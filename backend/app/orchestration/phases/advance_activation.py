"""The activation phase: the driver takes custody of the trip."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseStatus, TripStatus
from app.orchestration.evidence import corroboration
from app.orchestration.phases.anchor_dispatch import _anchor_phase
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.payloads import compute_activation_canonical_payload_v2
from app.orchestration.phases.scheduling import _claim_crew_for_activation, _reject_if_not_due
from app.schemas.phases import ActivationCompleteRequest
from app.schemas.trips import TripDetailResponse


async def advance_activation(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: ActivationCompleteRequest,
) -> TripDetailResponse:
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Activation",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    await _reject_if_not_due(db, trip)

    await _claim_crew_for_activation(db, trip)

    await _record_driver_position(event, payload)
    horse_fix = await corroboration.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )
    event.status = PhaseStatus.COMPLETED

    trip.status = TripStatus.ACTIVE

    _anchor_phase(db, event=event, canonical_payload=compute_activation_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
