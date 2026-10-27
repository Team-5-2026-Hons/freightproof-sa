"""The read-only tools the Analytics chat's model may call (FP-295 spec D4–D6, §7.4).

One tool per Analytics tab, plus the headline tiles. Each runs the same service function
as its tab (orchestration/analytics/fleet.py), so a chat answer rests on exactly the figures
the page shows. The model chooses a tool and a period; it never chooses the organisation:
run_tool takes that from the caller's token only, and no input schema has a field for it.

Left out on purpose (spec D5): the incident map (pins are where a named driver was) and
every per-driver, per-vehicle and per-site figure (orchestration/analytics/metrics.py).

A tool that can't run (unknown name, bad input, a period the charts can't draw) returns an
error ToolOutcome carrying a message for the model, never an exception, so the model can
correct itself on its next turn.
"""

import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.constants import EXPIRY_BAND_EDGES_DAYS, TILE_WINDOW_DAYS
from app.analytics.fleet.periods import Period, today_sast
from app.core.fleet_bands import Grain
from app.orchestration.analytics.fleet import (
    check_period,
    get_activity,
    get_cost,
    get_evidence,
    get_on_time,
    get_patterns,
    get_problems,
    get_review,
    get_routes,
    get_tiles,
    resolve_period_start,
)
from app.orchestration.analytics.cost_profile import read_cost_profile
from app.orchestration.analytics_chat.definitions import ABOUT_BY_TOOL, about
from app.orchestration.analytics_chat.page_guide import GUIDE, Topic, guide_for
from app.orchestration.analytics_chat.periods import PeriodPreset, resolve_preset
from app.orchestration.analytics_chat.totals import (
    activity_totals,
    cost_totals,
    evidence_totals,
    on_time_totals,
    patterns_totals,
    problems_totals,
    review_totals,
    right_now_totals,
    routes_totals,
)

JsonObject = dict[str, object]


class ToolInput(BaseModel):
    """Every tool input rejects unknown fields, so a stray "organization_id" can't sneak in."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class NoInput(ToolInput):
    """For the "right now" tiles: they have no period."""


class PeriodInput(ToolInput):
    preset: PeriodPreset = Field(
        description=(
            "The page's Period choice. Weeks start on Monday; a preset ends today and includes "
            "the current, unfinished week, month or year. Use custom for any other range."
        ),
    )
    start: date | None = Field(description="Only for preset custom: the first day, YYYY-MM-DD. Otherwise null.")
    end: date | None = Field(description="Only for preset custom: the last day, YYYY-MM-DD. Otherwise null.")


class TrendInput(PeriodInput):
    grain: Grain = Field(
        description="View by: how the trend charts group time. A chart shows at most 53 bars.",
    )


class ExplainInput(ToolInput):
    topic: Topic = Field(description="The part of the page to explain; the tool's description lists what each covers.")


ToolRunner = Callable[[AsyncSession, uuid.UUID, Period | None, datetime, ToolInput], Awaitable[JsonObject]]


@dataclass(frozen=True)
class ChatTool:
    name: str
    tab: str | None
    label: str
    description: str
    input_model: type[ToolInput]
    runner: ToolRunner
    gives_figures: bool = True

    def input_schema(self) -> JsonObject:
        return self.input_model.model_json_schema()


@dataclass(frozen=True)
class ToolOutcome:
    """Exactly one of `result` and `error` is set. `period` is the resolved period the tool
    ran for (None for the tiles, or when it failed)."""

    tool: ChatTool | None
    result: JsonObject | None
    error: str | None
    period: Period | None


def _dump(model: BaseModel) -> JsonObject:
    return model.model_dump(mode="json")


def _with_totals(totals: JsonObject, model: BaseModel) -> JsonObject:
    """The tab's figures with the server's whole-period totals first, so the model reads totals
    instead of adding rows (totals.py, spec B37)."""
    return {"totals": totals, **_dump(model)}


def _require(period: Period | None) -> Period:
    if period is None:
        raise ValueError("this tool needs a period")
    return period


async def _activity(db: AsyncSession, org: uuid.UUID, period: Period | None, now: datetime, inputs: ToolInput) -> JsonObject:
    resolved = _require(period)
    activity = await get_activity(db, organization_id=org, period=resolved)
    patterns = await get_patterns(db, organization_id=org, period=replace(resolved, grain=None))
    return {
        "activity": _with_totals(activity_totals(activity), activity),
        "busy_patterns": _with_totals(patterns_totals(patterns), patterns),
    }


async def _on_time(db: AsyncSession, org: uuid.UUID, period: Period | None, now: datetime, inputs: ToolInput) -> JsonObject:
    response = await get_on_time(db, organization_id=org, period=_require(period))
    return _with_totals(on_time_totals(response), response)


async def _problems(db: AsyncSession, org: uuid.UUID, period: Period | None, now: datetime, inputs: ToolInput) -> JsonObject:
    response = await get_problems(db, organization_id=org, period=_require(period))
    return _with_totals(problems_totals(response), response)


async def _review(db: AsyncSession, org: uuid.UUID, period: Period | None, now: datetime, inputs: ToolInput) -> JsonObject:
    response = await get_review(db, organization_id=org, period=_require(period), now=now)
    return _with_totals(review_totals(response), response)


async def _evidence(db: AsyncSession, org: uuid.UUID, period: Period | None, now: datetime, inputs: ToolInput) -> JsonObject:
    response = await get_evidence(db, organization_id=org, period=_require(period))
    return _with_totals(evidence_totals(response), response)


async def _routes(db: AsyncSession, org: uuid.UUID, period: Period | None, now: datetime, inputs: ToolInput) -> JsonObject:
    response = await get_routes(db, organization_id=org, period=_require(period))
    return _with_totals(routes_totals(response), response)


def _rates_without_names(rates: JsonObject) -> JsonObject:
    """The cost rates as the chat may see them: without the name of the admin who last saved them. The page shows
    it on the rates card, but no answer needs a person's name, and only page figures go to the provider (spec D5)."""
    return {key: value for key, value in rates.items() if key != "updated_by_name"}


