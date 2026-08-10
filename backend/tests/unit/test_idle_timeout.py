"""Unit tests for the inactivity timeout (app/auth/sessions.py).

The rule: a session that has not been seen for SESSION_IDLE_TIMEOUT_MINUTES stops being
accepted. It exists because Supabase signs the tokens and refreshes them indefinitely —
without something on this side tracking activity, a stolen laptop or an unattended
handset stays authenticated forever.

Both halves are covered: the driver's (which reads the DriverSession row the single-device
check already maintains) and the dispatcher's (which owns user_sessions outright).
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.auth.sessions import (
    SESSION_IDLE_DETAIL,
    SESSION_RECORD_RETENTION_DAYS,
    enforce_driver_idle_timeout,
    enforce_single_device,
    enforce_user_idle_timeout,
)
from app.core.config import settings
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import Driver, User
from app.db.models.sessions import DriverSession, UserSession


async def _org(db_session) -> Organization:
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    return org


async def _driver(db_session) -> Driver:
    org = await _org(db_session)
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number=f"DRV-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(driver)
    await db_session.flush()
    return driver


async def _user(db_session) -> User:
    org = await _org(db_session)
    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"dispatcher-{uuid.uuid4().hex[:8]}@example.com", full_name="Dispatcher",
    )
    db_session.add(user)
    await db_session.flush()
    return user


def _token(session_id: str, issued_at: datetime) -> dict:
    return {"session_id": session_id, "iat": int(issued_at.timestamp())}


def _long_ago() -> datetime:
    """Comfortably past the idle window, whatever it is configured to."""
    return datetime.now(UTC) - timedelta(minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES + 5)


# ── Driver ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_an_active_driver_session_is_accepted(db_session) -> None:
    driver = await _driver(db_session)
    now = datetime.now(UTC)
    await enforce_single_device(db_session, driver_id=driver.id, payload=_token("session-a", now))

    # No exception: the row was stamped a moment ago.
    await enforce_driver_idle_timeout(db_session, driver_id=driver.id, payload=_token("session-a", now))


@pytest.mark.asyncio
async def test_an_idle_driver_session_is_refused(db_session) -> None:
    driver = await _driver(db_session)
    now = datetime.now(UTC)
    await enforce_single_device(db_session, driver_id=driver.id, payload=_token("session-a", now))

    # Age the row rather than the clock — the same state as a handset left untouched.
    stored = (await db_session.execute(
        select(DriverSession).where(DriverSession.driver_id == driver.id)
    )).scalar_one()
    stored.last_seen_at = _long_ago()
    await db_session.flush()

    with pytest.raises(HTTPException) as exc_info:
        await enforce_driver_idle_timeout(
            db_session, driver_id=driver.id, payload=_token("session-a", now),
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == SESSION_IDLE_DETAIL


@pytest.mark.asyncio
async def test_a_replayed_token_from_an_unknown_session_is_refused(db_session) -> None:
    """The case the DB row cannot answer: no record, so the token's own age decides.

    A client that is not running is not refreshing its token, so a token replayed from a
    handset in a drawer carries an old `iat` — which is the only activity evidence
    available when there is no row to read.
    """
    driver = await _driver(db_session)

    with pytest.raises(HTTPException) as exc_info:
        await enforce_driver_idle_timeout(
            db_session, driver_id=driver.id, payload=_token("never-seen", _long_ago()),
        )

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_a_fresh_login_on_a_new_device_is_allowed(db_session) -> None:
    """The other side of the same branch: an unrecognised session with a NEW token is
    an ordinary first request after signing in, and must not be mistaken for a replay."""
    driver = await _driver(db_session)

    await enforce_driver_idle_timeout(
        db_session, driver_id=driver.id, payload=_token("brand-new", datetime.now(UTC)),
    )


@pytest.mark.asyncio
async def test_a_driver_token_without_a_session_claim_is_allowed_through(db_session) -> None:
    """Matches the single-device check's policy: an auth-provider detail the driver
    cannot influence must not lock them out of the app."""
    driver = await _driver(db_session)

    await enforce_driver_idle_timeout(db_session, driver_id=driver.id, payload={})


# ── Dispatcher ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_first_dispatcher_request_records_the_session(db_session) -> None:
    user = await _user(db_session)
    now = datetime.now(UTC)

    await enforce_user_idle_timeout(db_session, user_id=user.id, payload=_token("session-a", now))

    stored = (await db_session.execute(
        select(UserSession).where(UserSession.session_id == "session-a")
    )).scalar_one()
    assert stored.user_id == user.id


@pytest.mark.asyncio
async def test_an_active_dispatcher_session_is_accepted_and_restamped(db_session) -> None:
    user = await _user(db_session)
    now = datetime.now(UTC)
    await enforce_user_idle_timeout(db_session, user_id=user.id, payload=_token("session-a", now))

    stored = (await db_session.execute(
        select(UserSession).where(UserSession.session_id == "session-a")
    )).scalar_one()
    # Push it back inside the window, then confirm a request moves it forward again.
    behind = datetime.now(UTC) - timedelta(minutes=1)
    stored.last_seen_at = behind
    await db_session.flush()

    await enforce_user_idle_timeout(db_session, user_id=user.id, payload=_token("session-a", now))

    # Flush before refresh: the function assigns last_seen_at on the in-session object,
    # and refresh() re-reads from the database — without the flush it would read back the
    # pre-update row and the assertion would test nothing. Flushing also proves the new
    # value actually reaches Postgres rather than only living in the identity map.
    await db_session.flush()
    await db_session.refresh(stored)
    assert stored.last_seen_at > behind


@pytest.mark.asyncio
async def test_an_idle_dispatcher_session_is_refused(db_session) -> None:
    user = await _user(db_session)
    now = datetime.now(UTC)
    await enforce_user_idle_timeout(db_session, user_id=user.id, payload=_token("session-a", now))

    stored = (await db_session.execute(
        select(UserSession).where(UserSession.session_id == "session-a")
    )).scalar_one()
    stored.last_seen_at = _long_ago()
    await db_session.flush()

    with pytest.raises(HTTPException) as exc_info:
        await enforce_user_idle_timeout(
            db_session, user_id=user.id, payload=_token("session-a", now),
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == SESSION_IDLE_DETAIL


@pytest.mark.asyncio
async def test_two_dispatcher_devices_keep_independent_clocks(db_session) -> None:
    """The reason user_sessions is keyed on the session and not the user.

    A dispatcher working from a desktop and a laptop holds two Supabase sessions. Letting
    them share one row would mean either machine's activity kept the other alive — so
    neither would ever expire.
    """
    user = await _user(db_session)
    now = datetime.now(UTC)
    await enforce_user_idle_timeout(db_session, user_id=user.id, payload=_token("desktop", now))
    await enforce_user_idle_timeout(db_session, user_id=user.id, payload=_token("laptop", now))

    idle = (await db_session.execute(
        select(UserSession).where(UserSession.session_id == "laptop")
    )).scalar_one()
    idle.last_seen_at = _long_ago()
    await db_session.flush()

    # The abandoned laptop is refused...
    with pytest.raises(HTTPException):
        await enforce_user_idle_timeout(db_session, user_id=user.id, payload=_token("laptop", now))

    # ...while the desktop in front of them keeps working.
    await enforce_user_idle_timeout(db_session, user_id=user.id, payload=_token("desktop", now))


@pytest.mark.asyncio
async def test_a_replayed_dispatcher_token_from_an_unknown_session_is_refused(db_session) -> None:
    user = await _user(db_session)

    with pytest.raises(HTTPException) as exc_info:
        await enforce_user_idle_timeout(
            db_session, user_id=user.id, payload=_token("never-seen", _long_ago()),
        )

    assert exc_info.value.status_code == 401
    # Nothing was recorded for a session that was refused.
    assert (await db_session.execute(
        select(UserSession).where(UserSession.session_id == "never-seen")
    )).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_the_retention_sweep_leaves_recently_idle_rows_alone(db_session) -> None:
    """The gap between the idle timeout and the retention horizon is load-bearing.

    If a row were swept as soon as it went idle, the next replay of its token would find
    no record and be treated as a fresh sign-in — the cleanup would undo the check. Only
    rows older than SESSION_RECORD_RETENTION_DAYS may go, by which point no token naming
    them can still verify.
    """
    user = await _user(db_session)
    now = datetime.now(UTC)
    await enforce_user_idle_timeout(db_session, user_id=user.id, payload=_token("idle-but-recent", now))

    recent = (await db_session.execute(
        select(UserSession).where(UserSession.session_id == "idle-but-recent")
    )).scalar_one()
    recent.last_seen_at = _long_ago()

    ancient = UserSession(
        session_id="ancient", user_id=user.id, issued_at=now,
        last_seen_at=now - timedelta(days=SESSION_RECORD_RETENTION_DAYS + 1),
    )
    db_session.add(ancient)
    await db_session.flush()

    # A new session triggers the sweep.
    await enforce_user_idle_timeout(db_session, user_id=user.id, payload=_token("fresh", now))

    remaining = set((await db_session.execute(
        select(UserSession.session_id).where(UserSession.user_id == user.id)
    )).scalars())
    assert "ancient" not in remaining
    assert "idle-but-recent" in remaining
