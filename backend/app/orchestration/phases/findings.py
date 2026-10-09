"""System-detected exceptions raised while a phase completes: position disagreement, trailer
decoupling, scan shortfall and seal findings."""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.geo import format_distance, haversine_metres
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    ExceptionReviewStatus, ExceptionSeverity, ExceptionSource, ExceptionType, PhaseStatus,
)
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.review_policy import initial_review_status

logger = logging.getLogger(__name__)


def _phone_tracker_separation_metres(event: PhaseEvent) -> float | None:
    """How far apart the two independent position sources were, or None.

    None means "not measurable" — one of the two sources recorded no fix — and is
    never conflated with 0.0, which is a real and opposite claim: the phone and the
    tracker agreed exactly. Mirrors separationMetres() in the dispatcher's
    lib/phase/geo.ts, which computes the same number from the same two columns for
    the same card.
    """
    if (
        event.driver_phone_lat is None or event.driver_phone_lng is None
        or event.horse_gps_lat is None or event.horse_gps_lng is None
    ):
        return None
    return haversine_metres(
        event.driver_phone_lat, event.driver_phone_lng,
        event.horse_gps_lat, event.horse_gps_lng,
    )


async def _raise_position_disagreement_if_unrecorded(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent,
) -> None:
    """Record GPS_MISMATCH when Pulsit measured the vehicle away from this stop (FP-145).

    Consumes what FP-143's evidence.corroboration wrote moments earlier in this same
    request; computes nothing about geofences itself.

    ── ONLY FALSE RAISES. NEVER NULL. ────────────────────────────────────────────
    `is False`, deliberately, and never `not confirmed`. FP-143's three-state column
    reads NULL for "we could not check" — an unreachable tracker, a dark unit, a
    precinct with no coordinates — and `not None` is True, so the looser test would
    put a position disagreement against the name of every driver who drove through a
    coverage dead zone on the N3. FALSE is a measurement; NULL is an admission that
    no measurement exists. This one line is what keeps them apart.

    ── Why this lives here and not in exceptions.creation ───────────────────
    exceptions.creation owns DRIVER-raised exceptions: its entry point asserts the
    caller is the trip's assigned driver and stamps ExceptionSource.DRIVER on the
    row. Routing a system measurement through it would file the finding as something
    the driver reported about themselves, which is precisely backwards — the value of
    this exception is that a source the driver cannot influence produced it. Every
    other system-detected exception (parcel count, seal mismatch, seal unverified,
    waybill count) is written here, in this module, with source=SYSTEM; this follows
    that path rather than inventing a second one.

    ── Idempotent against the phase event ────────────────────────────────────────
    _gate_and_load already short-circuits a replayed completion before any wrapper
    body runs, so a re-synced offline handshake should never reach here twice. The
    existence check is kept anyway, for the same reason FP-143 re-checks a fix's
    timestamp it has been promised: evidence writes should not depend on another
    function's invariant holding. One exception per phase event, and the check is
    NOT filtered on `resolved` — a dispatcher who has already actioned this finding
    must not have a duplicate reappear when the driver app flushes its queue again.

    Never raises. A handshake is evidence that already physically happened; a fault
    while annotating it must not undo it. Same fail-open stance as
    _anchor_or_fail_open and record_phase_corroboration.
    """
    if event.pulsit_geofence_confirmed is not False:
        return

    try:
        existing = (await db.execute(
            select(TripException.id).where(
                TripException.phase_event_id == event.id,
                TripException.exception_type == ExceptionType.GPS_MISMATCH,
            )
        )).first()
        if existing is not None:
            return

        separation = _phone_tracker_separation_metres(event)
        if separation is None:
            description = (
                "The vehicle tracker's position is outside this stop's geofence at this "
                "handshake. Only one of the two position sources recorded a fix, so the "
                "separation between them could not be measured."
            )
        else:
            description = (
                f"Driver phone and vehicle tracker reported positions "
                f"{format_distance(separation)} apart at this handshake. The tracker's "
                f"position is outside this stop's geofence."
            )

        db.add(TripException(
            trip_id=trip.id,
            phase_event_id=event.id,
            # Scoped to the stop the phase is anchored to, as every other
            # system-detected exception in this module already does.
            trip_stop_id=event.trip_stop_id,
            exception_type=ExceptionType.GPS_MISMATCH,
            source=ExceptionSource.SYSTEM,
            # WARNING, not CRITICAL, and the choice is the copy rule in code form.
            # CRITICAL is this codebase's alarm tier: a seal mismatch, a panic button,
            # a seal broken in transit — findings with no benign reading. A single
            # geofence measurement has several: tracker drift, a stale cached fix, a
            # vehicle legitimately parked outside the fence while the driver walks in
            # to the gate office, or a precinct row whose coordinates or radius are
            # wrong. Putting a class of finding with real false-positive modes into
            # the alarm lane is how a dispatcher learns to ignore the alarm lane.
            # WARNING is also what the comparable measurement disagreement
            # (PARCEL_COUNT_MISMATCH) already uses. The separation is reported; the
            # dispatcher decides what it means.
            severity=ExceptionSeverity.WARNING,
            review_status=initial_review_status(ExceptionSeverity.WARNING),
            description=description,
            # The driver's own fix, which is what this column means on every other
            # writer. The tracker's fix has no column here and needs none: both
            # positions live on the phase_events row this exception points at, and
            # copying them into the exception would create a second version of the
            # same coordinates that could drift out of step with the first. The
            # separation is likewise recomputed at render time from those two
            # columns, per FP-143's note — no derived value is persisted.
            gps_lat=event.driver_phone_lat,
            gps_lng=event.driver_phone_lng,
        ))

        logger.info(
            "Recorded GPS_MISMATCH for phase_event_id=%s trip_id=%s: separation=%s",
            event.id, trip.id,
            "not measurable" if separation is None else f"{separation:.1f}m",
        )

        # FP-147's invariant: a system-detected exception that tells no one leaves the
        # dispatcher's screen showing a trip that no longer matches the record. WARNING
        # to match the row written above — event_severity widens the same value rather
        # than restating it, so the toast band cannot drift from the stored severity.
        # Inside the try: enqueue_event only appends to a session-local buffer, but if
        # it ever raises, a handshake the driver already completed must not 400.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.WARNING),
            ),
        )

    except Exception:
        # Deliberate broad catch, logged with a traceback per the project's error
        # rules, not a silent swallow. The driver is standing at a gate and has
        # already done the thing being recorded.
        logger.exception(
            "Could not record a position disagreement for phase_event_id=%s — the "
            "handshake stands and the corroboration columns still carry the finding",
            event.id,
        )


