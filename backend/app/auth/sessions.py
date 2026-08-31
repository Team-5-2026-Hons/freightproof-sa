"""Session rules enforced on the way in: one active device per driver, and an idle
timeout for everyone.

Supabase issues and signs the tokens, so this backend cannot revoke one — a device that
has signed in keeps a valid token until it expires no matter what happens elsewhere, and
Supabase's client refreshes that token indefinitely. Both rules here therefore work the
same way: the backend records what it knows about each session and refuses requests that
contradict it.

  Single device  — the backend records which session it recognises for each driver and
                   refuses a different, older one. Newest login wins, which is what a
                   driver expects: signing in on a new phone takes over, and the old
                   handset is signed out the next time it touches the API. The ordering
                   comes from the token's own `iat` claim, because the backend never
                   observes a login event — only requests, which can arrive from two
                   devices in any order.

  Idle timeout   — the backend stamps a last-seen time on every authenticated request and
                   refuses a session that has not been seen for
                   SESSION_IDLE_TIMEOUT_MINUTES. Without it a stolen laptop or an
                   unattended handset stays signed in permanently, because nothing in the
                   Supabase token lifecycle ever ends a session that keeps refreshing.
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

# Sent as the detail when an older device is refused. The driver app matches on this
# exact string to tell "you were signed out because you signed in elsewhere" apart from
# an ordinary expired/invalid token, which needs different copy and no explanation.
SESSION_SUPERSEDED_DETAIL = "Signed in on another device."


def _superseded() -> HTTPException:
    """Raised from two places now — the read-time decision and the write-time re-test —
    which is why it is a helper rather than an inline construction."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=SESSION_SUPERSEDED_DETAIL,
        headers={"WWW-Authenticate": "Bearer"},
    )

# Sent when a session is refused for inactivity. A distinct string for the same reason
# SESSION_SUPERSEDED_DETAIL is distinct: "you were signed out for being idle" is a
# different fact from "your token is invalid", and the apps say different things about it.
SESSION_IDLE_DETAIL = "Signed out after a period of inactivity."

# How long a session row outlives its own usefulness before the sweep removes it.
#
# This is deliberately far longer than the idle timeout, and that gap is load-bearing.
# enforce_idle_timeout treats an unrecognised session as new; if rows were deleted as
# soon as they went idle, an attacker replaying a long-idle token would find no row and
# be admitted as a fresh sign-in — the deletion would undo the very check it was cleaning
# up after. A week is comfortably beyond the life of any access token that could still be
# presented, so by the time a row is swept, no token naming it can still verify.
SESSION_RECORD_RETENTION_DAYS = 7

# How stale the last-seen stamp may get before a request bothers to refresh it.
#
# Every request from one signed-in user writes the SAME row, and the idle window is
# measured in minutes — so stamping on literally every request buys nothing and costs two
# round trips (the write, and the commit that releases its row lock) against a database
# that is not on this machine.
#
# What skipping costs is bounded and points the safe way: the stamp can lag reality by at
# most this interval, so a session is refused at most this much EARLIER than its true idle
# deadline, never later. Against SESSION_IDLE_TIMEOUT_MINUTES that is a small fraction,
# and erring towards signing someone out sooner is the right direction for a control that
# exists to end unattended sessions.
SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS = 60


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


