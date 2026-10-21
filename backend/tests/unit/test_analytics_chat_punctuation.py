"""No em dashes in a chat answer (spec B44): what each one becomes, and what is left alone."""

import pytest

from app.orchestration.analytics_chat.punctuation import EM_DASH, EN_DASH, without_em_dashes


@pytest.mark.parametrize(
    ("answer", "shown"),
    [
        (f"There are 4 live trips {EM_DASH} 2 haven't departed yet.", "There are 4 live trips, 2 haven't departed yet."),
        (f"Delay cost was R 305 781{EM_DASH}the highest this year.", "Delay cost was R 305 781, the highest this year."),
        (f"Seal mismatch, {EM_DASH} the most common.", "Seal mismatch, the most common."),
        (f"Between 1 {EM_DASH} 15 October", f"Between 1{EN_DASH}15 October"),
        (f"Weeks 3{EM_DASH}5 were quiet.", f"Weeks 3{EN_DASH}5 were quiet."),
        (f"Two lanes:\n{EM_DASH} Cape Town to Johannesburg\n  {EM_DASH} Cape Town to Bloemfontein",
         "Two lanes:\n- Cape Town to Johannesburg\n  - Cape Town to Bloemfontein"),
    ],
)
def test_every_em_dash_becomes_the_punctuation_that_reads_the_same(answer: str, shown: str) -> None:
    assert without_em_dashes(answer) == shown
    assert EM_DASH not in without_em_dashes(answer)


def test_a_dash_at_a_line_end_does_not_join_the_next_line_onto_it() -> None:
    assert without_em_dashes(f"On time {EM_DASH}\nmostly.") == "On time, \nmostly."


def test_answers_without_em_dashes_are_unchanged() -> None:
    answer = f"On-time arrivals: 5 of 8 (62.5%), 1{EN_DASH}15 Oct.\n- Cape Town Depot (Epping) - well ahead."

    assert without_em_dashes(answer) == answer
