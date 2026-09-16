"""Queries behind the Problems tab (GET /analytics/fleet/problems, spec §5.3).

Every figure is about exceptions on the closed-trip set (spec G4), bucketed by the trip's first
departure like every other trend, and never counting dispatcher notes (spec D10): every
cancellation and override writes one, so counting them would make "problems" rise whenever a
dispatcher does their job.

Three reads (the problems with their linked step, closed trips per bucket, and driving legs),
then pure functions that shape each chart, so the rules are the ones the tests pin down.
"""

import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.base import closed_trips, gap_is_attested, trip_steps
from app.analytics.fleet.constants import DAY_BLOCKS, EXCLUDED_FROM_PROBLEMS, THEFT_SIGNAL_TYPES
from app.analytics.fleet.periods import (
    Bucket,
    Period,
    buckets,
    day_block,
    driving_minutes_by_block,
    instant_range,
    require_grain,
)
from app.analytics.stats import safe_ratio
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType, PhaseType
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.schemas.fleet_analytics import (
    PeriodEcho,
    ProblemsPerTripBucket,
    ProblemsResponse,
    ProblemStepCount,
    ProblemTypeCount,
    RiskyTimeBlock,
    TheftSignalsBucket,
)

# A problem with no linked phase event (phase_event_id IS NULL), e.g. a system check on the
# whole trip. Its own bar on chart 3.4, so those problems are never silently dropped.
UNLINKED_STEP = "unlinked"
# Plan order (PhaseType's own order), then "unlinked" last (spec §5.3, 3.4).
STEP_ORDER: tuple[str, ...] = (*(phase.value for phase in PhaseType), UNLINKED_STEP)
_SOURCE_ORDER: dict[ExceptionSource, int] = {source: index for index, source in enumerate(ExceptionSource)}


@dataclass(frozen=True)
class ProblemRow:
    """One exception on a closed trip, with the trip's bucket and the step it was raised at."""

    bucket_start: date
    exception_type: ExceptionType
    source: ExceptionSource
    severity: ExceptionSeverity
    created_at: datetime
    step: PhaseType | None


def per_trip(
    rows: Sequence[ProblemRow], trip_counts: dict[date, int], bucket_list: Sequence[Bucket],
) -> list[ProblemsPerTripBucket]:
    severities = Counter((row.bucket_start, row.severity) for row in rows)
    return [
        ProblemsPerTripBucket(
            bucket_start=bucket.start,
            is_partial=bucket.is_partial,
            trip_count=trip_counts.get(bucket.start, 0),
            info_count=severities[(bucket.start, ExceptionSeverity.INFO)],
            warning_count=severities[(bucket.start, ExceptionSeverity.WARNING)],
            critical_count=severities[(bucket.start, ExceptionSeverity.CRITICAL)],
        )
        for bucket in bucket_list
    ]


def theft_signals(rows: Sequence[ProblemRow], bucket_list: Sequence[Bucket]) -> list[TheftSignalsBucket]:
    """Only THEFT_SIGNAL_TYPES (spec D12). seal_unverified is not one: no departure seal
    existed to compare against, a paperwork gap rather than evidence of tampering."""
    counts = Counter((row.bucket_start, row.exception_type) for row in rows if row.exception_type in THEFT_SIGNAL_TYPES)
    result: list[TheftSignalsBucket] = []
    for bucket in bucket_list:
        by_type = {signal.value: counts[(bucket.start, signal)] for signal in THEFT_SIGNAL_TYPES}
        result.append(TheftSignalsBucket(
            bucket_start=bucket.start, is_partial=bucket.is_partial,
            total_count=sum(by_type.values()), by_type=by_type,
        ))
    return result


def by_type(rows: Sequence[ProblemRow]) -> list[ProblemTypeCount]:
    """(type, source) pairs that happened, the type with the most problems first. Ties go by
    type name and then source, so the order never shuffles between reloads."""
    counts = Counter((row.exception_type, row.source) for row in rows)
    totals = Counter(row.exception_type for row in rows)
    ordered = sorted(
        counts.items(),
        key=lambda item: (-totals[item[0][0]], item[0][0].value, _SOURCE_ORDER[item[0][1]]),
    )
    return [
        ProblemTypeCount(exception_type=exception_type, source=source, count=count)
        for (exception_type, source), count in ordered
    ]


