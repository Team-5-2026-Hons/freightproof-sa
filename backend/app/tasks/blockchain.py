"""Celery task: anchor a completed phase event to Hedera HCS.

Why this exists: anchoring used to run INSIDE the phase-completion request. A Hedera
submit takes ~4-6s (settings.HEDERA_SUBMIT_TIMEOUT_SECONDS bounds it at 15), and the
driver stood at a gate holding the swipe control for all of it. Nothing about that wait
served the evidence — the phase is already recorded and committed by the time this runs;
the receipt is a separate fact that arrives shortly afterwards, which is exactly what
anchor_status and the driver app's "anchoring in progress" state already modelled.

Layering: tasks -> orchestration -> blockchain -> db. This module owns no anchoring
logic of its own; it re-enters phase_service's anchor_phase_event, so the canonical
payload and the fail-open contract stay defined in exactly one place.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from celery import Task
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.models.enums import BlockchainReceiptType
from app.tasks import celery

logger = logging.getLogger(__name__)

PHASE_ANCHOR_RECOVERY_INTERVAL_SECONDS = 60
_RECOVERY_DELAY_SECONDS = 300
_RECOVERY_BATCH_SIZE = 20


async def _anchor(
    *, phase_event_id: uuid.UUID, canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> bool:
    """Anchor one phase event in its own session. Returns whether a receipt was written.

    Isolated as a private coroutine so unit tests can drive it directly without a
    running Celery worker — same shape as tasks/parcel_perfect.py's _sync_all_active.
    """
    # A fresh engine per invocation, not the module-level one from db/session.py:
    # Celery workers may run in a forked subprocess where a pre-fork connection pool is
    # unsafe. Mirrors parcel_perfect.py's reasoning.
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    # Imported here, not at module scope: phase_service imports from app.tasks.blockchain
    # to dispatch this task, so a top-level import would close the cycle.
    from app.orchestration.phase_service import anchor_phase_event

    try:
        async with session_factory() as db:
            anchored = await anchor_phase_event(
                db, phase_event_id=phase_event_id,
                canonical_payload=canonical_payload, receipt_type=receipt_type,
            )
            await db.commit()
            return anchored
    finally:
        await engine.dispose()


@celery.task(
    name="tasks.blockchain.anchor_phase_event",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    default_retry_delay=30,
)
def anchor_phase_event_task(
    self: Task, phase_event_id: str, canonical_payload: dict[str, Any], receipt_type: str,
) -> bool:
    """Anchor a completed phase event. Arguments are JSON-native for the broker.

    anchor_phase_event records a Hedera failure as anchor_status = FAILED (the
    request remains fail-open), then False makes this worker retry the owed receipt.
    Infrastructure failures that prevent the attempt also retry through the same
    bounded Celery policy.
    """
    try:
        anchored = asyncio.run(_anchor(
            phase_event_id=uuid.UUID(phase_event_id),
            canonical_payload=canonical_payload,
            receipt_type=BlockchainReceiptType(receipt_type),
        ))
    except Exception as exc:  # noqa: BLE001 — re-raised via Celery's retry below
        logger.exception("Anchor task failed for phase_event_id=%s — retrying", phase_event_id)
        raise self.retry(exc=exc)
    if not anchored:
        error = RuntimeError("Phase receipt is still owed")
        logger.warning("Anchor not written for phase_event_id=%s — retrying", phase_event_id)
        raise self.retry(exc=error)
    return True


async def _recover_anchors() -> int:
    """Drain a bounded batch of ledger debts, committing every attempt separately."""
    from app.orchestration.phase_service import recover_phase_anchor

    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    due_before = datetime.now(UTC) - timedelta(seconds=_RECOVERY_DELAY_SECONDS)
    recovered = 0
    try:
        for _ in range(_RECOVERY_BATCH_SIZE):
            async with session_factory() as db, db.begin():
                result = await recover_phase_anchor(db, due_before=due_before)
            if result is None:
                break
            recovered += int(result)
        return recovered
    finally:
        await engine.dispose()


@celery.task(name="tasks.blockchain.recover_phase_anchors", acks_late=True, reject_on_worker_lost=True)
def recover_phase_anchors_task() -> int:
    """Beat retries debts even after publish loss, restart, or exhausted task retries."""
    return asyncio.run(_recover_anchors())
