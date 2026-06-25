import uuid
from unittest.mock import MagicMock

import pytest

from app.blockchain.anchor_service import (
    anchor_subject,
    canonicalize_payload,
    compute_payload_hash,
)
from app.blockchain.hedera import HederaReceipt
from app.db.models.enums import BlockchainReceiptType, SubjectType


def test_canonicalize_is_deterministic_and_sorted():
    out1 = canonicalize_payload({"b": 2, "a": 1, "c": [3, 1, 2]})
    out2 = canonicalize_payload({"c": [3, 1, 2], "a": 1, "b": 2})
    assert out1 == out2
    assert out1 == '{"a":1,"b":2,"c":[3,1,2]}'


def test_hash_matches_manual_sha256():
    import hashlib
    import json

    payload = {"x": 1}
    expected = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    assert compute_payload_hash(payload) == expected


@pytest.mark.asyncio
async def test_anchor_subject_persists_receipt(db_session):
    stub_service = MagicMock()
    stub_service.submit_hash.return_value = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=41,
        consensus_timestamp="1715865600.000000000",
        transaction_id="0.0.12345@1715865600.000000000",
    )

    subject_id = uuid.uuid4()
    payload = {"hello": "world"}

    receipt = await anchor_subject(
        db_session,
        subject_type=SubjectType.VEHICLE_EVENT,
        subject_id=subject_id,
        canonical_payload=payload,
        receipt_type=BlockchainReceiptType.VEHICLE_CREATED,
        hedera_service=stub_service,
    )

    assert receipt.subject_id == subject_id
    assert receipt.subject_type == SubjectType.VEHICLE_EVENT
    assert receipt.hedera_sequence_number == 41
    assert receipt.hedera_topic_id == "0.0.12345"
    assert receipt.data_hash == compute_payload_hash(payload)
    stub_service.submit_hash.assert_called_once_with(receipt.data_hash)
