"""Orchestration-layer wrapper around HederaService + BlockchainReceipt persistence.

This is the single function called sync today and async via Celery later.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaService
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import BlockchainReceiptType, SubjectType


def canonicalize_payload(payload: dict[str, Any]) -> str:
    """JSON with sorted keys and no whitespace — reproducible from any language."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def compute_payload_hash(payload: dict[str, Any]) -> str:
    """SHA-256 hex over the canonical JSON encoding of payload."""
    canonical = canonicalize_payload(payload)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def anchor_subject(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    canonical_payload: dict[str, Any],
    receipt_type: BlockchainReceiptType,
    trip_id: uuid.UUID | None = None,
    hedera_service: HederaService | None = None,
) -> BlockchainReceipt:
    """Hash the payload, submit to HCS, persist a BlockchainReceipt, return it.

    Blocks ~4-6s on the Hedera SDK call. The caller is responsible for whether this
    runs inside an HTTP request handler (demo path) or a Celery task (production path).

    Raises any HederaServiceError uncaught — the caller transaction should roll back.
    """
    data_hash = compute_payload_hash(canonical_payload)

    service = hedera_service or HederaService()
    hedera_receipt = service.submit_hash(data_hash)

    receipt = BlockchainReceipt(
        id=uuid.uuid4(),
        trip_id=trip_id,
        subject_type=subject_type,
        subject_id=subject_id,
        receipt_type=receipt_type,
        data_hash=data_hash,
        hedera_topic_id=hedera_receipt.topic_id,
        hedera_tx_id=hedera_receipt.transaction_id,
        hedera_sequence_number=hedera_receipt.sequence_number,
        hedera_consensus_timestamp=None,
        payload_json=canonical_payload,
    )
    db.add(receipt)
    await db.flush()
    return receipt
