"""Scripted provider replies; analytics SQL and the isolated Redis budget stay real.

Reuses FP-295's FakeProvider from tests/fake_ai_provider.py, as the FP-299 plan chose, so
the chat flow under load is the one the analytics-chat tests already exercise. That makes
tests/ a runtime dependency of this runner, which is why Dockerfile.load copies it.
"""

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.integrations.ai_chat.provider import ModelReply, ProviderMessage, ToolResults, ToolSpec, Usage
from scripts.db_timeout_load.metrics import RequestSpec
from tests.fake_ai_provider import FakeProvider, text_reply, tool_reply

ZERO_USAGE = Usage(input_tokens=0, output_tokens=0, cache_write_tokens=0, cache_read_tokens=0)
CHAT = RequestSpec(
    "analytics_chat", "/api/v1/analytics/chat", method="POST",
    body={"question": "What needs attention right now?", "history": []}, expected={"kind": "answer"},
)


@dataclass
class ProviderGate:
    """Holds every chat request after its real tool query until the scenario releases it."""

    target: int
    reached: int = 0
    released_at: float | None = None
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)


class ControlledProvider(FakeProvider):
    def __init__(self, gate: ProviderGate | None = None) -> None:
        super().__init__([tool_reply(("right_now", {}), usage=ZERO_USAGE),
                          text_reply("The current figures have been checked.", usage=ZERO_USAGE)])
        self.gate = gate

    async def reply(
        self, *, system: str, context: str, messages: Sequence[ProviderMessage], tools: Sequence[ToolSpec],
    ) -> ModelReply:
        if len(self.sent) == 1:
            result = messages[-1]
            if not isinstance(result, ToolResults) or not result.results or any(r.is_error for r in result.results):
                raise RuntimeError("The controlled delay requires a successful real analytics tool result")
            if self.gate is not None:
                self.gate.reached += 1
                if self.gate.reached == self.gate.target:
                    self.gate.ready.set()
                await self.gate.release.wait()
        return await super().reply(system=system, context=context, messages=messages, tools=tools)
