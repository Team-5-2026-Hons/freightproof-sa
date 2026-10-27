"""The "move the phone" control: guarded like move-truck, and independent of it.

Two halves, split by what they need, mirroring test_dev_pulsit.py:

  * The ROUTER REGISTRATION matrix needs no database. It is the half that keeps a
    demo-only position override off a host that did not ask for one, so it must never
    be the half that quietly skipped.

  * The BEHAVIOUR tests need a database and skip without one. They pin the two things a
    presenter depends on: a placement resolves to the right precinct on THIS trip, and
    releasing hands the fix back to the handset.

The ledger side — that a phase completed while a position is staged records
driver_position_source='simulated' — is unit-tested in
tests/unit/test_driver_position_provenance.py, against the one function every advance_*
goes through.
"""

import importlib
import uuid
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

import app.main as app_main
from app.core.config import settings
from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.dev.services import demo_phone as demo_phone_module
from app.dev.schemas import (
    PHONE_AT_DESTINATION,
    PHONE_AT_ORIGIN,
    PHONE_AT_STOP,
    PHONE_RELEASE,
)

from tests.conftest import FakeMockStateStore, auth_header, make_jwks, make_token, production_settings

_MOVE_URL = "/api/v1/dev/phone/move"

_ORIGIN_LAT, _ORIGIN_LNG = "-33.9249000", "18.4241000"
_DEST_LAT, _DEST_LNG = "-26.2041000", "28.0473000"



def _reload_with(*, panel: bool, mock: bool, environment: str = "development") -> list[str]:
    """Reload app.main under one flag combination and report the phone routes."""
    with production_settings(
        ENVIRONMENT=environment, DEV_PANEL_ENABLED=panel, PULSE_USE_MOCK=mock,
    ):
        try:
            importlib.reload(app_main)
            return [
                r.path for r in app_main.app.routes
                if isinstance(r, APIRoute) and r.path.startswith("/api/v1/dev/phone")
            ]
        finally:
            importlib.reload(app_main)


def test_route_registered_when_both_guards_pass() -> None:
    assert _reload_with(panel=True, mock=True) == [_MOVE_URL]


@pytest.mark.parametrize(("panel", "mock"), [(True, False), (False, True), (False, False)])
def test_route_absent_unless_both_guards_pass(panel: bool, mock: bool) -> None:
    """Fail closed, and as absence rather than 403.

    A 403 would tell a prober the override exists and is worth revisiting once the
    configuration changes. An unregistered path tells them nothing — and, more
    importantly, cannot be reached at all.
    """
    assert _reload_with(panel=panel, mock=mock) == []


def test_route_present_in_production_when_both_guards_pass() -> None:
    """Same deliberate deviation as move-truck: ENVIRONMENT is not a guard here.

    The deployed demo host runs ENVIRONMENT="production" to keep /docs unpublished, and
    that host is the one place this control is actually needed. The two flags that DO
    gate it both default to closed. See test_dev_pulsit.py's own version of this test.
    """
    assert _reload_with(panel=True, mock=True, environment="production") == [_MOVE_URL]



@pytest.fixture(scope="module")
def phone_app():
    original = (settings.DEV_PANEL_ENABLED, settings.PULSE_USE_MOCK, settings.ENVIRONMENT)
    settings.DEV_PANEL_ENABLED = True
    settings.PULSE_USE_MOCK = True
    settings.ENVIRONMENT = "development"
    importlib.reload(app_main)

    yield app_main.app

    (settings.DEV_PANEL_ENABLED, settings.PULSE_USE_MOCK, settings.ENVIRONMENT) = original
    importlib.reload(app_main)


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    """Dict-backed mock state, so these tests never need a real Redis."""
    fake = FakeMockStateStore()
    monkeypatch.setattr(demo_phone_module, "get_mock_state_store", lambda: fake)
    return fake


@pytest_asyncio.fixture
async def phone_client(
    phone_app, db_session, store: FakeMockStateStore, monkeypatch: pytest.MonkeyPatch
) -> AsyncGenerator[AsyncClient, None]:
    monkeypatch.setattr("app.auth.dependencies._get_jwks", make_jwks)

    async def _get_db():
        yield db_session

    phone_app.dependency_overrides[get_db] = _get_db
    async with AsyncClient(
        transport=ASGITransport(app=phone_app), base_url="http://test",
    ) as ac:
        yield ac
    phone_app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seeded(db_session):
    """An active two-stop trip, so origin and destination are genuinely different."""
    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="CA 123-456", pulsit_device_id="PLT-HORSE-001",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="Cape Town Depot", principal_organization_id=org.id,
        latitude=_ORIGIN_LAT, longitude=_ORIGIN_LNG, geofence_radius_metres=200,
    )
    destination = Precinct(
        id=uuid.uuid4(), name="Johannesburg Depot", principal_organization_id=org.id,
        latitude=_DEST_LAT, longitude=_DEST_LNG, geofence_radius_metres=200,
    )
    db_session.add_all([user, driver, horse, origin, destination])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id, current_stop=1,
    )
    db_session.add(trip)
    await db_session.flush()

    first = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=origin.id, sequence=1)
    last = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=destination.id, sequence=2)
    db_session.add_all([first, last])
    await db_session.flush()

    other_org = Organization(
        id=uuid.uuid4(), name="Other Op", org_type=OrganizationType.OPERATOR,
    )
    db_session.add(other_org)
    await db_session.flush()
    outsider = User(
        id=uuid.uuid4(), organization_id=other_org.id,
        email="outsider@test.co.za", full_name="Outsider",
    )
    db_session.add(outsider)
    await db_session.flush()

    return {
        "trip": trip, "org": org, "user": user,
        "origin": origin, "destination": destination, "first": first, "last": last,
        "other_org": other_org, "outsider": outsider,
    }


