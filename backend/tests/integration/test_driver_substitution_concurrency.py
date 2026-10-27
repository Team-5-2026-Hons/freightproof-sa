"""FP-83 C2 concurrency proofs, on independent PostgreSQL sessions with real commits.

Why not `db_session`: its sessions share one transaction, so there is no lock to wait on and
every test here would pass against unlocked code (see test_creation_concurrency.py).

The handover (completion), arrangement and crew-claim steps below are the real services
(complete_attested_substitution, arrange_substitution, creation._claim_crew), so what is proved
is the shipped lock order and availability rules, not a copy of them. The handover is completed
by a dispatcher attesting both captures missing, which exercises the same locks, eligibility
check and completion path as the final driver confirmation without needing uploaded evidence.

Every wait is bounded: a deadlock fails a test with TimeoutError instead of hanging the suite.
"""

import asyncio
import threading
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.blockchain.hedera import HederaReceipt
from app.core.exceptions import (
    CrewUnavailableError, EvidenceAlreadyRecordedError, IncomingDriverUnavailableError, TripActivationBlockedError,
    TripHandedOverError,
)
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.driver_substitutions import DriverSubstitutionRequest
from app.db.models.enums import BlockchainReceiptType, DispatcherRole, IdvsStatus, PhaseStatus, TripStatus, TripType
from app.db.models.people import Driver
from app.db.models.phases import PhaseEvent
from app.db.models.trips import DriverSubstitution, Trip
from app.orchestration.phases.anchor_dispatch import _BACKGROUND_ANCHOR_TASKS
from app.orchestration.phases.anchor_execution import anchor_phase_event
from app.orchestration.phases.service import complete_phase
from app.orchestration.substitutions import service
from app.orchestration.trips.creation import NewTrip, _claim_crew
from app.schemas.driver_substitutions import ArrangeSubstitutionRequest, CompleteSubstitutionRequest, ExchangePoint
from app.schemas.phases import ActivationCompleteRequest
from app.schemas.people import UserRead
from tests.integration._driver_substitution_world import (
    SubWorld, add_pending, add_trip, build_world, tear_down,
)

_QUEUED_PROBE_SECONDS = 0.5
_TIMEOUT_SECONDS = 10

HOUR = timedelta(hours=1)


