"""Queries behind the Cost tab (GET /analytics/fleet/cost, FP-294).

Every figure is about closed trips bucketed by first attested departure, like every other
fleet tab. Three kinds of figure, kept apart because only one is real data:
  - operating cost: ESTIMATED from the organisation's rates (app/analytics/cost_model.py);
  - delay cost: ESTIMATED, hours late at final arrival on trips that had a problem;
  - value exposed: REAL, the declared waybill value on trips with a theft signal.

Leg distances are looked up by orchestration (this layer may not import integrations) and
passed in, so the queries here stay pure database reads.
"""

import uuid
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.cost_model import (
    ZERO_COST,
    CostParts,
    CostRates,
    LegDistance,
    delay_cost,
    late_hours,
    to_rand,
    to_tenths,
    trip_operating_cost,
)
from app.analytics.fleet.base import closed_trips
from app.analytics.fleet.constants import EXCLUDED_FROM_PROBLEMS, THEFT_SIGNAL_TYPES
from app.analytics.fleet.on_time import TripTimes, arrival_delay
from app.analytics.fleet.periods import SECONDS_PER_MINUTE, Bucket, Period, buckets, instant_range, require_grain
from app.db.models.enums import ExceptionReviewStatus
from app.db.models.organisations import Precinct
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, TripStop
from app.schemas.cost_analytics import CostBucket, DelayCost, OperatingCost, ValueExposed

_SECONDS_PER_HOUR = Decimal(SECONDS_PER_MINUTE) * 60


@dataclass(frozen=True)
class StopPoint:
    precinct_id: uuid.UUID
    latitude: Decimal
    longitude: Decimal


LegKey = tuple[uuid.UUID, uuid.UUID]


def leg_keys(stops: Sequence[StopPoint]) -> list[LegKey]:
    return [(a.precinct_id, b.precinct_id) for a, b in zip(stops, stops[1:])]


@dataclass
class LaneTotals:
    """One origin -> destination lane, built up trip by trip. Rand in Decimal."""

    origin_precinct_id: uuid.UUID
    destination_precinct_id: uuid.UUID
    trip_count: int = 0
    trips_costed: int = 0
    operating: Decimal = Decimal(0)
    delay: Decimal = Decimal(0)
    value_exposed: Decimal = Decimal(0)
    routed_legs: int = 0
    estimated_legs: int = 0


@dataclass(frozen=True)
class CostFigures:
    """Everything the Cost tab shows except names and rates, which orchestration adds."""

    operating: OperatingCost
    delay: DelayCost
    exposure: ValueExposed
    buckets: list[CostBucket]
    lanes: list[LaneTotals]


@dataclass
class _Bucket:
    parts: CostParts = ZERO_COST
    delay: Decimal = Decimal(0)
    under_review: Decimal = Decimal(0)
    reviewed: Decimal = Decimal(0)


@dataclass
class _Exposure:
    under_review: bool = False
    values: list[Decimal | None] = field(default_factory=list)


