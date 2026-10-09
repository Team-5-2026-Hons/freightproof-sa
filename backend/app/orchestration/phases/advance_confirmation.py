"""The confirmation phase: proof of delivery, reconciled against the scan-in count and anchored to
Hedera.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    BlockchainReceiptType, ExceptionSeverity, ExceptionSource, ExceptionType, PhaseStatus,
)
from app.db.models.transit import TripException
from app.integrations.scan_feed import ScanDirection
from app.orchestration.consignments import scans as scan_service
from app.orchestration.evidence import corroboration
from app.orchestration.phases.anchor_dispatch import _dispatch_anchor
from app.orchestration.phases.artifacts import _assert_artifacts_belong_to_trip
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.payloads import compute_confirmation_canonical_payload_v2
from app.orchestration.review_policy import initial_review_status
from app.schemas.phases import ConfirmationCompleteRequest
from app.schemas.trips import TripDetailResponse


async def advance_confirmation(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: ConfirmationCompleteRequest,
) -> TripDetailResponse:
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Confirmation",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    artifact_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id,
        artifact_ids=(payload.pod_photo_artifact_id, payload.pod_signature_artifact_id),
    )

    event.pod_photo_artifact_id = payload.pod_photo_artifact_id
    event.pod_signature_artifact_id = payload.pod_signature_artifact_id

    # Per consignment delivered at THIS stop, not per leg. A consignment picked up at
    # stop 1 and delivered at stop 3 has its scan-out at stop 1; the old leg-based
    # lookup this replaced would have resolved stop 2's loading row instead and
    # manufactured a mismatch on a healthy cross-dock trip. Consignment.pickup_stop_id
    # / delivery_stop_id (FP-112) is the partition that makes this correct.
    #
    # trip_stop_id is Optional on PhaseEvent (only TRIP_CREATION is ever NULL, per
    # its own uq_phase_events_trip_stop_type comment) — a CONFIRMATION row always
    # carries one, so the None branch is unreachable in practice. Narrowed
    # explicitly rather than asserted, matching advance_loading's own precedent.
    consignments = (
        await scan_service.load_consignments_at_stop(
            db, trip_id=trip_id, trip_stop_id=event.trip_stop_id,
            direction=ScanDirection.IN,
        )
        if event.trip_stop_id is not None
        else []
    )

    scanned_in_total = 0
    mismatched = False
    for consignment in consignments:
        counts = await scan_service.scanned_counts_for_consignment(
            db, consignment_id=consignment.id,
        )
        scanned_in_total += counts.scanned_in

        if counts.scanned_out == 0 and counts.scanned_in == 0:
            # No baseline at either end — nothing to compare. Covers empty-leg trips
            # and dispatcher-overridden loadings alike, without either needing its own
            # branch keyed on a field that no longer exists.
            continue

        if counts.scanned_out != counts.scanned_in:
            mismatched = True
            db.add(TripException(
                trip_id=trip_id, phase_event_id=event.id,
                consignment_id=consignment.id, trip_stop_id=event.trip_stop_id,
                exception_type=ExceptionType.WAYBILL_COUNT_MISMATCH,
                source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
                review_status=initial_review_status(ExceptionSeverity.WARNING),
                description=(
                    f"Parcel count changed in transit on waybill "
                    f"{consignment.parcel_perfect_reference}: "
                    f"{counts.scanned_out} scanned out at origin, "
                    f"{counts.scanned_in} scanned in at destination."
                ),
            ))

    if mismatched:
        # Once, after the loop — a three-waybill discrepancy is still one trip to
        # refetch, and three identical events would only make the client do it thrice.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.WARNING),
            ),
        )

    event.driver_visual_count = payload.driver_visual_count
    event.parcel_count_destination = scanned_in_total

    canonical_payload = compute_confirmation_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
        # Key name unchanged — see the schema comment. Its provenance is now the
        # warehouse feed rather than Parcel Perfect; its name is a mild misnomer and
        # stays, because verification_service rebuilds every historical anchor from it.
        pp_scan_in_count=scanned_in_total,
        driver_visual_count=payload.driver_visual_count,
        pod_photo_sha256=artifact_hashes[payload.pod_photo_artifact_id],
        pod_signature_sha256=artifact_hashes[payload.pod_signature_artifact_id],
    )
    event.event_hash = compute_payload_hash(canonical_payload)

    # Anchors unconditionally, fail-open — a Hedera outage no longer
    # blocks delivery confirmation from completing; the anchor path records the debt on
    # event.anchor_status instead of raising. Queued rather than awaited (see
    # _dispatch_anchor) so the driver isn't held on the swipe for the Hedera round trip.
    _dispatch_anchor(
        db, event=event, canonical_payload=canonical_payload,
        receipt_type=BlockchainReceiptType.DELIVERY,
    )

    event.status = PhaseStatus.EXCEPTION if mismatched else PhaseStatus.COMPLETED

    # No explicit trip.status = CLOSED / closed_at here anymore — this is
    # confirmation's real point: recompute_position (called inside
    # _finish_phase) finds no unresolved rows left and closes the trip
    # generically, instead of this wrapper hardcoding "I am always last."
    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
