"""SQLAlchemy models for the receiver QR handover (FP-155): a capability token is
single-use, short-lived, and bound to one stop, making the receiver's confirmation
POST unforgeable without a receiver account or OTP."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import HandoverTokenRejectionReason


class HandoverCapabilityToken(Base):
    """One single-use grant to confirm a delivery at one stop. Redemption is an atomic
    `UPDATE ... WHERE redeemed_at IS NULL AND expires_at > now()`, so simultaneous
    scans race the database, not application code."""

    __tablename__ = "handover_capability_tokens"
    # Declared as Index (not unique constraint) so autogenerate stops proposing to
    # drop/replace indexes that already exist in the deployed DB.
    __table_args__ = (
        Index("uq_handover_capability_tokens_token_hash", "token_hash", unique=True),
        Index("ix_handover_capability_tokens_phase_event", "phase_event_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phase_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=False
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    trip_stop_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=False
    )
    # SHA-256 hex digest of the raw token; the raw value is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    redeemed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when the receiver's browser first loads the token page (FP-239). Non-null pauses
    # rotation (rotate_capability_token won't retire or replace an opened token) but is not
    # itself a redemption or claim — an opened, unconfirmed token still expires normally.
    opened_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set once when the token's life is extended for identity verification (spec §6.3);
    # NULL-ness gates the single-claim UPDATE in extend_token_for_verification.
    verification_extended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # SHA-256 of a browser-binding secret set as an HttpOnly cookie on first page load.
    # Confirming needs both this and the URL token, so a forwarded link with no cookie
    # can't confirm — it binds a browser profile, not a device.
    session_secret_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class HandoverTokenAttempt(Base):
    """Every redemption attempt against a capability token, accepted or rejected — a
    rejected attempt is evidence in its own right. `token_id` is nullable for UNKNOWN
    attempts (a presented token matching nothing), which still get logged with the
    presented trip/stop ids."""

    __tablename__ = "handover_token_attempts"
    # Declared so autogenerate stops proposing to drop an index that already exists
    # in the deployed database.
    __table_args__ = (
        Index("ix_handover_token_attempts_token_id", "token_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_capability_tokens.id"), nullable=True
    )
    presented_trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    presented_trip_stop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # NULL means success; otherwise one of HandoverTokenRejectionReason (never free
    # text) so rejected/unknown/expired responses stay identical and queryable.
    rejection_reason: Mapped[Optional[HandoverTokenRejectionReason]] = mapped_column(
        String(30), nullable=True
    )
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class HandoverConfirmation(Base):
    """What the receiver did once a capability token was redeemed. One confirmation
    per `phase_event_id` (unique constraint), since FP-237's rotating series issues
    many tokens per event. Receiver name/ID live only in the attestation PNG (Supabase
    Storage, af-south-1), never in a column; `receiver_ip`/`receiver_user_agent` are
    weak evidence signals only, never identifiers (SA mobile networks are heavily
    CGNAT'd)."""

    __tablename__ = "handover_confirmations"
    __table_args__ = (
        UniqueConstraint("phase_event_id", name="uq_handover_confirmations_phase_event_id"),
        # Declared so autogenerate stops proposing to drop an index that already exists
        # in the deployed database.
        Index("ix_handover_confirmations_trip_id", "trip_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # The redeemed grant this confirmation came through; non-null since every
    # confirmation is a scan.
    token_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_capability_tokens.id"), nullable=False
    )
    phase_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=False
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    # Attestation PNG rendered by the receiver's own browser, submitted by the driver
    # as pod_signature_artifact_id.
    signature_artifact_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=False
    )
    # Receiver's own position fix — a third independent source alongside the driver's
    # phone and Pulsit. Nullable: a browser may fail to produce one.
    receiver_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    receiver_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    receiver_accuracy_m: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2), nullable=True)
    # 45 chars holds the longest legitimate IPv6 (with IPv4-mapped suffix) form.
    receiver_ip: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    receiver_user_agent: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # FP-240. True if the confirming request carried an Authorization header (most
    # plausibly the driver's own handset); recorded as evidence, never used as a gate.
    bearer_token_present: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Server clock only — never trust the client clock.
    confirmed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
