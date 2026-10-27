"""The Gemini adapter: the generateContent request it builds, how it reads replies, and how it
reports failures. respx mocks httpx at the transport layer (as test_routing.py does), so no
request reaches Google."""

import json
from typing import Any

import httpx
import pytest
import respx

from app.integrations.ai_chat import gemini_client
from app.integrations.ai_chat.gemini_client import (
    API_KEY_HEADER,
    MAX_OUTPUT_TOKENS,
    SYNTHETIC_CALL_ID_PREFIX,
    GeminiProvider,
    inline_refs,
    quota_reason,
    reply_from,
)
from app.integrations.ai_chat.provider import (
    AiCreditError,
    AiProviderError,
    AiQuotaError,
    AssistantReply,
    AssistantText,
    ModelReply,
    ToolResult,
    ToolResults,
    ToolSpec,
    UserText,
)
from app.orchestration.analytics_chat.tools import TOOLS_BY_NAME

_BASE = "https://gemini.test/v1beta"
_MODEL = "gemini-3.8-flash"
_URL = f"{_BASE}/models/{_MODEL}:generateContent"
_TOOLS = (ToolSpec(name="on_time", description="On time tab", input_schema=TOOLS_BY_NAME["on_time"].input_schema()),)
_USAGE = {"promptTokenCount": 5_000, "cachedContentTokenCount": 2_000, "candidatesTokenCount": 120, "thoughtsTokenCount": 80}


def _payload(parts: list[dict[str, Any]], finish: str = "STOP") -> dict[str, Any]:
    return {"candidates": [{"content": {"role": "model", "parts": parts}, "finishReason": finish}], "usageMetadata": _USAGE}


def _provider() -> GeminiProvider:
    return GeminiProvider(api_key="test-key", model=_MODEL, base_url=_BASE)


async def _reply(messages: list[Any] | None = None) -> ModelReply:
    return await _provider().reply(
        system="FIXED", context="Today is Monday 2026-10-19.",
        messages=messages or [UserText("How late were we?")], tools=_TOOLS,
    )



@respx.mock
async def test_reply_builds_the_generate_content_request() -> None:
    route = respx.post(_URL).mock(return_value=httpx.Response(200, json=_payload([{"text": "For which period?"}])))

    await _reply()

    request = route.calls.last.request
    assert request.headers[API_KEY_HEADER] == "test-key"
    assert "key=" not in str(request.url)
    body = json.loads(request.content)
    assert body["systemInstruction"] == {"parts": [{"text": "FIXED"}, {"text": "Today is Monday 2026-10-19."}]}
    assert body["contents"] == [{"role": "user", "parts": [{"text": "How late were we?"}]}]
    assert body["toolConfig"] == {"functionCallingConfig": {"mode": "AUTO"}}
    assert body["generationConfig"] == {"maxOutputTokens": MAX_OUTPUT_TOKENS}
    [declaration] = body["tools"][0]["functionDeclarations"]
    assert declaration["name"] == "on_time"
    assert "$ref" not in json.dumps(declaration) and "$defs" not in json.dumps(declaration)


def test_inline_refs_replaces_refs_and_drops_defs_and_titles() -> None:
    schema = TOOLS_BY_NAME["on_time"].input_schema()

    inlined = inline_refs(schema)

    assert "$defs" not in inlined and "title" not in inlined
    assert "last_12_months" in inlined["properties"]["preset"]["enum"]
    assert inlined["properties"]["preset"]["description"].startswith("The page's Period choice")
    assert inlined["additionalProperties"] is False


@respx.mock
async def test_reply_sends_history_its_own_turn_unchanged_and_named_results() -> None:
    route = respx.post(_URL).mock(return_value=httpx.Response(200, json=_payload([{"text": "Done."}])))
    own_turn = {"role": "model", "parts": [
        {"functionCall": {"id": "fc_1", "name": "on_time", "args": {}}, "thoughtSignature": "c2lnbmF0dXJl"},
    ]}
    earlier = ModelReply(text="", tool_calls=(), stop="tool_use", usage=reply_from(_payload([])).usage, raw=own_turn)

    await _reply([
        UserText("q1"), AssistantText("a1"), UserText("q2"), AssistantReply(earlier),
        ToolResults((
            ToolResult(call_id="fc_1", name="on_time", content='{"figure": 42}', is_error=False),
            ToolResult(call_id=f"{SYNTHETIC_CALL_ID_PREFIX}1", name="cost", content="Invalid input", is_error=True),
        )),
    ])

    contents = json.loads(route.calls.last.request.content)["contents"]
    assert contents[:3] == [
        {"role": "user", "parts": [{"text": "q1"}]},
        {"role": "model", "parts": [{"text": "a1"}]},
        {"role": "user", "parts": [{"text": "q2"}]},
    ]
    assert contents[3] == own_turn
    assert contents[4] == {"role": "user", "parts": [
        {"functionResponse": {"id": "fc_1", "name": "on_time", "response": {"result": {"figure": 42}}}},
        {"functionResponse": {"name": "cost", "response": {"error": "Invalid input"}}},
    ]}



