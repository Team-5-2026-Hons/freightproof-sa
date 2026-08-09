"""Unit tests for create_trip() consignment-loop wiring and phase-plan generation.

Most tests here are DB-free — every async call made by create_trip() is patched.
They verify that:
  - fetch_and_sync_consignment is NOT called for an empty-leg trip (no consignments)
  - fetch_and_sync_consignment IS called once per consignment, with the correct args
  - a PP failure for any consignment surfaces as PPSyncError and rolls back the session
  - create_trip writes the trip's full committed phase plan (Stage 2.1), not just H0

One exception (task 2.5): test_create_trip_anchor_failure_still_rolls_back_whole_trip
uses the real (rolled-back) db_session fixture, because it asserts on rows actually
persisted/not-persisted — a mocked session can't prove that.
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.exceptions import HederaTimeoutError, PPSyncError, ResourceNotFoundError
from app.db.models.enums import AnchorStatus, DispatcherRole, OrganizationType, PhaseStatus, PhaseType, TripStatus, TripType, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.integrations.parcel_perfect import PPWaybillNotFoundError
from app.schemas.people import UserRead
from app.schemas.trips import TripCreateRequest

_NOW = datetime(2026, 1, 1, tzinfo=UTC)


def make_user() -> UserRead:
    return UserRead(
        id=uuid.uuid4(),
        email="dispatcher@test.co.za",
        full_name="Test Dispatcher",
        organization_id=uuid.uuid4(),
        role=DispatcherRole.DISPATCHER,
        created_at=_NOW,
        updated_at=_NOW,
    )


def make_loaded_payload(**kwargs) -> TripCreateRequest:
    """A LOADED trip payload — requires at least one consignment."""
    base = dict(
        order_number="ORD-001",
        driver_id=uuid.uuid4(),
        horse_id=uuid.uuid4(),
        trailer_ids=[uuid.uuid4()],
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
        consignments=[{"pp_reference": "WAY123", "unit_count_expected": 2}],
        # Required by validate_request — a resolvable schedule at creation
        # (see TripCreateRequest.validate_request); orthogonal to the
        # consignment-loop behaviour this file exercises.
        planned_departure_at=_NOW,
    )
    base.update(kwargs)
    return TripCreateRequest(**base)


def make_empty_leg_payload(**kwargs) -> TripCreateRequest:
    """An EMPTY_LEG trip payload — must carry no consignments."""
    base = dict(
        order_number="ORD-002",
        driver_id=uuid.uuid4(),
        horse_id=uuid.uuid4(),
        trailer_ids=[uuid.uuid4()],
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
        trip_type=TripType.EMPTY_LEG,
        # See make_loaded_payload above.
        planned_departure_at=_NOW,
    )
    base.update(kwargs)
    return TripCreateRequest(**base)


def _make_db() -> AsyncMock:
    db = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.rollback = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.mark.asyncio
async def test_create_trip_empty_leg_does_not_call_sync() -> None:
    """An empty-leg trip (no consignments) must never call fetch_and_sync_consignment."""
    from app.orchestration.trip_service import create_trip

    payload = make_empty_leg_payload()
    user = make_user()
    db = _make_db()

    with (
        patch("app.orchestration.trip_service._fetch_driver", new_callable=AsyncMock) as mock_driver,
        patch("app.orchestration.trip_service._fetch_vehicle", new_callable=AsyncMock) as mock_vehicle,
        patch("app.orchestration.trip_service._check_order_number_conflict", new_callable=AsyncMock),
        patch("app.orchestration.trip_service.anchor_subject", new_callable=AsyncMock) as mock_anchor,
        patch("app.orchestration.trip_service.compute_journey_lock_hash", return_value="hash-abc"),
        # A real dict, not a placeholder — compute_payload_hash (called for real
        # on h0's inline completion) needs a JSON-serialisable payload, matching
        # compute_trip_canonical_payload's actual dict return type.
        patch("app.orchestration.trip_service.compute_trip_canonical_payload", return_value={"trip_id": "canonical"}),
        patch("app.orchestration.trip_service.get_trip_detail", new_callable=AsyncMock) as mock_detail,
        patch(
            "app.orchestration.consignment_service.fetch_and_sync_consignment",
            new_callable=AsyncMock,
        ) as mock_sync,
    ):
        mock_driver.return_value = MagicMock(id=payload.driver_id)
        mock_vehicle.return_value = MagicMock(id=payload.horse_id, pulsit_device_id="DEV-001")
        mock_anchor.return_value = MagicMock()
        mock_detail.return_value = MagicMock()

        try:
            await create_trip(db, payload, user)
        except Exception:
            # We only care that sync was not called; other mock gaps are acceptable.
            pass

        mock_sync.assert_not_called()


@pytest.mark.asyncio
async def test_create_trip_with_consignments_calls_sync() -> None:
    """A loaded trip calls fetch_and_sync_consignment once per consignment with correct args."""
    from app.orchestration.trip_service import create_trip

    payload = make_loaded_payload(
        consignments=[{"pp_reference": "WAY123", "unit_count_expected": 2}]
    )
    user = make_user()
    db = _make_db()

    with (
        patch("app.orchestration.trip_service._fetch_driver", new_callable=AsyncMock) as mock_driver,
        patch("app.orchestration.trip_service._fetch_vehicle", new_callable=AsyncMock) as mock_vehicle,
        patch("app.orchestration.trip_service._check_order_number_conflict", new_callable=AsyncMock),
        patch("app.orchestration.trip_service.anchor_subject", new_callable=AsyncMock) as mock_anchor,
        patch("app.orchestration.trip_service.compute_journey_lock_hash", return_value="hash-abc"),
        # A real dict, not a placeholder — compute_payload_hash (called for real
        # on h0's inline completion) needs a JSON-serialisable payload, matching
        # compute_trip_canonical_payload's actual dict return type.
        patch("app.orchestration.trip_service.compute_trip_canonical_payload", return_value={"trip_id": "canonical"}),
        patch("app.orchestration.trip_service.get_trip_detail", new_callable=AsyncMock) as mock_detail,
        patch(
            "app.orchestration.consignment_service.fetch_and_sync_consignment",
            new_callable=AsyncMock,
        ) as mock_sync,
    ):
        mock_driver.return_value = MagicMock(id=payload.driver_id)
        mock_vehicle.return_value = MagicMock(id=payload.horse_id, pulsit_device_id="DEV-001")
        mock_anchor.return_value = MagicMock()
        mock_detail.return_value = MagicMock()

        try:
            await create_trip(db, payload, user)
        except Exception:
            # We only care that sync was called correctly; other mock gaps are acceptable
            # (e.g. ConsignmentRead.model_validate() on the MagicMock sync result below).
            pass

        mock_sync.assert_called_once()
        call_kwargs = mock_sync.call_args.kwargs
        assert call_kwargs.get("pp_reference") == "WAY123"
        assert call_kwargs.get("unit_count_expected") == 2


@pytest.mark.asyncio
async def test_create_trip_unknown_waybill_raises_ppsync_error() -> None:
    """A PP failure for any consignment (e.g. unresolvable pp_reference) surfaces as
    PPSyncError and rolls back the session — a trip must not persist with a cargo
    plan that couldn't be pulled from PP."""
    from app.orchestration.trip_service import create_trip

    payload = make_loaded_payload(
        consignments=[{"pp_reference": "NOPE999", "unit_count_expected": 1}]
    )
    user = make_user()
    db = _make_db()

    with (
        patch("app.orchestration.trip_service._fetch_driver", new_callable=AsyncMock) as mock_driver,
        patch("app.orchestration.trip_service._fetch_vehicle", new_callable=AsyncMock) as mock_vehicle,
        patch("app.orchestration.trip_service._check_order_number_conflict", new_callable=AsyncMock),
        patch(
            "app.orchestration.consignment_service.fetch_and_sync_consignment",
            new_callable=AsyncMock,
        ) as mock_sync,
    ):
        mock_driver.return_value = MagicMock(id=payload.driver_id)
        mock_vehicle.return_value = MagicMock(id=payload.horse_id, pulsit_device_id="DEV-001")
        mock_sync.side_effect = PPWaybillNotFoundError("NOPE999")

        with pytest.raises(PPSyncError) as exc_info:
            await create_trip(db, payload, user)

        assert exc_info.value.pp_reference == "NOPE999"
        db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_trip_writes_full_pending_plan() -> None:
    """A single-leg (2-stop, 1-consignment) create_trip call writes the full
    7-row committed phase plan up front (Stage 2.1) — not just a hand-built H0.

    All 7 rows must be `pending`, ordered by sequence_number, and match
    build_phase_plan's 2-stop shape: trip_creation, activation, loading,
    departure, in_transit, unloading, confirmation.
    """
    from app.orchestration.trip_service import create_trip

    payload = make_loaded_payload()
    user = make_user()

    added: list[object] = []

    def _add(obj: object) -> None:
        added.append(obj)

    async def _flush() -> None:
        # Mimic the ORM's INSERT-time id generation for objects whose PK is
        # still unset. create_trip reads trip_stops[i].id right after the
        # first flush to stamp consignment pickup/delivery links, so those
        # ids must exist by then, same as against a real session.
        for obj in added:
            if getattr(obj, "id", None) is None and hasattr(obj, "id"):
                obj.id = uuid.uuid4()

    db = AsyncMock()
    db.add = MagicMock(side_effect=_add)
    db.flush = AsyncMock(side_effect=_flush)
    db.refresh = AsyncMock()
    db.rollback = AsyncMock()

    fake_consignment = MagicMock()
    fake_sync_result = MagicMock(consignment=fake_consignment, warning=None)

    with (
        patch("app.orchestration.trip_service._fetch_driver", new_callable=AsyncMock) as mock_driver,
        patch("app.orchestration.trip_service._fetch_vehicle", new_callable=AsyncMock) as mock_vehicle,
        patch("app.orchestration.trip_service._check_order_number_conflict", new_callable=AsyncMock),
        patch("app.orchestration.trip_service.anchor_subject", new_callable=AsyncMock) as mock_anchor,
        patch("app.orchestration.trip_service.compute_journey_lock_hash", return_value="hash-abc"),
        # A real dict, not a placeholder — compute_payload_hash (called for real
        # on h0's inline completion) needs a JSON-serialisable payload, matching
        # compute_trip_canonical_payload's actual dict return type.
        patch("app.orchestration.trip_service.compute_trip_canonical_payload", return_value={"trip_id": "canonical"}),
        patch("app.orchestration.trip_service.get_trip_detail", new_callable=AsyncMock),
        patch(
            "app.orchestration.consignment_service.fetch_and_sync_consignment",
            new_callable=AsyncMock,
            return_value=fake_sync_result,
        ),
    ):
        mock_driver.return_value = MagicMock(id=payload.driver_id)
        mock_vehicle.return_value = MagicMock(id=payload.horse_id, pulsit_device_id="DEV-001")
        mock_anchor.return_value = MagicMock()

        try:
            await create_trip(db, payload, user)
        except Exception:
            # Response assembly calls ConsignmentRead.model_validate() on the
            # MagicMock sync result, which is expected to fail (same gap noted
            # in the other tests in this file) — the phase plan is flushed to
            # the session well before response assembly runs.
            pass

    phase_events = sorted(
        (obj for obj in added if isinstance(obj, PhaseEvent)),
        key=lambda e: e.sequence_number,
    )

    assert len(phase_events) == 7
    assert [e.sequence_number for e in phase_events] == list(range(7))
    # h0 (trip_creation) is the one row create_trip completes inline, right
    # after its Hedera anchor succeeds — every other row stays PENDING until a
    # later advance_* call resolves it. Regression coverage for the h0-never-
    # completes bug (Stage 2 final review): h0 used to stay PENDING forever,
    # which _gate_and_load's "all lower sequence_numbers resolved" check turned
    # into a permanent block on every later phase.
    assert phase_events[0].status == PhaseStatus.COMPLETED
    assert all(e.status == PhaseStatus.PENDING for e in phase_events[1:])
    assert [e.phase_type for e in phase_events] == [
        PhaseType.TRIP_CREATION,
        PhaseType.ACTIVATION,
        PhaseType.LOADING,
        PhaseType.DEPARTURE,
        PhaseType.IN_TRANSIT,
        PhaseType.UNLOADING,
        PhaseType.CONFIRMATION,
    ]
    # trip_creation is the only NULL-stop row (D3); every other row anchors to
    # a real stop.
    assert phase_events[0].trip_stop_id is None
    assert all(e.trip_stop_id is not None for e in phase_events[1:])
    # D7: only trip_creation/departure/confirmation carry a Hedera receipt. h0's
    # anchor is ANCHORED (not just PENDING) because create_trip completes it
    # inline in the same step that succeeds the anchor; departure/confirmation
    # stay PENDING until their own advance_* calls run.
    assert phase_events[0].anchor_status == AnchorStatus.ANCHORED
    assert phase_events[3].anchor_status == AnchorStatus.PENDING
    assert phase_events[6].anchor_status == AnchorStatus.PENDING
    assert phase_events[1].anchor_status == AnchorStatus.NOT_REQUIRED
    assert phase_events[2].anchor_status == AnchorStatus.NOT_REQUIRED
    assert phase_events[4].anchor_status == AnchorStatus.NOT_REQUIRED
    assert phase_events[5].anchor_status == AnchorStatus.NOT_REQUIRED
    assert phase_events[0].completed_at is not None
    assert phase_events[0].event_hash is not None
    assert phase_events[0].blockchain_receipt_id is not None


