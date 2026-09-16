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
from decimal import Decimal
from typing import AsyncGenerator, Optional

import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
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
from app.core.geo import haversine_metres
from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.integrations import pulsit as pulsit_module
from app.orchestration.dev_truck_service import TOLERANCE_BOUNDARY_MARGIN_METRES
from app.orchestration.geofence_service import TrackerFix, evaluate_geofence
from app.schemas.dev import (
    SCENARIO_AT_STOP,
    SCENARIO_FIFTY_KM,
    SCENARIO_INSIDE_TOLERANCE,
    SCENARIO_NO_SIGNAL,
    SCENARIO_OUTSIDE_TOLERANCE,
    SCENARIO_THREE_KM,
)

from tests.conftest import FakeMockStateStore, auth_header, make_jwks, make_token, production_settings

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

# FP-197 Task 3: a real, non-Cape-Town precinct pair, so the scenario-mode tests below
# do not accidentally pass just because everything in this codebase's fixtures
# happens to sit near the seeded demo depot. Johannesburg CBD and Durban Point —
# genuinely far apart, on real South African coordinates.
_JHB_LAT = "-26.2041"
_JHB_LNG = "28.0473"
_JHB_RADIUS_METRES = 150

_DBN_LAT = "-29.8587"
_DBN_LNG = "31.0218"
_DBN_RADIUS_METRES = 300

_GPS_TOLERANCE_METRES = 50  # settings.GPS_TOLERANCE_METRES default — see core/config.py


# ── Router registration: the guard matrix (no database required) ──────────────


def _routes_with_prefix(prefix: str) -> list[str]:
    # BaseRoute doesn't declare .path; every route FastAPI registers via a decorator
    # is an APIRoute, which does.
    return [
        r.path
        for r in app_main.app.routes
        if isinstance(r, APIRoute) and r.path.startswith(prefix)
    ]


def _reload_with(*, panel: bool, mock: bool, environment: str = "development") -> list[str]:
    """Reload app.main under one flag combination and report the move-truck routes.

    Restores every flag and reloads again on the way out, so a failure here cannot
    leave a poisoned app object for the rest of the suite.
    """
    # production_settings, not a bare ENVIRONMENT flip: app.main enforces the production
    # preconditions at import time, so a reload under ENVIRONMENT="production" must also
    # present a configuration production would actually be allowed to serve. In
    # development the extra values it sets are inert.
    with production_settings(
        ENVIRONMENT=environment, DEV_PANEL_ENABLED=panel, PULSE_USE_MOCK=mock,
    ):
        try:
            importlib.reload(app_main)
            return _routes_with_prefix("/api/v1/dev/pulsit")
        finally:
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
    pulsit_app, db_session, store: FakeMockStateStore, monkeypatch: pytest.MonkeyPatch
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

    assert list(store.data.keys()) == [
        f"freightproof:mock:pulsit:{seeded['org'].id}:{_DEVICE_ID}"
    ]


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

    # 403, not 401: get_current_dispatcher (auth/dependencies.py) answers a MISSING
    # Authorization header with 403 and reserves 401 for a header it could not honour —
    # a malformed token, an unknown subject, an expired session. Every other guarded
    # endpoint on this API behaves the same way, so asserting 401 here was testing a
    # convention the codebase does not have.
    assert response.status_code == 403


async def test_move_truck_rejects_a_malformed_body(pulsit_client, seeded) -> None:
    response = await pulsit_client.post(
        _MOVE_URL, json={"waypoint_id": WAYPOINT_THREE_KM}, headers=auth_header(_token(seeded)),
    )

    assert response.status_code == 422


# ── FP-197 Task 3: trip-stop-relative scenario mode ────────────────────────────


