"""Whether an incoming driver may take a trip over (FP-83 C3).

Two moments, deliberately different:

* ARRANGING (or replacing): account active, licence valid on the expected exchange date, and the
  driver free for the reservation window. Identity is not required: an arrangement may be saved
  with a truthful PENDING/FAILED status, it just grants no custody.
* COMPLETING: the same account, licence and availability questions asked again against the
  ACTUAL server time, then identity. Whichever fails first in the contract's fixed order is the
  one reported, so a client always sees one deterministic reason.

A licence is valid through the end of its expiry date in Africa/Johannesburg; there is no
override. These rules are substitution-specific and do not change baseline trip activation.
"""

import uuid
from datetime import date, datetime
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    IncomingDriverInactiveError, IncomingDriverUnavailableError, LicenceInvalidError,
)
from app.db.models.enums import IdvsStatus
from app.db.models.people import Driver
from app.db.models.trips import Trip
from app.orchestration.substitutions.availability import reservation_window
from app.orchestration.trips.availability import CrewFilter, TimeWindow, busy_crew_in_window
from app.schemas.driver_substitutions import SubstitutionCompletionBlocker

SAST = ZoneInfo("Africa/Johannesburg")


def sast_date(moment: datetime) -> date:
    """The calendar date of `moment` in South Africa."""
    return moment.astimezone(SAST).date()


def licence_valid_on(expiry: date | None, on: datetime) -> bool:
    """Valid through the whole of the expiry date (SAST). No expiry on file is not valid."""
    return expiry is not None and expiry >= sast_date(on)


async def _is_busy(
    db: AsyncSession, *, trip: Trip, driver_id: uuid.UUID, window: TimeWindow, now: datetime,
) -> bool:
    """Is the driver committed to another trip at some point in the half-open `window`?

    This trip is excluded: its own occupancy of the outgoing driver is exactly what the handover
    is releasing.
    """
    busy = await busy_crew_in_window(
        db, organization_id=trip.operator_organization_id, window=window, now=now,
        crew=CrewFilter(driver_id=driver_id, exclude_trip_id=trip.id),
    )
    return any(entry.resource_id == driver_id for entry in busy)


def _takeover_window(trip: Trip, *, now: datetime) -> TimeWindow:
    """What a completed handover occupies: from now to the trip's planned end, or open-ended
    when there is none or the trip has overrun it. Deliberately not `reservation_window`: that
    keeps an overdue RESERVATION open-ended so nobody promises the driver elsewhere while the
    exchange is outstanding, whereas the completed transfer holds the driver only for the trip."""
    planned_end = trip.planned_arrival_at
    return TimeWindow(now, planned_end if planned_end is not None and planned_end > now else None)


@dataclass(frozen=True)
class ArrangementTiming:
    expected_at: datetime | None
    now: datetime
    request_format: str = "planned_v1"
    reservation_start_at: datetime | None = None


async def require_arrangeable(
    db: AsyncSession, *, trip: Trip, incoming: Driver, timing: ArrangementTiming,
) -> None:
    """Raise the contract's refusal when `incoming` cannot be arranged for `expected_at`.

    Same precedence as completion: inactive, licence, then availability.
    """
    expected_at, now = timing.expected_at, timing.now
    request_format, reservation_start_at = timing.request_format, timing.reservation_start_at
    if request_format != "immediate_v2" and expected_at is None:
        raise ValueError("Legacy arrangement requires its expected exchange time")
    if not incoming.is_active:
        raise IncomingDriverInactiveError()
    if not licence_valid_on(incoming.license_expiry, expected_at if expected_at is not None else now):
        raise LicenceInvalidError()
    start, end = reservation_window(
        expected_at=expected_at, planned_end=trip.planned_arrival_at, now=now,
        request_format=request_format, reservation_start_at=reservation_start_at,
    )
    if await _is_busy(db, trip=trip, driver_id=incoming.id, window=TimeWindow(start, end), now=now):
        raise IncomingDriverUnavailableError()


async def first_completion_blocker(
    db: AsyncSession, *, trip: Trip, incoming: Driver, now: datetime, identity_attested: bool,
) -> SubstitutionCompletionBlocker | None:
    """The first reason custody cannot transfer at `now`, in the contract's fixed order.

    `identity_attested` is True only when an admin has recorded an unavailable-identity
    exception for a PENDING driver. It never helps a FAILED driver.
    """
    if not incoming.is_active:
        return SubstitutionCompletionBlocker.INCOMING_DRIVER_INACTIVE
    if not licence_valid_on(incoming.license_expiry, now):
        return SubstitutionCompletionBlocker.LICENCE_INVALID
    if await _is_busy(db, trip=trip, driver_id=incoming.id, window=_takeover_window(trip, now=now), now=now):
        return SubstitutionCompletionBlocker.DRIVER_UNAVAILABLE
    status = IdvsStatus(incoming.idvs_status)
    if status is IdvsStatus.VERIFIED or (status is IdvsStatus.PENDING and identity_attested):
        return None
    return SubstitutionCompletionBlocker.IDENTITY_NOT_VERIFIED
