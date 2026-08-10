# FreightProof SA — API Contract: Dispatcher & Driver Endpoints

**Source of truth for every endpoint the Dispatcher Portal and Driver PWA will consume.**

Generated from analysis of:
- `docs/FreightProof_Frontend_Spec_v1.md` — page catalogue, hook names, data shapes
- `docs/FreightProof_Full_Picture_v6.md` — domain rules, handshake flow
- `backend/app/db/models/` — authoritative DB schema
- `backend/app/schemas/` — existing Pydantic v2 schemas

Date: 2026-05-10 | Author: Claude Code (Tim Gultig session)

---

## 0. Three Design Decisions — Questions Answered

These were the specific questions that triggered this document. Answers are derived from
the frontend spec hooks and the existing backend schema patterns.

### 0.1 Does `GET /trips/{id}` nest driver, horse, trailers as full objects or just IDs?

**Full objects for all three.**

Evidence:
- `schemas/trips.py → TripRead` already declares `driver: Optional[DriverRead]` and
  `horse: Optional[VehicleRead]` — the pattern is already established in the codebase.
- The Dispatcher Trip Detail page (`spec §7.3`) renders driver name, vehicle registration,
  and trailer details inline without a second network call.
- The Driver Home page (`spec §8.2`) renders "trip summary (route, vehicle, expected origin
  gate, slot time)" from a single `useTrip()` call.

`trailers` is not yet in `TripRead` but must be added as `trailers: list[VehicleRead]`.
Trailers live in `trip_trailers` (join table) pointing at `vehicles` rows with
`vehicle_type = "trailer"`. The join is resolved by the service layer, not the endpoint.

### 0.2 Is the list envelope key `items` or `results`? What are the pagination field names?

**`items`. Pagination fields: `total`, `page`, `page_size`.**

No list endpoint exists yet. This spec defines the shape.

Rationale: `items` is the FastAPI community convention and matches the JSON:API adjacency
expected by `DataTable` in the dispatcher frontend. `total` (not `count`) is used
because `total` is unambiguous when `page_size` differs from the number of items
returned on the last page. `page` is 1-indexed (easier to display in UI). `page_size`
is the requested page size (the actual items list may be shorter on the last page).

```json
{
  "items": [ ... ],
  "total": 42,
  "page": 1,
  "page_size": 25
}
```

This shape is used by every list endpoint in this spec.

### 0.3 Does `/trips/{id}/manifest` exist as its own endpoint, or is it folded into the trip detail?

**Its own endpoint: `GET /trips/{id}/manifest`.**

Evidence:
- The frontend has TWO separate hooks: `useTrip(id)` (dispatcher Trip Detail — full trip)
  and `useManifest(tripId)` (driver H2 Step 2 — manifest only). Separate hooks → separate
  endpoints in the real-API transition path (`spec §3.4`).
- A manifest can contain 100+ `Parcel` rows. Including it in every `GET /trips/{id}` call
  would bloat the response for the dispatcher's Active Trips list and the driver's home
  screen, both of which show trip summaries only.
- The manifest is only needed in two specific contexts: the Dispatcher's "Manifest" tab
  inside Trip Detail, and the Driver's H2 Step 2 loading confirmation page.

`GET /trips/{id}` returns the full trip with handshakes, exceptions, and blockchain
receipts — but NOT the parcel list. The manifest is fetched on demand.

---

## 1. Architecture Constraints

### 1.1 Layering (from `CLAUDE.md`)

```
endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db
```

- Endpoints are thin: validate input, call a service/orchestration function, return output.
- Business logic (state machine transitions, hash computation, Hedera calls) lives in
  `app/orchestration/`, never inline in the endpoint.
- The DB is never touched directly from an endpoint — always via `get_db()` and a service.

### 1.2 Auth model

Two separate token types:

| Caller | Token type | How obtained |
|---|---|---|
| Dispatcher Portal | Bearer JWT | `POST /auth/token` (email + password, User table) |
| Driver PWA | Bearer JWT | `POST /auth/driver/token` (phone OTP, Driver table) |

Both tokens are validated by a shared `get_current_user` / `get_current_driver` dependency.
Endpoints that serve both surfaces use a union dependency.

