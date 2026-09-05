"""FP-116/FP-198: the "move the truck" control is guarded, and it writes nothing else.

Two halves, deliberately separated by what they need:

  * The ROUTER REGISTRATION matrix needs no database. It reloads app.main under each
    combination of the two guard flags and asserts the routes are absent — 404, not 403
    — whenever either flag is off. These run everywhere, including a checkout with no
    TEST_DATABASE_URL, because they are the tests that keep a demo trigger off a
    production host and must never be the ones that quietly skipped.

  * The BEHAVIOUR tests need a database and skip without one. The most important of
    them is test_moving_the_truck_writes_no_evidence_rows: it counts phase_events and
    trip_exceptions before and after and asserts both are unchanged. That is the
    assertion protecting the integrity claim — the exception a reviewer sees on stage
    has to have arrived through the real pipeline, not been inserted by the button.
"""

import importlib
import uuid
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

import app.main as app_main
from app.core.config import settings
from app.core.demo_waypoints import (
    DEMO_WAYPOINTS,
    WAYPOINT_FIFTY_KM,
    WAYPOINT_INSIDE_TOLERANCE,
    WAYPOINT_NO_SIGNAL,
    WAYPOINT_OUTSIDE_TOLERANCE,
    WAYPOINT_PRECINCT,
    WAYPOINT_THREE_KM,
)
from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.integrations import pulsit as pulsit_module

from tests.conftest import FakeMockStateStore, auth_header, make_jwks, make_token

_MOVE_URL = "/api/v1/dev/pulsit/move-truck"
_WAYPOINTS_URL = "/api/v1/dev/pulsit/waypoints"

# The seeded demo depot, which the waypoint coordinates are anchored to. The fixture
# precinct below uses it so measured distances are the real advertised ones.
_DEPOT_LAT = "-33.9249"
_DEPOT_LNG = "18.4241"
_SEEDED_RADIUS_METRES = 200

# The tracker on the fixture trip's horse. Any string works — MockPulsitClient keys
# staged state by device id and only falls back to its fixture library when nothing
# is staged, which is exactly the path these tests drive.
_DEVICE_ID = "PLT-HORSE-001"


# ── Router registration: the guard matrix (no database required) ──────────────


def _routes_with_prefix(prefix: str) -> list[str]:
    return [r.path for r in app_main.app.routes if r.path.startswith(prefix)]


def _reload_with(*, panel: bool, mock: bool, environment: str = "development") -> list[str]:
    """Reload app.main under one flag combination and report the move-truck routes.

    Restores every flag and reloads again on the way out, so a failure here cannot
    leave a poisoned app object for the rest of the suite.
    """
    original = (settings.DEV_PANEL_ENABLED, settings.PULSE_USE_MOCK, settings.ENVIRONMENT)
    settings.DEV_PANEL_ENABLED = panel
    settings.PULSE_USE_MOCK = mock
    settings.ENVIRONMENT = environment
    try:
        importlib.reload(app_main)
        return _routes_with_prefix("/api/v1/dev/pulsit")
    finally:
        (settings.DEV_PANEL_ENABLED, settings.PULSE_USE_MOCK, settings.ENVIRONMENT) = original
        importlib.reload(app_main)


def test_routes_registered_when_both_guards_pass() -> None:
    routes = _reload_with(panel=True, mock=True)

    assert sorted(routes) == ["/api/v1/dev/pulsit/move-truck", "/api/v1/dev/pulsit/waypoints"]


def test_routes_absent_when_pulse_use_mock_is_off() -> None:
    """Staging into a live Pulsit client would be a button that lies. No route at all."""
    assert _reload_with(panel=True, mock=False) == []


def test_routes_absent_when_dev_panel_is_off() -> None:
    assert _reload_with(panel=False, mock=True) == []


def test_routes_absent_when_both_guards_fail() -> None:
    """Fail closed. Neither signal present means nothing to probe."""
    assert _reload_with(panel=False, mock=False) == []


@pytest.mark.parametrize(
    ("panel", "mock"),
    [(True, False), (False, True), (False, False)],
)
def test_move_truck_returns_404_not_403_when_refused(panel: bool, mock: bool) -> None:
    """Refusal is absence, not a guarded route.

    An endpoint that answers 403 tells a prober it exists and is worth revisiting when
    the configuration changes. One that is never registered tells them nothing.
    """
    routes = _reload_with(panel=panel, mock=mock)

    assert _MOVE_URL not in routes
    assert _WAYPOINTS_URL not in routes


# ── The ENVIRONMENT dimension, and why it is deliberately not a guard ─────────


