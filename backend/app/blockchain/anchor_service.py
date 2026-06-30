"""Orchestration-layer wrapper around HederaService + BlockchainReceipt persistence.

This is the single function called sync today and async via Celery later.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaService, HederaTimeoutError
from app.core.config import settings
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import BlockchainReceiptType, SubjectType

logger = logging.getLogger(__name__)


def canonicalize_payload(payload: dict[str, Any]) -> str:
    """JSON with sorted keys and no whitespace — reproducible from any language."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def compute_payload_hash(payload: dict[str, Any]) -> str:
    """SHA-256 hex over the canonical JSON encoding of payload."""
    canonical = canonicalize_payload(payload)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _parse_consensus_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Hedera/Java returns 9 digits of nanoseconds (e.g. 2021-06-23T10:13:30.123456789Z)
        # Python's fromisoformat only supports 6 digits (microseconds).
        # We replace the Z and slice off the last 3 digits of the fractional seconds if there are 9.
        val = value.replace("Z", "+00:00")
        if "." in val and "+" in val:
            time_part, tz_part = val.split("+")
            secs, frac = time_part.split(".")
            if len(frac) > 6:
                val = f"{secs}.{frac[:6]}+{tz_part}"
        return datetime.fromisoformat(val)
    except ValueError:
        return None


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

    Typical latency ~4-6s on the Hedera SDK call. The caller is responsible for
    whether this runs inside an HTTP request handler (demo path) or a Celery task
    (production path).

    submit_hash() is a synchronous SDK call with no built-in timeout, so it runs in
    a worker thread (asyncio.to_thread) bounded by HEDERA_SUBMIT_TIMEOUT_SECONDS —
    without this, a stalled Hedera/network call blocks the event loop indefinitely,
    hanging every request the server is handling, not just this one.

    Raises any HederaServiceError uncaught (including HederaTimeoutError on
    timeout) — the caller transaction should roll back.
    """
    data_hash = compute_payload_hash(canonical_payload)

    service = hedera_service or HederaService()
    timeout = settings.HEDERA_SUBMIT_TIMEOUT_SECONDS
    try:
        hedera_receipt = await asyncio.wait_for(
            asyncio.to_thread(service.submit_hash, data_hash),
            timeout=timeout,
        )
    except asyncio.TimeoutError as exc:
        logger.error(
            "Hedera submit_hash timed out after %.1fs (subject_type=%s, subject_id=%s)",
            timeout, subject_type.value, subject_id,
        )
        raise HederaTimeoutError(
            f"Hedera anchoring did not respond within {timeout:.0f}s. "
            "The change was not saved — please retry."
        ) from exc

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
        hedera_consensus_timestamp=_parse_consensus_timestamp(
            hedera_receipt.consensus_timestamp
        ),
        payload_json=canonical_payload,
    )
    db.add(receipt)
    await db.flush()
    return receipt
