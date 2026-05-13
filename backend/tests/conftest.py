"""Shared fixtures for unit and integration tests.

Two fixture families live here:

  JWT helpers (make_token, auth_header, client): for endpoint tests that need a
  real HTTP client with signed tokens. The client fixture monkeypatches
  SUPABASE_JWT_SECRET so token verification uses test-minted tokens instead of
  production credentials.

  DB session fixtures (test_engine, db_session): for integration tests that need
  direct DB access. Each test runs inside a rolled-back transaction so the DB is
  clean between tests. Requires TEST_DATABASE_URL in backend/.env.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, Optional

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.db.models import Base
from app.main import app

# ── JWT test helpers ───────────────────────────────────────────────────────────

TEST_JWT_SECRET = "test-supabase-jwt-secret-at-least-32-chars-long"
_ALGORITHM = "HS256"
_AUDIENCE = "authenticated"


def make_token(
    *,
    sub: Optional[str] = None,
    role: str = "dispatcher",
    org_id: Optional[str] = None,
    expires_in: int = 3600,
) -> str:
    """Return a signed JWT that matches the Supabase Auth payload shape.

    role and org_id go into app_metadata so they mirror production tokens.
    Pass expires_in=-1 to create an already-expired token.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "aud": _AUDIENCE,
        "iss": "https://test.supabase.co/auth/v1",
        "sub": sub or str(uuid.uuid4()),
        "email": "dispatcher@test.co.za",
        "role": "authenticated",
        "app_metadata": {
            "role": role,
            "org_id": org_id or str(uuid.uuid4()),
        },
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    return jwt.encode(payload, TEST_JWT_SECRET, algorithm=_ALGORITHM)


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── In-process HTTP client ─────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def client(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient wired directly to the FastAPI app via ASGITransport.

    Overrides SUPABASE_JWT_SECRET with the test secret so token verification
    in get_current_dispatcher() uses our test-minted tokens.
    """
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", TEST_JWT_SECRET)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac


# ── DB session fixtures ────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def test_engine():
    """Create tables once per session (sync wrapper) and yield the async engine.

    NullPool means no connections are held by the engine itself, so there is no
    event-loop binding on the engine object. Each test's db_session fixture
    opens a fresh connection in its own (function-scoped) event loop.
    """
    if not settings.TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL not set — skipping integration tests")

    engine = create_async_engine(settings.TEST_DATABASE_URL, poolclass=NullPool)

    async def _create() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def _drop() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    asyncio.run(_create())
    yield engine
    asyncio.run(_drop())


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Yield a rolled-back AsyncSession for each test — leaves DB clean."""
    async with test_engine.connect() as conn:
        transaction = await conn.begin()
        session = AsyncSession(
            bind=conn,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()
