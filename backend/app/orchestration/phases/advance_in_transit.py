"""The in transit phase: the driver's attestation that the vehicle has arrived."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseStatus
from app.orchestration import corroboration_service
from app.orchestration.phases.anchor_dispatch import _anchor_phase
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.payloads import compute_in_transit_canonical_payload_v2
from app.schemas.phases import InTransitCompleteRequest
from app.schemas.trips import TripDetailResponse


async def advance_in_transit(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: InTransitCompleteRequest,
) -> TripDetailResponse:
    """The driver attesting arrival — the act that closes the driving leg.

    The thinnest wrapper in this module, and that is the design. It writes no evidence of
    its own beyond the phone fix _record_driver_position stores for every phase, and it
    anchors nothing. What it changes is WHO owns the row: before 2026-08-09 in_transit was
    opened by advance_departure and closed as a side effect of advance_unloading, which
    meant its completed_at recorded when the unloading paperwork was submitted, not when
    the truck actually arrived — the dispatcher's elapsed drive time silently swallowed
    the entire unloading phase. It also meant an overridden unloading left the row PENDING
    with no actor able to resolve it, stranding the trip ACTIVE forever.

    No _reject_if_not_due and no scan gate: IN_TRANSIT is absent from
    phase_gate.GATED_PHASES on purpose. The destination warehouse has not scanned anything
    when the driver pulls up at the boom — gating arrival on a scan that only happens
    after arrival would deadlock the leg. UNLOADING carries that gate instead, which is
    the correct place for it.

    The driver app submits this from the in-transit hub's existing "Arrive at destination"
    swipe, NOT from a step page: STEP_SLUGS[in_transit] stays empty so actionablePhase()
    keeps skipping the row and driver-pwa routing is unchanged.
    """
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Arrival",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )
    event.status = PhaseStatus.COMPLETED

    _anchor_phase(db, event=event, canonical_payload=compute_in_transit_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
