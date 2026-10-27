"""The live number check (analysis A3): every number in an answer should come from what the tools
returned, allowing for honest restatements. Also pins what it can't catch."""

from app.orchestration.analytics_chat.number_check import numbers_in, unmatched_numbers

_PROBLEMS = '{"totals": {"problems": 34, "warning": 33, "critical": 1, "on_time_arrival_rate": 0.5}}'


def test_numbers_in_reads_rand_thousands_decimal_commas_and_percents() -> None:
    assert numbers_in("R 305 781, 4,5 h and 81%") == [305781.0, 4.5, 81.0]


def test_figures_from_the_tools_pass() -> None:
    assert unmatched_numbers("There were 34 problems: 33 warnings and 1 critical.", [_PROBLEMS]) == []


def test_honest_restatements_pass() -> None:
    sources = ['{"rate": 0.5, "median_early_minutes": 599.26, "cost": 305780.5, "whole_hours": 114}']

    answer = "50% on time, about 10 hours early (599 minutes), R 305 781, waiting 4 days."

    assert unmatched_numbers(answer, sources) == []


def test_years_and_question_numbers_pass() -> None:
    assert unmatched_numbers("In the last 12 weeks of 2026 there were 34 problems.", [_PROBLEMS, "the last 12 weeks?"]) == []


def test_an_invented_figure_is_caught() -> None:
    assert unmatched_numbers("There were 41 problems.", [_PROBLEMS]) == ["41"]


def test_cannot_catch_a_real_figure_used_for_the_wrong_thing() -> None:
    assert unmatched_numbers("There were 33 problems.", [_PROBLEMS]) == []



def test_numbers_in_reads_every_way_a_sentence_writes_an_amount() -> None:
    text = "R 305 781, 81%, 4.5, 17,64, R20,000, R1,100.00, 1,5, R155 per hour"

    assert numbers_in(text) == [305781.0, 81.0, 4.5, 17.64, 20000.0, 1100.0, 1.5, 155.0]


def test_numbers_inside_words_are_still_not_figures() -> None:
    assert numbers_in("Q3 and last_12_months") == []


def test_an_amount_written_with_spaced_thousands_in_a_source_is_known() -> None:
    guide = "calibrated so Bruce's Johannesburg to Durban run, about R 20 000, comes out right"

    assert unmatched_numbers("It was calibrated on Bruce's R 20 000 run.", [guide]) == []
    assert unmatched_numbers("Bruce's run cost R20,000.", [guide]) == []
    assert unmatched_numbers("A run costs R 21 000.", [guide]) == ["21000"]


def test_an_amount_written_with_comma_thousands_in_a_source_is_known() -> None:
    origin = "R30,000 a month ÷ 195 working hours (Bruce, 28 Jul 2026)."

    assert unmatched_numbers("A driver earns about R 30 000 a month.", [origin]) == []
