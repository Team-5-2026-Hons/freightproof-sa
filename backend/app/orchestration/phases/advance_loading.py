"""The loading phase: origin parcel count and the linehaul sheet, gated on the warehouse scan feed."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.phases import PhaseEvent
from app.db.models.enums import EvidenceRole, ExceptionSeverity, PhaseStatus
from app.integrations.scan_feed import ScanDirection
from app.orchestration.consignments import scans as scan_service
from app.orchestration.evidence import corroboration
from app.orchestration.phases.anchor_dispatch import _anchor_phase
from app.orchestration.phases.artifacts import _assert_artifacts_belong_to_trip
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.findings import _raise_scan_shortfall_if_unrecorded
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.payloads import compute_loading_canonical_payload_v3
from app.schemas.phases import LoadingCompleteRequest
from app.schemas.trips import TripDetailResponse


async def _record_linehaul_evidence(
    db: AsyncSession, *, event: PhaseEvent, payload: LoadingCompleteRequest,
) -> tuple[str | None, str | None]:
    linehaul_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=event.trip_id, phase_event_id=event.id,
        cited={
            EvidenceRole.LINEHAUL_PHOTO: payload.linehaul_photo_artifact_id,
            EvidenceRole.LINEHAUL_PDF: payload.linehaul_pdf_artifact_id,
        },
    )
    event.linehaul_photo_artifact_id = payload.linehaul_photo_artifact_id
    event.linehaul_pdf_artifact_id = payload.linehaul_pdf_artifact_id
    linehaul_photo_sha256 = (
        linehaul_hashes[payload.linehaul_photo_artifact_id]
        if payload.linehaul_photo_artifact_id is not None else None
    )
    linehaul_pdf_sha256 = (
        linehaul_hashes[payload.linehaul_pdf_artifact_id]
        if payload.linehaul_pdf_artifact_id is not None else None
    )

    return linehaul_photo_sha256, linehaul_pdf_sha256


async def advance_loading(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: LoadingCompleteRequest,
) -> TripDetailResponse:
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Loading",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    await _record_driver_position(event, payload)
    horse_fix = await corroboration.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    linehaul_photo_sha256, linehaul_pdf_sha256 = await _record_linehaul_evidence(
        db, event=event, payload=payload,
    )

    consignments = (
        await scan_service.load_consignments_at_stop(
            db, trip_id=trip_id, trip_stop_id=event.trip_stop_id,
            direction=ScanDirection.OUT,
        )
        if event.trip_stop_id is not None
        else []
    )

    scanned_out_total = 0
    expected_total = 0
    shortfall_recorded = False
    for consignment in consignments:
        counts = await scan_service.scanned_counts_for_consignment(
            db, consignment_id=consignment.id,
        )
        scanned_out_total += counts.scanned_out
        expected_total += counts.expected

        if counts.scanned_out != counts.expected:
            shortfall_recorded |= await _raise_scan_shortfall_if_unrecorded(
                db, trip_id=trip_id, event=event, consignment=consignment,
                scanned_out=counts.scanned_out, expected=counts.expected,
            )

    if shortfall_recorded:
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.WARNING),
            ),
        )

    event.parcel_count_origin = scanned_out_total if consignments else None

    event.status = (
        PhaseStatus.EXCEPTION
        if consignments and scanned_out_total != expected_total
        else PhaseStatus.COMPLETED
    )

    _anchor_phase(db, event=event, canonical_payload=compute_loading_canonical_payload_v3(
        phase_event_id=event.id, trip_id=trip_id,
        parcel_count_origin=event.parcel_count_origin,
        linehaul_photo_sha256=linehaul_photo_sha256,
        linehaul_pdf_sha256=linehaul_pdf_sha256,
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
