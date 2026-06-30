"""Unit tests for the handshake state machine (advance_h1..advance_h5)."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
import pytest_asyncio

from app.core.exceptions import HandshakeSequenceError, ResourceNotFoundError
from app.db.models.enums import (
    ArtifactType, ExceptionSeverity, ExceptionType, HandshakeStatus, HandshakeType, IdvsStatus,
    OrganizationType, TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.handshakes import HandshakeEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.handshake_service import advance_h1, advance_h2, advance_h3, advance_h4, advance_h5
from app.schemas.handshakes import H1CompleteRequest, H2CompleteRequest, H3CompleteRequest, H4CompleteRequest, H5CompleteRequest


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
        gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
    ))
    await advance_h2(db_session, trip_id=trip.id, driver_id=driver.id, payload=H2CompleteRequest(
        waybill_photo_artifact_id=await _make_artifact(db_session, trip.id), seal_number="AB-1234",
        seal_photo_artifact_id=await _make_artifact(db_session, trip.id), driver_visual_count=42,
    ))


async def _advance_to_in_transit(db_session, trip, driver):
    await _advance_to_loading(db_session, trip, driver)
    await advance_h3(db_session, trip_id=trip.id, driver_id=driver.id, payload=H3CompleteRequest(
        gate_exit_photo_artifact_id=await _make_artifact(db_session, trip.id), guard_verified_seal=True,
    ))


async def _advance_to_dest_gate_in(db_session, trip, driver, seal="AB-1234"):
    await _advance_to_in_transit(db_session, trip, driver)
    return await advance_h4(db_session, trip_id=trip.id, driver_id=driver.id, payload=H4CompleteRequest(
        gate_entry_photo_artifact_id=await _make_artifact(db_session, trip.id), seal_number_at_destination=seal,
    ))


@pytest.mark.asyncio
async def test_advance_h1_happy_path_sets_trip_status(db_session, trip_fixture):
    trip, driver = trip_fixture
    payload = H1CompleteRequest(
        driver_phone_lat=Decimal("0.0001"), driver_phone_lng=Decimal("0.0001"),
        gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
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
        gate_photo_artifact_id=uuid.uuid4(),
    )
    with pytest.raises(HandshakeSequenceError):
        await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=payload)


@pytest.mark.asyncio
async def test_advance_h1_unknown_trip_raises_not_found(db_session):
    payload = H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
        gate_photo_artifact_id=uuid.uuid4(),
    )
    with pytest.raises(ResourceNotFoundError):
        await advance_h1(db_session, trip_id=uuid.uuid4(), driver_id=uuid.uuid4(), payload=payload)


@pytest.mark.asyncio
async def test_advance_h2_happy_path_stores_seal_and_hash(db_session, trip_fixture):
    trip, driver = trip_fixture
    await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
        gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
    ))

    result = await advance_h2(db_session, trip_id=trip.id, driver_id=driver.id, payload=H2CompleteRequest(
        waybill_photo_artifact_id=await _make_artifact(db_session, trip.id), seal_number="AB-1234",
        seal_photo_artifact_id=await _make_artifact(db_session, trip.id), driver_visual_count=42,
    ))
    assert result.status == TripStatus.LOADING
    h2 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.LOADING)
    assert h2.seal_number == "AB-1234"
    assert h2.event_hash is not None
    assert h2.blockchain_receipt_id is None  # Hedera anchoring deferred — not this plan


@pytest.mark.asyncio
async def test_advance_h3_happy_path_sets_in_transit(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_loading(db_session, trip, driver)

    result = await advance_h3(db_session, trip_id=trip.id, driver_id=driver.id, payload=H3CompleteRequest(
        gate_exit_photo_artifact_id=await _make_artifact(db_session, trip.id), guard_verified_seal=True,
    ))
    assert result.status == TripStatus.IN_TRANSIT


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
    assert result.exceptions[0].exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH
