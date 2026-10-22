"""Integration contract for POST /api/v1/assistant/chat and GET /api/v1/assistant/status (spec §4).

The model is the scripted FakeProvider, patched in where the service builds its provider; the tools
run for real on the test database. The spend counters are patched where the service calls them.
"""

from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.integrations.ai_chat.provider import AiCreditError, AiProviderError, AiQuotaError
from app.main import app
from app.orchestration.analytics_chat.budget import BudgetSpentError
from app.orchestration.assistant import service, spend
from app.schemas.assistant import MAX_HISTORY_TURNS, MAX_QUESTION_CHARS, MAX_REFS_PER_TURN, AssistantSpend
from tests.conftest import auth_header, make_token
from tests.fake_ai_provider import FakeProvider, text_reply, tool_reply
from tests.integration._fleet_seed import Operator, headers, operator_from_seed

_CHAT = "/api/v1/assistant/chat"
_STATUS = "/api/v1/assistant/status"
_SPEND = AssistantSpend(spent_usd=0.42, all_chats_spent_usd=3.1, budget_usd=20.0, available=True)


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


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
        "status": AsyncMock(return_value=_SPEND),
    }
    for name, mock in mocks.items():
        monkeypatch.setattr(spend, name, mock)
    return mocks


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    provider = FakeProvider([])
    monkeypatch.setattr(service, "build_provider", lambda: provider)
    return provider


@pytest.fixture
def operator(seed: dict[str, Any]) -> Operator:
    return operator_from_seed(seed)


def _body(question: str = "What needs attention?", **fields: Any) -> dict[str, Any]:
    return {"question": question, **fields}


async def test_chat_answers_with_cards_tools_and_spend(client: AsyncClient, operator: Operator, model: FakeProvider) -> None:
    model.replies = [tool_reply(("needs_attention", {"severity_at_least": None})), text_reply("Nothing needs review.")]

    response = await client.post(_CHAT, json=_body(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert (body["answer"], body["kind"], body["tools_used"]) == ("Nothing needs review.", "answer", ["needs_attention"])
    assert [card["type"] for card in body["cards"]] == ["review_queue", "trip_list", "incident_list"]
    assert body["spend"] == _SPEND.model_dump()


async def test_chat_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.post(_CHAT, json=_body())

    assert response.status_code == 403


async def test_chat_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.post(_CHAT, json=_body(), headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_chat_with_driver_token_returns_403(client: AsyncClient, operator: Operator) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.post(_CHAT, json=_body(), headers=auth_header(token))

    assert response.status_code == 403


async def test_status_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_STATUS)

    assert response.status_code == 403


_A_REF = {"kind": "driver", "id": "00000000-0000-0000-0000-000000000001", "label": "Someone"}


@pytest.mark.parametrize(
    "body",
    [
        {"question": ""},
        {"question": "x" * (MAX_QUESTION_CHARS + 1)},
        {"question": "hi", "history": [{"role": "user", "text": "a"}] * (MAX_HISTORY_TURNS + 1)},
        {"question": "hi", "refs": [_A_REF] * (MAX_REFS_PER_TURN + 1)},
        {"question": "hi", "refs": [{**_A_REF, "kind": "organisation"}]},
        {"question": "hi", "organization_id": "x"},
    ],
    ids=["empty", "too-long", "too-many-turns", "too-many-refs", "bad-ref-kind", "unknown-field"],
)
async def test_chat_invalid_body_returns_422(client: AsyncClient, operator: Operator, body: dict[str, Any]) -> None:
    response = await client.post(_CHAT, json=body, headers=headers(operator))

    assert response.status_code == 422


async def test_chat_switched_off_returns_503(
    client: AsyncClient, operator: Operator, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ASSISTANT_ENABLED", False)

    response = await client.post(_CHAT, json=_body(), headers=headers(operator))

    assert response.status_code == 503


async def test_chat_without_a_key_returns_503(
    client: AsyncClient, operator: Operator, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")

    response = await client.post(_CHAT, json=_body(), headers=headers(operator))

    assert response.status_code == 503


async def test_chat_budget_spent_returns_429(
    client: AsyncClient, operator: Operator, model: FakeProvider, spend_calls: dict[str, AsyncMock],
) -> None:
    spend_calls["ensure_available"].side_effect = BudgetSpentError("The AI budget for this month is used up.")

    response = await client.post(_CHAT, json=_body(), headers=headers(operator))

    assert response.status_code == 429
    assert model.sent == []


@pytest.mark.parametrize(
    ("error", "code", "words"),
    [
        (AiCreditError("402"), 503, "run out of credit"),
        (AiQuotaError("429"), 503, "allowance is used up"),
        (AiProviderError("down"), 502, "didn't answer"),
    ],
)
async def test_chat_provider_failures_map_to_plain_messages(
    client: AsyncClient, operator: Operator, model: FakeProvider, error: AiProviderError, code: int, words: str,
) -> None:
    model.error = error

    response = await client.post(_CHAT, json=_body(), headers=headers(operator))

    assert response.status_code == code
    assert words in response.json()["detail"]


async def test_status_when_on_reports_spend(client: AsyncClient, operator: Operator) -> None:
    response = await client.get(_STATUS, headers=headers(operator))

    assert response.status_code == 200
    assert response.json() == {"enabled": True, "spend": _SPEND.model_dump()}


async def test_status_when_off_is_disabled(
    client: AsyncClient, operator: Operator, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ASSISTANT_ENABLED", False)

    response = await client.get(_STATUS, headers=headers(operator))

    assert response.json() == {"enabled": False, "spend": None}
