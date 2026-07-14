"""Integration test for consignment_id/trip_stop_id scoping FKs on TripException (FP-112 alignment)."""

import uuid

import pytest_asyncio
from httpx import AsyncClient

from app.db.models.enums import (
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    TripStatus,
    VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Trip, TripStop
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
async def seed_trip_with_consignment_and_stop(db_session):
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
        id=uuid.uuid4(), trip_reference="FP-TEST-EXC-SCOPE", order_number="ORD-EXC-SCOPE",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.IN_TRANSIT, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="PP-EXC-SCOPE",
        client_organization_id=client_org.id, parcel_count_expected=3,
    )
    db_session.add(consignment)
    await db_session.flush()

    trip_stop = TripStop(
        id=uuid.uuid4(), trip_id=trip.id, precinct_id=dest.id, sequence=1,
    )
    db_session.add(trip_stop)
    await db_session.flush()

    return trip, consignment, trip_stop, user, org


async def test_get_trip_detail_returns_exception_scoping_fields(
    client: AsyncClient, db_session, seed_trip_with_consignment_and_stop,
):
    trip, consignment, trip_stop, user, org = seed_trip_with_consignment_and_stop

    scoped_exception = TripException(
        id=uuid.uuid4(), trip_id=trip.id,
        consignment_id=consignment.id, trip_stop_id=trip_stop.id,
        exception_type=ExceptionType.PARCEL_COUNT_MISMATCH, source=ExceptionSource.SYSTEM,
        severity=ExceptionSeverity.WARNING, description="Scoped to one client's cargo at one stop.",
    )
    unscoped_exception = TripException(
        id=uuid.uuid4(), trip_id=trip.id,
        consignment_id=None, trip_stop_id=None,
        exception_type=ExceptionType.ROUTE_DEVIATION, source=ExceptionSource.SYSTEM,
        severity=ExceptionSeverity.INFO, description="Trip-level, unscoped exception.",
    )
    db_session.add_all([scoped_exception, unscoped_exception])
    await db_session.flush()

    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))
    resp = await client.get(f"/api/v1/trips/{trip.id}", headers=auth_header(token))

    assert resp.status_code == 200
    body = resp.json()
    exceptions_by_id = {e["id"]: e for e in body["exceptions"]}

    assert exceptions_by_id[str(scoped_exception.id)]["consignment_id"] == str(consignment.id)
    assert exceptions_by_id[str(scoped_exception.id)]["trip_stop_id"] == str(trip_stop.id)

    assert exceptions_by_id[str(unscoped_exception.id)]["consignment_id"] is None
    assert exceptions_by_id[str(unscoped_exception.id)]["trip_stop_id"] is None
