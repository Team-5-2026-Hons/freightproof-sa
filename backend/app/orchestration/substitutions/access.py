"""Who holds a trip: current custody derived from the ordered chain of completed handovers.

`Trip.driver_id` is the journey lock's original driver and never changes. Custody moves only
when a `DriverSubstitution` row is completed, so the current driver is the incoming driver of
the highest `sequence_number`, or the original driver when there are none. Pending and
cancelled `DriverSubstitutionRequest` rows are never read here.

Ordering is by `sequence_number`, never by timestamp: two handovers can share an instant,
and a device-claimed time can contradict the server's order. A chain that does not hold
together (a gap, a wrong previous link, an outgoing driver who is not the current holder)
raises `CustodyChainError`; it is never repaired, because guessing who held evidence is the
failure this module exists to prevent.

`require_current_driver` and `authorise_driver_write` are the one gate every driver-facing trip
read and write goes through (FP-83 C2); see their docstrings for the lock order and the rule
that authority is decided after the trip lock, never from an earlier read.

`derive_custody` is the single definition of the rules and is unit-tested without a database.
`get_current_custody` feeds it from SQL. `current_driver_id_expression` is the SQL-only twin
for queries that must filter or join on the current driver in one statement; it cannot raise,
so it trusts the chain's constraints (unique sequence, no forks) and the agreement with
`derive_custody` is covered by an integration test on the same rows.
"""

import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, Select, SQLColumnExpression, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    CustodyAccessError, CustodyContextChangedError, CustodyContextRequiredError,
    EvidenceAlreadyRecordedError, ResourceNotFoundError, TripHandedOverError,
)
from app.db.models.trips import DriverSubstitution, Trip

# Custody period of the trip's original driver, who has no DriverSubstitution row.
ORIGINAL_CUSTODY_SEQUENCE = 0


class CustodyChainError(Exception):
    """A trip's completed handovers do not form one unbroken chain."""


@dataclass(frozen=True, slots=True)
class CurrentCustody:
    """Who holds the trip now. `substitution_id` is None until the first handover."""

    driver_id: uuid.UUID
    sequence: int
    substitution_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class CompletedCustodyLink:
    """One completed handover. Pending requests are never passed in as links.

    `effective_at` is carried for callers that display or audit it; derivation ignores it
    on purpose (see the module docstring).
    """

    id: uuid.UUID
    sequence_number: int
    previous_substitution_id: uuid.UUID | None
    outgoing_driver_id: uuid.UUID
    incoming_driver_id: uuid.UUID
    effective_at: datetime


def derive_custody(
    original_driver_id: uuid.UUID, completed: Sequence[CompletedCustodyLink],
) -> CurrentCustody:
    """Resolve current custody from completed links, whatever order they arrive in."""
    ordered = sorted(completed, key=lambda link: link.sequence_number)
    if [link.sequence_number for link in ordered] != list(range(1, len(ordered) + 1)):
        raise CustodyChainError(
            f"sequence numbers must run 1..{len(ordered)} without gaps or repeats, "
            f"got {[link.sequence_number for link in ordered]}"
        )

    holder = original_driver_id
    previous_id: uuid.UUID | None = None
    for link in ordered:
        if link.previous_substitution_id != previous_id:
            raise CustodyChainError(
                f"substitution {link.id} (sequence {link.sequence_number}) names previous link "
                f"{link.previous_substitution_id}, expected {previous_id}"
            )
        if link.outgoing_driver_id != holder:
            raise CustodyChainError(
                f"substitution {link.id} (sequence {link.sequence_number}) has outgoing driver "
                f"{link.outgoing_driver_id} but the holder at that point is {holder}"
            )
        holder, previous_id = link.incoming_driver_id, link.id

    return CurrentCustody(
        driver_id=holder,
        sequence=ordered[-1].sequence_number if ordered else ORIGINAL_CUSTODY_SEQUENCE,
        substitution_id=previous_id,
    )


