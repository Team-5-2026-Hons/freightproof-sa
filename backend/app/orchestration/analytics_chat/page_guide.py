"""Everything the Analytics page shows, explained, for the chat (FP-295 spec B45; coverage audit 2026-10-22).

The chat answered figure questions well but couldn't answer "how do we come up with operating cost?" or "why does
this chart exist?": the page's explanations only reached it alongside figures, and figures need a period. This guide
holds, for every element on /analytics (the coverage audit's 51 rows), what it shows, why it exists, how each number
is worked out, where the data comes from, what is counted and left out, what its words mean, why it might look odd,
and what its controls do. The `explain` tool hands one topic's entries to the model, with no period needed.

Three kinds of text, kept apart so each can be checked:
- `page_says`: the page's own sentences, word for word (most borrowed from definitions.py). A test fails if the page's
  wording changes and this doesn't.
- numbers (thresholds, bands, starting rates) are read from the code that applies them (fleet/constants.py,
  cost_model.py), never typed in, so an explanation can't drift from what the page does.
- everything else is written from the design specs' reasons (2026-09-15 fleet analytics page spec §2, §4, §5, §13;
  2026-10-15 FP-294 cost spec §2) and checked against the code on 22 Oct 2026. Where a spec and the code disagree,
  this follows the code (audit §7).

No em dashes anywhere: the chat quotes this text, and its answers carry none (B44).

Pure data: no database, no I/O.
"""

from collections.abc import Mapping
from dataclasses import dataclass, fields
from decimal import Decimal
from typing import Literal

from app.analytics.cost_model import DEFAULT_COST_RATES
from app.analytics.fleet.constants import (
    DAY_BLOCKS,
    EARLY_THRESHOLD_MINUTES,
    EXPIRY_BAND_EDGES_DAYS,
    LATE_BUCKET_EDGES_MINUTES,
    MAX_TREND_BUCKETS,
    REVIEW_AGE_EDGES_HOURS,
    THEFT_SIGNAL_TYPES,
    TILE_WINDOW_DAYS,
)
from app.db.models.enums import ExceptionType
from app.orchestration.analytics_chat.definitions import ABOUT_BY_TOOL

# The page's "Based on only N trips, read with care" threshold. It lives in the frontend
# (lib/format/period.ts LOW_SAMPLE_TRIPS); a test reads that file so the two can't differ.
LOW_SAMPLE_TRIPS = 5
# Receiver QR sign-off went live on this day (copy.ts evidence.signoff.live).
SIGNOFF_LIVE = "13 Sep 2026"

Topic = Literal["page", "tiles", "activity", "on_time", "problems", "review_desk", "evidence", "routes_and_sites", "cost"]
TOPICS: tuple[Topic, ...] = (
    "page", "tiles", "activity", "on_time", "problems", "review_desk", "evidence", "routes_and_sites", "cost",
)


@dataclass(frozen=True)
class GuideEntry:
    """One element on the page. Empty fields are left out of what the model sees."""

    title: str
    kind: Literal["page", "control", "tile", "chart", "note", "removed", "chat"]
    purpose: str = ""
    shows: str = ""
    method: tuple[str, ...] = ()
    counted: tuple[str, ...] = ()
    left_out: tuple[str, ...] = ()
    terms: tuple[str, ...] = ()
    odd_states: tuple[str, ...] = ()
    controls: tuple[str, ...] = ()
    page_says: tuple[str, ...] = ()

    def as_json(self) -> dict[str, object]:
        out: dict[str, object] = {}
        for field in fields(self):
            value = getattr(self, field.name)
            if value:
                out[field.name] = list(value) if isinstance(value, tuple) else value
        return out


# ── Helpers that turn the code's numbers into words ─────────────────────────


def _say(tool: str, title: str) -> tuple[str, ...]:
    """The page's own lines for a chart, as definitions.py holds them (drift-tested there)."""
    return ABOUT_BY_TOOL[tool][title]


def _plain(exception_type: ExceptionType) -> str:
    """seal_mismatch -> "seal mismatch", receiver_id_mismatch -> "receiver ID mismatch"."""
    return exception_type.value.replace("_", " ").replace(" id ", " ID ")


def _hours(minutes: int) -> str:
    return f"{minutes // 60} h" if minutes % 60 == 0 and minutes >= 60 else f"{minutes} min"


def _rand(value: Decimal) -> str:
    return f"R {value:,.2f}".replace(",", " ")


