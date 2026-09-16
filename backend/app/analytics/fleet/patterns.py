"""Queries behind the busy-pattern charts (GET /analytics/fleet/patterns, spec §5.1, chart 1.3).

Departures are attested departure steps. Arrivals are attested in_transit steps: in_transit
completes when the driver taps "arrived" (phase_service.advance_in_transit). Every leg counts,
and so does every trip status, since a cancelled trip that left still kept the yard busy.
Overridden steps are left out: their time is a dispatcher's click, not when the truck moved.

Averages are per occurrence (spec G13): events that fell at 07:xx, divided by the number of
days in the period, and likewise for weekday, date and month. The counting happens in Python,
on SAST wall-clock time, so it reuses the calendar rules periods.py already unit-tests.
"""

import uuid
from collections import Counter
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.periods import (
    OPERATIONS_TZ,
    InstantRange,
    OccurrenceDays,
    Period,
    instant_range,
    occurrence_days,
)
from app.analytics.views import ATTESTED_PHASE_STATUSES
from app.db.models.enums import PhaseType
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip
from app.schemas.fleet_analytics import PatternBar, PatternSet, PatternsResponse, PeriodEcho

_HOURS_PER_DAY = 24


def build_pattern_set(instants: Iterable[datetime], days: OccurrenceDays) -> PatternSet:
    """Count events by SAST hour, weekday, date and month, each bar keeping its divisor."""
    local = [instant.astimezone(OPERATIONS_TZ) for instant in instants]
    hours = Counter(moment.hour for moment in local)
    weekdays = Counter(moment.weekday() for moment in local)
    dates = Counter(moment.day for moment in local)
    months = Counter(moment.month for moment in local)
    return PatternSet(
        hour_of_day=[
            PatternBar(key=hour, event_count=hours[hour], day_count=days.total_days)
            for hour in range(_HOURS_PER_DAY)
        ],
        weekday=[
            PatternBar(key=key, event_count=weekdays[key], day_count=count)
            for key, count in sorted(days.weekday.items())
        ],
        day_of_month=[
            PatternBar(key=key, event_count=dates[key], day_count=count)
            for key, count in sorted(days.day_of_month.items())
        ],
        month_of_year=[
            PatternBar(key=key, event_count=months[key], day_count=count)
            for key, count in sorted(days.month_of_year.items())
        ],
    )


async def attested_instants(
    db: AsyncSession, *, organization_id: uuid.UUID, phase_type: PhaseType, window: InstantRange,
) -> list[datetime]:
    """When each attested step of `phase_type` completed, for the organisation, in `window`."""
    result = await db.execute(
        select(PhaseEvent.completed_at)
        .join(Trip, Trip.id == PhaseEvent.trip_id)
        .where(
            Trip.operator_organization_id == organization_id,
            PhaseEvent.phase_type == phase_type,
            PhaseEvent.status.in_(ATTESTED_PHASE_STATUSES),
            PhaseEvent.completed_at >= window.start,
            PhaseEvent.completed_at < window.end,
        )
    )
    # The window filter already excludes NULL; this narrows the type.
    return [instant for instant in result.scalars().all() if instant is not None]


async def build_patterns(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> PatternsResponse:
    window = instant_range(period.start, period.end)
    days = occurrence_days(period.start, period.end)
    departures = await attested_instants(
        db, organization_id=organization_id, phase_type=PhaseType.DEPARTURE, window=window,
    )
    arrivals = await attested_instants(
        db, organization_id=organization_id, phase_type=PhaseType.IN_TRANSIT, window=window,
    )
    return PatternsResponse(
        period=PeriodEcho(start=period.start, end=period.end, grain=period.grain),
        departures=build_pattern_set(departures, days),
        arrivals=build_pattern_set(arrivals, days),
    )