async def _completed_links(db: AsyncSession, *, trip_id: uuid.UUID) -> list[CompletedCustodyLink]:
    rows = await db.execute(
        select(
            DriverSubstitution.id,
            DriverSubstitution.sequence_number,
            DriverSubstitution.previous_substitution_id,
            DriverSubstitution.original_driver_id,
            DriverSubstitution.substituting_driver_id,
            DriverSubstitution.substitution_at,
        )
        .where(DriverSubstitution.trip_id == trip_id)
        .order_by(DriverSubstitution.sequence_number)
    )
    return [
        CompletedCustodyLink(
            id=row.id,
            sequence_number=row.sequence_number,
            previous_substitution_id=row.previous_substitution_id,
            outgoing_driver_id=row.original_driver_id,
            incoming_driver_id=row.substituting_driver_id,
            effective_at=row.substitution_at,
        )
        for row in rows
    ]


async def get_current_custody(db: AsyncSession, *, trip: Trip) -> CurrentCustody:
    """Current custody of `trip`, read fresh from the completed chain."""
    return derive_custody(trip.driver_id, await _completed_links(db, trip_id=trip.id))


def current_driver_id_expression(
    *,
    trip_id: SQLColumnExpression[uuid.UUID],
    original_driver_id: SQLColumnExpression[uuid.UUID],
) -> ColumnElement[uuid.UUID]:
    """SQL for "the driver who holds this trip now", for use inside another statement.

    Correlates on `trip_id`: pass `Trip.id` (and `Trip.driver_id`) from a query that already
    selects from trips. The latest link is found through the (trip_id, sequence_number)
    unique index.
    """
    latest_incoming = (
        select(DriverSubstitution.substituting_driver_id)
        .where(DriverSubstitution.trip_id == trip_id)
        .order_by(DriverSubstitution.sequence_number.desc())
        .limit(1)
        .scalar_subquery()
    )
    return func.coalesce(latest_incoming, original_driver_id)


async def participant_driver_ids(db: AsyncSession, *, trip_id: uuid.UUID) -> set[uuid.UUID]:
    """Every driver who has held the trip: the original driver and each handover's drivers.

    A driver named only on a pending request has held nothing and is not included.
    """
    original = (await db.execute(select(Trip.driver_id).where(Trip.id == trip_id))).scalar_one_or_none()
    if original is None:
        return set()

    participants = {original}
    rows = await db.execute(
        select(DriverSubstitution.original_driver_id, DriverSubstitution.substituting_driver_id)
        .where(DriverSubstitution.trip_id == trip_id)
    )
    for outgoing, incoming in rows:
        participants.update((outgoing, incoming))
    return participants


# ── the access gate ──────────────────────────────────────────────────────────

# Finds the evidence record this same driver already had accepted for the request being
# retried (bound to actor and idempotency key), or None. Called lazily, only when the request
# would otherwise be refused, so the common path costs nothing.
ReplayFinder = Callable[[], Awaitable[uuid.UUID | None]]


def lock_trip_statement(statement: Select[tuple[Trip]]) -> Select[tuple[Trip]]:
    """Row-lock the trip so a driver write, a handover, a cancellation and an activation queue
    behind one another.

    FOR NO KEY UPDATE, not FOR UPDATE: the anchor worker holds a phase row and inserts a
    BlockchainReceipt, whose trip_id foreign key takes FOR KEY SHARE on the trip. FOR UPDATE
    conflicts with that and would deadlock a replayed completion with the worker; FOR NO KEY
    UPDATE still conflicts with itself and with cancel_trip's FOR UPDATE, which is all the
    serialisation needed. Every lock the feature takes uses this mode (trip, then drivers and
    vehicles in sorted id order, then the request, then phase rows).
    """
    return statement.with_for_update(of=Trip, key_share=True)


async def lock_trip(db: AsyncSession, *, trip_id: uuid.UUID) -> Trip:
    """Take the trip lock and return the row. 404 when the trip does not exist."""
    trip = (await db.execute(lock_trip_statement(select(Trip).where(Trip.id == trip_id)))).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return trip


