"""Unit tests for the phase completion engine (advance_activation..advance_confirmation)."""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql

from app.blockchain.anchor_service import compute_payload_hash
from app.blockchain.hedera import HederaReceipt
from app.core.exceptions import (
    HederaServiceError, HederaTimeoutError, PhaseSequenceError, PhaseTypeMismatchError, ResourceNotFoundError,
    TripActivationBlockedError,
)
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    AnchorStatus, ArtifactType, BlockchainReceiptType, ExceptionSeverity, ExceptionType,
    IdvsStatus, OrganizationType, ParcelStatus, PhaseStatus, PhaseType, TripStatus, TripType,
    VehicleType,
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
from app.orchestration import phase_service, scan_service
from app.orchestration.phase_plan import PlanStop, build_phase_plan
from app.orchestration.phase_service import (
    _load_phase_event,
    advance_activation, advance_confirmation, advance_departure, advance_in_transit, advance_loading,
    advance_unloading,
    anchor_phase_event,
    complete_phase, current_phase_event, is_before_scheduled_day, next_phase, operating_day,
)
from app.schemas.phases import (
    ActivationCompleteRequest, ConfirmationCompleteRequest, DepartureCompleteRequest,
    InTransitCompleteRequest, LoadingCompleteRequest, UnloadingCompleteRequest,
)
from tests.conftest import FakeMockStateStore

# Activation is gated on the trip actually being due (phase_service._reject_if_not_due),
# and a trip carrying no schedule at all is deliberately unstartable. Every fixture below
# therefore books its trip for today — which is what these fixtures always meant: a trip a
# driver is about to run. Computed per-run, not pinned to a literal date, so the suite
# does not quietly start failing the day after it was written.
_SCHEDULED_TODAY = datetime.now(UTC)


@pytest.fixture(autouse=True)
def stub_hedera_service(monkeypatch):
    """advance_loading/advance_confirmation anchor to Hedera via anchor_subject(),
    which builds its own HederaService() when they don't pass one in (they
    don't — same no-injection shape as trip_service.create_trip). These tests
    use a real (rolled-back) db_session but must not touch the real Hedera SDK,
    so the SDK wrapper class is patched at the import boundary anchor_service
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


@pytest.fixture(autouse=True)
def captured_anchor_dispatches(monkeypatch):
    """Capture the Celery dispatch instead of queueing a real task.

    Anchoring no longer happens inside a phase-completion request (a ~4-6s Hedera submit
    was holding the driver's swipe open), so "did this phase anchor" is now asserted as
    "was an anchor dispatched" — and the dispatch fires on the session's after_commit
    hook, which is why the tests below commit before asserting. The db_session fixture
    joins with create_savepoint, so that commit fires the hook and is still rolled back.
    """
    dispatched: list[tuple[str, dict, str]] = []

    class _StubTask:
        @staticmethod
        def delay(phase_event_id: str, canonical_payload: dict, receipt_type: str) -> None:
            dispatched.append((phase_event_id, canonical_payload, receipt_type))

    monkeypatch.setattr("app.tasks.blockchain.anchor_phase_event_task", _StubTask)
    return dispatched


@pytest_asyncio.fixture
async def second_trip_fixture(db_session):
    """A second, unrelated trip — exists only so its artifacts can be offered to the
    first trip's phases. Deliberately has no phase plan: nothing here is ever advanced,
    it is purely somewhere else for an EvidenceArtifact to legitimately belong.

    Its own org/driver/vehicle rows are separate from trip_fixture's to avoid the
    unique constraints on registration/id_number/email, not because the ownership
    check cares about organisations — it keys on trip_id alone.
    """
    org = Organization(id=uuid.uuid4(), name="Other Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Other Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="other@test.co.za", full_name="O")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Other Driver",
        id_number="9002025009088", phone_number="+27829999999", license_number="DRV-2",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="XYZ789GP", pulsit_device_id="PUL-2",
    )
    origin = Precinct(id=uuid.uuid4(), name="Other Origin", principal_organization_id=client_org.id, latitude="2", longitude="2")
    dest = Precinct(id=uuid.uuid4(), name="Other Dest", principal_organization_id=client_org.id, latitude="3", longitude="3")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-2", order_number="ORD-2",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    return trip


@pytest_asyncio.fixture
async def trip_fixture(db_session):
    """Trip + driver + a hand-built PhaseEvent plan for a single-leg trip.

    Mirrors the phase rows create_trip ultimately produces for a 2-stop,
    single-consignment trip: trip_creation (h0), activation/loading/departure/
    in_transit at stop 0, unloading/confirmation at stop 1. h0 is seeded here
    directly as COMPLETED — matching create_trip's inline completion of h0
    once its Hedera anchor succeeds (see trip_service.create_trip), not the
    PENDING status _build_phase_events initially assigns every row including
    h0. Only h0.status is set, not its anchor bookkeeping fields
    (completed_at/blockchain_receipt_id/event_hash/anchor_status) — these
    tests exercise advance_* from activation onward and never read those
    fields off h0. The in_transit (P4) row is included for real: it is opened PENDING by
    advance_departure and closed by the driver's own arrival submission
    (advance_in_transit, 2026-08-09). A fixture that hid this row could not
    exercise the arrival phase at all.
    """
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
        planned_departure_at=_SCHEDULED_TODAY,
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
    """Insert a real EvidenceArtifact row — phase_events FK-references this table."""
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg", captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    return artifact.id


async def _h3_payload(db_session, trip_id, **overrides) -> DepartureCompleteRequest:
    """T5 (task 2.6): the seal now applies at departure, so every H3 payload
    needs waybill/seal artifact fields that used to live on H2. Defaults give
    every existing departure-focused test a valid, matching seal (AB-1234)
    unless a test overrides seal_number/seal_number_confirmed/guard_verified_seal
    to exercise a mismatch."""
    defaults: dict = dict(
        waybill_photo_artifact_id=await _make_artifact(db_session, trip_id),
        seal_number="AB-1234",
        seal_photo_artifact_id=await _make_artifact(db_session, trip_id),
        guard_verified_seal=True,
        idempotency_key=str(uuid.uuid4()),
    )
    defaults.update(overrides)
    return DepartureCompleteRequest(phase_type=PhaseType.DEPARTURE, **defaults)


async def _advance_to_loading(db_session, trip, driver, phases):
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION, 
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
            idempotency_key=str(uuid.uuid4()),
        ),
    )
    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, driver_visual_count=42, idempotency_key=str(uuid.uuid4())),
    )


async def _advance_to_departure(db_session, trip, driver, phases, **h3_overrides):
    await _advance_to_loading(db_session, trip, driver, phases)
    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id, **h3_overrides),
    )


async def _advance_to_arrival(db_session, trip, driver, phases, **h3_overrides):
    """Departure plus the driver's own arrival attestation — where a trip sits once the
    truck is at the destination gate and unloading is the next actionable phase.

    The arrival is a real submission now, not a side effect of unloading: in_transit sits
    at a lower sequence than unloading, so leaving it PENDING makes unloading a 409.
    """
    await _advance_to_departure(db_session, trip, driver, phases, **h3_overrides)
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )


async def _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234"):
    await _advance_to_arrival(db_session, trip, driver, phases)
    return await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination=seal,
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )


# ── advance_activation ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_advance_activation_happy_path_sets_trip_status(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    payload = ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION, 
        driver_phone_lat=Decimal("0.0001"), driver_phone_lng=Decimal("0.0001"),
        idempotency_key=str(uuid.uuid4()),
    )
    result = await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id, payload=payload,
    )
    assert result.status == TripStatus.ACTIVE


@pytest.mark.asyncio
async def test_advance_activation_closed_trip_raises_sequence_error(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    trip.status = TripStatus.CLOSED
    await db_session.flush()
    payload = ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION, 
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
    )
    with pytest.raises(PhaseSequenceError):
        await advance_activation(
            db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id, payload=payload,
        )


@pytest.mark.asyncio
async def test_advance_activation_unknown_trip_raises_not_found(db_session):
    payload = ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION, 
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
    )
    with pytest.raises(ResourceNotFoundError):
        await advance_activation(
            db_session, trip_id=uuid.uuid4(), driver_id=uuid.uuid4(),
            phase_event_id=uuid.uuid4(), payload=payload,
        )


@pytest.mark.asyncio
async def test_advance_activation_out_of_order_raises_sequence_error_reads_the_plan(db_session, trip_fixture):
    """Attempting confirmation before activation on a freshly created trip must
    raise — proving the gate reads PhaseEvent.sequence_number, not trip.status
    (trip.status is still plain CREATED here, not any per-phase value)."""
    trip, driver, phases = trip_fixture

    with pytest.raises(PhaseSequenceError):
        await advance_confirmation(
            db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
            payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
                pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
                pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
                driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
            ),
        )


@pytest.mark.asyncio
async def test_non_activation_phase_records_the_driver_position(db_session, trip_fixture):
    """The driver no longer taps "Capture GPS Location" anywhere — the PWA takes the fix
    silently at submit — so every phase, not just activation, must store what it was sent.
    phase_events has always had the columns; before this only advance_activation used them."""
    trip, driver, phases = trip_fixture
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=_activation_payload(),
    )

    result = await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, driver_visual_count=42,
            driver_phone_lat=-26.0942, driver_phone_lng=28.1342,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    loading = next(p for p in result.phases if p.phase_type == PhaseType.LOADING)
    # Exact, not approximate: the stored coordinate must be the one the phone reported,
    # not a float rounded into Numeric(10, 7) as -26.0941999...
    assert loading.driver_phone_lat == -26.0942
    assert loading.driver_phone_lng == 28.1342


@pytest.mark.asyncio
async def test_phase_without_a_fix_completes_anyway(db_session, trip_fixture):
    """A fix can fail — under a loading-bay roof, permission revoked mid-trip. Evidence
    capture must never be blocked by it: the phase completes, the position is just null."""
    trip, driver, phases = trip_fixture
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=_activation_payload(),
    )

    result = await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )

    loading = next(p for p in result.phases if p.phase_type == PhaseType.LOADING)
    assert loading.status == PhaseStatus.COMPLETED
    assert loading.driver_phone_lat is None


# ── advance_loading ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_advance_loading_happy_path_ignores_driver_visual_count(db_session, trip_fixture):
    """D7/T5 (task 2.6): loading no longer carries or anchors the seal — only
    driver_visual_count. Explicit regression guard that the anchor really moved:
    event_hash/blockchain_receipt_id must stay unset on the loading row.

    Renamed from test_advance_loading_happy_path_stores_driver_visual_count_only
    (Task 7): loading no longer stores driver_visual_count at all — a legacy
    offline-queue payload that still carries it (schema kept it Optional so
    that entry doesn't 422 forever) must be accepted, not stored."""
    trip, driver, phases = trip_fixture
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION,
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )

    result = await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, driver_visual_count=42, idempotency_key=str(uuid.uuid4())),
    )
    assert result.status == TripStatus.ACTIVE
    h2 = next(h for h in result.phases if h.phase_type == PhaseType.LOADING)
    assert h2.driver_visual_count is None
    assert h2.seal_number is None
    assert h2.event_hash is None
    assert h2.blockchain_receipt_id is None


@pytest.mark.asyncio
async def test_advance_loading_no_consignments_skips_manifest_check(db_session, trip_fixture):
    """trip_fixture (shared by ~25 other advance_loading-touching tests below) has no
    Consignment rows — this is the load-bearing regression proof that the manifest check
    added in advance_loading does not manufacture a mismatch on any of them: no baseline
    means skipped, not compared against 0."""
    trip, driver, phases = trip_fixture
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION,
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )

    result = await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, driver_visual_count=42, idempotency_key=str(uuid.uuid4())),
    )

    h2 = next(h for h in result.phases if h.phase_type == PhaseType.LOADING)
    assert h2.status == PhaseStatus.COMPLETED
    assert h2.parcel_count_origin is None
    assert len(result.exceptions) == 0


async def _add_parcels(db_session, *, consignment_id: uuid.UUID, barcodes: list[str]) -> None:
    """Insert real Parcel rows for a consignment — scan_service's expected count
    (func.count(Parcel.id)) reads these, never Consignment.parcel_count_expected."""
    for barcode in barcodes:
        db_session.add(Parcel(consignment_id=consignment_id, barcode=barcode, status=ParcelStatus.PENDING))
    await db_session.flush()


@pytest.mark.asyncio
async def test_advance_loading_full_scan_out_completes_with_no_exception(db_session, trip_fixture):
    """Renamed from test_advance_loading_manifest_matches_driver_count_completes
    (Task 7): the loading-count check moved from manifest-vs-driver-count to
    scanned-out-vs-expected — a full scan-out is still what closes a loading
    clean, it's just measured by the warehouse now, not the driver's guess."""
    trip, driver, phases = trip_fixture
    stop_id = phases["loading"].trip_stop_id
    consignment = Consignment(
        trip_id=trip.id, parcel_perfect_reference="PP-1", parcel_count_expected=3,
        pickup_stop_id=stop_id,
    )
    db_session.add(consignment)
    await db_session.flush()
    barcodes = ["PP1-0001", "PP1-0002", "PP1-0003"]
    await _add_parcels(db_session, consignment_id=consignment.id, barcodes=barcodes)

    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="PP-1", stop_reference=str(stop_id),
        direction=ScanDirection.OUT, barcodes=barcodes,
    )
    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop_id, direction=ScanDirection.OUT,
    )
    # The warehouse closes its session once its own scan is done — what
    # unblocks _gate_and_load's gate (task 6) and is what makes the counts
    # final by the time advance_loading reads them.
    await feed.close_session(
        consignment_reference="PP-1", stop_reference=str(stop_id), direction=ScanDirection.OUT,
    )
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION,
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )

    result = await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4())),
    )

    h2 = next(h for h in result.phases if h.phase_type == PhaseType.LOADING)
    assert h2.status == PhaseStatus.COMPLETED
    assert h2.parcel_count_origin == 3
    assert len(result.exceptions) == 0


@pytest.mark.asyncio
async def test_advance_loading_short_scan_out_flags_but_does_not_hold(db_session, trip_fixture):
    """Renamed from test_advance_loading_manifest_mismatch_flags_but_does_not_hold
    (Task 7): the mismatch is now scanned-out-vs-expected (2 of 3 barcodes),
    not manifest-vs-driver-count — same non-blocking precedent either way.
    scan_service._reconcile_consignment raises this exception at ingest time
    (before advance_loading is ever called); advance_loading's own backstop
    (_raise_scan_shortfall_if_unrecorded) must find it already recorded and
    not add a second row for the same fact."""
    trip, driver, phases = trip_fixture
    stop_id = phases["loading"].trip_stop_id
    consignment = Consignment(
        trip_id=trip.id, parcel_perfect_reference="PP-1", parcel_count_expected=3,
        pickup_stop_id=stop_id,
    )
    db_session.add(consignment)
    await db_session.flush()
    barcodes = ["PP1-0001", "PP1-0002", "PP1-0003"]
    await _add_parcels(db_session, consignment_id=consignment.id, barcodes=barcodes)

    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="PP-1", stop_reference=str(stop_id),
        direction=ScanDirection.OUT, barcodes=barcodes[:2],  # short — 2 of 3
    )
    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop_id, direction=ScanDirection.OUT,
    )
    await feed.close_session(
        consignment_reference="PP-1", stop_reference=str(stop_id), direction=ScanDirection.OUT,
    )
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION,
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )

    result = await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4())),
    )

    h2 = next(h for h in result.phases if h.phase_type == PhaseType.LOADING)
    assert h2.status == PhaseStatus.EXCEPTION
    assert h2.parcel_count_origin == 2
    assert len(result.exceptions) == 1  # scan_service's row, not a second one from advance_loading
    assert result.exceptions[0].exception_type == ExceptionType.PARCEL_COUNT_MISMATCH
    assert result.exceptions[0].severity == ExceptionSeverity.WARNING
    # Non-blocking: the trip is still ACTIVE, not held — same precedent as the
    # seal-mismatch branches in advance_departure/advance_unloading.
    assert result.status == TripStatus.ACTIVE


