"""Integration tests for the FP-153 analytics read models.

A materialized view cannot be tested without Postgres, so these live here rather than in
tests/unit (FP-230 calls them unit tests; this project's taxonomy says otherwise).

The test database is built with create_all(), which knows nothing about views, so the
`views` fixture runs the migration's own UPGRADE_STATEMENTS inside each test's rolled-back
transaction — the SQL under test is exactly the SQL that ships. Every expected number is
hand-computed from the seeded timeline in the same test.
"""

import importlib.util
import uuid
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.analytics.driver_metrics import get_driver_metrics
from app.analytics.facility_metrics import get_facility_metrics
from app.analytics.lane_metrics import get_lane_metrics
from app.analytics.refresh import refresh_analytics_views
from app.analytics.vehicle_metrics import (
    get_vehicle_metrics,
    get_vehicle_streaks,
    trips_since_last_incident,
)
from app.analytics.views import ANALYTICS_VIEW_NAMES
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

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "migrations" / "versions" / "2026_09_12_tom_analytics_read_models.py"
)

# SAST, the zone the views bucket months in — a fixed offset is exact (no DST).
_SAST = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))

# A mechanical breakdown is logged mid-drive in every seeded trip (between departure at
# +100 and arrival at +400 on the default single-leg timeline).
_MECHANICAL_AT_MINUTE = 200


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("tom_analytics_read_models", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load migration at {_MIGRATION_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_MIGRATION = _load_migration()


# ── Timeline building blocks ─────────────────────────────────────────────────


@dataclass(frozen=True)
class Step:
    """One phase row: completed `minute` minutes after the trip's start (None = not yet)."""

    phase_type: PhaseType
    stop: int | None
    minute: float | None
    status: PhaseStatus = PhaseStatus.COMPLETED
    geofence: bool | None = None


@dataclass(frozen=True)
class Operator:
    org: Organization
    dispatcher: User
    driver: Driver
    horse: Vehicle


def _single_leg(*, departure: float = 100, arrival: float = 400) -> list[Step]:
    """origin -> dest, 7 rows. Dwells: activation 30, loading 60, departure 10,
    unloading 40, confirmation 20 (with the default departure/arrival)."""
    return [
        Step(PhaseType.TRIP_CREATION, None, 0),
        Step(PhaseType.ACTIVATION, 0, 30),
        Step(PhaseType.LOADING, 0, 90),
        Step(PhaseType.DEPARTURE, 0, departure),
        Step(PhaseType.IN_TRANSIT, 0, arrival),
        Step(PhaseType.UNLOADING, 1, arrival + 40),
        Step(PhaseType.CONFIRMATION, 1, arrival + 60),
    ]


def _cross_dock() -> list[Step]:
    """origin (pickup) -> mid (pickup) -> dest, 10 rows: two loadings, two driving legs."""
    return [
        Step(PhaseType.TRIP_CREATION, None, 0),
        Step(PhaseType.ACTIVATION, 0, 10),
        Step(PhaseType.LOADING, 0, 40),
        Step(PhaseType.DEPARTURE, 0, 50),
        Step(PhaseType.IN_TRANSIT, 0, 200),
        Step(PhaseType.LOADING, 1, 230),
        Step(PhaseType.DEPARTURE, 1, 250),
        Step(PhaseType.IN_TRANSIT, 1, 400),
        Step(PhaseType.UNLOADING, 2, 430),
        Step(PhaseType.CONFIRMATION, 2, 450),
    ]


def _with(steps: list[Step], phase_type: PhaseType, **changes: Any) -> list[Step]:
    """Copy of `steps` with the first row of `phase_type` changed."""
    index = next(i for i, step in enumerate(steps) if step.phase_type == phase_type)
    return [*steps[:index], replace(steps[index], **changes), *steps[index + 1:]]


def _pending_from(steps: list[Step], phase_type: PhaseType) -> list[Step]:
    """An open plan: `phase_type` and everything after it not yet done."""
    index = next(i for i, step in enumerate(steps) if step.phase_type == phase_type)
    return [
        *steps[:index],
        *(replace(step, minute=None, status=PhaseStatus.PENDING) for step in steps[index:]),
    ]


def _geofenced(steps: list[Step], verdicts: dict[PhaseType, bool | None]) -> list[Step]:
    return [replace(step, geofence=verdicts.get(step.phase_type)) for step in steps]


def _add_months(month: date, count: int) -> date:
    index = month.year * 12 + month.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def _start(month: date, day: int, hour: int = 8) -> datetime:
    """A SAST wall-clock instant inside `month`."""
    return datetime(month.year, month.month, day, hour, tzinfo=_SAST)


def _minutes(delta: timedelta) -> float:
    return delta.total_seconds() / 60


# ── Seeding ──────────────────────────────────────────────────────────────────


def _new_horse(org: Organization) -> Vehicle:
    tag = uuid.uuid4().hex[:8].upper()
    return Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"H{tag}", pulsit_device_id=f"PUL-{tag}",
    )


async def _new_operator(db: AsyncSession) -> Operator:
    org = Organization(id=uuid.uuid4(), name="Other operator", org_type=OrganizationType.OPERATOR)
    db.add(org)
    await db.flush()
    dispatcher = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"{uuid.uuid4().hex}@test.co.za", full_name="Other dispatcher",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Other driver",
        id_number="8001015009087", phone_number="+27821234568", license_number="DRV-2",
    )
    horse = _new_horse(org)
    db.add_all([dispatcher, driver, horse])
    await db.flush()
    return Operator(org=org, dispatcher=dispatcher, driver=driver, horse=horse)


