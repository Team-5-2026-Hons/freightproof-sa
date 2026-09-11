"""Unit tests for the analytics refresh loop and its Celery beat task.

No DB, no worker: the connection and engine are mocks. That the SQL actually refreshes
real views (CONCURRENTLY included) is covered in tests/integration/test_analytics.py.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from celery.exceptions import Retry
from sqlalchemy.exc import OperationalError

from app.analytics.refresh import AnalyticsRefreshError, refresh_analytics_views
from app.analytics.views import ANALYTICS_VIEW_NAMES
from app.core.config import settings
from app.tasks import celery
from app.tasks.analytics import _refresh_all, refresh_analytics

_TASK_NAME = "tasks.analytics.refresh_views"


def _executed_sql(conn: AsyncMock) -> list[str]:
    return [str(call.args[0]) for call in conn.execute.await_args_list]


def _mock_engine(conn: MagicMock) -> MagicMock:
    engine = MagicMock()
    engine.connect.return_value.__aenter__.return_value = conn
    engine.dispose = AsyncMock()
    return engine


# ── refresh_analytics_views ──────────────────────────────────────────────────


async def test_refresh_analytics_views_refreshes_every_view_concurrently() -> None:
    conn = AsyncMock()

    refreshed = await refresh_analytics_views(conn)

    assert refreshed == list(ANALYTICS_VIEW_NAMES)
    assert _executed_sql(conn) == [
        f"REFRESH MATERIALIZED VIEW CONCURRENTLY {name}" for name in ANALYTICS_VIEW_NAMES
    ]


async def test_refresh_analytics_views_non_concurrent_omits_keyword() -> None:
    conn = AsyncMock()

    await refresh_analytics_views(conn, concurrently=False)

    assert _executed_sql(conn) == [f"REFRESH MATERIALIZED VIEW {name}" for name in ANALYTICS_VIEW_NAMES]


async def test_refresh_analytics_views_failure_still_attempts_remaining_views() -> None:
    failing = ANALYTICS_VIEW_NAMES[1]

    async def execute(statement: Any) -> None:
        if str(statement).endswith(f" {failing}"):
            raise OperationalError("REFRESH", None, Exception("simulated failure"))

    conn = AsyncMock()
    conn.execute.side_effect = execute

    with pytest.raises(AnalyticsRefreshError) as excinfo:
        await refresh_analytics_views(conn)

    assert excinfo.value.failed_views == [failing]
    assert conn.execute.await_count == len(ANALYTICS_VIEW_NAMES)


# ── _refresh_all ─────────────────────────────────────────────────────────────


async def test_refresh_all_uses_autocommit_engine_and_disposes_it() -> None:
    conn = MagicMock()
    engine = _mock_engine(conn)
    refresh = AsyncMock(return_value=list(ANALYTICS_VIEW_NAMES))

    with (
        patch("app.tasks.analytics.create_async_engine", return_value=engine) as create_engine,
        patch("app.tasks.analytics.refresh_analytics_views", new=refresh),
    ):
        result = await _refresh_all()

    assert result == list(ANALYTICS_VIEW_NAMES)
    assert create_engine.call_args.kwargs["isolation_level"] == "AUTOCOMMIT"
    refresh.assert_awaited_once_with(conn, concurrently=True)
    engine.dispose.assert_awaited_once()


async def test_refresh_all_disposes_engine_when_refresh_fails() -> None:
    engine = _mock_engine(MagicMock())
    refresh = AsyncMock(side_effect=AnalyticsRefreshError(["driver_analytics"]))

    with (
        patch("app.tasks.analytics.create_async_engine", return_value=engine),
        patch("app.tasks.analytics.refresh_analytics_views", new=refresh),
        pytest.raises(AnalyticsRefreshError),
    ):
        await _refresh_all()

    engine.dispose.assert_awaited_once()


# ── Celery task ──────────────────────────────────────────────────────────────


def test_refresh_analytics_task_returns_refreshed_views() -> None:
    with patch("app.tasks.analytics._refresh_all", new=AsyncMock(return_value=["driver_analytics"])):
        result = refresh_analytics()

    assert result == ["driver_analytics"]


def test_refresh_analytics_task_retries_on_failure() -> None:
    failure = AnalyticsRefreshError(["driver_analytics"])

    with (
        patch("app.tasks.analytics._refresh_all", new=AsyncMock(side_effect=failure)),
        patch.object(refresh_analytics, "retry", side_effect=Retry()) as retry,
        pytest.raises(Retry),
    ):
        refresh_analytics()

    retry.assert_called_once_with(exc=failure)


def test_beat_schedule_registers_analytics_refresh() -> None:
    entry = celery.conf.beat_schedule["analytics-refresh-views"]

    assert entry["task"] == _TASK_NAME
    assert entry["schedule"] == settings.ANALYTICS_REFRESH_INTERVAL_SECONDS
    assert _TASK_NAME in celery.tasks
