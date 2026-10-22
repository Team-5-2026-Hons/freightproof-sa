"""Day and time words, turned into exact South African times by code (assistant spec §5.3, D12).

The model never works out a date. It passes a `When` ("this weekend", "Thursday at 17:00") and this
module turns it into a window or an instant on the operator's clock (OPERATIONS_TZ, the same clock
the trip form and `trips.availability.format_when` use, spec B1). The Analytics chat taught us this:
its model got dates wrong until the arithmetic moved into code (FP-295 analysis, 20 Oct).

Windows are half-open [start, end), like every crew window in `trips.availability`. Whole days run
00:00 to the next 00:00 SAST. An instant ("now", "Thursday 17:00") is kept as one moment; callers that
need a window ask `as_window()`, which gives it one second, so "busy at this moment" can reuse the
half-open overlap rule unchanged.

Anything unclear is a `WhenError`, never a guess. Its message is written for the model to read and
act on: the commonest one is a weekday that is today ("Wednesday" asked on a Wednesday), which comes
back with both exact dates so the model can ask and then pass the chosen one as `day`.

Pure: no database, no I/O.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.analytics.fleet.periods import DAYS_PER_WEEK, OPERATIONS_TZ, start_of_day, today_sast

WhenPreset = Literal[
    "now", "today", "tomorrow", "this_weekend", "next_weekend", "this_week", "next_week",
    "next_n_days", "weekday", "date", "range",
    # The past (coverage audit item 1, B35): history questions need them, and without them the model would
    # have to work out a date itself (D12).
    "yesterday", "days_ago", "last_n_days", "this_week_so_far", "last_week", "this_month", "last_month",
    "last_weekday",
]
Weekday = Literal["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
# Index = date.weekday() (Monday 0).
WEEKDAYS: tuple[Weekday, ...] = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
SATURDAY = WEEKDAYS.index("saturday")

# A dispatcher plans weeks ahead, not years: past a quarter, a request is far more likely a slip
# (n=700 for "the next 7 days") than a real question, and it would scan every booking in the fleet.
MAX_DAYS_AHEAD = 92
MONTHS_PER_YEAR = 12
# The width that turns an instant into a window, for the half-open overlap rule (module docstring).
INSTANT_WIDTH = timedelta(seconds=1)
_TIME_FORMAT = "%H:%M"
_HH_MM = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")

# Which optional field each preset uses. Any other field must be null, so a confused call is
# corrected rather than half-read.
_USES: dict[WhenPreset, frozenset[str]] = {
    "now": frozenset(),
    "today": frozenset({"time_of_day"}),
    "tomorrow": frozenset({"time_of_day"}),
    "this_weekend": frozenset(),
    "next_weekend": frozenset(),
    "this_week": frozenset(),
    "next_week": frozenset(),
    "next_n_days": frozenset({"n"}),
    "weekday": frozenset({"weekday", "time_of_day"}),
    "date": frozenset({"day", "time_of_day"}),
    "range": frozenset({"day", "end_day"}),
    "yesterday": frozenset({"time_of_day"}),
    "days_ago": frozenset({"n", "time_of_day"}),
    "last_n_days": frozenset({"n"}),
    "this_week_so_far": frozenset(),
    "last_week": frozenset(),
    "this_month": frozenset(),
    "last_month": frozenset(),
    "last_weekday": frozenset({"weekday", "time_of_day"}),
}
_OPTIONAL_FIELDS = ("n", "weekday", "day", "end_day", "time_of_day")


class WhenError(ValueError):
    """The `When` can't be read as one exact time. The message is for the model."""


