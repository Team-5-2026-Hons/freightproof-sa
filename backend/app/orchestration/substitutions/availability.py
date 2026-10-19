"""What a driver's availability looks like once a trip's driver can change (FP-83 C2).

Two facts the plain "trip.driver_id is busy" rule cannot express:

* A live trip occupies its CURRENT driver. Before a handover that is the driver of record; after
  it, the incoming driver, and the outgoing one is free from the effective transfer onward.
* A pending takeover RESERVES the incoming driver for [expected_at, planned end) of the trip they
  are about to take over, so nobody can promise that driver elsewhere while the exchange is
  arranged. An open-ended or overrun trip never promised an end, so its reservation stays open
  until the trip is closed or cancelled. A reservation whose exchange is overdue starts no later
  than now and stays effective until it is cancelled or completed - an exchange that has not
  happened yet is not a reason to release the driver (see reservation_window).

This module is the data and window rules only. trips/availability.py owns the clash detection
and imports from here, so this file must not import it (that would be a cycle).
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import DriverSubstitutionRequest
from app.db.models.trips import DriverSubstitution, Trip


@dataclass(frozen=True)
class PendingReservation:
    """The one pending takeover on a trip (the partial unique index allows at most one)."""

    request_id: uuid.UUID
    trip_id: uuid.UUID
    incoming_driver_id: uuid.UUID
    expected_at: datetime


async def current_driver_ids(db: AsyncSession, trips: Sequence[Trip]) -> dict[uuid.UUID, uuid.UUID]:
    """Current driver of each trip, in one query for any number of trips.

    The highest sequence_number's incoming driver, else the original driver. The same rule as
    `current_driver_id_expression`; this form serves callers that already hold the trips.
    """
    if not trips:
        return {}
    rows = await db.execute(
        select(DriverSubstitution.trip_id, DriverSubstitution.substituting_driver_id)
        .where(DriverSubstitution.trip_id.in_([trip.id for trip in trips]))
        .order_by(DriverSubstitution.trip_id, DriverSubstitution.sequence_number)
    )
    latest: dict[uuid.UUID, uuid.UUID] = {}
    for trip_id, incoming in rows:
        latest[trip_id] = incoming
    return {trip.id: latest.get(trip.id, trip.driver_id) for trip in trips}


async def pending_reservations(
    db: AsyncSession, trip_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, PendingReservation]:
    """Pending takeovers of the given trips, keyed by trip."""
    if not trip_ids:
        return {}
    rows = await db.execute(
        select(
            DriverSubstitutionRequest.id, DriverSubstitutionRequest.trip_id,
            DriverSubstitutionRequest.incoming_driver_id, DriverSubstitutionRequest.expected_at,
        ).where(DriverSubstitutionRequest.trip_id.in_(trip_ids), DriverSubstitutionRequest.state == "pending")
    )
    return {
        row.trip_id: PendingReservation(
            request_id=row.id, trip_id=row.trip_id, incoming_driver_id=row.incoming_driver_id,
            expected_at=row.expected_at,
        )
        for row in rows
    }


def reservation_window(
    *, expected_at: datetime, planned_end: datetime | None, now: datetime,
) -> tuple[datetime, datetime | None]:
    """The half-open [start, end) a pending takeover reserves; end None = until it is resolved.

    It starts at the expected exchange time. It ends at the trip's planned end, except that it
    stays open-ended when there is no planned end, when the trip has overrun it, when it does
    not come after the exchange, and once the exchange itself is overdue: a takeover that has
    not happened is not a reason to release the driver, so it holds until cancelled, completed
    or the trip terminates. An overdue reservation therefore never starts later than `now`.
    """
    overdue = expected_at <= now
    if overdue or planned_end is None or planned_end <= now or planned_end <= expected_at:
        return expected_at, None
    return expected_at, planned_end
