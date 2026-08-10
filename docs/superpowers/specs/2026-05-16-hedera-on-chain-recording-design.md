# Hedera On-Chain Recording — Spec

**Date:** 2026-05-16
**Branch:** Ciaran
**Demo target:** Tuesday 2026-05-19
**Approach:** Sync-anchor for demo, async-ready scaffold. Trips + vehicles + drivers anchored on creation. Mutations anchored as stretch.

---

## Goal

Make trip, vehicle, and driver creation produce immutable evidence on Hedera HCS, so that:

1. Every created entity has a `BlockchainReceipt` linking the DB row to a Hedera HCS message
2. The dispatcher UI surfaces the anchor state (passive badge) and offers live verification (active button)
3. Tampering with the DB after anchoring is detectable through the verify flow
4. Vehicle and driver mutations record diff-events that are themselves anchored (stretch)
5. Personal information (POPIA-regulated) never reaches the blockchain

The architecture extends the existing `HederaService` (already implemented in `backend/app/blockchain/hedera.py`) and the existing `BlockchainReceipt` model (already implemented in `backend/app/db/models/blockchain.py`) — no rewrites, only additions and one schema extension.

---

## Demo scope

**B (primary):** trip + vehicle + driver creation each anchored. Detail pages show the badge. Trip-level Verify Now button is wired and clickable. Live tamper demo via `psql UPDATE` works for trips.

**C (stretch):** vehicle and driver mutation paths anchor on critical-field change. Edit forms in UI.

---

## Trust model (out-of-scope note)

FreightProof records what happened. It does not assert the recorded data was true at the moment of entry — that is the classic *oracle problem* / *garbage-in-garbage-out* limitation of any blockchain-of-record system. The architectural mitigations are:

- The five-handshake chain (multi-party confirmation across origin gate, loading, transit, destination, closure)
- IDVS integration for driver identity verification
- Pulsit GPS as an independent oracle for trip movement

These mitigations are in the architecture but **not built for Tuesday's demo**. For the demo, FreightProof is positioned as *evidence-of-record, not truth-of-origin*: "we prove data hasn't been tampered with after entry; preventing bad data at entry is a separate concern addressed through the handshake chain post-demo."

---

## 1. Backend — Anchor Service

**File (new):** `backend/app/blockchain/anchor_service.py`

A single orchestration-layer service that wraps `HederaService.submit_hash()` and persists the `BlockchainReceipt` row. This is the function that gets called synchronously from request handlers today, and that a future Celery task will call asynchronously.

```python
async def anchor_subject(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    canonical_payload: dict,
    receipt_type: BlockchainReceiptType,
    hedera_service: HederaService | None = None,
) -> BlockchainReceipt:
    """Compute SHA-256 over canonical_payload, submit to HCS, persist receipt.

    canonical_payload is serialized with sort_keys=True, separators=(",",":").
    The hash is the SHA-256 of the UTF-8 bytes of that string.
    """
```

The function:
1. Canonicalizes the payload (`json.dumps(payload, sort_keys=True, separators=(",", ":"))`)
2. Computes the SHA-256
3. Calls `HederaService.submit_hash(hash_hex)` (blocks ~4–6s)
4. Inserts a `BlockchainReceipt` with `subject_type`, `subject_id`, `data_hash`, `payload_json`, and the Hedera fields from the receipt
5. Returns the persisted receipt

`HederaService` is injected (default: construct from settings) so tests can pass a stub.

The sync/async swap is later: a Celery task does the same call. No flag needed for the demo; the function is structured to be called either way.

---

## 2. Backend — `compute_journey_lock_hash` extension

**File:** `backend/app/crypto/hashing.py`

Extend the function to include `created_by_user_id` and `created_at` in the canonical payload. The current signature:

```python
def compute_journey_lock_hash(
    *, trip_id, order_number, driver_id, horse_id, trailer_ids,
    origin_precinct_id, destination_precinct_id
) -> str:
```

becomes:

```python
def compute_journey_lock_hash(
    *, trip_id, order_number, driver_id, horse_id, trailer_ids,
    origin_precinct_id, destination_precinct_id,
    created_by_user_id, created_at  # NEW
) -> str:
```

`created_at` is serialized as ISO 8601 UTC. The canonical payload becomes the *exact same* payload anchored to Hedera for a trip, so the journey lock hash and the on-chain hash for `subject_type='trip'` are identical. One hash, one source of truth.

