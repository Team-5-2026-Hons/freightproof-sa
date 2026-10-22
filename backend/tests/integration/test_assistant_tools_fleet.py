"""The assistant's vehicle, free-crew, route-time and parcel tools against a real database
(spec §5.1 rows 5–8, Stage 3). The route planner and Redis are faked: CI never calls ORS."""

import json
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.periods import today_sast as sast_today
from app.db.models.enums import ExceptionReviewStatus, ExceptionSeverity, ExceptionType, TripStatus, VehicleType
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.integrations.routing import PlannedRoute, RouteLeg, RoutePoint, RoutingNotConfiguredError
from app.orchestration.assistant import route_cache
from app.orchestration.assistant.refs import RefBook
from app.orchestration.assistant.tools import run_tool
from app.orchestration.assistant.tools_base import ToolContext, ToolOutcome
from app.schemas.assistant import FreeCrewCard, RouteTimeCard, VehicleCard
from tests.integration._fleet_seed import (
    PLANNED_ARRIVAL_MINUTE,
    Operator,
    add_exception,
    days_ago,
    new_driver,
    new_vehicle,
    not_started,
    operator_from_seed,
    seed_trip,
)
# The lane figures read the analytics views, which the test schema builds from their migrations.
from tests.integration.test_analytics import views  # noqa: F401
from tests.integration.test_parcel_trace import make_world

NOW = datetime.now(UTC)
_NULL_WHEN: dict[str, object] = {"n": None, "weekday": None, "day": None, "end_day": None, "time_of_day": None}
# Cape Town to Johannesburg by truck, roughly: 1,400 km and 17 h 40 min of road time.
_ROAD_METRES = 1_400_000
_ROAD_SECONDS = (17 * 60 + 40) * 60


def _when(preset: str, **fields: object) -> dict[str, object]:
    return {"preset": preset, **_NULL_WHEN, **fields}


def _vehicle_args(**fields: object) -> dict[str, object]:
    return {"vehicle_name": None, "vehicle_ref": None, **fields}


def _route_args(origin: str, destination: str) -> dict[str, object]:
    return {"origin_name": origin, "origin_ref": None, "destination_name": destination, "destination_ref": None}


async def _run(db: AsyncSession, organization_id: Any, name: str, arguments: dict[str, object]) -> ToolOutcome:
    context = ToolContext(db=db, organization_id=organization_id, now=NOW, refs=RefBook())
    return await run_tool(context, name=name, arguments=arguments)


def _result(outcome: ToolOutcome) -> dict[str, Any]:
    assert outcome.error is None, outcome.error
    assert outcome.result is not None
    return outcome.result


async def _trip(
    db: AsyncSession, operator: Operator, seed: dict[str, Any], *, status: TripStatus, arrival: datetime,
    horse: Vehicle | None = None, trailers: tuple[Vehicle, ...] = (), driver: Driver | None = None,
) -> Trip:
    seeded = await seed_trip(
        db, operator, stops=[seed["origin"], seed["dest"]], status=status, steps=not_started(),
        start=arrival - timedelta(minutes=PLANNED_ARRIVAL_MINUTE), horse=horse, trailers=trailers, driver=driver,
    )
    return seeded.trip


async def _vehicle(db: AsyncSession, operator: Operator, kind: VehicleType, *, disc: date | None = None) -> Vehicle:
    vehicle = new_vehicle(operator.org.id, kind, licence_disc_expiry=disc)
    db.add(vehicle)
    await db.flush()
    return vehicle


async def _depots(db: AsyncSession, operator: Operator) -> tuple[Precinct, Precinct]:
    """Two depots the operator owns: the seed's belong to its client, which the trip form can't pick either."""
    tag = uuid.uuid4().hex[:6]
    depots = (
        Precinct(id=uuid.uuid4(), name=f"Epping {tag}", principal_organization_id=operator.org.id, latitude="-33.93", longitude="18.53"),
        Precinct(id=uuid.uuid4(), name=f"Linbro {tag}", principal_organization_id=operator.org.id, latitude="-26.08", longitude="28.11"),
    )
    db.add_all(depots)
    await db.flush()
    return depots


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    redis = _FakeRedis()
    monkeypatch.setattr(route_cache, "get_redis", lambda: redis)
    return redis


