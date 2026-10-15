"""What the anchor worker runs for one evidence event: submit its frozen hash to Hedera and
link the receipt. The caller owns the transaction (commit, rollback and retry policy);
dispatch and the Celery task live elsewhere and this module must not import tasks/.
"""

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject, compute_payload_hash
from app.core.exceptions import HederaServiceError, HederaTimeoutError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import AnchorStatus, BlockchainReceiptType, SubjectType
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.orchestration.verification.errors import _EvidenceMissing, _UnsupportedPhasePayloadVersion
from app.orchestration.verification.evidence_payloads import reconstruct_evidence_event

logger = logging.getLogger(__name__)


def _receipt_matches(event: EvidenceAnchorEvent, receipt: BlockchainReceipt | None) -> bool:
    return (
        receipt is not None
        and receipt.subject_type == SubjectType.EVIDENCE_EVENT
        and receipt.subject_id == event.id
        and receipt.receipt_type == event.receipt_type
        and receipt.data_hash == event.event_hash
    )


async def _frozen_state_is_intact(db: AsyncSession, event: EvidenceAnchorEvent) -> bool:
    """The hash we are about to publish is the one frozen at the action, and the live source
    still rebuilds to it. Anything else is edited evidence: it is never anchored and never
    re-baselined, so a receipt can only ever commit what actually happened."""
    if compute_payload_hash(event.payload_json) != event.event_hash:
        logger.error("Evidence event %s: stored payload no longer matches its frozen hash", event.id)
        return False
    try:
        state = await reconstruct_evidence_event(
            db, event_id=event.id, anchored_payload=event.payload_json,
        )
    except (_UnsupportedPhasePayloadVersion, _EvidenceMissing) as error:
        logger.error("Evidence event %s: cannot be rebuilt (%s)", event.id, type(error).__name__)
        return False
    if compute_payload_hash(state.payload) != event.event_hash:
        logger.error("Evidence event %s: source rows changed since the action", event.id)
        return False
    return True


async def anchor_evidence_event(db: AsyncSession, *, event_id: uuid.UUID) -> bool:
    """Anchor one event. Returns whether it ends linked to a valid receipt.

    Hedera trouble records `failed` (a retry-owed debt) and returns False; it never touches
    the source rows. Database/infrastructure errors propagate so the caller rolls back and
    retries. The event row is the application identity: Celery delivery is at-least-once,
    so the row is locked and a linked receipt is never submitted twice by this path. (A
    crash after Hedera accepts but before commit can still duplicate an HCS message —
    exactly-once is not claimed.)
    """
    event = (await db.execute(
        select(EvidenceAnchorEvent).where(EvidenceAnchorEvent.id == event_id).with_for_update()
    )).scalar_one_or_none()
    if event is None:
        logger.error("Anchor requested for unknown evidence_event_id=%s", event_id)
        return False

    event.updated_at = datetime.now(UTC)

    if event.receipt_id is not None:
        receipt = await db.get(BlockchainReceipt, event.receipt_id)
        if _receipt_matches(event, receipt):
            return True
        logger.error("Evidence event %s links a receipt that does not belong to it", event.id)
        return False

    if not await _frozen_state_is_intact(db, event):
        event.anchor_status = AnchorStatus.FAILED
        return False

    try:
        receipt = await anchor_subject(
            db, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=event.id,
            canonical_payload=event.payload_json,
            receipt_type=BlockchainReceiptType(event.receipt_type), trip_id=event.trip_id,
        )
    except (HederaTimeoutError, HederaServiceError) as error:
        logger.error(
            "Anchor failed for evidence_event_id=%s (retry owed): %s", event.id, type(error).__name__,
        )
        event.anchor_status = AnchorStatus.FAILED
        return False
    event.receipt_id = receipt.id
    event.anchor_status = AnchorStatus.ANCHORED
    return True
