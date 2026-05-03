# Spike FP-23 — Hedera SDK Findings

## Result: PASS

Both scripts exited 0. Topic created, message submitted, mirror confirmed.

---

## Environment

| Field | Value |
|-------|-------|
| SDK version | `hiero-sdk-python==0.2.5` |
| Python version | 3.13 |
| Testnet account | `0.0.8669989` (testnet only — never mainnet) |
| Date run | 2026-05-03 |

---

## FP-25 — Topic Creation

| Field | Value |
|-------|-------|
| Topic ID | `0.0.8846169` |
| Transaction status | `SUCCESS` (ResponseCode 22) |
| Creation latency | ~4.40s |
| Memo used | `FreightProof SA — spike FP-25` |

---

## FP-26 — Message Submission

| Field | Value |
|-------|-------|
| Transaction ID | `0.0.8669989@1777835212.54013013` |
| Transaction status | `SUCCESS` (ResponseCode 22) |
| Submission latency | ~4.08s |
| Mirror confirmed | Yes (within 30s poll) |
| Payload size | 187 bytes |

**Mirror URL:**
```
https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.8846169/messages
```

**HashScan URL:**
```
https://hashscan.io/testnet/transaction/0.0.8669989@1777835212.54013013
```

---

## Observations

### SDK install
No issues. `pip install hiero-sdk-python` resolves cleanly. Dependencies: `cryptography`, `eth-abi`, `grpcio`, `protobuf`, `pycryptodome`, `python-dotenv`, `requests`.

### Auth
`INVALID_SIGNATURE` on first attempt because `PrivateKey.from_string()` tried Ed25519 first on a 32-byte key. The testnet account uses an ECDSA secp256k1 key (standard for Hedera EVM accounts, stored as `0x`-prefixed hex). Fix: always use `PrivateKey.from_string_ecdsa()` explicitly. `from_string()` is ambiguous for 32-byte keys and should not be used in production.

### Message size limit
Not tested to the boundary in this spike. The SDK has a `set_chunk_size()` and `set_max_chunks()` on `TopicMessageSubmitTransaction`, implying automatic chunking for large messages. The HCS protocol limit per chunk is 1024 bytes. Our production anchor payload (~187 bytes) is well within one chunk.

### Exception types raised
- `hiero_sdk_python.exceptions.PrecheckError` — raised on precheck failure (e.g. `INVALID_SIGNATURE`). Contains `status` (ResponseCode) and `transaction_id`.
- `ImportError` — if SDK not installed.
- `ValueError` — from `PrivateKey.from_string_ecdsa()` if hex string is malformed.

### Gotchas
1. **Key type must be explicit.** `PrivateKey.from_string()` is ambiguous for 32-byte keys. Use `from_string_ecdsa()` for `0x`-prefixed hex keys (EVM-style Hedera accounts). Use `from_string_ed25519()` for native Hedera ED25519 accounts.
2. **`set_memo()` not `set_topic_memo()`.** `TopicCreateTransaction` uses `set_memo()`.
3. **`execute()` returns the receipt directly.** No separate `.get_receipt()` call needed — the default `wait_for_receipt=True` blocks until the receipt is available.
4. **`set_message()` takes `str`, not `bytes`.** Pass the JSON string directly.
5. **Status is an int (ResponseCode IntEnum).** Compare with `ResponseCode.SUCCESS` (value 22), not the string `"SUCCESS"`.
6. **Mirror node propagation.** The mirror confirmed within the 30s poll window. In production, do not assume instant availability — add retry logic or poll.
7. **Consensus latency ~4s.** Both transactions took ~4s to reach consensus and return a receipt. Budget for this in async Celery tasks.

---

## Recommended Production Implementation

### Package version to pin
```
hiero-sdk-python==0.2.5
```

### Client initialisation pattern
```python
from hiero_sdk_python import AccountId, Client, PrivateKey

client = Client.for_testnet()  # or Client.for_mainnet() in production
client.set_operator(
    AccountId.from_string(settings.HEDERA_ACCOUNT_ID),
    PrivateKey.from_string_ecdsa(settings.HEDERA_PRIVATE_KEY),  # explicit — never from_string()
)
```

### Error handling
```python
from hiero_sdk_python.exceptions import PrecheckError
from hiero_sdk_python import ResponseCode

try:
    receipt = TopicMessageSubmitTransaction() ...execute(client)
except PrecheckError as exc:
    # exc.status is a ResponseCode int; exc.transaction_id is available
    logger.error("Hedera precheck failed: status=%s tx=%s", exc.status, exc.transaction_id)
    raise
```

### Configuration
- `HEDERA_TOPIC_ID`: add `HEDERA_TOPIC_ID=0.0.8846169` to `backend/.env` (testnet topic created by this spike).
- Spike topic `0.0.8846169` is on testnet — safe to use for continued dev/test.
- Create a separate topic for production mainnet when ready.

### SDK vs REST API
Use the SDK for all write operations (topic creation, message submission). Use the mirror REST API (`https://testnet.mirrornode.hedera.com/api/v1/topics/{id}/messages`) for read operations (audit trail, hash verification) since it doesn't require an operator account or transaction fees.

---

## Action Items for `backend/app/blockchain/hedera.py`

- [ ] Implement `submit_hash(trip_id: str, event: str, sha256_hash: str) -> str`
      — submits anchor payload to `HEDERA_TOPIC_ID`, returns `transaction_id`.
- [ ] Implement `get_topic_messages(topic_id: str) -> list[dict]`
      — fetches messages from mirror node for audit trail (REST, no SDK needed).
- [ ] Pin `hiero-sdk-python==0.2.5` in `backend/requirements.txt`.
- [ ] Add `HEDERA_TOPIC_ID=0.0.8846169` to `backend/.env` (testnet).
- [ ] Add `HEDERA_TOPIC_ID=` (empty) to `backend/.env.example`.
- [ ] Use `PrivateKey.from_string_ecdsa()` — never `from_string()`.
- [ ] Wrap `execute()` calls in `try/except PrecheckError` and log before re-raising.
- [ ] Run `hedera.py` functions as Celery tasks (consensus latency ~4s — must be async).