_DATA_NOTE = _say("activity", "Every figure on the page")[0]
_EARLY = EARLY_THRESHOLD_MINUTES
_L1, _L2, _L3 = LATE_BUCKET_EDGES_MINUTES
_R1, _R2, _R3 = REVIEW_AGE_EDGES_HOURS
_E1, _E2, _E3 = EXPIRY_BAND_EDGES_DAYS
_THEFT_TYPES = ", ".join(_plain(t) for t in THEFT_SIGNAL_TYPES)
_DAY_BLOCKS = ", ".join(f"{block.value} {start:02d}:00 to {end:02d}:00" for block, start, end in DAY_BLOCKS)
_RATES = DEFAULT_COST_RATES

# Said once and reused: the rule every trend on the page follows (page spec D8, G3, G4).
_CLOSED_TRIPS_RULE = (
    "Trend charts count closed trips only, each in the bucket of the South African day it first departed: the time "
    "of its first departure step the driver attested (not a field on the trip, which is overwritten on every leg of a "
    "multi-stop trip)."
)
_ON_TIME_RULE = "On time is strict: on or before the planned time, with no grace minutes (page spec D9)."
_NO_RANKING = (
    "No driver, vehicle or dispatcher is ranked or scored anywhere on this page, by design (page spec D13, FP-156 "
    "decision 06). Per-driver and per-vehicle figures are on each one's own page."
)


# ── Page level ────────────────────────────────────────────────────────────────

_PAGE: tuple[GuideEntry, ...] = (
    GuideEntry(
        title="The Analytics page",
        kind="page",
        purpose=(
            "Answers 'how is the whole operation doing?' for the fleet as a whole. Per-driver, per-vehicle and per-site "
            "figures moved to their own detail pages (page spec D1). Headline tiles sit on top, then seven tabs: Activity, "
            "On time, Problems, Review desk, Evidence, Routes & sites and Cost. Only the open tab loads (page spec D2, D3; "
            "Cost added by FP-294)."
        ),
        method=(
            _CLOSED_TRIPS_RULE,
            "Why by departure and not by when a trip finished: the driver, vehicle and site detail pages count the same "
            "way, so every figure in the app agrees (page spec D8).",
            "Real data only: no seeded or demo trips are added to make charts look full (page spec D6), which is why "
            "charts have empty and low-sample states.",
            "Every rate is worked out once on the server from raw counts; a rate with nothing to divide by is shown as "
            "a dash, never 0% (page spec G9).",
            "All dates and times are South African time; weeks start on Monday.",
        ),
        left_out=(_NO_RANKING,),
        page_says=(
            "Trends count closed trips, grouped by the day they first departed (South African time). Tiles show right now.",
            _DATA_NOTE,
        ),
    ),
    GuideEntry(
        title="View by",
        kind="control",
        purpose="Groups the over-time charts' bars into weeks, months or years.",
        controls=(
            "Week, Month or Year. Weeks run Monday to Sunday.",
            f"A chart shows at most {MAX_TREND_BUCKETS} bars (a year of weeks). A View by that would draw more is "
            "switched off with 'Too many weeks for this period: choose Month'; if a period change makes the current one "
            "too fine, the page moves to the next coarser one and says so.",
            "Routes & sites has no View by: its charts total the whole period. Plans vs reality and the Cost by lane "
            "chart also cover the whole period whatever View by says.",
        ),
    ),
    GuideEntry(
        title="Period",
        kind="control",
        purpose="Chooses which days the tab's charts cover.",
        controls=(
            "The presets depend on View by. Week: last 4 weeks, last 12 weeks, last 26 weeks, this year, all time. "
            "Month: last 3 months, last 6 months, last 12 months, this year, all time. Year: this year, last 3 years, "
            "all time. Routes & sites and the busy patterns: last 4 weeks, last 12 weeks, last 12 months, this year, all "
            "time. Every list ends with Custom range.",
            "A preset ends today and includes the current, unfinished week, month or year. 'Last 12 weeks' is this week "
            "and the 11 before it.",
            "All time starts on the day of the organisation's first trip.",
            "A period can't end after today. Switching View by keeps the period if the new list offers it, otherwise it "
            "moves to that View by's default: last 12 weeks (Week), last 12 months (Month), all time (Year).",
            "Each tab keeps its own View by and Period while you move between tabs.",
        ),
    ),
    GuideEntry(
        title="Information button, the 'i' on each chart, Show table and zoom",
        kind="control",
        controls=(
            "Information opens the page notes: the scope note, the data note, and the open tab's own note (Problems, "
            "Review desk and Cost have one).",
            "The 'i' beside a chart's title shows the question it answers, what it is based on, how to read it, where "
            "its data comes from, and for time charts what a faded bar means.",
            "Show table swaps the chart for a table holding every value, so nothing needs hovering. The zoom button "
            "opens the same view larger.",
        ),
    ),
    GuideEntry(
        title="Faded bars, 'read with care', and empty charts",
        kind="note",
        odd_states=(
            "A faded bar or point is a part week, month or year: one at either end of the period that isn't whole, or "
            "one still running (this week so far). Its figure is real but covers fewer days, so it isn't a fair "
            "comparison with the whole ones.",
            f"'Based on only N trips, read with care' appears when a chart rests on fewer than {LOW_SAMPLE_TRIPS} trips. "
            "The chart still draws; a few trips can swing a rate a long way.",
            "'Not enough data yet' means nothing happened in the period for that chart, for example no closed trips "
            "departed.",
            "A dash in place of a figure means there was nothing to measure (a rate with no trips under it). It is not "
            "zero.",
        ),
        page_says=(
            "Faded: a part week, month or year at either end of the period, or one still running.",
        ),
    ),
    GuideEntry(
        title="This chat",
        kind="chat",
        purpose=(
            "Answers questions about this page: its figures, read from the same functions as each tab, and what any "
            "tile, chart or control means, how it is worked out and why it exists."
        ),
        method=(
            "A figure answer shows 'Based on' chips: the tab, dates, View by and closed-trip count it came from, built "
            "by the server from the lookups that actually ran. An explanation answer is labelled 'Explained from the "
            "page's own notes'.",
            "Totals, rates and 'which is biggest' are worked out by the server, not by the AI.",
            "Only page totals and the typed question are sent to the AI provider; no names, ID numbers or locations.",
            "AI spend is capped per calendar month; the footer shows this month's spend against the cap.",
        ),
        left_out=(
            "It doesn't predict or forecast; it can show the trend so far.",
            _NO_RANKING,
            "It doesn't read the incident map's pin locations: a pin is where a named driver was. The map is on Routes & "
            "sites.",
            "It describes patterns worth looking into; it doesn't make operational decisions.",
        ),
    ),
)


