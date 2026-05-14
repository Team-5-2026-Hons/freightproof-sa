"""FastAPI dependencies for Supabase Auth verification.

Flow (DEMO_MODE=False):
  1. Extract Bearer token from Authorization header.
  2. Fetch Supabase JWKS once (cached) and verify the JWT using ES256 public key.
  3. Assert app_metadata.role == "dispatcher" — rejects driver and
     client_viewer tokens at the gate.
  4. Look up the User row by id == JWT sub claim.
  5. Assert the account is active.

In DEMO_MODE=True a fixed stub UserRead is returned without touching the DB
or verifying any token — local dev only, blocked in production by the guard
at the bottom of this module.
"""

import json
import uuid
import urllib.request
from datetime import UTC, datetime
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.people import User
from app.db.session import get_db
from app.schemas.people import UserRead

_bearer = HTTPBearer(auto_error=False)

_ALGORITHMS = ["ES256"]
_AUDIENCE = "authenticated"
_DISPATCHER_ROLE = "dispatcher"

# Fixed stub identity used in DEMO_MODE — must match the org created by DB seeds.
_DEMO_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
_DEMO_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
_DEMO_NOW = datetime(2026, 1, 1, tzinfo=UTC)

_DEMO_USER = UserRead(
    id=_DEMO_USER_ID,
    organization_id=_DEMO_ORG_ID,
    email="demo-dispatcher@freightproof.co.za",
    full_name="Demo Dispatcher",
    is_active=True,
    created_at=_DEMO_NOW,
    updated_at=_DEMO_NOW,
)


@lru_cache(maxsize=1)
def _get_jwks() -> dict:
    """Fetch and cache the Supabase JWKS. Called once per process lifetime."""
    url = f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read())


def _get_signing_key(kid: str) -> dict:
    """Return the JWK matching the token's key ID."""
    jwks = _get_jwks()
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _decode_token(token: str) -> dict:
    """Verify the Supabase JWT and return its payload.

    Supabase uses ES256 (ECDSA) — verified against the public key from JWKS.
    Raises HTTP 401 on any verification failure.
    """
    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    signing_key = _get_signing_key(header.get("kid", ""))

    try:
        return jwt.decode(
            token,
            signing_key,
            algorithms=_ALGORITHMS,
            audience=_AUDIENCE,
        )
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _require_dispatcher_role(payload: dict) -> None:
    """Raise HTTP 403 if the JWT does not carry the dispatcher role.

    Role lives in app_metadata (set by service_role at account creation) —
    never in user_metadata, which is user-editable.
    """
    role = (payload.get("app_metadata") or {}).get("role")
    if role != _DISPATCHER_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dispatcher role required.",
        )


async def get_current_dispatcher(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """Return the authenticated dispatcher for the current request, or raise 401/403.

    Used as a FastAPI dependency:
        async def my_endpoint(user: UserRead = Depends(get_current_dispatcher)):
    """
    if settings.DEMO_MODE:
        return _DEMO_USER

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing authentication credentials.",
        )

    payload = _decode_token(credentials.credentials)
    _require_dispatcher_role(payload)

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token subject is missing or not a valid UUID.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not found.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return UserRead.model_validate(user)


# Guard: DEMO_MODE must never be enabled in production — it bypasses all authentication.
if settings.DEMO_MODE and settings.ENVIRONMENT == "production":
    raise RuntimeError(
        "DEMO_MODE=True is not permitted when ENVIRONMENT='production'. "
        "Set DEMO_MODE=False and configure Supabase Auth credentials."
    )