@pytest_asyncio.fixture
async def multi_stop_seeded(db_session):
    """A cross-dock trip with non-Cape-Town origin/destination stops, currently
    sitting at its origin (current_stop=1) — so the EXPECTED stop (Johannesburg) and
    a scenario-mode TARGET stop (Durban) are deliberately different places. That
    separation is the whole point of this fixture: a test that only ever targets the
    trip's current stop could not tell "scenario mode" apart from "the legacy code
    happened to still work".
    """
    org = Organization(id=uuid.uuid4(), name="Op-multi", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="multi@test.co.za", full_name="Multi")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver Multi",
        id_number="8001015009095", phone_number="+27821234568", license_number="DRV-MULTI",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="GP 456-789", pulsit_device_id=f"PLT-{uuid.uuid4().hex[:8]}",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="Johannesburg CBD", principal_organization_id=org.id,
        latitude=_JHB_LAT, longitude=_JHB_LNG, geofence_radius_metres=_JHB_RADIUS_METRES,
    )
    destination = Precinct(
        id=uuid.uuid4(), name="Durban Point", principal_organization_id=org.id,
        latitude=_DBN_LAT, longitude=_DBN_LNG, geofence_radius_metres=_DBN_RADIUS_METRES,
    )
    db_session.add_all([user, driver, horse, origin, destination])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-MULTI",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id, current_stop=1,
    )
    db_session.add(trip)
    await db_session.flush()

    origin_stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=origin.id, sequence=1)
    destination_stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=destination.id, sequence=2)
    db_session.add_all([origin_stop, destination_stop])
    await db_session.flush()

    return {
        "trip": trip, "origin_stop": origin_stop, "destination_stop": destination_stop,
        "origin_precinct": origin, "destination_precinct": destination,
        "org": org, "user": user, "horse": horse,
    }


@pytest_asyncio.fixture
async def repeated_precinct_seeded(db_session):
    """A trip that returns to its own origin precinct — two distinct TripStop rows
    sharing one Precinct — so resolving a target must key off trip_stop_id, never
    "a stop at this precinct". A resolver that joined only on precinct_id would pass
    every other test in this file and still be wrong for exactly this shape of trip.
    """
    org = Organization(id=uuid.uuid4(), name="Op-repeat", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="repeat@test.co.za", full_name="Repeat")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver Repeat",
        id_number="8001015009109", phone_number="+27821234569", license_number="DRV-REPEAT",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="WC 111-222", pulsit_device_id=f"PLT-{uuid.uuid4().hex[:8]}",
    )
    precinct = Precinct(
        id=uuid.uuid4(), name="Shared Depot", principal_organization_id=org.id,
        latitude=_JHB_LAT, longitude=_JHB_LNG, geofence_radius_metres=_JHB_RADIUS_METRES,
    )
    db_session.add_all([user, driver, horse, precinct])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-REPEAT",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id, current_stop=1,
    )
    db_session.add(trip)
    await db_session.flush()

    first_stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=1)
    second_stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=2)
    db_session.add_all([first_stop, second_stop])
    await db_session.flush()

    return {
        "trip": trip, "first_stop": first_stop, "second_stop": second_stop,
        "precinct": precinct, "org": org, "user": user, "horse": horse,
    }


async def _move_scenario(
    client: AsyncClient,
    fixture: dict,
    *,
    scenario: str,
    trip_id: Optional[uuid.UUID] = None,
    trip_stop_id: Optional[uuid.UUID] = None,
):
    body: dict = {
        "trip_id": str(trip_id if trip_id is not None else fixture["trip"].id),
        "scenario": scenario,
    }
    if trip_stop_id is not None:
        body["trip_stop_id"] = str(trip_stop_id)
    return await client.post(_MOVE_URL, json=body, headers=auth_header(_token(fixture)))


