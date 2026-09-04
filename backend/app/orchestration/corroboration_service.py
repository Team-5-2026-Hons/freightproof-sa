"""Independent Pulsit corroboration of a driver's handshake (FP-143).

Every phase completion is, by itself, a claim the driver's own phone makes about
itself: the phone reports where the phone is. This module adds the second source.
At each handshake it asks Pulsit — the tracker hardware bolted to the vehicle,
which the driver cannot influence from the app — where the horse and every trailer
actually are, and records that answer beside the driver's.

It writes exactly four things, and nothing else:

    phase_events.horse_gps_lat            the horse tracker's latitude
    phase_events.horse_gps_lng            the horse tracker's longitude
    phase_events.pulsit_geofence_confirmed  FP-68's verdict on that fix
    trailer_gps_snapshots                 one row per trailer that reported

No migration accompanies this module. All four already existed and simply had no
writer; that absence is what this module closes.

Scope fences, so a reader knows what this module deliberately does NOT do:
  * It does not compute geofence maths. FP-68's geofence_service owns that; this
    calls it and stores the verdict.
  * It does not speak HTTP to Pulsit. FP-87's integrations/pulsit.py owns that.
  * It does not raise GPS_MISMATCH. FP-145 owns that, and consumes what is
    written here.

╔══════════════════════════════════════════════════════════════════════════════╗
║  NULL SEMANTICS FOR pulsit_geofence_confirmed — three states, one column.     ║
║                                                                              ║
║    NULL   we could not check. No tracker fix, the unit was dark, Pulsit was  ║
║           unreachable, the device is unknown, the precinct has no            ║
║           coordinates, or the phase has no stop to check against.            ║
║    TRUE   we checked, and the vehicle was inside the geofence (radius plus   ║
║           the operational GPS tolerance).                                    ║
║    FALSE  we checked, and the vehicle was NOT there.                         ║
║                                                                              ║
║  FALSE is an accusation. NULL is an admission. Conflating them would let a   ║
║  dark tracker read to a dispatcher exactly like a truck in the wrong place,  ║
║  and this platform's entire value is that it does not overstate what it      ║
║  knows. The discriminator is GeofenceVerdict.reason: FP-68 returns           ║
║  confirmed=False for a missing fix, so its boolean must NEVER be persisted   ║
║  unless reason is MEASURED. That single check is what keeps the column       ║
║  honest — see _geofence_verdict_to_column() below.                           ║
╚══════════════════════════════════════════════════════════════════════════════╝

Offline handshakes and the timestamp gap (decision recorded 2026-09-04):
The driver app queues completions offline on the N3 and flushes on reconnect
(driver-pwa/lib/hooks/useOfflineQueue.ts). A completion queued at 14:00 and
flushed at 17:00 reaches this module at 17:00, and the phase-complete request body
carries NO client capture timestamp at all — the queue's own `enqueuedAt` is
never put on the wire. Pulsit cannot close that gap either: asked at 17:00 it
returns a fresh 17:00 fix, so the fix's own age does not reveal the delay.

The server therefore cannot detect a replayed handshake, and this module does not
pretend otherwise. What it does instead is refuse to launder the ambiguity:

  * trailer_gps_snapshots.captured_at stores the TRACKER's own reading time
    (PulsitFix.fixed_at), never now(). A reader comparing it against
    phase_events.completed_at can see the separation for themselves.
  * A positioned fix that arrives without its own timestamp is DISCARDED rather
    than stamped with now(). An invented time on an evidence platform is worse
    than a missing row.
  * phase_events.horse_gps_lat/lng have no timestamp column of their own, so they
    are honestly a fix taken when the SERVER PROCESSED the handshake, not when
    the driver swiped. On a live submission those are the same instant; on a
    replayed one they are not.

Closing the gap properly needs an optional client capture timestamp on the wire
(the pattern LocationPingBody.recorded_at already uses) plus a staleness window.
That is a shared-contract change spanning FP-70 and the driver app, and was
deliberately left out of this story rather than half-built here.

Where the distance went, for FP-145:
FP-68's GeofenceVerdict carries distance_metres, and phase_events has no column
for it. It needs none. Everything the distance is derived from is already
persisted — horse_gps_lat/lng, driver_phone_lat/lng, and the stop's precinct
coordinates — so FP-145 can recompute it with core.geo.haversine_metres at read
time, exactly as the dispatcher already does client-side for the "Driver /
vehicle separation" field (dispatcher/components/domain/PhaseLocationSection.tsx
and its geo.ts twin). Storing a derived number would add a column that could
drift out of step with the coordinates it was derived from. The distance is
logged here so a mismatch is traceable in the request log without a schema change.

Layering: orchestration → integrations/geofence → db. Never imported by
integrations/, never imports from api/.
"""

