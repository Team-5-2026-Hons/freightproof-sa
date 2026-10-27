"""Run the Analytics chat's eval against the real model (FP-295 spec §8.5; explanation questions, B45).

Never part of CI: every question costs real money (or free-tier quota). It asks each question
through the same service.ask the endpoint uses, as one organisation, against DATABASE_URL
(the tools only read), and grades the answer:

  PASS / FAIL  the right tool(s) for the right period and View by, the right kind of reply
               (answer, follow-up, explanation, decline), every figure or fact the page shows
               (must_mention), the page-guide topic it should explain (explain), and nothing it must
               not say (must_not: "for which period" on an explanation, and never an em dash);
  REVIEW       needs a person to read it (e.g. "did it avoid a forecast?");
  ERROR        the model provider failed.

It also lists numbers in each answer that appear in no tool result, for a person to check:
most are harmless (a percentage worked out from two counts), but one that isn't is a figure
the model made up.

Usage (from backend/, run as a module so `app` is importable):
    python -m scripts.eval_analytics_chat --org-id <ORGANISATION_UUID> --out /path/report.md --confirm-spend
    python -m scripts.eval_analytics_chat ... --only q01 q08      # just some questions
    python -m scripts.eval_analytics_chat ... --model gemini-2.5-flash   # another priced model, same provider
    python -m scripts.eval_analytics_chat ... --questions tests/eval/analytics_chat_explain_questions.json

Without --confirm-spend it prints what it would ask and the estimated cost, and stops.
The report goes OUTSIDE the repository (--out), so nothing about a run is committed by accident.
"""

import argparse
import asyncio
import json
import re
import uuid
from collections.abc import Sequence
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
    ToolCall,
    ToolResults,
    ToolSpec,
)
from app.orchestration.analytics_chat import service
from app.orchestration.analytics_chat.number_check import unmatched_numbers
from app.orchestration.analytics_chat.periods import PeriodPreset, resolve_preset
from app.orchestration.analytics_chat.service import ChatCreditError, ChatProviderFailedError, ChatQuotaError
from app.schemas.analytics_chat import Basis, ChatAnswer, ChatRequest, PageView
from app.schemas.people import UserRead

DEFAULT_QUESTIONS = Path(__file__).resolve().parents[1] / "tests" / "eval" / "analytics_chat_questions.json"
DEFAULT_PAUSE_SECONDS = 15.0
_ESTIMATE_CALLS, _ESTIMATE_PROMPT, _ESTIMATE_OUTPUT = 2, 6_000, 400
MICRO_USD_PER_USD = 1_000_000


@dataclass
class Grade:
    status: str
    reasons: list[str] = field(default_factory=list)
    unmatched_numbers: list[str] = field(default_factory=list)
    extra_calls: list[str] = field(default_factory=list)



def _date_token(token: str, today: date) -> date:
    """A fixed date, or a date relative to today: today, this_month_start, last_month_start, last_month_end."""
    first_this_month = today.replace(day=1)
    if token == "today":
        return today
    if token == "this_month_start":
        return first_this_month
    if token == "last_month_end":
        return first_this_month - timedelta(days=1)
    if token == "last_month_start":
        return (first_this_month - timedelta(days=1)).replace(day=1)
    return date.fromisoformat(token)


def tool_matches(basis: Basis, expected: dict[str, Any], today: date) -> bool:
    """Whether a "Based on" line is the expected tool, period and View by."""
    if basis.tool != expected["tool"]:
        return False
    preset = expected.get("preset")
    if preset is not None:
        custom = preset == PeriodPreset.CUSTOM.value
        start, end = resolve_preset(
            PeriodPreset(preset), today=today,
            start=_date_token(expected["start"], today) if custom else None,
            end=_date_token(expected["end"], today) if custom else None,
        )
        if basis.end != end or (start is not None and basis.start != start):
            return False
    grain = expected.get("grain", "any")
    return grain == "any" or basis.grain == grain



_RIGHT_NOW_TOOL = "right_now"