def by_step(rows: Sequence[ProblemRow]) -> list[ProblemStepCount]:
    """Every step in plan order, zeros included, then "unlinked". The page decides which zero
    bars to hide (trip creation and activation), so the answer stays complete."""
    counts = Counter(row.step.value if row.step is not None else UNLINKED_STEP for row in rows)
    return [ProblemStepCount(step=step, count=counts[step]) for step in STEP_ORDER]


def risky_times(legs: Sequence[tuple[datetime, datetime]], rows: Sequence[ProblemRow]) -> list[RiskyTimeBlock]:
    """Share of driving time against share of problems raised during the driving step, per
    SAST quarter of the day (spec §5.3, D21). Any severity: critical-only would be almost
    always empty. Driving step only: a seal mismatch found at unloading is not a road risk.

    A problem counts in the block its created_at falls in, which is when the server received
    it. The page says so beside the table: a report from a phone with no signal can arrive late.
    """
    minutes = {block: 0.0 for block, _, _ in DAY_BLOCKS}
    for departed_at, arrived_at in legs:
        for block, value in driving_minutes_by_block(departed_at, arrived_at).items():
            minutes[block] += value
    road = Counter(day_block(row.created_at) for row in rows if row.step == PhaseType.IN_TRANSIT)
    total_minutes = sum(minutes.values())
    total_road = sum(road.values())
    return [
        RiskyTimeBlock(
            block=block,
            driving_minutes=minutes[block],
            driving_share=safe_ratio(minutes[block], total_minutes),
            road_problem_count=road[block],
            road_problem_share=safe_ratio(road[block], total_road),
        )
        for block, _, _ in DAY_BLOCKS
    ]


async def problem_rows(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> list[ProblemRow]:
    trips = closed_trips(organization_id, instant_range(period.start, period.end), require_grain(period))
    result = await db.execute(
        select(
            trips.c.bucket_start,
            TripException.exception_type,
            TripException.source,
            TripException.severity,
            TripException.created_at,
            PhaseEvent.phase_type,
        )
        .select_from(TripException)
        .join(trips, trips.c.trip_id == TripException.trip_id)
        .outerjoin(PhaseEvent, PhaseEvent.id == TripException.phase_event_id)
        .where(TripException.exception_type.not_in(list(EXCLUDED_FROM_PROBLEMS)))
    )
    return [
        ProblemRow(
            bucket_start=bucket_start,
            exception_type=ExceptionType(exception_type),
            source=ExceptionSource(source),
            severity=ExceptionSeverity(severity),
            created_at=created_at,
            step=None if phase_type is None else PhaseType(phase_type),
        )
        for bucket_start, exception_type, source, severity, created_at, phase_type in result.tuples().all()
    ]


async def trips_per_bucket(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> dict[date, int]:
    """Closed trips per bucket: the "per 100 trips" denominator."""
    trips = closed_trips(organization_id, instant_range(period.start, period.end), require_grain(period))
    result = await db.execute(select(trips.c.bucket_start, func.count()).group_by(trips.c.bucket_start))
    return {bucket_start: count for bucket_start, count in result.tuples().all()}


async def driving_legs(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> list[tuple[datetime, datetime]]:
    """(departed, arrived) for every driving leg of the closed-trip set (spec G14): an attested
    in_transit step straight after an attested departure."""
    trips = closed_trips(organization_id, instant_range(period.start, period.end), require_grain(period))
    steps = trip_steps(trips)
    result = await db.execute(
        select(steps.c.prev_completed_at, steps.c.completed_at).where(
            gap_is_attested(steps),
            steps.c.phase_type == PhaseType.IN_TRANSIT,
            steps.c.prev_phase_type == PhaseType.DEPARTURE,
        )
    )
    return [(departed_at, arrived_at) for departed_at, arrived_at in result.tuples().all()]


async def build_problems(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> ProblemsResponse:
    bucket_list = buckets(period)
    rows = await problem_rows(db, organization_id=organization_id, period=period)
    trip_counts = await trips_per_bucket(db, organization_id=organization_id, period=period)
    legs = await driving_legs(db, organization_id=organization_id, period=period)
    return ProblemsResponse(
        period=PeriodEcho(start=period.start, end=period.end, grain=period.grain),
        per_trip=per_trip(rows, trip_counts, bucket_list),
        theft_signals=theft_signals(rows, bucket_list),
        by_type=by_type(rows),
        by_step=by_step(rows),
        risky_times=risky_times(legs, rows),
    )
