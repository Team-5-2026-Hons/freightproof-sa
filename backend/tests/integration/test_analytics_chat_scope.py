"""The Analytics chat's tools against a real database (FP-295 Stage 1).

Two promises: the "Based on" trip count is the period's closed trips for the caller's
organisation only, and a tool returns exactly what its tab's endpoint returns for the
same period, so a chat answer can be checked against the page.
"""

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import ExceptionSeverity, ExceptionType, TripStatus
from app.db.models.organisations import Precinct
from app.db.session import get_db
from app.main import app
from app.orchestration.analytics_chat.basis import basis_for
from app.orchestration.analytics_chat.definitions import about
from app.orchestration.analytics_chat.tools import run_tool

from tests.integration._fleet_seed import (
    Operator,
    add_exception,
    days_ago,
    headers,
    operator_from_seed,
    other_operator,
    seed_trip,
)

_ON_TIME = "/api/v1/analytics/fleet/on-time"
_LAST_12_WEEKS_BY_WEEK = {"preset": "last_12_weeks", "start": None, "end": None, "grain": "week"}
_RECENT_DAYS = (7, 14, 21)
_OLD_DAYS = 200


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


async def _seed_mixed_trips(db: AsyncSession, operator: Operator, stops: list[Precinct]) -> None:
    """3 closed recent trips that count; then an open one, an old one and another
    organisation's, none of which may."""
    for days in _RECENT_DAYS:
        await seed_trip(db, operator, stops=stops, start=days_ago(days, hour=6))
    await seed_trip(db, operator, stops=stops, start=days_ago(10, hour=6), status=TripStatus.ACTIVE)
    await seed_trip(db, operator, stops=stops, start=days_ago(_OLD_DAYS, hour=6))
    other = await other_operator(db)
    await seed_trip(db, other, stops=stops, start=days_ago(7, hour=6))


