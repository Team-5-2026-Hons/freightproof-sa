"""What in the dispatcher's question must be asked back before it's used (assistant spec D2b, D12).

Read by code and passed to the model in the context block, like the Analytics chat's period hints
(`analytics_chat/period_hints.py`), because a model left to judge these alone guesses as often as
it asks. Two cases, each a wrong trip form if guessed:

- **A bare hour**: "at 5", "by 7 o'clock". Trucks leave at 05:00 as often as 17:00. Times written
  with minutes ("17:00", "5:30", "5h00") are read as 24-hour, as the trip form shows them; an hour
  with am/pm, or "in the morning/evening", is clear; an hour above 12 is clear.
- **Today's weekday named**: "Wednesday" asked on a Wednesday means today or next week. Not hinted
  when the question also says "today".

The hint names both exact readings, so the model can ask without working out a date (D12).

Pure: no database, no I/O.
"""

import re
from datetime import date, datetime, timedelta

from app.analytics.fleet.periods import DAYS_PER_WEEK, today_sast
from app.orchestration.assistant.when import WEEKDAYS

HOURS_ON_A_CLOCK_FACE = 12

# A preposition, then an hour on its own. The lookahead drops "5:30", "5h30", "5.30", "17", "5pm".
_BARE_HOUR = re.compile(
    r"\b(?:at|by|around|about|from|before|after|until|till)\s+(\d{1,2})(?![\d:.h])(?!\s*(?:am|pm|a\.m|p\.m)\b)",
    re.IGNORECASE,
)
_O_CLOCK = re.compile(r"^\s*o['’]?\s?clock", re.IGNORECASE)
# What may follow an hour and settle it ("at 5 in the morning", "5 o'clock pm").
_SETTLED_BY = re.compile(
    r"^\s*(?:am|pm|a\.m|p\.m|in\s+the\s+(?:morning|afternoon|evening)|at\s+night|tonight"
    r"|this\s+(?:morning|afternoon|evening))\b",
    re.IGNORECASE,
)
# "by 5 days", "at 5 depots": the number counts things, it isn't a time.
_COUNTED = re.compile(
    r"^\s*(?:days?|weeks?|months?|hours?|hrs?|minutes?|mins?|km|trips?|drivers?|trucks?|horses?|trailers?"
    r"|vehicles?|depots?|parcels?|waybills?|stops?|%|percent)\b",
    re.IGNORECASE,
)
_TODAY_WORD = re.compile(r"\btoday\b", re.IGNORECASE)
# Full names, plus the short forms dispatchers type; "sat" and "sun" are ordinary words.
_WEEKDAY_FORMS: dict[str, tuple[str, ...]] = {
    "monday": ("monday",), "tuesday": ("tuesday", "tues"), "wednesday": ("wednesday", "weds"),
    "thursday": ("thursday", "thurs"), "friday": ("friday",), "saturday": ("saturday",), "sunday": ("sunday",),
}


def _label(day: date) -> str:
    return f"{day:%a} {day.day} {day:%b}"


def _is_bare(question: str, match: re.Match[str]) -> bool:
    hour = int(match.group(1))
    if not 1 <= hour <= HOURS_ON_A_CLOCK_FACE:
        return False
    rest = question[match.end():]
    o_clock = _O_CLOCK.match(rest)
    if o_clock:
        rest = rest[o_clock.end():]
    return not _SETTLED_BY.match(rest) and (o_clock is not None or not _COUNTED.match(rest))


def _hour_hint(hour: int) -> str:
    morning = 0 if hour == HOURS_ON_A_CLOCK_FACE else hour
    afternoon = hour if hour == HOURS_ON_A_CLOCK_FACE else hour + HOURS_ON_A_CLOCK_FACE
    return (
        f"The time '{hour}' has no am or pm. Ask whether it is {morning:02d}:00 or {afternoon:02d}:00 "
        "before using it."
    )


def _weekday_hint(question: str, today: date) -> str | None:
    name = WEEKDAYS[today.weekday()]
    forms = "|".join(_WEEKDAY_FORMS[name])
    if not re.search(rf"\b(?:{forms})\b", question, re.IGNORECASE) or _TODAY_WORD.search(question):
        return None
    later = today + timedelta(days=DAYS_PER_WEEK)
    title = name.capitalize()
    return (
        f"'{title}' is today ({_label(today)}). Unless the dispatcher said which, ask whether they mean today or "
        f"next {title} ({_label(later)}); then use preset date with day {today.isoformat()} or {later.isoformat()}."
    )


_LAST_WEEKDAY = re.compile(r"\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.IGNORECASE)


def _last_weekday_hint(question: str) -> str | None:
    """"last Thursday" is the most recent past one; without this the model reaches for `weekday`, the next one."""
    match = _LAST_WEEKDAY.search(question)
    if match is None:
        return None
    day = match.group(1).lower()
    return f"'last {day.capitalize()}' means the most recent past {day.capitalize()}: use preset last_weekday with weekday {day}."


def hints_for(question: str, *, now: datetime) -> tuple[str, ...]:
    """Every hint the question needs, in a fixed order (hours as they appear, then the weekday)."""
    hints: list[str] = []
    for match in _BARE_HOUR.finditer(question):
        if _is_bare(question, match):
            hint = _hour_hint(int(match.group(1)))
            if hint not in hints:
                hints.append(hint)
    last = _last_weekday_hint(question)
    if last is not None:
        hints.append(last)
    # "last Wednesday" asked on a Wednesday is not "today or next week?": the past hint already settles it.
    weekday = _weekday_hint(question, today_sast(now)) if last is None else None
    if weekday is not None:
        hints.append(weekday)
    return tuple(hints)
