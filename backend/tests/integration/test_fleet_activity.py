"""Integration contract for GET /api/v1/analytics/fleet/activity (fleet analytics spec §5.1).

Charts 1.1 (closed trips by departure date, loaded vs empty) and 1.7 (cancellations by the
day trips ended). Every expected number is hand-computed from the rows each test seeds. The
period is built from "now": it starts on the Wednesday of the week four weeks back and ends on
the Sunday two weeks later, so its first week is partial and the other two are whole and past.
"""

from collections.abc import AsyncIterator
from datetime import date, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseStatus, PhaseType, TripStatus, TripType
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

_ACTIVITY = "/api/v1/analytics/fleet/activity"
_WEEKS_BACK = 4
_START_OFFSET_DAYS = 2  # Wednesday: cuts the first week, so it is partial
_END_OFFSET_DAYS = 20  # the Sunday two weeks later: the last two weeks are whole


def _week0() -> date:
    """The Monday four weeks before this week's Monday."""
    today = today_sast()
    return today - timedelta(days=today.weekday(), weeks=_WEEKS_BACK)


def _day(offset: int) -> date:
    return _week0() + timedelta(days=offset)


def _params(start: date | None, end: date, grain: str = "week") -> dict[str, str]:
    params = {"end": end.isoformat(), "grain": grain}
    if start is not None:
        params["start"] = start.isoformat()
    return params


def _period_params() -> dict[str, str]:
    return _params(_day(_START_OFFSET_DAYS), _day(_END_OFFSET_DAYS))


def _bucket(offset_weeks: int) -> str:
    return (_week0() + timedelta(weeks=offset_weeks)).isoformat()


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


# ── Auth ─────────────────────────────────────────────────────────────────────


async def test_fleet_activity_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_ACTIVITY, params=_period_params())

    assert response.status_code == 403


async def test_fleet_activity_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.get(_ACTIVITY, params=_period_params(), headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_fleet_activity_with_driver_token_returns_403(
    client: AsyncClient, operator: Operator,
) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(_ACTIVITY, params=_period_params(), headers=auth_header(token))

    assert response.status_code == 403


# ── 422 ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "params",
    [
        {"end": "not-a-date", "grain": "week"},
        {"grain": "week"},
        {"end": "2026-01-01", "grain": "fortnight"},
        {"end": "2026-01-01"},
    ],
    ids=["malformed-end", "missing-end", "unknown-grain", "missing-grain"],
)
async def test_fleet_activity_rejects_malformed_params(
    client: AsyncClient, operator: Operator, params: dict[str, str],
) -> None:
    response = await client.get(_ACTIVITY, params=params, headers=headers(operator))

    assert response.status_code == 422


async def test_fleet_activity_rejects_an_end_after_today(
    client: AsyncClient, operator: Operator,
) -> None:
    params = _params(None, today_sast() + timedelta(days=1))

    response = await client.get(_ACTIVITY, params=params, headers=headers(operator))

    assert response.status_code == 422
    assert "after today" in response.json()["detail"]


async def test_fleet_activity_rejects_a_start_after_the_end(
    client: AsyncClient, operator: Operator,
) -> None:
    today = today_sast()
    params = _params(today, today - timedelta(days=1))

    response = await client.get(_ACTIVITY, params=params, headers=headers(operator))

    assert response.status_code == 422
    assert "after it ends" in response.json()["detail"]


async def test_fleet_activity_rejects_more_bars_than_a_chart_can_show(
    client: AsyncClient, operator: Operator,
) -> None:
    today = today_sast()
    params = _params(today - timedelta(weeks=60), today, grain="week")

    response = await client.get(_ACTIVITY, params=params, headers=headers(operator))

    assert response.status_code == 422
    assert "at most" in response.json()["detail"]