async def _trip(
    db: AsyncSession,
    operator: Operator,
    *,
    start: datetime,
    steps: list[Step],
    stops: list[Precinct],
    status: TripStatus = TripStatus.CLOSED,
    horse: Vehicle | None = None,
    planned_departure_minute: float | None = None,
    planned_duration_minutes: float | None = None,
    on_a_lane: bool = True,
) -> Trip:
    """Seed one trip, its stops and its full phase ledger exactly as `steps` describe."""

    def at(minute: float | None) -> datetime | None:
        return None if minute is None else start + timedelta(minutes=minute)

    departures = [s for s in steps if s.phase_type == PhaseType.DEPARTURE and s.minute is not None]
    legs = [s for s in steps if s.phase_type == PhaseType.IN_TRANSIT]
    final_leg = legs[-1] if legs else None
    planned_departure = at(planned_departure_minute)
    planned_arrival = (
        planned_departure + timedelta(minutes=planned_duration_minutes)
        if planned_departure is not None and planned_duration_minutes is not None
        else None
    )

    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-AN-{uuid.uuid4().hex[:10]}",
        order_number=f"ORD-{uuid.uuid4().hex[:10]}",
        operator_organization_id=operator.org.id,
        driver_id=operator.driver.id,
        horse_id=(horse or operator.horse).id,
        origin_precinct_id=stops[0].id if on_a_lane else None,
        destination_precinct_id=stops[-1].id if on_a_lane else None,
        status=status,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=operator.dispatcher.id,
        planned_departure_at=planned_departure,
        planned_arrival_at=planned_arrival,
        # Reproduces phase_service's known defect: stamped on EVERY departure, so it holds
        # the LAST leg. Seeded deliberately wrong to prove no view reads it.
        actual_departure_at=at(departures[-1].minute) if departures else None,
        actual_arrival_at=(
            at(final_leg.minute)
            if final_leg is not None and final_leg.status == PhaseStatus.COMPLETED
            else None
        ),
        closed_at=start + timedelta(days=1) if status != TripStatus.ACTIVE else None,
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
            status=step.status,
            dispatcher_override_user_id=(
                operator.dispatcher.id if step.status == PhaseStatus.OVERRIDDEN else None
            ),
            pulsit_geofence_confirmed=step.geofence,
            completed_at=at(step.minute),
        )
        for index, step in enumerate(steps)
    ])
    await db.flush()
    return trip


async def _exception(
    db: AsyncSession,
    trip: Trip,
    exception_type: ExceptionType,
    severity: ExceptionSeverity,
    *,
    at: datetime,
) -> None:
    db.add(TripException(
        id=uuid.uuid4(), trip_id=trip.id, exception_type=exception_type,
        source=ExceptionSource.SYSTEM, severity=severity,
        description="seeded by test_analytics", created_at=at,
    ))
    await db.flush()


