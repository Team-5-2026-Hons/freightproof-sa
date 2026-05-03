"""
FP-26 — Submit a message to an HCS topic on Hedera testnet.

Reads topic_id from topic_id.txt (written by 01_create_topic.py), submits a
realistic FreightProof anchor payload, prints the receipt, and verifies the
message is visible on the Hedera mirror REST API.

Run from the spike directory after 01_create_topic.py has succeeded:
    python 02_submit_message.py
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

_env_path = Path(__file__).parent / ".." / ".." / "backend" / ".env"
if not _env_path.exists():
    print(f"ERROR: backend/.env not found at {_env_path.resolve()}", file=sys.stderr)
    sys.exit(1)

load_dotenv(dotenv_path=_env_path)

ACCOUNT_ID = os.environ.get("HEDERA_ACCOUNT_ID", "")
PRIVATE_KEY = os.environ.get("HEDERA_PRIVATE_KEY", "")
NETWORK = os.environ.get("HEDERA_NETWORK", "testnet")
TOPIC_ID_FILE = Path(__file__).parent / "topic_id.txt"
MIRROR_BASE = "https://testnet.mirrornode.hedera.com/api/v1"

# Mirror node has propagation lag; we poll up to this many seconds before giving up.
MIRROR_POLL_TIMEOUT_SECONDS = 30
MIRROR_POLL_INTERVAL_SECONDS = 3

if not ACCOUNT_ID or not PRIVATE_KEY:
    print("ERROR: HEDERA_ACCOUNT_ID or HEDERA_PRIVATE_KEY missing from backend/.env", file=sys.stderr)
    sys.exit(1)

if NETWORK != "testnet":
    print(f"ERROR: HEDERA_NETWORK={NETWORK!r} — spike only runs against testnet.", file=sys.stderr)
    sys.exit(1)

if not TOPIC_ID_FILE.exists():
    print("ERROR: topic_id.txt not found — run 01_create_topic.py first.", file=sys.stderr)
    sys.exit(1)

topic_id_str = TOPIC_ID_FILE.read_text().strip()
if not topic_id_str:
    print("ERROR: topic_id.txt is empty — run 01_create_topic.py first.", file=sys.stderr)
    sys.exit(1)

# --- SDK imports -----------------------------------------------------------
try:
    from hiero import (
        AccountId,
        Client,
        PrivateKey,
        TopicId,
        TopicMessageSubmitTransaction,
    )
except ImportError as exc:
    print(f"ERROR: hiero-sdk-python not installed — {exc}", file=sys.stderr)
    print("  Run: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)


def build_anchor_payload(topic_id: str) -> dict:
    """Build a payload matching FreightProof's planned HCS anchor schema."""
    return {
        "event": "ORIGIN_GATE_IN",
        "trip_id": "spike-test-001",
        # Placeholder hash: production will use SHA-256 of serialised trip evidence.
        "hash": "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
        "timestamp": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "topic_id": topic_id,
    }


def poll_mirror_for_message(topic_id: str, tx_id: str) -> str | None:
    """
    Poll the Hedera mirror REST API until the submitted message appears or
    the timeout is reached. Returns the mirror URL on success, None on timeout.
    """
    mirror_url = f"{MIRROR_BASE}/topics/{topic_id}/messages"
    deadline = time.monotonic() + MIRROR_POLL_TIMEOUT_SECONDS

    print(f"Polling mirror node for confirmation (up to {MIRROR_POLL_TIMEOUT_SECONDS}s)…")
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(mirror_url, timeout=10) as response:
                data = json.loads(response.read())
                messages = data.get("messages", [])
                if messages:
                    return mirror_url
        except urllib.error.HTTPError as exc:
            # 404 before first message lands is expected; other codes are real errors.
            if exc.code != 404:
                print(f"  Mirror API error {exc.code}: {exc}", file=sys.stderr)
        except Exception as exc:
            print(f"  Mirror poll error: {exc}", file=sys.stderr)

        time.sleep(MIRROR_POLL_INTERVAL_SECONDS)

    return None


def main() -> None:
    print(f"Account:  {ACCOUNT_ID}")
    print(f"Network:  {NETWORK}")
    print(f"Topic ID: {topic_id_str}")
    print()

    client = Client.for_testnet()
    account_id = AccountId.from_string(ACCOUNT_ID)
    private_key = PrivateKey.from_string(PRIVATE_KEY)
    client.set_operator(account_id, private_key)

    topic_id = TopicId.from_string(topic_id_str)
    payload = build_anchor_payload(topic_id_str)
    payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    print("Payload:")
    print(json.dumps(payload, indent=2))
    print(f"Payload size: {len(payload_bytes)} bytes")
    print()

    print("Submitting TopicMessageSubmitTransaction…")
    t_start = time.monotonic()

    receipt = (
        TopicMessageSubmitTransaction()
        .set_topic_id(topic_id)
        .set_message(payload_bytes)
        .execute(client)
        .get_receipt(client)
    )

    elapsed = time.monotonic() - t_start
    status = receipt.status
    # Transaction ID format: accountId@seconds.nanos
    transaction_id = str(receipt.transaction_id) if hasattr(receipt, "transaction_id") else "n/a"

    print(f"Status:         {status}")
    print(f"Transaction ID: {transaction_id}")
    print(f"Latency:        {elapsed:.2f}s")
    print()

    if str(status) != "SUCCESS":
        print(f"ERROR: transaction did not succeed (status={status})", file=sys.stderr)
        sys.exit(1)

    # Confirm the message is visible on the public mirror node.
    mirror_url = poll_mirror_for_message(topic_id_str, transaction_id)

    hashscan_url = f"https://hashscan.io/testnet/transaction/{transaction_id}"

    if mirror_url:
        print(f"Mirror confirmed: {mirror_url}")
    else:
        print(f"WARNING: message not yet visible on mirror after {MIRROR_POLL_TIMEOUT_SECONDS}s", file=sys.stderr)
        print("  It may still appear — check manually:", file=sys.stderr)
        print(f"  {MIRROR_BASE}/topics/{topic_id_str}/messages", file=sys.stderr)

    print(f"HashScan:        {hashscan_url}")
    print()

    summary = {
        "topic_id": topic_id_str,
        "transaction_id": transaction_id,
        "status": str(status),
        "submission_latency_seconds": round(elapsed, 2),
        "mirror_confirmed": mirror_url is not None,
        "mirror_url": mirror_url or f"{MIRROR_BASE}/topics/{topic_id_str}/messages",
        "hashscan_url": hashscan_url,
        "payload_size_bytes": len(payload_bytes),
    }
    print("=== SUMMARY (copy into 03_findings.md) ===")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
