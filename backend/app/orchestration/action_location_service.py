"""Assembles ActionLocationAssessment snapshots and raises the distinct
DRIVER_VEHICLE_SEPARATION and DRIVER_LOCATION_MISMATCH findings they can imply
(Task 5 of the trip-location-timeline-improvements story; DRIVER_LOCATION_MISMATCH
added to close a gap DRIVER_VEHICLE_SEPARATION alone leaves open — see
record_driver_location_finding's own docstring).

Two independent modules each answer one narrow question, deliberately kept apart
(see their own docstrings): `proximity_service.evaluate_proximity` answers "how far
apart are the driver's own phone and the vehicle's Pulsit tracker?"; `geofence_
service.evaluate_geofence` answers "is a fix inside a precinct's fence?" — asked
here once for the driver's own phone and once for the truck, so a dispatcher can
tell "truck in precinct, driver's phone elsewhere" apart from "both parties
together, outside the fence". This module is the ONLY place those two answers are
combined into one `ActionLocationAssessment` (schemas/action_location.py, Task 4)
and the only place that snapshot is persisted or turned into evidence.

Kept separate from GPS_MISMATCH (phase_service._raise_position_disagreement_if_
unrecorded), which answers a third, independent question: "does the TRACKER agree
with the PRECINCT?". A single handshake can trip GPS_MISMATCH, DRIVER_VEHICLE_
SEPARATION, both, or neither — they measure different pairs of things and neither
implies the other. A truck sitting correctly in its precinct while the driver's
phone is genuinely elsewhere (left in the cab, handed to a co-driver) is exactly
the case DRIVER_VEHICLE_SEPARATION exists to catch and GPS_MISMATCH cannot.

A FOURTH, equally independent question — "does the DRIVER'S OWN PHONE agree with
the PRECINCT?" — is DRIVER_LOCATION_MISMATCH (record_driver_location_finding). It
exists because DRIVER_VEHICLE_SEPARATION only ever fires once a real phone-to-
tracker DISTANCE was measured (`assessment.proximity == "separated"`); when the
truck's tracker fix is stale or simply unavailable, that comparison never runs at
all, and a driver whose phone is measurably 50km outside the stop's precinct
produces no finding whatsoever. DRIVER_LOCATION_MISMATCH reads `assessment.
driver_in_precinct` directly instead, so it fires independently of whether a
tracker fix existed to compare against.

Scope fence for reviewers: driver-raised exception reports (exception_service.py,
DriverExceptionCreateBody) are NOT wired to this module by this story, even though
R8 adds `driver_accuracy_metres` to that schema and R13 adds `exceptions.
action_location_assessment` to the table those reports live in. Both exist now so
a later task can populate them without a second migration; exception_service.py is
not in this story's file list, and a driver exception report's own capture
assessment — embedded on ITS OWN row, never as a second recursively-generated
TripException — is that later task's wiring, not this one's.

Layering: orchestration → orchestration/proximity_service, orchestration/
geofence_service, integrations(PulsitFix type only) → db. Never imported by
integrations/ or db/; never imports from api/.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    ExceptionReviewStatus, ExceptionSeverity, ExceptionSource, ExceptionType, PhaseStatus, PhaseType,
    TripStatus,
)
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint, TripException
from app.db.models.trips import Trip, TripStop
from app.integrations.pulsit import PulsitFix, PulsitFixSource, PulsitFixStatus, get_pulsit_client
from app.orchestration.geofence_service import (
    DEFAULT_GEOFENCE_RADIUS_METRES, GeofenceVerdictReason, TrackerFix, evaluate_geofence,
)
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.orchestration.proximity_service import evaluate_proximity
from app.schemas.action_location import (
    ACTION_LOCATION_POLICY_VERSION, ActionLocationAssessment, DriverLocationCapture,
)

logger = logging.getLogger(__name__)

# Name of the two partial unique indexes on `exceptions`
# (migration ciaran_action_location) — matched against violated_constraint() so an
# unrelated unique violation on this table is never misread as this replay/race.
_PHASE_SEPARATION_INDEX = "uq_exceptions_phase_separation"
_CHECKPOINT_SEPARATION_INDEX = "uq_exceptions_checkpoint_separation"

# Name of the DRIVER_LOCATION_MISMATCH partial unique index (migration
# tim_driver_location_mismatch). Phase-scoped only — driver_in_precinct is never
# set for a checkpoint's own assessment (build_checkpoint_assessment/build_capture_
# assessment always leave it None), so there is no checkpoint-scoped twin to name.
_PHASE_DRIVER_LOCATION_INDEX = "uq_exceptions_phase_driver_location"

# A dispatcher-facing description must stay a short, scannable fact, not a wall of
# driver-submitted text — the payload already caps location_warning_reason at 1000
# chars (schemas/phases.py) before it ever reaches this module; this is a second,
# tighter guard on what actually renders inline in the exception feed.
_MAX_DRIVER_REASON_CHARS_IN_DESCRIPTION = 300

# Mirrors phase_service._format_separation exactly, duplicated rather than imported:
# phase_service imports THIS module (to call build_phase_assessment/
# record_separation_finding from _finish_phase), so importing back from it would be
# circular. A three-line formatter is cheaper to keep in step by hand than to solve
# with a shared module for one function.
_SEPARATION_KM_THRESHOLD_METRES = 1000
_LOCATION_PREVIEW_TRACKER_TIMEOUT_SECONDS = 2.0

# Trip states in which a preview is pointless: nothing can be completed on a trip that
# is over, cancelled, or frozen on a hold, so there is no Pulsit read worth paying for.
_PREVIEW_INELIGIBLE_TRIP_STATUSES = frozenset(
    {TripStatus.CLOSED, TripStatus.CANCELLED, TripStatus.EXCEPTION_HOLD}
)


class PhaseLocationPreviewConflictError(Exception):
    """The addressed phase is no longer eligible for an advisory preview."""


def _format_metres(metres: float) -> str:
    if metres < _SEPARATION_KM_THRESHOLD_METRES:
        return f"{round(metres)} m"
    return f"{metres / _SEPARATION_KM_THRESHOLD_METRES:.1f} km"


def _describe_driver_reason(driver_reason: Optional[str]) -> str:
    """A trailing description clause attributing the driver's own words, or "" when
    none was given. Clearly attributed ("Driver's reason: ...") so a dispatcher
    reading the exception can never mistake the driver's own explanation for a
    second measured fact. Truncated to _MAX_DRIVER_REASON_CHARS_IN_DESCRIPTION —
    see that constant's own comment for why."""
    if driver_reason is None:
        return ""
    reason = driver_reason.strip()
    if not reason:
        return ""
    if len(reason) > _MAX_DRIVER_REASON_CHARS_IN_DESCRIPTION:
        reason = reason[:_MAX_DRIVER_REASON_CHARS_IN_DESCRIPTION].rstrip() + "…"
    return f' Driver\'s reason: "{reason}".'


