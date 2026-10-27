"""SQLAlchemy models for trip lifecycle: template, consignment, parcel, trip, trip-trailer."""

import uuid
from decimal import Decimal
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric,
    PrimaryKeyConstraint, String, Text, UniqueConstraint, column, desc, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import IdvsStatus, ParcelStatus, TripStatus, TripType

LIVE_TRIP_STATUSES: tuple[TripStatus, ...] = (
    TripStatus.CREATED,
    TripStatus.ACTIVE,
    TripStatus.EXCEPTION_HOLD,
)

PP_MANIFEST_INDEX = "uq_trips_pp_manifest"
PP_MANIFEST_CHECK = "ck_trips_pp_manifest_all_or_none"


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
    __table_args__ = (
        UniqueConstraint(
            "parcel_perfect_reference", name="uq_consignments_parcel_perfect_reference"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=True
    )
    parcel_perfect_reference: Mapped[str] = mapped_column(String(100), nullable=False)
    client_organization_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True
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
    pickup_stop_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=True
    )
    delivery_stop_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=True
    )
    load_priority: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    unit_count_expected: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    pp_manifest_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Parcel(Base):
    """Individual parcel within a consignment — tracked via Parcel Perfect barcode."""

    __tablename__ = "parcels"
    __table_args__ = (
        Index("ix_parcels_barcode", "barcode"),
        Index("ix_parcels_consignment_id", "consignment_id"),
    )

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
    __table_args__ = (
        Index(
            PP_MANIFEST_INDEX,
            "operator_organization_id",
            "pp_manifest_issuer_account",
            "pp_manifest_origin_hub",
            "pp_manifest_number",
            unique=True,
            postgresql_where=column("status") != TripStatus.CANCELLED.value,
        ),
        CheckConstraint(
            "(pp_manifest_issuer_account IS NULL AND pp_manifest_origin_hub IS NULL"
            " AND pp_manifest_number IS NULL)"
            " OR (pp_manifest_issuer_account IS NOT NULL AND pp_manifest_origin_hub IS NOT NULL"
            " AND pp_manifest_number IS NOT NULL)",
            name=PP_MANIFEST_CHECK,
        ),
        Index("ix_trips_driver_id", "driver_id"),
        Index("ix_trips_order_number", "order_number"),
        Index("ix_trips_status", "status"),
        Index("ix_trips_org_status_closed_id", "operator_organization_id", "status", "closed_at", "id"),
        Index("ix_trips_created_at_desc", desc("created_at")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_reference: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    order_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    operator_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    client_organization_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True
    )
    pp_manifest_issuer_account: Mapped[Optional[str]] = mapped_column(String(6), nullable=True)
    pp_manifest_origin_hub: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    pp_manifest_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    horse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False
    )
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
    current_phase: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    current_stop: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    trip_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default=TripType.LOADED.value)
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
    pulsit_device_id_snapshot: Mapped[str] = mapped_column(String(100), nullable=False)


class DriverSubstitution(Base):
    """One COMPLETED custody amendment: the trip's driver changed from `original_driver_id`
    (that event's outgoing driver) to `substituting_driver_id` (the contract's incoming
    driver). `Trip.driver_id` never changes; the current driver is derived from the ordered
    chain of these rows (orchestration/substitutions/access.py), ordered by
    `sequence_number`, never by timestamp.

    New substitutions are amendments, not exceptions: `exception_id` is NULL for them and is
    kept only for genuine legacy links. Pending and cancelled arrangements live in
    DriverSubstitutionRequest and never appear here. Rows written before the request model
    existed (`request_id` NULL) keep their original facts; their requests, confirmations,
    completing actors, hashes and payload versions were never recorded and stay NULL.
    """

    __tablename__ = "driver_substitutions"
    __table_args__ = (
        Index("ix_driver_substitutions_trip_id", "trip_id"),
        UniqueConstraint("trip_id", "sequence_number", name="uq_driver_substitutions_trip_sequence"),
        UniqueConstraint("request_id", name="uq_driver_substitutions_request_id"),
        Index(
            "uq_driver_substitutions_previous",
            "previous_substitution_id",
            unique=True,
            postgresql_where=text("previous_substitution_id IS NOT NULL"),
        ),
        Index("ix_driver_substitutions_anchor_status_updated", "anchor_status", "updated_at"),
        CheckConstraint("sequence_number > 0", name="ck_driver_substitutions_sequence_positive"),
        CheckConstraint(
            "(sequence_number = 1) = (previous_substitution_id IS NULL)",
            name="ck_driver_substitutions_previous_link",
        ),
        CheckConstraint(
            "(request_id IS NULL AND completed_by_driver_id IS NULL AND completed_by_user_id IS NULL) "
            "OR (request_id IS NOT NULL AND num_nonnulls(completed_by_driver_id, completed_by_user_id) = 1)",
            name="ck_driver_substitutions_completion_actor",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    original_driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    substituting_driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    exchange_location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    approving_dispatcher_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    is_planned: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    substitution_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    exception_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exceptions.id"), nullable=True
    )
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("blockchain_receipts.id", use_alter=True, name="fk_driver_sub_blockchain_receipt"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    request_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("driver_substitution_requests.id", name="fk_driver_substitutions_request_id"),
        nullable=True,
    )
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_substitution_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("driver_substitutions.id", name="fk_driver_substitutions_previous_id"),
        nullable=True,
    )
    completed_by_driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_driver_substitutions_completed_by_driver"),
        nullable=True,
    )
    completed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", name="fk_driver_substitutions_completed_by_user"),
        nullable=True,
    )
    completion_mode: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    declared_exchange_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    missing_confirmation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    incoming_identity_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    incoming_identity_last_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    incoming_identity_observed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    identity_attested_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", name="fk_driver_substitutions_identity_attester"),
        nullable=True,
    )
    identity_attestation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    identity_attested_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    incoming_licence_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    eligibility_observed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    payload_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    payload_json: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    event_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    anchor_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