def _as_utc(value: datetime) -> datetime:
    """Force a timestamp read back from Postgres into an aware UTC datetime.

    The columns are TIMESTAMPTZ and asyncpg returns aware values, but a row still sitting
    in the session from an earlier write in the same transaction carries whatever the
    caller assigned. Normalising here means the comparison below can never raise the
    naive-vs-aware TypeError, which on this path would be a 500 on every request.
    """
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _recently_stamped(last_seen_at: datetime) -> bool:
    """True when the stamp is fresh enough that rewriting it would buy nothing.

    Shared by both halves: the driver's row and the dispatcher's are different tables but
    the same problem — one row, written by every request the signed-in user makes.
    """
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

    # A different session. Only a NEWER one may take over — otherwise an old handset
    # whose token is still valid would claim the account back on its very next poll, and
    # the two devices would trade the session between them indefinitely. Decided here so
    # the refusal is logged against what was actually read, but it is NOT what enforces
    # the rule: the upsert below re-tests it atomically, because between this read and
    # that write a newer handset may have claimed the driver.
    if current is not None and current.session_id != session_id and issued_at <= current.issued_at:
        raise _superseded()

    if (
        current is not None
        and current.session_id == session_id
        and _recently_stamped(current.last_seen_at)
    ):
        # This handset already holds the claim and was stamped moments ago, so the upsert
        # below would do nothing but move last_seen_at. Skipped — see the constant. Only
        # safe on the same session: a takeover has to be written, however fresh the row.
        return

    now = datetime.now(UTC)
    claim = pg_insert(DriverSession).values(
        driver_id=driver_id,
        session_id=session_id,
        issued_at=issued_at,
        last_seen_at=now,
    )
    # One statement for all three outcomes — claim an unheld account, restamp the handset
    # that already holds it, or hand it to a newer login — because the driver app fires
    # several requests at once and a read-then-INSERT gives the losers a duplicate-key 500
    # on driver_sessions_pkey instead of a session. The WHERE is the single-device rule
    # itself, evaluated against the row as it exists at write time:
    #
    #   same session_id  — the holder, whatever its iat: restamp it
    #   strictly newer   — a login on another handset takes over
    #   anything else    — no row updated, which is how the caller learns it was refused
    #
    # last_seen_at is set from this process's clock rather than the column's now() default
    # so that the timestamp and the idle comparison that reads it come from one clock.
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
        # The conflict target matched but the WHERE refused the update: another handset
        # holds this driver with a token at least as new. Only reachable when that handset
        # landed between the read above and this write, so it is rare — and it is exactly
        # the case the read alone would have got wrong.
        raise _superseded()

    if current is not None and current.session_id != session_id:
        logger.info("Driver %s signed in on a new device — previous session superseded", driver_id)

    # Committed on its own rather than left to the request's transaction. Every request
    # from one signed-in user writes THE SAME row, so an uncommitted stamp holds a row
    # lock that the user's other in-flight requests block on until the slowest of them
    # finishes — which is what turned one slow endpoint into a whole page stalling.
    #
    # This is safe because nothing else has written yet: dependencies run before the
    # endpoint body, and no dependency outside this module takes a database session at
    # all. That is a property of the current code, not one the code enforces — if a
    # writing dependency is ever added ahead of the auth check, its work would be
    # committed here as a side effect and would survive a later rollback.
    #
    # Do NOT try to guard that by checking db.new/db.dirty before committing: it looks
    # like it works and does not. Our own SELECT and upsert autoflush the session first,
    # so any pending work has already moved into the transaction by the time the check
    # runs, and the check sees a clean session and commits it regardless. Making this
    # genuinely safe needs the stamp on its own connection, which the savepoint-based test
    # fixture cannot express (the seeded rows are uncommitted on another connection, so
    # the FK would fail). Left as a documented constraint, deliberately.
    await db.commit()