async def trip_routes(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> dict[uuid.UUID, list[StopPoint]]:
    """Each closed trip's stops in order, with their coordinates. One query for every trip.

    Ordered by TripStop.sequence and never by its value: the app numbers stops from 0, some
    seed scripts from 1, so only the order is meaningful.
    """
    trips = closed_trips(organization_id, instant_range(period.start, period.end), require_grain(period))
    result = await db.execute(
        select(TripStop.trip_id, TripStop.precinct_id, Precinct.latitude, Precinct.longitude)
        .join(trips, trips.c.trip_id == TripStop.trip_id)
        .join(Precinct, Precinct.id == TripStop.precinct_id)
        .order_by(TripStop.trip_id, TripStop.sequence)
    )
    routes: dict[uuid.UUID, list[StopPoint]] = defaultdict(list)
    for trip_id, precinct_id, latitude, longitude in result.tuples().all():
        routes[trip_id].append(StopPoint(precinct_id, latitude, longitude))
    return dict(routes)


@dataclass(frozen=True)
class _TripRow:
    trip_id: uuid.UUID
    bucket_start: date
    origin_precinct_id: uuid.UUID | None
    destination_precinct_id: uuid.UUID | None
    departed_at: datetime
    planned_departure_at: datetime | None
    planned_arrival_at: datetime | None
    actual_arrival_at: datetime | None


async def _load(
    db: AsyncSession, organization_id: uuid.UUID, period: Period,
) -> tuple[list[_TripRow], set[uuid.UUID], dict[uuid.UUID, _Exposure]]:
    """The closed trips, which of them had a problem, and the theft-signal trips with their
    review state and consignment values. Four queries, none per trip."""
    window = instant_range(period.start, period.end)
    grain = require_grain(period)
    trips = closed_trips(organization_id, window, grain)
    trip_result = await db.execute(
        select(
            trips.c.trip_id, trips.c.bucket_start, trips.c.origin_precinct_id, trips.c.destination_precinct_id,
            trips.c.departed_at, trips.c.planned_departure_at, trips.c.planned_arrival_at, trips.c.actual_arrival_at,
        )
    )
    rows = [_TripRow(*row) for row in trip_result.tuples().all()]

    problem_trips = closed_trips(organization_id, window, grain)
    problem_result = await db.execute(
        select(TripException.trip_id)
        .join(problem_trips, problem_trips.c.trip_id == TripException.trip_id)
        .where(TripException.exception_type.not_in(list(EXCLUDED_FROM_PROBLEMS)))
        .distinct()
    )
    problems = set(problem_result.scalars().all())

    theft_trips = closed_trips(organization_id, window, grain)
    theft_result = await db.execute(
        select(TripException.trip_id, TripException.review_status)
        .join(theft_trips, theft_trips.c.trip_id == TripException.trip_id)
        .where(TripException.exception_type.in_(list(THEFT_SIGNAL_TYPES)))
    )
    exposed: dict[uuid.UUID, _Exposure] = {}
    for trip_id, review_status in theft_result.tuples().all():
        entry = exposed.setdefault(trip_id, _Exposure())
        entry.under_review = entry.under_review or review_status != ExceptionReviewStatus.REVIEWED
    if exposed:
        value_result = await db.execute(
            select(Consignment.trip_id, Consignment.declared_value).where(Consignment.trip_id.in_(list(exposed)))
        )
        for consignment_trip_id, declared_value in value_result.tuples().all():
            if consignment_trip_id is not None:
                exposed[consignment_trip_id].values.append(declared_value)
    return rows, problems, exposed


def _trip_km(stops: Sequence[StopPoint], legs: Mapping[LegKey, LegDistance]) -> tuple[Decimal, int, int]:
    """km over the trip's legs, plus how many legs were routed and how many estimated."""
    distances = [legs[key] for key in leg_keys(stops)]
    routed = sum(1 for leg in distances if leg.routed)
    return sum((leg.km for leg in distances), start=Decimal(0)), routed, len(distances) - routed


@dataclass(frozen=True)
class CostInputs:
    """What build_cost needs besides the database: the rates, each trip's stops (from
    trip_routes) and the distance of every leg in them (from orchestration's lookup)."""

    rates: CostRates
    routes: Mapping[uuid.UUID, Sequence[StopPoint]]
    legs: Mapping[LegKey, LegDistance]


@dataclass
class _Totals:
    """The period's running totals, added to trip by trip. Rand in Decimal."""

    inputs: CostInputs
    by_bucket: dict[date, _Bucket]
    lanes: dict[LegKey, LaneTotals] = field(default_factory=dict)
    operating: CostParts = ZERO_COST
    km: Decimal = Decimal(0)
    costed: int = 0
    routed_legs: int = 0
    estimated_legs: int = 0
    late_hours: Decimal = Decimal(0)
    delay: Decimal = Decimal(0)
    late_trips: int = 0
    lateness_unknown: int = 0

    def lane_for(self, row: _TripRow) -> LaneTotals | None:
        """A trip with an unknown endpoint is on no lane (as lane_trips does)."""
        if row.origin_precinct_id is None or row.destination_precinct_id is None:
            return None
        key = (row.origin_precinct_id, row.destination_precinct_id)
        lane = self.lanes.setdefault(key, LaneTotals(*key))
        lane.trip_count += 1
        return lane

    def add_operating(self, row: _TripRow, bucket: _Bucket, lane: LaneTotals | None) -> None:
        """Only with a final arrival: driving time needs both ends (spec D6)."""
        if row.actual_arrival_at is None:
            return
        km, routed, estimated = _trip_km(self.inputs.routes.get(row.trip_id, []), self.inputs.legs)
        hours = Decimal(repr((row.actual_arrival_at - row.departed_at).total_seconds())) / _SECONDS_PER_HOUR
        parts = trip_operating_cost(km, hours, self.inputs.rates)
        self.operating, bucket.parts = self.operating + parts, bucket.parts + parts
        self.km += km
        self.costed += 1
        self.routed_legs += routed
        self.estimated_legs += estimated
        if lane is not None:
            lane.trips_costed += 1
            lane.operating += parts.total
            lane.routed_legs += routed
            lane.estimated_legs += estimated

    def add_delay(self, row: _TripRow, bucket: _Bucket, lane: LaneTotals | None) -> None:
        """Hours late at final arrival on a problem trip (spec D7). Never added to operating (D8)."""
        hours_late = late_hours(arrival_delay(TripTimes(
            row.bucket_start, row.departed_at, row.planned_departure_at, row.planned_arrival_at, row.actual_arrival_at,
        )))
        if hours_late is None:
            self.lateness_unknown += 1
            return
        if hours_late == 0:
            return
        cost = delay_cost(hours_late, self.inputs.rates)
        self.late_trips += 1
        self.late_hours += hours_late
        self.delay += cost
        bucket.delay += cost
        if lane is not None:
            lane.delay += cost

    @staticmethod
    def add_exposure(exposure: _Exposure, bucket: _Bucket, lane: LaneTotals | None) -> None:
        """The whole load's declared value (spec D9); a missing value is counted, never R0'd in."""
        value = sum((v for v in exposure.values if v is not None), start=Decimal(0))
        if exposure.under_review:
            bucket.under_review += value
        else:
            bucket.reviewed += value
        if lane is not None:
            lane.value_exposed += value


def _figures(totals: _Totals, rows: Sequence[_TripRow], problems: set[uuid.UUID],
             exposed: Mapping[uuid.UUID, _Exposure], bucket_list: Sequence[Bucket]) -> CostFigures:
    under_review = sum((b.under_review for b in totals.by_bucket.values()), start=Decimal(0))
    reviewed = sum((b.reviewed for b in totals.by_bucket.values()), start=Decimal(0))
    return CostFigures(
        operating=OperatingCost(
            fuel=to_rand(totals.operating.fuel), running=to_rand(totals.operating.running),
            driver=to_rand(totals.operating.driver), fixed=to_rand(totals.operating.fixed),
            total=to_rand(totals.operating.total), trips_costed=totals.costed,
            trips_not_costed=len(rows) - totals.costed, distance_km=to_tenths(totals.km),
            legs_routed=totals.routed_legs, legs_estimated=totals.estimated_legs,
        ),
        delay=DelayCost(
            cost=to_rand(totals.delay), late_hours=to_tenths(totals.late_hours), problem_trips=len(problems),
            late_problem_trips=totals.late_trips, lateness_unknown=totals.lateness_unknown,
        ),
        exposure=ValueExposed(
            under_review=to_rand(under_review), reviewed=to_rand(reviewed), total=to_rand(under_review + reviewed),
            trips=len(exposed),
            consignments_without_value=sum(e.values.count(None) for e in exposed.values()),
            trips_without_consignments=sum(1 for e in exposed.values() if not e.values),
        ),
        buckets=[_bucket_out(b, totals.by_bucket[b.start]) for b in bucket_list],
        lanes=list(totals.lanes.values()),
    )


def _bucket_out(bucket: Bucket, sums: _Bucket) -> CostBucket:
    return CostBucket(
        start=bucket.start, is_partial=bucket.is_partial,
        fuel=to_rand(sums.parts.fuel), running=to_rand(sums.parts.running),
        driver=to_rand(sums.parts.driver), fixed=to_rand(sums.parts.fixed),
        delay_cost=to_rand(sums.delay),
        value_under_review=to_rand(sums.under_review), value_reviewed=to_rand(sums.reviewed),
    )


async def build_cost(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period, inputs: CostInputs,
) -> CostFigures:
    """The Cost tab's figures, every one from the closed-trip set of the period."""
    rows, problems, exposed = await _load(db, organization_id, period)
    bucket_list = buckets(period)
    totals = _Totals(inputs=inputs, by_bucket={bucket.start: _Bucket() for bucket in bucket_list})
    for row in rows:
        bucket = totals.by_bucket[row.bucket_start]
        lane = totals.lane_for(row)
        totals.add_operating(row, bucket, lane)
        if row.trip_id in problems:
            totals.add_delay(row, bucket, lane)
        if row.trip_id in exposed:
            totals.add_exposure(exposed[row.trip_id], bucket, lane)
    return _figures(totals, rows, problems, exposed, bucket_list)
