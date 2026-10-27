"""Periods the dispatcher's question names, read by code (FP-295 analysis §10.3, spec B39, B41, B42).

On `gemini-3.5-flash-lite` the model's reading of periods flipped between runs: it asked "for which
period?" about "the last 3 months", and "which year?" about "September with October". So, like the
arithmetic (totals.py), reading a named period is done here and the model is told the exact tool
inputs. The model only judges when the question names no period at all.

Two kinds of phrase:
- **Clear ones are read** into exact dates: "past year", "last N days/weeks/months/years", "this/last
  week, month, quarter", "this year", "year to date", "previous calendar year", "all time", "today",
  "yesterday", month names and quarters (with or without a year), a year on its own ("2025"), "since
  1 September" / "since August", and ranges ("from 1 Sep to 15 Oct", "between 1 and 15 October",
  "March 2026 to February 2027").
- **Phrases with two common meanings are asked back, never guessed** (Tom, 20 Oct; spec D8): "past
  month" (30 days or the calendar month?), "past week" (7 days or last Monday–Sunday?), "last year" on
  its own (12 months or the calendar year?) and "financial year" (FreightProof doesn't record a
  company's financial year). Each gets one exact question naming both readings.

Weeks start on Monday, and a "last N weeks/months/years" period ends today and includes the current
one, exactly as the page's presets do (periods.py). A named month, quarter or date without a year means
the most recent one that has started; anything is cut off at today (the page refuses a future end).
Lower-case "may" and "march" are ordinary words unless a day number is next to them ("1 may").

Pure: no database, no I/O.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta

from app.analytics.fleet.periods import DAYS_PER_WEEK, MONTHS_PER_YEAR, bucket_start
from app.core.fleet_bands import Grain
from app.orchestration.analytics_chat.periods import PeriodPreset, add_months

MONTHS_PER_QUARTER = 3
ROLLING_MONTH_DAYS = 30
ROLLING_WEEK_DAYS = 7

_MONTH_TITLES = ("January", "February", "March", "April", "May", "June", "July", "August",
                 "September", "October", "November", "December")
_MONTHS = {title.lower(): index + 1 for index, title in enumerate(_MONTH_TITLES)}
_MONTHS.update({"jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9,
                "oct": 10, "nov": 11, "dec": 12})
_WORD_MONTHS = {"may", "march", "mar"}
_MONTH_ALT = "|".join(sorted(_MONTHS, key=len, reverse=True))
_ORDINAL = r"(?:st|nd|rd|th)?"
_WEEKDAY = r"(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?"
_POINT = (
    rf"{_WEEKDAY}(?:\d{{4}}-\d{{2}}-\d{{2}}"
    rf"|\d{{1,2}}{_ORDINAL}\s+(?:of\s+)?(?:{_MONTH_ALT})(?:,?\s+\d{{4}})?"
    rf"|(?:{_MONTH_ALT})(?:\s+\d{{1,2}}{_ORDINAL})?(?:,?\s+\d{{4}})?"
    rf"|20\d{{2}})"
)
_LEFT = rf"{_POINT}|{_WEEKDAY}\d{{1,2}}{_ORDINAL}"
_RIGHT = rf"{_POINT}|today|now"
_BETWEEN = re.compile(rf"\bbetween\s+(?:the\s+)?({_LEFT})\s+and\s+(?:the\s+)?({_RIGHT})\b", re.IGNORECASE)
_FROM_TO = re.compile(
    rf"(?:\bfrom\s+(?:the\s+)?)?\b({_LEFT})(?:\s+(?:to|until|till|through)\s+(?:the\s+)?|\s*[–-]\s*)({_RIGHT})\b",
    re.IGNORECASE,
)
_SINCE = re.compile(
    rf"\bsince\s+(?:the\s+)?(?:start\s+of\s+)?({_POINT})\b|\bfrom\s+(?:the\s+)?({_POINT})\s+(?:on(?:wards?)?|to\s+date)\b",
    re.IGNORECASE,
)
_DAY = re.compile(
    rf"\b{_WEEKDAY}(?:\d{{4}}-\d{{2}}-\d{{2}}|\d{{1,2}}{_ORDINAL}\s+(?:of\s+)?(?:{_MONTH_ALT})(?:,?\s+\d{{4}})?"
    rf"|(?:{_MONTH_ALT})\s+\d{{1,2}}{_ORDINAL}(?:,?\s+\d{{4}})?)\b",
    re.IGNORECASE,
)
_MONTH = re.compile(rf"\b({_MONTH_ALT})\b(?:\s+(\d{{4}}))?", re.IGNORECASE)
_QUARTER = re.compile(r"\bQ([1-4])\b(?:\s+(\d{4}))?", re.IGNORECASE)
_YEAR = re.compile(r"(?<![\d-])\b(20\d{2})\b(?![\d-])")
_YEAR_QUALIFIER = re.compile(r"\b(this|last)\s+year\b", re.IGNORECASE)
_RELATIVE = re.compile(r"\b(?:last|past|previous)\s+(\d{1,3})\s+(day|week|month|year)s?\b", re.IGNORECASE)
_PAST_YEAR = re.compile(r"\bpast\s+(?:twelve\s+months|year)\b", re.IGNORECASE)
_THIS_YEAR = re.compile(r"\b(?:so\s+far\s+)?this\s+year\b|\byear\s+to\s+date\b|\bytd\b", re.IGNORECASE)
_CALENDAR_YEAR = re.compile(r"\b(?:last|previous|past)\s+calendar\s+year\b", re.IGNORECASE)
_THIS_MONTH = re.compile(r"\bthis\s+month\b", re.IGNORECASE)
_LAST_MONTH = re.compile(r"\b(?:last|previous|past)\s+calendar\s+month\b|\b(?:last|previous)\s+month\b", re.IGNORECASE)
_THIS_WEEK = re.compile(r"\bthis\s+week\b", re.IGNORECASE)
_LAST_WEEK = re.compile(r"\b(?:last|previous|past)\s+calendar\s+week\b|\b(?:last|previous)\s+week\b", re.IGNORECASE)
_THIS_QUARTER = re.compile(r"\bthis\s+quarter\b", re.IGNORECASE)
_LAST_QUARTER = re.compile(r"\b(?:last|previous)\s+quarter\b", re.IGNORECASE)
_ALL_TIME = re.compile(r"\ball[\s-]time\b|\bsince\s+(?:we\s+)?(?:the\s+)?start(?:ed)?\b", re.IGNORECASE)
_TODAY = re.compile(r"\btoday\b", re.IGNORECASE)
_ANCHORED = re.compile(r"\b(?:from|to|until|till|through|since|as\s+of|up\s+to|before|including)\s+$", re.IGNORECASE)
_YESTERDAY = re.compile(r"\byesterday\b", re.IGNORECASE)
_RIGHT_NOW = re.compile(r"\bright\s+now\b|\bat\s+the\s+moment\b|\bcurrently\b", re.IGNORECASE)
_PAST_MONTH = re.compile(r"\bpast\s+month\b", re.IGNORECASE)
_PAST_WEEK = re.compile(r"\bpast\s+week\b", re.IGNORECASE)
_LAST_YEAR = re.compile(r"\blast\s+year\b", re.IGNORECASE)
_FINANCIAL_YEAR = re.compile(r"\b(?:financial|fiscal)\s+year\b|\bFY\s*\d{0,4}\b", re.IGNORECASE)
_EXPLANATION = re.compile(
    r"\bhow\s+(?:is|are|was|were|do|does|did)\b[^?.]*?\b(?:calculated|calculate|worked\s+out|work\s+out|computed?|"
    r"counted|measured|derived|come\s+up\s+with|arrived?\s+at|get\s+to|got\s+to|determined|figured\s+out)\b"
    r"|\bhow\s+(?:does|do)\b[^?.]*?\bwork\b"
    r"|\bwhat\s+(?:does|do|did)\b[^?.]*?\b(?:mean|show|tell|include|comprise|consist|count|measure|represent|"
    r"stand\s+for|change|affect)\b"
    r"|\bwhat\s+counts?\s+as\b|\bdifference\s+between\b"
    r"|\bwhat\s+(?:is|are)\s+an?\s+\w"
    r"|\bwhy\s+(?:is|are|does|do|did|was|were|isn'?t|aren'?t|doesn'?t|don'?t)\b"
    r"|\bwhere\s+(?:does|do|did)\b[^?.]*?\bcome\s+from\b"
    r"|\bmade\s+up\s+of\b|\bcompris|\bconsists?\s+of\b|\bdefin(?:e|ition)\b|\bpurpose\b|\bexplain\b"
    r"|\bwhat\s+is\s+the\s+point\b|\bmeaning\s+of\b",
    re.IGNORECASE,
)
EXPLANATION_HINT = (
    "The question asks what something on the page means, shows or counts, why it exists, how it is worked out or "
    "where its data comes from: call `explain` for its topic (no period is needed) and answer fully from the guide. "
    "If it also asks for figures, get them as usual."
)

_PRESET_WEEKS = {4: PeriodPreset.LAST_4_WEEKS, 12: PeriodPreset.LAST_12_WEEKS, 26: PeriodPreset.LAST_26_WEEKS}
_PRESET_MONTHS = {3: PeriodPreset.LAST_3_MONTHS, 6: PeriodPreset.LAST_6_MONTHS, 12: PeriodPreset.LAST_12_MONTHS}
_PRESET_YEARS = {3: PeriodPreset.LAST_3_YEARS}


@dataclass(frozen=True)
class NamedPeriod:
    """One period the question names, as the tool input that means it."""

    phrase: str
    preset: PeriodPreset
    start: date | None
    end: date

    def tool_input(self) -> str:
        if self.preset is PeriodPreset.CUSTOM and self.start is not None:
            return f'preset "custom", start "{self.start.isoformat()}", end "{self.end.isoformat()}"'
        return f'preset "{self.preset.value}"'


@dataclass(frozen=True)
class _Point:
    """A date-like phrase before its year is decided: "1 Sep" has a day, "September" doesn't."""

    month: int | None
    day: int | None
    year: int | None



