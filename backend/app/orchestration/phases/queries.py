"""Read side of the phase ledger: the driver's current and next phase event, and the full phase
list for a trip.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseStatus
from app.db.models.phases import PhaseEvent
from app.orchestration.phases.loaders import _load_trip_for_driver
from app.orchestration.phases.state import _is_resolved


async def current_phase_event(db: AsyncSession, trip_id: uuid.UUID) -> PhaseEvent | None:
    """The phase row a trip is sitting on right now — the same ledger walk
    recompute_position does, returning the row itself instead of caching its type and
    stop onto the trip.

    Exists so an event that happens OUTSIDE a phase completion — a panic hold, a
    breakdown — can still be tagged with the phase it happened during. Every
    TripException this module writes already carries phase_event_id because it has an
    `event` in hand; the driver-raised ones (exception_service) have no such handle and
    were landing untagged, which pushed placement onto the dispatcher's render-time
    fallback and let an exception appear to move between phases as the trip advanced.

    Falls back to the highest-sequence row once every phase is resolved: on a closed
    trip nothing is unresolved, and confirmation is genuinely where the trip is — that
    is placement, not a guess. Returns None only for a trip with no plan at all.

    Resolved by sequence_number, never by matching on phase_type: a cross-dock plan
    carries one in_transit row per leg and only the ordering identifies the right one.
    """
    result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number)
    )
    events = list(result.scalars().all())
    for event in events:
        if not _is_resolved(PhaseStatus(event.status)):
            return event
    return events[-1] if events else None


async def next_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
) -> PhaseEvent | None:
    """The lowest-sequence unresolved row.

    Re-derived from the ledger, never read off trip.current_phase: the cache is a
    cache, and if it ever diverges this endpoint tells the truth
    instead of laundering the divergence. Returns None for a closed trip.
    """
    await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number)
    )
    for event in result.scalars().all():
        if not _is_resolved(PhaseStatus(event.status)):
            return event
    return None


async def list_phases(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
) -> list[PhaseEvent]:
    """The trip's committed plan, in plan order. Length is data — never sliced,
    never padded to six."""
    await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number)
    )
    return list(result.scalars().all())