# ── Headline tiles (always right now, never a period) ─────────────────────────

_TILES: tuple[GuideEntry, ...] = (
    GuideEntry(
        title="Headline tiles",
        kind="note",
        purpose="The state of the fleet right now, above the tabs, with no period.",
        page_says=_say("right_now", "Headline tiles"),
    ),
    GuideEntry(
        title="Live trips",
        kind="tile",
        shows="How many trips are live now.",
        method=(
            "Counts the organisation's trips with status created, active or on hold. Created means planned and not yet "
            "departed, so planned trips are included; the tile doesn't split them.",
        ),
        controls=("Clicking it opens the Dispatcher Dashboard, whose Active Trips list shows every trip.",),
        page_says=_say("right_now", "Live trips"),
    ),
    GuideEntry(
        title="Critical Exceptions Waiting",
        kind="tile",
        shows="How many critical problems are waiting for a dispatcher's review, and how long the oldest has waited.",
        method=(
            "Counts exceptions of critical severity whose review status is 'needs review'. Every exception starts "
            "unreviewed whatever its severity (team decision, 29 Sep 2026); this tile shows only the critical ones, the "
            "ones that must be acted on.",
            "The age is from when the oldest of them was raised, in whole days and hours.",
        ),
        odd_states=("It turns to warning colours with an icon when anything is waiting.",),
        controls=("Clicking it opens the Exceptions page.",),
    ),
    GuideEntry(
        title="Licences & discs",
        kind="tile",
        shows="Active drivers' licences and active vehicles' licence discs, by how soon they expire.",
        method=(
            f"Bands, counted separately (not added up): expired (before today), {_E1} days or less, {_E1 + 1} to {_E2} "
            f"days, {_E2 + 1} to {_E3} days, and no date on file. Anything further than {_E3} days away isn't counted "
            "here.",
            f"The {_E1} and {_E2}-day edges match the red and amber colours on the drivers list, so the tile agrees "
            "with it.",
        ),
        left_out=("Inactive drivers and vehicles.",),
        controls=("The Drivers and Discs rows open the drivers and vehicles lists.",),
        page_says=_say("right_now", "Licences & discs"),
    ),
    GuideEntry(
        title="Unused vehicles",
        kind="tile",
        shows="Trucks and trailers that haven't been used recently, with up to three registrations.",
        method=(
            f"Active vehicles (truck or trailer) with no trip departure in the last {TILE_WINDOW_DAYS} South African "
            "days (today included) and not on a live trip now. A trip of any status counts as use, cancelled included, "
            "and a vehicle booked on a live trip that hasn't left yet counts as in use.",
            f"Why {TILE_WINDOW_DAYS} days: long enough to hold several trips per vehicle at today's volumes, short "
            "enough to describe the fleet as it is now.",
        ),
        left_out=("Drivers are never listed as unused (page spec D13).",),
    ),
)


# ── Activity ──────────────────────────────────────────────────────────────────

