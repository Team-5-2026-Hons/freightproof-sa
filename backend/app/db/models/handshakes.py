"""SQLAlchemy models for handshake events and per-trailer GPS snapshots."""

import uuid
from decimal import Decimal
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, Numeric,
    SmallInteger, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import HandshakeStatus, HandshakeType


class HandshakeEvent(Base):
    """One row per handshake per trip. H0, H2, H5 are anchored to Hedera; H1, H3, H4 are feeders."""

    __tablename__ = "handshake_events"
    __table_args__ = (
        UniqueConstraint("trip_id", "handshake_type", name="uq_handshake_events_trip_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    handshake_type: Mapped[HandshakeType] = mapped_column(String(30), nullable=False)
    sequence_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[HandshakeStatus] = mapped_column(String(20), nullable=False, server_default="pending")
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
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_handshake_seal_photo"),
        nullable=True,
    )
    waybill_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_handshake_waybill_photo"),
        nullable=True,
    )
    gate_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_handshake_gate_photo"),
        nullable=True,
    )
    pod_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_handshake_pod_photo"),
        nullable=True,
    )
    parcel_manifest_snapshot: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    parcel_count_origin: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    parcel_count_destination: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    driver_visual_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    event_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("blockchain_receipts.id", use_alter=True, name="fk_handshake_blockchain_receipt"),
        nullable=True,
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class TrailerGpsSnapshot(Base):
    """Per-trailer GPS reading at each handshake — independent Pulsit source for cross-reference."""

    __tablename__ = "trailer_gps_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    handshake_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handshake_events.id"), nullable=False
    )
    trailer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False
    )
    pulsit_device_id: Mapped[str] = mapped_column(String(100), nullable=False)
    lat: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
