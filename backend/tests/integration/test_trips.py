"""Integration tests for POST /api/v1/trips.

These tests use a real PostgreSQL test database (TEST_DATABASE_URL) and a
rolled-back transaction per test. DEMO_MODE=True is required — the stub auth
dependency returns a fixed user whose organization_id is _DEMO_ORG_ID.
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.blockchain.hedera import HederaSubmitError, HederaTimeoutError
from app.main import app
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
from app.db.models.trips import Consignment, Parcel, Trip, TripStop, TripTrailer
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
        "driver_id": str(seed["driver_id"]),
        "horse_id": str(seed["horse_id"]),
        "trailer_ids": [str(seed["trailer_id"])],
        "origin_precinct_id": str(seed["origin_id"]),
        "destination_precinct_id": str(seed["destination_id"]),
        "consignments": [{"pp_reference": "MOCKWAY001", "unit_count_expected": 2}],
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


async def test_create_trip_zero_trailers(seed_data, db_session):
    """A trip with no trailers is valid — rigid trucks and integrated bodies run
    without trailers (empty trailer list is a valid canonical value, see
    crypto/hashing.py). This supersedes the old 422-on-empty-trailers expectation,
    which predates that decision."""
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-NOTRAILER-001"
    payload["trailer_ids"] = []
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["trailers"] == []
    assert body["journey_lock_hash"] is not None
    assert len(body["journey_lock_hash"]) == 64

    trip_id = uuid.UUID(body["id"])
    trailer_rows = (
        await db_session.execute(select(TripTrailer).where(TripTrailer.trip_id == trip_id))
    ).scalars().all()
    assert trailer_rows == []


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


async def _post_trip_with_hedera_failure(payload: dict, side_effect: Exception):
    """POST /trips with HederaService patched so submit_hash raises side_effect.

    Patch target follows test_trips_anchor.py — anchor_service instantiates
    HederaService itself, so the class is patched where anchor_service imports it.
    """
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        instance = MagicMock()
        instance.submit_hash.side_effect = side_effect
        MockService.return_value = instance

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.post(
                "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
            )


async def _assert_no_trip_persisted(db_session: AsyncSession, order_number: str) -> None:
    """Assert fail-closed H0: nothing survives a failed anchoring attempt.

    The autouse get_db override yields the test session without the
    rollback-on-exception that production get_db performs, so the flushed-but-
    unanchored Trip row is still pending here. Mirror production's rollback
    first — if trip_service had committed mid-way (breaking atomicity), the
    row would survive this rollback and the assertion would catch it.
    """
    await db_session.rollback()
    row = (
        await db_session.execute(select(Trip).where(Trip.order_number == order_number))
    ).scalar_one_or_none()
    assert row is None


async def test_create_trip_hedera_timeout_returns_504_and_no_trip(seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-HEDERA-TIMEOUT-001"

    resp = await _post_trip_with_hedera_failure(
        payload, HederaTimeoutError("Hedera anchoring did not respond in time")
    )

    assert resp.status_code == 504
    assert "retry" in resp.json()["detail"].lower()
    await _assert_no_trip_persisted(db_session, "ORD-HEDERA-TIMEOUT-001")


async def test_create_trip_hedera_service_error_returns_502_and_no_trip(seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-HEDERA-DOWN-001"

    # HederaSubmitError subclasses HederaServiceError — the realistic failure
    # shape for the endpoint's generic HederaServiceError → 502 handler.
    resp = await _post_trip_with_hedera_failure(
        payload, HederaSubmitError("Failed to submit hash to Hedera HCS.")
    )

    assert resp.status_code == 502
    assert "retry" in resp.json()["detail"].lower()
    await _assert_no_trip_persisted(db_session, "ORD-HEDERA-DOWN-001")


async def test_list_trips_empty_returns_200(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/trips",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_trips_returns_created_trip(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
        resp = await client.get(
            "/api/v1/trips",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 1
    assert body[0]["order_number"] == "ORD-TEST-001"
    assert body[0]["status"] == "created"
    assert body[0]["open_exception_count"] == 0
    assert "driver" in body[0]
    assert "horse" in body[0]
    assert "trailers" in body[0]


async def test_list_trips_status_filter(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
        resp_created = await client.get(
            "/api/v1/trips?status=created",
            headers={"Authorization": "Bearer demo"},
        )
        resp_in_transit = await client.get(
            "/api/v1/trips?status=in_transit",
            headers={"Authorization": "Bearer demo"},
        )
    assert len(resp_created.json()) == 1
    assert resp_in_transit.json() == []


async def test_get_trip_detail_returns_200(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        create_resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
        trip_id = create_resp.json()["id"]
        resp = await client.get(
            f"/api/v1/trips/{trip_id}",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert body["id"] == trip_id
    assert len(body["handshakes"]) == 1
    assert body["handshakes"][0]["handshake_type"] == "trip_creation"


async def test_get_trip_detail_not_found_returns_404(seed_data, db_session):
    import uuid
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            f"/api/v1/trips/{uuid.uuid4()}",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 404


# ─── Consignment loop / empty legs (trip-creation-redesign Task 6) ─────────────

async def test_create_trip_persists_consignments_and_parcels(seed_data, db_session):
    """POST with two consignments persists a Consignment row per waybill (with the
    dispatcher-entered unit_count_expected) and a Parcel row per PP track."""
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-CONSIGN-001"
    payload["consignments"] = [
        {"pp_reference": "MOCKWAY001", "unit_count_expected": 2},
        {"pp_reference": "WAY001", "unit_count_expected": 4},
    ]
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body["consignments"]) == 2

    trip_id = uuid.UUID(body["id"])
    consignment_rows = (
        await db_session.execute(select(Consignment).where(Consignment.trip_id == trip_id))
    ).scalars().all()
    assert len(consignment_rows) == 2

    by_ref = {c.parcel_perfect_reference: c for c in consignment_rows}
    assert by_ref["MOCKWAY001"].unit_count_expected == 2
    assert by_ref["WAY001"].unit_count_expected == 4

    parcel_rows = (
        await db_session.execute(
            select(Parcel).where(Parcel.consignment_id.in_([c.id for c in consignment_rows]))
        )
    ).scalars().all()
    barcodes = {p.barcode for p in parcel_rows}
    expected_barcodes = {"MOCKWAY0010001", "MOCKWAY0010002"} | {
        f"WAY001{n:04d}" for n in range(1, 6)
    }
    assert barcodes == expected_barcodes


async def test_create_trip_unknown_waybill_rolls_back_everything(seed_data, db_session):
    """A PP waybill that doesn't resolve must roll back the whole trip — atomicity,
    not a partially-created trip with no manifest."""
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-ROLLBACK-001"
    payload["consignments"] = [{"pp_reference": "NOPE999", "unit_count_expected": 1}]
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 422

    trip_rows = (
        await db_session.execute(select(Trip).where(Trip.order_number == "ORD-ROLLBACK-001"))
    ).scalars().all()
    assert trip_rows == []
    stop_rows = (await db_session.execute(select(TripStop))).scalars().all()
    assert stop_rows == []
    consignment_rows = (await db_session.execute(select(Consignment))).scalars().all()
    assert consignment_rows == []
    handshake_rows = (await db_session.execute(select(HandshakeEvent))).scalars().all()
    assert handshake_rows == []


async def test_create_trip_unmapped_accnum_returns_warning(seed_data, db_session):
    """WAY004's accnum (UNMAP9) has no matching Organization — the consignment is
    still saved (client_organization_id NULL) with a non-fatal warning surfaced."""
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-WARN-001"
    payload["consignments"] = [{"pp_reference": "WAY004", "unit_count_expected": 3}]
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body["warnings"]) >= 1
    assert any("UNMAP9" in w for w in body["warnings"])

    trip_id = uuid.UUID(body["id"])
    consignment_row = (
        await db_session.execute(select(Consignment).where(Consignment.trip_id == trip_id))
    ).scalar_one()
    assert consignment_row.client_organization_id is None


async def test_create_empty_leg_no_consignments_no_pp_call(seed_data, db_session, monkeypatch):
    """An empty-leg trip (no consignments) must never touch Parcel Perfect."""
    def _raise(*args, **kwargs):
        raise AssertionError("PP client must not be called for an empty-leg trip")

    monkeypatch.setattr("app.orchestration.consignment_service.get_pp_client", _raise)

    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-EMPTY-001"
    payload["trip_type"] = "empty_leg"
    payload["consignments"] = []

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["trip_type"] == "empty_leg"

    trip_id = uuid.UUID(body["id"])
    consignment_rows = (
        await db_session.execute(select(Consignment).where(Consignment.trip_id == trip_id))
    ).scalars().all()
    assert consignment_rows == []
