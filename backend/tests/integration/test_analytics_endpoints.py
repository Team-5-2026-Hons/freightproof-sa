"""Integration contract for the FP-156 dispatcher analytics endpoints.

FP-153's own suite (test_analytics.py) proves the metric definitions. This file proves
the HTTP layer on top of them: auth and org scoping, the 422s, name enrichment, and that
every streaks row carries trips_since_last_incident. Expected numbers are hand-computed
from the one seeded timeline below.

The test DB is built by create_all(), which knows nothing about views, so the `views`
fixture runs the FP-153 migration's own UPGRADE_STATEMENTS inside the test's rolled-back
transaction. It is a local copy of test_analytics.py's fixture rather than an import, so
FP-153's test file stays untouched.
"""

import importlib.util
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.refresh import refresh_analytics_views
from app.analytics.vehicle_metrics import trips_since_last_incident
from app.core.config import settings
from app.db.models.enums import (
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    PhaseStatus,
    PhaseType,
    TripStatus,
    VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token

_BASE = "/api/v1/analytics"
_DRIVERS = f"{_BASE}/drivers"
_VEHICLES = f"{_BASE}/vehicles"
_STREAKS = f"{_BASE}/vehicles/streaks"
_LANES = f"{_BASE}/lanes"
_FACILITIES = f"{_BASE}/facilities"
_MONTHLY = [_DRIVERS, _VEHICLES, _LANES, _FACILITIES]
_ALL = [*_MONTHLY, _STREAKS]

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "migrations" / "versions" / "2026_09_12_tom_analytics_read_models.py"
)

# SAST, the zone the views bucket months in — a fixed offset is exact (no DST).
_SAST = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))
_MINUTES_PER_HOUR = 60
_MONTHS_BACK = 3


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("tom_analytics_read_models", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load migration at {_MIGRATION_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_MIGRATION = _load_migration()


# ── The one hand-computed timeline ───────────────────────────────────────────


@dataclass(frozen=True)
class _Step:
    """One phase row, completed `minute` minutes after the trip's start."""

    phase_type: PhaseType
    stop: int | None
    minute: float
    geofence: bool | None = None


# origin (stop 0) -> destination (stop 1). Every expected number below comes from this:
#   dwells: activation 30, loading 60, departure 10, unloading 40, confirmation 20
#   transit: arrival 400 - departure 100 = 300 minutes = 5 driving hours
#   Pulsit at origin: confirmed, mismatch, unwitnessed — one each (rate 1/2, not 1/3)
#   Pulsit at destination: confirmed twice. in_transit is never a facility observation.
_DEPARTURE_MINUTE = 100
_ARRIVAL_MINUTE = 400
_TIMELINE = (
    _Step(PhaseType.TRIP_CREATION, None, 0),
    _Step(PhaseType.ACTIVATION, 0, 30, geofence=True),
    _Step(PhaseType.LOADING, 0, 90, geofence=False),
    _Step(PhaseType.DEPARTURE, 0, _DEPARTURE_MINUTE),
    _Step(PhaseType.IN_TRANSIT, 0, _ARRIVAL_MINUTE),
    _Step(PhaseType.UNLOADING, 1, 440, geofence=True),
    _Step(PhaseType.CONFIRMATION, 1, 460, geofence=True),
)
_TRANSIT_MINUTES = _ARRIVAL_MINUTE - _DEPARTURE_MINUTE
_PLANNED_DEPARTURE_MINUTE = 120  # departed at +100, so on time
_PLANNED_DURATION_MINUTES = 280  # schedule delta = 300 - 280 = +20 (late)
_BREAKDOWN_MINUTE = 200


@dataclass(frozen=True)
class _Operator:
    org: Organization
    dispatcher: User
    driver: Driver
    horse: Vehicle


def _add_months(month: date, count: int) -> date:
    index = month.year * 12 + month.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def _start(month: date, day: int = 10) -> datetime:
    """A SAST wall-clock instant inside `month`."""
    return datetime(month.year, month.month, day, 8, tzinfo=_SAST)


def _range(month: date) -> dict[str, str]:
    return {"start_month": month.isoformat(), "end_month": month.isoformat()}


def _params_for(path: str, month: date) -> dict[str, str]:
    """Valid query params for `path`, so an auth test fails on auth alone."""
    return {} if path == _STREAKS else _range(month)


def _headers(operator: _Operator) -> dict[str, str]:
    return auth_header(make_token(
        sub=str(operator.dispatcher.id), role="dispatcher", org_id=str(operator.org.id),
    ))


# ── Seeding ──────────────────────────────────────────────────────────────────


def _new_horse(org: Organization) -> Vehicle:
    tag = uuid.uuid4().hex[:8].upper()
    return Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"H{tag}", pulsit_device_id=f"PUL-{tag}",
    )


async def _other_operator(db: AsyncSession) -> _Operator:
    tag = uuid.uuid4().hex[:8]
    org = Organization(
        id=uuid.uuid4(), name=f"Other operator {tag}", org_type=OrganizationType.OPERATOR,
    )
    db.add(org)
    await db.flush()
    dispatcher = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"other-{tag}@test.co.za", full_name="Other dispatcher",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Other driver",
        id_number="9001015009088", phone_number="+27820000001", license_number=f"OTHER-{tag}",
    )
    horse = _new_horse(org)
    db.add_all([dispatcher, driver, horse])
    await db.flush()
    return _Operator(org=org, dispatcher=dispatcher, driver=driver, horse=horse)