Endpoint-level auth is declared via FastAPI `Depends`. Never validate tokens inline.

### 1.3 Response format

- All successful responses use the schema's `Read` type directly — no wrapper envelope
  except for list responses (see §0.2).
- All timestamps are ISO 8601 UTC strings (`2026-05-10T08:14:00Z`). The frontend converts
  to SAST for display.
- All IDs are UUIDs serialised as lowercase hyphenated strings.
- HTTP 422 for Pydantic validation failures (FastAPI default — do not override).
- HTTP 401 for missing/invalid token. HTTP 403 for valid token, wrong role/organisation.
- HTTP 404 for any resource not found (never expose whether it exists in a 403).

### 1.4 Status enum mismatch — CRITICAL coordination point

The backend `TripStatus` enum (`enums.py`) has **10 states**:

```
CREATED, ORIGIN_GATE_IN, LOADING, ORIGIN_GATE_OUT, IN_TRANSIT,
DEST_GATE_IN, UNLOADING, CLOSED, CANCELLED, EXCEPTION_HOLD
```

The frontend `spec §3.1` defines **6 states**:

```
'CREATED' | 'AT_ORIGIN' | 'LOADED' | 'IN_TRANSIT' | 'AT_DESTINATION' | 'CLOSED'
```

**The frontend types are wrong — they must be updated to match the backend.**

The backend model is correct: it tracks the precise handshake phase, which the dispatcher
UI needs (e.g. to show "currently at Handshake 3" vs "currently at Handshake 4").
`frontend/dispatcher/lib/types/trip.ts` and `frontend/driver-pwa/lib/types/trip.ts` must
be updated before Phase 1 page work starts. This is a Phase 0 task (after fixtures are
written but before pages). The active-trips filter in `useTrips()` will need to pass the
full 10-state set, not the 6-state set.

Mapping for the frontend's display logic (read-only, for UI labels only):

| Backend `TripStatus` | Frontend display label | Handshake |
|---|---|---|
| `created` | Trip Created | H0 |
| `origin_gate_in` | At Origin Gate | H1 |
| `loading` | Loading | H2 |
| `origin_gate_out` | Departed Origin | H3 |
| `in_transit` | In Transit | — |
| `dest_gate_in` | At Destination Gate | H4 |
| `unloading` | Unloading | H5 |
| `closed` | Closed | — |
| `cancelled` | Cancelled | — |
| `exception_hold` | On Hold | — |

---

## 2. Router File Layout

One router file per resource domain. Register all routers in `app/main.py` under `/api/v1`.

```
backend/app/api/v1/endpoints/
├── __init__.py
├── auth.py           # POST /auth/token, POST /auth/driver/token, POST /auth/refresh
├── trips.py          # Trip CRUD + detail + manifest + handshake advancement
├── exceptions.py     # TripException list + detail + resolution actions
├── vehicles.py       # Vehicle list (for trip creation dropdowns)
├── drivers.py        # Driver list (for trip creation dropdown)
├── precincts.py      # Precinct list (for trip creation dropdown)
├── checkpoints.py    # Checkpoint create + list per trip
└── templates.py      # TripTemplate list (for trip creation)
```

Each file has a single `APIRouter` with `tags=["..."]`. No logic lives in these files
beyond input validation and delegation to a service function.

---

## 3. Endpoint Catalogue

### 3.1 Auth

#### `POST /api/v1/auth/token`
Dispatcher login.

| Field | Value |
|---|---|
| Auth | None |
| Tags | `["auth"]` |
| Request body | `{ "email": str, "password": str }` |
| Response 200 | `{ "access_token": str, "token_type": "bearer", "expires_in": int }` |
| Response 401 | Invalid credentials |

#### `POST /api/v1/auth/driver/token`
Driver login (phone OTP — two-step: request OTP then verify).

| Field | Value |
|---|---|
| Auth | None |
| Tags | `["auth"]` |
| Step 1 Request | `POST /auth/driver/otp-request` — `{ "phone_number": str }` → 200 OK (no body) |
| Step 2 Request | `POST /auth/driver/token` — `{ "phone_number": str, "otp": str }` |
| Response 200 | `{ "access_token": str, "token_type": "bearer", "expires_in": int, "driver": DriverRead }` |
| Response 401 | Invalid or expired OTP |

