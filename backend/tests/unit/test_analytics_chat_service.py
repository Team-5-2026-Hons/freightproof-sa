"""The Analytics chat's question loop, with a scripted model (tests/fake_ai_provider.py).

The tools, the "Based on" builder and the budget are replaced where service.py looks them
up, so no database, Redis or network is needed. What's tested is the loop: what it sends
the model, when it stops, what it returns, and what it never logs.
"""

import json
import logging
import uuid
from collections.abc import Mapping
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock

import pytest

from app.analytics.fleet.periods import Grain, Period
from app.core.config import settings
from app.integrations.ai_chat.provider import (
    AiCreditError,
    AiProviderError,
    AiQuotaError,
    AssistantReply,
    AssistantText,
    ToolResults,
    UserText,
)
from app.orchestration.analytics_chat import budget, service
from app.orchestration.analytics_chat.budget import BudgetSpentError
from app.orchestration.analytics_chat.prompt import (
    FIGURES_NEED_A_TOOL,
    NO_SOURCE_MESSAGE,
    REFUSAL_MESSAGE,
    SYSTEM_PROMPT,
    TOOL_CAP_MESSAGE,
)
from app.integrations.ai_chat.anthropic_client import AnthropicProvider
from app.integrations.ai_chat.gemini_client import GeminiProvider
from app.orchestration.analytics_chat.service import (
    MAX_MODEL_CALLS,
    TOOL_SPECS,
    ChatDisabledError,
    ChatCreditError,
    ChatProviderFailedError,
    ChatQuotaError,
    ask,
    build_provider,
)
from app.orchestration.analytics_chat.tools import TOOLS_BY_NAME, ToolOutcome
from app.schemas.analytics_chat import Basis, ChatAnswer, ChatRequest, ChatTurn, SpendStatus
from app.schemas.people import UserRead

from tests.fake_ai_provider import FAKE_USAGE, FakeProvider, text_reply, tool_reply

# 10:00 SAST on Monday 19 Oct 2026.
_NOW = datetime(2026, 10, 19, 8, 0, tzinfo=UTC)
_ON_TIME_ARGS: Mapping[str, object] = {"preset": "last_12_months", "start": None, "end": None, "grain": "month"}
_PERIOD = Period(start=date(2025, 11, 1), end=date(2026, 10, 19), grain=Grain.MONTH)
_SPEND = SpendStatus(spent_usd=0.5, budget_usd=20.0, available=True)
# 3000×1.50 + 3000×0.15 + 300×7.50 micro-dollars on gemini-3.8-flash.
_FAKE_CALL_COST = 7_200
_SECRET_QUESTION = "How late was Sipho Dlamini's truck on the N3?"


@pytest.fixture
def user() -> UserRead:
    return UserRead(
        id=uuid.uuid4(), organization_id=uuid.uuid4(), email="dispatcher@test.co.za", full_name="Dispatcher",
        created_at=_NOW, updated_at=_NOW,
    )