_ACTIVITY: tuple[GuideEntry, ...] = (
    GuideEntry(
        title="Trips over time",
        kind="chart",
        purpose="Shows whether the operation is getting busier.",
        shows="Closed trips per week, month or year, stacked as loaded and empty runs.",
        method=(_CLOSED_TRIPS_RULE, "Loaded and empty run come from the trip's type."),
        left_out=("Cancelled trips (they have their own chart), and trips not yet closed.",),
        page_says=("Are we getting busier?", *_say("activity", "Trips over time")),
    ),
    GuideEntry(
        title="Cancellations over time",
        kind="chart",
        purpose="Shows how often trips are abandoned.",
        shows="Cancelled trips per bucket, against every trip that ended in it; the table lists each cancelled trip.",
        method=(
            "Bucketed by the day the trip was cancelled, not by departure: a cancelled trip may never have departed.",
            "The share = cancelled ÷ (cancelled + closed) among trips that ended in that bucket.",
        ),
        left_out=(
            "The cancellation note isn't shown here: it is stored inside a free-text record, so each cancelled trip "
            "links to its trip page, where the note is (page spec D20).",
        ),
        page_says=("How often are trips abandoned?", *_say("activity", "Cancellations over time")),
    ),
    GuideEntry(
        title="Busy patterns",
        kind="chart",
        purpose=(
            "Shows when the operation is busiest: by hour of day, weekday, day of month and month of year. It has its "
            "own Pattern period (default all time) because patterns need a lot of history to mean anything (page spec "
            "D5)."
        ),
        shows="Four small charts of the average number of departures (or arrivals) per day.",
        method=(
            "Departures are the departure steps drivers completed in the app; arrivals are their arrival steps (the end "
            "of each driving leg). Every leg counts, on trips of any status.",
            "Each bar is an average per day: events in that hour, weekday, date or month, divided by how many such days "
            "the period holds. The 31st is only divided by months that have a 31st, so short months don't drag it down.",
            "Bars stay in clock and calendar order; the busiest is highlighted.",
        ),
        left_out=("Steps a dispatcher completed for the driver (their time is a click, not when the truck moved).",),
        odd_states=("The month-of-year chart needs a full year of history to compare months fairly.",),
        controls=("The Departures | Arrivals switch flips all four charts; the Pattern period is separate from the tab's.",),
        page_says=_say("activity", "Busy patterns"),
    ),
)


# ── On time ───────────────────────────────────────────────────────────────────

_LATE_BANDS = (
    f"early (more than {_EARLY} min ahead of plan), on time (up to {_EARLY} min ahead, or exactly on plan), 1 to {_L1} "
    f"min late, {_L1} to {_L2} min, {_hours(_L2)} to {_hours(_L3)}, and {_hours(_L3)}+"
)

_ON_TIME: tuple[GuideEntry, ...] = (
    GuideEntry(
        title="On-time departures and arrivals",
        kind="chart",
        purpose=(
            "Shows whether the operation is getting more punctual. On-time pickup and delivery are the measures "
            "dispatcher KPI guides centre on (page spec §13)."
        ),
        shows="The percentage of departures and of arrivals that were on time, per bucket.",
        method=(
            _ON_TIME_RULE,
            "A departure is compared with the planned departure; an arrival is the final driving leg's attested arrival "
            "compared with the planned arrival.",
            "Only trips that had a planned time are counted.",
        ),
        terms=(
            "Left late and arrived late points to a problem at the dock; left on time but arrived late points to a "
            "problem on the road.",
        ),
        page_says=("Are we getting more punctual?", *_say("on_time", "On-time departures and arrivals")),
    ),
    GuideEntry(
        title="How late is late",
        kind="chart",
        purpose=(
            "Separates 'a little late often' from 'very late sometimes', so the strict on-time rule doesn't make a "
            "few minutes look like a failure."
        ),
        shows=f"How many departures (or arrivals) fell in each band: {_LATE_BANDS}.",
        method=(
            "Minutes late = actual time minus planned time, over the whole period.",
            f"Leaving more than {_EARLY} minutes early usually means the plan was wrong, not that the driver was good, "
            "so it has its own band.",
            "Early and on time together equal the on-time count in the chart above for the same period.",
        ),
        controls=("The Departures | Arrivals switch picks which is shown.",),
        page_says=("A little late often, or very late sometimes?", *_say("on_time", "How late is late")),
    ),
    GuideEntry(
        title="Plans vs reality",
        kind="chart",
        purpose="Shows whether planned trip times are realistic.",
        shows=(
            "How far each closed trip's actual time was from its planned time: finished early on the left of the "
            "middle axis, ran over on the right, in bands of 0 to 15 min, 15 to 60 min, 1 to 3 h and 3 h+."
        ),
        method=(
            "Per trip: (actual arrival minus first departure) minus (planned arrival minus planned departure).",
            "Covers the whole period; View by doesn't change it. Trips exactly on plan are named under the axis, not "
            "drawn.",
            "Redesigned twice after Tom's reviews: a one-sided chart looked upside down and a dot per trip doesn't "
            "scale (page spec D23, D24).",
        ),
        counted=("Closed trips with a planned departure, a planned arrival and a recorded arrival.",),
        page_says=("Are our planned times realistic?", *_say("on_time", "Plans vs reality")),
    ),
    GuideEntry(
        title="Where the time goes (removed)",
        kind="removed",
        purpose=(
            "Was removed (page spec D24): it read badly on real data (every step '1 to 3 min'). Per-driver step "
            "timings are on each driver's page."
        ),
    ),
)


