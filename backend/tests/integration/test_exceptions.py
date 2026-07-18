"""Integration tests for POST /trips/{id}/exceptions (driver-raised exceptions)."""

import uuid

import pytest_asyncio
from httpx import AsyncClient

from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
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


@pytest_asyncio.fixture
async def seed_trip(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-EXC", order_number="ORD-EXC",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.IN_TRANSIT, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    return trip, driver


async def test_driver_raises_panic_exception(client: AsyncClient, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/exceptions",
        json={"exception_type": "panic_button", "description": "Driver pressed panic button."},
        headers=auth_header(token),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["severity"] == "critical"
    assert body["source"] == "driver"


async def test_driver_raises_panic_exception_with_gps_persists_coordinates(
    client: AsyncClient, db_session, seed_trip,
):
    """Regression guard for the panic-button GPS-drop bug: the API must accept
    gps_lat/gps_lng and the row actually in the DB must carry them — not just the
    response body, since a response-only check would miss a service-layer that
    validates the field but never passes it to the model."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/exceptions",
        json={
            "exception_type": "panic_button",
            "description": "Driver pressed panic button.",
            "gps_lat": "-26.0942000",
            "gps_lng": "28.1342000",
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["gps_lat"] == "-26.0942000" or float(body["gps_lat"]) == -26.0942
    assert body["gps_lng"] == "28.1342000" or float(body["gps_lng"]) == 28.1342

    row = await db_session.get(TripException, uuid.UUID(body["id"]))
    assert row is not None
    assert float(row.gps_lat) == -26.0942
    assert float(row.gps_lng) == 28.1342


async def test_driver_raises_exception_with_lat_only_returns_422(client: AsyncClient, seed_trip):
    """Both-or-neither is enforced at the schema layer — a partial fix must never
    reach the DB as a nonsense (lat, no lng) coordinate."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/exceptions",
        json={
            "exception_type": "panic_button",
            "description": "Driver pressed panic button.",
            "gps_lat": "-26.0942000",
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 422


async def test_driver_cannot_raise_exception_on_someone_elses_trip(client: AsyncClient, db_session, seed_trip):
    trip, _driver = seed_trip
    org = Organization(id=uuid.uuid4(), name="Other Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    other_driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Other",
        id_number="8001015009088", phone_number="+27820000000", license_number="DRV-X",
    )
    db_session.add(other_driver)
    await db_session.flush()

    token = make_token(sub=str(other_driver.id), role="driver")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/exceptions",
        json={"exception_type": "panic_button", "description": "x"},
        headers=auth_header(token),
    )
    assert resp.status_code == 403


async def test_driver_raises_exception_on_unknown_trip_returns_404(client: AsyncClient, db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    db_session.add(driver)
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.post(
        f"/api/v1/trips/{uuid.uuid4()}/exceptions",
        json={"exception_type": "panic_button", "description": "x"},
        headers=auth_header(token),
    )
    assert resp.status_code == 404
