"""The Analytics chat's question loop (FP-295 spec §7.3).

ask() sends the question to the model with the tool menu. While the model asks for tools,
it runs them for the caller's organisation (tools.run_tool) and sends the results back,
then returns the model's answer with the "Based on" lines our server built from the tools
that actually ran (basis.basis_for). Before EVERY model call it checks the monthly budget,
and after every call it records the real cost (budget.py).

Caps per question (spec D15): MAX_MODEL_CALLS model calls and MAX_TOOL_CALLS tool calls.

Never logs the question or the answer text (spec rule 13, D13): a dispatcher may have typed
a name. Logs ids, tool names, call counts and cost only.
"""

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.periods import today_sast
from app.core.config import settings
from app.integrations.ai_chat.anthropic_client import AnthropicProvider
from app.integrations.ai_chat.gemini_client import GeminiProvider
from app.integrations.ai_chat.pricing import (
    ModelPrice,
    UnknownModelError,
    cost_micro_usd,
    price_for,
)
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
from app.orchestration.analytics_chat import budget
from app.orchestration.analytics_chat.basis import basis_for
from app.orchestration.analytics_chat.number_check import unmatched_numbers
from app.orchestration.analytics_chat.page_view import page_view_hint
from app.orchestration.analytics_chat.period_hints import hint_for
from app.orchestration.analytics_chat.periods import PeriodPreset
from app.orchestration.analytics_chat.prompt import (
    CUT_OFF_MESSAGE,
    FIGURES_NEED_A_TOOL,
    NO_SOURCE_MESSAGE,
    REFUSAL_MESSAGE,
    SYSTEM_PROMPT,
    TOOL_CAP_MESSAGE,
    context_for,
)
from app.orchestration.analytics_chat.punctuation import without_em_dashes
from app.orchestration.analytics_chat.tools import TOOLS, run_tool
from app.schemas.analytics_chat import Basis, ChatAnswer, ChatRequest, ChatStatus
from app.schemas.people import UserRead

logger = logging.getLogger(__name__)

MAX_MODEL_CALLS = 5
MAX_TOOL_CALLS = 4
FOLLOW_UP_MAX_CHARS = 200

TOOL_SPECS: tuple[ToolSpec, ...] = tuple(
    ToolSpec(name=tool.name, description=tool.description, input_schema=tool.input_schema()) for tool in TOOLS
)

AnswerKind = Literal["answer", "follow_up", "explanation", "declined"]


_PROVIDER_KEYS = {"gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


class ChatDisabledError(Exception):
    """The chat is switched off, has no key, or its provider or model is unknown."""


class ChatCreditError(Exception):
    """The model provider's account has no credit left. Wraps AiCreditError for the same layering
    reason as ChatProviderFailedError."""


class ChatQuotaError(Exception):
    """The model provider's allowance is used up for now (its 429). Wraps AiQuotaError for the
    same layering reason as ChatProviderFailedError."""


class ChatProviderFailedError(Exception):
    """The model provider couldn't answer. Wraps integrations' AiProviderError so endpoints
    never import from integrations (the api-no-layer-skip import contract)."""


def _provider_key() -> str:
    setting = _PROVIDER_KEYS.get(settings.AI_CHAT_PROVIDER)
    if setting is None:
        logger.error("AI_CHAT_PROVIDER %r is not gemini or anthropic; the analytics chat stays off", settings.AI_CHAT_PROVIDER)
        return ""
    key: str = getattr(settings, setting)
    return key


def chat_enabled() -> bool:
    if not settings.AI_CHAT_ENABLED or not _provider_key():
        return False
    try:
        price_for(settings.AI_CHAT_MODEL)
    except UnknownModelError:
        logger.error("AI_CHAT_MODEL %r has no price; the analytics chat stays off", settings.AI_CHAT_MODEL)
        return False
    return True


def build_provider() -> ChatProvider:
    """The adapter AI_CHAT_PROVIDER names. Called only once chat_enabled() has passed."""
    if settings.AI_CHAT_PROVIDER == "anthropic":
        return AnthropicProvider(api_key=settings.ANTHROPIC_API_KEY, model=settings.AI_CHAT_MODEL)
    return GeminiProvider(
        api_key=settings.GEMINI_API_KEY, model=settings.AI_CHAT_MODEL, base_url=settings.GEMINI_API_URL,
    )


@dataclass(frozen=True)
class _Question:
    """What stays fixed while one question is answered."""

    db: AsyncSession
    organization_id: uuid.UUID
    provider: ChatProvider
    price: ModelPrice
    now: datetime
    text: str
    period_hint: str | None
    page_hint: str | None = None


@dataclass
class _Progress:
    """What builds up while one question is answered."""

    messages: list[ProviderMessage]
    basis: list[Basis] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)
    model_calls: int = 0
    cost_micro_usd: int = 0
    corrected: bool = False


