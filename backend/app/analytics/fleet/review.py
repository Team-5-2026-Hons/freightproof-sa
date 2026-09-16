"""Queries behind the Review desk tab (GET /analytics/fleet/review, spec §5.4).

Not limited to closed trips: reviewing an exception is independent of the trip's status
(exception_service.review_exception). Only critical exceptions enter the review queue on
their own (exception_service.initial_review_status), so the queue charts read critical ones.
Everywhere, rows marked legacy_review are left out: that outcome is a migration marker saying
"reviewed before outcomes existed", not a finding.
"""

import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.analytics.fleet.periods import (
    SECONDS_PER_HOUR,
    Bucket,
    Period,
    ReviewAgeBand,
    bucket_start,
    buckets,
    instant_range,
    next_bucket_start,
    require_grain,
    review_age_band,
    sast_date,
    start_of_day,
    waiting_at,
)
from app.analytics.stats import MEDIAN_FRACTION, percentile, safe_ratio
from app.db.models.enums import (
    DispatcherReviewOutcome,
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
    ExceptionSeverity,
)
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.schemas.fleet_analytics import (
    PeriodEcho,
    QueueBucket,
    ReviewOutcomeCount,
    ReviewResponse,
    TimeToReviewBucket,
    WaitingAgeBar,
)


@dataclass(frozen=True)
class ReviewPair:
    """One critical exception's life in the queue: raised, and reviewed (None if still waiting)."""

    created_at: datetime
    reviewed_at: datetime | None


def _not_legacy() -> ColumnElement[bool]:
    return or_(
        TripException.review_outcome.is_(None),
        TripException.review_outcome != ExceptionReviewOutcome.LEGACY_REVIEW,
    )


def _in_organisation(organization_id: uuid.UUID) -> ColumnElement[bool]:
    return Trip.operator_organization_id == organization_id


def _hours(later: datetime, earlier: datetime) -> float:
    return (later - earlier).total_seconds() / SECONDS_PER_HOUR


def waiting_by_age(created: Sequence[datetime], now: datetime) -> list[WaitingAgeBar]:
    """Chart 4.1: every band, zeros included, youngest first."""
    counts = Counter(review_age_band(now - created_at) for created_at in created)
    return [WaitingAgeBar(band=band, count=counts[band]) for band in ReviewAgeBand]


def queue(pairs: Sequence[ReviewPair], period: Period, bucket_list: Sequence[Bucket], now: datetime) -> list[QueueBucket]:
    """Chart 4.2: how many were waiting at each bucket's end. A bucket cut short by the period,
    or still running, is measured at the period's end or now, whichever comes first, so the
    last point never counts reviews that have not happened yet as "still waiting"."""
    grain = require_grain(period)
    period_end = start_of_day(period.end + timedelta(days=1))
    items = [(pair.created_at, pair.reviewed_at) for pair in pairs]
    return [
        QueueBucket(
            bucket_start=bucket.start,
            is_partial=bucket.is_partial,
            waiting_at_end=waiting_at(
                items, min(start_of_day(next_bucket_start(bucket.start, grain)), period_end, now),
            ),
        )
        for bucket in bucket_list
    ]


def time_to_review(pairs: Sequence[ReviewPair], period: Period, bucket_list: Sequence[Bucket]) -> list[TimeToReviewBucket]:
    """Chart 4.3: critical problems reviewed in each bucket (by SAST reviewed_at), with the
    median and mean hours they had waited."""
    grain = require_grain(period)
    hours: dict[object, list[float]] = {bucket.start: [] for bucket in bucket_list}
    for pair in pairs:
        if pair.reviewed_at is None:
            continue
        key = bucket_start(sast_date(pair.reviewed_at), grain)
        if key in hours:
            hours[key].append(_hours(pair.reviewed_at, pair.created_at))
    return [
        TimeToReviewBucket(
            bucket_start=bucket.start,
            is_partial=bucket.is_partial,
            reviewed_count=len(hours[bucket.start]),
            median_hours=percentile(hours[bucket.start], MEDIAN_FRACTION),
            mean_hours=safe_ratio(sum(hours[bucket.start]), len(hours[bucket.start])),
        )
        for bucket in bucket_list
    ]


async def critical_pairs(db: AsyncSession, *, organization_id: uuid.UUID) -> list[ReviewPair]:
    """Every critical exception of the organisation, whole history: an item raised long
    before the period can still be waiting inside it."""
    result = await db.execute(
        select(TripException.created_at, TripException.reviewed_at)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(
            _in_organisation(organization_id),
            TripException.severity == ExceptionSeverity.CRITICAL,
            _not_legacy(),
        )
    )
    return [ReviewPair(created_at, reviewed_at) for created_at, reviewed_at in result.tuples().all()]


async def waiting_now(db: AsyncSession, *, organization_id: uuid.UUID) -> list[datetime]:
    """When each critical exception still in the review queue was raised (chart 4.1)."""
    result = await db.execute(
        select(TripException.created_at)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(
            _in_organisation(organization_id),
            TripException.severity == ExceptionSeverity.CRITICAL,
            TripException.review_status == ExceptionReviewStatus.NEEDS_REVIEW,
        )
    )
    return list(result.scalars().all())


async def outcomes(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> list[ReviewOutcomeCount]:
    """Chart 4.4: reviews of any severity concluded in the period, one row per outcome a
    dispatcher can choose, zeros included, in the enum's order."""
    window = instant_range(period.start, period.end)
    result = await db.execute(
        select(TripException.review_outcome, func.count())
        .join(Trip, Trip.id == TripException.trip_id)
        .where(
            _in_organisation(organization_id),
            TripException.review_outcome.is_not(None),
            _not_legacy(),
            TripException.reviewed_at >= window.start,
            TripException.reviewed_at < window.end,
        )
        .group_by(TripException.review_outcome)
    )
    # The column is a String, so rows come back as plain strings; normalising through the
    # enum makes the lookup below independent of that.
    counts = {
        ExceptionReviewOutcome(outcome).value: count
        for outcome, count in result.tuples().all()
        if outcome is not None
    }
    return [ReviewOutcomeCount(outcome=outcome, count=counts.get(outcome.value, 0)) for outcome in DispatcherReviewOutcome]


async def build_review(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period, now: datetime,
) -> ReviewResponse:
    bucket_list = buckets(period)
    pairs = await critical_pairs(db, organization_id=organization_id)
    waiting = await waiting_now(db, organization_id=organization_id)
    concluded = await outcomes(db, organization_id=organization_id, period=period)
    return ReviewResponse(
        period=PeriodEcho(start=period.start, end=period.end, grain=period.grain),
        waiting_by_age=waiting_by_age(waiting, now),
        queue=queue(pairs, period, bucket_list, now),
        time_to_review=time_to_review(pairs, period, bucket_list),
        outcomes=concluded,
    )
