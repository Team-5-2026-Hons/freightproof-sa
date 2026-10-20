"""The FP-295 eval's grading logic (scripts/eval_analytics_chat.py). No model is called: these
check that the grader passes a right answer and catches the wrong ones."""

import json
from datetime import date
from pathlib import Path
from typing import Any

from scripts.eval_analytics_chat import DEFAULT_QUESTIONS, grade, tool_matches

from app.orchestration.analytics_chat.number_check import numbers_in, unmatched_numbers

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