import logging
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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

# Phases whose geofence verdict is deliberately left NULL even when a fix is in
# hand. IN_TRANSIT is anchored to the stop it DEPARTS FROM (see the
# uq_phase_events_trip_stop_type comment in db/models/phases.py), so its
# trip_stop_id names the precinct the truck has just spent hours driving away
# from. Checking an arrival attestation against the origin would stamp
# confirmed=False on every healthy trip in the fleet — a fabricated accusation,
# which is precisely the failure mode the NULL semantics above exist to prevent.
# The position and the trailer snapshots are still recorded: where the truck was
# when the driver said "I have arrived" is real evidence, it just cannot be
# judged against this row's stop.
_PHASES_WITHOUT_A_GEOFENCE_VERDICT: frozenset[PhaseType] = frozenset({PhaseType.IN_TRANSIT})


async def _load_horse_device_id(db: AsyncSession, *, horse_id: uuid.UUID) -> Optional[str]:
    """The horse's tracker id, read live from the vehicle row.

    Unlike the trailers below this is not a snapshot, because there is no snapshot
    to read: Trip.horse_id is a plain FK and trip_trailers is the only table that
    froze a device id at creation. Reassigning a horse's tracker mid-trip would
    therefore change which device later phases read — flagged rather than solved,
    since fixing it means a column this story is forbidden from adding.
    """
    result = await db.execute(select(Vehicle.pulsit_device_id).where(Vehicle.id == horse_id))
    return result.scalar_one_or_none()


async def _load_trailer_devices(
    db: AsyncSession, *, trip_id: uuid.UUID
) -> list[tuple[uuid.UUID, str]]:
    """Every trailer on the trip as (trailer_id, device id), in a stable order.

    Reads pulsit_device_id_snapshot, NOT the trailer's current vehicle row. That
    column exists precisely so retroactively reassigning a tracker cannot rewrite
    what earlier phases recorded (see TripTrailer's own comment), and reading the
    live row here would defeat it. Ordered by trailer_id so a multi-trailer trip
    produces its snapshots deterministically and a test can assert on them.
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
    """The precinct this phase should have happened at, or None if it has no stop.

    Only trip_creation has a NULL trip_stop_id (parent D3), and no driver handshake
    completes that row — so the None branch is defensive rather than expected.
    """
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
    """Turn a fix and a precinct into the nullable boolean the column stores.

    The one place the three-state contract in this module's docstring is enforced.
    FP-68's evaluate_geofence returns confirmed=False when it had nothing to
    measure, so reading .confirmed unconditionally would write FALSE — "the truck
    was not there" — every time a tracker went dark. Only a MEASURED verdict is
    allowed to produce a boolean; everything else stays NULL.
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

    # The distance has no column by design (see module docstring). Logged so a
    # dispatcher query about a specific mismatch is traceable, and so FP-145 has a
    # worked example of the arithmetic it will recompute at read time.
    logger.info(
        "Geofence measured for %s: distance=%.1fm radius=%sm tolerance=%sm "
        "confirmed=%s in_tolerance_band=%s",
        context, verdict.distance_metres, verdict.radius_metres,
        verdict.tolerance_metres, verdict.confirmed, verdict.in_tolerance_band,
    )
    return verdict.confirmed