Update the call site at [trip_service.py:160-168](backend/app/orchestration/trip_service.py#L160-L168). Update any tests that pin the old hash output.

---

## 3. Backend — Schema changes

### 3.1 Extend `blockchain_receipts`

**Migration:** `backend/migrations/versions/2026_05_17_ciaran_extend_blockchain_receipts_for_subjects.py`

- Drop NOT NULL on `trip_id`
- Add column `subject_type` (String(30), NOT NULL) — values: `trip`, `vehicle`, `driver`, `vehicle_event`, `driver_event`
- Add column `subject_id` (UUID, NOT NULL, indexed)
- Add composite index `(subject_type, subject_id)` for the common "show receipts for entity X" query
- Backfill existing rows: `subject_type='trip'`, `subject_id=trip_id`

The existing `trip_id` column stays — it's still useful for trip-scoped queries and the existing `BlockchainReceiptType` enum still applies. New subjects use `subject_type`/`subject_id` and leave `trip_id` NULL.

Update model in `backend/app/db/models/blockchain.py` to match.

### 3.2 New event tables

**Migration:** `backend/migrations/versions/2026_05_17_ciaran_add_vehicle_driver_events.py`

**`vehicle_events`:**
```
id              UUID PK
vehicle_id      UUID FK→vehicles.id  NOT NULL  INDEXED
event_type      String(40)  NOT NULL  ('created', 'license_plate_changed',
                                       'license_disc_renewed', 'deactivated')
changed_fields  JSONB  NOT NULL  (snapshot for 'created', diff for changes)
changed_by_user_id  UUID FK→users.id  NOT NULL
blockchain_receipt_id  UUID FK→blockchain_receipts.id  NULLABLE  (use_alter)
created_at      TIMESTAMPTZ DEFAULT now()  NOT NULL
updated_at      TIMESTAMPTZ DEFAULT now() ON UPDATE now()  NOT NULL
```

**`driver_events`:**
```
id              UUID PK
driver_id       UUID FK→drivers.id  NOT NULL  INDEXED
event_type      String(40)  NOT NULL  ('created', 'license_renewed', 'deactivated')
changed_fields  JSONB  NOT NULL
changed_by_user_id  UUID FK→users.id  NOT NULL
blockchain_receipt_id  UUID FK→blockchain_receipts.id  NULLABLE  (use_alter)
created_at      TIMESTAMPTZ DEFAULT now()  NOT NULL
updated_at      TIMESTAMPTZ DEFAULT now() ON UPDATE now()  NOT NULL
```

Both follow the existing `DriverSubstitution` pattern (see [backend/app/db/models/trips.py:159-199](backend/app/db/models/trips.py#L159-L199)).

Register both models in `backend/app/db/models/__init__.py`.

### 3.3 Critical fields constants

**File (new):** `backend/app/blockchain/critical_fields.py`

Hard-coded lists of "fields that trigger an anchor on mutation":

```python
VEHICLE_CRITICAL_FIELDS = frozenset({
    "registration", "licence_disc_expiry", "vehicle_type", "vin_number",
})
DRIVER_CRITICAL_FIELDS = frozenset({
    "license_number", "license_expiry",  # plaintext license number hashed before on-chain
})
```

A helper `diff_critical_fields(old: dict, new: dict, critical: frozenset) -> dict | None` returns the diff if any critical field changed, else None. Anchoring is skipped on None.

---

## 4. Backend — Service-layer integration

### 4.1 Trip creation

**File:** `backend/app/orchestration/trip_service.py` — modify `create_trip()`

After step 6 (existing `journey_lock_hash` computation), replace the `NOTE: Hedera HCS anchor task would be queued here` stub with:

```python
canonical_payload = {
    "trip_id": str(trip_id),
    "order_number": payload.order_number,
    "driver_id": str(payload.driver_id),
    "horse_id": str(payload.horse_id),
    "trailers": sorted(str(t) for t in payload.trailer_ids),
    "origin_precinct_id": str(payload.origin_precinct_id),
    "destination_precinct_id": str(payload.destination_precinct_id),
    "created_by_user_id": str(current_user.id),
    "created_at": trip.created_at.isoformat(),
}
receipt = await anchor_subject(
    db,
    subject_type=SubjectType.TRIP,
    subject_id=trip_id,
    canonical_payload=canonical_payload,
    receipt_type=BlockchainReceiptType.TRIP_CREATION,
)
# Verify the receipt's data_hash matches journey_lock_hash (same canonical payload).
```

The `TripDetailResponse` includes the receipt in its `blockchain_receipts` field (previously always `[]` — see [trip_service.py:199](backend/app/orchestration/trip_service.py#L199)).

### 4.2 Vehicle creation

**File:** `backend/app/orchestration/resource_service.py` — modify `create_vehicle()`

After insert + flush, write a `VehicleEvent(event_type='created', changed_fields={...full snapshot...})`, then anchor:

```python
canonical_payload = {
    "vehicle_event_id": str(vehicle_event.id),
    "vehicle_id": str(vehicle.id),
    "event_type": "created",
    "fields": {
        "registration": vehicle.registration,
        "vehicle_type": vehicle.vehicle_type.value,
        "make": vehicle.make,
        "model": vehicle.model,
        "year": vehicle.year,
        "vin_number": vehicle.vin_number,
        "licence_disc_expiry": vehicle.licence_disc_expiry.isoformat() if vehicle.licence_disc_expiry else None,
    },
    "changed_by_user_id": str(current_user.id),
    "timestamp": vehicle_event.created_at.isoformat(),
}
receipt = await anchor_subject(...)
vehicle_event.blockchain_receipt_id = receipt.id
```

Note: `create_vehicle` currently takes `organization_id` but not `current_user` — extend its signature and the endpoint at `backend/app/api/v1/endpoints/vehicles.py` to pass the authenticated user.

### 4.3 Driver creation

**File:** `backend/app/orchestration/resource_service.py` — modify `create_driver()`

Same pattern. **POPIA-critical:** the canonical payload anchored to Hedera contains only:

```python
canonical_payload = {
    "driver_event_id": str(driver_event.id),
    "driver_id": str(driver.id),
    "event_type": "created",
    "fields": {
        "license_number_sha256": sha256(driver.license_number.encode()).hexdigest(),
        "license_expiry": driver.license_expiry.isoformat() if driver.license_expiry else None,
        "is_active": driver.is_active,
    },
    "changed_by_user_id": str(current_user.id),
    "timestamp": driver_event.created_at.isoformat(),
}
```

**Never on-chain:** `full_name`, `phone_number`, `id_number`, plaintext `license_number`. The license number is hashed before anchoring so tampering is detectable without exposing the number itself.

`create_driver` already provisions a Supabase auth user (see [resource_service.py:50-53](backend/app/orchestration/resource_service.py#L50-L53)); the event row is created after that succeeds.

### 4.4 Verification service

**File (new):** `backend/app/orchestration/verification_service.py`

```python
async def verify_subject(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    hedera_service: HederaService | None = None,
) -> VerifyResult:
    """
    1. Fetch the most recent BlockchainReceipt for (subject_type, subject_id).
       If none → return VerifyResult(status='no_receipt').
    2. Reconstruct the canonical payload from the current DB state of the subject.
       - For 'trip': re-read Trip + TripTrailers, build the same dict as create_trip did.
       - For 'vehicle'/'driver' (event-level): re-read the event row and use its
         payload_json from the receipt (events are immutable; we verify the event
         row hasn't been altered, not the live vehicle row).
    3. Recompute SHA-256.
    4. If receipt.data_hash != recomputed_hash → return 'db_mismatch'.
    5. Call hedera_service.verify_hash(receipt.topic_id, receipt.sequence_number,
       receipt.data_hash).
    6. If mirror node returns False → return 'hedera_mismatch'.
    7. Return 'verified'.
    """
```

For the demo, only trip-level verification is exposed in the UI. The function supports event-level verification too, but no button calls it Tuesday.

### 4.5 Vehicle/driver detail (with events)

**File:** `backend/app/orchestration/resource_service.py` — new functions

```python
async def get_vehicle_detail(db, vehicle_id, organization_id) -> VehicleDetailResponse
async def get_driver_detail(db, driver_id, organization_id) -> DriverDetailResponse
```

Returns the vehicle/driver + list of `VehicleEvent`/`DriverEvent` rows ordered by `created_at` + list of `BlockchainReceipt` rows for each event + list of trips referencing this entity.

### 4.6 Stretch: mutation endpoints

**Files:** new endpoints `PATCH /api/v1/vehicles/{id}`, `PATCH /api/v1/drivers/{id}`.

Service functions:
```python
async def update_vehicle(db, vehicle_id, organization_id, data, current_user)
async def update_driver(db, driver_id, organization_id, data, current_user)
```

Flow:
1. Fetch current row, snapshot it as old dict
2. Apply patch
3. Build new dict
4. `diff = diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS)` (or DRIVER)
5. If `diff` is not None: create event row (`event_type='license_plate_changed'` etc., `changed_fields=diff`), anchor it
6. If `diff` is None: still create an event row (`event_type='cosmetic_update'`) for the audit log, but skip the anchor
7. Commit

---

## 5. Backend — API surface

| Method | Path | Notes |
|---|---|---|
| `POST /api/v1/trips` | (existing — modified) | Returns `blockchain_receipts` populated |
| `POST /api/v1/drivers` | (existing — modified) | Returns the receipt for the `created` event |
| `POST /api/v1/vehicles` | (existing — modified) | Returns the receipt for the `created` event |
| `GET /api/v1/blockchain/receipts?subject_type=X&subject_id=Y` | NEW | List receipts for a subject |
| `POST /api/v1/blockchain/verify` | NEW | Body: `{subject_type, subject_id}`; returns `VerifyResult` |
| `GET /api/v1/vehicles/{id}` | NEW | Vehicle + events + receipts + trips |
| `GET /api/v1/drivers/{id}` | NEW | Driver + events + receipts + trips |
| `PATCH /api/v1/vehicles/{id}` | NEW (stretch) | Mutate + anchor if critical fields changed |
| `PATCH /api/v1/drivers/{id}` | NEW (stretch) | Mutate + anchor if critical fields changed |

New endpoint module: `backend/app/api/v1/endpoints/blockchain.py`. Register in `main.py`.

---

## 6. Backend — Schemas

**File:** `backend/app/schemas/blockchain.py` — extend

```python
class SubjectType(str, Enum):
    TRIP = "trip"
    VEHICLE = "vehicle"
    DRIVER = "driver"
    VEHICLE_EVENT = "vehicle_event"
    DRIVER_EVENT = "driver_event"

class BlockchainReceiptRead(BaseModel):
    id: UUID
    subject_type: SubjectType
    subject_id: UUID
    data_hash: str
    hedera_topic_id: str | None
    hedera_sequence_number: int | None
    hedera_consensus_timestamp: datetime | None
    hedera_tx_id: str | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class VerifyRequest(BaseModel):
    subject_type: SubjectType
    subject_id: UUID

class VerifyStatus(str, Enum):
    VERIFIED = "verified"
    DB_MISMATCH = "db_mismatch"
    HEDERA_MISMATCH = "hedera_mismatch"
    NO_RECEIPT = "no_receipt"

class VerifyResult(BaseModel):
    status: VerifyStatus
    receipt: BlockchainReceiptRead | None = None
    expected_hash: str | None = None  # populated on db_mismatch
    current_hash: str | None = None   # populated on db_mismatch
```

**Files (new):** `backend/app/schemas/events.py` — `VehicleEventRead`, `DriverEventRead`.

`VehicleDetailResponse` and `DriverDetailResponse` extend the existing `VehicleRead`/`DriverRead` with `events: list[...]`, `receipts: list[BlockchainReceiptRead]`, `trips: list[TripListItemResponse]`.

---

## 7. Frontend — Shared components

**Folder (new):** `frontend/shared/components/blockchain/`

### 7.1 `BlockchainBadge.tsx`

```ts
type BlockchainBadgeProps = {
  receipt: BlockchainReceipt | null;
  state: 'anchored' | 'pending' | 'failed' | 'unanchored';
  className?: string;
};
```

Renders a small pill:
- **anchored** (green): `🔒 Hedera • Seq #${seq} • ${time}` + external-link icon → HashScan
- **pending** (amber): `⏳ Anchoring…`
- **failed** (red): `⚠ Anchor failed`
- **unanchored** (grey): `Not anchored`

HashScan URL: `${NEXT_PUBLIC_HEDERA_HASHSCAN_BASE}/topic/${topic}/${seq}`.

### 7.2 `VerifyButton.tsx`

```ts
type VerifyButtonProps = {
  subjectType: SubjectType;
  subjectId: string;
  onResult?: (result: VerifyResult) => void;
};
```

States:
- **idle**: button labeled `Verify Now`
- **verifying**: spinner + `Verifying against Hedera…`
- **verified**: green panel `✓ Verified — DB matches Hedera anchor`
- **db_mismatch**: red panel with `⚠ MISMATCH — DB has been modified` + expandable detail showing `expected_hash` vs `current_hash`
- **hedera_mismatch**: red panel `⚠ Hedera record mismatch — escalate`
- **no_receipt**: grey `No anchor available — cannot verify`

On click, calls `POST /api/v1/blockchain/verify`. Result persists for ~5 seconds, then returns to idle.

### 7.3 `EventTimeline.tsx`

```ts
type EventTimelineProps = {
  events: Array<VehicleEvent | DriverEvent>;
  receipts: BlockchainReceipt[];  // keyed by event_id
};
```

Vertical list. Each row:
- Timestamp on the left
- Event-type chip (e.g. `Created`, `License plate changed`)
- Diff (compact JSON or "from X → Y" for single-field changes)
- `<BlockchainBadge>` if a receipt links to this event
- `[Verify ↗]` link (designed in, not wired Tuesday)

### 7.4 Shared types

**File (new):** `frontend/shared/types/blockchain.ts`

```ts
export type SubjectType =
  | 'trip' | 'vehicle' | 'driver' | 'vehicle_event' | 'driver_event';

export type BlockchainReceipt = {
  id: string;
  subject_type: SubjectType;
  subject_id: string;
  data_hash: string;
  hedera_topic_id: string;
  hedera_sequence_number: number;
  hedera_consensus_timestamp: string;
  hedera_tx_id: string;
  created_at: string;
};

export type VerifyResult =
  | { status: 'verified'; receipt: BlockchainReceipt }
  | { status: 'db_mismatch'; receipt: BlockchainReceipt;
      expected_hash: string; current_hash: string }
  | { status: 'hedera_mismatch'; receipt: BlockchainReceipt }
  | { status: 'no_receipt' };

export type VehicleEvent = {
  id: string;
  vehicle_id: string;
  event_type: 'created' | 'license_plate_changed' | 'license_disc_renewed' | 'deactivated';
  changed_fields: Record<string, unknown>;
  changed_by_user_id: string;
  blockchain_receipt_id: string | null;
  created_at: string;
};

export type DriverEvent = {
  id: string;
  driver_id: string;
  event_type: 'created' | 'license_renewed' | 'deactivated';
  changed_fields: Record<string, unknown>;
  changed_by_user_id: string;
  blockchain_receipt_id: string | null;
  created_at: string;
};
```

---

## 8. Frontend — Dispatcher pages

### 8.1 Modify `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`

- Add `<BlockchainBadge>` next to the trip-reference header
- Add `<VerifyButton subjectType="trip" subjectId={trip.id}>` in the actions row
- Add a "Blockchain Receipts" section listing all receipts for the trip with their topic/sequence/timestamps

### 8.2 Modify `frontend/dispatcher/app/(app)/trips/new/page.tsx`

After successful POST, show a transient "Anchoring to Hedera (≈4s)…" state. Navigate to detail page when the response arrives. The receipt is in the response body, so the detail page renders the badge immediately.

### 8.3 Modify `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`

- Each row gets a small 🔒 indicator if anchored
- Click row → `router.push(\`/fleet/vehicles/${id}\`)`

### 8.4 Modify `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`

Same — anchored indicator + clickable row.

### 8.5 New `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`

Layout:
- Header card: registration, make/model, type (HORSE/TRAILER), license disc expiry, active state
- `<BlockchainBadge>` + `<VerifyButton>` (verify button designed in; not wired for vehicles Tuesday)
- `<EventTimeline events={events} receipts={receipts} />`
- "Trips using this vehicle" table (recycled `TripsTable` component)

### 8.6 New `frontend/dispatcher/app/(app)/fleet/drivers/[id]/page.tsx`

Same layout as vehicle detail. PII fields (name, phone, ID number, license number) visible to authenticated dispatcher — they're stored in DB and shown in UI, but never on-chain.

### 8.7 New hooks in `frontend/dispatcher/lib/hooks/`

- `useBlockchainReceipts(subjectType, subjectId)` — GET `/api/v1/blockchain/receipts?...`
- `useVerify()` — returns `(subjectType, subjectId) => Promise<VerifyResult>`
- `useVehicleDetail(id)` — GET `/api/v1/vehicles/{id}`
- `useDriverDetail(id)` — GET `/api/v1/drivers/{id}`

All use the existing typed-fetch wrapper pattern in `frontend/dispatcher/lib/hooks/useAsyncData.ts`.

### 8.8 Extend `useTripDetail.ts`

The uncommitted `useTripDetail.ts` hook returns trip detail. Extend its return type to include `blockchain_receipts: BlockchainReceipt[]`. No new fetch — the existing endpoint already returns this.

---

## 9. Configuration

### Backend `.env`

Hedera env vars already wired into [hedera.py:140-151](backend/app/blockchain/hedera.py#L140-L151) via `app.core.config.settings`:

- `HEDERA_NETWORK` (testnet)
- `HEDERA_ACCOUNT_ID` (operator account)
- `HEDERA_PRIVATE_KEY` (operator private key — secret)
- `HEDERA_TOPIC_ID` (the HCS topic for FreightProof anchors)

Verify these are present in `backend/.env.example` and `backend/app/core/config.py`. If absent on a teammate's machine, they'll need to be added — flag as coordination item.

### Frontend `.env`

Add to `frontend/dispatcher/.env.local.example` and `frontend/shared/`:

- `NEXT_PUBLIC_HEDERA_HASHSCAN_BASE` (e.g. `https://hashscan.io/testnet`)

---

## 10. Testing

### Unit tests

- `backend/tests/unit/test_anchor_service.py` — anchor_subject() with stubbed HederaService; verifies payload canonicalization, hash computation, receipt persistence
- `backend/tests/unit/test_critical_fields.py` — diff_critical_fields() returns diff when registration changes, returns None when only `make` changes
- `backend/tests/unit/test_hashing.py` — extend existing test for the new `created_by_user_id`/`created_at` parameters
- `backend/tests/unit/test_verification_service.py` — all four VerifyStatus branches with stubbed HederaService

### Integration tests

- `backend/tests/integration/test_trips_anchor.py` — POST /trips, assert BlockchainReceipt row created, assert hash matches journey_lock_hash, assert mirror-node verify call stubbed
- `backend/tests/integration/test_vehicles_anchor.py` — POST /vehicles, assert VehicleEvent + BlockchainReceipt
- `backend/tests/integration/test_drivers_anchor.py` — POST /drivers, assert DriverEvent + BlockchainReceipt, assert NO license_number plaintext in payload_json
- `backend/tests/integration/test_blockchain_verify.py` — all four VerifyStatus paths

### Manual demo rehearsal

Run through the demo script once end-to-end against the live Hedera testnet before Tuesday.

---

## 11. POPIA compliance (design property, not feature)

### On-chain payload is PII-safe by construction

| Anchored field | PII? |
|---|---|
| Subject UUIDs (trip_id, vehicle_id, driver_id, user_id) | No (opaque random tokens) |
| `license_number_sha256` | No (one-way hash) |
| Dates, registration, make/model, order_number | No |
| Driver name / phone / ID / license number plaintext | **Never on-chain** |

### Erasure model

When a user or driver exercises POPIA right to erasure:

1. On-chain receipts are kept (immutable; required for evidentiary integrity)
2. The UUID stays on the row (referential integrity)
3. PII columns are nulled on the `users` / `drivers` row
4. The row is **not** deleted
5. After erasure: UI shows "Deleted user (erased)" instead of names. Hedera record shows the UUID, which can no longer be linked to a human via FreightProof's data

This is the established CNIL/POPIA-compatible pattern: anonymize the off-chain interpretation key while preserving the on-chain evidence.

**Implementation deferred** — no erasure code Tuesday. The design property holds because the anchored payload was built to be POPIA-safe from day one.

---

## 12. Out of scope for Tuesday

These are designed in this spec but **not implemented** for the demo:

- Async/Celery anchoring (sync path covers the demo; `anchor_subject` is structured for swap)
- Vehicle/driver edit forms in the UI (the *anchor on mutate* backend logic is the C stretch; the *edit form* is post-demo)
- Event-level Verify Now buttons (designed; only trip-level is wired)
- Handshake / exception anchoring (receipt model supports `handshake` / `exception` subject_types; flows separate work)
- Multi-party signatures, IDVS, Pulsit GPS oracle integration
- POPIA erasure flow code (design property only)
- Driver PWA blockchain features
- Receiver OTP / guard zero-login pages

---

## 13. Demo script — Tuesday 2026-05-19 (~3 minutes)

1. **"Here's the dispatcher dashboard."** Log in.
2. **"I'm creating a new trip."** Fill the form, press Create. Brief 4–6s pause: *"this is being anchored to Hedera testnet right now"*.
3. **Trip detail page loads** with 🔒 Anchored to Hedera badge — sequence number, consensus timestamp, HashScan link.
4. **Click HashScan.** External page shows the same hash. *"Independently verifiable. If our system goes dark, the proof persists."*
5. **Back to dispatcher. Click Verify Now.** ~1s — ✓ Verified.
6. **Tamper demo (showpiece).** Side terminal: `psql -c "UPDATE trips SET order_number='ORDER-HACKED' WHERE ..."`. Refresh page, click Verify Now. **⚠ MISMATCH DETECTED** in red. *"Direct DB tampering is detected — that's the value of blockchain anchoring."*
7. **Vehicle detail page.** Timeline shows the `created` event with its receipt.
8. **Driver detail page.** Same.
9. **(Stretch)** Edit a vehicle's licence disc expiry. New event in timeline, new anchor.

---

## 14. Files at a glance

### Backend — new
- `backend/app/blockchain/anchor_service.py`
- `backend/app/blockchain/critical_fields.py`
- `backend/app/orchestration/verification_service.py`
- `backend/app/api/v1/endpoints/blockchain.py`
- `backend/app/schemas/events.py`
- `backend/migrations/versions/2026_05_17_ciaran_extend_blockchain_receipts_for_subjects.py`
- `backend/migrations/versions/2026_05_17_ciaran_add_vehicle_driver_events.py`
- `backend/app/db/models/events.py` (or extend existing model files)
- `backend/tests/unit/test_anchor_service.py`
- `backend/tests/unit/test_critical_fields.py`
- `backend/tests/unit/test_verification_service.py`
- `backend/tests/integration/test_trips_anchor.py`
- `backend/tests/integration/test_vehicles_anchor.py`
- `backend/tests/integration/test_drivers_anchor.py`
- `backend/tests/integration/test_blockchain_verify.py`

### Backend — modified
- `backend/app/crypto/hashing.py` (extend `compute_journey_lock_hash`)
- `backend/app/orchestration/trip_service.py` (replace stub with anchor call)
- `backend/app/orchestration/resource_service.py` (extend create_vehicle, create_driver; add get_vehicle_detail, get_driver_detail; add update_vehicle, update_driver for stretch)
- `backend/app/db/models/blockchain.py` (add subject_type, subject_id)
- `backend/app/db/models/__init__.py` (register new event models)
- `backend/app/schemas/blockchain.py` (add VerifyRequest/Result, BlockchainReceiptRead)
- `backend/app/schemas/trips.py` (include receipts in TripDetailResponse)
- `backend/app/schemas/vehicles.py` (VehicleDetailResponse)
- `backend/app/schemas/people.py` (DriverDetailResponse)
- `backend/app/api/v1/endpoints/vehicles.py` (pass current_user, add GET/PATCH)
- `backend/app/api/v1/endpoints/drivers.py` (pass current_user, add GET/PATCH)
- `backend/app/main.py` (register blockchain router)

### Frontend — new
- `frontend/shared/components/blockchain/BlockchainBadge.tsx`
- `frontend/shared/components/blockchain/VerifyButton.tsx`
- `frontend/shared/components/blockchain/EventTimeline.tsx`
- `frontend/shared/types/blockchain.ts`
- `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`
- `frontend/dispatcher/app/(app)/fleet/drivers/[id]/page.tsx`
- `frontend/dispatcher/lib/hooks/useBlockchainReceipts.ts`
- `frontend/dispatcher/lib/hooks/useVerify.ts`
- `frontend/dispatcher/lib/hooks/useVehicleDetail.ts`
- `frontend/dispatcher/lib/hooks/useDriverDetail.ts`

### Frontend — modified
- `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`
- `frontend/dispatcher/app/(app)/trips/new/page.tsx`
- `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`
- `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`
- `frontend/dispatcher/lib/hooks/useTripDetail.ts`

### Shared-file changes flagged
- `backend/app/main.py` — router registration
- `backend/app/db/models/__init__.py` — new model registration
- `backend/app/core/config.py` — verify Hedera env vars (likely already present)
- `backend/.env.example` — add Hedera keys if missing
- `frontend/dispatcher/.env.local.example` — add `NEXT_PUBLIC_HEDERA_HASHSCAN_BASE`

> **Suggested commit (after implementation):** `feat(blockchain): anchor trip/vehicle/driver creation to Hedera HCS with verify flow`
