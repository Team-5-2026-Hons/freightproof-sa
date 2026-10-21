"""The Anthropic adapter: the request it builds, how it reads replies, and how it reports
failures. The SDK client is replaced by a stub, so nothing reaches the network."""

from collections.abc import Mapping
from typing import Any
from unittest.mock import AsyncMock

import anthropic
import httpx2
import pytest
from anthropic.types import Message

from app.integrations.ai_chat.anthropic_client import EFFORT, MAX_OUTPUT_TOKENS, AnthropicProvider
from app.integrations.ai_chat.provider import (
    AiProviderError,
    AssistantReply,
    AssistantText,
    ToolResult,
    ToolResults,
    ToolSpec,
    UserText,
)

_MODEL = "claude-sonnet-5-5"
_TOOLS = (
    ToolSpec(name="on_time", description="On time tab", input_schema={"type": "object", "additionalProperties": False}),
    ToolSpec(name="right_now", description="Tiles", input_schema={"type": "object", "additionalProperties": False}),
)
_REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def _message(content: list[dict[str, Any]], stop_reason: str, usage: Mapping[str, int | None] | None = None) -> Message:
    return Message.model_validate({
        "id": "msg_test", "type": "message", "role": "assistant", "model": _MODEL,
        "content": content, "stop_reason": stop_reason, "stop_sequence": None,
        "usage": usage or {"input_tokens": 100, "output_tokens": 20, "cache_creation_input_tokens": None, "cache_read_input_tokens": None},
    })


class _StubClient:
    def __init__(self, result: Message | Exception) -> None:
        self.messages = AsyncMock()
        self.messages.create = AsyncMock(side_effect=[result])


def _provider(result: Message | Exception) -> tuple[AnthropicProvider, _StubClient]:
    client = _StubClient(result)
    return AnthropicProvider(api_key="test", model=_MODEL, client=client), client  # type: ignore[arg-type]


async def _reply(provider: AnthropicProvider, messages: list[Any] | None = None) -> Any:
    return await provider.reply(
        system="FIXED", context="Today is Monday 2026-10-19.",
        messages=messages or [UserText("How late were we?")], tools=_TOOLS,
    )


async def test_reply_builds_the_request_the_spec_describes() -> None:
    provider, client = _provider(_message([{"type": "text", "text": "For which period?"}], "end_turn"))

    await _reply(provider)

    kwargs = client.messages.create.await_args.kwargs
    assert kwargs["model"] == _MODEL
    assert kwargs["max_tokens"] == MAX_OUTPUT_TOKENS
    assert kwargs["tool_choice"] == {"type": "auto"}
    assert kwargs["output_config"] == {"effort": EFFORT}
    assert "fallbacks" not in kwargs and "thinking" not in kwargs
    assert [tool["name"] for tool in kwargs["tools"]] == ["on_time", "right_now"]
    assert all(tool["strict"] is True for tool in kwargs["tools"])
    # Cached fixed prompt first, then the uncached date: the cached prefix never changes.
    assert kwargs["system"] == [
        {"type": "text", "text": "FIXED", "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": "Today is Monday 2026-10-19."},
    ]


async def test_reply_reads_tool_calls_and_usage() -> None:
    message = _message(
        [{"type": "text", "text": "Let me check."}, {"type": "tool_use", "id": "tu_1", "name": "on_time", "input": {"preset": "this_year"}}],
        "tool_use",
        {"input_tokens": 1_000, "output_tokens": 50, "cache_creation_input_tokens": 2_000, "cache_read_input_tokens": 3_000},
    )
    provider, _ = _provider(message)

    reply = await _reply(provider)

    assert reply.stop == "tool_use"
    assert reply.text == "Let me check."
    assert [(call.id, call.name, dict(call.arguments)) for call in reply.tool_calls] == [("tu_1", "on_time", {"preset": "this_year"})]
    assert (reply.usage.input_tokens, reply.usage.output_tokens, reply.usage.cache_write_tokens, reply.usage.cache_read_tokens) == (1_000, 50, 2_000, 3_000)
    assert reply.raw is message


@pytest.mark.parametrize(
    ("stop_reason", "expected"),
    [("end_turn", "end"), ("refusal", "refusal"), ("max_tokens", "max_tokens"), ("model_context_window_exceeded", "max_tokens")],
)
async def test_reply_maps_stop_reasons(stop_reason: str, expected: str) -> None:
    provider, _ = _provider(_message([{"type": "text", "text": "x"}], stop_reason))

    reply = await _reply(provider)

    assert reply.stop == expected


async def test_reply_sends_history_tool_turns_and_results_in_the_api_shape() -> None:
    earlier = _message([{"type": "tool_use", "id": "tu_1", "name": "on_time", "input": {}}], "tool_use")
    first, _ = _provider(earlier)
    earlier_reply = await _reply(first)
    provider, client = _provider(_message([{"type": "text", "text": "Done."}], "end_turn"))

    await _reply(provider, [
        UserText("q1"), AssistantText("a1"), UserText("q2"),
        AssistantReply(earlier_reply),
        ToolResults((ToolResult(call_id="tu_1", name="on_time", content='{"figure": 42}', is_error=False),)),
    ])

    sent = client.messages.create.await_args.kwargs["messages"]
    assert sent[:3] == [
        {"role": "user", "content": "q1"}, {"role": "assistant", "content": "a1"}, {"role": "user", "content": "q2"},
    ]
    # The assistant's own blocks go back unchanged.
    assert sent[3] == {"role": "assistant", "content": earlier.content}
    assert sent[4] == {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "tu_1", "content": '{"figure": 42}', "is_error": False},
    ]}


@pytest.mark.parametrize(
    "error",
    [
        anthropic.RateLimitError("slow down", response=httpx2.Response(429, request=_REQUEST), body=None),
        anthropic.InternalServerError("broken", response=httpx2.Response(500, request=_REQUEST), body=None),
        anthropic.BadRequestError("bad", response=httpx2.Response(400, request=_REQUEST), body=None),
        anthropic.APIConnectionError(request=_REQUEST),
        anthropic.APITimeoutError(request=_REQUEST),
    ],
    ids=["rate_limit", "server_error", "bad_request", "connection", "timeout"],
)
async def test_reply_turns_sdk_errors_into_provider_errors(error: Exception) -> None:
    provider, _ = _provider(error)

    with pytest.raises(AiProviderError):
        await _reply(provider)
