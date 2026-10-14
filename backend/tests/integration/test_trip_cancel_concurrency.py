"""Concurrency proofs for cancel_trip against phase writes.

A phase write that has read an ACTIVE trip must not be able to commit over a cancellation.
Before the trip row was locked on the phase path, the gate read the trip with no lock, so a
completion and a cancellation interleaved freely: `recompute_position` wrote CLOSED (and
advance_activation wrote ACTIVE) on top of a committed CANCELLED, silently un-cancelling
the trip.

Why this file does not use the `db_session` fixture: see the same note in
test_creation_concurrency.py. Two sessions built on that fixture sit inside one transaction,
so there is no lock to wait on and the test would pass against the unfixed code.

How the race is held open: the slow step is a patched call that parks on an asyncio.Event
while the transaction under test is mid-flight. The test then starts the competing
transaction on a second connection and asserts it is queued behind the first, not racing it.
"""

import asyncio
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.exceptions import PhaseSequenceError, TripStateError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, IdvsStatus, OrganizationType, PhaseStatus, PhaseType, SubjectType,
    TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.orchestration.phases.service import complete_phase
from app.orchestration.trips.administration import cancel_trip
from app.schemas.phases import ActivationCompleteRequest

# How long the test waits to decide that the second transaction is queued rather than merely
# slow. A queued transaction stays pending for as long as the first one is held open; an
# unlocked one finishes in a few milliseconds, so a fraction of a second separates the two
# without making the suite wait.
_BLOCKED_PROBE_SECONDS = 0.5

# Upper bound for anything that should complete once the hold is released. A deadlock would
# otherwise surface as a hung test; Postgres breaks one after deadlock_timeout (1s) anyway.
_COMPLETION_TIMEOUT_SECONDS = 10


@dataclass
class World:
    sessionmaker: async_sessionmaker[AsyncSession]
    org_id: uuid.UUID
    user_id: uuid.UUID
    driver_id: uuid.UUID
    trip_id: uuid.UUID
    activation_id: uuid.UUID


async def _build_world(
    sessionmaker: async_sessionmaker[AsyncSession], *, trailing_phase: PhaseType | None,
) -> World:
    """A committed trip whose only open phase is ACTIVATION, optionally followed by one more.

    With no trailing phase, completing activation resolves the last row, so
    recompute_position closes the trip. With one, activation leaves the trip ACTIVE.
    """
    suffix = uuid.uuid4().hex[:8]
    org = Organization(id=uuid.uuid4(), name=f"Cancel Op {suffix}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(
        id=uuid.uuid4(), name=f"Cancel Client {suffix}", org_type=OrganizationType.PRINCIPAL,
    )
    async with sessionmaker() as db:
        db.add_all([org, client_org])
        await db.flush()
        user = User(
            id=uuid.uuid4(), organization_id=org.id,
            email=f"cancel-{suffix}@test.co.za", full_name="Dispatcher",
        )
        driver = Driver(
            id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
            id_number=f"80010150{suffix[:5]}", phone_number=f"+2782{suffix[:7]}",
            license_number=f"DRV-{suffix}",
        )
        horse = Vehicle(
            id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
            registration=f"C{suffix.upper()}", pulsit_device_id=f"PUL-{suffix}",
        )
        origin = Precinct(
            id=uuid.uuid4(), name=f"O{suffix}", principal_organization_id=client_org.id,
            latitude="0", longitude="0",
        )
        db.add_all([user, driver, horse, origin])
        await db.flush()
        trip = Trip(
            id=uuid.uuid4(), trip_reference=f"FP-{suffix}", order_number=f"ORD-{suffix}",
            operator_organization_id=org.id, client_organization_id=client_org.id,
            driver_id=driver.id, horse_id=horse.id,
            origin_precinct_id=origin.id, destination_precinct_id=origin.id,
            status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
            planned_departure_at=datetime.now(UTC), created_by_user_id=user.id,
        )
        db.add(trip)
        await db.flush()
        stop = TripStop(trip_id=trip.id, precinct_id=origin.id, sequence=0)
        db.add(stop)
        await db.flush()
        activation = PhaseEvent(
            id=uuid.uuid4(), trip_id=trip.id, phase_type=PhaseType.ACTIVATION,
            trip_stop_id=stop.id, sequence_number=1, status=PhaseStatus.PENDING,
        )
        rows = [
            PhaseEvent(
                trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION, sequence_number=0,
                status=PhaseStatus.COMPLETED,
            ),
            activation,
        ]
        if trailing_phase is not None:
            rows.append(PhaseEvent(
                trip_id=trip.id, phase_type=trailing_phase, trip_stop_id=stop.id,
                sequence_number=2, status=PhaseStatus.PENDING,
            ))
        db.add_all(rows)
        await db.commit()

    return World(
        sessionmaker=sessionmaker, org_id=org.id, user_id=user.id, driver_id=driver.id,
        trip_id=trip.id, activation_id=activation.id,
    )


