"""Integration tests for GET /trips/me/active (driver PWA home screen)."""

import uuid

import pytest_asyncio
from httpx import AsyncClient

from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, IdvsStatus, OrganizationType, SubjectType, TripStatus, VehicleType,
)
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


async def test_active_trip_returns_null_when_no_active_trip(client: AsyncClient, db_session):
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
    resp = await client.get("/api/v1/trips/me/active", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json() is None


async def test_active_trip_returns_trip_when_one_exists(client: AsyncClient, db_session):
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
        id=uuid.uuid4(), trip_reference="FP-TEST-ACTIVE", order_number="ORD-ACTIVE",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me/active", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["id"] == str(trip.id)


async def test_active_trip_excludes_closed_trips(client: AsyncClient, db_session):
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
        id=uuid.uuid4(), trip_reference="FP-TEST-CLOSED", order_number="ORD-CLOSED",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CLOSED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me/active", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json() is None


async def test_underway_trip_outranks_newer_created_assignment(client: AsyncClient, db_session):
    """A trip the driver has ACTIVATED outranks a more recently assigned one.

    Was test_two_active_trips_returns_newest_not_500, which asserted the opposite —
    newest-by-created_at wins outright. That is the bug this test now pins the fix for:
    a dispatcher assigning tomorrow's trip mid-journey made the PWA's Home screen swap
    to that un-activated assignment, so the driver's Active tab showed a 'created' trip
    while the trip they were physically driving disappeared from view.

    An un-activated assignment is Upcoming, never Active. The multiple-rows guard the old
    test existed for is kept by test_two_underway_trips_returns_newest_not_500 below.
    """
    from datetime import UTC, datetime, timedelta

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

    held = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-HELD", order_number="ORD-HELD",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.EXCEPTION_HOLD, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
        created_at=datetime.now(UTC) - timedelta(hours=2),
    )
    newer = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-NEWER", order_number="ORD-NEWER",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add_all([held, newer])
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me/active", headers=auth_header(token))

    assert resp.status_code == 200
    # The held trip, despite being two hours older: a held trip is still the trip the
    # driver is on, just blocked from advancing.
    assert resp.json()["id"] == str(held.id)


async def test_two_underway_trips_returns_newest_not_500(client: AsyncClient, db_session):
    """Two trips at the SAME rank must resolve to one row, not crash.

    Inherited from the old test_two_active_trips_returns_newest_not_500: more than one
    non-terminal trip per driver is legitimate, so scalar_one_or_none() would 500 the
    driver. Within a single rank, newest-first decides.
    """
    from datetime import UTC, datetime, timedelta

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

    older = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-OLDER-ACTIVE", order_number="ORD-OLDER",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
        created_at=datetime.now(UTC) - timedelta(hours=2),
    )
    newer = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-NEWER-ACTIVE", order_number="ORD-NEWER",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add_all([older, newer])
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me/active", headers=auth_header(token))

    assert resp.status_code == 200
    assert resp.json()["id"] == str(newer.id)


async def test_created_only_trip_is_still_returned_so_driver_can_activate(
    client: AsyncClient, db_session
):
    """A driver whose ONLY trip is an un-activated assignment must still be handed it.

    Pins the deliberate fallback in get_active_trip_for_driver: the Activation phase is
    reached through this endpoint, so excluding CREATED outright would leave a driver
    unable to ever start work.
    """
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
        id=uuid.uuid4(), trip_reference="FP-TEST-ONLY-CREATED", order_number="ORD-ONLY-CREATED",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me/active", headers=auth_header(token))

    assert resp.status_code == 200
    assert resp.json()["id"] == str(trip.id)


async def test_active_trip_includes_receipts_for_driver(client: AsyncClient, db_session):
    """Pins the deliberate asymmetry with GET /trips/{id}: the driver's own active
    trip must keep its blockchain_receipts (PWA anchor UI renders them), unlike the
    dispatcher detail endpoint which strips receipts for non-admin roles."""
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
        id=uuid.uuid4(), trip_reference="FP-TEST-RECEIPTS", order_number="ORD-RECEIPTS",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    # Simulate the H0 journey-lock anchor recorded at trip creation.
    h0_receipt = BlockchainReceipt(
        id=uuid.uuid4(), trip_id=trip.id,
        subject_type=SubjectType.TRIP, subject_id=trip.id,
        receipt_type=BlockchainReceiptType.JOURNEY_LOCK,
        data_hash="a" * 64,
        payload_json={"note": "h0-journey-lock-test-receipt"},
    )
    db_session.add(h0_receipt)
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me/active", headers=auth_header(token))
    assert resp.status_code == 200

    body = resp.json()
    assert "blockchain_receipts" in body
    # anchored seed trip -> at least the H0 anchor receipt must be visible.
    assert isinstance(body["blockchain_receipts"], list)
    assert len(body["blockchain_receipts"]) >= 1
    assert body["blockchain_receipts"][0]["id"] == str(h0_receipt.id)
