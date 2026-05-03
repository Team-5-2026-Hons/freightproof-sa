"""SQLAlchemy models for Hedera HCS receipts and Merkle batch structures."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import BlockchainReceiptType, MerkleBatchType


class BlockchainReceipt(Base):
    """Record of a single anchoring event on Hedera HCS.

    trip_id uses use_alter=True — see EvidenceArtifact for rationale.
    payload_json stores the hashed payload for audit; no PII (POPIA compliance).
    """

    __tablename__ = "blockchain_receipts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trips.id", use_alter=True, name="fk_blockchain_receipts_trip_id"),
        nullable=False,
    )
    receipt_type: Mapped[BlockchainReceiptType] = mapped_column(String(30), nullable=False)
    data_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hedera_topic_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    hedera_tx_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hedera_sequence_number: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    hedera_consensus_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payload_json: Mapped[Any] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class MerkleBatch(Base):
    """Merkle tree batch aggregating checkpoints or exceptions before anchoring.

    trip_id uses use_alter=True — see EvidenceArtifact for rationale.
    """

    __tablename__ = "merkle_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trips.id", use_alter=True, name="fk_merkle_batches_trip_id"),
        nullable=False,
    )
    batch_type: Mapped[MerkleBatchType] = mapped_column(String(20), nullable=False)
    merkle_root: Mapped[str | None] = mapped_column(String(64), nullable=True)
    leaf_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    blockchain_receipt_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("blockchain_receipts.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class MerkleBatchLeaf(Base):
    """Single leaf in a Merkle batch — points back to a checkpoint, exception, or artifact."""

    __tablename__ = "merkle_batch_leaves"
    __table_args__ = (
        UniqueConstraint("batch_id", "leaf_index", name="uq_merkle_batch_leaves_batch_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("merkle_batches.id"), nullable=False
    )
    leaf_index: Mapped[int] = mapped_column(Integer, nullable=False)
    leaf_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
