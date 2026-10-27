"""Integration tests for POST /api/v1/drivers/me/push-tokens."""

import uuid

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_push_tokens import DriverPushToken
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import Driver
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token

_URL = "/api/v1/drivers/me/push-tokens"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def _driver(db: AsyncSession, org: Organization | None = None) -> Driver:
    if org is None:
        org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
        db.add(org)
        await db.flush()
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number=f"DRV-{uuid.uuid4().hex[:6]}",
    )
    db.add(driver)
    await db.flush()
    return driver


async def _tokens(db: AsyncSession) -> list[DriverPushToken]:
    return list((await db.execute(select(DriverPushToken).execution_options(populate_existing=True))).scalars())


async def test_register_push_token_returns_204_and_stores_the_token(client: AsyncClient, db_session: AsyncSession):
    driver = await _driver(db_session)
    token = make_token(sub=str(driver.id), role="driver")

    response = await client.post(_URL, json={"token": "fcm-1", "platform": "android"}, headers=auth_header(token))

    assert response.status_code == 204
    rows = await _tokens(db_session)
    assert [(row.driver_id, row.token, row.platform) for row in rows] == [(driver.id, "fcm-1", "android")]


async def test_register_push_token_twice_keeps_one_row(client: AsyncClient, db_session: AsyncSession):
    driver = await _driver(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await client.post(_URL, json={"token": "fcm-1", "platform": "android"}, headers=auth_header(token))

    response = await client.post(_URL, json={"token": "fcm-1", "platform": "android"}, headers=auth_header(token))

    assert response.status_code == 204
    assert len(await _tokens(db_session)) == 1


async def test_register_push_token_held_by_another_driver_moves_to_the_caller(
    client: AsyncClient, db_session: AsyncSession,
):
    first = await _driver(db_session)
    second = await _driver(db_session)
    await client.post(
        _URL, json={"token": "shared-device", "platform": "ios"},
        headers=auth_header(make_token(sub=str(first.id), role="driver")),
    )

    response = await client.post(
        _URL, json={"token": "shared-device", "platform": "ios"},
        headers=auth_header(make_token(sub=str(second.id), role="driver")),
    )

    assert response.status_code == 204
    rows = await _tokens(db_session)
    assert [row.driver_id for row in rows] == [second.id]


async def test_register_push_token_without_auth_is_refused(client: AsyncClient, db_session: AsyncSession):
    response = await client.post(_URL, json={"token": "fcm-1", "platform": "android"})

    assert response.status_code in (401, 403)
    assert await _tokens(db_session) == []


async def test_register_push_token_expired_token_returns_401(client: AsyncClient, db_session: AsyncSession):
    driver = await _driver(db_session)
    token = make_token(sub=str(driver.id), role="driver", expires_in=-1)

    response = await client.post(_URL, json={"token": "fcm-1", "platform": "android"}, headers=auth_header(token))

    assert response.status_code == 401


async def test_register_push_token_dispatcher_returns_403(client: AsyncClient, db_session: AsyncSession):
    token = make_token(role="dispatcher")

    response = await client.post(_URL, json={"token": "fcm-1", "platform": "android"}, headers=auth_header(token))

    assert response.status_code == 403


async def test_register_push_token_bad_platform_returns_422(client: AsyncClient, db_session: AsyncSession):
    driver = await _driver(db_session)
    token = make_token(sub=str(driver.id), role="driver")

    response = await client.post(_URL, json={"token": "fcm-1", "platform": "web"}, headers=auth_header(token))

    assert response.status_code == 422
    assert await _tokens(db_session) == []