@pytest_asyncio.fixture
async def sessionmaker(test_engine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(test_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def world(sessionmaker) -> AsyncGenerator[SubWorld, None]:
    """T1 is live under A with a pending takeover by B expected in six hours."""
    now = datetime.now(UTC)
    async with sessionmaker() as db:
        built = await build_world(db, departure=now, arrival=now + 8 * HOUR)
        await add_pending(db, built, outgoing=built.a, incoming=built.b, expected_at=now + 6 * HOUR)
        incoming = await db.get(Driver, built.b)
        incoming.license_expiry = now.date() + timedelta(days=30)
        incoming.idvs_status = IdvsStatus.VERIFIED.value
        await db.commit()
    yield built
    await tear_down(sessionmaker, built)


async def _committed(sessionmaker, work: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    async with sessionmaker() as db:
        result = await work(db)
        await db.commit()
        return result


async def _assert_queued(task: asyncio.Task[Any], what: str) -> None:
    done, _ = await asyncio.wait({task}, timeout=_QUEUED_PROBE_SECONDS)
    assert not done, f"{what} finished while the lock was held - not serialised"


async def _settle(*tasks: asyncio.Task[Any]) -> list[Any]:
    return await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), _TIMEOUT_SECONDS)


class Hold:
    """A patched async step that parks until the test releases it."""

    def __init__(self) -> None:
        self.entered = asyncio.Event()
        self.release = asyncio.Event()

    async def step(self, *_args: Any, **_kwargs: Any) -> None:
        self.entered.set()
        await self.release.wait()


async def _handover(
    db: AsyncSession, w: SubWorld, *, parked: asyncio.Event | None = None, resume: asyncio.Event | None = None,
) -> None:
    """The real completion of the world's pending A -> B request.

    With `parked`/`resume` it pauses just before eligibility is decided, i.e. after the service
    holds the trip, the drivers and vehicles, and the request: the point a racing write must
    queue behind.
    """
    request = (await db.execute(
        select(DriverSubstitutionRequest)
        .where(DriverSubstitutionRequest.trip_id == w.trip_id, DriverSubstitutionRequest.state == "pending")
    )).scalar_one()
    original = service.first_completion_blocker

    async def parking(*args: Any, **kwargs: Any) -> Any:
        if parked is not None and resume is not None:
            parked.set()
            await resume.wait()
        return await original(*args, **kwargs)

    with patch.object(service, "first_completion_blocker", parking):
        await service.complete_attested_substitution(
            db, trip_id=w.trip_id, request_id=request.id, actor=_dispatcher(w),
            payload=CompleteSubstitutionRequest(
                client_request_id=uuid.uuid4(), expected_version=request.version,
                missing_confirmation_reason="No signal at the exchange point",
            ),
        )


def _activation(key: str, sequence: int | None = None) -> ActivationCompleteRequest:
    return ActivationCompleteRequest(
        phase_type="activation", driver_phone_lat=0.0001, driver_phone_lng=0.0001,
        idempotency_key=key, custody_sequence=sequence,
    )


def _complete(w: SubWorld, driver_id: uuid.UUID, payload: ActivationCompleteRequest, trip_id: uuid.UUID | None = None,
              phase_event_id: uuid.UUID | None = None) -> Callable[[AsyncSession], Awaitable[Any]]:
    async def work(db: AsyncSession) -> Any:
        return await complete_phase(
            db, trip_id=trip_id or w.trip_id, driver_id=driver_id,
            phase_event_id=phase_event_id or w.activation_id, payload=payload,
        )
    return work


async def _chain_length(sessionmaker, trip_id: uuid.UUID) -> int:
    async with sessionmaker() as db:
        return (await db.execute(
            select(func.count()).select_from(DriverSubstitution).where(DriverSubstitution.trip_id == trip_id)
        )).scalar_one()


async def _phase(sessionmaker, phase_event_id: uuid.UUID) -> PhaseEvent:
    async with sessionmaker() as db:
        return (await db.execute(select(PhaseEvent).where(PhaseEvent.id == phase_event_id))).scalar_one()



async def test_stale_actor_is_rechecked_after_trip_lock(sessionmaker, world):
    """A request queued behind a handover must not write as A once B holds the trip.

    The request passes every unlocked look at the trip (A is the driver of record when it
    arrives). Only a custody read taken after the trip lock is granted sees the handover.
    """
    parked, resume = asyncio.Event(), asyncio.Event()
    handover = asyncio.create_task(_committed(sessionmaker, lambda db: _handover(db, world, parked=parked, resume=resume)))
    stale: asyncio.Task[Any] | None = None
    try:
        await asyncio.wait_for(parked.wait(), _TIMEOUT_SECONDS)
        stale = asyncio.create_task(_committed(sessionmaker, _complete(world, world.a, _activation(str(uuid.uuid4()), 0))))
        await _assert_queued(stale, "A's phase completion")
    finally:
        resume.set()
        outcomes = await _settle(handover, *([stale] if stale else []))

    assert not isinstance(outcomes[0], BaseException), f"handover failed: {outcomes[0]!r}"
    assert isinstance(outcomes[1], TripHandedOverError), f"stale write should be refused, got {outcomes[1]!r}"
    event = await _phase(sessionmaker, world.activation_id)
    assert event.status == PhaseStatus.PENDING and event.idempotency_key is None
    async with sessionmaker() as db:
        receipts = (await db.execute(
            select(func.count()).select_from(BlockchainReceipt).where(BlockchainReceipt.trip_id == world.trip_id)
        )).scalar_one()
    assert receipts == 0
    assert await _chain_length(sessionmaker, world.trip_id) == 1


async def test_anchor_worker_receipt_insert_does_not_deadlock_handover(sessionmaker, world):
    """The real anchor worker, a replayed completion and a handover, all at once.

    The worker holds the phase row FOR UPDATE and inserts a BlockchainReceipt, whose trip_id
    FK takes KEY SHARE on the trip. The handover takes the trip FOR NO KEY UPDATE, which does
    not conflict with KEY SHARE, and never touches the phase row, so it completes while the
    worker is still inside Hedera. The worker then finishes with its receipt intact, and the
    replayed completion (now from a former driver) is acknowledged rather than re-applied.
    """
    key = str(uuid.uuid4())
    await _committed(sessionmaker, _complete(world, world.a, _activation(key)))
    await asyncio.wait_for(asyncio.gather(*_BACKGROUND_ANCHOR_TASKS), _TIMEOUT_SECONDS)
    from app.tasks.blockchain import anchor_phase_event_task
    event_id, canonical_payload, receipt_type = anchor_phase_event_task.delay.call_args.args

    inside_hedera, release_hedera = threading.Event(), threading.Event()

    def blocking_submit(_data_hash: str) -> HederaReceipt:
        inside_hedera.set()
        assert release_hedera.wait(_TIMEOUT_SECONDS), "test never released the worker"
        return HederaReceipt(
            topic_id="0.0.1", sequence_number=7, consensus_timestamp=None, transaction_id="0.0.1@1.0",
        )

    async def worker(db: AsyncSession) -> bool:
        return await anchor_phase_event(
            db, phase_event_id=uuid.UUID(event_id), canonical_payload=canonical_payload,
            receipt_type=BlockchainReceiptType(receipt_type),
        )

    with patch("app.blockchain.anchor_service.HederaService") as service:
        service.return_value = MagicMock(submit_hash=blocking_submit)
        anchoring = asyncio.create_task(_committed(sessionmaker, worker))
        handover: asyncio.Task[Any] | None = None
        replay: asyncio.Task[Any] | None = None
        try:
            for _ in range(_TIMEOUT_SECONDS * 20):
                if inside_hedera.is_set():
                    break
                await asyncio.sleep(0.05)
            assert inside_hedera.is_set(), "the worker never reached Hedera"
            handover = asyncio.create_task(_committed(sessionmaker, lambda db: _handover(db, world)))
            await asyncio.wait_for(asyncio.shield(handover), _TIMEOUT_SECONDS)
            replay = asyncio.create_task(_committed(sessionmaker, _complete(world, world.a, _activation(key, 0))))
        finally:
            release_hedera.set()
            outcomes = await _settle(anchoring, *(t for t in (handover, replay) if t is not None))

    assert outcomes[0] is True, f"anchor worker: {outcomes[0]!r}"
    assert not isinstance(outcomes[1], BaseException), f"handover: {outcomes[1]!r}"
    assert isinstance(outcomes[2], EvidenceAlreadyRecordedError), f"replay: {outcomes[2]!r}"
    assert await _chain_length(sessionmaker, world.trip_id) == 1
    event = await _phase(sessionmaker, world.activation_id)
    assert event.blockchain_receipt_id is not None



async def test_activation_waits_for_a_handover_then_is_refused_for_the_driver_who_took_over(sessionmaker, world):
    """B's own CREATED trip is planned for earlier today and already over, so it sits outside the
    takeover window and the handover is allowed; B then holds T1, and activating that second trip
    must fail rather than double-assign B."""
    now = datetime.now(UTC)
    async with sessionmaker() as db:
        t2, activation_2 = await add_trip(
            db, world, driver_id=world.b, status=TripStatus.CREATED, departure=now - 3 * HOUR, arrival=now - HOUR,
        )
        await db.commit()
    parked, resume = asyncio.Event(), asyncio.Event()
    handover = asyncio.create_task(_committed(sessionmaker, lambda db: _handover(db, world, parked=parked, resume=resume)))
    activation: asyncio.Task[Any] | None = None
    try:
        await asyncio.wait_for(parked.wait(), _TIMEOUT_SECONDS)
        activation = asyncio.create_task(_committed(
            sessionmaker, _complete(world, world.b, _activation(str(uuid.uuid4())), trip_id=t2, phase_event_id=activation_2),
        ))
        await _assert_queued(activation, "B's activation of the second trip")
    finally:
        resume.set()
        outcomes = await _settle(handover, *([activation] if activation else []))

    assert not isinstance(outcomes[0], BaseException), f"handover failed: {outcomes[0]!r}"
    assert isinstance(outcomes[1], TripActivationBlockedError), f"activation should be refused, got {outcomes[1]!r}"
    assert await _chain_length(sessionmaker, world.trip_id) == 1


async def test_handover_waits_for_an_activation_then_is_refused_because_the_driver_is_busy(sessionmaker, world, monkeypatch):
    """The other order: B's open-ended trip activates first, so the takeover finds B busy."""
    now = datetime.now(UTC)
    async with sessionmaker() as db:
        t2, activation_2 = await add_trip(db, world, driver_id=world.b, status=TripStatus.CREATED, departure=now, arrival=None)
        await db.commit()
    hold = Hold()
    monkeypatch.setattr("app.orchestration.evidence.corroboration.record_phase_corroboration", hold.step)
    activation = asyncio.create_task(_committed(
        sessionmaker, _complete(world, world.b, _activation(str(uuid.uuid4())), trip_id=t2, phase_event_id=activation_2),
    ))
    handover: asyncio.Task[Any] | None = None
    try:
        await asyncio.wait_for(hold.entered.wait(), _TIMEOUT_SECONDS)
        handover = asyncio.create_task(_committed(sessionmaker, lambda db: _handover(db, world)))
        await _assert_queued(handover, "the handover")
    finally:
        hold.release.set()
        outcomes = await _settle(activation, *([handover] if handover else []))

    assert not isinstance(outcomes[0], BaseException), f"activation failed: {outcomes[0]!r}"
    assert isinstance(outcomes[1], IncomingDriverUnavailableError), f"handover should be refused, got {outcomes[1]!r}"
    assert await _chain_length(sessionmaker, world.trip_id) == 0


async def _stand_in_creation(db: AsyncSession, w: SubWorld, start: datetime, end: datetime) -> uuid.UUID:
    """create_trip's real crew claim (lock, load, refuse a clash), then the insert that follows it."""
    await _claim_crew(db, NewTrip(
        driver_id=w.b, horse_id=w.horse_id, trailer_ids=[], stops=[], trip_type=TripType.EMPTY_LEG,
        planned_departure_at=start, planned_arrival_at=end,
    ), w.org_id)
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:8]}", order_number="ORD-N",
        operator_organization_id=w.org_id, client_organization_id=w.client_org_id, driver_id=w.b,
        horse_id=w.horse_id, origin_precinct_id=w.origin_id, destination_precinct_id=w.dest_id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=w.user_id,
        planned_departure_at=start, planned_arrival_at=end,
    )
    db.add(trip)
    await db.flush()
    return trip.id


