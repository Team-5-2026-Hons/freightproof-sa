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
    assert "consignments" not in body
    assert body["vehicle_registration"] == "ABC123GP"


async def test_dispatcher_gets_full_manifest_with_parcels(client: AsyncClient, seed_trip_with_consignment):
    trip, _driver, user, org = seed_trip_with_consignment
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    resp = await client.get(f"/api/v1/trips/{trip.id}/manifest", headers=auth_header(token))

    assert resp.status_code == 200
    body = resp.json()
    assert body["total_parcel_count"] == 3
    assert len(body["consignments"][0]["stops"][0]["parcels"]) == 3


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


@pytest_asyncio.fixture
async def seed_trip_with_two_consignments(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_a = Organization(id=uuid.uuid4(), name="Client A", org_type=OrganizationType.PRINCIPAL)
    client_b = Organization(id=uuid.uuid4(), name="Client B", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_a, client_b])
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email="d2@test.co.za", full_name="D2")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver2",
        id_number="8001015009088", phone_number="+27821234568", license_number="DRV-2",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="XYZ456GP", pulsit_device_id="PUL-2",
    )
    origin = Precinct(id=uuid.uuid4(), name="O2", principal_organization_id=client_a.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D2", principal_organization_id=client_a.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-6", order_number="ORD-6",
        operator_organization_id=org.id, client_organization_id=None,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.LOADING, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    cons_a = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="PP-A",
        client_organization_id=client_a.id, parcel_count_expected=5, unit_count_expected=10,
    )
    cons_b = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="PP-B",
        client_organization_id=client_b.id, parcel_count_expected=2, unit_count_expected=4,
    )
    db_session.add_all([cons_a, cons_b])
    await db_session.flush()
    for i in range(5):
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=cons_a.id, barcode=f"BC-A-{i}",
            delivery_stop="Stop A", status=ParcelStatus.SCANNED_OUT,
        ))
    for i in range(2):
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=cons_b.id, barcode=f"BC-B-{i}",
            delivery_stop="Stop B", status=ParcelStatus.SCANNED_OUT,
        ))
    await db_session.flush()
    return trip, cons_a, cons_b, driver, user, org


async def test_dispatcher_manifest_multi_consignment_returns_all(
    client: AsyncClient, seed_trip_with_two_consignments,
):
    trip, cons_a, cons_b, _driver, user, org = seed_trip_with_two_consignments
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    resp = await client.get(f"/api/v1/trips/{trip.id}/manifest", headers=auth_header(token))

    assert resp.status_code == 200
    body = resp.json()
    returned_ids = {c["consignment_id"] for c in body["consignments"]}
    assert returned_ids == {str(cons_a.id), str(cons_b.id)}
    # Per-client grouping: each consignment carries its own client org.
    clients = {c["client_organization_id"] for c in body["consignments"]}
    assert len(clients) == 2


async def test_driver_linehaul_multi_consignment_sums_unit_counts(
    client: AsyncClient, seed_trip_with_two_consignments,
):
    trip, _cons_a, _cons_b, driver, _user, _org = seed_trip_with_two_consignments  # unit_count_expected: 10 and 4

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get(f"/api/v1/trips/{trip.id}/manifest", headers=auth_header(token))

    assert resp.status_code == 200
    body = resp.json()
    assert body["consolidated_unit_count"] == 14
    # Theft-risk rule: the driver response must never contain parcel-grain data.
    assert "consignments" not in body
    assert "parcels" not in body


async def test_driver_linehaul_falls_back_to_parcel_count_when_no_unit_counts(
    client: AsyncClient, seed_trip_with_consignment,
):
    # Legacy consignment (unit_count_expected=None, 3 parcels) keeps pre-FP-112 behaviour.
    trip, driver, _user, _org = seed_trip_with_consignment

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get(f"/api/v1/trips/{trip.id}/manifest", headers=auth_header(token))

    assert resp.status_code == 200
    assert resp.json()["consolidated_unit_count"] == 3


@pytest_asyncio.fixture
async def seed_trip_with_mixed_unit_counts(db_session):
    """One FP-112 consignment with unit_count_expected set, one legacy consignment
    without it — the fallback must apply per-consignment, not per-trip."""
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_a = Organization(id=uuid.uuid4(), name="Client A", org_type=OrganizationType.PRINCIPAL)
    client_b = Organization(id=uuid.uuid4(), name="Client B", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_a, client_b])
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email="d3@test.co.za", full_name="D3")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver3",
        id_number="8001015009089", phone_number="+27821234569", license_number="DRV-3",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="LMN789GP", pulsit_device_id="PUL-3",
    )
    origin = Precinct(id=uuid.uuid4(), name="O3", principal_organization_id=client_a.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D3", principal_organization_id=client_a.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-7", order_number="ORD-7",
        operator_organization_id=org.id, client_organization_id=None,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.LOADING, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    # FP-112 consignment: unit_count_expected set — its 3 parcels are ignored for the count.
    cons_a = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="PP-C",
        client_organization_id=client_a.id, parcel_count_expected=3, unit_count_expected=10,
    )
    # Legacy consignment: no unit_count_expected — falls back to its own parcel count (5).
    cons_b = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="PP-D",
        client_organization_id=client_b.id, parcel_count_expected=5, unit_count_expected=None,
    )
    db_session.add_all([cons_a, cons_b])
    await db_session.flush()
    for i in range(3):
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=cons_a.id, barcode=f"BC-C-{i}",
            delivery_stop="Stop C", status=ParcelStatus.SCANNED_OUT,
        ))
    for i in range(5):
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=cons_b.id, barcode=f"BC-D-{i}",
            delivery_stop="Stop D", status=ParcelStatus.SCANNED_OUT,
        ))
    await db_session.flush()
    return trip, cons_a, cons_b, driver, user, org


async def test_driver_linehaul_mixed_unit_counts_applies_fallback_per_consignment(
    client: AsyncClient, seed_trip_with_mixed_unit_counts,
):
    # cons_a: unit_count_expected=10 (used as-is). cons_b: unit_count_expected=None,
    # 5 parcels (fallback applies to cons_b only) -- expected total is 10 + 5 = 15,
    # not 10 (which would mean cons_b's parcels were silently dropped).
    trip, _cons_a, _cons_b, driver, _user, _org = seed_trip_with_mixed_unit_counts

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get(f"/api/v1/trips/{trip.id}/manifest", headers=auth_header(token))

    assert resp.status_code == 200
    assert resp.json()["consolidated_unit_count"] == 15