# ── Problems ──────────────────────────────────────────────────────────────────

_PROBLEMS: tuple[GuideEntry, ...] = (
    GuideEntry(
        title="Problems tab",
        kind="note",
        method=(
            "A problem is an exception report on a closed trip, raised by a driver, a dispatcher or an automatic check.",
            "Dispatcher notes are never counted: one is recorded automatically for every cancellation and every "
            "override, so counting them would make problems rise whenever a dispatcher does their job (page spec D10).",
            "Only types that something actually creates are listed, so a never-created type doesn't sit at a "
            "reassuring 0 (page spec D11).",
        ),
        page_says=_say("problems", "Problems tab"),
    ),
    GuideEntry(
        title="Problems over time",
        kind="chart",
        purpose=(
            "The tab's anchor chart: a rising problem rate tends to come before falling on-time performance (page spec "
            "§13)."
        ),
        shows="How many problems were raised per bucket, warning under critical; the rate per trip is in the tooltip "
        "and the table.",
        method=(
            "Counts, not a rate per 100 trips: '400 per 100' on two trips misled (page spec D25). The rate per trip "
            "sits next to the trip count instead.",
            "A total counts every severity; nothing creates 'info' today, so the bars show warning and critical.",
        ),
        page_says=("Are things getting better or worse?", *_say("problems", "Problems over time")),
    ),
    GuideEntry(
        title="Theft warning signs",
        kind="chart",
        purpose=(
            "Shows whether theft risk is going up. TAPA's trucking security requirements centre on sealing, route "
            "control and incident reporting (page spec §13)."
        ),
        shows="The total of theft-sign reports per bucket; the tooltip and table split it by type.",
        counted=(f"These types count as theft signs: {_THEFT_TYPES}.",),
        left_out=(
            "seal unverified and receiver ID unverified: no check was completed, a gap in the paperwork rather than a "
            "sign of tampering.",
        ),
        page_says=("Is theft risk going up?", *_say("problems", "Theft warning signs")),
    ),
    GuideEntry(
        title="Most common problems",
        kind="chart",
        purpose="Shows which problems happen most, and who raises them.",
        shows="One bar per problem type with at least one report, longest first, split by who raised it: system, driver "
        "or dispatcher.",
        page_says=("Which problems happen most?", *_say("problems", "Most common problems")),
    ),
    GuideEntry(
        title="Where in the trip",
        kind="chart",
        purpose="Shows at which step of a trip problems happen.",
        shows="Problems by the trip step they were raised at, in trip order.",
        terms=(
            "The steps: Trip creation, Activation, Loading, Waiting to leave (departure), Driving (in transit), Arrival "
            "seal check, Unloading and Sign-off (confirmation).",
            "Not linked to a step: a report raised outside any step, for example from the road or by a dispatcher.",
        ),
        odd_states=(
            "With the chat panel open the card is narrower, so the columns lie down as bars with the names beside them.",
        ),
        page_says=("At which step do problems happen?", *_say("problems", "Where in the trip")),
    ),
    GuideEntry(
        title="Risky times of day",
        kind="chart",
        purpose="Shows whether any time of day is riskier than its share of driving.",
        shows="For each quarter of the day, its share of all driving time beside its share of problems raised while "
        "driving.",
        method=(
            f"Quarters of the South African day: {_DAY_BLOCKS}. Six-hour blocks are coarse on purpose: at today's "
            "volumes finer slices would each hold a handful of minutes.",
            "Driving time = each leg from its attested departure to its arrival, split minute by minute across the "
            "blocks it crosses.",
            "Problems while driving = reports linked to the driving step, by when the server received them, any "
            "severity (page spec D21: critical-only would be almost always empty).",
        ),
        page_says=("Is any time of day riskier than its share of driving?", *_say("problems", "Risky times of day")),
    ),
)


# ── Review desk ───────────────────────────────────────────────────────────────

