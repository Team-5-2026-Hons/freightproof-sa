"""The Analytics chat's adapter for Google's Gemini API, over REST (FP-295, Tom 19 Oct).

One `reply` is one POST to `{GEMINI_API_URL}/models/{model}:generateContent`. It uses the
backend's pinned httpx, as integrations/routing.py does, because every version of Google's
Python SDK needs a newer httpx than the team pins (checked 19 Oct 2026). The field names
below are from Google's API reference (ai.google.dev/api/generate-content).

Request choices, each with its reason:
- the fixed prompt and today's date go in `systemInstruction`, the conversation in `contents`;
- tools are `functionDeclarations` with `parametersJsonSchema`, with `$ref`s inlined so the
  schema doesn't depend on which JSON Schema features Google resolves; mode AUTO, so the
  model is free to ask a follow-up instead of calling a tool;
- the model's own turn is sent back exactly as received, because its parts can carry
  `thoughtSignature`s that the API needs to see again on the next call;
- thinking is left at the model's default; maxOutputTokens leaves room for it.

One retry, after RETRY_DELAY_SECONDS, only when Google says it's busy (500/503): on the free
tier that is common and usually gone a moment later (spec B27). Never on 429: the quota is
spent, and retrying only spends more of it.

Only page-level aggregates are ever sent (spec D5); this module never sees the database. On a
key from a project without billing (Gemini's free tier) Google may use what is sent to improve
its products; on paid or prepaid billing it doesn't (Google's pricing page, 19 Oct 2026; spec D19).
A prepaid project with no credit left answers 402, which becomes AiCreditError (spec B34).
"""

import asyncio
import json
import logging
from collections.abc import Mapping, Sequence
from typing import Any

import httpx

