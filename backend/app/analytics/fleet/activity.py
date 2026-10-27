"""Queries behind the Activity tab's trend charts (GET /analytics/fleet/activity).
Chart 1.1 buckets by first departure; chart 1.7 buckets by
closed_at instead, since a cancelled trip may never have departed."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.analytics.fleet.base import closed_trips, sast_bucket
from app.analytics.fleet.periods import InstantRange, Period, buckets, instant_range, require_grain
from app.db.models.enums import TripStatus, TripType
from app.db.models.trips import Trip
from app.schemas.fleet_analytics import (
    ActivityResponse,
    CancellationsBucket,
    CancelledTrip,
    PeriodEcho,
    TripsBucket,
)

_ENDED_STATUSES: tuple[TripStatus, TripStatus] = (TripStatus.CLOSED, TripStatus.CANCELLED)


async def trips_by_bucket(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> list[TripsBucket]:
    trips = closed_trips(
        organization_id, instant_range(period.start, period.end), require_grain(period),
    )
    result = await db.execute(
        select(
            trips.c.bucket_start,
            func.count().filter(trips.c.trip_type == TripType.LOADED),
            func.count().filter(trips.c.trip_type == TripType.EMPTY_LEG),
        ).group_by(trips.c.bucket_start)
    )
    counts = {bucket_start: (loaded, empty) for bucket_start, loaded, empty in result.tuples().all()}
    return [
        TripsBucket(
            bucket_start=bucket.start,
            is_partial=bucket.is_partial,
            loaded_count=counts.get(bucket.start, (0, 0))[0],
            empty_count=counts.get(bucket.start, (0, 0))[1],
        )
        for bucket in buckets(period)
    ]


def _ended_in(organization_id: uuid.UUID, window: InstantRange) -> tuple[ColumnElement[bool], ...]:
    """Filters for the organisation's trips that closed or were cancelled within `window`."""
    return (
        Trip.operator_organization_id == organization_id,
        Trip.status.in_(_ENDED_STATUSES),
        Trip.closed_at >= window.start,
        Trip.closed_at < window.end,
    )


async def cancellations_by_bucket(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> list[CancellationsBucket]:
    window = instant_range(period.start, period.end)
    ended = (
        select(
            Trip.status.label("status"),
            sast_bucket(Trip.closed_at, require_grain(period)).label("bucket_start"),
        )
        .where(*_ended_in(organization_id, window))
        .subquery()
    )
    result = await db.execute(
        select(
            ended.c.bucket_start,
            func.count().filter(ended.c.status == TripStatus.CANCELLED),
            func.count(),
        ).group_by(ended.c.bucket_start)
    )
    counts = {bucket_start: (cancelled, total) for bucket_start, cancelled, total in result.tuples().all()}
    return [
        CancellationsBucket(
            bucket_start=bucket.start,
            is_partial=bucket.is_partial,
            cancelled_count=counts.get(bucket.start, (0, 0))[0],
            ended_count=counts.get(bucket.start, (0, 0))[1],
        )
        for bucket in buckets(period)
    ]


async def cancelled_trips(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> list[CancelledTrip]:
    """Every trip cancelled in the period, newest first: the table under chart 1.7."""
    window = instant_range(period.start, period.end)
    result = await db.execute(
        select(Trip.id, Trip.trip_reference, Trip.closed_at)
        .where(*_ended_in(organization_id, window), Trip.status == TripStatus.CANCELLED)
        .order_by(Trip.closed_at.desc(), Trip.trip_reference)
    )
    return [
        CancelledTrip(trip_id=trip_id, trip_reference=reference, cancelled_at=closed_at)
        for trip_id, reference, closed_at in result.tuples().all()
        if closed_at is not None
    ]


async def build_activity(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> ActivityResponse:
    trips = await trips_by_bucket(db, organization_id=organization_id, period=period)
    cancellations = await cancellations_by_bucket(db, organization_id=organization_id, period=period)
    cancelled = await cancelled_trips(db, organization_id=organization_id, period=period)
    return ActivityResponse(
        period=PeriodEcho(start=period.start, end=period.end, grain=period.grain),
        trips=trips,
        cancellations=cancellations,
        cancelled_trips=cancelled,
    )
