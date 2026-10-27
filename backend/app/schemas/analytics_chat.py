"""Request and response models for the Analytics chat (FP-295).

Basis is the "Based on" line under an answer. It is built by our server from the tools that
actually ran, never written by the model (spec D9), so it can't misstate where a figure
came from. The other models are the chat endpoint's request and answer (spec §4).
"""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ChatGrain = Literal["week", "month", "year"]
ChatTab = Literal["activity", "on-time", "problems", "review", "evidence", "routes", "cost"]
ChatPreset = Literal[
    "last_4_weeks", "last_12_weeks", "last_26_weeks", "last_3_months", "last_6_months", "last_12_months",
    "this_year", "last_3_years", "all_time", "custom",
]

MAX_QUESTION_CHARS = 500
MAX_HISTORY_TURNS = 10
MAX_TURN_CHARS = 2_000

Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_QUESTION_CHARS)]
TurnText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TURN_CHARS)]


class Basis(BaseModel):
    """One tool call an answer rests on: which tab, which dates, how many closed trips."""

    model_config = ConfigDict(frozen=True)

    tool: str
    tab: str | None
    label: str
    start: date | None
    end: date | None
    grain: ChatGrain | None
    closed_trip_count: int | None


class ChatTurn(BaseModel):
    """One earlier message, as text only. Kept in the browser, never on the server (spec D7).
    The browser could send anything here, which is harmless: it only shapes the caller's own
    answer, and the tools take the organisation from the token, never from the conversation."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    role: Literal["user", "assistant"]
    text: TurnText


class PageView(BaseModel):
    """What the dispatcher has on screen when they ask (B45, Stage 4b): the open tab, its Period and its View by.
    So "what do these figures tell us?" is answered for the period on screen instead of asking for one. A period
    the question names itself still wins. Holds no personal data."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    tab: ChatTab
    preset: ChatPreset
    start: date | None = None
    end: date | None = None
    grain: ChatGrain | None = None


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    question: Question
    history: list[ChatTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)
    page: PageView | None = None


class SpendStatus(BaseModel):
    model_config = ConfigDict(frozen=True)

    spent_usd: float
    budget_usd: float
    available: bool


class ChatAnswer(BaseModel):
    model_config = ConfigDict(frozen=True)

    answer: str
    kind: Literal["answer", "follow_up", "explanation", "declined"]
    basis: list[Basis]
    spend: SpendStatus | None


class ChatStatus(BaseModel):
    model_config = ConfigDict(frozen=True)

    enabled: bool
    spend: SpendStatus | None
