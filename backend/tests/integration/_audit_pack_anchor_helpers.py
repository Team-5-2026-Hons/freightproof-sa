"""Seeds shared by the FP-290 audit-pack tests: critical reports with photos, and their anchors."""

import uuid
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    AnchorStatus, ExceptionReviewOutcome, ExceptionReviewStatus, ExceptionSeverity, ExceptionSource,
    ExceptionType, SubjectType,
)
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.db.models.transit import TripException
from app.orchestration.evidence_anchors.artifacts import attach_exception_artifacts
from app.orchestration.evidence_anchors.recording import prepare_exception_anchors, prepare_review_anchor

from tests.integration.audit_pack_seed import T0, AuditTrip, _artifact


async def raise_critical(
    db: AsyncSession, seed: AuditTrip, *, photos: int = 2, consignment_id: uuid.UUID | None = None,
    label: str = "raise",
) -> tuple[TripException, EvidenceAnchorEvent]:
    """A critical driver report with `photos` photos and its frozen (pending) raise event."""
    exception = TripException(
        id=uuid.uuid4(), trip_id=seed.trip.id, exception_type=ExceptionType.SEAL_BROKEN_IN_TRANSIT,
        source=ExceptionSource.DRIVER, severity=ExceptionSeverity.CRITICAL,
        description=f"Seal found cut open ({label}).", consignment_id=consignment_id,
        gps_lat=-28.27, gps_lng=29.13, created_at=T0 + timedelta(hours=6),
        review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )
    db.add(exception)
    artifacts = [_artifact(seed.trip.id, f"{label}-{i}", T0 + timedelta(hours=6)) for i in range(photos)]
    db.add_all(artifacts)
    await db.flush()
    await attach_exception_artifacts(db, exception_id=exception.id, artifact_ids=[a.id for a in artifacts])
    [event] = await prepare_exception_anchors(db, exception=exception)
    return exception, event


async def anchor_event(db: AsyncSession, seed: AuditTrip, event: EvidenceAnchorEvent) -> BlockchainReceipt:
    """Land the event on Hedera: a receipt over exactly the frozen payload, linked to the event."""
    receipt = BlockchainReceipt(
        id=uuid.uuid4(), trip_id=seed.trip.id, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=event.id,
        receipt_type=event.receipt_type, data_hash=event.event_hash, hedera_topic_id="0.0.2002",
        hedera_tx_id=f"0.0.1@{uuid.uuid4().int % 10**6}.0", hedera_sequence_number=900,
        hedera_consensus_timestamp=T0 + timedelta(hours=7), payload_json=event.payload_json,
    )
    db.add(receipt)
    await db.flush()
    event.anchor_status = AnchorStatus.ANCHORED
    event.receipt_id = receipt.id
    await db.flush()
    return receipt


async def review_exception(db: AsyncSession, seed: AuditTrip, exception: TripException) -> EvidenceAnchorEvent:
    exception.review_status = ExceptionReviewStatus.REVIEWED
    exception.review_outcome = ExceptionReviewOutcome.EVIDENCE_VERIFIED
    exception.reviewed_by_user_id = seed.dispatcher.id
    exception.reviewed_at = T0 + timedelta(hours=6, minutes=10)
    exception.review_note = "Called driver."
    await db.flush()
    return await prepare_review_anchor(db, exception=exception)
