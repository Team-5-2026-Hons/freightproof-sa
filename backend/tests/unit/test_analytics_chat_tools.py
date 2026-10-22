"""The Analytics chat's tools: right service, caller's organisation only, the page's periods,
model mistakes returned as messages, and no personal data in anything a tool can return.

Services are patched where tools.py looks them up, so no database is needed.
"""

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest
from pydantic import BaseModel

from app.analytics.fleet.periods import Grain, Period
from app.orchestration.analytics_chat import tools
from app.orchestration.analytics_chat.definitions import about
from app.orchestration.analytics_chat.page_guide import GUIDE
from app.orchestration.analytics_chat.tools import TOOLS, TOOLS_BY_NAME, run_tool
from app.schemas.cost_analytics import CostProfileRead, CostResponse
from app.schemas.fleet_analytics import (
    ActivityResponse,
    EvidenceResponse,
    FleetTilesResponse,
    OnTimeResponse,
    PatternsResponse,
    ProblemsResponse,
    ReviewResponse,
    RoutesResponse,
)

# 10:00 SAST on Monday 19 Oct 2026.
_NOW = datetime(2026, 10, 19, 8, 0, tzinfo=UTC)
_TODAY = date(2026, 10, 19)
# What "All time" starts at in these tests: the organisation's (patched) first trip.
_FIRST_TRIP = date(2025, 3, 1)

_SERVICES = (
    "get_activity", "get_patterns", "get_on_time", "get_problems", "get_review",
    "get_evidence", "get_routes", "get_cost", "get_tiles",
)

# tool name -> the service(s) it must call.
_TOOL_SERVICES = {
    "activity": ("get_activity", "get_patterns"),
    "on_time": ("get_on_time",),
    "problems": ("get_problems",),
    "review_desk": ("get_review",),
    "evidence": ("get_evidence",),
    "routes_and_sites": ("get_routes",),
    "cost": ("get_cost",),
    "right_now": ("get_tiles",),
}

# tool name -> every response model it can hand to the model (for the personal-data check).
_TOOL_OUTPUTS: dict[str, tuple[type[BaseModel], ...]] = {
    "activity": (ActivityResponse, PatternsResponse),
    "on_time": (OnTimeResponse,),
    "problems": (ProblemsResponse,),
    "review_desk": (ReviewResponse,),
    "evidence": (EvidenceResponse,),
    "routes_and_sites": (RoutesResponse,),
    "cost": (CostResponse,),
    "right_now": (FleetTilesResponse,),
}

# Field-name words that would mean personal data (POPIA, spec D5). Matched against whole
# underscore-separated words, so "late_1_15" doesn't trip "lat".
_PERSONAL_WORDS = frozenset({
    "driver", "person", "user", "phone", "email", "lat", "lng", "latitude", "longitude", "gps", "name",
})
# Fields that contain one of those words but are not personal data, as Model.field so a new
# field with the same name elsewhere is still checked. Each with its reason.
_ALLOWED_FIELDS = frozenset({
    # Business sites (depots), named on the page already; a site belongs to a client company.
    "SiteActivity.precinct_name",
    "LaneRisk.origin_name", "LaneRisk.destination_name",
    "LaneCost.origin_name", "LaneCost.destination_name",
    # Rand amounts: the driver share of operating cost, and the driver cost rate. Not a person.
    "OperatingCost.driver", "CostBucket.driver", "CostProfileRead.driver_cost_per_hour",
    # The admin who last saved the cost rates, shown on the Cost tab's rates card (spec §12). In the schema, but
    # stripped before anything is sent (tools._rates_without_names; test_cost_tool_never_sends_the_rates_editors_name).
    "CostProfileRead.updated_by_name",
    # A count of receiver sign-offs sent from a phone already signed in to FreightProof.
    "SignoffFlags.same_phone_count",
})


class _Stub(BaseModel):
    value: int = 1


@pytest.fixture
def services(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, AsyncMock]]:
    mocks = {name: AsyncMock(return_value=_Stub()) for name in _SERVICES}
    for name, mock in mocks.items():
        monkeypatch.setattr(tools, name, mock)
    # The stand-in results have no rows to total; totals have their own tests (test_analytics_chat_totals.py).
    for name in ("activity_totals", "patterns_totals", "on_time_totals", "problems_totals", "review_totals",
                 "evidence_totals", "routes_totals", "cost_totals"):
        monkeypatch.setattr(tools, name, lambda response: {"stub": True})
    monkeypatch.setattr(tools, "right_now_totals", lambda response, now: {"stub": True})
    monkeypatch.setattr(
        tools, "resolve_period_start",
        AsyncMock(side_effect=lambda db, *, organization_id, start, end, now: start or _FIRST_TRIP),
    )
    yield mocks


