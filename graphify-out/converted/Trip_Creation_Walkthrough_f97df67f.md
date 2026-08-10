<!-- converted from Trip_Creation_Walkthrough.docx -->

Trip Creation
Code Walkthrough  •  FreightProof SA Demo
INF4027W Honours Project  •  UCT 2026
# Overview
Trip creation is the entry point of the FreightProof evidence chain. When a dispatcher creates a trip, the system:

- Validates all referenced entities (driver, vehicle, trailers)
- Writes the trip, junction rows, and H0 handshake event to Supabase (PostgreSQL) atomically
- Computes a SHA-256 journey lock hash over the 9 immutable trip fields
- Anchors that hash to Hedera HCS — before the API response is returned

No PII ever leaves the system. Only the 64-character hex hash reaches Hedera.

# 1.  The HTTP Request
Endpoint and auth:


Request body (all fields):

{
"order_number":              "SO-12345",
"client_organization_id":    "uuid",
"driver_id":                 "uuid",
"horse_id":                  "uuid",
"trailer_ids":               ["uuid"],
"origin_precinct_id":        "uuid",
"destination_precinct_id":   "uuid",
"planned_departure_at":      "2026-05-19T08:00:00Z",
"planned_arrival_at":        "2026-05-19T14:00:00Z"
}

Built-in Pydantic validators reject the request before it even hits the database:
- origin and destination precincts must differ
- planned_arrival_at must be after planned_departure_at

# 2.  HTTP Layer  (trips.py)
File: backend/app/api/v1/endpoints/trips.py : 37

This function is intentionally thin — it does two things only:
- Calls create_trip() in the orchestration layer
- Maps domain exceptions to HTTP status codes


All business logic lives in the orchestration layer below.

# 3.  Orchestration: Validation  (trip_service.py)
File: backend/app/orchestration/trip_service.py

Four checks run before any database write:


# 4.  Orchestration: Database Writes
Three inserts are flushed (not committed) — they get database IDs but can still roll back if anything fails later.

## 4a.  Insert Trip row

trip = Trip(
trip_reference = "FP-20260519-A1B2C3D4",  # auto-generated
order_number   = payload.order_number,
status         = TripStatus.CREATED,
idvs_check_status = IdvsStatus.PENDING,
driver_id      = payload.driver_id,
horse_id       = payload.horse_id,
...)
db.add(trip)
await db.flush()   # gets trip.id without committing

## 4b.  Insert TripTrailer rows (one per trailer)

TripTrailer(
trip_id    = trip.id,
trailer_id = trailer_id,
pulsit_device_id_snapshot = "...",  # snapshot prevents retroactive change
)

## 4c.  Insert HandshakeEvent H0

HandshakeEvent(
trip_id          = trip.id,
sequence_number  = 0,
handshake_type   = HandshakeType.TRIP_CREATION,
status           = HandshakeStatus.PENDING,
)


# 5.  Journey Lock Hash  (crypto/hashing.py)
File: backend/app/crypto/hashing.py

A canonical dictionary is built from the 9 immutable trip fields:


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

Then:
- Keys sorted alphabetically
- JSON serialised with no whitespace
- SHA-256 digest → 64-character lowercase hex string

Result stored in: trips.journey_lock_hash (Supabase / PostgreSQL)

Why this matters: if anyone edits any of these 9 fields directly in Supabase after creation, recomputing the hash produces a different value — which won't match what was sent to Hedera.

# 6.  Hedera HCS Anchoring  (blockchain/)
Files: blockchain/anchor_service.py  →  blockchain/hedera.py


compute_trip_canonical_payload()     →  the same 9-field dict
↓
SHA-256 hash of that dict            →  64-char hex
↓
HederaService.submit_hash()
TopicMessageSubmitTransaction      →  sends ONLY the hash (no PII)
↓
HederaReceipt {
topic_id, sequence_number,
consensus_timestamp, tx_id
}
↓
INSERT BlockchainReceipt row into Supabase


This happens synchronously — by the time the API returns 201, the hash is already on Hedera and the receipt is in the database.

# 7.  Commit & Response
After the Hedera call succeeds:
- db.commit() — all rows are persisted
- Rows are refreshed to pick up updated_at etc.
- TripDetailResponse is assembled and returned as 201 Created

The response includes:
- Full trip details + journey_lock_hash
- blockchain_receipts array — with the Hedera topic_id, sequence_number, consensus_timestamp
- handshakes array — H0 entry (trip_creation, status: pending)

# 8.  Full Call Chain

POST /api/v1/trips
→ trips.py: create_trip_endpoint()           error mapping only
→ trip_service.py: create_trip()             all logic lives here
→ _fetch_driver()                         validate
→ _fetch_vehicle()                        validate
→ _check_order_number_conflict()          validate
→ db.flush() x2                           insert Trip + TripTrailer + H0
→ crypto/hashing.py: compute_journey_lock_hash()
→ blockchain/anchor_service.py: anchor_subject()
→ blockchain/hedera.py: HederaService.submit_hash()
→ db.add(BlockchainReceipt)
→ db.commit()
→ 201 TripDetailResponse


# 9.  Key Response Fields to Point to in the Demo


Delete after demo — 2026-05-19
| Field | Value |
| --- | --- |
| Method + path | POST /api/v1/trips |
| Auth | JWT bearer token — dispatcher only |
| Success response | 201 Created + TripDetailResponse body |
| Schema | TripCreateRequest  (schemas/trips.py:232) |
| Exception | HTTP status |
| --- | --- |
| TripConflictError | 409 Conflict — duplicate active order_number |
| ResourceNotFoundError | 404 Not Found — bad driver / vehicle / trailer ID |
| SQLAlchemyError | 500 Internal Server Error |
| Check | What it verifies | Fails with |
| --- | --- | --- |
| _fetch_driver() | Driver exists, is active, belongs to operator org | 404 |
| _fetch_vehicle() | Horse exists, is HORSE type, is active | 404 |
| Loop trailers | Each trailer exists, is TRAILER type, is active | 404 |
| _check_order_number_conflict() | No active trip already has this order_number in this org | 409 |
| Field | Where | What to say |
| --- | --- | --- |
| trip_reference | Top level | Auto-generated unique ID, format "FP-YYYYMMDD-XXXXXXXX" |
| status | Top level | Starts as "created" — advances via handshake events |
| journey_lock_hash | Top level | SHA-256 of the 9 immutable fields — this is what goes to Hedera |
| blockchain_receipts[0].hedera_topic_id | blockchain_receipts | The Hedera topic this hash was written to |
| blockchain_receipts[0].hedera_consensus_timestamp | blockchain_receipts | When Hedera reached consensus — immutable timestamp |
| handshakes[0].handshake_type | handshakes | "trip_creation" — H0, always created atomically with the trip |