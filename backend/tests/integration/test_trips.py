"""Integration tests for POST /api/v1/trips.

These tests use a real PostgreSQL test database (TEST_DATABASE_URL) and a
rolled-back transaction per test. DEMO_MODE=True is required — the stub auth
dependency returns a fixed user whose organization_id is _DEMO_ORG_ID.
"""

import uuid
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.main import app
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
from app.db.models.trips import Trip, TripTrailer
from app.db.models.handshakes import HandshakeEvent
from app.db.models.enums import (
    HandshakeStatus, HandshakeType, IdvsStatus,
    OrganizationType, TripStatus, VehicleType,
)
from app.auth.dependencies import _DEMO_ORG_ID, _DEMO_USER_ID
from app.db.session import get_db


# Override get_db so the endpoint uses the same rolled-back session as seed_data
@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


# ─── Seed fixtures ──────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seed_data(db_session: AsyncSession):
    """Insert the minimal rows required by POST /trips and yield their IDs."""

    operator_org = Organization(
        id=_DEMO_ORG_ID,
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    client_org = Organization(
        id=uuid.uuid4(),
        name="Demo Client",
        org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([operator_org, client_org])
    await db_session.flush()

    demo_user = User(
        id=_DEMO_USER_ID,
        organization_id=_DEMO_ORG_ID,
        email="demo-dispatcher@freightproof.co.za",
        full_name="Demo Dispatcher",
        is_active=True,
    )
    db_session.add(demo_user)
    await db_session.flush()

    origin = Precinct(
        id=uuid.uuid4(),
        name="Cape Town Depot",
        principal_organization_id=client_org.id,
        latitude="33.9249",
        longitude="18.4241",
    )
    destination = Precinct(
        id=uuid.uuid4(),
        name="Johannesburg Depot",
        principal_organization_id=client_org.id,
        latitude="26.2041",
        longitude="28.0473",
    )
    db_session.add_all([origin, destination])
    await db_session.flush()

    driver = Driver(
        id=uuid.uuid4(),
        organization_id=_DEMO_ORG_ID,
        full_name="Test Driver",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-001",
        idvs_status=IdvsStatus.PENDING,
    )
    horse = Vehicle(
        id=uuid.uuid4(),
        organization_id=_DEMO_ORG_ID,
        registration="CA 123-456",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-HORSE-001",
    )
    trailer = Vehicle(
        id=uuid.uuid4(),
        organization_id=_DEMO_ORG_ID,
        registration="CA 789-012",
        vehicle_type=VehicleType.TRAILER,
        pulsit_device_id="PLT-TRAILER-001",
    )
    db_session.add_all([driver, horse, trailer])
    await db_session.flush()

    yield {
        "client_org_id": client_org.id,
        "origin_id": origin.id,
        "destination_id": destination.id,
        "driver_id": driver.id,
        "horse_id": horse.id,
        "trailer_id": trailer.id,
        "trailer_pulsit_id": trailer.pulsit_device_id,
    }


# ─── Helper ─────────────────────────────────────────────────────────────────

def _make_payload(seed: dict) -> dict:
    return {
        "order_number": "ORD-TEST-001",
        "client_organization_id": str(seed["client_org_id"]),
        "driver_id": str(seed["driver_id"]),
        "horse_id": str(seed["horse_id"]),
        "trailer_ids": [str(seed["trailer_id"])],
        "origin_precinct_id": str(seed["origin_id"]),
        "destination_precinct_id": str(seed["destination_id"]),
    }


# ─── Tests ──────────────────────────────────────────────────────────────────

async def test_create_trip_returns_201(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 201


async def test_create_trip_response_shape(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert body["status"] == "created"
    assert body["order_number"] == "ORD-TEST-001"
    assert body["trip_reference"].startswith("FP-")
    assert len(body["journey_lock_hash"]) == 64
    assert body["idvs_check_status"] == "pending"
    assert len(body["handshakes"]) == 1
    assert body["handshakes"][0]["handshake_type"] == "trip_creation"
    assert body["handshakes"][0]["status"] == "pending"
    assert body["handshakes"][0]["sequence_number"] == 0
    assert len(body["trailers"]) == 1
    assert body["exceptions"] == []
    assert body["blockchain_receipts"] == []
    assert "created_at" in body
    assert "updated_at" in body


async def test_create_trip_writes_trip_to_db(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 201
    trip_id = uuid.UUID(resp.json()["id"])

    trip_row = (await db_session.execute(select(Trip).where(Trip.id == trip_id))).scalar_one()
    assert trip_row.status == TripStatus.CREATED
    assert trip_row.journey_lock_hash is not None
    assert len(trip_row.journey_lock_hash) == 64


async def test_create_trip_writes_trailer_snapshot_to_db(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
    trip_id = uuid.UUID(resp.json()["id"])

    trailer_rows = (
        await db_session.execute(select(TripTrailer).where(TripTrailer.trip_id == trip_id))
    ).scalars().all()
    assert len(trailer_rows) == 1
    assert trailer_rows[0].pulsit_device_id_snapshot == seed_data["trailer_pulsit_id"]


async def test_create_trip_writes_h0_handshake_to_db(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
    trip_id = uuid.UUID(resp.json()["id"])

    h0_row = (
        await db_session.execute(
            select(HandshakeEvent).where(HandshakeEvent.trip_id == trip_id)
        )
    ).scalar_one()
    assert h0_row.handshake_type == HandshakeType.TRIP_CREATION
    assert h0_row.sequence_number == 0
    assert h0_row.status == HandshakeStatus.PENDING


async def test_create_trip_409_on_duplicate_order_number(seed_data, db_session):
    payload = _make_payload(seed_data)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
        assert first.status_code == 201
        second = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
    assert second.status_code == 409
    assert "ORD-TEST-001" in second.json()["detail"]


async def test_create_trip_404_unknown_driver(seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["driver_id"] = str(uuid.uuid4())
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
    assert resp.status_code == 404
    assert "Driver" in resp.json()["detail"]


async def test_create_trip_422_no_trailers(seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["trailer_ids"] = []
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
    assert resp.status_code == 422


async def test_create_trip_422_same_origin_and_destination(seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["destination_precinct_id"] = payload["origin_precinct_id"]
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
    assert resp.status_code == 422


async def test_create_trip_403_without_demo_mode(seed_data, db_session, monkeypatch):
    # FastAPI's HTTPBearer returns 403 (not 401) when the Authorization header
    # is completely absent. 401 is reserved for an invalid/expired token.
    monkeypatch.setattr("app.core.config.settings.DEMO_MODE", False)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
        )
    assert resp.status_code == 403
