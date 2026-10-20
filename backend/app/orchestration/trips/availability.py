"""Who is busy when: the one rule every caller uses to decide whether a driver, horse or trailer is
free (FP-139, FP-142).

Trip creation refuses a clash with it. Activation reads the same occupying trips. The trip wizard's
availability read greys out exactly what creation would refuse. One definition, so the screen and
the server can never disagree about a clash.

The rule (spec 2026-10-14 D3-D5):
  * a trip occupies its driver, horse and trailers while it is CREATED, ACTIVE or EXCEPTION_HOLD;
  * its window starts at the planned departure (else its first timed stop) and ends at the planned
    arrival (else its last timed stop after the start);
  * windows are half-open [start, end), so a trip ending at 16:00 and one starting at 16:00 do not
    clash;
  * a live trip that has overrun its planned end, or any trip with no end at all, is busy until it
    is closed or cancelled. Nobody can promise when a truck still on the road comes back.

FP-83: a live trip occupies its CURRENT driver (the highest completed handover's incoming driver),
and a pending takeover reserves the incoming driver from the exchange time to the trip's end. The
rules for both live in orchestration/substitutions/availability.py.

Layering: a leaf of trips/ (imports core/, db/, schemas/ and orchestration/substitutions only), so
phases.scheduling can use it without a cycle.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.enums import TripStatus
from app.db.models.driver_substitutions import DriverSubstitutionRequest
from app.db.models.people import Driver
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.substitutions.access import current_driver_id_expression
from app.orchestration.substitutions.availability import (
    PendingReservation, current_driver_ids, pending_reservations, reservation_window,
)
from app.schemas.availability import BusyEntry, CrewResourceType

# Tuples, not sets: a row's status can come back as a plain str, and a str-Enum member hashes by
# its *name*, so `"active" in {TripStatus.ACTIVE}` is False. Tuple membership compares by equality.
OCCUPYING_STATUSES: tuple[TripStatus, ...] = (
    TripStatus.CREATED, TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD,
)
# A held trip is still the trip its crew is on; it is merely blocked from advancing.
LIVE_STATUSES: tuple[TripStatus, ...] = (TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD)

_RESOURCE_ORDER: dict[CrewResourceType, int] = {
    CrewResourceType.DRIVER: 0, CrewResourceType.HORSE: 1, CrewResourceType.TRAILER: 2,
}


@dataclass(frozen=True)
class CrewFilter:
    """Which crew a caller asks about. All empty = the whole organisation's crew (the wizard's view).
    exclude_trip_id leaves out the asking trip itself (activation checks a trip against the others)."""

    driver_id: uuid.UUID | None = None
    horse_id: uuid.UUID | None = None
    trailer_ids: tuple[uuid.UUID, ...] = ()
    exclude_trip_id: uuid.UUID | None = None

    @property
    def everything(self) -> bool:
        return self.driver_id is None and self.horse_id is None and not self.trailer_ids


@dataclass(frozen=True)
class TimeWindow:
    """A half-open [start, end); end None = open-ended."""

    start: datetime
    end: datetime | None


@dataclass(frozen=True)
class OccupyingTrip:
    """A non-terminal trip with what it occupies, loaded in bulk so callers never query per trip."""

    trip: Trip
    trailer_ids: frozenset[uuid.UUID]
    # Every timed stop, in stop-sequence order.
    slot_times: tuple[datetime, ...]
    # Who holds the trip now. Trip.driver_id is only the original driver.
    current_driver_id: uuid.UUID
    # The pending takeover, if any: it reserves the incoming driver (see substitutions.availability).
    reservation: PendingReservation | None = None


def as_utc(moment: datetime) -> datetime:
    """A naive datetime is read as UTC (as scheduling.operating_day does), so comparing it with the
    stored, zone-aware times can never raise or silently shift."""
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment


def planned_window(
    departure: datetime | None, arrival: datetime | None, slot_times: Sequence[datetime],
) -> tuple[datetime | None, datetime | None]:
    """A trip's planned [start, end): the same fallbacks TripCreateRequest.validate_request uses, so
    the window checked here is the one the dispatcher was made to declare."""
    start = departure or (slot_times[0] if slot_times else None)
    later = [slot for slot in slot_times if start is None or slot > start]
    end = arrival or (later[-1] if later else None)
    return start, end


def busy_until(status: TripStatus, planned_end: datetime | None, now: datetime) -> datetime | None:
    """When the trip frees its crew; None means not until it is closed or cancelled."""
    if planned_end is None:
        return None
    if status in LIVE_STATUSES and planned_end <= now:
        return None
    return planned_end


def windows_overlap(
    a_start: datetime, a_end: datetime | None, b_start: datetime, b_end: datetime | None,
) -> bool:
    """Half-open intervals overlap when each starts before the other ends. A None end never ends."""
    return (b_end is None or a_start < b_end) and (a_end is None or b_start < a_end)


def format_when(moment: datetime) -> str:
    """"Thu 16 Oct, 16:00" in the operator's local time, the clock dispatchers and drivers work to.
    Built from parts because %-d (day without a leading zero) is not portable."""
    local = as_utc(moment).astimezone(timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS)))
    return f"{local:%a} {local.day} {local:%b}, {local:%H:%M}"


def clash_message(entries: Sequence[BusyEntry]) -> str:
    """The dispatcher-facing sentence for a refused creation. Names the first clash; the 409 body
    lists every one."""
    first = entries[0]
    kind = first.resource_type.value
    subject = f"{kind.capitalize()} {first.label} is on {first.trip_reference}"
    if first.busy_until is not None:
        return f"{subject} until {format_when(first.busy_until)}. Pick another {kind}, or move this departure."
    if first.trip_status in LIVE_STATUSES:
        return f"{subject}, which is still under way. Pick another {kind}."
    return f"{subject}, which has no planned arrival. Pick another {kind}, or cancel that trip."


async def lock_crew(db: AsyncSession, *, driver_id: uuid.UUID, vehicle_ids: Sequence[uuid.UUID]) -> None:
    """Serialise everyone claiming this crew, before anyone checks whether it is free."""
    await lock_crew_set(db, driver_ids=[driver_id], vehicle_ids=vehicle_ids)


async def lock_crew_set(
    db: AsyncSession, *, driver_ids: Sequence[uuid.UUID], vehicle_ids: Sequence[uuid.UUID],
) -> None:
    """Serialise everyone claiming these drivers and vehicles, before anyone checks they are free.

    Without it, two dispatchers both read "free" and both insert. The lock makes the second wait
    for the first to commit, then see the first trip. FOR NO KEY UPDATE (key_share=True) blocks
    another claimer but not ordinary inserts that merely reference the row by foreign key (tracker
    fixes, exceptions), so nothing unrelated stalls while a creation waits on its Hedera anchor.
    Order is fixed - drivers by ascending id, then vehicles by ascending id - so two claimers of
    overlapping crews can never deadlock each other (spec D8). A handover claims two drivers,
    which is why the driver side takes a sorted set rather than one id. Callers that also hold the
    trip lock take it first; never lock another trip while holding these.
    """
    if driver_ids:
        await db.execute(
            select(Driver.id).where(Driver.id.in_(driver_ids)).order_by(Driver.id).with_for_update(key_share=True)
        )
    if vehicle_ids:
        await db.execute(
            select(Vehicle.id).where(Vehicle.id.in_(vehicle_ids)).order_by(Vehicle.id)
            .with_for_update(key_share=True)
        )


async def occupying_trips(
    db: AsyncSession, *, organization_id: uuid.UUID, crew: CrewFilter,
) -> list[OccupyingTrip]:
    """Non-terminal trips of the organisation that share any of the given crew. With no crew
    given, every non-terminal trip of the organisation (the wizard's whole-fleet view)."""
    statement = select(Trip).where(
        Trip.operator_organization_id == organization_id, Trip.status.in_(OCCUPYING_STATUSES),
    )
    shares: list[ColumnElement[bool]] = []
    if crew.driver_id is not None:
        # The current driver, not Trip.driver_id (the original), and the incoming driver of a
        # pending takeover: both occupy this driver, at different times.
        shares.append(current_driver_id_expression(trip_id=Trip.id, original_driver_id=Trip.driver_id) == crew.driver_id)
        shares.append(Trip.id.in_(
            select(DriverSubstitutionRequest.trip_id).where(
                DriverSubstitutionRequest.state == "pending",
                DriverSubstitutionRequest.incoming_driver_id == crew.driver_id,
            )
        ))
    if crew.horse_id is not None:
        shares.append(Trip.horse_id == crew.horse_id)
    if crew.trailer_ids:
        shares.append(Trip.id.in_(
            select(TripTrailer.trip_id).where(TripTrailer.trailer_id.in_(crew.trailer_ids))
        ))
    if shares:
        statement = statement.where(or_(*shares))
    if crew.exclude_trip_id is not None:
        statement = statement.where(Trip.id != crew.exclude_trip_id)
    trips = list((await db.execute(statement.order_by(Trip.id))).scalars().all())
    if not trips:
        return []

    trip_ids = [trip.id for trip in trips]
    trailers: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for trip_id, trailer_id in (await db.execute(
        select(TripTrailer.trip_id, TripTrailer.trailer_id).where(TripTrailer.trip_id.in_(trip_ids))
    )).all():
        trailers[trip_id].add(trailer_id)
    slots: dict[uuid.UUID, list[datetime]] = defaultdict(list)
    for trip_id, slot_time in (await db.execute(
        select(TripStop.trip_id, TripStop.slot_time)
        .where(TripStop.trip_id.in_(trip_ids), TripStop.slot_time.is_not(None))
        .order_by(TripStop.trip_id, TripStop.sequence)
    )).all():
        slots[trip_id].append(slot_time)
    drivers = await current_driver_ids(db, trips)
    reservations = await pending_reservations(db, trip_ids)
    return [
        OccupyingTrip(
            trip=trip, trailer_ids=frozenset(trailers[trip.id]), slot_times=tuple(slots[trip.id]),
            current_driver_id=drivers[trip.id], reservation=reservations.get(trip.id),
        )
        for trip in trips
    ]


def _occupied_window(
    occupying: OccupyingTrip, now: datetime,
) -> tuple[datetime, datetime | None, datetime | None] | None:
    """(busy_from, busy_until, planned_end), or None when the trip occupies nothing at any time."""
    trip = occupying.trip
    status = TripStatus(trip.status)
    start, planned_end = planned_window(trip.planned_departure_at, trip.planned_arrival_at, occupying.slot_times)
    if start is None:
        # A CREATED trip with no schedule can never be activated (scheduling._reject_if_not_due),
        # so it has no claim on anyone. A live one predates that rule and is plainly in use: busy
        # since it was created.
        if status not in LIVE_STATUSES:
            return None
        start = trip.created_at
    return start, busy_until(status, planned_end, now), planned_end


_Held = tuple[datetime, datetime | None, datetime | None]  # (busy_from, busy_until, planned_end)


def _shared_resources(
    occupying: OccupyingTrip, crew: CrewFilter, held: _Held, now: datetime,
) -> Iterator[tuple[CrewResourceType, uuid.UUID, _Held]]:
    """The resources this trip holds that the caller asked about (all of them for the fleet view),
    each with the window it is held for.

    The current driver is held for the trip's own window. The incoming driver of a pending
    takeover is held for the reservation window instead: from the exchange, not from departure.
    """
    trip, everything = occupying.trip, crew.everything
    if everything or occupying.current_driver_id == crew.driver_id:
        yield CrewResourceType.DRIVER, occupying.current_driver_id, held
    reservation = occupying.reservation
    if reservation is not None and reservation.incoming_driver_id != occupying.current_driver_id and (
        everything or reservation.incoming_driver_id == crew.driver_id
    ):
        start, until = reservation_window(
            expected_at=reservation.expected_at, planned_end=held[2], now=now,
            request_format=reservation.request_format, reservation_start_at=reservation.reservation_start_at,
        )
        yield CrewResourceType.DRIVER, reservation.incoming_driver_id, (start, until, held[2])
    if everything or trip.horse_id == crew.horse_id:
        yield CrewResourceType.HORSE, trip.horse_id, held
    for trailer_id in sorted(occupying.trailer_ids):
        if everything or trailer_id in crew.trailer_ids:
            yield CrewResourceType.TRAILER, trailer_id, held


async def busy_crew_in_window(
    db: AsyncSession, *, organization_id: uuid.UUID, window: TimeWindow, now: datetime, crew: CrewFilter,
) -> list[BusyEntry]:
    """Every driver, horse and trailer busy at some point in [start, end), one entry per resource
    per trip. With no crew given, the whole organisation's busy crew; otherwise only the crew
    given. Ordered driver, horse, trailers, then by name, so the first entry is the one a
    dispatcher picked first."""
    start, now = as_utc(window.start), as_utc(now)
    end = as_utc(window.end) if window.end is not None else None
    occupying = await occupying_trips(db, organization_id=organization_id, crew=crew)

    hits: list[tuple[CrewResourceType, uuid.UUID, OccupyingTrip, datetime, datetime | None, datetime | None]] = []
    for occupied in occupying:
        held = _occupied_window(occupied, now)
        if held is None:
            continue
        for resource_type, resource_id, shared in _shared_resources(occupied, crew, held, now):
            if windows_overlap(shared[0], shared[1], start, end):
                hits.append((resource_type, resource_id, occupied, *shared))
    if not hits:
        return []

    labels = await _labels(db, hits)
    entries = [
        BusyEntry(
            resource_type=resource_type, resource_id=resource_id, label=labels.get(resource_id, ""),
            trip_id=occupied.trip.id, trip_reference=occupied.trip.trip_reference,
            trip_status=TripStatus(occupied.trip.status), busy_from=busy_from, busy_until=until,
            planned_until=planned_end,
        )
        for resource_type, resource_id, occupied, busy_from, until, planned_end in hits
    ]
    entries.sort(key=lambda entry: (_RESOURCE_ORDER[entry.resource_type], entry.label, entry.busy_from))
    return entries


async def _labels(
    db: AsyncSession,
    hits: Sequence[tuple[CrewResourceType, uuid.UUID, OccupyingTrip, datetime, datetime | None, datetime | None]],
) -> dict[uuid.UUID, str]:
    """Driver names and vehicle registrations for every resource in `hits`, in two queries."""
    driver_ids = {resource_id for kind, resource_id, *_ in hits if kind == CrewResourceType.DRIVER}
    vehicle_ids = {resource_id for kind, resource_id, *_ in hits if kind != CrewResourceType.DRIVER}
    labels: dict[uuid.UUID, str] = {}
    if driver_ids:
        rows = await db.execute(select(Driver.id, Driver.full_name).where(Driver.id.in_(driver_ids)))
        labels.update({driver_id: name for driver_id, name in rows.all()})
    if vehicle_ids:
        rows = await db.execute(select(Vehicle.id, Vehicle.registration).where(Vehicle.id.in_(vehicle_ids)))
        labels.update({vehicle_id: registration for vehicle_id, registration in rows.all()})
    return labels
