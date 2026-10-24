"""Integration tests for GET /api/v1/auth/me.

These tests mock the database layer so they run without a live Postgres
connection. The DB dependency is overridden to return a controlled User
fixture, keeping the tests fast and hermetic while still exercising the
full FastAPI request path (middleware, dependency injection, response
serialisation).

_get_jwks is monkeypatched to return a test EC public key, avoiding any
network calls to Supabase's live JWKS endpoint.
"""

import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import get_current_dispatcher
from app.db.models.enums import DispatcherRole, OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.session import get_db
from app.main import app
from app.schemas.people import UserRead
from tests.conftest import auth_header, make_token, make_jwks

# ── Fixtures ──────────────────────────────────────────────────────────────────

_ORG_ID = uuid.uuid4()
_ORG_NAME = "Load Factor Transport"
_USER_ID = uuid.uuid4()


def _make_user(*, is_active: bool = True) -> UserRead:
    """The authenticated dispatcher as get_current_dispatcher returns it, without a database."""
    return UserRead(
        id=_USER_ID,
        organization_id=_ORG_ID,
        email="dispatcher@loadfactor.co.za",
        full_name="Demo Dispatcher",
        is_active=is_active,
        created_at="2026-05-13T00:00:00+00:00",
        updated_at="2026-05-13T00:00:00+00:00",
        role=DispatcherRole.DISPATCHER,
    )


async def _mock_db() -> AsyncGenerator:
    """Stub DB session — prevents any real Postgres connection. The only query /auth/me
    makes is the organisation-name lookup, so that is the one result it needs to answer."""
    session = AsyncMock()
    session.execute.return_value = MagicMock(scalar_one=MagicMock(return_value=_ORG_NAME))
    yield session


@pytest_asyncio.fixture
async def client_with_db(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient, None]:
    """Client with JWKS patched and DB dependency overridden."""
    _settings = __import__("app.core.config", fromlist=["settings"]).settings
    # DEMO_MODE bypasses all JWT checks — disable it so these tests exercise real auth.
    monkeypatch.setattr(_settings, "DEMO_MODE", False)
    # Patch JWKS so token verification uses the test EC key pair, not Supabase's live endpoint.
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
        assert body["organization_name"] == _ORG_NAME
    finally:
        app.dependency_overrides.pop(get_current_dispatcher, None)


@pytest_asyncio.fixture
async def client_with_real_db(
    monkeypatch: pytest.MonkeyPatch, db_session,
) -> AsyncGenerator[AsyncClient, None]:
    """Client whose requests run against the rolled-back test database, so the organisation
    lookup is exercised for real."""
    monkeypatch.setattr(
        __import__("app.core.config", fromlist=["settings"]).settings, "DEMO_MODE", False,
    )
    monkeypatch.setattr("app.auth.dependencies._get_jwks", make_jwks)

    async def _real_db() -> AsyncGenerator:
        yield db_session

    app.dependency_overrides[get_db] = _real_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),  # type: ignore[arg-type]
            base_url="http://test",
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_me_returns_the_dispatchers_own_organisation_name(
    client_with_real_db: AsyncClient, db_session,
) -> None:
    own = Organization(id=uuid.uuid4(), name="Own Transport", org_type=OrganizationType.OPERATOR)
    other = Organization(id=uuid.uuid4(), name="Other Transport", org_type=OrganizationType.OPERATOR)
    db_session.add_all([own, other])
    await db_session.flush()
    user = User(
        id=uuid.uuid4(), organization_id=own.id,
        email=f"dispatcher-{uuid.uuid4().hex[:8]}@test.co.za", full_name="Own Dispatcher",
    )
    db_session.add(user)
    await db_session.flush()
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(own.id))

    response = await client_with_real_db.get("/api/v1/auth/me", headers=auth_header(token))

    assert response.status_code == 200
    body = response.json()
    assert body["organization_name"] == "Own Transport"
    assert body["organization_id"] == str(own.id)


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
