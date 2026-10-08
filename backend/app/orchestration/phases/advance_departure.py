"""The departure phase: the seal applied and photographed, anchored to Hedera."""

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    BlockchainReceiptType, ExceptionSeverity, ExceptionSource, ExceptionType, PhaseStatus,
)
from app.db.models.transit import TripException
from app.orchestration import corroboration_service
from app.orchestration.phases.anchor_dispatch import _dispatch_anchor
from app.orchestration.phases.artifacts import _assert_artifacts_belong_to_trip
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.payloads import compute_departure_canonical_payload_v2
from app.orchestration.phases.seals import _normalized_seal
from app.orchestration.review_policy import initial_review_status
from app.schemas.phases import DepartureCompleteRequest
from app.schemas.trips import TripDetailResponse


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

    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    # Before any evidence is written: every photo cited must be this trip's own. The
    # waybill id is normally None now (its step was removed 2026-08-10 — see
    # DepartureCompleteRequest); the helper skips None entries, so a replayed offline
    # entry that still carries one is checked exactly as before.
    artifact_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id,
        artifact_ids=(payload.waybill_photo_artifact_id, payload.seal_photo_artifact_id),
    )

    # The seal is applied HERE now, not at loading.
    event.waybill_photo_artifact_id = payload.waybill_photo_artifact_id
    event.seal_number = payload.seal_number
    event.seal_photo_artifact_id = payload.seal_photo_artifact_id

    # Intra-request seal continuity — compared against THIS SAME
    # request's seal_number, not a fetched prior row: the driver applies and
    # photographs the seal, the exit guard independently re-enters what they
    # physically see, in one submission.
    #
    # Three states, not two. `guard_verified_seal` is now Optional[bool] (see
    # DepartureCompleteRequest) because the driver app no longer collects a guard's
    # re-entry at all — guards have no accounts. The absence of an independent
    # confirmation is the NORMAL case and must not be recorded as an anomaly: a
    # falsy-check here would stamp a CRITICAL seal_mismatch exception on every
    # single trip the current app submits, drowning the real mismatches this
    # platform exists to surface. Only an explicit False (a guard who was asked and
    # could not verify) or a real re-entered seal that fails to match is evidence of
    # anything.
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

    if seal_mismatch_description is not None:
        # Recorded as evidence, but the trip still departs — a departure
        # mismatch doesn't hold the trip, it's anchored regardless below.
        # Unloading's seal mismatch (destination) matches this precedent too —
        # neither ever holds the trip, only flags it (critical exception).
        event.status = PhaseStatus.EXCEPTION
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.SEAL_MISMATCH, source=ExceptionSource.DRIVER,
            severity=ExceptionSeverity.CRITICAL,
            review_status=initial_review_status(ExceptionSeverity.CRITICAL),
            description=seal_mismatch_description,
        ))
        # Emitted for consistency with the other system sites, but deliberately
        # untested: BOTH entry paths above are dead from any current client. The driver
        # app sends neither seal_number_confirmed nor guard_verified_seal
        # (driver-pwa/lib/api/phases.ts:50) — the guard re-entry step was removed
        # 2026-08-05. The fields survive only so a departure queued offline by an older
        # build can replay instead of 422-ing forever, which is also why this stays.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.CRITICAL),
            ),
        )
    else:
        event.status = PhaseStatus.COMPLETED

    # The anchor moves whole to departure. Runs unconditionally regardless
    # of the mismatch outcome above — a mismatch is evidence in its own right,
    # not a reason to withhold the anchor (matching confirmation's precedent).
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
    # Queued, not awaited: this used to hold the driver's swipe open for the whole
    # Hedera submit. anchor_status stays PENDING until the worker lands the receipt —
    # which is precisely what the driver app's "anchoring in progress" state reports.
    _dispatch_anchor(
        db, event=event, canonical_payload=canonical_payload,
        receipt_type=BlockchainReceiptType.PICKUP,
    )

    trip.actual_departure_at = datetime.now(UTC)
    # IN_TRANSIT stays PENDING while the driver is moving. It is closed by the driver's own
    # arrival submission (advance_in_transit), which is what gives the dispatcher a drive
    # time measured from departure to actual arrival rather than to whenever the unloading
    # paperwork happened to land.

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
