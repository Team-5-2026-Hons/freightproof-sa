"""The "Based on" line under a chat answer (FP-295 spec D9, §7.5).

Built here from the tool calls that actually ran, never by the model, so the line can't
misstate where a figure came from. The trip count is the period's closed trips, the scope
every tab counts (analytics/fleet/scope.py).
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.scope import closed_trip_count
from app.orchestration.analytics_chat.tools import ToolOutcome
from app.schemas.analytics_chat import Basis


async def basis_for(db: AsyncSession, *, organization_id: uuid.UUID, outcome: ToolOutcome) -> Basis | None:
    """The Basis for one tool run, or None if it failed (a failed run rests nothing on data)."""
    if outcome.tool is None or outcome.error is not None:
        return None
    period = outcome.period
    if period is None:
        return Basis(
            tool=outcome.tool.name, tab=outcome.tool.tab, label=outcome.tool.label,
            start=None, end=None, grain=None, closed_trip_count=None,
        )
    count = await closed_trip_count(db, organization_id=organization_id, period=period)
    return Basis(
        tool=outcome.tool.name, tab=outcome.tool.tab, label=outcome.tool.label,
        start=period.start, end=period.end,
        grain=None if period.grain is None else period.grain.value,
        closed_trip_count=count,
    )
