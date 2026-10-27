"""Whole-period totals for each chat tool's result, worked out by our server (FP-295 spec B37).

The tabs return figures bucket by bucket (per week, per month). A model asked "how many
problems in the last 12 weeks?" then has to add the buckets up itself, and models are weak at
that: on 20 Oct `gemini-3.5-flash-lite` added the weekly warnings (16 + 17 = 33) and missed the
one critical, so it said 33 problems where there were 34. So every tool result now starts with a
`totals` block, summed here from the same rows the page draws, and the prompt tells the model to
read totals from it instead of adding rows.

Rates use the page's own rules (safe_ratio: no denominator → None, not 0; the tracker's agreement
leaves unwitnessed steps out, as the Evidence tab does). Medians and means can't be combined
across buckets, so none is invented here.

The same goes for every other kind of arithmetic the model used to do (analysis
2026-10-20-fp295-answer-accuracy-analysis.md §4, A2): "which is biggest" (leaders, with ties
listed), the lowest and highest rate, and the age of the oldest critical problem are all worked
out here. A leader is {"value": …, "of": [labels…]}; it is None when there's nothing to compare
(no rows, or every count is 0), so "none" is never dressed up as a winner.

Pure: no database, no I/O.
"""

import math
from collections.abc import Iterable
from datetime import date, datetime

from app.core.stats import safe_ratio
from app.schemas.cost_analytics import CostResponse
from app.schemas.fleet_analytics import (
    ActivityResponse,
    EvidenceResponse,
    FleetTilesResponse,
    OnTimeResponse,
    PatternSet,
    PatternsResponse,
    ProblemsResponse,
    ReviewResponse,
    RoutesResponse,
)

JsonObject = dict[str, object]

PER_100 = 100
SECONDS_PER_HOUR = 3600
HOURS_PER_DAY = 24
_DECIMALS = 2
_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August",
           "September", "October", "November", "December")


def percent(numerator: float, denominator: float) -> float | None:
    """A share as the page shows it: a percentage to one decimal, or None with nothing to divide by.
    Totals carry percents, not fractions, so the model never multiplies by 100 (eval run 3, q03)."""
    share = safe_ratio(numerator, denominator)
    return None if share is None else round(share * PER_100, 1)


def as_percent(share: float | None) -> float | None:
    """A row's own fraction (e.g. a week's on-time rate) as a percentage to one decimal."""
    return None if share is None else round(share * PER_100, 1)


def top(pairs: Iterable[tuple[str, float | None]], *, lowest: bool = False) -> JsonObject | None:
    """The label or labels sharing the highest (or lowest) value; every tie is listed.

    Missing values never count. For "highest", a zero isn't a winner either, so a period where nothing
    happened gives None instead of naming the first row.
    """
    known = [(label, value) for label, value in pairs if value is not None and (lowest or value > 0)]
    if not known:
        return None
    best = min(value for _, value in known) if lowest else max(value for _, value in known)
    return {"value": best, "of": [label for label, value in known if value == best]}


def bucket_label(start: date, is_partial: bool) -> str:
    """A week or month by its first day, flagged when it isn't a whole one."""
    return f"{start.isoformat()} (partial)" if is_partial else start.isoformat()


def activity_totals(response: ActivityResponse) -> JsonObject:
    loaded = sum(bucket.loaded_count for bucket in response.trips)
    empty = sum(bucket.empty_count for bucket in response.trips)
    cancelled = sum(bucket.cancelled_count for bucket in response.cancellations)
    ended = sum(bucket.ended_count for bucket in response.cancellations)
    return {
        "closed_trips": loaded + empty,
        "loaded_trips": loaded,
        "empty_trips": empty,
        "trips_ended": ended,
        "cancelled_trips": cancelled,
        "cancelled_percent": percent(cancelled, ended),
        "most_closed_trips_in": top(
            (bucket_label(b.bucket_start, b.is_partial), b.loaded_count + b.empty_count) for b in response.trips
        ),
        "most_cancelled_in": top(
            (bucket_label(b.bucket_start, b.is_partial), b.cancelled_count) for b in response.cancellations
        ),
    }


