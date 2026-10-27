"""Receiver identity verification via Didit, and the free-tier quota that meters it.
No document/face image or extracted ID number is stored here — only a decision and
session reference; a dispute must re-query the vendor for the underlying images."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import (
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)


class ReceiverIdentityVerification(Base):
    """One identity check against one handover confirmation.

    Keyed on the capability token rather than the confirmation, because the spec's
    ordering is verify-then-confirm: this row exists before the receiver signs. The
    unique constraint on token_id is what makes "one verification per grant" true at
    the database rather than at the application's word.
    """

    __tablename__ = "receiver_identity_verifications"
    __table_args__ = (
        UniqueConstraint("token_id", name="uq_receiver_identity_verifications_token_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_capability_tokens.id"), nullable=False
    )
    handover_confirmation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_confirmations.id"), nullable=True
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)

    status: Mapped[ReceiverVerificationStatus] = mapped_column(String(20), nullable=False)
    tier: Mapped[ReceiverVerificationTier] = mapped_column(String(20), nullable=False)
    unverified_reason: Mapped[Optional[ReceiverVerificationUnverifiedReason]] = mapped_column(
        String(30), nullable=True
    )

    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    provider_session_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    provider_decision_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    identity_match: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    selfie_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=True
    )

    consent_given_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    consent_text_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    late_decision_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    late_decision_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class IdvsQuotaLedger(Base):
    """How many free vendor sessions this calendar month has spent, one row per
    (period, provider). A hard stop: at the limit we stop calling the vendor and
    degrade the handover, rather than let session 501 silently bill."""

    __tablename__ = "idvs_quota_ledger"
    __table_args__ = (
        UniqueConstraint("period", "provider", name="uq_idvs_quota_ledger_period_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    period: Mapped[str] = mapped_column(String(7), nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    sessions_used: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