@pytest.mark.asyncio
async def test_replayed_completion_is_idempotent_returns_200_no_duplicate(db_session, trip_fixture, stub_hedera_service):
    """Anchor moved to departure (task 2.6) — the idempotent-replay-doesn't-
    double-anchor guarantee now needs proving there, not at loading."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)
    payload = await _h3_payload(db_session, trip.id, idempotency_key="offline-queue-entry-1")

    first = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id, payload=payload,
    )
    second = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id, payload=payload,
    )

    departure_first = next(h for h in first.phases if h.phase_type == PhaseType.DEPARTURE)
    departure_second = next(h for h in second.phases if h.phase_type == PhaseType.DEPARTURE)
    assert departure_first.id == departure_second.id
    # Neither call anchors in-request any more, so the property that matters is that the
    # replay short-circuits before reaching the anchor path at all — one dispatch, not two.
    assert departure_first.blockchain_receipt_id == departure_second.blockchain_receipt_id
    assert stub_hedera_service.return_value.submit_hash.call_count == 0


@pytest.mark.asyncio
async def test_replayed_exception_completion_is_idempotent_no_duplicate_exception(db_session, trip_fixture):
    """Covers the branch test_replayed_completion_is_idempotent_returns_200_no_duplicate
    doesn't: a completion that resolves to EXCEPTION (not COMPLETED) must still
    be caught by the replay short-circuit (_is_resolved, not a bare COMPLETED
    check), or a resent offline-queue entry would re-execute the wrapper body —
    inserting a second duplicate TripException row on every resend."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    payload = await _h3_payload(
        db_session, trip.id, seal_number_confirmed="ZZ-9999",
        idempotency_key="offline-queue-entry-departure-1",
    )

    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id, payload=payload,
    )

    second = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id, payload=payload,
    )

    assert second.status == TripStatus.ACTIVE
    assert len(second.exceptions) == 1  # not duplicated by the replay

    exception_count = (await db_session.execute(
        select(func.count()).select_from(TripException).where(
            TripException.phase_event_id == phases["departure"].id,
        )
    )).scalar_one()
    assert exception_count == 1


# ── advance_departure ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_advance_departure_happy_path_completes(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    """D7/T5 (task 2.6): departure now owns the seal AND the anchor — the
    single place both are asserted together, since they're written/computed
    in the same wrapper call."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    result = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id),
    )
    assert result.status == TripStatus.ACTIVE
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)
    assert departure.status == PhaseStatus.COMPLETED
    assert departure.seal_number == "AB-1234"
    # The hash is still computed in-request — it is derived from this request's own
    # evidence. Only the Hedera submit moved to the worker, so no receipt exists yet and
    # anchor_status still reads PENDING. See test_anchor_phase_event_* below for the
    # worker half, and _dispatch_anchor for why the split is safe.
    assert departure.event_hash is not None
    assert departure.blockchain_receipt_id is None

    # The anchor is queued on commit, not awaited in-request.
    assert captured_anchor_dispatches == []
    await db_session.commit()
    assert len(captured_anchor_dispatches) == 1
    dispatched_event_id, dispatched_payload, dispatched_type = captured_anchor_dispatches[0]
    assert dispatched_event_id == str(phases["departure"].id)
    assert dispatched_payload["seal_number"] == "AB-1234"
    assert dispatched_type == BlockchainReceiptType.PICKUP.value


@pytest.mark.asyncio
async def test_advance_departure_guard_refused_creates_exception_but_departs(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    result = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id, guard_verified_seal=False),
    )

    assert result.status == TripStatus.ACTIVE  # recorded, not held — departure is a feeder
    assert len(result.exceptions) == 1
    assert result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    assert result.exceptions[0].severity == ExceptionSeverity.CRITICAL
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)
    assert departure.status == PhaseStatus.EXCEPTION
    # D7: the anchor is queued regardless of the mismatch outcome — a mismatch is
    # evidence in its own right, not a reason to withhold the receipt.
    await db_session.commit()
    assert len(captured_anchor_dispatches) == 1


@pytest.mark.asyncio
async def test_advance_departure_guard_verified_seal_none_records_no_exception(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    """The state the driver app now actually sends (2026-08-05).

    The guard-confirms-seal step was deleted: guards have no accounts, and a seal
    number re-typed on the driver's own phone proves nothing the seal photograph
    does not. So guard_verified_seal arrives as None — "no independent confirmation
    was collected" — which is the ORDINARY case and must not be recorded as an
    anomaly.

    This is the regression this test exists for: the branch used to read
    `elif not payload.guard_verified_seal`, under which None is falsy. Shipping the
    app change against that code would have stamped a CRITICAL seal_mismatch on
    EVERY departure of EVERY trip, burying the real mismatches the platform exists
    to surface.
    """
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    result = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id, guard_verified_seal=None),
    )

    assert result.status == TripStatus.ACTIVE
    assert result.exceptions == []
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)
    assert departure.status == PhaseStatus.COMPLETED
    # The anchor still goes out — nothing about "not collected" withholds the receipt.
    await db_session.commit()
    assert len(captured_anchor_dispatches) == 1


@pytest.mark.asyncio
async def test_advance_departure_guard_verified_seal_omitted_defaults_to_none(db_session, trip_fixture):
    """Omitting the field entirely is the same as sending null.

    The driver app no longer includes the key in its departure body at all
    (lib/api/phases.ts), so the schema default is what production traffic actually
    exercises — asserting it here means a change to that default cannot pass
    silently.
    """
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    payload = DepartureCompleteRequest(
        phase_type=PhaseType.DEPARTURE,
        waybill_photo_artifact_id=await _make_artifact(db_session, trip.id),
        seal_number="AB-1234",
        seal_photo_artifact_id=await _make_artifact(db_session, trip.id),
        idempotency_key=str(uuid.uuid4()),
    )
    assert payload.guard_verified_seal is None

    result = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["departure"].id, payload=payload,
    )

    assert result.exceptions == []
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)
    assert departure.status == PhaseStatus.COMPLETED


@pytest.mark.asyncio
async def test_advance_departure_guard_verified_seal_true_records_no_exception(db_session, trip_fixture):
    """The third of the three states, kept explicit alongside the other two.

    An older app build (or a replayed offline-queue entry) still sends the boolean;
    True must remain an ordinary clean departure.
    """
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    result = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id, guard_verified_seal=True),
    )

    assert result.exceptions == []
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)
    assert departure.status == PhaseStatus.COMPLETED


@pytest.mark.asyncio
async def test_advance_departure_seal_number_confirmed_still_supersedes_a_none_flag(db_session, trip_fixture):
    """A real re-entered seal that fails to match is STILL a mismatch, even though
    the guard flag is now None.

    The tri-state change relaxed only the flag, not the comparison: an operator
    tool or a future build that does collect a confirmation must keep flagging a
    genuine discrepancy. Without this, "None means no anomaly" could be
    over-applied to the branch that does the real work.
    """
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    result = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(
            db_session, trip.id, guard_verified_seal=None, seal_number_confirmed="ZZ-9999",
        ),
    )

    assert len(result.exceptions) == 1
    assert result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    assert result.exceptions[0].severity == ExceptionSeverity.CRITICAL
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)
    assert departure.status == PhaseStatus.EXCEPTION


@pytest.mark.asyncio
async def test_exception_status_phase_does_not_block_next_phase(db_session, trip_fixture):
    """Renamed/kept from the old H3-confirmed-seal-mismatch test, extended to
    prove T3's predicate: a phase left in EXCEPTION status is resolved for
    gating purposes, so the phase after it (unloading) must still be reachable.
    No mismatch of any kind holds a trip today — trip.status == EXCEPTION_HOLD
    is reserved for a future manual dispatcher hold and nothing sets it."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    result = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id, seal_number_confirmed="ZZ-9999"),
    )
    assert result.status == TripStatus.ACTIVE
    assert len(result.exceptions) == 1
    assert result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)
    assert departure.status == PhaseStatus.EXCEPTION
    # T5: the row stores the seal actually APPLIED at departure (payload.seal_number,
    # "AB-1234" — the _h3_payload default), not the guard's differing re-entered
    # confirmation ("ZZ-9999") — that confirmation is used only for the
    # intra-request comparison, it's never what gets written to the ledger.
    assert departure.seal_number == "AB-1234"

    # The drive still has to be attested to before unloading — the EXCEPTION on departure
    # is what this test is about, not a licence to skip the arrival row.
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )

    next_result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )
    assert next_result.status == TripStatus.ACTIVE
    unloading = next(h for h in next_result.phases if h.phase_type == PhaseType.UNLOADING)
    assert unloading.status == PhaseStatus.COMPLETED


@pytest.mark.asyncio
async def test_advance_departure_confirmed_seal_match_supersedes_guard_flag(db_session, trip_fixture):
    """The intra-request comparison against THIS SAME request's applied seal
    (T5) is authoritative: a device that lost its local seal reference sends
    guard_verified_seal=False, which must not create a false mismatch when the
    re-entered seal matches."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    result = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(
            db_session, trip.id, guard_verified_seal=False, seal_number_confirmed="ab-1234 ",
        ),
    )

    assert result.status == TripStatus.ACTIVE
    assert result.exceptions == []
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)
    assert departure.status == PhaseStatus.COMPLETED


@pytest.mark.asyncio
async def test_advance_departure_leaves_in_transit_pending_until_arrival(db_session, trip_fixture):
    """IN_TRANSIT stays PENDING for the whole drive: departure opens it, and only the
    driver's own arrival submission closes it. Departure must not resolve it, and nothing
    else may either — that is what makes completed_at the moment the truck arrived rather
    than the moment some later phase's paperwork landed."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id),
    )

    # Departure completes but does NOT auto-complete IN_TRANSIT.
    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].status == PhaseStatus.PENDING
    assert phases["in_transit"].completed_at is None

    # IN_TRANSIT is closed by the driver's own arrival submission.
    result = await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )

    in_transit_in_response = next(h for h in result.phases if h.phase_type == PhaseType.IN_TRANSIT)
    assert in_transit_in_response.status == PhaseStatus.COMPLETED
    assert in_transit_in_response.completed_at is not None


# ── advance_in_transit ──────────────────────────────────────────────────────

def _arrival_payload(**overrides) -> InTransitCompleteRequest:
    """The whole arrival payload. Position defaults to a real fix because the point of
    the phase is recording WHERE the driver arrived; tests that care about the
    no-fix path pass driver_phone_lat=None, driver_phone_lng=None explicitly."""
    fields: dict = {
        "phase_type": PhaseType.IN_TRANSIT,
        "idempotency_key": str(uuid.uuid4()),
        "driver_phone_lat": Decimal("-29.8587"),
        "driver_phone_lng": Decimal("31.0218"),
    }
    fields.update(overrides)
    return InTransitCompleteRequest(**fields)


@pytest.mark.asyncio
async def test_advance_in_transit_closes_the_leg_and_records_arrival_position(
    db_session, trip_fixture,
):
    """The point of the whole change: completed_at is stamped when the DRIVER says he
    arrived, not when the unloading paperwork lands."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)

    result = await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].status == PhaseStatus.COMPLETED
    assert phases["in_transit"].completed_at is not None
    assert float(phases["in_transit"].driver_phone_lat) == pytest.approx(-29.8587)
    assert float(phases["in_transit"].driver_phone_lng) == pytest.approx(31.0218)

    in_response = next(p for p in result.phases if p.phase_type == PhaseType.IN_TRANSIT)
    assert in_response.status == PhaseStatus.COMPLETED


@pytest.mark.asyncio
async def test_advance_in_transit_moves_the_position_cache_to_unloading(
    db_session, trip_fixture,
):
    """recompute_position must walk past the now-resolved arrival row to the next
    unresolved one. Without this the driver arrives and the board still reads 'driving'."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )

    await db_session.refresh(trip)
    assert PhaseType(trip.current_phase) == PhaseType.UNLOADING


@pytest.mark.asyncio
async def test_advance_in_transit_before_departure_is_rejected(db_session, trip_fixture):
    """An arrival cannot be claimed on a leg never departed. DEPARTURE sits at a lower
    sequence than IN_TRANSIT, so _gate_and_load's ordinary lower-sequence gate — not any
    in_transit special case — is what refuses this."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    with pytest.raises(PhaseSequenceError):
        await advance_in_transit(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
        )


@pytest.mark.asyncio
async def test_advance_in_transit_replay_is_idempotent(db_session, trip_fixture):
    """Drivers lose signal at destination gates; the offline queue resends. A replay must
    return current state without re-stamping the arrival time."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    payload = _arrival_payload(idempotency_key="offline-queue-entry-arrival-1")

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=payload,
    )
    await db_session.refresh(phases["in_transit"])
    first_completed_at = phases["in_transit"].completed_at

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=payload,
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].completed_at == first_completed_at


@pytest.mark.asyncio
async def test_advance_in_transit_accepts_a_submission_with_no_fix(db_session, trip_fixture):
    """A destination gate under a canopy must never be a reason arrival goes unrecorded.
    Only activation requires a position."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id,
        payload=_arrival_payload(driver_phone_lat=None, driver_phone_lng=None),
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].status == PhaseStatus.COMPLETED
    assert phases["in_transit"].driver_phone_lat is None


@pytest.mark.asyncio
async def test_advance_in_transit_does_not_anchor(db_session, trip_fixture, stub_hedera_service):
    """Unanchored by design — ANCHORED_PHASES is trip_creation/departure/confirmation.
    An arrival receipt would be a fourth anchor nobody asked for."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    stub_hedera_service.return_value.submit_hash.reset_mock()

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].event_hash is None
    assert phases["in_transit"].blockchain_receipt_id is None
    assert stub_hedera_service.return_value.submit_hash.call_count == 0


@pytest.mark.asyncio
async def test_unloading_is_refused_while_the_arrival_is_unrecorded(db_session, trip_fixture):
    """The gate exclusion's removal, stated as a contract. IN_TRANSIT used to be skipped
    by _gate_and_load's lower-sequence check because nothing could resolve it before
    unloading ran — gating on it made advance_unloading unreachable. Now the driver
    resolves it himself, so the ordinary ordering rule applies and no special case is
    needed. An arrival that was never attested to is exactly the gap this platform exists
    to surface."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)

    with pytest.raises(PhaseSequenceError):
        await advance_unloading(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["unloading"].id,
            payload=UnloadingCompleteRequest(
                phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
                gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
                idempotency_key=str(uuid.uuid4()),
            ),
        )