async def test_fleet_activity_does_not_misreport_a_service_value_error_as_422(
    client: AsyncClient, operator: Operator, monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _broken_service(*args: object, **kwargs: object) -> None:
        raise ValueError("response construction defect")

    monkeypatch.setattr("app.api.v1.endpoints.fleet_analytics.get_activity", _broken_service)

    with pytest.raises(ValueError, match="response construction defect"):
        await client.get(_ACTIVITY, params=_period_params(), headers=headers(operator))


# ── 200 ──────────────────────────────────────────────────────────────────────


async def test_fleet_activity_for_an_org_without_trips_returns_empty_buckets(
    client: AsyncClient, operator: Operator,
) -> None:
    response = await client.get(_ACTIVITY, params=_period_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert body["period"] == {
        "start": _day(_START_OFFSET_DAYS).isoformat(),
        "end": _day(_END_OFFSET_DAYS).isoformat(),
        "grain": "week",
    }
    assert body["trips"] == [
        {"bucket_start": _bucket(0), "is_partial": True, "loaded_count": 0, "empty_count": 0},
        {"bucket_start": _bucket(1), "is_partial": False, "loaded_count": 0, "empty_count": 0},
        {"bucket_start": _bucket(2), "is_partial": False, "loaded_count": 0, "empty_count": 0},
    ]
    assert [row["cancelled_rate"] for row in body["cancellations"]] == [None, None, None]
    assert body["cancelled_trips"] == []


async def test_fleet_activity_counts_closed_trips_by_sast_departure_week(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    overridden = replace_step(SINGLE_LEG, PhaseType.DEPARTURE, status=PhaseStatus.OVERRIDDEN)
    # (departure, trip type, status, steps)
    cases = (
        (at_sast(_day(3), 10), TripType.LOADED, TripStatus.CLOSED, SINGLE_LEG),  # week 0
        (at_sast(_day(1), 10), TripType.LOADED, TripStatus.CLOSED, SINGLE_LEG),  # before the start
        (at_sast(_day(9), 10), TripType.EMPTY_LEG, TripStatus.CLOSED, SINGLE_LEG),  # week 1
        (at_sast(_day(10), 10), TripType.LOADED, TripStatus.CLOSED, SINGLE_LEG),  # week 1
        # 00:30 SAST on Monday is still Sunday 22:30 in UTC: it must count in week 1.
        (at_sast(_day(7), 0, 30), TripType.LOADED, TripStatus.CLOSED, SINGLE_LEG),
        (at_sast(_day(10), 10), TripType.LOADED, TripStatus.ACTIVE, SINGLE_LEG),  # not closed
        (at_sast(_day(11), 10), TripType.LOADED, TripStatus.CLOSED, overridden),  # no attested departure
    )
    for departed_at, trip_type, trip_status, steps in cases:
        await seed_trip(
            db_session, operator, stops=stops, start=start_for_departure(departed_at, steps),
            trip_type=trip_type, status=trip_status, steps=steps,
        )
    other = await other_operator(db_session)
    await seed_trip(db_session, other, stops=stops, start=start_for_departure(at_sast(_day(10), 10)))

    response = await client.get(_ACTIVITY, params=_period_params(), headers=headers(operator))

    assert response.status_code == 200
    assert response.json()["trips"] == [
        {"bucket_start": _bucket(0), "is_partial": True, "loaded_count": 1, "empty_count": 0},
        {"bucket_start": _bucket(1), "is_partial": False, "loaded_count": 2, "empty_count": 1},
        {"bucket_start": _bucket(2), "is_partial": False, "loaded_count": 0, "empty_count": 0},
    ]


async def test_fleet_activity_counts_cancellations_by_the_day_trips_ended(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    seeded: dict[str, Any] = {}
    # (name, status, when it ended)
    ends = (
        ("cancelled_week0", TripStatus.CANCELLED, at_sast(_day(3), 12)),
        ("closed_a", TripStatus.CLOSED, at_sast(_day(4), 12)),
        ("closed_b", TripStatus.CLOSED, at_sast(_day(4), 15)),
        ("cancelled_week2", TripStatus.CANCELLED, at_sast(_day(15), 9)),
        ("cancelled_before", TripStatus.CANCELLED, at_sast(_day(1), 9)),
    )
    for name, trip_status, ended_at in ends:
        seeded[name] = await seed_trip(
            db_session, operator, stops=stops, start=ended_at - timedelta(days=1),
            status=trip_status, closed_at=ended_at,
        )
    await seed_trip(db_session, operator, stops=stops, start=at_sast(_day(5)), status=TripStatus.ACTIVE)
    other = await other_operator(db_session)
    await seed_trip(
        db_session, other, stops=stops, start=at_sast(_day(2)), status=TripStatus.CANCELLED,
        closed_at=at_sast(_day(3), 12),
    )

    response = await client.get(_ACTIVITY, params=_period_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert [
        (row["bucket_start"], row["cancelled_count"], row["ended_count"]) for row in body["cancellations"]
    ] == [(_bucket(0), 1, 3), (_bucket(1), 0, 0), (_bucket(2), 1, 1)]
    assert [row["cancelled_rate"] for row in body["cancellations"]] == [
        pytest.approx(1 / 3), None, pytest.approx(1.0),
    ]
    newest, oldest = seeded["cancelled_week2"].trip, seeded["cancelled_week0"].trip
    assert [(row["trip_id"], row["trip_reference"]) for row in body["cancelled_trips"]] == [
        (str(newest.id), newest.trip_reference),
        (str(oldest.id), oldest.trip_reference),
    ]
    assert datetime.fromisoformat(body["cancelled_trips"][0]["cancelled_at"]) == at_sast(_day(15), 9)


async def test_fleet_activity_all_time_starts_on_the_first_trip_day(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await seed_trip(db_session, operator, stops=stops, start=days_ago(10))
    today = today_sast()

    response = await client.get(_ACTIVITY, params=_params(None, today, grain="month"), headers=headers(operator))

    assert response.status_code == 200
    assert response.json()["period"] == {
        "start": (today - timedelta(days=10)).isoformat(), "end": today.isoformat(), "grain": "month",
    }