def test_routes_present_in_production_when_both_guards_pass() -> None:
    """DELIBERATE DEVIATION FROM FP-197 AS WRITTEN — read before "fixing" this.

    FP-197 asked for a non-production check as the second signal. It is not used, and
    this test pins that decision so nobody restores it by accident.

    In this codebase ENVIRONMENT="production" does not mean "real production": the
    deployed demo host sets it to keep /docs, /redoc and /openapi.json unpublished
    (main.py), and the team already removed that gate from the dev panel for exactly
    this reason (dev_triggers.dev_panel_enabled, and
    test_dev_router_present_in_production_when_flag_is_on next door). Gating on it here
    would make "move the truck" absent on the one host the demo actually runs on.

    The two signals that DO gate this are DEV_PANEL_ENABLED and PULSE_USE_MOCK — both
    default to closed, and PULSE_USE_MOCK is causally connected to whether the endpoint
    can do anything at all, which ENVIRONMENT is not.
    """
    routes = _reload_with(panel=True, mock=True, environment="production")

    assert _MOVE_URL in routes


@pytest.mark.parametrize(("panel", "mock"), [(True, False), (False, True), (False, False)])
def test_routes_still_absent_in_production_when_a_guard_fails(panel: bool, mock: bool) -> None:
    """Production changes nothing about the guards — they refuse there too."""
    assert _reload_with(panel=panel, mock=mock, environment="production") == []


# ── Fixtures for the behaviour tests (database required) ──────────────────────


@pytest.fixture(scope="module")
def pulsit_app():
    """Reload app.main with both guards on, then restore."""
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
    monkeypatch.setattr(pulsit_module, "get_mock_state_store", lambda: fake)
    return fake


@pytest_asyncio.fixture
async def pulsit_client(
    pulsit_app, db_session, monkeypatch: pytest.MonkeyPatch
) -> AsyncGenerator[AsyncClient, None]:
    monkeypatch.setattr("app.auth.dependencies._get_jwks", make_jwks)

    async def _get_db():
        yield db_session

    pulsit_app.dependency_overrides[get_db] = _get_db
    async with AsyncClient(
        transport=ASGITransport(app=pulsit_app), base_url="http://test",
    ) as ac:
        yield ac
    pulsit_app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seeded(db_session):
    """An active trip whose single stop sits exactly on the waypoint anchor."""
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
        registration="CA 123-456", pulsit_device_id=_DEVICE_ID,
    )
    precinct = Precinct(
        id=uuid.uuid4(), name="Cape Town Depot (Epping)", principal_organization_id=org.id,
        latitude=_DEPOT_LAT, longitude=_DEPOT_LNG,
        geofence_radius_metres=_SEEDED_RADIUS_METRES,
    )
    db_session.add_all([user, driver, horse, precinct])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id, current_stop=1,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    return {"trip": trip, "stop": stop, "precinct": precinct, "org": org,
            "user": user, "horse": horse}


def _token(seeded) -> str:
    return make_token(sub=str(seeded["user"].id), role="dispatcher", org_id=str(seeded["org"].id))


async def _move(client: AsyncClient, seeded, waypoint_id: str):
    return await client.post(
        _MOVE_URL,
        json={"trip_id": str(seeded["trip"].id), "waypoint_id": waypoint_id},
        headers=auth_header(_token(seeded)),
    )


# ── Behaviour ─────────────────────────────────────────────────────────────────


async def test_waypoints_endpoint_serves_the_ordered_route(pulsit_client, seeded) -> None:
    response = await pulsit_client.get(_WAYPOINTS_URL, headers=auth_header(_token(seeded)))

    assert response.status_code == 200
    body = response.json()
    assert [w["waypoint_id"] for w in body] == [w.waypoint_id for w in DEMO_WAYPOINTS]


async def test_moving_to_the_precinct_confirms_the_geofence(pulsit_client, seeded) -> None:
    response = await _move(pulsit_client, seeded, WAYPOINT_PRECINCT)

    assert response.status_code == 200
    body = response.json()
    assert body["geofence_confirmed"] is True
    assert body["distance_metres"] == pytest.approx(0.0, abs=1.0)
    assert body["device_id"] == _DEVICE_ID


async def test_the_marginal_waypoint_still_confirms_but_flags_the_band(
    pulsit_client, seeded
) -> None:
    """230 m proves the tolerance band is real rather than decorative."""
    response = await _move(pulsit_client, seeded, WAYPOINT_INSIDE_TOLERANCE)

    body = response.json()
    assert body["geofence_confirmed"] is True
    assert body["in_tolerance_band"] is True
    assert body["distance_metres"] == pytest.approx(230, abs=1.0)


@pytest.mark.parametrize(
    ("waypoint_id", "expected_metres"),
    [(WAYPOINT_OUTSIDE_TOLERANCE, 260), (WAYPOINT_THREE_KM, 3_000), (WAYPOINT_FIFTY_KM, 50_000)],
)
async def test_waypoints_past_the_band_fail_the_geofence(
    pulsit_client, seeded, waypoint_id: str, expected_metres: int
) -> None:
    response = await _move(pulsit_client, seeded, waypoint_id)

    body = response.json()
    assert body["geofence_confirmed"] is False
    assert body["in_tolerance_band"] is False
    assert body["distance_metres"] == pytest.approx(expected_metres, abs=1.0)


