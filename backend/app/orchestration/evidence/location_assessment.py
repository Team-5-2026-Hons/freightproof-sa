"""Assembles the ActionLocationAssessment snapshot for a handshake: the driver's own phone against
the vehicle's Pulsit tracker (`evidence.proximity`) and against the stop's precinct fence
(`evidence.precinct_assessment`), combined into one record. Also the advisory preview the driver
sees before completing a phase, which builds the same snapshot and records nothing.

The findings that snapshot can imply (DRIVER_VEHICLE_SEPARATION, DRIVER_LOCATION_MISMATCH) are
recorded by `evidence.action_location`; why they are separate questions, and separate from
GPS_MISMATCH, is explained there.

Layering: orchestration → evidence.proximity, evidence.precinct_assessment,
integrations(Pulsit) → db. Never imported by integrations/ or db/; never imports from api/.
"""

import asyncio
import logging
import uuid
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import (
    PhaseStatus, TripStatus,
)
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint
from app.db.models.trips import Trip
from app.integrations.pulsit import PulsitFix, PulsitFixSource, PulsitFixStatus, get_pulsit_client
from app.orchestration.evidence.precinct_assessment import build_phase_precinct_assessment, tracker_fix
from app.orchestration.evidence.proximity import evaluate_proximity
from app.orchestration.phases.demo_position import staged_demo_position
from app.orchestration.substitutions.access import require_current_driver
from app.schemas.action_location import (
    ACTION_LOCATION_POLICY_VERSION, ActionLocationAssessment, DriverLocationCapture,
)

logger = logging.getLogger(__name__)


_LOCATION_PREVIEW_TRACKER_TIMEOUT_SECONDS = 2.0


# Trip states in which a preview is pointless: nothing can be completed on a trip that
# is over, cancelled, or frozen on a hold, so there is no Pulsit read worth paying for.
_PREVIEW_INELIGIBLE_TRIP_STATUSES = frozenset(
    {TripStatus.CLOSED, TripStatus.CANCELLED, TripStatus.EXCEPTION_HOLD}
)


class PhaseLocationPreviewConflictError(Exception):
    """The addressed phase is no longer eligible for an advisory preview."""


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

    `horse_fix` is the SAME fix evidence.corroboration.record_phase_corroboration
    already obtained moments earlier in this same request — this function
    never calls Pulsit itself, so no action pays for a second tracker round trip.

    Precinct membership (driver_in_precinct/truck_in_precinct and the geometry
    fields) is only ever evaluated for a phase anchored to a stop, and never for
    IN_TRANSIT — exactly `evidence.corroboration._PHASES_WITHOUT_A_GEOFENCE_VERDICT`'s
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
    # lat/lng None-checks are implied by has_position; repeated so mypy can narrow the Decimal | None.
    if horse_fix is not None and horse_fix.has_position and horse_fix.lat is not None and horse_fix.lng is not None:
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

    precinct = await build_phase_precinct_assessment(
        db, event=event,
        driver_fix=tracker_fix(driver_lat, driver_lng),
        truck_fix=tracker_fix(tracker_lat, tracker_lng),
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
        **asdict(precinct),
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
    # A read-only comparison, so no lock or sequence: but only for the driver holding the trip.
    trip = await require_current_driver(db, trip_id=trip_id, driver_id=driver_id)

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

    # A demo-staged phone position (dev panel -> "move the phone") is applied to the
    # PREVIEW too, not just the recorded completion. Otherwise the driver is shown a
    # warning about a mismatch that the submission a second later will not record, and the
    # preview's whole job is to predict what completing the phase would store. The staged
    # pair is stamped SIMULATED where it is written — see phases/driver_position.py.
    staged = await staged_demo_position(trip.id)
    previewed = capture if staged is None else capture.model_copy(
        update={"driver_phone_lat": float(staged[0]), "driver_phone_lng": float(staged[1])},
    )

    return await build_phase_assessment(
        db, trip=trip, event=event, horse_fix=horse_fix,
        driver_accuracy_metres=previewed.driver_accuracy_metres,
        evaluated_at=datetime.now(UTC), capture=previewed,
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
    the fix on some other record (exceptions.creation: the report row itself) never has
    to fabricate a Checkpoint instance just to satisfy a parameter type. Pure: no DB.
    """
    tracker_lat: Optional[float] = None
    tracker_lng: Optional[float] = None
    tracker_captured_at: Optional[datetime] = None
    # lat/lng None-checks are implied by has_position; repeated so mypy can narrow the Decimal | None.
    if horse_fix is not None and horse_fix.has_position and horse_fix.lat is not None and horse_fix.lng is not None:
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


__all__ = [
    "build_capture_assessment",
    "build_checkpoint_assessment",
    "build_phase_assessment",
    "PhaseLocationPreviewConflictError",
    "preview_phase_location",
]
