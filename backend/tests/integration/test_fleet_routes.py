"""Integration contract for GET /api/v1/analytics/fleet/routes (fleet analytics spec §5.6).

Charts 1.6 (busiest sites), 2.4 (driving time per lane) and 6.3 (lane risk) over one seeded
fortnight. Precincts O and D (and X) belong to the CLIENT and are not shared, so naming them
proves the by-id-only lookup (spec G16).
  T1 day 1, loaded O->D, drives 300 min. A mechanical problem and a dispatcher note (not counted).
  T2 day 3, loaded O->D, drives 420 min. A seal mismatch.
  T3 day 4, EMPTY run D->O, no loading step: its unloading at O is not a delivery. Drives 300.
  T4 day 9, loaded O->X, loading overridden (not a pickup), unloading at X a delivery. Drives 300.
  T5 open O->D, and another operator's O->D trip: never counted.
"""

import uuid
from collections.abc import AsyncIterator
from datetime import date, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import ExceptionSeverity, ExceptionType, PhaseStatus, PhaseType, TripStatus, TripType
from app.db.models.organisations import Precinct
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token
from tests.integration._fleet_seed import (
    SINGLE_LEG,
    Operator,
    add_exception,
    at_sast,
    headers,
    operator_from_seed,
    other_operator,
    replace_step,
    seed_trip,
    today_sast,
)

_ROUTES = "/api/v1/analytics/fleet/routes"
_WEEKS_BACK = 4


def _week0() -> date:
    today = today_sast()
    return today - timedelta(days=today.weekday(), weeks=_WEEKS_BACK)


def _day(offset: int) -> date:
    return _week0() + timedelta(days=offset)


def _params() -> dict[str, str]:
    return {"start": _day(0).isoformat(), "end": _day(13).isoformat()}


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def operator(seed: dict[str, Any]) -> Operator:
    return operator_from_seed(seed)


@pytest_asyncio.fixture
async def depots(db_session: AsyncSession, seed: dict[str, Any]) -> dict[str, Precinct]:
    """O and D from the shared seed (client-owned), plus a third client depot X."""
    third = Precinct(
        id=uuid.uuid4(), name="X", principal_organization_id=seed["client_org"].id,
        latitude="2", longitude="2", is_shared=False,
    )
    db_session.add(third)
    await db_session.flush()
    return {"O": seed["origin"], "D": seed["dest"], "X": third}


async def _seed_fortnight(db: AsyncSession, operator: Operator, depots: dict[str, Precinct]) -> None:
    o, d, x = depots["O"], depots["D"], depots["X"]
    t1 = await seed_trip(db, operator, stops=[o, d], start=at_sast(_day(1), 6))
    await add_exception(db, t1.trip, exception_type=ExceptionType.MECHANICAL, severity=ExceptionSeverity.WARNING, created_at=at_sast(_day(1), 9))
    await add_exception(db, t1.trip, exception_type=ExceptionType.DISPATCHER_NOTE, severity=ExceptionSeverity.INFO, created_at=at_sast(_day(1), 10))
    slow = replace_step(SINGLE_LEG, PhaseType.IN_TRANSIT, minute=520)
    slow = replace_step(slow, PhaseType.UNLOADING, minute=560)
    slow = replace_step(slow, PhaseType.CONFIRMATION, minute=580)
    t2 = await seed_trip(db, operator, stops=[o, d], start=at_sast(_day(3), 6), steps=slow)
    await add_exception(db, t2.trip, exception_type=ExceptionType.SEAL_MISMATCH, severity=ExceptionSeverity.CRITICAL, created_at=at_sast(_day(3), 9))
    empty_run = tuple(step for step in SINGLE_LEG if step.phase_type != PhaseType.LOADING)
    await seed_trip(db, operator, stops=[d, o], start=at_sast(_day(4), 6), trip_type=TripType.EMPTY_LEG, steps=empty_run)
    no_pickup = replace_step(SINGLE_LEG, PhaseType.LOADING, status=PhaseStatus.OVERRIDDEN)
    await seed_trip(db, operator, stops=[o, x], start=at_sast(_day(9), 6), steps=no_pickup)
    await seed_trip(db, operator, stops=[o, d], start=at_sast(_day(5), 6), status=TripStatus.ACTIVE)
    other = await other_operator(db)
    await seed_trip(db, other, stops=[o, d], start=at_sast(_day(2), 6))


# ── Auth and 422 ─────────────────────────────────────────────────────────────


async def test_fleet_routes_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_ROUTES, params=_params())

    assert response.status_code == 403


async def test_fleet_routes_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.get(_ROUTES, params=_params(), headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_fleet_routes_with_driver_token_returns_403(client: AsyncClient, operator: Operator) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(_ROUTES, params=_params(), headers=auth_header(token))

    assert response.status_code == 403


async def test_fleet_routes_rejects_a_start_after_the_end(client: AsyncClient, operator: Operator) -> None:
    params = {"start": _day(5).isoformat(), "end": _day(4).isoformat()}

    response = await client.get(_ROUTES, params=params, headers=headers(operator))

    assert response.status_code == 422


# ── 200 ──────────────────────────────────────────────────────────────────────


async def test_fleet_routes_for_an_org_without_trips_are_empty(client: AsyncClient, operator: Operator) -> None:
    response = await client.get(_ROUTES, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert (body["sites"], body["lanes"], body["period"]["grain"]) == ([], [], None)


async def test_fleet_routes_sites_count_pickups_and_loaded_deliveries(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, depots: dict[str, Precinct],
) -> None:
    await _seed_fortnight(db_session, operator, depots)

    response = await client.get(_ROUTES, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    # D and O tie on 2 and go by name; T3's unloading at O (empty run) and T4's overridden
    # loading at O count for nothing. Client-owned, unshared precincts are still named.
    assert [
        (row["precinct_name"], row["pickup_count"], row["delivery_count"]) for row in response.json()["sites"]
    ] == [("D", 0, 2), ("O", 2, 0), ("X", 0, 1)]


async def test_fleet_routes_lanes_pool_driving_time_and_count_problems_without_notes(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, depots: dict[str, Precinct],
) -> None:
    await _seed_fortnight(db_session, operator, depots)

    response = await client.get(_ROUTES, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    lanes = response.json()["lanes"]
    assert [(lane["origin_name"], lane["destination_name"], lane["trip_count"]) for lane in lanes] == [
        ("O", "D", 2), ("D", "O", 1), ("O", "X", 1),
    ]
    busiest = lanes[0]
    minutes = busiest["driving_minutes"]
    assert minutes["sample_count"] == 2
    # Pooled [300, 420]: median 360; P90 = 300 + 0.9 * 120 = 408.
    assert (minutes["median"], minutes["p90"]) == pytest.approx((360, 408))
    assert (busiest["problem_count"], busiest["problems_per_trip"]) == (2, pytest.approx(1.0))
    assert [lane["problem_count"] for lane in lanes[1:]] == [0, 0]