async def test_no_signal_leaves_the_verdict_null_rather_than_false(
    pulsit_client, seeded
) -> None:
    """An unreachable tracker must never accuse a driver.

    `false` would be the panel rendering a failed corroboration where the pipeline
    deliberately records none — the difference between "the truck was elsewhere" and
    "we could not ask".
    """
    response = await _move(pulsit_client, seeded, WAYPOINT_NO_SIGNAL)

    body = response.json()
    assert body["geofence_confirmed"] is None
    assert body["has_position"] is False
    assert body["latitude"] is None and body["longitude"] is None
    assert body["distance_metres"] is None
    assert body["verdict_reason"] == "no_fix"


async def test_moving_the_truck_writes_no_evidence_rows(pulsit_client, seeded, db_session) -> None:
    """THE ASSERTION THE INTEGRITY CLAIM RESTS ON.

    If this control could insert a phase event or an exception, the demo would prove
    only that the button works. It has to prove the product works, so the button moves
    a tracker and nothing else — every downstream row must come from the real pipeline.
    """
    phase_events_before = (await db_session.execute(
        select(func.count()).select_from(PhaseEvent)
    )).scalar_one()
    exceptions_before = (await db_session.execute(
        select(func.count()).select_from(TripException)
    )).scalar_one()

    for waypoint in DEMO_WAYPOINTS:
        assert (await _move(pulsit_client, seeded, waypoint.waypoint_id)).status_code == 200

    phase_events_after = (await db_session.execute(
        select(func.count()).select_from(PhaseEvent)
    )).scalar_one()
    exceptions_after = (await db_session.execute(
        select(func.count()).select_from(TripException)
    )).scalar_one()
    assert phase_events_after == phase_events_before
    assert exceptions_after == exceptions_before


async def test_moving_the_truck_writes_only_pulsit_mock_state(
    pulsit_client, seeded, store
) -> None:
    """The one key it may touch is this device's, under the pulsit namespace."""
    await _move(pulsit_client, seeded, WAYPOINT_THREE_KM)

    assert list(store.data.keys()) == [f"freightproof:mock:pulsit:{_DEVICE_ID}"]


async def test_pressing_the_same_waypoint_twice_is_idempotent(
    pulsit_client, seeded, store
) -> None:
    """Re-pressing is how a presenter recovers from a mis-click. It must be boring."""
    first = await _move(pulsit_client, seeded, WAYPOINT_THREE_KM)
    state_after_first = dict(store.data)

    second = await _move(pulsit_client, seeded, WAYPOINT_THREE_KM)

    assert second.status_code == 200
    assert len(store.data) == len(state_after_first)
    for key, value in state_after_first.items():
        # fixed_at moves with the clock; everything that describes WHERE must not.
        assert store.data[key]["lat"] == value["lat"]
        assert store.data[key]["lng"] == value["lng"]
        assert store.data[key]["status"] == value["status"]
    assert second.json()["distance_metres"] == pytest.approx(
        first.json()["distance_metres"], abs=0.01
    )


async def test_reset_returns_the_truck_to_the_precinct(pulsit_client, seeded) -> None:
    """Rehearsal recovery without touching a database."""
    await _move(pulsit_client, seeded, WAYPOINT_FIFTY_KM)

    reset = await _move(pulsit_client, seeded, WAYPOINT_PRECINCT)

    assert reset.json()["geofence_confirmed"] is True
    assert reset.json()["distance_metres"] == pytest.approx(0.0, abs=1.0)


async def test_no_signal_can_be_recovered_from(pulsit_client, seeded) -> None:
    """Going dark must not be a one-way door mid-demo."""
    await _move(pulsit_client, seeded, WAYPOINT_NO_SIGNAL)

    recovered = await _move(pulsit_client, seeded, WAYPOINT_PRECINCT)

    assert recovered.json()["has_position"] is True
    assert recovered.json()["geofence_confirmed"] is True


async def test_unknown_waypoint_is_rejected(pulsit_client, seeded) -> None:
    response = await _move(pulsit_client, seeded, "somewhere-else")

    assert response.status_code == 404


async def test_unknown_trip_is_rejected(pulsit_client, seeded) -> None:
    response = await pulsit_client.post(
        _MOVE_URL,
        json={"trip_id": str(uuid.uuid4()), "waypoint_id": WAYPOINT_THREE_KM},
        headers=auth_header(_token(seeded)),
    )

    assert response.status_code == 404


async def test_move_truck_requires_authentication(pulsit_client, seeded) -> None:
    response = await pulsit_client.post(
        _MOVE_URL, json={"trip_id": str(seeded["trip"].id), "waypoint_id": WAYPOINT_THREE_KM},
    )

    assert response.status_code == 401


async def test_move_truck_rejects_a_malformed_body(pulsit_client, seeded) -> None:
    response = await pulsit_client.post(
        _MOVE_URL, json={"waypoint_id": WAYPOINT_THREE_KM}, headers=auth_header(_token(seeded)),
    )

    assert response.status_code == 422
