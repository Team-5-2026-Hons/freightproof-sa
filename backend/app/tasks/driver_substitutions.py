"""Celery tasks: anchor a completed driver handover or correction to Hedera, and sweep owed anchors.

Same shape and retry policy as tasks/evidence_anchors.py. Only `(kind, id)` crosses the broker;
the frozen payload and hash are read from the row, never from the message (FP-83 C5).
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

from celery import Task
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.orchestration.substitutions.anchors import (
    CustodyAnchorKind, CustodyPublisher, anchor_custody_record, configure_custody_publisher, recover_custody_anchor,
)
from app.tasks import celery
from app.tasks.evidence_anchors import (
    EVIDENCE_ANCHOR_RECOVERY_INTERVAL_SECONDS, RECOVERY_BATCH_SIZE, RECOVERY_DELAY_SECONDS,
)

logger = logging.getLogger(__name__)

CUSTODY_ANCHOR_RECOVERY_INTERVAL_SECONDS = EVIDENCE_ANCHOR_RECOVERY_INTERVAL_SECONDS


async def _anchor(*, kind: CustodyAnchorKind, record_id: uuid.UUID) -> bool:
    """Anchor one record in its own session; committed whatever the outcome, because a Hedera
    failure is recorded as anchor_status=failed and that state must persist. A fresh engine per
    call: Celery workers may fork, so a pre-fork pool is unsafe."""
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with session_factory() as db:
            anchored = await anchor_custody_record(db, kind=kind, record_id=record_id)
            await db.commit()
            return anchored
    finally:
        await engine.dispose()


@celery.task(
    name="tasks.driver_substitutions.anchor_record",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    default_retry_delay=30,
)
def anchor_record_task(self: Task, kind: str, record_id: str) -> bool:
    """Anchor one handover or correction. Retries while the receipt is owed or infrastructure fails."""
    try:
        anchored = asyncio.run(_anchor(kind=CustodyAnchorKind(kind), record_id=uuid.UUID(record_id)))
    except Exception as exc:  # noqa: BLE001 — re-raised via Celery's retry below
        logger.exception("Custody anchor task failed for %s %s — retrying", kind, record_id)
        raise self.retry(exc=exc)
    if not anchored:
        logger.warning("Custody anchor not written for %s %s — retrying", kind, record_id)
        raise self.retry(exc=RuntimeError("Custody receipt is still owed"))
    return True


async def _recover_records() -> int:
    """Drain a bounded batch of anchor debts, committing every attempt separately."""
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    due_before = datetime.now(UTC) - timedelta(seconds=RECOVERY_DELAY_SECONDS)
    recovered = 0
    try:
        for _ in range(RECOVERY_BATCH_SIZE):
            async with session_factory() as db, db.begin():
                result = await recover_custody_anchor(db, due_before=due_before)
            if result is None:
                break
            recovered += int(result)
        return recovered
    finally:
        await engine.dispose()


@celery.task(name="tasks.driver_substitutions.recover_records", acks_late=True, reject_on_worker_lost=True)
def recover_records_task() -> int:
    """Beat retries debts even after publish loss, restart, or exhausted task retries."""
    return asyncio.run(_recover_records())


def register_custody_publisher() -> None:
    """Hand the request path its broker and local fallback. Called by app/main.py; idempotent."""
    configure_custody_publisher(CustodyPublisher(
        publish=lambda kind, record_id: anchor_record_task.delay(kind, record_id),
        anchor_locally=lambda kind, record_id: _anchor(kind=kind, record_id=record_id),
    ))