def _month_end(first: date) -> date:
    return add_months(first, 1) - timedelta(days=1)


def _custom(phrase: str, start: date, end: date, today: date) -> NamedPeriod | None:
    """A named period cut off at today; None if it hasn't started yet or runs backwards."""
    if start > today or start > end:
        return None
    return NamedPeriod(phrase, PeriodPreset.CUSTOM, start, min(end, today))


def _recent_year(month: int, day: int, today: date) -> int:
    """The year of the most recent such day that isn't in the future."""
    return today.year if (month, day) <= (today.month, today.day) else today.year - 1


def _point(text: str, today: date) -> _Point | None:
    """Read "1 September 2026", "Sept 1", "September", "2026-09-01", "2025", "today" or a bare "15"."""
    text = text.strip()
    if text.lower() in {"today", "now"}:
        return _Point(today.month, today.day, today.year)
    iso = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    if iso:
        return _Point(int(iso.group(2)), int(iso.group(3)), int(iso.group(1)))
    month_word = re.search(rf"\b({_MONTH_ALT})\b", text, re.IGNORECASE)
    year = re.search(r"\b(\d{4})\b", text)
    day = re.search(rf"\b(\d{{1,2}}){_ORDINAL}\b", re.sub(r"\b\d{4}\b", "", text))
    if month_word is None and day is None and year is None:
        return None
    return _Point(
        None if month_word is None else _MONTHS[month_word.group(1).lower()],
        None if day is None else int(day.group(1)),
        None if year is None else int(year.group(1)),
    )