async def _load_precinct_for_stop(db: AsyncSession, *, trip_stop_id: uuid.UUID) -> Optional[Precinct]:
    """The precinct a stop resolves to. Mirrors corroboration_service._load_precinct_
    for_phase's join exactly — deliberately not imported from there (that helper takes
    a PhaseEvent and this module also serves checkpoints, which have no trip_stop_id),
    so this owns the smaller, phase-agnostic query it actually needs.
    """
    result = await db.execute(
        select(Precinct).join(TripStop, TripStop.precinct_id == Precinct.id).where(TripStop.id == trip_stop_id)
    )
    return result.scalar_one_or_none()


def _tracker_fix(lat: Optional[float], lng: Optional[float]) -> Optional[TrackerFix]:
    if lat is None or lng is None:
        return None
    return TrackerFix(lat=lat, lng=lng)


async def build_phase_assessment(
    db: AsyncSession,
    *,
    trip: Trip,
    event: PhaseEvent,
    horse_fix: Optional[PulsitFix],
    driver_accuracy_metres: Optional[float],
    evaluated_at: datetime,
    capture: DriverLocationCapture | None = None,
) -> ActionLocationAssessment:
    """Assemble one ActionLocationAssessment for a phase handshake.

    `horse_fix` is the SAME fix corroboration_service.record_phase_corroboration
    already obtained moments earlier in this same request (R12) — this function
    never calls Pulsit itself, so no action pays for a second tracker round trip.

    Precinct membership (driver_in_precinct/truck_in_precinct and the geometry
    fields) is only ever evaluated for a phase anchored to a stop, and never for
    IN_TRANSIT — exactly `corroboration_service._PHASES_WITHOUT_A_GEOFENCE_VERDICT`'s
    own reasoning: IN_TRANSIT's trip_stop_id names the stop the leg DEPARTED FROM,
    so checking an arrival attestation's position against it would judge "have you
    arrived" against "where you started". `expected_trip_stop_id` on the returned
    assessment still carries `event.trip_stop_id` regardless — it is the honest
    record of which stop this assessment's phase was anchored to, independent of
    whether a precinct check against that stop made sense.
    """
    # Preview supplies an ephemeral capture; completion deliberately leaves this
    # unset so its persisted event fields remain the sole input to final evidence.
    driver_lat = (
        capture.driver_phone_lat if capture is not None
        else (float(event.driver_phone_lat) if event.driver_phone_lat is not None else None)
    )
    driver_lng = (
        capture.driver_phone_lng if capture is not None
        else (float(event.driver_phone_lng) if event.driver_phone_lng is not None else None)
    )
    driver_captured_at = capture.driver_captured_at if capture is not None else event.driver_captured_at
    if capture is not None:
        driver_accuracy_metres = capture.driver_accuracy_metres

    tracker_lat: Optional[float] = None
    tracker_lng: Optional[float] = None
    tracker_captured_at: Optional[datetime] = None
    if horse_fix is not None and horse_fix.has_position:
        tracker_lat = float(horse_fix.lat)
        tracker_lng = float(horse_fix.lng)
        tracker_captured_at = horse_fix.fixed_at

    proximity, separation_metres, reasons = evaluate_proximity(
        driver_lat=driver_lat, driver_lng=driver_lng,
        tracker_lat=tracker_lat, tracker_lng=tracker_lng,
        driver_captured_at=driver_captured_at, tracker_captured_at=tracker_captured_at,
        driver_accuracy_metres=driver_accuracy_metres, evaluated_at=evaluated_at,
        max_separation_metres=settings.DRIVER_TRUCK_MAX_SEPARATION_METRES,
        max_age_seconds=settings.DRIVER_TRUCK_MAX_FIX_AGE_SECONDS,
        max_skew_seconds=settings.DRIVER_TRUCK_MAX_SKEW_SECONDS,
        max_phone_accuracy_metres=settings.DRIVER_TRUCK_MAX_PHONE_ACCURACY_METRES,
    )

    precinct_id: Optional[uuid.UUID] = None
    precinct_lat: Optional[float] = None
    precinct_lng: Optional[float] = None
    precinct_radius_metres: Optional[float] = None
    precinct_tolerance_metres: Optional[float] = None
    driver_in_precinct: Optional[bool] = None
    truck_in_precinct: Optional[bool] = None

    checkable = (
        PhaseType(event.phase_type) is not PhaseType.IN_TRANSIT and event.trip_stop_id is not None
    )
    if checkable:
        precinct = await _load_precinct_for_stop(db, trip_stop_id=event.trip_stop_id)
        if precinct is not None and precinct.latitude is not None and precinct.longitude is not None:
            precinct_id = precinct.id
            precinct_lat = float(precinct.latitude)
            precinct_lng = float(precinct.longitude)
            precinct_radius_metres = float(
                DEFAULT_GEOFENCE_RADIUS_METRES
                if precinct.geofence_radius_metres is None
                else precinct.geofence_radius_metres
            )
            precinct_tolerance_metres = float(settings.GPS_TOLERANCE_METRES)

            driver_verdict = evaluate_geofence(_tracker_fix(driver_lat, driver_lng), precinct)
            truck_verdict = evaluate_geofence(_tracker_fix(tracker_lat, tracker_lng), precinct)
            driver_in_precinct = (
                driver_verdict.confirmed if driver_verdict.reason is GeofenceVerdictReason.MEASURED else None
            )
            truck_in_precinct = (
                truck_verdict.confirmed if truck_verdict.reason is GeofenceVerdictReason.MEASURED else None
            )

    return ActionLocationAssessment(
        policy_version=ACTION_LOCATION_POLICY_VERSION,
        evaluated_at=evaluated_at,
        driver_lat=driver_lat,
        driver_lng=driver_lng,
        driver_captured_at=driver_captured_at,
        driver_accuracy_metres=driver_accuracy_metres,
        tracker_lat=tracker_lat,
        tracker_lng=tracker_lng,
        tracker_captured_at=tracker_captured_at,
        separation_metres=separation_metres,
        proximity=proximity,
        reasons=reasons,
        max_separation_metres=settings.DRIVER_TRUCK_MAX_SEPARATION_METRES,
        max_age_seconds=settings.DRIVER_TRUCK_MAX_FIX_AGE_SECONDS,
        max_skew_seconds=settings.DRIVER_TRUCK_MAX_SKEW_SECONDS,
        max_phone_accuracy_metres=settings.DRIVER_TRUCK_MAX_PHONE_ACCURACY_METRES,
        expected_trip_stop_id=event.trip_stop_id,
        precinct_id=precinct_id,
        precinct_lat=precinct_lat,
        precinct_lng=precinct_lng,
        precinct_radius_metres=precinct_radius_metres,
        precinct_tolerance_metres=precinct_tolerance_metres,
        driver_in_precinct=driver_in_precinct,
        truck_in_precinct=truck_in_precinct,
    )