async def test_creation_after_a_handover_sees_the_driver_on_the_taken_over_trip(sessionmaker, world):
    now = datetime.now(UTC)
    parked, resume = asyncio.Event(), asyncio.Event()
    handover = asyncio.create_task(_committed(sessionmaker, lambda db: _handover(db, world, parked=parked, resume=resume)))
    creation: asyncio.Task[Any] | None = None
    try:
        await asyncio.wait_for(parked.wait(), _TIMEOUT_SECONDS)
        creation = asyncio.create_task(_committed(
            sessionmaker, lambda db: _stand_in_creation(db, world, now + 7 * HOUR, now + 9 * HOUR),
        ))
        await _assert_queued(creation, "the new trip's crew claim")
    finally:
        resume.set()
        outcomes = await _settle(handover, *([creation] if creation else []))

    assert not isinstance(outcomes[0], BaseException), f"handover failed: {outcomes[0]!r}"
    assert isinstance(outcomes[1], CrewUnavailableError), f"creation should see B busy, got {outcomes[1]!r}"


async def test_creation_inside_a_reserved_window_is_refused_but_one_after_it_is_not(sessionmaker, world):
    """B is reserved for T1's takeover from hour 6 to hour 8: a trip claiming B in that window is
    refused, one starting after T1's planned end is allowed and does not block the handover."""
    now = datetime.now(UTC)

    inside = await _settle(asyncio.create_task(_committed(
        sessionmaker, lambda db: _stand_in_creation(db, world, now + 7 * HOUR, now + 9 * HOUR),
    )))
    after = await _committed(sessionmaker, lambda db: _stand_in_creation(db, world, now + 9 * HOUR, now + 11 * HOUR))
    handover = await _settle(asyncio.create_task(_committed(sessionmaker, lambda db: _handover(db, world))))

    assert isinstance(inside[0], CrewUnavailableError)
    assert isinstance(after, uuid.UUID)
    assert not isinstance(handover[0], BaseException), f"handover failed: {handover[0]!r}"
    assert await _chain_length(sessionmaker, world.trip_id) == 1


