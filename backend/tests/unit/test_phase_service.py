"""Unit tests for the phase completion engine (advance_activation..advance_confirmation)."""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.blockchain.hedera import HederaReceipt
from app.core.exceptions import (
    HederaServiceError, HederaTimeoutError, PhaseSequenceError, PhaseTypeMismatchError, ResourceNotFoundError,
)
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    AnchorStatus, ArtifactType, BlockchainReceiptType, ExceptionSeverity, ExceptionType,
    PhaseStatus, PhaseType, IdvsStatus, OrganizationType, TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.orchestration.phase_plan import PlanStop, build_phase_plan
from app.orchestration.phase_service import (
    advance_activation, advance_confirmation, advance_departure, advance_loading, advance_unloading,
    complete_phase, is_before_scheduled_day, next_phase, operating_day,
)
from app.schemas.phases import (
    ActivationCompleteRequest, ConfirmationCompleteRequest, DepartureCompleteRequest,
    LoadingCompleteRequest, UnloadingCompleteRequest,
)

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
    fields off h0. The in_transit (P4) row is included for real:
    advance_departure auto-completes the immediately-following in_transit row
    as a stopgap until checkpoint-Merkle-batch wiring exists (D2 in the parent
    plan; see _auto_complete_in_transit's docstring in phase_service.py) — a
    fixture that hid this row could not prove that stopgap works.
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


async def _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234"):
    await _advance_to_departure(db_session, trip, driver, phases)
    return await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(phase_type=PhaseType.UNLOADING, seal_number_at_destination=seal, idempotency_key=str(uuid.uuid4())),
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
                driver_visual_count=42, pp_scan_in_count=42, idempotency_key=str(uuid.uuid4()),
            ),
        )


# ── advance_loading ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_advance_loading_happy_path_stores_driver_visual_count_only(db_session, trip_fixture):
    """D7/T5 (task 2.6): loading no longer carries or anchors the seal — only
    driver_visual_count. Explicit regression guard that the anchor really moved:
    event_hash/blockchain_receipt_id must stay unset on the loading row."""
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
    assert h2.driver_visual_count == 42
    assert h2.seal_number is None
    assert h2.event_hash is None
    assert h2.blockchain_receipt_id is None


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
    assert departure_first.blockchain_receipt_id == departure_second.blockchain_receipt_id
    assert stub_hedera_service.return_value.submit_hash.call_count == 1


@pytest.mark.asyncio
async def test_replayed_exception_completion_is_idempotent_no_duplicate_exception(db_session, trip_fixture):
    """Covers the branch test_replayed_completion_is_idempotent_returns_200_no_duplicate
    doesn't: a completion that resolves to EXCEPTION (not COMPLETED) must still
    be caught by the replay short-circuit (_is_resolved, not a bare COMPLETED
    check), or a resent offline-queue entry would re-execute the wrapper body
    on every resend — inserting a second duplicate TripException row and
    letting _auto_complete_in_transit stamp a fresh completed_at over the
    already-closed in_transit row."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    payload = await _h3_payload(
        db_session, trip.id, seal_number_confirmed="ZZ-9999",
        idempotency_key="offline-queue-entry-departure-1",
    )

    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id, payload=payload,
    )
    await db_session.refresh(phases["in_transit"])
    first_completed_at = phases["in_transit"].completed_at

    second = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id, payload=payload,
    )
    await db_session.refresh(phases["in_transit"])

    assert second.status == TripStatus.ACTIVE
    assert len(second.exceptions) == 1  # not duplicated by the replay

    exception_count = (await db_session.execute(
        select(func.count()).select_from(TripException).where(
            TripException.phase_event_id == phases["departure"].id,
        )
    )).scalar_one()
    assert exception_count == 1

    assert phases["in_transit"].status == PhaseStatus.COMPLETED
    assert phases["in_transit"].completed_at == first_completed_at  # not overwritten by the replay


# ── advance_departure ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_advance_departure_happy_path_completes(db_session, trip_fixture):
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
    assert departure.event_hash is not None
    assert departure.blockchain_receipt_id is not None

    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == departure.blockchain_receipt_id)
    )).scalar_one()
    assert receipt.data_hash == departure.event_hash
    assert receipt.receipt_type == BlockchainReceiptType.PICKUP


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "hedera_exception",
    [
        HederaTimeoutError("simulated Hedera timeout"),
        HederaServiceError("simulated Hedera service error"),
    ],
    ids=["timeout", "service_error"],
)
async def test_departure_anchors_fail_open_on_hedera_timeout(
    db_session, trip_fixture, monkeypatch, hedera_exception,
):
    """D7/task 2.6 — _anchor_or_fail_open is wired into advance_departure for
    the first time this task; this is the departure-side equivalent of
    test_confirmation_anchors_fail_open_on_hedera_timeout above. A Hedera
    failure must not propagate, and — unlike the OLD fail-closed loading
    anchor this replaced — must not block the phase or the trip from
    advancing: only anchor_status records the retry-owed debt."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    monkeypatch.setattr(
        "app.orchestration.phase_service.anchor_subject",
        AsyncMock(side_effect=hedera_exception),
    )

    result = await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id),
    )

    # No exception propagated, and a failed anchor doesn't block phase/trip completion.
    assert result.status == TripStatus.ACTIVE
    departure = next(h for h in result.phases if h.phase_type == PhaseType.DEPARTURE)
    assert departure.status == PhaseStatus.COMPLETED
    assert departure.blockchain_receipt_id is None
    assert departure.seal_number == "AB-1234"  # the seal is still recorded even though anchoring failed

    assert phases["departure"].anchor_status == AnchorStatus.FAILED

    # Gate is genuinely unblocked despite the failed anchor.
    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].status == PhaseStatus.COMPLETED


