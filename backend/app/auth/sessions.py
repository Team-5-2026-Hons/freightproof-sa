"""One active device per driver.

Supabase issues and signs driver tokens, so this backend cannot revoke one — a handset
that has signed in keeps a valid token until it expires no matter what happens elsewhere.
Enforcement therefore happens on the way IN: the backend records which session it
recognises for each driver, and refuses any request carrying a different, older one.

Newest login wins, which is the behaviour a driver expects: signing in on a new phone
takes over, and the old handset is signed out the next time it touches the API. The
ordering comes from the token's own `iat` claim, because the backend never observes a
login event — only requests, which can arrive from two devices in any order.
"""

import logging
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.sessions import DriverSession

logger = logging.getLogger(__name__)

# Sent as the detail when an older device is refused. The driver app matches on this
# exact string to tell "you were signed out because you signed in elsewhere" apart from
# an ordinary expired/invalid token, which needs different copy and no explanation.
SESSION_SUPERSEDED_DETAIL = "Signed in on another device."


def _claimed_session(payload: dict) -> tuple[str, datetime] | None:
    """The (session_id, issued_at) this token claims, or None if it carries neither.

    Supabase access tokens include session_id; a token without one cannot be placed in
    any ordering, so it is allowed through unchecked rather than locking a driver out of
    the app over an auth-provider detail they cannot influence. Logged, because a fleet
    where this never appears is one where the enforcement is real.
    """
    session_id = payload.get("session_id")
    issued_at_raw = payload.get("iat")
    if not isinstance(session_id, str) or not session_id or not isinstance(issued_at_raw, (int, float)):
        return None
    return session_id, datetime.fromtimestamp(issued_at_raw, tz=UTC)


async def enforce_single_device(
    db: AsyncSession, *, driver_id: uuid.UUID, payload: dict,
) -> None:
    """Bind this driver to the token's session, or refuse an older device's token.

    Raises HTTPException 401 with SESSION_SUPERSEDED_DETAIL when a newer session has
    already claimed this driver. Returns normally in every other case:

      * no session recorded yet — first request from a fresh login, claim it
      * same session — the device already holds the claim, just note it was seen
      * newer session — a login on another handset takes over, and the previous device
        starts failing from its next request
    """
    claimed = _claimed_session(payload)
    if claimed is None:
        logger.warning("Driver token for %s carries no session_id — single-device check skipped", driver_id)
        return
    session_id, issued_at = claimed

    result = await db.execute(select(DriverSession).where(DriverSession.driver_id == driver_id))
    current = result.scalar_one_or_none()

    if current is None:
        db.add(DriverSession(driver_id=driver_id, session_id=session_id, issued_at=issued_at))
        await db.flush()
        return

    if current.session_id == session_id:
        current.last_seen_at = datetime.now(UTC)
        return

    # A different session. Only a NEWER one may take over — otherwise an old handset
    # whose token is still valid would claim the account back on its very next poll, and
    # the two devices would trade the session between them indefinitely.
    if issued_at <= current.issued_at:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=SESSION_SUPERSEDED_DETAIL,
            headers={"WWW-Authenticate": "Bearer"},
        )

    logger.info("Driver %s signed in on a new device — previous session superseded", driver_id)
    current.session_id = session_id
    current.issued_at = issued_at
    current.last_seen_at = datetime.now(UTC)
