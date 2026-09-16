"""Celery task: terminalise receiver verifications no decision ever arrived for.

The enforcement arm of the spec's invariant — no trip may reach a terminal state with a
verification still in flight. The receiver's own page gives up after
IDVS_DECISION_POLL_SECONDS and records the outcome itself; this catches the cases where
the page never got the chance, because the tab closed or the phone died.

Layering: tasks -> orchestration -> db.
"""

import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.orchestration.receiver_verification_service import sweep_abandoned_verifications
from app.tasks import celery

logger = logging.getLogger(__name__)


async def _sweep() -> int:
    """Run one sweep on a short-lived engine.

    Fresh engine per run (as in tasks/analytics.py) — a pool created before
    the Celery worker forks is unsafe to share with the forked child.
    """
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    try:
        session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with session_factory() as session:
            swept = await sweep_abandoned_verifications(
                session, older_than_seconds=settings.IDVS_ABANDON_AFTER_SECONDS,
            )
            await session.commit()
            return swept
    finally:
        await engine.dispose()


@celery.task(name="tasks.verification.sweep_abandoned")
def sweep_abandoned() -> int:
    """Beat-scheduled entry point.

    Exceptions logged and swallowed, not retried — the next scheduled run
    does the same work, and the rows are still there to find.
    """
    try:
        return asyncio.run(_sweep())
    except Exception:
        logger.exception("Receiver verification sweep failed; the next run will retry")
        return 0
