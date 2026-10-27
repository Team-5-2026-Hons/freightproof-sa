"""Session rules enforced on the way in: one active device per driver, and an
idle timeout for everyone.

Supabase issues and signs the tokens, so this backend cannot revoke one — it
can only record what it knows about each session and refuse requests that
contradict it.

  Single device — newest login (by the token's `iat` claim) wins; an older
                  device's token is refused from its next request.
  Idle timeout  — a session not seen for SESSION_IDLE_TIMEOUT_MINUTES is
                  refused, since a self-refreshing Supabase token never
                  expires an unattended session on its own.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.sessions import DriverSession, UserSession

logger = logging.getLogger(__name__)

SESSION_SUPERSEDED_DETAIL = "Signed in on another device."


def _superseded() -> HTTPException:
    """Raised from both the read-time decision and the write-time re-test."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=SESSION_SUPERSEDED_DETAIL,
        headers={"WWW-Authenticate": "Bearer"},
    )

SESSION_IDLE_DETAIL = "Signed out after a period of inactivity."

SESSION_RECORD_RETENTION_DAYS = 7

SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS = 60


def _claimed_session(payload: dict) -> tuple[str, datetime] | None:
    """The (session_id, issued_at) this token claims, or None if it carries neither.

    A token without a session_id is allowed through unchecked rather than
    locking the driver out over an auth-provider detail they can't influence.
    """
    session_id = payload.get("session_id")
    issued_at_raw = payload.get("iat")
    if not isinstance(session_id, str) or not session_id or not isinstance(issued_at_raw, (int, float)):
        return None
    return session_id, datetime.fromtimestamp(issued_at_raw, tz=UTC)


def _as_utc(value: datetime) -> datetime:
    """Force a timestamp into an aware UTC datetime.

    A row still in the session from an earlier write in the same transaction
    may carry a naive value; normalising avoids a naive-vs-aware TypeError.
    """
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _recently_stamped(last_seen_at: datetime) -> bool:
    """True when the stamp is fresh enough that rewriting it would buy nothing."""
    return _as_utc(last_seen_at) > datetime.now(UTC) - timedelta(
        seconds=SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS
    )


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

    if current is not None and current.session_id != session_id and issued_at <= current.issued_at:
        raise _superseded()

    if (
        current is not None
        and current.session_id == session_id
        and _recently_stamped(current.last_seen_at)
    ):
        return

    now = datetime.now(UTC)
    claim = pg_insert(DriverSession).values(
        driver_id=driver_id,
        session_id=session_id,
        issued_at=issued_at,
        last_seen_at=now,
    )
    claim_result = await db.execute(
        claim.on_conflict_do_update(
            index_elements=[DriverSession.driver_id],
            set_={
                "session_id": claim.excluded.session_id,
                "issued_at": claim.excluded.issued_at,
                "last_seen_at": claim.excluded.last_seen_at,
                "updated_at": now,
            },
            where=(
                (DriverSession.session_id == claim.excluded.session_id)
                | (DriverSession.issued_at < claim.excluded.issued_at)
            ),
        ).returning(DriverSession.driver_id)
    )
    if claim_result.scalar_one_or_none() is None:
        raise _superseded()

    if current is not None and current.session_id != session_id:
        logger.info("Driver %s signed in on a new device — previous session superseded", driver_id)

    await db.commit()



def _idle_cutoff() -> datetime:
    """The instant before which a last-seen timestamp counts as expired."""
    return datetime.now(UTC) - timedelta(minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES)


def _idle_expired() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=SESSION_IDLE_DETAIL,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def enforce_driver_idle_timeout(
    db: AsyncSession, *, driver_id: uuid.UUID, payload: dict,
) -> None:
    """Refuse a driver's request when their session has been idle too long.

    Reads the same DriverSession row the single-device check maintains.

    MUST run before enforce_single_device, which stamps last_seen_at forward
    — checking after would read a timestamp this request just refreshed and
    the timeout would never fire.
    """
    claimed = _claimed_session(payload)
    if claimed is None:
        logger.warning("Driver token for %s carries no session_id — idle check skipped", driver_id)
        return
    session_id, issued_at = claimed

    result = await db.execute(select(DriverSession).where(DriverSession.driver_id == driver_id))
    current = result.scalar_one_or_none()

    if current is None or current.session_id != session_id:
        if issued_at < _idle_cutoff():
            logger.info("Driver %s refused: unrecognised session issued %s", driver_id, issued_at)
            raise _idle_expired()
        return

    if _as_utc(current.last_seen_at) < _idle_cutoff():
        logger.info("Driver %s signed out for inactivity (last seen %s)", driver_id, current.last_seen_at)
        raise _idle_expired()


async def enforce_user_idle_timeout(
    db: AsyncSession, *, user_id: uuid.UUID, payload: dict,
) -> None:
    """Refuse a dispatcher's request when their session has been idle too
    long, and stamp this request as activity.

    Unlike the driver path there's no existing row to piggyback on, so this
    both reads and writes user_sessions, keyed by session (not user) since a
    dispatcher may hold several sessions at once (desk + laptop).
    """
    claimed = _claimed_session(payload)
    if claimed is None:
        logger.warning("Dispatcher token for %s carries no session_id — idle check skipped", user_id)
        return
    session_id, issued_at = claimed

    result = await db.execute(select(UserSession).where(UserSession.session_id == session_id))
    current = result.scalar_one_or_none()

    if current is None:
        if issued_at < _idle_cutoff():
            logger.info("Dispatcher %s refused: unrecognised session issued %s", user_id, issued_at)
            raise _idle_expired()
    elif _as_utc(current.last_seen_at) < _idle_cutoff():
        logger.info("Dispatcher %s signed out for inactivity (last seen %s)", user_id, current.last_seen_at)
        raise _idle_expired()
    elif _recently_stamped(current.last_seen_at):
        return

    now = datetime.now(UTC)
    await db.execute(
        pg_insert(UserSession)
        .values(
            session_id=session_id,
            user_id=user_id,
            issued_at=issued_at,
            last_seen_at=now,
        )
        .on_conflict_do_update(
            index_elements=[UserSession.session_id],
            set_={"last_seen_at": now, "updated_at": now},
        )
    )

    if current is None:
        await db.execute(
            delete(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.session_id != session_id,
                UserSession.last_seen_at < now - timedelta(days=SESSION_RECORD_RETENTION_DAYS),
            )
        )

    await db.commit()
