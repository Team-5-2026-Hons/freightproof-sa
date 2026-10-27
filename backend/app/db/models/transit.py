"""SQLAlchemy models for in-transit checkpoints and exceptions."""

import uuid
from typing import Any, Optional
from decimal import Decimal
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, column, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import (
    ExceptionContactMethod,
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
)

SUBSTITUTION_SEPARATION_INDEX = "uq_exceptions_substitution_separation"
SUBSTITUTION_SEAL_FINDING_INDEX = "uq_exceptions_substitution_seal"


class Checkpoint(Base):
    """Driver-logged or Pulsit-pulled in-transit event between phases."""

    __tablename__ = "checkpoints"
    __table_args__ = (
        Index(
            "uq_checkpoints_trip_client_report_id",
            "trip_id",
            "client_report_id",
            unique=True,
            postgresql_where=column("client_report_id").isnot(None),
        ),
        Index("ix_checkpoints_trip_created", "trip_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    checkpoint_type: Mapped[str] = mapped_column(String(50), nullable=False)
    driver_phone_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    driver_phone_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    driver_captured_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    horse_gps_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    horse_gps_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    selfie_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=True
    )
    cargo_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=True
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_deviation: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    merkle_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("merkle_batches.id"), nullable=True
    )
    action_location_assessment: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    client_report_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    phase_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=True
    )
    performed_by_driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_checkpoints_performed_by_driver_id"), nullable=True
    )
    custody_sequence: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TripException(Base):
    """Anomaly recorded at any point in a trip — system-detected, driver-raised, or dispatcher-raised.

    Named TripException (not Exception) to avoid shadowing Python's built-in.
    The table name remains 'exceptions' to match the original schema design.
    """

    __tablename__ = "exceptions"
    __table_args__ = (
        Index(
            "uq_exceptions_trip_client_report_id",
            "trip_id",
            "client_report_id",
            unique=True,
            postgresql_where=column("client_report_id").isnot(None),
        ),
        Index(
            "uq_exceptions_phase_separation",
            "phase_event_id",
            "exception_type",
            unique=True,
            postgresql_where=text(
                "exception_type = 'driver_vehicle_separation' AND phase_event_id IS NOT NULL"
            ),
        ),
        Index(
            "uq_exceptions_checkpoint_separation",
            "checkpoint_id",
            "exception_type",
            unique=True,
            postgresql_where=text(
                "exception_type = 'driver_vehicle_separation' AND checkpoint_id IS NOT NULL"
            ),
        ),
        Index(
            "uq_exceptions_phase_driver_location",
            "phase_event_id",
            "exception_type",
            unique=True,
            postgresql_where=text(
                "exception_type = 'driver_location_mismatch' AND phase_event_id IS NOT NULL"
            ),
        ),
        Index(
            "uq_exceptions_phase_trailer_location",
            "phase_event_id",
            "exception_type",
            unique=True,
            postgresql_where=text(
                "exception_type = 'trailer_location_mismatch' AND phase_event_id IS NOT NULL"
            ),
        ),
        Index(
            SUBSTITUTION_SEPARATION_INDEX,
            "substitution_confirmation_id",
            "exception_type",
            unique=True,
            postgresql_where=text(
                "exception_type = 'driver_vehicle_separation' AND substitution_confirmation_id IS NOT NULL"
            ),
        ),
        Index(
            SUBSTITUTION_SEAL_FINDING_INDEX,
            "substitution_confirmation_id",
            "vehicle_id",
            "exception_type",
            unique=True,
            postgresql_where=text(
                "exception_type IN ('seal_mismatch', 'seal_compromised') AND substitution_confirmation_id IS NOT NULL"
            ),
        ),
        Index("ix_exceptions_severity", "severity"),
        Index("ix_exceptions_trip_review_status", "trip_id", "review_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    phase_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=True
    )
    checkpoint_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("checkpoints.id"), nullable=True
    )
    substitution_confirmation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("driver_substitution_confirmations.id", name="fk_exceptions_substitution_confirmation_id"),
        nullable=True,
    )
    consignment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("consignments.id"), nullable=True
    )
    trip_stop_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=True
    )
    exception_type: Mapped[ExceptionType] = mapped_column(String(50), nullable=False)
    source: Mapped[ExceptionSource] = mapped_column(String(20), nullable=False)
    severity: Mapped[ExceptionSeverity] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    supporting_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=True
    )
    client_report_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    gps_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    gps_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    vehicle_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id", name="fk_exceptions_vehicle_id"), nullable=True
    )
    review_status: Mapped[ExceptionReviewStatus] = mapped_column(
        String(20), nullable=False, server_default=ExceptionReviewStatus.NEEDS_REVIEW.value
    )
    review_outcome: Mapped[Optional[ExceptionReviewOutcome]] = mapped_column(
        String(30), nullable=True
    )
    reviewed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    contact_method: Mapped[Optional[ExceptionContactMethod]] = mapped_column(
        String(20), nullable=True
    )
    claimed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", name="fk_exceptions_claimed_by_user_id"), nullable=True
    )
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    performed_by_driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_exceptions_performed_by_driver_id"), nullable=True
    )
    custody_sequence: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    merkle_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("merkle_batches.id"), nullable=True
    )
    action_location_assessment: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
