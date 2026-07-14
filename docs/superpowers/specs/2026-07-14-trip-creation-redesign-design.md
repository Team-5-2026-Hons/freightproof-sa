# Trip Creation Redesign — Minimal Wizard, PP-Sourced Cargo, Mocked PP API (Design Spec)

**Date:** 2026-07-14
**Branch:** Ciaran
**Status:** Design — reviewed with Ciaran 2026-07-14; awaiting implementation plan
**Supersedes:** the wizard's current Step 1 ("Order & Cargo") data model. Aligns with FP-112 (multi-consignment), WP7 (journey lock v2), WP8 (linehaul completion), the H1 geofence spec (2026-07-13), and the PP architecture review (2026-07-02).

## Problem

Trip creation is the root of the evidence chain (journey lock hash, H0 anchor), but the
current dispatcher wizard and backend contract have drifted apart:

1. **Dead inputs.** The wizard collects commodity, weight, unit count, and receiver
   name/contact, then silently drops all four — `handleSubmit` never sends them and the
   backend has no fields for them. Required-field validation on data that goes nowhere is
   pure friction, and receiver contact is PII collected without purpose (POPIA smell).
2. **The one number that matters isn't wired.** `Consignment.unit_count_expected` (the
   consolidated-unit/pallet grain, Bruce 24 Jun) is documented as "dispatcher-entered" but
   no creation path populates it. Because `manifest_service._load_consignments_and_parcels`
   404s on a trip with zero consignments, **every wizard-created trip dead-ends the driver
   app at H2** (linehaul fetch fails).
3. **Contract mismatches.** The wizard permits 0 trailers (single-unit trucks — valid: some
   trucks have integrated bodies) but `TripCreateRequest` requires ≥1 and
   `compute_journey_lock_hash` raises on an empty list. The wizard also sends the
   dispatcher's *own* org as `client_organization_id` — the operator posing as the client.
4. **Hedera failures look like bugs.** No handler maps `HederaServiceError`, so an anchor
   outage during creation surfaces as a raw 500.
5. **PP integration shape.** Tim's branch (`feature/gps-warehouse-geofencing`) adds a
   *singular* `pp_reference` to `TripCreateRequest`; FP-112's model is multi-consignment.
   His `fetch_and_sync_consignment` call can also pass a `None`
   `client_organization_id` into a non-nullable column (latent crash).

## Goals

- The wizard collects **only** data that is stored and load-bearing; everything PP can
  supply (weight, receiver, commodity, declared value, parcels) is pulled from PP, not typed.
- A trip references **one or more PP waybills** (multi-client, multi-consignment trips are
  first-class — one truck, several bookings).
- Every created trip is **readable by the driver app**: loaded trips carry ≥1 consignment
  with a unit count so the H2 linehaul works; empty legs (`trip_type=empty_leg`) get a
  defined 0-unit linehaul instead of a 404.
- PP is **mocked faithfully** for the upcoming iteration: same interface as the real v28
  client, realistic fixtures, plus a clearly-flagged *aspirational* manifest-number lookup
  to demo to PP/FedEx.
- Trip creation (H0) stays **fail-closed** on Hedera; failures surface as a clear 503.

## Non-goals (explicitly out of scope)

- No multi-stop wizard UI (`stops[]` input) — backend back-compat two-stop path is enough
  for this iteration; the schema already accepts explicit stops when we need them.
- No journey-lock v2 payload changes beyond the empty-trailer relaxation — the full
  cargo-plan hash (ordered stops, consignment snapshot hashes) is WP7 (FP-113, Chiko).
