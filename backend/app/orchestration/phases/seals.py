"""Seal continuity helpers shared by departure and arrival."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import PhaseType
from app.db.models.phases import PhaseEvent


def _normalized_seal(seal: str) -> str:
    # Deliberately NOT Optional. None is not a single concept here: for a stored
    # phase_events.seal_number it means "seal unknown" (an anomaly), but for
    # payload.seal_number_confirmed it means "no guard re-entry", which is the
    # normal case and must never be flagged (see advance_departure). Swallowing
    # None here would let that second, far more common case silently become a
    # CRITICAL mismatch on every trip. Callers holding a nullable value resolve
    # what their own None means before calling.
    return seal.strip().upper()


async def _find_departure_for_leg(
    db: AsyncSession, *, trip_id: uuid.UUID, before_sequence: int,
) -> PhaseEvent:
    """The departure that opened the leg ending at `before_sequence`. Well-defined
    because the plan generator (phases.plan.build_phase_plan) interleaves exactly
    one `in_transit` between any departure and the unloading/confirmation that
    closes its leg — there is never a second departure to be confused with the
    right one.

    Caller contract: `before_sequence` must be the sequence_number of the
    closing phase's OWN row (the event being validated) — never a hardcoded
    or otherwise-derived reference. Passing the wrong row's sequence silently
    resolves the wrong leg's departure instead of raising."""
    result = await db.execute(
        select(PhaseEvent)
        .where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.phase_type == PhaseType.DEPARTURE,
            PhaseEvent.sequence_number < before_sequence,
        )
        .order_by(PhaseEvent.sequence_number.desc())
        .limit(1)
    )
    departure = result.scalar_one_or_none()
    if departure is None:
        raise ResourceNotFoundError("PhaseEvent", "departure")
    return departure
