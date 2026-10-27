"""Dispatcher-initiated changes to a trip that already exists. terminate_trip is the only code
in app/ that writes TripStatus.CANCELLED, reached two ways: cancel_trip, and an incident that
stops its trip (orchestration.incidents.creation). cancel_trip locks the trip row, records the acting
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
from app.orchestration.evidence_anchors.recording import register_exception
from app.orchestration.exceptions.review_policy import dispatcher_authored_review
from app.orchestration.substitutions.termination import cancel_pending_for_terminal_trip
from app.orchestration.trips.detail import get_trip_detail
from app.schemas.trips import TripDetailResponse


_CANCELLED_BY_PREFIX = "Cancelled by user "

TRIP_CANCELLED_REASON = "Trip cancelled"


async def cancel_trip(
    db: AsyncSession, *, trip_id: uuid.UUID, operator_organization_id: uuid.UUID,
    user_id: uuid.UUID, note: str,
) -> TripDetailResponse:
    """Dispatcher-only terminal exit for a trip abandoned mid-plan.

    Before this, nothing in app/ ever wrote TripStatus.CANCELLED — an abandoned
    trip (cargo pulled, vehicle broken down) sat ACTIVE forever, and worse,
    phases.scheduling._reject_if_another_trip_underway then blocked that crew from
    EVER activating another trip. Cancel is the only exit; it is also a promise
    the dispatcher wizard's confirmation modal already makes to the user.

    Raises ResourceNotFoundError (404) if the trip doesn't exist or belongs to a
    different org, and TripStateError (409) if it is already CLOSED or CANCELLED.
    """
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

    await terminate_trip(db, trip=trip, user_id=user_id, note=note)

    return await get_trip_detail(
        db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id,
    )


async def terminate_trip(db: AsyncSession, *, trip: Trip, user_id: uuid.UUID, note: str) -> None:
    """Write a trip's cancellation: status, closed_at, the pending handover, the ledger note and
    the realtime events. Shared by cancel_trip and an incident that stops its trip
    (orchestration.incidents), so both exits leave exactly the same record.

    The caller must already hold the trip row FOR UPDATE and have checked it is not CLOSED or
    CANCELLED: that check-then-write is what stops a racing retry writing a second ledger row.
    """
    closed_at = datetime.now(UTC)
    trip.status = TripStatus.CANCELLED
    trip.closed_at = closed_at
    await cancel_pending_for_terminal_trip(db, trip=trip, reason=TRIP_CANCELLED_REASON)

    await register_exception(db, TripException(
        trip_id=trip.id, exception_type=ExceptionType.DISPATCHER_NOTE,
        source=ExceptionSource.DISPATCHER, severity=ExceptionSeverity.WARNING,
        **dispatcher_authored_review(user_id=user_id, at=closed_at),
        description=f"{_CANCELLED_BY_PREFIX}{user_id}: {note}",
    ), cancelled_trip=trip)
    await db.flush()

    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(ExceptionSeverity.WARNING),
        ),
    )

    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=RealtimeKind.TRIP_CLOSED))
