"""Unit tests for the departure/confirmation Hedera anchor payload shapes and verification.

Payload-shape tests are pure logic (no DB). The anchoring and verification
reconstruction tests use a real (rolled-back) db_session with the Hedera SDK
wrapper stubbed at the import boundary anchor_service uses it through — the
same approach as tests/unit/test_phase_service.py's autouse fixture, kept
consistent here rather than mixing in a second mocking style.

compute_departure_canonical_payload/compute_confirmation_canonical_payload
(renamed by task 2.7 from compute_h2_canonical_payload/compute_h5_canonical_payload)
are exercised here under their current names.
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
    ArtifactType, BlockchainReceiptType, PhaseStatus, PhaseType, IdvsStatus,
    OrganizationType, SubjectType, TripStatus, VehicleType, VerifyStatus,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.orchestration.phase_service import (
    advance_activation, advance_confirmation, advance_departure, advance_loading, advance_unloading,
    compute_confirmation_canonical_payload, compute_departure_canonical_payload,
)
from app.orchestration.verification_service import verify_subject
from app.schemas.phases import (
    ActivationCompleteRequest, ConfirmationCompleteRequest, DepartureCompleteRequest,
    LoadingCompleteRequest, UnloadingCompleteRequest,
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
    """Stub the Hedera SDK wrapper so advance_departure/advance_confirmation anchor
    for real (real anchor_subject, real BlockchainReceipt row) without real
    network access — see the identical fixture in tests/unit/test_phase_service.py.
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
    """Same hand-built single-leg plan as test_phase_service.py's trip_fixture,
    IN_TRANSIT row included — see that file's fixture docstring."""
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
        # Activation is gated on the trip being due (phase_service._reject_if_not_due) and
        # an unscheduled trip is deliberately unstartable, so this fixture books itself for
        # today — what it always meant: a trip a driver is about to run.
        planned_departure_at=datetime.now(UTC),
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop0 = TripStop(trip_id=trip.id, precinct_id=origin.id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=dest.id, sequence=1)
    db_session.add_all([stop0, stop1])
    await db_session.flush()

    phases = {
        "trip_creation": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION,
            sequence_number=0, status=PhaseStatus.COMPLETED,
        ),
        "activation": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.ACTIVATION, trip_stop_id=stop0.id,
            sequence_number=1, status=PhaseStatus.PENDING,
        ),
        "loading": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.LOADING, trip_stop_id=stop0.id,
            sequence_number=2, status=PhaseStatus.PENDING,
        ),
        "departure": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.DEPARTURE, trip_stop_id=stop0.id,
            sequence_number=3, status=PhaseStatus.PENDING,
        ),
        "in_transit": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.IN_TRANSIT, trip_stop_id=stop0.id,
            sequence_number=4, status=PhaseStatus.PENDING,
        ),
        "unloading": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop1.id,
            sequence_number=5, status=PhaseStatus.PENDING,
        ),
        "confirmation": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id,
            sequence_number=6, status=PhaseStatus.PENDING,
        ),
    }
    db_session.add_all(phases.values())
    await db_session.flush()

    return trip, driver, phases


async def _make_artifact(db_session, trip_id):
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg",
        captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    return artifact.id


async def _advance_to_departure(db_session, trip, driver, phases):
    """D7/T5 (task 2.6): the seal — and the anchor — moved from loading to
    departure, so this is now the helper that produces an anchored handshake."""
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION, 
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )
    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, driver_visual_count=42, idempotency_key=str(uuid.uuid4())),
    )
    return await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=DepartureCompleteRequest(phase_type=PhaseType.DEPARTURE, 
            waybill_photo_artifact_id=await _make_artifact(db_session, trip.id), seal_number="AB-1234",
            seal_photo_artifact_id=await _make_artifact(db_session, trip.id),
            guard_verified_seal=True, idempotency_key=str(uuid.uuid4()),
        ),
    )


async def _advance_to_unloading(db_session, trip, driver, phases):
    await _advance_to_departure(db_session, trip, driver, phases)
    return await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )


# ── Payload shape: no GPS/artifact/PII keys (pure logic, no DB) ────────────────

