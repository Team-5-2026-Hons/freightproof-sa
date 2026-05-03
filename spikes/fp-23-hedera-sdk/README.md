# Spike FP-23 — Hiero Python SDK on Hedera Testnet

Validates that `hiero-sdk-python` works end-to-end for the two HCS operations FreightProof uses in production:
creating a topic and submitting a message.

**This is throwaway proof-of-concept code. Nothing here is ever imported by the application.**

---

## Prerequisites

- Python 3.13+
- A Hedera testnet account with `HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY` in `backend/.env`
  (FP-24 — create one free at https://portal.hedera.com if not done)
- The scripts resolve `backend/.env` via a relative path (`../../backend/.env`) — run them from this directory

---

## Setup

```bash
cd spikes/fp-23-hedera-sdk
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

---

## Execution Order

### Step 1 — FP-25: Create an HCS topic

```bash
python 01_create_topic.py
```

Prints the new `topic_id` and writes it to `topic_id.txt`.

### Step 2 — FP-26: Submit a message to the topic

```bash
python 02_submit_message.py
```

Reads `topic_id.txt`, submits a realistic FreightProof anchor payload, prints the receipt,
and confirms the message via the Hedera mirror REST API.

### Step 3 — FP-27: Record findings

Open `03_findings.md` and fill in every field with real output from Steps 1 and 2.
Commit the completed findings doc to the spike branch.

---

## Verification

| Check | How |
|-------|-----|
| Both scripts exit 0 | No unhandled exceptions |
| `topic_id.txt` exists | Contains a valid `0.0.XXXXXX` ID after Step 1 |
| Receipt status = SUCCESS | Printed by both scripts |
| Message visible on mirror | Open the URL printed by `02_submit_message.py` in a browser |
| Cross-check on HashScan | https://hashscan.io/testnet — search the transaction ID |

---

## Out of Scope

- Writing `backend/app/blockchain/hedera.py` (happens after findings are reviewed)
- Adding `hiero-sdk-python` to `backend/requirements.txt` (deferred until version confirmed)
- Any mainnet interaction — **testnet only**
- Database, Alembic, Celery, or frontend changes
