"""Integration contract for GET /api/v1/analytics/fleet/cost (FP-294).

Round-number rates so every figure is checkable by hand: diesel R20/L × 10 L/100 km = R2/km,
running R3/km, driver R100/h, delay R600/h, fixed R50/trip, road factor 1.00. ORS is
replaced with a fake that measures every leg at exactly 100 km, and Redis with a fake, so
the real routing service is never called.

Precincts O, D (shared seed) and X. One seeded fortnight, weekly buckets:
  T1 week 0, O->D, on time, 5 h driving. MECHANICAL + SEAL_UNVERIFIED (a problem, not theft).
       100 km → fuel 200 + running 300 + driver 500 + fixed 50 = R1,050.
  T2 week 0, O->D, 2 h late (7 h driving). SEAL_MISMATCH, not reviewed. Consignments R40,000
       and one with no declared value. → R1,250; delay 2 h × R600 = R1,200; R40,000 under review.
  T3 week 0, O->D, 2 h late, only a DISPATCHER_NOTE: not a problem trip, so no delay cost. R1,250.
  T4 week 1, O->X->D (two legs, 200 km), on time. PANIC_BUTTON reviewed, no consignments.
       → fuel 400 + running 600 + driver 500 + fixed 50 = R1,550.
  T5 week 1, D->O, final arrival overridden (no arrival time): not costed. MECHANICAL → lateness unknown.
  T6 open O->D with a seal mismatch, and another operator's trip: never counted.
"""

import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.cost_model import DEFAULT_COST_RATES
from app.db.models.cost import CostProfile
from app.db.models.enums import (
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionType,
    PhaseStatus,
    PhaseType,
    TripStatus,
)
from app.db.models.organisations import Precinct
from app.db.models.trips import Consignment, Trip
from app.db.session import get_db
from app.integrations.routing import PlannedRoute, RouteLeg, RoutePoint, RoutingNotConfiguredError
from app.main import app
from app.orchestration.analytics import lane_distance
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

_COST = "/api/v1/analytics/fleet/cost"
_WEEKS_BACK = 4
_LEG_METRES = 100_000.0


def _week0() -> date:
    today = today_sast()
    return today - timedelta(days=today.weekday(), weeks=_WEEKS_BACK)


def _day(offset: int) -> date:
    return _week0() + timedelta(days=offset)


def _params(**overrides: str) -> dict[str, str]:
    return {"start": _day(0).isoformat(), "end": _day(13).isoformat(), "grain": "week", **overrides}


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}

    async def mget(self, keys: Sequence[str]) -> list[bytes | None]:
        return [self.store.get(key) for key in keys]

    async def set(self, key: str, value: str, ex: int) -> None:
        self.store[key] = value.encode()


class _FakeOrs:
    def __init__(self) -> None:
        self.calls = 0
        self.configured = True

    async def __call__(self, points: Sequence[RoutePoint]) -> PlannedRoute:
        self.calls += 1
        if not self.configured:
            raise RoutingNotConfiguredError("no key")
        return PlannedRoute(legs=(RouteLeg(distance_metres=_LEG_METRES, duration_seconds=1.0, coordinates=()),))


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def ors(monkeypatch: pytest.MonkeyPatch) -> _FakeOrs:
    """Autouse: no test here may reach the real ORS or Redis, whatever .env holds."""
    fake = _FakeOrs()
    monkeypatch.setattr(lane_distance, "compute_truck_route", fake)
    monkeypatch.setattr(lane_distance, "get_redis", _FakeRedis)
    monkeypatch.setattr(lane_distance.settings, "ORS_API_KEY", "test-key")
    return fake


@pytest.fixture
def operator(seed: dict[str, Any]) -> Operator:
    return operator_from_seed(seed)


@pytest_asyncio.fixture
async def depots(db_session: AsyncSession, seed: dict[str, Any]) -> dict[str, Precinct]:
    third = Precinct(
        id=uuid.uuid4(), name="X", principal_organization_id=seed["client_org"].id,
        latitude="2", longitude="2", is_shared=False,
    )
    db_session.add(third)
    await db_session.flush()
    return {"O": seed["origin"], "D": seed["dest"], "X": third}


async def _round_rates(db: AsyncSession, operator: Operator) -> None:
    db.add(CostProfile(
        operator_organization_id=operator.org.id,
        diesel_price_per_litre=Decimal("20"), litres_per_100km=Decimal("10"),
        running_cost_per_km=Decimal("3"), driver_cost_per_hour=Decimal("100"),
        delay_cost_per_hour=Decimal("600"), fixed_cost_per_trip=Decimal("50"),
        road_factor=Decimal("1.00"), updated_by_user_id=operator.dispatcher.id,
    ))
    await db.flush()


async def _add_consignment(db: AsyncSession, trip: Trip, value: str | None) -> None:
    db.add(Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=f"WB-{uuid.uuid4().hex[:8]}",
        declared_value=None if value is None else Decimal(value),
    ))
    await db.flush()


