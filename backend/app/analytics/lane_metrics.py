"""Lane grain — origin -> destination precinct pairs.

The one grain where road time is the subject rather than noise (spec §6).
"""

import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.stats import validate_month_range
from app.analytics.views import LaneAnalyticsView
from app.schemas.analytics import DurationStats, LaneMetrics


@dataclass
class _LanePool:
    """Running totals for one lane while its months are folded together."""

    trip_count: int = 0
    exception_count: int = 0
    actual_transit_minutes: list[float] = field(default_factory=list)
    schedule_delta_minutes: list[float] = field(default_factory=list)


async def get_lane_metrics(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    start_month: date,
    end_month: date,
    origin_precinct_id: uuid.UUID | None = None,
    destination_precinct_id: uuid.UUID | None = None,
) -> list[LaneMetrics]:
    """Every lane with at least one closed trip departing in [start_month, end_month].

    Monthly arrays are concatenated and each statistic is computed once over the pooled
    list: a median or P90 of the months' medians is not the median of the range, so the
    raw observations are the only thing that can be carried across months.
    """
    validate_month_range(start_month, end_month)

    view = LaneAnalyticsView
    # Columns, not entities — see rollup.sum_over_months on the identity map.
    stmt = (
        select(
            view.origin_precinct_id,
            view.destination_precinct_id,
            view.trip_count,
            view.exception_count,
            view.actual_transit_minutes,
            view.schedule_delta_minutes,
        )
        .where(
            view.operator_organization_id == organization_id,
            view.month_start.between(start_month, end_month),
        )
        .order_by(view.origin_precinct_id, view.destination_precinct_id, view.month_start)
    )
    if origin_precinct_id is not None:
        stmt = stmt.where(view.origin_precinct_id == origin_precinct_id)
    if destination_precinct_id is not None:
        stmt = stmt.where(view.destination_precinct_id == destination_precinct_id)

    pools: dict[tuple[uuid.UUID, uuid.UUID], _LanePool] = {}
    for row in (await db.execute(stmt)).all():
        pool = pools.setdefault((row.origin_precinct_id, row.destination_precinct_id), _LanePool())
        pool.trip_count += row.trip_count
        pool.exception_count += row.exception_count
        pool.actual_transit_minutes.extend(row.actual_transit_minutes)
        pool.schedule_delta_minutes.extend(row.schedule_delta_minutes)

    return [
        LaneMetrics(
            origin_precinct_id=origin,
            destination_precinct_id=destination,
            trip_count=pool.trip_count,
            exception_count=pool.exception_count,
            actual_transit_minutes=DurationStats.from_values(pool.actual_transit_minutes),
            schedule_delta_minutes=DurationStats.from_values(pool.schedule_delta_minutes),
        )
        for (origin, destination), pool in pools.items()
    ]
