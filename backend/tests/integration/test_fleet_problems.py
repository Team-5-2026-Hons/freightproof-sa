"""Integration contract for GET /api/v1/analytics/fleet/problems (fleet analytics spec §5.3).

Charts 3.1–3.5. One seeded fortnight (two whole past weeks, built from "now") with problems of
every kind that matters: theft signs and a seal_unverified (a paperwork gap, never a theft sign),
a dispatcher note (never a problem, D10), problems on the driving step at known SAST times, one
problem with no step, and another operator's and an open trip's problems that must never count.
"""

from collections.abc import AsyncIterator
from datetime import date, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.constants import THEFT_SIGNAL_TYPES
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType, PhaseType, TripStatus
from app.db.models.organisations import Precinct
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token
from tests.integration._fleet_seed import (
    Operator,
    SeededTrip,
    add_exception,
    at_sast,
    headers,
    operator_from_seed,
    other_operator,
    seed_trip,
    today_sast,
)

_PROBLEMS = "/api/v1/analytics/fleet/problems"
_WEEKS_BACK = 4
_STEPS = ["trip_creation", "activation", "loading", "departure", "in_transit", "unloading", "confirmation", "unlinked"]


def _week0() -> date:
    today = today_sast()
    return today - timedelta(days=today.weekday(), weeks=_WEEKS_BACK)


def _day(offset: int) -> date:
    return _week0() + timedelta(days=offset)


def _params() -> dict[str, str]:
    return {"start": _day(0).isoformat(), "end": _day(13).isoformat(), "grain": "week"}


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


async def _problem(
    db: AsyncSession, seeded: SeededTrip, exception_type: ExceptionType, severity: ExceptionSeverity,
    source: ExceptionSource, created_at: datetime, step: PhaseType | None,
) -> None:
    await add_exception(
        db, seeded.trip, exception_type=exception_type, severity=severity, source=source,
        created_at=created_at, phase_event=None if step is None else seeded.phase(step),
    )


async def _seed_fortnight(db: AsyncSession, operator: Operator, stops: list[Precinct]) -> None:
    """Three closed trips, each driving 300 minutes (departs +100, arrives +400):
      A  day 1 06:00 start -> drives 07:40-12:40 (morning 260, afternoon 40)
      B  day 8 22:00 start -> drives 23:40-04:40 (evening 20, night 280)
      C  day 9 06:00 start -> drives 07:40-12:40 (morning 260, afternoon 40)
    Problems on A (week 0): seal_mismatch at departure (critical, theft), mechanical while
    driving at 09:00 (warning, morning), seal_unverified at unloading (warning, not theft), and a
    dispatcher note (never counted). On B (week 1): panic while driving at 01:00 on day 9
    (critical, theft, night) and parcel_count_mismatch with no step (warning, theft). C has none."""
    trip_a = await seed_trip(db, operator, stops=stops, start=at_sast(_day(1), 6))
    trip_b = await seed_trip(db, operator, stops=stops, start=at_sast(_day(8), 22))
    await seed_trip(db, operator, stops=stops, start=at_sast(_day(9), 6))
    system, driver, dispatcher = ExceptionSource.SYSTEM, ExceptionSource.DRIVER, ExceptionSource.DISPATCHER
    warning, critical, info = ExceptionSeverity.WARNING, ExceptionSeverity.CRITICAL, ExceptionSeverity.INFO
    for seeded, exception_type, severity, source, created_at, step in (
        (trip_a, ExceptionType.SEAL_MISMATCH, critical, system, at_sast(_day(1), 7, 40), PhaseType.DEPARTURE),
        (trip_a, ExceptionType.MECHANICAL, warning, driver, at_sast(_day(1), 9), PhaseType.IN_TRANSIT),
        (trip_a, ExceptionType.SEAL_UNVERIFIED, warning, system, at_sast(_day(1), 13), PhaseType.UNLOADING),
        (trip_a, ExceptionType.DISPATCHER_NOTE, info, dispatcher, at_sast(_day(1), 14), None),
        (trip_b, ExceptionType.PANIC_BUTTON, critical, driver, at_sast(_day(9), 1), PhaseType.IN_TRANSIT),
        (trip_b, ExceptionType.PARCEL_COUNT_MISMATCH, warning, system, at_sast(_day(9), 6), None),
    ):
        await _problem(db, seeded, exception_type, severity, source, created_at, step)
    # Never counted: another operator's closed trip, and an open trip.
    other = await other_operator(db)
    stranger = await seed_trip(db, other, stops=stops, start=at_sast(_day(2), 6))
    await _problem(db, stranger, ExceptionType.SEAL_MISMATCH, critical, system, at_sast(_day(2), 8), PhaseType.IN_TRANSIT)
    open_trip = await seed_trip(db, operator, stops=stops, start=at_sast(_day(3), 6), status=TripStatus.ACTIVE)
    await _problem(db, open_trip, ExceptionType.PANIC_BUTTON, critical, driver, at_sast(_day(3), 9), PhaseType.IN_TRANSIT)


