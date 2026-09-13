"""Read-only ORM mappings for the FP-153 analytics views.

Mapped on their own DeclarativeBase, deliberately NOT on app.db.models.Base: anything on
Base.metadata is created as a real TABLE by the test suite's create_all(), and would be
proposed as a new table by Alembic autogenerate. These relations are plain views, worked
out from the evidence tables on every read (migration tom_live_analytics_views); this
module only describes their columns so queries use typed attributes instead of raw SQL
strings.

The primary keys below are each view's grain, declared only because the ORM needs an
identity: a plain view has no index or constraint behind them. Nothing is ever written
through these classes.
"""

import uuid
from datetime import date

from sqlalchemy import Date, Double, Integer
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.db.models.enums import PhaseStatus

# Phase statuses that mean "the driver actually did this, at completed_at". OVERRIDDEN is
# excluded: its completed_at is the dispatcher's click and it never ran corroboration.
# The migration's SQL uses the same pair; this copy serves the live (non-view) query in
# vehicle_metrics.trips_since_last_incident.
ATTESTED_PHASE_STATUSES: tuple[PhaseStatus, ...] = (PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION)


class AnalyticsViewBase(DeclarativeBase):
    pass


class DriverAnalyticsView(AnalyticsViewBase):
    __tablename__ = "driver_analytics"

    operator_organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    driver_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    month_start: Mapped[date] = mapped_column(Date, primary_key=True)
    trip_count: Mapped[int] = mapped_column(Integer)
    trips_with_exceptions_count: Mapped[int] = mapped_column(Integer)
    total_exceptions_count: Mapped[int] = mapped_column(Integer)
    info_exceptions_count: Mapped[int] = mapped_column(Integer)
    warning_exceptions_count: Mapped[int] = mapped_column(Integer)
    critical_exceptions_count: Mapped[int] = mapped_column(Integer)
    departures_with_plan_count: Mapped[int] = mapped_column(Integer)
    on_time_departures_count: Mapped[int] = mapped_column(Integer)
    activation_dwell_minutes_sum: Mapped[float] = mapped_column(Double)
    activation_dwell_events_count: Mapped[int] = mapped_column(Integer)
    loading_dwell_minutes_sum: Mapped[float] = mapped_column(Double)
    loading_dwell_events_count: Mapped[int] = mapped_column(Integer)
    departure_dwell_minutes_sum: Mapped[float] = mapped_column(Double)
    departure_dwell_events_count: Mapped[int] = mapped_column(Integer)
    unloading_dwell_minutes_sum: Mapped[float] = mapped_column(Double)
    unloading_dwell_events_count: Mapped[int] = mapped_column(Integer)
    confirmation_dwell_minutes_sum: Mapped[float] = mapped_column(Double)
    confirmation_dwell_events_count: Mapped[int] = mapped_column(Integer)
    phase_events_count: Mapped[int] = mapped_column(Integer)
    override_count: Mapped[int] = mapped_column(Integer)


class VehicleAnalyticsView(AnalyticsViewBase):
    __tablename__ = "vehicle_analytics"

    operator_organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    month_start: Mapped[date] = mapped_column(Date, primary_key=True)
    trip_count: Mapped[int] = mapped_column(Integer)
    mechanical_exceptions_count: Mapped[int] = mapped_column(Integer)
    mechanical_info_count: Mapped[int] = mapped_column(Integer)
    mechanical_warning_count: Mapped[int] = mapped_column(Integer)
    mechanical_critical_count: Mapped[int] = mapped_column(Integer)
    mechanical_gap_minutes_sum: Mapped[float] = mapped_column(Double)
    mechanical_gap_count: Mapped[int] = mapped_column(Integer)
    driving_hours_sum: Mapped[float] = mapped_column(Double)


class VehicleIncidentStreaksView(AnalyticsViewBase):
    """Whole-history streaks — one row per vehicle, not month-bucketed (spec §3a)."""

    __tablename__ = "vehicle_incident_streaks"

    operator_organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    highest_streak_trips: Mapped[int] = mapped_column(Integer)
    lowest_streak_trips: Mapped[int | None] = mapped_column(Integer, nullable=True)


class LaneAnalyticsView(AnalyticsViewBase):
    __tablename__ = "lane_analytics"

    operator_organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    origin_precinct_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    destination_precinct_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    month_start: Mapped[date] = mapped_column(Date, primary_key=True)
    trip_count: Mapped[int] = mapped_column(Integer)
    exception_count: Mapped[int] = mapped_column(Integer)
    actual_transit_minutes: Mapped[list[float]] = mapped_column(ARRAY(Double))
    schedule_delta_minutes: Mapped[list[float]] = mapped_column(ARRAY(Double))


class FacilityAnalyticsView(AnalyticsViewBase):
    __tablename__ = "facility_analytics"

    operator_organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    precinct_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    month_start: Mapped[date] = mapped_column(Date, primary_key=True)
    confirmed_count: Mapped[int] = mapped_column(Integer)
    mismatch_count: Mapped[int] = mapped_column(Integer)
    unwitnessed_count: Mapped[int] = mapped_column(Integer)


ANALYTICS_VIEWS: tuple[type[AnalyticsViewBase], ...] = (
    DriverAnalyticsView,
    VehicleAnalyticsView,
    VehicleIncidentStreaksView,
    LaneAnalyticsView,
    FacilityAnalyticsView,
)

ANALYTICS_VIEW_NAMES: tuple[str, ...] = tuple(view.__tablename__ for view in ANALYTICS_VIEWS)
