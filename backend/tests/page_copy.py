"""Reads the Analytics page's own wording files, for the tests that keep the chat's copy of it in step
(test_analytics_chat_definitions.py, test_analytics_chat_page_guide.py)."""

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "dispatcher"
FLEET_COPY_DIR = FRONTEND / "components" / "analytics" / "fleet"
COPY_FILES = (FLEET_COPY_DIR / "copy.ts", FLEET_COPY_DIR / "costCopy.ts")

EXPLAINING_KEYS = (
    "scopeNote", "dataNote", "tabNote", "source", "sub", "caption", "intro", "note", "caveat", "live",
    "fadedNote", "monthNeedsYear", "partialFootnote", "basis",
)
GUIDE_KEYS = (*EXPLAINING_KEYS, "question", "origin")

_LITERAL = r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\""


def _unquote(literal: str) -> str:
    return re.sub(r"\\(.)", r"\1", literal[1:-1])


def page_lines(keys: tuple[str, ...]) -> set[str]:
    """Every plain-string value of these keys in the page's wording files, string pieces joined with + put together."""
    entry = re.compile(rf"\b({'|'.join(keys)})\s*:\s*((?:{_LITERAL})(?:\s*\+\s*(?:{_LITERAL}))*)")
    found: set[str] = set()
    for path in COPY_FILES:
        for match in entry.finditer(path.read_text(encoding="utf-8")):
            found.add("".join(_unquote(literal) for literal in re.findall(_LITERAL, match.group(2))))
    return found


def page_text() -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in COPY_FILES)
