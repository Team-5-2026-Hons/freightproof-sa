"""Emit tests — every orchestration write path enqueues the right realtime event
onto the request's outbox.

Two families live here. The lifecycle emits (phase completed, trip closed, exception
raised) came with Stage 3. The system-detected emits below are FP-147: the six sites
that write a TripException without a driver asking them to, which until now changed the
dispatcher's data with nothing telling the dispatcher's screen.

The kind is never asserted against a hard-coded constant per site — it is derived from
the severity the row is written with (kind_for_severity), so these tests pin the mapping
rather than a duplicate of the branch that produced it.

DB-backed (uses the rolled-back db_session), no Hedera and no Redis: _finish_phase and
raise_exception neither anchor nor publish — publishing is the after_commit hook's job,
which these assert by reading the outbox left on the session (session.info), exactly the
list the hook would drain on commit. The discard-on-rollback half of D9 is covered in
tests/unit/test_realtime.py.
"""

import pathlib
import re
import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select

from app.core.realtime import EventSeverity, RealtimeKind, event_severity
from app.blockchain.hedera import HederaReceipt
from app.db.models.enums import (
    ArtifactType,
    ExceptionSeverity,
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    ParcelStatus,
    PhaseStatus,
    PhaseType,
    TripStatus,
    VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import MockScanFeed, ScanDirection
from app.orchestration import scan_service
from app.orchestration.exception_service import raise_exception
from app.orchestration.phase_service import (
    _finish_phase,
    advance_confirmation,
    advance_loading,
    advance_unloading,
    override_phase,
)
from app.orchestration.trip_service import cancel_trip
from app.schemas.phases import (
    ConfirmationCompleteRequest,
    LoadingCompleteRequest,
    UnloadingCompleteRequest,
)
from tests.conftest import FakeMockStateStore

_OUTBOX_KEY = "realtime_outbox"

# The full single-leg plan, in sequence order — mirrors what create_trip writes.
_PLAN = [
    ("trip_creation", PhaseType.TRIP_CREATION, 0, None),
    ("activation", PhaseType.ACTIVATION, 1, 0),
    ("loading", PhaseType.LOADING, 2, 0),
    ("departure", PhaseType.DEPARTURE, 3, 0),
    ("in_transit", PhaseType.IN_TRANSIT, 4, 0),
    ("unloading", PhaseType.UNLOADING, 5, 1),
    ("confirmation", PhaseType.CONFIRMATION, 6, 1),
]


async def _seed_trip(db_session, *, suffix: str = "1") -> tuple[Trip, Driver, dict[str, PhaseEvent]]:
    """Seed one single-leg trip + its full pending phase plan (trip_creation completed).

    `suffix` distinguishes trip_reference/order_number/user email (all unique
    columns) when a single test needs more than one independently-seeded trip.
    """
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"d-{suffix}@test.co.za", full_name="D")
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
        id=uuid.uuid4(), trip_reference=f"FP-EMIT-{suffix}", order_number=f"ORD-EMIT-{suffix}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stops = {
        0: TripStop(trip_id=trip.id, precinct_id=origin.id, sequence=0),
        1: TripStop(trip_id=trip.id, precinct_id=dest.id, sequence=1),
    }
    db_session.add_all(stops.values())
    await db_session.flush()

    phases: dict[str, PhaseEvent] = {}
    for name, ptype, seq, stop_seq in _PLAN:
        phases[name] = PhaseEvent(
            trip_id=trip.id, phase_type=ptype, sequence_number=seq,
            trip_stop_id=None if stop_seq is None else stops[stop_seq].id,
            status=PhaseStatus.COMPLETED if name == "trip_creation" else PhaseStatus.PENDING,
        )
    db_session.add_all(phases.values())
    await db_session.flush()

    return trip, driver, phases


def _outbox(db_session) -> list:
    return db_session.info.get(_OUTBOX_KEY, [])