@pytest.mark.asyncio
async def test_unloading_no_longer_stamps_the_arrival_row(db_session, trip_fixture):
    """advance_unloading must not touch in_transit at all. Its old close block was what
    made the arrival timestamp untruthful; with ordering enforced above it is unreachable,
    and unreachable code that rewrites evidence is worse than none."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )
    await db_session.refresh(phases["in_transit"])
    arrival_at = phases["in_transit"].completed_at

    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].completed_at == arrival_at


@pytest_asyncio.fixture
async def multi_leg_trip_fixture(db_session):
    """3-stop trip: stop0 loads, stop1 is a pure pass-through waypoint (no
    cargo activity there), stop2 delivers. This yields two DEPARTURE/
    IN_TRANSIT leg pairs — build_phase_plan emits that pair for every
    non-final stop regardless of cargo activity — while keeping only ONE
    LOADING row overall.

    Deliberately not a true cross-dock (two LOADING rows) — this fixture
    isolates exactly what's under test here: that an arrival submission resolves
    the correct leg's row, and only that leg's row. T4's per-leg
    _find_departure_for_leg fix (proving the seal-continuity lookup itself
    picks the right leg on a genuine multi-LOADING cross-dock) is covered
    separately by test_cross_dock_seal_continuity_* below, built on a fixture
    that mirrors scripts/seed_trips.py's real 3-stop/3-consignment shape.
    """
    org = Organization(id=uuid.uuid4(), name="Org2", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client2", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="d2@test.co.za", full_name="D2")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver2",
        id_number="8001015009095", phone_number="+27821234599", license_number="DRV-2",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="XYZ987GP", pulsit_device_id="PUL-2",
    )
    p0 = Precinct(id=uuid.uuid4(), name="P0", principal_organization_id=client_org.id, latitude="0", longitude="0")
    p1 = Precinct(id=uuid.uuid4(), name="P1", principal_organization_id=client_org.id, latitude="1", longitude="1")
    p2 = Precinct(id=uuid.uuid4(), name="P2", principal_organization_id=client_org.id, latitude="2", longitude="2")
    db_session.add_all([user, driver, horse, p0, p1, p2])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-ML", order_number="ORD-ML",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=p0.id, destination_precinct_id=p2.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=_SCHEDULED_TODAY,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop0 = TripStop(trip_id=trip.id, precinct_id=p0.id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=p1.id, sequence=1)
    stop2 = TripStop(trip_id=trip.id, precinct_id=p2.id, sequence=2)
    db_session.add_all([stop0, stop1, stop2])
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
        "departure_1": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.DEPARTURE, trip_stop_id=stop0.id,
            sequence_number=3, status=PhaseStatus.PENDING,
        ),
        "in_transit_1": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.IN_TRANSIT, trip_stop_id=stop0.id,
            sequence_number=4, status=PhaseStatus.PENDING,
        ),
        "departure_2": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.DEPARTURE, trip_stop_id=stop1.id,
            sequence_number=5, status=PhaseStatus.PENDING,
        ),
        "in_transit_2": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.IN_TRANSIT, trip_stop_id=stop1.id,
            sequence_number=6, status=PhaseStatus.PENDING,
        ),
        "unloading": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop2.id,
            sequence_number=7, status=PhaseStatus.PENDING,
        ),
        "confirmation": PhaseEvent(
            trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop2.id,
            sequence_number=8, status=PhaseStatus.PENDING,
        ),
    }
    db_session.add_all(phases.values())
    await db_session.flush()

    return trip, driver, phases


@pytest.mark.asyncio
async def test_advance_departure_leaves_all_in_transit_rows_pending_until_each_arrival(
    db_session, multi_leg_trip_fixture,
):
    """Each departure leaves its own IN_TRANSIT row PENDING — no auto-complete — and an
    arrival submission resolves that leg's row and only that leg's row. Neither a later
    departure nor a later arrival may reach back and stamp an earlier leg's drive."""
    trip, driver, phases = multi_leg_trip_fixture

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

    # Leg 1's departure leaves IN_TRANSIT_1 PENDING.
    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure_1"].id,
        payload=await _h3_payload(db_session, trip.id),
    )
    await db_session.refresh(phases["in_transit_1"])
    await db_session.refresh(phases["in_transit_2"])
    assert phases["in_transit_1"].status == PhaseStatus.PENDING
    assert phases["in_transit_2"].status == PhaseStatus.PENDING  # No auto-complete

    # Leg 1's arrival closes IN_TRANSIT_1 and leaves leg 2's row alone.
    #
    # Multi-stop shape note, recorded not repaired (out of scope: hub-to-hub only).
    #
    # This is NOT a stall. The arrival resolver is generic, not single-leg: isDriving is
    # `currentPhase().phase_type === 'in_transit'` (driver-pwa lib/phase/derive.ts), so it
    # fires on every leg; Home routes any driving trip to the in-transit hub; and the hub
    # submits currentPhase()'s own row — which on this plan IS in_transit_1. The driver
    # can close leg 1 and currentStepRoute then lands them on departure_2, which has a
    # step recipe. An earlier draft of this comment claimed the trip stalls here; it does
    # not, and the claim would have been read as a known bug that isn't there.
    #
    # What IS awkward on a pass-through waypoint — a stop that neither drops off nor picks
    # up — is that build_phase_plan gives it no arrival phase of its own, so the driver
    # goes hub -> departure_2 and is asked for a fresh waybill photograph at a stop where
    # nothing happened. That is pre-existing plan-generator behaviour, unchanged by this
    # work, and it is UX friction rather than a blocked ledger.
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit_1"].id, payload=_arrival_payload(),
    )
    await db_session.refresh(phases["in_transit_1"])
    await db_session.refresh(phases["in_transit_2"])
    assert phases["in_transit_1"].status == PhaseStatus.COMPLETED
    assert phases["in_transit_2"].status == PhaseStatus.PENDING  # not reached back into
    leg_1_arrival_at = phases["in_transit_1"].completed_at

    # Leg 2's departure leaves IN_TRANSIT_2 PENDING. Does not affect leg 1.
    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure_2"].id,
        payload=await _h3_payload(db_session, trip.id),
    )
    await db_session.refresh(phases["in_transit_1"])
    await db_session.refresh(phases["in_transit_2"])
    assert phases["in_transit_1"].completed_at == leg_1_arrival_at
    assert phases["in_transit_2"].status == PhaseStatus.PENDING

    # Leg 2's own arrival closes IN_TRANSIT_2, still without touching leg 1's timestamp.
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit_2"].id, payload=_arrival_payload(),
    )
    await db_session.refresh(phases["in_transit_1"])
    await db_session.refresh(phases["in_transit_2"])
    assert phases["in_transit_2"].status == PhaseStatus.COMPLETED
    assert phases["in_transit_1"].completed_at == leg_1_arrival_at


# ── advance_unloading ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_advance_unloading_matching_seal_completes(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    result = await _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234")
    assert result.status == TripStatus.ACTIVE
    assert result.exceptions == []
    unloading = next(h for h in result.phases if h.phase_type == PhaseType.UNLOADING)
    assert unloading.status == PhaseStatus.COMPLETED


@pytest.mark.asyncio
async def test_advance_unloading_normalizes_against_a_non_canonical_stored_seal(db_session, trip_fixture):
    """seal_number_at_destination is normalized (stripped/uppercased) by
    UnloadingCompleteRequest.validate_seal_number before this code ever runs — see
    _validate_seal_format in app/schemas/phases.py — so the API itself can no longer
    hand this comparison a mismatched-casing or padded value on the incoming side.
    But the phase_events.seal_number DB column has no matching CHECK constraint, so a
    departure row written out of band (a backfill, a legacy row predating the
    validator, a future integration that writes it directly) could still carry a
    non-canonical value. This proves the comparison survives that, the same way it
    already has to for the free-form seal_number_confirmed (see
    test_advance_departure_seal_number_confirmed_still_supersedes_a_none_flag
    above)."""
    trip, driver, phases = trip_fixture
    await _advance_to_arrival(db_session, trip, driver, phases)
    phases["departure"].seal_number = " ab-1234 "
    await db_session.flush()

    result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    assert result.status == TripStatus.ACTIVE
    assert result.exceptions == []
    unloading = next(h for h in result.phases if h.phase_type == PhaseType.UNLOADING)
    assert unloading.status == PhaseStatus.COMPLETED


@pytest.mark.asyncio
async def test_advance_unloading_persists_gate_photo_when_provided(db_session, trip_fixture):
    """The seal photo at destination must actually reach the row, not be silently
    dropped — it is the only physical evidence of the seal's state before the truck
    was opened, and it cannot be recaptured after the fact."""
    trip, driver, phases = trip_fixture
    await _advance_to_arrival(db_session, trip, driver, phases)
    photo_id = await _make_artifact(db_session, trip.id)

    result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=photo_id, idempotency_key=str(uuid.uuid4()),
        ),
    )

    unloading = next(h for h in result.phases if h.phase_type == PhaseType.UNLOADING)
    assert unloading.gate_photo_artifact_id == photo_id


def test_unloading_request_rejects_a_missing_gate_photo():
    """The seal photo is required, so an unloading submitted without one must fail at
    the schema boundary — never reach the service and complete as a phase whose seal
    evidence is a bare typed-in string."""
    with pytest.raises(PydanticValidationError) as exc_info:
        UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            idempotency_key=str(uuid.uuid4()),
        )

    assert "gate_photo_artifact_id" in str(exc_info.value)


@pytest.mark.asyncio
async def test_unloading_seal_mismatch_flags_but_does_not_hold(db_session, trip_fixture):
    """A destination seal mismatch is recorded as a CRITICAL exception but must
    NOT hold the trip — matches departure's own seal-mismatch precedent
    (test_exception_status_phase_does_not_block_next_phase above).

    Holding here used to set TripStatus.EXCEPTION_HOLD. With no release or override
    path in the codebase, that stranded the trip permanently: confirmation could
    never run, so no POD and no delivery anchor were ever recorded. The hold
    destroyed the remaining evidence of the trip whose integrity it was reacting to.
    So a subsequent advance_confirmation must succeed, not be rejected."""
    trip, driver, phases = trip_fixture
    result = await _advance_to_unloading(db_session, trip, driver, phases, seal="ZZ-9999")
    assert result.status == TripStatus.ACTIVE  # flagged, not held
    assert len(result.exceptions) == 1
    assert result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    assert result.exceptions[0].severity == ExceptionSeverity.CRITICAL
    unloading = next(h for h in result.phases if h.phase_type == PhaseType.UNLOADING)
    assert unloading.status == PhaseStatus.EXCEPTION

    next_result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )
    assert next_result.status == TripStatus.CLOSED


# ── evidence artifact ownership ──────────────────────────────────────────────
#
# The FK on phase_events proves only that an artifact row exists SOMEWHERE. These
# tests fence the thing the FK cannot: that the evidence a phase cites is this
# trip's own. Without them, another trip's seal photo can be attached as this
# trip's and hashed into the record as genuine — a forged evidence chain that
# every downstream verification would report as intact.


@pytest.mark.asyncio
async def test_unloading_rejects_a_seal_photo_belonging_to_another_trip(
    db_session, trip_fixture, second_trip_fixture,
):
    trip, driver, phases = trip_fixture
    other_trip = second_trip_fixture
    await _advance_to_arrival(db_session, trip, driver, phases)
    foreign_photo = await _make_artifact(db_session, other_trip.id)

    with pytest.raises(ResourceNotFoundError):
        await advance_unloading(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["unloading"].id,
            payload=UnloadingCompleteRequest(
                phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
                gate_photo_artifact_id=foreign_photo, idempotency_key=str(uuid.uuid4()),
            ),
        )


@pytest.mark.asyncio
async def test_unloading_rejects_an_artifact_id_that_does_not_exist(db_session, trip_fixture):
    """A bogus UUID must be a clean domain error (404 at the endpoint), not an
    IntegrityError surfacing as a 500."""
    trip, driver, phases = trip_fixture
    await _advance_to_arrival(db_session, trip, driver, phases)

    with pytest.raises(ResourceNotFoundError):
        await advance_unloading(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["unloading"].id,
            payload=UnloadingCompleteRequest(
                phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
                gate_photo_artifact_id=uuid.uuid4(), idempotency_key=str(uuid.uuid4()),
            ),
        )


@pytest.mark.asyncio
async def test_departure_rejects_a_waybill_photo_belonging_to_another_trip(
    db_session, trip_fixture, second_trip_fixture,
):
    trip, driver, phases = trip_fixture
    other_trip = second_trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    with pytest.raises(ResourceNotFoundError):
        await advance_departure(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["departure"].id,
            payload=DepartureCompleteRequest(
                phase_type=PhaseType.DEPARTURE, seal_number="AB-1234",
                waybill_photo_artifact_id=await _make_artifact(db_session, other_trip.id),
                seal_photo_artifact_id=await _make_artifact(db_session, trip.id),
                guard_verified_seal=True, idempotency_key=str(uuid.uuid4()),
            ),
        )


@pytest.mark.asyncio
async def test_confirmation_rejects_a_pod_belonging_to_another_trip(
    db_session, trip_fixture, second_trip_fixture,
):
    trip, driver, phases = trip_fixture
    other_trip = second_trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234")

    with pytest.raises(ResourceNotFoundError):
        await advance_confirmation(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["confirmation"].id,
            payload=ConfirmationCompleteRequest(
                phase_type=PhaseType.CONFIRMATION,
                pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
                pod_signature_artifact_id=await _make_artifact(db_session, other_trip.id),
                driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
            ),
        )


@pytest.mark.asyncio
async def test_rejected_foreign_artifact_writes_no_evidence(
    db_session, trip_fixture, second_trip_fixture,
):
    """The check must run BEFORE any evidence is written, so a rejected attempt
    leaves the phase untouched and replayable — not half-populated with a seal
    number whose photo was refused."""
    trip, driver, phases = trip_fixture
    other_trip = second_trip_fixture
    await _advance_to_arrival(db_session, trip, driver, phases)

    with pytest.raises(ResourceNotFoundError):
        await advance_unloading(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["unloading"].id,
            payload=UnloadingCompleteRequest(
                phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
                gate_photo_artifact_id=await _make_artifact(db_session, other_trip.id),
                idempotency_key=str(uuid.uuid4()),
            ),
        )

    await db_session.refresh(phases["unloading"])
    assert phases["unloading"].status == PhaseStatus.PENDING
    assert phases["unloading"].seal_number is None
    assert phases["unloading"].gate_photo_artifact_id is None


# ── advance_confirmation ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_advance_confirmation_matching_counts_closes_trip(
    db_session, trip_fixture, captured_anchor_dispatches,
):
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234")

    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )
    assert result.status == TripStatus.CLOSED
    assert result.closed_at is not None
    assert result.exceptions == []

    h5 = next(h for h in result.phases if h.phase_type == PhaseType.CONFIRMATION)
    # The hash is computed in-request; the receipt is not. Closing the trip no longer
    # waits on Hedera — the worker writes the receipt and flips anchor_status moments
    # later (test_anchor_phase_event_writes_the_receipt below covers that half).
    assert h5.event_hash is not None
    assert h5.blockchain_receipt_id is None

    # Departure (walked above) queued its own PICKUP anchor, so assert on this phase's
    # dispatch rather than the total.
    await db_session.commit()
    confirmation_dispatches = [d for d in captured_anchor_dispatches if d[0] == str(phases["confirmation"].id)]
    assert len(confirmation_dispatches) == 1
    assert confirmation_dispatches[0][2] == BlockchainReceiptType.DELIVERY.value


