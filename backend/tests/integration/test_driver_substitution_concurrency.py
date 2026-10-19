"""FP-83 C2 concurrency proofs, on independent PostgreSQL sessions with real commits.

Why not `db_session`: its sessions share one transaction, so there is no lock to wait on and
every test here would pass against unlocked code (see test_creation_concurrency.py).

The handover itself is C3. These tests stand in for it with the lock order the feature
mandates (trip, drivers by id, vehicles by id, request, phase rows - all FOR NO KEY UPDATE)
followed by the availability check and the completed row, because what C2 must prove is that
the access, availability and anchor-worker paths compose with that order without deadlock or
double ownership.

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
    EvidenceAlreadyRecordedError, TripActivationBlockedError, TripHandedOverError,
)
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.driver_substitutions import DriverSubstitutionRequest
from app.db.models.enums import BlockchainReceiptType, PhaseStatus, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import DriverSubstitution, Trip
from app.orchestration.phases.anchor_dispatch import _BACKGROUND_ANCHOR_TASKS
from app.orchestration.phases.anchor_execution import anchor_phase_event
from app.orchestration.phases.service import complete_phase
from app.orchestration.substitutions.access import lock_trip
from app.orchestration.trips.availability import (
    CrewFilter, TimeWindow, busy_crew_in_window, lock_crew_set,
)
from app.schemas.phases import ActivationCompleteRequest
from tests.integration._driver_substitution_world import (
    SubWorld, add_pending, add_trip, build_world, tear_down,
)

# Long enough to decide a transaction is queued rather than slow; short enough not to drag.
_QUEUED_PROBE_SECONDS = 0.5
# Upper bound for anything that must finish once released. Postgres breaks a true deadlock
# after deadlock_timeout (1s), so anything near this limit is a hang, not a slow test.
_TIMEOUT_SECONDS = 10

HOUR = timedelta(hours=1)


class HandoverRefusedError(Exception):
    """The stand-in handover found the incoming driver busy."""


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


async def _stand_in_handover(
    db: AsyncSession, w: SubWorld, *, parked: asyncio.Event | None = None, resume: asyncio.Event | None = None,
) -> None:
    """The mandated lock order, the incoming-driver availability check, then the completed row."""
    await lock_trip(db, trip_id=w.trip_id)
    await lock_crew_set(db, driver_ids=[w.a, w.b], vehicle_ids=[w.horse_id])
    request = (await db.execute(
        select(DriverSubstitutionRequest)
        .where(DriverSubstitutionRequest.trip_id == w.trip_id, DriverSubstitutionRequest.state == "pending")
        .with_for_update(key_share=True)
    )).scalar_one()
    await db.execute(
        select(PhaseEvent.id).where(PhaseEvent.trip_id == w.trip_id).order_by(PhaseEvent.id)
        .with_for_update(key_share=True)
    )
    if parked is not None and resume is not None:
        parked.set()
        await resume.wait()

    busy = await busy_crew_in_window(
        db, organization_id=w.org_id, window=TimeWindow(request.expected_at, request.expected_at + 2 * HOUR),
        now=datetime.now(UTC), crew=CrewFilter(driver_id=w.b, exclude_trip_id=w.trip_id),
    )
    if busy:
        raise HandoverRefusedError(busy[0].trip_reference)

    previous = (await db.execute(
        select(func.coalesce(func.max(DriverSubstitution.sequence_number), 0))
        .where(DriverSubstitution.trip_id == w.trip_id)
    )).scalar_one()
    request.state = "completed"
    request.terminal_at = datetime.now(UTC)
    await db.flush()
    db.add(DriverSubstitution(
        id=uuid.uuid4(), trip_id=w.trip_id, original_driver_id=w.a, substituting_driver_id=w.b,
        exchange_location="Depot", approving_dispatcher_user_id=w.user_id, is_planned=True,
        substitution_at=datetime.now(UTC), sequence_number=previous + 1, previous_substitution_id=None,
        request_id=request.id, completed_by_user_id=w.user_id,
    ))


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


# ── named regression cases ───────────────────────────────────────────────────


async def test_stale_actor_is_rechecked_after_trip_lock(sessionmaker, world):
    """A request queued behind a handover must not write as A once B holds the trip.

    The request passes every unlocked look at the trip (A is the driver of record when it
    arrives). Only a custody read taken after the trip lock is granted sees the handover.
    """
    parked, resume = asyncio.Event(), asyncio.Event()
    handover = asyncio.create_task(_committed(sessionmaker, lambda db: _stand_in_handover(db, world, parked=parked, resume=resume)))
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
    FK takes KEY SHARE on the trip. The handover holds the trip FOR NO KEY UPDATE and then
    queues for the same phase row. FOR NO KEY UPDATE does not conflict with KEY SHARE, so the
    worker finishes, the handover follows, and the replay then sees A as a former driver.
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
            handover = asyncio.create_task(_committed(sessionmaker, lambda db: _stand_in_handover(db, world)))
            await _assert_queued(handover, "the handover")
            replay = asyncio.create_task(_committed(sessionmaker, _complete(world, world.a, _activation(key, 0))))
            await _assert_queued(replay, "the replayed completion")
        finally:
            release_hedera.set()
            outcomes = await _settle(anchoring, *(t for t in (handover, replay) if t is not None))

    assert outcomes[0] is True, f"anchor worker: {outcomes[0]!r}"
    assert not isinstance(outcomes[1], BaseException), f"handover: {outcomes[1]!r}"
    assert isinstance(outcomes[2], EvidenceAlreadyRecordedError), f"replay: {outcomes[2]!r}"
    assert await _chain_length(sessionmaker, world.trip_id) == 1
    event = await _phase(sessionmaker, world.activation_id)
    assert event.blockchain_receipt_id is not None


# ── creation / activation / handover compose ─────────────────────────────────


async def test_activation_waits_for_a_handover_then_is_refused_for_the_driver_who_took_over(sessionmaker, world):
    """B's own CREATED trip sits outside the takeover window, so the handover is allowed;
    B then holds T1, and activating a second trip must fail rather than double-assign B."""
    now = datetime.now(UTC)
    async with sessionmaker() as db:
        t2, activation_2 = await add_trip(db, world, driver_id=world.b, status=TripStatus.CREATED, departure=now, arrival=now + HOUR)
        await db.commit()
    parked, resume = asyncio.Event(), asyncio.Event()
    handover = asyncio.create_task(_committed(sessionmaker, lambda db: _stand_in_handover(db, world, parked=parked, resume=resume)))
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
        handover = asyncio.create_task(_committed(sessionmaker, lambda db: _stand_in_handover(db, world)))
        await _assert_queued(handover, "the handover")
    finally:
        hold.release.set()
        outcomes = await _settle(activation, *([handover] if handover else []))

    assert not isinstance(outcomes[0], BaseException), f"activation failed: {outcomes[0]!r}"
    assert isinstance(outcomes[1], HandoverRefusedError), f"handover should be refused, got {outcomes[1]!r}"
    assert await _chain_length(sessionmaker, world.trip_id) == 0


async def _stand_in_creation(db: AsyncSession, w: SubWorld, start: datetime, end: datetime) -> uuid.UUID:
    """create_trip's claim step: lock the crew, refuse a clash, insert the trip."""
    from app.db.models.enums import IdvsStatus

    await lock_crew_set(db, driver_ids=[w.b], vehicle_ids=[w.horse_id])
    clashes = await busy_crew_in_window(
        db, organization_id=w.org_id, window=TimeWindow(start, end), now=datetime.now(UTC),
        crew=CrewFilter(driver_id=w.b),
    )
    if clashes:
        raise HandoverRefusedError(clashes[0].trip_reference)
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
    handover = asyncio.create_task(_committed(sessionmaker, lambda db: _stand_in_handover(db, world, parked=parked, resume=resume)))
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
    assert isinstance(outcomes[1], HandoverRefusedError), f"creation should see B busy, got {outcomes[1]!r}"