async def test_basis_counts_only_the_callers_closed_trips_in_the_period(
    db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_mixed_trips(db_session, operator, stops)

    outcome = await run_tool(
        db_session, organization_id=operator.org.id, name="on_time", arguments=_LAST_12_WEEKS_BY_WEEK,
    )
    basis = await basis_for(db_session, organization_id=operator.org.id, outcome=outcome)

    assert outcome.error is None
    assert basis is not None
    assert basis.closed_trip_count == len(_RECENT_DAYS)
    assert (basis.tool, basis.tab, basis.label, basis.grain) == ("on_time", "on-time", "On time", "week")


async def test_on_time_tool_returns_what_the_on_time_tab_shows(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_mixed_trips(db_session, operator, stops)
    outcome = await run_tool(
        db_session, organization_id=operator.org.id, name="on_time", arguments=_LAST_12_WEEKS_BY_WEEK,
    )
    assert outcome.period is not None

    response = await client.get(
        _ON_TIME,
        params={"start": outcome.period.start.isoformat(), "end": outcome.period.end.isoformat(), "grain": "week"},
        headers=headers(operator),
    )

    assert response.status_code == 200
    assert outcome.result is not None
    assert {key: value for key, value in outcome.result.items() if key not in {"about", "totals"}} == response.json()
    assert outcome.result["about"] == about("on_time")
    punctuality = response.json()["punctuality"]
    assert sum(bucket["arrivals_with_plan"] for bucket in punctuality) == len(_RECENT_DAYS)


async def test_right_now_basis_has_no_period_or_count(db_session: AsyncSession, operator: Operator) -> None:
    outcome = await run_tool(db_session, organization_id=operator.org.id, name="right_now", arguments={})
    basis = await basis_for(db_session, organization_id=operator.org.id, outcome=outcome)

    assert basis is not None
    assert (basis.tab, basis.start, basis.end, basis.grain, basis.closed_trip_count) == (None, None, None, None, None)


async def test_failed_tool_has_no_basis(db_session: AsyncSession, operator: Operator) -> None:
    outcome = await run_tool(db_session, organization_id=operator.org.id, name="incidents", arguments={})

    assert await basis_for(db_session, organization_id=operator.org.id, outcome=outcome) is None



async def _seed_problem_weeks(db: AsyncSession, operator: Operator, stops: list[Precinct]) -> None:
    """The 20 Oct shape: one trip with 2 warnings, a week later one with 2 warnings and 1 critical."""
    first = await seed_trip(db, operator, stops=stops, start=days_ago(14, hour=6))
    second = await seed_trip(db, operator, stops=stops, start=days_ago(7, hour=6))
    for trip, severities in ((first.trip, ("warning", "warning")), (second.trip, ("warning", "warning", "critical"))):
        for severity in severities:
            await add_exception(
                db, trip, exception_type=ExceptionType.GPS_MISMATCH if severity == "warning" else ExceptionType.SEAL_MISMATCH,
                severity=ExceptionSeverity(severity), created_at=trip.created_at,
            )


def _sum(rows: list[dict[str, Any]], *keys: str) -> int:
    return sum(int(row[key]) for row in rows for key in keys)


async def test_every_tools_totals_equal_the_sum_of_its_rows(
    db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_problem_weeks(db_session, operator, stops)
    await seed_trip(db_session, operator, stops=stops, start=days_ago(10, hour=6), status=TripStatus.CANCELLED)
    results: dict[str, Any] = {}
    for name in ("activity", "on_time", "problems", "review_desk", "evidence", "routes_and_sites"):
        args = _LAST_12_WEEKS_BY_WEEK if name != "routes_and_sites" else {k: v for k, v in _LAST_12_WEEKS_BY_WEEK.items() if k != "grain"}
        outcome = await run_tool(db_session, organization_id=operator.org.id, name=name, arguments=args)
        assert outcome.error is None and outcome.result is not None, name
        results[name] = outcome.result

    activity = results["activity"]["activity"]
    assert activity["totals"]["closed_trips"] == _sum(activity["trips"], "loaded_count", "empty_count") == 2
    assert activity["totals"]["cancelled_trips"] == _sum(activity["cancellations"], "cancelled_count") == 1

    on_time = results["on_time"]
    assert on_time["totals"]["arrivals_with_plan"] == _sum(on_time["punctuality"], "arrivals_with_plan")
    assert on_time["totals"]["on_time_arrivals"] == _sum(on_time["punctuality"], "on_time_arrivals")

    problems = results["problems"]
    rows = problems["per_trip"]
    assert problems["totals"]["problems"] == _sum(rows, "info_count", "warning_count", "critical_count") == 5
    assert (problems["totals"]["warning"], problems["totals"]["critical"]) == (4, 1)
    assert problems["totals"]["theft_signals"] == _sum(problems["theft_signals"], "total_count") == 1

    review = results["review_desk"]
    assert review["totals"]["critical_waiting_now"] == _sum(review["waiting_by_age"], "count")

    evidence = results["evidence"]
    assert evidence["totals"]["tracker_confirmed"] == _sum(evidence["tracker"], "confirmed_count")
    assert evidence["totals"]["steps"] == _sum(evidence["overrides"], "phase_count")

    routes = results["routes_and_sites"]
    assert routes["totals"]["trips_on_lanes"] == _sum(routes["lanes"], "trip_count") == 2
    assert routes["totals"]["problems_on_lanes"] == _sum(routes["lanes"], "problem_count") == 5

    _assert_leader(problems["totals"]["step_with_most_problems"], [(r["step"], r["count"]) for r in problems["by_step"]])
    _assert_leader(problems["totals"]["riskiest_time_of_day"], [(r["block"], r["road_problem_count"]) for r in problems["risky_times"]])
    _assert_leader(problems["totals"]["most_problems_in"], [
        (r["bucket_start"] + (" (partial)" if r["is_partial"] else ""), r["info_count"] + r["warning_count"] + r["critical_count"])
        for r in rows
    ])
    lane_names = [(f"{r['origin_name']} → {r['destination_name']}", r["problem_count"]) for r in routes["lanes"]]
    _assert_leader(routes["totals"]["lane_with_most_problems"], lane_names)
    hours = results["activity"]["busy_patterns"]
    _assert_leader(hours["totals"]["departures"]["busiest_hour"], [
        (f"{b['key']:02d}:00–{b['key'] + 1:02d}:00", b["average_per_day"]) for b in hours["departures"]["hour_of_day"]
    ])


def _assert_leader(leader: dict[str, Any] | None, rows: list[tuple[str, float | None]]) -> None:
    values = [value for _, value in rows if value]
    if not values:
        assert leader is None
        return
    best = max(values)
    assert leader == {"value": best, "of": [label for label, value in rows if value == best]}



async def test_explain_cost_reads_the_organisations_rates_and_gives_no_basis(
    db_session: AsyncSession, operator: Operator,
) -> None:
    outcome = await run_tool(db_session, organization_id=operator.org.id, name="explain", arguments={"topic": "cost"})
    basis = await basis_for(db_session, organization_id=operator.org.id, outcome=outcome)

    assert outcome.error is None
    assert outcome.result is not None
    rates = outcome.result["current_rates"]
    assert rates["is_default"] is True  # type: ignore[index]
    assert round(rates["fuel_per_km"], 2) == 17.64  # type: ignore[index]  # 33.29 × 53 ÷ 100, as the rates card rounds it
    assert "updated_by_name" not in rates  # type: ignore[operator]
    assert basis is None
