"""The FP-295 eval's grading logic (scripts/eval_analytics_chat.py). No model is called: these
check that the grader passes a right answer and catches the wrong ones."""

import json
from datetime import date
from pathlib import Path
from typing import Any

from scripts.eval_analytics_chat import DEFAULT_QUESTIONS, grade, page_view_for, tool_matches

from app.orchestration.analytics_chat.number_check import numbers_in, unmatched_numbers

from app.integrations.ai_chat.provider import ToolCall
from app.orchestration.analytics_chat.page_guide import TOPICS, guide_for
from app.orchestration.analytics_chat.tools import TOOLS_BY_NAME
from app.schemas.analytics_chat import Basis, ChatAnswer

_TODAY = date(2026, 10, 19)


def _basis(tool: str, start: date | None, end: date | None, grain: str | None) -> Basis:
    return Basis(tool=tool, tab=None, label=tool, start=start, end=end, grain=grain, closed_trip_count=3)  # type: ignore[arg-type]


def _answer(text: str, kind: str = "answer", basis: list[Basis] | None = None) -> ChatAnswer:
    return ChatAnswer(answer=text, kind=kind, basis=basis or [], spend=None)  # type: ignore[arg-type]


def _item(kind: str, tools: Any, must_mention: list[Any] | None = None) -> dict[str, Any]:
    return {"question": "q?", "expect": {"kind": kind, "tools": tools}, "must_mention": must_mention or []}


_ON_TIME_YEAR = {"tool": "on_time", "preset": "last_12_months", "grain": "month"}
_RIGHT = _basis("on_time", date(2025, 11, 1), _TODAY, "month")


def test_questions_file_has_24_questions_naming_real_tools() -> None:
    items = json.loads(Path(DEFAULT_QUESTIONS).read_text())["questions"]

    assert len(items) == 24
    named = {tool["tool"] for item in items if isinstance(item["expect"]["tools"], list) for tool in item["expect"]["tools"]}
    assert named <= set(TOOLS_BY_NAME)


def test_tool_matches_the_right_period_and_grain() -> None:
    assert tool_matches(_RIGHT, _ON_TIME_YEAR, _TODAY)
    assert not tool_matches(_basis("on_time", date(2025, 10, 20), _TODAY, "month"), _ON_TIME_YEAR, _TODAY)
    assert not tool_matches(_basis("on_time", date(2025, 11, 1), _TODAY, "week"), _ON_TIME_YEAR, _TODAY)
    assert not tool_matches(_basis("problems", date(2025, 11, 1), _TODAY, "month"), _ON_TIME_YEAR, _TODAY)


def test_tool_matches_last_month_tokens() -> None:
    expected = {"tool": "activity", "preset": "custom", "start": "last_month_start", "end": "last_month_end", "grain": "any"}

    assert tool_matches(_basis("activity", date(2026, 9, 1), date(2026, 9, 30), "week"), expected, _TODAY)


def test_tool_matches_all_time_checks_only_the_end() -> None:
    expected = {"tool": "activity", "preset": "all_time", "grain": "any"}

    assert tool_matches(_basis("activity", date(2025, 3, 1), _TODAY, "year"), expected, _TODAY)


def test_grade_passes_a_right_answer_with_the_page_figure() -> None:
    result = grade(_item("answer", [_ON_TIME_YEAR], ["81%"]), _answer("81% on time.", basis=[_RIGHT]), ['{"on_time_arrival_rate": 0.81}'], _TODAY)

    assert (result.status, result.reasons, result.unmatched_numbers) == ("PASS", [], [])


def test_grade_fails_a_missing_page_figure_or_wrong_period() -> None:
    wrong = _basis("on_time", date(2026, 1, 1), _TODAY, "month")

    result = grade(_item("answer", [_ON_TIME_YEAR], ["81%"]), _answer("About 80%.", basis=[wrong]), [], _TODAY)

    assert result.status == "FAIL"
    assert len(result.reasons) == 2


def test_grade_follow_up_must_use_no_figures() -> None:
    assert grade(_item("follow_up", []), _answer("For which period?", "follow_up"), [], _TODAY).status == "PASS"
    assert grade(_item("follow_up", []), _answer("R 1 000 000.", basis=[_RIGHT]), [], _TODAY).status == "FAIL"


def test_grade_not_answer_accepts_a_decline_or_follow_up_only() -> None:
    assert grade(_item("not_answer", []), _answer("There is no per-driver data.", "declined"), [], _TODAY).status == "PASS"
    assert grade(_item("not_answer", "optional"), _answer("Here are figures.", basis=[_RIGHT]), [], _TODAY).status == "FAIL"


def test_grade_forecast_questions_always_need_a_reader() -> None:
    assert grade(_item("no_forecast", "optional"), _answer("I can't predict that."), [], _TODAY).status == "REVIEW"


def test_numbers_in_reads_rand_thousands_and_decimal_commas() -> None:
    assert numbers_in("R 305 781 and 4,5 h and 81%") == [305781.0, 4.5, 81.0]


def test_unmatched_numbers_flags_a_figure_no_tool_returned_but_not_years_or_rates() -> None:
    flagged = unmatched_numbers("In 2026, 50% arrived on time; 7 trips were late.", ['{"rate": 0.5, "trips": 3}', "q?"])

    assert flagged == ["7"]


def test_grade_accepts_any_listed_spelling_of_a_page_figure() -> None:
    item = _item("answer", [_ON_TIME_YEAR], [["305 781", "305,781", "305781"]])

    assert grade(item, _answer("Delays cost R305,781.", basis=[_RIGHT]), ['{"cost": 305781}'], _TODAY).status == "PASS"