async def test_creation_inside_a_reserved_window_is_refused_but_one_after_it_is_not(sessionmaker, world):
    """B is reserved for T1's takeover from hour 6 to hour 8: a trip claiming B in that window is
    refused, one starting after T1's planned end is allowed and does not block the handover."""
    now = datetime.now(UTC)

    inside = await _settle(asyncio.create_task(_committed(
        sessionmaker, lambda db: _stand_in_creation(db, world, now + 7 * HOUR, now + 9 * HOUR),
    )))
    after = await _committed(sessionmaker, lambda db: _stand_in_creation(db, world, now + 9 * HOUR, now + 11 * HOUR))
    handover = await _settle(asyncio.create_task(_committed(sessionmaker, lambda db: _stand_in_handover(db, world))))

    assert isinstance(inside[0], HandoverRefusedError)
    assert isinstance(after, uuid.UUID)
    assert not isinstance(handover[0], BaseException), f"handover failed: {handover[0]!r}"
    assert await _chain_length(sessionmaker, world.trip_id) == 1


async def test_two_trips_cannot_both_reserve_one_driver(sessionmaker, world):
    """Two arrangements for B over the same hours race for B's crew lock; exactly one wins."""
    now = datetime.now(UTC)
    async with sessionmaker() as db:
        t2, _ = await add_trip(db, world, driver_id=world.c, status=TripStatus.ACTIVE, departure=now, arrival=now + 8 * HOUR)
        await db.commit()

    async def arrange(db: AsyncSession, trip_id: uuid.UUID, outgoing: uuid.UUID, hold: Hold | None) -> None:
        await lock_crew_set(db, driver_ids=[outgoing, world.b], vehicle_ids=[])
        if hold is not None:
            await hold.step()
        busy = await busy_crew_in_window(
            db, organization_id=world.org_id, window=TimeWindow(now + 6 * HOUR, now + 8 * HOUR),
            now=datetime.now(UTC), crew=CrewFilter(driver_id=world.b, exclude_trip_id=trip_id),
        )
        if busy:
            raise HandoverRefusedError(busy[0].trip_reference)
        db.add(DriverSubstitutionRequest(
            id=uuid.uuid4(), trip_id=trip_id, outgoing_driver_id=outgoing, incoming_driver_id=world.b,
            exchange_label="Depot", exchange_latitude=-32.35, exchange_longitude=22.58,
            exchange_instructions="", expected_at=now + 6 * HOUR, reason="r", is_planned=True,
            arranged_by_user_id=world.user_id, version=1, state="pending",
        ))

    # T1 already holds a pending takeover by B (the fixture), so a second arrangement is refused;
    # cancel it first so the race is between two fresh arrangements.
    async with sessionmaker() as db:
        await db.execute(DriverSubstitutionRequest.__table__.update().where(
            DriverSubstitutionRequest.trip_id == world.trip_id).values(state="cancelled"))
        await db.commit()
    hold = Hold()
    first = asyncio.create_task(_committed(sessionmaker, lambda db: arrange(db, world.trip_id, world.a, hold)))
    second: asyncio.Task[Any] | None = None
    try:
        await asyncio.wait_for(hold.entered.wait(), _TIMEOUT_SECONDS)
        second = asyncio.create_task(_committed(sessionmaker, lambda db: arrange(db, t2, world.c, None)))
        await _assert_queued(second, "the second arrangement")
    finally:
        hold.release.set()
        outcomes = await _settle(first, *([second] if second else []))

    assert not isinstance(outcomes[0], BaseException), f"first arrangement failed: {outcomes[0]!r}"
    assert isinstance(outcomes[1], HandoverRefusedError), f"second should be refused, got {outcomes[1]!r}"
    async with sessionmaker() as db:
        reserved = (await db.execute(
            select(func.count()).select_from(DriverSubstitutionRequest).where(
                DriverSubstitutionRequest.incoming_driver_id == world.b, DriverSubstitutionRequest.state == "pending",
            )
        )).scalar_one()
    assert reserved == 1
