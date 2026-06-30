"""Integration tests for GET /trips/{id}/manifest — role-aware (Linehaul vs full manifest)."""

import uuid

import pytest_asyncio
from httpx import AsyncClient

from app.db.models.enums import IdvsStatus, OrganizationType, ParcelStatus, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Consignment, Parcel, Trip
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
async def seed_trip_with_consignment(db_session):
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
        id=uuid.uuid4(), trip_reference="FP-TEST-5", order_number="ORD-5",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.LOADING, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="PP-1",
        client_organization_id=client_org.id, parcel_count_expected=3,
    )
    db_session.add(consignment)
    await db_session.flush()
    for i in range(3):
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id, barcode=f"BC-{i}",
            delivery_stop="Stop A", status=ParcelStatus.SCANNED_OUT,
        ))
    await db_session.flush()
    return trip, driver, user, org


async def test_driver_gets_linehaul_without_parcel_detail(client: AsyncClient, seed_trip_with_consignment):
    trip, driver, _user, _org = seed_trip_with_consignment
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.get(f"/api/v1/trips/{trip.id}/manifest", headers=auth_header(token))

    assert resp.status_code == 200
    body = resp.json()
    assert body["consolidated_unit_count"] == 3
    assert "stops" not in body
    assert "parcels" not in body
    assert body["vehicle_registration"] == "ABC123GP"


async def test_dispatcher_gets_full_manifest_with_parcels(client: AsyncClient, seed_trip_with_consignment):
    trip, _driver, user, org = seed_trip_with_consignment
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    resp = await client.get(f"/api/v1/trips/{trip.id}/manifest", headers=auth_header(token))

    assert resp.status_code == 200
    body = resp.json()
    assert body["total_parcel_count"] == 3
    assert len(body["stops"][0]["parcels"]) == 3


async def test_dispatcher_from_other_org_gets_404(client: AsyncClient, db_session, seed_trip_with_consignment):
    trip, _driver, _user, _org = seed_trip_with_consignment
    other_org = Organization(id=uuid.uuid4(), name="Other", org_type=OrganizationType.OPERATOR)
    db_session.add(other_org)
    await db_session.flush()
    other_user = User(id=uuid.uuid4(), organization_id=other_org.id, email="other@test.co.za", full_name="Other")
    db_session.add(other_user)
    await db_session.flush()

    token = make_token(sub=str(other_user.id), role="dispatcher", org_id=str(other_org.id))
    resp = await client.get(f"/api/v1/trips/{trip.id}/manifest", headers=auth_header(token))
    assert resp.status_code == 404


async def test_no_auth_returns_403(client: AsyncClient, seed_trip_with_consignment):
    trip, _driver, _user, _org = seed_trip_with_consignment
    resp = await client.get(f"/api/v1/trips/{trip.id}/manifest")
    assert resp.status_code == 403


async def test_other_driver_cannot_read_this_trips_linehaul(
    client: AsyncClient, db_session, seed_trip_with_consignment,
):
    trip, _driver, _user, org = seed_trip_with_consignment
    other_driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Other",
        id_number="8001015009088", phone_number="+27820000000", license_number="DRV-X",
    )
    db_session.add(other_driver)
    await db_session.flush()

    token = make_token(sub=str(other_driver.id), role="driver")
    resp = await client.get(f"/api/v1/trips/{trip.id}/manifest", headers=auth_header(token))
    assert resp.status_code == 404
