"""How many trips a fleet analytics period covers (FP-295 "Based on" line).

Every tab counts the same set: the organisation's closed trips whose first attested
departure falls in the period (base.closed_trips). The chat's "Based on" line quotes that
count, so a dispatcher can see how much data an answer rests on.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.base import closed_trips
from app.analytics.fleet.periods import Period, instant_range


async def closed_trip_count(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> int:
    """The organisation's closed trips that first departed within the period (SAST days)."""
    trips = closed_trips(organization_id, instant_range(period.start, period.end))
    result = await db.execute(select(func.count()).select_from(trips))
    return int(result.scalar_one())
