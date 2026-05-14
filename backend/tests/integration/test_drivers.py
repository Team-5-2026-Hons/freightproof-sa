"""Integration tests for GET /api/v1/drivers."""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.db.models.organisations import Organization
from app.db.models.people import Driver
from app.db.models.enums import IdvsStatus, OrganizationType
from app.auth.dependencies import _DEMO_ORG_ID
from app.db.session import get_db


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
        id=_DEMO_ORG_ID,
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add(org)
    await db_session.flush()


@pytest_asyncio.fixture
async def seed_driver(db_session: AsyncSession, seed_org):
    driver = Driver(
        organization_id=_DEMO_ORG_ID,
        full_name="Sipho Dlamini",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-001",
        idvs_status=IdvsStatus.PENDING,
    )
    db_session.add(driver)
    await db_session.flush()
    return driver


async def test_list_drivers_empty_returns_200(seed_org):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/drivers",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_drivers_returns_active_drivers(seed_driver):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/drivers",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 1
    assert body[0]["full_name"] == "Sipho Dlamini"
    assert body[0]["organization_id"] == str(_DEMO_ORG_ID)
    assert body[0]["idvs_status"] == "pending"


async def test_list_drivers_excludes_inactive(db_session, seed_org):
    inactive = Driver(
        organization_id=_DEMO_ORG_ID,
        full_name="Inactive Driver",
        id_number="9001015009089",
        phone_number="+27829999999",
        license_number="DRV-999",
        idvs_status=IdvsStatus.PENDING,
        is_active=False,
    )
    db_session.add(inactive)
    await db_session.flush()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/drivers",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.json() == []
