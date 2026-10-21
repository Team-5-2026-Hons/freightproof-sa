"""The Analytics chat's adapter for Anthropic's Messages API (FP-295 spec D2, D16, §7.2).

One `reply` is one `messages.create` call. The question loop drives the tool loop itself
(not the SDK's beta Tool Runner), so it can check the spend cap before every call.

Request choices, each with its reason:
- tools are `strict`, so their arguments always match the schema; tool_choice stays `auto`
  (forcing a tool is a 400 on Sonnet 5.5, and the model must be free to ask a follow-up);
- effort `low`: a short chat answer, not a coding task; thinking is left at the model's default;
- the fixed system prompt is one cached block, and today's date a second, uncached one after
  it, so the cached prefix (tools + system) is byte-identical on every request;
- no refusal fallback (spec D17, Tom 19 Oct): a declined question gets a polite fixed reply.

Only page-level aggregates are ever sent (spec D5); this module never sees the database.
"""

import logging
from collections.abc import Sequence
from typing import Literal, cast

import anthropic
from anthropic.types import Message, MessageParam, TextBlockParam, ToolParam, ToolResultBlockParam

from app.integrations.ai_chat.provider import (
    AiProviderError,
    AiQuotaError,
    AssistantReply,
    AssistantText,
    ModelReply,
    ProviderMessage,
    StopKind,
    ToolCall,
    ToolSpec,
    Usage,
    UserText,
)

logger = logging.getLogger(__name__)

# Room for brief reasoning plus a few short paragraphs; answers are meant to be short, and a
# cut-off answer is worse than a few unused tokens (they cost nothing unless produced).
MAX_OUTPUT_TOKENS = 4_000
# Per call. With one retry a stuck call gives up in about a minute, inside the panel's timeout.
REQUEST_TIMEOUT_SECONDS = 30.0
MAX_RETRIES = 1
EFFORT: Literal["low"] = "low"

_STOP_KINDS: dict[str | None, StopKind] = {
    "end_turn": "end",
    "stop_sequence": "end",
    "pause_turn": "end",
    "tool_use": "tool_use",
    "refusal": "refusal",
    "max_tokens": "max_tokens",
    "model_context_window_exceeded": "max_tokens",
}


def _message_param(message: ProviderMessage) -> MessageParam:
    if isinstance(message, UserText):
        return {"role": "user", "content": message.text}
    if isinstance(message, AssistantText):
        return {"role": "assistant", "content": message.text}
    if isinstance(message, AssistantReply):
        # Passed back exactly as received (reasoning blocks included), as the API requires.
        return {"role": "assistant", "content": cast(Message, message.reply.raw).content}
    results: list[ToolResultBlockParam] = [
        {"type": "tool_result", "tool_use_id": result.call_id, "content": result.content, "is_error": result.is_error}
        for result in message.results
    ]
    return {"role": "user", "content": results}


def _tool_param(tool: ToolSpec) -> ToolParam:
    return {
        "name": tool.name,
        "description": tool.description,
        "input_schema": cast(dict[str, object], dict(tool.input_schema)),  # type: ignore[typeddict-item]
        "strict": True,
    }


def _reply_from(message: Message) -> ModelReply:
    text = "".join(block.text for block in message.content if block.type == "text")
    calls = tuple(
        ToolCall(id=block.id, name=block.name, arguments=cast(dict[str, object], block.input))
        for block in message.content
        if block.type == "tool_use"
    )
    usage = message.usage
    return ModelReply(
        text=text,
        tool_calls=calls,
        stop="tool_use" if calls else _STOP_KINDS.get(message.stop_reason, "end"),
        usage=Usage(
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cache_write_tokens=usage.cache_creation_input_tokens or 0,
            cache_read_tokens=usage.cache_read_input_tokens or 0,
        ),
        raw=message,
    )


class AnthropicProvider:
    def __init__(self, *, api_key: str, model: str, client: anthropic.AsyncAnthropic | None = None) -> None:
        self._model = model
        self._client = client or anthropic.AsyncAnthropic(
            api_key=api_key, timeout=REQUEST_TIMEOUT_SECONDS, max_retries=MAX_RETRIES,
        )

    @property
    def model(self) -> str:
        return self._model

    async def reply(
        self,
        *,
        system: str,
        context: str,
        messages: Sequence[ProviderMessage],
        tools: Sequence[ToolSpec],
    ) -> ModelReply:
        system_blocks: list[TextBlockParam] = [
            {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": context},
        ]
        try:
            message = await self._client.messages.create(
                model=self._model,
                max_tokens=MAX_OUTPUT_TOKENS,
                system=system_blocks,
                tools=[_tool_param(tool) for tool in tools],
                tool_choice={"type": "auto"},
                output_config={"effort": EFFORT},
                messages=[_message_param(message) for message in messages],
            )
        # Most specific first, so the log says which kind of failure it was.
        except anthropic.RateLimitError as exc:
            logger.warning("Anthropic rate limit: status=%s", exc.status_code)
            raise AiQuotaError("rate limited") from exc
        except anthropic.APIStatusError as exc:
            logger.warning("Anthropic error: %s status=%s", type(exc).__name__, exc.status_code)
            raise AiProviderError(f"status {exc.status_code}") from exc
        except anthropic.APIConnectionError as exc:
            logger.warning("Anthropic unreachable: %s", type(exc).__name__)
            raise AiProviderError("connection failed") from exc
        return _reply_from(message)
