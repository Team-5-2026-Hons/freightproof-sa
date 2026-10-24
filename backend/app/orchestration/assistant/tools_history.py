"""Trip history tool (assistant spec B31): "how many trips has Tim done?", "when did CA 123-456 last run?".

One driver's or one vehicle's trips, counted EXACTLY as that record's own page lists them, by calling the pages'
own reads rather than copying their rules (so the two can never disagree):
- a driver: every trip they took part in, first assigned or taken over or handed over (FP-83,
  `fleet.drivers.get_driver_detail`); not only trips they hold now, which is what `trips`' driver filter means;
- a vehicle: every trip it pulled as horse or trailer (`fleet.vehicles.get_vehicle_detail`).

One record at a time, never a ranking: the project deliberately builds no driver league tables or risk scores
(docs/iteration3_plan.md, FP-295 D5), and the prompt says so.
"""

import uuid
from collections import Counter
from datetime import datetime

from pydantic import Field
from sqlalchemy import select

from app.db.models.enums import TripStatus
from app.db.models.trips import Trip
from app.orchestration.assistant.results import HistoryLine, HistoryResult, Who
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
from app.orchestration.fleet.drivers import get_driver_detail
from app.orchestration.fleet.vehicles import get_vehicle_detail
from app.orchestration.trips.availability import LIVE_STATUSES, format_when
from app.schemas.assistant import HistoryCard, HistoryRow, RecordRef

# The newest trips listed; the counts cover all of them.
MAX_RECENT = 10
DRIVER_COUNTED_AS = "Trips this driver took part in: first assigned, taken over or handed over (as on their page)."
VEHICLE_COUNTED_AS = "Trips this vehicle was on, as horse or trailer (as on its page)."


class TripHistoryInput(ToolInput):
    driver_name: str | None = Field(description="Driver as typed (or a vehicle, not both).")
    driver_ref: str | None = Field(description="Driver as a ref.")
    vehicle_name: str | None = Field(description="Horse or trailer registration as typed.")
    vehicle_ref: str | None = Field(description="Vehicle as a ref.")
    when: When | None = Field(description="Only trips in this window. Null: all time.")


def _happened_at(trip: Trip) -> datetime:
    """The moment that dates a trip: closed, else left, else planned to leave, else booked."""
    return trip.closed_at or trip.actual_departure_at or trip.planned_departure_at or trip.created_at


def _name(names: dict[uuid.UUID, str], precinct_id: uuid.UUID | None) -> str:
    return names.get(precinct_id, "") if precinct_id is not None else ""


async def _trip_ids(context: ToolContext, record: RecordRef) -> list[uuid.UUID]:
    if record.kind == "driver":
        return (await get_driver_detail(context.db, record.id, context.organization_id)).trip_ids
    return (await get_vehicle_detail(context.db, record.id, context.organization_id)).trip_ids


async def _trip_history(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, TripHistoryInput)
    asks_driver = inputs.driver_name is not None or inputs.driver_ref is not None
    asks_vehicle = inputs.vehicle_name is not None or inputs.vehicle_ref is not None
    if asks_driver == asks_vehicle:
        return ToolOutcome.failed("Give one driver or one vehicle. Comparing or ranking drivers isn't something this does.")
    window: tuple[datetime, datetime] | None = None
    if inputs.when is not None:
        try:
            resolved = resolve(inputs.when, now=context.now)
        except WhenError as exc:
            return ToolOutcome.failed(str(exc))
        window = resolved.as_window()
    if asks_driver:
        match = await find(context, "driver", name=inputs.driver_name, ref=inputs.driver_ref)
    else:
        match = await find(context, "vehicle", name=inputs.vehicle_name, ref=inputs.vehicle_ref)
    if match is None or isinstance(match, ToolOutcome):
        return match or ToolOutcome.failed("Give one driver or one vehicle.")
    record = record_of(match)
    ids = await _trip_ids(context, record)
    trips: list[Trip] = []
    if ids:
        trips = list((await context.db.execute(select(Trip).where(Trip.id.in_(ids)))).scalars().all())
    if window is not None:
        trips = [trip for trip in trips if window[0] <= _happened_at(trip) < window[1]]
    trips.sort(key=_happened_at, reverse=True)
    return await _history_outcome(context, record, trips, window)


async def _history_outcome(
    context: ToolContext, record: RecordRef, trips: list[Trip], window: tuple[datetime, datetime] | None,
) -> ToolOutcome:
    statuses = Counter(TripStatus(trip.status) for trip in trips)
    completed = sorted(trip.closed_at for trip in trips if TripStatus(trip.status) == TripStatus.CLOSED and trip.closed_at)
    recent = trips[:MAX_RECENT]
    ends = {end for trip in recent for end in (trip.origin_precinct_id, trip.destination_precinct_id) if end is not None}
    names = await precinct_names(context, ends)
    rows = [
        HistoryRow(
            trip_id=trip.id, trip_reference=trip.trip_reference, status=TripStatus(trip.status),
            origin=_name(names, trip.origin_precinct_id), destination=_name(names, trip.destination_precinct_id),
            happened_at=_happened_at(trip),
        )
        for trip in recent
    ]
    counts = {
        "total": len(trips), "completed": statuses[TripStatus.CLOSED], "cancelled": statuses[TripStatus.CANCELLED],
        "live": sum(statuses[status] for status in LIVE_STATUSES), "booked": statuses[TripStatus.CREATED],
    }
    result = HistoryResult(
        who=Who(ref=context.refs.tag(record), label=record.label, kind=record.detail or record.kind, active=record.is_active),
        counted_as=DRIVER_COUNTED_AS if record.kind == "driver" else VEHICLE_COUNTED_AS,
        window=when_text(*window) if window else "all time",
        first_completed=format_when(completed[0]) if completed else None,
        last_completed=format_when(completed[-1]) if completed else None,
        recent=[
            HistoryLine(
                trip_ref=context.refs.tag(RecordRef(kind="trip", id=row.trip_id, label=row.trip_reference, detail=row.status.value)),
                trip_reference=row.trip_reference, status=row.status.value, origin=row.origin,
                destination=row.destination, happened=format_when(row.happened_at),
            )
            for row in rows
        ],
        **counts,
    )
    card = HistoryCard(
        who=record, window_start=window[0] if window else None, window_end=window[1] if window else None,
        recent=rows, **counts,
    )
    return ToolOutcome.done(result, card)


HISTORY_TOOLS: tuple[AssistantTool, ...] = (
    AssistantTool(
        name="trip_history",
        description=(
            "One driver's or one vehicle's trips, counted as their own page lists them: how many completed, "
            "cancelled, live and booked, first and last completed, and the newest few. Optional window; null = all "
            "time. Use for 'how many trips has Tim done', 'when did CA 123-456 last run'. One record only: never "
            "rank or compare drivers."
        ),
        input_model=TripHistoryInput,
        runner=_trip_history,
    ),
)