async def _vehicle_history(
    db: AsyncSession, operator: Operator, horse: Vehicle, month: date, stops: list[Precinct], pattern: str,
) -> None:
    """One closed trip per character, a day apart, in order: '.' clean,
    'X' one mechanical exception, '2' two mechanical exceptions on the same trip."""
    for day, mark in enumerate(pattern, start=1):
        start = _start(month, day)
        trip = await _trip(db, operator, start=start, steps=_single_leg(), stops=stops, horse=horse)
        breakdowns = {".": 0, "X": 1, "2": 2}[mark]
        for n in range(breakdowns):
            await _exception(
                db, trip, ExceptionType.MECHANICAL, ExceptionSeverity.WARNING,
                at=start + timedelta(minutes=_MECHANICAL_AT_MINUTE + n),
            )


async def _refresh(db: AsyncSession) -> None:
    await db.flush()
    # Non-concurrent: CONCURRENTLY cannot run inside the test's transaction.
    await refresh_analytics_views(await db.connection(), concurrently=False)


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def views(db_session: AsyncSession) -> None:
    for statement in _MIGRATION.UPGRADE_STATEMENTS:
        await db_session.execute(text(statement))


@pytest_asyncio.fixture
async def operator(seed: dict[str, Any]) -> Operator:
    return Operator(
        org=seed["org"], dispatcher=seed["dispatcher"], driver=seed["driver"], horse=seed["horse"]
    )


@pytest.fixture
def lane(seed: dict[str, Any]) -> list[Precinct]:
    return [seed["origin"], seed["dest"]]


@pytest.fixture
def month() -> date:
    """A complete past calendar month, derived from today rather than hardcoded."""
    return _add_months(datetime.now(_SAST).date().replace(day=1), -3)


# ── Driver ───────────────────────────────────────────────────────────────────


@pytest.mark.usefixtures("views")
async def test_driver_metrics_counts_closed_trips_only(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    on_time = await _trip(
        db_session, operator, start=_start(month, 10), steps=_single_leg(),
        stops=lane, planned_departure_minute=120,
    )
    await _exception(db_session, on_time, ExceptionType.CARGO_DAMAGE, ExceptionSeverity.INFO,
                     at=_start(month, 10, hour=12))
    await _exception(db_session, on_time, ExceptionType.SEAL_MISMATCH, ExceptionSeverity.CRITICAL,
                     at=_start(month, 10, hour=13))
    # Late, and its loading overridden: loading AND departure dwell (whose predecessor is
    # the override) are not observations; the override still counts toward the rate.
    await _trip(
        db_session, operator, start=_start(month, 12), stops=lane, planned_departure_minute=30,
        steps=[
            Step(PhaseType.TRIP_CREATION, None, 0),
            Step(PhaseType.ACTIVATION, 0, 10),
            Step(PhaseType.LOADING, 0, 50, PhaseStatus.OVERRIDDEN),
            Step(PhaseType.DEPARTURE, 0, 60),
            Step(PhaseType.IN_TRANSIT, 0, 300),
            Step(PhaseType.UNLOADING, 1, 320),
            Step(PhaseType.CONFIRMATION, 1, 330),
        ],
    )
    active = await _trip(
        db_session, operator, start=_start(month, 14), stops=lane, status=TripStatus.ACTIVE,
        steps=_pending_from(_single_leg(), PhaseType.IN_TRANSIT),
    )
    await _exception(db_session, active, ExceptionType.ROUTE_DEVIATION, ExceptionSeverity.WARNING,
                     at=_start(month, 14, hour=12))
    await _trip(
        db_session, operator, start=_start(month, 15), stops=lane, status=TripStatus.CANCELLED,
        steps=_pending_from(_single_leg(), PhaseType.IN_TRANSIT),
    )
    await _refresh(db_session)

    [metrics] = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )

    assert metrics.driver_id == operator.driver.id
    assert metrics.trip_count == 2
    assert metrics.trips_with_exceptions_count == 1
    assert metrics.total_exceptions_count == 2
    assert (metrics.info_exceptions_count, metrics.warning_exceptions_count,
            metrics.critical_exceptions_count) == (1, 0, 1)
    assert (metrics.departures_with_plan_count, metrics.on_time_departures_count) == (2, 1)
    assert (metrics.activation_dwell_minutes_sum, metrics.activation_dwell_events_count) == (40, 2)
    assert (metrics.loading_dwell_minutes_sum, metrics.loading_dwell_events_count) == (60, 1)
    assert (metrics.departure_dwell_minutes_sum, metrics.departure_dwell_events_count) == (10, 1)
    assert (metrics.unloading_dwell_minutes_sum, metrics.unloading_dwell_events_count) == (60, 2)
    assert (metrics.confirmation_dwell_minutes_sum, metrics.confirmation_dwell_events_count) == (30, 2)
    assert (metrics.phase_events_count, metrics.override_count) == (14, 1)
    assert metrics.on_time_departure_rate == pytest.approx(0.5)
    assert metrics.override_rate == pytest.approx(1 / 14)
    assert metrics.activation_dwell_minutes_avg == pytest.approx(20.0)


