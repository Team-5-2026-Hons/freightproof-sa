"""Facility grain — Pulsit geofence corroboration per precinct (spec §8).

The one metric every source agreed on: corroboration rate per precinct.
"""

import uuid
from collections.abc import Sequence
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.rollup import sum_over_months
from app.analytics.views import FacilityAnalyticsView
from app.schemas.analytics import FacilityMetrics


async def get_facility_metrics(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    start_month: date,
    end_month: date,
    precinct_ids: Sequence[uuid.UUID] | None = None,
) -> list[FacilityMetrics]:
    """Every precinct where this organisation's closed trips (departing in range) had an
    attested, non-in-transit phase."""
    rows = await sum_over_months(
        db,
        view=FacilityAnalyticsView,
        key_column="precinct_id",
        organization_id=organization_id,
        start_month=start_month,
        end_month=end_month,
        key_ids=precinct_ids,
    )
    return [FacilityMetrics.model_validate(dict(row)) for row in rows]