def _opening_messages(request: ChatRequest) -> list[ProviderMessage]:
    """The history as text, then the question. A conversation must open with the user, so
    any leading assistant turns (a trimmed history can start with one) are dropped."""
    turns = list(request.history)
    while turns and turns[0].role == "assistant":
        turns.pop(0)
    messages: list[ProviderMessage] = [
        UserText(turn.text) if turn.role == "user" else AssistantText(turn.text) for turn in turns
    ]
    messages.append(UserText(request.question))
    return messages


async def _call_model(question: _Question, progress: _Progress) -> ModelReply:
    await budget.ensure_available(budget_usd=settings.AI_CHAT_MONTHLY_BUDGET_USD, now=question.now)
    reply = await question.provider.reply(
        system=SYSTEM_PROMPT,
        context=context_for(today_sast(question.now), question.period_hint, question.page_hint),
        messages=progress.messages,
        tools=TOOL_SPECS,
    )
    cost = cost_micro_usd(reply.usage, question.price)
    progress.model_calls += 1
    progress.cost_micro_usd += cost
    await budget.record(question.organization_id, cost, now=question.now)
    return reply


async def _run_tools(question: _Question, progress: _Progress, calls: tuple[ToolCall, ...]) -> ToolResults:
    """Run each call in turn (one database session can't run two queries at once) and
    collect every result for one message back to the model."""
    results: list[ToolResult] = []
    for call in calls:
        outcome = await run_tool(
            question.db, organization_id=question.organization_id,
            name=call.name, arguments=call.arguments, now=question.now,
        )
        progress.tools_used.append(call.name)
        if outcome.error is not None:
            results.append(ToolResult(call_id=call.id, name=call.name, content=outcome.error, is_error=True))
            continue
        results.append(ToolResult(call_id=call.id, name=call.name, content=json.dumps(outcome.result), is_error=False))
        basis = await basis_for(question.db, organization_id=question.organization_id, outcome=outcome)
        if basis is not None and basis not in progress.basis:
            progress.basis.append(basis)
    return ToolResults(results=tuple(results))


def _is_question_back(text: str) -> bool:
    stripped = text.strip()
    return stripped.endswith("?") and len(stripped) <= FOLLOW_UP_MAX_CHARS


def tool_texts(messages: list[ProviderMessage]) -> list[str]:
    """What each tool was asked for (the period, e.g. last_12_months) and what it returned during one
    question, as text: the sources an answer's numbers may honestly come from."""
    texts: list[str] = []
    for message in messages:
        if isinstance(message, AssistantReply):
            texts.extend(json.dumps(call.arguments) for call in message.reply.tool_calls)
        elif isinstance(message, ToolResults):
            texts.extend(result.content for result in message.results)
    return texts


def _check_numbers(question: _Question, progress: _Progress, request: ChatRequest, text: str) -> None:
    """Analysis A3: log any number in the answer that no tool returned. Numbers only, never text
    (rule 13). It flags invented figures; it can't flag a real figure used for the wrong thing."""
    if not progress.basis:
        return
    unmatched = unmatched_numbers(text, [*tool_texts(progress.messages), request.question])
    if unmatched:
        logger.warning(
            "Analytics chat answer has numbers no tool returned: org=%s model=%s tools=%s numbers=%s",
            question.organization_id, question.provider.model, progress.tools_used, unmatched,
        )


def _kind(progress: _Progress, text: str) -> AnswerKind:
    if progress.basis:
        return "answer"
    if text.rstrip().endswith("?"):
        return "follow_up"
    return "explanation" if _EXPLAIN_TOOL in progress.tools_used else "declined"


_EXPLAIN_TOOL = "explain"