async def test_scenario_at_stop_stages_the_requested_stops_coordinates_exactly(
    pulsit_client, multi_stop_seeded,
) -> None:
    """Targets the DESTINATION stop (Durban) while the trip's current stop is the
    ORIGIN (Johannesburg) — proves the staged position follows the requested stop,
    not whichever stop the phase ledger currently sits at."""
    response = await _move_scenario(
        pulsit_client, multi_stop_seeded,
        scenario=SCENARIO_AT_STOP, trip_stop_id=multi_stop_seeded["destination_stop"].id,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["latitude"] == _DBN_LAT
    assert body["longitude"] == _DBN_LNG
    assert body["target_trip_stop_id"] == str(multi_stop_seeded["destination_stop"].id)
    assert body["target_precinct_name"] == "Durban Point"
    assert body["target_distance_metres"] == pytest.approx(0.0, abs=1.0)
    assert body["scenario"] == SCENARIO_AT_STOP


async def test_scenario_mode_still_evaluates_the_expected_phase_ledger_stop(
    pulsit_client, multi_stop_seeded,
) -> None:
    """The legacy verdict fields must keep describing the trip's CURRENT stop (origin,
    Johannesburg) even while scenario mode stages the tracker at a totally different
    stop (destination, Durban) — the two must never be conflated."""
    response = await _move_scenario(
        pulsit_client, multi_stop_seeded,
        scenario=SCENARIO_THREE_KM, trip_stop_id=multi_stop_seeded["destination_stop"].id,
    )

    assert response.status_code == 200
    body = response.json()
    # Expected fields describe Johannesburg (the ledger's current stop) ...
    assert body["precinct_name"] == "Johannesburg CBD"
    assert body["expected_precinct_name"] == "Johannesburg CBD"
    assert body["expected_trip_stop_id"] == str(multi_stop_seeded["origin_stop"].id)
    # ... while the target fields describe Durban (what was actually requested), and
    # the expected-stop distance is NOT 3000 m (that number belongs to the target).
    assert body["target_precinct_name"] == "Durban Point"
    assert body["target_trip_stop_id"] == str(multi_stop_seeded["destination_stop"].id)
    assert body["target_distance_metres"] == pytest.approx(3_000.0, abs=0.5)
    # The tracker is nowhere near Johannesburg once staged 3 km from Durban, so the
    # expected-stop verdict must fail — proving the two distances are not the same
    # number wearing two field names.
    assert body["geofence_confirmed"] is False
    assert body["distance_metres"] != pytest.approx(3_000.0, abs=1.0)


@pytest.mark.parametrize(
    ("scenario", "expected_metres"),
    [
        (SCENARIO_INSIDE_TOLERANCE, _JHB_RADIUS_METRES + _GPS_TOLERANCE_METRES - TOLERANCE_BOUNDARY_MARGIN_METRES),
        (SCENARIO_OUTSIDE_TOLERANCE, _JHB_RADIUS_METRES + _GPS_TOLERANCE_METRES + TOLERANCE_BOUNDARY_MARGIN_METRES),
        (SCENARIO_THREE_KM, 3_000.0),
        (SCENARIO_FIFTY_KM, 50_000.0),
    ],
)
async def test_scenario_distances_are_computed_from_the_targets_own_precinct(
    pulsit_client, multi_stop_seeded, scenario: str, expected_metres: float,
) -> None:
    """Distances are relative to the TARGET stop's own radius (Johannesburg's 150 m),
    not the seeded demo depot's 200 m — proves the maths reads the real precinct row
    rather than a hardcoded assumption left over from the legacy waypoints."""
    response = await _move_scenario(
        pulsit_client, multi_stop_seeded,
        scenario=scenario, trip_stop_id=multi_stop_seeded["origin_stop"].id,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["target_distance_metres"] == pytest.approx(expected_metres, abs=0.5)
    measured = haversine_metres(
        float(_JHB_LAT), float(_JHB_LNG), float(body["latitude"]), float(body["longitude"]),
    )
    assert measured == pytest.approx(expected_metres, abs=0.5)


async def test_no_signal_scenario_without_a_stop_stages_no_fix_and_names_no_target(
    pulsit_client, multi_stop_seeded,
) -> None:
    """trip_stop_id is optional for no_signal — omitting it must still succeed, with
    no target stop to report since none was named."""
    response = await _move_scenario(pulsit_client, multi_stop_seeded, scenario=SCENARIO_NO_SIGNAL)

    assert response.status_code == 200
    body = response.json()
    assert body["has_position"] is False
    assert body["latitude"] is None and body["longitude"] is None
    assert body["target_trip_stop_id"] is None
    assert body["target_precinct_name"] is None
    assert body["target_distance_metres"] is None
    assert body["scenario"] == SCENARIO_NO_SIGNAL


async def test_no_signal_scenario_with_a_stop_still_stages_no_fix(
    pulsit_client, multi_stop_seeded,
) -> None:
    """trip_stop_id MAY be supplied with no_signal (naming which stop the tracker went
    dark near) — it must not be treated as a coordinate request."""
    response = await _move_scenario(
        pulsit_client, multi_stop_seeded,
        scenario=SCENARIO_NO_SIGNAL, trip_stop_id=multi_stop_seeded["destination_stop"].id,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["has_position"] is False
    assert body["latitude"] is None and body["longitude"] is None
    assert body["target_trip_stop_id"] == str(multi_stop_seeded["destination_stop"].id)
    assert body["target_precinct_name"] == "Durban Point"
    assert body["target_distance_metres"] is None


async def test_repeated_precinct_trip_resolves_the_exact_requested_stop(
    pulsit_client, repeated_precinct_seeded,
) -> None:
    """Two TripStop rows share one Precinct. Requesting the SECOND stop specifically
    must resolve to the second stop's own id, not silently match on the first stop
    that happens to share its precinct."""
    response = await _move_scenario(
        pulsit_client, repeated_precinct_seeded,
        scenario=SCENARIO_AT_STOP, trip_stop_id=repeated_precinct_seeded["second_stop"].id,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["target_trip_stop_id"] == str(repeated_precinct_seeded["second_stop"].id)
    assert body["target_trip_stop_id"] != str(repeated_precinct_seeded["first_stop"].id)


async def test_waypoint_id_and_scenario_together_is_rejected(pulsit_client, seeded) -> None:
    response = await pulsit_client.post(
        _MOVE_URL,
        json={
            "trip_id": str(seeded["trip"].id),
            "waypoint_id": WAYPOINT_THREE_KM,
            "scenario": SCENARIO_AT_STOP,
            "trip_stop_id": str(seeded["stop"].id),
        },
        headers=auth_header(_token(seeded)),
    )

    assert response.status_code == 422


async def test_neither_waypoint_id_nor_scenario_is_rejected(pulsit_client, seeded) -> None:
    response = await pulsit_client.post(
        _MOVE_URL, json={"trip_id": str(seeded["trip"].id)}, headers=auth_header(_token(seeded)),
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "scenario",
    [SCENARIO_AT_STOP, SCENARIO_INSIDE_TOLERANCE, SCENARIO_OUTSIDE_TOLERANCE, SCENARIO_THREE_KM, SCENARIO_FIFTY_KM],
)
async def test_scenario_without_a_stop_is_rejected_unless_no_signal(
    pulsit_client, seeded, scenario: str,
) -> None:
    response = await pulsit_client.post(
        _MOVE_URL, json={"trip_id": str(seeded["trip"].id), "scenario": scenario},
        headers=auth_header(_token(seeded)),
    )

    assert response.status_code == 422


async def test_unknown_trip_stop_id_is_rejected(pulsit_client, seeded) -> None:
    response = await _move_scenario(
        pulsit_client, seeded, scenario=SCENARIO_AT_STOP, trip_stop_id=uuid.uuid4(),
    )

    assert response.status_code == 404


async def test_trip_stop_belonging_to_a_different_trip_is_rejected(
    pulsit_client, multi_stop_seeded, seeded,
) -> None:
    """A syntactically valid trip_stop_id that belongs to a DIFFERENT trip (even in
    the same organisation) must 404 exactly like one that does not exist at all —
    never confirm the id is real by answering differently."""
    response = await _move_scenario(
        pulsit_client, seeded, scenario=SCENARIO_AT_STOP,
        trip_stop_id=multi_stop_seeded["origin_stop"].id,
    )

    assert response.status_code == 404


# ── Fix round 1: "same horse shared by demo trips" — pinning DevTriggerPanel.tsx's own
# copy ("any other trip whose horse shares this same Pulsit tracker will observe the
# same staged position too") to actual behaviour, not just prose. ─────────────────


@pytest_asyncio.fixture
async def shared_horse_seeded(db_session):
    """Two trips, same organisation, sharing the SAME horse Vehicle row (and therefore
    the same pulsit_device_id). Each has its own single stop at its own precinct, so a
    verdict computed against "trip B's expected stop" is numerically distinguishable
    from one computed against trip A's — the only way to prove a test is reading the
    right ledger rather than one that would pass by accident if both trips shared a
    stop too.
    """
    org = Organization(id=uuid.uuid4(), name="Op-shared-horse", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="shared@test.co.za", full_name="Shared")
    driver_a = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver A",
        id_number="8001015009117", phone_number="+27821234570", license_number="DRV-SHARED-A",
    )
    driver_b = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver B",
        id_number="8001015009125", phone_number="+27821234571", license_number="DRV-SHARED-B",
    )
    # ONE horse, shared by both trips below — the whole point of this fixture.
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="EC 999-000", pulsit_device_id=f"PLT-SHARED-{uuid.uuid4().hex[:8]}",
    )
    precinct_a = Precinct(
        id=uuid.uuid4(), name="Johannesburg CBD", principal_organization_id=org.id,
        latitude=_JHB_LAT, longitude=_JHB_LNG, geofence_radius_metres=_JHB_RADIUS_METRES,
    )
    precinct_b = Precinct(
        id=uuid.uuid4(), name="Durban Point", principal_organization_id=org.id,
        latitude=_DBN_LAT, longitude=_DBN_LNG, geofence_radius_metres=_DBN_RADIUS_METRES,
    )
    db_session.add_all([user, driver_a, driver_b, horse, precinct_a, precinct_b])
    await db_session.flush()

    trip_a = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-SHARED-A",
        operator_organization_id=org.id, driver_id=driver_a.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id, current_stop=1,
    )
    trip_b = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-SHARED-B",
        operator_organization_id=org.id, driver_id=driver_b.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id, current_stop=1,
    )
    db_session.add_all([trip_a, trip_b])
    await db_session.flush()

    stop_a = TripStop(id=uuid.uuid4(), trip_id=trip_a.id, precinct_id=precinct_a.id, sequence=1)
    stop_b = TripStop(id=uuid.uuid4(), trip_id=trip_b.id, precinct_id=precinct_b.id, sequence=1)
    db_session.add_all([stop_a, stop_b])
    await db_session.flush()

    return {
        "org": org, "user": user, "horse": horse,
        "trip_a": trip_a, "trip_b": trip_b,
        "stop_a": stop_a, "stop_b": stop_b,
        "precinct_a": precinct_a, "precinct_b": precinct_b,
    }


