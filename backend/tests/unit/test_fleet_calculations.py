"""Unit tests for the fleet analytics bands and derived measures.

Pure logic, no DB: periods.py's banding, driving-time splitting and queue reconstruction,
and tiles.count_expiry_bands. Every band is tested at its edges and just either side, since
an off-by-one there silently moves trips between bars.
"""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.analytics.fleet.constants import DayBlock
from app.analytics.fleet.periods import (
    OPERATIONS_TZ,
    ExpiryBand,
    LatenessBand,
    PlanBand,
    ReviewAgeBand,
    day_block,
    driving_minutes_by_block,
    expiry_band,
    lateness_band,
    occurrence_days,
    plan_band,
    review_age_band,
    waiting_at,
)
from app.analytics.fleet.patterns import build_pattern_set
from app.analytics.fleet.tiles import count_expiry_bands
from app.schemas.fleet_analytics import ExpiryBands

_TODAY = date(2026, 9, 15)
_NOON = datetime(2026, 9, 14, 12, tzinfo=OPERATIONS_TZ)
_HOUR = timedelta(hours=1)
_MINUTES_IN_SIX_HOURS = 360


def _sast(day: int, hour: int) -> datetime:
    return datetime(2026, 9, day, hour, tzinfo=OPERATIONS_TZ)


# ── Lateness bands (chart 2.2) ───────────────────────────────────────────────


@pytest.mark.parametrize(
    ("delta_minutes", "expected"),
    [
        (-16, LatenessBand.EARLY),
        (-15, LatenessBand.ON_TIME),
        (0, LatenessBand.ON_TIME),
        (0.5, LatenessBand.LATE_1_15),
        (15, LatenessBand.LATE_1_15),
        (15.5, LatenessBand.LATE_15_60),
        (60, LatenessBand.LATE_15_60),
        (60.5, LatenessBand.LATE_60_180),
        (180, LatenessBand.LATE_60_180),
        (180.5, LatenessBand.LATE_OVER_180),
    ],
)
def test_lateness_band_edges(delta_minutes: float, expected: LatenessBand) -> None:
    result = lateness_band(delta_minutes)

    assert result is expected


# ── Driving time by block (chart 3.5) ────────────────────────────────────────


def test_driving_minutes_split_across_two_blocks() -> None:
    result = driving_minutes_by_block(_sast(14, 17), _sast(14, 20))

    assert result == {
        DayBlock.NIGHT: 0, DayBlock.MORNING: 0, DayBlock.AFTERNOON: 60, DayBlock.EVENING: 120,
    }


def test_driving_minutes_split_across_midnight() -> None:
    result = driving_minutes_by_block(_sast(14, 23), _sast(15, 2))

    assert result[DayBlock.EVENING] == 60
    assert result[DayBlock.NIGHT] == 120


def test_driving_minutes_given_in_utc_are_split_in_sast() -> None:
    # 04:00-05:00 UTC is 06:00-07:00 SAST: morning, not night.
    result = driving_minutes_by_block(
        datetime(2026, 9, 14, 4, tzinfo=UTC), datetime(2026, 9, 14, 5, tzinfo=UTC),
    )

    assert result[DayBlock.MORNING] == 60
    assert result[DayBlock.NIGHT] == 0


def test_driving_minutes_over_a_whole_day_fill_every_block_equally() -> None:
    result = driving_minutes_by_block(_sast(14, 6), _sast(15, 6))

    assert set(result.values()) == {_MINUTES_IN_SIX_HOURS}


def test_a_leg_with_no_length_counts_no_driving() -> None:
    result = driving_minutes_by_block(_sast(14, 9), _sast(14, 9))

    assert sum(result.values()) == 0


def test_a_leg_that_ends_before_it_starts_counts_no_driving() -> None:
    result = driving_minutes_by_block(_sast(14, 10), _sast(14, 9))

    assert sum(result.values()) == 0


@pytest.mark.parametrize(
    ("instant", "expected"),
    [
        (datetime(2026, 9, 14, 23, 30, tzinfo=UTC), DayBlock.NIGHT),  # 01:30 SAST
        (datetime(2026, 9, 14, 4, 0, tzinfo=UTC), DayBlock.MORNING),  # 06:00 SAST
        (datetime(2026, 9, 14, 9, 59, tzinfo=UTC), DayBlock.MORNING),  # 11:59 SAST
        (datetime(2026, 9, 14, 16, 0, tzinfo=UTC), DayBlock.EVENING),  # 18:00 SAST
    ],
)
def test_day_block_reads_the_sast_clock(instant: datetime, expected: DayBlock) -> None:
    result = day_block(instant)

    assert result is expected


# ── Review queue reconstruction (chart 4.2) ──────────────────────────────────


def test_an_item_raised_before_and_reviewed_after_was_waiting() -> None:
    result = waiting_at([(_NOON - _HOUR, _NOON + _HOUR)], _NOON)

    assert result == 1


def test_an_item_reviewed_before_the_instant_was_not_waiting() -> None:
    result = waiting_at([(_NOON - 2 * _HOUR, _NOON - _HOUR)], _NOON)

    assert result == 0


def test_an_item_raised_after_the_instant_was_not_waiting() -> None:
    result = waiting_at([(_NOON + _HOUR, None)], _NOON)

    assert result == 0


def test_an_item_never_reviewed_is_still_waiting() -> None:
    result = waiting_at([(_NOON - _HOUR, None)], _NOON)

    assert result == 1


def test_an_item_reviewed_exactly_at_the_instant_was_still_waiting() -> None:
    result = waiting_at([(_NOON - _HOUR, _NOON)], _NOON)

    assert result == 1


def test_an_item_raised_exactly_at_the_instant_was_not_yet_waiting() -> None:
    result = waiting_at([(_NOON, None)], _NOON)

    assert result == 0