_REVIEW: tuple[GuideEntry, ...] = (
    GuideEntry(
        title="Review desk tab",
        kind="note",
        method=(
            "Every exception starts as 'needs review', whatever its severity (team decision, 29 Sep 2026). The queue "
            "charts here follow the critical ones; the outcomes chart counts reviews of any severity.",
            "Trips of any status count, not just closed ones: reviewing doesn't depend on the trip.",
        ),
        left_out=(
            "Reviews marked as migrated from the old system (a marker, not a finding).",
            "Reviews per dispatcher: left out on purpose (page spec D13).",
        ),
        page_says=_say("review_desk", "Review desk tab"),
    ),
    GuideEntry(
        title="Waiting now, by age",
        kind="chart",
        purpose="Shows how long critical problems have been waiting for review right now.",
        shows=(
            f"Critical problems waiting now, in bands: under {_R1} h, {_R1} to {_R2} h, {_R2 // 24} to {_R3 // 24} "
            f"days, over {_R3 // 24} days. It has no period: it is right now."
        ),
        page_says=("How long have critical problems been waiting for review?",),
    ),
    GuideEntry(
        title="Is the pile growing?",
        kind="chart",
        purpose="Shows whether critical problems are being reviewed as fast as they arrive.",
        method=(
            "For each bucket: critical problems raised before its end and not yet reviewed by its end (now, for one "
            "still running).",
        ),
        page_says=(
            "Are critical problems being reviewed as fast as they arrive?", *_say("review_desk", "Is the pile growing?"),
        ),
    ),
    GuideEntry(
        title="How fast critical problems get reviewed",
        kind="chart",
        purpose="Shows how long a critical problem waits for a dispatcher.",
        method=(
            "The median (typical) hours from a critical problem being raised to being reviewed, for those reviewed in "
            "each bucket, by the day reviewed. The tooltip and table also show the average and the count.",
            "A median, because one problem left for a week would drag an average far from the usual wait. Medians per "
            "bucket can't be added together.",
        ),
        page_says=("How long does a critical problem wait for a dispatcher?",),
    ),
    GuideEntry(
        title="What reviews concluded",
        kind="chart",
        purpose="Shows what dispatchers find when they review.",
        shows="Every review of any severity concluded in the period, by outcome, as a donut with the total in the "
        "centre.",
        terms=(
            "The five outcomes: No action needed, Handled elsewhere, Evidence confirmed, Data discrepancy, Referred for "
            "follow-up.",
        ),
        page_says=("What do dispatchers find when they review?", *_say("review_desk", "What reviews concluded")),
    ),
)


# ── Evidence ──────────────────────────────────────────────────────────────────

_EVIDENCE: tuple[GuideEntry, ...] = (
    GuideEntry(
        title="Evidence tab",
        kind="note",
        purpose=(
            "Shows how strong the record is. Delivery disputes turn on an intact chain of custody and independent proof "
            "of delivery (page spec §13)."
        ),
    ),
    GuideEntry(
        title="Tracker agreement",
        kind="chart",
        purpose="Shows whether the truck's tracker agrees with where the driver said they were.",
        method=(
            "Each attested stop step on a closed trip has a tracker check: confirmed, no tracker reading, or mismatch.",
            "Agreement = confirmed ÷ (confirmed + mismatch); steps with no reading are outside the sum.",
        ),
        page_says=(
            "Does the truck's tracker agree with where the driver said they were?", *_say("evidence", "Tracker agreement"),
        ),
    ),
    GuideEntry(
        title="Overrides over time",
        kind="chart",
        purpose="Shows how often a dispatcher completes a step for the driver.",
        method=("The share of all steps on closed trips that a dispatcher completed for the driver.",),
        page_says=(
            "How often does a dispatcher complete a step for the driver?", *_say("evidence", "Overrides over time"),
        ),
    ),
    GuideEntry(
        title="Receiver sign-off",
        kind="chart",
        purpose="Shows how often the receiver confirms the delivery on their own phone.",
        method=(
            "The share of attested sign-off steps on closed trips that the receiver scanned by QR code, plus two figures "
            "for the period: confirmations made from the driver's own phone, and rejected scan attempts.",
        ),
        odd_states=(f"It went live on {SIGNOFF_LIVE}, so periods before then read low.",),
        page_says=(
            "How often does the receiver confirm the delivery on their own phone?", *_say("evidence", "Receiver sign-off"),
        ),
    ),
    GuideEntry(
        title="Blockchain receipts (removed)",
        kind="removed",
        purpose="Was removed, with its Receipts owed tile, in September (page spec D25, D26).",
    ),
)


# ── Routes & sites ────────────────────────────────────────────────────────────

