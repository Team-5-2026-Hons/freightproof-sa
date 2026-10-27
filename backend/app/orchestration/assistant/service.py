"""The dispatcher assistant's question loop (spec §7.2), modelled on the Analytics chat's.

ask() sends the question, the conversation so far and the tool menu to the model. While the model
asks for tools, it runs them for the caller's organisation (tools.run_tool) and sends the trimmed
results back; then it returns the model's short reply with the cards our server built from those
results (spec D3). Before EVERY model call it checks the shared monthly budget, and after every call
it records the real cost (spend.py, D7).

Records travel as short tags (refs.py): the conversation's earlier records are tagged first, in
order, and listed to the model after the turn that showed them, so "him" resolves to the same id.

"No tool, no facts" is enforced, not only asked for: a reply that ran no tool and still states
numbers the dispatcher didn't type is sent back once, then replaced (FP-295's rule, B-items there).

Caps per question: MAX_MODEL_CALLS model calls, MAX_TOOL_CALLS tool calls and QUESTION_DEADLINE_SECONDS.

Never logs the question, the answer, tool results or names (spec rule 12): this chat carries driver
names. Logs ids, tool names, counts and cost only.
"""

import asyncio
import json
import logging
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.ai_chat.pricing import ModelPrice, cost_micro_usd, price_for
from app.integrations.ai_chat.provider import (
    AiCreditError,
    AiProviderError,
    AiQuotaError,
    AssistantReply,
    AssistantText,
    ChatProvider,
    ModelReply,
    ProviderMessage,
    ToolCall,
    ToolResult,
    ToolResults,
    ToolSpec,
    UserText,
)
from app.orchestration.analytics_chat.number_check import unmatched_numbers
from app.orchestration.analytics_chat.punctuation import without_em_dashes
from app.orchestration.analytics_chat.service import (
    ChatCreditError,
    ChatProviderFailedError,
    ChatQuotaError,
    build_provider,
    tool_texts,
)
from app.orchestration.assistant import spend
from app.orchestration.assistant.enabled import assistant_enabled
from app.orchestration.assistant.hints import hints_for
from app.orchestration.assistant.prompt import (
    CUT_OFF_MESSAGE,
    FACTS_NEED_A_TOOL,
    NO_SOURCE_MESSAGE,
    REFUSAL_MESSAGE,
    SYSTEM_PROMPT,
    TOO_SLOW_MESSAGE,
    TOOL_CAP_MESSAGE,
    context_for,
)
from app.orchestration.assistant.refs import RefBook
from app.orchestration.assistant.tools import TOOLS, run_tool
from app.orchestration.assistant.tools_base import ToolContext
from app.schemas.assistant import (
    MAX_REFS_PER_TURN,
    AnswerKind,
    AssistantAction,
    AssistantAnswer,
    AssistantCard,
    AssistantRequest,
    AssistantStatus,
    AssistantTurn,
    IncidentListCard,
    OpenTripFormAction,
    RecordRef,
    ReviewQueueCard,
    TripListCard,
)
from app.schemas.people import UserRead

logger = logging.getLogger(__name__)

MAX_MODEL_CALLS = 7
MAX_TOOL_CALLS = 8
FOLLOW_UP_MAX_CHARS = 300
MAX_CARDS = 8
MAX_ACTIONS = 3
QUESTION_DEADLINE_SECONDS = 45.0

TOOL_SPECS: tuple[ToolSpec, ...] = tuple(
    ToolSpec(name=tool.name, description=tool.description, input_schema=tool.input_schema()) for tool in TOOLS
)


class AssistantDisabledError(Exception):
    """The assistant is switched off, has no key, or its model has no price."""


@dataclass(frozen=True)
class _Question:
    """What stays fixed while one question is answered."""

    db: AsyncSession
    organization_id: uuid.UUID
    provider: ChatProvider
    price: ModelPrice
    now: datetime
    typed: tuple[str, ...]
    hints: tuple[str, ...]


@dataclass
class _Progress:
    """What builds up while one question is answered."""

    messages: list[ProviderMessage]
    refs: RefBook
    seeded: int
    cards: list[AssistantCard] = field(default_factory=list)
    actions: list[AssistantAction] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)
    ran_tool: bool = False
    model_calls: int = 0
    cost_micro_usd: int = 0
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    corrected: bool = False


def _records_line(heading: str, records: Sequence[RecordRef], refs: RefBook) -> str:
    """"Records shown: driver Tim Giltig [d1]; vehicle CA 123-456 (horse) [v1]."""
    named = [
        f"{record.kind} {record.label}{f' ({record.detail})' if record.detail else ''} [{refs.tag(record)}]"
        for record in records
    ]
    return f"{heading}: {'; '.join(named)}."


def _with_records(text: str, heading: str, records: Sequence[RecordRef], refs: RefBook) -> str:
    return text if not records else f"{text}\n\n{_records_line(heading, records, refs)}"


