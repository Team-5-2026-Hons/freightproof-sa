"""Activation-day rules: whether a trip may start today, and which other trips block it. These
read the DB; the name says what they decide, not that they are pure.
"""

import uuid
from datetime import UTC, date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import PhaseTooEarlyError, TripActivationBlockedError
from app.db.models.enums import TripStatus
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.trips.availability import (
    LIVE_STATUSES, CrewFilter, OccupyingTrip, lock_crew, occupying_trips,
)


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


async def _claim_crew_for_activation(db: AsyncSession, trip: Trip) -> None:
    """Refuse to start a trip while its driver, horse or a trailer is in use elsewhere (FP-139).

    Locks the crew first (after the trip lock _gate_and_load already holds: trip, then crew,
    the order every path uses), so two drivers starting two trips on one horse at the same
    instant are serialised and the second sees the first one ACTIVE.
    """
    trailer_ids = tuple((await db.execute(
        select(TripTrailer.trailer_id).where(TripTrailer.trip_id == trip.id)
    )).scalars().all())
    await lock_crew(db, driver_id=trip.driver_id, vehicle_ids=[trip.horse_id, *trailer_ids])
    crew = CrewFilter(
        driver_id=trip.driver_id, horse_id=trip.horse_id, trailer_ids=trailer_ids, exclude_trip_id=trip.id,
    )
    others = await occupying_trips(db, organization_id=trip.operator_organization_id, crew=crew)
    await _reject_if_another_trip_underway(db, trip, crew, others)
    # Start-in-order is about one driver's day (spec D10): a horse shared with another driver
    # must not let that driver's unstarted trip block this one.
    await _reject_if_an_earlier_trip_is_due(
        db, trip, [other.trip for other in others if other.trip.driver_id == trip.driver_id],
    )


async def _reject_if_another_trip_underway(
    db: AsyncSession, trip: Trip, crew: CrewFilter, others: list[OccupyingTrip],
) -> None:
    """One trip at a time, for the driver and for every vehicle.

    Nothing stops a dispatcher assigning overlapping trips from different days or before
    FP-139, and two trips claiming the same driver, horse or trailer at the same moment make the
    custody chain of both unprovable. ACTIVE and EXCEPTION_HOLD both count: a held trip is
    still the trip its crew is on. The driver is named first, then the horse, then a trailer, so
    the reason points at what the driver can most easily act on.
    """
    live = [other for other in others if other.trip.status in LIVE_STATUSES]
    for other in live:
        if other.trip.driver_id == trip.driver_id:
            raise TripActivationBlockedError(other.trip.trip_reference, "another trip is already underway")
    for other in live:
        if other.trip.horse_id == trip.horse_id:
            raise TripActivationBlockedError(
                other.trip.trip_reference,
                f"horse {await _registration(db, trip.horse_id)} is on another trip that is underway",
            )
    for other in live:
        shared = sorted(other.trailer_ids.intersection(crew.trailer_ids))
        if shared:
            raise TripActivationBlockedError(
                other.trip.trip_reference,
                f"trailer {await _registration(db, shared[0])} is on another trip that is underway",
            )


async def _registration(db: AsyncSession, vehicle_id: uuid.UUID) -> str:
    """The plate the driver can see on the vehicle, for the refusal message."""
    registration = await db.scalar(select(Vehicle.registration).where(Vehicle.id == vehicle_id))
    return registration or "unknown"


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