def _first_day(point: _Point, today: date) -> date | None:
    """The first day a point covers: "2025" → 1 Jan 2025, "August" → 1 Aug, "1 Sep" → 1 Sep."""
    if point.month is None:
        return None if point.year is None or point.day is not None else date(point.year, 1, 1)
    year = point.year or _recent_year(point.month, point.day or 1, today)
    try:
        return date(year, point.month, point.day or 1)
    except ValueError:
        return None


def _span(left: _Point, right: _Point, today: date) -> tuple[date, date] | None:
    """The dates a range covers: a month or year alone means all of it; a bare left day borrows the
    right side's month ("between 1 and 15 October"); a missing year is the most recent that fits."""
    if right.month is None:
        if right.year is None or right.day is not None:
            return None
        end, right_month, right_year = date(right.year, 12, 31), 12, right.year
    else:
        right_month = right.month
        right_year = right.year or _recent_year(right_month, right.day or 1, today)
        try:
            end = date(right_year, right_month, right.day) if right.day else _month_end(date(right_year, right_month, 1))
        except ValueError:
            return None
    if left.month is None and left.day is None:
        start = _first_day(left, today)
    else:
        try:
            start = date(left.year or right_year, left.month or right_month, left.day or 1)
        except ValueError:
            return None
        if start > end and left.year is None:
            start = start.replace(year=start.year - 1)
    return None if start is None else (start, end)



