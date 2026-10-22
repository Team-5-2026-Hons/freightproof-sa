"""The assistant's question loop (spec §7.2) with the scripted FakeProvider and the real tools on the
test database. The spend counters are patched where the service calls them, so no Redis is needed."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.enums import TripStatus
from app.db.models.people import Driver
from app.integrations.ai_chat.provider import AiCreditError, AiProviderError, AssistantText, ToolResults, UserText
from app.orchestration.analytics_chat.budget import BudgetSpentError
from app.orchestration.analytics_chat.service import ChatCreditError, ChatProviderFailedError
from app.orchestration.assistant import service, spend
from app.orchestration.assistant.prompt import (
    FACTS_NEED_A_TOOL,
    NO_SOURCE_MESSAGE,
    REFUSAL_MESSAGE,
    TOO_SLOW_MESSAGE,
    TOOL_CAP_MESSAGE,
)
from app.orchestration.assistant.service import MAX_MODEL_CALLS, AssistantDisabledError, ask
from app.schemas.assistant import AssistantRequest, ChooseCard, RecordRef, TripListCard
from app.schemas.people import UserRead
from tests.fake_ai_provider import FakeProvider, text_reply, tool_reply
from tests.integration._fleet_seed import (
    PLANNED_ARRIVAL_MINUTE,
    Operator,
    new_driver,
    not_started,
    operator_from_seed,
    other_operator,
    seed_trip,
)

NOW = datetime.now(UTC)
_NOW_WHEN = {"preset": "now", "n": None, "weekday": None, "day": None, "end_day": None, "time_of_day": None}
_ACTIVE = {
    "status_group": "active", "when": None, "which_time": None, "overdue_only": False, "precinct_name": None,
    "precinct_ref": None, "driver_name": None, "driver_ref": None, "vehicle_name": None, "vehicle_ref": None,
}


def _crew(**fields: object) -> dict[str, object]:
    return {"driver_name": None, "driver_ref": None, "vehicle_name": None, "vehicle_ref": None, "when": _NOW_WHEN, **fields}


@pytest.fixture(autouse=True)
def assistant_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ASSISTANT_ENABLED", True)
    monkeypatch.setattr(settings, "AI_CHAT_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "AI_CHAT_MODEL", "gemini-3.8-flash")


@pytest.fixture(autouse=True)
def spend_calls(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    mocks = {
        "ensure_available": AsyncMock(return_value=None),
        "record": AsyncMock(return_value=None),
        "status": AsyncMock(return_value=None),
    }
    for name, mock in mocks.items():
        monkeypatch.setattr(spend, name, mock)
    return mocks


def _user(operator: Operator) -> UserRead:
    return UserRead.model_validate(operator.dispatcher)


async def _ask(db: AsyncSession, operator: Operator, provider: FakeProvider, question: str, **request: Any) -> Any:
    return await ask(
        db, user=_user(operator), request=AssistantRequest(question=question, **request), provider=provider, now=NOW,
    )


async def _active_trip(db: AsyncSession, operator: Operator, seed: dict[str, Any]) -> None:
    await seed_trip(
        db, operator, stops=[seed["origin"], seed["dest"]], status=TripStatus.ACTIVE, steps=not_started(),
        start=NOW + timedelta(hours=3) - timedelta(minutes=PLANNED_ARRIVAL_MINUTE),
    )


async def test_ask_tool_then_answer_returns_cards_and_refs(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    await _active_trip(db_session, operator, seed)
    model = FakeProvider([tool_reply(("trips", _ACTIVE)), text_reply("You have 1 active trip, on the road.")])

    answer = await _ask(db_session, operator, model, "How many trips are active?")

    assert (answer.kind, answer.answer, answer.tools_used) == ("answer", "You have 1 active trip, on the road.", ["trips"])
    [card] = answer.cards
    assert isinstance(card, TripListCard) and card.total == 1
    assert {ref.kind for ref in answer.refs} == {"trip", "driver", "vehicle"}
    sent = model.sent[1].messages[-1]
    assert isinstance(sent, ToolResults) and not sent.results[0].is_error


async def test_ask_two_matching_drivers_is_a_follow_up_with_a_choice_card(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    for name in ("Tim Giltig", "Timothy Nkosi"):
        driver = new_driver(operator.org.id)
        driver.full_name = name
        db_session.add(driver)
    await db_session.flush()
    model = FakeProvider([tool_reply(("crew_bookings", _crew(driver_name="Tim"))), text_reply("Which Tim do you mean?")])

    answer = await _ask(db_session, operator, model, "Is Tim busy now?")

    assert answer.kind == "follow_up"
    [card] = answer.cards
    assert isinstance(card, ChooseCard) and {option.label for option in card.options} == {"Tim Giltig", "Timothy Nkosi"}


async def test_ask_history_refs_reach_the_model_and_resolve_to_the_same_driver(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    driver = seed["driver"]
    shown = RecordRef(kind="driver", id=driver.id, label=driver.full_name)
    history = [
        {"role": "user", "text": "Who's free now?"},
        {"role": "assistant", "text": "Driver is free.", "refs": [shown.model_dump(mode="json")]},
    ]
    model = FakeProvider([tool_reply(("crew_bookings", _crew(driver_ref="d1"))), text_reply("He has nothing booked.")])

    answer = await _ask(db_session, operator, model, "Is he busy now?", history=history)

    earlier = model.sent[0].messages[1]
    assert isinstance(earlier, AssistantText) and f"Records shown: driver {driver.full_name} [d1]." in earlier.text
    results = model.sent[1].messages[-1]
    assert isinstance(results, ToolResults) and not results.results[0].is_error
    assert '"label": "' + driver.full_name + '"' in results.results[0].content
    assert answer.kind == "answer"


async def test_ask_ref_to_another_orgs_driver_is_not_found(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    other = await other_operator(db_session)
    forged = RecordRef(kind="driver", id=other.driver.id, label="Someone")
    model = FakeProvider([tool_reply(("crew_bookings", _crew(driver_ref="d1"))), text_reply("I couldn't find that driver.")])

    await _ask(db_session, operator, model, "Is this one busy?", refs=[forged.model_dump(mode="json")])

    results = model.sent[1].messages[-1]
    assert isinstance(results, ToolResults) and results.results[0].is_error
    assert "No driver" in results.results[0].content


async def test_ask_drops_an_empty_trip_list_when_another_card_says_more(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    await _active_trip(db_session, operator, seed)
    today = {**_ACTIVE, "when": {**_NOW_WHEN, "preset": "today"}, "which_time": "arrival"}
    model = FakeProvider([
        tool_reply(("trips", {**today, "status_group": "closed"}), ("trips", {**_ACTIVE, "overdue_only": False})),
        text_reply("Nothing finishes today; 1 trip is on the road."),
    ])

    answer = await _ask(db_session, operator, model, "What's finishing today?")

    assert [card.type for card in answer.cards] == ["trip_list"]
    [card] = answer.cards
    assert isinstance(card, TripListCard) and card.total == 1


async def test_ask_returns_the_buttons_the_tools_made(seed: dict, db_session: AsyncSession) -> None:
    page = {"page": "exceptions", "record_ref": None, "exceptions_severity": "critical", "search": None, "barcode": None, "waybill": None}
    model = FakeProvider([tool_reply(("open_page", page)), text_reply("Here are the critical exceptions.")])

    answer = await _ask(db_session, operator_from_seed(seed), model, "Show me critical exceptions")

    [action] = answer.actions
    assert action.kind == "open_page" and action.filters == {"severity": "critical"}


async def test_ask_refusal_gives_the_fixed_reply(seed: dict, db_session: AsyncSession) -> None:
    model = FakeProvider([text_reply("", stop="refusal")])

    answer = await _ask(db_session, operator_from_seed(seed), model, "Anything")

    assert (answer.answer, answer.kind, answer.cards) == (REFUSAL_MESSAGE, "declined", [])


async def test_ask_stops_at_the_model_call_cap(seed: dict, db_session: AsyncSession) -> None:
    model = FakeProvider([tool_reply(("needs_attention", {"severity_at_least": None})) for _ in range(MAX_MODEL_CALLS)])

    answer = await _ask(db_session, operator_from_seed(seed), model, "Loop for ever")

    assert (answer.answer, answer.kind) == (TOOL_CAP_MESSAGE, "declined")
    assert len(model.sent) == MAX_MODEL_CALLS


class _TransactionWatcher(FakeProvider):
    """Records whether the session still held a transaction (and so a pooled connection) at each model call."""

    def __init__(self, db: AsyncSession, replies: list[Any]) -> None:
        super().__init__(replies)
        self.db = db
        self.in_transaction: list[bool] = []

    async def reply(self, **kwargs: Any) -> Any:
        self.in_transaction.append(self.db.in_transaction())
        return await super().reply(**kwargs)


async def test_ask_hands_the_connection_back_while_waiting_on_the_model(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    await _active_trip(db_session, operator, seed)
    model = _TransactionWatcher(db_session, [tool_reply(("trips", _ACTIVE)), text_reply("1 active trip.")])

    answer = await _ask(db_session, operator, model, "How many trips are active?")

    assert answer.kind == "answer"
    assert model.in_transaction == [False, False]


async def test_ask_keeps_writes_already_pending_in_the_request(seed: dict, db_session: AsyncSession) -> None:
    """The sign-in dependency's idle-timeout stamp is pending in the same session: it must survive (B27)."""
    operator = operator_from_seed(seed)
    stamp = new_driver(operator.org.id)
    db_session.add(stamp)
    await db_session.flush()
    model = FakeProvider([tool_reply(("trips", _ACTIVE)), text_reply("No active trips.")])

    await _ask(db_session, operator, model, "How many trips are active?")
    await db_session.rollback()

    assert await db_session.get(Driver, stamp.id) is not None


