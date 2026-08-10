"""Integration tests for GET /api/v1/drivers/me.

Mirrors tests/integration/test_auth_router.py's structure: the DB dependency
is overridden with a mocked session so these tests run without a live
Postgres connection, while still exercising the full FastAPI request path.
"""

import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import get_current_driver
from app.db.models.people import Driver
from app.db.session import get_db
from app.main import app
from tests.conftest import auth_header, make_token, make_jwks

_ORG_ID = uuid.uuid4()
_DRIVER_ID = uuid.uuid4()


def _make_driver(*, is_active: bool = True) -> Driver:
    """Return a Driver ORM instance that does not touch the database."""
    driver = MagicMock(spec=Driver)
    driver.id = _DRIVER_ID
    driver.organization_id = _ORG_ID
    driver.full_name = "Sipho Dlamini"
    driver.id_number = "8001015009087"
    driver.phone_number = "+27821234567"
    driver.license_number = "DRV-001"
    driver.license_expiry = None
    driver.idvs_status = "pending"
    driver.idvs_last_verified_at = None
    driver.is_active = is_active
    driver.created_at = "2026-06-23T00:00:00+00:00"
    driver.updated_at = "2026-06-23T00:00:00+00:00"
    return driver


async def _mock_db() -> AsyncGenerator:
    session = AsyncMock()
    yield session


@pytest_asyncio.fixture
async def client_with_db(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient, None]:
    """Client with JWKS patched and DB dependency overridden."""
    _settings = __import__("app.core.config", fromlist=["settings"]).settings
    monkeypatch.setattr(_settings, "DEMO_MODE", False)
    monkeypatch.setattr("app.auth.dependencies._get_jwks", make_jwks)

    app.dependency_overrides[get_db] = _mock_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),  # type: ignore[arg-type]
            base_url="http://test",
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── Happy path ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_my_driver_profile_returns_driver(
    client_with_db: AsyncClient,
) -> None:
    active_driver = _make_driver()
    app.dependency_overrides[get_current_driver] = lambda: active_driver

    try:
        token = make_token(sub=str(_DRIVER_ID), role="driver")

        response = await client_with_db.get(
            "/api/v1/drivers/me",
            headers=auth_header(token),
        )

        assert response.status_code == 200
        body = response.json()
        assert body["full_name"] == "Sipho Dlamini"
        assert body["phone_number"] == "+27821234567"
    finally:
        app.dependency_overrides.pop(get_current_driver, None)


# ── Rejection paths ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_my_driver_profile_no_token_returns_403(client_with_db: AsyncClient) -> None:
    response = await client_with_db.get("/api/v1/drivers/me")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_my_driver_profile_expired_token_returns_401(client_with_db: AsyncClient) -> None:
    token = make_token(role="driver", expires_in=-1)

    response = await client_with_db.get(
        "/api/v1/drivers/me",
        headers=auth_header(token),
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_my_driver_profile_dispatcher_token_returns_403(
    client_with_db: AsyncClient,
) -> None:
    token = make_token(role="dispatcher")

    response = await client_with_db.get(
        "/api/v1/drivers/me",
        headers=auth_header(token),
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_my_driver_profile_invalid_token_returns_401(
    client_with_db: AsyncClient,
) -> None:
    response = await client_with_db.get(
        "/api/v1/drivers/me",
        headers=auth_header("not.a.real.token"),
    )

    assert response.status_code == 401