async def test_finishing_a_non_final_phase_enqueues_phase_completed(db_session):
    trip, _driver, phases = await _seed_trip(db_session)
    # Activation done, everything after it still pending → the trip stays open.
    phases["activation"].status = PhaseStatus.COMPLETED
    await db_session.flush()

    await _finish_phase(
        db_session, trip=trip, event=phases["activation"], idempotency_key=str(uuid.uuid4()),
    )

    outbox = _outbox(db_session)
    assert len(outbox) == 1
    org_id, event = outbox[0]
    assert org_id == trip.operator_organization_id
    assert event.kind == RealtimeKind.PHASE_COMPLETED
    assert event.id == trip.id
    assert event.resource == "trip"


async def test_finishing_the_last_phase_enqueues_trip_closed(db_session):
    trip, _driver, phases = await _seed_trip(db_session)
    # Every phase resolved → recompute_position closes the trip, so the ping is trip_closed.
    for phase in phases.values():
        phase.status = PhaseStatus.COMPLETED
    await db_session.flush()

    await _finish_phase(
        db_session, trip=trip, event=phases["confirmation"], idempotency_key=str(uuid.uuid4()),
    )

    assert trip.status == TripStatus.CLOSED  # guards the branch's precondition
    outbox = _outbox(db_session)
    assert len(outbox) == 1
    org_id, event = outbox[0]
    assert org_id == trip.operator_organization_id
    assert event.kind == RealtimeKind.TRIP_CLOSED
    assert event.id == trip.id


async def test_raising_an_exception_enqueues_exception_raised(db_session):
    trip, driver, _phases = await _seed_trip(db_session)

    await raise_exception(
        db_session, trip_id=trip.id, driver_id=driver.id,
        exception_type=ExceptionType.PANIC_BUTTON, description="Hijack in progress",
        supporting_artifact_id=None,
    )

    outbox = _outbox(db_session)
    assert len(outbox) == 1
    org_id, event = outbox[0]
    assert org_id == trip.operator_organization_id
    assert event.kind == RealtimeKind.EXCEPTION_RAISED
    assert event.id == trip.id


@pytest.mark.parametrize(
    ("exception_type", "expected"),
    [
        (ExceptionType.PANIC_BUTTON, EventSeverity.CRITICAL),
        (ExceptionType.SEAL_BROKEN_IN_TRANSIT, EventSeverity.CRITICAL),
        (ExceptionType.CARGO_DAMAGE, EventSeverity.WARNING),
    ],
)
async def test_driver_raised_exceptions_carry_their_own_severity(
    db_session, exception_type, expected,
):
    """Regression: a driver-raised exception must be as loud as what it is.

    exception_service used to publish a fixed kind with no severity at all, while the
    system-detected sites promoted their CRITICAL rows. The result was inverted — a
    panic button pressed during a hijacking reached the dispatcher quieter than an
    automated parcel-count mismatch. The severity now comes off the same binding that
    writes the row (_CRITICAL_TYPES decides both), so the two cannot diverge again.
    """
    trip, driver, _phases = await _seed_trip(db_session, suffix=f"sev-{exception_type.value}")

    await raise_exception(
        db_session, trip_id=trip.id, driver_id=driver.id,
        exception_type=exception_type, description="raised by the driver",
        supporting_artifact_id=None,
    )

    assert _severities(db_session) == [expected]


async def test_a_hijacking_is_never_quieter_than_a_count_check(db_session):
    """The inversion stated as the comparison that exposed it. Two exceptions, one
    session, and the driver's panic must not rank below the warehouse's arithmetic."""
    trip, driver, phases = await _seed_trip(db_session, suffix="panic-vs-count")

    await raise_exception(
        db_session, trip_id=trip.id, driver_id=driver.id,
        exception_type=ExceptionType.PANIC_BUTTON, description="Hijack in progress",
        supporting_artifact_id=None,
    )
    panic_severity = _severities(db_session)[0]
    db_session.info.pop(_OUTBOX_KEY, None)

    stop = (await db_session.execute(
        select(TripStop).where(TripStop.trip_id == trip.id, TripStop.sequence == 0)
    )).scalar_one()
    consignment = await _seed_manifest(db_session, trip, stop, reference="WAY-EMIT-005")
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=consignment.parcel_perfect_reference,
        stop_reference=str(stop.id), direction=ScanDirection.OUT,
        barcodes=_BARCODES[:2],
    )
    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop.id, direction=ScanDirection.OUT,
    )
    count_severity = _severities(db_session)[0]

    assert panic_severity == EventSeverity.CRITICAL
    assert count_severity == EventSeverity.WARNING