---

### 3.2 Trips

Router prefix: `/api/v1/trips`

#### `GET /api/v1/trips`
Paginated trip list for the Dispatcher Active Trips and History pages.
Consumed by `useTrips(filter?)` hook.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["trips"]` |
| Query params | `status` (repeatable, any `TripStatus` value), `driver_id` (UUID), `search` (order number or trip reference), `has_exceptions` (bool), `from_date` (ISO date), `to_date` (ISO date), `page` (int, default 1), `page_size` (int, default 25, max 100) |
| Response 200 | `TripListResponse` — see schema §4.1 |
| Filtering | `status` is a multi-value filter: `?status=loading&status=in_transit`. If omitted, all statuses returned. |
| Ordering | `updated_at DESC` (most recently changed trip first). Not configurable on v1. |
| Scope | Caller's `operator_organization_id` is applied automatically from the JWT — no cross-org leakage. |

#### `POST /api/v1/trips`
Trip creation (Handshake 0). Consumed by dispatcher Trip Creation page.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["trips"]` |
| Request body | `TripCreate` (from `schemas/trips.py`) |
| Response 201 | `TripDetailResponse` — see schema §4.2 |
| Side effects | Creates `HandshakeEvent` row for H0, computes journey lock hash, queues Hedera HCS anchor task via Celery, runs IDVS check for the assigned driver. |
| Errors | 422 if validation fails, 409 if `order_number` is already active in another trip |

#### `GET /api/v1/trips/{trip_id}`
Full trip detail. Consumed by `useTrip(id)` hook in both surfaces.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT OR Driver JWT (driver sees only their own assigned trip) |
| Tags | `["trips"]` |
| Response 200 | `TripDetailResponse` — see schema §4.2 |
| Response 404 | Trip not found or not accessible by caller |
| What's included | Trip row, nested driver (full), nested horse (full), nested trailers (full list), all `HandshakeEvent` rows, all `TripException` rows, all `BlockchainReceipt` rows. NOT the parcel manifest — see §3.3. |