# A day or time the dispatcher named, as words. Every field is required (strict tool schema); the ones a
# preset doesn't use are null. A comment, not a docstring: Pydantic would send a docstring to the model as the
# schema's description, in every tool that takes a `when`, on every call (B26).
class When(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    # Short on purpose: this object repeats in every tool that takes a time, on every model call, so the presets
    # are explained once, in the system prompt's "Dates and times" (prompt.WHEN_GUIDE, B36).
    preset: WhenPreset = Field(description="See Dates and times.")
    n: int | None = Field(description="Days, 1-92.")
    weekday: Weekday | None
    day: date | None = Field(description="YYYY-MM-DD.")
    end_day: date | None = Field(description="YYYY-MM-DD, included.")
    time_of_day: str | None = Field(description="HH:MM, 24-hour, only if exact.")

    @field_validator("time_of_day")
    @classmethod
    def _valid_time(cls, value: str | None) -> str | None:
        # A validator, not a `pattern`: the schema then stays plain for every provider's tool format.
        # Exactly two digits each side: strptime alone would accept "7:5".
        if value is not None and not _HH_MM.fullmatch(value):
            raise ValueError("time_of_day must be 24-hour HH:MM, e.g. 17:00.")
        return value


@dataclass(frozen=True)
class ResolvedWhen:
    """An exact window [start, end), or an instant (`end` is None and `is_instant` is True). Aware
    datetimes on the operator's clock."""

    start: datetime
    end: datetime | None
    is_instant: bool

    def as_window(self) -> tuple[datetime, datetime]:
        """[start, end) for the overlap rule; an instant becomes one second wide."""
        if self.end is None:
            return self.start, self.start + INSTANT_WIDTH
        return self.start, self.end


def _day_label(day: date) -> str:
    """"Wed 21 Oct": what the model shows the dispatcher when it asks back."""
    return f"{day:%a} {day.day} {day:%b}"


def _check_fields(when: When) -> None:
    used = _USES[when.preset]
    stray = [name for name in _OPTIONAL_FIELDS if name not in used and getattr(when, name) is not None]
    if stray:
        raise WhenError(f"Preset {when.preset} doesn't use {', '.join(stray)}: set {' and '.join(stray)} to null.")


def _on_day(day: date, time_of_day: str | None) -> ResolvedWhen:
    if time_of_day is None:
        return ResolvedWhen(start=start_of_day(day), end=start_of_day(day + timedelta(days=1)), is_instant=False)
    clock = datetime.strptime(time_of_day, _TIME_FORMAT).time()
    return ResolvedWhen(start=datetime.combine(day, clock, tzinfo=OPERATIONS_TZ), end=None, is_instant=True)


def _days(first: date, days: int) -> ResolvedWhen:
    return ResolvedWhen(start=start_of_day(first), end=start_of_day(first + timedelta(days=days)), is_instant=False)


def _coming_saturday(today: date) -> date:
    """The Saturday of this weekend: today on a Saturday, yesterday on a Sunday, else the next one."""
    if today.weekday() >= SATURDAY:
        return today - timedelta(days=today.weekday() - SATURDAY)
    return today + timedelta(days=SATURDAY - today.weekday())


def _next_monday(today: date) -> date:
    return today + timedelta(days=DAYS_PER_WEEK - today.weekday())


def _weekday(when: When, today: date) -> ResolvedWhen:
    if when.weekday is None:
        raise WhenError("Preset weekday needs weekday (monday to sunday).")
    target = WEEKDAYS.index(when.weekday)
    if target == today.weekday():
        later = today + timedelta(days=DAYS_PER_WEEK)
        raise WhenError(
            f"{when.weekday.capitalize()} is today ({_day_label(today)}). Ask the dispatcher whether they mean "
            f"today or next {when.weekday.capitalize()} ({_day_label(later)}), then use preset date with day "
            f"{today.isoformat()} or {later.isoformat()}."
        )
    ahead = (target - today.weekday()) % DAYS_PER_WEEK
    return _on_day(today + timedelta(days=ahead), when.time_of_day)


def _date(when: When) -> ResolvedWhen:
    if when.day is None:
        raise WhenError("Preset date needs day (YYYY-MM-DD).")
    return _on_day(when.day, when.time_of_day)


def _range(when: When) -> ResolvedWhen:
    if when.day is None or when.end_day is None:
        raise WhenError("Preset range needs both day and end_day (YYYY-MM-DD).")
    if when.end_day < when.day:
        raise WhenError("end_day is before day: swap them, or ask the dispatcher which dates they mean.")
    days = (when.end_day - when.day).days + 1
    if days > MAX_DAYS_AHEAD:
        raise WhenError(f"That range is {days} days; the most is {MAX_DAYS_AHEAD}. Ask for a shorter one.")
    return _days(when.day, days)


def _days_count(when: When) -> int:
    if when.n is None or not 1 <= when.n <= MAX_DAYS_AHEAD:
        raise WhenError(f"Preset {when.preset} needs n from 1 to {MAX_DAYS_AHEAD}.")
    return when.n


def _next_n_days(when: When, moment: datetime) -> ResolvedWhen:
    return ResolvedWhen(start=moment, end=moment + timedelta(days=_days_count(when)), is_instant=False)


def _last_n_days(when: When, moment: datetime) -> ResolvedWhen:
    return ResolvedWhen(start=moment - timedelta(days=_days_count(when)), end=moment, is_instant=False)


def _month_start(day: date, months_back: int = 0) -> date:
    index = day.year * MONTHS_PER_YEAR + day.month - 1 - months_back
    return date(index // MONTHS_PER_YEAR, index % MONTHS_PER_YEAR + 1, 1)


def _month(today: date, months_back: int) -> ResolvedWhen:
    first = _month_start(today, months_back)
    following = _month_start(today, months_back - 1)
    return ResolvedWhen(start=start_of_day(first), end=start_of_day(following), is_instant=False)


def _last_weekday(when: When, today: date) -> ResolvedWhen:
    """The most recent past such day: a week ago when it's today ("last Wednesday" asked on a Wednesday)."""
    if when.weekday is None:
        raise WhenError("Preset last_weekday needs weekday (monday to sunday).")
    back = (today.weekday() - WEEKDAYS.index(when.weekday)) % DAYS_PER_WEEK or DAYS_PER_WEEK
    return _on_day(today - timedelta(days=back), when.time_of_day)


# Every preset's reader takes (when, the moment in SAST, today's SAST date), so resolve() is one lookup.
_Reader = Callable[[When, datetime, date], ResolvedWhen]
_READERS: dict[WhenPreset, _Reader] = {
    "now": lambda when, moment, today: ResolvedWhen(start=moment, end=None, is_instant=True),
    "today": lambda when, moment, today: _on_day(today, when.time_of_day),
    "tomorrow": lambda when, moment, today: _on_day(today + timedelta(days=1), when.time_of_day),
    "this_weekend": lambda when, moment, today: _days(_coming_saturday(today), 2),
    "next_weekend": lambda when, moment, today: _days(_coming_saturday(today) + timedelta(days=DAYS_PER_WEEK), 2),
    "this_week": lambda when, moment, today: ResolvedWhen(
        start=moment, end=start_of_day(_next_monday(today)), is_instant=False,
    ),
    "next_week": lambda when, moment, today: _days(_next_monday(today), DAYS_PER_WEEK),
    "next_n_days": lambda when, moment, today: _next_n_days(when, moment),
    "weekday": lambda when, moment, today: _weekday(when, today),
    "date": lambda when, moment, today: _date(when),
    "range": lambda when, moment, today: _range(when),
    "yesterday": lambda when, moment, today: _on_day(today - timedelta(days=1), when.time_of_day),
    "days_ago": lambda when, moment, today: _on_day(today - timedelta(days=_days_count(when)), when.time_of_day),
    "last_n_days": lambda when, moment, today: _last_n_days(when, moment),
    "this_week_so_far": lambda when, moment, today: ResolvedWhen(
        start=start_of_day(_next_monday(today) - timedelta(days=DAYS_PER_WEEK)), end=moment, is_instant=False,
    ),
    "last_week": lambda when, moment, today: _days(_next_monday(today) - timedelta(days=2 * DAYS_PER_WEEK), DAYS_PER_WEEK),
    "this_month": lambda when, moment, today: _month(today, 0),
    "last_month": lambda when, moment, today: _month(today, 1),
    "last_weekday": lambda when, moment, today: _last_weekday(when, today),
}


def resolve(when: When, *, now: datetime) -> ResolvedWhen:
    """The exact window or instant `when` names, read at `now` (aware). Raises WhenError."""
    _check_fields(when)
    return _READERS[when.preset](when, now.astimezone(OPERATIONS_TZ), today_sast(now))