@pytest.mark.usefixtures("views")
async def test_driver_metrics_range_sums_months_before_dividing(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    next_month = _add_months(month, 1)
    # Departure is at +100 on the default timeline: plan +120 is on time, +30 is late.
    await _trip(db_session, operator, start=_start(month, 5), steps=_single_leg(),
                stops=lane, planned_departure_minute=120)
    await _trip(db_session, operator, start=_start(month, 6), steps=_single_leg(),
                stops=lane, planned_departure_minute=30)
    await _trip(db_session, operator, start=_start(next_month, 5), steps=_single_leg(),
                stops=lane, planned_departure_minute=120)
    await _refresh(db_session)

    [first] = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    [second] = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=next_month, end_month=next_month
    )
    [both] = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=next_month
    )

    assert first.on_time_departure_rate == pytest.approx(0.5)
    assert second.on_time_departure_rate == pytest.approx(1.0)
    assert both.trip_count == 3
    # 2 on time of 3 — not the 0.75 that averaging the two monthly rates would give.
    assert both.on_time_departure_rate == pytest.approx(2 / 3)


@pytest.mark.usefixtures("views")
async def test_multi_stop_trip_measured_from_first_ledger_departure(
    db_session: AsyncSession, operator: Operator, seed: dict[str, Any], month: date,
) -> None:
    mid = Precinct(id=uuid.uuid4(), name="Mid", principal_organization_id=seed["client_org"].id,
                   latitude="0.5", longitude="0.5")
    db_session.add(mid)
    await db_session.flush()
    last_day = _add_months(month, 1) - timedelta(days=1)
    # Starts 23:00 SAST on the month's last day: the FIRST departure (+50) is still in
    # `month`, the last (+250) is in the next month — as is trips.actual_departure_at.
    start = datetime(last_day.year, last_day.month, last_day.day, 23, tzinfo=_SAST)
    await _trip(
        db_session, operator, start=start, steps=_cross_dock(),
        stops=[seed["origin"], mid, seed["dest"]], planned_departure_minute=60,
    )
    await _refresh(db_session)

    [driver] = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    [vehicle] = await get_vehicle_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    [lane_row] = await get_lane_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    next_month = _add_months(month, 1)
    later = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=next_month, end_month=next_month
    )

    assert driver.trip_count == 1
    assert later == []
    # First departure +50 vs plan +60: on time. The last leg (+250) would have been late.
    assert driver.on_time_departures_count == 1
    # Both loadings pooled (30 + 30), both departures (10 + 20).
    assert (driver.loading_dwell_minutes_sum, driver.loading_dwell_events_count) == (60, 2)
    assert (driver.departure_dwell_minutes_sum, driver.departure_dwell_events_count) == (30, 2)
    # Two legs of 150 minutes each.
    assert vehicle.driving_hours_sum == pytest.approx(5.0)
    # Door to door from the first departure: 400 - 50.
    assert lane_row.actual_transit_minutes.median == pytest.approx(350.0)


@pytest.mark.usefixtures("views")
async def test_month_bucket_follows_south_african_time(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    next_month = _add_months(month, 1)
    midnight = datetime(next_month.year, next_month.month, 1, tzinfo=_SAST)
    # Departs 00:40 SAST on the 1st — still the previous month in UTC.
    start = midnight - timedelta(minutes=60)
    departed = start + timedelta(minutes=100)
    await _trip(db_session, operator, start=start, steps=_single_leg(), stops=lane)
    await _refresh(db_session)

    in_month = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    [in_next] = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=next_month, end_month=next_month
    )

    assert departed.astimezone(UTC).month == month.month
    assert in_month == []
    assert in_next.trip_count == 1


