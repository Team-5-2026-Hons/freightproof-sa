"""What the dispatcher is looking at, as a note for the model (FP-295 spec B45, Stage 4b).

"What do these figures tell us?" was answered with "For which period?" although the period was on screen. The panel
now sends the open tab, its Period and its View by with each question. This turns them into the exact tool inputs,
worked out here as period_hints.py does for periods named in the question, so the model never resolves a date itself.
A period the question names wins over the one on screen; the prompt says so.

Pure: no database, no I/O.
"""

from datetime import date

from app.orchestration.analytics_chat.periods import PeriodPreset, resolve_preset
from app.orchestration.analytics_chat.tools import TOOLS, TrendInput
from app.schemas.analytics_chat import PageView


def _period_words(view: PageView, start: date | None, end: date) -> str:
    if view.preset == PeriodPreset.CUSTOM.value:
        return f"{start} to {end}"
    words = view.preset.replace("_", " ")
    return f"{words} (from the organisation's first trip to {end})" if start is None else f"{words} ({start} to {end})"


def page_view_hint(view: PageView, today: date) -> str | None:
    """The note about what is on screen, or None when it can't be read (a custom range the page wouldn't draw)."""
    tool = next((candidate for candidate in TOOLS if candidate.tab == view.tab), None)
    if tool is None:
        return None
    preset = PeriodPreset(view.preset)
    try:
        start, end = resolve_preset(preset, today=today, start=view.start, end=view.end)
    except ValueError:
        return None
    # The page can't draw a range that runs backwards or ends in the future, so it wouldn't be on screen.
    if end > today or (start is not None and start > end):
        return None
    inputs = (
        f'preset "custom", start "{start}", end "{end}"' if preset is PeriodPreset.CUSTOM else f'preset "{preset.value}"'
    )
    grain = view.grain if issubclass(tool.input_model, TrendInput) else None
    if grain is not None:
        inputs += f', grain "{grain}"'
    view_by = "" if grain is None else f", View by {grain}"
    return (
        f"The dispatcher is looking at the {tool.label} tab, Period {_period_words(view, start, end)}{view_by}. When "
        'the question is about what is on screen ("these figures", "this chart", "this tab", "here") or asks for '
        f'figures without naming a period, use this period: tool "{tool.name}" with {inputs} (for another tab, the '
        "same period), and say which period the answer covers. A period the question names itself always wins. "
        f'For "this chart" or "this tab", the `explain` topic is "{tool.name}".'
    )
