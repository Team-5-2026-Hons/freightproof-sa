"""The period parser (analysis §10.3): named periods in a question become exact tool inputs, the
way the page would read them; anything unclear is left to the model."""

from datetime import date

import pytest

from app.orchestration.analytics_chat.period_hints import (
    EXPLANATION_HINT,
    FINANCIAL_YEAR_QUESTION,
    ambiguity_question,
    asks_for_explanation,
    asks_about_right_now,
    hint_for,
    last_year_question,
    named_periods,
    past_month_question,
    past_week_question,
)
from app.orchestration.analytics_chat.periods import PeriodPreset, resolve_preset

_TODAY = date(2026, 10, 20)


def _one(question: str, today: date = _TODAY) -> tuple[PeriodPreset, date | None, date]:
    [period] = named_periods(question, today)
    return period.preset, period.start, period.end


@pytest.mark.parametrize(
    ("question", "preset"),
    [
        ("How did delays change over the past year?", PeriodPreset.LAST_12_MONTHS),
        ("On-time arrivals in the last 12 weeks?", PeriodPreset.LAST_12_WEEKS),
        ("Theft signs in the last 3 months?", PeriodPreset.LAST_3_MONTHS),
        ("Problems over the past 26 weeks", PeriodPreset.LAST_26_WEEKS),
        ("Cost in the last 6 months", PeriodPreset.LAST_6_MONTHS),
        ("Trips in the last 3 years", PeriodPreset.LAST_3_YEARS),
        ("Which lane had the most problems this year?", PeriodPreset.THIS_YEAR),
        ("Cancellations year to date", PeriodPreset.THIS_YEAR),
        ("Busiest hour over all time?", PeriodPreset.ALL_TIME),
    ],
)
def test_named_presets_match_the_pages_presets(question: str, preset: PeriodPreset) -> None:
    found_preset, start, end = _one(question)

    assert found_preset is preset
    assert (start, end) == resolve_preset(preset, today=_TODAY)


def test_a_non_preset_length_uses_the_page_rule_as_custom_dates() -> None:
    assert _one("Problems in the last 8 weeks") == (PeriodPreset.CUSTOM, date(2026, 8, 31), _TODAY)


@pytest.mark.parametrize(
    ("question", "start", "end"),
    [
        ("How many trips did we run last month?", date(2026, 9, 1), date(2026, 9, 30)),
        ("Problems this month", date(2026, 10, 1), _TODAY),
        ("Arrivals this week", date(2026, 10, 19), _TODAY),
        ("Arrivals last week", date(2026, 10, 12), date(2026, 10, 18)),
        ("Trips in September", date(2026, 9, 1), date(2026, 9, 30)),
        ("Trips in October", date(2026, 10, 1), _TODAY),
        ("Trips in November", date(2025, 11, 1), date(2025, 11, 30)),
        ("Trips in September last year", date(2025, 9, 1), date(2025, 9, 30)),
        ("Trips in Sept 2024", date(2024, 9, 1), date(2024, 9, 30)),
        ("Problems in Q3", date(2026, 7, 1), date(2026, 9, 30)),
        ("Problems in Q4", date(2026, 10, 1), _TODAY),
        ("Problems in Q1 2025", date(2025, 1, 1), date(2025, 3, 31)),
        ("Trips in May", date(2026, 5, 1), date(2026, 5, 31)),
    ],
)
def test_calendar_periods_are_read_as_their_dates(question: str, start: date, end: date) -> None:
    assert _one(question) == (PeriodPreset.CUSTOM, start, end)


def test_two_named_months_give_two_periods_in_order() -> None:
    periods = named_periods("Compare on-time arrivals in September with October.", _TODAY)

    assert [(p.start, p.end) for p in periods] == [(date(2026, 9, 1), date(2026, 9, 30)), (date(2026, 10, 1), _TODAY)]


def test_this_year_after_quarters_is_their_year_not_a_third_period() -> None:
    periods = named_periods("Compare problems per 100 trips in Q3 with Q2 this year.", _TODAY)

    assert [(p.phrase, p.start, p.end) for p in periods] == [
        ("Q3", date(2026, 7, 1), date(2026, 9, 30)), ("Q2", date(2026, 4, 1), date(2026, 6, 30)),
    ]


