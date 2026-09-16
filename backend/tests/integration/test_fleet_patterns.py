"""Integration contract for GET /api/v1/analytics/fleet/patterns (fleet analytics spec §5.1, 1.3).

The period is two whole past weeks, Monday to Sunday, built from "now", so every weekday has
exactly two occurrences and every hour fourteen. Each expected number is hand-computed from the
steps each test seeds.
"""

from collections import Counter
from collections.abc import AsyncIterator
from datetime import date, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.organisations import Precinct
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token
from tests.integration._fleet_seed import (
    SINGLE_LEG,
    Operator,
    at_sast,
    days_ago,
    headers,
    operator_from_seed,
    other_operator,
    replace_step,
    seed_trip,
    start_for_departure,
    today_sast,
)

_PATTERNS = "/api/v1/analytics/fleet/patterns"
_WEEKS_BACK = 4
_PERIOD_DAYS = 14
_OCCURRENCES_PER_WEEKDAY = 2
_MONDAY, _WEDNESDAY, _THURSDAY, _SATURDAY = 0, 2, 3, 5


def _week0() -> date:
    today = today_sast()
    return today - timedelta(days=today.weekday(), weeks=_WEEKS_BACK)


def _day(offset: int) -> date:
    return _week0() + timedelta(days=offset)


def _period_params() -> dict[str, str]:
    return {"start": _day(0).isoformat(), "end": _day(_PERIOD_DAYS - 1).isoformat()}


def _events(bars: list[dict[str, Any]]) -> dict[int, int]:
    """Only the bars that had events: {key: event_count}."""
    return {bar["key"]: bar["event_count"] for bar in bars if bar["event_count"]}


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


# ── Auth and 422 ─────────────────────────────────────────────────────────────


async def test_fleet_patterns_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_PATTERNS, params=_period_params())

    assert response.status_code == 403


