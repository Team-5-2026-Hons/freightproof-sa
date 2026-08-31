"""Integration tests for GET /api/v1/drivers."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.db.models.organisations import Organization
from app.db.models.people import Driver, User
from app.db.models.enums import IdvsStatus, OrganizationType
from app.db.session import get_db

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def stub_driver_auth_user():
    """Never let this file provision a real Supabase Auth account.

    create_driver_auth_user makes a live HTTP call to the Supabase Admin API. Left
    unpatched, the FIRST run of a creation test here registered a real auth user against
    the shared project — and every run since got 422 back, which driver_service maps to a
    409 on a duplicate the test itself created. The tests passed exactly once and were
    permanently red afterwards.

    Autouse, and at module scope rather than inside the two tests that needed it, because
    the trap is silent: a new creation test added to this file inherits the same live call
    and the same one-shot lifetime, and nothing in the failure says so.
    """
    with patch(
        "app.orchestration.driver_service.create_driver_auth_user",
        new_callable=AsyncMock,
    ) as mock_auth:
        mock_auth.side_effect = lambda **kwargs: uuid.uuid4()
        yield mock_auth


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_org(db_session: AsyncSession):
    org = Organization(
        id=uuid.uuid4(),
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add(org)
    await db_session.flush()
    user = User(
        id=uuid.uuid4(),
        organization_id=org.id,
        email="demo-dispatcher@freightproof.co.za",
        full_name="Demo Dispatcher",
    )
    db_session.add(user)
    await db_session.flush()
    return org, user


@pytest_asyncio.fixture
async def seed_driver(db_session: AsyncSession, seed_org):
    org, _user = seed_org
    driver = Driver(
        organization_id=org.id,
        full_name="Sipho Dlamini",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-001",
        idvs_status=IdvsStatus.PENDING,
    )
    db_session.add(driver)
    await db_session.flush()
    return driver


async def test_list_drivers_empty_returns_200(client: AsyncClient, seed_org):
    org, user = seed_org

    resp = await client.get(
        "/api/v1/drivers",
        headers=auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id))),
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_drivers_returns_active_drivers(client: AsyncClient, seed_org, seed_driver):
    org, user = seed_org

    resp = await client.get(
        "/api/v1/drivers",
        headers=auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id))),
    )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 1
    assert body[0]["full_name"] == "Sipho Dlamini"
    assert body[0]["organization_id"] == str(org.id)
    assert body[0]["idvs_status"] == "pending"


async def test_list_drivers_excludes_inactive(client: AsyncClient, db_session, seed_org):
    org, user = seed_org
    inactive = Driver(
        organization_id=org.id,
        full_name="Inactive Driver",
        id_number="9001015009089",
        phone_number="+27829999999",
        license_number="DRV-999",
        idvs_status=IdvsStatus.PENDING,
        is_active=False,
    )
    db_session.add(inactive)
    await db_session.flush()

    resp = await client.get(
        "/api/v1/drivers",
        headers=auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id))),
    )
    assert resp.json() == []


async def test_create_driver_returns_201_with_pending_status(client: AsyncClient, seed_org):
    org, user = seed_org
    payload = {
        "full_name": "Thabo Nkosi",
        "id_number": "9001015009081",
        "phone_number": "+27829999999",
        "license_number": "DRV-002",
    }
    resp = await client.post(
        "/api/v1/drivers",
        json=payload,
        headers=auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id))),
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["full_name"] == "Thabo Nkosi"
    assert body["id_number"] == "9001015009081"
    assert body["idvs_status"] == "pending"
    assert "id" in body
    assert "created_at" in body


async def test_create_driver_invalid_id_number_returns_422(client: AsyncClient, seed_org):
    org, user = seed_org
    payload = {
        "full_name": "Bad Driver",
        "id_number": "123",
        "phone_number": "+27821234567",
        "license_number": "DRV-BAD",
    }
    resp = await client.post(
        "/api/v1/drivers",
        json=payload,
        headers=auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id))),
    )

    assert resp.status_code == 422


async def test_create_driver_appears_in_subsequent_list(client: AsyncClient, seed_org):
    org, user = seed_org
    payload = {
        "full_name": "Lerato Mokoena",
        "id_number": "8501015009085",
        "phone_number": "+27831111111",
        "license_number": "DRV-003",
    }
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))

    create_resp = await client.post(
        "/api/v1/drivers",
        json=payload,
        headers=headers,
    )
    assert create_resp.status_code == 201

    list_resp = await client.get(
        "/api/v1/drivers",
        headers=headers,
    )

    names = [d["full_name"] for d in list_resp.json()]
    assert "Lerato Mokoena" in names
