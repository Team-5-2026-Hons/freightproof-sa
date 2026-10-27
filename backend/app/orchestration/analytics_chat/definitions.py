"""What the Analytics page says each figure counts, for the chat (FP-295 spec B43).

The page explains every chart and tile in a line or two (its "Source", notes and sub-lines, in
frontend/dispatcher/components/analytics/fleet/copy.ts and costCopy.ts). The model used to get the
figures without those lines, so it guessed what a figure meant, and on 21 Oct it guessed wrong: it
said planned trips weren't tracked, while the "Live trips" tile counts them ("Created, underway or
on hold"). Now every tool result starts with an `about` block holding the page's own lines for that
tab, word for word, so the chat explains a figure exactly as the page does.

Copied, not paraphrased: test_analytics_chat_definitions.py checks that every line here is still on
the page, and that every explanatory line on the page is here (or listed there as left out, with
the reason). A wording change on the page fails that test until this file is updated too.

Pure data: no database, no I/O.
"""

from collections.abc import Mapping

About = Mapping[str, tuple[str, ...]]

_DATA_NOTE = (
    "Every figure comes from FreightProof's own records of trips run on this system, test and demo trips included. "
    "The tracker, parcel and waybill, and receiver-ID checks behind some figures run on simulated and mock feeds "
    "until live credentials arrive."
)
_THIS_PAGE = {"Every figure on the page": (_DATA_NOTE,)}

_PROBLEM_REPORTS = (
    "Exception reports in our ledger on closed trips, raised by drivers, dispatchers or automatic checks. "
    "Dispatcher notes are left out."
)
_PLANNED_TIMES = (
    "Planned times entered at trip creation, against the driver’s attested departure and the trip’s recorded "
    "final arrival. Only trips that had planned times are counted."
)
_REVIEWS = (
    "Reviews dispatchers recorded in this system: when each problem was raised, when it was reviewed and the "
    "outcome chosen. Trips of any status, not just closed ones. The queue charts count critical problems only; "
    "the outcomes chart counts any severity. Migration-marked reviews are left out."
)