def _ranges(text: str, today: date) -> tuple[list[NamedPeriod], list[tuple[int, int]]]:
    found: list[NamedPeriod] = []
    spans: list[tuple[int, int]] = []
    for pattern in (_BETWEEN, _FROM_TO):
        for match in pattern.finditer(text):
            if any(start <= match.start() < end for start, end in spans):
                continue
            left, right = _point(match.group(1), today), _point(match.group(2), today)
            dates = None if left is None or right is None else _span(left, right, today)
            period = None if dates is None else _custom(match.group(0).strip(), *dates, today)
            if period:
                found.append(period)
            spans.append(match.span())
    return found, spans


def _since(text: str, today: date) -> tuple[list[NamedPeriod], list[tuple[int, int]]]:
    """"Since 1 September", "since August", "since 2025", "from 1 Sep onwards": up to today."""
    found: list[NamedPeriod] = []
    spans: list[tuple[int, int]] = []
    for match in _SINCE.finditer(text):
        point = _point(match.group(1) or match.group(2), today)
        first = None if point is None else _first_day(point, today)
        period = None if first is None else _custom(match.group(0), first, today, today)
        if period:
            found.append(period)
        spans.append(match.span())
    return found, spans


def _single_days(text: str, today: date) -> tuple[list[NamedPeriod], list[tuple[int, int]]]:
    found: list[NamedPeriod] = []
    spans: list[tuple[int, int]] = []
    for match in _DAY.finditer(text):
        point = _point(match.group(0), today)
        first = None if point is None else _first_day(point, today)
        period = None if first is None else _custom(match.group(0), first, first, today)
        if period:
            found.append(period)
        spans.append(match.span())
    return found, spans


def _qualifier_year(text: str, today: date) -> int | None:
    match = _YEAR_QUALIFIER.search(text)
    if match is None:
        return None
    return today.year if match.group(1).lower() == "this" else today.year - 1


def _months(text: str, today: date, qualifier: int | None) -> tuple[list[NamedPeriod], list[tuple[int, int]]]:
    found: list[NamedPeriod] = []
    spans: list[tuple[int, int]] = []
    for match in _MONTH.finditer(text):
        name = match.group(1)
        if name.lower() in _WORD_MONTHS and not name[0].isupper():
            continue
        month = _MONTHS[name.lower()]
        year = int(match.group(2)) if match.group(2) else qualifier or _recent_year(month, 1, today)
        first = date(year, month, 1)
        period = _custom(match.group(0), first, _month_end(first), today)
        if period:
            found.append(period)
            spans.append(match.span())
    return found, spans


def _quarters(text: str, today: date, qualifier: int | None) -> tuple[list[NamedPeriod], list[tuple[int, int]]]:
    found: list[NamedPeriod] = []
    spans: list[tuple[int, int]] = []
    for match in _QUARTER.finditer(text):
        first_month = (int(match.group(1)) - 1) * MONTHS_PER_QUARTER + 1
        year = int(match.group(2)) if match.group(2) else qualifier or _recent_year(first_month, 1, today)
        first = date(year, first_month, 1)
        period = _custom(match.group(0), first, add_months(first, MONTHS_PER_QUARTER) - timedelta(days=1), today)
        if period:
            found.append(period)
            spans.append(match.span())
    return found, spans


def _years(text: str, today: date) -> list[NamedPeriod]:
    """A year on its own ("in 2025", or a reply of "2025") is that calendar year."""
    periods = [_custom(match.group(1), date(int(match.group(1)), 1, 1), date(int(match.group(1)), 12, 31), today)
               for match in _YEAR.finditer(text)]
    return [period for period in periods if period]


