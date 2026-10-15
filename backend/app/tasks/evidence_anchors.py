"""Celery tasks: anchor an evidence event to Hedera HCS, and sweep owed anchors.

Same shape and retry policy as tasks/blockchain.py (kept separate so the phase path is
untouched). Only event IDs cross the broker: the frozen payload and hash are read from the
event row, never from the message.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

from celery import Task
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.orchestration.evidence_anchors.dispatch import EvidencePublisher, configure_evidence_publisher
from app.orchestration.evidence_anchors.execution import anchor_evidence_event
from app.tasks import celery
from app.tasks.blockchain import (
    PHASE_ANCHOR_RECOVERY_INTERVAL_SECONDS,
    _RECOVERY_BATCH_SIZE,
    _RECOVERY_DELAY_SECONDS,
)

logger = logging.getLogger(__name__)

# The phase sweep's constants, reused so the two sweeps cannot drift apart.
EVIDENCE_ANCHOR_RECOVERY_INTERVAL_SECONDS = PHASE_ANCHOR_RECOVERY_INTERVAL_SECONDS
RECOVERY_DELAY_SECONDS = _RECOVERY_DELAY_SECONDS
RECOVERY_BATCH_SIZE = _RECOVERY_BATCH_SIZE


async def _anchor(*, event_id: uuid.UUID) -> bool:
    """Anchor one event in its own session; returns whether it ends linked to a receipt.

    Committed whatever the outcome: a Hedera failure is recorded as anchor_status=failed and
    that state must persist. An infrastructure error propagates, rolling the attempt back.
    A fresh engine per call: Celery workers may fork, so a pre-fork pool is unsafe.
    """
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with session_factory() as db:
            anchored = await anchor_evidence_event(db, event_id=event_id)
            await db.commit()
            return anchored
    finally:
        await engine.dispose()


@celery.task(
    name="tasks.evidence_anchors.anchor_event",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    default_retry_delay=30,
)
def anchor_event_task(self: Task, event_id: str) -> bool:
    """Anchor one evidence event. Retries while the receipt is owed or infrastructure fails."""
    try:
        anchored = asyncio.run(_anchor(event_id=uuid.UUID(event_id)))
    except Exception as exc:  # noqa: BLE001 — re-raised via Celery's retry below
        logger.exception("Evidence anchor task failed for evidence_event_id=%s — retrying", event_id)
        raise self.retry(exc=exc)
    if not anchored:
        logger.warning("Evidence anchor not written for evidence_event_id=%s — retrying", event_id)
        raise self.retry(exc=RuntimeError("Evidence receipt is still owed"))
    return True


async def _recover_events() -> int:
    """Drain a bounded batch of anchor debts, committing every attempt separately."""
    from app.orchestration.evidence_anchors.recovery import recover_evidence_anchor

    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    due_before = datetime.now(UTC) - timedelta(seconds=RECOVERY_DELAY_SECONDS)
    recovered = 0
    try:
        for _ in range(RECOVERY_BATCH_SIZE):
            async with session_factory() as db, db.begin():
                result = await recover_evidence_anchor(db, due_before=due_before)
            if result is None:
                break
            recovered += int(result)
        return recovered
    finally:
        await engine.dispose()


@celery.task(name="tasks.evidence_anchors.recover_events", acks_late=True, reject_on_worker_lost=True)
def recover_events_task() -> int:
    """Beat retries debts even after publish loss, restart, or exhausted task retries."""
    return asyncio.run(_recover_events())


def register_evidence_publisher() -> None:
    """Hand the request path its broker and local fallback (see orchestration dispatch).
    Called by app/main.py at startup; idempotent."""
    configure_evidence_publisher(EvidencePublisher(
        publish=lambda event_id: anchor_event_task.delay(event_id),
        anchor_locally=lambda event_id: _anchor(event_id=event_id),
    ))