# ── Expiry bands (Licences & discs tile) ─────────────────────────────────────


@pytest.mark.parametrize(
    ("days_left", "expected"),
    [
        (-1, ExpiryBand.EXPIRED),
        (0, ExpiryBand.WITHIN_30_DAYS),
        (30, ExpiryBand.WITHIN_30_DAYS),
        (31, ExpiryBand.WITHIN_90_DAYS),
        (90, ExpiryBand.WITHIN_90_DAYS),
        (91, ExpiryBand.WITHIN_180_DAYS),
        (180, ExpiryBand.WITHIN_180_DAYS),
        (181, None),
    ],
)
def test_expiry_band_edges(days_left: int, expected: ExpiryBand | None) -> None:
    result = expiry_band(_TODAY + timedelta(days=days_left), _TODAY)

    assert result is expected


def test_no_expiry_date_on_file_is_its_own_band() -> None:
    result = expiry_band(None, _TODAY)

    assert result is ExpiryBand.NO_DATE


def test_count_expiry_bands_counts_each_date_once_and_skips_distant_ones() -> None:
    expiries = [
        _TODAY - timedelta(days=1),
        _TODAY + timedelta(days=10),
        _TODAY + timedelta(days=10),
        _TODAY + timedelta(days=365),
        None,
    ]

    result = count_expiry_bands(expiries, _TODAY)

    assert result == ExpiryBands(
        expired=1, within_30_days=2, within_90_days=0, within_180_days=0, no_date=1,
    )


# ── Review age bands (chart 4.1) ─────────────────────────────────────────────


@pytest.mark.parametrize(
    ("age", "expected"),
    [
        (timedelta(minutes=59), ReviewAgeBand.UNDER_1H),
        (timedelta(hours=1), ReviewAgeBand.HOUR_TO_DAY),
        (timedelta(hours=23, minutes=59), ReviewAgeBand.HOUR_TO_DAY),
        (timedelta(hours=24), ReviewAgeBand.DAY_TO_3_DAYS),
        (timedelta(hours=71, minutes=59), ReviewAgeBand.DAY_TO_3_DAYS),
        (timedelta(hours=72), ReviewAgeBand.OVER_3_DAYS),
    ],
)
def test_review_age_band_edges(age: timedelta, expected: ReviewAgeBand) -> None:
    result = review_age_band(age)

    assert result is expected


# ── Busy patterns (chart 1.3) ────────────────────────────────────────────────


def test_pattern_set_counts_in_sast_and_divides_by_occurrences() -> None:
    # Monday 7 Sep to Sunday 20 Sep: 14 days, every weekday twice.
    days = occurrence_days(date(2026, 9, 7), date(2026, 9, 20))
    instants = [
        datetime(2026, 9, 7, 5, 10, tzinfo=UTC),  # 07:10 SAST, Monday 7th
        datetime(2026, 9, 14, 5, 40, tzinfo=UTC),  # 07:40 SAST, Monday 14th
        datetime(2026, 9, 18, 23, 30, tzinfo=UTC),  # 01:30 SAST, Saturday 19th
    ]

    result = build_pattern_set(instants, days)

    assert (result.hour_of_day[7].event_count, result.hour_of_day[7].day_count) == (2, 14)
    assert result.hour_of_day[7].average_per_day == pytest.approx(2 / 14)
    assert result.hour_of_day[1].event_count == 1
    assert result.weekday[0].average_per_day == pytest.approx(1.0)
    assert result.weekday[5].event_count == 1
    assert {bar.key: bar.event_count for bar in result.day_of_month}[19] == 1


def test_pattern_set_is_complete_and_in_calendar_order() -> None:
    days = occurrence_days(date(2026, 9, 7), date(2026, 9, 20))

    result = build_pattern_set([], days)

    assert [bar.key for bar in result.hour_of_day] == list(range(24))
    assert [bar.key for bar in result.weekday] == list(range(7))
    assert [bar.key for bar in result.day_of_month] == list(range(1, 32))
    assert [bar.key for bar in result.month_of_year] == list(range(1, 13))


def test_a_date_the_period_never_reaches_has_no_average() -> None:
    days = occurrence_days(date(2026, 9, 7), date(2026, 9, 20))

    result = build_pattern_set([], days)

    by_date = {bar.key: bar for bar in result.day_of_month}
    assert by_date[31].day_count == 0
    assert by_date[31].average_per_day is None
    assert by_date[10].average_per_day == 0.0


# ── Plan spread bands (chart 2.5, D23) ───────────────────────────────────────


@pytest.mark.parametrize(
    ("delta_minutes", "expected"),
    [
        (0, PlanBand.ON_PLAN),
        (15, PlanBand.OVER_0_15),
        (16, PlanBand.OVER_15_60),
        (60, PlanBand.OVER_15_60),
        (61, PlanBand.OVER_60_180),
        (180, PlanBand.OVER_60_180),
        (181, PlanBand.OVER_OVER_180),
        (-15, PlanBand.EARLY_0_15),
        (-16, PlanBand.EARLY_15_60),
        (-60, PlanBand.EARLY_15_60),
        (-61, PlanBand.EARLY_60_180),
        (-180, PlanBand.EARLY_60_180),
        (-181, PlanBand.EARLY_OVER_180),
    ],
)
def test_plan_band_edges_on_both_sides(delta_minutes: float, expected: PlanBand) -> None:
    result = plan_band(delta_minutes)

    assert result is expected


def test_a_trip_a_moment_off_plan_is_not_on_plan() -> None:
    assert plan_band(0.5) is PlanBand.OVER_0_15
    assert plan_band(-0.5) is PlanBand.EARLY_0_15