def check_custody_sequence(custody: CurrentCustody, claimed: int | None) -> CustodyAccessError | None:
    """The refusal for a capture whose custody period is not the current one, or None.

    An omitted sequence is accepted only while the trip has never changed driver (sequence 0),
    which keeps clients that predate substitutions working. After any handover a missing
    sequence cannot be attributed to a period, and a stale one is refused even when the
    caller is the current driver again (A -> B -> A): the capture belongs to A's first period.
    """
    if claimed is None:
        return None if custody.sequence == ORIGINAL_CUSTODY_SEQUENCE else CustodyContextRequiredError()
    return None if claimed == custody.sequence else CustodyContextChangedError()


async def _resolve_custody(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, lock: bool,
) -> tuple[Trip, CurrentCustody]:
    """Trip and fresh custody for a driver who has held the trip; 404 for anyone else.

    The participant check is an unlocked pre-screen, there so a stranger (or a driver only
    named on a pending request) gets the same 404 as for a missing trip and can never queue a
    lock on a trip that is not theirs. It is monotone - nobody stops being a participant - so
    it cannot go stale in a harmful way. Who holds the trip NOW is decided only after the lock
    is granted, in a fresh statement: a request that queued behind a handover must see it.
    """
    if driver_id not in await participant_driver_ids(db, trip_id=trip_id):
        raise ResourceNotFoundError("Trip", str(trip_id))
    if lock:
        trip = await lock_trip(db, trip_id=trip_id)
    else:
        trip = (await db.execute(select(Trip).where(Trip.id == trip_id))).scalar_one_or_none()
        if trip is None:
            raise ResourceNotFoundError("Trip", str(trip_id))
    return trip, await get_current_custody(db, trip=trip)


async def require_current_driver(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, lock: bool = False,
) -> Trip:
    """The trip, provided `driver_id` is the one holding it now.

    404 for a driver who never held it (including one only named on a pending request);
    TripHandedOverError for one who held it earlier. With `lock=True` the trip is locked first
    and custody resolved afterwards, which is what a write must use.
    """
    trip, custody = await _resolve_custody(db, trip_id=trip_id, driver_id=driver_id, lock=lock)
    if custody.driver_id != driver_id:
        raise TripHandedOverError()
    return trip


@dataclass(frozen=True, slots=True)
class WriteClaim:
    """What the caller says about the write: the custody period it was captured in, and how to
    recognise an exact retry of an action this driver already had accepted."""

    custody_sequence: int | None
    find_replay: ReplayFinder | None = None


async def authorise_driver_write(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, claim: WriteClaim, lock: bool = True,
) -> tuple[Trip, CurrentCustody]:
    """Lock the trip and decide whether this driver may write to it now.

    `lock=False` is a fail-fast pre-check for a write that does slow I/O before it inserts
    (an artifact upload to Storage): holding the trip lock across a network call would stall
    every other write on the trip. Such a caller MUST call again with the lock just before it
    writes - the unlocked answer can be stale by then.

    Order, each step after the trip lock: former driver -> an exact retry of their own accepted
    action is acknowledged (EvidenceAlreadyRecordedError) and anything else is TripHandedOver;
    current driver -> a stale or missing sequence is refused UNLESS the request is an exact
    retry of an action already accepted, which the writer then answers from the stored record.
    `find_replay` must match on the caller's own id and the request's idempotency key, so one
    driver's key is never acknowledged for another.
    """
    trip, custody = await _resolve_custody(db, trip_id=trip_id, driver_id=driver_id, lock=lock)
    if custody.driver_id != driver_id:
        recorded = await claim.find_replay() if claim.find_replay is not None else None
        if recorded is not None:
            raise EvidenceAlreadyRecordedError(recorded)
        raise TripHandedOverError()
    refusal = check_custody_sequence(custody, claim.custody_sequence)
    if refusal is not None and not (claim.find_replay is not None and await claim.find_replay() is not None):
        raise refusal
    return trip, custody