#### `PATCH /api/v1/trips/{trip_id}`
Dispatcher-only updates (add Pulsit reference ID, put trip on hold, cancel).

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["trips"]` |
| Request body | `TripUpdate` (from `schemas/trips.py`) |
| Response 200 | `TripDetailResponse` |
| Restriction | Status transitions via `PATCH` are limited to `CANCELLED` and `EXCEPTION_HOLD`. All other status changes happen through the handshake advancement endpoints (§3.4) to enforce the state machine. |

---

### 3.3 Trip Manifest

#### `GET /api/v1/trips/{trip_id}/manifest`
Parcel manifest for one trip. Consumed by `useManifest(tripId)` hook.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT OR Driver JWT (driver sees only their own trip's manifest) |
| Tags | `["trips"]` |
| Response 200 | `ManifestResponse` — see schema §4.3 |
| Response 404 | Trip not found, or manifest not yet pulled from Parcel Perfect (loading not started) |
| Timing | Available after H2 loading starts. Before that, the endpoint returns 404. The driver's H2 Step 1 "loading status" polling uses a separate endpoint (§3.4 handshake detail). |

---

### 3.4 Handshake Advancement (Driver)

These endpoints advance the trip state machine. They are called from the driver PWA
at the end of each handshake step's "Complete & continue" CTA. Each endpoint:

1. Validates preconditions (correct current state, required artifacts present).
2. Calls the orchestration layer state machine.
3. Returns the updated `TripDetailResponse`.

Router prefix: `/api/v1/trips/{trip_id}/handshakes`

#### `POST /api/v1/trips/{trip_id}/handshakes/h1/complete`
Complete H1 — Origin Gate-In.

| Field | Value |
|---|---|
| Auth | Driver JWT (must be the assigned driver on this trip) |
| Tags | `["handshakes"]` |
| Request body | `H1CompleteRequest` — GPS coords (phone), gate photo artifact ID |
| Response 200 | `TripDetailResponse` |
| Orchestration | Queries Pulsit for horse + trailer GPS cross-reference, runs driver match check, records `HandshakeEvent` H1 as `completed`, transitions `Trip.status → origin_gate_in`. |
| On check failure | Returns 200 with H1 `HandshakeEvent.status = "exception"` and a populated `TripException`. Does NOT return 4xx — the trip continues with a dispatcher alert. |

#### `POST /api/v1/trips/{trip_id}/handshakes/h2/complete`
Complete H2 — Loading Handshake.

| Field | Value |
|---|---|
| Auth | Driver JWT |
| Tags | `["handshakes"]` |
| Request body | `H2CompleteRequest` — waybill photo artifact ID, seal number, seal photo artifact ID, driver visual count confirmation |
| Response 200 | `TripDetailResponse` |
| Orchestration | Fetches final Parcel Perfect manifest snapshot, assembles pickup event hash (SHA-256), queues Hedera HCS pickup receipt anchor task, transitions `Trip.status → loading → origin_gate_out` (via H3 — H2 complete sets `loading`). |

#### `POST /api/v1/trips/{trip_id}/handshakes/h3/complete`
Complete H3 — Origin Gate-Out.

| Field | Value |
|---|---|
| Auth | Driver JWT |
| Tags | `["handshakes"]` |
| Request body | `H3CompleteRequest` — gate exit photo artifact ID, seal verified (bool) |
| Response 200 | `TripDetailResponse` |
| Orchestration | Confirms Pulsit geofence departure, transitions `Trip.status → in_transit`. |

#### `POST /api/v1/trips/{trip_id}/handshakes/h4/complete`
Complete H4 — Destination Gate-In.

| Field | Value |
|---|---|
| Auth | Driver JWT |
| Tags | `["handshakes"]` |
| Request body | `H4CompleteRequest` — gate entry photo artifact ID, seal number at destination |
| Response 200 | `TripDetailResponse` |
| Orchestration | Compares incoming seal number against the H2 committed seal number. If mismatch → creates `TripException(SEAL_MISMATCH, CRITICAL)` and transitions `Trip.status → exception_hold`. If intact → transitions `Trip.status → dest_gate_in`. |

#### `POST /api/v1/trips/{trip_id}/handshakes/h5/complete`
Complete H5 — Unloading Handshake (closes the trip).

| Field | Value |
|---|---|
| Auth | Driver JWT |
| Tags | `["handshakes"]` |
| Request body | `H5CompleteRequest` — POD photo artifact ID, driver visual count, destination Parcel Perfect scan-in count |
| Response 200 | `TripDetailResponse` |
| Orchestration | Runs three-count reconciliation (manifest origin, PP scan-in, driver visual), assembles delivery event hash, queues Hedera HCS delivery receipt anchor task, transitions `Trip.status → closed`, sets `Trip.closed_at`. |

#### `GET /api/v1/trips/{trip_id}/handshakes/{handshake_type}`
Polling endpoint for loading status (H2 Step 1) and unloading count (H5 Step 3).

| Field | Value |
|---|---|
| Auth | Driver JWT OR Dispatcher JWT |
| Tags | `["handshakes"]` |
| Path param | `handshake_type`: one of the `HandshakeType` enum values |
| Response 200 | `HandshakeEventRead` (from `schemas/handshakes.py`) |
| Use case | Driver PWA polls this every 4 seconds during H2 Step 1 ("Loading status: not started / in progress / complete") and H5 Step 3 (auto-incrementing scan-in count). |

---

### 3.5 Checkpoints

Router prefix: `/api/v1/trips/{trip_id}/checkpoints`

#### `POST /api/v1/trips/{trip_id}/checkpoints`
Log an in-transit checkpoint. Consumed by Driver PWA "Log checkpoint" flow.

| Field | Value |
|---|---|
| Auth | Driver JWT |
| Tags | `["checkpoints"]` |
| Request body | `CheckpointCreate` — GPS lat/lng (phone), GPS lat/lng (horse from Pulsit), selfie artifact ID, optional cargo photo artifact ID, optional note |
| Response 201 | `CheckpointRead` (from schemas) |
| Orchestration | Adds checkpoint to the daily Merkle batch for the trip. |

#### `GET /api/v1/trips/{trip_id}/checkpoints`
Checkpoint history for a trip (dispatcher Timeline tab).

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["checkpoints"]` |
| Response 200 | `list[CheckpointRead]` (no pagination — checkpoints per trip are bounded, not a global list) |

