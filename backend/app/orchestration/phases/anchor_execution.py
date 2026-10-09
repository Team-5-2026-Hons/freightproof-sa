"""What the Celery anchor task runs: submit a phase event's canonical payload to Hedera and
record the receipt. Must not import tasks/; the dispatch side lives in anchor_dispatch.
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject, compute_payload_hash
from app.core.exceptions import HederaServiceError, HederaTimeoutError
from app.db.models.enums import (
    AnchorStatus, BlockchainReceiptType, PhaseStatus, PhaseType, SubjectType,
)
from app.db.models.phases import PhaseEvent

logger = logging.getLogger(__name__)


# Every driver-completable phase has a receipt type. trip_creation is absent on purpose:
# it is anchored by create_trip as the JOURNEY_LOCK, not through this path.
_PHASE_RECEIPT_TYPES = {
    PhaseType.ACTIVATION: BlockchainReceiptType.ACTIVATION,
    PhaseType.LOADING: BlockchainReceiptType.LOADING,
    PhaseType.DEPARTURE: BlockchainReceiptType.PICKUP,
    PhaseType.IN_TRANSIT: BlockchainReceiptType.TRANSIT_ARRIVAL,
    PhaseType.ARRIVAL: BlockchainReceiptType.ARRIVAL_INSPECTION,
    PhaseType.UNLOADING: BlockchainReceiptType.UNLOADING,
    PhaseType.CONFIRMATION: BlockchainReceiptType.DELIVERY,
}


def receipt_type_for(event: PhaseEvent) -> BlockchainReceiptType:
    """The receipt type this row's anchor must carry. An overridden row anchors the
    override record, never the phase's own type: the receipt must not claim the driver
    evidenced a phase a dispatcher resolved on their behalf."""
    if event.status == PhaseStatus.OVERRIDDEN:
        return BlockchainReceiptType.PHASE_OVERRIDE
    return _PHASE_RECEIPT_TYPES[PhaseType(event.phase_type)]


async def anchor_phase_event(
    db: AsyncSession, *, phase_event_id: uuid.UUID,
    canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> bool:
    """Load a phase event by id and anchor it. Returns whether a receipt was written.

    The entry point tasks/blockchain.py re-enters this module through, so the anchoring
    contract (canonical payload in, fail-open on Hedera trouble) stays defined here
    rather than being duplicated in a worker.
    """
    result = await db.execute(
        select(PhaseEvent).where(PhaseEvent.id == phase_event_id).with_for_update()
    )
    event = result.scalar_one_or_none()
    if event is None:
        # Nothing to anchor and nothing to retry — the row a receipt was owed against is
        # gone. Loud, because it should be impossible: the dispatch only happens after
        # the transaction that wrote this row has committed.
        logger.error("Anchor requested for unknown phase_event_id=%s", phase_event_id)
        return False

    event.updated_at = datetime.now(UTC)

    # Celery delivery is at-least-once. Serialize duplicate workers on this row and
    # never submit a second HCS message once the first worker linked its receipt.
    if event.blockchain_receipt_id is not None:
        event.anchor_status = AnchorStatus.ANCHORED
        return True

    payload_hash = compute_payload_hash(canonical_payload)
    expected_receipt_type = (
        receipt_type_for(event) if event.phase_type in _PHASE_RECEIPT_TYPES else None
    )
    if event.event_hash != payload_hash or receipt_type != expected_receipt_type:
        logger.error(
            "Rejected invalid anchor task for phase_event_id=%s: payload or receipt type mismatch",
            phase_event_id,
        )
        event.anchor_status = AnchorStatus.FAILED
        return False

    await _anchor_or_fail_open(
        db, event=event, canonical_payload=canonical_payload, receipt_type=receipt_type,
    )
    return event.anchor_status == AnchorStatus.ANCHORED


async def _anchor_or_fail_open(
    db: AsyncSession, *, event: PhaseEvent,
    canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> None:
    """Anchor a phase event to Hedera without ever blocking phase completion.

    subject_id/trip_id are deliberately not separate parameters — both are always
    event.id/event.trip_id at every call site, and taking them independently would
    let a future caller anchor one subject while stamping the receipt onto a
    different, mismatched event. Deriving them from `event` makes that impossible.

    Unlike P0's (create_trip's) anchor, which must stay fail-closed because there
    is no committed trip yet to salvage, a phase event already represents evidence
    that genuinely happened — driver custody didn't pause because Hedera was slow.
    A failed anchor is recorded as a retry-owed debt (`anchor_status = FAILED`)
    rather than raised, so the caller can still flip the phase to COMPLETED.

    Also the first place in this module that ever sets `anchor_status` post-creation
    (the plan generator only ever set it to PENDING) — ANCHORED on success,
    FAILED on failure, matching the AnchorStatus contract that `anchor_status` is
    the one place to check whether a receipt is actually owed.
    """
    try:
        receipt = await anchor_subject(
            db, subject_type=SubjectType.PHASE_EVENT, subject_id=event.id,
            canonical_payload=canonical_payload, receipt_type=receipt_type, trip_id=event.trip_id,
        )
    except (HederaTimeoutError, HederaServiceError) as exc:
        # Preserve the failure reason while the worker retries the durable debt.
        logger.exception(
            "Anchor failed for phase_event_id=%s (fail-open): retry owed — %s", event.id, exc,
        )
        event.anchor_status = AnchorStatus.FAILED
        return
    event.blockchain_receipt_id = receipt.id
    event.anchor_status = AnchorStatus.ANCHORED