_ROUTES: tuple[GuideEntry, ...] = (
    GuideEntry(
        title="Busiest sites",
        kind="chart",
        purpose="Shows which sites see the most of the fleet's trucks.",
        shows="Pickups and deliveries per site, top 10 (Show all for every site).",
        method=(
            "Pickups = attested loading steps; deliveries = attested unloading steps on loaded trips, over closed trips.",
        ),
        page_says=("Which sites see the most of our trucks?", *_say("routes_and_sites", "Busiest sites")),
    ),
    GuideEntry(
        title="Lane risk",
        kind="chart",
        purpose="Shows which lanes are both busy and risky.",
        shows=(
            "One dot per lane: trips on the lane across, problems per trip up. Two faint lines mark the average lane; "
            "the top-right corner is busy and risky. A lane's name shows when you hover its dot, and every lane is in "
            "the table."
        ),
        terms=("A lane is an origin depot to a destination depot.",),
        page_says=(
            "Which lanes are both busy and risky?",
            *_say("routes_and_sites", "Lane risk"),
            "The two faint lines mark the average lane: trips across, problems per trip up. Top-right = busy and risky.",
        ),
    ),
    GuideEntry(
        title="Driving time per lane",
        kind="chart",
        purpose="Shows how long each route takes on a normal day and on a bad one.",
        method=(
            "Per closed trip: first departure to final arrival. Typical = the median; bad day = the 90th percentile "
            "(9 in 10 trips were faster).",
        ),
        odd_states=(f"Lanes with fewer than {LOW_SAMPLE_TRIPS} trips are faded and marked 'too few trips'.",),
        page_says=(
            "How long does each route take, on a normal day and a bad one?",
            *_say("routes_and_sites", "Driving time per lane"),
        ),
    ),
    GuideEntry(
        title="Incident map",
        kind="chart",
        purpose="Shows where problems happen.",
        shows="One pin per report that carries a location, coloured by severity, with a table of the same pins below.",
        method=("Every report with a location in the period, any trip status; dispatcher notes left out.",),
        left_out=(
            "This chat doesn't read the pins: a pin is where a named driver was (page spec D14). Open the map on Routes "
            "& sites to see them.",
        ),
        controls=("'Show reports from' switches between Today and This period.",),
        page_says=(
            "Where do problems happen?",
            "The position saved with each report: the driver’s phone for driver reports and for tracker mismatches at "
            "a stop; the simulated tracker for checks on the road. Any trip status; dispatcher notes are left out.",
        ),
    ),
)


# ── Cost ──────────────────────────────────────────────────────────────────────

_COST_METHOD = (
    "Per closed trip: road distance × (fuel per km + other running per km) + driving hours × driver rate + the fixed "
    "rate per trip.",
    "Fuel per km = diesel price × consumption (litres per 100 km) ÷ 100.",
    "Distance: each leg between consecutive stops, along the truck road route from OpenRouteService (looked up once per "
    "pair of depots and remembered). Where a route can't be looked up, the straight line × the road factor.",
    "Driving hours: first departure to final arrival. A trip missing either time isn't costed, and is counted as 'not "
    "costed' instead.",
)

