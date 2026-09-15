"""Unit tests for the departure/confirmation Hedera anchor payload shapes and verification.

Payload-shape tests are pure logic (no DB). The anchoring and verification
reconstruction tests use a real (rolled-back) db_session with the Hedera SDK
wrapper stubbed at the import boundary anchor_service uses it through — the
same approach as tests/unit/test_phase_service.py's autouse fixture, kept
consistent here rather than mixing in a second mocking style.

The explicit v1 builders preserve historical receipts, while v2 builders add
role-labelled evidence hashes without exposing artifact IDs or private data.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.blockchain.anchor_service import compute_payload_hash
from app.blockchain.hedera import HederaReceipt
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    AnchorStatus, ArtifactType, BlockchainReceiptType, ExceptionType, ParcelStatus, PhaseStatus, PhaseType, IdvsStatus,
    OrganizationType, SubjectType, TripStatus, VehicleType, VerifyStatus,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import MockScanFeed, ScanDirection
from app.orchestration import scan_service
from app.orchestration.phase_service import (
    _BACKGROUND_ANCHOR_TASKS,
    advance_activation, advance_confirmation, advance_departure, advance_in_transit, advance_loading,
    advance_unloading, compute_confirmation_canonical_payload_v1,
    compute_confirmation_canonical_payload_v2, compute_departure_canonical_payload_v1,
    compute_departure_canonical_payload_v2,
    recover_phase_anchor,
)
from app.orchestration.phase_service import anchor_phase_event
from app.orchestration.verification_service import verify_subject
from app.storage.supabase_storage import EvidenceObjectNotFoundError, EvidenceStorageUnavailableError
from app.schemas.phases import (
    ActivationCompleteRequest, ConfirmationCompleteRequest, DepartureCompleteRequest,
    InTransitCompleteRequest, LoadingCompleteRequest, UnloadingCompleteRequest,
)
from tests.conftest import FakeMockStateStore


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    fake = FakeMockStateStore()
    monkeypatch.setattr(scan_feed_module, "get_mock_state_store", lambda: fake)
    return fake

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


@pytest.fixture(autouse=True)
def stub_evidence_storage_hash(monkeypatch):
    async def _stored_hash(*, s3_bucket: str, s3_key: str) -> str:
        return "a" * 64

    monkeypatch.setattr(
        "app.orchestration.verification_service.hash_stored_evidence_file", _stored_hash,
    )


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


async def _make_artifact(db_session, trip_id, *, file_hash="a" * 64):
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash=file_hash, mime_type="image/jpeg",
        captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    return artifact.id


async def _advance_to_departure(
    db_session, trip, driver, phases, *,
    waybill_hash: str | None = "a" * 64, seal_hash: str = "a" * 64,
):
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
            waybill_photo_artifact_id=(
                await _make_artifact(db_session, trip.id, file_hash=waybill_hash)
                if waybill_hash is not None else None
            ),
            seal_number="AB-1234",
            seal_photo_artifact_id=await _make_artifact(
                db_session, trip.id, file_hash=seal_hash,
            ),
            guard_verified_seal=True, idempotency_key=str(uuid.uuid4()),
        ),
    )


def _arrival_payload() -> InTransitCompleteRequest:
    """The driver's arrival attestation — it anchors nothing, which is why these
    anchor-payload tests only need it to get past the sequence gate."""
    return InTransitCompleteRequest(
        phase_type=PhaseType.IN_TRANSIT, idempotency_key=str(uuid.uuid4()),
        driver_phone_lat=Decimal("-29.8587"), driver_phone_lng=Decimal("31.0218"),
    )


async def _advance_to_arrival(db_session, trip, driver, phases):
    await _advance_to_departure(db_session, trip, driver, phases)
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )


async def _advance_to_unloading(db_session, trip, driver, phases):
    await _advance_to_arrival(db_session, trip, driver, phases)
    return await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )


# ── Payload shape: no GPS/artifact/PII keys (pure logic, no DB) ────────────────

def test_departure_v1_payload_remains_byte_compatible():
    """T5/task 2.6: driver_visual_count is gone from this payload — it stays
    on loading, unanchored, and never travels with the seal to departure."""
    event_id = uuid.uuid4()
    trip_id = uuid.uuid4()

    payload = compute_departure_canonical_payload_v1(
        phase_event_id=event_id, trip_id=trip_id, seal_number="AB-1234",
    )

    assert not (_FORBIDDEN_KEYS & payload.keys())
    assert payload == {
        "phase_event_id": str(event_id), "trip_id": str(trip_id),
        "phase_type": "departure", "seal_number": "AB-1234",
    }


def test_confirmation_v1_payload_remains_byte_compatible():
    event_id = uuid.uuid4()
    trip_id = uuid.uuid4()

    payload = compute_confirmation_canonical_payload_v1(
        phase_event_id=event_id, trip_id=trip_id, pp_scan_in_count=42, driver_visual_count=40,
    )

    assert not (_FORBIDDEN_KEYS & payload.keys())
    assert payload == {
        "phase_event_id": str(event_id), "trip_id": str(trip_id),
        "phase_type": "confirmation", "pp_scan_in_count": 42, "driver_visual_count": 40,
    }


def test_confirmation_v1_payload_keeps_null_count_key_present():
    """driver_visual_count is now Optional (the driver may skip the count) — the
    key must stay PRESENT with value None, never be omitted, so
    verification_service's rebuild reproduces the same JSON shape and hash."""
    event_id = uuid.uuid4()
    trip_id = uuid.uuid4()

    payload = compute_confirmation_canonical_payload_v1(
        phase_event_id=event_id, trip_id=trip_id, pp_scan_in_count=42, driver_visual_count=None,
    )

    assert "driver_visual_count" in payload
    assert payload["driver_visual_count"] is None
    assert payload == {
        "phase_event_id": str(event_id), "trip_id": str(trip_id),
        "phase_type": "confirmation", "pp_scan_in_count": 42, "driver_visual_count": None,
    }


