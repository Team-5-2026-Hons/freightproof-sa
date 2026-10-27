"""What must be asked back before use (assistant spec D2b, D12): bare hours and today's weekday."""

from datetime import datetime, timedelta, timezone

import pytest

from app.orchestration.assistant.hints import hints_for

SAST = timezone(timedelta(hours=2))
_NOW = datetime(2026, 10, 21, 14, 32, tzinfo=SAST)


@pytest.mark.parametrize(
    "question",
    [
        "Create a trip with Tim on Thursday at 5 from Joburg to Cape Town",
        "Can it leave by 5 o'clock?",
        "Book CA 123-456 around 5, please",
    ],
)
def test_hints_for_bare_hour_asks_am_or_pm(question: str) -> None:
    hints = hints_for(question, now=_NOW)

    assert hints == ("The time '5' has no am or pm. Ask whether it is 05:00 or 17:00 before using it.",)


@pytest.mark.parametrize(
    "question",
    [
        "Thursday at 5pm",
        "Thursday at 5 pm",
        "Thursday at 5 a.m.",
        "Thursday at 17:00",
        "Thursday at 5:30",
        "Thursday 5h00",
        "Thursday at 05:00",
        "Thursday at 17",
        "Thursday at 5 in the morning",
        "Thursday at 5 o'clock pm",
        "How many trips finish in 5 days?",
        "Show 5 trips",
        "Anything late by 5 hours?",
        "Trucks at 5 depots",
    ],
)
def test_hints_for_clear_times_and_counts_gives_no_hour_hint(question: str) -> None:
    assert hints_for(question, now=_NOW) == ()


def test_hints_for_twelve_offers_midnight_or_noon() -> None:
    hints = hints_for("Thursday at 12", now=_NOW)

    assert hints == ("The time '12' has no am or pm. Ask whether it is 00:00 or 12:00 before using it.",)


def test_hints_for_repeated_hour_hints_once() -> None:
    hints = hints_for("Leave at 5 on Thursday, at 5 sharp", now=_NOW)

    assert len(hints) == 1


@pytest.mark.parametrize("question", ["Is Tim free on Wednesday?", "Book it for weds"])
def test_hints_for_todays_weekday_asks_today_or_next_week(question: str) -> None:
    [hint] = hints_for(question, now=_NOW)

    assert "'Wednesday' is today (Wed 21 Oct)" in hint
    assert "2026-10-21" in hint
    assert "2026-10-28" in hint


@pytest.mark.parametrize("question", ["Is Tim free today, Wednesday?", "Is Tim free on Thursday?"])
def test_hints_for_weekday_that_is_not_ambiguous_gives_no_hint(question: str) -> None:
    assert hints_for(question, now=_NOW) == ()


def test_hints_for_both_hints_come_hours_first() -> None:
    hints = hints_for("Wednesday at 7", now=_NOW)

    assert len(hints) == 2
    assert hints[0].startswith("The time '7'")
    assert hints[1].startswith("'Wednesday' is today")


def test_hints_for_last_weekday_points_to_the_past_preset() -> None:
    hints = hints_for("What did Sipho do last Wednesday?", now=_NOW)

    assert hints == ("'last Wednesday' means the most recent past Wednesday: use preset last_weekday with weekday wednesday.",)