@pytest.mark.asyncio
async def test_advance_departure_guard_refused_creates_exception_but_departs(db_session, trip_fixture):
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
    # D7: the anchor runs regardless of the mismatch outcome.
    assert departure.blockchain_receipt_id is not None


@pytest.mark.asyncio
async def test_exception_status_phase_does_not_block_next_phase(db_session, trip_fixture):
    """Renamed/kept from the old H3-confirmed-seal-mismatch test, extended to
    prove T3's predicate: a phase left in EXCEPTION status is resolved for
    gating purposes, so the phase after it (unloading) must still be reachable
    — only trip.status == EXCEPTION_HOLD (a separate, later mismatch) actually
    blocks."""
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

    next_result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234", idempotency_key=str(uuid.uuid4())),
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
async def test_advance_departure_auto_completes_leg_in_transit_row(db_session, trip_fixture):
    """Stopgap (D2, awaiting real checkpoint-Merkle-batch wiring): advance_departure
    must auto-complete the immediately-following in_transit row, and that must
    actually unblock the gate for the phase after it — not just flip a status
    flag with no downstream effect."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure"].id,
        payload=await _h3_payload(db_session, trip.id),
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].status == PhaseStatus.COMPLETED
    assert phases["in_transit"].completed_at is not None

    # Proves the gate is genuinely unblocked, not just that a flag flipped.
    result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234", idempotency_key=str(uuid.uuid4())),
    )
    unloading = next(h for h in result.phases if h.phase_type == PhaseType.UNLOADING)
    assert unloading.status == PhaseStatus.COMPLETED


@pytest_asyncio.fixture
async def multi_leg_trip_fixture(db_session):
    """3-stop trip: stop0 loads, stop1 is a pure pass-through waypoint (no
    cargo activity there), stop2 delivers. This yields two DEPARTURE/
    IN_TRANSIT leg pairs — build_phase_plan emits that pair for every
    non-final stop regardless of cargo activity — while keeping only ONE
    LOADING row overall.

    Deliberately not a true cross-dock (two LOADING rows) — this fixture
    isolates exactly what's under test here: that _auto_complete_in_transit
    resolves the correct leg's row, and only that leg's row. T4's per-leg
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
async def test_advance_departure_auto_completes_only_its_own_leg_in_transit(db_session, multi_leg_trip_fixture):
    """Each leg's departure must resolve only its own in_transit row — leg 2's
    row must stay PENDING (unreachable) until leg 2's own departure runs."""
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

    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure_1"].id,
        payload=await _h3_payload(db_session, trip.id),
    )
    await db_session.refresh(phases["in_transit_1"])
    await db_session.refresh(phases["in_transit_2"])
    assert phases["in_transit_1"].status == PhaseStatus.COMPLETED
    assert phases["in_transit_2"].status == PhaseStatus.PENDING  # leg 2's departure hasn't run yet

    await advance_departure(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["departure_2"].id,
        payload=await _h3_payload(db_session, trip.id),
    )
    await db_session.refresh(phases["in_transit_2"])
    assert phases["in_transit_2"].status == PhaseStatus.COMPLETED

    # Gate is genuinely unblocked end to end now — both legs' in_transit rows
    # resolved independently, correctly, in order.
    result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234", idempotency_key=str(uuid.uuid4())),
    )
    unloading = next(h for h in result.phases if h.phase_type == PhaseType.UNLOADING)
    assert unloading.status == PhaseStatus.COMPLETED


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
async def test_exception_hold_status_blocks_further_advancement(db_session, trip_fixture):
    """Renamed/extended from the old H4-seal-mismatch test: the mismatch still
    holds the trip, and — new for this task — a subsequent advance_confirmation
    call must be rejected while the trip sits at EXCEPTION_HOLD."""
    trip, driver, phases = trip_fixture
    result = await _advance_to_unloading(db_session, trip, driver, phases, seal="ZZ-9999")
    assert result.status == TripStatus.EXCEPTION_HOLD
    assert len(result.exceptions) == 1
    assert result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    assert result.exceptions[0].severity == ExceptionSeverity.CRITICAL

    with pytest.raises(PhaseSequenceError):
        await advance_confirmation(
            db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
            payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
                pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
                pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
                driver_visual_count=42, pp_scan_in_count=42, idempotency_key=str(uuid.uuid4()),
            ),
        )


