"""The Analytics page's Period presets, turned into dates the way the page does (FP-295).

The chat's tools take a preset name ("last_12_months") instead of dates, so "the past year"
means exactly what the page's "Last 12 months" means and the model never does date
arithmetic. resolve_preset is a line-for-line copy of resolvePeriod in
frontend/dispatcher/lib/format/period.ts: if one changes, the other must, and
tests/unit/test_analytics_chat_periods.py pins the same cases.

Pure: no database, no I/O.
"""

import enum
from datetime import date, timedelta

from app.analytics.fleet.periods import DAYS_PER_WEEK, MONTHS_PER_YEAR, bucket_start
from app.core.fleet_bands import Grain


class PeriodPreset(str, enum.Enum):
    """The page's Period choices (period.ts PresetId), plus custom dates."""

    LAST_4_WEEKS = "last_4_weeks"
    LAST_12_WEEKS = "last_12_weeks"
    LAST_26_WEEKS = "last_26_weeks"
    LAST_3_MONTHS = "last_3_months"
    LAST_6_MONTHS = "last_6_months"
    LAST_12_MONTHS = "last_12_months"
    THIS_YEAR = "this_year"
    LAST_3_YEARS = "last_3_years"
    ALL_TIME = "all_time"
    CUSTOM = "custom"


_PRESET_WEEKS = {
    PeriodPreset.LAST_4_WEEKS: 4,
    PeriodPreset.LAST_12_WEEKS: 12,
    PeriodPreset.LAST_26_WEEKS: 26,
}
_PRESET_MONTHS = {
    PeriodPreset.LAST_3_MONTHS: 3,
    PeriodPreset.LAST_6_MONTHS: 6,
    PeriodPreset.LAST_12_MONTHS: 12,
}
_PRESET_YEARS = {PeriodPreset.LAST_3_YEARS: 3}


def add_months(day: date, months: int) -> date:
    """`day` moved by whole months. Only ever called on the 1st, so no month-end clamping."""
    index = day.year * MONTHS_PER_YEAR + (day.month - 1) + months
    return day.replace(year=index // MONTHS_PER_YEAR, month=index % MONTHS_PER_YEAR + 1)


def resolve_preset(
    preset: PeriodPreset, *, today: date, start: date | None = None, end: date | None = None,
) -> tuple[date | None, date]:
    """(first day, last day) for a preset, as period.ts resolvePeriod computes it. A first
    day of None means All time: the caller resolves it to the organisation's first trip.

    `start` and `end` are read only for CUSTOM, which needs both (ValueError otherwise).
    """
    if preset in _PRESET_WEEKS:
        weeks_back = _PRESET_WEEKS[preset] - 1
        return bucket_start(today, Grain.WEEK) - timedelta(days=weeks_back * DAYS_PER_WEEK), today
    if preset in _PRESET_MONTHS:
        return add_months(bucket_start(today, Grain.MONTH), -(_PRESET_MONTHS[preset] - 1)), today
    if preset in _PRESET_YEARS:
        years_back = _PRESET_YEARS[preset] - 1
        return add_months(bucket_start(today, Grain.YEAR), -years_back * MONTHS_PER_YEAR), today
    if preset is PeriodPreset.THIS_YEAR:
        return bucket_start(today, Grain.YEAR), today
    if preset is PeriodPreset.ALL_TIME:
        return None, today
    if start is None or end is None:
        raise ValueError("A custom period needs both a start date and an end date.")
    return start, end