def test_departure_v2_payload_commits_role_labelled_artifact_hashes():
    event_id = uuid.uuid4()
    trip_id = uuid.uuid4()

    payload = compute_departure_canonical_payload_v2(
        phase_event_id=event_id,
        trip_id=trip_id,
        seal_number="AB-1234",
        seal_photo_sha256="a" * 64,
        waybill_photo_sha256="b" * 64,
    )

    assert not (_FORBIDDEN_KEYS & payload.keys())
    assert payload == {
        "payload_version": 2,
        "phase_event_id": str(event_id),
        "trip_id": str(trip_id),
        "phase_type": "departure",
        "seal_number": "AB-1234",
        "seal_photo_sha256": "a" * 64,
        "waybill_photo_sha256": "b" * 64,
    }


def test_departure_v2_payload_keeps_optional_waybill_hash_key_present():
    payload = compute_departure_canonical_payload_v2(
        phase_event_id=uuid.uuid4(),
        trip_id=uuid.uuid4(),
        seal_number="AB-1234",
        seal_photo_sha256="a" * 64,
        waybill_photo_sha256=None,
    )

    assert "waybill_photo_sha256" in payload
    assert payload["waybill_photo_sha256"] is None


def test_confirmation_v2_payload_commits_distinct_pod_and_signature_hashes():
    event_id = uuid.uuid4()
    trip_id = uuid.uuid4()

    payload = compute_confirmation_canonical_payload_v2(
        phase_event_id=event_id,
        trip_id=trip_id,
        pp_scan_in_count=42,
        driver_visual_count=40,
        pod_photo_sha256="a" * 64,
        pod_signature_sha256="b" * 64,
    )

    assert not (_FORBIDDEN_KEYS & payload.keys())
    assert payload == {
        "payload_version": 2,
        "phase_event_id": str(event_id),
        "trip_id": str(trip_id),
        "phase_type": "confirmation",
        "pp_scan_in_count": 42,
        "driver_visual_count": 40,
        "pod_photo_sha256": "a" * 64,
        "pod_signature_sha256": "b" * 64,
    }


