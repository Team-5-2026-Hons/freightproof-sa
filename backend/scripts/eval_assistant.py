"""Run the dispatcher assistant's eval against the real model (assistant spec §8.5, Stage 7).

Never part of CI: every question costs real money. It asks each question through the same
`assistant.service.ask` the chat endpoint uses, as one organisation, against DATABASE_URL (every
tool only reads, and the session is rolled back), and grades the answer:

  PASS / FAIL  the right kind of reply (answer, follow-up, refusal), the right tool calls with the
               right inputs, the right buttons and cards, every fact the page showed (must_mention),
               and nothing it must never say (must_not_mention, must_not_match);
  REVIEW       the checks passed but a person must read it (advice, a pointer to the right page);
  SKIP         the demo data has nothing to ask about (we never add records to the shared database);
  ERROR        the model provider failed.

It also lists numbers in each answer that appear in no tool result, for a person to check.

A question with "after" is asked as the next turn of that earlier question's conversation (its
text, answer and records go in the history, as the browser sends them). Questions may use
{today_weekday}, {today_day} and {next_week_day}, filled in on the day the eval runs.

Usage (from backend/, run as a module so `app` is importable):
    python -m scripts.eval_assistant --org-id <ORGANISATION_UUID> --out /path/report.md --confirm-spend
    python -m scripts.eval_assistant ... --only s06 x02      # just some questions (and what they follow)

Without --confirm-spend it prints what it would ask and the estimated cost, and stops.
The report goes OUTSIDE the repository (--out), so nothing about a run is committed by accident.
The cost is counted in the shared monthly AI budget like any other question (spec D7).
"""

import argparse
import asyncio
import json
import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from app.analytics.fleet.periods import today_sast
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.integrations.ai_chat.pricing import ModelPrice, cost_micro_usd, price_for
from app.integrations.ai_chat.provider import (
    AiProviderError,
    ChatProvider,
    ModelReply,
    ProviderMessage,
    ToolResults,
    ToolSpec,
)
from app.orchestration.analytics_chat.budget import BudgetSpentError
from app.orchestration.analytics_chat.number_check import unmatched_numbers
from app.orchestration.analytics_chat.service import (
    ChatCreditError,
    ChatProviderFailedError,
    ChatQuotaError,
    build_provider,
)
from app.orchestration.assistant import service
from app.orchestration.assistant.enabled import assistant_enabled
from app.schemas.assistant import MAX_TURN_CHARS, AssistantAnswer, AssistantRequest, AssistantTurn
from app.schemas.people import UserRead

DEFAULT_QUESTIONS = Path(__file__).resolve().parents[1] / "tests" / "eval" / "assistant_questions.json"
DEFAULT_PAUSE_SECONDS = 10.0
DEFAULT_MAX_USD = 1.0
_ESTIMATE_CALLS, _ESTIMATE_PROMPT, _ESTIMATE_OUTPUT = 3, 9_000, 400
MICRO_USD_PER_USD = 1_000_000
STATUSES = ("PASS", "FAIL", "REVIEW", "SKIP", "ERROR")
DAYS_PER_WEEK = 7

_KINDS: dict[str, set[str]] = {
    "answer": {"answer"},
    "follow_up": {"follow_up"},
    "declined": {"declined"},
    "not_answer": {"follow_up", "declined"},
    "point": {"answer", "follow_up", "declined"},
    "any": {"answer", "follow_up", "declined"},
}


@dataclass
class Grade:
    status: str
    reasons: list[str] = field(default_factory=list)
    unmatched_numbers: list[str] = field(default_factory=list)


@dataclass
class Asked:
    """One question asked: what came back, what the model called, and the conversation so far."""

    answer: AssistantAnswer | None
    calls: list[tuple[str, Mapping[str, object]]]
    tool_texts: list[str]
    history: list[AssistantTurn]
    cost_micro_usd: int
    error: str | None = None



def _day(day: date) -> str:
    return f"{day.day} {day.strftime('%b')}"


def fill(text: str, today: date) -> str:
    """The run day's words: a question about "today's weekday" has to be asked on the day it runs."""
    return (
        text.replace("{today_weekday}", today.strftime("%A"))
        .replace("{today_day}", _day(today))
        .replace("{next_week_day}", _day(today + timedelta(days=DAYS_PER_WEEK)))
    )


def chain(items: Sequence[dict[str, Any]], wanted: Sequence[str]) -> list[dict[str, Any]]:
    """The wanted questions plus every question they follow, in file order."""
    by_id = {item["id"]: item for item in items}
    needed: set[str] = set()
    for item_id in wanted:
        current: str | None = item_id
        while current is not None:
            needed.add(current)
            current = by_id[current].get("after")
    return [item for item in items if item["id"] in needed]



