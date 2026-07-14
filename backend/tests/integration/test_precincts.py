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
    """Two shared precincts owned by a different org than the demo dispatcher.

    is_shared=True is required for the demo dispatcher (operator org) to see
    precincts owned by client_org — mirrors how operators see client depots
    they've opted into sharing.
    """
    client_org = seed_orgs["client_org"]
    origin = Precinct(
        name="Cape Town Depot",
        principal_organization_id=client_org.id,
        latitude="33.9249",
        longitude="18.4241",
        is_shared=True,
    )
    destination = Precinct(
        name="Johannesburg Depot",
        principal_organization_id=client_org.id,
        latitude="26.2041",
        longitude="28.0473",
        is_shared=True,
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


async def test_list_precincts_returns_shared(seed_precincts):
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


async def test_list_precincts_excludes_other_org_non_shared(db_session: AsyncSession, seed_orgs):
    """A precinct owned by another org with is_shared=False must not be visible."""
    client_org = seed_orgs["client_org"]
    private_precinct = Precinct(
        name="Private Client Warehouse",
        principal_organization_id=client_org.id,
        latitude="29.8587",
        longitude="31.0218",
        is_shared=False,
    )
    db_session.add(private_precinct)
    await db_session.flush()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.get(
            "/api/v1/precincts",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert body == []


async def test_list_precincts_includes_own_org_non_shared(db_session: AsyncSession, seed_orgs):
    """A precinct owned by the caller's own org is always visible, shared or not."""
    own_precinct = Precinct(
        name="Demo Operator Yard",
        principal_organization_id=_DEMO_ORG_ID,
        latitude="-33.9249",
        longitude="18.4241",
        is_shared=False,
    )
    db_session.add(own_precinct)
    await db_session.flush()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.get(
            "/api/v1/precincts",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert [p["name"] for p in body] == ["Demo Operator Yard"]