@pytest.fixture(autouse=True)
def captured_anchor_dispatches(monkeypatch):
    """Capture anchor dispatches instead of queueing real Celery tasks.

    Anchoring no longer runs inside a phase-completion request (a ~4-6s Hedera submit was
    holding the driver's swipe open). These tests are about the ANCHORED PAYLOAD, so they
    still need the anchor to actually happen — _drain_anchors below runs each dispatch
    through the same entry point the worker calls, which means they now cover the full
    dispatch -> worker -> receipt chain rather than a single in-request call.
    """
    dispatched: list[tuple[str, dict, str]] = []

    class _StubTask:
        @staticmethod
        def delay(phase_event_id: str, canonical_payload: dict, receipt_type: str) -> None:
            dispatched.append((phase_event_id, canonical_payload, receipt_type))

    monkeypatch.setattr("app.tasks.blockchain.anchor_phase_event_task", _StubTask)
    return dispatched


async def _drain_anchors(db_session, dispatched) -> None:
    """Commit (which fires the after_commit dispatch hook), then run every queued anchor.

    The db_session fixture joins with create_savepoint, so this commit fires the hook and
    is still rolled back when the test ends.
    """
    await db_session.commit()
    await asyncio.gather(*_BACKGROUND_ANCHOR_TASKS)
    for phase_event_id, canonical_payload, receipt_type in dispatched:
        await anchor_phase_event(
            db_session, phase_event_id=uuid.UUID(phase_event_id),
            canonical_payload=canonical_payload,
            receipt_type=BlockchainReceiptType(receipt_type),
        )
    # Flush so the receipt and the event's new blockchain_receipt_id are queryable —
    # refresh() would discard these pending in-session writes instead of reading them.
    await db_session.flush()
    dispatched.clear()


# ── Anchoring: receipt_type per handshake, anchors on mismatch too (DB-gated) ──

@pytest.mark.asyncio
async def test_advance_departure_anchors_with_pickup_receipt_type(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    """D7/T5 (task 2.6): the PICKUP-typed anchor moved whole from loading to
    departure — this is now where it's produced."""
    trip, driver, phases = trip_fixture

    await _advance_to_departure(db_session, trip, driver, phases)
    await _drain_anchors(db_session, captured_anchor_dispatches)

    departure = phases["departure"]
    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == departure.blockchain_receipt_id)
    )).scalar_one()

    assert receipt.subject_type == SubjectType.PHASE_EVENT
    assert receipt.receipt_type == BlockchainReceiptType.PICKUP
    assert receipt.data_hash == departure.event_hash
    assert receipt.payload_json["payload_version"] == 2
    assert receipt.payload_json["seal_photo_sha256"] == "a" * 64
    assert receipt.payload_json["waybill_photo_sha256"] == "a" * 64


@pytest.mark.asyncio
async def test_advance_confirmation_anchors_with_delivery_receipt_type(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases)

    await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(
                db_session, trip.id, file_hash="b" * 64,
            ),
            driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )

    await _drain_anchors(db_session, captured_anchor_dispatches)

    h5 = phases["confirmation"]
    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == h5.blockchain_receipt_id)
    )).scalar_one()

    assert receipt.subject_type == SubjectType.PHASE_EVENT
    assert receipt.receipt_type == BlockchainReceiptType.DELIVERY
    assert receipt.data_hash == h5.event_hash
    assert receipt.payload_json["payload_version"] == 2
    assert receipt.payload_json["pod_photo_sha256"] == "a" * 64
    assert receipt.payload_json["pod_signature_sha256"] == "b" * 64


@pytest.mark.asyncio
async def test_advance_departure_v2_anchors_null_for_absent_legacy_waybill(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    trip, driver, phases = trip_fixture

    await _advance_to_departure(
        db_session, trip, driver, phases, waybill_hash=None,
    )
    await _drain_anchors(db_session, captured_anchor_dispatches)

    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(
            BlockchainReceipt.id == phases["departure"].blockchain_receipt_id,
        )
    )).scalar_one()
    assert receipt.payload_json["waybill_photo_sha256"] is None


# Task 7 removed test_advance_confirmation_anchors_even_on_count_mismatch from
# here (see git history) — advance_loading stopped writing driver_visual_count,
# so the old three-way count check it drove became unreachable. Task 8 restores
# the same property below, now driven by a genuine scan-out vs scan-in mismatch.

