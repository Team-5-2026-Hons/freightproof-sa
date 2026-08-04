"""Integration tests for GET /trips/me and GET /trips/me/{trip_id} (driver PWA trip list).

These endpoints exist because the PWA's Upcoming and Past tabs previously read mock
fixtures filtered by the signed-in driver's real UUID — which matched no fixture, so both
tabs rendered permanently empty however many trips the dispatcher had actually assigned.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from httpx import AsyncClient

from app.db.models.enums import (
    IdvsStatus, OrganizationType, TripStatus, VehicleType,
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


async def _fixture_world(db_session):
    """Two orgs, one user, one horse and two named precincts — the minimum a Trip needs."""
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="Johannesburg Depot", principal_organization_id=client_org.id,
        latitude="0", longitude="0",
    )
    dest = Precinct(
        id=uuid.uuid4(), name="Cape Town Depot", principal_organization_id=client_org.id,
        latitude="1", longitude="1",
    )
    db_session.add_all([user, horse, origin, dest])
    await db_session.flush()
    return org, client_org, user, horse, origin, dest


async def _make_driver(db_session, org, *, name: str, id_number: str, license_number: str):
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name=name,
        id_number=id_number, phone_number="+27821234567", license_number=license_number,
    )
    db_session.add(driver)
    await db_session.flush()
    return driver


def _make_trip(*, org, client_org, user, driver, horse, origin, dest, reference, status, created_at=None):
    return Trip(
        id=uuid.uuid4(), trip_reference=reference, order_number=f"ORD-{reference}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=status, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
        **({"created_at": created_at} if created_at is not None else {}),
    )


async def test_list_my_trips_returns_every_status(client: AsyncClient, db_session):
    """The reported bug, as a test: one active trip plus two un-activated assignments must
    all come back, so the PWA can show Active=1 / Upcoming=2 rather than Active=1 and two
    permanently empty tabs."""
    org, client_org, user, horse, origin, dest = await _fixture_world(db_session)
    driver = await _make_driver(db_session, org, name="Driver", id_number="8001015009087", license_number="DRV-1")

    now = datetime.now(UTC)
    active = _make_trip(
        org=org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-ACTIVE", status=TripStatus.ACTIVE,
        created_at=now - timedelta(hours=3),
    )
    upcoming_a = _make_trip(
        org=org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UPCOMING-A", status=TripStatus.CREATED,
        created_at=now - timedelta(hours=2),
    )
    upcoming_b = _make_trip(
        org=org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UPCOMING-B", status=TripStatus.CREATED,
        created_at=now - timedelta(hours=1),
    )
    closed = _make_trip(
        org=org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-CLOSED", status=TripStatus.CLOSED,
        created_at=now - timedelta(days=1),
    )
    db_session.add_all([active, upcoming_a, upcoming_b, closed])
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me", headers=auth_header(token))

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 4
    by_status: dict[str, list[str]] = {}
    for row in body:
        by_status.setdefault(row["status"], []).append(row["trip_reference"])
    assert by_status["active"] == ["FP-ACTIVE"]
    assert sorted(by_status["created"]) == ["FP-UPCOMING-A", "FP-UPCOMING-B"]
    assert by_status["closed"] == ["FP-CLOSED"]
    # Newest first, so the list reads as a reverse-chronological assignment feed.
    assert [r["trip_reference"] for r in body] == [
        "FP-UPCOMING-B", "FP-UPCOMING-A", "FP-ACTIVE", "FP-CLOSED",
    ]


async def test_list_my_trips_resolves_precinct_names(client: AsyncClient, db_session):
    """Names are resolved server-side so the trip card can render a real
    origin -> destination instead of eight characters of a UUID."""
    org, client_org, user, horse, origin, dest = await _fixture_world(db_session)
    driver = await _make_driver(db_session, org, name="Driver", id_number="8001015009087", license_number="DRV-1")
    trip = _make_trip(
        org=org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-NAMES", status=TripStatus.CREATED,
    )
    db_session.add(trip)
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me", headers=auth_header(token))

    assert resp.status_code == 200
    row = resp.json()[0]
    assert row["origin_precinct_name"] == "Johannesburg Depot"
    assert row["destination_precinct_name"] == "Cape Town Depot"


async def test_list_my_trips_excludes_other_drivers_trips(client: AsyncClient, db_session):
    """driver_id from the verified token is the whole authorisation boundary."""
    org, client_org, user, horse, origin, dest = await _fixture_world(db_session)
    mine = await _make_driver(db_session, org, name="Mine", id_number="8001015009087", license_number="DRV-1")
    theirs = await _make_driver(db_session, org, name="Theirs", id_number="9002026009088", license_number="DRV-2")

    my_trip = _make_trip(
        org=org, client_org=client_org, user=user, driver=mine, horse=horse,
        origin=origin, dest=dest, reference="FP-MINE", status=TripStatus.CREATED,
    )
    their_trip = _make_trip(
        org=org, client_org=client_org, user=user, driver=theirs, horse=horse,
        origin=origin, dest=dest, reference="FP-THEIRS", status=TripStatus.CREATED,
    )
    db_session.add_all([my_trip, their_trip])
    await db_session.flush()

    token = make_token(sub=str(mine.id), role="driver")
    resp = await client.get("/api/v1/trips/me", headers=auth_header(token))

    assert resp.status_code == 200
    assert [r["trip_reference"] for r in resp.json()] == ["FP-MINE"]


async def test_list_my_trips_returns_empty_list_when_none_assigned(client: AsyncClient, db_session):
    org, _client_org, _user, _horse, _origin, _dest = await _fixture_world(db_session)
    driver = await _make_driver(db_session, org, name="Driver", id_number="8001015009087", license_number="DRV-1")

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me", headers=auth_header(token))

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_my_trips_rejects_missing_credentials(client: AsyncClient, db_session):
    resp = await client.get("/api/v1/trips/me")

    assert resp.status_code == 403


async def test_list_my_trips_rejects_dispatcher_token(client: AsyncClient, db_session):
    """A dispatcher has GET /trips for their whole org; this endpoint is driver-only."""
    org, _client_org, _user, _horse, _origin, _dest = await _fixture_world(db_session)

    token = make_token(sub=str(uuid.uuid4()), role="dispatcher")
    resp = await client.get("/api/v1/trips/me", headers=auth_header(token))

    assert resp.status_code == 403


async def test_my_trip_detail_returns_own_trip(client: AsyncClient, db_session):
    """An un-activated trip must be openable — that is what makes the Upcoming tab
    tappable, and it is where the driver activates the trip."""
    org, client_org, user, horse, origin, dest = await _fixture_world(db_session)
    driver = await _make_driver(db_session, org, name="Driver", id_number="8001015009087", license_number="DRV-1")
    trip = _make_trip(
        org=org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-OWN", status=TripStatus.CREATED,
    )
    db_session.add(trip)
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get(f"/api/v1/trips/me/{trip.id}", headers=auth_header(token))

    assert resp.status_code == 200
    assert resp.json()["id"] == str(trip.id)
    assert resp.json()["status"] == "created"


async def test_my_trip_detail_404s_on_another_drivers_trip(client: AsyncClient, db_session):
    """404, not 403: a 403 would confirm the trip exists, letting a driver probe for real
    trip ids. Both 'not yours' and 'not real' must be indistinguishable."""
    org, client_org, user, horse, origin, dest = await _fixture_world(db_session)
    mine = await _make_driver(db_session, org, name="Mine", id_number="8001015009087", license_number="DRV-1")
    theirs = await _make_driver(db_session, org, name="Theirs", id_number="9002026009088", license_number="DRV-2")
    their_trip = _make_trip(
        org=org, client_org=client_org, user=user, driver=theirs, horse=horse,
        origin=origin, dest=dest, reference="FP-THEIRS", status=TripStatus.ACTIVE,
    )
    db_session.add(their_trip)
    await db_session.flush()

    token = make_token(sub=str(mine.id), role="driver")
    resp = await client.get(f"/api/v1/trips/me/{their_trip.id}", headers=auth_header(token))

    assert resp.status_code == 404


async def test_my_trip_detail_404s_on_unknown_trip(client: AsyncClient, db_session):
    org, _client_org, _user, _horse, _origin, _dest = await _fixture_world(db_session)
    driver = await _make_driver(db_session, org, name="Driver", id_number="8001015009087", license_number="DRV-1")

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get(f"/api/v1/trips/me/{uuid.uuid4()}", headers=auth_header(token))

    assert resp.status_code == 404


async def test_my_trip_detail_422s_on_malformed_id(client: AsyncClient, db_session):
    org, _client_org, _user, _horse, _origin, _dest = await _fixture_world(db_session)
    driver = await _make_driver(db_session, org, name="Driver", id_number="8001015009087", license_number="DRV-1")

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me/not-a-uuid", headers=auth_header(token))

    assert resp.status_code == 422


async def test_me_route_is_not_swallowed_by_the_dispatcher_detail_route(
    client: AsyncClient, db_session
):
    """Route-ordering regression guard. GET /trips/{trip_id} is declared in the same
    router; registered before the literal /me paths it would match 'me' as a trip_id and
    422 on UUID parsing, silently breaking the driver's whole trip list."""
    org, _client_org, _user, _horse, _origin, _dest = await _fixture_world(db_session)
    driver = await _make_driver(db_session, org, name="Driver", id_number="8001015009087", license_number="DRV-1")

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.get("/api/v1/trips/me", headers=auth_header(token))

    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
