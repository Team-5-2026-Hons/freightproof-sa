"""The departure phase: the seal applied and photographed, anchored to Hedera."""

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    BlockchainReceiptType, EvidenceRole, ExceptionSeverity, ExceptionSource, ExceptionType, PhaseStatus,
)
from app.db.models.transit import TripException
from app.orchestration.evidence_anchors.recording import register_exception
from app.orchestration.evidence import corroboration
from app.orchestration.phases.anchor_dispatch import _dispatch_anchor
from app.orchestration.phases.artifacts import _assert_artifacts_belong_to_trip
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.payloads import compute_departure_canonical_payload_v2
from app.orchestration.phases.seals import _normalized_seal
from app.orchestration.exceptions.review_policy import initial_review_status
from app.schemas.phases import DepartureCompleteRequest
from app.schemas.trips import TripDetailResponse


def _departure_seal_mismatch(payload: DepartureCompleteRequest) -> str | None:
    seal_mismatch_description: str | None = None
    if payload.seal_number_confirmed is not None:
        confirmed = _normalized_seal(payload.seal_number_confirmed)
        if confirmed != _normalized_seal(payload.seal_number):
            seal_mismatch_description = (
                f"Seal at origin gate-out ('{confirmed}') does not match "
                f"the seal applied at departure ('{payload.seal_number}')."
            )
    elif payload.guard_verified_seal is False:
        seal_mismatch_description = "Exit-gate guard could not verify the seal at origin gate-out."

    return seal_mismatch_description


async def advance_departure(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: DepartureCompleteRequest,
) -> TripDetailResponse:
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Departure",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    await _record_driver_position(event, payload)
    horse_fix = await corroboration.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    artifact_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id, phase_event_id=event.id,
        cited={EvidenceRole.WAYBILL_PHOTO: payload.waybill_photo_artifact_id, EvidenceRole.SEAL_PHOTO: payload.seal_photo_artifact_id},
    )

    event.waybill_photo_artifact_id = payload.waybill_photo_artifact_id
    event.seal_number = payload.seal_number
    event.seal_photo_artifact_id = payload.seal_photo_artifact_id
    event.seal_number_source = (
        payload.seal_number_source.value if payload.seal_number_source is not None else None
    )

    seal_mismatch_description = _departure_seal_mismatch(payload)

    if seal_mismatch_description is not None:
        event.status = PhaseStatus.EXCEPTION
        await register_exception(db, TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.SEAL_MISMATCH, source=ExceptionSource.DRIVER,
            severity=ExceptionSeverity.CRITICAL,
            review_status=initial_review_status(ExceptionSeverity.CRITICAL),
            description=seal_mismatch_description,
        ))
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.CRITICAL),
            ),
        )
    else:
        event.status = PhaseStatus.COMPLETED

    canonical_payload = compute_departure_canonical_payload_v2(
        phase_event_id=event.id,
        trip_id=trip_id,
        seal_number=payload.seal_number,
        seal_photo_sha256=artifact_hashes[payload.seal_photo_artifact_id],
        waybill_photo_sha256=(
            artifact_hashes[payload.waybill_photo_artifact_id]
            if payload.waybill_photo_artifact_id is not None
            else None
        ),
    )
    event.event_hash = compute_payload_hash(canonical_payload)
    _dispatch_anchor(
        db, event=event, canonical_payload=canonical_payload,
        receipt_type=BlockchainReceiptType.PICKUP,
    )

    trip.actual_departure_at = datetime.now(UTC)

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