def _kind_reason(expected_kind: str, answer: ChatAnswer) -> str | None:
    if expected_kind == "follow_up_or_right_now":
        snapshot = answer.kind == "answer" and bool(answer.basis) and all(b.tool == _RIGHT_NOW_TOOL for b in answer.basis)
        return None if answer.kind == "follow_up" or snapshot else f"kind {answer.kind}, expected a follow-up or a Right now snapshot"
    allowed = {
        "answer": {"answer"},
        "follow_up": {"follow_up"},
        "explanation": {"explanation"},
        "explains": {"explanation", "answer"},
        "not_answer": {"follow_up", "declined", "explanation"},
        "no_forecast": {"answer", "follow_up", "declined"},
    }[expected_kind]
    return None if answer.kind in allowed else f"kind {answer.kind}, expected {expected_kind}"


def _tools_reasons(expected_tools: Any, basis: Sequence[Basis], today: date) -> list[str]:
    if expected_tools == "optional":
        return []
    if not expected_tools:
        return [] if not basis else [f"used figures it shouldn't: {[b.tool for b in basis]}"]
    reasons = [
        f"no matching call for {expected}" for expected in expected_tools
        if not any(tool_matches(b, expected, today) for b in basis)
    ]
    return reasons


def extra_calls(expected_tools: Any, basis: Sequence[Basis]) -> list[str]:
    """Calls beyond the expected ones. Not a failure (the spec's rule is "the right tool for the
    right period"), but each adds a "Based on" line a dispatcher has to read, so it's reported."""
    if not isinstance(expected_tools, list) or len(basis) <= len(expected_tools):
        return []
    return [f"{b.tool} {b.start}–{b.end} {b.grain}" for b in basis]


def _normalise(text: str) -> str:
    return re.sub(r"[  ]", " ", text).lower()


EM_DASH = "\u2014"


def explain_reasons(expected_topics: Sequence[str], calls: Sequence[ToolCall]) -> list[str]:
    """An explanation has no "Based on" line to check, so the page-guide topic it read is checked instead: any one
    of the expected topics will do."""
    if not expected_topics:
        return []
    read = {str(call.arguments.get("topic")) for call in calls if call.name == "explain"}
    return [] if read & set(expected_topics) else [f"didn't read the page guide for {' or '.join(expected_topics)} (read: {sorted(read) or 'none'})"]


def grade(
    item: dict[str, Any], answer: ChatAnswer, tool_texts: Sequence[str], today: date, calls: Sequence[ToolCall] = (),
) -> Grade:
    expect = item["expect"]
    reasons = [r for r in [_kind_reason(expect["kind"], answer)] if r is not None]
    reasons += _tools_reasons(expect["tools"], answer.basis, today)
    reasons += explain_reasons(expect.get("explain", []), calls)
    text = _normalise(answer.answer)
    for figure in item["must_mention"]:
        spellings = [figure] if isinstance(figure, str) else figure
        if not any(_normalise(spelling) in text for spelling in spellings):
            reasons.append(f"doesn't mention {spellings[0]!r} (the page shows it)")
    for phrase in [*item.get("must_not", []), EM_DASH]:
        if _normalise(phrase) in text:
            reasons.append(f"says {phrase!r}, which it mustn't")
    status = "FAIL" if reasons else ("REVIEW" if expect["kind"] == "no_forecast" else "PASS")
    return Grade(
        status=status, reasons=reasons,
        unmatched_numbers=unmatched_numbers(answer.answer, [*tool_texts, item["question"]]),
        extra_calls=extra_calls(expect["tools"], answer.basis),
    )



class RecordingProvider:
    """Wraps the real provider to keep what the tools returned and what each call cost."""

    def __init__(self, inner: ChatProvider, price: ModelPrice) -> None:
        self._inner = inner
        self._price = price
        self.tool_texts: list[str] = []
        self.calls: list[ToolCall] = []
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
        self.cost_micro_usd += cost_micro_usd(reply.usage, self._price)
        self.calls.extend(reply.tool_calls)
        return reply


def page_view_for(item: dict[str, Any]) -> PageView | None:
    """What the dispatcher has on screen for this question, as the panel sends it (B45 page context)."""
    view = item.get("page_view")
    return None if view is None else PageView.model_validate(view)


def _eval_user(organization_id: uuid.UUID) -> UserRead:
    now = datetime.now(UTC)
    return UserRead(
        id=uuid.uuid4(), organization_id=organization_id, email="eval@freightproof.local",
        full_name="FP-295 eval", created_at=now, updated_at=now,
    )


