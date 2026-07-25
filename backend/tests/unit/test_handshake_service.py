"""Unit tests for the handshake state machine (advance_h1..advance_h5)."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.blockchain.hedera import HederaReceipt
from app.core.exceptions import HandshakeSequenceError, ResourceNotFoundError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    ArtifactType, BlockchainReceiptType, ExceptionSeverity, ExceptionType, HandshakeStatus,
    HandshakeType, IdvsStatus, OrganizationType, TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.handshakes import HandshakeEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.handshake_service import advance_h1, advance_h2, advance_h3, advance_h4, advance_h5
from app.schemas.handshakes import H1CompleteRequest, H2CompleteRequest, H3CompleteRequest, H4CompleteRequest, H5CompleteRequest


@pytest.fixture(autouse=True)
def stub_hedera_service(monkeypatch):
    """H2/H5 now anchor to Hedera via anchor_subject(), which builds its own
    HederaService() when advance_h2/advance_h5 don't pass one in (they don't —
    same no-injection shape as trip_service.create_trip). These tests use a
    real (rolled-back) db_session but must not touch the real Hedera SDK, so
    the SDK wrapper class is patched at the import boundary anchor_service
    uses it through, matching tests/integration/test_trips_anchor.py.
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
        id=uuid.uuid4(), trip_reference="FP-TEST-1", order_number="ORD-1",
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
    """Insert a real EvidenceArtifact row — handshake_events FK-references this table."""
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
    await advance_h2(db_session, trip_id=trip.id, driver_id=driver.id, payload=H2CompleteRequest(
        waybill_photo_artifact_id=await _make_artifact(db_session, trip.id), seal_number="AB-1234",
        seal_photo_artifact_id=await _make_artifact(db_session, trip.id), driver_visual_count=42,
    ))


async def _advance_to_in_transit(db_session, trip, driver):
    await _advance_to_loading(db_session, trip, driver)
    await advance_h3(db_session, trip_id=trip.id, driver_id=driver.id, payload=H3CompleteRequest(
        guard_verified_seal=True,
    ))


async def _advance_to_dest_gate_in(db_session, trip, driver, seal="AB-1234"):
    await _advance_to_in_transit(db_session, trip, driver)
    return await advance_h4(db_session, trip_id=trip.id, driver_id=driver.id, payload=H4CompleteRequest(
        seal_number_at_destination=seal,
    ))


@pytest.mark.asyncio
async def test_advance_h1_happy_path_sets_trip_status(db_session, trip_fixture):
    trip, driver = trip_fixture
    payload = H1CompleteRequest(
        driver_phone_lat=Decimal("0.0001"), driver_phone_lng=Decimal("0.0001"),
    )
    result = await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=payload)
    assert result.status == TripStatus.ORIGIN_GATE_IN


@pytest.mark.asyncio
async def test_advance_h1_wrong_state_raises_sequence_error(db_session, trip_fixture):
    trip, driver = trip_fixture
    trip.status = TripStatus.IN_TRANSIT
    await db_session.flush()
    payload = H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
    )
    with pytest.raises(HandshakeSequenceError):
        await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=payload)


@pytest.mark.asyncio
async def test_advance_h1_unknown_trip_raises_not_found(db_session):
    payload = H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
    )
    with pytest.raises(ResourceNotFoundError):
        await advance_h1(db_session, trip_id=uuid.uuid4(), driver_id=uuid.uuid4(), payload=payload)


@pytest.mark.asyncio
async def test_advance_h2_happy_path_stores_seal_and_hash(db_session, trip_fixture):
    trip, driver = trip_fixture
    await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
    ))

    result = await advance_h2(db_session, trip_id=trip.id, driver_id=driver.id, payload=H2CompleteRequest(
        waybill_photo_artifact_id=await _make_artifact(db_session, trip.id), seal_number="AB-1234",
        seal_photo_artifact_id=await _make_artifact(db_session, trip.id), driver_visual_count=42,
    ))
    assert result.status == TripStatus.LOADING
    h2 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.LOADING)
    assert h2.seal_number == "AB-1234"
    assert h2.event_hash is not None
    assert h2.blockchain_receipt_id is not None

    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == h2.blockchain_receipt_id)
    )).scalar_one()
    assert receipt.data_hash == h2.event_hash
    assert receipt.receipt_type == BlockchainReceiptType.PICKUP