def test_new_years_day_reads_december_as_last_year_and_this_week_across_the_year() -> None:
    new_year = date(2027, 1, 1)

    assert _one("Trips in December", new_year) == (PeriodPreset.CUSTOM, date(2026, 12, 1), date(2026, 12, 31))
    assert _one("Trips this week", new_year) == (PeriodPreset.CUSTOM, date(2026, 12, 28), new_year)
    assert _one("Trips last month", new_year) == (PeriodPreset.CUSTOM, date(2026, 12, 1), date(2026, 12, 31))


def test_a_sunday_still_counts_the_week_from_monday() -> None:
    sunday = date(2026, 10, 25)

    assert _one("Arrivals this week", sunday) == (PeriodPreset.CUSTOM, date(2026, 10, 19), sunday)


@pytest.mark.parametrize(
    "question",
    [
        "Which lane costs the most to run?",
        "How are things going?",
        "Will delays get worse next month?",
        "How many trips last year?",
        "Delays may get worse",
        "Which driver has the most problems?",
        "The march to the depot was slow",
    ],
)
def test_unclear_or_absent_periods_are_left_to_the_model(question: str) -> None:
    assert named_periods(question, _TODAY) == []


def test_lower_case_may_and_march_are_words_but_capitalised_they_are_months() -> None:
    assert named_periods("delays may get worse on the march north", _TODAY) == []
    assert _one("delays in May") == (PeriodPreset.CUSTOM, date(2026, 5, 1), date(2026, 5, 31))
    assert _one("delays in March 2025") == (PeriodPreset.CUSTOM, date(2025, 3, 1), date(2025, 3, 31))


def test_right_now_is_recognised_without_a_period() -> None:
    assert asks_about_right_now("How many critical problems are waiting for review right now?")
    assert hint_for("How many critical problems are waiting right now?", _TODAY) == (
        'The question asks about right now: the "right_now" tool needs no period.'
    )


def test_hint_gives_exact_tool_inputs_and_says_not_to_ask() -> None:
    hint = hint_for("How many trips did we run last month?", _TODAY)

    assert hint is not None
    assert "don't ask which period" in hint
    assert '"last month" → preset "custom", start "2026-09-01", end "2026-09-30"' in hint


def test_no_hint_when_nothing_is_named() -> None:
    assert hint_for("Which lane costs the most to run?", _TODAY) is None




@pytest.mark.parametrize(
    ("question", "start"),
    [
        ("Problems in the last 30 days", date(2026, 9, 21)),
        ("and in the lasty 30 days from today", None),
        ("Trips over the past 7 days", date(2026, 10, 14)),
        ("Trips in the last 1 day", _TODAY),
    ],
)
def test_last_n_days_ends_today_and_counts_today(question: str, start: date | None) -> None:
    periods = named_periods(question, _TODAY)

    if start is None:
        assert periods == []
    else:
        assert [(p.preset, p.start, p.end) for p in periods] == [(PeriodPreset.CUSTOM, start, _TODAY)]


@pytest.mark.parametrize("question", ["How many problems have we had in the past month", "Delays over the PAST MONTH?"])
def test_past_month_is_asked_back_never_looked_up(question: str) -> None:
    hint = hint_for(question, _TODAY)

    assert hint is not None
    assert "Call no tool" in hint
    assert '"For which period: the last 30 days, or September 2026 (the previous calendar month)?"' in hint


def test_past_month_question_names_the_right_calendar_month_across_a_new_year() -> None:
    assert past_month_question(date(2027, 1, 5)) == (
        "For which period: the last 30 days, or December 2026 (the previous calendar month)?"
    )


@pytest.mark.parametrize("answer", ["the previous calendar month", "Last calendar month", "the past calendar month please"])
def test_the_calendar_month_reply_is_read_as_last_month(answer: str) -> None:
    assert [(p.start, p.end) for p in named_periods(answer, _TODAY)] == [(date(2026, 9, 1), date(2026, 9, 30))]


def test_past_months_plural_and_past_n_months_are_not_the_ambiguous_phrase() -> None:
    assert hint_for("The past months were busy", _TODAY) is None
    [period] = named_periods("Problems in the past 2 months", _TODAY)
    assert (period.start, period.end) == (date(2026, 9, 1), _TODAY)