from app.integrations.ai_chat.provider import (
    AiCreditError,
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

MAX_OUTPUT_TOKENS = 8_192
REQUEST_TIMEOUT_SECONDS = 30.0
RETRYABLE_STATUSES = frozenset({httpx.codes.INTERNAL_SERVER_ERROR, httpx.codes.SERVICE_UNAVAILABLE})
RETRY_DELAY_SECONDS = 2.0
API_KEY_HEADER = "x-goog-api-key"
SYNTHETIC_CALL_ID_PREFIX = "local-call-"

_END = frozenset({"STOP", "FINISH_REASON_UNSPECIFIED"})
_CUT_OFF = frozenset({"MAX_TOKENS"})
_REFUSED = frozenset({
    "SAFETY", "RECITATION", "LANGUAGE", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII",
})

JsonObject = dict[str, Any]


def inline_refs(schema: Mapping[str, Any]) -> JsonObject:
    """The schema with every local `$ref` replaced by its `$defs` entry, and the `$defs` and
    `title` keys dropped. Pydantic emits `$ref`s for enums; inlining keeps the schema to plain
    features. Our tool inputs are never recursive, so this always ends."""
    definitions: Mapping[str, Any] = schema.get("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            reference = node.get("$ref")
            if isinstance(reference, str) and reference.startswith("#/$defs/"):
                target = dict(definitions[reference.removeprefix("#/$defs/")])
                target.update({key: value for key, value in node.items() if key != "$ref"})
                return resolve(target)
            return {key: resolve(value) for key, value in node.items() if key not in ("$defs", "title")}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    resolved: JsonObject = resolve(dict(schema))
    return resolved


def quota_reason(response: httpx.Response) -> str:
    """What a Gemini 429 says about the limit it hit, for the log: each named quota and, if Google
    gives one, how long until it may be retried. Falls back to the start of the raw body."""
    try:
        error = response.json().get("error", {})
        details = error.get("details", [])
        quotas = [
            violation.get("quotaId") or violation.get("quotaMetric")
            for detail in details for violation in detail.get("violations", [])
        ]
        delays = [detail["retryDelay"] for detail in details if "retryDelay" in detail]
    except (ValueError, AttributeError, TypeError):
        return response.text[:300]
    if not quotas and not delays:
        return response.text[:300]
    return f"quotas={[q for q in quotas if q]} retry_after={delays[0] if delays else 'not given'}"


def _function_response(call_id: str, name: str, content: str, is_error: bool) -> JsonObject:
    response: JsonObject = {"error": content} if is_error else {"result": json.loads(content)}
    body: JsonObject = {"name": name, "response": response}
    if not call_id.startswith(SYNTHETIC_CALL_ID_PREFIX):
        body["id"] = call_id
    return {"functionResponse": body}


def _content(message: ProviderMessage) -> JsonObject:
    if isinstance(message, UserText):
        return {"role": "user", "parts": [{"text": message.text}]}
    if isinstance(message, AssistantText):
        return {"role": "model", "parts": [{"text": message.text}]}
    if isinstance(message, AssistantReply):
        raw: JsonObject = message.reply.raw  # type: ignore[assignment]
        return raw
    return {
        "role": "user",
        "parts": [_function_response(r.call_id, r.name, r.content, r.is_error) for r in message.results],
    }


def _usage(metadata: Mapping[str, Any]) -> Usage:
    """Google's counts in our shape. promptTokenCount already includes the cached part, and
    thinking is billed as output, so it joins the answer's own tokens."""
    cached = int(metadata.get("cachedContentTokenCount", 0))
    prompt = int(metadata.get("promptTokenCount", 0)) + int(metadata.get("toolUsePromptTokenCount", 0))
    output = int(metadata.get("candidatesTokenCount", 0)) + int(metadata.get("thoughtsTokenCount", 0))
    return Usage(input_tokens=max(prompt - cached, 0), output_tokens=output, cache_write_tokens=0, cache_read_tokens=cached)


def _stop(finish_reason: str | None, has_calls: bool) -> StopKind:
    if has_calls:
        return "tool_use"
    reason = finish_reason or "FINISH_REASON_UNSPECIFIED"
    if reason in _END:
        return "end"
    if reason in _CUT_OFF:
        return "max_tokens"
    if reason in _REFUSED:
        return "refusal"
    raise AiProviderError(f"Gemini stopped with {reason}")


def reply_from(payload: Mapping[str, Any]) -> ModelReply:
    """Turn a generateContent response into a ModelReply. A prompt Google blocked outright
    has no candidate at all; that reads as a refusal."""
    usage = _usage(payload.get("usageMetadata", {}))
    candidates = payload.get("candidates") or []
    if not candidates:
        block = payload.get("promptFeedback", {}).get("blockReason")
        if block is None:
            raise AiProviderError("Gemini returned no candidate and no block reason")
        return ModelReply(text="", tool_calls=(), stop="refusal", usage=usage, raw=None)

    candidate = candidates[0]
    content: JsonObject = candidate.get("content") or {"role": "model", "parts": []}
    content.setdefault("role", "model")
    parts = content.get("parts") or []
    text = "".join(part.get("text", "") for part in parts if "text" in part and not part.get("thought"))
    calls = tuple(
        ToolCall(
            id=part["functionCall"].get("id") or f"{SYNTHETIC_CALL_ID_PREFIX}{index}",
            name=part["functionCall"]["name"],
            arguments=part["functionCall"].get("args") or {},
        )
        for index, part in enumerate(parts)
        if "functionCall" in part
    )
    return ModelReply(
        text=text, tool_calls=calls, stop=_stop(candidate.get("finishReason"), bool(calls)), usage=usage, raw=content,
    )


class GeminiProvider:
    def __init__(
        self, *, api_key: str, model: str, base_url: str, client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._url = f"{base_url.rstrip('/')}/models/{model}:generateContent"
        self._client = client

    @property
    def model(self) -> str:
        return self._model

    def _body(self, system: str, context: str, messages: Sequence[ProviderMessage], tools: Sequence[ToolSpec]) -> JsonObject:
        return {
            "systemInstruction": {"parts": [{"text": system}, {"text": context}]},
            "contents": [_content(message) for message in messages],
            "tools": [{"functionDeclarations": [
                {"name": tool.name, "description": tool.description, "parametersJsonSchema": inline_refs(tool.input_schema)}
                for tool in tools
            ]}],
            "toolConfig": {"functionCallingConfig": {"mode": "AUTO"}},
            "generationConfig": {"maxOutputTokens": MAX_OUTPUT_TOKENS},
        }

    async def _post(self, body: JsonObject) -> httpx.Response:
        headers = {API_KEY_HEADER: self._api_key}
        if self._client is not None:
            return await self._client.post(self._url, json=body, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as http:
            return await http.post(self._url, json=body, headers=headers)

    async def reply(
        self,
        *,
        system: str,
        context: str,
        messages: Sequence[ProviderMessage],
        tools: Sequence[ToolSpec],
    ) -> ModelReply:
        try:
            body = self._body(system, context, messages, tools)
            response = await self._post(body)
            if response.status_code in RETRYABLE_STATUSES:
                logger.info("Gemini busy (status=%s); retrying once", response.status_code)
                await asyncio.sleep(RETRY_DELAY_SECONDS)
                response = await self._post(body)
        except httpx.HTTPError as exc:
            logger.warning("Gemini unreachable: %s", type(exc).__name__)
            raise AiProviderError("connection failed") from exc
        if response.status_code == httpx.codes.PAYMENT_REQUIRED:
            logger.error("Gemini refused: the project's prepaid credit is used up (402). Top it up in AI Studio.")
            raise AiCreditError("credit used up")
        if response.status_code == httpx.codes.TOO_MANY_REQUESTS:
            logger.warning("Gemini quota used up: %s", quota_reason(response))
            raise AiQuotaError("quota used up")
        if response.status_code != httpx.codes.OK:
            logger.warning("Gemini error: status=%s body=%s", response.status_code, response.text[:300])
            raise AiProviderError(f"status {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise AiProviderError("Gemini returned a non-JSON body") from exc
        try:
            return reply_from(payload)
        except (KeyError, TypeError, AttributeError) as exc:
            logger.warning("Gemini response not understood: %s", exc)
            raise AiProviderError("unexpected response shape") from exc
