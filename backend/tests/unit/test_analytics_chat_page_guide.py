"""The page guide (FP-295 spec B45; coverage audit 2026-10-22): it covers the whole page, quotes it word for word,
takes its numbers from the code, and carries no em dashes.

The guide is what the chat explains the page from. These tests read the page's own wording files, so a new chart, a
reworded note or a changed threshold fails here until the guide is updated too.
"""

import json
import re

import pytest

from app.analytics.cost_model import DEFAULT_COST_RATES
from app.analytics.fleet.constants import (
    EARLY_THRESHOLD_MINUTES,
    EXPIRY_BAND_EDGES_DAYS,
    MAX_TREND_BUCKETS,
    THEFT_SIGNAL_TYPES,
    TILE_WINDOW_DAYS,
)
from app.orchestration.analytics_chat.page_guide import GUIDE, LOW_SAMPLE_TRIPS, SIGNOFF_LIVE, TOPICS, guide_for
from tests.page_copy import FRONTEND, GUIDE_KEYS, page_lines, page_text

# Chart and tile titles on the page ("title:" and "label:" values). Sub-chart titles of the busy patterns
# (By hour of day…) and table/legend labels aren't elements of their own.
_TITLE = re.compile(r"\b(?:title|label):\s*'([^']+)'")
_NOT_ELEMENTS = re.compile(
    r"^(By |Drivers$|Discs$|Record$|Diesel price|Consumption|Fuel per km|Other running|Driver$|Fixed per trip|Delay$|"
    r"Road factor|Show reports from)"
)


def _guide_lines() -> set[str]:
    return {line for entries in GUIDE.values() for entry in entries for line in entry.page_says}


def _guide_titles() -> set[str]:
    return {entry.title for entries in GUIDE.values() for entry in entries}


def _all_text() -> str:
    return json.dumps({topic: guide_for(topic) for topic in TOPICS}, ensure_ascii=False)


def test_every_line_the_guide_quotes_is_on_the_page_word_for_word() -> None:
    lines, text = page_lines(GUIDE_KEYS), page_text()

    not_on_page = sorted(line for line in _guide_lines() if line not in lines and line not in text)

    assert not_on_page == [], "The page no longer says these; copy its new wording into page_guide.py"


def test_every_explanation_question_and_rate_origin_on_the_page_is_in_the_guide() -> None:
    # 22 Oct: "how do we come up with operating cost?" had nothing to answer from. Now nothing the page explains,
    # no chart's question and no rate's origin is missing.
    missing = sorted(page_lines(GUIDE_KEYS) - _guide_lines())

    assert missing == [], "The page explains these but the guide doesn't carry them; add them to page_guide.py"


def test_every_chart_and_tile_on_the_page_has_an_entry() -> None:
    page_titles = {title for title in _TITLE.findall(page_text()) if not _NOT_ELEMENTS.match(title)}
    entry_titles = _guide_titles()

    missing = sorted(title for title in page_titles if not any(entry.startswith(title) for entry in entry_titles))

    # Guards the guard: the reader found the page's charts.
    assert {"Trips over time", "Lane risk", "Cost at a glance", "Live trips", "Unused vehicles"} <= page_titles
    assert missing == [], "These charts or tiles have no guide entry"


def test_every_topic_has_entries_and_every_entry_explains_something() -> None:
    assert set(GUIDE) == set(TOPICS)
    for topic in TOPICS:
        entries = guide_for(topic)
        assert entries
        assert all(set(entry) - {"title", "kind"} for entry in entries), topic


def test_the_guide_has_no_em_dashes() -> None:
    # The chat quotes the guide, and an answer must carry none (B44).
    assert "—" not in _all_text()


def test_thresholds_come_from_the_code() -> None:
    text = _all_text()

    assert f"more than {EARLY_THRESHOLD_MINUTES} min ahead of plan" in text
    assert f"last {TILE_WINDOW_DAYS} South African days" in text
    assert f"at most {MAX_TREND_BUCKETS} bars" in text
    assert f"{EXPIRY_BAND_EDGES_DAYS[0]} days or less" in text
    theft = next(e for e in guide_for("problems") if e["title"] == "Theft warning signs")
    assert theft["counted"][0].count(",") == len(THEFT_SIGNAL_TYPES) - 1  # type: ignore[index]


def test_the_low_sample_threshold_matches_the_page() -> None:
    period_ts = (FRONTEND / "lib" / "format" / "period.ts").read_text(encoding="utf-8")

    assert f"export const LOW_SAMPLE_TRIPS = {LOW_SAMPLE_TRIPS}" in period_ts


def test_the_sign_off_start_date_matches_the_page() -> None:
    assert f"Receiver QR sign-off went live on {SIGNOFF_LIVE}." in page_lines(GUIDE_KEYS)


def test_the_starting_rates_are_read_from_the_cost_model() -> None:
    rates = next(e for e in guide_for("cost") if e["title"] == "Cost rates")["method"][0]  # type: ignore[index]

    assert f"R {DEFAULT_COST_RATES.diesel_price_per_litre:.2f} per litre" in rates
    assert "fuel R 17.64 per km" in rates  # 33.29 × 53 ÷ 100, Bruce's calibration (cost spec D3)
    assert f"road factor {DEFAULT_COST_RATES.road_factor}" in rates


@pytest.mark.parametrize(
    ("topic", "title", "must_say"),
    [
        # The facts the 21-22 Oct answers got wrong or couldn't give.
        ("tiles", "Live trips", "planned trips are included"),
        ("activity", "Cancellations over time", "Bucketed by the day the trip was cancelled"),
        ("activity", "Busy patterns", "on trips of any status"),
        ("cost", "Cost at a glance", "never added"),
        ("cost", "Operating cost over time", "road distance × (fuel per km + other running per km)"),
        ("review_desk", "Review desk tab", "Every exception starts as 'needs review'"),
        # The 22 Oct eval expanded DMPR from memory, wrongly.
        ("cost", "Cost rates", "Department of Mineral and Petroleum Resources"),
    ],
)
def test_the_facts_that_were_missing_or_wrong_are_stated(topic: str, title: str, must_say: str) -> None:
    entry = next(e for e in guide_for(topic) if e["title"] == title)  # type: ignore[arg-type]

    assert must_say in json.dumps(entry, ensure_ascii=False)