@pytest.mark.parametrize(
    ("question", "ask"),
    [
        ("How many trips last year?", "For which period: the last 12 months, or 2025 (the previous calendar year)?"),
        ("Delays in the past week", "For which period: the last 7 days, or last week (Monday 12 October to Sunday 18 October)?"),
        ("What did delays cost us this financial year?", FINANCIAL_YEAR_QUESTION),
        ("Problems in FY2026", FINANCIAL_YEAR_QUESTION),
        ("Trips this fiscal year", FINANCIAL_YEAR_QUESTION),
    ],
)
def test_phrases_with_two_meanings_are_asked_back_with_an_exact_question(question: str, ask: str) -> None:
    hint = hint_for(question, _TODAY)

    assert hint is not None
    assert "Call no tool" in hint
    assert f'"{ask}"' in hint


@pytest.mark.parametrize(
    "question",
    [
        "Trips in September last year",
        "Problems in Q3 last year",
        "Problems in the last calendar year",
        "Delays in the past 2 weeks",
        "The past weeks were busy",
        "Trips in the last 12 months",
    ],
)
def test_clear_relatives_of_the_two_meaning_phrases_are_not_asked_back(question: str) -> None:
    assert ambiguity_question(question, _TODAY) is None


def test_every_question_back_ends_with_a_question_mark_so_it_shows_as_one() -> None:
    for ask in (past_month_question(_TODAY), past_week_question(_TODAY), last_year_question(_TODAY), FINANCIAL_YEAR_QUESTION):
        assert ask.endswith("?")
        assert len(ask) <= 200


def test_the_questions_back_name_the_right_dates_across_a_new_year() -> None:
    new_year = date(2027, 1, 1)

    assert last_year_question(new_year) == "For which period: the last 12 months, or 2026 (the previous calendar year)?"
    assert past_week_question(new_year) == (
        "For which period: the last 7 days, or last week (Monday 21 December to Sunday 27 December)?"
    )


@pytest.mark.parametrize(
    ("reply", "start", "end"),
    [
        ("2025", date(2025, 1, 1), date(2025, 12, 31)),
        ("the previous calendar year", date(2025, 1, 1), date(2025, 12, 31)),
        ("the last 12 months", date(2025, 11, 1), _TODAY),
        ("the last 7 days", date(2026, 10, 14), _TODAY),
        ("last week", date(2026, 10, 12), date(2026, 10, 18)),
        ("March 2026 to February 2027", date(2026, 3, 1), _TODAY),
    ],
)
def test_the_replies_to_the_questions_back_are_read(reply: str, start: date, end: date) -> None:
    assert [(p.start, p.end) for p in named_periods(reply, _TODAY)] == [(start, end)]



@pytest.mark.parametrize(
    ("question", "start", "end"),
    [
        ("How many trips today?", _TODAY, _TODAY),
        ("Problems yesterday", date(2026, 10, 19), date(2026, 10, 19)),
        ("Problems this quarter", date(2026, 10, 1), _TODAY),
        ("Problems last quarter", date(2026, 7, 1), date(2026, 9, 30)),
        ("Problems in the previous quarter", date(2026, 7, 1), date(2026, 9, 30)),
        ("Trips in 2025", date(2025, 1, 1), date(2025, 12, 31)),
        ("Trips in 2026", date(2026, 1, 1), _TODAY),
        ("Trips since 1 September", date(2026, 9, 1), _TODAY),
        ("Trips since the 1st of September", date(2026, 9, 1), _TODAY),
        ("Trips since August", date(2026, 8, 1), _TODAY),
        ("Trips since 1 November", date(2025, 11, 1), _TODAY),
        ("Trips since 2025", date(2025, 1, 1), _TODAY),
        ("Trips since the start of 2026", date(2026, 1, 1), _TODAY),
        ("Trips from 1 September onwards", date(2026, 9, 1), _TODAY),
        ("Trips from 1 Sep to 15 Oct", date(2026, 9, 1), date(2026, 10, 15)),
        ("Trips between 1 and 15 October", date(2026, 10, 1), date(2026, 10, 15)),
        ("Trips 1-15 October", date(2026, 10, 1), date(2026, 10, 15)),
        ("Trips between the 1st of September and today", date(2026, 9, 1), _TODAY),
        ("Trips from 2025-09-01 to 2025-09-30", date(2025, 9, 1), date(2025, 9, 30)),
        ("Trips from December to February", date(2025, 12, 1), date(2026, 2, 28)),
        ("Trips from Monday 12 October to Sunday 18 October", date(2026, 10, 12), date(2026, 10, 18)),
        ("Trips from 2024 to 2025", date(2024, 1, 1), date(2025, 12, 31)),
        ("Trips on 1 September", date(2026, 9, 1), date(2026, 9, 1)),
        ("Trips on 2026-09-01", date(2026, 9, 1), date(2026, 9, 1)),
        ("Trips on 25 October", date(2025, 10, 25), date(2025, 10, 25)),
        ("Trips on 1 may", date(2026, 5, 1), date(2026, 5, 1)),
    ],
)
def test_clear_phrases_are_read_as_their_dates(question: str, start: date, end: date) -> None:
    assert _one(question) == (PeriodPreset.CUSTOM, start, end)