@pytest.mark.asyncio
async def test_advance_confirmation_anchors_even_on_a_scan_mismatch(
    db_session, trip_fixture, captured_anchor_dispatches, store,
):
    """The anchor must still fire when the scan-based reconciliation finds a real
    discrepancy — a mismatch is evidence in its own right, not a reason to
    withhold the anchor. _dispatch_anchor's call site in advance_confirmation is
    unconditional; this proves it on the mismatch path, not just the match path
    test_advance_confirmation_anchors_with_delivery_receipt_type covers above."""
    trip, driver, phases = trip_fixture
    stop0_id = phases["activation"].trip_stop_id
    stop1_id = phases["confirmation"].trip_stop_id

    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY-ANCHOR-MISMATCH",
        parcel_count_expected=3, pickup_stop_id=stop0_id, delivery_stop_id=stop1_id,
    )
    db_session.add(consignment)
    await db_session.flush()
    barcodes = ["ANCMIS0001", "ANCMIS0002", "ANCMIS0003"]
    for barcode in barcodes:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id, barcode=barcode, status=ParcelStatus.PENDING,
        ))
    await db_session.flush()

    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=consignment.parcel_perfect_reference, stop_reference=str(stop0_id),
        direction=ScanDirection.OUT, barcodes=barcodes,
    )
    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop0_id, direction=ScanDirection.OUT,
    )
    await feed.close_session(
        consignment_reference=consignment.parcel_perfect_reference, stop_reference=str(stop0_id),
        direction=ScanDirection.OUT,
    )

    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION,
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )
    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4())),
    )
    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=DepartureCompleteRequest(phase_type=PhaseType.DEPARTURE,
            waybill_photo_artifact_id=await _make_artifact(db_session, trip.id), seal_number="AB-1234",
            seal_photo_artifact_id=await _make_artifact(db_session, trip.id),
            guard_verified_seal=True, idempotency_key=str(uuid.uuid4()),
        ),
    )
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )
    # Only 2 of 3 scanned in at destination — the mismatch this test exists to
    # anchor. Staged/ingested/closed BEFORE advance_unloading, not after: UNLOADING
    # now gates on this stop's IN-direction scan session (phase_gate.GATED_PHASES).
    await feed.stage_scans(
        consignment_reference=consignment.parcel_perfect_reference, stop_reference=str(stop1_id),
        direction=ScanDirection.IN, barcodes=barcodes[:2],
    )
    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop1_id, direction=ScanDirection.IN,
    )
    await feed.close_session(
        consignment_reference=consignment.parcel_perfect_reference, stop_reference=str(stop1_id),
        direction=ScanDirection.IN,
    )

    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=2, idempotency_key=str(uuid.uuid4()),
        ),
    )
    h5 = next(h for h in result.phases if h.phase_type == PhaseType.CONFIRMATION)
    assert h5.status == PhaseStatus.EXCEPTION

    exception = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == trip.id,
            TripException.exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH,
        )
    )).scalar_one()
    assert exception.consignment_id == consignment.id

    await _drain_anchors(db_session, captured_anchor_dispatches)

    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == phases["confirmation"].blockchain_receipt_id)
    )).scalar_one()
    assert receipt.subject_type == SubjectType.PHASE_EVENT
    assert receipt.receipt_type == BlockchainReceiptType.DELIVERY
    assert receipt.data_hash == phases["confirmation"].event_hash


# ── Verification reconstruction: proves reconstruct == anchored payload ───────

@pytest.mark.asyncio
async def test_verify_subject_after_departure_reconstructs_matching_payload(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    """D7/T5 (task 2.6): verification_service._reconstruct_phase_event_payload
    now dispatches on PhaseType.DEPARTURE, not LOADING, matching where the
    seal (and the anchor) actually live post-refactor."""
    trip, driver, phases = trip_fixture
    result = await _advance_to_departure(db_session, trip, driver, phases)
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)

    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    await _drain_anchors(db_session, captured_anchor_dispatches)

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=departure.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    assert outcome.evidence_verified is True
    stub_service.verify_hash.assert_called_once_with(
        outcome.receipt.hedera_topic_id, outcome.receipt.hedera_sequence_number, outcome.receipt.data_hash,
    )


