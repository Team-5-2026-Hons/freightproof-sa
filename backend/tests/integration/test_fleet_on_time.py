"""Integration contract for GET /api/v1/analytics/fleet/on-time (fleet analytics spec §5.2).

Charts 2.1 (on-time departures and arrivals), 2.2 (how late is late) and 2.5 (plans vs reality:
how far off plan, whole period), as reworked in D23 and D24. Every expected number is
hand-computed from the trips each test seeds. SINGLE_LEG departs 100 minutes after the trip's start and arrives at 400, so each trip's
plan below is chosen to land its delay on a known band.

The consistency test at the end loads the FP-153 views (as test_analytics_endpoints.py does) and
proves the fleet on-time counts equal the sums of the driver analytics for the same month.
"""

import importlib.util
from collections.abc import AsyncIterator
from datetime import date, timedelta
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.organisations import Precinct
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token
from tests.integration._fleet_seed import (
    Operator,
    at_sast,
    headers,
    new_driver,
    operator_from_seed,
    other_operator,
    seed_trip,
    today_sast,
)

_ON_TIME = "/api/v1/analytics/fleet/on-time"
_DRIVERS = "/api/v1/analytics/drivers"
_WEEKS_BACK = 4
_BANDS = ["early", "on_time", "late_1_15", "late_15_60", "late_60_180", "late_over_180"]
_PLAN_BANDS = [
    "early_over_180", "early_60_180", "early_15_60", "early_0_15", "on_plan",
    "over_0_15", "over_15_60", "over_60_180", "over_over_180",
]
_MONTHS_BACK = 3
_MONTHS_PER_YEAR = 12

_MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations" / "versions"
_VIEW_MIGRATIONS = (
    ("2026_09_12_tom_analytics_read_models.py", "tom_analytics_read_models"),
    ("2026_09_12_tom_trailer_vehicle_analytics.py", "tom_trailer_vehicle_analytics"),
    ("2026_09_13_tom_live_analytics_views.py", "tom_live_analytics_views"),
)


