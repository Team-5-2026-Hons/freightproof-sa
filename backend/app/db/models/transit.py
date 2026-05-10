"""SQLAlchemy models for in-transit checkpoints and exceptions."""

import uuid
from decimal import Decimal
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType


class Checkpoint(Base):
    """Driver-logged or Pulsit-pulled in-transit event between handshakes."""

    __tablename__ = "checkpoints"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    checkpoint_type: Mapped[str] = mapped_column(String(50), nullable=False)
    driver_phone_lat: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    driver_phone_lng: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    horse_gps_lat: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    horse_gps_lng: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    selfie_artifact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=True
    )
    cargo_photo_artifact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deviation: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    merkle_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("merkle_batches.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TripException(Base):
    """Anomaly recorded at any point in a trip — system-detected, driver-raised, or dispatcher-raised.

    Named TripException (not Exception) to avoid shadowing Python's built-in.
    The table name remains 'exceptions' for DB consistency with the spec.
    """

    __tablename__ = "exceptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    handshake_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handshake_events.id"), nullable=True
    )
    checkpoint_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("checkpoints.id"), nullable=True
    )
    exception_type: Mapped[ExceptionType] = mapped_column(String(50), nullable=False)
    source: Mapped[ExceptionSource] = mapped_column(String(20), nullable=False)
    severity: Mapped[ExceptionSeverity] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    supporting_artifact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=True
    )
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolver_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    merkle_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("merkle_batches.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