async def test_cancel_and_override_enqueue_a_realtime_event(db_session):
    """Task 6.1 / D9: neither of the two lifecycle exits may leave a dispatcher's
    screen stale until a manual reload. override -> PHASE_COMPLETED (the plan
    position moved); cancel -> TRIP_CLOSED (terminal, drop from Active)."""
    trip, _driver, phases = await _seed_trip(db_session, suffix="override")
    # dispatcher_override_user_id is a real FK to users — a bare uuid4() would
    # violate it, unlike operator_organization_id/driver_id above which are read
    # straight off the already-seeded trip/phase rows.
    dispatcher = User(
        id=uuid.uuid4(), organization_id=trip.operator_organization_id,
        email="override-dispatcher@test.co.za", full_name="Override Dispatcher",
    )
    db_session.add(dispatcher)
    await db_session.flush()

    await override_phase(
        db_session, trip_id=trip.id, phase_event_id=phases["activation"].id,
        operator_organization_id=trip.operator_organization_id,
        user_id=dispatcher.id, note="driver's phone was wiped, cannot complete activation",
    )

    override_outbox = _outbox(db_session)
    assert len(override_outbox) == 1
    org_id, event = override_outbox[0]
    assert org_id == trip.operator_organization_id
    assert event.kind == RealtimeKind.PHASE_COMPLETED
    assert event.id == trip.id

    # Pop, not read (mirrors the real after_commit drain) — a second lifecycle
    # action in the same session must not be judged against the first one's ping.
    db_session.info.pop(_OUTBOX_KEY, None)

    trip2, _driver2, _phases2 = await _seed_trip(db_session, suffix="cancel")

    await cancel_trip(
        db_session, trip_id=trip2.id, operator_organization_id=trip2.operator_organization_id,
        user_id=trip2.created_by_user_id, note="cargo pulled, trip abandoned",
    )

    cancel_outbox = _outbox(db_session)
    assert len(cancel_outbox) == 1
    org_id2, event2 = cancel_outbox[0]
    assert org_id2 == trip2.operator_organization_id
    assert event2.kind == RealtimeKind.TRIP_CLOSED
    assert event2.id == trip2.id


# ── FP-147: system-detected exceptions ───────────────────────────────────────
#
# Site inventory (grep "TripException(" app/orchestration/ — note that scan_service
# assigns before adding, so a "db.add(TripException(" grep misses it):
#
#   phase_service  advance_departure     departure seal mismatch    CRITICAL
#   phase_service  advance_unloading     seal continuity            WARNING|CRITICAL
#   phase_service  advance_unloading     destination seal mismatch  CRITICAL
#   phase_service  advance_confirmation  waybill count mismatch     WARNING
#   phase_service  advance_loading       scan shortfall backstop    WARNING
#   scan_service   ingest_scans          scan discrepancy           WARNING
#
# advance_departure's site has no test here, and deliberately. Both of its entry
# conditions are dead from any current client: the driver app sends neither
# seal_number_confirmed nor guard_verified_seal (driver-pwa/lib/api/phases.ts:50),
# the guard re-entry step having been removed on 2026-08-05. The fields survive only
# so an offline-queued departure from an older build can replay instead of 422-ing
# forever. Contorting a test to drive a path no client can reach would test the
# contortion, not the behaviour.


async def _make_artifact(db_session, trip_id) -> uuid.UUID:
    """A real EvidenceArtifact row — phase_events FK-references this table, so the
    unloading payload's mandatory gate photo cannot be a bare uuid4()."""
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg", captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    return artifact.id


