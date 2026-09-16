"""SQLAlchemy models for in-transit checkpoints and exceptions."""

import uuid
from typing import Optional
from decimal import Decimal
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Text, column
from sqlalchemy.dialects.postgresql import UUID
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


class Checkpoint(Base):
    """Driver-logged or Pulsit-pulled in-transit event between phases."""

    __tablename__ = "checkpoints"
    # Declared so autogenerate stops proposing to drop an index that already exists
    # in the deployed database.
    __table_args__ = (
        Index("ix_checkpoints_trip_created", "trip_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    checkpoint_type: Mapped[str] = mapped_column(String(50), nullable=False)
    driver_phone_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    driver_phone_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    # Same field, same reason, as PhaseEvent.driver_captured_at: superseded by a live
    # Pulsit read (corroboration_service) that must not trust a stale offline replay.
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TripException(Base):
    """Anomaly recorded at any point in a trip — system-detected, driver-raised, or dispatcher-raised.

    Named TripException (not Exception) to avoid shadowing Python's built-in.
    The table name remains 'exceptions' for DB consistency with the spec.
    """

    __tablename__ = "exceptions"
    # One report per (trip, client_report_id) — see client_report_id's own comment.
    # Declared here, not just in the migration, because Base.metadata.create_all()
    # (every test's schema) only picks up indexes the model itself declares. Partial:
    # rows with no client_report_id carry no idempotency claim.
    __table_args__ = (
        Index(
            "uq_exceptions_trip_client_report_id",
            "trip_id",
            "client_report_id",
            unique=True,
            postgresql_where=column("client_report_id").isnot(None),
        ),
        # Declared so autogenerate stops proposing to drop indexes that already exist
        # in the deployed database.
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
    # Scopes an exception to one client's cargo / one stop, so a multi-client evidence
    # chain can be cut per client (v7 §6.1). Nullable: trip-level exceptions stay
    # unscoped, and nothing populates these yet.
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
    # Driver app's offline-queue entry id, sent as client_report_id, so
    # exception_service.raise_exception can recognise a resent report and return the
    # existing row instead of duplicating it. Nullable for older clients; uniqueness
    # enforced per-trip by a partial index, not `unique=True`, since it must be
    # unique only when present.
    client_report_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # Driver-phone GPS fix at the moment raised (e.g. panic-button). Nullable:
    # system/dispatcher-raised exceptions have none. POPIA: stays in Postgres only,
    # never read into any hash/anchoring path.
    gps_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    gps_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    # The trip's horse or trailer a MECHANICAL exception belongs to
    # (exception_service.pick_breakdown_vehicle); needed since trailers attach
    # many-to-many via trip_trailers. Nullable and never backfilled — unattributed
    # breakdowns count toward the horse (trailer analytics spec, decision 2).
    vehicle_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id", name="fk_exceptions_vehicle_id"), nullable=True
    )
    # Replaces the old `resolved: bool`, which couldn't distinguish "not looked at"
    # from "looked at, still needs a decision" (see ExceptionReviewStatus).
    review_status: Mapped[ExceptionReviewStatus] = mapped_column(
        String(20), nullable=False, server_default=ExceptionReviewStatus.RECORDED.value
    )
    # Set only once review_status reaches REVIEWED; nullable for unreviewed rows.
    review_outcome: Mapped[Optional[ExceptionReviewOutcome]] = mapped_column(
        String(30), nullable=True
    )
    reviewed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # How the dispatcher established what happened. Nullable: exceptions written
    # before this column existed have no method (see ExceptionContactMethod).
    contact_method: Mapped[Optional[ExceptionContactMethod]] = mapped_column(
        String(20), nullable=True
    )
    merkle_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("merkle_batches.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
