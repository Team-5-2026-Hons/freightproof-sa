"""Does every number in an answer come from what the tools returned? (FP-295 analysis A3)

After each answer the service lists the numbers in it that appear in no tool result, no tool
input (the period asked for, e.g. last_12_months), the question, or a simple restatement of
one (rounded, a fraction as a percent, minutes as hours, hours as days), and logs them, never
the text. The eval's grader uses the same check.

What it catches: a figure the model made up, or worked out itself despite the `totals` block.
What it can't catch (stated, analysis §7): a real figure used for the wrong thing, such as the
warning total (33) quoted as the problem total (34) on 20 Oct, because 33 was in the results.

Pure: no database, no I/O.
"""

import math
import re
from collections.abc import Iterable

# A number as a sentence writes it. Three forms, tried in this order:
# - thousands in spaces, the page's style: "R 305 781", "R 20 000", with optional decimals ("1 100,50");
# - thousands in commas, as Bruce's figures are written: "R20,000", "R1,100.00" (a comma then exactly three digits);
# - a plain number with an optional decimal point or decimal comma: "81", "4.5", "17,64".
# A number never starts inside a word ("Q3", "last_12_months"), except straight after a rand sign ("R20,000").
_AFTER_RAND = r"(?<=\bR)"
_SPACE_THOUSANDS = rf"(?:{_AFTER_RAND}|(?<![\w.,]))\d{{1,3}}(?:[ \u00a0\u202f]\d{{3}})+(?:[.,]\d+)?"
_COMMA_THOUSANDS = rf"(?:{_AFTER_RAND}|(?<![\w.,]))\d{{1,3}}(?:,\d{{3}})+(?:\.\d+)?(?!\d|,\d)"
_PLAIN = rf"(?:{_AFTER_RAND}|(?<![\w.]))\d+(?:[.,]\d+)?"
_NUMBER = re.compile(rf"({_SPACE_THOUSANDS})|({_COMMA_THOUSANDS})|({_PLAIN})")
_THOUSANDS_SPACE = re.compile(r"[ \u00a0\u202f]")
# Sources are machine text (JSON, preset names like last_12_months), so every digit run counts there,
# even one joined to letters or underscores, which _NUMBER deliberately skips in prose.
_SOURCE_NUMBER = re.compile(r"\d+(?:\.\d+)?")
# Years in dates ("October 2026") are never figures to check.
_YEARS = range(2000, 2101)
PERCENT = 100
MINUTES_PER_HOUR = 60
HOURS_PER_DAY = 24


def numbers_in(text: str) -> list[float]:
    values: list[float] = []
    for spaced, commas, plain in _NUMBER.findall(text):
        if commas:
            values.append(float(commas.replace(",", "")))
        else:
            values.append(float(_THOUSANDS_SPACE.sub("", spaced or plain).replace(",", ".")))
    return values


def _restatements(value: float) -> set[float]:
    """The ways a value may honestly appear in a sentence."""
    forms = {value, value * PERCENT, value / MINUTES_PER_HOUR, value / HOURS_PER_DAY}
    spoken: set[float] = set()
    for form in forms:
        # round() sends halves to the even number (305780.5 → 305780); the page rounds halves up
        # (R 305 781), so both are accepted, plus whole-number truncation ("4 d" for 4.8 days).
        spoken.update({
            round(form), round(form, 1), round(form, 2), float(math.floor(form)), float(math.floor(form + 0.5)),
        })
    return spoken


def known_numbers(sources: Iterable[str]) -> set[float]:
    """Every number a source holds, read two ways: each run of digits (machine text such as last_12_months), and
    each number as a sentence writes it, so "about R 20 000" in the page guide is 20000, not 20 and 000 (eval, 22 Oct:
    an explanation quoting Bruce's R 20 000 run was taken for an invented figure)."""
    known: set[float] = set()
    for text in sources:
        for value in [float(match) for match in _SOURCE_NUMBER.findall(text)] + numbers_in(text):
            known.update(_restatements(value))
    return known


def unmatched_numbers(answer: str, sources: Iterable[str]) -> list[str]:
    """Numbers in `answer` found in none of `sources` (tool results and the question), sorted."""
    known = known_numbers(sources)
    return sorted({
        f"{value:g}" for value in numbers_in(answer)
        if value not in _YEARS and not ({round(value), round(value, 1), round(value, 2)} & known)
    })