@pytest.mark.asyncio
async def test_verify_subject_after_confirmation_reconstructs_matching_payload(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases)
    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )
    h5 = next(h for h in result.phases if h.phase_type == PhaseType.CONFIRMATION)

    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    await _drain_anchors(db_session, captured_anchor_dispatches)

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=h5.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    assert outcome.evidence_verified is True
    stub_service.verify_hash.assert_called_once_with(
        outcome.receipt.hedera_topic_id, outcome.receipt.hedera_sequence_number, outcome.receipt.data_hash,
    )


@pytest.mark.asyncio
async def test_verify_subject_after_confirmation_with_null_visual_count_reconstructs_matching_payload(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    """The stop condition this test exists to rule out: driver_visual_count is now
    Optional, and _reconstruct_phase_event_payload's completeness check used to
    read `event.driver_visual_count is None` as "not yet completed" — which would
    have misread a genuinely anchored, null-count confirmation as NO_RECEIPT.
    parcel_count_destination alone is the correct signal (see verification_service's
    docstring); this proves the rebuild still reaches VERIFIED with the count absent.
    """
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases)
    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=None, idempotency_key=str(uuid.uuid4()),
        ),
    )
    h5 = next(h for h in result.phases if h.phase_type == PhaseType.CONFIRMATION)
    assert h5.driver_visual_count is None

    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    await _drain_anchors(db_session, captured_anchor_dispatches)

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=h5.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    assert outcome.evidence_verified is True
    stub_service.verify_hash.assert_called_once_with(
        outcome.receipt.hedera_topic_id, outcome.receipt.hedera_sequence_number, outcome.receipt.data_hash,
    )


@pytest.mark.asyncio
async def test_verify_subject_preserves_unversioned_departure_receipt_compatibility(
    db_session, trip_fixture,
):
    trip, _driver, phases = trip_fixture
    departure = phases["departure"]
    departure.seal_number = "AB-1234"
    payload = compute_departure_canonical_payload_v1(
        phase_event_id=departure.id, trip_id=trip.id, seal_number=departure.seal_number,
    )
    receipt = BlockchainReceipt(
        id=uuid.uuid4(), trip_id=trip.id,
        subject_type=SubjectType.PHASE_EVENT, subject_id=departure.id,
        receipt_type=BlockchainReceiptType.PICKUP,
        payload_json=payload, data_hash=compute_payload_hash(payload),
        hedera_topic_id="0.0.12345", hedera_sequence_number=12,
    )
    db_session.add(receipt)
    await db_session.flush()
    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=departure.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    assert outcome.evidence_verified is False
    stub_service.verify_hash.assert_called_once()


@pytest.mark.asyncio
async def test_verify_subject_preserves_unversioned_confirmation_receipt_compatibility(
    db_session, trip_fixture,
):
    trip, _driver, phases = trip_fixture
    confirmation = phases["confirmation"]
    confirmation.parcel_count_destination = 42
    confirmation.driver_visual_count = 40
    payload = compute_confirmation_canonical_payload_v1(
        phase_event_id=confirmation.id,
        trip_id=trip.id,
        pp_scan_in_count=confirmation.parcel_count_destination,
        driver_visual_count=confirmation.driver_visual_count,
    )
    receipt = BlockchainReceipt(
        id=uuid.uuid4(), trip_id=trip.id,
        subject_type=SubjectType.PHASE_EVENT, subject_id=confirmation.id,
        receipt_type=BlockchainReceiptType.DELIVERY,
        payload_json=payload, data_hash=compute_payload_hash(payload),
        hedera_topic_id="0.0.12345", hedera_sequence_number=12,
    )
    db_session.add(receipt)
    await db_session.flush()
    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=confirmation.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    assert outcome.evidence_verified is False
    stub_service.verify_hash.assert_called_once()