def _opening_messages(request: AssistantRequest, refs: RefBook) -> list[ProviderMessage]:
    """The history as text with its records listed, then the question. A conversation must open with
    the user, so leading assistant turns (a trimmed history can start with one) are dropped."""
    turns: list[AssistantTurn] = list(request.history)
    while turns and turns[0].role == "assistant":
        turns.pop(0)
    messages: list[ProviderMessage] = []
    for turn in turns:
        if turn.role == "user":
            messages.append(UserText(_with_records(turn.text, "Records meant", turn.refs, refs)))
        else:
            messages.append(AssistantText(_with_records(turn.text, "Records shown", turn.refs, refs)))
    messages.append(UserText(_with_records(request.question, "Records meant", request.refs, refs)))
    return messages


async def _call_model(question: _Question, progress: _Progress) -> ModelReply:
    await spend.ensure_available(now=question.now)
    reply = await question.provider.reply(
        system=SYSTEM_PROMPT, context=context_for(question.now, question.hints),
        messages=progress.messages, tools=TOOL_SPECS,
    )
    cost = cost_micro_usd(reply.usage, question.price)
    progress.model_calls += 1
    progress.cost_micro_usd += cost
    progress.input_tokens += reply.usage.input_tokens
    progress.cached_tokens += reply.usage.cache_read_tokens
    progress.output_tokens += reply.usage.output_tokens
    await spend.record(question.organization_id, cost, now=question.now)
    return reply


async def _run_tools(question: _Question, progress: _Progress, calls: tuple[ToolCall, ...]) -> ToolResults:
    """Run each call in turn (one database session can't run two queries at once) and collect every
    result for one message back to the model."""
    context = ToolContext(db=question.db, organization_id=question.organization_id, now=question.now, refs=progress.refs)
    results: list[ToolResult] = []
    for call in calls:
        outcome = await run_tool(context, name=call.name, arguments=call.arguments)
        progress.tools_used.append(call.name)
        if outcome.error is not None:
            results.append(ToolResult(call_id=call.id, name=call.name, content=outcome.error, is_error=True))
            continue
        progress.ran_tool = True
        progress.cards.extend(outcome.cards)
        progress.actions.extend(outcome.actions)
        results.append(ToolResult(call_id=call.id, name=call.name, content=json.dumps(outcome.result), is_error=False))
    return ToolResults(results=tuple(results))


_REF_IN_TEXT = re.compile(r"\s?[\[(][dvtp]\d{1,3}(?:,\s*[dvtp]\d{1,3})*[\])]")


def _without_refs(text: str) -> str:
    return _REF_IN_TEXT.sub("", text)


def _kind(progress: _Progress, text: str) -> AnswerKind:
    stripped = text.strip()
    if stripped.endswith("?") and len(stripped) <= FOLLOW_UP_MAX_CHARS:
        return "follow_up"
    return "answer" if progress.ran_tool else "declined"


def _final(question: _Question, progress: _Progress, reply: ModelReply) -> tuple[str, AnswerKind] | None:
    """The answer for a reply with no tool calls, or None to send the model back once to fix it."""
    text = _without_refs(without_em_dashes(reply.text.strip())) or CUT_OFF_MESSAGE
    invented = [] if progress.ran_tool else unmatched_numbers(text, [*question.typed, *question.hints])
    if invented and not progress.corrected:
        progress.corrected = True
        progress.messages.append(AssistantReply(reply))
        progress.messages.append(UserText(FACTS_NEED_A_TOOL))
        return None
    if invented:
        logger.warning(
            "Assistant replaced an answer with numbers no tool gave: org=%s model=%s numbers=%s",
            question.organization_id, question.provider.model, invented,
        )
        return NO_SOURCE_MESSAGE, "declined"
    return text, _kind(progress, text)


async def _answer(question: _Question, progress: _Progress) -> tuple[str, AnswerKind]:
    tool_calls_made = 0
    while progress.model_calls < MAX_MODEL_CALLS:
        reply = await _call_model(question, progress)
        if reply.stop == "refusal":
            return REFUSAL_MESSAGE, "declined"
        if not reply.tool_calls:
            final = _final(question, progress, reply)
            if final is not None:
                return final
            continue
        tool_calls_made += len(reply.tool_calls)
        if tool_calls_made > MAX_TOOL_CALLS:
            break
        progress.messages.append(AssistantReply(reply))
        progress.messages.append(await _run_tools(question, progress, reply.tool_calls))
        await _release_connection(question.db)
    return TOOL_CAP_MESSAGE, "declined"


async def _release_connection(db: AsyncSession) -> None:
    """End the request's transaction before waiting on the model, so its pooled connection goes back.

    The backend has only DB_POOL_SIZE + DB_MAX_OVERFLOW connections (3: four devs share Supabase's 15), and a session
    keeps its connection for as long as its transaction is open, so a question held one through every model call and
    the trips pages timed out queueing for the rest (Tom's test, 21 Oct, B27). COMMIT, not ROLLBACK: the assistant
    writes nothing, but the sign-in dependency's idle-timeout stamp (auth.sessions.enforce_user_idle_timeout) is
    pending in this same session, and get_db would commit it at the end anyway. A rollback would discard it and
    could sign out a dispatcher who is busy using the chat."""
    await db.commit()


