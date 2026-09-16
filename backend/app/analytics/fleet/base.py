"""Shared SQLAlchemy Core builders for the fleet queries, rebuilt from FP-153's views
as typed Core expressions (house style, see app/analytics/views.py; spec D8, G1-G4).
Every builder filters by organisation first (spec G1)."""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import CTE, Date, Select, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.sql.selectable import Subquery

from app.analytics.fleet.constants import OPERATIONS_TIME_ZONE_NAME
from app.analytics.fleet.periods import Grain, InstantRange, sast_date
from app.analytics.views import ATTESTED_PHASE_STATUSES
from app.db.models.enums import PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip


def sast_bucket(
    instant: ColumnElement[Any] | InstrumentedAttribute[Any], grain: Grain,
) -> ColumnElement[date]:
    """The first SAST day of the week/month/year an instant falls in (spec G4).
    timezone(zone, instant) is Postgres's AT TIME ZONE: it converts the stored UTC
    instant to SAST wall-clock time before truncating."""
    return cast(func.date_trunc(grain.value, func.timezone(OPERATIONS_TIME_ZONE_NAME, instant)), Date)


def trip_departures(organization_id: uuid.UUID) -> CTE:
    """Each of the organisation's trips with its first attested departure (spec G3).
    Read from the phase ledger, not trips.actual_departure_at, which is overwritten
    on every leg of a multi-stop trip and so holds only the last departure."""
    return (
        select(PhaseEvent.trip_id, func.min(PhaseEvent.completed_at).label("departed_at"))
        .join(Trip, Trip.id == PhaseEvent.trip_id)
        .where(
            Trip.operator_organization_id == organization_id,
            PhaseEvent.phase_type == PhaseType.DEPARTURE,
            PhaseEvent.status.in_(ATTESTED_PHASE_STATUSES),
            PhaseEvent.completed_at.is_not(None),
        )
        .group_by(PhaseEvent.trip_id)
        .cte("trip_departures")
    )


def closed_trips(
    organization_id: uuid.UUID, window: InstantRange, grain: Grain | None = None,
) -> CTE:
    """The organisation's closed trips whose first departure falls in `window` (spec G4).

    Closed only, because an open trip's numbers are not final yet. With a grain, each row
    also carries bucket_start: the first SAST day of the bucket its departure falls in.
    """
    departures = trip_departures(organization_id)
    stmt: Select[Any] = (
        select(
            Trip.id.label("trip_id"),
            Trip.trip_type,
            Trip.driver_id,
            Trip.horse_id,
            Trip.origin_precinct_id,
            Trip.destination_precinct_id,
            Trip.planned_departure_at,
            Trip.planned_arrival_at,
            Trip.actual_arrival_at,
            departures.c.departed_at,
        )
        .join(departures, departures.c.trip_id == Trip.id)
        .where(
            Trip.operator_organization_id == organization_id,
            Trip.status == TripStatus.CLOSED,
            departures.c.departed_at >= window.start,
            departures.c.departed_at < window.end,
        )
    )
    if grain is not None:
        stmt = stmt.add_columns(sast_bucket(departures.c.departed_at, grain).label("bucket_start"))
    return stmt.cte("closed_trips")


def trip_steps(trips: CTE) -> Subquery:
    """Every phase row of `trips`, beside the plan step before it (spec G15). The
    window runs over every row, trip_creation included, so the previous row is
    always the true previous plan step; filter only afterwards."""
    bucket = [trips.c.bucket_start] if "bucket_start" in trips.c else []
    # Carried so a query can tell a delivery on a loaded trip from an empty run's last stop.
    trip_type = [trips.c.trip_type] if "trip_type" in trips.c else []
    stmt: Select[Any] = select(
        PhaseEvent.id.label("phase_event_id"),
        PhaseEvent.trip_id,
        *bucket,
        *trip_type,
        PhaseEvent.phase_type,
        PhaseEvent.status,
        PhaseEvent.trip_stop_id,
        PhaseEvent.dispatcher_override_user_id,
        PhaseEvent.pulsit_geofence_confirmed,
        PhaseEvent.anchor_status,
        PhaseEvent.completed_at,
        func.lag(PhaseEvent.phase_type)
        .over(partition_by=PhaseEvent.trip_id, order_by=PhaseEvent.sequence_number)
        .label("prev_phase_type"),
        func.lag(PhaseEvent.status)
        .over(partition_by=PhaseEvent.trip_id, order_by=PhaseEvent.sequence_number)
        .label("prev_status"),
        func.lag(PhaseEvent.completed_at)
        .over(partition_by=PhaseEvent.trip_id, order_by=PhaseEvent.sequence_number)
        .label("prev_completed_at"),
    ).join(trips, trips.c.trip_id == PhaseEvent.trip_id)
    return stmt.subquery("trip_steps")


def gap_is_attested(steps: Subquery) -> ColumnElement[bool]:
    """A gap between two steps is a real measurement only when BOTH ends were attested
    (FP-153's _GAP_IS_ATTESTED). An overridden end's time is a dispatcher's click."""
    return and_(
        steps.c.status.in_(ATTESTED_PHASE_STATUSES),
        steps.c.prev_status.in_(ATTESTED_PHASE_STATUSES),
        steps.c.completed_at.is_not(None),
        steps.c.prev_completed_at.is_not(None),
    )


async def earliest_trip_date(db: AsyncSession, *, organization_id: uuid.UUID) -> date | None:
    """The SAST day the organisation's first trip was created: where "All time" starts
    (G11). created_at rather than departure, so "All time" also reaches cancelled
    trips that never left. None when the organisation has no trips."""
    result = await db.execute(
        select(func.min(Trip.created_at)).where(Trip.operator_organization_id == organization_id)
    )
    first: datetime | None = result.scalar_one()
    return sast_date(first) if first is not None else None