@pytest.fixture
def ors_calls(monkeypatch: pytest.MonkeyPatch) -> list[list[RoutePoint]]:
    calls: list[list[RoutePoint]] = []

    async def fake_route(points: list[RoutePoint]) -> PlannedRoute:
        calls.append(points)
        return PlannedRoute(legs=(RouteLeg(distance_metres=_ROAD_METRES, duration_seconds=_ROAD_SECONDS, coordinates=()),))

    monkeypatch.setattr(route_cache, "compute_truck_route", fake_route)
    return calls


async def test_vehicle_status_splits_its_own_exceptions_from_its_trips(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    trip = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=3))
    for kind in (ExceptionType.GPS_MISMATCH, ExceptionType.MECHANICAL):
        await add_exception(
            db_session, trip, exception_type=kind, severity=ExceptionSeverity.WARNING,
            created_at=NOW, review_status=ExceptionReviewStatus.NEEDS_REVIEW,
        )

    outcome = await _run(db_session, operator.org.id, "vehicle_status", _vehicle_args(vehicle_name=seed["horse"].registration))

    result = _result(outcome)
    assert result["exceptions_to_review"]["types"] == ["mechanical"]
    assert result["exceptions_on_all_its_trips"]["types"] == ["gps_mismatch"]
    # The model is told this count covers every trip, so it can't call it the current trip's (B38).
    assert "not only its current trip" in result["all_trips_scope"]
    assert result["recent_breakdowns"] == 1
    assert [booking["trip_reference"] for booking in result["on_trip_now"]] == [trip.trip_reference]
    [card] = outcome.cards
    assert isinstance(card, VehicleCard) and card.recent_breakdowns == 1


async def test_vehicle_status_trailer_gets_only_exceptions_naming_it(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    trailer = await _vehicle(db_session, operator, VehicleType.TRAILER)
    trip = await _trip(
        db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=3), trailers=(trailer,),
    )
    named = await add_exception(
        db_session, trip, exception_type=ExceptionType.MECHANICAL, severity=ExceptionSeverity.CRITICAL,
        created_at=NOW, review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )
    named.vehicle_id = trailer.id
    await add_exception(
        db_session, trip, exception_type=ExceptionType.MECHANICAL, severity=ExceptionSeverity.WARNING,
        created_at=NOW, review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )
    await db_session.flush()

    trailer_result = _result(await _run(db_session, operator.org.id, "vehicle_status", _vehicle_args(vehicle_name=trailer.registration)))
    horse_result = _result(await _run(db_session, operator.org.id, "vehicle_status", _vehicle_args(vehicle_name=seed["horse"].registration)))

    assert (trailer_result["exceptions_to_review"]["critical"], trailer_result["exceptions_to_review"]["warning"]) == (1, 0)
    assert trailer_result["exceptions_on_all_its_trips"]["warning"] == 1
    assert (horse_result["exceptions_to_review"]["critical"], horse_result["exceptions_to_review"]["warning"]) == (0, 1)