def _relative(text: str, today: date) -> list[NamedPeriod]:
    found: list[NamedPeriod] = []
    for match in _RELATIVE.finditer(text):
        count, unit = int(match.group(1)), match.group(2).lower()
        if count < 1:
            continue
        if unit == "day":
            preset, start = None, today - timedelta(days=count - 1)
        elif unit == "week":
            preset, start = _PRESET_WEEKS.get(count), bucket_start(today, Grain.WEEK) - timedelta(days=(count - 1) * DAYS_PER_WEEK)
        elif unit == "month":
            preset, start = _PRESET_MONTHS.get(count), add_months(bucket_start(today, Grain.MONTH), -(count - 1))
        else:
            preset, start = _PRESET_YEARS.get(count), add_months(bucket_start(today, Grain.YEAR), -(count - 1) * MONTHS_PER_YEAR)
        found.append(NamedPeriod(match.group(0), preset or PeriodPreset.CUSTOM, start, today))
    return found


def _quarter_start(day: date) -> date:
    return date(day.year, (day.month - 1) // MONTHS_PER_QUARTER * MONTHS_PER_QUARTER + 1, 1)


def _calendar_phrases(text: str, today: date) -> list[NamedPeriod]:
    """This/last week, month and quarter, and the previous calendar year."""
    monday = bucket_start(today, Grain.WEEK)
    first_this_month = bucket_start(today, Grain.MONTH)
    quarter = _quarter_start(today)
    candidates: list[tuple[re.Pattern[str], str, date, date]] = [
        (_THIS_WEEK, "this week", monday, today),
        (_LAST_WEEK, "last week", monday - timedelta(days=DAYS_PER_WEEK), monday - timedelta(days=1)),
        (_THIS_MONTH, "this month", first_this_month, today),
        (_LAST_MONTH, "last month", add_months(first_this_month, -1), first_this_month - timedelta(days=1)),
        (_THIS_QUARTER, "this quarter", quarter, today),
        (_LAST_QUARTER, "last quarter", add_months(quarter, -MONTHS_PER_QUARTER), quarter - timedelta(days=1)),
        (_CALENDAR_YEAR, "previous calendar year", date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)),
    ]
    return [NamedPeriod(phrase, PeriodPreset.CUSTOM, start, end) for pattern, phrase, start, end in candidates if pattern.search(text)]


def _presets(text: str, today: date, has_calendar: bool) -> list[NamedPeriod]:
    """Phrases that are the page's own presets. "This year" after a month or quarter is their year,
    not a period of its own."""
    found: list[NamedPeriod] = []
    if _PAST_YEAR.search(text) and not has_calendar:
        found.append(NamedPeriod("past year", PeriodPreset.LAST_12_MONTHS, add_months(bucket_start(today, Grain.MONTH), -(MONTHS_PER_YEAR - 1)), today))
    if _THIS_YEAR.search(text) and not has_calendar:
        found.append(NamedPeriod("this year", PeriodPreset.THIS_YEAR, bucket_start(today, Grain.YEAR), today))
    if _ALL_TIME.search(text):
        found.append(NamedPeriod("all time", PeriodPreset.ALL_TIME, None, today))
    return found


def _days(text: str, today: date) -> list[NamedPeriod]:
    """Today and yesterday. Only used when nothing else is named, so "the last 30 days" stays one
    period; and "from today" or "until today" is the end of some period, never a day of its own."""
    found: list[tuple[int, NamedPeriod]] = []
    today_at = [match.start() for match in _TODAY.finditer(text) if not _ANCHORED.search(text[: match.start()])]
    if today_at:
        found.append((today_at[0], NamedPeriod("today", PeriodPreset.CUSTOM, today, today)))
    yesterday = _YESTERDAY.search(text)
    if yesterday:
        day = today - timedelta(days=1)
        found.append((yesterday.start(), NamedPeriod("yesterday", PeriodPreset.CUSTOM, day, day)))
    return [period for _, period in sorted(found, key=lambda pair: pair[0])]


def _blank(text: str, spans: list[tuple[int, int]]) -> str:
    """The text with already-read phrases blanked out, so a range's months aren't read again as months."""
    for start, end in spans:
        text = text[:start] + " " * (end - start) + text[end:]
    return text