async def _cost(db: AsyncSession, org: uuid.UUID, period: Period | None, now: datetime, inputs: ToolInput) -> JsonObject:
    response = await get_cost(db, organization_id=org, period=_require(period))
    result = _with_totals(cost_totals(response), response)
    rates = result.get("rates")
    if isinstance(rates, dict):
        result["rates"] = _rates_without_names(rates)
    return result


async def _right_now(db: AsyncSession, org: uuid.UUID, period: Period | None, now: datetime, inputs: ToolInput) -> JsonObject:
    response = await get_tiles(db, organization_id=org, now=now)
    return _with_totals(right_now_totals(response, now), response)


async def _explain(db: AsyncSession, org: uuid.UUID, period: Period | None, now: datetime, inputs: ToolInput) -> JsonObject:
    if not isinstance(inputs, ExplainInput):
        raise TypeError("explain takes an ExplainInput")
    result: JsonObject = {"guide": guide_for(inputs.topic)}
    if inputs.topic == "cost":
        rates = await read_cost_profile(db, organization_id=org)
        result["current_rates"] = _rates_without_names(rates.model_dump(mode="json"))
    return result


def _topic_menu() -> str:
    """Each topic and the elements its guide covers, built from the guide so the menu can't fall behind it."""
    return "; ".join(f"{topic}: {', '.join(entry.title for entry in entries)}" for topic, entries in GUIDE.items())


MAX_EXPIRY_BAND_DAYS = EXPIRY_BAND_EDGES_DAYS[-1]

_SCOPE = (
    " Unless the result's `about` lines say otherwise, counts closed trips, grouped by the day of their first "
    "departure in South African time. Buckets marked is_partial are not a whole week, month or year. A null "
    "rate means nothing to measure, not zero. Starts with `about` (what the page says each chart counts) and "
    "`totals`: whole-period sums, rates and leaders (which is biggest, lowest, highest, ties listed) worked "
    "out by the server; use them, never add up or compare rows yourself."
)

