"""Integration tests for GET /health (FP-141).

The point of the ticket is the degraded path, so that is what these drive: Postgres and
Redis are each made to fail at the transport level and the endpoint is called over HTTP,
through the real middleware stack, exactly as an orchestrator would call it.

Both dependencies are substituted rather than run. The DB session is swapped through
FastAPI's dependency_overrides and Redis through the module-level accessor, which means
these tests need no TEST_DATABASE_URL and no Redis server — a test suite that could only
prove "degraded" by having no database would be unable to prove "ok" at all.
"""

import asyncio
from collections.abc import AsyncGenerator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.exc import OperationalError

from app import main as main_module
from app.db.session import get_db
from app.main import app

_TEST_TIMEOUT_SECONDS = 0.05
_HANG_SECONDS = 5.0


class _StubSession:
    """Stands in for the AsyncSession that get_db would yield."""

    def __init__(self, *, raises: Exception | None = None, hangs: bool = False) -> None:
        self._raises = raises
        self._hangs = hangs

    async def execute(self, statement: Any) -> Any:
        if self._hangs:
            await asyncio.sleep(_HANG_SECONDS)
        if self._raises is not None:
            raise self._raises
        return object()

    async def rollback(self) -> None:
        return None


class _StubRedis:
    def __init__(self, *, raises: Exception | None = None, hangs: bool = False) -> None:
        self._raises = raises
        self._hangs = hangs

    async def ping(self) -> bool:
        if self._hangs:
            await asyncio.sleep(_HANG_SECONDS)
        if self._raises is not None:
            raise self._raises
        return True


def _db_error() -> OperationalError:
    return OperationalError("SELECT 1", {}, Exception("connection refused"))


def _override_db(session: _StubSession) -> None:
    """Point the endpoint's get_db dependency at `session` for this test."""

    async def _dependency() -> AsyncGenerator[Any, None]:
        yield session

    app.dependency_overrides[get_db] = _dependency


@pytest.fixture(autouse=True)
def isolated_dependencies(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Give every test a healthy Redis and a short probe ceiling, and clean up after.

    Each test then breaks only the dependency it is about, so a failure names the probe
    that regressed. Clearing dependency_overrides matters: it is app-global state, and a
    leaked override would hand a stub session to every later test in the suite.
    """
    monkeypatch.setattr(
        main_module.settings, "HEALTH_PROBE_TIMEOUT_SECONDS", _TEST_TIMEOUT_SECONDS
    )
    monkeypatch.setattr(main_module, "get_redis", lambda: _StubRedis())

    yield

    app.dependency_overrides.pop(get_db, None)


async def _get_health() -> Any:
    async with AsyncClient(
        transport=ASGITransport(app=app),  # type: ignore[arg-type]
        base_url="http://test",
    ) as client:
        return await client.get("/health")


# ── Healthy ───────────────────────────────────────────────────────────────────


async def test_health_reports_ok_when_both_dependencies_answer():
    _override_db(_StubSession())

    response = await _get_health()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["checks"]["database"]["status"] == "ok"
    assert body["checks"]["redis"]["status"] == "ok"
    assert body["checks"]["database"]["error"] is None
    assert body["checks"]["redis"]["error"] is None


# ── Degraded — the FP-141 acceptance criterion ────────────────────────────────


async def test_health_reports_degraded_when_database_is_unreachable():
    _override_db(_StubSession(raises=_db_error()))

    response = await _get_health()

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["checks"]["database"]["status"] == "unavailable"
    # Redis was fine — a degraded verdict still has to say which dependency broke.
    assert body["checks"]["redis"]["status"] == "ok"


async def test_health_reports_degraded_when_redis_is_unreachable(
    monkeypatch: pytest.MonkeyPatch,
):
    _override_db(_StubSession())
    monkeypatch.setattr(
        main_module,
        "get_redis",
        lambda: _StubRedis(raises=RedisConnectionError("connection refused")),
    )

    response = await _get_health()

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["checks"]["redis"]["status"] == "unavailable"
    assert body["checks"]["database"]["status"] == "ok"


async def test_health_reports_degraded_when_both_dependencies_are_unreachable(
    monkeypatch: pytest.MonkeyPatch,
):
    _override_db(_StubSession(raises=_db_error()))
    monkeypatch.setattr(
        main_module,
        "get_redis",
        lambda: _StubRedis(raises=RedisConnectionError("connection refused")),
    )

    response = await _get_health()

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["checks"]["database"]["status"] == "unavailable"
    assert body["checks"]["redis"]["status"] == "unavailable"


async def test_health_does_not_return_500_when_the_database_fails():
    """The failed session must not blow up in get_db's commit on the way out.

    Named separately from the degraded assertion above because it is a different bug: a
    correct verdict that still leaves the request to die in teardown reads to an
    orchestrator as a broken health endpoint rather than a degraded service.
    """
    _override_db(_StubSession(raises=_db_error()))

    response = await _get_health()

    assert response.status_code != 500
    assert response.json()["status"] == "degraded"


# ── Timeouts ──────────────────────────────────────────────────────────────────


async def test_health_reports_degraded_when_a_dependency_hangs():
    """A hanging dependency is the failure mode the explicit timeouts exist for."""
    _override_db(_StubSession(hangs=True))

    started = asyncio.get_running_loop().time()
    response = await _get_health()
    elapsed = asyncio.get_running_loop().time() - started

    assert response.status_code == 503
    assert response.json()["checks"]["database"]["status"] == "unavailable"
    assert elapsed < _HANG_SECONDS


async def test_health_probes_run_concurrently(monkeypatch: pytest.MonkeyPatch):
    """Two hanging dependencies must cost one timeout, not two in series."""
    _override_db(_StubSession(hangs=True))
    monkeypatch.setattr(main_module, "get_redis", lambda: _StubRedis(hangs=True))

    started = asyncio.get_running_loop().time()
    response = await _get_health()
    elapsed = asyncio.get_running_loop().time() - started

    assert response.status_code == 503
    # Well under two ceilings, while still leaving room for a slow CI runner.
    assert elapsed < _TEST_TIMEOUT_SECONDS * 20


# ── Version and environment come from config (FP-179) ─────────────────────────


async def test_health_reports_version_and_environment_from_settings(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(main_module.settings, "VERSION", "9.9.9-test")
    monkeypatch.setattr(main_module.settings, "ENVIRONMENT", "staging")
    _override_db(_StubSession())

    response = await _get_health()

    body = response.json()
    assert body["version"] == "9.9.9-test"
    assert body["environment"] == "staging"


async def test_health_error_detail_never_leaks_the_connection_string():
    """The probe reports the exception's class, never its message.

    /health is unauthenticated, and a driver's connection error carries the DSN — host,
    port, and often the user — in its text.
    """
    _override_db(_StubSession(raises=OperationalError(
        "SELECT 1", {}, Exception("could not connect to db.supabase.co:5432 as postgres"),
    )))

    response = await _get_health()

    body = response.json()
    assert body["checks"]["database"]["error"] == "OperationalError"
    assert "supabase.co" not in response.text
    assert "5432" not in response.text
