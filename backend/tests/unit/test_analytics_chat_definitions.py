"""The chat's copy of the page's explanations matches the page (FP-295 spec B43).

definitions.py repeats, word for word, the lines the Analytics page shows about each chart and tile.
These tests read the page's own wording files, so a change on either side fails here:
- every line the chat is given is still on the page (nothing paraphrased or out of date);
- every explanatory line on the page is given to the chat, or listed below as left out, with why.
"""

import re
from pathlib import Path

from app.orchestration.analytics_chat.definitions import ABOUT_BY_TOOL
from app.orchestration.analytics_chat.tools import TOOLS

_FLEET_COPY_DIR = Path(__file__).resolve().parents[3] / "frontend" / "dispatcher" / "components" / "analytics" / "fleet"
_COPY_FILES = (_FLEET_COPY_DIR / "copy.ts", _FLEET_COPY_DIR / "costCopy.ts")

# The copy keys whose plain-string values explain what a figure counts. Function values (counts
# filled in at run time) aren't plain strings, so they aren't read here.
_EXPLAINING_KEYS = (
    "scopeNote", "dataNote", "tabNote", "source", "sub", "caption", "intro", "note", "caveat", "live",
    "fadedNote", "monthNeedsYear", "partialFootnote", "basis",
)
_LITERAL = r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\""
_ENTRY = re.compile(rf"\b({'|'.join(_EXPLAINING_KEYS)})\s*:\s*((?:{_LITERAL})(?:\s*\+\s*(?:{_LITERAL}))*)")

# On the page but deliberately not given to the chat.
_LEFT_OUT = {
    # The general rule; every tool's description says it, and the tabs' own lines give the exceptions.
    "Trends count closed trips, grouped by the day they first departed (South African time). Tiles show right now.",
    # The incident map has no chat tool: its pins are where a named driver was (spec D5).
    "The position saved with each report: the driver’s phone for driver reports and for tracker mismatches at "
    "a stop; the simulated tracker for checks on the road. Any trip status; dispatcher notes are left out.",
    # How to read a drawing ("faint lines", "faded" bars); the chat gets is_partial and the numbers instead.
    "The two faint lines mark the average lane: trips across, problems per trip up. Top-right = busy and risky.",
    "Faded: a part week, month or year at either end of the period, or one still running.",
}


def _unquote(literal: str) -> str:
    return re.sub(r"\\(.)", r"\1", literal[1:-1])


def _page_explanations() -> set[str]:
    found: set[str] = set()
    for path in _COPY_FILES:
        for match in _ENTRY.finditer(path.read_text(encoding="utf-8")):
            found.add("".join(_unquote(literal) for literal in re.findall(_LITERAL, match.group(2))))
    return found


def _page_text() -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in _COPY_FILES)


def _chat_lines() -> set[str]:
    return {line for about in ABOUT_BY_TOOL.values() for lines in about.values() for line in lines}


def test_the_page_wording_files_are_found_and_read() -> None:
    # Guards the guard: if the files moved, the tests below would pass on nothing.
    explanations = _page_explanations()

    assert len(explanations) > 30
    assert "Created, underway or on hold" in explanations


def test_every_line_the_chat_is_given_is_on_the_page_word_for_word() -> None:
    explanations, text = _page_explanations(), _page_text()

    # A few lines are fixed sentences inside a template, so they are found in the file text instead.
    not_on_page = sorted(line for line in _chat_lines() if line not in explanations and line not in text)

    assert not_on_page == [], "These lines are no longer on the page; copy the page's new wording into definitions.py"


def test_every_explanation_on_the_page_is_given_to_the_chat_or_left_out_on_purpose() -> None:
    missing = sorted(_page_explanations() - _chat_lines() - _LEFT_OUT)

    assert missing == [], "The page explains these figures but the chat isn't told; add them to definitions.py"


def test_left_out_lines_are_still_on_the_page() -> None:
    # Otherwise the list keeps excusing lines that no longer exist.
    assert _LEFT_OUT <= _page_explanations()


def test_every_tool_has_the_pages_lines_and_the_page_level_data_note() -> None:
    assert set(ABOUT_BY_TOOL) == {tool.name for tool in TOOLS}
    for about in ABOUT_BY_TOOL.values():
        assert about["Every figure on the page"][0].startswith("Every figure comes from FreightProof's own records")


def test_the_three_lines_the_chat_used_to_contradict_are_given() -> None:
    assert ABOUT_BY_TOOL["right_now"]["Live trips"] == ("Created, underway or on hold",)
    assert "by when they were cancelled" in ABOUT_BY_TOOL["activity"]["Cancellations over time"][0]
    assert "this one counts trips of any status" in ABOUT_BY_TOOL["activity"]["Busy patterns"][0]
