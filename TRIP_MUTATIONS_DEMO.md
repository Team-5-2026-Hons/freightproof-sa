# Trip Mutations — Demo Reference

> **Key insight for the demo:** In FreightProof, trip *core details* (driver, vehicle, route) are **intentionally immutable** after creation — that's the whole point of the journey lock hash. What we call "mutations" are **state transitions via HandshakeEvents**, which are anchored to Hedera for tamper-proof evidence.

---

## 1. The Two Types of "Mutation"

| Type | What changes | How |
|------|-------------|-----|
| **Trip creation** | Creates the trip + locks all core params | `POST /api/v1/trips` |
| **State transition** | Advances trip through handshake stages | `POST /api/v1/handshakes` (Ciaran's side) |

Core fields (driver, horse, trailers, precincts) **cannot be edited post-creation** — that's by design. Any change would break the journey lock hash.

---

## 2. Trip Creation — Full Call Chain

```
HTTP: POST /api/v1/trips
  │   Body: TripCreateRequest  Auth: JWT (dispatcher)
  │
  ▼
backend/app/api/v1/endpoints/trips.py
  └─ create_trip_endpoint()
       ├─ Catches: TripConflictError → 409
       ├─ Catches: ResourceNotFoundError → 404
       └─ Calls ▼

backend/app/orchestration/trip_service.py
  └─ create_trip(db, payload, current_user)
       │
       ├─ [VALIDATE] _fetch_driver()         — active, belongs to operator org
       ├─ [VALIDATE] _fetch_vehicle()        — active HORSE type
       ├─ [VALIDATE] loop trailers           — active TRAILER type
       ├─ [VALIDATE] _check_order_number_conflict() — 409 if duplicate active trip
       │
       ├─ [DB] INSERT Trip row
       │       status=CREATED, idvs_check_status=PENDING
       │       trip_reference = "FP-YYYYMMDD-XXXXXXXX"
       │
       ├─ [DB] INSERT TripTrailer rows (junction)
       │       stores pulsit_device_id_snapshot per trailer
       │
       ├─ [DB] INSERT HandshakeEvent H0
       │       sequence_number=0, type=TRIP_CREATION, status=PENDING
       │
       ├─ [DB] FLUSH (gets IDs without committing)
       │
       ├─ [CRYPTO] compute_journey_lock_hash()  ← see §4
       │           → 64-char SHA-256 hex
       │
       ├─ [DB] UPDATE trip.journey_lock_hash = hash
       │
       ├─ [BLOCKCHAIN] anchor_subject()  ← see §5
       │               → inserts BlockchainReceipt row
       │
       ├─ [DB] COMMIT
       └─ Returns TripDetailResponse (201 Created)
```

---

## 3. Key Files & Classes

| File | What it does |
|------|-------------|
| `api/v1/endpoints/trips.py` | Thin HTTP layer, error mapping, auth |
| `orchestration/trip_service.py` | All business logic for trip creation |
| `crypto/hashing.py` | `compute_journey_lock_hash()`, `compute_trip_canonical_payload()` |
| `blockchain/anchor_service.py` | `anchor_subject()` — hashes payload, calls Hedera, saves receipt |
| `blockchain/hedera.py` | `HederaService.submit_hash()` — low-level SDK call |
| `db/models/trips.py` | `Trip`, `TripTrailer` ORM models |
| `db/models/handshakes.py` | `HandshakeEvent` ORM model |
| `db/models/blockchain.py` | `BlockchainReceipt` ORM model |
| `schemas/trips.py` | `TripCreateRequest`, `TripDetailResponse`, `TripUpdate` |

---

## 4. Journey Lock Hash (Supabase → Tamper Detection)

**Computed in:** `backend/app/crypto/hashing.py`

**What gets hashed (canonical payload):**
```json
{
  "trip_id":                "uuid",
  "order_number":           "SO-12345",
  "driver_id":              "uuid",
  "horse_id":               "uuid",
  "trailers":               ["sorted", "uuids"],
  "origin_precinct_id":     "uuid",
  "destination_precinct_id":"uuid",
  "created_by_user_id":     "uuid",
  "created_at":             "2026-05-18T10:00:00Z"
}
```

**How:**
1. Keys sorted alphabetically
2. JSON serialised, no whitespace
3. SHA-256 → 64-char lowercase hex

**Stored in:** `trips.journey_lock_hash` (PostgreSQL/Supabase)

**Why it matters for the demo:** If anyone edits trip details directly in the database after creation, the hash they'd recompute won't match what's on Hedera — **that's your proof of tampering**.

---

## 5. Hedera HCS Anchoring

**Called in:** `blockchain/anchor_service.py → anchor_subject()`

**Flow:**
```
compute_trip_canonical_payload()  →  dict of immutable fields
        ↓
compute_payload_hash()            →  SHA-256 of that dict
        ↓
HederaService.submit_hash()       →  TopicMessageSubmitTransaction
        ↓
HederaReceipt {
  topic_id, sequence_number,
  consensus_timestamp, tx_id
}
        ↓
INSERT BlockchainReceipt row in Supabase (PostgreSQL)
```

**What goes to Hedera:** Only the 64-char SHA-256 hex — **no personal data ever leaves** (POPIA compliance).

**Verification:** Mirror node query to `/api/v1/topics/{topic_id}/messages/{sequence_number}`, decode base64, compare against stored `data_hash`.

**Which handshakes anchor to Hedera:**
- H0 — Trip Creation ✓
- H2 — Loading Complete ✓
- H5 — Delivery (Unloading) ✓
- H1, H3, H4 — gate events (recorded, not anchored)

---

## 6. Trip Status Lifecycle

```
CREATED
  └─ H0 anchored to Hedera at this point

ORIGIN_GATE_IN    (H1 — guard scans, no blockchain)
LOADING           (H2 — anchored to Hedera)
ORIGIN_GATE_OUT   (H3 — no blockchain)
IN_TRANSIT
DEST_GATE_IN      (H4 — no blockchain)
UNLOADING         (H5 — anchored to Hedera)

CLOSED  /  CANCELLED  /  EXCEPTION_HOLD
```

---

## 7. Supabase's Role

| Role | Details |
|------|---------|
| **PostgreSQL (primary DB)** | All trip data, handshakes, blockchain receipts stored here |
| **Auth** | Driver accounts provisioned via Supabase Auth admin API |
| **Storage** | Used for evidence photos (handshake artifacts), NOT for trip mutations |

Trip mutations themselves only touch **PostgreSQL** — Supabase Storage is for photo evidence attached to handshakes.

---

## 8. What to Say in the Demo

1. **"Trip details are locked at creation"** — the journey lock hash is computed from all core parameters (driver, vehicle, route, timestamps) and written to Supabase.

2. **"That hash is immediately anchored to Hedera HCS"** — a SHA-256 of the canonical payload is submitted as a topic message. No PII leaves the system.

3. **"Any edit to trip details after creation would break the evidence chain"** — recomputing the hash would give a different value than what's on Hedera, which is how we detect tampering.

4. **"State changes happen via Handshake Events"** — not by editing the trip row directly. H0 (creation), H2 (loading), H5 (delivery) each get their own Hedera anchoring.

---

*This file is for demo prep only — delete after 2026-05-19.*