# Task 7 removed test_advance_confirmation_count_mismatch_creates_exception_but_still_closes
# and test_replayed_confirmation_that_closed_trip_is_idempotent_not_409 from here.
# Both drove advance_confirmation's WAYBILL_COUNT_MISMATCH branch by submitting a
# driver_visual_count at confirmation that disagreed with loading's
# driver_visual_count — but advance_loading no longer writes driver_visual_count at
# all (this task's whole point), so loading_event.driver_visual_count is now always
# None and advance_confirmation's origin_count lookup always takes the "no baseline"
# skip branch. The mismatch path this pair tested is genuinely unreachable via any
# real flow today, not just untested — manufacturing coverage by hand-setting
# driver_visual_count on the loading row would test a write path nothing in
# production performs any more. Task 8 ("advance_confirmation reconciles
# scanned-out against scanned-in per consignment") owns reintroducing equivalent
# coverage once that reconciliation is scan-based instead.


@pytest.mark.asyncio
async def test_trip_closes_when_no_phases_remain(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234")

    await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )

    assert trip.status == TripStatus.CLOSED
    assert trip.closed_at is not None
    assert trip.current_phase is None
    assert trip.current_stop is None


@pytest.mark.asyncio
async def test_replayed_confirmation_that_closed_trip_is_idempotent_not_409(db_session, trip_fixture):
    """_gate_and_load must run its _is_resolved(event.status) replay short-circuit
    BEFORE its trip.status in (CLOSED, CANCELLED, EXCEPTION_HOLD) check — not after.
    Confirmation is the one phase whose own successful completion can flip trip.status
    to CLOSED in the same call. If the trip-status check ran first, resending that exact
    completion (same phase_event_id + idempotency_key, e.g. a driver app replaying an
    offline-queue entry that already landed) would hit "trip status is 'closed'" and
    raise PhaseSequenceError/409, instead of returning the idempotent 200 the replay
    contract promises — and the offline queue would never drain.

    This used to be proven via advance_confirmation's count-mismatch branch (EXCEPTION),
    deleted when advance_loading stopped writing driver_visual_count and made that branch
    unreachable. It doesn't need reviving: _is_resolved treats COMPLETED and EXCEPTION as
    equally "already decided" for gating, so a plain CLEAN confirmation — matching counts,
    no mismatch, straight to COMPLETED — exercises the identical ordering hazard, closing
    the trip on the first call and forcing the same short-circuit-before-status-check path
    on the replay.
    """
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234")

    payload = ConfirmationCompleteRequest(
        phase_type=PhaseType.CONFIRMATION,
        pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
        pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
        driver_visual_count=42,
        idempotency_key="offline-queue-entry-confirmation-1",
    )

    first = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["confirmation"].id, payload=payload,
    )
    assert first.status == TripStatus.CLOSED

    # The replay: identical phase_event_id, identical idempotency_key, identical payload.
    # Must NOT raise PhaseSequenceError/PhaseBlockedError (that would surface as a 409) —
    # it must return the same closed state as a plain idempotent 200.
    second = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["confirmation"].id, payload=payload,
    )
    assert second.status == TripStatus.CLOSED

    # No duplicate side effects from re-executing the wrapper body: a clean
    # confirmation writes zero TripException rows, and the replay must not add any.
    exception_count = (await db_session.execute(
        select(func.count()).select_from(TripException).where(TripException.trip_id == trip.id)
    )).scalar_one()
    assert exception_count == 0


# ── F1 (task 6.2a): confirmation must not 404 / must not manufacture a
# mismatch when there is no origin baseline to reconcile against ───────────

@pytest_asyncio.fixture
async def empty_leg_trip_fixture(db_session):
    """An EMPTY_LEG trip's real phase plan (finding F1): no consignments means
    build_phase_plan never emits a LOADING row at all — trip_creation,
    activation, departure, in_transit, unloading, confirmation. Built via the
    real build_phase_plan, not hand-numbered sequence_number literals, for the
    same reason cross_dock_trip_fixture is: if the generation rule ever
    changes shape, this fixture changes with it instead of asserting against
    a stale hand-written plan."""
    org = Organization(id=uuid.uuid4(), name="OrgEL", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="ClientEL", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="el@test.co.za", full_name="EL")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="DriverEL",
        id_number="8001015009122", phone_number="+27821234522", license_number="DRV-EL",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ELK123GP", pulsit_device_id="PUL-EL",
    )
    origin = Precinct(id=uuid.uuid4(), name="EL-Origin", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="EL-Dest", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-EMPTY", order_number="ORD-EMPTY",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=_SCHEDULED_TODAY, trip_type=TripType.EMPTY_LEG,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop0 = TripStop(trip_id=trip.id, precinct_id=origin.id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=dest.id, sequence=1)
    db_session.add_all([stop0, stop1])
    await db_session.flush()
    stop_id_by_sequence = {0: stop0.id, 1: stop1.id}

    plan = build_phase_plan([
        PlanStop(sequence=0, picks_up=False, drops_off=False),
        PlanStop(sequence=1, picks_up=False, drops_off=False),
    ])
    # This shape (no LOADING row) is exactly the premise this fixture exists to
    # reproduce — asserted here so a future change to build_phase_plan that
    # broke this premise would fail loudly at fixture setup, not as a
    # confusing failure deep inside a test that assumes it.
    assert [p.phase_type for p in plan] == [
        PhaseType.TRIP_CREATION, PhaseType.ACTIVATION, PhaseType.DEPARTURE,
        PhaseType.IN_TRANSIT, PhaseType.UNLOADING, PhaseType.CONFIRMATION,
    ]

    phases: dict[str, PhaseEvent] = {}
    for planned in plan:
        event = PhaseEvent(
            trip_id=trip.id,
            trip_stop_id=None if planned.stop_sequence is None else stop_id_by_sequence[planned.stop_sequence],
            phase_type=planned.phase_type,
            sequence_number=planned.sequence_number,
            status=PhaseStatus.COMPLETED if planned.phase_type == PhaseType.TRIP_CREATION else PhaseStatus.PENDING,
        )
        db_session.add(event)
        phases[planned.phase_type.value] = event
    await db_session.flush()

    return trip, driver, phases


@pytest.mark.asyncio
async def test_confirmation_skips_reconciliation_when_no_loading_exists(
    db_session, empty_leg_trip_fixture,
):
    """Before the fix, _find_loading_for_leg raised ResourceNotFoundError here
    (404 'PhaseEvent: loading') and an EMPTY_LEG trip could never reach
    confirmation, let alone close. After the fix it returns None, and
    advance_confirmation must skip count reconciliation entirely rather than
    treating the missing baseline as 0."""
    trip, driver, phases = empty_leg_trip_fixture
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION,
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )
    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id),
    )
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
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
            driver_visual_count=0, idempotency_key=str(uuid.uuid4()),
        ),
    )

    confirmation = next(h for h in result.phases if h.id == phases["confirmation"].id)
    assert confirmation.status == PhaseStatus.COMPLETED
    assert result.exceptions == []
    assert result.status == TripStatus.CLOSED


@pytest.mark.asyncio
async def test_confirmation_skips_reconciliation_when_origin_count_is_null(
    db_session, trip_fixture,
):
    """Newly reachable since task 6.1's dispatcher override: an overridden
    loading row is resolved (so _gate_and_load lets confirmation proceed) but
    never had a driver actually record a count, so driver_visual_count stays
    null. Without the origin_count-is-None guard, Python's
    `None == payload.pp_scan_in_count` is simply False, which would silently
    raise a false WAYBILL_COUNT_MISMATCH on every overridden loading."""
    trip, driver, phases = trip_fixture
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION,
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )
    # Simulate task 6.1's override_phase outcome directly: the loading row is
    # resolved (OVERRIDDEN) but its driver_visual_count was never captured.
    phases["loading"].status = PhaseStatus.OVERRIDDEN
    await db_session.flush()

    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id),
    )
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
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
            driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )

    confirmation = next(h for h in result.phases if h.id == phases["confirmation"].id)
    assert confirmation.status == PhaseStatus.COMPLETED
    assert not any(
        exc.exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH for exc in result.exceptions
    )
    assert result.status == TripStatus.CLOSED


# ── current_phase / current_stop tracking ───────────────────────────────────

@pytest.mark.asyncio
async def test_current_phase_and_current_stop_track_the_ledger(db_session, trip_fixture):
    trip, driver, phases = trip_fixture

    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION, 
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )
    assert trip.current_phase == PhaseType.LOADING
    assert trip.current_stop == 0

    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, driver_visual_count=42, idempotency_key=str(uuid.uuid4())),
    )
    assert trip.current_phase == PhaseType.DEPARTURE
    assert trip.current_stop == 0

    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id),
    )
    # Departure opens the driving leg; the cache sits on in_transit for the whole drive.
    # in_transit anchors to the stop it DEPARTS FROM (D3), so current_stop stays 0 here.
    assert trip.current_phase == PhaseType.IN_TRANSIT
    assert trip.current_stop == 0

    # The driver's own arrival submission is what moves the cache to the arrival phase.
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )
    await db_session.refresh(trip)
    assert trip.current_phase == PhaseType.UNLOADING
    assert trip.current_stop == 1

    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )
    assert trip.current_phase == PhaseType.CONFIRMATION
    assert trip.current_stop == 1

    await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )
    assert trip.current_phase is None
    assert trip.current_stop is None


# ── T4 fence: per-leg seal continuity on a genuine cross-dock trip ─────────
#
# This is the specific regression Task 2.6 exists to fix: on a real multi-stop
# trip there can be TWO (or more) LOADING/DEPARTURE rows, and a naive
# trip-wide `phase_type == LOADING` (or DEPARTURE) lookup either raises
# MultipleResultsFound the instant advance_unloading runs on ANY leg, or —
# worse — silently compares against the wrong leg's row without raising
# anything at all. _find_departure_for_leg (phase_service.py) fixes this by
# always resolving the latest DEPARTURE strictly before the calling phase's
# own sequence_number — the departure that opened THIS leg.

@pytest_asyncio.fixture
async def cross_dock_trip_fixture(db_session):
    """Mirrors scripts/seed_trips.py's real 11-row cross-dock shape: 3 stops,
    consignment A picks up at stop0/delivers at stop2 (straight through), B
    picks up at stop0/delivers at stop1 (dropped at the hub), C picks up at
    stop1/delivers at stop2 (collected at the hub) — stop1 is both a drop-off
    and a pick-up, exactly like seed_trips.py's FP-DEMO-XDOCK-0001.

    Built via the real build_phase_plan (not hand-numbered sequence_number
    literals) so this fixture can never silently drift from the actual
    generation rule under test — if build_phase_plan's algorithm ever changes
    shape, this fixture changes with it instead of asserting against a stale
    hand-written plan.
    """
    org = Organization(id=uuid.uuid4(), name="OrgXD", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="ClientXD", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="xd@test.co.za", full_name="XD")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="DriverXD",
        id_number="8001015009117", phone_number="+27821234511", license_number="DRV-XD",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="XDK123GP", pulsit_device_id="PUL-XD",
    )
    p0 = Precinct(id=uuid.uuid4(), name="XD-P0", principal_organization_id=client_org.id, latitude="0", longitude="0")
    p1 = Precinct(id=uuid.uuid4(), name="XD-P1", principal_organization_id=client_org.id, latitude="1", longitude="1")
    p2 = Precinct(id=uuid.uuid4(), name="XD-P2", principal_organization_id=client_org.id, latitude="2", longitude="2")
    db_session.add_all([user, driver, horse, p0, p1, p2])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-XDOCK", order_number="ORD-XDOCK",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=p0.id, destination_precinct_id=p2.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=_SCHEDULED_TODAY,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop0 = TripStop(trip_id=trip.id, precinct_id=p0.id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=p1.id, sequence=1)
    stop2 = TripStop(trip_id=trip.id, precinct_id=p2.id, sequence=2)
    db_session.add_all([stop0, stop1, stop2])
    await db_session.flush()
    stop_id_by_sequence = {0: stop0.id, 1: stop1.id, 2: stop2.id}

    # A: 0->2, B: 0->1, C: 1->2 — stop0 only picks up, stop1 both drops and
    # picks up (the hub), stop2 only drops.
    plan = build_phase_plan([
        PlanStop(sequence=0, picks_up=True, drops_off=False),
        PlanStop(sequence=1, picks_up=True, drops_off=True),
        PlanStop(sequence=2, picks_up=False, drops_off=True),
    ])
    assert len(plan) == 11  # the exact shape this fixture exists to reproduce

    # Deterministic emission order per build_phase_plan's own rule (verified
    # against phase_plan.py directly): trip_creation, activation, then per
    # stop loading/departure/in_transit or unloading, closing on confirmation.
    names = [
        "trip_creation", "activation", "loading_1", "departure_1", "in_transit_1",
        "unloading_1", "loading_2", "departure_2", "in_transit_2", "unloading_2", "confirmation",
    ]
    phases: dict[str, PhaseEvent] = {}
    for name, planned in zip(names, plan, strict=True):
        event = PhaseEvent(
            trip_id=trip.id,
            trip_stop_id=None if planned.stop_sequence is None else stop_id_by_sequence[planned.stop_sequence],
            phase_type=planned.phase_type,
            sequence_number=planned.sequence_number,
            status=PhaseStatus.COMPLETED if planned.phase_type == PhaseType.TRIP_CREATION else PhaseStatus.PENDING,
        )
        db_session.add(event)
        phases[name] = event
    await db_session.flush()

    return trip, driver, phases


async def _walk_cross_dock_leg1_unloading_to_leg2_departure(
    db_session, trip, driver, phases, *, leg1_destination_seal: str,
):
    """Drives the trip through the only order the sequence gate actually
    allows: activation -> loading(leg1) -> departure(leg1, seal=AB-1111) ->
    in_transit(leg1) arrival -> unloading(leg1, against
    leg1_destination_seal) -> loading(leg2) -> departure(leg2, seal=AB-2222).
    Stops one call short of leg2's own arrival and unloading — the two tests
    below each drive those themselves, with a different destination seal, to
    prove the match/mismatch outcome independently."""
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION, 
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )
    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading_1"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, driver_visual_count=12, idempotency_key=str(uuid.uuid4())),
    )
    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure_1"].id,
        payload=await _h3_payload(db_session, trip.id, seal_number="AB-1111"),
    )

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit_1"].id, payload=_arrival_payload(),
    )

    # At this point leg2's departure row already exists (created upfront by
    # the plan) but is still PENDING with seal_number=None — the old
    # trip-wide-LOADING lookup, or a naive "any departure" lookup, would
    # either crash on MultipleResultsFound or compare against None here.
    unloading_1_result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading_1"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination=leg1_destination_seal,
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading_2"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, driver_visual_count=8, idempotency_key=str(uuid.uuid4())),
    )
    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure_2"].id,
        payload=await _h3_payload(db_session, trip.id, seal_number="AB-2222"),
    )

    return unloading_1_result


