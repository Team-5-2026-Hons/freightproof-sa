"""Unit tests for HederaService wrapper."""

from __future__ import annotations

import base64

import httpx
import pytest

from app.blockchain.hedera import HederaConfigError
from app.blockchain.hedera import HederaReceipt
from app.blockchain.hedera import HederaService
from app.blockchain.hedera import HederaSubmitError
from app.blockchain.hedera import HederaVerifyError


class _FakeAdapter:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def submit_message(self, topic_id: str, message: str) -> HederaReceipt:
        self.calls.append((topic_id, message))
        return HederaReceipt(
            topic_id=topic_id,
            sequence_number=41,
            consensus_timestamp="2026-05-13T10:00:00Z",
            transaction_id="0.0.111-1234567890-000000001",
        )


def test_submit_hash_calls_adapter_with_normalized_hash() -> None:
    adapter = _FakeAdapter()
    service = HederaService(
        network="testnet",
        account_id="0.0.1001",
        private_key="302e020100300506032b657004220420dummy",
        topic_id="0.0.2002",
        adapter=adapter,
    )

    receipt = service.submit_hash("AA" * 32)

    assert adapter.calls == [("0.0.2002", "aa" * 32)]
    assert receipt.sequence_number == 41


def test_submit_hash_rejects_invalid_sha256_hex() -> None:
    adapter = _FakeAdapter()
    service = HederaService(
        network="testnet",
        account_id="0.0.1001",
        private_key="302e020100300506032b657004220420dummy",
        topic_id="0.0.2002",
        adapter=adapter,
    )

    with pytest.raises(HederaSubmitError):
        service.submit_hash("not-a-hash")


def test_verify_hash_returns_true_when_message_matches() -> None:
    expected_hash = "a" * 64
    encoded = base64.b64encode(expected_hash.encode("utf-8")).decode("utf-8")

    def _handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/api/v1/topics/0.0.2002/messages/7")
        return httpx.Response(200, json={"message": encoded})

    client = httpx.Client(transport=httpx.MockTransport(_handler))
    service = HederaService(
        network="testnet",
        account_id="0.0.1001",
        private_key="302e020100300506032b657004220420dummy",
        topic_id="0.0.2002",
        adapter=_FakeAdapter(),
        http_client=client,
    )

    assert service.verify_hash("0.0.2002", 7, expected_hash)


def test_verify_hash_returns_false_when_message_differs() -> None:
    encoded = base64.b64encode(("b" * 64).encode("utf-8")).decode("utf-8")

    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message": encoded})

    client = httpx.Client(transport=httpx.MockTransport(_handler))
    service = HederaService(
        network="testnet",
        account_id="0.0.1001",
        private_key="302e020100300506032b657004220420dummy",
        topic_id="0.0.2002",
        adapter=_FakeAdapter(),
        http_client=client,
    )

    assert not service.verify_hash("0.0.2002", 7, "a" * 64)


def test_verify_hash_raises_on_http_error() -> None:
    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"status": "not-found"})

    client = httpx.Client(transport=httpx.MockTransport(_handler))
    service = HederaService(
        network="testnet",
        account_id="0.0.1001",
        private_key="302e020100300506032b657004220420dummy",
        topic_id="0.0.2002",
        adapter=_FakeAdapter(),
        http_client=client,
    )

    with pytest.raises(HederaVerifyError):
        service.verify_hash("0.0.2002", 7, "a" * 64)


def test_missing_config_raises() -> None:
    with pytest.raises(HederaConfigError):
        HederaService(
            network="testnet",
            account_id="",
            private_key="abc",
            topic_id="0.0.2002",
            adapter=_FakeAdapter(),
        )