class _SlowProvider(FakeProvider):
    """A provider that takes longer than the question's time limit."""

    async def reply(self, **kwargs: Any) -> Any:
        await asyncio.sleep(1)
        return await super().reply(**kwargs)


async def test_ask_past_its_time_limit_answers_plainly_instead_of_timing_out(
    seed: dict, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service, "QUESTION_DEADLINE_SECONDS", 0.05)
    model = _SlowProvider([text_reply("Too late.")])

    answer = await _ask(db_session, operator_from_seed(seed), model, "What's finishing today?")

    assert (answer.answer, answer.kind, answer.cards) == (TOO_SLOW_MESSAGE, "declined", [])


async def test_ask_facts_without_a_tool_are_sent_back_then_replaced(seed: dict, db_session: AsyncSession) -> None:
    model = FakeProvider([text_reply("You have 12 trips."), text_reply("Still 12 trips.")])

    answer = await _ask(db_session, operator_from_seed(seed), model, "How many trips?")

    correction = model.sent[1].messages[-1]
    assert isinstance(correction, UserText) and correction.text == FACTS_NEED_A_TOOL
    assert (answer.answer, answer.kind) == (NO_SOURCE_MESSAGE, "declined")


async def test_ask_numbers_the_dispatcher_typed_are_not_invented(seed: dict, db_session: AsyncSession) -> None:
    model = FakeProvider([text_reply("Do you mean manifest 81 from Parcel Perfect?")])

    answer = await _ask(db_session, operator_from_seed(seed), model, "What's on manifest 81?")

    assert answer.kind == "follow_up"
    assert len(model.sent) == 1