@pytest.mark.asyncio
async def test_cross_dock_seal_continuity_correct_seal_per_leg_no_mismatch(
    db_session, cross_dock_trip_fixture,
):
    """The full two-leg proof: each leg's unloading resolves against ITS OWN
    leg's departure, not the trip's other leg. leg1's unloading (seal
    AB-1111, matching leg1's own departure) must not mismatch even though
    leg2's departure exists but is still PENDING/seal_number=None at that
    point — this would FAIL (crash or false mismatch) against the old
    trip-wide-LOADING lookup. leg2's unloading (seal AB-2222, matching leg2's
    own departure, NOT leg1's AB-1111) proves the lookup didn't just get
    lucky by reusing a stale row — a spurious mismatch here would mean it
    reused leg1's departure instead of resolving leg2's own."""
    trip, driver, phases = cross_dock_trip_fixture

    leg1_result = await _walk_cross_dock_leg1_unloading_to_leg2_departure(
        db_session, trip, driver, phases, leg1_destination_seal="AB-1111",
    )
    unloading_1 = next(h for h in leg1_result.phases if h.id == phases["unloading_1"].id)
    assert unloading_1.status == PhaseStatus.COMPLETED
    assert leg1_result.exceptions == []

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit_2"].id, payload=_arrival_payload(),
    )
    leg2_result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading_2"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-2222",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )
    unloading_2 = next(h for h in leg2_result.phases if h.id == phases["unloading_2"].id)
    assert unloading_2.status == PhaseStatus.COMPLETED
    assert leg2_result.exceptions == []
    assert leg2_result.status == TripStatus.ACTIVE  # not held — no mismatch on either leg


@pytest.mark.asyncio
async def test_cross_dock_seal_continuity_wrong_leg_seal_raises_mismatch(
    db_session, cross_dock_trip_fixture,
):
    """Negative case: the fix must genuinely enforce per-leg continuity, not
    just avoid crashing. Submitting leg1's stale seal (AB-1111) at leg2's
    unloading — instead of leg2's own AB-2222 — must still raise a mismatch."""
    trip, driver, phases = cross_dock_trip_fixture

    await _walk_cross_dock_leg1_unloading_to_leg2_departure(
        db_session, trip, driver, phases, leg1_destination_seal="AB-1111",
    )
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit_2"].id, payload=_arrival_payload(),
    )

    leg2_result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading_2"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1111",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    unloading_2 = next(h for h in leg2_result.phases if h.id == phases["unloading_2"].id)
    assert unloading_2.status == PhaseStatus.EXCEPTION
    assert leg2_result.status == TripStatus.ACTIVE  # flagged, not held
    assert len(leg2_result.exceptions) == 1
    assert leg2_result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    assert leg2_result.exceptions[0].severity == ExceptionSeverity.CRITICAL


# ── S1 / NEW-9: confirmation's origin count must be leg-scoped ─────────────
#
# test_confirmation_origin_count_uses_nearest_preceding_loading_not_trip_wide used
# to live here, proving decision S1's leg-scoped _find_loading_for_leg lookup.
# Task 8 deletes it as superseded: _find_loading_for_leg is gone (advance_confirmation
# now reconciles per CONSIGNMENT via Consignment.pickup_stop_id/delivery_stop_id,
# never per leg), and this fixture (cross_dock_trip_fixture) carries no Consignment
# rows at all, so under the new reconciliation the test would only pass vacuously —
# via the "no scan baseline, skip" branch, not by proving anything about stop-scoping.
# test_crossdock_reconciles_against_the_pickup_stop_not_the_preceding_leg below is
# the genuine replacement: a real Consignment picked up at one stop and delivered at
# a later one, with actual scan-out/scan-in data, on a real cross-dock trip.

@pytest.mark.asyncio
async def test_cross_dock_plan_walks_to_closed(db_session, cross_dock_trip_fixture):
    """Stage 2's ledger recorded this as its unmet "Done when": an 11-row
    cross-dock plan walks its final phase and closes the trip. It was
    blocked only by NEW-9 (advance_confirmation's trip-wide LOADING lookup
    crashing with MultipleResultsFound) until decision S1's fix. Both in_transit
    rows (seq 4, 8) are walked explicitly: each leg's drive is closed by the
    driver's own arrival submission, and the walk cannot skip either one.
    """
    trip, driver, phases = cross_dock_trip_fixture
    await _walk_cross_dock_leg1_unloading_to_leg2_departure(
        db_session, trip, driver, phases, leg1_destination_seal="AB-1111",
    )
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit_2"].id, payload=_arrival_payload(),
    )
    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading_2"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-2222",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=8, idempotency_key=str(uuid.uuid4()),
        ),
    )

    assert result.status == TripStatus.CLOSED
    assert trip.status == TripStatus.CLOSED
    assert trip.current_phase is None


# ── F13 (task 6.2b): the loading-count baseline must be scoped to its own
# stop, not summed trip-wide ─────────────────────────────────────────────
#
# The old _expected_parcel_count summed Consignment.parcel_count_expected
# trip-wide with no stop filter. A cross-dock trip has more than one LOADING
# row, so every loading was compared against the WHOLE ROUTE's declared
# total — exactly scripts/seed_trips.py's FP-DEMO-XDOCK-0001 shape (consignment
# A: stop0->stop2, B: stop0->stop1, C: stop1->stop2). loading_1 (stop0) only
# picks up A+B, loading_2 (stop1) only picks up C, but both were held to the
# full A+B+C total, raising a false PARCEL_COUNT_MISMATCH on both.
#
# Task 7 replaced the manifest-vs-driver-count baseline with a scanned-out
# aggregate, but the underlying stop-scoping the fix proved is untouched:
# scan_service.load_consignments_at_stop filters on Consignment.pickup_stop_id
# exactly as _expected_parcel_count used to, so this test is rewritten onto
# real Parcel rows and mock scans rather than deleted — the scoping behaviour
# it exists to pin is still real and still worth a regression test.
# test_single_leg_loading_count_unchanged_by_stop_scoping (the old no-op-on-a-
# single-leg-trip pin) is deleted outright: its whole premise was that the
# stop-scoped SUM equalled the old trip-wide SUM of Consignment.
# parcel_count_expected, a comparison that has no scan-driven counterpart.
# test_advance_loading_full_scan_out_completes_with_no_exception below already
# covers a single-leg trip's scanned-out aggregate end to end.

@pytest.mark.asyncio
async def test_cross_dock_loading_counts_only_what_that_stop_picks_up(
    db_session, cross_dock_trip_fixture,
):
    """Reproduces the exact demo shape: A (7 parcels, stop0->stop2), B (5
    parcels, stop0->stop1), C (8 parcels, stop1->stop2), each with real Parcel
    rows and a full scan-out at their own pickup stop. loading_1's scanned-out
    total (12 = A+B) and loading_2's (8 = C) each match what THAT STOP
    actually picks up. Before the stop-scoping fix this raised exactly two
    PARCEL_COUNT_MISMATCH exceptions (both loadings compared against
    A+B+C=20); after the fix, zero."""
    trip, driver, phases = cross_dock_trip_fixture
    stop0_id = phases["loading_1"].trip_stop_id
    stop1_id = phases["loading_2"].trip_stop_id
    stop2_id = phases["confirmation"].trip_stop_id

    consignment_a = Consignment(
        trip_id=trip.id, parcel_perfect_reference="PP-A", parcel_count_expected=7,
        pickup_stop_id=stop0_id, delivery_stop_id=stop2_id,
    )
    consignment_b = Consignment(
        trip_id=trip.id, parcel_perfect_reference="PP-B", parcel_count_expected=5,
        pickup_stop_id=stop0_id, delivery_stop_id=stop1_id,
    )
    consignment_c = Consignment(
        trip_id=trip.id, parcel_perfect_reference="PP-C", parcel_count_expected=8,
        pickup_stop_id=stop1_id, delivery_stop_id=stop2_id,
    )
    db_session.add_all([consignment_a, consignment_b, consignment_c])
    await db_session.flush()

    barcodes_by_consignment = {
        consignment_a.parcel_perfect_reference: [f"A-{i:04d}" for i in range(7)],
        consignment_b.parcel_perfect_reference: [f"B-{i:04d}" for i in range(5)],
        consignment_c.parcel_perfect_reference: [f"C-{i:04d}" for i in range(8)],
    }
    for consignment, reference in (
        (consignment_a, "PP-A"), (consignment_b, "PP-B"), (consignment_c, "PP-C"),
    ):
        await _add_parcels(
            db_session, consignment_id=consignment.id, barcodes=barcodes_by_consignment[reference],
        )

    # The warehouse scans every parcel out, in full, at the stop it's actually
    # picked up at, then closes every session this trip's loading/confirmation
    # rows are gated on. B's dropoff at stop1 is now UNLOADING, which phase_gate
    # gates on ScanDirection.IN — so its IN session at stop1 must close too,
    # even though no actual barcodes are staged for it (nothing downstream
    # reads B's scan-in count: it never feeds the final CONFIRMATION at stop2).
    feed = MockScanFeed()
    for reference, stop_id in (("PP-A", stop0_id), ("PP-B", stop0_id), ("PP-C", stop1_id)):
        await feed.stage_scans(
            consignment_reference=reference, stop_reference=str(stop_id),
            direction=ScanDirection.OUT, barcodes=barcodes_by_consignment[reference],
        )
    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop0_id, direction=ScanDirection.OUT,
    )
    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop1_id, direction=ScanDirection.OUT,
    )
    for reference, stop_id, direction in (
        ("PP-A", stop0_id, ScanDirection.OUT),
        ("PP-B", stop0_id, ScanDirection.OUT),
        ("PP-C", stop1_id, ScanDirection.OUT),
        ("PP-B", stop1_id, ScanDirection.IN),
        ("PP-A", stop2_id, ScanDirection.IN),
        ("PP-C", stop2_id, ScanDirection.IN),
    ):
        await feed.close_session(
            consignment_reference=reference, stop_reference=str(stop_id), direction=direction,
        )

    await _walk_cross_dock_leg1_unloading_to_leg2_departure(
        db_session, trip, driver, phases, leg1_destination_seal="AB-1111",
    )
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit_2"].id, payload=_arrival_payload(),
    )
    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading_2"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-2222",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )
    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=8, idempotency_key=str(uuid.uuid4()),
        ),
    )

    mismatches = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == trip.id,
            TripException.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH,
        )
    )).scalars().all()
    assert mismatches == []

    loading_1 = next(h for h in result.phases if h.id == phases["loading_1"].id)
    loading_2 = next(h for h in result.phases if h.id == phases["loading_2"].id)
    assert loading_1.status == PhaseStatus.COMPLETED
    assert loading_1.parcel_count_origin == 12  # A(7) + B(5), stop0's own pickups
    assert loading_2.status == PhaseStatus.COMPLETED
    assert loading_2.parcel_count_origin == 8  # C only, stop1's own pickup
    assert result.status == TripStatus.CLOSED


@pytest.mark.asyncio
async def test_loading_count_check_skipped_when_stop_has_no_mapped_consignments(
    db_session, cross_dock_trip_fixture,
):
    """A stop-scoped baseline of None must SKIP the check, not manufacture a
    mismatch against 0 — the stop-scoped counterpart of
    test_advance_loading_no_consignments_skips_manifest_check. Consignment C
    exists on this trip and picks up at stop1, but nothing is mapped to pick
    up at stop0 — loading_1's baseline must resolve to None even though the
    trip as a whole has a manifest, and an arbitrary driver count (99) must
    not raise a mismatch against it."""
    trip, driver, phases = cross_dock_trip_fixture
    stop1_id = phases["loading_2"].trip_stop_id
    stop2_id = phases["confirmation"].trip_stop_id

    db_session.add(Consignment(
        trip_id=trip.id, parcel_perfect_reference="PP-C", parcel_count_expected=8,
        pickup_stop_id=stop1_id, delivery_stop_id=stop2_id,
    ))
    await db_session.flush()

    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION,
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )
    result = await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading_1"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, driver_visual_count=99, idempotency_key=str(uuid.uuid4())),
    )

    loading_1 = next(h for h in result.phases if h.id == phases["loading_1"].id)
    assert loading_1.status == PhaseStatus.COMPLETED
    assert loading_1.parcel_count_origin is None
    assert not any(
        exc.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH for exc in result.exceptions
    )


# ── complete_phase / next_phase: the two new Stage 3 service entry points ──

@pytest.mark.asyncio
async def test_complete_phase_rejects_payload_for_a_different_phase_type(db_session, trip_fixture):
    """complete_phase raises PhaseTypeMismatchError rather than writing
    activation's evidence onto a loading row."""
    trip, driver, phases = trip_fixture
    payload = LoadingCompleteRequest(
        phase_type=PhaseType.LOADING, driver_visual_count=42, idempotency_key=str(uuid.uuid4()),
    )

    with pytest.raises(PhaseTypeMismatchError):
        await complete_phase(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["activation"].id, payload=payload,
        )


@pytest.mark.asyncio
async def test_next_phase_derives_from_ledger_not_from_trip_current_phase(db_session, trip_fixture):
    """Corrupt trip.current_phase to a deliberately wrong value, then assert
    next_phase() still returns the true lowest-unresolved row. This is the test
    that makes 'the ledger is the truth' provable rather than asserted."""
    trip, driver, phases = trip_fixture
    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(
            phase_type=PhaseType.ACTIVATION, driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
            idempotency_key=str(uuid.uuid4()),
        ),
    )
    # Genuinely wrong, not merely stale: activation just completed, so the
    # ledger's true next phase is LOADING — CONFIRMATION cannot be right by
    # any honest reading of the ledger either.
    trip.current_phase = PhaseType.CONFIRMATION
    await db_session.flush()

    event = await next_phase(db_session, trip_id=trip.id, driver_id=driver.id)

    assert event is not None
    assert event.id == phases["loading"].id
    assert event.phase_type == PhaseType.LOADING


# ── Activation date gate: a trip cannot be started before the day it is due ──
#
# Pure logic, no DB — the two helpers below are the whole rule, and testing them
# directly is what makes the timezone decision provable rather than asserted.

def test_operating_day_uses_the_operator_timezone_not_utc():
    # 23:00 UTC on the 4th is 01:00 SAST on the 5th. Comparing UTC dates here would
    # tell a driver their legitimately-scheduled early-morning trip is a day early.
    late_utc = datetime(2026, 8, 4, 23, 0, tzinfo=UTC)

    assert operating_day(late_utc) == date(2026, 8, 5)


def test_operating_day_reads_a_naive_datetime_as_utc():
    # Not as server-local time: the same trip must gate identically whichever machine
    # answers the request.
    naive = datetime(2026, 8, 4, 23, 0)

    assert operating_day(naive) == operating_day(datetime(2026, 8, 4, 23, 0, tzinfo=UTC))


def test_is_before_scheduled_day_blocks_an_earlier_calendar_day():
    now = datetime(2026, 8, 4, 12, 0, tzinfo=UTC)
    scheduled = datetime(2026, 8, 12, 6, 0, tzinfo=UTC)

    assert is_before_scheduled_day(now, scheduled) is True


