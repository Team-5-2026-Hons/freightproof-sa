"""Integration tests: H2/H5 handshake completion anchors to Hedera HCS.

Mirrors tests/integration/test_trips_anchor.py's approach (patch HederaService
at the app.blockchain.anchor_service import boundary) applied to the
driver-JWT-authenticated handshake endpoints exercised in
tests/integration/test_handshakes.py — this file reuses that module's seeding
fixtures rather than DEMO_MODE auth, since H1-H5 require a real Driver row.
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.blockchain.hedera import HederaReceipt, HederaTimeoutError
from app.db.models.enums import ArtifactType, IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.evidence import EvidenceArtifact
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
        id=uuid.uuid4(), trip_reference="FP-TEST-HA", order_number="ORD-HA",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    return trip, driver


async def _make_artifact(db_session, trip_id) -> str:
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg",
        captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    return str(artifact.id)


def _fake_hedera_receipt() -> HederaReceipt:
    return HederaReceipt(
        topic_id="0.0.12345", sequence_number=7,
        consensus_timestamp=None, transaction_id="0.0.12345@1715865600.0",
    )


async def _complete_h1(client: AsyncClient, db_session, trip, token) -> None:
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/handshakes/h1/complete",
        json={
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "gate_photo_artifact_id": await _make_artifact(db_session, trip.id),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200


def _h2_payload(waybill_id: str, seal_photo_id: str) -> dict:
    return {
        "waybill_photo_artifact_id": waybill_id,
        "seal_number": "AB-1234",
        "seal_photo_artifact_id": seal_photo_id,
        "driver_visual_count": 42,
    }


async def test_h2_complete_anchors_and_returns_event_hash(client: AsyncClient, db_session, seed_trip):
    """POST h2/complete → 200, with event_hash + blockchain_receipt_id set on
    the H2 handshake in the response — the fields the driver-pwa's "anchored"
    badge reads."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_h1(client, db_session, trip, token)
    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()

        resp = await client.post(
            f"/api/v1/trips/{trip.id}/handshakes/h2/complete",
            json=_h2_payload(waybill_id, seal_photo_id),
            headers=auth_header(token),
        )

    assert resp.status_code == 200
    body = resp.json()
    h2 = next(h for h in body["handshakes"] if h["handshake_type"] == "loading")
    assert h2["event_hash"] is not None
    assert h2["blockchain_receipt_id"] is not None


async def test_h2_complete_hedera_timeout_returns_504_and_trip_unchanged(
    client: AsyncClient, db_session, seed_trip,
):
    """A Hedera failure during H2 must not silently advance the trip — the
    driver should see a clear failure and be able to retry, not a trip that
    looks like it loaded when nothing was anchored.

    submit_hash raises HederaTimeoutError directly rather than actually
    stalling past HEDERA_SUBMIT_TIMEOUT_SECONDS (that stall→504 mechanism is
    already covered by tests/unit/test_anchor_service_timeout.py); this test's
    job is only to prove the endpoint's HederaTimeoutError -> 504 mapping and
    the resulting non-advancement of trip.status.
    """
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_h1(client, db_session, trip, token)
    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.side_effect = HederaTimeoutError("Simulated Hedera timeout")

        resp = await client.post(
            f"/api/v1/trips/{trip.id}/handshakes/h2/complete",
            json=_h2_payload(waybill_id, seal_photo_id),
            headers=auth_header(token),
        )

    assert resp.status_code == 504

    db_session.expire_all()
    refreshed = (await db_session.execute(select(Trip).where(Trip.id == trip.id))).scalar_one()
    assert refreshed.status == TripStatus.ORIGIN_GATE_IN  # H2 never advanced the trip to LOADING


async def test_trip_detail_lists_h2_handshake_receipt_for_dispatcher(
    client: AsyncClient, db_session, seed_trip,
):
    """The driver→dispatcher anchoring link: after H2 anchors, GET /trips/{id}
    (the dispatcher portal's data source) must list the HANDSHAKE_EVENT receipt
    in blockchain_receipts. resource_service.get_trip_detail used to filter
    subject_type == TRIP only, silently hiding every driver-anchored receipt
    from the dispatcher's per-trip evidence view."""
    trip, driver = seed_trip
    driver_token = make_token(sub=str(driver.id), role="driver")
    await _complete_h1(client, db_session, trip, driver_token)
    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        h2_resp = await client.post(
            f"/api/v1/trips/{trip.id}/handshakes/h2/complete",
            json=_h2_payload(waybill_id, seal_photo_id),
            headers=auth_header(driver_token),
        )
    assert h2_resp.status_code == 200
    h2 = next(h for h in h2_resp.json()["handshakes"] if h["handshake_type"] == "loading")

    # Receipts are role-gated (FP-115): only admin_dispatcher sees the full list,
    # so the read side authenticates as an admin in the trip's operator org.
    admin = User(
        id=uuid.uuid4(), organization_id=trip.operator_organization_id,
        email="admin@test.co.za", full_name="Admin",
    )
    db_session.add(admin)
    await db_session.flush()
    admin_token = make_token(
        sub=str(admin.id), role="admin_dispatcher",
        org_id=str(trip.operator_organization_id),
    )

    detail_resp = await client.get(f"/api/v1/trips/{trip.id}", headers=auth_header(admin_token))

    assert detail_resp.status_code == 200
    receipts = detail_resp.json()["blockchain_receipts"]
    handshake_receipts = [r for r in receipts if r["subject_type"] == "handshake_event"]
    assert len(handshake_receipts) == 1
    assert handshake_receipts[0]["subject_id"] == h2["id"]
    assert handshake_receipts[0]["id"] == h2["blockchain_receipt_id"]