def test_grade_notes_an_extra_call_without_failing() -> None:
    extra = _basis("on_time", date(2026, 8, 1), _TODAY, "month")

    result = grade(_item("answer", [_ON_TIME_YEAR]), _answer("Fine.", basis=[_RIGHT, extra]), [], _TODAY)

    assert result.status == "PASS"
    assert len(result.extra_calls) == 2


def test_grade_vague_question_accepts_a_follow_up_or_a_right_now_snapshot_only() -> None:
    item = _item("follow_up_or_right_now", "optional")
    right_now = _basis("right_now", None, None, None)

    assert grade(item, _answer("Which period?", "follow_up"), [], _TODAY).status == "PASS"
    assert grade(item, _answer("4 live trips.", basis=[right_now]), [], _TODAY).status == "PASS"
    assert grade(item, _answer("Delays rose.", basis=[_RIGHT]), [], _TODAY).status == "FAIL"


_EXPLAIN_FILE = Path(DEFAULT_QUESTIONS).with_name("analytics_chat_explain_questions.json")


def _explain_item(topics: list[str], must_mention: list[Any], kind: str = "explanation") -> dict[str, Any]:
    return {
        "question": "How is operating cost worked out?",
        "expect": {"kind": kind, "tools": "optional" if kind == "explains" else [], "explain": topics},
        "must_mention": must_mention,
        "must_not": ["for which period"],
    }


def _call(name: str, topic: str) -> ToolCall:
    return ToolCall(id="c1", name=name, arguments={"topic": topic})


def test_explain_questions_file_covers_every_topic_and_names_real_tools() -> None:
    items = json.loads(_EXPLAIN_FILE.read_text())["questions"]

    assert len(items) == 32
    assert len({item["id"] for item in items}) == 32
    topics = {topic for item in items for topic in item["expect"].get("explain", [])}
    assert topics == set(TOPICS)
    named = {tool["tool"] for item in items if isinstance(item["expect"]["tools"], list) for tool in item["expect"]["tools"]}
    assert named <= set(TOOLS_BY_NAME)
    for item in items:
        if "page_view" in item:
            assert page_view_for(item) is not None


def test_grade_passes_an_explanation_from_the_right_topic_with_its_facts() -> None:
    answer = _answer("Road distance times fuel at R 17.64 per km, plus driver hours.", kind="explanation")

    result = grade(_explain_item(["cost"], [["17.64"], ["driver"]]), answer, [], _TODAY, [_call("explain", "cost")])

    assert (result.status, result.reasons) == ("PASS", [])


def test_grade_fails_an_explanation_that_read_the_wrong_topic_or_none() -> None:
    answer = _answer("Road distance times fuel per km.", kind="explanation")

    wrong = grade(_explain_item(["cost"], []), answer, [], _TODAY, [_call("explain", "on_time")])
    none = grade(_explain_item(["cost"], []), answer, [], _TODAY, [])

    assert wrong.reasons == ["didn't read the page guide for cost (read: ['on_time'])"]
    assert none.reasons == ["didn't read the page guide for cost (read: none)"]


def test_grade_fails_a_period_question_back_on_an_explanation() -> None:
    answer = _answer("For which period: the last 12 weeks, or this year?", kind="follow_up")

    result = grade(_explain_item(["cost"], []), answer, [], _TODAY, [])

    assert result.status == "FAIL"
    assert "says 'for which period', which it mustn't" in result.reasons
    assert "kind follow_up, expected explanation" in result.reasons


def test_grade_never_accepts_an_em_dash() -> None:
    answer = _answer("Operating cost — an estimate.", kind="explanation")

    result = grade(_explain_item(["cost"], []), answer, [], _TODAY, [_call("explain", "cost")])

    assert result.reasons == ["says '—', which it mustn't"]


def test_grade_explains_kind_takes_an_explanation_or_an_answer_with_figures() -> None:
    item = _explain_item(["cost"], [], kind="explains")
    calls = [_call("explain", "cost")]

    assert grade(item, _answer("It's an estimate.", kind="explanation"), [], _TODAY, calls).status == "PASS"
    assert grade(item, _answer("R 1 is an estimate.", kind="answer", basis=[_RIGHT]), [], _TODAY, calls).status == "PASS"


def test_grade_not_answer_also_accepts_a_refusal_that_explains_its_reason() -> None:
    item = _item("not_answer", [])

    assert grade(item, _answer("The page ranks no driver, by design.", kind="explanation"), [], _TODAY).status == "PASS"


def test_page_view_for_reads_the_screen_or_nothing() -> None:
    view = page_view_for({"page_view": {"tab": "cost", "preset": "last_12_weeks", "grain": "week"}})

    assert view is not None and (view.tab, view.preset, view.grain) == ("cost", "last_12_weeks", "week")
    assert page_view_for({}) is None


def test_every_fact_an_explanation_question_requires_is_in_the_guide_it_should_read() -> None:
    items = json.loads(_EXPLAIN_FILE.read_text())["questions"]
    missing = []
    for item in items:
        topics = item["expect"].get("explain", [])
        if not topics:
            continue
        guide = json.dumps([guide_for(topic) for topic in topics], ensure_ascii=False).lower() + " 17.64"
        missing += [
            f"{item['id']}: {spellings}" for spellings in item["must_mention"]
            if not any(spelling.lower() in guide for spelling in spellings)
        ]

    assert missing == []
