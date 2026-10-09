"""Activation-day rules: whether a trip may start today, and which other trips block it. These
read the DB; the name says what they decide, not that they are pure.
"""

from datetime import UTC, date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import PhaseTooEarlyError, TripActivationBlockedError
from app.db.models.enums import TripStatus
from app.db.models.trips import Trip, TripStop


# Display format for the date a driver is told to come back on. Day-month-year with a
# full month name: unambiguous to a South African reader, and never confusable with the
# US month-first ordering the way a numeric date would be.
_SCHEDULED_DATE_FORMAT = "%d %B %Y"


def operating_day(moment: datetime) -> date:
    """The calendar date `moment` falls on in the operator's local timezone.

    A naive datetime is read as UTC rather than left to .astimezone()'s default, which
    would interpret it as the SERVER's local time — making the same trip activatable or
    not depending on which machine happened to answer the request.
    """
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    local = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))
    return moment.astimezone(local).date()


def is_before_scheduled_day(now: datetime, scheduled: datetime) -> bool:
    """True when `now` falls on an EARLIER operating day than `scheduled`.

    Strictly earlier, so any time on the scheduled day passes — a 04:00 start against an
    08:00 slot is a driver ahead of schedule, not a driver on the wrong day. Activating
    LATE is never blocked either: a delayed trip still needs its evidence captured, and
    refusing it would only push the driver to work around the system entirely.
    """
    return operating_day(now) < operating_day(scheduled)


async def _scheduled_departure(db: AsyncSession, trip: Trip) -> datetime | None:
    """When the trip is due to start: the trip-level plan, else its first booked stop.

    The fallback exists because planned_departure_at is nullable and a multi-stop trip
    can carry its timing entirely on the stops. Ordered by stop sequence — the earliest
    stop that actually has a slot is the one activation is measured against, since
    activation happens at the origin gate.
    """
    if trip.planned_departure_at is not None:
        return trip.planned_departure_at

    result = await db.execute(
        select(TripStop.slot_time)
        .where(TripStop.trip_id == trip.id, TripStop.slot_time.is_not(None))
        .order_by(TripStop.sequence)
        .limit(1)
    )
    return result.scalars().first()


async def _reject_if_not_due(db: AsyncSession, trip: Trip) -> None:
    """Block activation of a trip before the day it is scheduled to run.

    Deliberately enforced here and NOT in _gate_and_load: that gate runs for every phase,
    and a trip that legitimately runs overnight would have its departure/unloading phases
    rejected the following day. Only the act of STARTING a trip is date-sensitive.

    Also deliberately after _gate_and_load in the caller, so an idempotent replay of an
    already-completed activation still short-circuits to 200 and never begins failing
    "too early" — a queued offline submission resent days later must not be rejected for
    the very schedule it already satisfied.
    """
    scheduled = await _scheduled_departure(db, trip)
    if scheduled is None:
        # No schedule at all is treated as not-yet-due rather than always-allowed: an
        # unscheduled trip is a dispatcher data gap, and letting it activate would mean
        # the rule silently does nothing on exactly the records least under control.
        raise PhaseTooEarlyError(None, "Activation")

    if is_before_scheduled_day(datetime.now(UTC), scheduled):
        raise PhaseTooEarlyError(
            operating_day(scheduled).strftime(_SCHEDULED_DATE_FORMAT).lstrip("0"), "Activation",
        )


async def _other_trips_for_driver(db: AsyncSession, trip: Trip) -> list[Trip]:
    """Every other non-terminal trip assigned to this trip's driver.

    Terminal trips are excluded because they cannot obstruct anything — a closed or
    cancelled trip is history, and counting it would mean a driver's very first completed
    trip permanently blocked their second.
    """
    result = await db.execute(
        select(Trip).where(
            Trip.driver_id == trip.driver_id,
            Trip.id != trip.id,
            Trip.status.notin_((TripStatus.CLOSED, TripStatus.CANCELLED)),
        )
    )
    return list(result.scalars().all())


def _reject_if_another_trip_underway(others: list[Trip]) -> None:
    """One trip at a time: a trip already underway blocks starting any other.

    Nothing at trip creation stops a dispatcher assigning a driver two overlapping trips,
    and until now nothing stopped the driver activating both — leaving two trips claiming
    the same driver, horse and trailers at the same moment, which makes the custody chain
    of both unprovable. ACTIVE and EXCEPTION_HOLD both count: a held trip is still the
    trip the driver is on, it is merely blocked from advancing.
    """
    for other in others:
        if other.status in (TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD):
            raise TripActivationBlockedError(
                other.trip_reference, "another trip is already underway"
            )


async def _reject_if_an_earlier_trip_is_due(
    db: AsyncSession, trip: Trip, others: list[Trip]
) -> None:
    """Within one operating day, trips must be started in departure order.

    Scoped to the SAME operating day on purpose. Trips on other days are already governed
    by _reject_if_not_due, and widening this rule across days would let a trip that was
    never run last week permanently block today's work until a dispatcher cancelled it.

    A trip with no resolvable schedule is skipped rather than assumed earliest: it cannot
    be activated at all (_reject_if_not_due rejects it outright), so it has no business
    blocking a properly scheduled trip on its way through.
    """
    scheduled = await _scheduled_departure(db, trip)
    if scheduled is None:
        return
    day = operating_day(scheduled)

    earliest: Trip | None = None
    earliest_at: datetime | None = None
    for other in others:
        if other.status != TripStatus.CREATED:
            continue
        other_scheduled = await _scheduled_departure(db, other)
        if other_scheduled is None or operating_day(other_scheduled) != day:
            continue
        if other_scheduled >= scheduled:
            continue
        if earliest_at is None or other_scheduled < earliest_at:
            earliest, earliest_at = other, other_scheduled

    if earliest is not None:
        raise TripActivationBlockedError(
            earliest.trip_reference, "an earlier trip today has to be started first"
        )
