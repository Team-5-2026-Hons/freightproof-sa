"""WI-27 item 5: two concurrent completions of one phase row produce one completion.

Characterisation for WI-21/WI-22. The trip row lock (taken in _gate_and_load before the phase
row is read) serialises the pair: the loser re-reads the row as COMPLETED and replays instead of
completing again. WI-22 adds savepoints on this path, so this pins what must still hold
afterwards: one stamp, one anchor dispatch, no extra rows.

Why not the `db_session` fixture: two sessions inside one transaction have no lock to wait on.
The committed-world builder and the park-and-release `Hold` come from
test_trip_cancel_concurrency.py, which explains the technique.
"""

import asyncio
from collections.abc import AsyncGenerator
from typing import Any

import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.orchestration.phases.anchor_dispatch import _BACKGROUND_ANCHOR_TASKS
from app.tasks.blockchain import anchor_phase_event_task

from tests.integration.test_trip_cancel_concurrency import (
    Hold,
    World,
    _assert_queued,
    _build_world,
    _committed,
    _complete_activation,
    _tear_down,
)

_COMPLETION_TIMEOUT_SECONDS = 10


@pytest_asyncio.fixture
async def phase_sessionmaker(test_engine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(test_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def open_world(phase_sessionmaker) -> AsyncGenerator[World, None]:
    """Activation is open and LOADING follows it, so completing activation leaves the trip ACTIVE."""
    world = await _build_world(phase_sessionmaker, trailing_phase=PhaseType.LOADING)
    yield world
    await _tear_down(world)


async def _drain_anchor_dispatch() -> None:
    while _BACKGROUND_ANCHOR_TASKS:
        await asyncio.gather(*tuple(_BACKGROUND_ANCHOR_TASKS))


async def test_two_concurrent_completions_of_one_phase_complete_it_once(
    phase_sessionmaker, open_world, monkeypatch,
) -> None:
    """The first caller is parked mid-completion; the second must queue behind it, then replay.

    Each call carries its own idempotency key, as a driver resending after a timeout would, so
    the guard under test is the resolved-row replay rather than the key.
    """
    world = open_world
    anchor_phase_event_task.delay.reset_mock()
    hold = Hold()
    monkeypatch.setattr("app.orchestration.evidence.corroboration.record_phase_corroboration", hold.step)
    first = asyncio.create_task(_committed(phase_sessionmaker, _complete_activation(world)))
    second: asyncio.Task[Any] | None = None
    try:
        await asyncio.wait_for(hold.entered.wait(), _COMPLETION_TIMEOUT_SECONDS)
        second = asyncio.create_task(_committed(phase_sessionmaker, _complete_activation(world)))

        await _assert_queued(second, "the second completion")
    finally:
        hold.release.set()
        outcomes = await asyncio.wait_for(
            asyncio.gather(first, *([second] if second else []), return_exceptions=True),
            _COMPLETION_TIMEOUT_SECONDS,
        )
    await _drain_anchor_dispatch()

    assert not any(isinstance(o, BaseException) for o in outcomes), f"unexpected failure: {outcomes!r}"
    async with phase_sessionmaker() as db:
        activation = (await db.execute(select(PhaseEvent).where(PhaseEvent.id == world.activation_id))).scalar_one()
        trip_status = (await db.execute(select(Trip.status).where(Trip.id == world.trip_id))).scalar_one()
        exceptions = (await db.execute(
            select(func.count()).select_from(TripException).where(TripException.trip_id == world.trip_id)
        )).scalar_one()
        phase_rows = (await db.execute(
            select(func.count()).select_from(PhaseEvent).where(PhaseEvent.trip_id == world.trip_id)
        )).scalar_one()
    assert activation.status == PhaseStatus.COMPLETED
    assert activation.completed_at is not None
    assert TripStatus(trip_status) == TripStatus.ACTIVE
    assert exceptions == 0
    assert phase_rows == 3
    anchor_phase_event_task.delay.assert_called_once()
    assert anchor_phase_event_task.delay.call_args.args[0] == str(world.activation_id)