async def test_vehicle_status_gives_the_vehicle_pages_specs(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    horse = await _vehicle(db_session, operator, VehicleType.HORSE)
    horse.make, horse.model, horse.year, horse.length_m, horse.gross_vehicle_mass_kg = "Volvo", "FH16", 2021, 7, 26000
    await db_session.flush()

    outcome = await _run(db_session, operator.org.id, "vehicle_status", _vehicle_args(vehicle_name=horse.registration))

    assert _result(outcome)["specs"] == {"make": "Volvo", "model": "FH16", "year": 2021, "length_m": 7, "gross_vehicle_mass_kg": 26000}
    [card] = outcome.cards
    assert isinstance(card, VehicleCard) and (card.make, card.year) == ("Volvo", 2021)


async def test_vehicle_status_expired_disc(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    horse = await _vehicle(db_session, operator, VehicleType.HORSE, disc=sast_today(NOW) - timedelta(days=3))

    outcome = await _run(db_session, operator.org.id, "vehicle_status", _vehicle_args(vehicle_name=horse.registration))

    assert _result(outcome)["licence_disc"].startswith("Expired on")
    [card] = outcome.cards
    assert isinstance(card, VehicleCard) and card.disc_state == "expired"


async def test_free_crew_lists_free_and_booked_active_crew_only(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    free = new_driver(operator.org.id)
    free.full_name = "Free Driver"
    retired = new_driver(operator.org.id, is_active=False)
    retired.full_name = "Retired Driver"
    db_session.add_all([free, retired])
    await db_session.flush()
    trip = await _trip(db_session, operator, seed, status=TripStatus.CREATED, arrival=NOW + timedelta(days=1, hours=3))

    outcome = await _run(
        db_session, operator.org.id, "free_crew", {"when": _when("next_n_days", n=3), "kinds": ["driver", "horse"]},
    )

    drivers, horses = _result(outcome)["groups"]
    assert [name["label"] for name in drivers["nothing_booked"]] == ["Free Driver"]
    assert [(line["label"], line["bookings"][0]["trip_reference"]) for line in drivers["booked"]] == [
        (seed["driver"].full_name, trip.trip_reference),
    ]
    assert horses["nothing_booked_total"] == 0 and horses["booked_total"] == 1
    [card] = outcome.cards
    assert isinstance(card, FreeCrewCard) and [group.kind for group in card.groups] == ["driver", "horse"]


@pytest.mark.usefixtures("views")
async def test_route_time_driving_and_past_trips(
    seed: dict, db_session: AsyncSession, fake_redis: _FakeRedis, ors_calls: list[list[RoutePoint]],
) -> None:
    operator = operator_from_seed(seed)
    origin, dest = await _depots(db_session, operator)
    for days in (2, 3):
        await seed_trip(db_session, operator, stops=[origin, dest], start=days_ago(days))

    first = _result(await _run(db_session, operator.org.id, "route_time", _route_args(origin.name, dest.name)))
    # Past times here are the seed's few minutes of driving, faster than the faked road: left out.
    assert first["history_left_out"] is not None
    again = await _run(db_session, operator.org.id, "route_time", _route_args(origin.name, dest.name))

    assert (first["driving_time"], first["distance_km"]) == ("17 h 40 min", 1400)
    assert first["past_trips"] == 2
    assert "never fill one in" in first["arrival_rule"]
    assert len(ors_calls) == 1, "the second question should come from the cache"
    [card] = again.cards
    assert isinstance(card, RouteTimeCard) and card.driving_minutes == 17 * 60 + 40


@pytest.mark.usefixtures("views")
async def test_route_time_without_the_route_planner_still_gives_history(
    seed: dict, db_session: AsyncSession, fake_redis: _FakeRedis, monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def not_set_up(points: list[RoutePoint]) -> PlannedRoute:
        raise RoutingNotConfiguredError("no key")

    monkeypatch.setattr(route_cache, "compute_truck_route", not_set_up)
    operator = operator_from_seed(seed)
    origin, dest = await _depots(db_session, operator)
    await seed_trip(db_session, operator, stops=[origin, dest], start=days_ago(2))

    result = _result(await _run(db_session, operator.org.id, "route_time", _route_args(origin.name, dest.name)))

    assert "driving_time" not in result
    assert result["driving_basis"] == route_cache.NOT_SET_UP
    assert result["past_trips"] == 1
    assert fake_redis.store == {}, "a failure must never be cached"


@pytest.mark.usefixtures("views")
@pytest.mark.usefixtures("views")
async def test_route_time_leaves_out_trips_faster_than_the_road(
    seed: dict, db_session: AsyncSession, fake_redis: _FakeRedis, ors_calls: list[list[RoutePoint]],
) -> None:
    operator = operator_from_seed(seed)
    origin, dest = await _depots(db_session, operator)
    # The seeded single leg drives for minutes, far under the faked 17 h 40 min of road.
    await seed_trip(db_session, operator, stops=[origin, dest], start=days_ago(2))

    outcome = await _run(db_session, operator.org.id, "route_time", _route_args(origin.name, dest.name))

    result = _result(outcome)
    assert result["past_trips"] == 1
    assert "typical_time" not in result and "slow_time" not in result
    assert "Don't quote them" in result["history_left_out"]
    [card] = outcome.cards
    assert isinstance(card, RouteTimeCard) and card.history_left_out and card.typical_minutes is None


@pytest.mark.usefixtures("views")
async def test_route_time_offers_believable_past_trips(
    seed: dict, db_session: AsyncSession, fake_redis: _FakeRedis, monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def four_hours(points: list[RoutePoint]) -> PlannedRoute:
        return PlannedRoute(legs=(RouteLeg(distance_metres=300_000, duration_seconds=4 * 60 * 60, coordinates=()),))

    monkeypatch.setattr(route_cache, "compute_truck_route", four_hours)
    operator = operator_from_seed(seed)
    origin, dest = await _depots(db_session, operator)
    # The seeded single leg departs at +100 min and arrives at +400: 5 hours, believable for 4 h of road.
    for days in (2, 3):
        await seed_trip(db_session, operator, stops=[origin, dest], start=days_ago(days))

    result = _result(await _run(db_session, operator.org.id, "route_time", _route_args(origin.name, dest.name)))

    assert "history_left_out" not in result
    assert result["typical_time"] == "5 h"


async def test_route_time_same_depot_errors(seed: dict, db_session: AsyncSession, fake_redis: _FakeRedis) -> None:
    origin, _ = await _depots(db_session, operator_from_seed(seed))

    outcome = await _run(db_session, seed["org"].id, "route_time", _route_args(origin.name, origin.name))

    assert outcome.error is not None and "same depot" in outcome.error


async def test_parcel_lookup_by_waybill_and_by_barcode(db_session: AsyncSession) -> None:
    world = await make_world(db_session, "WB-ASSIST-1")

    by_waybill = _result(await _run(db_session, world.org.id, "parcel_lookup", {"barcode": None, "waybill": "WB-ASSIST-1"}))
    by_barcode = _result(await _run(
        db_session, world.org.id, "parcel_lookup", {"barcode": world.parcel.barcode, "waybill": None},
    ))

    assert [trip["trip_reference"] for trip in by_waybill["trips"]] == [world.trip.trip_reference]
    assert "ask for its barcode" in by_waybill["detail_level"]
    assert by_barcode["waybill"] == "WB-ASSIST-1"
    assert [trip["trip_reference"] for trip in by_barcode["trips"]] == [world.trip.trip_reference]
    assert by_barcode["trips"][0]["where"] is not None


async def test_parcel_lookup_never_crosses_organisations(seed: dict, db_session: AsyncSession) -> None:
    await make_world(db_session, "WB-ASSIST-2")

    outcome = await _run(db_session, seed["org"].id, "parcel_lookup", {"barcode": None, "waybill": "WB-ASSIST-2"})

    assert outcome.error is not None and "No trip" in outcome.error


@pytest.mark.usefixtures("views")
async def test_new_tools_never_send_personal_numbers_or_positions(
    seed: dict, db_session: AsyncSession, fake_redis: _FakeRedis, ors_calls: list[list[RoutePoint]],
) -> None:
    operator = operator_from_seed(seed)
    await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=3))
    world = await make_world(db_session, "WB-ASSIST-3")
    driver = seed["driver"]
    calls: list[tuple[Any, str, dict[str, object]]] = [
        (operator.org.id, "vehicle_status", _vehicle_args(vehicle_name=seed["horse"].registration)),
        (operator.org.id, "free_crew", {"when": _when("now"), "kinds": ["driver", "horse", "trailer"]}),
        (operator.org.id, "route_time", _route_args(*(depot.name for depot in await _depots(db_session, operator)))),
        (world.org.id, "parcel_lookup", {"barcode": world.parcel.barcode, "waybill": None}),
    ]

    for organization_id, name, arguments in calls:
        outcome = await _run(db_session, organization_id, name, arguments)
        sent = json.dumps(_result(outcome))
        for secret in (driver.id_number, driver.phone_number, driver.license_number, "-26.1", "SEAL-001"):
            assert secret not in sent, f"{name} sent {secret!r} to the model"