def test_is_before_scheduled_day_allows_any_time_on_the_scheduled_day():
    # 02:00 SAST against an 08:00 slot is a driver ahead of schedule, not a driver on
    # the wrong day — the chosen rule is same-calendar-day, not same-minute.
    now = datetime(2026, 8, 12, 0, 0, tzinfo=UTC)      # 02:00 SAST
    scheduled = datetime(2026, 8, 12, 6, 0, tzinfo=UTC)  # 08:00 SAST

    assert is_before_scheduled_day(now, scheduled) is False


def test_is_before_scheduled_day_allows_a_late_start():
    # A delayed trip still needs its evidence captured. Blocking it would only push the
    # driver to work around the system, which is the opposite of what this app is for.
    now = datetime(2026, 8, 20, 6, 0, tzinfo=UTC)
    scheduled = datetime(2026, 8, 12, 6, 0, tzinfo=UTC)

    assert is_before_scheduled_day(now, scheduled) is False


# ── Activation gates: one trip at a time, earliest-first within a day ────────────────
#
# Both rules are enforced in advance_activation (not _gate_and_load): they are about
# STARTING a trip, and applying them to every phase would strand a driver mid-journey the
# moment a dispatcher assigned them tomorrow's work.


async def _sibling_trip(db_session, trip, *, status, scheduled, reference="FP-TEST-2"):
    """Another trip for the SAME driver — the obstacle the two gates look for."""
    sibling = Trip(
        id=uuid.uuid4(), trip_reference=reference, order_number=f"ORD-{uuid.uuid4().hex[:6]}",
        operator_organization_id=trip.operator_organization_id,
        client_organization_id=trip.client_organization_id,
        driver_id=trip.driver_id,
        # Same horse on purpose: two trips claiming one driver and one horse at the same
        # moment is exactly the state the underway gate exists to prevent.
        horse_id=trip.horse_id,
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        status=status, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=scheduled,
        created_by_user_id=trip.created_by_user_id,
    )
    db_session.add(sibling)
    await db_session.flush()
    return sibling


def _activation_payload():
    return ActivationCompleteRequest(
        phase_type=PhaseType.ACTIVATION,
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
        idempotency_key=str(uuid.uuid4()),
    )


@pytest.mark.asyncio
async def test_activation_rejected_while_another_trip_is_underway(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    await _sibling_trip(
        db_session, trip, status=TripStatus.ACTIVE, scheduled=_SCHEDULED_TODAY,
        reference="FP-ALREADY-RUNNING",
    )

    with pytest.raises(TripActivationBlockedError) as exc:
        await advance_activation(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["activation"].id, payload=_activation_payload(),
        )

    assert exc.value.blocking_trip_reference == "FP-ALREADY-RUNNING"


@pytest.mark.asyncio
async def test_activation_rejected_while_another_trip_is_held(db_session, trip_fixture):
    # A held trip is still the trip the driver is on — it is merely blocked from
    # advancing, so it must not free them up to start a second one.
    trip, driver, phases = trip_fixture
    await _sibling_trip(
        db_session, trip, status=TripStatus.EXCEPTION_HOLD, scheduled=_SCHEDULED_TODAY,
    )

    with pytest.raises(TripActivationBlockedError):
        await advance_activation(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["activation"].id, payload=_activation_payload(),
        )


@pytest.mark.asyncio
async def test_activation_allowed_when_the_other_trip_is_finished(db_session, trip_fixture):
    # A driver's first completed trip must not permanently block their second.
    trip, driver, phases = trip_fixture
    await _sibling_trip(db_session, trip, status=TripStatus.CLOSED, scheduled=_SCHEDULED_TODAY)

    result = await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["activation"].id, payload=_activation_payload(),
    )

    assert result.status == TripStatus.ACTIVE


@pytest.mark.asyncio
async def test_activation_rejected_when_an_earlier_trip_today_is_unstarted(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    trip.planned_departure_at = _SCHEDULED_TODAY.replace(hour=14, minute=0, second=0, microsecond=0)
    await db_session.flush()
    await _sibling_trip(
        db_session, trip, status=TripStatus.CREATED,
        scheduled=trip.planned_departure_at - timedelta(hours=4),
        reference="FP-EARLIER-RUN",
    )

    with pytest.raises(TripActivationBlockedError) as exc:
        await advance_activation(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["activation"].id, payload=_activation_payload(),
        )

    assert exc.value.blocking_trip_reference == "FP-EARLIER-RUN"


@pytest.mark.asyncio
async def test_activation_names_the_earliest_of_several_blocking_trips(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    trip.planned_departure_at = _SCHEDULED_TODAY.replace(hour=14, minute=0, second=0, microsecond=0)
    await db_session.flush()
    await _sibling_trip(
        db_session, trip, status=TripStatus.CREATED,
        scheduled=trip.planned_departure_at - timedelta(hours=2), reference="FP-MID-RUN",
    )
    await _sibling_trip(
        db_session, trip, status=TripStatus.CREATED,
        scheduled=trip.planned_departure_at - timedelta(hours=6), reference="FP-FIRST-RUN",
    )

    with pytest.raises(TripActivationBlockedError) as exc:
        await advance_activation(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["activation"].id, payload=_activation_payload(),
        )

    assert exc.value.blocking_trip_reference == "FP-FIRST-RUN"


@pytest.mark.asyncio
async def test_activation_allowed_when_the_other_trip_departs_later_today(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    await _sibling_trip(
        db_session, trip, status=TripStatus.CREATED,
        scheduled=trip.planned_departure_at + timedelta(hours=4),
    )

    result = await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["activation"].id, payload=_activation_payload(),
    )

    assert result.status == TripStatus.ACTIVE


@pytest.mark.asyncio
async def test_activation_ignores_an_earlier_trip_on_a_different_day(db_session, trip_fixture):
    # Scoped to one operating day on purpose: a trip that was never run last week must
    # not freeze today's work until a dispatcher cancels it.
    trip, driver, phases = trip_fixture
    await _sibling_trip(
        db_session, trip, status=TripStatus.CREATED,
        scheduled=trip.planned_departure_at - timedelta(days=7),
    )

    result = await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["activation"].id, payload=_activation_payload(),
    )

    assert result.status == TripStatus.ACTIVE


@pytest.mark.asyncio
async def test_activation_replay_is_not_blocked_by_a_trip_started_since(db_session, trip_fixture):
    # An offline activation queued on the roadside and resent later must still return the
    # trip it already activated, not start failing a rule it satisfied at capture time.
    trip, driver, phases = trip_fixture
    payload = _activation_payload()
    first = await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["activation"].id, payload=payload,
    )
    await _sibling_trip(db_session, trip, status=TripStatus.ACTIVE, scheduled=_SCHEDULED_TODAY)

    replay = await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["activation"].id, payload=payload,
    )

    assert replay.id == first.id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "hedera_exception",
    [
        HederaTimeoutError("simulated Hedera timeout"),
        HederaServiceError("simulated Hedera service error"),
    ],
    ids=["timeout", "service_error"],
)
async def test_anchor_phase_event_fails_open_on_hedera_trouble(
    db_session, trip_fixture, monkeypatch, hedera_exception,
):
    """D7 fail-open, now asserted where it actually runs: the worker.

    The phase itself can no longer be blocked by Hedera at all — completion returns
    before the submit is even attempted. What still matters is that the worker's attempt
    never raises and records the retry-owed debt on anchor_status instead. Parametrized
    over both exception types the except clause catches — HederaServiceError is the
    parent of HederaTimeoutError, so both branches are cheap insurance against someone
    later narrowing the caught tuple.
    """
    trip, driver, phases = trip_fixture
    monkeypatch.setattr(
        "app.orchestration.phase_service.anchor_subject",
        AsyncMock(side_effect=hedera_exception),
    )

    anchored = await anchor_phase_event(
        db_session, phase_event_id=phases["departure"].id,
        canonical_payload={"phase_event_id": str(phases["departure"].id)},
        receipt_type=BlockchainReceiptType.PICKUP,
    )

    assert anchored is False
    assert phases["departure"].anchor_status == AnchorStatus.FAILED
    assert phases["departure"].blockchain_receipt_id is None


@pytest.mark.asyncio
async def test_anchor_phase_event_writes_the_receipt(db_session, trip_fixture):
    """The other half of the split: the worker turns a PENDING phase into an ANCHORED one
    with a real receipt, which is what the driver app's anchor badge waits for."""
    trip, driver, phases = trip_fixture

    anchored = await anchor_phase_event(
        db_session, phase_event_id=phases["departure"].id,
        canonical_payload={"phase_event_id": str(phases["departure"].id), "seal_number": "AB-1234"},
        receipt_type=BlockchainReceiptType.PICKUP,
    )

    assert anchored is True
    assert phases["departure"].anchor_status == AnchorStatus.ANCHORED
    assert phases["departure"].blockchain_receipt_id is not None
    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == phases["departure"].blockchain_receipt_id)
    )).scalar_one()
    assert receipt.receipt_type == BlockchainReceiptType.PICKUP


@pytest.mark.asyncio
async def test_anchor_phase_event_ignores_an_unknown_event(db_session, trip_fixture):
    """Should be impossible — the dispatch only fires after the row's transaction
    commits — so it returns False and logs rather than raising a worker into a retry loop."""
    anchored = await anchor_phase_event(
        db_session, phase_event_id=uuid.uuid4(),
        canonical_payload={}, receipt_type=BlockchainReceiptType.PICKUP,
    )

    assert anchored is False


@pytest.mark.asyncio
async def test_a_broker_failure_falls_back_to_anchoring_inline(
    db_session, trip_fixture, monkeypatch,
):
    """The safety net for moving anchoring off the request path.

    Nothing in this codebase retries an anchor_status = FAILED debt, so a dispatch that
    vanishes into an unreachable broker would mean permanently unanchored evidence. When
    the queue can't be reached the anchor runs inline instead — slow, which is a far
    better failure than silent.
    """
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    class _BrokenBroker:
        @staticmethod
        def delay(*_args, **_kwargs):
            raise ConnectionError("broker unreachable")

    monkeypatch.setattr("app.tasks.blockchain.anchor_phase_event_task", _BrokenBroker)
    inline_calls: list[uuid.UUID] = []
    monkeypatch.setattr(
        "app.orchestration.phase_service._anchor_inline_after_dispatch_failure",
        lambda **kwargs: inline_calls.append(kwargs["phase_event_id"]),
    )

    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id),
    )
    await db_session.commit()

    assert inline_calls == [phases["departure"].id]


# ── D8: row locking on _load_phase_event ────────────────────────────────────

async def test_load_phase_event_emits_for_update(db_session, trip_fixture, monkeypatch):
    """D8: proves the lock hint is not silently dropped. A lock that got typo'd
    into a no-op is strictly worse than no lock at all — it looks handled in code
    review while leaving the exact Hedera double-submission race this task exists
    to close, and that race writes an on-chain message a rollback cannot un-submit.

    Deliberately spies on the statement _load_phase_event ACTUALLY hands the
    session, rather than re-building a `select(...).with_for_update()` here and
    asserting SQLAlchemy renders it. That earlier shape asserted a fact about
    SQLAlchemy, not about this codebase: deleting .with_for_update() from
    _load_phase_event left it green, so the only guard on the race could not fail.
    """
    trip, _driver, phases = trip_fixture
    captured: list[Any] = []
    original_execute = db_session.execute

    async def _spy(statement, *args, **kwargs):
        captured.append(statement)
        return await original_execute(statement, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", _spy)

    await _load_phase_event(
        db_session, trip_id=trip.id, phase_event_id=phases["activation"].id,
    )

    assert len(captured) == 1
    compiled = str(captured[0].compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in compiled


# ── Task 7: advance_loading closes on the warehouse scan, not a driver count ──
#
# The driver never enters the warehouse and may reach the truck after loading
# finished, so a parcel count he types in is not evidence — it's a guess. These
# fixtures build a trip whose loading phase is unblocked purely by the mock
# scan feed (mirroring test_phase_gate.py's `store`/`seeded` pattern), never by
# a hand-inserted TripException — the whole point of the short/empty variants
# is proving what happens when scan_service's own ingest has (or hasn't)
# already recorded a finding before advance_loading runs.


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    fake = FakeMockStateStore()
    monkeypatch.setattr(scan_feed_module, "get_mock_state_store", lambda: fake)
    return fake


async def _build_scan_ready_trip(db_session) -> dict[str, Any]:
    """Trip + driver + a one-stop, one-consignment, three-parcel setup with the
    phase plan advance_loading needs already committed (trip_creation
    completed, activation completed, loading pending).

    Same trip shape as conftest.py's `seeded` fixture (test_phase_gate.py's),
    extended with the PhaseEvent rows `seeded` deliberately omits — its only
    consumer calls blocked_on_by_stop directly and needs no phase plan at all,
    but advance_loading's own gate (_gate_and_load) requires one.
    """
    org = Organization(id=uuid.uuid4(), name="ScanOp", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4().hex[:8]}@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="ScanDriver",
        id_number="8001015009079", phone_number="+27821239999", license_number=f"DRV-{uuid.uuid4().hex[:8]}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"SC{uuid.uuid4().hex[:6].upper()}", pulsit_device_id=f"PUL-{uuid.uuid4().hex[:8]}",
    )
    precinct = Precinct(
        id=uuid.uuid4(), name="ScanOrigin", principal_organization_id=org.id,
        latitude="0", longitude="0",
    )
    db_session.add_all([user, driver, horse, precinct])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-SCAN",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        # A single-stop pickup+delivery trip (mirrors this consignment's own
        # pickup_stop_id == delivery_stop_id below) — get_trip_detail (reached
        # via advance_loading's _finish_phase) requires both to be set.
        origin_precinct_id=precinct.id, destination_precinct_id=precinct.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=0)
    db_session.add(stop)
    await db_session.flush()

    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY-SCAN-001",
        parcel_count_expected=3, pickup_stop_id=stop.id, delivery_stop_id=stop.id,
    )
    db_session.add(consignment)
    await db_session.flush()

    barcodes = ["WAYSCAN0001", "WAYSCAN0002", "WAYSCAN0003"]
    for barcode in barcodes:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id,
            barcode=barcode, status=ParcelStatus.PENDING,
        ))
    await db_session.flush()

    trip_creation_event = PhaseEvent(
        trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION,
        sequence_number=0, status=PhaseStatus.COMPLETED,
    )
    activation_event = PhaseEvent(
        trip_id=trip.id, phase_type=PhaseType.ACTIVATION, trip_stop_id=stop.id,
        sequence_number=1, status=PhaseStatus.COMPLETED,
    )
    loading_event = PhaseEvent(
        trip_id=trip.id, phase_type=PhaseType.LOADING, trip_stop_id=stop.id,
        sequence_number=2, status=PhaseStatus.PENDING,
    )
    db_session.add_all([trip_creation_event, activation_event, loading_event])
    await db_session.flush()

    return {
        "trip": trip, "driver": driver, "stop": stop, "consignment": consignment,
        "barcodes": barcodes, "loading_event": loading_event,
    }


