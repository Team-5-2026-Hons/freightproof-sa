"""Pydantic v2 schemas for BlockchainReceipt, MerkleBatch, MerkleBatchLeaf."""

import re
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.db.models.enums import BlockchainReceiptType, MerkleBatchType, SubjectType, VerifyStatus

_VALID_LEAF_SOURCE_TYPES = frozenset({"checkpoint", "exception", "artifact"})
_DATA_HASH_PATTERN = re.compile(r"[0-9a-f]{64}")
_HEDERA_TX_ID_MAX_LENGTH = 200


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


class BlockchainReceiptLookupQuery(BaseModel):
    """Validated query parameters for reverse receipt lookup."""

    model_config = ConfigDict(extra="forbid")

    data_hash: Optional[str] = None
    hedera_tx_id: Optional[str] = None
    subject_id: Optional[UUID] = None

    @field_validator("data_hash")
    @classmethod
    def normalize_data_hash(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().lower()
        if _DATA_HASH_PATTERN.fullmatch(normalized) is None:
            raise ValueError("data_hash must be exactly 64 hexadecimal characters")
        return normalized

    @field_validator("hedera_tx_id")
    @classmethod
    def normalize_hedera_tx_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("hedera_tx_id must not be blank")
        if len(normalized) > _HEDERA_TX_ID_MAX_LENGTH:
            raise ValueError(
                f"hedera_tx_id must be at most {_HEDERA_TX_ID_MAX_LENGTH} characters"
            )
        return normalized

    @model_validator(mode="after")
    def validate_exactly_one_lookup_value(self) -> "BlockchainReceiptLookupQuery":
        if (self.data_hash is None) == (self.hedera_tx_id is None):
            raise ValueError("exactly one of data_hash or hedera_tx_id must be provided")
        return self


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
