"""Loads a trip and phase event and checks the sequence gate before a phase may complete.
Includes the DB loading because the gate needs the trip, event and detail before it can
check order.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import PhaseBlockedError, PhaseOverriddenError, PhaseSequenceError
from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip
from app.orchestration.phases.blocking import blocked_on_by_stop
from app.orchestration.phases.loaders import _load_phase_event, _load_trip_for_driver
from app.orchestration.phases.state import _is_resolved, first_unresolved_earlier_phase
from app.orchestration.substitutions.access import get_current_custody
from app.orchestration.trips.detail import get_trip_detail
from app.schemas.trips import TripDetailResponse


async def _gate_and_load(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    phase_label: str,
) -> tuple[Trip, PhaseEvent] | TripDetailResponse:
    """Loads and validates the trip and phase event before completion. Returns
    (trip, event) to continue, or a TripDetailResponse if idempotent replay
    already short-circuited."""
    trip = await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id, lock=True)
    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)

    if event.status == PhaseStatus.OVERRIDDEN:
        raise PhaseOverriddenError()

    if _is_resolved(event.status):
        return await get_trip_detail(
            db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id,
        )

    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED, TripStatus.EXCEPTION_HOLD):
        raise PhaseSequenceError(f"trip status is '{TripStatus(trip.status).value}'", phase_label)

    if await first_unresolved_earlier_phase(
        db, trip_id=trip_id, sequence_number=event.sequence_number,
    ) is not None:
        raise PhaseSequenceError("an earlier phase in the plan is still unresolved", phase_label)

    if event.trip_stop_id is not None:
        gate = await blocked_on_by_stop(db, trip_id=trip_id)
        if gate.get((PhaseType(event.phase_type), event.trip_stop_id)) is not None:
            raise PhaseBlockedError(phase_label)

    event.performed_by_driver_id = driver_id
    event.custody_sequence = (await get_current_custody(db, trip=trip)).sequence

    return trip, event