def _is_empty_list(card: AssistantCard) -> bool:
    """A trip list, incident list or review queue with nothing in it."""
    return (
        (isinstance(card, TripListCard) and card.total == 0)
        or (isinstance(card, IncidentListCard) and not card.rows)
        or (isinstance(card, ReviewQueueCard) and card.total == 0)
    )


def _unique_cards(cards: Sequence[AssistantCard]) -> list[AssistantCard]:
    """The same look-up twice gives the same card once; empty lists are dropped when another card shows something
    (the reply already says "none", B26), and kept when every card is empty ("no trips, no incidents" is the
    answer); at most MAX_CARDS, in the order they came."""
    seen: set[str] = set()
    unique: list[AssistantCard] = []
    for card in cards:
        key = card.model_dump_json()
        if key not in seen:
            seen.add(key)
            unique.append(card)
    if any(not _is_empty_list(card) for card in unique):
        unique = [card for card in unique if not _is_empty_list(card)]
    return unique[:MAX_CARDS]


def _unique_actions(actions: Sequence[AssistantAction]) -> list[AssistantAction]:
    """The same button once, the latest version of a trip form (a corrected call replaces the first), at most MAX_ACTIONS."""
    forms = [action for action in actions if isinstance(action, OpenTripFormAction)]
    kept: list[AssistantAction] = []
    seen: set[str] = set()
    for action in actions:
        if isinstance(action, OpenTripFormAction) and action is not forms[-1]:
            continue
        key = action.model_dump_json()
        if key not in seen:
            seen.add(key)
            kept.append(action)
    return kept[:MAX_ACTIONS]


def _check_numbers(question: _Question, progress: _Progress, text: str) -> None:
    """Log any number in an answer that no tool returned (numbers only, never text: rule 12)."""
    if not progress.ran_tool:
        return
    unmatched = unmatched_numbers(text, [*tool_texts(progress.messages), *question.typed, *question.hints])
    if unmatched:
        logger.warning(
            "Assistant answer has numbers no tool returned: org=%s model=%s tools=%s numbers=%s",
            question.organization_id, question.provider.model, progress.tools_used, unmatched,
        )


async def ask(
    db: AsyncSession,
    *,
    user: UserRead,
    request: AssistantRequest,
    provider: ChatProvider | None = None,
    now: datetime | None = None,
) -> AssistantAnswer:
    """Answer one question for the signed-in dispatcher's organisation.

    Raises AssistantDisabledError (off), budget.BudgetSpentError (cap reached or Redis down),
    ChatCreditError (no credit), ChatQuotaError (provider allowance used up) and
    ChatProviderFailedError (the model couldn't answer). `provider` is for tests.
    """
    if not assistant_enabled():
        raise AssistantDisabledError("The assistant is switched off.")
    chosen = provider or build_provider()
    moment = now or datetime.now(UTC)
    refs = RefBook()
    messages = _opening_messages(request, refs)
    question = _Question(
        db=db, organization_id=user.organization_id, provider=chosen, price=price_for(chosen.model), now=moment,
        typed=(request.question, *(turn.text for turn in request.history)),
        hints=hints_for(request.question, now=moment),
    )
    progress = _Progress(messages=messages, refs=refs, seeded=len(refs.records()))
    await _release_connection(db)
    try:
        async with asyncio.timeout(QUESTION_DEADLINE_SECONDS):
            text, kind = await _answer(question, progress)
    except TimeoutError:
        logger.warning(
            "Assistant stopped at its %.0f s limit: org=%s model=%s tools=%s model_calls=%d",
            QUESTION_DEADLINE_SECONDS, user.organization_id, chosen.model, progress.tools_used, progress.model_calls,
        )
        progress.cards.clear()
        progress.actions.clear()
        text, kind = TOO_SLOW_MESSAGE, "declined"
    except AiCreditError as exc:
        raise ChatCreditError(str(exc)) from exc
    except AiQuotaError as exc:
        raise ChatQuotaError(str(exc)) from exc
    except AiProviderError as exc:
        raise ChatProviderFailedError(str(exc)) from exc
    logger.info(
        "Assistant answered: org=%s model=%s kind=%s tools=%s model_calls=%d input_tokens=%d cached_tokens=%d "
        "output_tokens=%d cost_micro_usd=%d",
        user.organization_id, chosen.model, kind, progress.tools_used, progress.model_calls, progress.input_tokens,
        progress.cached_tokens, progress.output_tokens, progress.cost_micro_usd,
    )
    _check_numbers(question, progress, text)
    return AssistantAnswer(
        answer=text, kind=kind, cards=_unique_cards(progress.cards), actions=_unique_actions(progress.actions),
        tools_used=progress.tools_used,
        refs=refs.records()[progress.seeded:][:MAX_REFS_PER_TURN],
        spend=await spend.status(user.organization_id, now=moment),
    )


async def assistant_status(user: UserRead, *, now: datetime | None = None) -> AssistantStatus:
    """Whether the bubble should show, and this month's spend."""
    if not assistant_enabled():
        return AssistantStatus(enabled=False, spend=None)
    return AssistantStatus(enabled=True, spend=await spend.status(user.organization_id, now=now))