# ── advance_confirmation ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_advance_confirmation_matching_counts_closes_trip(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234")

    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, pp_scan_in_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )
    assert result.status == TripStatus.CLOSED
    assert result.closed_at is not None
    assert result.exceptions == []

    h5 = next(h for h in result.phases if h.phase_type == PhaseType.CONFIRMATION)
    assert h5.blockchain_receipt_id is not None

    receipt = (await db_session.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == h5.blockchain_receipt_id)
    )).scalar_one()
    assert receipt.data_hash == h5.event_hash
    assert receipt.receipt_type == BlockchainReceiptType.DELIVERY

    # anchor_status wasn't touched by any code path before task 2.5 — a successful
    # anchor must now be reflected as ANCHORED, not left at the plan generator's PENDING.
    assert phases["confirmation"].anchor_status == AnchorStatus.ANCHORED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "hedera_exception",
    [
        HederaTimeoutError("simulated Hedera timeout"),
        HederaServiceError("simulated Hedera service error"),
    ],
    ids=["timeout", "service_error"],
)
async def test_confirmation_anchors_fail_open_on_hedera_timeout(
    db_session, trip_fixture, monkeypatch, hedera_exception,
):
    """D7 (task 2.5) — a Hedera failure during advance_confirmation must not
    propagate; see test_departure_anchors_fail_open_on_hedera_timeout below
    for the equivalent proof at departure (task 2.6, where _anchor_or_fail_open
    was wired in for the first time). The phase (and, via
    recompute_position, the trip) still completes; only anchor_status records
    the retry-owed debt. Parametrized over both exception types
    _anchor_or_fail_open's except clause catches — HederaServiceError is the
    parent of HederaTimeoutError, so both branches are cheap insurance against
    someone later narrowing the caught tuple."""
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234")

    monkeypatch.setattr(
        "app.orchestration.phase_service.anchor_subject",
        AsyncMock(side_effect=hedera_exception),
    )

    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, pp_scan_in_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )

    # No exception propagated, and a failed anchor doesn't block phase/trip completion.
    assert result.status == TripStatus.CLOSED
    h5 = next(h for h in result.phases if h.phase_type == PhaseType.CONFIRMATION)
    assert h5.status == PhaseStatus.COMPLETED
    assert h5.blockchain_receipt_id is None

    assert phases["confirmation"].anchor_status == AnchorStatus.FAILED


