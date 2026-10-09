"""Recovers a phase anchor that was never submitted, by rebuilding its payload from the
committed phase ledger. Imports verification_service lazily.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import AnchorStatus, PhaseStatus
from app.db.models.phases import PhaseEvent
from app.orchestration.phases.anchor_execution import (
    _PHASE_RECEIPT_TYPES, anchor_phase_event, receipt_type_for,
)

logger = logging.getLogger(__name__)


async def recover_phase_anchor(db: AsyncSession, *, due_before: datetime) -> bool | None:
    """Attempt one overdue receipt; None means no eligible unlocked row remains.

    Each attempt gets its own transaction in the task. SKIP LOCKED prevents two
    recovery workers from waiting on the same phase, and updated_at rotates failures
    to the back of the queue instead of starving newer debts.
    """
    from app.orchestration.verification_service import reconstruct_pending_phase_payload

    event = (await db.execute(
        select(PhaseEvent).where(
            PhaseEvent.phase_type.in_(_PHASE_RECEIPT_TYPES),
            PhaseEvent.status.in_((PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION, PhaseStatus.OVERRIDDEN)),
            PhaseEvent.anchor_status.in_((AnchorStatus.PENDING, AnchorStatus.FAILED)),
            PhaseEvent.event_hash.is_not(None),
            PhaseEvent.blockchain_receipt_id.is_(None),
            PhaseEvent.completed_at.is_not(None),
            PhaseEvent.updated_at < due_before,
        ).order_by(PhaseEvent.updated_at, PhaseEvent.id).limit(1).with_for_update(skip_locked=True)
    )).scalar_one_or_none()
    if event is None:
        return None

    event.updated_at = datetime.now(UTC)
    payload = await reconstruct_pending_phase_payload(db, event)
    if payload is None:
        event.anchor_status = AnchorStatus.FAILED
        logger.error("Cannot recover original payload for phase_event_id=%s; receipt still owed", event.id)
        return False
    return await anchor_phase_event(
        db, phase_event_id=event.id, canonical_payload=payload,
        receipt_type=receipt_type_for(event),
    )