# ── Idle timeout ──────────────────────────────────────────────────────────────


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

    Reads the same DriverSession row the single-device check maintains, so drivers need
    no second table — the last_seen_at column that was already being stamped is exactly
    the timestamp this needs.

    MUST run before enforce_single_device, which stamps last_seen_at forward: checking
    afterwards would read a timestamp this request had just refreshed, and the timeout
    would never fire for anyone.
    """
    claimed = _claimed_session(payload)
    if claimed is None:
        # Same policy as the single-device check: a token carrying no session claim is an
        # auth-provider detail the driver cannot influence, and locking them out of the
        # app over it would be worse than the risk. Logged so a fleet where this appears
        # is visible rather than silent.
        logger.warning("Driver token for %s carries no session_id — idle check skipped", driver_id)
        return
    session_id, issued_at = claimed

    result = await db.execute(select(DriverSession).where(DriverSession.driver_id == driver_id))
    current = result.scalar_one_or_none()

    # No row, or a row for a different session: this session has never been seen here, so
    # there is no activity history to judge. Fall back to the token's own issue time —
    # a genuine fresh sign-in is seconds old, whereas a token replayed from a handset
    # that has been sitting in a drawer is not, because a client that is not running is
    # not refreshing it either.
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
    """Refuse a dispatcher's request when their session has been idle too long, and stamp
    this request as activity.

    Unlike the driver path there is no existing row to piggyback on, so this both reads
    and writes user_sessions. Dispatchers may hold several sessions at once (desk machine
    and laptop), which is why the row is keyed on the session rather than the user.

    The write is an upsert and is COMMITTED here rather than deferred to the request's own
    transaction — see the comments at each, both of which are about the same fact: a whole
    page-load's worth of requests from one dispatcher all contend for this single row.
    """
    claimed = _claimed_session(payload)
    if claimed is None:
        logger.warning("Dispatcher token for %s carries no session_id — idle check skipped", user_id)
        return
    session_id, issued_at = claimed

    result = await db.execute(select(UserSession).where(UserSession.session_id == session_id))
    current = result.scalar_one_or_none()

    if current is None:
        # Unrecognised session — same iat floor as the driver path, and for the same
        # reason. See SESSION_RECORD_RETENTION_DAYS on why a swept row cannot reach here
        # while its token is still valid.
        if issued_at < _idle_cutoff():
            logger.info("Dispatcher %s refused: unrecognised session issued %s", user_id, issued_at)
            raise _idle_expired()
    elif _as_utc(current.last_seen_at) < _idle_cutoff():
        logger.info("Dispatcher %s signed out for inactivity (last seen %s)", user_id, current.last_seen_at)
        raise _idle_expired()
    elif _recently_stamped(current.last_seen_at):
        # Session is known and recently active — the stamp below would only move
        # last_seen_at a few seconds. Skipped; see the constant. Deliberately AFTER the
        # idle check, which must still run on every request.
        return

    now = datetime.now(UTC)
    # The stamp is one upsert rather than an ORM insert-or-mutate, because "no row yet" is
    # the normal state for SEVERAL requests at once: signing in loads a page that fans out
    # to the trip list, the precinct list, the blockchain check and the SSE stream, and
    # every one of them arrives here with the same brand-new session_id having just found
    # nothing. A plain INSERT lets one win and gives the rest a duplicate-key 500. ON
    # CONFLICT turns the loser's statement into the last_seen_at stamp it was going to
    # make anyway, so all of them succeed.
    #
    # updated_at is set explicitly: the model's onupdate fires for ORM and Core UPDATE
    # statements, not for the DO UPDATE arm of an upsert.
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
        # Opportunistic retention sweep, scoped to this user's own rows and run only when
        # a new session appears — bounded work on an indexed column, and it keeps the
        # table from growing by one row per sign-in forever without needing a scheduled
        # job for a handful of dispatchers.
        await db.execute(
            delete(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.session_id != session_id,
                UserSession.last_seen_at < now - timedelta(days=SESSION_RECORD_RETENTION_DAYS),
            )
        )

    # Committed on its own rather than left to the request's transaction. Every request
    # from one signed-in user writes THE SAME row, so an uncommitted stamp holds a row
    # lock that the user's other in-flight requests block on until the slowest of them
    # finishes — which is what turned one slow endpoint into a whole page stalling.
    #
    # This is safe because nothing else has written yet: dependencies run before the
    # endpoint body, and no dependency outside this module takes a database session at
    # all. That is a property of the current code, not one the code enforces — if a
    # writing dependency is ever added ahead of the auth check, its work would be
    # committed here as a side effect and would survive a later rollback.
    #
    # Do NOT try to guard that by checking db.new/db.dirty before committing: it looks
    # like it works and does not. Our own SELECT and upsert autoflush the session first,
    # so any pending work has already moved into the transaction by the time the check
    # runs, and the check sees a clean session and commits it regardless. Making this
    # genuinely safe needs the stamp on its own connection, which the savepoint-based test
    # fixture cannot express (the seeded rows are uncommitted on another connection, so
    # the FK would fail). Left as a documented constraint, deliberately.
    await db.commit()
