"""SQLAlchemy models supporting driver substitution (FP-83).

The completed custody amendment itself stays `DriverSubstitution` in trips.py. These tables
hold everything around it: the pending arrangement, each driver's immutable confirmation,
durable notices, late evidence, clarifications and the idempotency record.

Constraint and FK names are explicit and short: Base has no naming convention, the
hand-written migration must reproduce them exactly, and PostgreSQL silently truncates
identifiers past 63 characters.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text,
    UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base

REQUEST_STATES = ("pending", "completed", "cancelled")
CONFIRMATION_ROLES = ("outgoing", "incoming")
NOTICE_KINDS = ("arranged", "cancelled", "completed")
LATE_EVIDENCE_KINDS = ("phase", "checkpoint", "location", "exception")
LATE_EVIDENCE_STATUSES = ("awaiting_review", "acknowledged")
UPLOAD_PURPOSES = ("handover", "late_evidence")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class DriverSubstitutionRequest(Base):
    """A dispatcher-arranged handover that has not (or has not yet) changed custody.

    Only a completed `DriverSubstitution` changes who holds the trip, so a pending or
    cancelled request never affects the derived current driver. A material change cancels
    the request and creates a replacement; confirmed facts are never edited.
    """

    __tablename__ = "driver_substitution_requests"
    __table_args__ = (
        Index(
            "uq_dsub_requests_one_pending_per_trip", "trip_id", unique=True,
            postgresql_where=text("state = 'pending'"),
        ),
        Index("ix_dsub_requests_trip_id", "trip_id"),
        CheckConstraint("version >= 1", name="ck_dsub_requests_version_positive"),
        CheckConstraint(_in_list("state", REQUEST_STATES), name="ck_dsub_requests_state"),
        CheckConstraint("(request_format = 'planned_v1' AND reservation_start_at IS NULL AND num_nonnulls(exchange_label, exchange_latitude, exchange_longitude, exchange_instructions, expected_at, is_planned) = 6) OR (request_format = 'immediate_v2' AND reservation_start_at IS NOT NULL AND num_nonnulls(exchange_label, exchange_latitude, exchange_longitude, exchange_instructions, expected_at, is_planned) = 0)", name="ck_dsub_requests_format_shape"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id", name="fk_dsub_requests_trip_id"), nullable=False
    )
    outgoing_driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_dsub_requests_outgoing_driver_id"), nullable=False
    )
    incoming_driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_dsub_requests_incoming_driver_id"), nullable=False
    )
    request_format: Mapped[str] = mapped_column(String(20), nullable=False, server_default="planned_v1")
    reservation_start_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    exchange_label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    exchange_latitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    exchange_longitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    exchange_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    is_planned: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    arranged_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", name="fk_dsub_requests_arranged_by_user_id"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    state: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending")
    replacement_request_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("driver_substitution_requests.id", name="fk_dsub_requests_replacement_id"),
        nullable=True,
    )
    terminal_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    terminal_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DriverSubstitutionConfirmation(Base):
    """One immutable capture per request and authenticated role.

    `captured_at` is the device's claim and never authorises anything; `received_at` is the
    server's. Location is all-or-nothing and its absence is preserved, never invented.
    """

    __tablename__ = "driver_substitution_confirmations"
    __table_args__ = (
        UniqueConstraint("request_id", "role", name="uq_dsub_confirmations_request_role"),
        CheckConstraint(_in_list("role", CONFIRMATION_ROLES), name="ck_dsub_confirmations_role"),
        CheckConstraint(
            "(latitude IS NULL) = (longitude IS NULL) AND (latitude IS NULL) = (accuracy_metres IS NULL)",
            name="ck_dsub_confirmations_location_together",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("driver_substitution_requests.id", name="fk_dsub_conf_request_id"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_dsub_conf_driver_id"), nullable=False
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    location_observed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    location_unavailable_reason: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    latitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    longitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    accuracy_metres: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    confirmed_vehicle_ids: Mapped[Any] = mapped_column(JSONB, nullable=False)
    seal_checks: Mapped[Any] = mapped_column(JSONB, nullable=False)
    discrepancy_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    action_location_assessment: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DriverSubstitutionConfirmationArtifact(Base):
    """Which evidence photo supports a confirmation, for which vehicle, in what order."""

    __tablename__ = "driver_substitution_confirmation_artifacts"
    __table_args__ = (
        UniqueConstraint("confirmation_id", "artifact_id", name="uq_dsub_conf_art_confirmation_artifact"),
        UniqueConstraint("confirmation_id", "position", name="uq_dsub_conf_art_confirmation_position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    confirmation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("driver_substitution_confirmations.id", name="fk_dsub_conf_art_confirmation_id"),
        nullable=False,
    )
    artifact_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id", name="fk_dsub_conf_art_artifact_id"), nullable=False
    )
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id", name="fk_dsub_conf_art_vehicle_id"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DriverSubstitutionUpload(Base):
    """Why a substitution-route photo was uploaded, by whom, and for what (FP-83 C4).

    A handover photo is uploaded before its confirmation exists, and a late-evidence photo
    before its receipt, so neither can borrow a phase attribution. This row records the purpose
    explicitly instead: a handover upload belongs to one request and the uploader's role on it;
    a late upload belongs to the custody period the uploader claimed. A confirmation or late
    receipt may cite only its own driver's uploads of the matching purpose, which is what stops
    one driver's photo from satisfying the other driver's independent capture. An unused upload
    is kept (evidence is never deleted) but appears in no confirmation.
    """

    __tablename__ = "driver_substitution_uploads"
    __table_args__ = (
        UniqueConstraint("artifact_id", name="uq_dsub_uploads_artifact"),
        CheckConstraint(_in_list("purpose", UPLOAD_PURPOSES), name="ck_dsub_uploads_purpose"),
        CheckConstraint(
            "(purpose = 'handover') = (request_id IS NOT NULL AND role IS NOT NULL AND custody_sequence IS NULL)"
            " AND (purpose = 'late_evidence') = (request_id IS NULL AND role IS NULL AND custody_sequence IS NOT NULL)",
            name="ck_dsub_uploads_scope",
        ),
        CheckConstraint("role IS NULL OR " + _in_list("role", CONFIRMATION_ROLES), name="ck_dsub_uploads_role"),
        Index("ix_dsub_uploads_request_id", "request_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    artifact_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id", name="fk_dsub_uploads_artifact_id"), nullable=False
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id", name="fk_dsub_uploads_trip_id"), nullable=False
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_dsub_uploads_driver_id"), nullable=False
    )
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    request_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("driver_substitution_requests.id", name="fk_dsub_uploads_request_id"),
        nullable=True,
    )
    role: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    custody_sequence: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DriverSubstitutionNotice(Base):
    """A durable in-app notice for one driver; a missed realtime event is recovered from here.

    Reading a notice is not a confirmation and never moves custody.
    """

    __tablename__ = "driver_substitution_notices"
    __table_args__ = (
        UniqueConstraint("recipient_driver_id", "request_id", "kind", name="uq_dsub_notices_recipient_request_kind"),
        CheckConstraint(_in_list("kind", NOTICE_KINDS), name="ck_dsub_notices_kind"),
        Index(
            "ix_dsub_notices_recipient_unread", "recipient_driver_id",
            postgresql_where=text("read_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipient_driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_dsub_notices_recipient_id"), nullable=False
    )
    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("driver_substitution_requests.id", name="fk_dsub_notices_request_id"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class LateDriverEvidence(Base):
    """Evidence a former (or otherwise out-of-context) driver captured in their own custody
    period, retained for dispatcher acknowledgement. It never advances a phase or changes
    custody; acknowledgement edits only the review fields."""

    __tablename__ = "late_driver_evidence"
    __table_args__ = (
        Index("ix_late_driver_evidence_trip_id", "trip_id"),
        CheckConstraint("custody_sequence >= 0", name="ck_late_evidence_sequence"),
        CheckConstraint(_in_list("kind", LATE_EVIDENCE_KINDS), name="ck_late_evidence_kind"),
        CheckConstraint(_in_list("status", LATE_EVIDENCE_STATUSES), name="ck_late_evidence_status"),
        CheckConstraint(
            "(status = 'acknowledged') = (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)",
            name="ck_late_evidence_review_complete",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id", name="fk_late_evidence_trip_id"), nullable=False
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_late_evidence_driver_id"), nullable=False
    )
    custody_sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    evidence_json: Mapped[Any] = mapped_column(JSONB, nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    original_idempotency_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="awaiting_review")
    reviewed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", name="fk_late_evidence_reviewed_by"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class LateDriverEvidenceArtifact(Base):
    """Which retained photos belong to a piece of late evidence, in order."""

    __tablename__ = "late_driver_evidence_artifacts"
    __table_args__ = (
        UniqueConstraint("late_evidence_id", "artifact_id", name="uq_late_evidence_art_evidence_artifact"),
        UniqueConstraint("late_evidence_id", "position", name="uq_late_evidence_art_evidence_position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    late_evidence_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("late_driver_evidence.id", name="fk_late_evidence_art_evidence_id"),
        nullable=False,
    )
    artifact_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id", name="fk_late_evidence_art_artifact_id"),
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DriverSubstitutionCorrection(Base):
    """An immutable clarification appended to a completed substitution.

    It annotates the record and carries its own frozen payload, hash and anchor state. It
    can never change the drivers, the effective time or the derived current owner.
    """

    __tablename__ = "driver_substitution_corrections"
    __table_args__ = (
        Index("ix_dsub_corrections_substitution_id", "substitution_id"),
        Index("ix_dsub_corrections_status_updated", "anchor_status", "updated_at"),
        CheckConstraint(
            "(anchor_status = 'anchored') = (receipt_id IS NOT NULL)",
            name="ck_dsub_corrections_anchored_has_receipt",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    substitution_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("driver_substitutions.id", name="fk_dsub_corrections_substitution_id"),
        nullable=False,
    )
    recorded_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", name="fk_dsub_corrections_recorded_by"), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    correction_note: Mapped[str] = mapped_column(Text, nullable=False)
    payload_version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_json: Mapped[Any] = mapped_column(JSONB, nullable=False)
    event_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    anchor_status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending")
    receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("blockchain_receipts.id", name="fk_dsub_corrections_receipt_id"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DriverSubstitutionOperation(Base):
    """Idempotency record for one authenticated actor's state-changing call.

    One request sees many operations over its life, so a single last-key column on the
    request would be insufficient. The key is scoped to actor and action; the body digest
    detects a reused key with different content.
    """

    __tablename__ = "driver_substitution_operations"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(actor_driver_id, actor_user_id) = 1", name="ck_dsub_operations_one_actor"
        ),
        Index(
            "uq_dsub_operations_driver_action_key", "actor_driver_id", "action", "client_request_id",
            unique=True, postgresql_where=text("actor_driver_id IS NOT NULL"),
        ),
        Index(
            "uq_dsub_operations_user_action_key", "actor_user_id", "action", "client_request_id",
            unique=True, postgresql_where=text("actor_user_id IS NOT NULL"),
        ),
        Index("ix_dsub_operations_request_id", "request_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", name="fk_dsub_operations_actor_driver_id"), nullable=True
    )
    actor_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", name="fk_dsub_operations_actor_user_id"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    client_request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    body_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    request_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("driver_substitution_requests.id", name="fk_dsub_operations_request_id"),
        nullable=True,
    )
    late_evidence_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("late_driver_evidence.id", name="fk_dsub_operations_late_evidence_id"),
        nullable=True,
    )
    result_json: Mapped[Any] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
