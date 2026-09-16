"""Queries behind the On time tab (GET /analytics/fleet/on-time, spec §5.2, D23, D24).

One read over the closed-trip set (spec G4): each trip's times (first departure, plans, final
arrival). Everything else is pure arithmetic over those rows, in the functions below, so "on
time", "how late" and the plan spread follow the rules the unit tests and the consistency test
with the driver pages check.

On time is strict, on or before the plan, exactly as the driver view's on_time_departure_rate
(spec D9). The plan spread uses the lane view's schedule delta: actual trip time minus planned
trip time, from the first attested departure (never trips.actual_departure_at, spec G3).
"""

import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.base import closed_trips
from app.analytics.fleet.periods import (
    SECONDS_PER_MINUTE,
    Bucket,
    LatenessBand,
    Period,
    PlanBand,
    buckets,
    instant_range,
    lateness_band,
    plan_band,
    require_grain,
)
from app.analytics.stats import MEDIAN_FRACTION, percentile
from app.schemas.fleet_analytics import (
    Lateness,
    LatenessBar,
    OnTimeResponse,
    PeriodEcho,
    PlanBandCount,
    PlanSpread,
    PunctualityBucket,
)


@dataclass(frozen=True)
class TripTimes:
    """One closed trip's timings. departed_at is its first attested departure (spec G3)."""

    bucket_start: date
    departed_at: datetime
    planned_departure_at: datetime | None
    planned_arrival_at: datetime | None
    actual_arrival_at: datetime | None


def _minutes(later: datetime, earlier: datetime) -> float:
    return (later - earlier).total_seconds() / SECONDS_PER_MINUTE


def _median(values: Sequence[float]) -> float | None:
    return percentile(values, MEDIAN_FRACTION)


def departure_delay(trip: TripTimes) -> float | None:
    """Minutes the first departure was after its plan (negative = early). None without a plan."""
    if trip.planned_departure_at is None:
        return None
    return _minutes(trip.departed_at, trip.planned_departure_at)


def arrival_delay(trip: TripTimes) -> float | None:
    """Minutes the final arrival was after its plan. None without a plan or an arrival."""
    if trip.planned_arrival_at is None or trip.actual_arrival_at is None:
        return None
    return _minutes(trip.actual_arrival_at, trip.planned_arrival_at)


def plan_delta(trip: TripTimes) -> float | None:
    """Actual trip time minus planned trip time, in minutes: the lane view's
    schedule_delta_minutes. None unless both plans and the arrival exist."""
    if trip.planned_departure_at is None or trip.planned_arrival_at is None or trip.actual_arrival_at is None:
        return None
    actual = _minutes(trip.actual_arrival_at, trip.departed_at)
    planned = _minutes(trip.planned_arrival_at, trip.planned_departure_at)
    return actual - planned


def punctuality(trips: Sequence[TripTimes], bucket_list: Sequence[Bucket]) -> list[PunctualityBucket]:
    rows: list[PunctualityBucket] = []
    for bucket in bucket_list:
        inside = [trip for trip in trips if trip.bucket_start == bucket.start]
        departures = [delay for delay in map(departure_delay, inside) if delay is not None]
        arrivals = [delay for delay in map(arrival_delay, inside) if delay is not None]
        rows.append(PunctualityBucket(
            bucket_start=bucket.start,
            is_partial=bucket.is_partial,
            departures_with_plan=len(departures),
            on_time_departures=sum(1 for delay in departures if delay <= 0),
            arrivals_with_plan=len(arrivals),
            on_time_arrivals=sum(1 for delay in arrivals if delay <= 0),
        ))
    return rows


def _bands(delays: Sequence[float]) -> list[LatenessBar]:
    counts = Counter(lateness_band(delay) for delay in delays)
    return [LatenessBar(band=band, trip_count=counts[band]) for band in LatenessBand]


def lateness(trips: Sequence[TripTimes]) -> Lateness:
    """Chart 2.2 over the whole period. Early + On time always equals chart 2.1's on-time
    count: both are "delay <= 0", split only at EARLY_THRESHOLD_MINUTES."""
    return Lateness(
        departures=_bands([delay for delay in map(departure_delay, trips) if delay is not None]),
        arrivals=_bands([delay for delay in map(arrival_delay, trips) if delay is not None]),
    )


def plan_spread(trips: Sequence[TripTimes]) -> PlanSpread:
    """Chart 2.5 over the whole period: every trip with a full plan in one of nine bands."""
    deltas = [delta for delta in map(plan_delta, trips) if delta is not None]
    counts = Counter(plan_band(delta) for delta in deltas)
    early = [-delta for delta in deltas if delta < 0]
    over = [delta for delta in deltas if delta > 0]
    return PlanSpread(
        bands=[PlanBandCount(band=band, trip_count=counts[band]) for band in PlanBand],
        early_count=len(early),
        over_count=len(over),
        on_plan_count=len(deltas) - len(early) - len(over),
        median_early_minutes=_median(early),
        median_over_minutes=_median(over),
    )


async def trip_times(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> list[TripTimes]:
    trips = closed_trips(organization_id, instant_range(period.start, period.end), require_grain(period))
    result = await db.execute(
        select(
            trips.c.bucket_start,
            trips.c.departed_at,
            trips.c.planned_departure_at,
            trips.c.planned_arrival_at,
            trips.c.actual_arrival_at,
        )
    )
    return [TripTimes(*row) for row in result.tuples().all()]


async def build_on_time(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> OnTimeResponse:
    trips = await trip_times(db, organization_id=organization_id, period=period)
    return OnTimeResponse(
        period=PeriodEcho(start=period.start, end=period.end, grain=period.grain),
        punctuality=punctuality(trips, buckets(period)),
        lateness=lateness(trips),
        plan_spread=plan_spread(trips),
    )
