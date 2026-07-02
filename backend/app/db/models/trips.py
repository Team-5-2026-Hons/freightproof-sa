"""SQLAlchemy models for trip lifecycle: template, consignment, parcel, trip, trip-trailer."""

import uuid
from decimal import Decimal
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, Numeric,
    PrimaryKeyConstraint, String, Text, UniqueConstraint,
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
    default_origin_precinct_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    default_destination_precinct_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Consignment(Base):
    """Cargo consignment pulled from Parcel Perfect — linked to a trip at creation."""

    __tablename__ = "consignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=True
    )
    parcel_perfect_reference: Mapped[str] = mapped_column(String(100), nullable=False)
    client_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    origin_precinct_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    destination_precinct_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    declared_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2), nullable=True)
    parcel_count_expected: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    slot_time_origin: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    slot_time_destination: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    pp_raw_json: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    # The stop realising this consignment's origin/destination on the assigned trip's route.
    # A TripStop has no inherent role — it's an origin/destination only via these links (FP-112).
    pickup_stop_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=True
    )
    delivery_stop_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=True
    )
    # Recorded evidence only (door vs bulkhead) — FreightProof records freight position,
    # it does not enforce loading order (scope-boundaries.md §3).
    load_priority: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Consolidated-unit grain (pallets), distinct from parcel-grain parcel_count_expected.
    # PP cannot supply this — pallet grain is LFG's — so it's populated outside the PP pull.
    unit_count_expected: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Snapshot of the PP waybill's "manifest" field (last manifest number), distinct from
    # parcel_perfect_reference which is the PP waybill number itself.
    pp_manifest_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
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
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    delivery_stop: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    pp_scan_out_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    pp_scan_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
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
    # Nullable: client now lives per-consignment (multi-client trips have no single client_organization_id).
    client_organization_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    horse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False
    )
    # Nullable: derived convenience (= precinct of the earliest/latest TripStop) for multi-stop trips.
    origin_precinct_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    destination_precinct_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    pulsit_trip_reference_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    template_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_templates.id"), nullable=True
    )
    status: Mapped[TripStatus] = mapped_column(String(30), nullable=False, server_default="created")
    journey_lock_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    idvs_check_status: Mapped[IdvsStatus] = mapped_column(String(20), nullable=False, server_default="pending")
    idvs_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_departure_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_arrival_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_departure_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_arrival_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class TripStop(Base):
    """A sequenced waypoint on a trip's route.

    No origin/destination type is stored here — the same physical stop can be an
    origin for one consignment and a destination for another. Role is derived from
    which Consignment rows point pickup_stop_id/delivery_stop_id at this stop.
    """

    __tablename__ = "trip_stops"
    __table_args__ = (
        UniqueConstraint("trip_id", "sequence", name="uq_trip_stops_trip_id_sequence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    precinct_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    slot_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


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


class DriverSubstitution(Base):
    """Records every mid-trip driver change — planned or unplanned.

    Spec §5 + Handshake 3: four fields are required for all substitutions.
    Planned substitutions (is_planned=True) are normal trip events with no
    exception flag. Unplanned ones link to a TripException row via exception_id
    and are anchored to blockchain separately.
    """

    __tablename__ = "driver_substitutions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    # The four required log fields from the spec.
    original_driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    substituting_driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    # Free-text: exchange points are Pulsit geofence locations (e.g. "Harrismith
    # N3 fuel stop"), not necessarily Precinct rows in our DB.
    exchange_location: Mapped[str] = mapped_column(String(255), nullable=False)
    approving_dispatcher_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    is_planned: Mapped[bool] = mapped_column(Boolean, nullable=False)
    substitution_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Populated only for unplanned substitutions — links to the TripException record.
    exception_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exceptions.id"), nullable=True
    )
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("blockchain_receipts.id", use_alter=True, name="fk_driver_sub_blockchain_receipt"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
