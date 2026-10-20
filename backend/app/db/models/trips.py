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

# Statuses that make a trip live — fleet analytics counts these as in use.
LIVE_TRIP_STATUSES: tuple[TripStatus, ...] = (
    TripStatus.CREATED,
    TripStatus.ACTIVE,
    TripStatus.EXCEPTION_HOLD,
)

# The trip's PP manifest key (FP-281, spec §6). Referenced by orchestration when
# translating a unique violation into a domain error, and by the schema tests.
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
    # One waybill, one consignment row (FP-138): a select-then-insert can't close
    # this race alone (two concurrent callers both insert), so the database enforces it.
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
    # Resolved from the PP account number during sync, not caller-supplied; may be
    # unresolved (warning, not error).
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
    # The stop realising this consignment's origin/destination; a TripStop has no
    # inherent role beyond these links (FP-112).
    pickup_stop_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=True
    )
    delivery_stop_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=True
    )
    # Recorded evidence only (door vs bulkhead) — FreightProof records freight
    # position, it does not enforce loading order.
    load_priority: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Consolidated-unit grain (pallets), distinct from parcel_count_expected; PP
    # can't supply this, so it's populated outside the PP pull.
    unit_count_expected: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Snapshot of the PP waybill's manifest field, distinct from
    # parcel_perfect_reference (the waybill number itself).
    pp_manifest_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Parcel(Base):
    """Individual parcel within a consignment — tracked via Parcel Perfect barcode."""

    __tablename__ = "parcels"
    # Declared so autogenerate stops proposing to drop indexes that already exist
    # in the deployed database.
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
        # One non-cancelled trip per PP manifest (spec §6). Not LIVE_TRIP_STATUSES: a
        # manifest is one departure, so a closed trip still owns it. Only cancelling
        # frees it, so the dispatcher can recreate the trip.
        Index(
            PP_MANIFEST_INDEX,
            "operator_organization_id",
            "pp_manifest_issuer_account",
            "pp_manifest_origin_hub",
            "pp_manifest_number",
            unique=True,
            postgresql_where=column("status") != TripStatus.CANCELLED.value,
        ),
        # A partial key identifies nothing: all three set (manifest trip) or none.
        CheckConstraint(
            "(pp_manifest_issuer_account IS NULL AND pp_manifest_origin_hub IS NULL"
            " AND pp_manifest_number IS NULL)"
            " OR (pp_manifest_issuer_account IS NOT NULL AND pp_manifest_origin_hub IS NOT NULL"
            " AND pp_manifest_number IS NOT NULL)",
            name=PP_MANIFEST_CHECK,
        ),
        # Declared so autogenerate stops proposing to drop indexes that already exist
        # in the deployed database.
        Index("ix_trips_driver_id", "driver_id"),
        Index("ix_trips_order_number", "order_number"),
        Index("ix_trips_status", "status"),
        Index("ix_trips_org_status_closed_id", "operator_organization_id", "status", "closed_at", "id"),
        Index("ix_trips_created_at_desc", desc("created_at")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_reference: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    # No longer written (FP-281): the PP manifest key replaced it. Nullable so trips
    # without one can be inserted; the column itself is dropped in piece C.
    order_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    operator_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    # Nullable: client now lives per-consignment (multi-client trips have no single client_organization_id).
    client_organization_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True
    )
    # PP manifest key (spec §6): issuer account + origin hub + number. All null on
    # empty legs and on trips created through the explicit POST /trips path.
    pp_manifest_issuer_account: Mapped[Optional[str]] = mapped_column(String(6), nullable=True)
    pp_manifest_origin_hub: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    pp_manifest_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
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
    # Denormalised caches of the ledger derivation, refreshed on every phase
    # completion so list views don't recompute. Read paths only — the ledger is
    # the truth; no write path may branch on these.
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
    # Snapshot prevents retroactive trailer reassignment from altering the evidence chain.
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
        # Declared so autogenerate stops proposing to drop an index that already exists
        # in the deployed database.
        Index("ix_driver_substitutions_trip_id", "trip_id"),
        # The ordered chain's key: one link per position per trip, which also backs the
        # "latest link" lookup the current-driver expression runs.
        UniqueConstraint("trip_id", "sequence_number", name="uq_driver_substitutions_trip_sequence"),
        # A request completes at most once. Plain unique: NULL request_ids (legacy rows)
        # never collide in PostgreSQL.
        UniqueConstraint("request_id", name="uq_driver_substitutions_request_id"),
        # A chain cannot fork: each link has at most one successor.
        Index(
            "uq_driver_substitutions_previous",
            "previous_substitution_id",
            unique=True,
            postgresql_where=text("previous_substitution_id IS NOT NULL"),
        ),
        # FP-83 C5: the custody anchor recovery sweep's lookup (owed status, oldest attempt first).
        Index("ix_driver_substitutions_anchor_status_updated", "anchor_status", "updated_at"),
        CheckConstraint("sequence_number > 0", name="ck_driver_substitutions_sequence_positive"),
        # Position 1 is the first handover from the original driver; every later link names
        # the one before it.
        CheckConstraint(
            "(sequence_number = 1) = (previous_substitution_id IS NULL)",
            name="ck_driver_substitutions_previous_link",
        ),
        # New rows (request-backed) record exactly one completing actor; legacy rows are
        # exempt and must not have one invented for them.
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
    # The four required log fields for a driver substitution: who left, who took
    # over, where, and who approved it.
    original_driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    substituting_driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    # The human label of the exchange point; the request freezes its coordinates and
    # instructions. Free-text: exchange points are not necessarily Precinct rows.
    exchange_location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # On new rows: the dispatcher who ARRANGED the handover, never a driver or whichever
    # dispatcher later completed it. Legacy rows keep their recorded approval meaning.
    approving_dispatcher_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    is_planned: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    # The server-effective transfer time (not the claimed exchange time, see below).
    substitution_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # NULL for every new substitution; set only on genuine legacy links.
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

    # ── Custody chain (FP-83) ────────────────────────────────────────────────
    # The arrangement this row completed. NULL only on legacy rows: no request was ever
    # recorded for them and none is fabricated.
    request_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("driver_substitution_requests.id", name="fk_driver_substitutions_request_id"),
        nullable=True,
    )
    # 1-based position in the trip's chain (sequence 0 is the original driver's period,
    # which has no row). The only ordering custody derivation trusts.
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_substitution_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("driver_substitutions.id", name="fk_driver_substitutions_previous_id"),
        nullable=True,
    )
    # Exactly one on request-backed rows: the driver whose final confirmation completed the
    # handover, or the dispatcher whose action did. Both NULL on legacy rows (unknown).
    completed_by_driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_driver_substitutions_completed_by_driver"),
        nullable=True,
    )
    completed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", name="fk_driver_substitutions_completed_by_user"),
        nullable=True,
    )
    # SubstitutionCompletionMode: "normal" or "dispatcher_attested". NULL on legacy rows.
    completion_mode: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    # The physical exchange time a dispatcher claimed, kept apart from substitution_at.
    declared_exchange_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # The completing dispatcher's reason when a driver confirmation was missing.
    missing_confirmation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # The incoming driver's fleet identity exactly as observed at completion. An admin
    # attestation is recorded separately and never relabels this status as verified.
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
    # The licence eligibility facts the completion relied on (the number is never stored here).
    incoming_licence_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    eligibility_observed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # The frozen commitment, written with the completion (C5). All NULL on legacy rows:
    # there is no payload version, hash or anchor status to carry over, and none is invented.
    payload_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    payload_json: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    event_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    anchor_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
