"""FastAPI dependencies for Supabase Auth verification.

Flow:
  1. Extract Bearer token from Authorization header.
  2. Decode + verify the JWT locally using SUPABASE_JWT_SECRET (no network
     round-trip per request).
  3. Assert app_metadata.role == "dispatcher" — rejects driver and
     client_viewer tokens at the gate.
  4. Look up the User row by id == JWT sub claim.
  5. Assert the account is active.

Import get_current_dispatcher as a FastAPI Depends() on any endpoint that
requires an authenticated dispatcher session.
"""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.people import User
from app.db.session import get_db

_bearer = HTTPBearer()

_ALGORITHM = "HS256"
_AUDIENCE = "authenticated"
_DISPATCHER_ROLE = "dispatcher"


def _decode_token(token: str) -> dict:
    """Verify the Supabase JWT and return its payload.

    Raises HTTP 401 on any verification failure so callers never see raw
    jose exceptions.
    """
    try:
        return jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=[_ALGORITHM],
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
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
    db: AsyncSession = Depends(get_db),
) -> User:
    """Return the authenticated dispatcher User, or raise 401/403.

    Used as a FastAPI dependency:
        async def my_endpoint(user: User = Depends(get_current_dispatcher)):
    """
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

    return user
