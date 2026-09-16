"""Service functions for the fleet-wide Analytics page (fleet analytics spec §7.1).

Sits between the endpoints and app/analytics/fleet/. It works out "today" in South African
time, resolves and validates periods, supplies the orchestration facts the query layer is not
allowed to import (which phases carry a blockchain receipt), and calls one query module per
endpoint.

Layering: imports analytics/, db/, orchestration/ and schemas/ only. Never api/ or auth/.

Precinct names are looked up by id ONLY, with no organisation or is_shared filter, for the
same reason as analytics_service._precinct_names: a precinct belongs to the CLIENT, so an
operator filter would name almost no depot, and the ids come only from this operator's own
trips, so naming them reveals only places its trucks have been (spec G16).
"""

import uuid
from collections.abc import Collection
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.activity import build_activity
from app.analytics.fleet.base import earliest_trip_date
from app.analytics.fleet.evidence import build_evidence
from app.analytics.fleet.on_time import build_on_time
from app.analytics.fleet.patterns import build_patterns
from app.analytics.fleet.problems import build_problems
from app.analytics.fleet.review import build_review
from app.analytics.fleet.routes import incident_pins, lane_trips, site_counts
from app.analytics.fleet.periods import (
    Grain,
    Period,
    build_period,
    instant_range,
    resolve_start,
    today_sast,
)
from app.analytics.fleet.tiles import get_fleet_tiles
from app.db.models.organisations import Precinct
from app.schemas.analytics import DurationStats
from app.schemas.fleet_analytics import (
    ActivityResponse,
    EvidenceResponse,
    FleetTilesResponse,
    IncidentsResponse,
    LaneRisk,
    OnTimeResponse,
    PatternsResponse,
    PeriodEcho,
    ProblemsResponse,
    ReviewResponse,
    RoutesResponse,
    SiteActivity,
)


async def get_tiles(
    db: AsyncSession, *, organization_id: uuid.UUID, now: datetime | None = None,
) -> FleetTilesResponse:
    """The four headline tiles as of `now` (default: this moment)."""
    return await get_fleet_tiles(db, organization_id=organization_id, today=today_sast(now))


async def resolve_period_start(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    start: date | None,
    end: date,
    now: datetime | None = None,
) -> date:
    """The period's first day. An omitted start is "All time", which begins at the
    organisation's first trip, so this reads the database. It validates nothing: that is
    check_period's job, kept separate so the endpoint can catch exactly that as a 422."""
    if start is not None:
        return start
    earliest = await earliest_trip_date(db, organization_id=organization_id)
    return resolve_start(None, end=end, earliest_activity=earliest, today=today_sast(now))


def check_period(
    *, start: date, end: date, grain: Grain | None, now: datetime | None = None,
) -> Period:
    """Raise ValueError, with a message for the dispatcher, for a period the charts cannot
    answer: ending after today, starting after it ends, or too many bars (spec G12)."""
    return build_period(start=start, end=end, grain=grain, today=today_sast(now))


async def get_activity(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> ActivityResponse:
    return await build_activity(db, organization_id=organization_id, period=period)


async def get_patterns(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> PatternsResponse:
    return await build_patterns(db, organization_id=organization_id, period=period)


async def get_on_time(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> OnTimeResponse:
    return await build_on_time(db, organization_id=organization_id, period=period)


async def get_problems(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> ProblemsResponse:
    return await build_problems(db, organization_id=organization_id, period=period)


async def get_review(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period, now: datetime | None = None,
) -> ReviewResponse:
    """Review desk figures. `now` anchors "waiting now" and the still-running bucket."""
    return await build_review(
        db, organization_id=organization_id, period=period, now=now if now is not None else datetime.now(UTC),
    )


async def get_evidence(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> EvidenceResponse:
    """Evidence figures. Which phases owe a receipt is orchestration's fact, passed in."""
    return await build_evidence(
        db, organization_id=organization_id, period=period,
    )


async def _precinct_names(db: AsyncSession, precinct_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
    """By id only, deliberately (module docstring, spec G16)."""
    if not precinct_ids:
        return {}
    result = await db.execute(select(Precinct.id, Precinct.name).where(Precinct.id.in_(precinct_ids)))
    return dict(result.tuples().all())


async def get_routes(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> RoutesResponse:
    """Busiest sites and lanes over the period, named. Both busiest first, ties by name, so the
    order never shuffles between reloads."""
    sites = await site_counts(db, organization_id=organization_id, period=period)
    lanes = await lane_trips(db, organization_id=organization_id, period=period)
    names = await _precinct_names(
        db,
        {site.precinct_id for site in sites}
        | {lane.origin_precinct_id for lane in lanes}
        | {lane.destination_precinct_id for lane in lanes},
    )
    site_rows = sorted(
        (
            SiteActivity(
                precinct_id=site.precinct_id, precinct_name=names.get(site.precinct_id),
                pickup_count=site.pickup_count, delivery_count=site.delivery_count,
            )
            for site in sites
        ),
        key=lambda row: (-(row.pickup_count + row.delivery_count), row.precinct_name or ""),
    )
    lane_rows = sorted(
        (
            LaneRisk(
                origin_precinct_id=lane.origin_precinct_id,
                origin_name=names.get(lane.origin_precinct_id),
                destination_precinct_id=lane.destination_precinct_id,
                destination_name=names.get(lane.destination_precinct_id),
                trip_count=lane.trip_count,
                driving_minutes=DurationStats.from_values(lane.driving_minutes),
                problem_count=lane.problem_count,
            )
            for lane in lanes
        ),
        key=lambda row: (-row.trip_count, row.origin_name or "", row.destination_name or ""),
    )
    return RoutesResponse(
        period=PeriodEcho(start=period.start, end=period.end, grain=period.grain),
        sites=site_rows,
        lanes=lane_rows,
    )


async def get_incidents(
    db: AsyncSession, *, organization_id: uuid.UUID, period: Period,
) -> IncidentsResponse:
    pins, unlocated = await incident_pins(
        db, organization_id=organization_id, window=instant_range(period.start, period.end),
    )
    return IncidentsResponse(
        period=PeriodEcho(start=period.start, end=period.end, grain=period.grain),
        pins=pins,
        unlocated_count=unlocated,
    )