def _args(preset: str = "last_12_weeks", grain: str | None = "week", **extra: Any) -> dict[str, Any]:
    args: dict[str, Any] = {"preset": preset, "start": None, "end": None, **extra}
    if grain is not None:
        args["grain"] = grain
    return args


def _args_for(tool_name: str) -> dict[str, Any]:
    if tool_name == "right_now":
        return {}
    if tool_name == "routes_and_sites":
        return _args(grain=None)
    return _args()


# ── Which service, which organisation, which period ──────────────────────────


@pytest.mark.parametrize("tool_name", sorted(_TOOL_SERVICES))
async def test_run_tool_calls_its_service_for_the_callers_org(
    services: dict[str, AsyncMock], tool_name: str,
) -> None:
    org = uuid.uuid4()

    outcome = await run_tool(object(), organization_id=org, name=tool_name, arguments=_args_for(tool_name), now=_NOW)  # type: ignore[arg-type]

    assert outcome.error is None
    assert outcome.result is not None
    # The page's own lines about this tab come first, before any figure (B43).
    assert next(iter(outcome.result)) == "about"
    assert outcome.result["about"] == about(tool_name)
    for service in _TOOL_SERVICES[tool_name]:
        call = services[service].await_args
        assert services[service].await_count == 1
        assert call is not None
        assert call.kwargs["organization_id"] == org
    others = set(_SERVICES) - set(_TOOL_SERVICES[tool_name])
    assert all(services[name].await_count == 0 for name in others)


async def test_run_tool_on_time_resolves_last_12_months_like_the_page(services: dict[str, AsyncMock]) -> None:
    outcome = await run_tool(
        object(), organization_id=uuid.uuid4(), name="on_time",  # type: ignore[arg-type]
        arguments=_args("last_12_months", "month"), now=_NOW,
    )

    expected = Period(start=date(2025, 11, 1), end=_TODAY, grain=Grain.MONTH)
    assert outcome.period == expected
    assert services["get_on_time"].await_args is not None
    assert services["get_on_time"].await_args.kwargs["period"] == expected


async def test_run_tool_all_time_starts_at_the_first_trip(services: dict[str, AsyncMock]) -> None:
    outcome = await run_tool(
        object(), organization_id=uuid.uuid4(), name="problems",  # type: ignore[arg-type]
        arguments=_args("all_time", "month"), now=_NOW,
    )

    assert outcome.period == Period(start=_FIRST_TRIP, end=_TODAY, grain=Grain.MONTH)


async def test_run_tool_custom_month_uses_the_given_dates(services: dict[str, AsyncMock]) -> None:
    outcome = await run_tool(
        object(), organization_id=uuid.uuid4(), name="activity",  # type: ignore[arg-type]
        arguments=_args("custom", "month", start="2026-09-01", end="2026-09-30"),
        now=_NOW,
    )

    assert outcome.period == Period(start=date(2026, 9, 1), end=date(2026, 9, 30), grain=Grain.MONTH)


async def test_run_tool_activity_sends_patterns_no_grain(services: dict[str, AsyncMock]) -> None:
    outcome = await run_tool(
        object(), organization_id=uuid.uuid4(), name="activity", arguments=_args(), now=_NOW,  # type: ignore[arg-type]
    )

    assert services["get_patterns"].await_args is not None
    assert services["get_patterns"].await_args.kwargs["period"].grain is None
    assert outcome.result == {
        "about": about("activity"),
        "activity": {"totals": {"stub": True}, "value": 1}, "busy_patterns": {"totals": {"stub": True}, "value": 1},
    }


async def test_run_tool_routes_has_no_grain(services: dict[str, AsyncMock]) -> None:
    outcome = await run_tool(
        object(), organization_id=uuid.uuid4(), name="routes_and_sites",  # type: ignore[arg-type]
        arguments=_args(grain=None), now=_NOW,
    )

    assert outcome.period is not None
    assert outcome.period.grain is None