def _late(steps: Sequence[Any] = SINGLE_LEG) -> tuple[Any, ...]:
    """Arrive at minute 520 instead of 400: two hours after the planned arrival."""
    late = replace_step(steps, PhaseType.IN_TRANSIT, minute=520)
    late = replace_step(late, PhaseType.UNLOADING, minute=560)
    return replace_step(late, PhaseType.CONFIRMATION, minute=580)


async def _seed_fortnight(db: AsyncSession, operator: Operator, depots: dict[str, Precinct]) -> None:
    o, d, x = depots["O"], depots["D"], depots["X"]
    t1 = await seed_trip(db, operator, stops=[o, d], start=at_sast(_day(1), 6))
    await add_exception(db, t1.trip, exception_type=ExceptionType.MECHANICAL, severity=ExceptionSeverity.WARNING, created_at=at_sast(_day(1), 9))
    await add_exception(db, t1.trip, exception_type=ExceptionType.SEAL_UNVERIFIED, severity=ExceptionSeverity.WARNING, created_at=at_sast(_day(1), 9))

    t2 = await seed_trip(db, operator, stops=[o, d], start=at_sast(_day(3), 6), steps=_late())
    await add_exception(db, t2.trip, exception_type=ExceptionType.SEAL_MISMATCH, severity=ExceptionSeverity.CRITICAL, created_at=at_sast(_day(3), 9))
    await _add_consignment(db, t2.trip, "40000")
    await _add_consignment(db, t2.trip, None)

    t3 = await seed_trip(db, operator, stops=[o, d], start=at_sast(_day(4), 6), steps=_late())
    await add_exception(db, t3.trip, exception_type=ExceptionType.DISPATCHER_NOTE, severity=ExceptionSeverity.INFO, created_at=at_sast(_day(4), 9))

    t4 = await seed_trip(db, operator, stops=[o, x, d], start=at_sast(_day(8), 6))
    await add_exception(
        db, t4.trip, exception_type=ExceptionType.PANIC_BUTTON, severity=ExceptionSeverity.CRITICAL,
        created_at=at_sast(_day(8), 9), review_status=ExceptionReviewStatus.REVIEWED,
    )

    no_arrival = replace_step(SINGLE_LEG, PhaseType.IN_TRANSIT, status=PhaseStatus.OVERRIDDEN)
    t5 = await seed_trip(db, operator, stops=[d, o], start=at_sast(_day(9), 6), steps=no_arrival)
    await add_exception(db, t5.trip, exception_type=ExceptionType.MECHANICAL, severity=ExceptionSeverity.WARNING, created_at=at_sast(_day(9), 9))

    t6 = await seed_trip(db, operator, stops=[o, d], start=at_sast(_day(5), 6), status=TripStatus.ACTIVE)
    await add_exception(db, t6.trip, exception_type=ExceptionType.SEAL_MISMATCH, severity=ExceptionSeverity.CRITICAL, created_at=at_sast(_day(5), 9))
    other = await other_operator(db)
    await seed_trip(db, other, stops=[o, d], start=at_sast(_day(2), 6))


@pytest_asyncio.fixture
async def fortnight(db_session: AsyncSession, operator: Operator, depots: dict[str, Precinct]) -> dict[str, Any]:
    await _round_rates(db_session, operator)
    await _seed_fortnight(db_session, operator, depots)
    return depots


# ── Auth and 422 ─────────────────────────────────────────────────────────────


async def test_fleet_cost_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_COST, params=_params())

    assert response.status_code == 403


