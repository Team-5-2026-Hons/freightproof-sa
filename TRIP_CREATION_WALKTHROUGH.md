# Trip Creation — Code Walkthrough

## The Request

**Endpoint:** `POST /api/v1/trips`  
**Auth:** JWT dispatcher token  
**Body:** `TripCreateRequest`

```json
{
  "order_number": "SO-12345",
  "client_organization_id": "uuid",
  "driver_id": "uuid",
  "horse_id": "uuid",
  "trailer_ids": ["uuid"],
  "origin_precinct_id": "uuid",
  "destination_precinct_id": "uuid",
  "planned_departure_at": "2026-05-19T08:00:00Z",
  "planned_arrival_at":   "2026-05-19T14:00:00Z"
}
```

**Validation baked into `TripCreateRequest`** (`schemas/trips.py:232`):
- origin ≠ destination precincts
- arrival must be after departure

---

## Step 1 — HTTP Layer

**File:** `backend/app/api/v1/endpoints/trips.py:37`

```python
@router.post("", response_model=TripDetailResponse, status_code=201)
async def create_trip_endpoint(payload, db, current_user):
    return await create_trip(db=db, payload=payload, current_user=current_user)
```

This function does nothing except:
- Call `create_trip()` in the orchestration layer
- Map domain errors to HTTP codes: `TripConflictError` → 409, `ResourceNotFoundError` → 404

---

## Step 2 — Orchestration: Validation

**File:** `backend/app/orchestration/trip_service.py`

Four checks run before anything is written to the DB:

| Check | What it does | Error if fails |
|-------|-------------|----------------|
| `_fetch_driver()` | Driver exists, is active, belongs to operator org | 404 |
| `_fetch_vehicle()` | Horse exists, is HORSE type, is active | 404 |
| Loop trailers | Each trailer exists, is TRAILER type, is active | 404 |
| `_check_order_number_conflict()` | No other active trip has this order_number in this org | 409 |

---

## Step 3 — Orchestration: DB Writes

Three inserts, all flushed (not committed) so they get IDs but can still be rolled back:

### 3a. Insert `Trip` row
```python
trip = Trip(
    trip_reference="FP-20260519-A1B2C3D4",  # auto-generated
    order_number=payload.order_number,
    status=TripStatus.CREATED,
    idvs_check_status=IdvsStatus.PENDING,
    driver_id=payload.driver_id,
    horse_id=payload.horse_id,
    ...
)
db.add(trip)
await db.flush()  # gets trip.id without committing
```

### 3b. Insert `TripTrailer` rows (one per trailer)
```python
TripTrailer(
    trip_id=trip.id,
    trailer_id=trailer_id,
    pulsit_device_id_snapshot="...",  # snapshot prevents retroactive change
)
```

### 3c. Insert `HandshakeEvent` H0
```python
HandshakeEvent(
    trip_id=trip.id,
    sequence_number=0,
    handshake_type=HandshakeType.TRIP_CREATION,
    status=HandshakeStatus.PENDING,
)
```

---

## Step 4 — Journey Lock Hash

**File:** `backend/app/crypto/hashing.py`

Builds a canonical dict of the immutable trip fields:

```python
{
    "trip_id":                  str(trip.id),
    "order_number":             trip.order_number,
    "driver_id":                str(trip.driver_id),
    "horse_id":                 str(trip.horse_id),
    "trailers":                 [sorted list of trailer UUIDs],
    "origin_precinct_id":       str(trip.origin_precinct_id),
    "destination_precinct_id":  str(trip.destination_precinct_id),
    "created_by_user_id":       str(trip.created_by_user_id),
    "created_at":               trip.created_at.isoformat(),
}
```

Then:
1. Keys sorted alphabetically
2. JSON serialised with no whitespace
3. SHA-256 → 64-char hex string

Result stored in `trip.journey_lock_hash`.

---

## Step 5 — Hedera Anchoring

**File:** `backend/app/blockchain/anchor_service.py` → `backend/app/blockchain/hedera.py`

```
compute_trip_canonical_payload()   →  the same dict from Step 4
        ↓
SHA-256 hash of that dict          →  64-char hex
        ↓
HederaService.submit_hash()
  TopicMessageSubmitTransaction     →  sends ONLY the hash (no PII)
        ↓
HederaReceipt {
    topic_id, sequence_number,
    consensus_timestamp, tx_id
}
        ↓
INSERT BlockchainReceipt row
```

---

## Step 6 — Commit & Response

```python
await db.commit()
# refresh all rows to get updated_at etc.
return TripDetailResponse(...)  # assembled manually, returned as 201
```

**Response includes:**
- Full trip details
- The `journey_lock_hash`
- The `blockchain_receipts` array with the Hedera receipt
- The H0 `handshakes` entry

---

## Full Call Chain (one line each)

```
POST /api/v1/trips
  → trips.py: create_trip_endpoint()          error mapping only
  → trip_service.py: create_trip()            all logic lives here
      → _fetch_driver()                        validate
      → _fetch_vehicle()                       validate
      → _check_order_number_conflict()         validate
      → db.flush() ×2                          insert Trip + TripTrailer + H0
      → crypto/hashing.py: compute_journey_lock_hash()
      → blockchain/anchor_service.py: anchor_subject()
          → blockchain/hedera.py: HederaService.submit_hash()
          → db.add(BlockchainReceipt)
      → db.commit()
  → 201 TripDetailResponse
```

---

## Key Fields to Point to in the Demo

| Field | Where | What to say |
|-------|-------|-------------|
| `trip_reference` | Response | Auto-generated unique ID, format `FP-YYYYMMDD-XXXXXXXX` |
| `status` | Response | Starts as `created` — advances via handshakes |
| `journey_lock_hash` | Response | SHA-256 of the 9 immutable fields — this is what goes to Hedera |
| `blockchain_receipts[0].hedera_topic_id` | Response | The Hedera topic this hash was written to |
| `blockchain_receipts[0].hedera_consensus_timestamp` | Response | When Hedera reached consensus — immutable timestamp |
| `handshakes[0].handshake_type` | Response | `trip_creation` — H0, always created atomically with the trip |

---

*Delete after demo 2026-05-19.*
