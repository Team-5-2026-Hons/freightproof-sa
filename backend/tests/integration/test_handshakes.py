"""Integration tests for the H1-H5 handshake endpoints and the polling GET."""

import uuid

import pytest_asyncio
from httpx import AsyncClient

from app.db.models.enums import IdvsStatus, OrganizationType, PhaseStatus, PhaseType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
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
        id=uuid.uuid4(), trip_reference="FP-TEST-H", order_number="ORD-H",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    # Hand-built single-leg phase plan, mirroring what create_trip actually
    # produces: the plan generator (task 2.1) writes every row `pending` at
    # trip creation, but create_trip then completes TRIP_CREATION (h0) inline
    # once its Hedera anchor succeeds (see trip_service.create_trip) — so h0
    # is seeded COMPLETED here and every driver-facing row stays PENDING
    # before any endpoint call (the deleted _get_handshake_event no longer
    # creates them on demand). IN_TRANSIT (P4) is included: advance_departure
    # auto-completes it as a stopgap until real checkpoint-Merkle-batch wiring
    # lands — see _auto_complete_in_transit's docstring in phase_service.py.
    stop0 = TripStop(trip_id=trip.id, precinct_id=origin.id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=dest.id, sequence=1)
    db_session.add_all([stop0, stop1])
    await db_session.flush()
    db_session.add_all([
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION, sequence_number=0, status=PhaseStatus.COMPLETED),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.ACTIVATION, trip_stop_id=stop0.id, sequence_number=1, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.LOADING, trip_stop_id=stop0.id, sequence_number=2, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.DEPARTURE, trip_stop_id=stop0.id, sequence_number=3, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.IN_TRANSIT, trip_stop_id=stop0.id, sequence_number=4, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop1.id, sequence_number=5, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id, sequence_number=6, status=PhaseStatus.PENDING),
    ])
    await db_session.flush()

    return trip, driver


async def test_h1_complete_returns_200(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/handshakes/h1/complete",
        json={"driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"


async def test_h1_wrong_state_returns_409(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    trip.status = TripStatus.EXCEPTION_HOLD
    await db_session.flush()
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/handshakes/h1/complete",
        json={"driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 409


async def test_h1_unknown_driver_token_returns_401(client: AsyncClient, seed_trip):
    trip, _driver = seed_trip
    other_driver_id = uuid.uuid4()
    token = make_token(sub=str(other_driver_id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/handshakes/h1/complete",
        json={"driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 401  # other_driver doesn't exist as a Driver row -> get_current_driver 401s first


async def test_get_handshake_detail_returns_event(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    await client.post(
        f"/api/v1/trips/{trip.id}/handshakes/h1/complete",
        json={"driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    resp = await client.get(
        f"/api/v1/trips/{trip.id}/handshakes/activation",
        headers=auth_header(token),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"


async def test_get_handshake_detail_unknown_trip_returns_404(client: AsyncClient, seed_trip):
    """Every valid phase_type now always has a PhaseEvent row from trip creation
    (task 2.1), so a not-yet-reached phase_type on a real trip returns 200
    (status 'pending'), not 404 — the old create-on-demand premise this test
    used to exercise is gone (T2). 404 now comes from trip-ownership/existence
    checks only, exercised here and in the other-driver test below."""
    driver = seed_trip[1]
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.get(
        f"/api/v1/trips/{uuid.uuid4()}/handshakes/unloading",
        headers=auth_header(token),
    )
    assert resp.status_code == 404


async def test_get_handshake_detail_other_driver_returns_404(client: AsyncClient, db_session, seed_trip):
    """A driver must not be able to read another driver's handshake data (GPS, seal, counts)
    by guessing/observing a trip_id that isn't their own — see security review finding."""
    trip, driver = seed_trip
    owner_token = make_token(sub=str(driver.id), role="driver")
    await client.post(
        f"/api/v1/trips/{trip.id}/handshakes/h1/complete",
        json={"driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(owner_token),
    )

    other_org = Organization(id=uuid.uuid4(), name="Other Org", org_type=OrganizationType.OPERATOR)
    db_session.add(other_org)
    await db_session.flush()
    other_driver = Driver(
        id=uuid.uuid4(), organization_id=other_org.id, full_name="Other",
        id_number="8001015009088", phone_number="+27820000000", license_number="DRV-X",
    )
    db_session.add(other_driver)
    await db_session.flush()

    other_token = make_token(sub=str(other_driver.id), role="driver")
    resp = await client.get(
        f"/api/v1/trips/{trip.id}/handshakes/activation",
        headers=auth_header(other_token),
    )
    assert resp.status_code == 404
