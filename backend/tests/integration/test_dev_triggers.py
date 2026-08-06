"""Integration tests for the dev trigger panel.

The router registers at import time, so a module-scoped fixture flips the settings
and reloads app.main to obtain an app that actually has the routes. Settings are
restored and main reloaded again on teardown so other test modules are unaffected.
"""

import importlib
import uuid
from typing import Any, AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import app.main as app_main
from app.core.config import settings
from app.db.models.enums import (
    ExceptionType, IdvsStatus, OrganizationType, ParcelStatus, TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.integrations import parcel_perfect as pp_module
from app.integrations import scan_feed as scan_feed_module

from tests.conftest import auth_header, make_jwks, make_token


class FakeStore:
    """Dict-backed MockStateStore — keeps these tests off a real Redis."""

    def __init__(self) -> None:
        self.data: dict[str, dict[str, Any]] = {}

    async def get_json(self, key: str) -> dict[str, Any] | None:
        return self.data.get(key)

    async def set_json(self, key: str, value: dict[str, Any]) -> None:
        self.data[key] = value

    async def flush(self) -> int:
        count = len(self.data)
        self.data.clear()
        return count


@pytest.fixture(scope="module")
def dev_app():
    """Reload app.main with the dev panel switched on, then restore."""
    original_environment = settings.ENVIRONMENT
    original_flag = settings.DEV_PANEL_ENABLED
    settings.ENVIRONMENT = "development"
    settings.DEV_PANEL_ENABLED = True
    importlib.reload(app_main)

    yield app_main.app

    settings.ENVIRONMENT = original_environment
    settings.DEV_PANEL_ENABLED = original_flag
    importlib.reload(app_main)


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    fake = FakeStore()
    monkeypatch.setattr(scan_feed_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(pp_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(
        "app.api.v1.endpoints.dev_triggers.get_mock_state_store", lambda: fake
    )
    return fake


@pytest_asyncio.fixture
async def dev_client(
    dev_app, db_session, monkeypatch: pytest.MonkeyPatch
) -> AsyncGenerator[AsyncClient, None]:
    monkeypatch.setattr("app.auth.dependencies._get_jwks", make_jwks)

    async def _get_db():
        yield db_session

    dev_app.dependency_overrides[get_db] = _get_db
    async with AsyncClient(
        transport=ASGITransport(app=dev_app), base_url="http://test",
    ) as ac:
        yield ac
    dev_app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seeded(db_session):
    """A trip with one stop and one consignment whose barcodes match WAY001's fixture."""
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
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    precinct = Precinct(
        id=uuid.uuid4(), name="Origin", principal_organization_id=org.id,
        latitude="0", longitude="0",
    )
    db_session.add_all([user, driver, horse, precinct])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    # WAY001 is a real fixture in parcel_perfect.MOCK_WAYBILLS with 5 parcels, so
    # the PP trigger's real sync resolves against data that actually exists.
    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY001",
        parcel_count_expected=5, pickup_stop_id=stop.id, delivery_stop_id=stop.id,
    )
    db_session.add(consignment)
    await db_session.flush()

    barcodes = [f"WAY001{n:04d}" for n in range(1, 6)]
    for barcode in barcodes:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id,
            barcode=barcode, status=ParcelStatus.PENDING,
        ))
    await db_session.flush()

    return {
        "trip": trip, "stop": stop, "consignment": consignment,
        "barcodes": barcodes, "org": org, "user": user,
    }


def _token(seeded) -> str:
    # sub must match the seeded User's id: get_current_dispatcher looks the user
    # up by JWT subject, so an unbound sub 401s as "User account not found" on
    # every authenticated call rather than actually testing the route.
    return make_token(sub=str(seeded["user"].id), role="dispatcher", org_id=str(seeded["org"].id))


# ── Router registration ───────────────────────────────────────────────────────


def test_dev_router_absent_in_production():
    """A trigger-exception endpoint reachable in production is a catastrophe."""
    original_environment = settings.ENVIRONMENT
    original_flag = settings.DEV_PANEL_ENABLED
    settings.ENVIRONMENT = "production"
    settings.DEV_PANEL_ENABLED = True
    try:
        importlib.reload(app_main)

        assert [r.path for r in app_main.app.routes if "/dev" in r.path] == []
    finally:
        settings.ENVIRONMENT = original_environment
        settings.DEV_PANEL_ENABLED = original_flag
        importlib.reload(app_main)


def test_dev_router_absent_when_flag_is_off():
    original_environment = settings.ENVIRONMENT
    original_flag = settings.DEV_PANEL_ENABLED
    settings.ENVIRONMENT = "development"
    settings.DEV_PANEL_ENABLED = False
    try:
        importlib.reload(app_main)

        assert [r.path for r in app_main.app.routes if "/dev" in r.path] == []
    finally:
        settings.ENVIRONMENT = original_environment
        settings.DEV_PANEL_ENABLED = original_flag
        importlib.reload(app_main)


def test_dev_router_present_when_both_conditions_hold(dev_app):
    assert any("/dev" in r.path for r in dev_app.routes)


# ── Auth ──────────────────────────────────────────────────────────────────────


async def test_scan_trigger_requires_auth(dev_client, seeded, store):
    res = await dev_client.post("/api/v1/dev/scans", json={
        "trip_id": str(seeded["trip"].id),
        "trip_stop_id": str(seeded["stop"].id),
        "direction": "out",
    })

    # get_current_dispatcher raises 403 (not 401) for a missing bearer token — see
    # app/auth/dependencies.py — matching the convention used everywhere else in
    # this suite (e.g. test_pp_endpoints.py::test_capabilities_no_auth_returns_403).
    assert res.status_code == 403


