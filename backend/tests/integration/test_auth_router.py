"""Integration tests for GET /api/v1/auth/me.

These tests mock the database layer so they run without a live Postgres
connection. The DB dependency is overridden to return a controlled User
fixture, keeping the tests fast and hermetic while still exercising the
full FastAPI request path (middleware, dependency injection, response
serialisation).
"""

import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.auth.dependencies import get_current_dispatcher
from app.db.models.people import User
from app.db.session import get_db
from app.main import app
from tests.conftest import TEST_JWT_SECRET, auth_header, make_token

# ── Fixtures ──────────────────────────────────────────────────────────────────

_ORG_ID = uuid.uuid4()
_USER_ID = uuid.uuid4()


def _make_user(*, is_active: bool = True) -> User:
    """Return a User ORM instance that does not touch the database."""
    user = MagicMock(spec=User)
    user.id = _USER_ID
    user.organization_id = _ORG_ID
    user.email = "dispatcher@loadfactor.co.za"
    user.full_name = "Demo Dispatcher"
    user.is_active = is_active
    user.created_at = "2026-05-13T00:00:00+00:00"
    user.updated_at = "2026-05-13T00:00:00+00:00"
    return user


async def _mock_db() -> AsyncGenerator:
    """Stub DB session — prevents any real Postgres connection."""
    session = AsyncMock()
    yield session


@pytest_asyncio.fixture
async def client_with_db(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient, None]:
    """Client with JWT secret patched and DB dependency overridden."""
    monkeypatch.setattr(__import__("app.core.config", fromlist=["settings"]).settings,
                        "SUPABASE_JWT_SECRET", TEST_JWT_SECRET)

    app.dependency_overrides[get_db] = _mock_db
    try:
        from httpx import ASGITransport
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── Happy path ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_me_returns_user_for_valid_dispatcher(
    monkeypatch: pytest.MonkeyPatch,
    client_with_db: AsyncClient,
) -> None:
    active_user = _make_user()
    # Override the full dependency so DB lookup is bypassed.
    app.dependency_overrides[get_current_dispatcher] = lambda: active_user

    try:
        token = make_token(sub=str(_USER_ID), role="dispatcher", org_id=str(_ORG_ID))

        response = await client_with_db.get(
            "/api/v1/auth/me",
            headers=auth_header(token),
        )

        assert response.status_code == 200
        body = response.json()
        assert body["email"] == "dispatcher@loadfactor.co.za"
        assert body["full_name"] == "Demo Dispatcher"
    finally:
        app.dependency_overrides.pop(get_current_dispatcher, None)


# ── Rejection paths ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_me_no_token_returns_403(client_with_db: AsyncClient) -> None:
    # HTTPBearer returns 403 (not 401) when the header is entirely absent.
    response = await client_with_db.get("/api/v1/auth/me")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_me_expired_token_returns_401(client_with_db: AsyncClient) -> None:
    token = make_token(expires_in=-1)

    response = await client_with_db.get(
        "/api/v1/auth/me",
        headers=auth_header(token),
    )

    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_get_me_driver_token_returns_403(client_with_db: AsyncClient) -> None:
    token = make_token(role="driver")

    response = await client_with_db.get(
        "/api/v1/auth/me",
        headers=auth_header(token),
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_me_client_viewer_token_returns_403(client_with_db: AsyncClient) -> None:
    token = make_token(role="client_viewer")

    response = await client_with_db.get(
        "/api/v1/auth/me",
        headers=auth_header(token),
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_me_invalid_token_returns_401(client_with_db: AsyncClient) -> None:
    response = await client_with_db.get(
        "/api/v1/auth/me",
        headers=auth_header("not.a.real.token"),
    )

    assert response.status_code == 401
