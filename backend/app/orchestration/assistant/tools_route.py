"""Route time tool (assistant spec §5.1 row 7, D4): how long one depot to another takes.

Two answers, each labelled for what it is, because they answer different questions:
- **driving time**: the truck road time from the route planner (`route_cache`). No stops, rest,
  loading or traffic: the fastest it could possibly be;
- **past trips**: how long closed trips on this depot pair actually took, door to door, over the last
  HISTORY_MONTHS months (`analytics.lane_metrics`, the Routes & sites tab's own lane figures): the
  middle (median) and slow (P90) times. Left out, with a warning, when they're faster than the road
  allows (PLAUSIBLE_SHARE_OF_DRIVING): the demo data's "1 minute" Cape Town to Johannesburg trips
  would otherwise be offered as an arrival time (found live, 21 Oct).

It never picks a planned arrival. Planned arrival is locked into the journey hash and becomes the
yardstick for lateness and for when the crew is free again (`crypto/hashing.py`), so the dispatcher
chooses it, with these two numbers in front of them (spec D4).
"""

from datetime import date

from pydantic import Field
from sqlalchemy import select

from app.analytics.fleet.periods import today_sast
from app.analytics.lane_metrics import get_lane_metrics
from app.db.models.organisations import Precinct
from app.orchestration.analytics_chat.periods import add_months
from app.orchestration.assistant.results import RouteTimeResult
from app.orchestration.assistant.route_cache import Depot, Driving, driving_between
from app.orchestration.assistant.tools_base import (
    AssistantTool,
    ToolContext,
    ToolInput,
    ToolOutcome,
    expect,
    find,
    record_of,
)
from app.schemas.analytics import DurationStats
from app.schemas.assistant import RecordRef, RouteTimeCard

HISTORY_MONTHS = 12
METRES_PER_KM = 1000
MINUTES_PER_HOUR = 60
PLAUSIBLE_SHARE_OF_DRIVING = 0.8
DRIVING_BASIS = "Truck road time from the route planner: no stops, rest, loading or traffic."
ARRIVAL_RULE = (
    "Planned arrival is the dispatcher's choice and becomes the yardstick for lateness. Offer these times; "
    "never fill one in yourself."
)


def duration_text(minutes: float) -> str:
    """"17 h 40 min", "5 h", "45 min"."""
    hours, rest = divmod(round(minutes), MINUTES_PER_HOUR)
    if not hours:
        return f"{rest} min"
    return f"{hours} h {rest} min" if rest else f"{hours} h"


def _month_label(month: date) -> str:
    return f"{month:%b %Y}"


class RouteTimeInput(ToolInput):
    origin_name: str | None = Field(description="Where it leaves from: a depot name, hub code or city, as typed.")
    origin_ref: str | None = Field(description="An origin depot ref from an earlier result. Otherwise null.")
    destination_name: str | None = Field(description="Where it goes: a depot name, hub code or city, as typed.")
    destination_ref: str | None = Field(description="A destination depot ref from an earlier result. Otherwise null.")


async def _depot(context: ToolContext, record: RecordRef) -> Depot:
    row = (await context.db.execute(
        select(Precinct.latitude, Precinct.longitude).where(Precinct.id == record.id),
    )).one()
    return Depot(id=record.id, lat=float(row.latitude), lng=float(row.longitude))


def plausible(middle: int | None, driving_minutes: int | None) -> bool:
    """Whether past trip times can be offered: unknowable without a driving time, so they're kept then."""
    return middle is None or driving_minutes is None or middle >= PLAUSIBLE_SHARE_OF_DRIVING * driving_minutes


def _left_out(count: int) -> str:
    return (
        f"The {count} past trips on this route took less time than the road allows (likely demo or test trips), "
        "so their times are left out. Don't quote them."
    )


def _times(stats: DurationStats | None) -> tuple[int, int | None, int | None]:
    if stats is None or not stats.sample_count:
        return 0, None, None
    middle = round(stats.median) if stats.median is not None else None
    slow = round(stats.p90) if stats.p90 is not None else None
    return stats.sample_count, middle, slow


async def _route_time(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, RouteTimeInput)
    ends: list[RecordRef] = []
    for name, ref, which in (
        (inputs.origin_name, inputs.origin_ref, "origin"),
        (inputs.destination_name, inputs.destination_ref, "destination"),
    ):
        match = await find(context, "precinct", name=name, ref=ref)
        if match is None:
            return ToolOutcome.failed(f"Give the {which} depot.")
        if isinstance(match, ToolOutcome):
            return match
        ends.append(record_of(match))
    origin, destination = ends
    if origin.id == destination.id:
        return ToolOutcome.failed("The origin and destination are the same depot. Ask which two depots they mean.")

    driving = await driving_between(await _depot(context, origin), await _depot(context, destination))
    this_month = today_sast(context.now).replace(day=1)
    first_month = add_months(this_month, -(HISTORY_MONTHS - 1))
    lanes = await get_lane_metrics(
        context.db, organization_id=context.organization_id, start_month=first_month, end_month=this_month,
        origin_precinct_id=origin.id, destination_precinct_id=destination.id,
    )
    count, middle, slow = _times(lanes[0].actual_transit_minutes if lanes else None)
    known = driving if isinstance(driving, Driving) else None
    left_out = not plausible(middle, known.minutes if known else None)
    if left_out:
        middle = slow = None
    result = RouteTimeResult(
        origin=origin.label, destination=destination.label,
        driving_time=duration_text(known.minutes) if known else None,
        distance_km=round(known.metres / METRES_PER_KM) if known else None,
        driving_basis=DRIVING_BASIS if known else str(driving),
        past_trips=count, typical_time=duration_text(middle) if middle is not None else None,
        slow_time=duration_text(slow) if slow is not None else None,
        history=f"Closed trips {_month_label(first_month)} to {_month_label(this_month)}, middle and slow (90th percentile).",
        history_left_out=_left_out(count) if left_out else None,
        arrival_rule=ARRIVAL_RULE,
    )
    card = RouteTimeCard(
        origin=origin, destination=destination,
        driving_minutes=known.minutes if known else None,
        distance_km=round(known.metres / METRES_PER_KM) if known else None,
        driving_unavailable=None if known else str(driving),
        past_trip_count=count, typical_minutes=middle, slow_minutes=slow, history_left_out=left_out,
        history_from=first_month, history_to=this_month,
    )
    context.refs.tag(origin)
    context.refs.tag(destination)
    return ToolOutcome.done(result, card)


ROUTE_TOOLS: tuple[AssistantTool, ...] = (
    AssistantTool(
        name="route_time",
        description=(
            "How long one depot to another takes: the truck driving time (road time only) and how long past closed "
            "trips on that route actually took (middle and slow). Use for 'how long is Joburg to Cape Town', and "
            "before asking for an empty leg's arrival time. Never choose the arrival yourself."
        ),
        input_model=RouteTimeInput,
        runner=_route_time,
    ),
)