async def _raise_trailer_decoupling_if_unrecorded(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent,
) -> None:
    """Record TRAILER_LOCATION_MISMATCH when a trailer was measured away from its horse.

    Three conditions, all measurements, all required:
      1. the horse was measured INSIDE this stop's precinct (TRUE, not NULL),
      2. a trailer was measured OUTSIDE it (its snapshot's FALSE, not NULL), and
      3. that trailer's fix is further than TRAILER_HORSE_MAX_SEPARATION_METRES from
         the horse's own fix.

    CRITICAL, unlike GPS_MISMATCH's WARNING (see its reasoning above), because the
    conditions remove GPS_MISMATCH's benign readings. The horse's own TRUE shows the
    precinct's coordinates and the horse tracker are sound, so "wrong precinct data" is
    out. The separation rule removes the fence-edge case: a coupled trailer ~20 m behind
    a horse at the boundary can read outside while its horse reads inside, but it cannot
    be hundreds of metres from it. What is left is a trailer that is not where its horse
    is: uncoupled, one of the strongest theft signals the system can see.

    Same stance as _raise_position_disagreement_if_unrecorded: NULL never raises,
    idempotent per phase event, and never raises out of here.
    """
    if event.pulsit_geofence_confirmed is not True:
        return
    if event.horse_gps_lat is None or event.horse_gps_lng is None:
        return

    try:
        outside = (await db.execute(
            select(TrailerGpsSnapshot, Vehicle.registration)
            .join(Vehicle, Vehicle.id == TrailerGpsSnapshot.trailer_id)
            .where(
                TrailerGpsSnapshot.phase_event_id == event.id,
                TrailerGpsSnapshot.geofence_confirmed.is_(False),
            )
        )).all()
        decoupled: list[tuple[str, float]] = []
        for snapshot, registration in outside:
            separation = haversine_metres(
                snapshot.lat, snapshot.lng, event.horse_gps_lat, event.horse_gps_lng,
            )
            if separation > settings.TRAILER_HORSE_MAX_SEPARATION_METRES:
                decoupled.append((registration, separation))
        if not decoupled:
            return

        existing = (await db.execute(
            select(TripException.id).where(
                TripException.phase_event_id == event.id,
                TripException.exception_type == ExceptionType.TRAILER_LOCATION_MISMATCH,
            )
        )).first()
        if existing is not None:
            return

        # Registrations identify vehicles, not people, so they may be named here.
        trailers = "; ".join(
            f"trailer {registration} is {format_distance(separation)} from the horse"
            for registration, separation in decoupled
        )
        db.add(TripException(
            trip_id=trip.id, phase_event_id=event.id, trip_stop_id=event.trip_stop_id,
            exception_type=ExceptionType.TRAILER_LOCATION_MISMATCH,
            source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.CRITICAL,
            review_status=initial_review_status(ExceptionSeverity.CRITICAL),
            description=(
                f"The horse's tracker is inside this stop's geofence, but {trailers} and "
                f"outside the geofence. The trailer may have been uncoupled."
            ),
        ))
        logger.info(
            "Recorded TRAILER_LOCATION_MISMATCH for phase_event_id=%s trip_id=%s: %s",
            event.id, trip.id, trailers,
        )
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.CRITICAL),
            ),
        )

    except Exception:
        # Same deliberate, logged broad catch as the GPS_MISMATCH check above: the
        # snapshots still carry every verdict, so nothing recorded is lost.
        logger.exception(
            "Could not record a trailer decoupling for phase_event_id=%s — the handshake "
            "stands and the trailer snapshots still carry their verdicts",
            event.id,
        )