async def test_ask_checks_the_budget_before_every_model_call(
    seed: dict, db_session: AsyncSession, spend_calls: dict[str, AsyncMock],
) -> None:
    spend_calls["ensure_available"].side_effect = [None, BudgetSpentError("used up")]
    model = FakeProvider([tool_reply(("needs_attention", {"severity_at_least": None})), text_reply("Done.")])

    with pytest.raises(BudgetSpentError):
        await _ask(db_session, operator_from_seed(seed), model, "What needs attention?")

    assert len(model.sent) == 1
    assert spend_calls["record"].await_count == 1


async def test_ask_switched_off_raises(seed: dict, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ASSISTANT_ENABLED", False)

    with pytest.raises(AssistantDisabledError):
        await _ask(db_session, operator_from_seed(seed), FakeProvider([]), "Hello")


@pytest.mark.parametrize(
    ("error", "raised"), [(AiProviderError("down"), ChatProviderFailedError), (AiCreditError("402"), ChatCreditError)],
)
async def test_ask_provider_errors_are_wrapped(
    seed: dict, db_session: AsyncSession, error: AiProviderError, raised: type[Exception],
) -> None:
    with pytest.raises(raised):
        await _ask(db_session, operator_from_seed(seed), FakeProvider([], error=error), "Hello")


async def test_ask_hints_and_time_reach_the_model_but_not_the_logs(
    seed: dict, db_session: AsyncSession, caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG, logger=service.__name__)
    model = FakeProvider([text_reply("Is that 05:00 or 17:00?")])

    await _ask(db_session, operator_from_seed(seed), model, "Book Tim Giltig on Thursday at 5")

    context = model.sent[0].context
    assert "South African time" in context and "no am or pm" in context
    assert "Tim Giltig" not in caplog.text and "Thursday" not in caplog.text


async def test_ask_em_dashes_never_reach_the_dispatcher(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    model = FakeProvider([tool_reply(("trips", _ACTIVE)), text_reply("No active trips — all quiet.")])

    answer = await _ask(db_session, operator, model, "Anything active?")

    assert "—" not in answer.answer


async def test_ask_record_tags_never_reach_the_dispatcher(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    model = FakeProvider([
        tool_reply(("trips", _ACTIVE)),
        text_reply("Sipho Dlamini [d1] leaves Cape Town Depot (Epping) (p1) with [d1, v3] (see the list)."),
    ])

    answer = await _ask(db_session, operator, model, "Anything active?")

    assert answer.answer == "Sipho Dlamini leaves Cape Town Depot (Epping) with (see the list)."


async def test_ask_drops_a_leading_assistant_turn(seed: dict, db_session: AsyncSession) -> None:
    model = FakeProvider([text_reply("Which trip?")])
    history = [{"role": "assistant", "text": "Hello"}, {"role": "user", "text": "Where is my trip?"}]

    await _ask(db_session, operator_from_seed(seed), model, "The one to Cape Town", history=history)

    first = model.sent[0].messages[0]
    assert isinstance(first, UserText) and first.text == "Where is my trip?"