- No changes to driver-app screens (Tim's branch owns those).
- No trip templates work (`template_id` passes through untouched).
- No async/outbox anchoring — that is WP5; H0 stays synchronous this iteration.
- No PP write operations (quotes, collections) — read-only `getSingleWaybill` (+ mock
  manifest lookup) only.
- No Pulsit work of any kind. Trip creation already links Pulsit via the vehicle rows
  (`Vehicle.pulsit_device_id`, snapshotted into `TripTrailer.pulsit_device_id_snapshot`);
  driver-phone GPS links via the driver's PWA login, not a device registry. Mocking the
  Pulsit API waits until we have their doc (July visit) — a mock invented without shapes
  is rework, unlike the PP mock which is built from the published v28 spec.
- No driver-app handshake changes for empty legs (see Component 1a): whether an empty leg
  carries a seal and whether H2/H5 exist for it is an open domain question (Bruce). This
  spec lands the data model and creation path only; the wizard toggle ships, but the
  driver app treats empty-leg trips as out of scope this iteration.

## Key decisions

| Decision | Choice | Reason |
|---|---|---|
| Cargo data source | **PP-first**: waybill reference(s) pull weight, receiver, commodity, parcels | PP v28 `getSingleWaybill` verifiably returns `actkg`, `destpers`/contact/address, `contents[].description`, `tracks[]`. Typed duplicates of PP data are junk-data and error surface. |
| Consignment input shape | **`consignments[]` list** on `TripCreateRequest` (supersedes Tim's singular `pp_reference`) | Multi-waybill trips are confirmed real (multi-client Option B → FP-112). Build the right structure now; a single waybill is the one-element case. |
| Unit/pallet count | **Dispatcher-entered per consignment** | PP has no pallet grain (`pieces` = parcels; `contents` = freight lines). Consolidated units are a FreightProof custody concept (Bruce 24 Jun). |
| Driver visibility | Weight, receiver, commodity, value **never** reach the driver | Theft-risk rule: driver sees `LinehaulResponse` only (vehicle, driver, consolidated unit count, scan status). PP detail surfaces only on dispatcher screens. |
| Trailers | **0 trailers valid** (`min_length=0`; remove empty-list raise in hashing) | Rigid trucks with integrated bodies are legitimate single units. Wizard's SA road-regs logic was right; backend follows. |
| Client organization | **Derived from PP `accnum` → `Organization.pp_account_number`** (new column); warn-don't-fail on no match | Operator org already comes from the JWT (correct, keep). The client is the PP account holder per waybill. Sender/receiver (`origpers`/`destpers`) are waybill parties, not orgs — snapshot only. |
| Hedera at creation | **Fail-closed** (unchanged), plus map `HederaServiceError` → HTTP 503 | The journey lock *is* the trip's evidentiary identity; nothing operational is blocked at creation (dispatcher retries). Settled position: H1 spec ("`anchor_subject` is fail-closed and must stay that way") + WP5 (outbox later). Handshakes stay fail-open. |
| PP failure at creation | **Fail-closed** (Tim's `PPSyncError` → 422, kept) | A trip whose cargo plan couldn't be pulled has no manifest, no linehaul, no evidence value. |
| PP mock strategy | **Fixture library behind the existing `get_pp_client()` factory**, plus mock-only `get_waybills_by_manifest()` | Same seam Tim built (`PP_USE_MOCK`). Real client never implements the manifest lookup, so the codebase stays honest about what PP v28 actually offers. |
| Empty legs (repositioning runs) | **`trip_type: loaded \| empty_leg` in the data model + wizard toggle now; driver-app flow deferred** | Cheap to structure now, painful to retrofit once `consignments ≥ 1` and the WP7 lock payload bake in the loaded assumption. Whether an empty leg carries a seal / H2+H5 is an unresolved domain question — deferred with it. |
| Pulsit | **No mocking until their API doc exists** (post-July visit) | Creation already links Pulsit via vehicle-row device IDs (snapshotted); driver-phone GPS links via PWA login. There is nothing faithful to mock yet. |

## Design

### Component 1 — Backend schema (`schemas/trips.py`)

New input model and a reshaped `TripCreateRequest`:

```
class TripConsignmentInput(BaseModel):
    pp_reference: str            # PP waybill number, min_length=1, max_length=24 (PP field limit)
    unit_count_expected: int     # ge=1 — consolidated units (pallets), dispatcher-entered

class TripCreateRequest(BaseModel):
    order_number: str
    trip_type: TripType = TripType.LOADED   # loaded | empty_leg
    driver_id: UUID
    horse_id: UUID
    trailer_ids: list[UUID] = []          # min_length removed — 0 valid (rigid trucks)
    origin_precinct_id / destination_precinct_id / stops  # unchanged (FP-112 A.3)
    consignments: list[TripConsignmentInput] = Field(default_factory=list)
    template_id / planned_departure_at / planned_arrival_at  # unchanged
    # REMOVED: client_organization_id (derived per consignment from PP accnum)
    # SUPERSEDED: Tim's singular pp_reference → consignments[] (coordinate before his merge)
```

Validator additions: duplicate `pp_reference` values rejected; existing validators kept;
**consignment count validated against `trip_type`** — `loaded` requires ≥ 1 (this is what
structurally guarantees the driver's linehaul can never 404 on a new loaded trip),
`empty_leg` requires exactly 0.

### Component 1a — Empty legs (`trip_type`)

- New enum `TripType(str, enum.Enum): LOADED = "loaded"; EMPTY_LEG = "empty_leg"` in
  `db/models/enums.py`; `Trip.trip_type` column (`String(20)`, `NOT NULL`,
  `server_default="loaded"`) — same migration as Component 2.
- An empty leg is a repositioning run: driver, horse, optional trailers, origin,
  destination, optional stops and planned times — no cargo, no waybills, no client.
- `trip_type` joins the journey-lock canonical payload (a repositioning run being
  re-labelled a loaded run post-hoc is exactly the kind of tampering the lock exists to
  catch). Existing seeded trips predate the field; WP7's version dispatch handles old
  receipts — same mechanism, no extra work here.
- **Read-side behaviour defined now** so the driver app can't dead-end: for `empty_leg`
  trips, `get_linehaul_for_driver` returns `consolidated_unit_count=0`,
  `origin_scan_complete=false`, `pulled_at=trip.updated_at` (no 404); the dispatcher
  manifest returns an empty `consignments` list. Trip list/detail responses expose
  `trip_type` so both frontends can label the trip.
- **Deferred with the domain answer** (see Radar): whether empty legs carry seals and
  whether the H2/H5 handshakes apply. Until then the driver app is not expected to run
  an empty-leg trip end-to-end.

### Component 2 — Organization mapping (`db/models/organisations.py` + migration)

- `Organization.pp_account_number: Mapped[Optional[str]] = mapped_column(String(6), nullable=True, unique=True)`
  (PP `accnum` is `string[6]` per the v28 spec).
- Migration: `backend/migrations/versions/2026_07_14_ciaran_add_org_pp_account_number.py`
  — generated only after `git fetch origin` and checking `dev` for unmerged migrations.
- Seed: set `pp_account_number` for the demo principal org(s) to match mock fixtures.

Resolution rule in consignment sync: look up `Organization` by the waybill's `accnum`.
Match → `client_organization_id` set. No match → consignment persists with
`client_organization_id = NULL` **and** a structured `logger.warning` + a
dispatcher-visible notice in the creation response (see Component 5). Never a hard fail —
an unmapped PP account is an admin gap, not a reason to block a trip.
**Schema prerequisite:** `Consignment.client_organization_id` becomes nullable (currently
`NOT NULL`) — same migration. This also fixes the latent crash on Tim's branch.

### Component 3 — Trip service (`orchestration/trip_service.py`)

`create_trip()` changes, in order of the existing flow:

1. Steps 1–5 (validate refs, conflict check, Trip/TripTrailer/TripStop rows) unchanged,
   except trailers may be empty.
2. **New step: consignment sync loop** (loaded trips only — empty legs skip it). For each
   `TripConsignmentInput`, call
   `fetch_and_sync_consignment(db, pp_reference=…, trip_id=…, origin/destination_precinct_id=…)`
   (Tim's service, extended: it resolves `client_organization_id` internally via the
   `accnum` mapping instead of taking it as a caller-supplied parameter, and now also
   stores `unit_count_expected` and `pp_manifest_number` from the waybill's `manifest`
   field). Any PP error → `PPSyncError` → 422; the whole transaction rolls back
   (fail-closed, atomic — no half-created trips).
3. H0 handshake, journey lock hash, canonical payload, `anchor_subject` — unchanged and
   fail-closed. The lock-hash empty-trailer `ValueError` is removed (`trailers: []` is a
   valid canonical value; sorting is a no-op). WP7 will extend the payload to cover the
   cargo plan — not this spec.
4. Response: `TripDetailResponse` gains `consignments: list[ConsignmentRead]` and
   `warnings: list[str]` (e.g. `"PP account 'ACC123' has no matching organization"`).

### Component 4 — Error mapping (`api/v1/endpoints/trips.py`)

- `PPSyncError` → 422 with the PP message (Tim's intent, wired for the list case).
- `HederaServiceError` → **503** `"Blockchain anchoring is unavailable — the trip was not
  created. Please retry."` — distinguishes an infrastructure outage from a code bug and
  makes fail-closed legible to the dispatcher.

### Component 5 — Dispatcher wizard (`dispatcher/app/(app)/trips/new/page.tsx`)

Three steps + review; **removed entirely: commodity, weight, receiver name/contact**
(PP supplies weight/receiver/commodity; receiver identity at delivery is the H5 OTP flow).

- **Step 1 — Order & Waybills.** Order number, an **"Empty leg (repositioning — no
  cargo)" toggle** that hides the waybill rows and sets `trip_type=empty_leg` (review step
  labels the trip accordingly), plus — when loaded — a repeatable waybill row:
  `[PP waybill reference] [expected unit/pallet count] [remove]` + "Add waybill".
  On reference blur, a **live validation call** (new thin endpoint
  `GET /api/v1/pp/waybills/{ref}` → dispatcher-shaped summary: waybill no, customer name,
  pieces, weight, dest town — *not* the raw PP payload) renders a confirmation chip:
  `WAY123 · FedEx · 14 parcels · 620 kg · Durban` or an inline "not found" error.
  This is the PP review's "wizard-time reference validation" recommendation.
  A **"Fetch by manifest number"** field sits above the rows, enabled only when the
  backend reports manifest lookup is available (mock mode — see Component 7): entering a
  manifest number populates one row per waybill automatically.
- **Step 2 — Crew & Vehicle.** Unchanged (driver/horse/trailer pickers, Pulsit snapshot,
  SA road-regs trailer combos) — 0 trailers now accepted end-to-end.
- **Step 3 — Route & Schedule.** Origin/destination precincts + planned times. Unchanged.
- **Review.** Existing review cards, plus a per-waybill card showing the PP-pulled summary
  (weight, receiver name/town, commodity lines, declared value) marked "from Parcel
  Perfect" — dispatcher-facing only. Submit posts `consignments[]`; no
  `client_organization_id` in the payload. 409/404/422/503 each get a distinct toast.

### Component 6 — PP mock: fixture library (`integrations/parcel_perfect.py`)

Replace the single `MOCK_WAYBILL_RESPONSE` with a **keyed fixture set** behind the same
`MockParcelPerfectClient` (interface unchanged — `get_pp_client()` stays the seam):

- `MOCK_WAYBILLS: dict[str, PPWaybillResponse]` — 6–8 fixtures built strictly from the
  v28 field spec (`getSingleWaybill.csv`), covering: single-parcel and multi-parcel
  waybills; multi-line `contents`; two different `accnum` values (one mapped to the demo
  principal org, one deliberately unmapped to exercise the warning path); a delivered
  waybill (`poddate` set); a failed delivery (`failtype` set); heavy vs light `actkg`;
  and **two manifest groups** — e.g. waybills `WAY001–WAY003` share `manifest=69`,
  `WAY004–WAY005` share `manifest=70`, others `manifest=None` (unmanifested).
- Unknown reference → raise the same "waybill not found" error shape as the real client,
  so the fail-closed 422 path is exercised in dev/CI exactly as it would be live.
- Fixtures live in the module (typed dataclasses, not JSON files) so they're
  refactor-safe and greppable; realistic SA data (Jhb/Durban towns, kg weights,
  R declared values), **no real personal data**.

### Component 7 — Aspirational manifest lookup (mock-only, honestly flagged)

The pitch to PP: "with one manifest number, the dispatcher keys a whole truck." PP v28
has **no** manifest endpoint (`manifest` is a bare integer on a waybill; you cannot
enumerate its waybills). We build the experience anyway, mock-only, to demo the delta:

- `MockParcelPerfectClient.get_waybills_by_manifest(manifest_number: int) -> list[PPWaybillResponse]`
  — filters `MOCK_WAYBILLS` by the `manifest` field.
- `ParcelPerfectClient` (real) implements the same method as
  `raise PPUnsupportedError("PP v28 exposes no manifest-contents endpoint — ask #1, July visit")`
  — the codebase never pretends the real API can do this.
- Capability discovery: `GET /api/v1/pp/capabilities` → `{"manifest_lookup": bool}`
  (true only in mock mode). The wizard's manifest field renders only when true, so
  flipping `PP_USE_MOCK=False` degrades the UI gracefully to waybill-by-waybill —
  which is exactly the live-PP story today.
- Demo script for the July 13–18 visit: same trip created twice — five waybill numbers
  typed one-by-one vs one manifest number. The side-by-side *is* the ask.

### Component 8 — Endpoints (`api/v1/endpoints/pp.py`, new)

Thin router (`tags=["parcel-perfect"]`), dispatcher-auth, all read-only:
- `GET /pp/waybills/{ref}` — validation summary (Component 5). Never returns raw
  `pp_raw_json`; response schema is a purpose-built `PPWaybillSummary`.
- `GET /pp/manifests/{manifest_number}` — list of `PPWaybillSummary` (404s with the
  unsupported message when the client raises `PPUnsupportedError`).
- `GET /pp/capabilities` — the flag above.
Layering: endpoints → orchestration (a small `pp_lookup_service`) → integrations. The
endpoints never import `parcel_perfect.py` directly.

## Data flow

```
Dispatcher wizard                Backend create_trip()                        PP (mock|real)
─────────────────                ─────────────────────                        ──────────────
type waybill ref ──GET /pp/waybills/{ref}──▶ pp_lookup_service ──▶ get_single_waybill()
  ◀── summary chip (customer, parcels, kg)
[or manifest no. ──GET /pp/manifests/{n}──▶ mock-only lookup ──▶ rows auto-filled]
enter unit counts, crew, route
submit consignments[] ──POST /trips──▶ validate refs, conflict check
                                       Trip + TripTrailer + TripStop rows
                                       per consignment: fetch_and_sync ──▶ getSingleWaybill
                                         accnum → Organization (warn if unmapped)
                                         Consignment + Parcel rows, unit_count_expected
                                       H0 handshake, journey lock hash
                                       anchor_subject (FAIL-CLOSED, 503 on outage)
  ◀── 201 TripDetailResponse (+consignments, +warnings)  |  422 PP  |  503 Hedera  |  409 dup
Driver app: GET linehaul ──▶ consolidated_unit_count = Σ unit_count_expected  ✓ (never 404s)
            weight/receiver/commodity NEVER in LinehaulResponse (theft-risk rule)
```

## Error handling

- **PP waybill not found / PP down at submit:** 422 via `PPSyncError`, transaction rolled
  back, no trip row. Wizard toast names the failing reference.
- **PP down at wizard-time validation:** inline non-blocking error on the row; dispatcher
  may still submit (submit-time sync is the enforcement point).
- **Unmapped PP account:** trip creates; `warnings[]` in the response; dispatcher toast +
  `logger.warning`. Fixing the mapping is an admin task, not a trip blocker.
- **Hedera outage:** 503, transaction rolled back, explicit "trip was not created" copy.
- **Duplicate active order_number:** 409 (unchanged).
- **0 trailers:** valid everywhere (schema, hash, wizard).
- **Consignments/trip_type mismatch:** `loaded` with 0 consignments or `empty_leg` with
  any consignments → 422 from the schema validator, before any DB work.

## Testing

- **Unit** (`tests/unit/`):
  - `test_trip_schemas.py`: consignments-vs-trip_type validation (both directions),
    duplicate pp_reference rejection, empty-trailer acceptance, removed-field absence
    (`client_organization_id`).
  - `test_hashing.py`: empty `trailer_ids` produces a stable hash; existing vectors unchanged.
  - `test_pp_mock.py`: fixture lookup, unknown-ref error parity with real client,
    `get_waybills_by_manifest` grouping, real client raising `PPUnsupportedError`.
  - `test_consignment_service.py` (extend Tim's): accnum→org resolution hit/miss,
    `unit_count_expected` + `pp_manifest_number` persisted.
- **Integration** (`tests/integration/`):
  - POST /trips with 2 consignments → trip + 2 Consignment rows + Parcel rows + H0 +
    receipt; linehaul for the trip's driver returns summed unit count (no 404).
  - POST /trips with unknown waybill → 422 and **no** trip/consignment rows (atomicity).
  - POST /trips with unmapped accnum → 201 + warning + NULL client org.
  - POST /trips with 0 trailers → 201, no TripTrailer rows, lock hash present.
  - POST /trips `empty_leg` → 201, no Consignment rows, no PP call made (mock client
    asserted untouched), linehaul returns 0 units (no 404), manifest returns empty list.
  - Hedera failure injected → 503 and no rows (fail-closed proof).
  - `GET /pp/waybills/{ref}` → 200 summary / 404; `GET /pp/manifests/69` → rows in mock
    mode; capabilities flag flips with `PP_USE_MOCK`.
  - Driver-visibility regression: linehaul response contains no weight/receiver/commodity keys.

## Coordination flags

- **Tim (`feature/gps-warehouse-geofencing`, unmerged):** `TripCreateRequest.pp_reference`
  → superseded by `consignments[]`; `fetch_and_sync_consignment` signature changes
  (drops caller-supplied `client_organization_id`, adds unit count + manifest capture);
  his `MockParcelPerfectClient` grows the fixture set. Agree the shape **before** either
  branch merges to `dev` to avoid a schema fight.
- **Chiko (WP7 / FP-113):** the empty-trailer relaxation touches shared
  `crypto/hashing.py`; land it as a tiny standalone change or fold it into WP7 — Chiko's
  call, but it must not wait behind WP7 (the wizard needs it).
- **Shared files touched:** `schemas/trips.py`, `crypto/hashing.py`,
  `db/models/organisations.py`, `db/models/trips.py` (nullable client org + `trip_type`),
  `db/models/enums.py` (`TripType`), one new router registration in `main.py`
  (**shared — flag in TASK COMPLETE**), two name-tagged Alembic migrations after
  checking `dev`.
- **Journey-lock payload change (`trip_type`)** joins the trailer relaxation in the WP7
  coordination with Chiko — both alter the canonical payload, so they should land as one
  hashing change, not two.
- **New `.env` keys:** none (PP keys exist on Tim's branch; mock is the default).
- **Docs to update after implementation:** technical full-picture (F2/F3 status),
  `api_contract_dispatcher_driver.md` (new PP endpoints, TripCreateRequest shape).

## Radar — deliberately deferred

0. **Empty-leg driver-app flow** — the domain questions first (Bruce/July visit): does a
   repositioning run carry a seal? Do H2 (loading) and H5 (unloading) exist for it, or
   does the sequence collapse to gate-in → gate-out → destination gate-in → close? Once
   answered, the driver app gets an empty-leg handshake sequence; until then dispatchers
   can create and track empty legs, but drivers shouldn't run them end-to-end.
0b. **Pulsit API mock** — wait for their API doc (July visit). The trip side is already
   structured: device IDs snapshot from vehicle rows at creation; `pulsit_geofence_confirmed`
   and `pulsit_trip_reference_id` columns exist as landing points. When the doc arrives,
   mirror the PP approach exactly: typed client + mock behind a `get_pulsit_client()`
   factory with a `PULSIT_USE_MOCK` flag.
1. **Manifest-number lookup against real PP** — blocked on PP granting the endpoint
   (ask #1, July 13–18 visit). The capability flag is the switch when it lands.
2. **WP7 journey lock v2** — cargo-plan (consignment snapshot hashes, ordered stops) into
   the anchored payload. This spec's `pp_raw_json` snapshots are its raw material.
3. **Multi-stop wizard UI** — backend already accepts `stops[]`; UI when a real
   multi-stop route is demo-relevant (FP-114 territory).
4. **Org-admin screen** for `pp_account_number` mapping — until then it's a seed/SQL task.
5. **PP polling refresh** (Tim's Celery task) re-syncing waybills mid-trip — interacts
   with WP2's manifest-snapshot-at-H2; reconcile in that plan, not here.
6. **Weight-based load validation** (GVM vs summed `actkg`) — nice dispatcher warning
   once PP weights are flowing; strictly display, never a block (evidence, not operations).