async def test_list_trips_requires_auth(dev_client):
    res = await dev_client.get("/api/v1/dev/trips")

    assert res.status_code == 403


# ── Validation ────────────────────────────────────────────────────────────────


async def test_scan_trigger_rejects_a_bad_direction(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "sideways",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 422


async def test_scan_trigger_rejects_a_negative_count(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
            "parcel_count": -1,
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 422


async def test_scan_trigger_404s_for_a_stop_with_no_consignments(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(uuid.uuid4()),
            "direction": "out",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 404


# ── Scan triggers ─────────────────────────────────────────────────────────────


async def test_full_scan_out_marks_every_parcel(dev_client, db_session, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    parcels = (await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
    )).scalars().all()
    assert all(p.pp_scan_out_at is not None for p in parcels)


async def test_partial_scan_creates_a_scoped_exception(dev_client, db_session, seeded, store):
    """The discrepancy path, end to end through the endpoint."""
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
            "parcel_count": 3,
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    body = res.json()
    assert len(body["consignments"][0]["missing_barcodes"]) == 2
    exception = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalar_one()
    assert exception.consignment_id == seeded["consignment"].id
    assert exception.trip_stop_id == seeded["stop"].id
    assert exception.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH


async def test_unexpected_barcode_is_reported_and_recorded(dev_client, db_session, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
            "barcodes": [*seeded["barcodes"], "STRANGER-99"],
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    assert res.json()["consignments"][0]["unexpected_barcodes"] == ["STRANGER-99"]
    exception = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalar_one()
    assert "STRANGER-99" in exception.description


# ── Close-session trigger (folded in from 2026-08-05-scan-driven-loading-unloading.md) ──


async def test_close_session_marks_the_session_closed(dev_client, seeded, store):
    """The trigger drives the mock; the mock is what the gate reads."""
    res = await dev_client.post(
        "/api/v1/dev/scans/close-session",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    assert res.json()["sessions_closed"] == 1


async def test_close_session_rejects_an_unknown_stop(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans/close-session",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(uuid.uuid4()),
            "direction": "out",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 404


# ── PP triggers ───────────────────────────────────────────────────────────────


async def test_pp_trigger_sets_the_manifest_number(dev_client, db_session, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/pp/waybill",
        json={
            "trip_id": str(seeded["trip"].id),
            "parcel_perfect_reference": "WAY001",
            "manifest": 999,
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    assert res.json()["pp_manifest_number"] == 999
    consignment = (await db_session.execute(
        select(Consignment).where(Consignment.id == seeded["consignment"].id)
    )).scalar_one()
    assert consignment.pp_manifest_number == 999


async def test_pp_trigger_404s_for_a_consignment_not_on_the_trip(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/pp/waybill",
        json={
            "trip_id": str(seeded["trip"].id),
            "parcel_perfect_reference": "WAY005",
            "manifest": 1,
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 404


async def test_mid_trip_waybill_edit_moves_the_baseline(dev_client, db_session, seeded, store):
    """Reproduces spec §B2c. Drift DETECTION is Stage 5 and deliberately not built,
    so this asserts the gap: the expected count is silently adopted."""
    res = await dev_client.post(
        "/api/v1/dev/pp/waybill",
        json={
            "trip_id": str(seeded["trip"].id),
            "parcel_perfect_reference": "WAY001",
            "parcel_count": 27,
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    consignment = (await db_session.execute(
        select(Consignment).where(Consignment.id == seeded["consignment"].id)
    )).scalar_one()
    assert consignment.parcel_count_expected == 27


# ── Exception trigger ─────────────────────────────────────────────────────────


async def test_exception_trigger_records_a_real_exception(dev_client, db_session, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/exceptions",
        json={
            "trip_id": str(seeded["trip"].id),
            "exception_type": "cargo_damage",
            "description": "Pallet 3 shrink-wrap torn on arrival.",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    exception = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalar_one()
    assert exception.exception_type == ExceptionType.CARGO_DAMAGE


async def test_exception_trigger_404s_for_an_unknown_trip(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/exceptions",
        json={
            "trip_id": str(uuid.uuid4()),
            "exception_type": "cargo_damage",
            "description": "x",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 404


async def test_exception_trigger_rejects_an_empty_description(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/exceptions",
        json={
            "trip_id": str(seeded["trip"].id),
            "exception_type": "cargo_damage",
            "description": "",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 422


# ── The principle ─────────────────────────────────────────────────────────────


async def test_flushing_mock_state_leaves_evidence_intact(dev_client, db_session, seeded, store):
    """THE test for this plan's non-negotiable principle.

    Redis holds only the simulated outside world. Every permanent effect is a
    PostgreSQL row written by orchestration. Wiping the former must not disturb
    the latter — if it does, a trigger was writing state that evidence depends on.
    """
    await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
            "parcel_count": 3,
        },
        headers=auth_header(_token(seeded)),
    )
    parcels_before = sorted(
        (p.barcode, p.pp_scan_out_at, p.status)
        for p in (await db_session.execute(
            select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
        )).scalars().all()
    )
    exceptions_before = len((await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalars().all())

    flush = await dev_client.post(
        "/api/v1/dev/mock-state/flush", headers=auth_header(_token(seeded)),
    )

    assert flush.status_code == 200
    parcels_after = sorted(
        (p.barcode, p.pp_scan_out_at, p.status)
        for p in (await db_session.execute(
            select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
        )).scalars().all()
    )
    exceptions_after = len((await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalars().all())
    assert parcels_after == parcels_before
    assert exceptions_after == exceptions_before