---

### 3.6 Exceptions

Router prefix: `/api/v1/exceptions`

#### `GET /api/v1/exceptions`
Global exception list for the Dispatcher Exceptions triage page.
Consumed by `useExceptions({ resolved: false })`.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["exceptions"]` |
| Query params | `resolved` (bool, default `false`), `severity` (repeatable), `source` (repeatable), `exception_type` (repeatable), `trip_id` (UUID), `from_date`, `to_date`, `page` (default 1), `page_size` (default 25, max 100) |
| Response 200 | `ExceptionListResponse` — items are `TripExceptionRead`, same `{items, total, page, page_size}` envelope |
| Scope | Filtered to caller's `operator_organization_id`. |

#### `GET /api/v1/exceptions/{exception_id}`
Exception detail. Consumed by Dispatcher Exception Detail page.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["exceptions"]` |
| Response 200 | `TripExceptionRead` — includes nested trip summary, handshake context, and last checkpoint |

#### `POST /api/v1/exceptions/{exception_id}/resolve`
Mark exception resolved (with note). Consumed by Dispatcher "Resolve" action.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["exceptions"]` |
| Request body | `{ "resolver_note": str }` |
| Response 200 | `TripExceptionRead` |

#### `POST /api/v1/exceptions/{exception_id}/override`
Dispatcher override — allows the trip to proceed past a failing check.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["exceptions"]` |
| Request body | `{ "override_note": str }` |
| Response 200 | `TripDetailResponse` (trip with updated HandshakeEvent status) |

#### `POST /api/v1/trips/{trip_id}/exceptions`
Driver raises an exception. Consumed by Driver PWA "Report exception" flow and panic button.

| Field | Value |
|---|---|
| Auth | Driver JWT |
| Tags | `["exceptions"]` |
| Request body | `TripExceptionCreate` — `exception_type`, `description`, optional `supporting_artifact_id` |
| Response 201 | `TripExceptionRead` |

---

### 3.7 Evidence Artifacts (uploads)

#### `POST /api/v1/artifacts`
Upload a photo or document. Called by the driver PWA before submitting a handshake step.

| Field | Value |
|---|---|
| Auth | Driver JWT OR Dispatcher JWT |
| Tags | `["artifacts"]` |
| Request | Multipart form — `file` (binary), `trip_id` (UUID), `artifact_type` (`photo` | `document`), `captured_lat` (optional), `captured_lng` (optional), `captured_at` (ISO 8601 string) |
| Response 201 | `EvidenceArtifactRead` — includes `id` (UUID) used in subsequent handshake requests |
| Side effect | Computes SHA-256 hash of the file, stores to Supabase Storage, records the row. The `id` is what the driver PWA passes in `H1CompleteRequest.gate_photo_artifact_id` etc. |
| Max size | 10 MB per file. 422 if exceeded. |

---

### 3.8 Reference data (dropdowns)

These are read-only endpoints for the Dispatcher Trip Creation form dropdowns.

#### `GET /api/v1/drivers`
Active driver list for the dispatcher's driver selector.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["drivers"]` |
| Query params | `search` (name or license), `page`, `page_size` |
| Response 200 | `{ items: list[DriverRead], total, page, page_size }` |
| Scope | Only drivers in caller's organization. |

#### `GET /api/v1/vehicles`
Vehicle list. Horse and trailer dropdowns in trip creation.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["vehicles"]` |
| Query params | `vehicle_type` (`horse` | `trailer`), `search` (registration), `page`, `page_size` |
| Response 200 | `{ items: list[VehicleRead], total, page, page_size }` |

#### `GET /api/v1/precincts`
Precinct list for origin/destination selectors.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["precincts"]` |
| Query params | `search` (name), `page`, `page_size` |
| Response 200 | `{ items: list[PrecinctRead], total, page, page_size }` |

