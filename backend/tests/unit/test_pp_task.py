"""Unit tests for the Parcel Perfect polling Celery task.

Targets _sync_all_active() directly — no live Celery worker, DB, or PP API.
The engine, session factory, and fetch_and_sync_consignment are all mocked
so these tests run fully in-process and remain deterministic.

Patching strategy:
  - create_async_engine     → MagicMock (returns a mock engine with a dispose coroutine)
  - async_sessionmaker      → MagicMock factory whose return value is an async context
                              manager yielding the mock DB session
  - fetch_and_sync_consignment → AsyncMock to control success / failure per call

All patches target app.tasks.parcel_perfect.* — the module path as seen by
the system under test, following the same convention as test_consignment_service.py.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.orchestration.consignment_service import ConsignmentSyncResult
from app.tasks.parcel_perfect import _sync_all_active


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_consignment(pp_ref: str = "WAY001") -> MagicMock:
    """Minimal mock of a Consignment ORM object.

    pp_raw_json defaults to None (no prior sync) so the POD-skip guard treats
    it as an unconfirmed consignment. Override in tests that need a specific value.
    """
    c = MagicMock()
    c.id = uuid.uuid4()
    c.parcel_perfect_reference = pp_ref
    c.client_organization_id = uuid.uuid4()
    c.trip_id = uuid.uuid4()
    c.pp_raw_json = None  # no prior sync — POD guard treats as unconfirmed
    return c


def _make_session_mock(consignments: list[MagicMock]) -> MagicMock:
    """Build a mock AsyncSession that returns the given consignments from execute().

    The session is set up as an async context manager so it works with
    ``async with session_factory() as db:``.
    """
    # execute().scalars().all() must return the consignment list.
    scalars_mock = MagicMock()
    scalars_mock.all.return_value = consignments

    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_mock

    db = MagicMock()
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


def _make_session_factory(db: MagicMock) -> MagicMock:
    """Wrap db in an async context manager so ``async with session_factory() as db:`` works.

    __aenter__ returns the session itself; __aexit__ returns False (does not suppress
    exceptions), matching the real AsyncSession context-manager behaviour.
    """
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=db)
    cm.__aexit__ = AsyncMock(return_value=False)

    factory = MagicMock(return_value=cm)
    return factory


def _make_engine_mock() -> MagicMock:
    """Minimal engine mock — only dispose() needs to be awaitable."""
    engine = MagicMock()
    engine.dispose = AsyncMock()
    return engine


# ---------------------------------------------------------------------------
# Test 1
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sync_all_active_calls_fetch_for_each_consignment() -> None:
    """_sync_all_active calls fetch_and_sync_consignment once per active consignment.

    With a single consignment in the query result the function must call
    fetch_and_sync_consignment exactly once with the right args, commit the
    session, and return {"synced": 1, "errors": 0}.
    """
    consignment = _make_consignment("WAY001")
    db = _make_session_mock([consignment])
    session_factory = _make_session_factory(db)
    engine = _make_engine_mock()

    # Return a consignment with no poddate so POD detection does not fire.
    updated = _make_consignment("WAY001")
    updated.pp_raw_json = {"details": {"poddate": ""}}

    with (
        patch("app.tasks.parcel_perfect.create_async_engine", return_value=engine),
        patch("app.tasks.parcel_perfect.async_sessionmaker", return_value=session_factory),
        patch(
            "app.tasks.parcel_perfect.fetch_and_sync_consignment",
            new_callable=AsyncMock,
            return_value=ConsignmentSyncResult(consignment=updated, warning=None),
        ) as mock_fetch,
    ):
        result = await _sync_all_active()

    # fetch_and_sync_consignment must be called exactly once for the one consignment.
    # client_organization_id is no longer caller-supplied — it is derived from
    # the PP waybill's accnum inside fetch_and_sync_consignment.
    mock_fetch.assert_awaited_once_with(
        db=db,
        pp_reference=consignment.parcel_perfect_reference,
        trip_id=consignment.trip_id,
    )

    # The session must be committed after the successful fetch.
    db.commit.assert_awaited_once()

    # Counts must reflect the single success.
    assert result["synced"] == 1
    assert result["errors"] == 0
    assert result["pods_confirmed"] == 0


# ---------------------------------------------------------------------------
# Test 2
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sync_all_active_skips_already_confirmed_pod() -> None:
    """Consignments with a non-empty poddate in pp_raw_json are skipped without a PP call.

    Once PP has confirmed delivery the waybill is immutable from our perspective.
    Skipping saves a PP API call per poll cycle per confirmed consignment.
    pods_confirmed is incremented; synced and errors stay at zero.
    """
    consignment = _make_consignment("WAY001")
    consignment.pp_raw_json = {"details": {"poddate": "2026-06-30"}}

    db = _make_session_mock([consignment])
    session_factory = _make_session_factory(db)
    engine = _make_engine_mock()

    with (
        patch("app.tasks.parcel_perfect.create_async_engine", return_value=engine),
        patch("app.tasks.parcel_perfect.async_sessionmaker", return_value=session_factory),
        patch(
            "app.tasks.parcel_perfect.fetch_and_sync_consignment",
            new_callable=AsyncMock,
        ) as mock_fetch,
    ):
        result = await _sync_all_active()

    # PP must not be called — the consignment is already confirmed.
    mock_fetch.assert_not_awaited()
    db.commit.assert_not_awaited()

    assert result["synced"] == 0
    assert result["errors"] == 0
    assert result["pods_confirmed"] == 1


@pytest.mark.asyncio
async def test_sync_all_active_detects_new_pod_after_sync() -> None:
    """When fetch_and_sync_consignment writes a poddate into pp_raw_json, pods_confirmed is set.

    The consignment starts with no poddate (empty string), triggering a normal sync.
    The returned Consignment mock has a fresh poddate, simulating PP confirming delivery
    in this cycle. The result must reflect synced=1 and pods_confirmed=1.
    """
    consignment = _make_consignment("WAY001")
    consignment.pp_raw_json = {"details": {"poddate": ""}}  # not yet confirmed

    # fetch_and_sync_consignment returns an updated consignment with poddate set.
    updated = _make_consignment("WAY001")
    updated.pp_raw_json = {"details": {"poddate": "2026-07-01"}}

    db = _make_session_mock([consignment])
    session_factory = _make_session_factory(db)
    engine = _make_engine_mock()

    with (
        patch("app.tasks.parcel_perfect.create_async_engine", return_value=engine),
        patch("app.tasks.parcel_perfect.async_sessionmaker", return_value=session_factory),
        patch(
            "app.tasks.parcel_perfect.fetch_and_sync_consignment",
            new_callable=AsyncMock,
            return_value=ConsignmentSyncResult(consignment=updated, warning=None),
        ) as mock_fetch,
    ):
        result = await _sync_all_active()

    mock_fetch.assert_awaited_once()
    db.commit.assert_awaited_once()

    assert result["synced"] == 1
    assert result["errors"] == 0
    assert result["pods_confirmed"] == 1


@pytest.mark.asyncio
async def test_sync_all_active_continues_on_single_failure() -> None:
    """A failure on one consignment rolls back, increments errors, and continues.

    Given two consignments where the first raises ValueError and the second
    succeeds, the function must:
      - roll back once (for the failed consignment),
      - commit once (for the successful one),
      - return {"synced": 1, "errors": 1}.
    """
    first = _make_consignment("WAY001")
    second = _make_consignment("WAY002")

    db = _make_session_mock([first, second])
    session_factory = _make_session_factory(db)
    engine = _make_engine_mock()

    # First call raises; second returns an unconfirmed consignment (no poddate).
    updated = _make_consignment("WAY002")
    updated.pp_raw_json = {"details": {"poddate": ""}}
    mock_fetch = AsyncMock(
        side_effect=[
            ValueError("PP not found"),
            ConsignmentSyncResult(consignment=updated, warning=None),
        ]
    )

    with (
        patch("app.tasks.parcel_perfect.create_async_engine", return_value=engine),
        patch("app.tasks.parcel_perfect.async_sessionmaker", return_value=session_factory),
        patch("app.tasks.parcel_perfect.fetch_and_sync_consignment", mock_fetch),
    ):
        result = await _sync_all_active()

    # fetch must have been attempted for both consignments despite the first failure.
    assert mock_fetch.await_count == 2

    # Only one rollback — for the consignment that raised.
    db.rollback.assert_awaited_once()

    # Only one commit — for the consignment that succeeded.
    db.commit.assert_awaited_once()

    assert result["synced"] == 1
    assert result["errors"] == 1
    assert result["pods_confirmed"] == 0
