"""Dispatcher-initiated changes to a trip that already exists. Today that is cancel_trip, the
only code in app/ that writes TripStatus.CANCELLED: it locks the trip row, records the acting
dispatcher on a DISPATCHER_NOTE exception (whose description starts with _CANCELLED_BY_PREFIX),
queues the realtime events and returns the trip detail read back after the write. Phase rows
are left as they were: the plan is abandoned, not completed.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError, TripStateError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType, TripStatus
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.orchestration.review_policy import dispatcher_authored_review
from app.orchestration.resource_service import get_trip_detail
from app.schemas.trips import TripDetailResponse


# Machine-findable marker for the acting dispatcher on a cancellation's ledger entry.
# A stable prefix, not free prose, so the actor stays greppable (and parseable by a
# future migration that moves it into a real raised_by_user_id column).
_CANCELLED_BY_PREFIX = "Cancelled by user "


async def cancel_trip(
    db: AsyncSession, *, trip_id: uuid.UUID, operator_organization_id: uuid.UUID,
    user_id: uuid.UUID, note: str,
) -> TripDetailResponse:
    """Dispatcher-only terminal exit for a trip abandoned mid-plan.

    Before this, nothing in app/ ever wrote TripStatus.CANCELLED — an abandoned
    trip (cargo pulled, vehicle broken down) sat ACTIVE forever, and worse,
    phase_service._reject_if_another_trip_underway then blocked that driver from
    EVER activating another trip. Cancel is the only exit; it is also a promise
    the dispatcher wizard's confirmation modal already makes to the user.

    Raises ResourceNotFoundError (404) if the trip doesn't exist or belongs to a
    different org, and TripStateError (409) if it is already CLOSED or CANCELLED.
    """
    # Serialize the terminal-state check so a racing retry observes the first
    # cancellation instead of writing a second ledger row and realtime alert.
    result = await db.execute(
        select(Trip).where(
            Trip.id == trip_id, Trip.operator_organization_id == operator_organization_id,
        ).with_for_update(of=Trip)
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED):
        raise TripStateError(current_status=TripStatus(trip.status).value, attempted_action="cancel")

    trip.status = TripStatus.CANCELLED
    trip.closed_at = datetime.now(UTC)

    # Phase rows are deliberately left untouched — they stay whatever they were
    # (most still PENDING), which is the honest record of a plan abandoned partway
    # through. Cancelling is not completing, so nothing here marks them resolved.
    #
    # recompute_position() is deliberately NOT called either: it derives the
    # position of a plan that is no longer being walked, and its close-branch
    # would overwrite this CANCELLED write with CLOSED — a trap a future reader
    # chasing "why isn't the trip cancelled any more" would otherwise walk into.

    # The human intervention lands on the ledger, not just in an audit column.
    #
    # The acting dispatcher is carried in the description rather than a column
    # because TripException has no raised_by_user_id — only reviewed_by_user_id.
    # override_phase escapes this via PhaseEvent.dispatcher_override_user_id, but a
    # cancellation has no phase row to hang an actor on, and an anonymous "this trip
    # was abandoned" record is exactly the kind of unattributable evidence this
    # platform exists to avoid. Deliberate no-migration stopgap: the proper fix is a
    # raised_by_user_id column, which is a schema change and its own task.
    # Reviewed by its author at creation (FP-280) — see review_policy.
    db.add(TripException(
        trip_id=trip.id, exception_type=ExceptionType.DISPATCHER_NOTE,
        source=ExceptionSource.DISPATCHER, severity=ExceptionSeverity.WARNING,
        **dispatcher_authored_review(user_id=user_id, at=trip.closed_at),
        description=f"{_CANCELLED_BY_PREFIX}{user_id}: {note}",
    ))
    await db.flush()

    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(ExceptionSeverity.WARNING),
        ),
    )

    # Published on commit — the dispatcher's list must drop this trip from
    # Active on the same refetch trip_closed already triggers.
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=RealtimeKind.TRIP_CLOSED))

    return await get_trip_detail(
        db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id,
    )
