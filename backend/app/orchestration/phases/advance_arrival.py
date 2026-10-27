"""The arrival phase: the seal as found at the gate, checked against the departure seal."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.phases import PhaseEvent
from app.db.models.enums import EvidenceRole, ExceptionSeverity, ExceptionType, PhaseStatus, SealCondition
from app.orchestration.evidence import corroboration
from app.orchestration.phases.anchor_dispatch import _anchor_phase
from app.orchestration.phases.artifacts import _assert_artifacts_belong_to_trip
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.findings import _record_seal_finding, _seal_unverified_severity
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.payloads import compute_arrival_canonical_payload_v2
from app.orchestration.phases.seals import _find_departure_for_leg, _normalized_seal
from app.schemas.phases import ArrivalCompleteRequest
from app.schemas.trips import TripDetailResponse


def _record_arrival_seal(event: PhaseEvent, payload: ArrivalCompleteRequest) -> str | None:
    seal_at_arrival = (
        None if payload.seal_number_at_arrival is None
        else _normalized_seal(payload.seal_number_at_arrival)
    )
    event.seal_number = seal_at_arrival
    event.seal_condition = payload.seal_condition.value
    event.seal_photo_artifact_id = payload.seal_photo_artifact_id
    event.seal_number_source = (
        payload.seal_number_source.value
        if payload.seal_number_source is not None and seal_at_arrival is not None
        else None
    )
    event.status = PhaseStatus.COMPLETED

    return seal_at_arrival


async def advance_arrival(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: ArrivalCompleteRequest,
) -> TripDetailResponse:
    """The seal inspection at the destination gate, before anything is opened.

    Holds the seal comparison that used to sit in advance_unloading. Being its own
    phase, completed before unloading can start (_gate_and_load's sequence rule), is
    what makes "inspected before opened" enforced rather than hoped for.

    No _reject_if_not_due and no scan gate: ARRIVAL is absent from
    phases.blocking.GATED_PHASES for the reason advance_in_transit gives. The warehouse
    scans after arrival, so gating on the scan here would deadlock the leg.
    """
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Seal inspection",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    await _record_driver_position(event, payload)
    horse_fix = await corroboration.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    departure_event = await _find_departure_for_leg(
        db, trip_id=trip_id, before_sequence=event.sequence_number,
    )

    artifact_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id, phase_event_id=event.id, cited={EvidenceRole.SEAL_PHOTO: payload.seal_photo_artifact_id},
    )

    seal_at_arrival = _record_arrival_seal(event, payload)

    departure_seal = _normalized_seal(departure_event.seal_number or "")

    if payload.seal_condition != SealCondition.INTACT:
        await _record_seal_finding(
            db, trip=trip, event=event,
            exception_type=ExceptionType.SEAL_COMPROMISED, severity=ExceptionSeverity.CRITICAL,
            description=(
                f"Seal found {payload.seal_condition.value} at arrival "
                f"(seal number read: '{seal_at_arrival or 'none'}')."
            ),
        )

    if not departure_seal:
        seal_unverified_severity = _seal_unverified_severity(departure_event)
        await _record_seal_finding(
            db, trip=trip, event=event,
            exception_type=ExceptionType.SEAL_UNVERIFIED, severity=seal_unverified_severity,
            description=(
                f"Seal continuity could not be verified for this leg: no seal was "
                f"recorded at departure (departure phase is "
                f"'{PhaseStatus(departure_event.status).value}'). Seal at arrival "
                f"was '{seal_at_arrival or 'none'}'."
            ),
        )
    elif seal_at_arrival is not None and seal_at_arrival != departure_seal:
        await _record_seal_finding(
            db, trip=trip, event=event,
            exception_type=ExceptionType.SEAL_MISMATCH, severity=ExceptionSeverity.CRITICAL,
            description=(
                f"Seal at arrival ('{seal_at_arrival}') does not match "
                f"the seal applied at departure ('{departure_seal}')."
            ),
        )

    _anchor_phase(db, event=event, canonical_payload=compute_arrival_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
        seal_number=seal_at_arrival,
        seal_condition=payload.seal_condition.value,
        seal_photo_sha256=artifact_hashes[payload.seal_photo_artifact_id],
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