async def test_run_tool_right_now_has_no_period_and_passes_now(services: dict[str, AsyncMock]) -> None:
    outcome = await run_tool(
        object(), organization_id=uuid.uuid4(), name="right_now", arguments={}, now=_NOW,  # type: ignore[arg-type]
    )

    assert outcome.period is None
    assert services["get_tiles"].await_args is not None
    assert services["get_tiles"].await_args.kwargs["now"] == _NOW


# ── Mistakes come back as messages, and nothing runs ─────────────────────────


async def _assert_error(services: dict[str, AsyncMock], name: str, arguments: dict[str, Any], match: str) -> None:
    outcome = await run_tool(object(), organization_id=uuid.uuid4(), name=name, arguments=arguments, now=_NOW)  # type: ignore[arg-type]

    assert outcome.result is None
    assert outcome.error is not None
    assert match in outcome.error
    assert all(mock.await_count == 0 for mock in services.values())


async def test_run_tool_too_many_bars_returns_the_pages_message(services: dict[str, AsyncMock]) -> None:
    await _assert_error(services, "on_time", _args("last_3_years", "week"), "at most 53")


async def test_run_tool_custom_period_ending_after_today_is_an_error(services: dict[str, AsyncMock]) -> None:
    arguments = _args("custom", "month") | {"start": "2026-10-01", "end": "2026-11-30"}

    await _assert_error(services, "on_time", arguments, "can't end after today")


async def test_run_tool_custom_without_dates_is_an_error(services: dict[str, AsyncMock]) -> None:
    await _assert_error(services, "on_time", _args("custom", "month"), "needs both")


async def test_run_tool_unknown_tool_is_an_error(services: dict[str, AsyncMock]) -> None:
    await _assert_error(services, "incidents", _args(), "Unknown tool")


async def test_run_tool_rejects_an_organization_field(services: dict[str, AsyncMock]) -> None:
    await _assert_error(services, "on_time", _args(organization_id=str(uuid.uuid4())), "Invalid input")


async def test_run_tool_rejects_a_grain_on_routes(services: dict[str, AsyncMock]) -> None:
    await _assert_error(services, "routes_and_sites", _args(), "Invalid input")


async def test_run_tool_rejects_an_unknown_preset(services: dict[str, AsyncMock]) -> None:
    await _assert_error(services, "on_time", _args("last_2_decades"), "Invalid input")


async def test_run_tool_rejects_a_missing_grain(services: dict[str, AsyncMock]) -> None:
    await _assert_error(services, "on_time", _args(grain=None), "Invalid input")


# ── The tool list itself ─────────────────────────────────────────────────────


def test_tools_are_the_eight_figure_tools_and_the_page_guide() -> None:
    assert [tool.name for tool in TOOLS] == [
        "activity", "on_time", "problems", "review_desk", "evidence", "routes_and_sites", "cost", "right_now", "explain",
    ]
    assert {tool.name for tool in TOOLS if tool.gives_figures} == set(_TOOL_OUTPUTS)


@pytest.mark.parametrize("tool", TOOLS, ids=lambda tool: tool.name)
def test_tool_input_schema_has_no_organisation_field(tool: tools.ChatTool) -> None:
    assert "organi" not in str(tool.input_schema()).lower()


@pytest.mark.parametrize("tool", TOOLS, ids=lambda tool: tool.name)
def test_tool_input_schema_is_strict_compatible(tool: tools.ChatTool) -> None:
    schema = tool.input_schema()

    assert schema["additionalProperties"] is False
    assert sorted(schema.get("required", [])) == sorted(schema.get("properties", {}))  # type: ignore[call-overload]


def _fields(model: type[BaseModel]) -> Iterator[tuple[str, str]]:
    """(Model.field, field) for every field of the model and every model nested in it."""
    schema = model.model_json_schema()
    for definition in [schema, *schema.get("$defs", {}).values()]:
        for field in definition.get("properties", {}):
            yield f"{definition['title']}.{field}", field


def _personal_fields(models: tuple[type[BaseModel], ...]) -> list[str]:
    return sorted({
        qualified
        for model in models
        for qualified, field in _fields(model)
        if qualified not in _ALLOWED_FIELDS and _PERSONAL_WORDS & set(field.lower().split("_"))
    })


@pytest.mark.parametrize("tool_name", sorted(_TOOL_OUTPUTS))
def test_tool_outputs_carry_no_personal_data_fields(tool_name: str) -> None:
    assert _personal_fields(_TOOL_OUTPUTS[tool_name]) == []


