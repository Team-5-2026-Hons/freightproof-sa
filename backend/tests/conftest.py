"""Shared fixtures for unit and integration tests.

Two fixture families live here:

  JWT helpers (make_token, auth_header, make_jwks, client): for endpoint tests
  that need a real HTTP client with signed tokens. The client fixture
  monkeypatches _get_jwks so token verification uses a test-generated EC key
  pair instead of fetching Supabase's live JWKS endpoint.

  DB session fixtures (test_engine, db_session): for integration tests that need
  direct DB access. Each test runs inside a rolled-back transaction so the DB is
  clean between tests. Requires TEST_DATABASE_URL in backend/.env.
"""

import asyncio
import base64
import uuid
from datetime import UTC, datetime, timedelta
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1, generate_private_key
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.db.models import Base
from app.main import app

# ── Test EC key pair (generated once per process) ─────────────────────────────
# Used to sign test JWTs with ES256, mirroring how Supabase signs real tokens.

_TEST_EC_KEY = generate_private_key(SECP256R1(), default_backend())
_TEST_PRIVATE_PEM = _TEST_EC_KEY.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)

TEST_KID = "test-kid-fp-0001"
_AUDIENCE = "authenticated"


def _b64url(n: int, byte_length: int = 32) -> str:
    """Encode an integer as a base64url string (used for EC coordinate encoding)."""
    return base64.urlsafe_b64encode(n.to_bytes(byte_length, "big")).rstrip(b"=").decode()


def make_jwks() -> dict:
    """Return a JWKS dict containing the test EC public key.

    Passed to monkeypatch so _get_jwks() returns a controlled key during tests
    instead of making a network request to Supabase.
    """
    pub_numbers = _TEST_EC_KEY.public_key().public_numbers()
    return {
        "keys": [
            {
                "kty": "EC",
                "crv": "P-256",
                "x": _b64url(pub_numbers.x),
                "y": _b64url(pub_numbers.y),
                "kid": TEST_KID,
                "alg": "ES256",
                "use": "sig",
            }
        ]
    }


def make_token(
    *,
    sub: str | None = None,
    role: str = "dispatcher",
    org_id: str | None = None,
    expires_in: int = 3600,
) -> str:
    """Return an ES256-signed JWT matching the Supabase Auth payload shape.

    role and org_id go into app_metadata to mirror production tokens.
    Pass expires_in=-1 to produce an already-expired token.
    """
    now = datetime.now(UTC)
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
    return jwt.encode(
        payload,
        _TEST_PRIVATE_PEM,
        algorithm="ES256",
        headers={"kid": TEST_KID},
    )


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── In-process HTTP client ─────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def client(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient wired directly to the FastAPI app via ASGITransport.

    Patches _get_jwks so token verification uses the test EC key pair instead
    of fetching Supabase's live JWKS endpoint.
    """
    monkeypatch.setattr("app.auth.dependencies._get_jwks", make_jwks)

    async with AsyncClient(
        transport=ASGITransport(app=app),  # type: ignore[arg-type]
        base_url="http://test",
    ) as ac:
        yield ac


# ── DB session fixtures ────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def test_engine():
    """Create tables once per session and yield the async engine.

    NullPool prevents connections being held by the engine itself, avoiding
    event-loop binding issues across function-scoped test sessions.
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
