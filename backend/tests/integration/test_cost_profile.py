"""Integration tests for GET/PATCH /api/v1/analytics/cost-profile (FP-294)."""

import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.cost_model import DEFAULT_COST_RATES
from app.db.models.cost import CostProfile
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.session import get_db
from app.main import app
from tests.conftest import auth_header, make_token

_PATH = "/api/v1/analytics/cost-profile"
_ADMIN = "admin_dispatcher"
_DISPATCHER = "dispatcher"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def _seed_org_user(db: AsyncSession, *, name: str) -> tuple[Organization, User]:
    org = Organization(id=uuid.uuid4(), name=f"Operator {uuid.uuid4().hex[:6]}", org_type=OrganizationType.OPERATOR)
    db.add(org)
    await db.flush()
    user = User(
        id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4().hex[:8]}@test.co.za",
        full_name=name, is_active=True,
    )
    db.add(user)
    await db.flush()
    return org, user


@pytest_asyncio.fixture
async def operator(db_session: AsyncSession) -> tuple[Organization, User]:
    return await _seed_org_user(db_session, name="Tom Admin")


def _headers(org: Organization, user: User, role: str) -> dict[str, str]:
    return auth_header(make_token(sub=str(user.id), role=role, org_id=str(org.id)))


async def _rows(db: AsyncSession, org: Organization) -> list[CostProfile]:
    result = await db.execute(
        select(CostProfile)
        .where(CostProfile.operator_organization_id == org.id)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


async def test_get_cost_profile_without_row_returns_defaults(client: AsyncClient, operator) -> None:
    org, user = operator

    response = await client.get(_PATH, headers=_headers(org, user, _DISPATCHER))

    assert response.status_code == 200
    body = response.json()
    assert body["is_default"] is True
    assert body["updated_at"] is None
    assert body["updated_by_name"] is None
    assert body["diesel_price_per_litre"] == float(DEFAULT_COST_RATES.diesel_price_per_litre)
    assert body["delay_cost_per_hour"] == float(DEFAULT_COST_RATES.delay_per_hour)
    assert body["fuel_per_km"] == pytest.approx(float(DEFAULT_COST_RATES.fuel_per_km))


async def test_patch_cost_profile_as_admin_saves_row(client: AsyncClient, db_session: AsyncSession, operator) -> None:
    org, user = operator

    response = await client.patch(_PATH, json={"diesel_price_per_litre": 34.5}, headers=_headers(org, user, _ADMIN))

    assert response.status_code == 200
    body = response.json()
    assert body["diesel_price_per_litre"] == 34.5
    assert body["is_default"] is False
    assert body["updated_by_name"] == "Tom Admin"
    rows = await _rows(db_session, org)
    assert len(rows) == 1
    assert rows[0].diesel_price_per_litre == Decimal("34.50")
    assert rows[0].updated_by_user_id == user.id
    # Fields not sent were filled from the starting rates.
    assert rows[0].delay_cost_per_hour == DEFAULT_COST_RATES.delay_per_hour


async def test_patch_then_get_returns_new_values(client: AsyncClient, operator) -> None:
    org, user = operator
    await client.patch(_PATH, json={"litres_per_100km": 48.5}, headers=_headers(org, user, _ADMIN))

    response = await client.get(_PATH, headers=_headers(org, user, _DISPATCHER))

    body = response.json()
    assert body["litres_per_100km"] == 48.5
    assert body["fuel_per_km"] == pytest.approx(float(DEFAULT_COST_RATES.diesel_price_per_litre) * 48.5 / 100)


async def test_second_patch_updates_same_row_and_keeps_other_fields(
    client: AsyncClient, db_session: AsyncSession, operator,
) -> None:
    org, user = operator
    headers = _headers(org, user, _ADMIN)
    await client.patch(_PATH, json={"diesel_price_per_litre": 34.5}, headers=headers)

    response = await client.patch(_PATH, json={"delay_cost_per_hour": 900}, headers=headers)

    assert response.status_code == 200
    rows = await _rows(db_session, org)
    assert len(rows) == 1
    assert rows[0].diesel_price_per_litre == Decimal("34.50")
    assert rows[0].delay_cost_per_hour == Decimal("900.00")


async def test_patch_cost_profile_as_dispatcher_returns_403(
    client: AsyncClient, db_session: AsyncSession, operator,
) -> None:
    org, user = operator

    response = await client.patch(_PATH, json={"diesel_price_per_litre": 1}, headers=_headers(org, user, _DISPATCHER))

    assert response.status_code == 403
    assert await _rows(db_session, org) == []


@pytest.mark.parametrize("method", ["GET", "PATCH"])
async def test_cost_profile_without_token_returns_403(client: AsyncClient, method: str) -> None:
    # The house convention (see test_fleet_on_time.py): no bearer header is 403, a bad token 401.
    response = await client.request(method, _PATH, json={"road_factor": 1.2})

    assert response.status_code == 403


@pytest.mark.parametrize("method", ["GET", "PATCH"])
async def test_cost_profile_with_malformed_token_returns_401(client: AsyncClient, method: str) -> None:
    response = await client.request(method, _PATH, json={"road_factor": 1.2}, headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_cost_profile_as_driver_returns_403(client: AsyncClient, operator) -> None:
    org, user = operator

    response = await client.get(_PATH, headers=_headers(org, user, "driver"))

    assert response.status_code == 403


@pytest.mark.parametrize(
    "body",
    [
        {"diesel_price_per_litre": -1},
        {"road_factor": 0.9},
        {"road_factor": 2.5},
        {"litres_per_100km": 0},
        {"litres_per_100km": 250},
        {"driver_cost_per_hour": 2_000_000},
        {"diesel_price_per_litre": 33.299},
        {},
        {"road_factor": None},
        {"unknown_rate": 5},
    ],
)
async def test_patch_cost_profile_invalid_body_returns_422(
    client: AsyncClient, db_session: AsyncSession, operator, body: dict[str, object],
) -> None:
    org, user = operator

    response = await client.patch(_PATH, json=body, headers=_headers(org, user, _ADMIN))

    assert response.status_code == 422
    assert await _rows(db_session, org) == []


async def test_cost_profile_is_scoped_to_callers_organisation(
    client: AsyncClient, db_session: AsyncSession, operator,
) -> None:
    org, user = operator
    other_org, other_user = await _seed_org_user(db_session, name="Other Admin")
    await client.patch(_PATH, json={"delay_cost_per_hour": 50}, headers=_headers(other_org, other_user, _ADMIN))

    mine = await client.get(_PATH, headers=_headers(org, user, _DISPATCHER))
    await client.patch(_PATH, json={"delay_cost_per_hour": 700}, headers=_headers(org, user, _ADMIN))

    assert mine.json()["is_default"] is True
    other_rows = await _rows(db_session, other_org)
    assert other_rows[0].delay_cost_per_hour == Decimal("50.00")
    count = await db_session.execute(select(func.count()).select_from(CostProfile))
    assert count.scalar_one() == 2