def _pattern_leaders(patterns: PatternSet) -> JsonObject:
    return {
        "total": sum(bar.event_count for bar in patterns.hour_of_day),
        "busiest_hour": top((f"{bar.key:02d}:00–{bar.key + 1:02d}:00", bar.average_per_day) for bar in patterns.hour_of_day),
        "busiest_weekday": top((_WEEKDAYS[bar.key], bar.average_per_day) for bar in patterns.weekday),
        "busiest_day_of_month": top((str(bar.key), bar.average_per_day) for bar in patterns.day_of_month),
        "busiest_month": top((_MONTHS[bar.key - 1], bar.average_per_day) for bar in patterns.month_of_year),
    }


def patterns_totals(response: PatternsResponse) -> JsonObject:
    return {"departures": _pattern_leaders(response.departures), "arrivals": _pattern_leaders(response.arrivals)}


def on_time_totals(response: OnTimeResponse) -> JsonObject:
    departures = sum(bucket.departures_with_plan for bucket in response.punctuality)
    on_time_departures = sum(bucket.on_time_departures for bucket in response.punctuality)
    arrivals = sum(bucket.arrivals_with_plan for bucket in response.punctuality)
    on_time_arrivals = sum(bucket.on_time_arrivals for bucket in response.punctuality)
    return {
        "departures_with_plan": departures,
        "on_time_departures": on_time_departures,
        "on_time_departure_percent": percent(on_time_departures, departures),
        "arrivals_with_plan": arrivals,
        "on_time_arrivals": on_time_arrivals,
        "on_time_arrival_percent": percent(on_time_arrivals, arrivals),
        "lowest_on_time_arrival_percent_in": top(
            ((bucket_label(b.bucket_start, b.is_partial), as_percent(b.on_time_arrival_rate)) for b in response.punctuality),
            lowest=True,
        ),
        "highest_on_time_arrival_percent_in": top(
            (bucket_label(b.bucket_start, b.is_partial), as_percent(b.on_time_arrival_rate)) for b in response.punctuality
        ),
        "lowest_on_time_departure_percent_in": top(
            ((bucket_label(b.bucket_start, b.is_partial), as_percent(b.on_time_departure_rate)) for b in response.punctuality),
            lowest=True,
        ),
        "highest_on_time_departure_percent_in": top(
            (bucket_label(b.bucket_start, b.is_partial), as_percent(b.on_time_departure_rate)) for b in response.punctuality
        ),
    }


def problems_totals(response: ProblemsResponse) -> JsonObject:
    trips = sum(bucket.trip_count for bucket in response.per_trip)
    info = sum(bucket.info_count for bucket in response.per_trip)
    warning = sum(bucket.warning_count for bucket in response.per_trip)
    critical = sum(bucket.critical_count for bucket in response.per_trip)
    theft_by_type: dict[str, int] = {}
    for bucket in response.theft_signals:
        for kind, count in bucket.by_type.items():
            theft_by_type[kind] = theft_by_type.get(kind, 0) + count
    return {
        "closed_trips": trips,
        "problems": info + warning + critical,
        "info": info,
        "warning": warning,
        "critical": critical,
        "warning_per_100_trips": safe_ratio(warning * PER_100, trips),
        "critical_per_100_trips": safe_ratio(critical * PER_100, trips),
        "theft_signals": sum(bucket.total_count for bucket in response.theft_signals),
        "theft_signals_by_type": {kind: count for kind, count in theft_by_type.items() if count},
        "most_problems_in": top(
            (bucket_label(b.bucket_start, b.is_partial), b.info_count + b.warning_count + b.critical_count)
            for b in response.per_trip
        ),
        "most_common_type": top(_type_counts(response).items()),
        "step_with_most_problems": top((step.step, step.count) for step in response.by_step),
        "riskiest_time_of_day": top((block.block.value, block.road_problem_count) for block in response.risky_times),
    }


def _type_counts(response: ProblemsResponse) -> dict[str, float | None]:
    """by_type splits a type by who raised it (system, driver…); "most common type" means across sources."""
    counts: dict[str, float | None] = {}
    for row in response.by_type:
        counts[row.exception_type.value] = (counts.get(row.exception_type.value) or 0) + row.count
    return counts


def review_totals(response: ReviewResponse) -> JsonObject:
    return {
        "critical_waiting_now": sum(band.count for band in response.waiting_by_age),
        "critical_reviewed_in_period": sum(bucket.reviewed_count for bucket in response.time_to_review),
        "reviews_concluded_in_period": sum(outcome.count for outcome in response.outcomes),
    }


