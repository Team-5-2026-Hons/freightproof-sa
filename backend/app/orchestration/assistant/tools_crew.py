"""Crew tools (assistant spec §5.1, row 4): one driver's or vehicle's bookings in a window.

"Is Tim busy now?", "Tim's next 2 weeks?", "Is CA 123-456 booked on Thursday?" all run
`trips.availability.busy_crew_in_window`, the one rule the trip form greys crew out with and trip
creation refuses clashes with (FP-139). So the chat can never call someone free whom the form
would refuse: it counts booked-but-not-started trips, the current driver after a handover (FP-83),
pending takeovers, and live trips past their planned end (busy until closed).

Our data knows trips only, not leave, sickness or driving hours: answers say "nothing booked", never
"available" (spec D11, `results.BOOKINGS_NOTE`).
"""

import uuid
from collections import defaultdict
from collections.abc import Collection, Sequence
from datetime import datetime

from pydantic import Field
from sqlalchemy import select

from app.db.models.enums import VehicleType
from app.db.models.trips import Trip
from app.orchestration.assistant.results import (
    BOOKINGS_NOTE,
    BookedLine,
    Booking,
    BookingsResult,
    CrewGroupResult,
    CrewName,
    FreeCrewResult,
    Who,
)
from app.orchestration.assistant.tools_base import (
    AssistantTool,
    ToolContext,
    ToolInput,
    ToolOutcome,
    expect,
    find,
    record_of,
    when_text,
)
from app.orchestration.assistant.tools_trips import precinct_names
from app.orchestration.assistant.when import When, WhenError, resolve
from app.orchestration.trips.availability import CrewFilter, TimeWindow, busy_crew_in_window, format_when
from app.orchestration.fleet.drivers import list_drivers
from app.orchestration.fleet.vehicles import list_vehicles
from app.schemas.assistant import BookedCrew, BookingRow, BookingsCard, CrewGroup, CrewKind, FreeCrewCard, RecordRef
from app.schemas.availability import BusyEntry

UNTIL_CLOSED = "until the trip is closed"
MAX_CREW_ROWS = 40


class CrewBookingsInput(ToolInput):
    driver_name: str | None = Field(description="Driver as typed (or vehicle, not both).")
    driver_ref: str | None = Field(description="Driver as a ref.")
    vehicle_name: str | None = Field(description="Horse or trailer registration as typed.")
    vehicle_ref: str | None = Field(description="Vehicle as a ref.")
    when: When = Field(description="'Busy now?' → now; 'next 2 weeks' → next_n_days, n 14.")


async def trip_routes(context: ToolContext, trip_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, tuple[str, str]]:
    if not trip_ids:
        return {}
    rows = (await context.db.execute(
        select(Trip.id, Trip.origin_precinct_id, Trip.destination_precinct_id).where(Trip.id.in_(set(trip_ids))),
    )).all()
    names = await precinct_names(context, {row.origin_precinct_id for row in rows} | {row.destination_precinct_id for row in rows})
    return {row.id: (names.get(row.origin_precinct_id, ""), names.get(row.destination_precinct_id, "")) for row in rows}


def _booking_row(entry: BusyEntry, routes: dict[uuid.UUID, tuple[str, str]]) -> BookingRow:
    origin, destination = routes.get(entry.trip_id, ("", ""))
    return BookingRow(
        trip_id=entry.trip_id, trip_reference=entry.trip_reference, status=entry.trip_status,
        origin=origin, destination=destination,
        busy_from=entry.busy_from, busy_until=entry.busy_until, planned_until=entry.planned_until,
    )


async def booking_rows(context: ToolContext, entries: Sequence[BusyEntry]) -> list[BookingRow]:
    routes = await trip_routes(context, {entry.trip_id for entry in entries})
    return [_booking_row(entry, routes) for entry in entries]


async def bookings_for(context: ToolContext, record: RecordRef, start: datetime, end: datetime) -> list[BookingRow]:
    """The trips holding one driver or vehicle in [start, end), by the FP-139 rule."""
    entries = await busy_crew_in_window(
        context.db, organization_id=context.organization_id, window=TimeWindow(start=start, end=end),
        now=context.now, crew=crew_filter(record),
    )
    return await booking_rows(context, [entry for entry in entries if entry.resource_id == record.id])


def crew_filter(record: RecordRef) -> CrewFilter:
    if record.kind == "driver":
        return CrewFilter(driver_id=record.id)
    return CrewFilter(horse_id=record.id) if record.detail == "horse" else CrewFilter(trailer_ids=(record.id,))


async def _crew_bookings(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, CrewBookingsInput)
    asks_driver = inputs.driver_name is not None or inputs.driver_ref is not None
    asks_vehicle = inputs.vehicle_name is not None or inputs.vehicle_ref is not None
    if asks_driver == asks_vehicle:
        return ToolOutcome.failed("Give either a driver or a vehicle (one call each), not both or neither.")
    try:
        resolved = resolve(inputs.when, now=context.now)
    except WhenError as exc:
        return ToolOutcome.failed(str(exc))
    start, end = resolved.as_window()
    if asks_driver:
        match = await find(context, "driver", name=inputs.driver_name, ref=inputs.driver_ref)
    else:
        match = await find(context, "vehicle", name=inputs.vehicle_name, ref=inputs.vehicle_ref)
    if match is None or isinstance(match, ToolOutcome):
        return match or ToolOutcome.failed("Give a driver or a vehicle.")

    record = record_of(match)
    rows = await bookings_for(context, record, start, end)
    result = BookingsResult(
        who=Who(ref=context.refs.tag(record), label=record.label, kind=record.detail or record.kind, active=record.is_active),
        window=when_text(resolved.start, resolved.end), nothing_booked=not rows,
        bookings=[booking_line(context, row) for row in rows], wording_rule=BOOKINGS_NOTE,
    )
    return ToolOutcome.done(result, BookingsCard(who=record, window_start=start, window_end=end, bookings=rows))