async def test_fleet_cost_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.get(_COST, params=_params(), headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_fleet_cost_with_driver_token_returns_403(client: AsyncClient, operator: Operator) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(_COST, params=_params(), headers=auth_header(token))

    assert response.status_code == 403


async def test_fleet_cost_without_grain_returns_422(client: AsyncClient, operator: Operator) -> None:
    params = {"start": _day(0).isoformat(), "end": _day(13).isoformat()}

    response = await client.get(_COST, params=params, headers=headers(operator))

    assert response.status_code == 422


async def test_fleet_cost_ending_after_today_returns_422(client: AsyncClient, operator: Operator) -> None:
    tomorrow = (today_sast() + timedelta(days=1)).isoformat()

    response = await client.get(_COST, params=_params(end=tomorrow), headers=headers(operator))

    assert response.status_code == 422


# ── Figures ──────────────────────────────────────────────────────────────────


async def test_fleet_cost_operating_matches_hand_calculation(
    client: AsyncClient, operator: Operator, fortnight: dict[str, Any],
) -> None:
    response = await client.get(_COST, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    operating = response.json()["operating"]
    assert operating == {
        "fuel": 1000.0, "running": 1500.0, "driver": 2400.0, "fixed": 200.0, "total": 5100.0,
        "trips_costed": 4, "trips_not_costed": 1, "distance_km": 500.0,
        "legs_routed": 5, "legs_estimated": 0,
    }


async def test_fleet_cost_delay_counts_only_late_problem_trips(
    client: AsyncClient, operator: Operator, fortnight: dict[str, Any],
) -> None:
    response = await client.get(_COST, params=_params(), headers=headers(operator))

    assert response.json()["delay"] == {
        "cost": 1200.0, "late_hours": 2.0, "problem_trips": 4,
        "late_problem_trips": 1, "lateness_unknown": 1,
    }


async def test_fleet_cost_exposure_from_theft_signal_trips(
    client: AsyncClient, operator: Operator, fortnight: dict[str, Any],
) -> None:
    response = await client.get(_COST, params=_params(), headers=headers(operator))

    assert response.json()["exposure"] == {
        "under_review": 40000.0, "reviewed": 0.0, "total": 40000.0, "trips": 2,
        "consignments_without_value": 1, "trips_without_consignments": 1,
    }


async def test_fleet_cost_buckets_split_by_week_and_zero_filled(
    client: AsyncClient, operator: Operator, fortnight: dict[str, Any],
) -> None:
    response = await client.get(_COST, params=_params(), headers=headers(operator))

    week0, week1 = response.json()["buckets"]
    assert week0["start"] == _day(0).isoformat()
    assert (week0["fuel"], week0["running"], week0["driver"], week0["fixed"]) == (600.0, 900.0, 1900.0, 150.0)
    assert (week0["delay_cost"], week0["value_under_review"], week0["value_reviewed"]) == (1200.0, 40000.0, 0.0)
    assert (week1["fuel"], week1["running"], week1["driver"], week1["fixed"]) == (400.0, 600.0, 500.0, 50.0)
    assert week1["delay_cost"] == 0.0


async def test_fleet_cost_lanes_sorted_and_named(
    client: AsyncClient, operator: Operator, fortnight: dict[str, Any],
) -> None:
    response = await client.get(_COST, params=_params(), headers=headers(operator))

    first, second = response.json()["lanes"]
    assert (first["origin_name"], first["destination_name"]) == ("O", "D")
    assert (first["trip_count"], first["operating_total"], first["operating_per_trip"]) == (4, 5100.0, 1275.0)
    assert (first["delay_cost"], first["value_exposed"], first["distance_source"]) == (1200.0, 40000.0, "road")
    assert (second["origin_name"], second["destination_name"]) == ("D", "O")
    assert (second["trip_count"], second["operating_per_trip"]) == (1, None)


async def test_fleet_cost_sends_the_rates_it_used(
    client: AsyncClient, operator: Operator, fortnight: dict[str, Any],
) -> None:
    response = await client.get(_COST, params=_params(), headers=headers(operator))

    rates = response.json()["rates"]
    assert rates["is_default"] is False
    assert rates["fuel_per_km"] == 2.0
    assert rates["delay_cost_per_hour"] == 600.0


async def test_fleet_cost_without_routing_uses_straight_line_estimate(
    client: AsyncClient, operator: Operator, fortnight: dict[str, Any], ors: _FakeOrs,
) -> None:
    ors.configured = False

    response = await client.get(_COST, params=_params(), headers=headers(operator))

    operating = response.json()["operating"]
    assert (operating["legs_routed"], operating["legs_estimated"]) == (0, 5)
    # Straight line between (0,0) and (1,1) is ~157 km, so not the routed 100 km.
    assert operating["distance_km"] != 500.0
    assert response.json()["lanes"][0]["distance_source"] == "estimate"


async def test_fleet_cost_without_saved_rates_uses_defaults(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, depots: dict[str, Precinct],
) -> None:
    await seed_trip(db_session, operator, stops=[depots["O"], depots["D"]], start=at_sast(_day(1), 6))

    response = await client.get(_COST, params=_params(), headers=headers(operator))

    body = response.json()
    assert body["rates"]["is_default"] is True
    assert body["rates"]["diesel_price_per_litre"] == float(DEFAULT_COST_RATES.diesel_price_per_litre)
    # 100 km at the default per-km rates plus 5 h of driver time, no fixed cost.
    per_km = DEFAULT_COST_RATES.fuel_per_km + DEFAULT_COST_RATES.running_per_km
    expected = per_km * 100 + DEFAULT_COST_RATES.driver_per_hour * 5
    assert body["operating"]["total"] == pytest.approx(float(expected), abs=0.01)


async def test_fleet_cost_empty_period_is_all_zero(client: AsyncClient, operator: Operator) -> None:
    response = await client.get(_COST, params=_params(), headers=headers(operator))

    body = response.json()
    assert body["operating"]["total"] == 0.0
    assert body["operating"]["trips_costed"] == 0
    assert body["exposure"]["total"] == 0.0
    assert body["lanes"] == []
    assert len(body["buckets"]) == 2


async def test_fleet_cost_second_load_uses_cache_not_ors(
    client: AsyncClient, operator: Operator, fortnight: dict[str, Any], monkeypatch: pytest.MonkeyPatch, ors: _FakeOrs,
) -> None:
    shared = _FakeRedis()
    monkeypatch.setattr(lane_distance, "get_redis", lambda: shared)
    await client.get(_COST, params=_params(), headers=headers(operator))
    calls_after_first = ors.calls

    second = await client.get(_COST, params=_params(), headers=headers(operator))

    # Four distinct legs: O->D, O->X, X->D, and D->O (looked up even though its trip isn't costed).
    assert calls_after_first == 4
    assert ors.calls == calls_after_first
    assert second.json()["operating"]["legs_routed"] == 5
