"""
FP-25 — Create an HCS topic on Hedera testnet.

Reads credentials from ../../backend/.env, creates a topic with a descriptive
memo, prints the topic_id, and writes it to topic_id.txt for use by script 02.

Run from the spike directory:
    python 01_create_topic.py
"""

import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

# Load from backend/.env relative to this script's location — no duplication of secrets.
_env_path = Path(__file__).parent / ".." / ".." / "backend" / ".env"
if not _env_path.exists():
    print(f"ERROR: backend/.env not found at {_env_path.resolve()}", file=sys.stderr)
    print("  Complete FP-24 first: create a testnet account at https://portal.hedera.com", file=sys.stderr)
    sys.exit(1)

load_dotenv(dotenv_path=_env_path)

ACCOUNT_ID = os.environ.get("HEDERA_ACCOUNT_ID", "")
PRIVATE_KEY = os.environ.get("HEDERA_PRIVATE_KEY", "")
NETWORK = os.environ.get("HEDERA_NETWORK", "testnet")
TOPIC_MEMO = "FreightProof SA — spike FP-25"
TOPIC_ID_FILE = Path(__file__).parent / "topic_id.txt"

if not ACCOUNT_ID or not PRIVATE_KEY:
    print("ERROR: HEDERA_ACCOUNT_ID or HEDERA_PRIVATE_KEY missing from backend/.env", file=sys.stderr)
    sys.exit(1)

if NETWORK != "testnet":
    # Safety guard: this spike must never touch mainnet.
    print(f"ERROR: HEDERA_NETWORK={NETWORK!r} — spike only runs against testnet.", file=sys.stderr)
    sys.exit(1)

# --- SDK imports -----------------------------------------------------------
# hiero-sdk-python must be installed in the active venv:
#   pip install -r requirements.txt
try:
    from hiero import (
        AccountId,
        Client,
        PrivateKey,
        TopicCreateTransaction,
    )
except ImportError as exc:
    print(f"ERROR: hiero-sdk-python not installed — {exc}", file=sys.stderr)
    print("  Run: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    print(f"Account:  {ACCOUNT_ID}")
    print(f"Network:  {NETWORK}")
    print(f"Memo:     {TOPIC_MEMO}")
    print()

    # Build client and set operator (the account that pays the transaction fee).
    client = Client.for_testnet()
    account_id = AccountId.from_string(ACCOUNT_ID)
    private_key = PrivateKey.from_string(PRIVATE_KEY)
    client.set_operator(account_id, private_key)

    print("Submitting TopicCreateTransaction…")
    t_start = time.monotonic()

    receipt = (
        TopicCreateTransaction()
        .set_topic_memo(TOPIC_MEMO)
        .execute(client)
        .get_receipt(client)
    )

    elapsed = time.monotonic() - t_start

    topic_id = receipt.topic_id
    status = receipt.status

    print(f"Status:   {status}")
    print(f"Topic ID: {topic_id}")
    print(f"Latency:  {elapsed:.2f}s")
    print()

    if str(status) != "SUCCESS":
        print(f"ERROR: transaction did not succeed (status={status})", file=sys.stderr)
        sys.exit(1)

    # Persist the topic_id so script 02 can read it without copy-pasting.
    TOPIC_ID_FILE.write_text(str(topic_id))
    print(f"topic_id written to {TOPIC_ID_FILE.name}")

    # Structured summary for findings doc.
    summary = {
        "topic_id": str(topic_id),
        "status": str(status),
        "latency_seconds": round(elapsed, 2),
        "memo": TOPIC_MEMO,
    }
    print()
    print("=== SUMMARY (copy into 03_findings.md) ===")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