def _dispatcher(w: SubWorld) -> UserRead:
    now = datetime.now(UTC)
    return UserRead(
        id=w.user_id, organization_id=w.org_id, email="d@test.co.za", full_name="D", created_at=now, updated_at=now,
        role=DispatcherRole.DISPATCHER,
    )


def _arrangement(incoming: uuid.UUID, expected_at: datetime) -> ArrangeSubstitutionRequest:
    return ArrangeSubstitutionRequest(
        client_request_id=uuid.uuid4(), incoming_driver_id=incoming,
        exchange=ExchangePoint(label="Depot", latitude=-32.35, longitude=22.58), expected_at=expected_at,
        is_planned=True, reason="r",
    )


async def _license(sessionmaker, *driver_ids: uuid.UUID) -> None:
    async with sessionmaker() as db:
        for driver_id in driver_ids:
            (await db.get(Driver, driver_id)).license_expiry = (datetime.now(UTC) + 400 * HOUR).date()
        await db.commit()


async def test_two_trips_cannot_both_reserve_one_driver(sessionmaker, world, monkeypatch):
    """Two real arrangements for B over the same hours race for B's crew lock; exactly one wins."""
    now = datetime.now(UTC)
    async with sessionmaker() as db:
        t2, _ = await add_trip(db, world, driver_id=world.c, status=TripStatus.ACTIVE, departure=now, arrival=now + 8 * HOUR)
        await db.execute(DriverSubstitutionRequest.__table__.update().where(
            DriverSubstitutionRequest.trip_id == world.trip_id).values(state="cancelled"))
        await db.commit()
    await _license(sessionmaker, world.b)

    hold = Hold()
    original = service.require_arrangeable
    calls = 0

    async def parked_first(*args: Any, **kwargs: Any) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            await hold.step()
        await original(*args, **kwargs)

    monkeypatch.setattr(service, "require_arrangeable", parked_first)
    expected_at = now + 6 * HOUR
    first = asyncio.create_task(_committed(sessionmaker, lambda db: service.arrange_substitution(
        db, trip_id=world.trip_id, actor=_dispatcher(world), payload=_arrangement(world.b, expected_at))))
    second: asyncio.Task[Any] | None = None
    try:
        await asyncio.wait_for(hold.entered.wait(), _TIMEOUT_SECONDS)
        second = asyncio.create_task(_committed(sessionmaker, lambda db: service.arrange_substitution(
            db, trip_id=t2, actor=_dispatcher(world), payload=_arrangement(world.b, expected_at))))
        await _assert_queued(second, "the second arrangement")
    finally:
        hold.release.set()
        outcomes = await _settle(first, *([second] if second else []))

    assert not isinstance(outcomes[0], BaseException), f"first arrangement failed: {outcomes[0]!r}"
    assert isinstance(outcomes[1], IncomingDriverUnavailableError), f"second should be refused, got {outcomes[1]!r}"
    async with sessionmaker() as db:
        reserved = (await db.execute(
            select(func.count()).select_from(DriverSubstitutionRequest).where(
                DriverSubstitutionRequest.incoming_driver_id == world.b, DriverSubstitutionRequest.state == "pending",
            )
        )).scalar_one()
    assert reserved == 1