def test_build_phase_events_single_leg_matches_plan() -> None:
    """_build_phase_events is a pure function (Stage 2.1 code-review extraction) —
    no session, no mocking, just plain in-memory TripStop/consignment-result
    stand-ins. Complements test_create_trip_writes_full_pending_plan above, which
    checks the same 7-row shape end-to-end through create_trip's session-mocked
    wiring; this test isolates the plan-building logic itself.
    """
    from app.orchestration.trip_service import _build_phase_events

    trip_id = uuid.uuid4()
    stop_0 = TripStop(id=uuid.uuid4(), trip_id=trip_id, precinct_id=uuid.uuid4(), sequence=0)
    stop_1 = TripStop(id=uuid.uuid4(), trip_id=trip_id, precinct_id=uuid.uuid4(), sequence=1)
    trip_stops = [stop_0, stop_1]

    # SimpleNamespace stand-ins for ConsignmentSyncResult/Consignment — the
    # function only reads .consignment.pickup_stop_id/.delivery_stop_id, so a
    # full ORM object (or a DB session) is not needed to exercise it.
    consignment = SimpleNamespace(pickup_stop_id=stop_0.id, delivery_stop_id=stop_1.id)
    consignment_results = [SimpleNamespace(consignment=consignment, warning=None)]

    phase_events = _build_phase_events(trip_id, trip_stops, consignment_results)  # type: ignore[arg-type]

    assert [e.phase_type for e in phase_events] == [
        PhaseType.TRIP_CREATION,
        PhaseType.ACTIVATION,
        PhaseType.LOADING,
        PhaseType.DEPARTURE,
        PhaseType.IN_TRANSIT,
        PhaseType.UNLOADING,
        PhaseType.CONFIRMATION,
    ]
    assert [e.sequence_number for e in phase_events] == list(range(7))
    assert all(e.trip_id == trip_id for e in phase_events)
    assert all(e.status == PhaseStatus.PENDING for e in phase_events)
    # trip_creation is the only NULL-stop row (D3); activation/loading anchor
    # to stop 0, unloading/confirmation to stop 1.
    assert phase_events[0].trip_stop_id is None
    assert phase_events[1].trip_stop_id == stop_0.id
    assert phase_events[2].trip_stop_id == stop_0.id
    assert phase_events[6].trip_stop_id == stop_1.id
    # D7: only trip_creation/departure/confirmation carry a Hedera receipt.
    assert [e.anchor_status for e in phase_events] == [
        AnchorStatus.PENDING,
        AnchorStatus.NOT_REQUIRED,
        AnchorStatus.NOT_REQUIRED,
        AnchorStatus.PENDING,
        AnchorStatus.NOT_REQUIRED,
        AnchorStatus.NOT_REQUIRED,
        AnchorStatus.PENDING,
    ]