async def _ready_for_unloading(
    db_session, phases: dict[str, PhaseEvent], *,
    departure_seal: str | None, departure_status: PhaseStatus = PhaseStatus.COMPLETED,
) -> None:
    """Resolve everything up to unloading and set the seal the departure recorded.

    Statuses are set directly rather than driven through advance_activation..
    advance_in_transit: this module tests what reaches the outbox, and a five-call
    chain would put four unrelated PHASE_COMPLETED events in front of the one
    assertion that matters. _seed_trip already fabricates the plan the same way.

    `departure_seal=None` with a COMPLETED departure is the data-integrity anomaly
    advance_unloading treats as CRITICAL; with OVERRIDDEN it is the authorised
    absence it treats as a WARNING.
    """
    for name in ("activation", "loading", "in_transit"):
        phases[name].status = PhaseStatus.COMPLETED
    phases["departure"].status = departure_status
    phases["departure"].seal_number = departure_seal
    await db_session.flush()


async def _unload(db_session, trip, driver, phases, *, seal_at_destination: str):
    return await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING,
            seal_number_at_destination=seal_at_destination,
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )


def _kinds(db_session) -> list[RealtimeKind]:
    return [event.kind for _org_id, event in _outbox(db_session)]


def _severities(db_session) -> list[EventSeverity]:
    return [event.severity for _org_id, event in _outbox(db_session)]


@pytest.mark.parametrize(
    ("severity", "expected"),
    [
        (ExceptionSeverity.CRITICAL, EventSeverity.CRITICAL),
        (ExceptionSeverity.WARNING, EventSeverity.WARNING),
        (ExceptionSeverity.INFO, EventSeverity.INFO),
    ],
)
def test_event_severity_carries_the_band_through(severity, expected):
    """The stored band reaches the wire unchanged. Pinned once so the eight call sites
    can assert behaviour instead of each re-testing the mapping."""
    assert event_severity(severity) is expected


def test_every_realtime_kind_names_a_change_not_a_loudness():
    """Guards the split EventSeverity's own docstring exists to explain.

    A kind names WHAT changed; severity says how much it matters. Re-adding something
    like `tamper_detected` to RealtimeKind would fold loudness back into the kind and
    re-open the inversion that once left a panic button quieter than a parcel-count
    check, so the membership is pinned rather than left to reviewer memory.
    """
    assert {k.value for k in RealtimeKind} == {
        "trip_created", "phase_completed", "exception_raised", "trip_closed",
    }


async def test_destination_seal_mismatch_enqueues_critical_severity(db_session):
    """The demo site. A seal that changed between departure and destination is the
    platform's core claim, and it must reach the dispatcher without a reload."""
    trip, driver, phases = await _seed_trip(db_session, suffix="dest-mismatch")
    await _ready_for_unloading(db_session, phases, departure_seal="AB-1234")

    await _unload(db_session, trip, driver, phases, seal_at_destination="ZZ-9999")

    assert phases["unloading"].status == PhaseStatus.EXCEPTION  # the branch really ran
    outbox = _outbox(db_session)
    org_id, event = outbox[0]
    assert org_id == trip.operator_organization_id
    assert event.id == trip.id
    assert event.severity == EventSeverity.CRITICAL
    # _finish_phase's own PHASE_COMPLETED rides along. Accepted and asserted rather
    # than suppressed: hiding a completion to keep the outbox tidy would be a lie
    # about what the trip did. It rides as INFO — progress, not an alarm.
    assert _kinds(db_session) == [RealtimeKind.EXCEPTION_RAISED, RealtimeKind.PHASE_COMPLETED]
    assert _severities(db_session) == [EventSeverity.CRITICAL, EventSeverity.INFO]


async def test_unverifiable_seal_chain_enqueues_critical_severity(db_session):
    """A COMPLETED departure that recorded no seal is unexplained: nothing legitimate
    produces it, so it is CRITICAL and must be as loud as an outright mismatch."""
    trip, driver, phases = await _seed_trip(db_session, suffix="seal-unverified")
    await _ready_for_unloading(db_session, phases, departure_seal=None)

    await _unload(db_session, trip, driver, phases, seal_at_destination="AB-1234")

    raised = (await db_session.execute(
        select(TripException).where(TripException.trip_id == trip.id)
    )).scalars().all()
    assert [e.exception_type for e in raised] == [ExceptionType.SEAL_UNVERIFIED]
    assert raised[0].severity == ExceptionSeverity.CRITICAL
    assert _severities(db_session)[0] == EventSeverity.CRITICAL