@pytest.mark.usefixtures("views")
async def test_trip_without_attested_departure_is_excluded(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    await _trip(
        db_session, operator, start=_start(month, 10), stops=lane,
        steps=_with(_single_leg(), PhaseType.DEPARTURE, status=PhaseStatus.OVERRIDDEN),
    )
    await _refresh(db_session)

    drivers = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    facilities = await get_facility_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )

    assert drivers == []
    assert facilities == []


# ── Vehicle ──────────────────────────────────────────────────────────────────


@pytest.mark.usefixtures("views")
async def test_vehicle_metrics_mechanical_breakdown_and_gaps(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    next_month = _add_months(month, 1)
    first = await _trip(db_session, operator, start=_start(month, 5), steps=_single_leg(), stops=lane)
    swap = await _trip(db_session, operator, start=_start(month, 10), steps=_single_leg(), stops=lane)
    double = await _trip(db_session, operator, start=_start(month, 20), steps=_single_leg(), stops=lane)
    later = await _trip(db_session, operator, start=_start(next_month, 5), steps=_single_leg(), stops=lane)
    t1 = _start(month, 5, hour=11)
    t2 = _start(month, 20, hour=11)
    t3 = _start(month, 20, hour=12)
    t4 = _start(next_month, 5, hour=11)
    await _exception(db_session, first, ExceptionType.MECHANICAL, ExceptionSeverity.WARNING, at=t1)
    # A swap is a separate, ambiguous signal — never counted as a breakdown.
    await _exception(db_session, swap, ExceptionType.VEHICLE_SUBSTITUTION, ExceptionSeverity.WARNING,
                     at=_start(month, 10, hour=11))
    await _exception(db_session, double, ExceptionType.MECHANICAL, ExceptionSeverity.CRITICAL, at=t2)
    await _exception(db_session, double, ExceptionType.MECHANICAL, ExceptionSeverity.INFO, at=t3)
    await _exception(db_session, later, ExceptionType.MECHANICAL, ExceptionSeverity.WARNING, at=t4)
    await _refresh(db_session)

    [this_month] = await get_vehicle_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    [following] = await get_vehicle_metrics(
        db_session, organization_id=operator.org.id, start_month=next_month, end_month=next_month
    )

    assert this_month.vehicle_id == operator.horse.id
    assert this_month.trip_count == 3
    assert this_month.mechanical_exceptions_count == 3
    assert (this_month.mechanical_info_count, this_month.mechanical_warning_count,
            this_month.mechanical_critical_count) == (1, 1, 1)
    # The vehicle's first-ever breakdown has no gap; the next two do.
    assert this_month.mechanical_gap_count == 2
    assert this_month.mechanical_gap_minutes_sum == pytest.approx(_minutes(t3 - t1))
    # Three single-leg trips of 300 minutes on the road.
    assert this_month.driving_hours_sum == pytest.approx(15.0)
    # The gap crosses the month boundary back to the previous month's last breakdown.
    assert following.mechanical_gap_count == 1
    assert following.mean_minutes_between_mechanical == pytest.approx(_minutes(t4 - t3))


@pytest.mark.usefixtures("views")
async def test_overridden_leg_contributes_no_timing(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    await _trip(
        db_session, operator, start=_start(month, 10), stops=lane,
        steps=_with(_single_leg(), PhaseType.IN_TRANSIT, status=PhaseStatus.OVERRIDDEN),
    )
    await _refresh(db_session)

    [vehicle] = await get_vehicle_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    [lane_row] = await get_lane_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )

    assert vehicle.trip_count == 1
    assert vehicle.driving_hours_sum == 0
    assert lane_row.trip_count == 1
    assert lane_row.actual_transit_minutes.sample_count == 0


@pytest.mark.usefixtures("views")
async def test_vehicle_streaks_and_trips_since_last_incident(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    horses = {name: _new_horse(operator.org) for name in ("mixed", "record", "clean", "double")}
    db_session.add_all(horses.values())
    await db_session.flush()
    # clean runs between incidents:  2 | 1 | 0 | open 1
    await _vehicle_history(db_session, operator, horses["mixed"], month, lane, "..X.XX.")
    # 1 | open 3 — the open run is already the record
    await _vehicle_history(db_session, operator, horses["record"], month, lane, ".X...")
    # open 2, no incident ever
    await _vehicle_history(db_session, operator, horses["clean"], month, lane, "..")
    # 1 | open 1 — two reports on one trip are one incident, not a 0-trip streak
    await _vehicle_history(db_session, operator, horses["double"], month, lane, ".2.")
    # An open trip after the last incident must not extend the current streak.
    await _trip(
        db_session, operator, start=_start(month, 25), horse=horses["mixed"], stops=lane,
        status=TripStatus.ACTIVE, steps=_pending_from(_single_leg(), PhaseType.IN_TRANSIT),
    )
    await _refresh(db_session)

    streaks = {
        streak.vehicle_id: (streak.highest_streak_trips, streak.lowest_streak_trips)
        for streak in await get_vehicle_streaks(db_session, organization_id=operator.org.id)
    }
    since = {
        name: await trips_since_last_incident(
            db_session, organization_id=operator.org.id, vehicle_id=horse.id
        )
        for name, horse in horses.items()
    }

    assert streaks[horses["mixed"].id] == (2, 0)
    assert streaks[horses["record"].id] == (3, 1)
    assert streaks[horses["clean"].id] == (2, None)
    assert streaks[horses["double"].id] == (1, 1)
    assert since == {"mixed": 1, "record": 3, "clean": 2, "double": 1}


# ── Lane ─────────────────────────────────────────────────────────────────────


@pytest.mark.usefixtures("views")
async def test_lane_metrics_pool_months_before_percentiles(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    next_month = _add_months(month, 1)
    # (start, actual minutes, planned minutes or None) — departure at +100 on plan.
    seeded = [
        (_start(month, 5), 100, 120),
        (_start(month, 6), 200, 120),
        (_start(month, 7), 300, None),
        (_start(next_month, 5), 1000, 900),
    ]
    trips = [
        await _trip(
            db_session, operator, start=start, stops=lane,
            steps=_single_leg(departure=100, arrival=100 + actual),
            planned_departure_minute=100 if planned is not None else None,
            planned_duration_minutes=planned,
        )
        for start, actual, planned in seeded
    ]
    for hour in (11, 12):
        await _exception(db_session, trips[0], ExceptionType.ROUTE_DEVIATION,
                         ExceptionSeverity.WARNING, at=_start(month, 5, hour=hour))
    await _refresh(db_session)

    [first] = await get_lane_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    [second] = await get_lane_metrics(
        db_session, organization_id=operator.org.id, start_month=next_month, end_month=next_month
    )
    [both] = await get_lane_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=next_month
    )

    assert (first.origin_precinct_id, first.destination_precinct_id) == (lane[0].id, lane[1].id)
    assert first.actual_transit_minutes.median == pytest.approx(200.0)
    assert first.actual_transit_minutes.p90 == pytest.approx(280.0)
    # The trip with no plan has an actual duration but no schedule delta.
    assert first.actual_transit_minutes.sample_count == 3
    assert first.schedule_delta_minutes.sample_count == 2
    assert first.schedule_delta_minutes.mean == pytest.approx(30.0)
    assert second.actual_transit_minutes.median == pytest.approx(1000.0)
    # Pooled [100, 200, 300, 1000]: the median is 250, not the 600 that averaging the
    # two monthly medians (200, 1000) would give.
    assert both.actual_transit_minutes.sample_count == 4
    assert both.actual_transit_minutes.median == pytest.approx(250.0)
    assert both.actual_transit_minutes.p90 == pytest.approx(790.0)
    assert both.actual_transit_minutes.mean == pytest.approx(400.0)
    assert (both.actual_transit_minutes.minimum, both.actual_transit_minutes.maximum) == (100, 1000)
    # Deltas pooled: [-20, 80, 100].
    assert both.schedule_delta_minutes.median == pytest.approx(80.0)
    assert (both.trip_count, both.exception_count) == (4, 2)
    assert both.exception_density == pytest.approx(0.5)


@pytest.mark.usefixtures("views")
async def test_lane_metrics_skip_trips_with_unknown_endpoint(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    await _trip(db_session, operator, start=_start(month, 10), steps=_single_leg(),
                stops=lane, on_a_lane=False)
    await _refresh(db_session)

    lanes = await get_lane_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    [driver] = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )

    assert lanes == []
    assert driver.trip_count == 1


# ── Facility ─────────────────────────────────────────────────────────────────


@pytest.mark.usefixtures("views")
async def test_facility_metrics_three_states_without_in_transit_or_overrides(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    # in_transit is left NULL on both trips, as corroboration_service always leaves it.
    await _trip(
        db_session, operator, start=_start(month, 10), stops=lane,
        steps=_geofenced(_single_leg(), {
            PhaseType.ACTIVATION: True, PhaseType.LOADING: False, PhaseType.DEPARTURE: None,
            PhaseType.UNLOADING: True, PhaseType.CONFIRMATION: None,
        }),
    )
    await _trip(
        db_session, operator, start=_start(month, 12), stops=lane,
        steps=_with(
            _geofenced(_single_leg(), {
                PhaseType.ACTIVATION: True, PhaseType.DEPARTURE: True,
                PhaseType.UNLOADING: False, PhaseType.CONFIRMATION: True,
            }),
            PhaseType.LOADING, status=PhaseStatus.OVERRIDDEN,
        ),
    )
    await _refresh(db_session)

    rows = {
        row.precinct_id: row
        for row in await get_facility_metrics(
            db_session, organization_id=operator.org.id, start_month=month, end_month=month
        )
    }
    origin, dest = rows[lane[0].id], rows[lane[1].id]

    assert (origin.confirmed_count, origin.mismatch_count, origin.unwitnessed_count) == (3, 1, 1)
    assert origin.corroboration_rate == pytest.approx(0.75)
    assert (dest.confirmed_count, dest.mismatch_count, dest.unwitnessed_count) == (2, 1, 1)
    assert dest.corroboration_rate == pytest.approx(2 / 3)


# ── Tenancy ──────────────────────────────────────────────────────────────────


@pytest.mark.usefixtures("views")
async def test_analytics_are_scoped_to_operator_organization(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
) -> None:
    other = await _new_operator(db_session)
    await _trip(db_session, operator, start=_start(month, 10), steps=_single_leg(), stops=lane)
    for day in (11, 12):
        await _trip(db_session, other, start=_start(month, day), steps=_single_leg(), stops=lane)
    await _refresh(db_session)

    [mine] = await get_lane_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )
    [theirs] = await get_lane_metrics(
        db_session, organization_id=other.org.id, start_month=month, end_month=month
    )
    my_facilities = {
        row.precinct_id: row.unwitnessed_count
        for row in await get_facility_metrics(
            db_session, organization_id=operator.org.id, start_month=month, end_month=month
        )
    }
    my_drivers = await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month
    )

    assert (mine.trip_count, theirs.trip_count) == (1, 2)
    # One trip's worth at the shared precincts: activation/loading/departure, unloading/confirmation.
    assert my_facilities == {lane[0].id: 3, lane[1].id: 2}
    assert [d.driver_id for d in my_drivers] == [operator.driver.id]


# ── Migration mechanics ──────────────────────────────────────────────────────


async def test_refresh_concurrently_succeeds_on_every_view(test_engine: AsyncEngine) -> None:
    # Its own AUTOCOMMIT connection: CONCURRENTLY cannot run inside db_session's
    # transaction. Views are dropped in `finally` so session teardown's drop_all()
    # never meets a view depending on its tables.
    async with test_engine.connect() as raw:
        conn = await raw.execution_options(isolation_level="AUTOCOMMIT")
        try:
            for statement in (*_MIGRATION.DOWNGRADE_STATEMENTS, *_MIGRATION.UPGRADE_STATEMENTS):
                await conn.execute(text(statement))

            refreshed = await refresh_analytics_views(conn, concurrently=True)
        finally:
            for statement in _MIGRATION.DOWNGRADE_STATEMENTS:
                await conn.execute(text(statement))

    assert refreshed == list(ANALYTICS_VIEW_NAMES)


@pytest.mark.usefixtures("views")
async def test_migration_downgrade_drops_every_view(db_session: AsyncSession) -> None:
    for statement in _MIGRATION.DOWNGRADE_STATEMENTS:
        await db_session.execute(text(statement))

    remaining = await db_session.execute(
        text("SELECT matviewname FROM pg_matviews WHERE matviewname = ANY(:names)"),
        {"names": list(ANALYTICS_VIEW_NAMES)},
    )

    assert remaining.all() == []