#### `GET /api/v1/templates`
Trip templates for "Use template" toggle in trip creation.

| Field | Value |
|---|---|
| Auth | Dispatcher JWT |
| Tags | `["templates"]` |
| Query params | `is_active` (bool, default `true`), `page`, `page_size` |
| Response 200 | `{ items: list[TripTemplateRead], total, page, page_size }` |

---

## 4. New Schema Types Required

These schemas do not exist yet. They must be written in `backend/app/schemas/` before
the endpoints are implemented.

### 4.1 `TripListResponse`

```python
# app/schemas/trips.py

class TripSummaryRead(BaseModel):
    """Lightweight trip row for list pages — no handshake events, no exceptions."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_reference: str
    order_number: str
    status: TripStatus
    driver: DriverRead                  # full nested object
    horse: VehicleRead                  # full nested object
    trailers: list[VehicleRead]         # full nested list
    origin_precinct_id: UUID
    destination_precinct_id: UUID
    planned_departure_at: Optional[datetime]
    actual_departure_at: Optional[datetime]
    planned_arrival_at: Optional[datetime]
    actual_arrival_at: Optional[datetime]
    open_exception_count: int           # derived: count of unresolved TripExceptions
    created_at: datetime
    updated_at: datetime


class TripListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[TripSummaryRead]
    total: int
    page: int
    page_size: int
```

### 4.2 `TripDetailResponse`

```python
# app/schemas/trips.py

class TripDetailResponse(BaseModel):
    """Full trip record for Trip Detail and Driver Home. No manifest — fetched separately."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_reference: str
    order_number: str
    status: TripStatus
    journey_lock_hash: Optional[str]
    idvs_check_status: IdvsStatus
    driver: DriverRead                          # full nested object
    horse: VehicleRead                          # full nested object
    trailers: list[VehicleRead]                 # full nested list
    origin_precinct_id: UUID
    destination_precinct_id: UUID
    pulsit_trip_reference_id: Optional[str]
    planned_departure_at: Optional[datetime]
    actual_departure_at: Optional[datetime]
    planned_arrival_at: Optional[datetime]
    actual_arrival_at: Optional[datetime]
    closed_at: Optional[datetime]
    handshakes: list[HandshakeEventRead]        # all 6 rows once created
    exceptions: list[TripExceptionRead]         # all exceptions for this trip
    blockchain_receipts: list[BlockchainReceiptRead]
    created_at: datetime
    updated_at: datetime
```

`TripExceptionRead` is the read schema for `TripException` — add it to
`app/schemas/transit.py` if it does not exist. It must include `exception_type`,
`source`, `severity`, `description`, `resolved`, `resolved_at`, `resolver_note`.

`BlockchainReceiptRead` lives in `app/schemas/blockchain.py` — confirm it includes
`receipt_type`, `hedera_topic_id`, `hedera_sequence_number`, `sha256_hash`,
`confirmed_at`.

### 4.3 `ManifestResponse`

Restructured for multi-consignment trips, FP-112 alignment 2026-07-02. A trip can now
have multiple `Consignment` rows (multi-client trips) — the manifest is grouped
per-consignment rather than assuming exactly one consignment per trip, and each
consignment's slice carries its own `client_organization_id` and consolidated-unit
count (`unit_count_expected`, pallets — distinct from parcel-grain `total_parcel_count`).

```python
# app/schemas/trips.py

class DeliveryStopManifest(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    delivery_stop: str
    parcel_count: int
    parcels: list[ParcelRead]


class ConsignmentManifest(BaseModel):
    """One consignment's slice of the manifest — one per client booking on the trip."""
    model_config = ConfigDict(from_attributes=True)

    consignment_id: UUID
    parcel_perfect_reference: str
    client_organization_id: UUID
    unit_count_expected: Optional[int] = None   # consolidated-unit (pallet) grain
    total_parcel_count: int
    origin_scan_complete: bool                  # True once all this consignment's parcels have pp_scan_out_at
    stops: list[DeliveryStopManifest]           # grouped by delivery_stop


class ManifestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    total_parcel_count: int              # sum across all consignments on the trip
    origin_scan_complete: bool           # True once all parcels across all consignments have pp_scan_out_at
    consignments: list[ConsignmentManifest]
    pulled_at: datetime                  # latest updated_at across all consignments on the trip
```