_PERIOD_WORDS = " ".join(preset.value for preset in PeriodPreset)


def _unsourced_figures(question: _Question, progress: _Progress, text: str) -> list[str]:
    """Numbers in a reply that ran no figure tool, other than ones from the question, a period name or the page
    guide. Any such number was made up: no tool gave it (eval run 4, q16: "Total trips: 2,752…")."""
    if progress.basis:
        return []
    return unmatched_numbers(
        text,
        [question.text, _PERIOD_WORDS, question.period_hint or "", question.page_hint or "", *tool_texts(progress.messages)],
    )


def _final(question: _Question, progress: _Progress, reply: ModelReply) -> tuple[str, AnswerKind] | None:
    """The answer for a reply with no tool calls, or None to send the model back once to fix it."""
    text = without_em_dashes(reply.text.strip()) or CUT_OFF_MESSAGE
    invented = _unsourced_figures(question, progress, text)
    if invented and not progress.corrected:
        progress.corrected = True
        progress.messages.append(AssistantReply(reply))
        progress.messages.append(UserText(FIGURES_NEED_A_TOOL))
        return None
    if invented:
        logger.warning(
            "Analytics chat replaced an answer with figures no tool gave: org=%s model=%s numbers=%s",
            question.organization_id, question.provider.model, invented,
        )
        return NO_SOURCE_MESSAGE, "declined"
    if _is_question_back(text):
        progress.basis.clear()
    return text, _kind(progress, text)


async def _answer(question: _Question, progress: _Progress) -> tuple[str, AnswerKind]:
    tool_calls_made = 0
    while progress.model_calls < MAX_MODEL_CALLS:
        reply = await _call_model(question, progress)
        if reply.stop == "refusal":
            progress.basis.clear()
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
    progress.basis.clear()
    return TOOL_CAP_MESSAGE, "declined"


async def ask(
    db: AsyncSession,
    *,
    user: UserRead,
    request: ChatRequest,
    provider: ChatProvider | None = None,
    now: datetime | None = None,
) -> ChatAnswer:
    """Answer one question for the signed-in dispatcher's organisation.

    Raises ChatDisabledError (chat off), budget.BudgetSpentError (cap reached or Redis down)
    ChatCreditError (the provider account has no credit), ChatQuotaError (the provider's
    allowance is used up) and ChatProviderFailedError (the model couldn't answer). `provider` is
    for tests.
    """
    if not chat_enabled():
        raise ChatDisabledError("The analytics chat is switched off.")
    chosen = provider or build_provider()
    moment = now or datetime.now(UTC)
    question = _Question(
        db=db, organization_id=user.organization_id, provider=chosen,
        price=price_for(chosen.model), now=moment, text=request.question,
        period_hint=hint_for(request.question, today_sast(moment)),
        page_hint=None if request.page is None else page_view_hint(request.page, today_sast(moment)),
    )
    progress = _Progress(messages=_opening_messages(request))
    try:
        text, kind = await _answer(question, progress)
    except AiCreditError as exc:
        raise ChatCreditError(str(exc)) from exc
    except AiQuotaError as exc:
        raise ChatQuotaError(str(exc)) from exc
    except AiProviderError as exc:
        raise ChatProviderFailedError(str(exc)) from exc
    logger.info(
        "Analytics chat answered: org=%s model=%s kind=%s tools=%s model_calls=%d cost_micro_usd=%d",
        user.organization_id, chosen.model, kind, progress.tools_used, progress.model_calls, progress.cost_micro_usd,
    )
    _check_numbers(question, progress, request, text)
    spend = await budget.status(
        user.organization_id, budget_usd=settings.AI_CHAT_MONTHLY_BUDGET_USD, now=question.now,
    )
    return ChatAnswer(answer=text, kind=kind, basis=progress.basis, spend=spend)


async def chat_status(user: UserRead, *, now: datetime | None = None) -> ChatStatus:
    """Whether the panel should offer the chat, and this month's spend."""
    if not chat_enabled():
        return ChatStatus(enabled=False, spend=None)
    spend = await budget.status(user.organization_id, budget_usd=settings.AI_CHAT_MONTHLY_BUDGET_USD, now=now)
    return ChatStatus(enabled=True, spend=spend)
