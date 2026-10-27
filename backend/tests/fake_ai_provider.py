"""A scripted stand-in for the Analytics chat's model (FP-295). Tests never call a real one.

It replays a fixed list of replies, one per call, and records every request it was sent, so a
test can assert what the loop sent (messages, tool results) as well as what it returned.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from app.integrations.ai_chat.provider import (
    AiProviderError,
    ModelReply,
    ProviderMessage,
    StopKind,
    ToolCall,
    ToolSpec,
    Usage,
)

FAKE_MODEL = "gemini-3.8-flash"
FAKE_USAGE = Usage(input_tokens=3_000, output_tokens=300, cache_write_tokens=0, cache_read_tokens=3_000)


def text_reply(text: str, *, stop: StopKind = "end", usage: Usage = FAKE_USAGE) -> ModelReply:
    return ModelReply(text=text, tool_calls=(), stop=stop, usage=usage, raw=None)


def tool_reply(*calls: tuple[str, Mapping[str, object]], usage: Usage = FAKE_USAGE) -> ModelReply:
    """A reply asking for tools: each call is (tool name, arguments)."""
    return ModelReply(
        text="",
        tool_calls=tuple(
            ToolCall(id=f"call_{index}", name=name, arguments=arguments) for index, (name, arguments) in enumerate(calls)
        ),
        stop="tool_use",
        usage=usage,
        raw=None,
    )


@dataclass(frozen=True)
class SentRequest:
    system: str
    context: str
    messages: tuple[ProviderMessage, ...]
    tools: tuple[ToolSpec, ...]


@dataclass
class FakeProvider:
    replies: list[ModelReply]
    model: str = FAKE_MODEL
    error: AiProviderError | None = None
    sent: list[SentRequest] = field(default_factory=list)

    async def reply(
        self,
        *,
        system: str,
        context: str,
        messages: Sequence[ProviderMessage],
        tools: Sequence[ToolSpec],
    ) -> ModelReply:
        self.sent.append(SentRequest(system, context, tuple(messages), tuple(tools)))
        if self.error is not None:
            raise self.error
        if not self.replies:
            raise AssertionError("FakeProvider ran out of scripted replies")
        return self.replies.pop(0)
