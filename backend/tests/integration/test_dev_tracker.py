"""Dev rig scenarios and the on-road tracker check, through the HTTP routes.

Fixtures copied from test_dev_pulsit.py (module-scoped app reload with both guards on,
a dict-backed mock store, and a client overriding get_db and the JWKS). The trip comes
from test_road_check._seed, a plain function so it can be shared.
"""

import importlib
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import app.main as app_main
from app.core.config import settings
from app.db.models.enums import ExceptionSource, PhaseType
from app.db.models.transit import TripException
from app.db.session import get_db
from app.integrations import pulsit as pulsit_module
from tests.conftest import FakeMockStateStore, auth_header, make_jwks, make_token, production_settings
from tests.integration.test_road_check import _seed

_SCENARIO_URL = "/api/v1/dev/tracker/scenario"
_CHECK_URL = "/api/v1/dev/tracker/check"


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


def _token_for(seed) -> str:
    # sub must be the seeded user: get_current_dispatcher looks the user up by JWT subject.
    trip = seed["trip"]
    return make_token(sub=str(trip.created_by_user_id), role="dispatcher", org_id=str(trip.operator_organization_id))


def test_tracker_routes_absent_when_pulse_use_mock_is_off() -> None:
    with production_settings(ENVIRONMENT="development", DEV_PANEL_ENABLED=True, PULSE_USE_MOCK=False):
        try:
            importlib.reload(app_main)
            paths = [r.path for r in app_main.app.routes if isinstance(r, APIRoute)]
        finally:
            importlib.reload(app_main)
    assert _SCENARIO_URL not in paths and _CHECK_URL not in paths


async def test_scenario_requires_auth(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)

    resp = await pulsit_client.post(_SCENARIO_URL, json={"trip_id": str(seed["trip"].id), "scenario": "en_route"})

    # 403, not 401: a missing bearer is refused by HTTPBearer before auth runs — the same
    # code test_dev_triggers.test_list_trips_requires_auth pins for the other dev routes.
    assert resp.status_code == 403


async def test_trailer_uncoupled_records_critical_finding(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)

    resp = await pulsit_client.post(
        _SCENARIO_URL,
        json={"trip_id": str(seed["trip"].id), "scenario": "trailer_uncoupled", "vehicle_id": str(seed["trailer"].id)},
        headers=auth_header(_token_for(seed)),
    )

    assert resp.status_code == 200
    body = resp.json()
    assert [f["exception_type"] for f in body["findings"]] == ["trailer_separated_in_transit"]
    assert body["findings"][0]["newly_recorded"] is True
    rows = (await db_session.execute(select(TripException).where(TripException.trip_id == seed["trip"].id))).scalars().all()
    assert [r.source for r in rows] == [ExceptionSource.SYSTEM]


async def test_en_route_while_loading_is_409(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.ACTIVATION)

    resp = await pulsit_client.post(
        _SCENARIO_URL, json={"trip_id": str(seed["trip"].id), "scenario": "en_route"},
        headers=auth_header(_token_for(seed)),
    )

    assert resp.status_code == 409


async def test_at_stop_without_stop_is_422(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)

    resp = await pulsit_client.post(
        _SCENARIO_URL, json={"trip_id": str(seed["trip"].id), "scenario": "at_stop"},
        headers=auth_header(_token_for(seed)),
    )

    assert resp.status_code == 422


async def test_other_org_trip_is_404(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)
    other = await _seed(db_session, completed_through=PhaseType.DEPARTURE)

    resp = await pulsit_client.post(
        _CHECK_URL, json={"trip_id": str(seed["trip"].id)}, headers=auth_header(_token_for(other)),
    )

    assert resp.status_code == 404


async def test_check_alone_reports_readings(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)

    resp = await pulsit_client.post(
        _CHECK_URL, json={"trip_id": str(seed["trip"].id)}, headers=auth_header(_token_for(seed)),
    )

    assert resp.status_code == 200
    assert {r["role"] for r in resp.json()["readings"]} == {"horse", "trailer"}