def test_a_range_is_one_period_not_also_its_two_months() -> None:
    assert [p.phrase for p in named_periods("Compare problems from 1 Sep to 15 Oct", _TODAY)] == ["from 1 Sep to 15 Oct"]


def test_a_range_that_is_no_period_is_not_read_as_its_months_either() -> None:
    assert named_periods("Trips since 31 September", _TODAY) == []
    assert named_periods("Trips from December 2026 to February 2027", _TODAY) == []


def test_today_as_the_end_of_another_period_is_not_a_day_of_its_own() -> None:
    assert named_periods("and in the lasty 30 days from today", _TODAY) == []
    assert [p.phrase for p in named_periods("Problems in the last 30 days up to today", _TODAY)] == ["last 30 days"]


def test_yesterday_and_today_are_two_periods_in_the_order_asked() -> None:
    assert [p.phrase for p in named_periods("Trips yesterday compared with today", _TODAY)] == ["yesterday", "today"]


def test_two_years_give_two_periods_and_the_year_in_a_date_is_not_one() -> None:
    assert [p.phrase for p in named_periods("Problems in 2025 vs 2024", _TODAY)] == ["2025", "2024"]
    assert [p.phrase for p in named_periods("Trips in Sept 2024", _TODAY)] == ["Sept 2024"]


def test_quarters_across_a_new_year() -> None:
    new_year = date(2027, 1, 1)

    assert _one("Problems last quarter", new_year) == (PeriodPreset.CUSTOM, date(2026, 10, 1), date(2026, 12, 31))
    assert _one("Problems this quarter", new_year) == (PeriodPreset.CUSTOM, new_year, new_year)


_TOMS_FOLLOW_UP = (
    "last year, but i am asking what the figures comprise of. so how do we come up with operating cost, where does "
    "thart number come from and same with the other 2 numbers"
)


@pytest.mark.parametrize(
    "question",
    [
        'what do the "Cost at a glance" figures tell us',
        _TOMS_FOLLOW_UP,
        "How is operating cost calculated?",
        "What's the purpose of this graph?",
        "why was it made and what does it show",
        "Why is the last bar faded?",
        "Where does the cargo value come from?",
        "What is an override?",
        "What counts as on time?",
        "What does View by change?",
        "How does the Lane risk chart work?",
        "Explain the Risky times of day chart",
        "What is the difference between operating cost and delay cost?",
        "How did we get to R 124 430?",
    ],
)
def test_questions_about_the_page_are_read_as_explanations(question: str) -> None:
    assert asks_for_explanation(question)
    hint = hint_for(question, _TODAY)
    assert hint is not None
    assert "call `explain`" in hint
    assert "Call no tool" not in hint


@pytest.mark.parametrize(
    "question",
    [
        "How many trips did we run last month?",
        "How did delays change over the past year?",
        "What did delays cost us in the last 12 weeks?",
        "Which lane costs the most to run?",
        "How many critical problems are waiting for review right now?",
        "What was operating cost in September?",
        "How late were we last week?",
    ],
)
def test_figure_questions_are_not_read_as_explanations(question: str) -> None:
    assert not asks_for_explanation(question)


def test_an_explanation_is_never_turned_into_a_period_question() -> None:
    hint = hint_for(_TOMS_FOLLOW_UP, _TODAY)

    assert hint is not None
    assert hint.startswith(EXPLANATION_HINT)
    assert "Only if it also wants figures" in hint
    assert '"For which period: the last 12 months, or 2025 (the previous calendar year)?"' in hint


def test_a_figure_question_with_last_year_is_still_asked_back() -> None:
    hint = hint_for("How many trips did we run last year?", _TODAY)

    assert hint is not None and hint.startswith("The question's period has two common meanings. Call no tool")
