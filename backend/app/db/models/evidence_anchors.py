"""FP-290: which photos belong to an exception report, and the anchor events that commit it.

An EvidenceAnchorEvent is the application identity of one Hedera receipt: one per action
(raise / review / cancel) on an exception. The row freezes what was committed (payload_json,
event_hash) at the moment of the action, so a Hedera outage leaves retryable debt instead of
losing the evidence, and the verifier can tell later source edits from the original.
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import AnchorStatus, BlockchainReceiptType


class ExceptionArtifact(Base):
    """One photo of an exception report, at a fixed position. Membership is written once at
    creation and never edited, because the report's receipt commits to exactly this set.
    No ON DELETE: evidence is never cascaded away."""

    __tablename__ = "exception_artifacts"
    __table_args__ = (
        UniqueConstraint("exception_id", "artifact_id", name="uq_exception_artifacts_exception_artifact"),
        UniqueConstraint("exception_id", "position", name="uq_exception_artifacts_exception_position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exception_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exceptions.id", name="fk_exception_artifacts_exception_id"),
        nullable=False,
    )
    artifact_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id", name="fk_exception_artifacts_artifact_id"),
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class EvidenceAnchorEvent(Base):
    """One anchorable action on an exception. payload_json and event_hash are written once
    in the same transaction as the action and are never updated; only anchor_status,
    receipt_id and the timestamps change afterwards."""

    __tablename__ = "evidence_anchor_events"
    __table_args__ = (
        UniqueConstraint("exception_id", "receipt_type", name="uq_evidence_anchor_events_exception_type"),
        Index("ix_evidence_anchor_events_status_updated", "anchor_status", "updated_at"),
        Index("ix_evidence_anchor_events_trip_id", "trip_id"),
        Index("ix_evidence_anchor_events_exception_id", "exception_id"),
        # Anchored if and only if a receipt is linked: the status can never claim a receipt
        # that is not there, nor hide one that is.
        CheckConstraint(
            "(anchor_status = 'anchored') = (receipt_id IS NOT NULL)",
            name="ck_evidence_anchor_events_anchored_has_receipt",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id", name="fk_evidence_anchor_events_trip_id"), nullable=False,
    )
    exception_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exceptions.id", name="fk_evidence_anchor_events_exception_id"),
        nullable=False,
    )
    receipt_type: Mapped[BlockchainReceiptType] = mapped_column(String(30), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_json: Mapped[Any] = mapped_column(JSONB, nullable=False)
    event_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    anchor_status: Mapped[AnchorStatus] = mapped_column(
        String(20), nullable=False, default=AnchorStatus.PENDING.value
    )
    receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("blockchain_receipts.id", name="fk_evidence_anchor_events_receipt_id"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
