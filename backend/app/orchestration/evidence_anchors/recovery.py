"""Recover evidence anchor debt: events that were never dispatched, or whose attempts failed.

Each attempt gets its own transaction in the task. SKIP LOCKED stops two sweeps waiting on
the same event, and updated_at rotates attempts to the back of the queue so one stuck event
cannot starve newer debts. The attempt always compares against the original event_hash
(execution.anchor_evidence_event); edited evidence is never re-baselined.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import AnchorStatus
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.orchestration.evidence_anchors.execution import anchor_evidence_event

logger = logging.getLogger(__name__)


async def recover_evidence_anchor(db: AsyncSession, *, due_before: datetime) -> bool | None:
    """Attempt one overdue event; None means no eligible unlocked event remains.

    Failed events stay eligible however many times they have failed (a task's own retries
    are bounded; the sweep is the backstop that is not).
    """
    event = (await db.execute(
        select(EvidenceAnchorEvent).where(
            EvidenceAnchorEvent.anchor_status.in_((AnchorStatus.PENDING, AnchorStatus.FAILED)),
            EvidenceAnchorEvent.receipt_id.is_(None),
            EvidenceAnchorEvent.updated_at < due_before,
        ).order_by(EvidenceAnchorEvent.updated_at, EvidenceAnchorEvent.id)
        .limit(1).with_for_update(skip_locked=True)
    )).scalar_one_or_none()
    if event is None:
        return None

    event.updated_at = datetime.now(UTC)
    return await anchor_evidence_event(db, event_id=event.id)