@pytest.mark.asyncio
async def test_verify_subject_preserves_migrated_handshake_loading_receipt(
    db_session, trip_fixture,
):
    trip, _driver, phases = trip_fixture
    loading = phases["loading"]
    loading.seal_number = "AB-1234"
    loading.driver_visual_count = 42
    payload = {
        "handshake_event_id": str(loading.id),
        "trip_id": str(trip.id),
        "handshake_type": "loading",
        "seal_number": loading.seal_number,
        "driver_visual_count": loading.driver_visual_count,
    }
    db_session.add(BlockchainReceipt(
        id=uuid.uuid4(), trip_id=trip.id,
        subject_type=SubjectType.PHASE_EVENT, subject_id=loading.id,
        receipt_type=BlockchainReceiptType.PICKUP,
        payload_json=payload, data_hash=compute_payload_hash(payload),
        hedera_topic_id="0.0.12345", hedera_sequence_number=12,
    ))
    await db_session.flush()
    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=loading.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    assert outcome.evidence_verified is False
    stub_service.verify_hash.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("phase_name", ["unloading", "confirmation"])
async def test_verify_subject_preserves_migrated_handshake_unloading_receipt(
    db_session, trip_fixture, phase_name,
):
    trip, _driver, phases = trip_fixture
    event = phases[phase_name]
    event.parcel_count_destination = 42
    event.driver_visual_count = 40
    payload = {
        "handshake_event_id": str(event.id),
        "trip_id": str(trip.id),
        "handshake_type": "unloading",
        "pp_scan_in_count": event.parcel_count_destination,
        "driver_visual_count": event.driver_visual_count,
    }
    db_session.add(BlockchainReceipt(
        id=uuid.uuid4(), trip_id=trip.id,
        subject_type=SubjectType.PHASE_EVENT, subject_id=event.id,
        receipt_type=BlockchainReceiptType.DELIVERY,
        payload_json=payload, data_hash=compute_payload_hash(payload),
        hedera_topic_id="0.0.12345", hedera_sequence_number=12,
    ))
    await db_session.flush()
    stub_service = MagicMock()
    stub_service.verify_hash.return_value = True

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=event.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    assert outcome.evidence_verified is False
    stub_service.verify_hash.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("payload_version", [1, True, "2", 999])
async def test_verify_subject_rejects_explicit_or_unknown_phase_payload_version(
    db_session, trip_fixture, payload_version,
):
    trip, _driver, phases = trip_fixture
    departure = phases["departure"]
    departure.seal_number = "AB-1234"
    payload = {
        "payload_version": payload_version,
        "phase_event_id": str(departure.id),
        "trip_id": str(trip.id),
        "phase_type": "departure",
        "seal_number": departure.seal_number,
    }
    db_session.add(BlockchainReceipt(
        id=uuid.uuid4(), trip_id=trip.id,
        subject_type=SubjectType.PHASE_EVENT, subject_id=departure.id,
        receipt_type=BlockchainReceiptType.PICKUP,
        payload_json=payload, data_hash=compute_payload_hash(payload),
        hedera_topic_id="0.0.12345", hedera_sequence_number=12,
    ))
    await db_session.flush()
    stub_service = MagicMock()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=departure.id,
        hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.ERROR
    stub_service.verify_hash.assert_not_called()