def _token(seeded) -> str:
    return make_token(sub=str(seeded["user"].id), role="dispatcher", org_id=str(seeded["org"].id))


async def _move(client: AsyncClient, seeded, placement: str, trip_stop_id: str | None = None):
    body: dict[str, object] = {"trip_id": str(seeded["trip"].id), "placement": placement}
    if trip_stop_id is not None:
        body["trip_stop_id"] = trip_stop_id
    return await client.post(_MOVE_URL, json=body, headers=auth_header(_token(seeded)))



async def test_at_origin_places_the_phone_at_the_first_stops_precinct(phone_client, seeded) -> None:
    response = await _move(phone_client, seeded, PHONE_AT_ORIGIN)

    assert response.status_code == 200
    body = response.json()
    assert body["staged"] is True
    assert body["precinct_name"] == "Cape Town Depot"
    assert body["trip_stop_id"] == str(seeded["first"].id)
    assert body["recorded_as"] == "simulated"


async def test_at_destination_places_the_phone_at_the_last_stops_precinct(phone_client, seeded) -> None:
    response = await _move(phone_client, seeded, PHONE_AT_DESTINATION)

    assert response.status_code == 200
    body = response.json()
    assert body["precinct_name"] == "Johannesburg Depot"
    assert body["trip_stop_id"] == str(seeded["last"].id)


async def test_the_staged_pair_is_the_precinct_centre(phone_client, seeded, store) -> None:
    await _move(phone_client, seeded, PHONE_AT_ORIGIN)

    staged = await demo_phone_module.staged_position(seeded["trip"].id, store=store)

    assert staged is not None
    assert str(staged[0]) == _ORIGIN_LAT
    assert str(staged[1]) == _ORIGIN_LNG


async def test_release_hands_the_fix_back_to_the_handset(phone_client, seeded, store) -> None:
    await _move(phone_client, seeded, PHONE_AT_ORIGIN)

    response = await _move(phone_client, seeded, PHONE_RELEASE)

    assert response.status_code == 200
    body = response.json()
    assert body["staged"] is False
    assert body["latitude"] is None
    assert body["recorded_as"] == "device"
    assert await demo_phone_module.staged_position(seeded["trip"].id, store=store) is None


async def test_at_stop_resolves_the_named_stop(phone_client, seeded) -> None:
    response = await _move(
        phone_client, seeded, PHONE_AT_STOP, trip_stop_id=str(seeded["last"].id),
    )

    assert response.status_code == 200
    assert response.json()["precinct_name"] == "Johannesburg Depot"


async def test_at_stop_without_a_stop_is_a_422(phone_client, seeded) -> None:
    response = await _move(phone_client, seeded, PHONE_AT_STOP)

    assert response.status_code == 422


async def test_an_unknown_placement_is_a_422(phone_client, seeded) -> None:
    """A closed vocabulary: the panel names a place, it never sends a coordinate."""
    response = await _move(phone_client, seeded, "somewhere_else")

    assert response.status_code == 422


async def test_a_foreign_trip_is_a_404(phone_client, seeded) -> None:
    other_org_token = make_token(
        sub=str(seeded["outsider"].id), role="dispatcher", org_id=str(seeded["other_org"].id),
    )

    response = await phone_client.post(
        _MOVE_URL,
        json={"trip_id": str(seeded["trip"].id), "placement": PHONE_AT_ORIGIN},
        headers=auth_header(other_org_token),
    )

    assert response.status_code == 404


async def test_a_driver_token_cannot_place_a_phone(phone_client, seeded) -> None:
    driver_token = make_token(
        sub=str(uuid.uuid4()), role="driver", org_id=str(seeded["org"].id),
    )

    response = await phone_client.post(
        _MOVE_URL,
        json={"trip_id": str(seeded["trip"].id), "placement": PHONE_AT_ORIGIN},
        headers=auth_header(driver_token),
    )

    assert response.status_code in (401, 403)


async def test_restaging_is_idempotent(phone_client, seeded, store) -> None:
    first = await _move(phone_client, seeded, PHONE_AT_ORIGIN)
    second = await _move(phone_client, seeded, PHONE_AT_ORIGIN)

    assert first.json() == second.json()
    assert await demo_phone_module.staged_position(seeded["trip"].id, store=store) is not None