### 4.4 Handshake request bodies

These live in `app/schemas/handshakes.py`. One per handshake.

```python
class H1CompleteRequest(BaseModel):
    driver_phone_lat: Decimal
    driver_phone_lng: Decimal
    gate_photo_artifact_id: UUID

class H2CompleteRequest(BaseModel):
    waybill_photo_artifact_id: UUID
    seal_number: str                    # format XX-#### validated at endpoint
    seal_photo_artifact_id: UUID
    driver_visual_count: int

class H3CompleteRequest(BaseModel):
    gate_exit_photo_artifact_id: UUID
    guard_verified_seal: bool

class H4CompleteRequest(BaseModel):
    gate_entry_photo_artifact_id: UUID
    seal_number_at_destination: str     # compared against H2 seal in orchestration

class H5CompleteRequest(BaseModel):
    pod_photo_artifact_id: UUID
    driver_visual_count: int
    pp_scan_in_count: int               # from destination Parcel Perfect poll
```

### 4.5 `TripExceptionCreate`

```python
# app/schemas/transit.py

class TripExceptionCreate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    exception_type: ExceptionType
    description: str
    supporting_artifact_id: Optional[UUID] = None
```

---

## 5. Orchestration Layer Functions Required

Endpoints delegate to these functions. None of them exist yet. Each lives in
`app/orchestration/`.

| Function | Module | Purpose |
|---|---|---|
| `create_trip(db, payload, dispatcher_user)` | `trip_service.py` | Creates Trip + H0 HandshakeEvent, computes journey lock hash, queues Celery tasks |
| `advance_h1(db, trip_id, driver, payload)` | `handshake_service.py` | H1 state machine step |
| `advance_h2(db, trip_id, driver, payload)` | `handshake_service.py` | H2 state machine step |
| `advance_h3(db, trip_id, driver, payload)` | `handshake_service.py` | H3 state machine step |
| `advance_h4(db, trip_id, driver, payload)` | `handshake_service.py` | H4 — includes seal comparison |
| `advance_h5(db, trip_id, driver, payload)` | `handshake_service.py` | H5 — three-count reconciliation, closes trip |
| `get_trip_detail(db, trip_id, caller)` | `trip_service.py` | Loads trip + joins + assembles `TripDetailResponse` |
| `get_trip_list(db, filters, caller)` | `trip_service.py` | Filtered/paged trip list |
| `get_manifest(db, trip_id, caller)` | `manifest_service.py` | Loads consignment + parcels, groups by stop |
| `raise_exception(db, trip_id, payload, driver)` | `exception_service.py` | Creates `TripException`, fires dispatcher alert |
| `resolve_exception(db, exception_id, note, dispatcher)` | `exception_service.py` | Marks resolved |
| `override_exception(db, exception_id, note, dispatcher)` | `exception_service.py` | Override + allows trip continuation |

The state machine (`advance_h1` … `advance_h5`) must enforce these preconditions before
mutating state:

1. Trip is not cancelled or closed.
2. The incoming handshake is the correct next step for the current `Trip.status`.
3. Required artifacts are present and their `file_hash` values pass a non-empty check.

If any precondition fails, raise a domain exception (not an HTTP exception) that the
endpoint handler converts to the appropriate HTTP status.

---

## 6. File Creation Order

When implementation starts, files must be created in this order to avoid circular
import issues:

