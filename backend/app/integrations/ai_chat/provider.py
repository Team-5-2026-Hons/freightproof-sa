"""Provider-neutral types for the Analytics chat's model (FP-295 spec D2, §7.1).

The question loop (orchestration/analytics_chat/service.py) speaks only these types, so
swapping Anthropic for another provider means writing one new adapter, not touching the
loop, the tools or the "Based on" logic. Nothing here imports a provider's SDK.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol


@dataclass(frozen=True)
class ToolSpec:
    """One tool on the menu: its name, what it returns, and its JSON input schema."""

    name: str
    description: str
    input_schema: Mapping[str, object]


@dataclass(frozen=True)
class ToolCall:
    """The model asking to run a tool. `arguments` is parsed JSON, not yet validated."""

    id: str
    name: str
    arguments: Mapping[str, object]


@dataclass(frozen=True)
class Usage:
    """Tokens one model call used, split the way providers price them."""

    input_tokens: int
    output_tokens: int
    cache_write_tokens: int
    cache_read_tokens: int


# end: finished its turn · tool_use: wants tools run · refusal: declined for safety reasons ·
# max_tokens: cut off by the output limit.
StopKind = Literal["end", "tool_use", "refusal", "max_tokens"]


@dataclass(frozen=True)
class ModelReply:
    text: str
    tool_calls: tuple[ToolCall, ...]
    stop: StopKind
    usage: Usage
    # The provider's own form of this assistant turn. Sent back unchanged on the next call of
    # the same question, because providers may attach reasoning that must not be edited.
    raw: object


@dataclass(frozen=True)
class UserText:
    text: str


@dataclass(frozen=True)
class AssistantText:
    """An earlier answer from the conversation history: text only."""

    text: str


@dataclass(frozen=True)
class AssistantReply:
    """This question's own earlier assistant turn, passed back as the provider sent it."""

    reply: ModelReply


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    # The tool's name: Gemini matches a result to its call by name as well as id.
    name: str
    content: str
    is_error: bool


@dataclass(frozen=True)
class ToolResults:
    """Every result of one assistant turn's tool calls, sent back together."""

    results: tuple[ToolResult, ...]


ProviderMessage = UserText | AssistantText | AssistantReply | ToolResults


class AiProviderError(Exception):
    """The model provider couldn't answer (network, rate limit, outage, bad request).
    The only error the question loop expects from a provider."""


class AiCreditError(AiProviderError):
    """The provider refused because the account has no credit left (Gemini's HTTP 402,
    "Your prepayment credits are depleted"). Only topping up fixes it, so retrying is pointless
    and the dispatcher is told so plainly (spec B34)."""


class AiQuotaError(AiProviderError):
    """The provider refused because our allowance is used up (HTTP 429). Retrying straight
    away won't help, so the dispatcher is told so plainly (Gemini's free tier has a small
    daily allowance: spec B22)."""


class ChatProvider(Protocol):
    @property
    def model(self) -> str: ...

    async def reply(
        self,
        *,
        system: str,
        context: str,
        messages: Sequence[ProviderMessage],
        tools: Sequence[ToolSpec],
    ) -> ModelReply:
        """One model call. `system` never changes between requests (cached); `context`
        carries what does (today's date)."""
        ...
