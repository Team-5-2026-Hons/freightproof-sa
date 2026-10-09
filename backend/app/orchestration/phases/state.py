"""The ledger-to-position rule: which phase events count as resolved, and the cached
current_phase/current_stop rebuilt from them. The ledger is the truth; position is derived.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseStatus, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop


def _is_resolved(status: PhaseStatus) -> bool:
    # A phase blocks the NEXT phase only while PENDING/IN_PROGRESS. EXCEPTION is
    # resolved for gating purposes — it already happened, the trip already moved
    # on, and the anomaly is recorded on the row itself.
    #
    # No phase completion holds a trip any more: the last writer of
    # TripStatus.EXCEPTION_HOLD (advance_unloading's seal mismatch) was removed —
    # see the rationale on that branch. EXCEPTION_HOLD survives as a status only
    # for a future MANUAL dispatcher hold; nothing in app/ sets it today, so the
    # _gate_and_load check that reads it is currently unreachable.
    return status in (PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION, PhaseStatus.OVERRIDDEN)


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
