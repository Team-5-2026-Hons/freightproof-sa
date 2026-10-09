"""Row loaders for the phase engine: the trip/phase-event lookups that enforce driver or
dispatcher ownership before any phase work. Named loaders, not loading, to avoid confusion
with the LOADING phase.
"""

import uuid

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip


def _lock_trip(statement: Select[tuple[Trip]]) -> Select[tuple[Trip]]:
    """Row-lock the trip so a phase write and cancel_trip cannot interleave.

    Without it a phase write that read an active trip could commit after a cancellation and
    overwrite CANCELLED (recompute_position writes CLOSED, advance_activation writes ACTIVE).
    Always taken before the PhaseEvent lock, so every path locks in the same order: a phase
    write and a cancellation queue behind each other but can never deadlock.

    FOR NO KEY UPDATE, not FOR UPDATE: the anchor worker holds a phase row and inserts a
    BlockchainReceipt, whose trip_id foreign key takes FOR KEY SHARE on the trip. FOR UPDATE
    conflicts with that, so a replayed completion (trip lock, then queue on the phase row)
    would deadlock with the worker. FOR NO KEY UPDATE still conflicts with cancel_trip's
    FOR UPDATE and with itself, which is all the serialisation needed here.
    """
    return statement.with_for_update(of=Trip, key_share=True)


async def _load_trip_for_driver(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, lock: bool = False,
) -> Trip:
    statement = select(Trip).where(Trip.id == trip_id, Trip.driver_id == driver_id)
    result = await db.execute(_lock_trip(statement) if lock else statement)
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return trip


async def _load_trip_for_dispatcher(
    db: AsyncSession, *, trip_id: uuid.UUID, operator_organization_id: uuid.UUID,
    lock: bool = False,
) -> Trip:
    """Dispatcher-scoped trip lookup — the override counterpart to _load_trip_for_driver.

    Filters by org, not driver: overriding a phase is a dispatcher action, and the
    org boundary is the caller's real authorisation scope. 404, never 403, on a
    trip belonging to another org — same no-existence-disclosure rule as everywhere
    else in this module.
    """
    statement = select(Trip).where(
        Trip.id == trip_id, Trip.operator_organization_id == operator_organization_id,
    )
    result = await db.execute(_lock_trip(statement) if lock else statement)
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return trip


async def _load_phase_event(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID,
) -> PhaseEvent:
    """The single load point every completion path (complete_phase's five
    advance_* wrappers, and override_phase) shares — which is why
    the lock below covers all of them from one place.

    Row-locked with FOR UPDATE. Two concurrent completions of the SAME
    phase both pass _gate_and_load's sequence gate and would both dispatch to
    Hedera before the partial unique index on idempotency_key ever fires —
    that index only fires at flush, which is AFTER the anchor has already been
    queued (_dispatch_anchor's after_commit hook), and a DB rollback cannot
    un-submit an on-chain message. The lock, not the index, is what stops the
    second submission from happening at all: the second transaction blocks
    here until the first commits, then re-reads this row as resolved and
    returns _gate_and_load's existing idempotent-replay 200 — no new code path.
    """
    result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.id == phase_event_id, PhaseEvent.trip_id == trip_id)
        .with_for_update()
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise ResourceNotFoundError("PhaseEvent", str(phase_event_id))
    return event