ABOUT_BY_TOOL: Mapping[str, About] = {
    "right_now": {
        "Headline tiles": (
            "Counted live from this system’s trips, exception reports, and the driver and vehicle records "
            "dispatchers keep. No refresh delay.",
        ),
        "Live trips": ("Created, underway or on hold",),
        "Licences & discs": ("Driver licences and vehicle licence discs by how soon they expire",),
        **_THIS_PAGE,
    },
    "activity": {
        "Trips over time": (
            "Closed trips only, from our trip records, dated by the driver’s first attested departure step in "
            "our phase ledger.",
        ),
        "Cancellations over time": (
            "Trip records: cancelled trips, by when they were cancelled, against every trip that ended in the "
            "same period.",
        ),
        "Busy patterns": (
            "Attested departure and in-transit steps drivers completed in the app (our phase ledger), by the time "
            "each was recorded. Steps a dispatcher completed are left out. Unlike the other charts, this one counts "
            "trips of any status.",
            "When are we busiest? Averages per day in South African time, over this section’s own period.",
            "Needs a full year of history to compare months fairly.",
        ),
        **_THIS_PAGE,
    },
    "on_time": {
        "On-time departures and arrivals": (
            _PLANNED_TIMES,
            "On time means on or before the plan.",
            "Left late and arrived late → a problem at the dock. Left on time but arrived late → a problem on "
            "the road.",
        ),
        "How late is late": (
            _PLANNED_TIMES,
            "On time means on or before the plan; early means more than 15 minutes ahead of it.",
        ),
        "Plans vs reality": (
            "Planned departure and arrival from trip creation, against the attested first departure and the "
            "recorded final arrival. Only closed trips with both planned times and an arrival are counted.",
            "over the whole period (View by doesn't change it)",
            "Faster than planned usually means the plan was too generous. It is not a measure of driving speed.",
        ),
        **_THIS_PAGE,
    },
    "problems": {
        "Problems tab": (
            "Dispatcher notes (recorded automatically for every cancellation and override) are not counted as "
            "problems, so totals can be lower than on driver pages.",
        ),
        "Problems over time": (_PROBLEM_REPORTS,),
        "Theft warning signs": (
            "Seal, trailer-separation, parcel, waybill, panic and receiver-ID reports in our ledger, on closed "
            "trips. The trailer check runs on the simulated Pulsit tracker feed; parcel and waybill counts come "
            "from the parcel feeds.",
            "A seal that could not be checked is a paperwork gap, not a theft sign, so it is left out.",
        ),
        "Most common problems": (_PROBLEM_REPORTS,),
        "Where in the trip": (_PROBLEM_REPORTS,),
        "Risky times of day": (
            "Our own ledger: driving minutes between each attested departure and arrival, split by South African "
            "quarter of the day, against problems linked to the driving step, by when the server received them. "
            "Any severity, closed trips only.",
            "If a block's problem share is much taller than its driving share, that time of day is riskier.",
            "A problem counts in the block when the server received it. A report sent from a phone with no "
            "signal may arrive later than it happened.",
        ),
        **_THIS_PAGE,
    },
    "review_desk": {
        "Review desk tab": (
            "Review figures cover every critical problem, on open and closed trips alike. Reviews recorded by "
            "the old system, before outcomes existed, are left out.",
            _REVIEWS,
        ),
        "Is the pile growing?": (
            "Critical problems still waiting for review at the end of each period (or now, for one still running)",
        ),
        "What reviews concluded": (
            'A large "data discrepancy" share means automatic checks are raising false alarms.',
        ),
        **_THIS_PAGE,
    },
    "evidence": {
        "Tracker agreement": (
            "The tracker check stored on each attested stop step of a closed trip; the driving step never gets a "
            "verdict. Truck positions come from a simulated Pulsit feed, not live trackers.",
        ),
        "Overrides over time": (
            "How many of every step on closed trips a dispatcher completed for the driver, from our phase ledger.",
            "An override skips the driver's photos, seal and tracker check: the weakest evidence we hold.",
        ),
        "Receiver sign-off": (
            "Attested sign-off steps on closed trips, the receiver QR scans recorded against them, and rejected "
            "scan attempts.",
            "Receiver QR sign-off went live on 13 Sep 2026.",
        ),
        **_THIS_PAGE,
    },
    "routes_and_sites": {
        "Busiest sites": (
            "Attested loading and unloading steps on closed trips, at the precincts set up in this system. An "
            "empty run’s unloading is not counted as a delivery.",
        ),
        "Driving time per lane": (
            "Each closed trip’s attested first departure to its recorded final arrival.",
            "Faded lanes have fewer than 5 trips, too few to compare fairly.",
        ),
        "Lane risk": (
            "Closed trips per lane and their exception reports, dispatcher notes left out. A trip without a known "
            "origin and destination is on no lane.",
        ),
        **_THIS_PAGE,
    },
    "cost": {
        "Cost tab": (
            "Estimates use your cost rates below. Cargo values come from Parcel Perfect waybills.",
            "Every estimate on this tab is worked out from these rates.",
        ),
        "Cost at a glance": (
            "Operating and delay cost are estimated from your cost rates (shown at the bottom of this tab). "
            "Cargo value is the declared value on Parcel Perfect waybills. Closed trips only.",
            "Delay cost is shown beside operating cost, never added to it: the driver’s late hours are already "
            "in operating cost.",
        ),
        "Operating cost over time": (
            "Estimated: truck road distance between each trip’s stops (OpenRouteService), or the straight line × "
            "road factor where a route couldn’t be looked up, × your fuel and running rates, plus driving time "
            "(first departure to final arrival) × driver rate, plus the fixed rate. Closed trips only.",
        ),
        "Delay cost on problem trips": (
            "Estimated: hours late at final arrival versus the plan, on closed trips that had at least one "
            "problem, × your delay rate. The problem may not have caused the delay.",
        ),
        "Cargo value exposed": (
            "From Parcel Perfect waybills: the declared value of every consignment on closed trips with a theft "
            "signal (seal, count, trailer, panic or receiver-ID finding). The whole load counts, because an "
            "exception isn’t linked to one consignment.",
        ),
        "Cost by lane": (
            "Estimated operating cost of each lane’s closed trips, from your cost rates. Delay cost and cargo "
            "value exposed are shown beside it, not added. A trip without a known origin and destination is on "
            "no lane.",
        ),
        **_THIS_PAGE,
    },
}


def about(tool_name: str) -> dict[str, list[str]]:
    """The page's lines for one tool's tab, ready to send as JSON."""
    return {title: list(lines) for title, lines in ABOUT_BY_TOOL[tool_name].items()}
