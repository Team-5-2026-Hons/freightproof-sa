"""Unit tests for the fleet analytics calendar arithmetic (app/analytics/fleet/periods.py).

Pure logic, no DB. Calendar dates are fixed here on purpose: each test needs a known month
or weekday (a year with seven months that have a 31st, a stretch with five Mondays), which a
date derived from today could not guarantee. Same practice as test_analytics_stats.py.
"""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.analytics.fleet.constants import MAX_TREND_BUCKETS
from app.analytics.fleet.periods import (
    Grain,
    Period,
    bucket_count,
    bucket_start,
    bucket_starts,
    buckets,
    build_period,
    instant_range,
    next_bucket_start,
    occurrence_days,
    resolve_start,
    sast_date,
    today_sast,
    trailing_days,
)

_MONDAY = date(2026, 9, 7)
_SUNDAY = date(2026, 9, 13)
_MONDAY_INDEX = 0
_SUNDAY_INDEX = 6


# ── Buckets ──────────────────────────────────────────────────────────────────


def test_week_bucket_of_a_sunday_starts_on_the_monday_before() -> None:
    result = bucket_start(_SUNDAY, Grain.WEEK)

    assert result == _MONDAY


def test_week_bucket_of_a_monday_is_that_monday() -> None:
    result = bucket_start(_MONDAY, Grain.WEEK)

    assert result == _MONDAY


@pytest.mark.parametrize(
    ("grain", "expected"),
    [(Grain.MONTH, date(2026, 9, 1)), (Grain.YEAR, date(2026, 1, 1))],
)
def test_month_and_year_buckets_start_on_their_first_day(grain: Grain, expected: date) -> None:
    result = bucket_start(date(2026, 9, 15), grain)

    assert result == expected


def test_month_after_december_is_january_of_the_next_year() -> None:
    result = next_bucket_start(date(2025, 12, 1), Grain.MONTH)

    assert result == date(2026, 1, 1)


def test_bucket_starts_run_from_the_start_bucket_to_the_end_bucket() -> None:
    result = bucket_starts(date(2026, 9, 2), date(2026, 9, 15), Grain.WEEK)

    assert result == [date(2026, 8, 31), date(2026, 9, 7), date(2026, 9, 14)]


def test_bucket_starts_keep_buckets_nothing_happened_in() -> None:
    # Three months, whatever the data: an empty month must still be a bar on the chart.
    result = bucket_starts(date(2026, 6, 1), date(2026, 8, 31), Grain.MONTH)

    assert result == [date(2026, 6, 1), date(2026, 7, 1), date(2026, 8, 1)]


def test_buckets_cut_by_the_period_are_partial() -> None:
    period = Period(start=date(2026, 9, 2), end=date(2026, 9, 15), grain=Grain.WEEK)

    result = buckets(period)

    assert [bucket.is_partial for bucket in result] == [True, False, True]


def test_whole_weeks_inside_the_period_are_not_partial() -> None:
    period = Period(start=_MONDAY - timedelta(days=7), end=_SUNDAY, grain=Grain.WEEK)

    result = buckets(period)

    assert [bucket.is_partial for bucket in result] == [False, False]


def test_the_month_still_running_is_partial() -> None:
    # A period ending on the 15th (today) holds only half of this month.
    period = Period(start=date(2026, 8, 1), end=date(2026, 9, 15), grain=Grain.MONTH)

    result = buckets(period)

    assert [(bucket.start, bucket.is_partial) for bucket in result] == [
        (date(2026, 8, 1), False),
        (date(2026, 9, 1), True),
    ]


def test_buckets_of_a_period_without_grain_raises() -> None:
    period = Period(start=_MONDAY, end=_SUNDAY, grain=None)

    with pytest.raises(ValueError):
        buckets(period)


# ── South African days and instants ──────────────────────────────────────────


def test_an_event_at_2330_utc_lands_on_the_next_sast_day() -> None:
    result = sast_date(datetime(2026, 9, 14, 23, 30, tzinfo=UTC))

    assert result == date(2026, 9, 15)


def test_an_event_before_2200_utc_stays_on_the_same_sast_day() -> None:
    result = sast_date(datetime(2026, 9, 14, 21, 59, tzinfo=UTC))

    assert result == date(2026, 9, 14)


def test_today_sast_reads_the_south_african_calendar() -> None:
    result = today_sast(datetime(2026, 9, 14, 22, 30, tzinfo=UTC))

    assert result == date(2026, 9, 15)


