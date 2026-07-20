"""Unit test: a stalled Hedera submit_hash() call must fail fast with
HederaTimeoutError instead of hanging the request indefinitely.

Pure logic test — no DB, no HTTP. The timeout fires before anchor_subject()
ever touches the `db` argument, so a bare MagicMock() stands in for it.
"""

import time
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.blockchain.anchor_service import anchor_subject
from app.core.config import settings
from app.core.exceptions import HederaTimeoutError
from app.db.models.enums import BlockchainReceiptType, SubjectType


@pytest.mark.asyncio
async def test_anchor_subject_raises_timeout_error_when_hedera_call_stalls(monkeypatch):
    monkeypatch.setattr(settings, "HEDERA_SUBMIT_TIMEOUT_SECONDS", 0.05)

    def slow_submit_hash(_hash_hex: str):
        time.sleep(0.3)
        raise AssertionError("submit_hash must not be allowed to finish before the timeout fires")

    stub_service = MagicMock()
    stub_service.submit_hash.side_effect = slow_submit_hash

    with pytest.raises(HederaTimeoutError, match="did not respond within"):
        await anchor_subject(
            MagicMock(),
            subject_type=SubjectType.VEHICLE_EVENT,
            subject_id=uuid.uuid4(),
            canonical_payload={"hello": "world"},
            receipt_type=BlockchainReceiptType.VEHICLE_UPDATED,
            hedera_service=stub_service,
        )


@pytest.mark.asyncio
async def test_anchor_subject_succeeds_within_timeout(monkeypatch):
    """Sanity check: a normal, fast call still works once wrapped in to_thread/wait_for."""
    from app.blockchain.hedera import HederaReceipt

    monkeypatch.setattr(settings, "HEDERA_SUBMIT_TIMEOUT_SECONDS", 5.0)

    stub_service = MagicMock()
    stub_service.submit_hash.return_value = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=7,
        consensus_timestamp=None,
        transaction_id="0.0.12345@1715865600.0",
    )

    db = MagicMock()
    db.flush = AsyncMock()

    receipt = await anchor_subject(
        db,
        subject_type=SubjectType.VEHICLE_EVENT,
        subject_id=uuid.uuid4(),
        canonical_payload={"hello": "world"},
        receipt_type=BlockchainReceiptType.VEHICLE_UPDATED,
        hedera_service=stub_service,
    )

    assert receipt.hedera_sequence_number == 7
    db.add.assert_called_once()
