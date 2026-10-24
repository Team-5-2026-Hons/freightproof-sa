"""What the dispatcher has on screen, as a note for the model (FP-295 spec B45, Stage 4b)."""

from datetime import date
from typing import get_args

import pytest

from app.orchestration.analytics_chat.page_view import page_view_hint
from app.orchestration.analytics_chat.periods import PeriodPreset
from app.orchestration.analytics_chat.tools import TOOLS
from app.schemas.analytics_chat import ChatPreset, ChatTab, PageView
from tests.page_copy import FRONTEND

# Thursday 22 Oct 2026.
_TODAY = date(2026, 10, 22)


def test_the_page_view_choices_match_the_page_and_the_tools() -> None:
    assert set(get_args(ChatPreset)) == {preset.value for preset in PeriodPreset}
    # Every tab id names a figure tool; the page's own tab list says the same ids.
    assert set(get_args(ChatTab)) == {tool.tab for tool in TOOLS if tool.tab is not None}
    page = (FRONTEND / "app" / "(app)" / "analytics" / "page.tsx").read_text(encoding="utf-8")
    for tab in get_args(ChatTab):
        assert f"'{tab}'" in page


def test_the_cost_tab_over_the_last_12_weeks_gives_its_exact_tool_inputs() -> None:
    hint = page_view_hint(PageView(tab="cost", preset="last_12_weeks", grain="week"), _TODAY)

    assert hint is not None
    assert "looking at the Cost tab, Period last 12 weeks (2026-08-03 to 2026-10-22), View by week" in hint
    assert 'tool "cost" with preset "last_12_weeks", grain "week"' in hint
    assert "A period the question names itself always wins." in hint
    assert 'the `explain` topic is "cost"' in hint


def test_routes_and_sites_takes_no_view_by_even_if_one_is_sent() -> None:
    hint = page_view_hint(PageView(tab="routes", preset="all_time", grain="week"), _TODAY)

    assert hint is not None
    assert 'tool "routes_and_sites" with preset "all_time" (' in hint
    assert "View by" not in hint
    assert "from the organisation's first trip" in hint


def test_a_custom_range_gives_its_dates() -> None:
    view = PageView(tab="on-time", preset="custom", start=date(2026, 9, 1), end=date(2026, 9, 30), grain="week")

    hint = page_view_hint(view, _TODAY)

    assert hint is not None
    assert 'preset "custom", start "2026-09-01", end "2026-09-30", grain "week"' in hint


@pytest.mark.parametrize(
    "view",
    [
        PageView(tab="cost", preset="custom", start=date(2026, 9, 30), end=date(2026, 9, 1), grain="week"),
        PageView(tab="cost", preset="custom", start=date(2026, 10, 1), end=date(2026, 11, 30), grain="week"),
        PageView(tab="cost", preset="custom", grain="week"),
    ],
    ids=["backwards", "ends after today", "no dates"],
)
def test_a_range_the_page_could_not_draw_gives_no_note(view: PageView) -> None:
    assert page_view_hint(view, _TODAY) is None