def test_personal_data_check_catches_a_nested_driver_name() -> None:
    class _Row(BaseModel):
        driver_name: str
        lateness_minutes: int

    class _Response(BaseModel):
        rows: list[_Row]

    assert _personal_fields((_Response,)) == ["_Row.driver_name"]


# ── What the descriptions say a figure counts (B43) ─────────────────────────


def test_right_now_says_live_trips_include_planned_ones_and_where_each_trip_is_listed() -> None:
    description = TOOLS_BY_NAME["right_now"].description

    # 21 Oct: the chat said planned trips weren't tracked, while the tile counts them.
    assert "created, underway or on hold" in description
    assert "planned trips that haven't departed yet" in description
    assert "Active Trips list" in description
    assert "last 30 days" in description


def test_no_period_tool_claims_closed_trips_only_without_deferring_to_about() -> None:
    # Cancellations (dated when cancelled), busy patterns (any status) and the review desk (any
    # status) are not closed-trips-by-departure; the old wording said every tool was.
    for tool in TOOLS:
        assert "Counts closed trips only" not in tool.description
        if tool.gives_figures:
            assert "`about`" in tool.description


# ── The page guide (B45) ─────────────────────────────────────────────────────


async def test_run_tool_explain_needs_no_period_and_returns_the_guide(services: dict[str, AsyncMock]) -> None:
    outcome = await run_tool(object(), organization_id=uuid.uuid4(), name="explain", arguments={"topic": "on_time"}, now=_NOW)  # type: ignore[arg-type]

    assert outcome.error is None
    assert outcome.period is None
    assert outcome.result is not None
    assert "about" not in outcome.result
    titles = [entry["title"] for entry in outcome.result["guide"]]  # type: ignore[attr-defined]
    assert "How late is late" in titles
    assert all(mock.await_count == 0 for mock in services.values())


async def test_run_tool_explain_cost_adds_todays_rates_without_the_editors_name(
    monkeypatch: pytest.MonkeyPatch, services: dict[str, AsyncMock],
) -> None:
    org = uuid.uuid4()
    profile = CostProfileRead(
        diesel_price_per_litre=33.29, litres_per_100km=53.0, fuel_per_km=17.64, running_cost_per_km=15.10,
        driver_cost_per_hour=155.0, delay_cost_per_hour=1100.0, fixed_cost_per_trip=0.0, road_factor=1.15,
        is_default=False, updated_at=_NOW, updated_by_name="Thandi Mokoena",
    )
    read = AsyncMock(return_value=profile)
    monkeypatch.setattr(tools, "read_cost_profile", read)

    outcome = await run_tool(object(), organization_id=org, name="explain", arguments={"topic": "cost"}, now=_NOW)  # type: ignore[arg-type]

    assert outcome.result is not None
    rates = outcome.result["current_rates"]
    assert rates["fuel_per_km"] == 17.64  # type: ignore[index]
    assert "updated_by_name" not in rates  # type: ignore[operator]
    assert "Thandi" not in json.dumps(outcome.result)
    assert read.await_args is not None and read.await_args.kwargs["organization_id"] == org


async def test_run_tool_explain_rejects_an_unknown_topic(services: dict[str, AsyncMock]) -> None:
    await _assert_error(services, "explain", {"topic": "everything"}, "Invalid input: topic")


class _CostWithRates(BaseModel):
    rates: dict[str, object]


async def test_cost_tool_never_sends_the_rates_editors_name(services: dict[str, AsyncMock]) -> None:
    # 22 Oct: the cost response carried the name of the admin who last saved the rates, and it was sent as is.
    services["get_cost"].return_value = _CostWithRates(rates={"fuel_per_km": 17.64, "updated_by_name": "Thandi Mokoena"})

    outcome = await run_tool(object(), organization_id=uuid.uuid4(), name="cost", arguments=_args_for("cost"), now=_NOW)  # type: ignore[arg-type]

    assert outcome.result is not None
    assert outcome.result["rates"] == {"fuel_per_km": 17.64}
    assert "Thandi" not in json.dumps(outcome.result)


def test_the_explain_menu_names_every_guide_entry() -> None:
    description = TOOLS_BY_NAME["explain"].description

    assert "NO period needed" in description
    for entries in GUIDE.values():
        for entry in entries:
            assert entry.title in description
