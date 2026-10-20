"""resolve_preset must turn the page's Period presets into exactly the dates the page uses.

The expected dates are worked out by hand from resolvePeriod in
frontend/dispatcher/lib/format/period.ts (weeks start Monday; a preset ends today and
includes the current bucket). If one side changes, these cases catch the drift.
"""

from datetime import date

import pytest

from app.orchestration.analytics_chat.periods import PeriodPreset, add_months, resolve_preset

# Monday 19 Oct 2026, the day the spec was written.
_MONDAY = date(2026, 10, 19)
# Sunday 25 Oct 2026: its week still starts on Monday the 19th.
_SUNDAY = date(2026, 10, 25)
# Friday 1 Jan 2027: the year and month have just started, the week began in 2026.
_NEW_YEAR = date(2027, 1, 1)


@pytest.mark.parametrize(
    ("preset", "expected_start"),
    [
        (PeriodPreset.LAST_4_WEEKS, date(2026, 9, 28)),
        (PeriodPreset.LAST_12_WEEKS, date(2026, 8, 3)),
        (PeriodPreset.LAST_26_WEEKS, date(2026, 4, 27)),
        (PeriodPreset.LAST_3_MONTHS, date(2026, 8, 1)),
        (PeriodPreset.LAST_6_MONTHS, date(2026, 5, 1)),
        (PeriodPreset.LAST_12_MONTHS, date(2025, 11, 1)),
        (PeriodPreset.THIS_YEAR, date(2026, 1, 1)),
        (PeriodPreset.LAST_3_YEARS, date(2024, 1, 1)),
        (PeriodPreset.ALL_TIME, None),
    ],
)
def test_resolve_preset_on_a_monday_matches_the_page(preset: PeriodPreset, expected_start: date | None) -> None:
    start, end = resolve_preset(preset, today=_MONDAY)

    assert start == expected_start
    assert end == _MONDAY


def test_resolve_preset_on_a_sunday_starts_from_that_weeks_monday() -> None:
    start, end = resolve_preset(PeriodPreset.LAST_4_WEEKS, today=_SUNDAY)

    assert start == date(2026, 9, 28)
    assert end == _SUNDAY


@pytest.mark.parametrize(
    ("preset", "expected_start"),
    [
        (PeriodPreset.LAST_12_WEEKS, date(2026, 10, 12)),
        (PeriodPreset.LAST_12_MONTHS, date(2026, 2, 1)),
        (PeriodPreset.THIS_YEAR, date(2027, 1, 1)),
        (PeriodPreset.LAST_3_YEARS, date(2025, 1, 1)),
    ],
)
def test_resolve_preset_on_new_years_day_crosses_the_year_correctly(
    preset: PeriodPreset, expected_start: date,
) -> None:
    start, _ = resolve_preset(preset, today=_NEW_YEAR)

    assert start == expected_start


def test_resolve_preset_custom_passes_the_dates_through() -> None:
    start, end = resolve_preset(
        PeriodPreset.CUSTOM, today=_MONDAY, start=date(2026, 9, 1), end=date(2026, 9, 30),
    )

    assert (start, end) == (date(2026, 9, 1), date(2026, 9, 30))


@pytest.mark.parametrize(
    ("start", "end"), [(None, date(2026, 9, 30)), (date(2026, 9, 1), None), (None, None)],
)
def test_resolve_preset_custom_missing_a_date_raises(start: date | None, end: date | None) -> None:
    with pytest.raises(ValueError, match="needs both"):
        resolve_preset(PeriodPreset.CUSTOM, today=_MONDAY, start=start, end=end)


def test_resolve_preset_ignores_custom_dates_for_a_named_preset() -> None:
    start, end = resolve_preset(
        PeriodPreset.THIS_YEAR, today=_MONDAY, start=date(2020, 1, 1), end=date(2020, 12, 31),
    )

    assert (start, end) == (date(2026, 1, 1), _MONDAY)


@pytest.mark.parametrize(
    ("day", "months", "expected"),
    [
        (date(2026, 10, 1), -11, date(2025, 11, 1)),
        (date(2026, 1, 1), -1, date(2025, 12, 1)),
        (date(2026, 12, 1), 1, date(2027, 1, 1)),
        (date(2026, 1, 1), -24, date(2024, 1, 1)),
    ],
)
def test_add_months_crosses_year_boundaries(day: date, months: int, expected: date) -> None:
    assert add_months(day, months) == expected