async def _tear_down(world: World) -> None:
    async with world.sessionmaker() as db:
        trip = (await db.execute(select(Trip).where(Trip.id == world.trip_id))).scalar_one()
        horse_id, origin_id, client_id = trip.horse_id, trip.origin_precinct_id, trip.client_organization_id
        await db.execute(delete(BlockchainReceipt).where(BlockchainReceipt.trip_id == world.trip_id))
        await db.execute(delete(TripException).where(TripException.trip_id == world.trip_id))
        await db.execute(delete(PhaseEvent).where(PhaseEvent.trip_id == world.trip_id))
        await db.execute(delete(TripStop).where(TripStop.trip_id == world.trip_id))
        await db.execute(delete(Trip).where(Trip.id == world.trip_id))
        await db.execute(delete(Precinct).where(Precinct.id == origin_id))
        await db.execute(delete(Vehicle).where(Vehicle.id == horse_id))
        await db.execute(delete(Driver).where(Driver.id == world.driver_id))
        await db.execute(delete(User).where(User.id == world.user_id))
        await db.execute(delete(Organization).where(Organization.id.in_([world.org_id, client_id])))
        await db.commit()


@pytest_asyncio.fixture
async def sessionmaker(test_engine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(test_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def closing_world(sessionmaker) -> AsyncGenerator[World, None]:
    """Activation is the plan's last open phase: completing it closes the trip."""
    world = await _build_world(sessionmaker, trailing_phase=None)
    yield world
    await _tear_down(world)


@pytest_asyncio.fixture
async def open_world(sessionmaker) -> AsyncGenerator[World, None]:
    """A loading phase follows activation: completing activation leaves the trip ACTIVE."""
    world = await _build_world(sessionmaker, trailing_phase=PhaseType.LOADING)
    yield world
    await _tear_down(world)


class Hold:
    """A patched async step that parks until the test releases it."""

    def __init__(self, result: Any = None) -> None:
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self._result = result

    async def step(self, *_args: Any, **_kwargs: Any) -> Any:
        self.entered.set()
        await self.release.wait()
        return self._result


async def _committed(
    sessionmaker: async_sessionmaker[AsyncSession], work: Callable[[AsyncSession], Awaitable[Any]],
) -> Any:
    """One request: its own session and transaction, ending in a real commit."""
    async with sessionmaker() as db:
        result = await work(db)
        await db.commit()
        return result


def _complete_activation(world: World) -> Callable[[AsyncSession], Awaitable[Any]]:
    async def work(db: AsyncSession) -> Any:
        return await complete_phase(
            db, trip_id=world.trip_id, driver_id=world.driver_id,
            phase_event_id=world.activation_id,
            payload=ActivationCompleteRequest(
                phase_type=PhaseType.ACTIVATION, driver_phone_lat=0.0001, driver_phone_lng=0.0001,
                idempotency_key=str(uuid.uuid4()),
            ),
        )
    return work


def _cancel(world: World) -> Callable[[AsyncSession], Awaitable[Any]]:
    async def work(db: AsyncSession) -> Any:
        return await cancel_trip(
            db, trip_id=world.trip_id, operator_organization_id=world.org_id,
            user_id=world.user_id, note="abandoned",
        )
    return work


async def _assert_queued(task: asyncio.Task[Any], what: str) -> None:
    done, _pending = await asyncio.wait({task}, timeout=_BLOCKED_PROBE_SECONDS)
    assert not done, f"{what} finished while the other transaction held the trip open — not serialised"


async def _final_status(world: World) -> str:
    async with world.sessionmaker() as db:
        status = (await db.execute(select(Trip.status).where(Trip.id == world.trip_id))).scalar_one()
    return TripStatus(status).value


async def test_cancel_waits_for_a_final_phase_completion_and_is_then_refused(
    sessionmaker, closing_world, monkeypatch,
) -> None:
    """The completion that closes the trip wins; the cancel it raced is told the trip is CLOSED.

    Unserialised, the cancel commits first and the completion's recompute_position then
    overwrites CANCELLED with CLOSED: the dispatcher was told the trip is cancelled and it is not.
    """
    hold = Hold()
    monkeypatch.setattr("app.orchestration.evidence.corroboration.record_phase_corroboration", hold.step)
    completion = asyncio.create_task(_committed(sessionmaker, _complete_activation(closing_world)))
    cancellation: asyncio.Task[Any] | None = None
    try:
        await asyncio.wait_for(hold.entered.wait(), _COMPLETION_TIMEOUT_SECONDS)
        cancellation = asyncio.create_task(_committed(sessionmaker, _cancel(closing_world)))

        await _assert_queued(cancellation, "cancel_trip")
    finally:
        hold.release.set()
        outcomes = await asyncio.wait_for(
            asyncio.gather(completion, *([cancellation] if cancellation else []), return_exceptions=True),
            _COMPLETION_TIMEOUT_SECONDS,
        )

    assert not isinstance(outcomes[0], BaseException), f"completion failed: {outcomes[0]!r}"
    assert isinstance(outcomes[1], TripStateError), f"cancel should be refused, got {outcomes[1]!r}"
    assert await _final_status(closing_world) == TripStatus.CLOSED.value


async def test_completion_waits_for_a_cancellation_and_is_then_rejected_by_the_gate(
    sessionmaker, closing_world, monkeypatch,
) -> None:
    """The symmetric order: the cancel commits first, the completion must be refused."""
    hold = Hold()
    monkeypatch.setattr("app.orchestration.trips.administration.get_trip_detail", hold.step)
    cancellation = asyncio.create_task(_committed(sessionmaker, _cancel(closing_world)))
    completion: asyncio.Task[Any] | None = None
    try:
        await asyncio.wait_for(hold.entered.wait(), _COMPLETION_TIMEOUT_SECONDS)
        completion = asyncio.create_task(_committed(sessionmaker, _complete_activation(closing_world)))

        await _assert_queued(completion, "the phase completion")
    finally:
        hold.release.set()
        outcomes = await asyncio.wait_for(
            asyncio.gather(cancellation, *([completion] if completion else []), return_exceptions=True),
            _COMPLETION_TIMEOUT_SECONDS,
        )

    assert not isinstance(outcomes[0], BaseException), f"cancel failed: {outcomes[0]!r}"
    assert isinstance(outcomes[1], PhaseSequenceError), f"completion should be refused, got {outcomes[1]!r}"
    assert await _final_status(closing_world) == TripStatus.CANCELLED.value


async def test_activation_cannot_reactivate_a_trip_cancelled_while_it_was_in_flight(
    sessionmaker, open_world, monkeypatch,
) -> None:
    """advance_activation writes ACTIVE; run after a cancel it would revive the trip."""
    hold = Hold()
    monkeypatch.setattr("app.orchestration.evidence.corroboration.record_phase_corroboration", hold.step)
    completion = asyncio.create_task(_committed(sessionmaker, _complete_activation(open_world)))
    cancellation: asyncio.Task[Any] | None = None
    try:
        await asyncio.wait_for(hold.entered.wait(), _COMPLETION_TIMEOUT_SECONDS)
        cancellation = asyncio.create_task(_committed(sessionmaker, _cancel(open_world)))

        await _assert_queued(cancellation, "cancel_trip")
    finally:
        hold.release.set()
        outcomes = await asyncio.wait_for(
            asyncio.gather(completion, *([cancellation] if cancellation else []), return_exceptions=True),
            _COMPLETION_TIMEOUT_SECONDS,
        )

    assert not any(isinstance(o, BaseException) for o in outcomes), f"unexpected failure: {outcomes!r}"
    assert await _final_status(open_world) == TripStatus.CANCELLED.value


async def test_a_replayed_completion_does_not_deadlock_with_the_anchor_worker(
    sessionmaker, closing_world,
) -> None:
    """The trip lock must not conflict with the FK check the anchor worker's receipt insert takes.

    The worker holds the phase row (FOR UPDATE) and then inserts a BlockchainReceipt, whose
    trip_id foreign key takes a KEY SHARE lock on the trip. A resent offline-queue completion
    of the same, already-resolved phase takes the trip lock first and then queues on the phase
    row. If the trip lock were FOR UPDATE the two would wait on each other; FOR NO KEY UPDATE
    does not conflict with KEY SHARE, so the worker finishes and the replay follows.
    """
    world = closing_world
    await _committed(sessionmaker, _complete_activation(world))

    async with sessionmaker() as worker:
        await worker.execute(select(PhaseEvent).where(PhaseEvent.id == world.activation_id).with_for_update())
        replay = asyncio.create_task(_committed(sessionmaker, _complete_activation(world)))
        await _assert_queued(replay, "the replayed completion")

        worker.add(BlockchainReceipt(
            trip_id=world.trip_id, subject_type=SubjectType.PHASE_EVENT, subject_id=world.activation_id,
            receipt_type=BlockchainReceiptType.ACTIVATION, data_hash="0" * 64, payload_json={},
        ))
        await asyncio.wait_for(worker.flush(), _COMPLETION_TIMEOUT_SECONDS)
        await worker.commit()

    # The replay carries a fresh idempotency key against a resolved row: an idempotent 200.
    outcome = await asyncio.wait_for(asyncio.gather(replay, return_exceptions=True), _COMPLETION_TIMEOUT_SECONDS)
    assert not isinstance(outcome[0], BaseException), f"replay failed: {outcome[0]!r}"