# ── P0 fail-closed contrast (task 2.5, D7) ─────────────────────────────────────

@pytest_asyncio.fixture
async def create_trip_seed(db_session):
    """Minimal real rows an empty-leg create_trip() call needs against a real DB:
    an operator org (driver/vehicle), a principal org (precincts), a driver, a
    horse, and origin/destination precincts. TripStop.precinct_id is a non-null
    FK, so — unlike the DB-free tests above — this can't be satisfied with bare
    uuid4()s once we're asserting against a real Postgres test DB.
    """
    operator_org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([operator_org, client_org])
    await db_session.flush()

    dispatcher_user = User(
        id=uuid.uuid4(), organization_id=operator_org.id,
        email="dispatcher@test.co.za", full_name="Test Dispatcher",
    )
    db_session.add(dispatcher_user)
    await db_session.flush()

    driver = Driver(
        id=uuid.uuid4(), organization_id=operator_org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=operator_org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="Origin", principal_organization_id=client_org.id,
        latitude="0", longitude="0",
    )
    dest = Precinct(
        id=uuid.uuid4(), name="Dest", principal_organization_id=client_org.id,
        latitude="1", longitude="1",
    )
    db_session.add_all([driver, horse, origin, dest])
    await db_session.flush()

    return operator_org, dispatcher_user, driver, horse, origin, dest


