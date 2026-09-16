"""Independent Pulsit corroboration of a driver's handshake (FP-143).

At each phase handshake, asks Pulsit — tracker hardware on the vehicle, which the
driver cannot influence — where the horse and every trailer actually are, and
records that alongside the driver's own claim. Writes phase_events.horse_gps_lat/lng,
phase_events.pulsit_geofence_confirmed, and trailer_gps_snapshots; nothing else.

Does not compute geofence maths (geofence_service), speak HTTP to Pulsit
(integrations/pulsit.py), or raise GPS_MISMATCH (FP-145) — those own that,
this only writes what they consume.

Layering: orchestration → integrations/geofence → db. Never imported by
integrations/, never imports from api/.
"""

import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.enums import PhaseType
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot
from app.db.models.transit import Checkpoint
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.integrations.pulsit import PulsitFix, get_pulsit_client
from app.orchestration.geofence_service import (
    GeofenceVerdictReason, TrackerFix, evaluate_geofence,
)

logger = logging.getLogger(__name__)

# IN_TRANSIT's trip_stop_id names the stop it DEPARTS FROM (see
# uq_phase_events_trip_stop_type in db/models/phases.py), so checking an arrival
# fix against it would falsely flag confirmed=False on every healthy trip.
# Position/trailer snapshots are still recorded, just not judged against this stop.
_PHASES_WITHOUT_A_GEOFENCE_VERDICT: frozenset[PhaseType] = frozenset({PhaseType.IN_TRANSIT})


async def _load_horse_device_id(db: AsyncSession, *, horse_id: uuid.UUID) -> Optional[str]:
    """The horse's tracker id, read live from the vehicle row.

    Unlike trailers, there's no snapshot column for the horse's device — Trip.horse_id
    is a plain FK, so reassigning a tracker mid-trip changes what later phases read.
    """
    result = await db.execute(select(Vehicle.pulsit_device_id).where(Vehicle.id == horse_id))
    return result.scalar_one_or_none()


async def _load_trailer_devices(
    db: AsyncSession, *, trip_id: uuid.UUID
) -> list[tuple[uuid.UUID, str]]:
    """Every trailer on the trip as (trailer_id, device id), ordered by trailer_id.

    Reads pulsit_device_id_snapshot, NOT the trailer's current vehicle row, so a
    later tracker reassignment can't rewrite what earlier phases recorded.
    """
    result = await db.execute(
        select(TripTrailer.trailer_id, TripTrailer.pulsit_device_id_snapshot)
        .where(TripTrailer.trip_id == trip_id)
        .order_by(TripTrailer.trailer_id)
    )
    return [(trailer_id, device_id) for trailer_id, device_id in result.all()]


async def _load_precinct_for_phase(
    db: AsyncSession, *, event: PhaseEvent
) -> Optional[Precinct]:
    """The precinct this phase should have happened at, or None if it has no stop."""
    if event.trip_stop_id is None:
        return None
    result = await db.execute(
        select(Precinct)
        .join(TripStop, TripStop.precinct_id == Precinct.id)
        .where(TripStop.id == event.trip_stop_id)
    )
    return result.scalar_one_or_none()


def _geofence_verdict_to_column(
    fix: Optional[PulsitFix], precinct: Optional[Precinct], *, context: str
) -> Optional[bool]:
    """Turn a fix and a precinct into the nullable boolean pulsit_geofence_confirmed stores.

    Three states: NULL = could not check, TRUE/FALSE = checked and confirmed/denied.
    evaluate_geofence returns confirmed=False when it had nothing to measure, so only
    a MEASURED verdict may produce a boolean — everything else stays NULL, since FALSE
    is an accusation and must never be inferred from a dark tracker.
    """
    tracker_fix = (
        TrackerFix(lat=fix.lat, lng=fix.lng)
        if fix is not None and fix.has_position and fix.lat is not None and fix.lng is not None
        else None
    )
    verdict = evaluate_geofence(tracker_fix, precinct)

    if verdict.reason is not GeofenceVerdictReason.MEASURED:
        logger.info(
            "Geofence not evaluated for %s: %s — recording pulsit_geofence_confirmed as NULL "
            "('could not check'), never False",
            context, verdict.reason.value,
        )
        return None

    # distance_metres has no column: it's derivable from the stored lat/lng at read
    # time (core.geo.haversine_metres), so storing it would risk drift. Logged for
    # traceability only.
    logger.info(
        "Geofence measured for %s: distance=%.1fm radius=%sm tolerance=%sm "
        "confirmed=%s in_tolerance_band=%s",
        context, verdict.distance_metres, verdict.radius_metres,
        verdict.tolerance_metres, verdict.confirmed, verdict.in_tolerance_band,
    )
    return verdict.confirmed