def _same(expected: object, actual: object) -> bool:
    """Expected inputs are a subset of the actual ones: dicts by key, lists by member, text ignoring case."""
    if isinstance(expected, dict):
        return isinstance(actual, Mapping) and all(_same(value, actual.get(key)) for key, value in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and all(any(_same(e, a) for a in actual) for e in expected)
    if isinstance(expected, str) and isinstance(actual, str):
        return expected.lower() == actual.lower()
    return expected == actual


def call_matches(expected: Mapping[str, Any], name: str, arguments: Mapping[str, object]) -> bool:
    """One expected call: a tool name (or a list of acceptable names) and the inputs that must be in it."""
    names = expected["tool"] if isinstance(expected["tool"], list) else [expected["tool"]]
    return name in names and _same(expected.get("args", {}), arguments)


def _calls_reasons(expected: Any, calls: Sequence[tuple[str, Mapping[str, object]]]) -> list[str]:
    if expected == "optional":
        return []
    if not expected:
        return [] if not calls else [f"ran tools it shouldn't: {[name for name, _ in calls]}"]
    return [
        f"no call matching {json.dumps(call)}" for call in expected
        if not any(call_matches(call, name, arguments) for name, arguments in calls)
    ]


def _actions_reasons(expect: Mapping[str, Any], answer: AssistantAnswer) -> list[str]:
    kinds = [action.kind for action in answer.actions]
    reasons: list[str] = []
    wanted = expect.get("actions")
    if wanted == []:
        reasons += [f"offered a button it shouldn't: {kinds}"] if kinds else []
    elif wanted:
        reasons += [f"no {kind} button" for kind in wanted if kind not in kinds]
    reasons += [f"offered a {kind} button" for kind in expect.get("no_actions", []) if kind in kinds]
    cards = [card.type for card in answer.cards]
    reasons += [f"no {kind} card" for kind in expect.get("cards", []) if kind not in cards]
    return reasons


def _normalise(text: str) -> str:
    return re.sub(r"[  ]", " ", text).lower()


def _text_reasons(item: Mapping[str, Any], text: str, today: date) -> list[str]:
    reasons: list[str] = []
    said = _normalise(text)
    for fact in item.get("must_mention", []):
        spellings = [fill(s, today) for s in ([fact] if isinstance(fact, str) else fact)]
        if not any(_normalise(spelling) in said for spelling in spellings):
            reasons.append(f"doesn't mention {spellings[0]!r}")
    reasons += [f"says {phrase!r}" for phrase in item.get("must_not_mention", []) if _normalise(phrase) in said]
    reasons += [f"matches /{pattern}/" for pattern in item.get("must_not_match", []) if re.search(pattern, text)]
    return reasons


def grade(item: Mapping[str, Any], asked: Asked, today: date) -> Grade:
    if asked.answer is None:
        return Grade(status="ERROR", reasons=[asked.error or "no answer"])
    answer, expect = asked.answer, item["expect"]
    reasons = [] if answer.kind in _KINDS[expect["kind"]] else [f"kind {answer.kind}, expected {expect['kind']}"]
    reasons += _calls_reasons(expect["calls"], asked.calls)
    reasons += _actions_reasons(expect, answer)
    reasons += _text_reasons(item, answer.answer, today)
    typed = [fill(item["question"], today), *(turn.text for turn in asked.history)]
    status = "FAIL" if reasons else ("REVIEW" if item.get("review") else "PASS")
    return Grade(status=status, reasons=reasons, unmatched_numbers=unmatched_numbers(answer.answer, [*asked.tool_texts, *typed]))



class RecordingProvider:
    """Wraps the real provider to keep the tool calls, what the tools returned, and what each call cost."""

    def __init__(self, inner: ChatProvider, price: ModelPrice) -> None:
        self._inner = inner
        self._price = price
        self.calls: list[tuple[str, Mapping[str, object]]] = []
        self.tool_texts: list[str] = []
        self.cost_micro_usd = 0

    @property
    def model(self) -> str:
        return self._inner.model

    async def reply(
        self, *, system: str, context: str, messages: Sequence[ProviderMessage], tools: Sequence[ToolSpec],
    ) -> ModelReply:
        for message in messages:
            if isinstance(message, ToolResults):
                self.tool_texts.extend(r.content for r in message.results if r.content not in self.tool_texts)
        reply = await self._inner.reply(system=system, context=context, messages=messages, tools=tools)
        self.calls.extend((call.name, call.arguments) for call in reply.tool_calls)
        self.cost_micro_usd += cost_micro_usd(reply.usage, self._price)
        return reply


def _eval_user(organization_id: uuid.UUID) -> UserRead:
    now = datetime.now(UTC)
    return UserRead(
        id=uuid.uuid4(), organization_id=organization_id, email="eval@freightproof.local",
        full_name="Assistant eval", created_at=now, updated_at=now,
    )


async def ask_one(question: str, history: list[AssistantTurn], user: UserRead) -> Asked:
    recorder = RecordingProvider(build_provider(), price_for(settings.AI_CHAT_MODEL))
    request = AssistantRequest(question=question, history=history)
    async with AsyncSessionLocal() as db:
        try:
            answer = await service.ask(db, user=user, request=request, provider=recorder)
        except (ChatCreditError, ChatQuotaError, ChatProviderFailedError, AiProviderError) as exc:
            return Asked(None, recorder.calls, recorder.tool_texts, history, recorder.cost_micro_usd, f"provider failed: {exc}")
        finally:
            await db.rollback()
    turns = [
        AssistantTurn(role="user", text=question),
        AssistantTurn(role="assistant", text=answer.answer[:MAX_TURN_CHARS], refs=answer.refs),
    ]
    return Asked(answer, recorder.calls, recorder.tool_texts, [*history, *turns], recorder.cost_micro_usd)


def _estimate_usd(count: int) -> float:
    price = price_for(settings.AI_CHAT_MODEL).standard
    per_call = _ESTIMATE_PROMPT * price.input + _ESTIMATE_OUTPUT * price.output
    return float(count * _ESTIMATE_CALLS * per_call) / MICRO_USD_PER_USD


def _body(asked: Asked) -> str:
    if asked.answer is None:
        return f"({asked.error})"
    answer = asked.answer
    calls = "; ".join(f"{name} {json.dumps(arguments, default=str)}" for name, arguments in asked.calls) or "none"
    actions = "; ".join(f"{a.kind} '{a.label}'" for a in answer.actions) or "none"
    cards = ", ".join(card.type for card in answer.cards) or "none"
    return (
        f"{answer.answer}\n\n*{answer.kind} · cards: {cards} · buttons: {actions} · "
        f"cost ${asked.cost_micro_usd / MICRO_USD_PER_USD:.4f}*\n\n`calls: {calls}`"
    )


def report(rows: Sequence[tuple[Mapping[str, Any], str, Grade]], total_micro: int, today: date) -> str:
    counts = {status: sum(1 for _, _, g in rows if g.status == status) for status in STATUSES}
    lines = [
        f"# Dispatcher assistant eval: {settings.AI_CHAT_PROVIDER} {settings.AI_CHAT_MODEL}, {today.isoformat()}",
        "",
        " · ".join(f"{k} {v}" for k, v in counts.items()) + f" · cost at paid prices ${total_micro / MICRO_USD_PER_USD:.4f}",
        "",
    ]
    for item, body, result in rows:
        after = f" (after {item['after']})" if item.get("after") else ""
        lines += [f"## {item['id']} {result.status}{after}: {fill(item['question'], today)}", "", f"*{item['source']}*", ""]
        lines += [f"Page: {item['page']} → {item['page_shows']}", "", body, ""]
        lines += [f"- ✗ {reason}" for reason in result.reasons]
        if result.unmatched_numbers:
            lines.append(f"- check these numbers (not in any tool result): {', '.join(result.unmatched_numbers)}")
        lines.append("")
    return "\n".join(lines)


async def run(args: argparse.Namespace) -> None:
    items: list[dict[str, Any]] = json.loads(Path(args.questions).read_text())["questions"]
    if args.only:
        items = chain(items, args.only)
    asked_count = sum(1 for item in items if not item.get("skip"))
    print(f"{asked_count} questions ({len(items) - asked_count} skipped) on {settings.AI_CHAT_PROVIDER} "
          f"{settings.AI_CHAT_MODEL}; estimated ${_estimate_usd(asked_count):.2f} at paid prices.")
    if not args.confirm_spend:
        print("Dry run: add --confirm-spend to ask them.")
        return
    if not assistant_enabled():
        raise SystemExit("The assistant is switched off (ASSISTANT_ENABLED, the provider key, or an unpriced model).")
    today, user = today_sast(), _eval_user(uuid.UUID(args.org_id))
    rows: list[tuple[Mapping[str, Any], str, Grade]] = []
    histories: dict[str, list[AssistantTurn]] = {}
    total = 0
    for index, item in enumerate(items):
        if item.get("skip"):
            rows.append((item, f"(skipped: {item['skip']})", Grade(status="SKIP")))
            continue
        if total / MICRO_USD_PER_USD >= args.max_usd:
            print(f"Stopped: ${args.max_usd:.2f} spent, the most this run may spend.")
            break
        if index:
            await asyncio.sleep(args.pause)
        try:
            asked = await ask_one(fill(item["question"], today), histories.get(item.get("after") or "", []), user)
        except BudgetSpentError as exc:
            print(f"Stopped: {exc}")
            break
        histories[item["id"]] = asked.history
        result = grade(item, asked, today)
        total += asked.cost_micro_usd
        rows.append((item, _body(asked), result))
        print(f"{item['id']} {result.status} {'; '.join(result.reasons)}")
    Path(args.out).write_text(report(rows, total, today))
    print(f"Report: {args.out} · cost ${total / MICRO_USD_PER_USD:.4f}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--org-id", required=True, help="the organisation to ask as (its own records only)")
    parser.add_argument("--out", required=True, help="where to write the Markdown report (outside the repo)")
    parser.add_argument("--questions", default=str(DEFAULT_QUESTIONS))
    parser.add_argument("--only", nargs="*", help="question ids to run, e.g. s06 x02 (and the ones they follow)")
    parser.add_argument("--pause", type=float, default=DEFAULT_PAUSE_SECONDS, help="seconds between questions")
    parser.add_argument("--max-usd", type=float, default=DEFAULT_MAX_USD, help="stop once this much is spent")
    parser.add_argument("--confirm-spend", action="store_true", help="actually call the model")
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
