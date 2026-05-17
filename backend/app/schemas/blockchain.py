"""Pydantic v2 schemas for BlockchainReceipt, MerkleBatch, MerkleBatchLeaf."""

from datetime import datetime
from uuid import UUID
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, field_validator

from app.db.models.enums import BlockchainReceiptType, MerkleBatchType, SubjectType, VerifyStatus

_VALID_LEAF_SOURCE_TYPES = frozenset({"checkpoint", "exception", "artifact"})


class BlockchainReceiptBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    receipt_type: BlockchainReceiptType
    data_hash: str
    payload_json: Any


class BlockchainReceiptCreate(BlockchainReceiptBase):
    pass


class BlockchainReceiptUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    hedera_topic_id: Optional[str] = None
    hedera_tx_id: Optional[str] = None
    hedera_sequence_number: Optional[int] = None
    hedera_consensus_timestamp: Optional[datetime] = None


class BlockchainReceiptReadLegacy(BlockchainReceiptBase):
    """Legacy receipt shape — uses trip_id from BlockchainReceiptBase.

    Kept for backward compatibility with any internal code that predates
    the subject_type/subject_id migration. New code should use
    BlockchainReceiptRead instead.
    """

    id: UUID
    hedera_topic_id: Optional[str] = None
    hedera_tx_id: Optional[str] = None
    hedera_sequence_number: Optional[int] = None
    hedera_consensus_timestamp: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class MerkleBatchBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    batch_type: MerkleBatchType


class MerkleBatchCreate(MerkleBatchBase):
    pass


class MerkleBatchUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    merkle_root: Optional[str] = None
    leaf_count: Optional[int] = None
    blockchain_receipt_id: Optional[UUID] = None


class MerkleBatchRead(MerkleBatchBase):
    id: UUID
    merkle_root: Optional[str] = None
    leaf_count: int
    blockchain_receipt_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime


class MerkleBatchLeafBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    batch_id: UUID
    leaf_index: int
    leaf_hash: str
    source_type: str
    source_id: UUID


class MerkleBatchLeafCreate(MerkleBatchLeafBase):
    @field_validator("source_type")
    @classmethod
    def validate_source_type(cls, v: str) -> str:
        if v not in _VALID_LEAF_SOURCE_TYPES:
            raise ValueError(
                f"source_type must be one of {sorted(_VALID_LEAF_SOURCE_TYPES)}, got '{v}'"
            )
        return v


class MerkleBatchLeafRead(MerkleBatchLeafBase):
    id: UUID
    created_at: datetime


class BlockchainReceiptRead(BaseModel):
    """Full receipt shape returned by blockchain endpoints and embedded in TripDetailResponse.

    Uses subject_type/subject_id rather than the legacy trip_id field so that
    receipts for vehicles, drivers, and events can all be represented uniformly.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    subject_type: SubjectType
    subject_id: UUID
    receipt_type: BlockchainReceiptType
    data_hash: str
    hedera_topic_id: Optional[str] = None
    hedera_sequence_number: Optional[int] = None
    hedera_consensus_timestamp: Optional[datetime] = None
    hedera_tx_id: Optional[str] = None
    created_at: datetime


class VerifyRequest(BaseModel):
    """Payload for POST /blockchain/verify."""

    subject_type: SubjectType
    subject_id: UUID


class VerifyResponse(BaseModel):
    """Result of a verification check against the Hedera on-chain record."""

    status: VerifyStatus
    receipt: Optional[BlockchainReceiptRead] = None
    expected_hash: Optional[str] = None
    current_hash: Optional[str] = None