def test_reply_from_reads_text_skipping_thoughts() -> None:
    reply = reply_from(_payload([{"text": "thinking...", "thought": True}, {"text": "81% on time."}]))

    assert (reply.text, reply.stop, reply.tool_calls) == ("81% on time.", "end", ())


def test_reply_from_reads_function_calls_and_makes_up_missing_ids() -> None:
    reply = reply_from(_payload([
        {"functionCall": {"id": "fc_1", "name": "on_time", "args": {"preset": "this_year"}}},
        {"functionCall": {"name": "cost", "args": {}}},
    ]))

    assert reply.stop == "tool_use"
    assert [(c.id, c.name, dict(c.arguments)) for c in reply.tool_calls] == [
        ("fc_1", "on_time", {"preset": "this_year"}), (f"{SYNTHETIC_CALL_ID_PREFIX}1", "cost", {}),
    ]


def test_reply_from_maps_usage_cached_and_thinking_tokens() -> None:
    usage = reply_from(_payload([{"text": "x"}])).usage

    assert (usage.input_tokens, usage.cache_read_tokens, usage.output_tokens, usage.cache_write_tokens) == (3_000, 2_000, 200, 0)


@pytest.mark.parametrize(
    ("finish", "expected"), [("STOP", "end"), ("MAX_TOKENS", "max_tokens"), ("SAFETY", "refusal"), ("PROHIBITED_CONTENT", "refusal")],
)
def test_reply_from_maps_finish_reasons(finish: str, expected: str) -> None:
    assert reply_from(_payload([{"text": "x"}], finish)).stop == expected


@pytest.mark.parametrize("finish", ["MALFORMED_FUNCTION_CALL", "MISSING_THOUGHT_SIGNATURE", "OTHER"])
def test_reply_from_broken_finish_reasons_are_provider_errors(finish: str) -> None:
    with pytest.raises(AiProviderError):
        reply_from(_payload([{"text": "x"}], finish))


def test_reply_from_blocked_prompt_is_a_refusal() -> None:
    reply = reply_from({"promptFeedback": {"blockReason": "SAFETY"}, "usageMetadata": _USAGE})

    assert reply.stop == "refusal"



@pytest.fixture(autouse=True)
def no_retry_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gemini_client, "RETRY_DELAY_SECONDS", 0.0)


@respx.mock
@pytest.mark.parametrize("busy", [500, 503])
async def test_reply_retries_once_when_busy_and_succeeds(busy: int) -> None:
    route = respx.post(_URL).mock(side_effect=[
        httpx.Response(busy, json={"error": {"message": "overloaded"}}),
        httpx.Response(200, json=_payload([{"text": "Done."}])),
    ])

    reply = await _reply()

    assert reply.text == "Done."
    assert route.call_count == 2


@respx.mock
async def test_reply_busy_twice_is_a_provider_error() -> None:
    route = respx.post(_URL).mock(return_value=httpx.Response(503, json={"error": {"message": "overloaded"}}))

    with pytest.raises(AiProviderError):
        await _reply()

    assert route.call_count == 2


@respx.mock
async def test_reply_402_is_a_credit_error_and_never_retried() -> None:
    route = respx.post(_URL).mock(return_value=httpx.Response(402, json={"error": {
        "code": 402, "status": "RESOURCE_EXHAUSTED",
        "message": "Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.",
    }}))

    with pytest.raises(AiCreditError):
        await _reply()

    assert route.call_count == 1


@respx.mock
async def test_reply_429_is_a_quota_error() -> None:
    respx.post(_URL).mock(return_value=httpx.Response(429, json={"error": {"message": "You exceeded your current quota"}}))

    with pytest.raises(AiQuotaError):
        await _reply()

    assert respx.calls.call_count == 1


@respx.mock
@pytest.mark.parametrize("status", [400, 500, 503])
async def test_reply_error_status_is_a_provider_error(status: int) -> None:
    respx.post(_URL).mock(return_value=httpx.Response(status, json={"error": {"message": "quota"}}))

    with pytest.raises(AiProviderError):
        await _reply()


@respx.mock
async def test_reply_unreachable_is_a_provider_error() -> None:
    respx.post(_URL).mock(side_effect=httpx.ConnectTimeout("slow"))

    with pytest.raises(AiProviderError):
        await _reply()


@respx.mock
async def test_reply_unexpected_shape_is_a_provider_error() -> None:
    respx.post(_URL).mock(return_value=httpx.Response(200, json={"candidates": [{"content": {"parts": [{"functionCall": {}}]}}]}))

    with pytest.raises(AiProviderError):
        await _reply()


def test_quota_reason_names_the_limit_and_the_retry_delay() -> None:
    response = httpx.Response(429, json={"error": {"code": 429, "message": "You exceeded your current quota", "details": [
        {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [
            {"quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
             "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"},
        ]},
        {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "41s"},
    ]}})

    assert quota_reason(response) == "quotas=['GenerateRequestsPerDayPerProjectPerModel-FreeTier'] retry_after=41s"


def test_quota_reason_falls_back_to_the_body() -> None:
    assert quota_reason(httpx.Response(429, text="slow down")) == "slow down"
