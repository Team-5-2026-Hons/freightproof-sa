"""Vehicle grain — horses and trailers. Supersedes FP-153 §5's "horses only": a trip
counts for its horse and every trailer on it; a breakdown counts for the recorded
vehicle, or the trip's horse when none was recorded."""

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
    """Closed trips this vehicle has run since its most recent mechanical incident.
    Live, never stored (spec §5) — a current-state fact, not a period count. Uses the
    same attribution as the vehicle_incident_streaks view: incidents recorded against
    this vehicle, or against no vehicle on a trip it was the horse of (trailer
    analytics spec, decision 2). No incident returns all closed trips."""
    # Departure from the phase ledger, not trips.actual_departure_at, which holds
    # only the last leg's departure on a multi-stop trip.
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
    # Same attribution rule as the views.
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
        # (departed_at, id) ordering matches the view's window, so ties resolve deterministically.
        count_stmt = count_stmt.where(
            tuple_(departures.c.departed_at, Trip.id)
            > tuple_(last_incident.departed_at, last_incident.trip_id)
        )

    return (await db.execute(count_stmt)).scalar_one()
