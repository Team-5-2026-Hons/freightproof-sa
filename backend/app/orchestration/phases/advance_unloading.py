"""The unloading phase: the driver's attestation that unloading has finished."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseStatus
from app.orchestration import corroboration_service
from app.orchestration.phases.anchor_dispatch import _anchor_phase
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.payloads import compute_unloading_canonical_payload_v2
from app.schemas.phases import UnloadingCompleteRequest
from app.schemas.trips import TripDetailResponse


async def advance_unloading(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: UnloadingCompleteRequest,
) -> TripDetailResponse:
    """Unloading only. The seal comparison moved to advance_arrival, which must
    complete first: _gate_and_load's lower-sequence rule already guarantees that,
    so nothing here re-checks it."""
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Unloading",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )
    event.status = PhaseStatus.COMPLETED

    _anchor_phase(db, event=event, canonical_payload=compute_unloading_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