async def _raise_scan_shortfall_if_unrecorded(
    db: AsyncSession, *, trip_id: uuid.UUID, event: PhaseEvent,
    consignment: Consignment, scanned_out: int, expected: int,
) -> bool:
    """Record a scan-out shortfall only if consignments.scans has not already recorded one.

    Returns True when a row was written, False when an existing unresolved one made
    this a no-op. The caller needs the distinction to decide whether to publish a
    realtime event: it holds the Trip (and so the org id) that this helper does not,
    and a suppressed duplicate must not wake the dispatcher a second time.

    Deliberately keyed on (consignment, stop, type, unresolved) rather than on the
    description string consignments.scans's own dedup compares: the two writers word the
    same finding differently, so a text comparison would let both through. The
    question being asked here is "is this discrepancy already on the dispatcher's
    list", and the answer must not depend on who phrased it.
    """
    existing = (await db.execute(
        select(TripException.id).where(
            TripException.trip_id == trip_id,
            TripException.consignment_id == consignment.id,
            TripException.trip_stop_id == event.trip_stop_id,
            TripException.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH,
            TripException.review_status != ExceptionReviewStatus.REVIEWED,
        )
    )).first()
    if existing is not None:
        return False

    db.add(TripException(
        trip_id=trip_id, phase_event_id=event.id,
        consignment_id=consignment.id, trip_stop_id=event.trip_stop_id,
        exception_type=ExceptionType.PARCEL_COUNT_MISMATCH,
        source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
        review_status=initial_review_status(ExceptionSeverity.WARNING),
        description=(
            f"Warehouse closed its scan-out session on waybill "
            f"{consignment.parcel_perfect_reference} with "
            f"{scanned_out} of {expected} parcel(s) scanned."
        ),
    ))
    return True


def _record_seal_finding(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent,
    exception_type: ExceptionType, severity: ExceptionSeverity, description: str,
) -> None:
    """Write one seal finding against the arrival row and publish it. The phase row
    becomes EXCEPTION, which _is_resolved treats as resolved: the finding is recorded
    without stopping the ledger (see the SEAL_MISMATCH comment in advance_arrival)."""
    event.status = PhaseStatus.EXCEPTION
    db.add(TripException(
        trip_id=trip.id, phase_event_id=event.id,
        exception_type=exception_type, source=ExceptionSource.SYSTEM,
        severity=severity,
        review_status=initial_review_status(severity),
        description=description,
    ))
    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED, severity=event_severity(severity)),
    )


def _seal_unverified_severity(departure_event: PhaseEvent) -> ExceptionSeverity:
    """Severity of a SEAL_UNVERIFIED finding for a leg whose departure has no seal.
    See the comment above its use in advance_arrival for why the split exists."""
    absence_is_explained = departure_event.status == PhaseStatus.OVERRIDDEN
    return ExceptionSeverity.WARNING if absence_is_explained else ExceptionSeverity.CRITICAL
