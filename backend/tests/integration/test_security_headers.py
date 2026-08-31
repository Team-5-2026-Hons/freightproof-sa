"""Integration tests for app.core.security_headers.SecurityHeadersMiddleware."""

from collections.abc import AsyncGenerator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app import main as main_module
from app.db.session import get_db
from app.main import app


@pytest.fixture(autouse=True)
def stub_health_dependencies(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Keep /health off real infrastructure for these tests.

    Since FP-141 the endpoint genuinely probes Postgres and Redis, so calling it here
    would dial both and sit out the probe timeout on a machine that has neither. What
    this module asserts is the response headers, which are identical whatever the probes
    conclude — so the dependencies are stubbed rather than the assertions relaxed. The
    probe behaviour itself is covered in test_health.py.
    """

    class _StubSession:
        async def execute(self, statement: Any) -> Any:
            return object()

        async def rollback(self) -> None:
            return None

    class _StubRedis:
        async def ping(self) -> bool:
            return True

    async def _dependency() -> AsyncGenerator[Any, None]:
        yield _StubSession()

    app.dependency_overrides[get_db] = _dependency
    monkeypatch.setattr(main_module, "get_redis", lambda: _StubRedis())

    yield

    app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_health_response_carries_hardening_headers():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test",
    ) as client:
        response = await client.get("/health")

    assert response.headers["Strict-Transport-Security"] == "max-age=63072000; includeSubDomains"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert response.headers["Content-Security-Policy"] == "default-src 'none'; frame-ancestors 'none'"


@pytest.mark.asyncio
async def test_not_found_response_still_carries_hardening_headers():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test",
    ) as client:
        response = await client.get("/no-such-route")

    assert response.status_code == 404
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