@pytest.mark.asyncio
async def test_advance_confirmation_count_mismatch_creates_exception_but_still_closes(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234")

    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=40, pp_scan_in_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )
    assert result.status == TripStatus.CLOSED
    assert len(result.exceptions) == 1

    h5 = next(h for h in result.phases if h.phase_type == PhaseType.CONFIRMATION)
    assert h5.status == PhaseStatus.EXCEPTION
    assert h5.blockchain_receipt_id is not None  # anchored despite the mismatch — the mismatch is evidence too
    assert result.exceptions[0].exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH


@pytest.mark.asyncio
async def test_replayed_confirmation_that_closed_trip_is_idempotent_not_409(db_session, trip_fixture):
    """The count-mismatch branch sets the confirmation row to EXCEPTION and
    lets the trip close (recompute_position finds nothing unresolved left).
    A replay of that exact completion (same phase_event_id/idempotency_key)
    must still return the idempotent 200 Task 2.4 promises — not a 409 from
    the trip.status == CLOSED check, which the replay short-circuit must run
    ahead of precisely because this is the completion that caused CLOSED."""
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234")

    payload = ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
        pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
        pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
        driver_visual_count=40, pp_scan_in_count=42, idempotency_key="offline-queue-entry-confirmation-1",
    )

    first = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id, payload=payload,
    )
    assert first.status == TripStatus.CLOSED

    second = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id, payload=payload,
    )
    assert second.status == TripStatus.CLOSED
    assert len(second.exceptions) == 1  # not duplicated by the replay


