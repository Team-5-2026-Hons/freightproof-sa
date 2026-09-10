"""Refresh the analytics materialized views.

Called by the Celery beat task (app/tasks/analytics.py) and by the integration tests.
"""

import logging

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.analytics.views import ANALYTICS_VIEW_NAMES

logger = logging.getLogger(__name__)


class AnalyticsRefreshError(Exception):
    """One or more views failed to refresh; the others were still attempted."""

    def __init__(self, failed_views: list[str]) -> None:
        self.failed_views = failed_views
        super().__init__(f"analytics views failed to refresh: {', '.join(failed_views)}")


async def refresh_analytics_views(conn: AsyncConnection, *, concurrently: bool = True) -> list[str]:
    """Recompute every analytics view from the evidence tables; return the names refreshed.

    CONCURRENTLY keeps each view readable while it rebuilds — a dispatcher opening the
    analytics screen mid-refresh sees the previous numbers rather than blocking. It
    cannot run inside a transaction block, so the caller must pass an AUTOCOMMIT
    connection; the tests pass concurrently=False to refresh inside their rolled-back
    transaction instead.

    The views are independent, so one failing does not stop the rest: each failure is
    logged, and AnalyticsRefreshError is raised at the end naming every view that failed
    so the Celery task is marked failed and retried rather than reporting success.
    """
    keyword = "CONCURRENTLY " if concurrently else ""
    refreshed: list[str] = []
    failed: list[str] = []

    for view_name in ANALYTICS_VIEW_NAMES:
        try:
            # view_name comes from the fixed ANALYTICS_VIEW_NAMES tuple, never from input,
            # and an identifier cannot be passed as a bind parameter.
            await conn.execute(text(f"REFRESH MATERIALIZED VIEW {keyword}{view_name}"))
        except SQLAlchemyError:
            logger.exception("analytics_refresh: failed to refresh %s", view_name)
            failed.append(view_name)
        else:
            refreshed.append(view_name)

    if failed:
        raise AnalyticsRefreshError(failed)

    logger.info("analytics_refresh: refreshed %d view(s)", len(refreshed))
    return refreshed