def _snapshot_for_trailer(
    *, phase_event_id: uuid.UUID, trailer_id: uuid.UUID, fix: PulsitFix
) -> Optional[TrailerGpsSnapshot]:
    """Build one trailer snapshot row, or None when the fix cannot honestly fill it.

    lat, lng and captured_at are all NOT NULL on trailer_gps_snapshots, so a
    trailer that did not report simply gets no row — an absent row is the honest
    record of a tracker that said nothing, and is exactly how "a trailer with no
    tracker" and "a tracker that is dark" both come out.

    The fixed_at guard is not redundant with has_position: PulsitFix's contract
    sets a timestamp on every positioned fix, but this module will not depend on
    another story's invariant to decide whether to invent a timestamp for
    evidence. If that invariant is ever broken, the row is dropped and logged
    rather than stamped with now().
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
        # The TRACKER's reading time, never now(). See the module docstring on
        # offline handshakes: this is the only place the staleness of a replayed
        # corroboration is visible at all.
        captured_at=fix.fixed_at,
    )


async def record_phase_corroboration(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent
) -> None:
    """Corroborate one phase handshake against Pulsit. NEVER raises.

    Called by every advance_* in phase_service.py, immediately after the driver's
    own phone fix is recorded, so the independent reading is taken as close as
    possible to the moment the driver's claim was.

    The whole body is wrapped, because the driver is standing at a gate. Pulsit
    being unreachable, a fleet record naming a tracker that does not exist, or a
    trailer row in a shape nobody anticipated must all end with the handshake
    completing and the corroboration recorded as unavailable — never with a 500
    on a swipe the driver has already physically performed. `except Exception` is
    deliberate and not a bare except: it is logged with a full traceback and
    returns, per the project's error rules.

    Catching a database error here does not make a broken session worse: the
    caller's own flush in _finish_phase would fail on the same session moments
    later, so this cannot mask a DB fault, only decline to be the thing that
    reports it.

    Writes only when it has something real. A None never overwrites a position
    stored by an earlier attempt, matching _record_driver_position's rule for the
    driver's own fix — a replayed offline submission must not erase corroboration
    its original delivery successfully captured.
    """
    context = f"phase_event_id={event.id} phase_type={event.phase_type}"
    try:
        horse_device_id = await _load_horse_device_id(db, horse_id=trip.horse_id)
        trailers = await _load_trailer_devices(db, trip_id=trip.id)

        if horse_device_id is None:
            # Trip.horse_id is NOT NULL and FK-constrained, so this is a fleet-data
            # fault, not an ordinary absence. Loud, but still not fatal.
            logger.error(
                "No vehicle row for horse_id=%s on trip_id=%s — cannot corroborate %s",
                trip.horse_id, trip.id, context,
            )

        # ONE batched call for the horse and every trailer. get_positions preserves
        # request order and returns a fix per requested id, so the response is split
        # back apart positionally below. A four-trailer trip costs one round trip,
        # not five — the reason FP-87's contract is batch-shaped at all.
        requested: list[str] = ([horse_device_id] if horse_device_id is not None else [])
        requested.extend(device_id for _, device_id in trailers)

        fixes: list[PulsitFix] = await get_pulsit_client().get_positions(requested)

        horse_fix: Optional[PulsitFix] = None
        if horse_device_id is not None and fixes:
            horse_fix = fixes[0]
            trailer_fixes = fixes[1:]
        else:
            trailer_fixes = fixes

        # ── FP-193: the horse position ──────────────────────────────────────────
        if horse_fix is not None and horse_fix.has_position:
            # Already Decimal from FP-87 — no float round trip on the way into
            # Numeric(10, 7), which is the whole reason PulsitFix parses to Decimal.
            event.horse_gps_lat = horse_fix.lat
            event.horse_gps_lng = horse_fix.lng
        elif horse_fix is not None:
            logger.info(
                "No horse position for %s (status=%s) — horse_gps columns left as they were",
                context, horse_fix.status.value,
            )

        # ── FP-194: the geofence verdict ────────────────────────────────────────
        if PhaseType(event.phase_type) in _PHASES_WITHOUT_A_GEOFENCE_VERDICT:
            logger.info(
                "Geofence verdict deliberately not evaluated for %s: this phase's stop is "
                "the one it departed from, not the one it is at",
                context,
            )
        else:
            precinct = await _load_precinct_for_phase(db, event=event)
            confirmed = _geofence_verdict_to_column(horse_fix, precinct, context=context)
            if confirmed is not None:
                event.pulsit_geofence_confirmed = confirmed

        # ── FP-195: one snapshot row per trailer that actually reported ─────────
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
        # Fail-open, mirroring _anchor_or_fail_open's stance on Hedera: the
        # handshake is evidence that already physically happened, and no external
        # system's outage may erase it. The corroboration columns stay NULL, which
        # the semantics above define as "we could not check" — exactly true.
        logger.exception(
            "Pulsit corroboration failed for %s — handshake continues, corroboration "
            "recorded as unavailable", context,
        )


async def record_checkpoint_corroboration(
    db: AsyncSession, *, trip: Trip, checkpoint: Checkpoint
) -> None:
    """Corroborate an in-transit checkpoint against Pulsit. NEVER raises.

    Scope note for review: FP-143 as written covers phase handshakes only. This
    entry point extends the same treatment to checkpoints by an explicit decision
    taken 2026-09-04, because the problem there was identical and worse —
    Checkpoint.horse_gps_lat was populated from the DRIVER'S OWN request payload,
    which is one source wearing two hats: the phone reporting its own position and
    also asserting where the truck is. A tracker reading obtained here supersedes
    the payload value entirely, which is the only thing that makes the column an
    independent source rather than a second copy of the driver's claim.

    No geofence verdict: a checkpoint happens on the road between precincts, so
    there is no fence to be inside of. Checkpoints have no trailer snapshot table
    either — trailer_gps_snapshots is keyed to a phase_event_id.

    Same fail-open contract as record_phase_corroboration: a driver logging a
    roadside checkpoint must not be blocked by an unreachable tracker API.
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

        fix = await get_pulsit_client().get_position(horse_device_id)
        if not fix.has_position:
            logger.info(
                "No horse position for %s (status=%s) — horse_gps columns left null",
                context, fix.status.value,
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