# ── Auth and 422 ─────────────────────────────────────────────────────────────


async def test_fleet_problems_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_PROBLEMS, params=_params())

    assert response.status_code == 403


async def test_fleet_problems_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.get(_PROBLEMS, params=_params(), headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_fleet_problems_with_driver_token_returns_403(client: AsyncClient, operator: Operator) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(_PROBLEMS, params=_params(), headers=auth_header(token))

    assert response.status_code == 403


async def test_fleet_problems_rejects_a_missing_grain(client: AsyncClient, operator: Operator) -> None:
    params = {key: value for key, value in _params().items() if key != "grain"}

    response = await client.get(_PROBLEMS, params=params, headers=headers(operator))

    assert response.status_code == 422


# ── 200 ──────────────────────────────────────────────────────────────────────


async def test_fleet_problems_for_an_org_without_trips_are_empty_but_complete(
    client: AsyncClient, operator: Operator,
) -> None:
    response = await client.get(_PROBLEMS, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert [(row["trip_count"], row["warning_per_100"]) for row in body["per_trip"]] == [(0, None), (0, None)]
    assert body["by_type"] == []
    assert body["by_step"] == [{"step": step, "count": 0} for step in _STEPS]
    assert [(row["block"], row["driving_share"], row["road_problem_share"]) for row in body["risky_times"]] == [
        ("night", None, None), ("morning", None, None), ("afternoon", None, None), ("evening", None, None),
    ]


async def test_fleet_problems_per_100_trips_leave_out_dispatcher_notes(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_fortnight(db_session, operator, stops)

    response = await client.get(_PROBLEMS, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    rows = response.json()["per_trip"]
    assert [(row["trip_count"], row["info_count"], row["warning_count"], row["critical_count"]) for row in rows] == [
        (1, 0, 2, 1), (2, 0, 1, 1),
    ]
    assert (rows[0]["warning_per_100"], rows[0]["critical_per_100"]) == pytest.approx((200, 100))
    assert (rows[1]["warning_per_100"], rows[1]["critical_per_100"]) == pytest.approx((50, 50))


async def test_fleet_problems_theft_signs_are_exactly_the_d12_types(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_fortnight(db_session, operator, stops)

    response = await client.get(_PROBLEMS, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    week0, week1 = response.json()["theft_signals"]
    assert list(week0["by_type"]) == [signal.value for signal in THEFT_SIGNAL_TYPES]
    assert "seal_unverified" not in week0["by_type"]
    # D25: a receiver ID that was checked and didn't match is a theft sign; one never checked is not.
    assert "receiver_id_mismatch" in week0["by_type"]
    assert "receiver_id_unverified" not in week0["by_type"]
    assert (week0["total_count"], week0["by_type"]["seal_mismatch"]) == (1, 1)
    assert (week1["total_count"], week1["by_type"]["panic_button"], week1["by_type"]["parcel_count_mismatch"]) == (2, 1, 1)


async def test_fleet_problems_by_type_lists_only_what_happened(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_fortnight(db_session, operator, stops)

    response = await client.get(_PROBLEMS, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    # Every type has one problem: ties go by type name.
    assert [(row["exception_type"], row["source"], row["count"]) for row in response.json()["by_type"]] == [
        ("mechanical", "driver", 1),
        ("panic_button", "driver", 1),
        ("parcel_count_mismatch", "system", 1),
        ("seal_mismatch", "system", 1),
        ("seal_unverified", "system", 1),
    ]


async def test_fleet_problems_by_step_counts_unlinked_last(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_fortnight(db_session, operator, stops)

    response = await client.get(_PROBLEMS, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    assert {row["step"]: row["count"] for row in response.json()["by_step"]} == {
        "trip_creation": 0, "activation": 0, "loading": 0, "departure": 1,
        "in_transit": 2, "unloading": 1, "confirmation": 0, "unlinked": 1,
    }


async def test_fleet_problems_risky_times_compare_driving_and_road_problems(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_fortnight(db_session, operator, stops)

    response = await client.get(_PROBLEMS, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    blocks = {row["block"]: row for row in response.json()["risky_times"]}
    total_minutes = 900
    for block, minutes in (("night", 280), ("morning", 520), ("afternoon", 80), ("evening", 20)):
        assert blocks[block]["driving_minutes"] == pytest.approx(minutes)
        assert blocks[block]["driving_share"] == pytest.approx(minutes / total_minutes)
    assert [blocks[block]["road_problem_count"] for block in ("night", "morning", "afternoon", "evening")] == [1, 1, 0, 0]
    assert blocks["night"]["road_problem_share"] == pytest.approx(0.5)