def named_periods(question: str, today: date) -> list[NamedPeriod]:
    """Every period the question names: ranges, "since…" and single days first (so "from 1 Sep to 15 Oct"
    isn't also read as two months), then months, quarters and years, relative and calendar phrases, presets, and
    today/yesterday only when nothing else was named. Duplicates removed."""
    ranges, range_spans = _ranges(question, today)
    text = _blank(question, range_spans)
    since, since_spans = _since(text, today)
    text = _blank(text, since_spans)
    days, day_spans = _single_days(text, today)
    text = _blank(text, day_spans)
    qualifier = _qualifier_year(text, today)
    months, month_spans = _months(text, today, qualifier)
    quarters, quarter_spans = _quarters(_blank(text, month_spans), today, qualifier)
    text = _blank(text, month_spans + quarter_spans)
    calendar = [*months, *quarters]
    periods = [*ranges, *since, *days, *calendar, *_years(text, today), *_relative(text, today),
               *_calendar_phrases(text, today), *_presets(text, today, bool(calendar))]
    if not periods:
        periods = _days(text, today)
    unique: list[NamedPeriod] = []
    for period in periods:
        if all((p.preset, p.start, p.end) != (period.preset, period.start, period.end) for p in unique):
            unique.append(period)
    return unique



def asks_about_right_now(question: str) -> bool:
    return bool(_RIGHT_NOW.search(question))


def past_month_question(today: date) -> str:
    """The exact question asked back for "past month", naming the calendar month it would mean."""
    previous = add_months(bucket_start(today, Grain.MONTH), -1)
    return (
        f"For which period: the last {ROLLING_MONTH_DAYS} days, or "
        f"{_MONTH_TITLES[previous.month - 1]} {previous.year} (the previous calendar month)?"
    )


def past_week_question(today: date) -> str:
    monday = bucket_start(today, Grain.WEEK) - timedelta(days=DAYS_PER_WEEK)
    sunday = monday + timedelta(days=DAYS_PER_WEEK - 1)
    return (
        f"For which period: the last {ROLLING_WEEK_DAYS} days, or last week "
        f"(Monday {monday.day} {_MONTH_TITLES[monday.month - 1]} to Sunday {sunday.day} {_MONTH_TITLES[sunday.month - 1]})?"
    )


def last_year_question(today: date) -> str:
    return f"For which period: the last 12 months, or {today.year - 1} (the previous calendar year)?"


FINANCIAL_YEAR_QUESTION = (
    "FreightProof doesn't record your financial year. Which months does it run over "
    "(for example March 2026 to February 2027)?"
)


def says_past_month(question: str) -> bool:
    return bool(_PAST_MONTH.search(question))


def ambiguity_question(question: str, today: date) -> str | None:
    """The exact question to ask back when the question uses a phrase with two common meanings."""
    if _PAST_MONTH.search(question):
        return past_month_question(today)
    if _PAST_WEEK.search(question):
        return past_week_question(today)
    if _FINANCIAL_YEAR.search(question):
        return FINANCIAL_YEAR_QUESTION
    has_month_or_quarter = bool(_months(question, today, None)[0] or _quarters(question, today, None)[0])
    if _LAST_YEAR.search(question) and not has_month_or_quarter and not _CALENDAR_YEAR.search(question):
        return last_year_question(today)
    return None


def asks_for_explanation(question: str) -> bool:
    return bool(_EXPLANATION.search(question))


def hint_for(question: str, today: date) -> str | None:
    """The line the model is given about this question's periods, or None when it names none."""
    ask = ambiguity_question(question, today)
    explaining = asks_for_explanation(question)
    if ask is not None and not explaining:
        return f'The question\'s period has two common meanings. Call no tool, and reply with exactly this question: "{ask}"'
    lines: list[str] = []
    if explaining:
        lines.append(EXPLANATION_HINT)
        if ask is not None:
            lines.append(f'Only if it also wants figures: their period has two common meanings, so after explaining, ask exactly "{ask}"')
    periods = named_periods(question, today)
    if periods:
        lines.append(
            "The question names these periods; the server has worked out the exact tool inputs. Use exactly "
            "these and don't ask which period: "
            + "; ".join(f'"{p.phrase}" → {p.tool_input()}' for p in periods) + "."
        )
    if asks_about_right_now(question):
        lines.append('The question asks about right now: the "right_now" tool needs no period.')
    return " ".join(lines) or None