def test_instant_range_runs_from_sast_midnight_to_the_midnight_after_the_end() -> None:
    result = instant_range(date(2026, 9, 1), date(2026, 9, 30))

    assert result.start == datetime(2026, 8, 31, 22, tzinfo=UTC)
    assert result.end == datetime(2026, 9, 30, 22, tzinfo=UTC)


def test_trailing_days_include_today() -> None:
    today = date(2026, 9, 15)

    result = trailing_days(today, 30)

    assert result == (date(2026, 8, 17), today)


# ── Per-occurrence day counts ────────────────────────────────────────────────


def test_the_31st_is_only_divided_by_months_that_have_one() -> None:
    result = occurrence_days(date(2026, 1, 1), date(2026, 12, 31))

    assert result.day_of_month[31] == 7
    assert result.day_of_month[30] == 11
    assert result.day_of_month[1] == 12
    assert result.total_days == 365


def test_month_of_year_counts_the_days_in_each_month() -> None:
    result = occurrence_days(date(2026, 1, 1), date(2026, 12, 31))

    assert result.month_of_year[1] == 31
    assert result.month_of_year[2] == 28


def test_weekday_counts_five_mondays_against_four_sundays() -> None:
    # Monday 7 Sep to Monday 5 Oct: Mondays 7, 14, 21, 28 Sep and 5 Oct; Sundays 13, 20, 27 Sep and 4 Oct.
    result = occurrence_days(_MONDAY, date(2026, 10, 5))

    assert result.weekday[_MONDAY_INDEX] == 5
    assert result.weekday[_SUNDAY_INDEX] == 4


def test_months_outside_the_period_count_zero_days() -> None:
    result = occurrence_days(date(2026, 1, 1), date(2026, 3, 31))

    assert result.month_of_year[4] == 0
    assert sum(result.month_of_year.values()) == result.total_days


# ── Period validation ────────────────────────────────────────────────────────


def test_build_period_accepts_exactly_the_maximum_number_of_buckets() -> None:
    end = _MONDAY + timedelta(weeks=MAX_TREND_BUCKETS) - timedelta(days=1)

    period = build_period(start=_MONDAY, end=end, grain=Grain.WEEK, today=end)

    assert bucket_count(period.start, period.end, Grain.WEEK) == MAX_TREND_BUCKETS


def test_build_period_rejects_one_bucket_too_many() -> None:
    end = _MONDAY + timedelta(weeks=MAX_TREND_BUCKETS)

    with pytest.raises(ValueError, match="at most"):
        build_period(start=_MONDAY, end=end, grain=Grain.WEEK, today=end)


def test_build_period_without_grain_has_no_bucket_limit() -> None:
    end = _MONDAY + timedelta(weeks=MAX_TREND_BUCKETS * 3)

    period = build_period(start=_MONDAY, end=end, grain=None, today=end)

    assert (period.start, period.end, period.grain) == (_MONDAY, end, None)


def test_build_period_rejects_an_end_after_today() -> None:
    with pytest.raises(ValueError, match="after today"):
        build_period(start=_MONDAY, end=_SUNDAY, grain=Grain.WEEK, today=_SUNDAY - timedelta(days=1))


def test_build_period_rejects_a_start_after_the_end() -> None:
    with pytest.raises(ValueError, match="after it ends"):
        build_period(start=_SUNDAY, end=_MONDAY, grain=Grain.WEEK, today=_SUNDAY)


# ── All time ─────────────────────────────────────────────────────────────────


def test_resolve_start_keeps_an_explicit_start() -> None:
    result = resolve_start(_MONDAY, end=_SUNDAY, earliest_activity=date(2025, 1, 1), today=_SUNDAY)

    assert result == _MONDAY


def test_all_time_starts_on_the_day_of_the_first_trip() -> None:
    first_trip = date(2026, 6, 20)

    result = resolve_start(None, end=_SUNDAY, earliest_activity=first_trip, today=_SUNDAY)

    assert result == first_trip


def test_all_time_without_any_trips_starts_today() -> None:
    result = resolve_start(None, end=_SUNDAY, earliest_activity=None, today=_SUNDAY)

    assert result == _SUNDAY


def test_all_time_never_starts_after_the_end() -> None:
    result = resolve_start(None, end=_MONDAY, earliest_activity=_SUNDAY, today=_SUNDAY)

    assert result == _MONDAY