async def test_overridden_departure_downgrades_the_same_site_to_exception_raised(db_session):
    """Same code path, same exception type, quieter kind — because a dispatcher
    override explains the missing seal and is already on the ledger as its own note.

    This is the case that makes deriving the kind from severity load-bearing rather
    than tidy: a constant per call site would shout CRITICAL at an authorised action,
    and the dispatcher would learn to dismiss the alert that matters.
    """
    trip, driver, phases = await _seed_trip(db_session, suffix="seal-overridden")
    await _ready_for_unloading(
        db_session, phases, departure_seal=None, departure_status=PhaseStatus.OVERRIDDEN,
    )

    await _unload(db_session, trip, driver, phases, seal_at_destination="AB-1234")

    raised = (await db_session.execute(
        select(TripException).where(TripException.trip_id == trip.id)
    )).scalars().all()
    assert raised[0].severity == ExceptionSeverity.WARNING
    assert _severities(db_session)[0] == EventSeverity.WARNING
    assert EventSeverity.CRITICAL not in _severities(db_session)


async def test_matching_seals_enqueue_no_exception_event(db_session):
    """The control. Without it these tests would still pass if every unloading emitted
    a tamper signal regardless of the seals."""
    trip, driver, phases = await _seed_trip(db_session, suffix="seal-match")
    await _ready_for_unloading(db_session, phases, departure_seal="AB-1234")

    await _unload(db_session, trip, driver, phases, seal_at_destination="ab-1234")  # case-normalised

    assert phases["unloading"].status == PhaseStatus.COMPLETED
    assert _kinds(db_session) == [RealtimeKind.PHASE_COMPLETED]


# ── Sites that need a manifest: the scan-backed three ─────────────────────────


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    """Dict-backed scan-feed state, so the gate and the feed never reach Redis.
    Injected locally rather than in conftest — which module gets monkeypatched is
    the part each test module should keep saying out loud (conftest.py:235)."""
    fake = FakeMockStateStore()
    monkeypatch.setattr(scan_feed_module, "get_mock_state_store", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
def stub_hedera_service(monkeypatch):
    """advance_loading and advance_confirmation anchor through anchor_subject(), which
    constructs its own HederaService. These tests use a real (rolled-back) session but
    must never touch the Hedera SDK, so the wrapper is patched at the import boundary
    anchor_service reaches it through — the same seam test_phase_service.py uses.

    Autouse and harmless to the seal tests above: unloading does not anchor at all.
    """
    mock_cls = MagicMock()
    mock_cls.return_value.submit_hash.return_value = HederaReceipt(
        topic_id="0.0.12345", sequence_number=1,
        consensus_timestamp="1715865600.000000000",
        transaction_id="0.0.12345@1715865600.000000000",
    )
    monkeypatch.setattr("app.blockchain.anchor_service.HederaService", mock_cls)
    return mock_cls


_BARCODES = ["EMITSCAN001", "EMITSCAN002", "EMITSCAN003"]


async def _seed_manifest(db_session, trip, stop, *, reference: str) -> Consignment:
    """One waybill of three parcels, picked up and delivered at the same stop.

    pickup_stop_id and delivery_stop_id are both set: phase_gate skips a consignment
    whose relevant stop is NULL, so leaving either off would silently disable the very
    gate these tests need to pass through.
    """
    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=reference,
        parcel_count_expected=len(_BARCODES),
        pickup_stop_id=stop.id, delivery_stop_id=stop.id,
    )
    db_session.add(consignment)
    await db_session.flush()
    db_session.add_all([
        Parcel(id=uuid.uuid4(), consignment_id=consignment.id,
               barcode=barcode, status=ParcelStatus.PENDING)
        for barcode in _BARCODES
    ])
    await db_session.flush()
    return consignment


