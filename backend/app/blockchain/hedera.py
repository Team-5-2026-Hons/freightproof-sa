"""Hedera HCS service wrapper for FreightProof evidence anchoring.

This module exposes a narrow, testable API for anchoring evidence hashes:

- submit_hash(hash_hex) -> HederaReceipt
- verify_hash(topic_id, sequence_number, expected_hash_hex) -> bool

Only SHA-256 hex digests are accepted. Raw evidence payloads must never be sent
to blockchain for POPIA compliance.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from typing import Protocol

import httpx


SHA256_HEX_PATTERN = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class HederaReceipt:
    """Minimal receipt fields needed by orchestration and persistence layers."""

    topic_id: str
    sequence_number: int
    consensus_timestamp: str | None
    transaction_id: str | None


class HederaServiceError(Exception):
    """Base exception for Hedera service failures."""


class HederaConfigError(HederaServiceError):
    """Raised when required Hedera configuration is missing or invalid."""


class HederaDependencyError(HederaServiceError):
    """Raised when the Hedera SDK dependency is unavailable."""


class HederaSubmitError(HederaServiceError):
    """Raised when submitting a hash to HCS fails."""


class HederaVerifyError(HederaServiceError):
    """Raised when mirror-node verification fails."""


class _HederaAdapter(Protocol):
    def submit_message(self, topic_id: str, message: str) -> HederaReceipt:
        """Submit a string message to the specified HCS topic."""


class _SdkHederaAdapter:
    """Thin adapter around hedera-sdk-py to keep HederaService testable."""

    def __init__(self, network: str, account_id: str, private_key: str) -> None:
        try:
            from hedera import AccountId, Client, PrivateKey
        except ImportError as exc:
            raise HederaDependencyError(
                "hedera-sdk-py is required for HederaService. "
                "Install backend dependencies to include it."
            ) from exc

        # hedera-sdk-py wraps the Java SDK via pyjnius — all names are Java camelCase.
        normalized_network = network.strip().lower()
        if normalized_network == "testnet":
            client = Client.forTestnet()
        elif normalized_network == "mainnet":
            client = Client.forMainnet()
        elif normalized_network == "previewnet":
            client = Client.forPreviewnet()
        else:
            raise HederaConfigError(
                f"Unsupported HEDERA_NETWORK '{network}'. "
                "Expected one of: testnet, mainnet, previewnet."
            )

        # Strip leading 0x if present — fromStringECDSA expects raw hex only.
        raw_key = private_key.strip().removeprefix("0x")
        client.setOperator(
            AccountId.fromString(account_id),
            PrivateKey.fromStringECDSA(raw_key),
        )
        self._client = client

    def submit_message(self, topic_id: str, message: str) -> HederaReceipt:
        from hedera import TopicId, TopicMessageSubmitTransaction

        topic = TopicId.fromString(topic_id)
        tx = TopicMessageSubmitTransaction().setTopicId(topic).setMessage(message)

        tx_response = tx.execute(self._client)
        receipt = tx_response.getReceipt(self._client)

        sequence_number = getattr(receipt, "topicSequenceNumber", None)
        if sequence_number is None:
            raise HederaSubmitError(
                "Hedera receipt did not include topicSequenceNumber."
            )

        tx_id = getattr(tx_response, "transactionId", None)
        transaction_id = str(tx_id) if tx_id is not None else None

        consensus_timestamp: str | None = None
        try:
            tx_record = tx_response.getRecord(self._client)
            maybe_timestamp = getattr(tx_record, "consensusTimestamp", None)
            if maybe_timestamp is not None:
                consensus_timestamp = str(maybe_timestamp)
        except Exception:
            consensus_timestamp = None

        # receipt.topicId can be Java null (pyjnius maps it to Python None) on
        # TopicMessageSubmit receipts — fall back to the known topic_id we submitted to.
        raw_topic_id = getattr(receipt, "topicId", None)
        resolved_topic_id = str(raw_topic_id) if raw_topic_id is not None else topic_id

        return HederaReceipt(
            topic_id=resolved_topic_id,
            sequence_number=int(sequence_number),
            consensus_timestamp=consensus_timestamp,
            transaction_id=transaction_id,
        )


class HederaService:
    """FreightProof-facing API for Hedera HCS evidence anchoring."""

    def __init__(
        self,
        *,
        network: str | None = None,
        account_id: str | None = None,
        private_key: str | None = None,
        topic_id: str | None = None,
        mirror_base_url: str | None = None,
        adapter: _HederaAdapter | None = None,
        http_client: httpx.Client | None = None,
    ) -> None:
        if any(v is None for v in (network, account_id, private_key, topic_id)):
            from app.core.config import settings

            network = network or settings.HEDERA_NETWORK
            account_id = account_id or settings.HEDERA_ACCOUNT_ID
            private_key = private_key or settings.HEDERA_PRIVATE_KEY
            topic_id = topic_id or settings.HEDERA_TOPIC_ID

        self._network = _require_non_empty("HEDERA_NETWORK", network)
        self._account_id = _require_non_empty("HEDERA_ACCOUNT_ID", account_id)
        self._private_key = _require_non_empty("HEDERA_PRIVATE_KEY", private_key)
        self._topic_id = _require_non_empty("HEDERA_TOPIC_ID", topic_id)

        self._adapter = adapter or _SdkHederaAdapter(
            network=self._network,
            account_id=self._account_id,
            private_key=self._private_key,
        )

        self._mirror_base_url = (
            mirror_base_url.strip().rstrip("/")
            if mirror_base_url
            else _default_mirror_url(self._network)
        )
        self._http_client = http_client or httpx.Client(timeout=10.0)

    def submit_hash(self, hash_hex: str) -> HederaReceipt:
        """Submit a SHA-256 hash to HCS and return the resulting receipt."""
        normalized_hash = _normalize_sha256_hex(hash_hex)
        try:
            return self._adapter.submit_message(self._topic_id, normalized_hash)
        except HederaServiceError:
            raise
        except Exception as exc:
            raise HederaSubmitError("Failed to submit hash to Hedera HCS.") from exc

    def verify_hash(
        self,
        topic_id: str,
        sequence_number: int,
        expected_hash_hex: str,
    ) -> bool:
        """Verify a sequence message matches the expected SHA-256 hash."""
        normalized_expected_hash = _normalize_sha256_hex(expected_hash_hex)
        if sequence_number < 1:
            raise HederaVerifyError("sequence_number must be >= 1.")

        endpoint = (
            f"{self._mirror_base_url}/api/v1/topics/"
            f"{topic_id}/messages/{sequence_number}"
        )

        try:
            response = self._http_client.get(endpoint)
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            raise HederaVerifyError("Failed to query Hedera mirror node.") from exc

        encoded_message = payload.get("message")
        if not isinstance(encoded_message, str) or not encoded_message:
            raise HederaVerifyError("Mirror node response missing message payload.")

        try:
            decoded = base64.b64decode(encoded_message).decode("utf-8")
        except Exception as exc:
            raise HederaVerifyError("Failed to decode mirror-node message payload.") from exc

        return decoded.strip().lower() == normalized_expected_hash


def _normalize_sha256_hex(value: str) -> str:
    normalized = value.strip().lower()
    if not SHA256_HEX_PATTERN.match(normalized):
        raise HederaSubmitError(
            "Expected a SHA-256 hex digest (64 hex characters)."
        )
    return normalized


def _require_non_empty(name: str, value: str | None) -> str:
    if value is None or not value.strip():
        raise HederaConfigError(f"{name} is required but missing.")
    return value.strip()


def _default_mirror_url(network: str) -> str:
    normalized = network.strip().lower()
    if normalized == "testnet":
        return "https://testnet.mirrornode.hedera.com"
    if normalized == "mainnet":
        return "https://mainnet-public.mirrornode.hedera.com"
    if normalized == "previewnet":
        return "https://previewnet.mirrornode.hedera.com"
    raise HederaConfigError(
        f"Unsupported HEDERA_NETWORK '{network}' for mirror-node lookup."
    )
