"""Ending a pending handover because its trip has ended (FP-83 C3).

A LEAF helper: it imports models and notices only, never the phase or trip services. Both
`trips.administration.cancel_trip` and `phases.completion._finish_phase` call it, and a cycle
back into either would stop the app importing.

The caller already holds the trip lock, which is what makes this safe against a handover being
confirmed or completed at the same moment: those take the same lock first, so exactly one of
"the handover completed" and "the trip ended" happens first. If the handover completed first
there is nothing pending here and the transfer stands; if the trip ended first, the arrangement
is cancelled in the same transaction, its reservation ends with it (availability reads pending
requests only), and both drivers get a notice. A failed transaction changes none of it.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import DriverSubstitutionRequest
from app.db.models.trips import Trip
from app.orchestration.substitutions.notices import notify_parties
from app.schemas.driver_substitutions import SubstitutionNoticeKind, SubstitutionState


def cancel_request(request: DriverSubstitutionRequest, *, reason: str, now: datetime) -> None:
    """Move a pending request to cancelled. Stored facts are never edited, only ended; the
    version advances so a stale client refetches."""
    request.state = SubstitutionState.CANCELLED.value
    request.terminal_reason = reason
    request.terminal_at = now
    request.version += 1


async def cancel_pending_for_terminal_trip(db: AsyncSession, *, trip: Trip, reason: str) -> None:
    """Cancel the trip's pending handover request, if any, and tell both drivers."""
    request = (await db.execute(
        select(DriverSubstitutionRequest)
        .where(DriverSubstitutionRequest.trip_id == trip.id, DriverSubstitutionRequest.state == SubstitutionState.PENDING.value)
        .with_for_update(key_share=True)
    )).scalar_one_or_none()
    if request is None:
        return
    cancel_request(request, reason=reason, now=trip.closed_at or datetime.now(UTC))
    await db.flush()
    await notify_parties(db, request=request, kind=SubstitutionNoticeKind.CANCELLED)
