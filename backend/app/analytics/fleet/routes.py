"""Queries behind the Routes & sites tab (spec §5.6): GET /analytics/fleet/routes and
GET /analytics/fleet/incidents. Period only: sites, lanes and pins are totals over the whole
period, never a time axis.

Sites and lanes are over the closed-trip set (spec G4). The incident map is over every report
in the period, any trip status, because a report's location is evidence the moment it arrives.
Precinct names are attached by the service (by id only, spec G16); this module returns ids.
"""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.analytics.fleet.base import closed_trips, trip_steps
from app.analytics.fleet.constants import EXCLUDED_FROM_PROBLEMS
from app.analytics.fleet.periods import SECONDS_PER_MINUTE, InstantRange, Period, instant_range
from app.analytics.views import ATTESTED_PHASE_STATUSES
from app.db.models.enums import ExceptionSeverity, ExceptionType, PhaseType, TripType
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.schemas.fleet_analytics import IncidentPin


@dataclass(frozen=True)
class SiteCounts:
    precinct_id: uuid.UUID
    pickup_count: int
    delivery_count: int


@dataclass
class LaneTrips:
    """One origin -> destination lane, built up trip by trip."""

    origin_precinct_id: uuid.UUID
    destination_precinct_id: uuid.UUID
    trip_count: int = 0
    driving_minutes: list[float] = field(default_factory=list)
    problem_count: int = 0


def _is_problem() -> ColumnElement[bool]:
    return TripException.exception_type.not_in(list(EXCLUDED_FROM_PROBLEMS))


async def site_counts(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> list[SiteCounts]:
    """Chart 1.6: attested loading steps (pickups) and attested unloading steps on LOADED trips
    (deliveries), per site. An empty run's plan still ends in an unloading step at its final
    stop (phase_plan.build_phase_plan), but nothing is delivered there, so it doesn't count."""
    steps = trip_steps(closed_trips(organization_id, instant_range(period.start, period.end)))
    is_pickup = steps.c.phase_type == PhaseType.LOADING
    is_delivery = (steps.c.phase_type == PhaseType.UNLOADING) & (steps.c.trip_type == TripType.LOADED)
    result = await db.execute(
        select(TripStop.precinct_id, func.count().filter(is_pickup), func.count().filter(is_delivery))
        .select_from(steps)
        .join(TripStop, TripStop.id == steps.c.trip_stop_id)
        .where(
            steps.c.status.in_(ATTESTED_PHASE_STATUSES),
            steps.c.phase_type.in_([PhaseType.LOADING, PhaseType.UNLOADING]),
        )
        .group_by(TripStop.precinct_id)
    )
    return [
        SiteCounts(precinct_id=precinct_id, pickup_count=pickups, delivery_count=deliveries)
        for precinct_id, pickups, deliveries in result.tuples().all()
        # A site whose only steps were empty-run unloadings saw neither.
        if pickups + deliveries > 0
    ]


async def lane_trips(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> list[LaneTrips]:
    """Charts 2.4 and 6.3: closed trips per lane, each with its driving time (first attested
    departure to final arrival, the lane view's actual_transit_minutes) and its problems
    (dispatcher notes excluded, spec D10). A trip with an unknown endpoint is on no lane."""
    window = instant_range(period.start, period.end)
    trips = closed_trips(organization_id, window)
    trip_rows = await db.execute(
        select(
            trips.c.trip_id,
            trips.c.origin_precinct_id,
            trips.c.destination_precinct_id,
            trips.c.departed_at,
            trips.c.actual_arrival_at,
        ).where(trips.c.origin_precinct_id.is_not(None), trips.c.destination_precinct_id.is_not(None))
    )
    problem_trips = closed_trips(organization_id, window)
    problem_rows = await db.execute(
        select(TripException.trip_id, func.count())
        .join(problem_trips, problem_trips.c.trip_id == TripException.trip_id)
        .where(_is_problem())
        .group_by(TripException.trip_id)
    )
    problems = {trip_id: count for trip_id, count in problem_rows.tuples().all()}

    lanes: dict[tuple[uuid.UUID, uuid.UUID], LaneTrips] = {}
    for trip_id, origin_id, destination_id, departed_at, arrived_at in trip_rows.tuples().all():
        lane = lanes.setdefault((origin_id, destination_id), LaneTrips(origin_id, destination_id))
        lane.trip_count += 1
        lane.problem_count += problems.get(trip_id, 0)
        if arrived_at is not None:
            lane.driving_minutes.append((arrived_at - departed_at).total_seconds() / SECONDS_PER_MINUTE)
    return list(lanes.values())


async def incident_pins(
    db: AsyncSession, *, organization_id: uuid.UUID, window: InstantRange,
) -> tuple[list[IncidentPin], int]:
    """Chart 3.6: every located report in the window, any trip status, newest first, and how
    many reports had no location. Selects only what a pin shows: nothing about the driver."""
    in_scope = (
        Trip.operator_organization_id == organization_id,
        _is_problem(),
        TripException.created_at >= window.start,
        TripException.created_at < window.end,
    )
    located = await db.execute(
        select(
            TripException.id,
            TripException.trip_id,
            Trip.trip_reference,
            TripException.exception_type,
            TripException.severity,
            TripException.created_at,
            TripException.gps_lat,
            TripException.gps_lng,
        )
        .join(Trip, Trip.id == TripException.trip_id)
        .where(*in_scope, TripException.gps_lat.is_not(None), TripException.gps_lng.is_not(None))
        .order_by(TripException.created_at.desc(), TripException.id)
    )
    unlocated = await db.execute(
        select(func.count())
        .select_from(TripException)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(*in_scope, or_(TripException.gps_lat.is_(None), TripException.gps_lng.is_(None)))
    )
    pins = [
        IncidentPin(
            exception_id=exception_id,
            trip_id=trip_id,
            trip_reference=reference,
            exception_type=ExceptionType(exception_type),
            severity=ExceptionSeverity(severity),
            created_at=created_at,
            lat=float(lat),
            lng=float(lng),
        )
        for exception_id, trip_id, reference, exception_type, severity, created_at, lat, lng in located.tuples().all()
        # The query already excludes NULL coordinates; this narrows the type.
        if lat is not None and lng is not None
    ]
    return pins, unlocated.scalar_one()