def evidence_totals(response: EvidenceResponse) -> JsonObject:
    confirmed = sum(bucket.confirmed_count for bucket in response.tracker)
    mismatch = sum(bucket.mismatch_count for bucket in response.tracker)
    unwitnessed = sum(bucket.unwitnessed_count for bucket in response.tracker)
    steps = sum(bucket.phase_count for bucket in response.overrides)
    overridden = sum(bucket.override_count for bucket in response.overrides)
    confirmations = sum(bucket.confirmation_count for bucket in response.receiver_signoff)
    scans = sum(bucket.receiver_scan_count for bucket in response.receiver_signoff)
    return {
        "tracker_confirmed": confirmed,
        "tracker_mismatch": mismatch,
        "tracker_unwitnessed": unwitnessed,
        "tracker_agreement_percent": percent(confirmed, confirmed + mismatch),
        "steps": steps,
        "steps_overridden": overridden,
        "override_percent": percent(overridden, steps),
        "receiver_confirmations": confirmations,
        "receiver_qr_scans": scans,
        "receiver_scan_percent": percent(scans, confirmations),
        "lowest_tracker_agreement_percent_in": top(
            ((bucket_label(b.bucket_start, b.is_partial), as_percent(b.agreement_rate)) for b in response.tracker), lowest=True,
        ),
    }


def routes_totals(response: RoutesResponse) -> JsonObject:
    return {
        "lanes": len(response.lanes),
        "trips_on_lanes": sum(lane.trip_count for lane in response.lanes),
        "problems_on_lanes": sum(lane.problem_count for lane in response.lanes),
        "sites": len(response.sites),
        "pickups": sum(site.pickup_count for site in response.sites),
        "deliveries": sum(site.delivery_count for site in response.sites),
        "lane_with_most_problems": top((_lane(lane.origin_name, lane.destination_name), lane.problem_count) for lane in response.lanes),
        "lane_with_most_problems_per_trip": top(
            (_lane(lane.origin_name, lane.destination_name), lane.problems_per_trip) for lane in response.lanes
        ),
        "busiest_site": top((site.precinct_name or "unnamed site", site.pickup_count + site.delivery_count) for site in response.sites),
    }


def _lane(origin: str | None, destination: str | None) -> str:
    return f"{origin or 'unnamed site'} → {destination or 'unnamed site'}"


def cost_totals(response: CostResponse) -> JsonObject:
    """The headline cost figures are already whole-period (operating, delay, exposure); these are the
    "which week or month / which lane" questions on top of them."""
    return {
        "costliest_in": top(
            (bucket_label(b.start, b.is_partial), round(b.fuel + b.running + b.driver + b.fixed, _DECIMALS)) for b in response.buckets
        ),
        "highest_delay_cost_in": top((bucket_label(b.start, b.is_partial), b.delay_cost) for b in response.buckets),
        "most_value_exposed_in": top(
            (bucket_label(b.start, b.is_partial), round(b.value_under_review + b.value_reviewed, _DECIMALS)) for b in response.buckets
        ),
        "costliest_lane": top((_lane(lane.origin_name, lane.destination_name), lane.operating_total) for lane in response.lanes),
    }


def right_now_totals(response: FleetTilesResponse, now: datetime) -> JsonObject:
    """How long the oldest critical problem has waited, ready to say ("5 days 17 hours"), so the model
    never works an age out: not from a timestamp, and not by splitting total hours into days and hours
    (it did, wrongly, in eval run 3: "5 days and 13 hours", "5 days and 137 hours")."""
    oldest = response.critical_waiting.oldest_created_at
    if oldest is None:
        return {"oldest_critical_waiting": None}
    total_hours = math.floor(max((now - oldest).total_seconds(), 0) / SECONDS_PER_HOUR)
    days, hours = divmod(total_hours, HOURS_PER_DAY)
    return {"oldest_critical_waiting": {
        "since": oldest.isoformat(), "days": days, "hours": hours,
        "as_words": f"{days} day{'s' if days != 1 else ''} {hours} hour{'s' if hours != 1 else ''}",
        "total_hours": total_hours,
    }}