@pytest.mark.asyncio
async def test_verify_subject_detects_tampered_artifact_hash_before_storage_or_hedera(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    await _drain_anchors(db_session, captured_anchor_dispatches)
    seal = await db_session.get(EvidenceArtifact, phases["departure"].seal_photo_artifact_id)
    seal.file_hash = "b" * 64
    await db_session.flush()
    stub_service = MagicMock()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT,
        subject_id=phases["departure"].id, hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.DB_MISMATCH
    assert outcome.current_hash != outcome.expected_hash
    stub_service.verify_hash.assert_not_called()


@pytest.mark.asyncio
async def test_verify_subject_reports_missing_anchored_phase_fields_as_mismatch(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    await _drain_anchors(db_session, captured_anchor_dispatches)
    phases["departure"].seal_number = None
    await db_session.flush()
    stub_service = MagicMock()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT,
        subject_id=phases["departure"].id, hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.DB_MISMATCH
    assert outcome.receipt is not None
    stub_service.verify_hash.assert_not_called()


@pytest.mark.asyncio
async def test_verify_subject_detects_swapped_artifact_roles(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    trip, driver, phases = trip_fixture
    await _advance_to_departure(
        db_session, trip, driver, phases,
        waybill_hash="a" * 64, seal_hash="b" * 64,
    )
    await _drain_anchors(db_session, captured_anchor_dispatches)
    departure = phases["departure"]
    departure.seal_photo_artifact_id, departure.waybill_photo_artifact_id = (
        departure.waybill_photo_artifact_id, departure.seal_photo_artifact_id,
    )
    await db_session.flush()
    stub_service = MagicMock()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT,
        subject_id=departure.id, hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.DB_MISMATCH
    assert outcome.current_hash != outcome.expected_hash
    stub_service.verify_hash.assert_not_called()


@pytest.mark.asyncio
async def test_verify_subject_detects_replaced_storage_bytes(
    db_session, trip_fixture, captured_anchor_dispatches, monkeypatch,
):
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    await _drain_anchors(db_session, captured_anchor_dispatches)
    seal = await db_session.get(EvidenceArtifact, phases["departure"].seal_photo_artifact_id)

    async def _stored_hash(*, s3_bucket: str, s3_key: str) -> str:
        return "b" * 64 if s3_key == seal.s3_key else "a" * 64

    monkeypatch.setattr(
        "app.orchestration.verification_service.hash_stored_evidence_file", _stored_hash,
    )
    stub_service = MagicMock()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT,
        subject_id=phases["departure"].id, hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.DB_MISMATCH
    assert outcome.current_hash != outcome.expected_hash
    stub_service.verify_hash.assert_not_called()


@pytest.mark.asyncio
async def test_verify_subject_treats_missing_storage_object_as_mismatch(
    db_session, trip_fixture, captured_anchor_dispatches, monkeypatch,
):
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    await _drain_anchors(db_session, captured_anchor_dispatches)

    async def _missing(*, s3_bucket: str, s3_key: str) -> str:
        raise EvidenceObjectNotFoundError("missing")

    monkeypatch.setattr(
        "app.orchestration.verification_service.hash_stored_evidence_file", _missing,
    )
    stub_service = MagicMock()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT,
        subject_id=phases["departure"].id, hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.DB_MISMATCH
    stub_service.verify_hash.assert_not_called()


@pytest.mark.asyncio
async def test_verify_subject_treats_storage_outage_as_error_not_tampering(
    db_session, trip_fixture, captured_anchor_dispatches, monkeypatch,
):
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    await _drain_anchors(db_session, captured_anchor_dispatches)

    async def _unavailable(*, s3_bucket: str, s3_key: str) -> str:
        raise EvidenceStorageUnavailableError("unavailable")

    monkeypatch.setattr(
        "app.orchestration.verification_service.hash_stored_evidence_file", _unavailable,
    )
    stub_service = MagicMock()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT,
        subject_id=phases["departure"].id, hedera_service=stub_service,
    )

    assert outcome.status == VerifyStatus.ERROR
    stub_service.verify_hash.assert_not_called()


@pytest.mark.parametrize("phase_type", [PhaseType.DEPARTURE, PhaseType.CONFIRMATION])
@pytest.mark.parametrize("version", [1, 2])
async def test_recovery_restores_lost_dispatch_without_changing_original_hash(
    db_session, trip_fixture, stub_hedera_service, phase_type, version,
):
    trip, _driver, phases = trip_fixture
    event = phases[phase_type.value]
    event.status = PhaseStatus.COMPLETED
    event.anchor_status = AnchorStatus.PENDING
    event.completed_at = datetime.now(UTC) - timedelta(minutes=10)
    event.updated_at = event.completed_at
    if phase_type == PhaseType.DEPARTURE:
        event.seal_number = "AB-1234"
        event.seal_photo_artifact_id = await _make_artifact(db_session, trip.id)
        args = dict(phase_event_id=event.id, trip_id=trip.id, seal_number=event.seal_number)
        payload = (
            compute_departure_canonical_payload_v1(**args) if version == 1 else
            compute_departure_canonical_payload_v2(**args, seal_photo_sha256="a" * 64, waybill_photo_sha256=None)
        )
    else:
        event.parcel_count_destination = 42
        event.driver_visual_count = None
        event.pod_photo_artifact_id = await _make_artifact(db_session, trip.id)
        event.pod_signature_artifact_id = await _make_artifact(db_session, trip.id)
        args = dict(phase_event_id=event.id, trip_id=trip.id, pp_scan_in_count=42, driver_visual_count=None)
        payload = (
            compute_confirmation_canonical_payload_v1(**args) if version == 1 else
            compute_confirmation_canonical_payload_v2(**args, pod_photo_sha256="a" * 64, pod_signature_sha256="a" * 64)
        )
    event.event_hash = compute_payload_hash(payload)
    await db_session.flush()
    event.updated_at = event.completed_at
    await db_session.flush()

    assert await recover_phase_anchor(db_session, due_before=datetime.now(UTC) - timedelta(minutes=5)) is True
    await db_session.flush()

    receipt = await db_session.get(BlockchainReceipt, event.blockchain_receipt_id)
    assert receipt.payload_json == payload
    assert receipt.data_hash == event.event_hash == compute_payload_hash(payload)
    assert event.anchor_status == AnchorStatus.ANCHORED
    assert await recover_phase_anchor(db_session, due_before=datetime.now(UTC)) is None
    stub_hedera_service.return_value.submit_hash.assert_called_once()


async def test_recovery_refuses_changed_evidence_and_does_not_starve_the_next_debt(
    db_session, trip_fixture, captured_anchor_dispatches, stub_hedera_service,
):
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    event = phases["departure"]
    original_hash = event.event_hash
    artifact = await db_session.get(EvidenceArtifact, event.seal_photo_artifact_id)
    artifact.file_hash = "b" * 64
    event.updated_at = datetime.now(UTC) - timedelta(minutes=10)
    await db_session.flush()
    due_before = datetime.now(UTC) - timedelta(minutes=5)

    assert await recover_phase_anchor(db_session, due_before=due_before) is False
    await db_session.flush()

    assert event.event_hash == original_hash
    assert event.anchor_status == AnchorStatus.FAILED
    assert event.blockchain_receipt_id is None
    assert await recover_phase_anchor(db_session, due_before=due_before) is None
    stub_hedera_service.return_value.submit_hash.assert_not_called()


async def test_recovery_waits_for_recent_or_incomplete_phases(db_session, trip_fixture):
    _trip, _driver, phases = trip_fixture
    event = phases["departure"]
    event.anchor_status = AnchorStatus.PENDING
    event.event_hash = "a" * 64
    await db_session.flush()

    assert await recover_phase_anchor(db_session, due_before=datetime.now(UTC)) is None


async def test_recovery_retries_failed_hedera_submission(db_session, trip_fixture, stub_hedera_service):
    from app.core.exceptions import HederaServiceError

    trip, _driver, phases = trip_fixture
    event = phases["departure"]
    event.status = PhaseStatus.COMPLETED
    event.anchor_status = AnchorStatus.FAILED
    event.completed_at = datetime.now(UTC) - timedelta(minutes=10)
    event.updated_at = event.completed_at
    event.seal_number = "AB-1234"
    payload = compute_departure_canonical_payload_v1(
        phase_event_id=event.id, trip_id=trip.id, seal_number=event.seal_number,
    )
    event.event_hash = compute_payload_hash(payload)
    await db_session.flush()
    stub_hedera_service.return_value.submit_hash.side_effect = HederaServiceError("offline")

    assert await recover_phase_anchor(db_session, due_before=datetime.now(UTC)) is False
    await db_session.flush()
    assert event.anchor_status == AnchorStatus.FAILED
    stub_hedera_service.return_value.submit_hash.side_effect = None

    assert await recover_phase_anchor(db_session, due_before=datetime.now(UTC) + timedelta(minutes=1)) is True
    assert event.anchor_status == AnchorStatus.ANCHORED
