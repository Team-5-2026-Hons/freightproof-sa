"""Sum a monthly analytics view across a month range — the "sum first" half of rule 1.

Shared by the driver, vehicle and facility grains, whose views hold only counts and
sums. Lane pools arrays instead and has its own query in lane_metrics.py.
"""

import uuid
from collections.abc import Sequence
from datetime import date

from sqlalchemy import RowMapping, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.stats import validate_month_range
from app.analytics.views import AnalyticsViewBase


async def sum_over_months(
    db: AsyncSession,
    *,
    view: type[AnalyticsViewBase],
    key_column: str,
    organization_id: uuid.UUID,
    start_month: date,
    end_month: date,
    key_ids: Sequence[uuid.UUID] | None,
) -> list[RowMapping]:
    """One row per entity: `key_column` plus the SUM of every non-grain column.

    Every non-grain column of these views is a raw count or sum by construction, so
    summing them all is always correct — no column here is a pre-divided rate. The
    month bounds are inclusive first-of-month dates.

    Selects columns, never ORM entities: an entity would enter the session's identity
    map, and a later read in the same session after a refresh would be served the
    pre-refresh values.
    """
    validate_month_range(start_month, end_month)

    columns = view.__table__.c
    key = columns[key_column]
    measures = [func.sum(column).label(column.key) for column in columns if not column.primary_key]

    stmt = (
        select(key, *measures)
        .where(
            columns["operator_organization_id"] == organization_id,
            columns["month_start"].between(start_month, end_month),
        )
        .group_by(key)
        .order_by(key)
    )
    if key_ids is not None:
        stmt = stmt.where(key.in_(key_ids))

    result = await db.execute(stmt)
    return list(result.mappings().all())
