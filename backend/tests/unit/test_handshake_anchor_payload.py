"""Unit tests for the H2/H5 Hedera anchor payload shapes and verification.

Payload-shape tests are pure logic (no DB). The anchoring and verification
reconstruction tests use a real (rolled-back) db_session with the Hedera SDK
wrapper stubbed at the import boundary anchor_service uses it through — the
same approach as tests/unit/test_handshake_service.py's autouse fixture, kept
consistent here rather than mixing in a second mocking style.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.blockchain.hedera import HederaReceipt
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    ArtifactType, BlockchainReceiptType, HandshakeStatus, HandshakeType, IdvsStatus,
    OrganizationType, SubjectType, TripStatus, VehicleType, VerifyStatus,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.handshakes import HandshakeEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.handshake_service import (
    advance_h1, advance_h2, advance_h3, advance_h4, advance_h5,
    compute_h2_canonical_payload, compute_h5_canonical_payload,
)
from app.orchestration.verification_service import verify_subject
from app.schemas.handshakes import (
    H1CompleteRequest, H2CompleteRequest, H3CompleteRequest, H4CompleteRequest, H5CompleteRequest,
)

# Fields that must never appear in an anchored handshake payload — GPS, photos,
# artifact IDs, and timestamps are all either PII/location data (POPIA) or
# fields excluded to avoid datetime round-trip fragility in verification.
_FORBIDDEN_KEYS = {
    "driver_phone_lat", "driver_phone_lng", "horse_gps_lat", "horse_gps_lng",
    "gate_photo_artifact_id", "waybill_photo_artifact_id", "seal_photo_artifact_id",
    "pod_photo_artifact_id", "pod_signature_artifact_id", "completed_at",
}


@pytest.fixture(autouse=True)
def stub_hedera_service(monkeypatch):
    """Stub the Hedera SDK wrapper so advance_h2/advance_h5 anchor for real
    (real anchor_subject, real BlockchainReceipt row) without real network
    access — see the identical fixture in tests/unit/test_handshake_service.py.
    """
    mock_cls = MagicMock()
    mock_cls.return_value.submit_hash.return_value = HederaReceipt(
        topic_id="0.0.12345", sequence_number=1,
        consensus_timestamp="1715865600.000000000",
        transaction_id="0.0.12345@1715865600.000000000",
    )
    monkeypatch.setattr("app.blockchain.anchor_service.HederaService", mock_cls)
    return mock_cls


@pytest_asyncio.fixture
async def trip_fixture(db_session):
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
    origin = Precinct(id=uuid.uuid4(), name="Origin", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="Dest", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-ANCHOR-1", order_number="ORD-ANCHOR-1",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    h0 = HandshakeEvent(
        trip_id=trip.id, handshake_type=HandshakeType.TRIP_CREATION,
        sequence_number=0, status=HandshakeStatus.COMPLETED,
    )
    db_session.add(h0)
    await db_session.flush()

    return trip, driver


async def _make_artifact(db_session, trip_id):
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg", captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    return artifact.id


async def _advance_to_loading(db_session, trip, driver):
    await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
    ))
    return await advance_h2(db_session, trip_id=trip.id, driver_id=driver.id, payload=H2CompleteRequest(
        waybill_photo_artifact_id=await _make_artifact(db_session, trip.id), seal_number="AB-1234",
        seal_photo_artifact_id=await _make_artifact(db_session, trip.id), driver_visual_count=42,
    ))


async def _advance_to_dest_gate_in(db_session, trip, driver):
    await _advance_to_loading(db_session, trip, driver)
    await advance_h3(db_session, trip_id=trip.id, driver_id=driver.id, payload=H3CompleteRequest(
        guard_verified_seal=True,
    ))
    return await advance_h4(db_session, trip_id=trip.id, driver_id=driver.id, payload=H4CompleteRequest(
        seal_number_at_destination="AB-1234",
    ))


# ── Payload shape: no GPS/artifact/PII keys (pure logic, no DB) ────────────────

def test_h2_canonical_payload_excludes_gps_artifacts_and_pii():
    event_id = uuid.uuid4()
    trip_id = uuid.uuid4()

    payload = compute_h2_canonical_payload(
        handshake_event_id=event_id, trip_id=trip_id, seal_number="AB-1234", driver_visual_count=42,
    )

    assert not (_FORBIDDEN_KEYS & payload.keys())
    assert payload == {
        "handshake_event_id": str(event_id), "trip_id": str(trip_id),
        "handshake_type": "loading", "seal_number": "AB-1234", "driver_visual_count": 42,
    }


def test_h5_canonical_payload_excludes_gps_artifacts_and_pii():
    event_id = uuid.uuid4()
    trip_id = uuid.uuid4()

    payload = compute_h5_canonical_payload(
        handshake_event_id=event_id, trip_id=trip_id, pp_scan_in_count=42, driver_visual_count=40,
    )

    assert not (_FORBIDDEN_KEYS & payload.keys())
    assert payload == {
        "handshake_event_id": str(event_id), "trip_id": str(trip_id),
        "handshake_type": "unloading", "pp_scan_in_count": 42, "driver_visual_count": 40,
    }


# ── Anchoring: receipt_type per handshake, anchors on mismatch too (DB-gated) ──

@pytest.mark.asyncio
async def test_advance_h2_anchors_with_pickup_receipt_type(db_session, trip_fixture):
    trip, driver = trip_fixture

    result = await _advance_to_loading(db_session, trip, driver)

    h2 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.LOADING)
    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == h2.blockchain_receipt_id)
    )).scalar_one()

    assert receipt.subject_type == SubjectType.HANDSHAKE_EVENT
    assert receipt.receipt_type == BlockchainReceiptType.PICKUP
    assert receipt.data_hash == h2.event_hash


@pytest.mark.asyncio
async def test_advance_h5_anchors_with_delivery_receipt_type(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_dest_gate_in(db_session, trip, driver)

    result = await advance_h5(db_session, trip_id=trip.id, driver_id=driver.id, payload=H5CompleteRequest(
        pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
        pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
        driver_visual_count=42, pp_scan_in_count=42,
    ))

    h5 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.UNLOADING)
    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == h5.blockchain_receipt_id)
    )).scalar_one()

    assert receipt.subject_type == SubjectType.HANDSHAKE_EVENT
    assert receipt.receipt_type == BlockchainReceiptType.DELIVERY
    assert receipt.data_hash == h5.event_hash


@pytest.mark.asyncio
async def test_advance_h5_anchors_even_on_count_mismatch(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_dest_gate_in(db_session, trip, driver)

    result = await advance_h5(db_session, trip_id=trip.id, driver_id=driver.id, payload=H5CompleteRequest(
        pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
        pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
        driver_visual_count=40, pp_scan_in_count=42,
    ))

    h5 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.UNLOADING)
    assert h5.status == HandshakeStatus.EXCEPTION
    assert h5.blockchain_receipt_id is not None


# ── Verification reconstruction: proves reconstruct == anchored payload ───────

@pytest.mark.asyncio
async def test_verify_subject_after_h2_reconstructs_matching_payload(db_session, trip_fixture):
    trip, driver = trip_fixture
    result = await _advance_to_loading(db_session, trip, driver)
    h2 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.LOADING)

    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.HANDSHAKE_EVENT, subject_id=h2.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    stub_service.verify_hash.assert_called_once_with(
        outcome.receipt.hedera_topic_id, outcome.receipt.hedera_sequence_number, outcome.receipt.data_hash,
    )


@pytest.mark.asyncio
async def test_verify_subject_after_h5_reconstructs_matching_payload(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_dest_gate_in(db_session, trip, driver)
    result = await advance_h5(db_session, trip_id=trip.id, driver_id=driver.id, payload=H5CompleteRequest(
        pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
        pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
        driver_visual_count=42, pp_scan_in_count=42,
    ))
    h5 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.UNLOADING)

    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.HANDSHAKE_EVENT, subject_id=h5.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
