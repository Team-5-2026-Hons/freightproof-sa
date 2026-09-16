"""SQLAlchemy models for in-transit checkpoints and exceptions."""

import uuid
from typing import Any, Optional
from decimal import Decimal
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Text, column, text
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


class Checkpoint(Base):
    """Driver-logged or Pulsit-pulled in-transit event between phases."""

    __tablename__ = "checkpoints"
    # Task 8 (not wired by this story — column/index only, see the migration's own
    # docstring): mirrors uq_exceptions_trip_client_report_id exactly. Declared here,
    # not just in the migration, so Base.metadata.create_all() (every test's schema)
    # carries the same constraint the real database will.
    #
    # ix_checkpoints_trip_created declared so autogenerate stops proposing to drop an
    # index that already exists in the deployed database (created by an earlier
    # migration, never modelled here).
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
    # Task 5: the versioned ActionLocationAssessment snapshot for this checkpoint's own
    # handshake (orchestration/action_location_service.build_checkpoint_assessment,
    # called from checkpoint_service.log_checkpoint). No precinct-membership facts —
    # unlike a phase event, a checkpoint happens on the road between precincts, so
    # those fields are always None here. See schemas/action_location.py.
    action_location_assessment: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    # Task 8 columns (not wired by this story): mirrors exceptions.client_report_id /
    # phase_event_id-style scoping — see the migration's own docstring for why they
    # exist now with no caller yet.
    client_report_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    phase_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=True
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
        # Task 5 (R13): one DRIVER_VEHICLE_SEPARATION finding per source event — the
        # idempotency key orchestration/action_location_service.record_separation_finding
        # relies on, alongside its own pre-insert existence check, to survive a replayed
        # completion or two concurrent requests racing for the same handshake. Scoped
        # to this exception_type only (postgresql_where), so it adds no constraint at
        # all to GPS_MISMATCH or any other type already sharing a phase_event_id/
        # checkpoint_id — those may still have as many rows as they always could.
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
        # Declared so autogenerate stops proposing to drop indexes that already exist
        # in the deployed database (created by an earlier migration, never modelled here).
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
    # The exact vehicle a MECHANICAL exception belongs to: the trip's horse or one of its
    # trailers, worked out by exception_service.pick_breakdown_vehicle from the driver's
    # "truck or trailer" answer. Needed because trailers attach through trip_trailers
    # (many-to-many), so the trip alone cannot say which trailer on an interlink broke
    # down. Nullable and never backfilled: every other exception type, every breakdown
    # recorded before this column existed, and every report from an app that doesn't ask
    # the question has no vehicle, and the analytics count those for the horse (trailer
    # analytics spec, decision 2). The FK is named explicitly to match the migration,
    # because Base has no naming_convention.
    vehicle_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id", name="fk_exceptions_vehicle_id"), nullable=True
    )
    # Task 1 (FP-146 review semantics, migration ciaran_exc_review_semantics): replaces
    # the old `resolved: bool`, which could not distinguish "nobody has looked at this"
    # from "looked at, still needs a decision" — see ExceptionReviewStatus's own comment.
    # String(20), not a native PG enum, matching every other enum column on this table.
    review_status: Mapped[ExceptionReviewStatus] = mapped_column(
        String(20), nullable=False, server_default=ExceptionReviewStatus.RECORDED.value
    )
    # What the dispatcher concluded, set only once review_status reaches REVIEWED.
    # Nullable: unreviewed rows (the overwhelming majority at any moment) have no
    # outcome yet, and the migration only back-stamps LEGACY_REVIEW onto rows that were
    # already `resolved=true` — see ExceptionReviewOutcome's own comment.
    review_outcome: Mapped[Optional[ExceptionReviewOutcome]] = mapped_column(
        String(30), nullable=True
    )
    reviewed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # How the dispatcher established what happened, alongside the note saying what they
    # found. Nullable: every exception written before this column existed has no method,
    # and backfilling a guess would put invented contact history on an evidence record.
    # ExceptionContactMethod; migration ciaran_exc_review_semantics remaps every stored value:
    # 'phoned'->'phone', 'no_contact_yet'->NULL — see that enum's own comment for why
    # NO_CONTACT_YET has no equivalent here). String(20), not a native PG enum — matching
    # exception_type/source/severity above and every other enum column in this codebase.
    contact_method: Mapped[Optional[ExceptionContactMethod]] = mapped_column(
        String(20), nullable=True
    )
    merkle_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("merkle_batches.id"), nullable=True
    )
    # Task 5 (R13): a driver exception report IS itself the capture the assessment
    # describes, so it carries its own snapshot rather than pointing at another row's.
    # Populated where a caller builds a capture-time comparison, including phase
    # completions, checkpoints, and driver-raised exception reports.
    action_location_assessment: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