1. `app/schemas/trips.py` — add `TripSummaryRead`, `TripDetailResponse`, `ManifestResponse`, `DeliveryStopManifest`, handshake request bodies. (Extend existing file, do not replace.)
2. `app/schemas/transit.py` — add `TripExceptionCreate`, `TripExceptionRead`, `CheckpointRead`. (Extend existing file.)
3. `app/schemas/blockchain.py` — confirm `BlockchainReceiptRead` is complete.
4. `app/orchestration/trip_service.py` — `create_trip`, `get_trip_detail`, `get_trip_list`.
5. `app/orchestration/handshake_service.py` — `advance_h1` … `advance_h5`.
6. `app/orchestration/manifest_service.py` — `get_manifest`.
7. `app/orchestration/exception_service.py` — `raise_exception`, `resolve_exception`, `override_exception`.
8. `app/api/v1/endpoints/auth.py`
9. `app/api/v1/endpoints/trips.py`
10. `app/api/v1/endpoints/exceptions.py`
11. `app/api/v1/endpoints/checkpoints.py`
12. `app/api/v1/endpoints/artifacts.py`
13. `app/api/v1/endpoints/vehicles.py`, `drivers.py`, `precincts.py`, `templates.py`
14. Update `app/main.py` — register all routers.

---

## 7. Shared-File Impact

Changes required to files owned by multiple devs:

| File | Change | Who to coordinate with |
|---|---|---|
| `backend/app/main.py` | Register new routers | All devs |
| `backend/app/schemas/trips.py` | Add new schema classes | DB schema owner |
| `backend/app/schemas/transit.py` | Add `TripExceptionCreate`, `TripExceptionRead` | DB schema owner |
| `frontend/dispatcher/lib/types/trip.ts` | Update `TripStatus` to 10-value union | Dispatcher frontend dev |
| `frontend/driver-pwa/lib/types/trip.ts` | Update `TripStatus` to 10-value union | Driver PWA frontend dev |
| `frontend/*/lib/mocks/trips.ts` | Update fixture trip statuses to match new enum values | Frontend devs |

---

## 8. Tests Required

Per `CLAUDE.md`, every feature needs unit + integration tests.

**Unit tests** (in `backend/tests/unit/`):
- `test_trip_service.py` — `create_trip` happy path, duplicate order number, IDVS failure
- `test_handshake_service.py` — each `advance_hN` happy path, wrong-state rejection, seal mismatch detection (H4)
- `test_manifest_service.py` — manifest grouping by stop, manifest not-yet-ready
- `test_exception_service.py` — raise, resolve, override happy paths

**Integration tests** (in `backend/tests/integration/`):
- `test_trips.py` — `POST /trips`, `GET /trips`, `GET /trips/{id}`, `PATCH /trips/{id}`
- `test_manifest.py` — `GET /trips/{id}/manifest` (200 and 404 before loading)
- `test_handshakes.py` — full H1–H5 sequence, seal mismatch at H4, override flow
- `test_exceptions.py` — list (filter by resolved/severity), detail, resolve, override
- `test_artifacts.py` — upload, hash stored, size limit 422
- `test_auth.py` — dispatcher login, driver OTP flow, invalid credentials

---

## 9. Frontend Transition Checklist

When the backend endpoints are live, the frontend swap from fixtures to real API follows
`spec §3.4`. For each hook, the corresponding API module to create:

| Hook | `lib/api/` module | Endpoint(s) used |
|---|---|---|
| `useTrips(filter?)` | `lib/api/trips.ts → fetchTrips()` | `GET /trips` |
| `useTrip(id)` | `lib/api/trips.ts → fetchTrip()` | `GET /trips/{id}` |
| `useManifest(tripId)` | `lib/api/manifest.ts → fetchManifest()` | `GET /trips/{id}/manifest` |
| `useExceptions(filter?)` | `lib/api/exceptions.ts → fetchExceptions()` | `GET /exceptions` |
| `useException(id)` | `lib/api/exceptions.ts → fetchException()` | `GET /exceptions/{id}` |
| `useDrivers()` | `lib/api/drivers.ts → fetchDrivers()` | `GET /drivers` |
| `useVehicles()` | `lib/api/vehicles.ts → fetchVehicles()` | `GET /vehicles` |
| `usePrecincts()` | `lib/api/precincts.ts → fetchPrecincts()` | `GET /precincts` |
| `useTemplates()` | `lib/api/templates.ts → fetchTemplates()` | `GET /templates` |

The hooks themselves do not change. Only their data source switches from
`lib/mocks/` to `lib/api/`. Pages and components are untouched.