async def _seed_trip(
    db: AsyncSession,
    operator: _Operator,
    *,
    stops: list[Precinct],
    start: datetime,
    horse: Vehicle | None = None,
    driver: Driver | None = None,
    breakdown: bool = False,
) -> Trip:
    """One closed trip following _TIMELINE, with its stops and full phase ledger."""

    def at(minute: float) -> datetime:
        return start + timedelta(minutes=minute)

    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-AN-{uuid.uuid4().hex[:10]}",
        order_number=f"ORD-{uuid.uuid4().hex[:10]}",
        operator_organization_id=operator.org.id,
        driver_id=(driver or operator.driver).id,
        horse_id=(horse or operator.horse).id,
        origin_precinct_id=stops[0].id,
        destination_precinct_id=stops[-1].id,
        status=TripStatus.CLOSED,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=operator.dispatcher.id,
        planned_departure_at=at(_PLANNED_DEPARTURE_MINUTE),
        planned_arrival_at=at(_PLANNED_DEPARTURE_MINUTE + _PLANNED_DURATION_MINUTES),
        actual_departure_at=at(_DEPARTURE_MINUTE),
        actual_arrival_at=at(_ARRIVAL_MINUTE),
        closed_at=start + timedelta(days=1),
    )
    db.add(trip)
    await db.flush()

    trip_stops = [
        TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=index + 1)
        for index, precinct in enumerate(stops)
    ]
    db.add_all(trip_stops)
    await db.flush()

    db.add_all([
        PhaseEvent(
            id=uuid.uuid4(),
            trip_id=trip.id,
            trip_stop_id=None if step.stop is None else trip_stops[step.stop].id,
            phase_type=step.phase_type,
            sequence_number=index,
            status=PhaseStatus.COMPLETED,
            pulsit_geofence_confirmed=step.geofence,
            completed_at=at(step.minute),
        )
        for index, step in enumerate(_TIMELINE)
    ])
    if breakdown:
        db.add(TripException(
            id=uuid.uuid4(), trip_id=trip.id, exception_type=ExceptionType.MECHANICAL,
            source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
            description="seeded by test_analytics_endpoints", created_at=at(_BREAKDOWN_MINUTE),
        ))
    await db.flush()
    return trip