def _within_corroboration_skew(
    *, fixed_at: Optional[datetime], driver_captured_at: Optional[datetime],
) -> bool:
    """Whether a Pulsit fix and the driver's own capture instant are close enough in
    time to trust the fix as corroboration (task 0A).

    Offline-queued handshakes can flush hours after capture; a fresh fix taken at
    flush time would otherwise look like it confirmed a stale claim. Either input
    missing resolves to False — "cannot verify timing" — never True.
    """
    if fixed_at is None or driver_captured_at is None:
        return False
    skew_seconds = abs((fixed_at - driver_captured_at).total_seconds())
    return skew_seconds <= settings.PULSIT_CORROBORATION_MAX_SKEW_SECONDS


def _snapshot_for_trailer(
    *, phase_event_id: uuid.UUID, trailer_id: uuid.UUID, fix: PulsitFix
) -> Optional[TrailerGpsSnapshot]:
    """Build one trailer snapshot row, or None when the fix cannot honestly fill it.

    lat, lng and captured_at are all NOT NULL on trailer_gps_snapshots, so a
    trailer that did not report simply gets no row rather than a fabricated one.
    """
    if not fix.has_position or fix.lat is None or fix.lng is None:
        return None
    if fix.fixed_at is None:
        logger.error(
            "Pulsit device=%s returned a position with no reading time — dropping the "
            "trailer snapshot rather than stamping it with the current time",
            fix.device_id,
        )
        return None
    return TrailerGpsSnapshot(
        phase_event_id=phase_event_id,
        trailer_id=trailer_id,
        pulsit_device_id=fix.device_id,
        lat=fix.lat,
        lng=fix.lng,
        captured_at=fix.fixed_at,  # tracker's reading time, never now()
    )