async def _close_session(feed, consignment, stop, direction) -> None:
    await feed.close_session(
        consignment_reference=consignment.parcel_perfect_reference,
        stop_reference=str(stop.id), direction=direction,
    )


async def test_scan_discrepancy_at_ingest_enqueues_exception_raised(db_session, store):
    """scan_service writes this one without any driver acting — the warehouse feed is
    the actor. Before FP-147 it changed the dispatcher's exception list with nothing
    telling the dispatcher's browser to go and look."""
    trip, _driver, _phases = await _seed_trip(db_session, suffix="ingest")
    stop = (await db_session.execute(
        select(TripStop).where(TripStop.trip_id == trip.id, TripStop.sequence == 0)
    )).scalar_one()
    consignment = await _seed_manifest(db_session, trip, stop, reference="WAY-EMIT-001")

    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=consignment.parcel_perfect_reference,
        stop_reference=str(stop.id), direction=ScanDirection.OUT,
        barcodes=_BARCODES[:2],  # one parcel never scanned
    )

    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop.id, direction=ScanDirection.OUT,
    )

    org_id, event = _outbox(db_session)[0]
    assert org_id == trip.operator_organization_id
    assert event.id == trip.id
    # WARNING, not CRITICAL: a short scan is a discrepancy to work through, not a
    # tamper signal, and must not compete with one for the dispatcher's attention.
    assert _kinds(db_session) == [RealtimeKind.EXCEPTION_RAISED]
    assert _severities(db_session) == [EventSeverity.WARNING]


async def test_repeat_ingest_of_an_unchanged_feed_enqueues_nothing(db_session, store):
    """The suppression half. A poll against an unchanged feed raises no new row, so it
    must raise no new event either — otherwise the dispatcher gets a toast per poll for
    a discrepancy they have already seen, which is how a live channel trains people to
    ignore it."""
    trip, _driver, _phases = await _seed_trip(db_session, suffix="ingest-twice")
    stop = (await db_session.execute(
        select(TripStop).where(TripStop.trip_id == trip.id, TripStop.sequence == 0)
    )).scalar_one()
    consignment = await _seed_manifest(db_session, trip, stop, reference="WAY-EMIT-002")

    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=consignment.parcel_perfect_reference,
        stop_reference=str(stop.id), direction=ScanDirection.OUT,
        barcodes=_BARCODES[:2],
    )
    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop.id, direction=ScanDirection.OUT,
    )
    db_session.info.pop(_OUTBOX_KEY, None)  # drain, as after_commit would

    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop.id, direction=ScanDirection.OUT,
    )

    assert _kinds(db_session) == []


async def test_loading_shortfall_backstop_enqueues_exception_raised(db_session, store):
    """The backstop advance_loading runs when the warehouse closed its session having
    scanned nothing at all — the one short count scan_service structurally cannot see,
    because its own guard needs at least one scan event to compare against."""
    trip, driver, phases = await _seed_trip(db_session, suffix="load-short")
    stop = (await db_session.execute(
        select(TripStop).where(TripStop.trip_id == trip.id, TripStop.sequence == 0)
    )).scalar_one()
    consignment = await _seed_manifest(db_session, trip, stop, reference="WAY-EMIT-003")
    phases["activation"].status = PhaseStatus.COMPLETED
    await db_session.flush()

    feed = MockScanFeed()
    # Nothing staged, then closed: the warehouse said "done" having scanned zero.
    await scan_service.ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop.id, direction=ScanDirection.OUT,
    )
    assert _kinds(db_session) == []  # scan_service really did stay silent
    await _close_session(feed, consignment, stop, ScanDirection.OUT)

    await advance_loading(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["loading"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
        ),
    )

    raised = (await db_session.execute(
        select(TripException).where(TripException.trip_id == trip.id)
    )).scalars().all()
    assert [e.exception_type for e in raised] == [ExceptionType.PARCEL_COUNT_MISMATCH]
    assert _kinds(db_session) == [RealtimeKind.EXCEPTION_RAISED, RealtimeKind.PHASE_COMPLETED]
    assert _severities(db_session) == [EventSeverity.WARNING, EventSeverity.INFO]


