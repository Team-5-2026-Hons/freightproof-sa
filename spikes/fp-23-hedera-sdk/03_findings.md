# Spike FP-23 — Hedera SDK Findings

> Fill this in after running 01_create_topic.py and 02_submit_message.py.
> Commit this file to the spike branch once all fields are populated.

---

## Result: PASS / FAIL

---

## Environment

| Field | Value |
|-------|-------|
| SDK version | `hiero-sdk-python==x.y.z` (check: `pip show hiero-sdk-python`) |
| Python version | (check: `python --version`) |
| Testnet account | `0.0.xxxxxx` (testnet only — never mainnet) |
| Date run | YYYY-MM-DD |

---

## FP-25 — Topic Creation

| Field | Value |
|-------|-------|
| Topic ID | `0.0.xxxxxx` |
| Transaction status | `SUCCESS` / other |
| Creation latency | ~Xs |
| Memo used | `FreightProof SA — spike FP-25` |

---

## FP-26 — Message Submission

| Field | Value |
|-------|-------|
| Transaction ID | `0.0.xxxxxx@timestamp` |
| Transaction status | `SUCCESS` / other |
| Submission latency | ~Xs |
| Mirror confirmed | Yes / No |
| Mirror confirmation latency | ~Xs |
| Payload size | XX bytes |

**Mirror URL:**
```
https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.xxxxxx/messages
```

**HashScan URL:**
```
https://hashscan.io/testnet/transaction/...
```

---

## Observations

### SDK install
<!-- Any issues with pip install, missing system deps, version conflicts? -->

### Auth
<!-- Any auth errors on first run? What does a wrong key look like? -->

### Message size limit
<!-- What is the observed or documented per-message size limit in bytes? -->

### Exception types raised
<!-- List the SDK exception classes encountered (auth failure, network failure, invalid tx, etc.) -->

### Gotchas
<!-- Anything unexpected: method naming, async vs sync, key format requirements, etc. -->

---

## Recommended Production Implementation

### Package version to pin
```
hiero-sdk-python==x.y.z
```

### Client initialisation pattern
```python
# Paste the working pattern from 01_create_topic.py here.
```

### Error handling
```python
# Which exceptions should hedera.py catch?
# e.g. from hiero import HederaError, MaxAttemptsError
```

### Configuration
- `HEDERA_TOPIC_ID`: store in `backend/.env` after topic is created on testnet.
  Add `HEDERA_TOPIC_ID=0.0.xxxxxx` once production topic is created.

### SDK vs REST API
<!-- Confirm the SDK is preferred over raw REST calls to the mirror node.
     Note any cases where a direct REST call to the mirror would be better. -->

---

## Action Items for `backend/app/blockchain/hedera.py`

- [ ] Implement `submit_hash(trip_id: str, event: str, sha256_hash: str) -> str`
      — submits anchor payload to `HEDERA_TOPIC_ID`, returns `transaction_id`.
- [ ] Implement `get_topic_messages(topic_id: str) -> list[dict]`
      — fetches messages from mirror node for audit trail.
- [ ] Pin `hiero-sdk-python==x.y.z` in `backend/requirements.txt`.
- [ ] Populate `HEDERA_TOPIC_ID` in `backend/.env` after topic is created on testnet.
- [ ] Add `HEDERA_TOPIC_ID` as an empty key in `backend/.env.example`.
