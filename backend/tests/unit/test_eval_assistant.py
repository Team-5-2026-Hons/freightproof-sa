"""The assistant eval's grading logic (scripts/eval_assistant.py, spec §8.5). No model is called: these
check that the grader passes a right answer and catches the wrong ones."""

import json
import uuid
from datetime import date
from pathlib import Path
from typing import Any

from scripts.eval_assistant import DEFAULT_QUESTIONS, Asked, call_matches, chain, fill, grade

from app.orchestration.assistant.tools import TOOLS_BY_NAME
from app.schemas.assistant import AssistantAnswer, ChooseCard, OpenPageAction, RecordRef

_TODAY = date(2026, 10, 21)
_TIM = RecordRef(kind="driver", id=uuid.uuid4(), label="Timothy Gultig")


def _answer(text: str, kind: str = "answer", **fields: Any) -> AssistantAnswer:
    values: dict[str, Any] = {"cards": [], "actions": [], "tools_used": [], "refs": [], "spend": None, **fields}
    return AssistantAnswer(answer=text, kind=kind, **values)  # type: ignore[arg-type]


def _asked(answer: AssistantAnswer, calls: list[tuple[str, dict[str, object]]] | None = None, texts: list[str] | None = None) -> Asked:
    return Asked(answer=answer, calls=list(calls or []), tool_texts=texts or [], history=[], cost_micro_usd=0)


def _item(kind: str, calls: Any, **fields: Any) -> dict[str, Any]:
    expect = {"kind": kind, "calls": calls, **{k: fields.pop(k) for k in ("actions", "no_actions", "cards") if k in fields}}
    return {"question": "q?", "expect": expect, **fields}


_ACTIVE = {"tool": "trips", "args": {"status_group": "active"}}


def test_questions_file_has_63_unique_questions_naming_real_tools() -> None:
    items = json.loads(Path(DEFAULT_QUESTIONS).read_text())["questions"]

    assert len(items) == 63
    ids = [item["id"] for item in items]
    assert len(set(ids)) == len(ids)
    named = {
        name for item in items if isinstance(item["expect"]["calls"], list) for call in item["expect"]["calls"]
        for name in (call["tool"] if isinstance(call["tool"], list) else [call["tool"]])
    }
    assert named <= set(TOOLS_BY_NAME)
    # A follow-up names a question asked before it.
    assert all(ids.index(item["after"]) < ids.index(item["id"]) for item in items if item.get("after"))


def test_call_matches_a_subset_of_the_inputs_ignoring_case() -> None:
    actual = {"status_group": "active", "when": {"preset": "today", "n": None}, "kinds": ["driver", "horse"]}

    assert call_matches({"tool": "trips", "args": {"status_group": "Active", "when": {"preset": "today"}}}, "trips", actual)
    assert call_matches({"tool": ["free_crew", "trips"], "args": {"kinds": ["horse"]}}, "trips", actual)
    assert not call_matches({"tool": "trips", "args": {"when": {"preset": "tomorrow"}}}, "trips", actual)
    assert not call_matches(_ACTIVE, "free_crew", actual)


def test_grade_passes_a_right_answer_with_the_page_fact() -> None:
    result = grade(
        {**_item("answer", [_ACTIVE]), "must_mention": [["5 active", "five"]]},
        _asked(_answer("There are 5 active trips."), [("trips", {"status_group": "active"})], ['{"total": 5}']),
        _TODAY,
    )

    assert (result.status, result.reasons, result.unmatched_numbers) == ("PASS", [], [])


def test_grade_fails_wrong_kind_missing_call_and_a_forbidden_phrase() -> None:
    item = {**_item("follow_up", [_ACTIVE]), "must_not_mention": ["is available"]}

    result = grade(item, _asked(_answer("Tim is available.")), _TODAY)

    assert result.status == "FAIL"
    assert len(result.reasons) == 3


def test_grade_checks_buttons_cards_and_patterns() -> None:
    page = OpenPageAction(label="Open", page="driver", record_id=_TIM.id, filters={})
    choose = ChooseCard(what="driver", typed="T", options=[_TIM], more=0)
    answer = _answer("Call 082 555 1234.", "follow_up", actions=[page], cards=[choose])

    wrong = grade({**_item("any", "optional", actions=[], cards=["choose"]), "must_not_match": [r"\b0\d{2} \d{3} \d{4}"]}, _asked(answer), _TODAY)
    right = grade(_item("any", "optional", actions=["open_page"], no_actions=["open_trip_form"], cards=["choose"]), _asked(answer), _TODAY)

    assert wrong.status == "FAIL" and len(wrong.reasons) == 2
    assert right.status == "PASS"


def test_grade_review_and_error() -> None:
    assert grade({**_item("point", "optional"), "review": True}, _asked(_answer("See the trip page.", "declined")), _TODAY).status == "REVIEW"
    failed = Asked(answer=None, calls=[], tool_texts=[], history=[], cost_micro_usd=0, error="provider failed: 503")
    assert grade(_item("answer", [_ACTIVE]), failed, _TODAY).status == "ERROR"


def test_fill_uses_the_run_day() -> None:
    assert fill("on {today_weekday}: {today_day} or {next_week_day}?", _TODAY) == "on Wednesday: 21 Oct or 28 Oct?"


def test_chain_adds_the_questions_a_follow_up_needs() -> None:
    items = [{"id": "a"}, {"id": "b", "after": "a"}, {"id": "c", "after": "b"}, {"id": "d"}]

    assert [item["id"] for item in chain(items, ["c"])] == ["a", "b", "c"]