@pytest.mark.asyncio
async def test_create_trip_anchor_failure_still_rolls_back_whole_trip(db_session, create_trip_seed) -> None:
    """P0 (create_trip's own anchor_subject call) is explicitly untouched by task
    2.5 — it must stay fail-closed, uncaught, whole-trip rollback. This is the
    direct contrast to advance_confirmation's new fail-open behaviour: the same
    HederaTimeoutError that leaves a confirmation phase COMPLETED with
    anchor_status=FAILED must, at trip creation, undo the entire trip — no Trip
    or PhaseEvent row may survive it.
    """
    from app.orchestration.trip_service import create_trip

    operator_org, dispatcher_user, driver, horse, origin, dest = create_trip_seed
    user = UserRead(
        id=dispatcher_user.id, email="dispatcher@test.co.za", full_name="Test Dispatcher",
        organization_id=operator_org.id, role=DispatcherRole.DISPATCHER,
        created_at=_NOW, updated_at=_NOW,
    )
    payload = TripCreateRequest(
        order_number="ORD-P0-ROLLBACK", driver_id=driver.id, horse_id=horse.id, trailer_ids=[],
        origin_precinct_id=origin.id, destination_precinct_id=dest.id, trip_type=TripType.EMPTY_LEG,
        planned_departure_at=_NOW,
    )

    with patch(
        "app.orchestration.trip_service.anchor_subject", new_callable=AsyncMock,
        side_effect=HederaTimeoutError("simulated Hedera timeout"),
    ):
        with pytest.raises(HederaTimeoutError):
            await create_trip(db_session, payload, user)

    # Mirrors get_db()'s exception-path rollback (app/db/session.py) — create_trip
    # itself has no try/except around P0's anchor call, by design (this task's fence).
    await db_session.rollback()

    trips = (await db_session.execute(select(Trip).where(Trip.order_number == "ORD-P0-ROLLBACK"))).scalars().all()
    events = (await db_session.execute(
        select(PhaseEvent).where(PhaseEvent.trip_id.in_(select(Trip.id).where(Trip.order_number == "ORD-P0-ROLLBACK")))
    )).scalars().all()
    assert trips == []
    assert events == []


