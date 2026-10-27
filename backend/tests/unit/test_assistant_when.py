"""Day and time words → exact SAST windows (assistant spec §5.3, D12): the model never works out a date."""

from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.orchestration.assistant.when import INSTANT_WIDTH, MAX_DAYS_AHEAD, When, WhenError, resolve

SAST = timezone(timedelta(hours=2))
_NOW = datetime(2026, 10, 21, 14, 32, tzinfo=SAST)


def _when(preset: str, **fields: object) -> When:
    values: dict[str, object] = {"n": None, "weekday": None, "day": None, "end_day": None, "time_of_day": None}
    values.update(fields)
    return When.model_validate({"preset": preset, **values})


def _sast(day: int, hour: int = 0, minute: int = 0, month: int = 10) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=SAST)


@pytest.mark.parametrize(
    ("preset", "start", "end"),
    [
        ("today", _sast(21), _sast(22)),
        ("tomorrow", _sast(22), _sast(23)),
        ("this_weekend", _sast(24), _sast(26)),
        ("next_weekend", _sast(31), _sast(2, month=11)),
        ("next_week", _sast(26), _sast(2, month=11)),
    ],
)
def test_resolve_whole_day_presets_cover_sast_days(preset: str, start: datetime, end: datetime) -> None:
    resolved = resolve(_when(preset), now=_NOW)

    assert (resolved.start, resolved.end, resolved.is_instant) == (start, end, False)


@pytest.mark.parametrize(
    ("preset", "fields", "start", "end"),
    [
        ("yesterday", {}, _sast(20), _sast(21)),
        ("days_ago", {"n": 3}, _sast(18), _sast(19)),
        ("this_week_so_far", {}, _sast(19), _NOW),
        ("last_week", {}, _sast(12), _sast(19)),
        ("this_month", {}, _sast(1), _sast(1, month=11)),
        ("last_month", {}, _sast(1, month=9), _sast(1)),
        ("last_weekday", {"weekday": "thursday"}, _sast(15), _sast(16)),
        ("last_weekday", {"weekday": "wednesday"}, _sast(14), _sast(15)),
    ],
)
def test_resolve_past_presets(preset: str, fields: dict[str, object], start: datetime, end: datetime) -> None:
    resolved = resolve(_when(preset, **fields), now=_NOW)

    assert (resolved.start, resolved.end) == (start, end)


def test_resolve_last_n_days_runs_up_to_now() -> None:
    resolved = resolve(_when("last_n_days", n=7), now=_NOW)

    assert (resolved.start, resolved.end) == (_NOW - timedelta(days=7), _NOW)


def test_resolve_last_month_in_january_is_december() -> None:
    resolved = resolve(_when("last_month"), now=datetime(2027, 1, 10, 9, tzinfo=SAST))

    assert (resolved.start, resolved.end) == (datetime(2026, 12, 1, tzinfo=SAST), datetime(2027, 1, 1, tzinfo=SAST))


def test_resolve_yesterday_at_a_time_is_an_instant() -> None:
    resolved = resolve(_when("yesterday", time_of_day="08:30"), now=_NOW)

    assert (resolved.start, resolved.is_instant) == (_sast(20, 8, 30), True)


def test_resolve_this_week_runs_from_now_to_monday() -> None:
    resolved = resolve(_when("this_week"), now=_NOW)

    assert (resolved.start, resolved.end) == (_NOW, _sast(26))


@pytest.mark.parametrize("days", [7, 14])
def test_resolve_next_n_days_runs_from_now(days: int) -> None:
    resolved = resolve(_when("next_n_days", n=days), now=_NOW)

    assert (resolved.start, resolved.end) == (_NOW, _NOW + timedelta(days=days))


@pytest.mark.parametrize("n", [None, 0, MAX_DAYS_AHEAD + 1])
def test_resolve_next_n_days_out_of_range_errors(n: int | None) -> None:
    with pytest.raises(WhenError, match="n from 1"):
        resolve(_when("next_n_days", n=n), now=_NOW)
    with pytest.raises(WhenError, match="n from 1"):
        resolve(_when("days_ago", n=n), now=_NOW)