@pytest.fixture(autouse=True)
def enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "AI_CHAT_ENABLED", True)
    monkeypatch.setattr(settings, "AI_CHAT_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(settings, "AI_CHAT_MODEL", "gemini-3.8-flash")


@pytest.fixture(autouse=True)
def spend(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    mocks = {
        "ensure_available": AsyncMock(return_value=None),
        "record": AsyncMock(return_value=None),
        "status": AsyncMock(return_value=_SPEND),
    }
    for name, mock in mocks.items():
        monkeypatch.setattr(budget, name, mock)
    return mocks


@pytest.fixture(autouse=True)
def tool_runs(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """Every tool succeeds with {"figure": 42} over _PERIOD, except an unknown name."""

    async def _run(db: object, *, organization_id: uuid.UUID, name: str, arguments: Mapping[str, object], now: datetime) -> ToolOutcome:
        tool = TOOLS_BY_NAME.get(name)
        if tool is None:
            return ToolOutcome(tool=None, result=None, error=f"Unknown tool: {name}", period=None)
        return ToolOutcome(tool=tool, result={"figure": 42}, error=None, period=_PERIOD)

    mock = AsyncMock(side_effect=_run)
    monkeypatch.setattr(service, "run_tool", mock)

    async def _basis(db: object, *, organization_id: uuid.UUID, outcome: ToolOutcome) -> Basis | None:
        if outcome.tool is None or outcome.error is not None:
            return None
        return Basis(
            tool=outcome.tool.name, tab=outcome.tool.tab, label=outcome.tool.label,
            start=_PERIOD.start, end=_PERIOD.end, grain="month", closed_trip_count=7,
        )

    monkeypatch.setattr(service, "basis_for", _basis)
    return mock


def _request(question: str = "How did delays change over the past year?", history: list[ChatTurn] | None = None) -> ChatRequest:
    return ChatRequest(question=question, history=history or [])


async def _ask(provider: FakeProvider, user: UserRead, request: ChatRequest | None = None) -> ChatAnswer:
    return await ask(object(), user=user, request=request or _request(), provider=provider, now=_NOW)  # type: ignore[arg-type]


# ── Answers, follow-ups, declines ────────────────────────────────────────────


async def test_ask_tool_then_answer_returns_answer_with_basis(user: UserRead, tool_runs: AsyncMock) -> None:
    provider = FakeProvider([tool_reply(("on_time", _ON_TIME_ARGS)), text_reply("Arrivals were 81% on time.")])

    result = await _ask(provider, user)

    assert result.kind == "answer"
    assert result.answer == "Arrivals were 81% on time."
    assert [(b.tool, b.closed_trip_count) for b in result.basis] == [("on_time", 7)]
    assert result.spend == _SPEND
    assert tool_runs.await_args is not None
    assert tool_runs.await_args.kwargs["organization_id"] == user.organization_id


async def test_ask_sends_the_tool_result_back_after_the_assistant_turn(user: UserRead) -> None:
    first = tool_reply(("on_time", _ON_TIME_ARGS))
    provider = FakeProvider([first, text_reply("Done.")])

    await _ask(provider, user)

    second_request = provider.sent[1].messages
    assert second_request[-2] == AssistantReply(first)
    results = second_request[-1]
    assert isinstance(results, ToolResults)
    assert [(r.call_id, json.loads(r.content), r.is_error) for r in results.results] == [("call_0", {"figure": 42}, False)]


async def test_ask_follow_up_question_has_no_basis(user: UserRead, tool_runs: AsyncMock) -> None:
    provider = FakeProvider([text_reply("For which period: the last 12 weeks, or this year?")])

    result = await _ask(provider, user, _request("Which lane costs the most to run?"))

    assert result.kind == "follow_up"
    assert result.basis == []
    assert tool_runs.await_count == 0


async def test_ask_question_back_after_a_lookup_shows_no_figures_used(user: UserRead) -> None:
    # What gemini-3.5-flash-lite did on 20 Oct: looked up All time, then asked which period.
    provider = FakeProvider([tool_reply(("cost", _ON_TIME_ARGS)), text_reply("For which period: all time, or this year?")])

    result = await _ask(provider, user, _request("Which lane costs the most to run?"))

    assert (result.kind, result.basis) == ("follow_up", [])


async def test_ask_answer_ending_in_an_offer_keeps_its_basis(user: UserRead) -> None:
    long_answer = (
        "The lane from Cape Town Depot (Epping) to Johannesburg Depot (Linbro) had the most problems this year: "
        "34 problems across 3 trips, about 11.3 a trip, and it is the only lane with trips. Want the monthly breakdown?"
    )
    provider = FakeProvider([tool_reply(("routes_and_sites", {"preset": "this_year", "start": None, "end": None})), text_reply(long_answer)])

    result = await _ask(provider, user)

    assert result.kind == "answer"
    assert [b.tool for b in result.basis] == ["routes_and_sites"]


async def test_ask_answer_never_shows_an_em_dash(user: UserRead) -> None:
    provider = FakeProvider([text_reply("I can't predict next month \u2014 but the trend so far is flat.")])

    result = await _ask(provider, user)

    assert result.answer == "I can't predict next month, but the trend so far is flat."


def test_prompt_asks_for_no_em_dashes_and_dash_lists() -> None:
    assert "Never use em dashes" in SYSTEM_PROMPT
    assert 'one item per line starting with "- "' in SYSTEM_PROMPT


def test_prompt_asks_for_whole_rands() -> None:
    assert "Round rand amounts to whole rands" in SYSTEM_PROMPT


async def test_ask_answer_without_tools_or_question_is_declined(user: UserRead) -> None:
    provider = FakeProvider([text_reply("I can't predict next month, but I can show the trend so far.")])

    result = await _ask(provider, user)

    assert result.kind == "declined"
    assert result.basis == []


async def test_ask_refusal_returns_the_fixed_message_without_basis(user: UserRead) -> None:
    provider = FakeProvider([tool_reply(("on_time", _ON_TIME_ARGS)), text_reply("", stop="refusal")])

    result = await _ask(provider, user)

    assert (result.answer, result.kind, result.basis) == (REFUSAL_MESSAGE, "declined", [])


async def test_ask_empty_cut_off_answer_gets_a_message(user: UserRead) -> None:
    provider = FakeProvider([text_reply("", stop="max_tokens")])

    result = await _ask(provider, user)

    assert "ran too long" in result.answer


# ── Tools in one turn, errors, caps ──────────────────────────────────────────


async def test_ask_two_tools_in_one_turn_run_both_and_reply_once(user: UserRead, tool_runs: AsyncMock) -> None:
    provider = FakeProvider([
        tool_reply(("problems", _ON_TIME_ARGS), ("problems", {**_ON_TIME_ARGS, "preset": "this_year"})),
        text_reply("Q3 was higher."),
    ])

    result = await _ask(provider, user)

    assert tool_runs.await_count == 2
    results = provider.sent[1].messages[-1]
    assert isinstance(results, ToolResults)
    assert len(results.results) == 2
    # Same tab and period (the fake resolves both to _PERIOD): one Based on line, not two.
    assert len(result.basis) == 1


async def test_ask_tool_error_goes_back_as_an_error_with_no_basis(user: UserRead) -> None:
    provider = FakeProvider([tool_reply(("incidents", {})), text_reply("I can't look that up.")])

    result = await _ask(provider, user)

    results = provider.sent[1].messages[-1]
    assert isinstance(results, ToolResults)
    assert results.results[0].is_error is True
    assert "Unknown tool" in results.results[0].content
    assert result.basis == []


async def test_ask_stops_past_the_tool_call_cap(user: UserRead, tool_runs: AsyncMock) -> None:
    three = [("on_time", _ON_TIME_ARGS)] * 3
    two = [("problems", _ON_TIME_ARGS)] * 2
    provider = FakeProvider([tool_reply(*three), tool_reply(*two)])

    result = await _ask(provider, user)

    assert result.answer == TOOL_CAP_MESSAGE
    # It states no figures, so no "Based on" lines (eval run 4, q23 showed four under it).
    assert (result.kind, result.basis) == ("declined", [])
    assert tool_runs.await_count == 3


# ── "No tool, no figures" (eval run 4, q16) ──────────────────────────────────

_INVENTED = "I can't predict that, but this year: Total trips: 2,752; on-time arrivals 60.1% (1,652 of 2,750)."


async def test_ask_sends_back_figures_given_without_a_tool_then_uses_the_tool_answer(user: UserRead) -> None:
    provider = FakeProvider([
        text_reply(_INVENTED),
        tool_reply(("on_time", _ON_TIME_ARGS)),
        text_reply("I can't predict next month. So far, 42 arrivals were on time."),
    ])

    result = await _ask(provider, user, _request("Will delays get worse next month?"))

    assert provider.sent[1].messages[-1] == UserText(FIGURES_NEED_A_TOOL)
    assert result.kind == "answer"
    assert "2,752" not in result.answer
    assert [b.tool for b in result.basis] == ["on_time"]


async def test_ask_replaces_figures_given_without_a_tool_twice(user: UserRead, caplog: pytest.LogCaptureFixture) -> None:
    provider = FakeProvider([text_reply(_INVENTED), text_reply(_INVENTED)])

    result = await _ask(provider, user, _request("Will delays get worse next month?"))

    assert (result.answer, result.kind, result.basis) == (NO_SOURCE_MESSAGE, "declined", [])
    assert "figures no tool gave" in caplog.text


async def test_ask_question_back_naming_a_preset_period_is_not_flagged(user: UserRead) -> None:
    provider = FakeProvider([text_reply("For which period: the last 12 weeks, the last 3 months, or this year?")])

    result = await _ask(provider, user, _request("Which lane costs the most to run?"))

    assert result.kind == "follow_up"
    assert len(provider.sent) == 1


async def test_ask_decline_repeating_the_questions_numbers_is_not_flagged(user: UserRead) -> None:
    provider = FakeProvider([text_reply("I can't compare Q3 with Q2 2026 per driver: there is no per-driver data.")])

    result = await _ask(provider, user, _request("Compare driver problems in Q3 with Q2 2026."))

    assert result.kind == "declined"
    assert len(provider.sent) == 1


async def test_ask_never_makes_more_than_the_model_call_cap(user: UserRead) -> None:
    # One tool per reply: the tool cap (4) stops it on the 5th reply, never a 6th call.
    provider = FakeProvider([tool_reply(("on_time", _ON_TIME_ARGS)) for _ in range(MAX_MODEL_CALLS + 1)])

    result = await _ask(provider, user)

    assert result.answer == TOOL_CAP_MESSAGE
    assert len(provider.sent) <= MAX_MODEL_CALLS


# ── Budget, provider failures, switch ────────────────────────────────────────


async def test_ask_records_each_calls_cost(user: UserRead, spend: dict[str, AsyncMock]) -> None:
    provider = FakeProvider([tool_reply(("on_time", _ON_TIME_ARGS)), text_reply("Done.")])

    await _ask(provider, user)

    assert [call.args for call in spend["record"].await_args_list] == [
        (user.organization_id, _FAKE_CALL_COST), (user.organization_id, _FAKE_CALL_COST),
    ]
    assert FAKE_USAGE.output_tokens == 300  # the cost above assumes the fake's usage


async def test_ask_checks_the_budget_before_every_model_call(user: UserRead, spend: dict[str, AsyncMock]) -> None:
    spend["ensure_available"].side_effect = [None, BudgetSpentError("used up")]
    provider = FakeProvider([tool_reply(("on_time", _ON_TIME_ARGS)), text_reply("never sent")])

    with pytest.raises(BudgetSpentError):
        await _ask(provider, user)

    assert len(provider.sent) == 1


async def test_ask_credit_error_becomes_a_credit_error(user: UserRead) -> None:
    provider = FakeProvider([], error=AiCreditError("credit used up"))

    with pytest.raises(ChatCreditError):
        await _ask(provider, user)


async def test_ask_quota_error_becomes_a_quota_error(user: UserRead) -> None:
    provider = FakeProvider([], error=AiQuotaError("quota used up"))

    with pytest.raises(ChatQuotaError):
        await _ask(provider, user)


async def test_ask_provider_error_becomes_a_chat_error(user: UserRead) -> None:
    provider = FakeProvider([], error=AiProviderError("connection failed"))

    with pytest.raises(ChatProviderFailedError):
        await _ask(provider, user)


@pytest.mark.parametrize(
    ("setting", "value"),
    [
        ("AI_CHAT_ENABLED", False), ("GEMINI_API_KEY", ""), ("AI_CHAT_MODEL", "gemini-imaginary-9"),
        ("AI_CHAT_PROVIDER", "openai"), ("AI_CHAT_PROVIDER", "anthropic"),  # the last: no Anthropic key set
    ],
)
async def test_ask_switched_off_raises_before_any_call(
    monkeypatch: pytest.MonkeyPatch, user: UserRead, setting: str, value: object,
) -> None:
    monkeypatch.setattr(settings, setting, value)
    provider = FakeProvider([text_reply("never sent")])

    with pytest.raises(ChatDisabledError):
        await _ask(provider, user)

    assert provider.sent == []


# ── What is sent, and what is never logged ───────────────────────────────────


async def test_ask_sends_the_fixed_prompt_todays_date_and_all_tools(user: UserRead) -> None:
    provider = FakeProvider([text_reply("For which period?")])

    await _ask(provider, user)

    sent = provider.sent[0]
    assert sent.system == SYSTEM_PROMPT
    assert "Monday 2026-10-19" in sent.context
    assert sent.tools == TOOL_SPECS
    assert len(sent.tools) == 8


async def test_ask_tells_the_model_the_periods_the_question_names(user: UserRead) -> None:
    provider = FakeProvider([text_reply("For which period?")])

    await _ask(provider, user, _request("How many trips did we run last month?"))

    context = provider.sent[0].context
    assert context.startswith("Today is Monday 2026-10-19")
    assert '"last month" → preset "custom", start "2026-09-01", end "2026-09-30"' in context


async def test_ask_past_month_is_asked_back_and_its_30_is_not_taken_for_an_invented_figure(user: UserRead) -> None:
    ask_back = "For which period: the last 30 days, or September 2026 (the previous calendar month)?"
    provider = FakeProvider([text_reply(ask_back)])

    result = await _ask(provider, user, _request("How many problems have we had in the past month"))

    assert "Call no tool" in provider.sent[0].context
    # One call only: the guard didn't send it back for the "30" and "2026" the hint itself offered.
    assert len(provider.sent) == 1
    assert (result.answer, result.kind, result.basis) == (ask_back, "follow_up", [])


async def test_ask_last_year_is_asked_back_and_its_numbers_are_not_taken_for_invented_figures(user: UserRead) -> None:
    ask_back = "For which period: the last 12 months, or 2025 (the previous calendar year)?"
    provider = FakeProvider([text_reply(ask_back)])

    result = await _ask(provider, user, _request("How many trips did we run last year?"))

    assert "Call no tool" in provider.sent[0].context
    assert len(provider.sent) == 1
    assert (result.answer, result.kind, result.basis) == (ask_back, "follow_up", [])


def test_prompt_asks_back_when_a_question_has_two_readings_and_not_when_it_is_clear() -> None:
    assert "could reasonably mean two different things that would give different figures" in SYSTEM_PROMPT
    assert "Don't ask when the question, the server's note" in SYSTEM_PROMPT
    # "Last year" is asked back by the server now, so it is no longer mapped to 12 months here.
    assert '"last year"' not in SYSTEM_PROMPT


async def test_ask_gives_no_period_hint_when_none_is_named(user: UserRead) -> None:
    provider = FakeProvider([text_reply("For which period?")])

    await _ask(provider, user, _request("Which lane costs the most to run?"))

    assert provider.sent[0].context == "Today is Monday 2026-10-19 (South African time)."


async def test_ask_sends_history_as_text_and_drops_a_leading_answer(user: UserRead) -> None:
    history = [
        ChatTurn(role="assistant", text="An answer whose question was trimmed away."),
        ChatTurn(role="user", text="How many trips last month?"),
        ChatTurn(role="assistant", text="42 trips."),
    ]
    provider = FakeProvider([text_reply("For which month?")])

    await _ask(provider, user, _request("And the month before?", history))

    assert provider.sent[0].messages == (
        UserText("How many trips last month?"), AssistantText("42 trips."), UserText("And the month before?"),
    )


async def test_ask_logs_numbers_no_tool_returned_but_never_the_text(
    user: UserRead, caplog: pytest.LogCaptureFixture,
) -> None:
    # The fake tool returns {"figure": 42}; 97 is invented.
    provider = FakeProvider([tool_reply(("on_time", _ON_TIME_ARGS)), text_reply("Sipho's lane had 42 late trips, and 97 more were early.")])

    await _ask(provider, user)

    flagged = [record for record in caplog.records if "numbers no tool returned" in record.getMessage()]
    assert len(flagged) == 1
    assert "'97'" in flagged[0].getMessage() and "'42'" not in flagged[0].getMessage()
    assert "Sipho" not in caplog.text


async def test_ask_logs_nothing_when_every_number_came_from_a_tool(user: UserRead, caplog: pytest.LogCaptureFixture) -> None:
    provider = FakeProvider([tool_reply(("on_time", _ON_TIME_ARGS)), text_reply("42 trips were late over the last 12 months.")])

    await _ask(provider, user)

    assert "numbers no tool returned" not in caplog.text


async def test_ask_never_logs_the_question_or_answer(user: UserRead, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    provider = FakeProvider([tool_reply(("on_time", _ON_TIME_ARGS)), text_reply("Sipho Dlamini's truck was late.")])

    await _ask(provider, user, _request(_SECRET_QUESTION))

    assert "Analytics chat answered" in caplog.text
    assert "Sipho" not in caplog.text


# ── Which provider ───────────────────────────────────────────────────────────


def test_build_provider_gemini_by_default() -> None:
    provider = build_provider()

    assert isinstance(provider, GeminiProvider)
    assert provider.model == "gemini-3.8-flash"


def test_build_provider_anthropic_when_chosen(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "AI_CHAT_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(settings, "AI_CHAT_MODEL", "claude-sonnet-5-5")

    provider = build_provider()

    assert isinstance(provider, AnthropicProvider)
    assert provider.model == "claude-sonnet-5-5"