# ── Driver trip reads (which trip is "current", and the driver's own list) ─────
#
# These use the real (rolled-back) db_session for the same reason as the P0 test above:
# the behaviour under test is an ORDER BY and a WHERE clause. A mocked session would only
# replay whatever order the mock was handed, proving nothing about the query itself.

def _driver_trip(
    *, org, client_org, user, driver, horse, origin, dest, reference, status, created_at=None,
    planned_departure_at: datetime | None = None,
):
    return Trip(
        id=uuid.uuid4(), trip_reference=reference, order_number=f"ORD-{reference}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=status, created_by_user_id=user.id,
        planned_departure_at=planned_departure_at,
        **({"created_at": created_at} if created_at is not None else {}),
    )


@pytest.mark.asyncio
async def test_active_trip_prefers_activated_trip_over_newer_assignment(
    db_session, create_trip_seed,
) -> None:
    """The reported bug's root cause, at the service level.

    Two trips exist: one the driver activated three hours ago, and one the dispatcher
    assigned since. Ordering by created_at alone handed back the newer CREATED row, so the
    PWA's Home and Active tab showed an un-activated assignment while the trip the driver
    was actually driving vanished from view.
    """
    from app.orchestration.trip_service import get_active_trip_for_driver

    operator_org, user, driver, horse, origin, dest = create_trip_seed
    client_org = (await db_session.execute(
        select(Organization).where(Organization.org_type == OrganizationType.PRINCIPAL)
    )).scalars().first()
    now = datetime.now(UTC)

    activated = _driver_trip(
        org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UNIT-ACTIVATED", status=TripStatus.ACTIVE,
        created_at=now - timedelta(hours=3),
    )
    newer_assignment = _driver_trip(
        org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UNIT-ASSIGNED", status=TripStatus.CREATED,
        created_at=now - timedelta(minutes=5),
    )
    db_session.add_all([activated, newer_assignment])
    await db_session.flush()

    current = await get_active_trip_for_driver(db_session, driver_id=driver.id)

    assert current is not None
    assert current.trip_reference == "FP-UNIT-ACTIVATED"