async def _run_history(
    db: AsyncSession,
    operator: _Operator,
    horse: Vehicle,
    stops: list[Precinct],
    month: date,
    pattern: str,
) -> None:
    """One closed trip per character, a day apart: '.' clean, 'X' a mechanical breakdown."""
    for day, mark in enumerate(pattern, start=1):
        await _seed_trip(
            db, operator, stops=stops, start=_start(month, day), horse=horse,
            breakdown=mark == "X",
        )


async def _refresh(db: AsyncSession) -> None:
    await db.flush()
    # Non-concurrent: CONCURRENTLY cannot run inside the test's transaction.
    await refresh_analytics_views(await db.connection(), concurrently=False)


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def views(db_session: AsyncSession) -> None:
    for statement in _MIGRATION.UPGRADE_STATEMENTS:
        await db_session.execute(text(statement))


@pytest.fixture
def operator(seed: dict[str, Any]) -> _Operator:
    return _Operator(
        org=seed["org"], dispatcher=seed["dispatcher"], driver=seed["driver"], horse=seed["horse"],
    )


@pytest_asyncio.fixture
async def lane(db_session: AsyncSession, seed: dict[str, Any]) -> list[Precinct]:
    """Two depots owned by the CLIENT and not shared — the normal case the precinct
    name lookup has to handle (spec §3.3). is_shared is set explicitly, not left to the
    server default, so the tests can assert it without a lazy load."""
    precincts = [
        Precinct(
            id=uuid.uuid4(), name=name, principal_organization_id=seed["client_org"].id,
            latitude=latitude, longitude="18.4", is_shared=False,
        )
        for name, latitude in (("Client origin DC", "-33.9"), ("Client destination DC", "-29.8"))
    ]
    db_session.add_all(precincts)
    await db_session.flush()
    return precincts


@pytest.fixture
def month() -> date:
    """A complete past calendar month, derived from today rather than hardcoded."""
    return _add_months(datetime.now(_SAST).date().replace(day=1), -_MONTHS_BACK)


@pytest_asyncio.fixture
async def closed_trip(
    db_session: AsyncSession, views: None, operator: _Operator, lane: list[Precinct], month: date,
) -> Trip:
    """The hand-computed trip, with one mechanical breakdown, visible through the views."""
    trip = await _seed_trip(db_session, operator, stops=lane, start=_start(month), breakdown=True)
    await _refresh(db_session)
    return trip


# ── Auth ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("path", _ALL)
async def test_analytics_without_token_returns_403(
    client: AsyncClient, month: date, path: str,
) -> None:
    response = await client.get(path, params=_params_for(path, month))

    assert response.status_code == 403


@pytest.mark.parametrize("path", _ALL)
async def test_analytics_with_malformed_token_returns_401(
    client: AsyncClient, month: date, path: str,
) -> None:
    response = await client.get(
        path, params=_params_for(path, month), headers=auth_header("not-a-jwt"),
    )

    assert response.status_code == 401


@pytest.mark.parametrize("path", _ALL)
async def test_analytics_with_expired_token_returns_401(
    client: AsyncClient, operator: _Operator, month: date, path: str,
) -> None:
    token = make_token(
        sub=str(operator.dispatcher.id), role="dispatcher", org_id=str(operator.org.id),
        expires_in=-1,
    )

    response = await client.get(path, params=_params_for(path, month), headers=auth_header(token))

    assert response.status_code == 401


@pytest.mark.parametrize("path", _ALL)
async def test_analytics_with_driver_token_returns_403(
    client: AsyncClient, operator: _Operator, month: date, path: str,
) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(path, params=_params_for(path, month), headers=auth_header(token))

    assert response.status_code == 403


# ── 422 ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("path", _MONTHLY)
@pytest.mark.parametrize(
    "params",
    [{"start_month": "not-a-date"}, {}],
    ids=["malformed-start", "missing-start"],
)
async def test_monthly_analytics_reject_invalid_date_params(
    client: AsyncClient, operator: _Operator, month: date, path: str, params: dict[str, str],
) -> None:
    response = await client.get(
        path, params={"end_month": month.isoformat(), **params}, headers=_headers(operator),
    )

    assert response.status_code == 422


