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
from app.orchestration.phases.scheduling import (
    _other_trips_for_driver, _reject_if_an_earlier_trip_is_due, _reject_if_another_trip_underway,
    _reject_if_not_due,
)
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

    # Both gates sit AFTER _gate_and_load's idempotent-replay short-circuit, for the same
    # reason _reject_if_not_due does: a queued offline activation resent later must not
    # start failing on a rule it already satisfied when it was captured.
    others = await _other_trips_for_driver(db, trip)
    _reject_if_another_trip_underway(others)
    await _reject_if_an_earlier_trip_is_due(db, trip, others)

    # Two sources, recorded together: the driver's phone says where the phone is,
    # then Pulsit says where the vehicle is. The second is what makes the first
    # corroborated rather than merely asserted. A feeder check — P1 is unanchored,
    # and a Pulsit outage leaves the columns null ("could not check") rather than
    # failing the handshake. See orchestration/evidence/corroboration.py.
    _record_driver_position(event, payload)
    horse_fix = await corroboration.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )
    event.status = PhaseStatus.COMPLETED

    # First phase off CREATED. LEGACY per-handshake TripStatus values are gone —
    # ACTIVE is the coarse "trip is underway" state until CLOSED.
    trip.status = TripStatus.ACTIVE

    _anchor_phase(db, event=event, canonical_payload=compute_activation_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