def booking_line(context: ToolContext, row: BookingRow) -> Booking:
    trip = RecordRef(kind="trip", id=row.trip_id, label=row.trip_reference, detail=row.status.value)
    return Booking(
        trip_ref=context.refs.tag(trip), trip_reference=row.trip_reference, status=row.status.value,
        origin=row.origin, destination=row.destination, busy_from=format_when(row.busy_from),
        busy_until=format_when(row.busy_until) if row.busy_until is not None else UNTIL_CLOSED,
        was_due=format_when(row.planned_until) if row.busy_until is None and row.planned_until is not None else None,
    )


class FreeCrewInput(ToolInput):
    when: When = Field(description="The time to check, e.g. this_weekend.")
    kinds: list[CrewKind] = Field(min_length=1, description="driver, horse and/or trailer.")


async def _pools(context: ToolContext) -> dict[CrewKind, list[RecordRef]]:
    """Every ACTIVE driver, horse and trailer, as the trip form's pickers offer them."""
    drivers = await list_drivers(context.db, context.organization_id)
    vehicles = await list_vehicles(context.db, context.organization_id)
    pools: dict[CrewKind, list[RecordRef]] = {
        "driver": [RecordRef(kind="driver", id=driver.id, label=driver.full_name) for driver in drivers],
        "horse": [],
        "trailer": [],
    }
    for vehicle in vehicles:
        kind = VehicleType(vehicle.vehicle_type).value
        pools["horse" if kind == "horse" else "trailer"].append(
            RecordRef(kind="vehicle", id=vehicle.id, label=vehicle.registration, detail=kind),
        )
    return pools


def _group(
    context: ToolContext,
    kind: CrewKind,
    pool: Sequence[RecordRef],
    busy: dict[uuid.UUID, list[BookingRow]],
) -> tuple[CrewGroupResult, CrewGroup]:
    every_free = [record for record in pool if record.id not in busy]
    every_booked = [(record, busy[record.id]) for record in pool if record.id in busy]
    truncated = len(every_free) > MAX_CREW_ROWS or len(every_booked) > MAX_CREW_ROWS
    free, booked = every_free[:MAX_CREW_ROWS], every_booked[:MAX_CREW_ROWS]
    result = CrewGroupResult(
        kind=kind,
        nothing_booked_total=len(every_free),
        nothing_booked=[CrewName(ref=context.refs.tag(record), label=record.label) for record in free],
        booked_total=len(every_booked),
        booked=[
            BookedLine(ref=context.refs.tag(record), label=record.label, bookings=[booking_line(context, row) for row in rows])
            for record, rows in booked
        ],
        truncated=truncated,
    )
    card = CrewGroup(
        kind=kind, nothing_booked=free,
        booked=[BookedCrew(who=record, bookings=rows) for record, rows in booked], truncated=truncated,
    )
    return result, card


async def _free_crew(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, FreeCrewInput)
    try:
        resolved = resolve(inputs.when, now=context.now)
    except WhenError as exc:
        return ToolOutcome.failed(str(exc))
    start, end = resolved.as_window()
    entries = await busy_crew_in_window(
        context.db, organization_id=context.organization_id, window=TimeWindow(start=start, end=end),
        now=context.now, crew=CrewFilter(),
    )
    routes = await trip_routes(context, {entry.trip_id for entry in entries})
    busy: dict[uuid.UUID, list[BookingRow]] = defaultdict(list)
    for entry in entries:
        busy[entry.resource_id].append(_booking_row(entry, routes))
    pools = await _pools(context)
    kinds = list(dict.fromkeys(inputs.kinds))
    groups = [_group(context, kind, pools[kind], busy) for kind in kinds]
    result = FreeCrewResult(
        window=when_text(resolved.start, resolved.end), groups=[group for group, _ in groups], wording_rule=BOOKINGS_NOTE,
    )
    card = FreeCrewCard(window_start=start, window_end=end, groups=[card for _, card in groups])
    return ToolOutcome.done(result, card)


CREW_TOOLS: tuple[AssistantTool, ...] = (
    AssistantTool(
        name="crew_bookings",
        description=(
            "One driver's or one vehicle's (horse or trailer) trips in a window, using the same rule the trip form "
            "uses to refuse clashes: booked trips count, the current driver after a handover counts, and a live trip "
            "past its planned end is busy until it is closed. Use for 'is Tim busy now', 'Tim's next 2 weeks', 'is "
            "CA 123-456 booked on Thursday'. Empty bookings means nothing booked, not 'available'."
        ),
        input_model=CrewBookingsInput,
        runner=_crew_bookings,
    ),
    AssistantTool(
        name="free_crew",
        description=(
            "Which active drivers, horses and/or trailers have nothing booked in a window, and which are booked (with "
            "their trips and times, so partly free crew can be named with when they're free). Same clash rule as the "
            "trip form. Use for 'who's free this weekend', 'which horses are free tomorrow morning'. Say 'nothing "
            "booked', never 'available'."
        ),
        input_model=FreeCrewInput,
        runner=_free_crew,
    ),
)