@pytest.mark.asyncio
async def test_active_trip_falls_back_to_created_when_nothing_activated(
    db_session, create_trip_seed,
) -> None:
    """CREATED stays eligible: Activation (which is what flips CREATED -> ACTIVE) is
    reached through this trip, so a driver holding only an assignment must still get it."""
    from app.orchestration.trip_service import get_active_trip_for_driver

    operator_org, user, driver, horse, origin, dest = create_trip_seed
    client_org = (await db_session.execute(
        select(Organization).where(Organization.org_type == OrganizationType.PRINCIPAL)
    )).scalars().first()

    assignment = _driver_trip(
        org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UNIT-ONLY-ASSIGNED", status=TripStatus.CREATED,
    )
    db_session.add(assignment)
    await db_session.flush()

    current = await get_active_trip_for_driver(db_session, driver_id=driver.id)

    assert current is not None
    assert current.trip_reference == "FP-UNIT-ONLY-ASSIGNED"


@pytest.mark.asyncio
async def test_active_trip_prefers_soonest_departure_over_newest_assignment(
    db_session, create_trip_seed,
) -> None:
    """The reported bug: Home offered the later-departing of two assignments.

    Nothing is activated, so both trips share the CREATED rank. The trip leaving the day
    after next was the one the dispatcher captured most recently, and created_at ordering
    was enough to make it the driver's "current" trip while the one leaving tomorrow sat
    unstarted — the opposite of the order phase_service's gates let them be worked in.
    """
    from app.orchestration.trip_service import get_active_trip_for_driver

    operator_org, user, driver, horse, origin, dest = create_trip_seed
    client_org = (await db_session.execute(
        select(Organization).where(Organization.org_type == OrganizationType.PRINCIPAL)
    )).scalars().first()
    now = datetime.now(UTC)

    departs_sooner = _driver_trip(
        org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UNIT-DEPARTS-SOONER", status=TripStatus.CREATED,
        planned_departure_at=now + timedelta(days=1), created_at=now - timedelta(hours=2),
    )
    departs_later_captured_last = _driver_trip(
        org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UNIT-DEPARTS-LATER", status=TripStatus.CREATED,
        planned_departure_at=now + timedelta(days=2), created_at=now - timedelta(minutes=5),
    )
    db_session.add_all([departs_sooner, departs_later_captured_last])
    await db_session.flush()

    current = await get_active_trip_for_driver(db_session, driver_id=driver.id)

    assert current is not None
    assert current.trip_reference == "FP-UNIT-DEPARTS-SOONER"


