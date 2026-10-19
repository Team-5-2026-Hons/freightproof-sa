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

`derive_custody` is the single definition of the rules and is unit-tested without a database.
`get_current_custody` feeds it from SQL. `current_driver_id_expression` is the SQL-only twin
for queries that must filter or join on the current driver in one statement; it cannot raise,
so it trusts the chain's constraints (unique sequence, no forks) and the agreement with
`derive_custody` is covered by an integration test on the same rows.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, SQLColumnExpression, func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