async def record_phase_corroboration(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent,
    driver_captured_at: Optional[datetime] = None,
) -> None:
    """Corroborate one phase handshake against Pulsit. NEVER raises.

    Called by every advance_* in phase_service.py right after the driver's own fix
    is recorded. `driver_captured_at` (task 0A) gates whether the horse position and
    geofence verdict get written; see `_within_corroboration_skew`. Errors are caught
    and logged, not raised: a driver standing at a gate must not get a 500 because
    Pulsit is unreachable — the corroboration columns simply stay NULL.
    """
    context = f"phase_event_id={event.id} phase_type={event.phase_type}"
    try:
        horse_device_id = await _load_horse_device_id(db, horse_id=trip.horse_id)
        trailers = await _load_trailer_devices(db, trip_id=trip.id)

        if horse_device_id is None:
            # Trip.horse_id is NOT NULL/FK-constrained, so this is a fleet-data fault.
            logger.error(
                "No vehicle row for horse_id=%s on trip_id=%s — cannot corroborate %s",
                trip.horse_id, trip.id, context,
            )

        # One batched call; get_positions preserves request order so the response
        # is split back apart positionally below.
        requested: list[str] = ([horse_device_id] if horse_device_id is not None else [])
        requested.extend(device_id for _, device_id in trailers)

        fixes: list[PulsitFix] = await get_pulsit_client(
            organization_id=trip.operator_organization_id
        ).get_positions(requested)

        horse_fix: Optional[PulsitFix] = None
        if horse_device_id is not None and fixes:
            horse_fix = fixes[0]
            trailer_fixes = fixes[1:]
        else:
            trailer_fixes = fixes

        # Checked once, gates both the position write and the verdict below.
        horse_fix_is_timely = horse_fix is not None and _within_corroboration_skew(
            fixed_at=horse_fix.fixed_at, driver_captured_at=driver_captured_at,
        )
        if horse_fix is not None and horse_fix.has_position and not horse_fix_is_timely:
            logger.info(
                "Horse fix for %s is outside the %ss corroboration skew "
                "(fixed_at=%s driver_captured_at=%s) — leaving horse_gps and the "
                "geofence verdict as 'could not compare', never a fabricated position",
                context, settings.PULSIT_CORROBORATION_MAX_SKEW_SECONDS,
                horse_fix.fixed_at, driver_captured_at,
            )

        if horse_fix is not None and horse_fix.has_position and horse_fix_is_timely:
            # Already Decimal, so no float round trip into Numeric(10, 7).
            event.horse_gps_lat = horse_fix.lat
            event.horse_gps_lng = horse_fix.lng
        elif horse_fix is not None and not horse_fix.has_position:
            logger.info(
                "No horse position for %s (status=%s) — horse_gps columns left as they were",
                context, horse_fix.status.value,
            )

        if PhaseType(event.phase_type) in _PHASES_WITHOUT_A_GEOFENCE_VERDICT:
            logger.info(
                "Geofence verdict deliberately not evaluated for %s: this phase's stop is "
                "the one it departed from, not the one it is at",
                context,
            )
        else:
            precinct = await _load_precinct_for_phase(db, event=event)
            # An untimely fix is passed as None: "can't be trusted now" and "no fix
            # at all" both mean could-not-check to evaluate_geofence.
            verdict_fix = horse_fix if horse_fix_is_timely else None
            confirmed = _geofence_verdict_to_column(verdict_fix, precinct, context=context)
            if confirmed is not None:
                event.pulsit_geofence_confirmed = confirmed

        for (trailer_id, _device_id), trailer_fix in zip(trailers, trailer_fixes, strict=False):
            snapshot = _snapshot_for_trailer(
                phase_event_id=event.id, trailer_id=trailer_id, fix=trailer_fix
            )
            if snapshot is None:
                logger.info(
                    "Trailer %s reported no usable position for %s (status=%s) — no snapshot row",
                    trailer_id, context, trailer_fix.status.value,
                )
                continue
            db.add(snapshot)

    except Exception:
        # Fail-open, mirroring _anchor_or_fail_open's stance on Hedera: an external
        # outage must not erase evidence that already physically happened.
        logger.exception(
            "Pulsit corroboration failed for %s — handshake continues, corroboration "
            "recorded as unavailable", context,
        )


async def record_checkpoint_corroboration(
    db: AsyncSession, *, trip: Trip, checkpoint: Checkpoint,
    driver_captured_at: Optional[datetime] = None,
) -> None:
    """Corroborate an in-transit checkpoint against Pulsit. NEVER raises.

    The tracker reading supersedes Checkpoint.horse_gps_lat/lng, which the driver's
    own payload otherwise populates — making the column an independent source rather
    than a copy of the driver's claim. No geofence verdict or trailer snapshots: a
    checkpoint is mid-road, not at a precinct, and isn't keyed to a phase_event_id.
    Same skew gate and fail-open contract as record_phase_corroboration.
    """
    context = f"checkpoint_id={checkpoint.id} trip_id={trip.id}"
    try:
        horse_device_id = await _load_horse_device_id(db, horse_id=trip.horse_id)
        if horse_device_id is None:
            logger.error(
                "No vehicle row for horse_id=%s on trip_id=%s — cannot corroborate %s",
                trip.horse_id, trip.id, context,
            )
            return

        fix = await get_pulsit_client(
            organization_id=trip.operator_organization_id
        ).get_position(horse_device_id)
        if not fix.has_position:
            logger.info(
                "No horse position for %s (status=%s) — horse_gps columns left null",
                context, fix.status.value,
            )
            return

        if not _within_corroboration_skew(
            fixed_at=fix.fixed_at, driver_captured_at=driver_captured_at,
        ):
            logger.info(
                "Horse fix for %s is outside the %ss corroboration skew "
                "(fixed_at=%s driver_captured_at=%s) — horse_gps columns left null, "
                "never a fabricated position",
                context, settings.PULSIT_CORROBORATION_MAX_SKEW_SECONDS,
                fix.fixed_at, driver_captured_at,
            )
            return

        checkpoint.horse_gps_lat = fix.lat
        checkpoint.horse_gps_lng = fix.lng

    except Exception:
        logger.exception(
            "Pulsit corroboration failed for %s — checkpoint continues, corroboration "
            "recorded as unavailable", context,
        )


__all__ = [
    "record_checkpoint_corroboration",
    "record_phase_corroboration",
]
