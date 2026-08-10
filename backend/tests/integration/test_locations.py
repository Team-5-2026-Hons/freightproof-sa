"""Integration tests for POST /trips/{trip_id}/locations — the driver's location trail.

This endpoint replaced three manual "Capture GPS Location" steps in the PWA, so its
authorisation boundary is doing real work: it is the one place a driver can write raw
position data, and it must only ever accept their own fixes onto their own trip.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.locations import TripLocationPing
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def _seed_trip(db_session, *, status: TripStatus = TripStatus.ACTIVE) -> tuple[Trip, Driver]:
    """One operator org, one driver, one trip assigned to them."""
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4()}@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number=f"DRV-{uuid.uuid4().hex[:6]}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"AB{uuid.uuid4().hex[:5].upper()}", pulsit_device_id=f"PUL-{uuid.uuid4().hex[:6]}",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-LOC-{uuid.uuid4().hex[:6]}", order_number=f"ORD-{uuid.uuid4().hex[:6]}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=status, idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    return trip, driver


def _ping(*, lat: float = -26.0942, lng: float = 28.1342, context: str = "/trips", **overrides) -> dict:
    body = {
        "lat": lat, "lng": lng, "accuracy_m": 8.5, "context": context,
        "recorded_at": datetime.now(UTC).isoformat(),
    }
    body.update(overrides)
    return body


async def test_record_locations_persists_the_batch(client: AsyncClient, db_session):
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/locations",
        json={"pings": [_ping(context="/"), _ping(context="phase-submit")]},
        headers=auth_header(token),
    )

    assert resp.status_code == 201
    assert resp.json() == {"recorded": 2}
    stored = (await db_session.execute(
        select(TripLocationPing).where(TripLocationPing.trip_id == trip.id)
    )).scalars().all()
    assert {row.context for row in stored} == {"/", "phase-submit"}
    assert all(row.driver_id == driver.id for row in stored)


async def test_recorded_coordinates_survive_the_float_round_trip(client: AsyncClient, db_session):
    """Numeric(10, 7) fed a raw float stores -26.0941999...; the trail must say what the
    phone said, because a coordinate that drifts is a coordinate a dispute can attack."""
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/locations",
        json={"pings": [_ping(lat=-26.0942, lng=28.1342)]},
        headers=auth_header(token),
    )

    assert resp.status_code == 201
    stored = (await db_session.execute(
        select(TripLocationPing).where(TripLocationPing.trip_id == trip.id)
    )).scalars().one()
    assert float(stored.lat) == -26.0942
    assert float(stored.lng) == 28.1342


async def test_record_locations_stores_device_time_not_receipt_time(client: AsyncClient, db_session):
    """A replayed offline ping is hours older than its request. The trail is ordered by
    recorded_at, so the server must keep the device's timestamp rather than now()."""
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    captured_earlier = datetime.now(UTC) - timedelta(hours=3)

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/locations",
        json={"pings": [_ping(recorded_at=captured_earlier.isoformat())]},
        headers=auth_header(token),
    )

    assert resp.status_code == 201
    stored = (await db_session.execute(
        select(TripLocationPing).where(TripLocationPing.trip_id == trip.id)
    )).scalars().one()
    assert abs((stored.recorded_at - captured_earlier).total_seconds()) < 1


async def test_record_locations_rejects_an_unauthenticated_request(client: AsyncClient, db_session):
    """403, not 401 — get_current_driver answers a MISSING credential with 403 and keeps
    401 for a token it could not decode (app/auth/dependencies.py). Asserted here so the
    trail endpoint is pinned to the app's existing contract rather than its own."""
    trip, _ = await _seed_trip(db_session)

    resp = await client.post(f"/api/v1/trips/{trip.id}/locations", json={"pings": [_ping()]})

    assert resp.status_code == 403


async def test_record_locations_401_on_an_undecodable_token(client: AsyncClient, db_session):
    trip, _ = await _seed_trip(db_session)

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/locations",
        json={"pings": [_ping()]},
        headers=auth_header("not-a-jwt"),
    )

    assert resp.status_code == 401


async def test_record_locations_403_for_another_drivers_trip(client: AsyncClient, db_session):
    trip, _ = await _seed_trip(db_session)
    _, other_driver = await _seed_trip(db_session)
    token = make_token(sub=str(other_driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/locations",
        json={"pings": [_ping()]},
        headers=auth_header(token),
    )

    assert resp.status_code == 403
    stored = (await db_session.execute(
        select(TripLocationPing).where(TripLocationPing.trip_id == trip.id)
    )).scalars().all()
    assert stored == []


async def test_record_locations_404_for_an_unknown_trip(client: AsyncClient, db_session):
    _, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{uuid.uuid4()}/locations",
        json={"pings": [_ping()]},
        headers=auth_header(token),
    )

    assert resp.status_code == 404


async def test_record_locations_422_on_an_out_of_range_coordinate(client: AsyncClient, db_session):
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/locations",
        json={"pings": [_ping(lat=91.0)]},
        headers=auth_header(token),
    )

    assert resp.status_code == 422


async def test_record_locations_422_on_an_empty_batch(client: AsyncClient, db_session):
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/locations", json={"pings": []}, headers=auth_header(token),
    )

    assert resp.status_code == 422