_COST: tuple[GuideEntry, ...] = (
    GuideEntry(
        title="Cost tab",
        kind="note",
        purpose=(
            "Puts a rand figure on running the trips, on lateness on trips with problems, and on cargo exposed to theft "
            "signs. Every figure says whether it is an estimate or from waybills (cost spec D13)."
        ),
        method=(_CLOSED_TRIPS_RULE, "Every figure uses today's rates; changing a rate changes past figures too (no rate "
                "history, cost spec D1)."),
        page_says=_say("cost", "Cost tab"),
    ),
    GuideEntry(
        title="Cost at a glance",
        kind="chart",
        purpose="Answers what the period cost, what problems added, and how much cargo was exposed.",
        shows=(
            "Three figures: operating cost (estimate) with the number of trips costed; delay cost on problem trips "
            "(estimate) with the hours late; cargo value exposed (from waybills) with how much is still under review."
        ),
        method=(
            "Operating cost and delay cost are explained under their own charts below.",
            "Delay cost is shown beside operating cost, never added: the driver's late hours are already inside the "
            "operating cost's driver part, so adding them would count them twice (cost spec D8).",
        ),
        page_says=(
            "What did this period cost us, what did problems add, and how much cargo was exposed?",
            *_say("cost", "Cost at a glance"),
        ),
    ),
    GuideEntry(
        title="Operating cost over time",
        kind="chart",
        purpose="Shows what running the trips cost, and what drove it (fuel, other running, driver, fixed).",
        method=_COST_METHOD,
        terms=(
            "Other running: tyres, maintenance, tolls and the vehicle itself.",
            "No system FreightProof reads records what a trip actually cost, so every operating figure is an estimate.",
        ),
        page_says=("What did running our trips cost, and what drove it?", *_say("cost", "Operating cost over time")),
    ),
    GuideEntry(
        title="Delay cost on problem trips",
        kind="chart",
        purpose="Shows what lateness on trips with problems might have cost.",
        method=(
            "Per closed trip with at least one problem (dispatcher notes don't count): hours late at final arrival × the "
            "delay rate. Arriving early or on time counts as 0 hours.",
            "Hours late uses the On time tab's own measure, so the two tabs agree.",
            "The delay rate is the driver plus the truck standing idle (cost spec D4).",
            "Rejected method: timing from the problem to the next step, because it counts normal driving as lost time.",
        ),
        left_out=("Trips with no planned or actual arrival: counted as lateness unknown, not as 0.",),
        page_says=(
            "What might lateness on trips with problems have cost us?", *_say("cost", "Delay cost on problem trips"),
        ),
    ),
    GuideEntry(
        title="Cargo value exposed",
        kind="chart",
        purpose="Shows how much cargo value was on trips with a sign of theft.",
        method=(
            "The declared value of every consignment on closed trips with at least one theft sign (the same types as "
            "the Problems tab's theft chart), split into still under review and reviewed.",
            "The whole load counts, because a report isn't linked to one consignment.",
        ),
        left_out=(
            "Unknown values are counted, never treated as R 0: consignments with no declared value, and exposed trips "
            "with no waybills on record (cost spec D10).",
        ),
        page_says=("How much cargo value was on trips with a sign of theft?", *_say("cost", "Cargo value exposed")),
    ),
    GuideEntry(
        title="Cost by lane",
        kind="chart",
        purpose="Shows which routes cost the most to run.",
        shows="Estimated operating cost per lane over the period, with the cost per trip, and the lane's delay cost and "
        "value exposed beside it. Each lane says whether its distance was by road, estimated, or a mix.",
        page_says=("Which routes cost the most to run?", *_say("cost", "Cost by lane")),
    ),
    GuideEntry(
        title="Cost rates",
        kind="chart",
        purpose=(
            "Every estimate on the tab is worked out from these rates, shown beside the figures they drive (cost spec "
            "D14). Only an admin can edit them; everyone else sees them read-only."
        ),
        method=(
            "Starting rates, used until an admin saves their own (calibrated so Bruce's Johannesburg to Durban run, "
            "about R 20 000, comes out right; cost spec D3): "
            f"diesel {_rand(_RATES.diesel_price_per_litre)} per litre, consumption {_RATES.litres_per_100km} L per "
            f"100 km (so fuel {_rand(_RATES.fuel_per_km)} per km), other running {_rand(_RATES.running_per_km)} per km, "
            f"driver {_rand(_RATES.driver_per_hour)} per hour, fixed {_rand(_RATES.fixed_per_trip)} per trip, delay "
            f"{_rand(_RATES.delay_per_hour)} per hour, road factor {_RATES.road_factor}.",
            "The organisation's current rates come with this explanation when they're asked about.",
        ),
        terms=(
            # 22 Oct eval (e05): with no meaning here, the model expanded DMPR from memory and got the name wrong.
            "DMPR: the Department of Mineral and Petroleum Resources, which sets South Africa's regulated fuel prices "
            "each month (on the first Wednesday). 'Inland 50ppm' is the regulated price of 50ppm diesel inland.",
            "Bruce's figures: the costs Bruce gave in the project's meetings of 28 Jul and 1 Sep 2026, which the "
            "starting rates were calibrated on (cost spec D3).",
        ),
        page_says=(
            "DMPR inland 50ppm, 7 Oct 2026. Update it when the price changes.",
            "Fuel ≈ half of a R20,000 JHB–DBN run (Bruce, 1 Sep 2026).",
            "Diesel price × consumption.",
            "The rest of that run after fuel and driver: tyres, maintenance, tolls, the vehicle.",
            "R30,000 a month ÷ 195 working hours (Bruce, 28 Jul 2026).",
            "Not set from Bruce’s figures.",
            "The driver plus the truck standing idle.",
            "Only where a road route can’t be looked up (the N3’s road ÷ straight-line ratio).",
        ),
    ),
)


GUIDE: Mapping[Topic, tuple[GuideEntry, ...]] = {
    "page": _PAGE,
    "tiles": _TILES,
    "activity": _ACTIVITY,
    "on_time": _ON_TIME,
    "problems": _PROBLEMS,
    "review_desk": _REVIEW,
    "evidence": _EVIDENCE,
    "routes_and_sites": _ROUTES,
    "cost": _COST,
}


def guide_for(topic: Topic) -> list[dict[str, object]]:
    """One topic's entries, ready to send as JSON."""
    return [entry.as_json() for entry in GUIDE[topic]]