async def _ask_one(item: dict[str, Any], user: UserRead, today: date) -> tuple[str, Grade, int]:
    recorder = RecordingProvider(service.build_provider(), price_for(settings.AI_CHAT_MODEL))
    async with AsyncSessionLocal() as db:
        try:
            request = ChatRequest(question=item["question"], page=page_view_for(item))
            answer = await service.ask(db, user=user, request=request, provider=recorder)
        except (ChatCreditError, ChatQuotaError, ChatProviderFailedError, AiProviderError) as exc:
            return f"(provider failed: {exc})", Grade(status="ERROR", reasons=[str(exc)]), recorder.cost_micro_usd
        finally:
            await db.rollback()
    basis = "; ".join(f"{b.label} {b.start}–{b.end} {b.grain} ({b.closed_trip_count} trips)" for b in answer.basis)
    body = f"{answer.answer}\n\n*{answer.kind} · Based on: {basis or 'no figures used'}*"
    return body, grade(item, answer, recorder.tool_texts, today, recorder.calls), recorder.cost_micro_usd


def _estimate_usd(count: int) -> float:
    price = price_for(settings.AI_CHAT_MODEL).standard
    per_call = _ESTIMATE_PROMPT * price.input + _ESTIMATE_OUTPUT * price.output
    return float(count * _ESTIMATE_CALLS * per_call) / MICRO_USD_PER_USD


def _report(rows: list[tuple[dict[str, Any], str, Grade]], total_micro: int, today: date) -> str:
    counts = {status: sum(1 for _, _, g in rows if g.status == status) for status in ("PASS", "FAIL", "REVIEW", "ERROR")}
    lines = [
        f"# FP-295 eval: {settings.AI_CHAT_PROVIDER} {settings.AI_CHAT_MODEL}, {today.isoformat()}",
        "",
        " · ".join(f"{k} {v}" for k, v in counts.items()) + f" · cost at paid prices ${total_micro / MICRO_USD_PER_USD:.4f}",
        "",
    ]
    for item, body, result in rows:
        lines += [f"## {item['id']} {result.status}: {item['question']}", "", f"Page: {item['page']} → {item['page_shows']}", "", body, ""]
        lines += [f"- ✗ {reason}" for reason in result.reasons]
        if result.extra_calls:
            lines.append(f"- note: more calls than needed: {'; '.join(result.extra_calls)}")
        if result.unmatched_numbers:
            lines.append(f"- check these numbers (not in any tool result): {', '.join(result.unmatched_numbers)}")
        lines.append("")
    return "\n".join(lines)


async def run(args: argparse.Namespace) -> None:
    if args.model:
        price_for(args.model)
        settings.AI_CHAT_MODEL = args.model
    items = json.loads(Path(args.questions).read_text())["questions"]
    if args.only:
        items = [item for item in items if item["id"] in args.only]
    print(f"{len(items)} questions on {settings.AI_CHAT_PROVIDER} {settings.AI_CHAT_MODEL}; "
          f"estimated ${_estimate_usd(len(items)):.2f} at paid prices.")
    if not args.confirm_spend:
        print("Dry run: add --confirm-spend to ask them.")
        return
    if not service.chat_enabled():
        raise SystemExit("The chat is switched off (AI_CHAT_ENABLED, the provider key, or an unpriced model).")
    today, user, rows, total = today_sast(), _eval_user(uuid.UUID(args.org_id)), [], 0
    for index, item in enumerate(items):
        if index:
            await asyncio.sleep(args.pause)
        body, result, cost = await _ask_one(item, user, today)
        total += cost
        rows.append((item, body, result))
        print(f"{item['id']} {result.status} {'; '.join(result.reasons)}")
    Path(args.out).write_text(_report(rows, total, today))
    print(f"Report: {args.out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--org-id", required=True, help="the organisation to ask as (its own figures only)")
    parser.add_argument("--out", required=True, help="where to write the Markdown report (outside the repo)")
    parser.add_argument("--questions", default=str(DEFAULT_QUESTIONS))
    parser.add_argument("--only", nargs="*", help="question ids to run, e.g. q01 q08")
    parser.add_argument("--model", help="override AI_CHAT_MODEL for this run (must be priced)")
    parser.add_argument("--pause", type=float, default=DEFAULT_PAUSE_SECONDS, help="seconds between questions")
    parser.add_argument("--confirm-spend", action="store_true", help="actually call the model")
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