def _load_migration(filename: str, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, _MIGRATIONS / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load migration {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _week0() -> date:
    today = today_sast()
    return today - timedelta(days=today.weekday(), weeks=_WEEKS_BACK)


def _day(offset: int) -> date:
    return _week0() + timedelta(days=offset)


def _params(grain: str = "week") -> dict[str, str]:
    """Two whole past weeks, Monday to Sunday."""
    return {"start": _day(0).isoformat(), "end": _day(13).isoformat(), "grain": grain}


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


@pytest.fixture
def stops(seed: dict[str, Any]) -> list[Precinct]:
    return [seed["origin"], seed["dest"]]


async def _seed_plans(db: AsyncSession, operator: Operator, stops: list[Precinct]) -> None:
    """Five closed trips. Each departs at +100 and arrives at +400 (300 min of driving):
         day  planned dep  planned arr   dep delay   arr delay   plan delta (300 - planned)
      A   1       100          400          0           0            0   on plan
      B   2        90          380        +10         +20          +10   over
      C   8       130          500        -30        -100          -70   under
      D   9       none         400         -            0            -   (no planned departure)
      E  10        20          100        +80        +300         +220   over
    Plus another operator's trip on day 1, which must never count."""
    for day, planned_departure, planned_arrival in ((1, 100, 400), (2, 90, 380), (8, 130, 500), (9, None, 400), (10, 20, 100)):
        await seed_trip(
            db, operator, stops=stops, start=at_sast(_day(day), 6),
            planned_departure_minute=planned_departure, planned_arrival_minute=planned_arrival,
        )
    other = await other_operator(db)
    await seed_trip(db, other, stops=stops, start=at_sast(_day(1), 6), planned_departure_minute=10)


# ── Auth and 422 ─────────────────────────────────────────────────────────────


async def test_fleet_on_time_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_ON_TIME, params=_params())

    assert response.status_code == 403


async def test_fleet_on_time_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.get(_ON_TIME, params=_params(), headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_fleet_on_time_with_driver_token_returns_403(client: AsyncClient, operator: Operator) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(_ON_TIME, params=_params(), headers=auth_header(token))

    assert response.status_code == 403


async def test_fleet_on_time_rejects_a_missing_grain(client: AsyncClient, operator: Operator) -> None:
    params = {key: value for key, value in _params().items() if key != "grain"}

    response = await client.get(_ON_TIME, params=params, headers=headers(operator))

    assert response.status_code == 422


async def test_fleet_on_time_rejects_an_end_after_today(client: AsyncClient, operator: Operator) -> None:
    params = {"end": (today_sast() + timedelta(days=1)).isoformat(), "grain": "week"}

    response = await client.get(_ON_TIME, params=params, headers=headers(operator))

    assert response.status_code == 422
    assert "after today" in response.json()["detail"]


# ── 200 ──────────────────────────────────────────────────────────────────────


async def test_fleet_on_time_for_an_org_without_trips_returns_empty_buckets(
    client: AsyncClient, operator: Operator,
) -> None:
    response = await client.get(_ON_TIME, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert [row["departures_with_plan"] for row in body["punctuality"]] == [0, 0]
    assert [row["on_time_departure_rate"] for row in body["punctuality"]] == [None, None]
    assert [bar["band"] for bar in body["lateness"]["departures"]] == _BANDS
    assert {bar["trip_count"] for bar in body["lateness"]["arrivals"]} == {0}
    assert "time_steps" not in body
    assert [band["band"] for band in body["plan_spread"]["bands"]] == _PLAN_BANDS
    assert body["plan_spread"]["median_over_minutes"] is None


async def test_fleet_on_time_punctuality_is_strict_and_per_departure_week(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_plans(db_session, operator, stops)

    response = await client.get(_ON_TIME, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    rows = response.json()["punctuality"]
    assert [
        (row["departures_with_plan"], row["on_time_departures"], row["arrivals_with_plan"], row["on_time_arrivals"])
        for row in rows
    ] == [(2, 1, 2, 1), (2, 1, 3, 2)]
    assert rows[1]["on_time_arrival_rate"] == pytest.approx(2 / 3)


async def test_fleet_on_time_lateness_bands_match_the_on_time_count(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_plans(db_session, operator, stops)

    response = await client.get(_ON_TIME, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    departures = {bar["band"]: bar["trip_count"] for bar in body["lateness"]["departures"]}
    arrivals = {bar["band"]: bar["trip_count"] for bar in body["lateness"]["arrivals"]}
    assert [departures[band] for band in _BANDS] == [1, 1, 1, 0, 1, 0]
    assert [arrivals[band] for band in _BANDS] == [1, 2, 0, 1, 0, 1]
    # The spec's invariant: Early + On time is exactly chart 2.1's on-time count.
    assert departures["early"] + departures["on_time"] == sum(row["on_time_departures"] for row in body["punctuality"])
    assert arrivals["early"] + arrivals["on_time"] == sum(row["on_time_arrivals"] for row in body["punctuality"])


async def test_fleet_on_time_plan_spread_bands_every_trip_with_a_full_plan(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_plans(db_session, operator, stops)

    response = await client.get(_ON_TIME, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    spread = response.json()["plan_spread"]
    bands = {band["band"]: band["trip_count"] for band in spread["bands"]}
    # A on plan, B +10 (0-15 over), C -70 (1-3 h early), E +220 (3 h+ over); D has no planned departure.
    assert {band: count for band, count in bands.items() if count} == {
        "on_plan": 1, "over_0_15": 1, "early_60_180": 1, "over_over_180": 1,
    }
    assert sum(bands.values()) == spread["early_count"] + spread["over_count"] + spread["on_plan_count"] == 4
    assert (spread["early_count"], spread["over_count"], spread["on_plan_count"]) == (1, 2, 1)
    # Positive minutes on both sides: median of [70] early, median of [10, 220] over.
    assert (spread["median_early_minutes"], spread["median_over_minutes"]) == pytest.approx((70, 115))


# ── Consistency with the driver pages (spec §8, risk R5) ─────────────────────


@pytest_asyncio.fixture
async def views(db_session: AsyncSession) -> None:
    for filename, name in _VIEW_MIGRATIONS:
        for statement in _load_migration(filename, name).UPGRADE_STATEMENTS:
            await db_session.execute(text(statement))


def _month_back(count: int) -> date:
    first = today_sast().replace(day=1)
    index = first.year * _MONTHS_PER_YEAR + first.month - 1 - count
    return date(index // _MONTHS_PER_YEAR, index % _MONTHS_PER_YEAR + 1, 1)


@pytest.mark.usefixtures("views")
async def test_fleet_on_time_matches_the_driver_analytics_for_the_same_month(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    month = _month_back(_MONTHS_BACK)
    last_day = _month_back(_MONTHS_BACK - 1) - timedelta(days=1)
    second_driver = new_driver(operator.org.id)
    db_session.add(second_driver)
    await db_session.flush()
    for day, planned_departure, driver in (
        (3, 100, None), (4, 90, None), (5, None, None), (6, 130, second_driver), (7, 20, second_driver),
    ):
        await seed_trip(
            db_session, operator, stops=stops, start=at_sast(month + timedelta(days=day), 6),
            planned_departure_minute=planned_departure, driver=driver,
        )
    headers_ = headers(operator)

    fleet = await client.get(
        _ON_TIME, params={"start": month.isoformat(), "end": last_day.isoformat(), "grain": "month"}, headers=headers_,
    )
    drivers = await client.get(
        _DRIVERS, params={"start_month": month.isoformat(), "end_month": month.isoformat()}, headers=headers_,
    )

    assert fleet.status_code == 200 and drivers.status_code == 200
    [bucket] = fleet.json()["punctuality"]
    driver_rows = drivers.json()
    assert bucket["departures_with_plan"] == sum(row["departures_with_plan_count"] for row in driver_rows) == 4
    assert bucket["on_time_departures"] == sum(row["on_time_departures_count"] for row in driver_rows) == 2