@pytest.fixture
async def ready_to_load(db_session, store) -> dict[str, Any]:
    """The scan-out session staged in FULL (3/3) and closed, with
    scan_service.ingest_scans already run — mirrors the real dispatcher flow
    (dev_triggers.py's scan trigger stages+ingests in one call; close-session
    is a separate call), which is what makes the counts final by the time
    advance_loading's gate lets the request through."""
    built = await _build_scan_ready_trip(db_session)
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=built["consignment"].parcel_perfect_reference,
        stop_reference=str(built["stop"].id), direction=ScanDirection.OUT,
        barcodes=built["barcodes"],
    )
    await scan_service.ingest_scans(
        db_session, trip_id=built["trip"].id, trip_stop_id=built["stop"].id,
        direction=ScanDirection.OUT,
    )
    await feed.close_session(
        consignment_reference=built["consignment"].parcel_perfect_reference,
        stop_reference=str(built["stop"].id), direction=ScanDirection.OUT,
    )
    return built


@pytest.fixture
async def short_scanned_ready_to_load(db_session, store) -> dict[str, Any]:
    """Only 2 of 3 barcodes staged, with ingest_scans already run — so
    scan_service's own PARCEL_COUNT_MISMATCH row exists BEFORE advance_loading
    is ever called. Built by calling ingest_scans, never by inserting a
    TripException by hand: that ordering is the entire point of the test this
    fixture backs."""
    built = await _build_scan_ready_trip(db_session)
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=built["consignment"].parcel_perfect_reference,
        stop_reference=str(built["stop"].id), direction=ScanDirection.OUT,
        barcodes=built["barcodes"][:2],
    )
    await scan_service.ingest_scans(
        db_session, trip_id=built["trip"].id, trip_stop_id=built["stop"].id,
        direction=ScanDirection.OUT,
    )
    await feed.close_session(
        consignment_reference=built["consignment"].parcel_perfect_reference,
        stop_reference=str(built["stop"].id), direction=ScanDirection.OUT,
    )
    return built


@pytest.fixture
async def unscanned_ready_to_load(db_session, store) -> dict[str, Any]:
    """Session closed with NOTHING staged. ingest_scans is run against the
    empty feed (so it behaves exactly as a real poll would) — scan_service's
    own guard (`if events and (missing or unexpected)`) fires on nothing, so
    no exception row exists going into advance_loading."""
    built = await _build_scan_ready_trip(db_session)
    await scan_service.ingest_scans(
        db_session, trip_id=built["trip"].id, trip_stop_id=built["stop"].id,
        direction=ScanDirection.OUT,
    )
    await MockScanFeed().close_session(
        consignment_reference=built["consignment"].parcel_perfect_reference,
        stop_reference=str(built["stop"].id), direction=ScanDirection.OUT,
    )
    return built


async def test_loading_completes_without_a_driver_count(db_session, store, ready_to_load):
    """The driver never enters the warehouse and may arrive after loading finished.
    A count he cannot honestly produce must not be what closes the phase."""
    await phase_service.advance_loading(
        db_session,
        trip_id=ready_to_load["trip"].id,
        driver_id=ready_to_load["driver"].id,
        phase_event_id=ready_to_load["loading_event"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(PhaseEvent, ready_to_load["loading_event"].id)
    assert event.status == PhaseStatus.COMPLETED
    assert event.driver_visual_count is None


async def test_loading_stamps_parcel_count_origin_from_scans(
    db_session, store, ready_to_load,
):
    await phase_service.advance_loading(
        db_session,
        trip_id=ready_to_load["trip"].id,
        driver_id=ready_to_load["driver"].id,
        phase_event_id=ready_to_load["loading_event"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(PhaseEvent, ready_to_load["loading_event"].id)
    assert event.parcel_count_origin == 3


async def test_loading_raises_no_exception_for_a_matching_scan(
    db_session, store, ready_to_load,
):
    await phase_service.advance_loading(
        db_session,
        trip_id=ready_to_load["trip"].id,
        driver_id=ready_to_load["driver"].id,
        phase_event_id=ready_to_load["loading_event"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
        ),
    )

    exceptions = (await db_session.execute(
        select(TripException).where(TripException.trip_id == ready_to_load["trip"].id)
    )).scalars().all()
    assert exceptions == []


async def test_a_legacy_payload_with_a_count_is_accepted_and_ignored(
    db_session, store, ready_to_load,
):
    """A loading queued offline under the old schema replays with the field present.
    Accepting and ignoring it is what stops the queue poisoning itself forever."""
    await phase_service.advance_loading(
        db_session,
        trip_id=ready_to_load["trip"].id,
        driver_id=ready_to_load["driver"].id,
        phase_event_id=ready_to_load["loading_event"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING,
            driver_visual_count=99,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(PhaseEvent, ready_to_load["loading_event"].id)
    assert event.status == PhaseStatus.COMPLETED
    assert event.parcel_count_origin == 3


async def test_a_short_scan_produces_exactly_one_exception(
    db_session, store, short_scanned_ready_to_load,
):
    """scan_service already raised this at ingest. advance_loading must not raise a
    second row for the same fact — its dedup compares descriptions verbatim, so a
    differently-worded duplicate would sail past it and the dispatcher would see the
    same short count twice."""
    await phase_service.advance_loading(
        db_session,
        trip_id=short_scanned_ready_to_load["trip"].id,
        driver_id=short_scanned_ready_to_load["driver"].id,
        phase_event_id=short_scanned_ready_to_load["loading_event"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
        ),
    )

    exceptions = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == short_scanned_ready_to_load["trip"].id,
            TripException.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH,
        )
    )).scalars().all()
    assert len(exceptions) == 1


async def test_a_session_closed_with_nothing_scanned_still_raises(
    db_session, store, unscanned_ready_to_load,
):
    """The backstop's whole reason for existing. scan_service guards on
    `if events and ...`, so a session closed with zero scans raises nothing there —
    and a truck that loaded nothing is the most serious short count of all."""
    await phase_service.advance_loading(
        db_session,
        trip_id=unscanned_ready_to_load["trip"].id,
        driver_id=unscanned_ready_to_load["driver"].id,
        phase_event_id=unscanned_ready_to_load["loading_event"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(PhaseEvent, unscanned_ready_to_load["loading_event"].id)
    exceptions = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == unscanned_ready_to_load["trip"].id,
            TripException.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH,
        )
    )).scalars().all()
    assert event.status == PhaseStatus.EXCEPTION
    assert len(exceptions) == 1


# ── Task 8: advance_confirmation reconciles scan-out against scan-in ───────
#
# Replaces the old circular check (origin_count came from loading_event.driver_
# visual_count, which advance_loading stopped writing — see the "Task 7 removed"
# comment above test_advance_confirmation_matching_counts_closes_trip). The new
# reconciliation is per CONSIGNMENT, scoped by Consignment.pickup_stop_id /
# delivery_stop_id (FP-112), never per leg — built the same way ready_to_load
# above was: real Consignment/Parcel rows, barcodes staged on MockScanFeed, and
# scan_service.ingest_scans actually run, never a hand-stamped Parcel or
# hand-inserted TripException.

async def _build_confirmation_base_trip(
    db_session, *, org_suffix: str, num_stops: int,
) -> dict[str, Any]:
    """Org/driver/horse + `num_stops` precincts and TripStops, trip CREATED and
    scheduled today (so _reject_if_not_due lets activation through). The common
    scaffold every ready_to_confirm* fixture below walks via the real advance_*
    functions rather than hand-stamping PhaseEvent rows — these fixtures prove
    the real gate and scan-reconciliation path, not a shortcut around it.
    """
    org = Organization(id=uuid.uuid4(), name=f"ConfirmOp-{org_suffix}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(
        id=uuid.uuid4(), name=f"ConfirmClient-{org_suffix}", org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"{uuid.uuid4().hex[:8]}@test.co.za", full_name="D",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="ConfirmDriver",
        id_number=uuid.uuid4().hex[:13], phone_number=f"+2782{uuid.uuid4().hex[:7]}",
        license_number=f"DRV-{uuid.uuid4().hex[:8]}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"CF{uuid.uuid4().hex[:6].upper()}", pulsit_device_id=f"PUL-{uuid.uuid4().hex[:8]}",
    )
    db_session.add_all([user, driver, horse])
    await db_session.flush()

    precincts = [
        Precinct(
            id=uuid.uuid4(), name=f"{org_suffix}-P{i}", principal_organization_id=client_org.id,
            latitude=str(i), longitude=str(i),
        )
        for i in range(num_stops)
    ]
    db_session.add_all(precincts)
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:8]}", order_number="ORD-CONFIRM",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=precincts[0].id, destination_precinct_id=precincts[-1].id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=_SCHEDULED_TODAY,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stops = [
        TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precincts[i].id, sequence=i)
        for i in range(num_stops)
    ]
    db_session.add_all(stops)
    await db_session.flush()

    return {"trip": trip, "driver": driver, "stops": stops}


async def _stage_and_ingest(
    db_session, feed: MockScanFeed, *, consignment_reference: str, stop_id: uuid.UUID,
    direction: ScanDirection, trip_id: uuid.UUID, barcodes: list[str],
) -> None:
    """Stage barcodes on the mock feed, ingest them, then close the session —
    the same three-call sequence ready_to_load's own fixtures use, factored out
    since every confirmation fixture below needs it at least twice (out then in)."""
    await feed.stage_scans(
        consignment_reference=consignment_reference, stop_reference=str(stop_id),
        direction=direction, barcodes=barcodes,
    )
    await scan_service.ingest_scans(
        db_session, trip_id=trip_id, trip_stop_id=stop_id, direction=direction,
    )
    await feed.close_session(
        consignment_reference=consignment_reference, stop_reference=str(stop_id), direction=direction,
    )


async def _build_confirmation_ready_trip(db_session, *, scan_in_count: int) -> dict[str, Any]:
    """A single-leg (2-stop) trip walked via advance_activation/loading/departure/
    unloading to a PENDING confirmation row, with 3 parcels scanned OUT in full at
    the origin stop and the first `scan_in_count` of those SAME 3 barcodes scanned
    IN at the destination stop — both sessions closed, so confirmation's own gate
    (blocked_on_by_stop) lets the call through without a 409.
    """
    base = await _build_confirmation_base_trip(db_session, org_suffix=uuid.uuid4().hex[:6], num_stops=2)
    trip, driver, (stop0, stop1) = base["trip"], base["driver"], base["stops"]

    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=f"WAY-{uuid.uuid4().hex[:8]}",
        parcel_count_expected=3, pickup_stop_id=stop0.id, delivery_stop_id=stop1.id,
    )
    db_session.add(consignment)
    await db_session.flush()

    barcodes = [f"CONF{uuid.uuid4().hex[:8]}" for _ in range(3)]
    for barcode in barcodes:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id, barcode=barcode, status=ParcelStatus.PENDING,
        ))
    await db_session.flush()

    feed = MockScanFeed()
    await _stage_and_ingest(
        db_session, feed, consignment_reference=consignment.parcel_perfect_reference,
        stop_id=stop0.id, direction=ScanDirection.OUT, trip_id=trip.id, barcodes=barcodes,
    )

    # Real phase plan for a single-leg trip, hand-built like trip_fixture's own —
    # walked with the real advance_* wrappers below, not skipped.
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

    # BEFORE advance_unloading, not after: UNLOADING now gates on this stop's
    # IN-direction scan session (phase_gate.GATED_PHASES), matching the physical
    # order — the warehouse scans parcels off the truck before the driver can
    # close out unloading.
    await _stage_and_ingest(
        db_session, feed, consignment_reference=consignment.parcel_perfect_reference,
        stop_id=stop1.id, direction=ScanDirection.IN, trip_id=trip.id, barcodes=barcodes[:scan_in_count],
    )

    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    return {
        "trip": trip, "driver": driver, "consignment": consignment,
        "delivery_stop": stop1, "pickup_stop": stop0,
        "confirmation_event": phases["confirmation"],
        "pod_photo_id": await _make_artifact(db_session, trip.id),
        "pod_signature_id": await _make_artifact(db_session, trip.id),
    }


@pytest.fixture
async def ready_to_confirm(db_session, store) -> dict[str, Any]:
    """All 3 parcels scanned OUT at origin and all 3 scanned IN at destination —
    the clean case. driver_visual_count on the payload is the driver's own pallet
    count, recorded as evidence but never compared against either scan."""
    return await _build_confirmation_ready_trip(db_session, scan_in_count=3)


@pytest.fixture
async def ready_to_confirm_short(db_session, store) -> dict[str, Any]:
    """Only 2 of 3 barcodes scanned IN at destination — the theft case."""
    return await _build_confirmation_ready_trip(db_session, scan_in_count=2)


@pytest.fixture
async def empty_leg_ready_to_confirm(db_session, store) -> dict[str, Any]:
    """Confirmation at a stop with NO Consignment rows at all — an EMPTY_LEG
    trip's real phase plan (no loading row, matching empty_leg_trip_fixture
    above), walked to a PENDING confirmation with nothing to reconcile."""
    base = await _build_confirmation_base_trip(db_session, org_suffix=f"EL{uuid.uuid4().hex[:6]}", num_stops=2)
    trip, driver, (stop0, stop1) = base["trip"], base["driver"], base["stops"]
    trip.trip_type = TripType.EMPTY_LEG
    await db_session.flush()

    plan = build_phase_plan([
        PlanStop(sequence=0, picks_up=False, drops_off=False),
        PlanStop(sequence=1, picks_up=False, drops_off=False),
    ])
    stop_id_by_sequence = {0: stop0.id, 1: stop1.id}
    phases: dict[str, PhaseEvent] = {}
    for planned in plan:
        event = PhaseEvent(
            trip_id=trip.id,
            trip_stop_id=None if planned.stop_sequence is None else stop_id_by_sequence[planned.stop_sequence],
            phase_type=planned.phase_type,
            sequence_number=planned.sequence_number,
            status=PhaseStatus.COMPLETED if planned.phase_type == PhaseType.TRIP_CREATION else PhaseStatus.PENDING,
        )
        db_session.add(event)
        phases[planned.phase_type.value] = event
    await db_session.flush()

    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION,
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
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
    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    return {
        "trip": trip, "driver": driver,
        "confirmation_event": phases["confirmation"],
        "pod_photo_id": await _make_artifact(db_session, trip.id),
        "pod_signature_id": await _make_artifact(db_session, trip.id),
    }


