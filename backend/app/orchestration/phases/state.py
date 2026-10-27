"""The ledger-to-position rule: which phase events count as resolved, and the cached
current_phase/current_stop rebuilt from them. The ledger is the truth; position is derived.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop


RESOLVED_PHASE_STATUSES = frozenset({PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION, PhaseStatus.OVERRIDDEN})


def _is_resolved(status: PhaseStatus) -> bool:
    return status in RESOLVED_PHASE_STATUSES


async def first_unresolved_earlier_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, sequence_number: int,
) -> PhaseType | None:
    """The earliest phase below `sequence_number` that is still open, or None.

    The one ordering rule behind both the driver's completion gate and the dispatcher's
    override: a phase may only be decided once everything before it in the plan has been.
    """
    result = await db.execute(
        select(PhaseEvent.phase_type, PhaseEvent.status)
        .where(PhaseEvent.trip_id == trip_id, PhaseEvent.sequence_number < sequence_number)
        .order_by(PhaseEvent.sequence_number)
    )
    for phase_type, status in result.all():
        if not _is_resolved(PhaseStatus(status)):
            return PhaseType(phase_type)
    return None


async def recompute_position(db: AsyncSession, trip: Trip) -> None:
    """Recomputes trip.current_phase/current_stop from the ledger. Public because
    create_trip must seed the cache the moment the plan exists — before this, a
    freshly created trip reported current_phase = NULL until its first advance.

    trip_stop_id is a FK, not the sequence int the cache wants — the join to
    TripStop.sequence is why this can't be a plain PhaseEvent-only query.
    """
    result = await db.execute(
        select(PhaseEvent.phase_type, PhaseEvent.status, TripStop.sequence)
        .outerjoin(TripStop, TripStop.id == PhaseEvent.trip_stop_id)
        .where(PhaseEvent.trip_id == trip.id)
        .order_by(PhaseEvent.sequence_number)
    )
    for phase_type, status, stop_sequence in result.all():
        if not _is_resolved(PhaseStatus(status)):
            trip.current_phase = phase_type
            trip.current_stop = stop_sequence
            return
    trip.current_phase = None
    trip.current_stop = None
    trip.status = TripStatus.CLOSED
    trip.closed_at = datetime.now(UTC)