@pytest.mark.parametrize("path", _MONTHLY)
async def test_monthly_analytics_reject_mid_month_date(
    client: AsyncClient, operator: _Operator, month: date, path: str,
) -> None:
    params = {"start_month": month.replace(day=15).isoformat(), "end_month": month.isoformat()}

    response = await client.get(path, params=params, headers=_headers(operator))

    assert response.status_code == 422
    assert "first-of-month" in response.json()["detail"]


@pytest.mark.parametrize("path", _MONTHLY)
async def test_monthly_analytics_reject_start_after_end(
    client: AsyncClient, operator: _Operator, month: date, path: str,
) -> None:
    params = {"start_month": _add_months(month, 1).isoformat(), "end_month": month.isoformat()}

    response = await client.get(path, params=params, headers=_headers(operator))

    assert response.status_code == 422
    assert "after" in response.json()["detail"]


async def test_analytics_does_not_misreport_a_service_value_error_as_422(
    client: AsyncClient, operator: _Operator, month: date, monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _broken_service(*args: object, **kwargs: object) -> None:
        raise ValueError("response construction defect")

    monkeypatch.setattr(
        "app.api.v1.endpoints.analytics.list_driver_analytics", _broken_service,
    )

    with pytest.raises(ValueError, match="response construction defect"):
        await client.get(_DRIVERS, params=_range(month), headers=_headers(operator))


# ── 200: hand-computed values per grain ──────────────────────────────────────


@pytest.mark.usefixtures("views")
@pytest.mark.parametrize("path", _ALL)
async def test_analytics_without_closed_trips_returns_empty_list(
    client: AsyncClient, operator: _Operator, month: date, path: str,
) -> None:
    response = await client.get(path, params=_params_for(path, month), headers=_headers(operator))

    assert response.status_code == 200
    assert response.json() == []


async def test_driver_analytics_returns_named_hand_computed_trends(
    client: AsyncClient, closed_trip: Trip, operator: _Operator, month: date,
) -> None:
    response = await client.get(_DRIVERS, params=_range(month), headers=_headers(operator))

    assert response.status_code == 200
    [row] = response.json()
    assert row["driver_id"] == str(operator.driver.id)
    assert row["driver_name"] == operator.driver.full_name
    assert (row["trip_count"], row["trips_with_exceptions_count"]) == (1, 1)
    assert (
        row["info_exceptions_count"],
        row["warning_exceptions_count"],
        row["critical_exceptions_count"],
    ) == (0, 1, 0)
    assert row["exception_trip_rate"] == pytest.approx(1.0)
    assert (row["on_time_departures_count"], row["departures_with_plan_count"]) == (1, 1)
    assert row["on_time_departure_rate"] == pytest.approx(1.0)
    assert row["activation_dwell_minutes_avg"] == pytest.approx(30)
    assert row["loading_dwell_minutes_avg"] == pytest.approx(60)
    assert row["departure_dwell_minutes_avg"] == pytest.approx(10)
    assert row["unloading_dwell_minutes_avg"] == pytest.approx(40)
    assert row["confirmation_dwell_minutes_avg"] == pytest.approx(20)
    assert (row["phase_events_count"], row["override_count"]) == (len(_TIMELINE), 0)
    assert row["override_rate"] == pytest.approx(0.0)


async def test_vehicle_analytics_returns_registration_and_hand_computed_numbers(
    client: AsyncClient, closed_trip: Trip, operator: _Operator, month: date,
) -> None:
    response = await client.get(_VEHICLES, params=_range(month), headers=_headers(operator))

    assert response.status_code == 200
    [row] = response.json()
    assert row["vehicle_id"] == str(operator.horse.id)
    assert row["registration"] == operator.horse.registration
    assert row["trip_count"] == 1
    assert row["mechanical_exceptions_count"] == 1
    assert (
        row["mechanical_info_count"],
        row["mechanical_warning_count"],
        row["mechanical_critical_count"],
    ) == (0, 1, 0)
    # The horse's first-ever breakdown: there is no earlier one to measure a gap from.
    assert row["mechanical_gap_count"] == 0
    assert row["mean_minutes_between_mechanical"] is None
    assert row["driving_hours_sum"] == pytest.approx(_TRANSIT_MINUTES / _MINUTES_PER_HOUR)


@pytest.mark.usefixtures("views")
async def test_vehicle_streaks_carry_trips_since_last_incident(
    client: AsyncClient,
    db_session: AsyncSession,
    operator: _Operator,
    lane: list[Precinct],
    month: date,
) -> None:
    clean_horse = _new_horse(operator.org)
    db_session.add(clean_horse)
    await db_session.flush()
    # '.X..' — streak of 1 closed by the breakdown, then 2 still running: (2, 1), 2 since.
    await _run_history(db_session, operator, operator.horse, lane, month, ".X..")
    # '..' — never broken down: lowest is null, and every closed trip counts since.
    await _run_history(db_session, operator, clean_horse, lane, month, "..")
    await _refresh(db_session)

    response = await client.get(_STREAKS, headers=_headers(operator))

    assert response.status_code == 200
    rows = {row["vehicle_id"]: row for row in response.json()}
    assert rows.keys() == {str(operator.horse.id), str(clean_horse.id)}
    broken = rows[str(operator.horse.id)]
    assert (
        broken["highest_streak_trips"],
        broken["lowest_streak_trips"],
        broken["trips_since_last_incident"],
    ) == (2, 1, 2)
    clean = rows[str(clean_horse.id)]
    assert (
        clean["highest_streak_trips"],
        clean["lowest_streak_trips"],
        clean["trips_since_last_incident"],
    ) == (2, None, 2)
    for horse in (operator.horse, clean_horse):
        direct = await trips_since_last_incident(
            db_session, organization_id=operator.org.id, vehicle_id=horse.id,
        )
        assert rows[str(horse.id)]["trips_since_last_incident"] == direct


async def test_lane_analytics_returns_hand_computed_durations(
    client: AsyncClient, closed_trip: Trip, operator: _Operator, lane: list[Precinct], month: date,
) -> None:
    origin, destination = lane

    response = await client.get(_LANES, params=_range(month), headers=_headers(operator))

    assert response.status_code == 200
    [row] = response.json()
    assert (row["origin_precinct_id"], row["destination_precinct_id"]) == (
        str(origin.id), str(destination.id),
    )
    assert (row["trip_count"], row["exception_count"]) == (1, 1)
    assert row["exception_density"] == pytest.approx(1.0)
    transit = row["actual_transit_minutes"]
    assert transit["sample_count"] == 1
    assert (transit["mean"], transit["median"], transit["p90"]) == pytest.approx(
        (_TRANSIT_MINUTES, _TRANSIT_MINUTES, _TRANSIT_MINUTES),
    )
    delta = row["schedule_delta_minutes"]
    assert delta["sample_count"] == 1
    assert delta["mean"] == pytest.approx(_TRANSIT_MINUTES - _PLANNED_DURATION_MINUTES)


async def test_facility_analytics_keeps_unwitnessed_out_of_the_rate(
    client: AsyncClient, closed_trip: Trip, operator: _Operator, lane: list[Precinct], month: date,
) -> None:
    origin, destination = lane

    response = await client.get(_FACILITIES, params=_range(month), headers=_headers(operator))

    assert response.status_code == 200
    rows = {row["precinct_id"]: row for row in response.json()}
    at_origin = rows[str(origin.id)]
    assert (
        at_origin["confirmed_count"], at_origin["mismatch_count"], at_origin["unwitnessed_count"],
    ) == (1, 1, 1)
    # Unwitnessed stays outside the denominator: 1 / (1 + 1), not 1 / 3.
    assert at_origin["corroboration_rate"] == pytest.approx(0.5)
    at_destination = rows[str(destination.id)]
    assert (
        at_destination["confirmed_count"],
        at_destination["mismatch_count"],
        at_destination["unwitnessed_count"],
    ) == (2, 0, 0)
    assert at_destination["corroboration_rate"] == pytest.approx(1.0)


# ── Names and org scoping ────────────────────────────────────────────────────


async def test_client_owned_private_precincts_are_still_named(
    client: AsyncClient, closed_trip: Trip, operator: _Operator, lane: list[Precinct], month: date,
) -> None:
    origin, destination = lane
    # The case this guards: neither depot is the operator's, and neither is shared.
    assert {origin.principal_organization_id, destination.principal_organization_id} != {
        operator.org.id
    }
    assert (origin.is_shared, destination.is_shared) == (False, False)
    headers = _headers(operator)

    lanes = (await client.get(_LANES, params=_range(month), headers=headers)).json()
    facilities = (await client.get(_FACILITIES, params=_range(month), headers=headers)).json()

    assert (lanes[0]["origin_precinct_name"], lanes[0]["destination_precinct_name"]) == (
        origin.name, destination.name,
    )
    assert {row["precinct_id"]: row["precinct_name"] for row in facilities} == {
        str(origin.id): origin.name,
        str(destination.id): destination.name,
    }


@pytest.mark.usefixtures("views")
async def test_driver_outside_the_organisation_is_never_named(
    client: AsyncClient,
    db_session: AsyncSession,
    operator: _Operator,
    lane: list[Precinct],
    month: date,
) -> None:
    """A trip row can point at another organisation's driver. The metrics row is kept,
    but the name lookup is org-scoped, so the name comes back null rather than leaking."""
    stranger = await _other_operator(db_session)
    await _seed_trip(db_session, operator, stops=lane, start=_start(month), driver=stranger.driver)
    await _refresh(db_session)

    response = await client.get(_DRIVERS, params=_range(month), headers=_headers(operator))

    assert response.status_code == 200
    [row] = response.json()
    assert row["driver_id"] == str(stranger.driver.id)
    assert row["driver_name"] is None
    assert row["trip_count"] == 1


async def test_analytics_never_include_another_operators_trips(
    client: AsyncClient,
    db_session: AsyncSession,
    closed_trip: Trip,
    operator: _Operator,
    lane: list[Precinct],
    month: date,
) -> None:
    """The other operator runs the same client lane in the same month. Precincts belong
    to the client, so two operators sharing them is realistic — and every grain must
    still count only the caller's own trip."""
    other = await _other_operator(db_session)
    await _seed_trip(db_session, other, stops=lane, start=_start(month, day=11), breakdown=True)
    await _refresh(db_session)
    headers = _headers(operator)

    drivers = (await client.get(_DRIVERS, params=_range(month), headers=headers)).json()
    vehicles = (await client.get(_VEHICLES, params=_range(month), headers=headers)).json()
    streaks = (await client.get(_STREAKS, headers=headers)).json()
    lanes = (await client.get(_LANES, params=_range(month), headers=headers)).json()
    facilities = (await client.get(_FACILITIES, params=_range(month), headers=headers)).json()

    assert [row["driver_id"] for row in drivers] == [str(operator.driver.id)]
    assert [row["vehicle_id"] for row in vehicles] == [str(operator.horse.id)]
    assert [row["vehicle_id"] for row in streaks] == [str(operator.horse.id)]
    assert [row["trip_count"] for row in lanes] == [1]
    at_origin = next(row for row in facilities if row["precinct_id"] == str(lane[0].id))
    assert at_origin["confirmed_count"] == 1