@pytest.mark.asyncio
async def test_active_trip_sorts_an_unscheduled_assignment_last(
    db_session, create_trip_seed,
) -> None:
    """A trip with no planned departure cannot be the "next" one to leave, however
    recently it was captured — it has no place in the queue at all until it is scheduled."""
    from app.orchestration.trip_service import get_active_trip_for_driver

    operator_org, user, driver, horse, origin, dest = create_trip_seed
    client_org = (await db_session.execute(
        select(Organization).where(Organization.org_type == OrganizationType.PRINCIPAL)
    )).scalars().first()
    now = datetime.now(UTC)

    scheduled = _driver_trip(
        org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UNIT-SCHEDULED", status=TripStatus.CREATED,
        planned_departure_at=now + timedelta(days=3), created_at=now - timedelta(hours=2),
    )
    unscheduled = _driver_trip(
        org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UNIT-UNSCHEDULED", status=TripStatus.CREATED,
        planned_departure_at=None, created_at=now - timedelta(minutes=5),
    )
    db_session.add_all([scheduled, unscheduled])
    await db_session.flush()

    current = await get_active_trip_for_driver(db_session, driver_id=driver.id)

    assert current is not None
    assert current.trip_reference == "FP-UNIT-SCHEDULED"


@pytest.mark.asyncio
async def test_active_trip_keeps_the_underway_trip_over_a_sooner_assignment(
    db_session, create_trip_seed,
) -> None:
    """Departure order decides WITHIN a rank, never across one. A trip the driver is
    physically on outranks an assignment even when that assignment leaves sooner —
    otherwise a mis-scheduled row would yank Home away mid-journey."""
    from app.orchestration.trip_service import get_active_trip_for_driver

    operator_org, user, driver, horse, origin, dest = create_trip_seed
    client_org = (await db_session.execute(
        select(Organization).where(Organization.org_type == OrganizationType.PRINCIPAL)
    )).scalars().first()
    now = datetime.now(UTC)

    underway = _driver_trip(
        org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UNIT-UNDERWAY", status=TripStatus.ACTIVE,
        planned_departure_at=now + timedelta(days=2),
    )
    assignment_leaving_sooner = _driver_trip(
        org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UNIT-SOONER-ASSIGNMENT", status=TripStatus.CREATED,
        planned_departure_at=now + timedelta(hours=1),
    )
    db_session.add_all([underway, assignment_leaving_sooner])
    await db_session.flush()

    current = await get_active_trip_for_driver(db_session, driver_id=driver.id)

    assert current is not None
    assert current.trip_reference == "FP-UNIT-UNDERWAY"


@pytest.mark.asyncio
async def test_active_trip_ignores_terminal_trips(db_session, create_trip_seed) -> None:
    from app.orchestration.trip_service import get_active_trip_for_driver

    operator_org, user, driver, horse, origin, dest = create_trip_seed
    client_org = (await db_session.execute(
        select(Organization).where(Organization.org_type == OrganizationType.PRINCIPAL)
    )).scalars().first()

    db_session.add_all([
        _driver_trip(
            org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
            origin=origin, dest=dest, reference="FP-UNIT-CLOSED", status=TripStatus.CLOSED,
        ),
        _driver_trip(
            org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
            origin=origin, dest=dest, reference="FP-UNIT-CANCELLED", status=TripStatus.CANCELLED,
        ),
    ])
    await db_session.flush()

    assert await get_active_trip_for_driver(db_session, driver_id=driver.id) is None


