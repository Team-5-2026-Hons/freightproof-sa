"""Integration tests for GET /api/v1/vehicles."""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.db.models.organisations import Organization
from app.db.models.vehicles import Vehicle
from app.db.models.enums import OrganizationType, VehicleType
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
async def seed_vehicles(db_session: AsyncSession, seed_org):
    horse = Vehicle(
        organization_id=_DEMO_ORG_ID,
        registration="CA 123-456",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-HORSE-001",
    )
    trailer = Vehicle(
        organization_id=_DEMO_ORG_ID,
        registration="CA 789-012",
        vehicle_type=VehicleType.TRAILER,
        pulsit_device_id="PLT-TRAILER-001",
    )
    db_session.add_all([horse, trailer])
    await db_session.flush()


async def test_list_vehicles_empty_returns_200(seed_org):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/vehicles",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_vehicles_returns_horses_and_trailers(seed_vehicles):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/vehicles",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 2
    types = {v["vehicle_type"] for v in body}
    assert types == {"horse", "trailer"}


async def test_list_vehicles_excludes_inactive(db_session, seed_org):
    inactive = Vehicle(
        organization_id=_DEMO_ORG_ID,
        registration="CA 000-000",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-INACTIVE",
        is_active=False,
    )
    db_session.add(inactive)
    await db_session.flush()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/vehicles",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.json() == []


async def test_create_vehicle_returns_201(seed_org):
    payload = {
        "registration": "CA 555-NEW",
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-HORSE-NEW",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["registration"] == "CA 555-NEW"
    assert body["vehicle_type"] == "horse"
    assert body["pulsit_device_id"] == "PLT-HORSE-NEW"
    assert "id" in body


async def test_create_vehicle_invalid_type_returns_422(seed_org):
    payload = {
        "registration": "CA 999-BAD",
        "vehicle_type": "submarine",
        "pulsit_device_id": "PLT-SUB",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_create_vehicle_appears_in_subsequent_list(seed_org):
    payload = {
        "registration": "WC 555-TEST",
        "vehicle_type": "trailer",
        "pulsit_device_id": "PLT-TRAILER-NEW",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        create_resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )
        assert create_resp.status_code == 201

        list_resp = await client.get(
            "/api/v1/vehicles",
            headers={"Authorization": "Bearer demo"},
        )

    regs = [v["registration"] for v in list_resp.json()]
    assert "WC 555-TEST" in regs