@pytest.mark.parametrize(("today", "saturday"), [(24, 24), (25, 24)])
def test_resolve_this_weekend_on_a_weekend_is_the_current_one(today: int, saturday: int) -> None:
    resolved = resolve(_when("this_weekend"), now=_sast(today, 9))

    assert (resolved.start, resolved.end) == (_sast(saturday), _sast(saturday + 2))


def test_resolve_now_is_an_instant_one_second_wide_as_a_window() -> None:
    resolved = resolve(_when("now"), now=_NOW)

    assert (resolved.start, resolved.end, resolved.is_instant) == (_NOW, None, True)
    assert resolved.as_window() == (_NOW, _NOW + INSTANT_WIDTH)


def test_resolve_weekday_is_the_next_such_day() -> None:
    thursday = resolve(_when("weekday", weekday="thursday"), now=_NOW)
    monday = resolve(_when("weekday", weekday="monday"), now=_NOW)

    assert (thursday.start, thursday.end) == (_sast(22), _sast(23))
    assert monday.start == _sast(26)


def test_resolve_weekday_with_time_is_a_sast_instant_stored_as_utc() -> None:
    resolved = resolve(_when("weekday", weekday="thursday", time_of_day="17:00"), now=_NOW)

    assert resolved.is_instant
    assert resolved.start == _sast(22, 17)
    assert resolved.start.astimezone(UTC) == datetime(2026, 10, 22, 15, 0, tzinfo=UTC)


def test_resolve_weekday_that_is_today_asks_with_both_dates() -> None:
    with pytest.raises(WhenError) as raised:
        resolve(_when("weekday", weekday="wednesday"), now=_NOW)

    message = str(raised.value)
    assert "2026-10-21" in message
    assert "2026-10-28" in message
    assert "Ask" in message


def test_resolve_date_with_and_without_time() -> None:
    day = resolve(_when("date", day=date(2026, 10, 23)), now=_NOW)
    instant = resolve(_when("date", day=date(2026, 10, 23), time_of_day="06:00"), now=_NOW)

    assert (day.start, day.end) == (_sast(23), _sast(24))
    assert (instant.start, instant.is_instant) == (_sast(23, 6), True)


def test_resolve_range_includes_both_days() -> None:
    resolved = resolve(_when("range", day=date(2026, 10, 22), end_day=date(2026, 10, 24)), now=_NOW)

    assert (resolved.start, resolved.end) == (_sast(22), _sast(25))


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"day": date(2026, 10, 24), "end_day": date(2026, 10, 22)}, "before day"),
        ({"day": date(2026, 10, 1), "end_day": date(2027, 1, 31)}, "most is"),
        ({"day": date(2026, 10, 22)}, "both day and end_day"),
    ],
)
def test_resolve_bad_range_errors(fields: dict[str, object], message: str) -> None:
    with pytest.raises(WhenError, match=message):
        resolve(_when("range", **fields), now=_NOW)


@pytest.mark.parametrize(
    ("preset", "fields", "message"),
    [
        ("date", {}, "needs day"),
        ("weekday", {}, "needs weekday"),
        ("today", {"n": 3}, "doesn't use n"),
        ("this_weekend", {"time_of_day": "17:00"}, "doesn't use time_of_day"),
        ("now", {"weekday": "friday"}, "doesn't use weekday"),
    ],
)
def test_resolve_missing_or_stray_fields_error(preset: str, fields: dict[str, object], message: str) -> None:
    with pytest.raises(WhenError, match=message):
        resolve(_when(preset, **fields), now=_NOW)


@pytest.mark.parametrize("value", ["25:00", "5pm", "17h00", "7:5"])
def test_when_rejects_times_that_are_not_24_hour(value: str) -> None:
    with pytest.raises(ValidationError, match="24-hour"):
        _when("today", time_of_day=value)


def test_resolve_late_utc_evening_is_already_tomorrow_in_sast() -> None:
    late = datetime(2026, 10, 21, 23, 30, tzinfo=UTC)

    resolved = resolve(_when("today"), now=late)

    assert resolved.start == _sast(22)


def test_when_schema_is_strict() -> None:
    schema = When.model_json_schema()

    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"preset", "n", "weekday", "day", "end_day", "time_of_day"}
