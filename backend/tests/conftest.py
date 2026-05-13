"""Shared fixtures for unit and integration tests.

DB_URL falls back to a local test database if TEST_DATABASE_URL is not set.
Integration tests that hit the DB are skipped when no database is reachable.

JWT helpers create signed tokens using a known test secret so tests never
depend on a live Supabase project.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, Optional

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.core.config import settings
from app.db.session import get_db
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
