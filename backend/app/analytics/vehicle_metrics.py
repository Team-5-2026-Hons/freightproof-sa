"""Vehicle grain — horses and trailers.

The trailer analytics spec (docs/design-notes/2026-09-12-trailer-analytics-spec.md)
supersedes FP-153 §5's "horses only". A trip counts for its horse and for every trailer
on it. A breakdown counts only for the vehicle it was recorded against, or for the trip's
horse when no vehicle was recorded.
"""

import uuid
from collections.abc import Sequence
from datetime import date

from sqlalchemy import and_, exists, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.rollup import sum_over_months
from app.analytics.views import (
    ATTESTED_PHASE_STATUSES,
    VehicleAnalyticsView,
    VehicleIncidentStreaksView,
)
from app.db.models.enums import ExceptionType, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripTrailer
from app.schemas.analytics import VehicleMetrics, VehicleStreak


async def get_vehicle_metrics(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    start_month: date,
    end_month: date,
    vehicle_ids: Sequence[uuid.UUID] | None = None,
) -> list[VehicleMetrics]:
    """Every vehicle, horse or trailer, with at least one closed trip departing in
    [start_month, end_month]."""
    rows = await sum_over_months(
        db,
        view=VehicleAnalyticsView,
        key_column="vehicle_id",
        organization_id=organization_id,
        start_month=start_month,
        end_month=end_month,
        key_ids=vehicle_ids,
    )
    return [VehicleMetrics.model_validate(dict(row)) for row in rows]


async def get_vehicle_streaks(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    vehicle_ids: Sequence[uuid.UUID] | None = None,
) -> list[VehicleStreak]:
    """Whole-history streaks. Takes no month range: a streak filtered to "last 3 months"
    has no meaning — it is either still running or it is not (spec §3a)."""
    view = VehicleIncidentStreaksView
    # Columns, not entities — see rollup.sum_over_months on the identity map.
    stmt = (
        select(view.vehicle_id, view.highest_streak_trips, view.lowest_streak_trips)
        .where(view.operator_organization_id == organization_id)
        .order_by(view.vehicle_id)
    )
    if vehicle_ids is not None:
        stmt = stmt.where(view.vehicle_id.in_(vehicle_ids))

    result = await db.execute(stmt)
    return [VehicleStreak.model_validate(dict(row)) for row in result.mappings()]


async def trips_since_last_incident(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    vehicle_id: uuid.UUID,
) -> int:
    """Closed trips this vehicle, horse or trailer, has run since its most recent
    mechanical incident.

    Live, never stored (spec §5): it is a current-state fact, not a period activity
    count, and has no meaning inside a month bucket. Reads the base tables with the SAME
    definitions the vehicle_incident_streaks view uses, so this number always equals that
    view's open segment:
      - a closed trip is on the vehicle when the vehicle is its horse or one of its
        trailers;
      - trips are ordered by their ledger departure;
      - an incident is a trip with at least one MECHANICAL exception belonging to this
        vehicle: recorded against it, or recorded against no vehicle on a trip it was the
        horse of (trailer analytics spec, decision 2).
    A vehicle with no incident returns all its closed trips: the streak has run since its
    first trip.
    """
    # Departure from the phase ledger, not trips.actual_departure_at: that cache is
    # overwritten on every leg of a multi-stop trip and holds the LAST departure.
    departures = (
        select(PhaseEvent.trip_id, func.min(PhaseEvent.completed_at).label("departed_at"))
        .where(
            PhaseEvent.phase_type == PhaseType.DEPARTURE,
            PhaseEvent.status.in_(ATTESTED_PHASE_STATUSES),
            PhaseEvent.completed_at.is_not(None),
        )
        .group_by(PhaseEvent.trip_id)
        .subquery()
    )
    on_this_vehicle = or_(
        Trip.horse_id == vehicle_id,
        exists().where(TripTrailer.trip_id == Trip.id, TripTrailer.trailer_id == vehicle_id),
    )
    closed_trips_of_vehicle = (
        Trip.operator_organization_id == organization_id,
        on_this_vehicle,
        Trip.status == TripStatus.CLOSED,
    )
    # The views' attribution rule, exactly: a breakdown recorded against this vehicle, or
    # one recorded against no vehicle on a trip this vehicle was the horse of.
    is_incident = exists().where(
        TripException.trip_id == Trip.id,
        TripException.exception_type == ExceptionType.MECHANICAL,
        or_(
            TripException.vehicle_id == vehicle_id,
            and_(TripException.vehicle_id.is_(None), Trip.horse_id == vehicle_id),
        ),
    )

    last_incident = (
        await db.execute(
            select(departures.c.departed_at, Trip.id.label("trip_id"))
            .join(departures, departures.c.trip_id == Trip.id)
            .where(*closed_trips_of_vehicle, is_incident)
            .order_by(departures.c.departed_at.desc(), Trip.id.desc())
            .limit(1)
        )
    ).one_or_none()

    count_stmt = (
        select(func.count())
        .select_from(Trip)
        .join(departures, departures.c.trip_id == Trip.id)
        .where(*closed_trips_of_vehicle)
    )
    if last_incident is not None:
        # (departed_at, id) ordering, identical to the view's window, so two trips
        # departing at the same instant still fall on a deterministic side of the incident.
        count_stmt = count_stmt.where(
            tuple_(departures.c.departed_at, Trip.id)
            > tuple_(last_incident.departed_at, last_incident.trip_id)
        )

    return (await db.execute(count_stmt)).scalar_one()
