"""Celery task: refresh the FP-153 analytics materialized views.

Runs on the beat schedule (ANALYTICS_REFRESH_INTERVAL_SECONDS). The views count closed
trips only, so they need to track new closures, not live movement.

Layering: tasks → analytics → db.
"""

import asyncio
import logging

from celery import Task
from sqlalchemy.ext.asyncio import create_async_engine

from app.analytics.refresh import refresh_analytics_views
from app.core.config import settings
from app.tasks import celery

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
# Well inside the refresh interval, so a retry lands before the next scheduled run.
_RETRY_DELAY_SECONDS = 60


async def _refresh_all() -> list[str]:
    """Refresh every view on a short-lived AUTOCOMMIT connection.

    AUTOCOMMIT because REFRESH ... CONCURRENTLY cannot run inside a transaction block.
    A fresh engine per run, as in tasks/parcel_perfect.py: a connection pool created
    before the Celery worker forks is unsafe to share with the forked child.
    """
    engine = create_async_engine(
        settings.DATABASE_URL, pool_pre_ping=True, isolation_level="AUTOCOMMIT"
    )
    try:
        async with engine.connect() as conn:
            return await refresh_analytics_views(conn, concurrently=True)
    finally:
        await engine.dispose()


@celery.task(
    name="tasks.analytics.refresh_views",
    bind=True,
    max_retries=_MAX_RETRIES,
    default_retry_delay=_RETRY_DELAY_SECONDS,
)
def refresh_analytics(self: Task) -> list[str]:
    """Celery beat task: rebuild the analytics views; returns the view names refreshed."""
    try:
        # Celery workers are synchronous; asyncio.run() drives the async implementation.
        return asyncio.run(_refresh_all())
    except Exception as exc:
        logger.error(
            "analytics_refresh: failed — scheduling retry (%d/%d): %r",
            self.request.retries,
            self.max_retries,
            exc,
        )
        # Re-raised as Retry so the run is marked RETRY/FAILURE, never SUCCESS.
        raise self.retry(exc=exc)