@pytest.fixture
async def xdock_ready_to_confirm(db_session, store) -> dict[str, Any]:
    """Cross-dock: a consignment picked up at stop0 and delivered at stop2, with an
    intervening stop1 that has its own LOADING row (no consignment of its own —
    build_phase_plan takes picks_up/drops_off as given, it does not derive them).
    Scan-out at stop0 and scan-in at stop2 AGREE for the one real consignment, so a
    correct per-consignment implementation raises nothing — a leg-based lookup
    would instead resolve stop1's loading (which never saw this consignment at
    all) as the "origin" and manufacture a mismatch on a healthy trip.
    """
    base = await _build_confirmation_base_trip(db_session, org_suffix=f"XD{uuid.uuid4().hex[:6]}", num_stops=3)
    trip, driver, (stop0, stop1, stop2) = base["trip"], base["driver"], base["stops"]

    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=f"WAY-XD-{uuid.uuid4().hex[:8]}",
        parcel_count_expected=2, pickup_stop_id=stop0.id, delivery_stop_id=stop2.id,
    )
    db_session.add(consignment)
    await db_session.flush()
    barcodes = [f"XD{uuid.uuid4().hex[:8]}" for _ in range(2)]
    for barcode in barcodes:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id, barcode=barcode, status=ParcelStatus.PENDING,
        ))
    await db_session.flush()

    plan = build_phase_plan([
        PlanStop(sequence=0, picks_up=True, drops_off=False),
        PlanStop(sequence=1, picks_up=True, drops_off=False),
        PlanStop(sequence=2, picks_up=False, drops_off=True),
    ])
    names = [
        "trip_creation", "activation", "loading_1", "departure_1", "in_transit_1",
        "loading_2", "departure_2", "in_transit_2", "unloading", "confirmation",
    ]
    stop_id_by_sequence = {0: stop0.id, 1: stop1.id, 2: stop2.id}
    phases: dict[str, PhaseEvent] = {}
    for name, planned in zip(names, plan, strict=True):
        event = PhaseEvent(
            trip_id=trip.id,
            trip_stop_id=None if planned.stop_sequence is None else stop_id_by_sequence[planned.stop_sequence],
            phase_type=planned.phase_type,
            sequence_number=planned.sequence_number,
            status=PhaseStatus.COMPLETED if planned.phase_type == PhaseType.TRIP_CREATION else PhaseStatus.PENDING,
        )
        db_session.add(event)
        phases[name] = event
    await db_session.flush()

    feed = MockScanFeed()
    await _stage_and_ingest(
        db_session, feed, consignment_reference=consignment.parcel_perfect_reference,
        stop_id=stop0.id, direction=ScanDirection.OUT, trip_id=trip.id, barcodes=barcodes,
    )

    await advance_activation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["activation"].id,
        payload=ActivationCompleteRequest(phase_type=PhaseType.ACTIVATION,
            driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), idempotency_key=str(uuid.uuid4()),
        ),
    )
    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading_1"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4())),
    )
    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure_1"].id,
        payload=DepartureCompleteRequest(phase_type=PhaseType.DEPARTURE,
            waybill_photo_artifact_id=await _make_artifact(db_session, trip.id), seal_number="AB-1111",
            seal_photo_artifact_id=await _make_artifact(db_session, trip.id),
            guard_verified_seal=True, idempotency_key=str(uuid.uuid4()),
        ),
    )
    # Each leg's drive is closed by the driver's own arrival before the next stop's work
    # can start — leg 1's in_transit sits at a lower sequence than loading_2/departure_2.
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit_1"].id, payload=_arrival_payload(),
    )
    # stop1 has no consignment of its own (pickup_stop_id never points here), so
    # loading_2's gate sees no expected parcel set and is never blocked — no
    # staging needed, matching phase_gate's own "no Consignment -> not blocked" rule.
    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["loading_2"].id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4())),
    )
    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure_2"].id,
        payload=DepartureCompleteRequest(phase_type=PhaseType.DEPARTURE,
            waybill_photo_artifact_id=await _make_artifact(db_session, trip.id), seal_number="AB-2222",
            seal_photo_artifact_id=await _make_artifact(db_session, trip.id),
            guard_verified_seal=True, idempotency_key=str(uuid.uuid4()),
        ),
    )
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit_2"].id, payload=_arrival_payload(),
    )
    # BEFORE advance_unloading, not after: UNLOADING at stop2 now gates on this
    # consignment's IN-direction scan session there (phase_gate.GATED_PHASES).
    await _stage_and_ingest(
        db_session, feed, consignment_reference=consignment.parcel_perfect_reference,
        stop_id=stop2.id, direction=ScanDirection.IN, trip_id=trip.id, barcodes=barcodes,
    )

    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-2222",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    return {
        "trip": trip, "driver": driver,
        "confirmation_event": phases["confirmation"],
        "pod_photo_id": await _make_artifact(db_session, trip.id),
        "pod_signature_id": await _make_artifact(db_session, trip.id),
    }


async def test_confirmation_derives_scan_in_count_from_parcels(
    db_session, store, ready_to_confirm,
):
    """The count comes from the warehouse, not from the driver's own number echoed
    back — which is what made the old three-way check circular."""
    await phase_service.advance_confirmation(
        db_session,
        trip_id=ready_to_confirm["trip"].id,
        driver_id=ready_to_confirm["driver"].id,
        phase_event_id=ready_to_confirm["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=ready_to_confirm["pod_photo_id"],
            pod_signature_artifact_id=ready_to_confirm["pod_signature_id"],
            driver_visual_count=1,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(PhaseEvent, ready_to_confirm["confirmation_event"].id)
    assert event.parcel_count_destination == 3
    # The driver's pallet count is recorded, never compared against a parcel count.
    assert event.driver_visual_count == 1


async def test_confirmation_raises_nothing_when_both_scans_agree(
    db_session, store, ready_to_confirm,
):
    await phase_service.advance_confirmation(
        db_session,
        trip_id=ready_to_confirm["trip"].id,
        driver_id=ready_to_confirm["driver"].id,
        phase_event_id=ready_to_confirm["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=ready_to_confirm["pod_photo_id"],
            pod_signature_artifact_id=ready_to_confirm["pod_signature_id"],
            driver_visual_count=1,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    exceptions = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == ready_to_confirm["trip"].id,
            TripException.exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH,
        )
    )).scalars().all()
    assert exceptions == []


async def test_a_parcel_lost_in_transit_raises_a_scoped_mismatch(
    db_session, store, ready_to_confirm_short,
):
    """3 scanned out at origin, 2 scanned in at destination. This is the theft case,
    and it is the single most important assertion in this plan."""
    result = await phase_service.advance_confirmation(
        db_session,
        trip_id=ready_to_confirm_short["trip"].id,
        driver_id=ready_to_confirm_short["driver"].id,
        phase_event_id=ready_to_confirm_short["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=ready_to_confirm_short["pod_photo_id"],
            pod_signature_artifact_id=ready_to_confirm_short["pod_signature_id"],
            driver_visual_count=1,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    exception = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == ready_to_confirm_short["trip"].id,
            TripException.exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH,
        )
    )).scalar_one()
    assert exception.consignment_id == ready_to_confirm_short["consignment"].id
    assert exception.trip_stop_id == ready_to_confirm_short["delivery_stop"].id
    assert "3" in exception.description and "2" in exception.description

    # Task 7 deleted test_advance_confirmation_count_mismatch_creates_exception_but_
    # still_closes, leaving "a mismatch records an exception but still lets the trip
    # close" for task 8 to reintroduce (see the comment above
    # test_advance_confirmation_matching_counts_closes_trip). Asserted here rather
    # than in a sibling test — this fixture is already the mismatch case.
    confirmation_row = next(h for h in result.phases if h.id == ready_to_confirm_short["confirmation_event"].id)
    assert confirmation_row.status == PhaseStatus.EXCEPTION
    assert result.status == TripStatus.CLOSED


async def test_crossdock_reconciles_against_the_pickup_stop_not_the_preceding_leg(
    db_session, store, xdock_ready_to_confirm,
):
    """A consignment picked up at stop 1 and delivered at stop 3 must compare against
    STOP 1's scan-out. A leg-based lookup finds stop 2's loading row instead and
    manufactures a mismatch on a healthy trip — on FP-DEMO-XDOCK-0001, the trip a
    reviewer is walked through."""
    result = await phase_service.advance_confirmation(
        db_session,
        trip_id=xdock_ready_to_confirm["trip"].id,
        driver_id=xdock_ready_to_confirm["driver"].id,
        phase_event_id=xdock_ready_to_confirm["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=xdock_ready_to_confirm["pod_photo_id"],
            pod_signature_artifact_id=xdock_ready_to_confirm["pod_signature_id"],
            driver_visual_count=2,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    exceptions = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == xdock_ready_to_confirm["trip"].id,
            TripException.exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH,
        )
    )).scalars().all()
    assert exceptions == []
    confirmation_row = next(h for h in result.phases if h.id == xdock_ready_to_confirm["confirmation_event"].id)
    assert confirmation_row.status == PhaseStatus.COMPLETED


async def test_a_stop_with_no_consignments_skips_reconciliation(
    db_session, store, empty_leg_ready_to_confirm,
):
    """No manifest baseline means nothing to compare — never 'compare against nothing
    and manufacture a mismatch'."""
    await phase_service.advance_confirmation(
        db_session,
        trip_id=empty_leg_ready_to_confirm["trip"].id,
        driver_id=empty_leg_ready_to_confirm["driver"].id,
        phase_event_id=empty_leg_ready_to_confirm["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=empty_leg_ready_to_confirm["pod_photo_id"],
            pod_signature_artifact_id=empty_leg_ready_to_confirm["pod_signature_id"],
            driver_visual_count=0,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(
        PhaseEvent, empty_leg_ready_to_confirm["confirmation_event"].id,
    )
    assert event.status == PhaseStatus.COMPLETED


# ── driver_visual_count becomes optional at confirmation ───────────────────
#
# The driver may now skip the pallet count at confirmation (matching loading's
# own Optional field). It has never fed the scan-out/scan-in mismatch verdict
# (counts.scanned_out != counts.scanned_in, computed above with no reference to
# driver_visual_count at all) — these tests prove that stays true with the count
# absent, and that a NULL count still anchors to a stable, reproducible hash.

async def test_confirmation_with_no_driver_visual_count_completes_and_stores_null(
    db_session, store, ready_to_confirm,
):
    result = await phase_service.advance_confirmation(
        db_session,
        trip_id=ready_to_confirm["trip"].id,
        driver_id=ready_to_confirm["driver"].id,
        phase_event_id=ready_to_confirm["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=ready_to_confirm["pod_photo_id"],
            pod_signature_artifact_id=ready_to_confirm["pod_signature_id"],
            driver_visual_count=None,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(PhaseEvent, ready_to_confirm["confirmation_event"].id)
    confirmation_row = next(h for h in result.phases if h.id == event.id)
    assert confirmation_row.status == PhaseStatus.COMPLETED
    assert event.driver_visual_count is None
    # A stable, non-empty hash — the None count did not stop the row from anchoring.
    assert event.event_hash is not None

    # Reproducible: hashing the canonical payload again from the stored fields
    # (exactly what verification_service._reconstruct_phase_event_payload does)
    # must land on the SAME hash — the None key stayed present, not omitted.
    expected_payload = phase_service.compute_confirmation_canonical_payload(
        phase_event_id=event.id, trip_id=ready_to_confirm["trip"].id,
        pp_scan_in_count=event.parcel_count_destination,
        driver_visual_count=event.driver_visual_count,
    )
    assert expected_payload["driver_visual_count"] is None
    assert "driver_visual_count" in expected_payload  # present, never omitted
    assert compute_payload_hash(expected_payload) == event.event_hash


async def test_a_parcel_lost_in_transit_raises_a_scoped_mismatch_with_no_visual_count(
    db_session, store, ready_to_confirm_short,
):
    """The three-way mismatch verdict is unchanged when driver_visual_count is
    absent — it has only ever compared scanned_out to scanned_in."""
    result = await phase_service.advance_confirmation(
        db_session,
        trip_id=ready_to_confirm_short["trip"].id,
        driver_id=ready_to_confirm_short["driver"].id,
        phase_event_id=ready_to_confirm_short["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=ready_to_confirm_short["pod_photo_id"],
            pod_signature_artifact_id=ready_to_confirm_short["pod_signature_id"],
            driver_visual_count=None,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    exception = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == ready_to_confirm_short["trip"].id,
            TripException.exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH,
        )
    )).scalar_one()
    assert exception.consignment_id == ready_to_confirm_short["consignment"].id
    assert "3" in exception.description and "2" in exception.description

    confirmation_row = next(
        h for h in result.phases if h.id == ready_to_confirm_short["confirmation_event"].id
    )
    assert confirmation_row.status == PhaseStatus.EXCEPTION
    assert result.status == TripStatus.CLOSED

    event = await db_session.get(PhaseEvent, ready_to_confirm_short["confirmation_event"].id)
    assert event.driver_visual_count is None


# ── current_phase_event: ledger placement for things that happen OUTSIDE a phase ──
# Driver-raised exceptions (panic, breakdown, seal broken on the road) have no phase
# event in hand the way advance_* does, so they resolve their placement through this
# helper. Its answer is written onto the exception row once, at creation, and never
# re-derived — the dispatcher used to infer placement at render time and an exception
# appeared to walk forward through the timeline as the trip advanced.


@pytest.mark.asyncio
async def test_current_phase_event_returns_lowest_unresolved_row(db_session, trip_fixture):
    trip, _driver, phases = trip_fixture

    event = await current_phase_event(db_session, trip.id)

    # trip_creation is COMPLETED in the fixture, so activation is the trip's position.
    assert event is not None
    assert event.id == phases["activation"].id


@pytest.mark.asyncio
async def test_current_phase_event_returns_in_transit_during_the_drive(db_session, trip_fixture):
    """The case the whole change exists for. in_transit is held PENDING for the entire
    drive, so a panic pressed on the road must resolve to that row — not to unloading,
    which is where a "what does the driver do next" walk would land."""
    trip, _driver, phases = trip_fixture
    for name in ("activation", "loading", "departure"):
        phases[name].status = PhaseStatus.COMPLETED
    await db_session.flush()

    event = await current_phase_event(db_session, trip.id)

    assert event is not None
    assert event.id == phases["in_transit"].id
    assert event.phase_type == PhaseType.IN_TRANSIT
    # Carries the stop it departs FROM — what the exception copies into trip_stop_id.
    assert event.trip_stop_id == phases["departure"].trip_stop_id


@pytest.mark.asyncio
async def test_current_phase_event_falls_back_to_last_row_when_all_resolved(db_session, trip_fixture):
    """A closed trip has nothing unresolved, and confirmation is genuinely where it
    sits — placement, not a guess. Returning None here would push the exception back
    onto the dispatcher's render-time inference, which is what this replaces."""
    trip, _driver, phases = trip_fixture
    for phase in phases.values():
        phase.status = PhaseStatus.COMPLETED
    await db_session.flush()

    event = await current_phase_event(db_session, trip.id)

    assert event is not None
    assert event.id == phases["confirmation"].id


@pytest.mark.asyncio
async def test_current_phase_event_picks_the_leg_being_driven_on_a_cross_dock(
    db_session, cross_dock_trip_fixture,
):
    """An 11-row plan carries TWO in_transit rows. Resolution is by sequence_number, so
    the second leg's drive must resolve to in_transit_2 — a phase_type match alone would
    return leg 1's row and file the exception against the wrong leg of the route."""
    trip, _driver, phases = cross_dock_trip_fixture
    for name in (
        "activation", "loading_1", "departure_1", "in_transit_1",
        "unloading_1", "loading_2", "departure_2",
    ):
        phases[name].status = PhaseStatus.COMPLETED
    await db_session.flush()

    event = await current_phase_event(db_session, trip.id)

    assert event is not None
    assert event.id == phases["in_transit_2"].id
    assert event.id != phases["in_transit_1"].id


@pytest.mark.asyncio
async def test_current_phase_event_returns_none_for_a_trip_with_no_plan(db_session, trip_fixture):
    trip, _driver, phases = trip_fixture
    for phase in phases.values():
        await db_session.delete(phase)
    await db_session.flush()

    assert await current_phase_event(db_session, trip.id) is None
