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
    ExceptionResolutionMethod,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
)


class Checkpoint(Base):
    """Driver-logged or Pulsit-pulled in-transit event between phases."""

    __tablename__ = "checkpoints"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    checkpoint_type: Mapped[str] = mapped_column(String(50), nullable=False)
    driver_phone_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    driver_phone_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    # Task 0A: the same field as PhaseEvent.driver_captured_at, and for the same reason
    # — a checkpoint is offline-queued exactly like a phase handshake, and its horse
    # position is likewise superseded by a live Pulsit read (corroboration_service's
    # record_checkpoint_corroboration) that must not be trusted against a stale replay.
    # See PhaseEvent.driver_captured_at's own comment for the full rationale.
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
    # Task 0B: one report per (trip, client_report_id) — see client_report_id's own
    # comment below. Declared here, not just in migration ciaran_exc_idempotency,
    # because Base.metadata.create_all() (every test's schema) only picks up indexes
    # the model itself declares — mirrors Trip.__table_args__'s identical
    # LIVE_ORDER_NUMBER_INDEX above it in db/models/trips.py. Partial: rows with no
    # client_report_id carry no idempotency claim and must never collide with each
    # other under this index.
    __table_args__ = (
        Index(
            "uq_exceptions_trip_client_report_id",
            "trip_id",
            "client_report_id",
            unique=True,
            postgresql_where=column("client_report_id").isnot(None),
        ),
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
    # Scope an exception to one client's cargo / one stop on the route, so a multi-client
    # evidence chain can be cut per client (v7 §6.1: a FedEx discrepancy must not surface
    # in Courier Guy's evidence PDF). Nullable: trip-level exceptions stay unscoped, and
    # nothing populates these yet — phases learn their stop via PhaseEvent.trip_stop_id,
    # introduced by this same phase refactor.
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
    # Task 0B: the driver app's own stable id for this report — the offline queue's
    # entry UUID (frontend/driver-pwa lib/hooks/useOfflineQueue.ts), sent as
    # client_report_id and never regenerated across a retry of the same submission.
    # Lets exception_service.raise_exception recognise "this exact report, resent"
    # (a lost response, or a retry after its photo uploaded but the POST itself
    # failed) and return the existing row instead of inserting a second one.
    # Nullable: an older installed/queued client omits it, and that submission gets
    # no idempotency protection rather than being rejected. Uniqueness is enforced
    # per-trip by a partial index (migration ciaran_exc_idempotency), not `unique=True`
    # here — a bare column constraint could not express "unique only when present".
    client_report_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # Driver-phone GPS fix captured at the moment the exception was raised (e.g. a
    # panic-button hold) — mirrors Checkpoint.driver_phone_lat/_lng's Numeric(10,7)
    # naming and precision above. Nullable: system- and dispatcher-raised exceptions
    # never have a driver phone fix to attach. POPIA: personal location data stays in
    # Postgres only — exceptions are not anchored to Hedera today, so these columns
    # must never be read into any hash/anchoring path.
    gps_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    gps_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    resolved_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolver_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # How the dispatcher established what happened, alongside the note saying what they
    # found. Nullable: every exception written before this column existed has no method,
    # and backfilling a guess would put invented contact history on an evidence record.
    # String(20), not a native PG enum — matching exception_type/source/severity above
    # and every other enum column in this codebase. A PG type would also have to be
    # created and dropped by hand in the migration, for no gain the app can see.
    resolution_method: Mapped[Optional[ExceptionResolutionMethod]] = mapped_column(
        String(20), nullable=True
    )
    merkle_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("merkle_batches.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