async def preview_phase_location(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    driver_id: uuid.UUID,
    phase_event_id: uuid.UUID,
    capture: DriverLocationCapture,
) -> ActionLocationAssessment:
    """Evaluate a fresh phone capture without altering phase or evidence records."""
    trip_result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.driver_id == driver_id)
    )
    trip = trip_result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    event_result = await db.execute(
        select(PhaseEvent).where(PhaseEvent.id == phase_event_id, PhaseEvent.trip_id == trip.id)
    )
    event = event_result.scalar_one_or_none()
    if event is None:
        raise ResourceNotFoundError("PhaseEvent", str(phase_event_id))
    if TripStatus(trip.status) in _PREVIEW_INELIGIBLE_TRIP_STATUSES:
        raise PhaseLocationPreviewConflictError("This trip is no longer active for a location preview.")
    if PhaseStatus(event.status) not in (PhaseStatus.PENDING, PhaseStatus.IN_PROGRESS):
        raise PhaseLocationPreviewConflictError("This phase is already resolved and cannot be previewed.")

    source = PulsitFixSource.MOCK if settings.PULSE_USE_MOCK else PulsitFixSource.LIVE
    device_id = await _load_horse_device_id_for_preview(db, horse_id=trip.horse_id)
    horse_fix = PulsitFix(
        device_id=device_id or "unavailable", status=PulsitFixStatus.UNAVAILABLE,
        source=source, lat=None, lng=None, fixed_at=None,
    )
    if device_id is not None:
        try:
            horse_fix = await asyncio.wait_for(
                get_pulsit_client(organization_id=trip.operator_organization_id).get_position(device_id),
                timeout=_LOCATION_PREVIEW_TRACKER_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            # Telemetry is advisory.  A failure must remain visible in the returned
            # assessment, but must never turn a preview into a write/retry workflow.
            logger.warning("Location preview tracker read unavailable for trip=%s: %s", trip.id, exc)

    return await build_phase_assessment(
        db, trip=trip, event=event, horse_fix=horse_fix,
        driver_accuracy_metres=capture.driver_accuracy_metres,
        evaluated_at=datetime.now(UTC), capture=capture,
    )


async def _load_horse_device_id_for_preview(db: AsyncSession, *, horse_id: uuid.UUID) -> str | None:
    from app.db.models.vehicles import Vehicle

    result = await db.execute(select(Vehicle.pulsit_device_id).where(Vehicle.id == horse_id))
    return result.scalar_one_or_none()


def build_checkpoint_assessment(
    *,
    checkpoint: Checkpoint,
    horse_fix: Optional[PulsitFix],
    driver_accuracy_metres: Optional[float],
    evaluated_at: datetime,
) -> ActionLocationAssessment:
    """Assemble one ActionLocationAssessment for an in-transit checkpoint.

    No precinct membership at all, and no DB access (unlike build_phase_assessment):
    a checkpoint happens on the road between precincts, so there is no fence for
    either party to be inside of, and `expected_trip_stop_id` is always None —
    Checkpoint carries no trip_stop_id to report. Thin adapter over
    build_capture_assessment: it only reads the checkpoint's own phone fix off the row.
    """
    return build_capture_assessment(
        driver_lat=float(checkpoint.driver_phone_lat) if checkpoint.driver_phone_lat is not None else None,
        driver_lng=float(checkpoint.driver_phone_lng) if checkpoint.driver_phone_lng is not None else None,
        driver_captured_at=checkpoint.driver_captured_at,
        driver_accuracy_metres=driver_accuracy_metres,
        horse_fix=horse_fix,
        evaluated_at=evaluated_at,
    )


def build_capture_assessment(
    *,
    driver_lat: Optional[float],
    driver_lng: Optional[float],
    driver_captured_at: Optional[datetime],
    driver_accuracy_metres: Optional[float],
    horse_fix: Optional[PulsitFix],
    evaluated_at: datetime,
) -> ActionLocationAssessment:
    """Assemble one ActionLocationAssessment for a bare phone capture with no phase
    or precinct context — the shape a checkpoint and a driver exception report share.

    Takes the capture as plain values rather than an ORM row so a caller that holds
    the fix on some other record (exception_service: the report row itself) never has
    to fabricate a Checkpoint instance just to satisfy a parameter type. Pure: no DB.
    """
    tracker_lat: Optional[float] = None
    tracker_lng: Optional[float] = None
    tracker_captured_at: Optional[datetime] = None
    if horse_fix is not None and horse_fix.has_position:
        tracker_lat = float(horse_fix.lat)
        tracker_lng = float(horse_fix.lng)
        tracker_captured_at = horse_fix.fixed_at

    proximity, separation_metres, reasons = evaluate_proximity(
        driver_lat=driver_lat, driver_lng=driver_lng,
        tracker_lat=tracker_lat, tracker_lng=tracker_lng,
        driver_captured_at=driver_captured_at, tracker_captured_at=tracker_captured_at,
        driver_accuracy_metres=driver_accuracy_metres, evaluated_at=evaluated_at,
        max_separation_metres=settings.DRIVER_TRUCK_MAX_SEPARATION_METRES,
        max_age_seconds=settings.DRIVER_TRUCK_MAX_FIX_AGE_SECONDS,
        max_skew_seconds=settings.DRIVER_TRUCK_MAX_SKEW_SECONDS,
        max_phone_accuracy_metres=settings.DRIVER_TRUCK_MAX_PHONE_ACCURACY_METRES,
    )

    return ActionLocationAssessment(
        policy_version=ACTION_LOCATION_POLICY_VERSION,
        evaluated_at=evaluated_at,
        driver_lat=driver_lat,
        driver_lng=driver_lng,
        driver_captured_at=driver_captured_at,
        driver_accuracy_metres=driver_accuracy_metres,
        tracker_lat=tracker_lat,
        tracker_lng=tracker_lng,
        tracker_captured_at=tracker_captured_at,
        separation_metres=separation_metres,
        proximity=proximity,
        reasons=reasons,
        max_separation_metres=settings.DRIVER_TRUCK_MAX_SEPARATION_METRES,
        max_age_seconds=settings.DRIVER_TRUCK_MAX_FIX_AGE_SECONDS,
        max_skew_seconds=settings.DRIVER_TRUCK_MAX_SKEW_SECONDS,
        max_phone_accuracy_metres=settings.DRIVER_TRUCK_MAX_PHONE_ACCURACY_METRES,
        expected_trip_stop_id=None,
        precinct_id=None,
        precinct_lat=None,
        precinct_lng=None,
        precinct_radius_metres=None,
        precinct_tolerance_metres=None,
        driver_in_precinct=None,
        truck_in_precinct=None,
    )


async def _find_existing_separation(
    db: AsyncSession, *, phase_event_id: Optional[uuid.UUID], checkpoint_id: Optional[uuid.UUID],
) -> Optional[uuid.UUID]:
    stmt = select(TripException.id).where(TripException.exception_type == ExceptionType.DRIVER_VEHICLE_SEPARATION)
    stmt = (
        stmt.where(TripException.phase_event_id == phase_event_id)
        if phase_event_id is not None
        else stmt.where(TripException.checkpoint_id == checkpoint_id)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def record_separation_finding(
    db: AsyncSession,
    *,
    trip: Trip,
    phase_event_id: Optional[uuid.UUID],
    checkpoint_id: Optional[uuid.UUID],
    assessment: ActionLocationAssessment,
    driver_reason: Optional[str] = None,
) -> None:
    """Raise ExceptionType.DRIVER_VEHICLE_SEPARATION when `assessment` says the
    driver's own phone and the vehicle tracker disagreed beyond policy.

    `driver_reason` (Task: driver-location-timeline-gap) is the driver's own typed
    explanation for this handshake (PhaseEvent.location_warning_reason on a phase;
    always None from a checkpoint, which has no such field) — appended to the
    description, clearly attributed, so a dispatcher reading the finding sees it
    alongside the measured fact rather than having to cross-reference the phase row.

    Exactly one of `phase_event_id`/`checkpoint_id` is the source event this finding
    is scoped to — enforced with ValueError, a caller contract violation rather than
    a runtime condition to fail open around. A no-op (returns without writing
    anything) unless `assessment.proximity == "separated"`; 'unverified' is not
    evidence of separation and must never raise a finding just because a quality
    gate — not the distance itself — could not be checked.

    SYSTEM source, WARNING severity (mirrors GPS_MISMATCH's own reasoning in
    phase_service._raise_position_disagreement_if_unrecorded: real false-positive
    modes exist — a phone left in the cab, a co-driver holding it, stale accuracy —
    so this is not the alarm tier), and `review_status` is set EXPLICITLY to
    NEEDS_REVIEW rather than routed through exception_service.initial_review_status
    (which would return RECORDED for a WARNING) — a controller decision (P5) that a
    measured driver/vehicle separation should reach a dispatcher's queue even though
    its severity alone would not otherwise earn that.

    Idempotent two ways at once, exactly like exception_service.raise_exception's
    client_report_id handling: an existence check up front closes the common case (a
    replayed offline completion re-running this same handshake), and a SAVEPOINT
    around the insert catches the race where two attempts land in the same instant —
    the partial unique index (migration ciaran_action_location) lets exactly one
    insert through, and this recovers the loser instead of raising to the caller.

    Only the named partial-unique race is recovered. Any other database failure
    propagates: returning as if a finding were persisted would conceal an evidence
    integrity failure from the caller and leave the timeline's record ambiguous.
    """
    if (phase_event_id is None) == (checkpoint_id is None):
        raise ValueError(
            "record_separation_finding requires exactly one of phase_event_id or checkpoint_id"
        )
    if assessment.proximity != "separated":
        return

    context = (
        f"phase_event_id={phase_event_id}" if phase_event_id is not None else f"checkpoint_id={checkpoint_id}"
    )
    index_name = _PHASE_SEPARATION_INDEX if phase_event_id is not None else _CHECKPOINT_SEPARATION_INDEX

    try:
        existing = await _find_existing_separation(
            db, phase_event_id=phase_event_id, checkpoint_id=checkpoint_id,
        )
        if existing is not None:
            logger.info(
                "DRIVER_VEHICLE_SEPARATION already recorded for %s — no duplicate written", context,
            )
            return

        # separation_metres is never None here: evaluate_proximity only returns the
        # 'separated' verdict once a real distance was measured (see its own
        # docstring) — reached this line only because assessment.proximity ==
        # 'separated' above.
        description = (
            f"Driver phone and vehicle tracker were recorded {_format_metres(assessment.separation_metres)} "
            f"apart at this handshake; limit {_format_metres(assessment.max_separation_metres)}."
            f"{_describe_driver_reason(driver_reason)}"
        )

        finding = TripException(
            trip_id=trip.id,
            phase_event_id=phase_event_id,
            checkpoint_id=checkpoint_id,
            # Scoped like the GPS_MISMATCH finding (phase_service): the stop this
            # assessment's phase was anchored to, or None for a checkpoint/trip_
            # creation, which have none.
            trip_stop_id=assessment.expected_trip_stop_id,
            exception_type=ExceptionType.DRIVER_VEHICLE_SEPARATION,
            source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.WARNING,
            review_status=ExceptionReviewStatus.NEEDS_REVIEW,
            description=description,
        )

        try:
            async with db.begin_nested():
                db.add(finding)
                await db.flush()
        except IntegrityError as integrity_exc:
            if not is_unique_violation(integrity_exc) or violated_constraint(integrity_exc) != index_name:
                # Not the race this savepoint exists to tolerate — a real integrity
                # fault must be visible, not folded into "someone else already wrote
                # it".
                raise
            logger.info(
                "DRIVER_VEHICLE_SEPARATION insert race for %s — another request already wrote it", context,
            )
            return

        logger.info(
            "Recorded DRIVER_VEHICLE_SEPARATION for %s: separation=%.1fm limit=%.1fm",
            context, assessment.separation_metres, assessment.max_separation_metres,
        )

        # FP-147's invariant, same as every other system-detected exception in this
        # codebase: a finding that tells no one leaves the dispatcher's screen out of
        # step with the record. Inside the try: a failure here must not undo a
        # handshake the driver already physically completed.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.WARNING),
            ),
        )

    except Exception:
        # Only the named partial-index race is an expected recovery path (handled by
        # the savepoint above). Any other DB or queue failure must remain observable to
        # the caller; logging it and returning would falsely report persisted evidence.
        raise