async def test_fleet_patterns_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.get(_PATTERNS, params=_period_params(), headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_fleet_patterns_with_driver_token_returns_403(
    client: AsyncClient, operator: Operator,
) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(_PATTERNS, params=_period_params(), headers=auth_header(token))

    assert response.status_code == 403


async def test_fleet_patterns_rejects_a_missing_end(client: AsyncClient, operator: Operator) -> None:
    response = await client.get(_PATTERNS, params={"start": _day(0).isoformat()}, headers=headers(operator))

    assert response.status_code == 422


async def test_fleet_patterns_rejects_an_end_after_today(
    client: AsyncClient, operator: Operator,
) -> None:
    params = {"end": (today_sast() + timedelta(days=1)).isoformat()}

    response = await client.get(_PATTERNS, params=params, headers=headers(operator))

    assert response.status_code == 422
    assert "after today" in response.json()["detail"]


async def test_fleet_patterns_have_no_bar_limit(client: AsyncClient, operator: Operator) -> None:
    today = today_sast()
    params = {"start": (today - timedelta(weeks=200)).isoformat(), "end": today.isoformat()}

    response = await client.get(_PATTERNS, params=params, headers=headers(operator))

    assert response.status_code == 200


# ── 200 ──────────────────────────────────────────────────────────────────────


async def test_fleet_patterns_for_an_org_without_trips_return_complete_empty_sets(
    client: AsyncClient, operator: Operator,
) -> None:
    response = await client.get(_PATTERNS, params=_period_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert body["period"] == {"start": _day(0).isoformat(), "end": _day(_PERIOD_DAYS - 1).isoformat(), "grain": None}
    for event_set in (body["departures"], body["arrivals"]):
        assert [bar["key"] for bar in event_set["hour_of_day"]] == list(range(24))
        assert [bar["key"] for bar in event_set["weekday"]] == list(range(7))
        assert [bar["key"] for bar in event_set["day_of_month"]] == list(range(1, 32))
        assert [bar["key"] for bar in event_set["month_of_year"]] == list(range(1, 13))
        assert {bar["day_count"] for bar in event_set["hour_of_day"]} == {_PERIOD_DAYS}
        assert {bar["average_per_day"] for bar in event_set["hour_of_day"]} == {0.0}


async def test_fleet_patterns_count_attested_steps_in_sast_per_occurrence(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    # SINGLE_LEG arrives 300 minutes (5 h) after it departs.
    departed_only = replace_step(SINGLE_LEG, PhaseType.IN_TRANSIT, status=PhaseStatus.PENDING)
    departed_only = replace_step(departed_only, PhaseType.UNLOADING, status=PhaseStatus.PENDING)
    departed_only = replace_step(departed_only, PhaseType.CONFIRMATION, status=PhaseStatus.PENDING)
    overridden = replace_step(SINGLE_LEG, PhaseType.DEPARTURE, status=PhaseStatus.OVERRIDDEN)
    cases = (
        # Monday 07:10 -> arrives 12:10.
        (at_sast(_day(0), 7, 10), TripStatus.CLOSED, SINGLE_LEG),
        # Wednesday 07:40, cancelled before arriving: a departure, no arrival.
        (at_sast(_day(2), 7, 40), TripStatus.CANCELLED, departed_only),
        # Thursday 09:00, departure overridden (not counted); arrival 14:00 attested (counted).
        (at_sast(_day(3), 9, 0), TripStatus.CLOSED, overridden),
        # Saturday 01:30 SAST is Friday 23:30 UTC: it must count as Saturday, hour 1.
        (at_sast(_day(5), 1, 30), TripStatus.CLOSED, SINGLE_LEG),
        # Two days before the period: neither step counts.
        (at_sast(_day(-2), 10, 0), TripStatus.CLOSED, SINGLE_LEG),
    )
    for departed_at, trip_status, steps in cases:
        await seed_trip(
            db_session, operator, stops=stops, start=start_for_departure(departed_at, steps),
            status=trip_status, steps=steps,
        )
    other = await other_operator(db_session)
    await seed_trip(db_session, other, stops=stops, start=start_for_departure(at_sast(_day(1), 7)))

    response = await client.get(_PATTERNS, params=_period_params(), headers=headers(operator))

    assert response.status_code == 200
    departures, arrivals = response.json()["departures"], response.json()["arrivals"]
    assert _events(departures["hour_of_day"]) == {7: 2, 1: 1}
    assert departures["hour_of_day"][7]["average_per_day"] == pytest.approx(2 / _PERIOD_DAYS)
    assert _events(departures["weekday"]) == {_MONDAY: 1, _WEDNESDAY: 1, _SATURDAY: 1}
    assert departures["weekday"][_MONDAY]["day_count"] == _OCCURRENCES_PER_WEEKDAY
    assert departures["weekday"][_MONDAY]["average_per_day"] == pytest.approx(0.5)
    assert _events(arrivals["hour_of_day"]) == {12: 1, 14: 1, 6: 1}
    assert _events(arrivals["weekday"]) == {_MONDAY: 1, _THURSDAY: 1, _SATURDAY: 1}
    assert _events(departures["day_of_month"]) == {_day(0).day: 1, _day(2).day: 1, _day(5).day: 1}


async def test_fleet_patterns_divide_each_date_and_month_by_its_own_occurrences(
    client: AsyncClient, operator: Operator,
) -> None:
    period_days = [_day(offset) for offset in range(_PERIOD_DAYS)]
    expected_dates = Counter(day.day for day in period_days)
    expected_months = Counter(day.month for day in period_days)

    response = await client.get(_PATTERNS, params=_period_params(), headers=headers(operator))

    assert response.status_code == 200
    departures = response.json()["departures"]
    assert {bar["key"]: bar["day_count"] for bar in departures["day_of_month"]} == {
        key: expected_dates[key] for key in range(1, 32)
    }
    assert {bar["key"]: bar["day_count"] for bar in departures["month_of_year"]} == {
        key: expected_months[key] for key in range(1, 13)
    }
    # A date the period never reaches has nothing to divide by: no average, not zero.
    for bar in departures["day_of_month"]:
        if bar["day_count"] == 0:
            assert bar["average_per_day"] is None


async def test_fleet_patterns_all_time_starts_on_the_first_trip_day(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await seed_trip(db_session, operator, stops=stops, start=days_ago(30))
    today = today_sast()

    response = await client.get(_PATTERNS, params={"end": today.isoformat()}, headers=headers(operator))

    assert response.status_code == 200
    assert response.json()["period"]["start"] == (today - timedelta(days=30)).isoformat()
    assert {bar["day_count"] for bar in response.json()["departures"]["hour_of_day"]} == {31}
