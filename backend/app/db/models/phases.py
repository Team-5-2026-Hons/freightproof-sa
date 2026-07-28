"""SQLAlchemy models for phase events and per-trailer GPS snapshots."""

import uuid
from decimal import Decimal
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Index, Integer, Numeric,
    SmallInteger, String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import AnchorStatus, PhaseStatus, PhaseType


class PhaseEvent(Base):
    """One row per phase per trip — the ledger the trip's position is DERIVED from.

    Rows are written at trip creation, all `pending`, in plan order; completion
    fills them in. `sequence_number` is the row's index in that committed plan,
    NOT an enum index and NOT bounded by 6 — a three-stop cross-dock has 11 rows
    and contains `loading` twice.
    """

    __tablename__ = "phase_events"
    __table_args__ = (
        # D3: only trip_creation has a NULL trip_stop_id, so this constraint is
        # total for P1..P6. PostgreSQL treats NULLs as distinct in a unique
        # constraint, which is exactly why in_transit is anchored to the stop it
        # DEPARTS FROM rather than left NULL — otherwise duplicate NULL-stop rows
        # would slip through this.
        UniqueConstraint("trip_id", "trip_stop_id", "phase_type", name="uq_phase_events_trip_stop_type"),
        # The other half of D3: exactly one P0 per trip, which the constraint
        # above cannot express because its trip_stop_id is NULL.
        Index(
            "uq_phase_events_trip_creation",
            "trip_id",
            unique=True,
            postgresql_where=text("phase_type = 'trip_creation'"),
        ),
        # Replay protection for the driver app's offline queue. Partial, because
        # server-generated rows (the whole plan at creation) carry no key.
        Index(
            "uq_phase_events_idempotency_key",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
        Index("ix_phase_events_trip_sequence", "trip_id", "sequence_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    # NULL only for trip_creation (D3). in_transit anchors to its departure stop.
    trip_stop_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=True
    )
    phase_type: Mapped[PhaseType] = mapped_column(String(30), nullable=False)
    sequence_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[PhaseStatus] = mapped_column(String(20), nullable=False, server_default="pending")
    # D4. Decoupled from `status` on purpose: a completed phase whose anchor
    # failed is a real state under the fail-open policy, and the system must be
    # able to say a receipt is owed.
    anchor_status: Mapped[AnchorStatus] = mapped_column(
        String(20), nullable=False, server_default="not_required"
    )
    # The driver app's offline-queue entry id, echoed back on replay. Drivers lose
    # signal; a resubmitted completion must return the current state, never a
    # duplicate row and never an error.
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    dispatcher_override_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    dispatcher_override_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    driver_phone_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    driver_phone_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    horse_gps_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    horse_gps_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    pulsit_geofence_confirmed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    seal_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    # Artifact FKs use use_alter=True to break the circular dependency in the
    # migration: evidence_artifacts is created before trips, so these FKs are
    # added via ALTER TABLE after all tables exist.
    seal_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_seal_photo"),
        nullable=True,
    )
    waybill_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_waybill_photo"),
        nullable=True,
    )
    gate_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_gate_photo"),
        nullable=True,
    )
    pod_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_pod_photo"),
        nullable=True,
    )
    # Proof of delivery is a photo AND an on-device signature (BQ2 resolved 2026-06-29) —
    # both are required at confirmation, not either/or.
    pod_signature_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_pod_signature"),
        nullable=True,
    )
    parcel_manifest_snapshot: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    parcel_count_origin: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    parcel_count_destination: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    driver_visual_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    event_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("blockchain_receipts.id", use_alter=True, name="fk_phase_blockchain_receipt"),
        nullable=True,
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class TrailerGpsSnapshot(Base):
    """Per-trailer GPS reading at each phase — independent Pulsit source for cross-reference."""

    __tablename__ = "trailer_gps_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phase_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=False
    )
    trailer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False
    )
    pulsit_device_id: Mapped[str] = mapped_column(String(100), nullable=False)
    lat: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