async def _find_existing_driver_location_mismatch(
    db: AsyncSession, *, phase_event_id: uuid.UUID,
) -> Optional[uuid.UUID]:
    result = await db.execute(
        select(TripException.id).where(
            TripException.exception_type == ExceptionType.DRIVER_LOCATION_MISMATCH,
            TripException.phase_event_id == phase_event_id,
        )
    )
    return result.scalar_one_or_none()


async def record_driver_location_finding(
    db: AsyncSession,
    *,
    trip: Trip,
    phase_event_id: uuid.UUID,
    assessment: ActionLocationAssessment,
    driver_reason: Optional[str] = None,
) -> None:
    """Raise ExceptionType.DRIVER_LOCATION_MISMATCH when `assessment` says the
    driver's own phone was measurably OUTSIDE the stop's precinct.

    This is the third question build_phase_assessment answers
    (`driver_in_precinct`), independent of both DRIVER_VEHICLE_SEPARATION (phone vs
    tracker distance) and GPS_MISMATCH (tracker vs precinct) — see this module's own
    docstring for why none of the other two can catch what this one does. A single
    handshake can trip any combination of the three, or none.

    Phase-scoped only, deliberately with no checkpoint_id parameter to mirror:
    driver_in_precinct is only ever set to True/False for a phase handshake anchored
    to a stop (build_phase_assessment; never IN_TRANSIT, never a bare checkpoint
    capture — build_checkpoint_assessment/build_capture_assessment always leave it
    None). Still safe, and intentionally called, from checkpoint_service.log_
    checkpoint when a checkpoint carries a real phase_event_id: that call simply
    no-ops there today via the guard below, and stays ready for the day a checkpoint
    resolves to a stop-anchored, non-IN_TRANSIT phase.

    A no-op unless `assessment.driver_in_precinct is False`. `None` (not
    assessable — no resolvable precinct, no driver phone fix, or a phase with no
    fence to check at all) must never raise: the absence of a check is not evidence
    of a violation. `True` is a clean pass and is likewise silent.

    `driver_reason` mirrors record_separation_finding's own parameter exactly — see
    its docstring.

    Same controller decision as record_separation_finding (SYSTEM source, WARNING
    severity, review_status forced to NEEDS_REVIEW rather than left to exception_
    service.initial_review_status), and the identical two-layer idempotency:
    an existence check up front for the common replay, and a SAVEPOINT insert
    around the partial unique index uq_exceptions_phase_driver_location (migration
    tim_driver_location_mismatch) to recover the loser of a genuine race. Only that
    named index violation is recovered; any other database failure propagates.
    """
    if assessment.driver_in_precinct is not False:
        return

    context = f"phase_event_id={phase_event_id}"

    try:
        existing = await _find_existing_driver_location_mismatch(db, phase_event_id=phase_event_id)
        if existing is not None:
            logger.info(
                "DRIVER_LOCATION_MISMATCH already recorded for %s — no duplicate written", context,
            )
            return

        # radius/tolerance are never None here: driver_in_precinct is only ever set
        # to True/False (never left None) once build_phase_assessment resolved a
        # precinct with usable coordinates and called evaluate_geofence — the same
        # branch that populates these two fields.
        radius_metres = assessment.precinct_radius_metres or 0.0
        tolerance_metres = assessment.precinct_tolerance_metres or 0.0
        description = (
            "Driver's phone was recorded outside the expected precinct for this stop "
            f"(geofence radius {_format_metres(radius_metres)}, tolerance {_format_metres(tolerance_metres)})."
            f"{_describe_driver_reason(driver_reason)}"
        )

        finding = TripException(
            trip_id=trip.id,
            phase_event_id=phase_event_id,
            checkpoint_id=None,
            trip_stop_id=assessment.expected_trip_stop_id,
            exception_type=ExceptionType.DRIVER_LOCATION_MISMATCH,
            source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.WARNING,
            review_status=ExceptionReviewStatus.NEEDS_REVIEW,
            description=description,
        )

        try:
            async with db.begin_nested():
                db.add(finding)
                await db.flush()
        except IntegrityError as integrity_exc:
            if (
                not is_unique_violation(integrity_exc)
                or violated_constraint(integrity_exc) != _PHASE_DRIVER_LOCATION_INDEX
            ):
                # Not the race this savepoint exists to tolerate — a real integrity
                # fault must be visible, not folded into "someone else already wrote
                # it".
                raise
            logger.info(
                "DRIVER_LOCATION_MISMATCH insert race for %s — another request already wrote it", context,
            )
            return

        logger.info("Recorded DRIVER_LOCATION_MISMATCH for %s", context)

        # Same FP-147 invariant as record_separation_finding: inside the try, so a
        # queue failure here must not undo a handshake the driver already physically
        # completed.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.WARNING),
            ),
        )

    except Exception:
        # Only the named partial-index race is an expected recovery path (handled by
        # the savepoint above). Any other DB or queue failure must remain observable to
        # the caller; logging it and returning would falsely report persisted evidence.
        raise


__all__ = [
    "build_capture_assessment",
    "build_checkpoint_assessment",
    "build_phase_assessment",
    "PhaseLocationPreviewConflictError",
    "preview_phase_location",
    "record_separation_finding",
]