def test_departure_canonical_payload_excludes_gps_artifacts_and_pii():
    """T5/task 2.6: driver_visual_count is gone from this payload — it stays
    on loading, unanchored, and never travels with the seal to departure."""
    event_id = uuid.uuid4()
    trip_id = uuid.uuid4()

    payload = compute_departure_canonical_payload(
        phase_event_id=event_id, trip_id=trip_id, seal_number="AB-1234",
    )

    assert not (_FORBIDDEN_KEYS & payload.keys())
    assert payload == {
        "phase_event_id": str(event_id), "trip_id": str(trip_id),
        "phase_type": "departure", "seal_number": "AB-1234",
    }


def test_confirmation_canonical_payload_excludes_gps_artifacts_and_pii():
    event_id = uuid.uuid4()
    trip_id = uuid.uuid4()

    payload = compute_confirmation_canonical_payload(
        phase_event_id=event_id, trip_id=trip_id, pp_scan_in_count=42, driver_visual_count=40,
    )

    assert not (_FORBIDDEN_KEYS & payload.keys())
    assert payload == {
        "phase_event_id": str(event_id), "trip_id": str(trip_id),
        "phase_type": "confirmation", "pp_scan_in_count": 42, "driver_visual_count": 40,
    }


# ── Anchoring: receipt_type per handshake, anchors on mismatch too (DB-gated) ──

@pytest.mark.asyncio
async def test_advance_departure_anchors_with_pickup_receipt_type(db_session, trip_fixture):
    """D7/T5 (task 2.6): the PICKUP-typed anchor moved whole from loading to
    departure — this is now where it's produced."""
    trip, driver, phases = trip_fixture

    result = await _advance_to_departure(db_session, trip, driver, phases)

    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)
    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == departure.blockchain_receipt_id)
    )).scalar_one()

    assert receipt.subject_type == SubjectType.PHASE_EVENT
    assert receipt.receipt_type == BlockchainReceiptType.PICKUP
    assert receipt.data_hash == departure.event_hash


@pytest.mark.asyncio
async def test_advance_confirmation_anchors_with_delivery_receipt_type(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases)

    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, pp_scan_in_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )

    h5 = next(h for h in result.phases if h.phase_type == PhaseType.CONFIRMATION)
    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == h5.blockchain_receipt_id)
    )).scalar_one()

    assert receipt.subject_type == SubjectType.PHASE_EVENT
    assert receipt.receipt_type == BlockchainReceiptType.DELIVERY
    assert receipt.data_hash == h5.event_hash


@pytest.mark.asyncio
async def test_advance_confirmation_anchors_even_on_count_mismatch(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases)

    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=40, pp_scan_in_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )

    h5 = next(h for h in result.phases if h.phase_type == PhaseType.CONFIRMATION)
    assert h5.status == PhaseStatus.EXCEPTION
    assert h5.blockchain_receipt_id is not None


# ── Verification reconstruction: proves reconstruct == anchored payload ───────

@pytest.mark.asyncio
async def test_verify_subject_after_departure_reconstructs_matching_payload(db_session, trip_fixture):
    """D7/T5 (task 2.6): verification_service._reconstruct_phase_event_payload
    now dispatches on PhaseType.DEPARTURE, not LOADING, matching where the
    seal (and the anchor) actually live post-refactor."""
    trip, driver, phases = trip_fixture
    result = await _advance_to_departure(db_session, trip, driver, phases)
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)

    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=departure.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    stub_service.verify_hash.assert_called_once_with(
        outcome.receipt.hedera_topic_id, outcome.receipt.hedera_sequence_number, outcome.receipt.data_hash,
    )


@pytest.mark.asyncio
async def test_verify_subject_after_confirmation_reconstructs_matching_payload(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases)
    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, pp_scan_in_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )
    h5 = next(h for h in result.phases if h.phase_type == PhaseType.CONFIRMATION)

    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=h5.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    stub_service.verify_hash.assert_called_once_with(
        outcome.receipt.hedera_topic_id, outcome.receipt.hedera_sequence_number, outcome.receipt.data_hash,
    )
