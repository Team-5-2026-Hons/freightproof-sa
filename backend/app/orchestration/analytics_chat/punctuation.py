"""No em dashes in a chat answer (Tom, 21 Oct; spec B44).

The instructions ask the model not to use them, but like the arithmetic (totals.py) and the periods
(period_hints.py) the rule is kept by code, not only asked for: every answer passes through here
before it is shown. An em dash between two numbers becomes the range dash the page uses ("1–15");
one starting a line becomes a list dash; any other becomes a comma, which reads the same in a
sentence ("4 live trips — 2 not yet departed" → "4 live trips, 2 not yet departed").

Pure: no database, no I/O.
"""

import re

EM_DASH = "—"
EN_DASH = "–"

# Spaces and tabs only, never a line break, so a dash at a line's end doesn't join two lines.
_RANGE = re.compile(rf"(\d)[ \t]*{EM_DASH}[ \t]*(\d)")
_LINE_START = re.compile(rf"^([ \t]*){EM_DASH}[ \t]*", re.MULTILINE)
# A comma already before the dash ("x, — y") isn't doubled.
_ELSEWHERE = re.compile(rf",?[ \t]*{EM_DASH}[ \t]*")


def without_em_dashes(text: str) -> str:
    text = _RANGE.sub(rf"\1{EN_DASH}\2", text)
    text = _LINE_START.sub(r"\1- ", text)
    return _ELSEWHERE.sub(", ", text)