async def test_two_trips_sharing_one_horse_observe_the_same_device_state(
    pulsit_client, shared_horse_seeded,
) -> None:
    """Pins the panel's own claim to behaviour: staging via trip A's scenario mode
    writes `freightproof:mock:pulsit:{org_id}:{device_id}` — a key that names the
    DEVICE, not either trip — so trip B's read of that same device must see exactly
    what trip A staged, and trip B's own EXPECTED-stop verdict must still be computed
    against trip B's OWN ledger stop (Durban), never trip A's (Johannesburg).

    WHY THE "READ-BACK PATH", NOT A SECOND move-truck CALL, PROVES THE FIRST HALF:
    move-truck's only job is to WRITE a new position (see this module's own docstring
    — "THIS ENDPOINT WRITES PULSIT MOCK STATE AND NOTHING ELSE"); there is no read-only
    variant. Calling it a second time for trip B would necessarily re-stage the shared
    device before we could observe what trip A left behind, which would prove nothing
    about sharing — it would just be trip B staging its own position, coincidentally
    through the same device. So the "trip B observes it" half reads the shared mock
    state directly through `MockPulsitClient.get_position()` — the exact same call
    `move_truck()` itself makes internally — scoped to the shared organisation, BEFORE
    trip B's own move-truck call (further down) has a chance to overwrite it.
    """
    # Trip A stages a KNOWN, distinctive position: 3 km from ITS OWN stop.
    stage_response = await _move_scenario(
        pulsit_client, shared_horse_seeded, trip_id=shared_horse_seeded["trip_a"].id,
        scenario=SCENARIO_THREE_KM, trip_stop_id=shared_horse_seeded["stop_a"].id,
    )
    assert stage_response.status_code == 200
    staged_lat = Decimal(stage_response.json()["latitude"])
    staged_lng = Decimal(stage_response.json()["longitude"])

    # Read the SAME device back — scoped to the shared organisation — through the
    # identical client call move_truck() uses internally. If this were keyed by trip
    # rather than by device, trip B's read would come back with no position at all.
    client = pulsit_module.get_pulsit_client(organization_id=shared_horse_seeded["org"].id)
    fix = await client.get_position(shared_horse_seeded["horse"].pulsit_device_id)
    assert fix.has_position
    assert fix.lat == staged_lat
    assert fix.lng == staged_lng

    # That SAME shared fix, judged against trip B's OWN expected precinct (Durban),
    # must NOT reduce to the number it would have produced against trip A's stop
    # (Johannesburg) — proving the ledger, not the shared device, decides "expected".
    verdict_for_b = evaluate_geofence(
        TrackerFix(lat=fix.lat, lng=fix.lng), shared_horse_seeded["precinct_b"],
    )
    distance_from_trip_as_stop = haversine_metres(
        float(staged_lat), float(staged_lng),
        float(shared_horse_seeded["precinct_a"].latitude), float(shared_horse_seeded["precinct_a"].longitude),
    )
    assert verdict_for_b.distance_metres != pytest.approx(distance_from_trip_as_stop, abs=1.0)

    # End to end: trip B's OWN move-truck call reports its OWN expected stop (Durban),
    # never trip A's (Johannesburg) — even though both trips' requests reach the same
    # underlying device.
    trip_b_response = await _move_scenario(
        pulsit_client, shared_horse_seeded, trip_id=shared_horse_seeded["trip_b"].id,
        scenario=SCENARIO_AT_STOP, trip_stop_id=shared_horse_seeded["stop_b"].id,
    )
    assert trip_b_response.status_code == 200
    body_b = trip_b_response.json()
    assert body_b["expected_trip_stop_id"] == str(shared_horse_seeded["stop_b"].id)
    assert body_b["expected_precinct_name"] == shared_horse_seeded["precinct_b"].name
    assert body_b["expected_precinct_name"] != shared_horse_seeded["precinct_a"].name