async def test_waybill_count_change_in_transit_enqueues_exception_raised(db_session, store):
    """Parcels that left the origin but never arrived. WARNING rather than a tamper
    signal: the count is evidence of loss, and the seal chain — which is what would
    say tampering — is checked at unloading, not here."""
    trip, driver, phases = await _seed_trip(db_session, suffix="waybill-drift")
    dest_stop = (await db_session.execute(
        select(TripStop).where(TripStop.trip_id == trip.id, TripStop.sequence == 1)
    )).scalar_one()
    consignment = await _seed_manifest(db_session, trip, dest_stop, reference="WAY-EMIT-004")

    # Stamped directly rather than driven through two ingests: this site compares
    # scanned_out against scanned_in, and the counts are what it reads. Three left
    # the origin, two arrived.
    parcels = list((await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == consignment.id).order_by(Parcel.barcode)
    )).scalars().all())
    now = datetime.now(UTC)
    for parcel in parcels:
        parcel.pp_scan_out_at = now
    for parcel in parcels[:2]:
        parcel.pp_scan_in_at = now
    for name in ("activation", "loading", "departure", "in_transit", "unloading"):
        phases[name].status = PhaseStatus.COMPLETED
    await db_session.flush()

    feed = MockScanFeed()
    await _close_session(feed, consignment, dest_stop, ScanDirection.IN)

    await advance_confirmation(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["confirmation"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=await _make_artifact(db_session, trip.id),
            pod_signature_artifact_id=await _make_artifact(db_session, trip.id),
            driver_visual_count=2,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    raised = (await db_session.execute(
        select(TripException).where(TripException.trip_id == trip.id)
    )).scalars().all()
    assert [e.exception_type for e in raised] == [ExceptionType.WAYBILL_COUNT_MISMATCH]
    # TRIP_CLOSED, not PHASE_COMPLETED: confirmation is the last phase in the plan, so
    # _finish_phase closes the trip. The discrepancy still gets its own event first.
    assert _kinds(db_session) == [RealtimeKind.EXCEPTION_RAISED, RealtimeKind.TRIP_CLOSED]
    assert _severities(db_session) == [EventSeverity.WARNING, EventSeverity.INFO]


# ── The tripwire ─────────────────────────────────────────────────────────────


def test_every_trip_exception_write_site_is_accounted_for():
    """Fail when someone adds a TripException site, so it cannot go silent unnoticed.

    FP-147 existed because six sites were added over time that wrote an exception and
    told no one — the dispatcher's data changed with nothing waking their screen. The
    emits above fix those six instances; this fixes the *class*, which is the part that
    would otherwise recur the next time someone adds a seventh.

    A SQLAlchemy flush listener was considered and rejected. Two sites (the dispatcher
    notes in phase_service.override_phase and trip_service.cancel_trip) must stay
    silent, so a blanket listener needs an opt-out list — turning "impossible to forget
    the emit" into "impossible to forget, unless you forget the opt-out", which is the
    same defect wearing a hat. It would also have to resolve the organisation during
    flush. This is cruder and catches the same mistake at the moment it is made.

    If this fails: add the enqueue (or decide the site is deliberately silent, and say
    why here), then update the count.
    """
    expected_sites = {
        # path -> (total construction sites, of which deliberately silent)
        "app/orchestration/phase_service.py": (6, 1),   # :560 dispatcher override note
        "app/orchestration/trip_service.py": (1, 1),    # :565 cancellation note
        "app/orchestration/scan_service.py": (1, 0),
        "app/orchestration/exception_service.py": (1, 0),
    }

    root = pathlib.Path(__file__).resolve().parents[2]
    actual = {
        path: len(re.findall(r"\bTripException\(", (root / path).read_text()))
        for path in expected_sites
    }

    assert actual == {path: total for path, (total, _silent) in expected_sites.items()}, (
        "A TripException write site was added or removed. Every site must either "
        "enqueue a realtime event or be recorded here as deliberately silent."
    )
