"""Unit tests for the /health dependency probes (app/main.py).

Postgres and Redis are both faked. What is under test is the probe contract — what a
probe returns when its dependency answers, refuses, or hangs, and what it leaves behind
on the session afterwards — none of which needs a real server. The degraded response
itself is covered end-to-end in tests/integration/test_health.py.
"""

import asyncio
from typing import Any, cast

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app import main as main_module
from app.main import _PROBE_OK, _PROBE_UNAVAILABLE, _probe_database, _probe_redis

# Long enough that a healthy fake never trips it, short enough that the timeout tests do
# not stretch the suite.
_TEST_TIMEOUT_SECONDS = 0.05
_HANG_SECONDS = 5.0


class _FakeSession:
    """The two AsyncSession methods the DB probe uses, and nothing else.

    Recording rollbacks is the point: the probe must leave the session committable, since
    get_db() commits after the handler returns.
    """

    def __init__(
        self,
        *,
        raises: Exception | None = None,
        hangs: bool = False,
        rollback_hangs: bool = False,
    ) -> None:
        self._raises = raises
        self._hangs = hangs
        self._rollback_hangs = rollback_hangs
        self.rollbacks = 0

    async def execute(self, statement: Any) -> Any:
        if self._hangs:
            await asyncio.sleep(_HANG_SECONDS)
        if self._raises is not None:
            raise self._raises
        return object()

    async def rollback(self) -> None:
        self.rollbacks += 1
        if self._rollback_hangs:
            await asyncio.sleep(_HANG_SECONDS)


class _FakeRedis:
    def __init__(self, *, raises: Exception | None = None, hangs: bool = False) -> None:
        self._raises = raises
        self._hangs = hangs

    async def ping(self) -> bool:
        if self._hangs:
            await asyncio.sleep(_HANG_SECONDS)
        if self._raises is not None:
            raise self._raises
        return True


def _as_session(fake: _FakeSession) -> AsyncSession:
    """Hand a fake to a probe typed for AsyncSession, without pretending it is one."""
    return cast(AsyncSession, fake)


def _db_error() -> OperationalError:
    """A driver-level connection failure, as SQLAlchemy surfaces it."""
    return OperationalError("SELECT 1", {}, Exception("connection refused"))


@pytest.fixture(autouse=True)
def short_probe_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """Shrink the probe ceiling so the hang cases finish in milliseconds."""
    monkeypatch.setattr(
        main_module.settings, "HEALTH_PROBE_TIMEOUT_SECONDS", _TEST_TIMEOUT_SECONDS
    )


# ── Database probe ────────────────────────────────────────────────────────────


async def test_database_probe_reports_ok_when_query_succeeds():
    session = _FakeSession()

    result = await _probe_database(_as_session(session))

    assert result.status == _PROBE_OK
    assert result.error is None


async def test_database_probe_reports_unavailable_when_connection_fails():
    session = _FakeSession(raises=_db_error())

    result = await _probe_database(_as_session(session))

    assert result.status == _PROBE_UNAVAILABLE
    assert result.error == "OperationalError"


async def test_database_probe_reports_unavailable_when_query_hangs():
    session = _FakeSession(hangs=True)

    result = await _probe_database(_as_session(session))

    assert result.status == _PROBE_UNAVAILABLE
    assert result.error == "TimeoutError"


async def test_database_probe_returns_within_the_configured_timeout():
    session = _FakeSession(hangs=True)

    started = asyncio.get_running_loop().time()
    await _probe_database(_as_session(session))
    elapsed = asyncio.get_running_loop().time() - started

    # Generous multiple of the ceiling: this asserts the probe is bounded at all, not
    # that the event loop is punctual on a loaded CI runner.
    assert elapsed < _TEST_TIMEOUT_SECONDS * 20
    assert elapsed < _HANG_SECONDS


async def test_database_probe_rolls_back_the_failed_session():
    # get_db() commits unconditionally after the handler returns. A session left inside a
    # failed transaction would raise there, turning a correct 503 into a 500.
    session = _FakeSession(raises=_db_error())

    await _probe_database(_as_session(session))

    assert session.rollbacks == 1


async def test_database_probe_does_not_roll_back_a_healthy_session():
    session = _FakeSession()

    await _probe_database(_as_session(session))

    assert session.rollbacks == 0


async def test_database_probe_survives_a_failing_rollback():
    """A session too broken to roll back must still yield a verdict, not an exception."""
    session = _FakeSession(raises=_db_error())

    async def _broken_rollback() -> None:
        raise _db_error()

    session.rollback = _broken_rollback  # type: ignore[method-assign]

    result = await _probe_database(_as_session(session))

    assert result.status == _PROBE_UNAVAILABLE


async def test_database_probe_is_bounded_when_the_rollback_also_hangs():
    """The cleanup must not reintroduce the hang the probe timeout just escaped.

    A database that hangs rather than refusing is the common case, and ROLLBACK travels
    the same dead connection the query timed out on — an unbounded rollback here would
    stall the whole endpoint for as long as the socket stays open.
    """
    session = _FakeSession(hangs=True, rollback_hangs=True)

    started = asyncio.get_running_loop().time()
    result = await _probe_database(_as_session(session))
    elapsed = asyncio.get_running_loop().time() - started

    assert result.status == _PROBE_UNAVAILABLE
    assert session.rollbacks == 1
    assert elapsed < _HANG_SECONDS


# ── Redis probe ───────────────────────────────────────────────────────────────


async def test_redis_probe_reports_ok_when_ping_succeeds(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(main_module, "get_redis", lambda: _FakeRedis())

    result = await _probe_redis()

    assert result.status == _PROBE_OK
    assert result.error is None


async def test_redis_probe_reports_unavailable_when_ping_fails(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        main_module,
        "get_redis",
        lambda: _FakeRedis(raises=RedisConnectionError("connection refused")),
    )

    result = await _probe_redis()

    assert result.status == _PROBE_UNAVAILABLE
    assert result.error == "ConnectionError"


async def test_redis_probe_reports_unavailable_when_ping_hangs(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(main_module, "get_redis", lambda: _FakeRedis(hangs=True))

    result = await _probe_redis()

    assert result.status == _PROBE_UNAVAILABLE
    assert result.error == "TimeoutError"


async def test_redis_probe_reports_unavailable_when_the_client_cannot_be_built(
    monkeypatch: pytest.MonkeyPatch,
):
    """Redis misconfiguration fails before ping() — at from_url, not on the wire."""

    def _explode() -> None:
        raise ValueError("Redis URL must specify one of the following schemes")

    monkeypatch.setattr(main_module, "get_redis", _explode)

    result = await _probe_redis()

    assert result.status == _PROBE_UNAVAILABLE
    assert result.error == "ValueError"