@pytest.mark.asyncio
async def test_advance_h3_happy_path_sets_in_transit(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_loading(db_session, trip, driver)

    result = await advance_h3(db_session, trip_id=trip.id, driver_id=driver.id, payload=H3CompleteRequest(
        guard_verified_seal=True,
    ))
    assert result.status == TripStatus.IN_TRANSIT


@pytest.mark.asyncio
async def test_wrong_state_with_db_loaded_str_status_raises_sequence_error():
    """Regression: Trip.status is a String(30) column, so DB-loaded trips carry a
    plain str. The old code called .value on it, turning every out-of-sequence
    submit into an AttributeError (HTTP 500) instead of HandshakeSequenceError (409).
    Pure unit test — mocks the session so the str-typed status is guaranteed."""
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.orchestration.handshake_service import _load_trip_for_handshake

    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = SimpleNamespace(status="loading")
    db.execute.return_value = result

    with pytest.raises(HandshakeSequenceError) as exc_info:
        await _load_trip_for_handshake(
            db, trip_id=uuid.uuid4(), driver_id=uuid.uuid4(),
            expected_status=TripStatus.ORIGIN_GATE_IN, handshake_label="H2 Loading",
        )
    assert exc_info.value.trip_status == "loading"


@pytest.mark.asyncio
async def test_advance_h3_guard_refused_creates_exception_but_departs(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_loading(db_session, trip, driver)

    result = await advance_h3(db_session, trip_id=trip.id, driver_id=driver.id, payload=H3CompleteRequest(
        guard_verified_seal=False,
    ))

    assert result.status == TripStatus.IN_TRANSIT  # recorded, not held — H3 is a feeder
    assert len(result.exceptions) == 1
    assert result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    assert result.exceptions[0].severity == ExceptionSeverity.CRITICAL
    h3 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.ORIGIN_GATE_OUT)
    assert h3.status == HandshakeStatus.EXCEPTION


@pytest.mark.asyncio
async def test_advance_h3_confirmed_seal_mismatch_creates_exception(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_loading(db_session, trip, driver)  # H2 seal is AB-1234

    result = await advance_h3(db_session, trip_id=trip.id, driver_id=driver.id, payload=H3CompleteRequest(
        guard_verified_seal=True, seal_number_confirmed="ZZ-9999",
    ))

    assert result.status == TripStatus.IN_TRANSIT
    assert len(result.exceptions) == 1
    assert result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    h3 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.ORIGIN_GATE_OUT)
    assert h3.seal_number == "ZZ-9999"


@pytest.mark.asyncio
async def test_advance_h3_confirmed_seal_match_supersedes_guard_flag(db_session, trip_fixture):
    """The server-side comparison against H2's committed seal is authoritative:
    a device that lost its local seal reference sends guard_verified_seal=False,
    which must not create a false mismatch when the re-entered seal matches."""
    trip, driver = trip_fixture
    await _advance_to_loading(db_session, trip, driver)  # H2 seal is AB-1234

    result = await advance_h3(db_session, trip_id=trip.id, driver_id=driver.id, payload=H3CompleteRequest(
        guard_verified_seal=False, seal_number_confirmed="ab-1234 ",  # normalised before compare
    ))

    assert result.status == TripStatus.IN_TRANSIT
    assert result.exceptions == []
    h3 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.ORIGIN_GATE_OUT)
    assert h3.status == HandshakeStatus.COMPLETED


@pytest.mark.asyncio
async def test_advance_h4_matching_seal_sets_dest_gate_in(db_session, trip_fixture):
    trip, driver = trip_fixture
    result = await _advance_to_dest_gate_in(db_session, trip, driver, seal="AB-1234")
    assert result.status == TripStatus.DEST_GATE_IN
    assert result.exceptions == []


@pytest.mark.asyncio
async def test_advance_h4_seal_mismatch_creates_exception_and_holds_trip(db_session, trip_fixture):
    trip, driver = trip_fixture
    result = await _advance_to_dest_gate_in(db_session, trip, driver, seal="ZZ-9999")
    assert result.status == TripStatus.EXCEPTION_HOLD
    assert len(result.exceptions) == 1
    assert result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    assert result.exceptions[0].severity == ExceptionSeverity.CRITICAL


@pytest.mark.asyncio
async def test_advance_h5_matching_counts_closes_trip(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_dest_gate_in(db_session, trip, driver, seal="AB-1234")

    result = await advance_h5(db_session, trip_id=trip.id, driver_id=driver.id, payload=H5CompleteRequest(
        pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
        pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
        driver_visual_count=42, pp_scan_in_count=42,
    ))
    assert result.status == TripStatus.CLOSED
    assert result.closed_at is not None
    assert result.exceptions == []

    h5 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.UNLOADING)
    assert h5.blockchain_receipt_id is not None

    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == h5.blockchain_receipt_id)
    )).scalar_one()
    assert receipt.data_hash == h5.event_hash
    assert receipt.receipt_type == BlockchainReceiptType.DELIVERY


@pytest.mark.asyncio
async def test_advance_h5_count_mismatch_creates_exception_but_still_closes(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_dest_gate_in(db_session, trip, driver, seal="AB-1234")

    result = await advance_h5(db_session, trip_id=trip.id, driver_id=driver.id, payload=H5CompleteRequest(
        pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
        pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
        driver_visual_count=40, pp_scan_in_count=42,
    ))
    assert result.status == TripStatus.CLOSED
    assert len(result.exceptions) == 1

    h5 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.UNLOADING)
    assert h5.status == HandshakeStatus.EXCEPTION
    assert h5.blockchain_receipt_id is not None  # anchored despite the mismatch — the mismatch is evidence too
    assert result.exceptions[0].exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH
