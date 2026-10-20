"""Request and response models for the Analytics chat (FP-295).

Basis is the "Based on" line under an answer. It is built by our server from the tools that
actually ran, never written by the model (spec D9), so it can't misstate where a figure
came from. The other models are the chat endpoint's request and answer (spec §4).
"""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# The View by values (analytics.fleet.periods.Grain). Spelled out because schemas sit below
# analytics in the import layers, and adding an ignore_imports line is not allowed.
ChatGrain = Literal["week", "month", "year"]

# Spec D15. A question is a sentence or two; the history is enough for "and the month
# before?" follow-ups without resending a long conversation (and its cost) every time.
MAX_QUESTION_CHARS = 500
MAX_HISTORY_TURNS = 10
MAX_TURN_CHARS = 2_000

Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_QUESTION_CHARS)]
TurnText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TURN_CHARS)]


class Basis(BaseModel):
    """One tool call an answer rests on: which tab, which dates, how many closed trips."""

    model_config = ConfigDict(frozen=True)

    tool: str
    # The page's tab id (?tab=…), so the panel can link to it. None for the "right now" tiles,
    # which sit above the tabs.
    tab: str | None
    label: str
    # None for the "right now" tiles: they have no period.
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


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    question: Question
    # Oldest first.
    history: list[ChatTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)


class SpendStatus(BaseModel):
    model_config = ConfigDict(frozen=True)

    # This organisation, this SAST calendar month.
    spent_usd: float
    budget_usd: float
    # False once every organisation together has reached the monthly budget.
    available: bool


class ChatAnswer(BaseModel):
    model_config = ConfigDict(frozen=True)

    answer: str
    # answer: at least one tool ran · follow_up: the model asked a question back, no figures ·
    # declined: neither (a refusal, a forecast or per-driver question, or a cap reached).
    kind: Literal["answer", "follow_up", "declined"]
    # Empty: the panel shows "No figures used".
    basis: list[Basis]
    # None when the spend couldn't be read after answering (Redis down).
    spend: SpendStatus | None


class ChatStatus(BaseModel):
    model_config = ConfigDict(frozen=True)

    enabled: bool
    spend: SpendStatus | None