async def test_arrangement_queues_behind_an_in_flight_activation_of_the_same_trip(sessionmaker, monkeypatch):
    """The C2 deviation: activation takes crew locks after its phase row, so a handover that
    interleaved with it could deadlock. A handover needs the trip lock first and a LIVE trip, so
    it waits for the activation, then is accepted against the ACTIVE trip. Both terminate."""
    now = datetime.now(UTC)
    async with sessionmaker() as db:
        built = await build_world(db, status=TripStatus.CREATED, departure=now, arrival=now + 8 * HOUR)
        await db.commit()
    await _license(sessionmaker, built.b)
    try:
        hold = Hold()
        monkeypatch.setattr("app.orchestration.evidence.corroboration.record_phase_corroboration", hold.step)
        activation = asyncio.create_task(_committed(sessionmaker, _complete(built, built.a, _activation(str(uuid.uuid4())))))
        arrange: asyncio.Task[Any] | None = None
        try:
            await asyncio.wait_for(hold.entered.wait(), _TIMEOUT_SECONDS)
            arrange = asyncio.create_task(_committed(sessionmaker, lambda db: service.arrange_substitution(
                db, trip_id=built.trip_id, actor=_dispatcher(built), payload=_arrangement(built.b, now + 6 * HOUR))))
            await _assert_queued(arrange, "the arrangement")
        finally:
            hold.release.set()
            outcomes = await _settle(activation, *([arrange] if arrange else []))

        assert not isinstance(outcomes[0], BaseException), f"activation failed: {outcomes[0]!r}"
        assert not isinstance(outcomes[1], BaseException), f"arrangement failed: {outcomes[1]!r}"
        async with sessionmaker() as db:
            assert (await db.get(Trip, built.trip_id)).status == TripStatus.ACTIVE
    finally:
        await tear_down(sessionmaker, built)