@pytest.mark.asyncio
async def test_trip_closes_when_no_phases_remain(db_session, trip_fixture):
    trip, driver, phases = trip_fixture
    await _advance_to_unloading(db_session, trip, driver, phases, seal="AB-1234")

    await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, pp_scan_in_count=42, idempotency_key=str(uuid.uuid4()),
        ),
    )

    assert trip.status == TripStatus.CLOSED
    assert trip.closed_at is not None
    assert trip.current_phase is None
    assert trip.current_stop is None


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
    assert trip.current_phase == PhaseType.UNLOADING
    assert trip.current_stop == 1

    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234", idempotency_key=str(uuid.uuid4())),
    )
    assert trip.current_phase == PhaseType.CONFIRMATION
    assert trip.current_stop == 1

    await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=42, pp_scan_in_count=42, idempotency_key=str(uuid.uuid4()),
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
    [in_transit(leg1) auto-completes] -> unloading(leg1, against
    leg1_destination_seal) -> loading(leg2) -> departure(leg2, seal=AB-2222)
    -> [in_transit(leg2) auto-completes]. Stops one call short of leg2's own
    unloading — the two tests below each drive that final call themselves,
    with a different destination seal, to prove the match/mismatch outcome
    independently."""
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

    # At this point leg2's departure row already exists (created upfront by
    # the plan) but is still PENDING with seal_number=None — the old
    # trip-wide-LOADING lookup, or a naive "any departure" lookup, would
    # either crash on MultipleResultsFound or compare against None here.
    unloading_1_result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading_1"].id,
        payload=UnloadingCompleteRequest(phase_type=PhaseType.UNLOADING, 
            seal_number_at_destination=leg1_destination_seal, idempotency_key=str(uuid.uuid4()),
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

    leg2_result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading_2"].id,
        payload=UnloadingCompleteRequest(phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-2222", idempotency_key=str(uuid.uuid4())),
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

    leg2_result = await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading_2"].id,
        payload=UnloadingCompleteRequest(phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1111", idempotency_key=str(uuid.uuid4())),
    )

    unloading_2 = next(h for h in leg2_result.phases if h.id == phases["unloading_2"].id)
    assert unloading_2.status == PhaseStatus.EXCEPTION
    assert leg2_result.status == TripStatus.EXCEPTION_HOLD
    assert len(leg2_result.exceptions) == 1
    assert leg2_result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    assert leg2_result.exceptions[0].severity == ExceptionSeverity.CRITICAL


# ── S1 / NEW-9: confirmation's origin count must be leg-scoped ─────────────
#
# Stage 2's ledger recorded NEW-9: advance_confirmation resolved the origin
# baseline via a trip-wide `select(PhaseEvent).where(trip_id=, phase_type=
# LOADING).scalar_one()`. On any trip with 2+ LOADING rows — every real
# cross-dock pickup pattern, exactly like cross_dock_trip_fixture below —
# that raises MultipleResultsFound. Ciaran's decision S1 (2026-07-29) fixes
# both the crash and the semantics: the origin baseline is the nearest
# preceding LOADING row — the pickup that loaded the FINAL leg, not the
# trip's first pickup.

@pytest.mark.asyncio
async def test_confirmation_origin_count_uses_nearest_preceding_loading_not_trip_wide(
    db_session, cross_dock_trip_fixture,
):
    """NEW-9 (Stage 2 ledger) + decision S1: a trip-wide
    `(trip_id, phase_type=LOADING)` `.scalar_one()` raises
    MultipleResultsFound on this fixture's two-LOADING cross-dock trip. S1
    fixes the semantics as well as the crash — the origin baseline is the
    pickup that loaded the FINAL leg (loading_2, seq 6,
    driver_visual_count=8), not the trip's first LOADING row (loading_1,
    seq 2, driver_visual_count=12), which loaded cargo already dropped at
    the hub before this leg began.

    Submitting driver_visual_count=8, pp_scan_in_count=8 only produces a
    three-way count MATCH if origin_count correctly resolves to 8 (loading_2).
    Had it wrongly resolved to 12 (loading_1), 12 != 8 would land the row in
    EXCEPTION with a WAYBILL_COUNT_MISMATCH instead — so both the COMPLETED
    status and the absence of that specific exception are asserted, proving
    the right row was used rather than merely proving no crash occurred.
    """
    trip, driver, phases = cross_dock_trip_fixture
    await _walk_cross_dock_leg1_unloading_to_leg2_departure(
        db_session, trip, driver, phases, leg1_destination_seal="AB-1111",
    )
    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading_2"].id,
        payload=UnloadingCompleteRequest(phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-2222", idempotency_key=str(uuid.uuid4())),
    )

    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=8, pp_scan_in_count=8, idempotency_key=str(uuid.uuid4()),
        ),
    )

    confirmation = next(h for h in result.phases if h.id == phases["confirmation"].id)
    assert confirmation.status == PhaseStatus.COMPLETED
    assert not any(
        exc.exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH for exc in result.exceptions
    )
    assert result.status == TripStatus.CLOSED


@pytest.mark.asyncio
async def test_cross_dock_plan_walks_to_closed(db_session, cross_dock_trip_fixture):
    """Stage 2's ledger recorded this as its unmet "Done when": an 11-row
    cross-dock plan walks its final phase and closes the trip. It was
    blocked only by NEW-9 (advance_confirmation's trip-wide LOADING lookup
    crashing with MultipleResultsFound) until decision S1's fix. in_transit
    rows (seq 4, 8) are deliberately absent from the walk below, not omitted
    by accident: advance_departure auto-completes the immediately-following
    in_transit row as NEW-8's authorized stopgap.
    """
    trip, driver, phases = cross_dock_trip_fixture
    await _walk_cross_dock_leg1_unloading_to_leg2_departure(
        db_session, trip, driver, phases, leg1_destination_seal="AB-1111",
    )
    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["unloading_2"].id,
        payload=UnloadingCompleteRequest(phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-2222", idempotency_key=str(uuid.uuid4())),
    )

    result = await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id, phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(phase_type=PhaseType.CONFIRMATION, 
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=8, pp_scan_in_count=8, idempotency_key=str(uuid.uuid4()),
        ),
    )

    assert result.status == TripStatus.CLOSED
    assert trip.status == TripStatus.CLOSED
    assert trip.current_phase is None


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