TOOLS: tuple[ChatTool, ...] = (
    ChatTool(
        name="activity", tab="activity", label="Activity",
        description=(
            "Activity tab: closed trips over time (loaded and empty), cancellations over time with the "
            "cancelled trips' references, and busy patterns (average departures and arrivals per hour "
            "of day, weekday, day of month and month of year)." + _SCOPE
        ),
        input_model=TrendInput, runner=_activity,
    ),
    ChatTool(
        name="on_time", tab="on-time", label="On time",
        description=(
            "On time tab: on-time departures and arrivals over time (strict: on or before the plan), "
            "how late trips were in bands, and how far actual trip times were from the plan. "
            "Use this for questions about delays and punctuality." + _SCOPE
        ),
        input_model=TrendInput, runner=_on_time,
    ),
    ChatTool(
        name="problems", tab="problems", label="Problems",
        description=(
            "Problems tab: problems (exceptions) per 100 trips over time by severity, theft warning "
            "signs over time by type, the most common problem types, where in the trip problems were "
            "raised, and risky times of day." + _SCOPE
        ),
        input_model=TrendInput, runner=_problems,
    ),
    ChatTool(
        name="review_desk", tab="review", label="Review desk",
        description=(
            "Review desk tab: critical problems waiting for review now by how long they've waited, "
            "the waiting pile over time, how fast critical problems get reviewed (median and mean "
            "hours), and what reviews concluded. Counts problems, not trips, and isn't limited to "
            "closed trips. Starts with `about` (what the page says each chart counts) and `totals` worked out "
            "by the server; use them for any total. "
            "Median and mean review times are per bucket only and can't be added."
        ),
        input_model=TrendInput, runner=_review,
    ),
    ChatTool(
        name="evidence", tab="evidence", label="Evidence",
        description=(
            "Evidence tab: whether the vehicle tracker agreed with the driver's check-ins at each "
            "stop, how many steps a dispatcher overrode, and receiver sign-off by QR scan." + _SCOPE
        ),
        input_model=TrendInput, runner=_evidence,
    ),
    ChatTool(
        name="routes_and_sites", tab="routes", label="Routes & sites",
        description=(
            "Routes & sites tab: the busiest sites (pickups and deliveries) and every lane (origin to "
            "destination) with its trip count, driving time and problem count, totalled over the "
            "whole period (no View by)." + _SCOPE
        ),
        input_model=PeriodInput, runner=_routes,
    ),
    ChatTool(
        name="cost", tab="cost", label="Cost",
        description=(
            "Cost tab: estimated operating cost (fuel, other running, driver, fixed) and delay cost on "
            "problem trips, both ESTIMATES from the organisation's cost rates (included); and cargo "
            "value exposed on trips with a theft signal, FROM WAYBILLS, split into still under review "
            "and reviewed. Also cost per lane." + _SCOPE
        ),
        input_model=TrendInput, runner=_cost,
    ),
    ChatTool(
        name="right_now", tab=None, label="Right now",
        description=(
            "The headline tiles, as of this moment (no period): live trips (created, underway or on hold, so "
            "they include planned trips that haven't departed yet; the tile doesn't split them), critical "
            "problems waiting for review and the oldest one's age, driver licence and vehicle disc expiries in "
            f"bands (none more than {MAX_EXPIRY_BAND_DAYS} days away), and trucks and trailers that neither "
            f"departed in the last {TILE_WINDOW_DAYS} days nor are on a live trip. No trip-by-trip detail: the "
            "Live trips tile opens the Dispatcher Dashboard, whose Active Trips list shows each trip. "
            "Starts with `about` (what the page says each tile counts) and `totals`, which gives how long the "
            "oldest critical problem has waited (whole days and hours, as the tile shows); never work it out "
            "from a date."
        ),
        input_model=NoInput, runner=_right_now,
    ),
    ChatTool(
        name="explain", tab=None, label="Page guide",
        description=(
            "Explains anything on the Analytics page from the page's own guide, with NO period needed: what a tile, "
            "chart, note or control shows; why it exists and the question it answers; how each of its numbers is worked "
            "out, step by step; where its data comes from; what is counted and what is left out; what its words mean; "
            "why it may look faded, empty or 'read with care'; and what the controls do. For Cost it also returns the "
            "organisation's current cost rates. It returns no fleet figures. Topics and what each covers: "
            + _topic_menu() + "."
        ),
        input_model=ExplainInput, runner=_explain, gives_figures=False,
    ),
)

TOOLS_BY_NAME: Mapping[str, ChatTool] = {tool.name: tool for tool in TOOLS}


def _invalid_input_message(exc: ValidationError) -> str:
    problems = "; ".join(
        f"{'.'.join(str(part) for part in error['loc']) or 'input'}: {error['msg']}" for error in exc.errors()
    )
    return f"Invalid input: {problems}"


async def _resolve_period(
    db: AsyncSession, organization_id: uuid.UUID, inputs: PeriodInput, now: datetime,
) -> Period:
    """The period the page would show for these inputs. ValueError (with the page's own
    message) when the charts can't draw it."""
    start, end = resolve_preset(inputs.preset, today=today_sast(now), start=inputs.start, end=inputs.end)
    first_day = await resolve_period_start(db, organization_id=organization_id, start=start, end=end, now=now)
    grain = inputs.grain if isinstance(inputs, TrendInput) else None
    return check_period(start=first_day, end=end, grain=grain, now=now)


async def run_tool(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    name: str,
    arguments: Mapping[str, object],
    now: datetime | None = None,
) -> ToolOutcome:
    """Run one tool call for the caller's organisation. Never raises for the model's mistakes."""
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return ToolOutcome(tool=None, result=None, error=f"Unknown tool: {name}", period=None)
    try:
        inputs = tool.input_model.model_validate(arguments)
    except ValidationError as exc:
        return ToolOutcome(tool=tool, result=None, error=_invalid_input_message(exc), period=None)

    moment = now if now is not None else datetime.now(UTC)
    period: Period | None = None
    if isinstance(inputs, PeriodInput):
        try:
            period = await _resolve_period(db, organization_id, inputs, moment)
        except ValueError as exc:
            return ToolOutcome(tool=tool, result=None, error=str(exc), period=None)
    result = await tool.runner(db, organization_id, period, moment, inputs)
    if tool.name not in ABOUT_BY_TOOL:
        return ToolOutcome(tool=tool, result=result, error=None, period=period)
    return ToolOutcome(tool=tool, result={"about": about(tool.name), **result}, error=None, period=period)
