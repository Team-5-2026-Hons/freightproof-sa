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
        # D3: only trip_creation has a NULL trip_stop_id, so this constraint is total
        # for P1..P6 — Postgres treats NULLs as distinct in a unique constraint, which
        # is why in_transit anchors to its departure stop rather than being left NULL.
        UniqueConstraint("trip_id", "trip_stop_id", "phase_type", name="uq_phase_events_trip_stop_type"),
        # The other half of D3: exactly one P0 per trip, which the constraint above
        # can't express since its trip_stop_id is NULL.
        Index(
            "uq_phase_events_trip_creation",
            "trip_id",
            unique=True,
            postgresql_where=text("phase_type = 'trip_creation'"),
        ),
        # Replay protection for the driver app's offline queue; partial since
        # server-generated rows carry no key.
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
    # D4. Decoupled from `status`: a completed phase with a failed anchor is a real
    # state under the fail-open policy, and the system must still know a receipt is owed.
    anchor_status: Mapped[AnchorStatus] = mapped_column(
        String(20), nullable=False, server_default="not_required"
    )
    # Driver app's offline-queue entry id, echoed back on replay, so a resubmitted
    # completion returns current state, never a duplicate or an error.
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    dispatcher_override_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    dispatcher_override_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    driver_phone_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    driver_phone_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    # Instant the driver's phone submitted this completion, not when the server
    # processed it — needed so corroboration_service can tell a live handshake from a
    # stale offline replay. Nullable for older clients; never backfilled with completed_at.
    driver_captured_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    horse_gps_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    horse_gps_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    pulsit_geofence_confirmed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    # Task 5: the versioned ActionLocationAssessment snapshot (schemas/action_location.py)
    # assembled by orchestration/action_location_service.build_phase_assessment at
    # _finish_phase time — the driver-phone-vs-tracker proximity verdict plus the
    # precinct-membership facts, frozen as they stood at evaluation. Nullable: every row
    # completed before this column existed, and never backfilled — fabricating a
    # historical assessment from columns that predate this contract would misrepresent
    # what was actually evaluated at the time. Validated through ActionLocationAssessment
    # on every read (schemas/phases.py's PhaseEventRead), never read as a raw dict.
    action_location_assessment: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    # Task 7: the driver's acknowledgement of a preview warning. This never replaces
    # the independently assembled action_location_assessment above; it records only
    # what the driver saw and, for a reliable discrepancy, why they continued.
    location_warning_acknowledged_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    location_warning_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    seal_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    # Artifact FKs use use_alter=True to break the migration's circular dependency:
    # evidence_artifacts is created before trips, so these FKs are added via ALTER TABLE.
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
    # Paper linehaul sheet from the warehouse at loading — third-party evidence of what
    # was claimed loaded, distinct from the legal waybill copy. Optional: a paperless
    # warehouse gives the driver nothing to photograph, and this must never block his trip.
    linehaul_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_linehaul_photo"),
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
