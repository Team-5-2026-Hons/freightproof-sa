"""SQLAlchemy models for trip lifecycle: template, consignment, parcel, trip, trip-trailer."""

import uuid
from decimal import Decimal
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, Numeric,
    PrimaryKeyConstraint, String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import IdvsStatus, ParcelStatus, TripStatus


class TripTemplate(Base):
    """Reusable trip configuration for recurring contractual routes."""

    __tablename__ = "trip_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operator_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    client_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    default_origin_precinct_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    default_destination_precinct_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Consignment(Base):
    """Cargo consignment pulled from Parcel Perfect — linked to a trip at creation."""

    __tablename__ = "consignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=True
    )
    parcel_perfect_reference: Mapped[str] = mapped_column(String(100), nullable=False)
    client_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    origin_precinct_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    destination_precinct_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    declared_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    parcel_count_expected: Mapped[int | None] = mapped_column(Integer, nullable=True)
    slot_time_origin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    slot_time_destination: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pp_raw_json: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Parcel(Base):
    """Individual parcel within a consignment — tracked via Parcel Perfect barcode."""

    __tablename__ = "parcels"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    consignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("consignments.id"), nullable=False
    )
    barcode: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivery_stop: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pp_scan_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pp_scan_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[ParcelStatus] = mapped_column(String(20), nullable=False, server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Trip(Base):
    """Central entity — one row per depot-to-depot trip, progresses through TripStatus states."""

    __tablename__ = "trips"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_reference: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    order_number: Mapped[str] = mapped_column(String(100), nullable=False)
    operator_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    client_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    horse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False
    )
    origin_precinct_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=False
    )
    destination_precinct_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=False
    )
    pulsit_trip_reference_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_templates.id"), nullable=True
    )
    status: Mapped[TripStatus] = mapped_column(String(30), nullable=False, server_default="created")
    journey_lock_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idvs_check_status: Mapped[IdvsStatus] = mapped_column(String(20), nullable=False, server_default="pending")
    idvs_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_departure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_arrival_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_departure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_arrival_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TripTrailer(Base):
    """Many-to-many: which trailers are attached to a trip (composite PK)."""

    __tablename__ = "trip_trailers"
    __table_args__ = (
        PrimaryKeyConstraint("trip_id", "trailer_id"),
    )

    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    trailer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    # Snapshot prevents retroactive trailer reassignment from altering the evidence chain.
    pulsit_device_id_snapshot: Mapped[str] = mapped_column(String(100), nullable=False)
