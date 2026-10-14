"""Driver grain — per-driver exceptions, on-time departure, phase dwell and overrides."""

import uuid
from collections.abc import Sequence
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.rollup import sum_over_months
from app.analytics.views import DriverAnalyticsView
from app.schemas.analytics import DriverMetrics


async def get_driver_metrics(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    start_month: date,
    end_month: date,
    driver_ids: Sequence[uuid.UUID] | None = None,
) -> list[DriverMetrics]:
    """Every driver with at least one closed trip departing in [start_month, end_month].

    Counts and sums are added across the months first; DriverMetrics then divides once.
    """
    rows = await sum_over_months(
        db,
        view=DriverAnalyticsView,
        key_column="driver_id",
        organization_id=organization_id,
        start_month=start_month,
        end_month=end_month,
        key_ids=driver_ids,
    )
    return [DriverMetrics.model_validate(dict(row)) for row in rows]