@pytest.mark.asyncio
async def test_list_trips_for_driver_returns_all_statuses_newest_first(
    db_session, create_trip_seed,
) -> None:
    """Terminal trips are included on purpose — the PWA's Past tab is built from them,
    and grouping is the client's job."""
    from app.orchestration.trip_service import list_trips_for_driver

    operator_org, user, driver, horse, origin, dest = create_trip_seed
    client_org = (await db_session.execute(
        select(Organization).where(Organization.org_type == OrganizationType.PRINCIPAL)
    )).scalars().first()
    now = datetime.now(UTC)

    db_session.add_all([
        _driver_trip(
            org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
            origin=origin, dest=dest, reference="FP-UNIT-L-CLOSED", status=TripStatus.CLOSED,
            created_at=now - timedelta(days=2),
        ),
        _driver_trip(
            org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
            origin=origin, dest=dest, reference="FP-UNIT-L-ACTIVE", status=TripStatus.ACTIVE,
            created_at=now - timedelta(hours=4),
        ),
        _driver_trip(
            org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
            origin=origin, dest=dest, reference="FP-UNIT-L-CREATED", status=TripStatus.CREATED,
            created_at=now - timedelta(minutes=10),
        ),
    ])
    await db_session.flush()

    rows = await list_trips_for_driver(db_session, driver_id=driver.id)

    assert [r.trip_reference for r in rows] == [
        "FP-UNIT-L-CREATED", "FP-UNIT-L-ACTIVE", "FP-UNIT-L-CLOSED",
    ]
    # Precinct names are resolved server-side so the PWA card need not guess from a UUID.
    assert rows[0].origin_precinct_name == "Origin"
    assert rows[0].destination_precinct_name == "Dest"


@pytest.mark.asyncio
async def test_list_trips_for_driver_scopes_to_that_driver(db_session, create_trip_seed) -> None:
    """driver_id is the whole authorisation boundary for GET /trips/me."""
    from app.orchestration.trip_service import list_trips_for_driver

    operator_org, user, driver, horse, origin, dest = create_trip_seed
    client_org = (await db_session.execute(
        select(Organization).where(Organization.org_type == OrganizationType.PRINCIPAL)
    )).scalars().first()

    other_driver = Driver(
        id=uuid.uuid4(), organization_id=operator_org.id, full_name="Other",
        id_number="9002026009088", phone_number="+27829999999", license_number="DRV-2",
    )
    db_session.add(other_driver)
    await db_session.flush()

    db_session.add_all([
        _driver_trip(
            org=operator_org, client_org=client_org, user=user, driver=driver, horse=horse,
            origin=origin, dest=dest, reference="FP-UNIT-MINE", status=TripStatus.CREATED,
        ),
        _driver_trip(
            org=operator_org, client_org=client_org, user=user, driver=other_driver, horse=horse,
            origin=origin, dest=dest, reference="FP-UNIT-THEIRS", status=TripStatus.CREATED,
        ),
    ])
    await db_session.flush()

    rows = await list_trips_for_driver(db_session, driver_id=driver.id)

    assert [r.trip_reference for r in rows] == ["FP-UNIT-MINE"]


@pytest.mark.asyncio
async def test_own_trip_detail_rejects_another_drivers_trip(db_session, create_trip_seed) -> None:
    """404 (ResourceNotFoundError), not a 403: a distinguishable refusal would confirm the
    trip exists and let a driver probe for real trip ids."""
    from app.orchestration.trip_service import get_own_trip_detail_for_driver

    operator_org, user, driver, horse, origin, dest = create_trip_seed
    client_org = (await db_session.execute(
        select(Organization).where(Organization.org_type == OrganizationType.PRINCIPAL)
    )).scalars().first()

    other_driver = Driver(
        id=uuid.uuid4(), organization_id=operator_org.id, full_name="Other",
        id_number="9002026009088", phone_number="+27829999999", license_number="DRV-2",
    )
    db_session.add(other_driver)
    await db_session.flush()

    their_trip = _driver_trip(
        org=operator_org, client_org=client_org, user=user, driver=other_driver, horse=horse,
        origin=origin, dest=dest, reference="FP-UNIT-NOT-MINE", status=TripStatus.ACTIVE,
    )
    db_session.add(their_trip)
    await db_session.flush()

    with pytest.raises(ResourceNotFoundError):
        await get_own_trip_detail_for_driver(
            db_session, driver_id=driver.id, trip_id=their_trip.id
        )
