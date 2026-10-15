"""Integration tests for GET /api/v1/trips/availability (FP-142, spec 2026-10-14 §4.3).

The read behind the trip wizard's greyed-out options. Trips are inserted as rows, not created
through POST /trips, so each test can set the exact status and window it is about.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app
from tests.conftest import auth_header, make_token

_URL = "/api/v1/trips/availability"
_TRIP_LENGTH = timedelta(hours=8)


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def _organisation(db_session: AsyncSession, name: str) -> dict[str, Any]:
    """An operator with a dispatcher, a driver, a horse and a trailer."""
    suffix = uuid.uuid4().hex[:6].upper()
    operator = Organization(id=uuid.uuid4(), name=f"{name} {suffix}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name=f"Client {suffix}", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([operator, client_org])
    await db_session.flush()
    user = User(
        id=uuid.uuid4(), organization_id=operator.id, email=f"d-{suffix}@test.co.za",
        full_name="Dispatcher", is_active=True,
    )
    precinct = Precinct(
        id=uuid.uuid4(), name=f"Depot {suffix}", principal_organization_id=client_org.id,
        latitude="0", longitude="0",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=operator.id, full_name=f"Driver {suffix}",
        id_number=f"8001015{suffix}", phone_number=f"+2782{suffix}", license_number=f"DRV-{suffix}",
        idvs_status=IdvsStatus.PENDING,
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=operator.id, vehicle_type=VehicleType.HORSE,
        registration=f"CA {suffix}H", pulsit_device_id=f"PUL-H-{suffix}",
    )
    trailer = Vehicle(
        id=uuid.uuid4(), organization_id=operator.id, vehicle_type=VehicleType.TRAILER,
        registration=f"CA {suffix}T", pulsit_device_id=f"PUL-T-{suffix}",
    )
    db_session.add_all([user, precinct, driver, horse, trailer])
    await db_session.flush()
    return {
        "org": operator, "user": user, "precinct": precinct, "driver": driver, "horse": horse,
        "trailer": trailer,
    }


@pytest_asyncio.fixture
async def world(db_session: AsyncSession) -> dict[str, Any]:
    return await _organisation(db_session, "Operator")


async def _trip(
    db_session: AsyncSession, org: dict[str, Any], *, departure: datetime,
    status: TripStatus = TripStatus.CREATED, reference: str | None = None,
) -> Trip:
    trip = Trip(
        id=uuid.uuid4(), trip_reference=reference or f"FP-AV-{uuid.uuid4().hex[:6].upper()}",
        operator_organization_id=org["org"].id, driver_id=org["driver"].id, horse_id=org["horse"].id,
        origin_precinct_id=org["precinct"].id, destination_precinct_id=org["precinct"].id,
        status=status, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=departure, planned_arrival_at=departure + _TRIP_LENGTH,
        created_by_user_id=org["user"].id,
    )
    db_session.add(trip)
    await db_session.flush()
    db_session.add(TripTrailer(
        trip_id=trip.id, trailer_id=org["trailer"].id, pulsit_device_id_snapshot=org["trailer"].pulsit_device_id,
    ))
    await db_session.flush()
    return trip


def _headers(org: dict[str, Any]) -> dict[str, str]:
    return auth_header(make_token(sub=str(org["user"].id), role="dispatcher", org_id=str(org["org"].id)))


async def _busy(client: AsyncClient, org: dict[str, Any], start: datetime, end: datetime) -> list[dict[str, Any]]:
    resp = await client.get(_URL, params={"start": start.isoformat(), "end": end.isoformat()}, headers=_headers(org))
    assert resp.status_code == 200, resp.text
    return resp.json()["busy"]


async def test_availability_lists_the_busy_driver_horse_and_trailer(
    client: AsyncClient, db_session: AsyncSession, world: dict[str, Any],
):
    departure = datetime.now(UTC) + timedelta(days=1)
    trip = await _trip(db_session, world, departure=departure, reference="FP-AV-BUSY")

    busy = await _busy(client, world, departure + timedelta(hours=2), departure + timedelta(hours=4))

    assert [(b["resource_type"], b["label"]) for b in busy] == [
        ("driver", world["driver"].full_name),
        ("horse", world["horse"].registration),
        ("trailer", world["trailer"].registration),
    ]
    assert {b["trip_id"] for b in busy} == {str(trip.id)}
    assert {b["trip_reference"] for b in busy} == {"FP-AV-BUSY"}
    assert datetime.fromisoformat(busy[0]["busy_until"]) == departure + _TRIP_LENGTH


async def test_availability_is_empty_when_nothing_overlaps(
    client: AsyncClient, db_session: AsyncSession, world: dict[str, Any],
):
    departure = datetime.now(UTC) + timedelta(days=1)
    await _trip(db_session, world, departure=departure)

    busy = await _busy(client, world, departure + 2 * _TRIP_LENGTH, departure + 3 * _TRIP_LENGTH)

    assert busy == []


async def test_availability_window_touching_a_trips_end_is_free(
    client: AsyncClient, db_session: AsyncSession, world: dict[str, Any],
):
    """FP-175: asking from the moment a trip is due back finds the crew free ([start, end))."""
    departure = datetime.now(UTC) + timedelta(days=1)
    await _trip(db_session, world, departure=departure)

    busy = await _busy(client, world, departure + _TRIP_LENGTH, departure + 2 * _TRIP_LENGTH)

    assert busy == []


@pytest.mark.parametrize("status", [TripStatus.CLOSED, TripStatus.CANCELLED])
async def test_availability_leaves_out_ended_trips(
    client: AsyncClient, db_session: AsyncSession, world: dict[str, Any], status: TripStatus,
):
    departure = datetime.now(UTC) + timedelta(days=1)
    await _trip(db_session, world, departure=departure, status=status)

    busy = await _busy(client, world, departure, departure + _TRIP_LENGTH)

    assert busy == []


async def test_availability_shows_an_overrunning_live_trip_as_busy_until_closed(
    client: AsyncClient, db_session: AsyncSession, world: dict[str, Any],
):
    overran = datetime.now(UTC) - 2 * _TRIP_LENGTH
    await _trip(db_session, world, departure=overran, status=TripStatus.ACTIVE)
    later = datetime.now(UTC) + timedelta(days=2)

    busy = await _busy(client, world, later, later + _TRIP_LENGTH)

    assert len(busy) == 3
    assert all(b["busy_until"] is None for b in busy)
    assert all(datetime.fromisoformat(b["planned_until"]) == overran + _TRIP_LENGTH for b in busy)


async def test_availability_never_shows_another_organisations_trips(
    client: AsyncClient, db_session: AsyncSession, world: dict[str, Any],
):
    other = await _organisation(db_session, "Other operator")
    departure = datetime.now(UTC) + timedelta(days=1)
    await _trip(db_session, other, departure=departure)

    busy = await _busy(client, world, departure, departure + _TRIP_LENGTH)

    assert busy == []


async def test_availability_route_is_not_swallowed_by_trip_id(client: AsyncClient, world: dict[str, Any]):
    """Declared before GET /trips/{trip_id}; otherwise "availability" would 422 as a bad UUID."""
    now = datetime.now(UTC)

    resp = await client.get(
        _URL, params={"start": now.isoformat(), "end": (now + _TRIP_LENGTH).isoformat()}, headers=_headers(world),
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["busy"] == []


async def test_availability_422_when_end_is_not_after_start(client: AsyncClient, world: dict[str, Any]):
    now = datetime.now(UTC)

    resp = await client.get(_URL, params={"start": now.isoformat(), "end": now.isoformat()}, headers=_headers(world))

    assert resp.status_code == 422


async def test_availability_422_for_a_time_without_a_zone(client: AsyncClient, world: dict[str, Any]):
    resp = await client.get(
        _URL, params={"start": "2026-10-16T08:00:00", "end": "2026-10-16T16:00:00"}, headers=_headers(world),
    )

    assert resp.status_code == 422


async def test_availability_without_a_token_is_refused(client: AsyncClient):
    """Every dispatcher route answers a missing token with 403 (auth.dependencies.get_current_dispatcher)."""
    now = datetime.now(UTC)

    resp = await client.get(_URL, params={"start": now.isoformat(), "end": (now + _TRIP_LENGTH).isoformat()})

    assert resp.status_code == 403


async def test_availability_is_refused_to_a_driver(client: AsyncClient, world: dict[str, Any]):
    now = datetime.now(UTC)

    resp = await client.get(
        _URL, params={"start": now.isoformat(), "end": (now + _TRIP_LENGTH).isoformat()},
        headers=auth_header(make_token(sub=str(world["driver"].id), role="driver")),
    )

    assert resp.status_code == 403
