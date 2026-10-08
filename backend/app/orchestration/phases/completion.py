"""The finish step shared by every phase: stamps idempotency and completion time, rebuilds the
position cache from the ledger, closes the trip when nothing remains, and returns the
updated trip detail.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip
from app.integrations.pulsit import PulsitFix
from app.orchestration import action_location_service
from app.orchestration.phases.findings import (
    _raise_position_disagreement_if_unrecorded, _raise_trailer_decoupling_if_unrecorded,
)
from app.orchestration.phases.state import recompute_position
from app.orchestration.resource_service import get_trip_detail
from app.schemas.trips import TripDetailResponse

logger = logging.getLogger(__name__)


async def _finish_phase(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent, idempotency_key: str,
    horse_fix: PulsitFix | None = None, driver_accuracy_metres: float | None = None,
) -> TripDetailResponse:
    """`horse_fix`/`driver_accuracy_metres`: the SAME Pulsit fix each
    wrapper's own call to corroboration_service.record_phase_corroboration already
    obtained a few lines earlier, and the request's own driver-claimed phone
    accuracy — both threaded through as keyword-only, defaulted, arguments rather
    than positional ones, so every existing call site not yet touched keeps
    compiling unchanged. See action_location_service.build_phase_assessment's
    own docstring for why this function does not re-fetch the fix itself."""
    event.idempotency_key = idempotency_key
    event.completed_at = event.completed_at or datetime.now(UTC)

    if event.phase_type == PhaseType.IN_TRANSIT and event.status == PhaseStatus.COMPLETED:
        # The trip-wide arrival is the final driving leg's evidence timestamp.
        # Intermediate stops and dispatcher overrides do not attest final arrival.
        later_leg = await db.execute(
            select(PhaseEvent.id).where(
                PhaseEvent.trip_id == trip.id,
                PhaseEvent.phase_type == PhaseType.IN_TRANSIT,
                PhaseEvent.sequence_number > event.sequence_number,
            ).limit(1)
        )
        if later_leg.scalar_one_or_none() is None:
            trip.actual_arrival_at = event.completed_at

    # FP-145. Placed on the one path every handshake converges on, and AFTER each
    # wrapper's own call to record_phase_corroboration, so the verdict being read
    # here is the one this handshake just produced. Before the flush below, so the
    # finding is already in the TripDetailResponse this request returns.
    await _raise_position_disagreement_if_unrecorded(db, trip=trip, event=event)
    # A separate question from the horse's: is each TRAILER where its horse is?
    await _raise_trailer_decoupling_if_unrecorded(db, trip=trip, event=event)

    # Independent of the GPS_MISMATCH check above — that asks "does the
    # TRACKER agree with the PRECINCT?"; this asks "does the DRIVER'S OWN PHONE agree
    # with the TRACKER?" — two different pairs of things that can each fail alone, or
    # together, on the same handshake. evaluated_at is stamped fresh HERE, not reused
    # from event.completed_at, because it is the instant the SERVER is judging the
    # separation, not the instant the driver's phone claims to have submitted it (the
    # skew between those two is exactly what the assessment's own reasons can surface).
    #
    # Fail-open, for exactly the reason record_phase_corroboration is: the driver has
    # already physically performed this handshake, and the assessment is a derived
    # comparison of telemetry, not the evidence itself. If assembling or recording it
    # fails for any reason, the column stays NULL — which the schema defines as "not
    # assessed" — the traceback is logged, and the completion still lands. A 500 here
    # would roll back a swipe the offline queue could then only ever replay into the
    # same failure. The separation finding uses its own SAVEPOINT for its insert, so
    # a failure inside it leaves the outer transaction usable for the flush below.
    evaluated_at = datetime.now(UTC)
    try:
        assessment = await action_location_service.build_phase_assessment(
            db, trip=trip, event=event, horse_fix=horse_fix,
            driver_accuracy_metres=driver_accuracy_metres, evaluated_at=evaluated_at,
        )
        event.action_location_assessment = assessment.model_dump(mode="json")
        await action_location_service.record_separation_finding(
            db, trip=trip, phase_event_id=event.id, checkpoint_id=None, assessment=assessment,
            driver_reason=event.location_warning_reason,
        )
        # Closes the gap DRIVER_VEHICLE_SEPARATION alone leaves open (see that
        # function's own docstring and action_location_service's module docstring):
        # a phone measurably outside the precinct with a stale/unavailable tracker
        # fix would otherwise raise nothing at all. Same fail-open block, same
        # driver-typed reason, same event.
        await action_location_service.record_driver_location_finding(
            db, trip=trip, phase_event_id=event.id, assessment=assessment,
            driver_reason=event.location_warning_reason,
        )
    except Exception:
        logger.exception(
            "Action-location assessment failed for phase_event_id=%s — handshake continues, "
            "assessment recorded as not assessed", event.id,
        )

    await recompute_position(db, trip)
    await db.flush()

    # Notify dispatchers watching this trip. The completion may also have CLOSED the trip
    # (advance_confirmation, phase_service.py) — distinguish the two so the UI raises the
    # right signal. Published on commit, never here; a thin ping, no trip data.
    kind = RealtimeKind.TRIP_CLOSED if TripStatus(trip.status) == TripStatus.CLOSED else RealtimeKind.PHASE_COMPLETED
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=kind))

    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)
