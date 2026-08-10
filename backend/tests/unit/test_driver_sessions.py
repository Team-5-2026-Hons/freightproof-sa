"""Unit tests for the one-device-per-driver rule (app/auth/sessions.py).

The rule exists because evidence is attributed to an identity: one account signed in on
two handsets means two people capturing phases of the same trip under one name, and
nothing downstream can untangle that afterwards.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.auth.sessions import SESSION_SUPERSEDED_DETAIL, enforce_single_device
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import Driver
from app.db.models.sessions import DriverSession


async def _driver(db_session) -> Driver:
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number=f"DRV-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(driver)
    await db_session.flush()
    return driver


def _token(session_id: str, issued_at: datetime) -> dict:
    return {"session_id": session_id, "iat": int(issued_at.timestamp())}


@pytest.mark.asyncio
async def test_first_request_claims_the_device(db_session) -> None:
    driver = await _driver(db_session)
    now = datetime.now(UTC)

    await enforce_single_device(db_session, driver_id=driver.id, payload=_token("session-a", now))

    stored = (await db_session.execute(
        select(DriverSession).where(DriverSession.driver_id == driver.id)
    )).scalar_one()
    assert stored.session_id == "session-a"


@pytest.mark.asyncio
async def test_the_same_session_keeps_working(db_session) -> None:
    driver = await _driver(db_session)
    now = datetime.now(UTC)
    await enforce_single_device(db_session, driver_id=driver.id, payload=_token("session-a", now))

    # No exception on the second, third, hundredth request from the same handset.
    await enforce_single_device(db_session, driver_id=driver.id, payload=_token("session-a", now))


@pytest.mark.asyncio
async def test_a_newer_login_takes_over_the_account(db_session) -> None:
    """Signing in on a new phone is the normal case, not an attack — it wins."""
    driver = await _driver(db_session)
    now = datetime.now(UTC)
    await enforce_single_device(db_session, driver_id=driver.id, payload=_token("old-phone", now))

    await enforce_single_device(
        db_session, driver_id=driver.id, payload=_token("new-phone", now + timedelta(minutes=5)),
    )

    stored = (await db_session.execute(
        select(DriverSession).where(DriverSession.driver_id == driver.id)
    )).scalar_one()
    assert stored.session_id == "new-phone"


@pytest.mark.asyncio
async def test_the_superseded_device_is_refused(db_session) -> None:
    """The old handset's token is still validly signed — Supabase can't be told to revoke
    it — so the refusal has to happen here, on its next request."""
    driver = await _driver(db_session)
    now = datetime.now(UTC)
    await enforce_single_device(db_session, driver_id=driver.id, payload=_token("old-phone", now))
    await enforce_single_device(
        db_session, driver_id=driver.id, payload=_token("new-phone", now + timedelta(minutes=5)),
    )

    with pytest.raises(HTTPException) as exc_info:
        await enforce_single_device(db_session, driver_id=driver.id, payload=_token("old-phone", now))

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == SESSION_SUPERSEDED_DETAIL


@pytest.mark.asyncio
async def test_the_old_device_cannot_claim_the_account_back(db_session) -> None:
    """The reason the check compares iat rather than just swapping on any difference:
    otherwise two logged-in handsets would trade the session between them forever, each
    kicking the other out on its next poll."""
    driver = await _driver(db_session)
    now = datetime.now(UTC)
    await enforce_single_device(
        db_session, driver_id=driver.id, payload=_token("new-phone", now + timedelta(minutes=5)),
    )

    with pytest.raises(HTTPException):
        await enforce_single_device(db_session, driver_id=driver.id, payload=_token("old-phone", now))

    stored = (await db_session.execute(
        select(DriverSession).where(DriverSession.driver_id == driver.id)
    )).scalar_one()
    assert stored.session_id == "new-phone"


@pytest.mark.asyncio
async def test_a_token_without_a_session_claim_is_allowed_through(db_session) -> None:
    """A token shape this backend doesn't recognise must not lock a driver out of the app
    over an auth-provider detail they cannot influence — it is logged and skipped."""
    driver = await _driver(db_session)

    await enforce_single_device(db_session, driver_id=driver.id, payload={"sub": str(driver.id)})

    assert (await db_session.execute(
        select(DriverSession).where(DriverSession.driver_id == driver.id)
    )).scalar_one_or_none() is None
