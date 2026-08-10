"""Integration tests for POST /trips/{id}/exceptions (driver-raised exceptions)."""

import uuid

import pytest_asyncio
from httpx import AsyncClient

from app.db.models.enums import (
    IdvsStatus, OrganizationType, PhaseStatus, PhaseType, TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
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
        id=uuid.uuid4(), trip_reference="FP-TEST-EXC", order_number="ORD-EXC",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
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


@pytest_asyncio.fixture
async def seed_trip_with_plan(db_session, seed_trip):
    """seed_trip plus the 7-row single-leg plan, positioned mid-drive: everything
    through departure COMPLETED, in_transit PENDING (it stays PENDING for the whole
    drive), unloading/confirmation still ahead.

    This is the state the driver is in when they press panic on the road — the exact
    scenario whose placement used to drift."""
    trip, driver = seed_trip

    stop0 = TripStop(trip_id=trip.id, precinct_id=trip.origin_precinct_id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=trip.destination_precinct_id, sequence=1)
    db_session.add_all([stop0, stop1])
    await db_session.flush()

    phases = {
        "trip_creation": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION,
            sequence_number=0, status=PhaseStatus.COMPLETED,
        ),
        "activation": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.ACTIVATION, trip_stop_id=stop0.id,
            sequence_number=1, status=PhaseStatus.COMPLETED,
        ),
        "loading": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.LOADING, trip_stop_id=stop0.id,
            sequence_number=2, status=PhaseStatus.COMPLETED,
        ),
        "departure": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.DEPARTURE, trip_stop_id=stop0.id,
            sequence_number=3, status=PhaseStatus.COMPLETED,
        ),
        "in_transit": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.IN_TRANSIT, trip_stop_id=stop0.id,
            sequence_number=4, status=PhaseStatus.PENDING,
        ),
        "unloading": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop1.id,
            sequence_number=5, status=PhaseStatus.PENDING,
        ),
        "confirmation": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id,
            sequence_number=6, status=PhaseStatus.PENDING,
        ),
    }
    db_session.add_all(phases.values())
    await db_session.flush()

    return trip, driver, phases


async def test_panic_stores_the_phase_the_driver_reported_it_from(
    client: AsyncClient, db_session, seed_trip_with_plan,
):
    """The driver app resolves its own phase context and sends it; the row must store
    that id verbatim, plus the stop the phase is anchored to."""
    trip, driver, phases = seed_trip_with_plan
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/exceptions",
        json={
            "exception_type": "panic_button",
            "description": "Driver activated panic button.",
            "phase_event_id": str(phases["in_transit"].id),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["phase_event_id"] == str(phases["in_transit"].id)

    row = await db_session.get(TripException, uuid.UUID(body["id"]))
    assert row is not None
    assert row.phase_event_id == phases["in_transit"].id
    assert row.trip_stop_id == phases["in_transit"].trip_stop_id


async def test_offline_panic_flushed_after_arrival_keeps_its_in_transit_phase(
    client: AsyncClient, db_session, seed_trip_with_plan,
):
    """THE regression. A panic pressed at 15:17 in transit sits in the driver app's
    offline queue; by the time signal returns the trip has reached confirmation. The
    client-supplied phase must win over anything derived from the trip's position at
    request time, or the alert is filed against confirmation — which is precisely the
    drift that made an exception appear to move between phases."""
    trip, driver, phases = seed_trip_with_plan
    captured_phase_event_id = phases["in_transit"].id
    # The trip advances while the alert is stuck in the queue.
    phases["in_transit"].status = PhaseStatus.COMPLETED
    phases["unloading"].status = PhaseStatus.COMPLETED
    await db_session.flush()
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/exceptions",
        json={
            "exception_type": "panic_button",
            "description": "Driver activated panic button.",
            "phase_event_id": str(captured_phase_event_id),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 201
    row = await db_session.get(TripException, uuid.UUID(resp.json()["id"]))
    assert row is not None
    assert row.phase_event_id == captured_phase_event_id
    assert row.phase_event_id != phases["confirmation"].id


async def test_seal_broken_in_transit_and_mechanical_are_tagged_to_the_drive(
    client: AsyncClient, db_session, seed_trip_with_plan,
):
    """Both are raised from the in-transit hub and are IN_TRANSIT events by definition —
    neither may land untagged and be inferred onto a neighbouring phase."""
    trip, driver, phases = seed_trip_with_plan
    token = make_token(sub=str(driver.id), role="driver")

    for exception_type in ("seal_broken_in_transit", "mechanical"):
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/exceptions",
            json={
                "exception_type": exception_type,
                "description": f"{exception_type} on the road.",
                "phase_event_id": str(phases["in_transit"].id),
            },
            headers=auth_header(token),
        )

        assert resp.status_code == 201, exception_type
        row = await db_session.get(TripException, uuid.UUID(resp.json()["id"]))
        assert row is not None
        assert row.phase_event_id == phases["in_transit"].id, exception_type


async def test_exception_without_phase_event_id_is_tagged_by_the_server(
    client: AsyncClient, db_session, seed_trip_with_plan,
):
    """An older installed client sends no phase context. The server derives placement
    ONCE, at creation, and freezes it — still far better than the dispatcher inferring
    it on every render, which is what produced the moving exception."""
    trip, driver, phases = seed_trip_with_plan
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/exceptions",
        json={"exception_type": "panic_button", "description": "No phase context sent."},
        headers=auth_header(token),
    )

    assert resp.status_code == 201
    row = await db_session.get(TripException, uuid.UUID(resp.json()["id"]))
    assert row is not None
    assert row.phase_event_id == phases["in_transit"].id


async def test_exception_with_a_foreign_phase_event_id_still_records(
    client: AsyncClient, db_session, seed_trip_with_plan,
):
    """A phase id that isn't on this trip is dropped and re-derived, NOT rejected. The
    driver app's offline queue treats 4xx as terminal and discards the entry, so a 422
    here would silently lose a panic alert to a stale client."""
    trip, driver, phases = seed_trip_with_plan
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/exceptions",
        json={
            "exception_type": "panic_button",
            "description": "Stale client.",
            "phase_event_id": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 201
    row = await db_session.get(TripException, uuid.UUID(resp.json()["id"]))
    assert row is not None
    assert row.phase_event_id == phases["in_transit"].id
