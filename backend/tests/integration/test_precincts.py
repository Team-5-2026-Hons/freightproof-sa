"""Integration tests for GET /api/v1/precincts."""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.db.models.organisations import Organization, Precinct
from app.db.models.enums import OrganizationType
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
async def seed_orgs(db_session: AsyncSession):
    operator_org = Organization(
        id=_DEMO_ORG_ID,
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    client_org = Organization(
        name="Demo Client",
        org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([operator_org, client_org])
    await db_session.flush()
    return {"client_org": client_org}


@pytest_asyncio.fixture
async def seed_precincts(db_session: AsyncSession, seed_orgs):
    client_org = seed_orgs["client_org"]
    origin = Precinct(
        name="Cape Town Depot",
        principal_organization_id=client_org.id,
        latitude="33.9249",
        longitude="18.4241",
    )
    destination = Precinct(
        name="Johannesburg Depot",
        principal_organization_id=client_org.id,
        latitude="26.2041",
        longitude="28.0473",
    )
    db_session.add_all([origin, destination])
    await db_session.flush()


async def test_list_precincts_empty_returns_200(seed_orgs):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/precincts",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_precincts_returns_all(seed_precincts):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/precincts",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 2
    names = {p["name"] for p in body}
    assert names == {"Cape Town Depot", "Johannesburg Depot"}
