# FreightProof SA — Technical Full Picture v1

> **Status:** architecture review + decision record — no code changed by this document.
> **Author:** Ciaran (with Claude as reviewing architect) · **Date:** 2026-07-06
> **Successor to:** `FreightProof_Full_Picture_v7.md` at the technical/architecture level. v7 remains
> the business-domain source of truth; where this document and v7 disagree on *what the code does*,
> this document wins (it was verified against source on 2026-07-06, branch `Ciaran`, HEAD `ee4cf32`).
> **Audience:** the 4-dev team, and future AI sessions on cheaper models executing work packages from
> §8 without a senior reviewer available. Decisions here are **decided**, not option lists — except
> the five questions in §0.4/§5.4 that genuinely belong to Bruce or the team.
>
> **Claim tags used throughout:**
> - **VERIFIED** — the author read the current source code in this session.
> - **REPORTED** — from docs, the graph, or a subagent sweep; not independently re-read.
> - **INFERRED** — a conclusion that follows from verified/reported facts but is not itself observed.
>
> **Test baseline (2026-07-06, `backend/.venv`, `python -m pytest -q`):**
> **124 passed, 100 skipped, 0 failed** in 0.32s. The 100 skips are the DB-backed integration suite:
> `tests/conftest.py:168` skips any test using `db_session` when `TEST_DATABASE_URL` is unset
> (REPORTED, mechanism confirmed by sweep). The same gate means **integration tests never run in CI**
> (no Postgres service in `.github/workflows/ci.yml`). The green baseline is therefore *unit-only*.

---

## 0. Executive summary (one page)

### 0.1 The five decisions that matter most

1. **Evidence hash scheme (fixes F4 — do this before anchoring anything else).** Every handshake
   H0–H5 gets a canonical `event_hash` covering: the SHA-256 `file_hash` of every attached artifact,
   GPS coordinates, timestamps, seal numbers, counts, and (H2/H5) the manifest-snapshot hash.
   High-volume records (checkpoints, exceptions, ad-hoc artifacts) are Merkle-batched per trip and
   the root anchored at trip close. `/verify` must recompute all of it from the DB. Today the
   anchored surface covers almost none of the evidence: only the journey lock and vehicle/driver
   critical-field events are anchored; H2/H5 hashes cover three fields and are never submitted to
   Hedera; photos are replaceable without detection (VERIFIED, §3). Full spec in §3.4.
2. **Reconciliation moves server-side; the driver submits only their visual count (fixes F1).**
   The PWA currently sends `pp_scan_in_count = driverVisualCount` — the "three-count reconciliation"
   compares the driver's number against itself (VERIFIED, `driver-pwa/lib/api/handshakes.ts:97-102`).
   Until PP data lands, the system leg comes from a mock manifest service and the evidence claim is
   documented as **two** independent legs, not three. §4 F1.
3. **Anchoring execution model.** Keep synchronous in-request anchoring (bounded by the existing
   15s timeout) through the August demo; for the production pilot, move anchoring to a Celery task
   with an outbox pattern and an `anchor_status` field on receipts. Celery is currently a zero-task
   scaffold — the worker container starts and does nothing (REPORTED, §6.3). §8 WP5.
4. **Demo-mode strategy.** The backend pattern is sound: `DEMO_MODE=False` default plus an
   import-time guard that refuses demo mode outside dev/test (VERIFIED, `auth/dependencies.py:305`).
   The driver PWA pattern is **not** sound: `IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'`
   is default-ON (VERIFIED, `driver-pwa/lib/constants/env.ts:4`), and several surfaces bypass the
   flag entirely and read mocks unconditionally (driver trips list/detail, dispatcher exceptions).
   Decision: flip the PWA default to opt-in (`=== 'true'`), then de-mock the unconditional surfaces.
   §6, §8 WP10.
5. **Per-stop handshake model is the confirmed target, deferred to iteration 3.** The 2026-07-02
   review's §7 design (coarse `TripStatus`, handshake ledger as state machine, per-stop types with
   seal segments, plan-driven driver app) is adopted as the target architecture. The pilot runs the
   degenerate two-stop path on the current H1–H5 machine. Iteration-2's only obligation is to add
   **no new** five-handshake hard-wiring. §2 D6, §4 F8.

### 0.2 The three biggest risks to production

1. **The evidence-integrity gap (§3).** FreightProof's entire value proposition is "the record is
   tamper-evident." Today that is true for the journey lock and fleet critical-field changes, and
   for nothing captured during the trip. If a pilot ran today and a dispute arose, the waybill
   photo, POD photo, seal photos, GPS trail, checkpoints, and exceptions would all be mutable
   without detection. WP1–WP6 close this; nothing else matters more.
2. **The PP visit (13–18 July) is single-shot.** ecomService v28 — the only PP surface we have docs
   for — has no manifest endpoint, no scan events, and no scan-in status (VERIFIED against
   `docs/parcel_perfect_documentation/`). If the visit does not secure the operational data listed
   in §5.4, the H2 polling loop and the H5 system reconciliation leg have **no data source, ever**,
   and the product claim must be permanently re-scoped. The agenda in §5 is written to be used as-is.
3. **Driver-PWA demo debt.** Demo-ON by default, mock-backed trip list/detail, an unsigned Android
   release build, no PWA coverage in CI, and no real-device end-to-end run of the full evidence
   path. The pilot's primary capture instrument does not yet exist in production form. §6, WP10/WP13.

### 0.3 What the PP visit must answer (see §5.4 for the full agenda)

1. Can FreightProof get **manifest contents by manifest number**, **scan-event history per waybill**
   (timestamps + facility), and **destination scan-in status** — via API, report export, or webhook?
2. Does LFG scan/identify each consolidated pallet, or only count units and seal the truck?
   (Decides whether a `HandlingUnit` entity exists — watch the FedEx consolidation floor.)
3. Confirm BQ2 operationally: will the destination cargo officer physically sign on the driver's
   device (touch-on-glass) in addition to the paper POD?

### 0.4 Decisions that belong to Bruce / the team (framed, with recommendations)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Pallet grain: `HandlingUnit` entity vs count+seal only | Default to **count+seal (no new entity)** unless the visit observes per-pallet scanning; the schema supports adding the leaf later without rework (`Consignment.unit_count_expected` already exists). |
| Q2 | PP access fallback if API is refused | Accept **scheduled report exports** (collection/delivery reports) as the system leg; do not build screen-scraping or write paths. |
| Q3 | Return-leg initiation | **Standalone new trip + nullable `return_of_trip_id` FK** (v7 §10's current direction). Keeps evidence chains uncoupled. |
| Q4 | APK distribution | **Sideloaded signed APK on company-issued devices** (MDM or manual). Play Store publication buys nothing for a closed fleet and costs review cycles. |
| Q5 | Pilot hosting + Hedera network budget | Managed Postgres/Supabase in af-south-1 + one small API host + Hedera **testnet for pilot** (receipts are still independently verifiable via mirror node), mainnet at commercial launch. Needs a cost sign-off, not a design change. |

---

## 1. System overview — as built (not as planned)

Everything in this section is VERIFIED unless tagged.

### 1.1 Component map

```
backend/app/
├── api/v1/endpoints/    trips, handshakes, manifest, artifacts, checkpoints,
│                        exceptions, drivers, vehicles, precincts, blockchain
├── auth/dependencies.py Supabase ES256/JWKS verification; dispatcher/driver/admin gates
├── orchestration/       trip, handshake, manifest, artifact, checkpoint, exception,
│                        driver, vehicle, resource, verification services
├── blockchain/          hedera.py (real SDK adapter), anchor_service.py,
│                        critical_fields.py, subject_visibility.py
├── crypto/hashing.py    journey lock hash + canonical trip payload
├── db/models/           trips (Trip, TripStop, Consignment, Parcel, TripTrailer,
│                        DriverSubstitution, TripTemplate), handshakes, transit
│                        (Checkpoint, TripException), blockchain (BlockchainReceipt,
│                        MerkleBatch, MerkleBatchLeaf), people, vehicles, events, sla
├── integrations/        supabase_admin.py ONLY — no pulse/parcel_perfect/idvs/
│                        twilio/sendgrid modules exist (drift vs CLAUDE.md)
├── storage/             supabase_storage.py (upload + server-side SHA-256 file_hash)
└── tasks/               Celery app with ZERO tasks defined

frontend/
├── dispatcher/          Next.js 15 dashboard; real API for trips/fleet; mock-backed
│                        exceptions; forensic mode behind admin_dispatcher
├── driver-pwa/          Next.js 15 static export + Capacitor Android; five-handshake
│                        capture flows; offline queue; IS_DEMO_MODE gating
└── shared/              types, mocks, constants, utilities via @shared/*
```

Layering (`endpoints → orchestration → integrations/blockchain/crypto → db`) is respected in the
files read this session; `trip_service.py` documents and follows it explicitly.

### 1.2 The five-handshake state machine as implemented

`TripStatus` (10 states) doubles as the sequencer: each `advance_hN` in
`orchestration/handshake_service.py` requires an exact `expected_status` and writes the next one.

| Step | Endpoint→service | Expected status → new status | Evidence written | Hash? | Anchored? |
|---|---|---|---|---|---|
| H0 Trip Creation | `create_trip` | — → `created` | Trip, TripTrailer (+Pulsit device snapshot), TripStop rows, H0 event | journey lock hash | **Yes** — `JOURNEY_LOCK` receipt, synchronous (~4–6s in-request) |
| H1 Origin Gate-In | `advance_h1` | `created` → `origin_gate_in` | gate photo id, phone GPS | none | no (feeder, by design) |
| H2 Loading | `advance_h2` | `origin_gate_in` → `loading` | waybill photo id, seal number+photo id, driver visual count | `{trip_id, seal_number, driver_visual_count}` only | **no** (deferred, module docstring) |
| H3 Origin Gate-Out | `advance_h3` | `loading` → `in_transit` | gate exit photo id; `guard_verified_seal` accepted then **discarded** | none | no |
| H4 Dest Gate-In | `advance_h4` | `in_transit` → `dest_gate_in`, or `exception_hold` on seal mismatch | gate photo id, seal-at-destination; CRITICAL `SEAL_MISMATCH` exception on mismatch | none | no |
| H5 Unloading | `advance_h5` | `dest_gate_in` → `closed` | POD photo + signature ids, driver visual count, `pp_scan_in_count`; WARNING count-mismatch exception (trip closes anyway) | `{trip_id, pp_scan_in_count, driver_visual_count}` only | **no** (deferred) |

Notes:
- `UNLOADING` and `ORIGIN_GATE_OUT` statuses exist in the enum but are never assigned — H5 jumps
  `dest_gate_in → closed`, H3 jumps `loading → in_transit`. Status names describe the last
  *completed* handshake, not the current phase (F11).
- `UNIQUE(trip_id, handshake_type)` permits exactly one of each handshake per trip
  (`db/models/handshakes.py:25`) — the single-leg shape, by design until iteration 3.
- No path exits `exception_hold`: `dispatcher_override_user_id/_note` columns exist on
  `HandshakeEvent` but no endpoint or service writes them (F7).
- No trip-cancellation endpoint exists (FP-117 unbuilt); `CANCELLED` is unreachable via the API.
- `get_active_trip_for_driver` uses `scalar_one_or_none()` — two active trips for one driver would
  raise `MultipleResultsFound` (500). Minor, new observation this review.

### 1.3 Journey lock and verification

- `crypto/hashing.py` — the lock covers: `trip_id`, `order_number`, `driver_id`, `horse_id`,
  sorted `trailer_ids`, `origin_precinct_id`, `destination_precinct_id`, `created_by_user_id`,
  `created_at`. **Not covered:** stops beyond the derived endpoints, consignments/cargo plan, PP
  snapshots, route, slot times, Pulsit trip ref, seal. FP-113 is the ticket; `trip_service.py:216`
  carries the honest comment "no real multi-stop trip should be anchored before that lands."
- **No consignments are created at trip creation** — `trip_service.py:173-177` states no code path
  creates `Consignment` rows during creation (no PP integration / consignment payload exists yet).
  Manifest/linehaul data exists only via seeds. The committed *cargo plan* is therefore entirely
  outside the tamper-evident record today.
- `/verify` (`orchestration/verification_service.py`) recomputes exactly three subject types —
  trip journey-lock, `VehicleEvent`, `DriverEvent` — compares against the stored receipt's
  `data_hash`, then confirms the hash on the Hedera mirror node. Handshake events, artifacts,
  checkpoints, and exceptions are **not verifiable**. Outcomes: `verified / db_mismatch /
  hedera_mismatch / no_receipt / error` (infrastructure failure deliberately distinct from tamper).
- Hedera adapter (`blockchain/hedera.py`) is a **real** hedera-sdk-py implementation
  (testnet/mainnet/previewnet, mirror-node verify); there is no stub mode. Anchoring runs inside
  the HTTP request bounded by `HEDERA_SUBMIT_TIMEOUT_SECONDS` (default 15s). With
  `HEDERA_TOPIC_ID` empty (the default) every anchor call fails at service construction.

### 1.4 Auth

- Dispatcher: Supabase email/password → ES256 JWT verified against JWKS (1h TTL cache with
  forced refresh on unknown `kid` — correct rotation handling), role from `app_metadata`
  (service-role-set, not user-editable), DB user lookup, active check. `require_admin_dispatcher`
  gates forensic surfaces and fleet mutations.
- Driver: Supabase phone OTP (`signInWithOtp` with `shouldCreateUser: false` so unprovisioned
  phones are refused — REPORTED from the approved spec), `app_metadata.role == "driver"`,
  `Driver` row lookup by JWT `sub`.
- `DEMO_MODE=True` short-circuits both dependencies to hardcoded stub identities
  (admin dispatcher `…0001` / driver `…0003`), guarded at import time against
  `ENVIRONMENT` outside `{development, test}`.

### 1.5 Frontends

- **Dispatcher:** real typed API client for trips/fleet/blockchain; forensic mode (receipt diff,
  journey-lock comparison, change humaniser) behind `admin_dispatcher`; receipts stripped from
  detail responses for non-admin dispatchers (REPORTED, commit `8cc00ef` + graph tests). The
  exceptions feature is entirely mock-backed (`lib/hooks/useExceptions.ts` returns
  `mockExceptions`; VERIFIED) — there is no exceptions list API call.
- **Driver PWA:** static export (`output: 'export'`) for the Capacitor APK, every page
  `"use client"`, Serwist service worker, URL-as-state handshake step navigation, generic capture
  components (`CameraCapture`, `SealInput`, `GpsCapture`, `SignaturePad`, `EvidenceReview`),
  offline queue in `localStorage` replaying on the `online` event. Real submission path uploads
  artifacts (server computes `file_hash`) then calls `completeHN`. Demo path
  (`submitHandshake`, `lib/api/handshakes.ts:25-28`) skips both and fabricates an event hash.
- **Drift note (graph/docs vs source):** CLAUDE.md's architecture section lists
  `integrations/pulse.py, parcel_perfect.py, idvs.py, twilio.py, sendgrid.py` — none exist.
  v7 §14.2 lists FP-113/FP-117 as in-progress — neither has landed. The graph (built 2026-07-02,
  pre-`ee4cf32`) predates the multi-consignment manifest fix; trust source for F2/F3 status.

---

## 2. Decision ledger

Format per entry: **Decision → why → where it lives → still sound?**

**D1. Stack: FastAPI + SQLAlchemy 2.0 async + Alembic + Pydantic v2; Next.js 15 App Router;
Supabase (auth, Postgres, storage); Hedera HCS; Celery+Redis.**
Why: team skills, honours-project velocity, POPIA-friendly region control, HCS is cheap
per-message anchoring. Lives: everywhere; pinned in CLAUDE.md. Still sound: **yes**, with one
caveat — Celery is unused scaffolding (§6.3); keep it only because WP5/WP6 need it. VERIFIED.

**D2. Evidence, not operations.** FreightProof records; Pulsit/PP/gate systems operate.
Why: scope defence + evidentiary independence. Lives: `docs/scope-boundaries.md` (FP-119),
enforced structurally by read-only integration policy (D11). Still sound: **yes** — it is the
survival boundary for a 4-person team. REPORTED (doc), consistent with all code read.

**D3. Five handshakes + H0, driver as the only hands-on user.** Why: matches Bruce's operational
reality; guards/warehouse staff get no accounts (zero-login adoption). Lives:
`handshake_service.py`, `HandshakeType` enum, PWA flows. Still sound: **yes** for the
depot-to-depot pilot; superseded by D6 for multi-stop. VERIFIED.

**D4. Journey lock hash anchored at creation, synchronously.** Why: the "birth certificate" —
commitment before execution; sync keeps the demo simple. Lives: `crypto/hashing.py`,
`trip_service.py:221-253`. Still sound: **partially** — the lock's *coverage* is too narrow
(no stops/cargo plan; FP-113) and sync anchoring can't survive production load (WP5). The
*concept* is sound and proven end-to-end. VERIFIED.

**D5. Hedera HCS, hash-only on-chain.** Why: POPIA — personal data never leaves the DB; a public
ledger gives independent verifiability without hosting obligations. Lives: `blockchain/hedera.py`
(regex-enforced: only 64-hex digests accepted). Still sound: **yes**. VERIFIED.

**D6. Per-stop handshake model (design-note Option A + review §7) as the multi-stop target.**
Why: multi-client/multi-stop is confirmed standard practice (Bruce 24 Jun); seal segments make
every leg independently provable; the current model is the degenerate 2-stop case. Lives:
`docs/design-notes/2026-06-24-multi-stop-handshakes.md`, review §7; `TripStop` +
consignment↔stop FKs already in schema. Still sound: **yes — adopted as the target**, iteration-3
execution. Iteration-2 rule: no new hard-wiring of the 5-shape. VERIFIED (schema) + REPORTED (docs).

**D7. TripStop / FP-112.** Trip → ordered `TripStop` rows; stops have no inherent role (role
derived from consignment pickup/delivery links); single-leg synthesises two stops — one code path.
Why: Option B (multi-leg/multi-client) confirmed 24 Jun. Lives: `db/models/trips.py:164`,
`trip_service.py:173-196`, migration `2026_06_24_ciaran_add_tripstop` + alignment migration.
Still sound: **yes**; landed and tested. VERIFIED.

**D8. Custody grain = consolidated unit (pallet) + seal, not parcel.** Why: LFG cannot see inside
sealed units (theft risk, Bruce 24 Jun); parcels are PP's world, correlated read-only. Lives:
`Consignment.unit_count_expected`, linehaul summing (`manifest_service.py:103-113`),
`docs/parcel-traceability.md`. Still sound: **yes**; pending only the Q1 HandlingUnit leaf
decision at the visit. VERIFIED.

**D9. Linehaul (driver) vs manifest (dispatcher) hard split.** Why: Bruce's hard line — cargo
contents knowledge = theft risk. Lives: `manifest_service.py` role-aware services; alignment plan
asserts driver responses contain no parcel-grain keys. Still sound: **yes**; the linehaul is
still missing seal number(s) and vehicle config/trailers (F2 residue, WP8). VERIFIED.

**D10. Multi-consignment manifest/linehaul (FP-112 alignment, `ee4cf32`).** Per-consignment
manifest grouping; linehaul sums unit counts with per-consignment legacy fallback; frozen
`LinehaulResponse` field names. Why: F2/F3. Still sound: **yes**. VERIFIED.

**D11. PP integration is read-only, PP-first for cargo, FreightProof-first for the trip; the
client omits write methods entirely.** Why: commercial framing of the three-party negotiation,
scope boundary, and evidentiary independence (an evidence system that can write to the system it
audits cannot claim independence). Lives: review §2; not yet code (no PP client exists). Still
sound: **yes — reaffirmed as a certifiable property**. REPORTED (design), VERIFIED (absence of
any PP write code — no PP code at all).

**D12. `admin_dispatcher` role gating (FP-115).** Forensic mode, fleet mutations, and blockchain
receipts on detail responses are admin-only; role carried in JWT `app_metadata`. Why: standard
dispatchers get the evidence trail, not the chain internals; mutation control. Lives:
`auth/dependencies.py:242`, endpoint gates, `AdminOnly`/`ForensicOnly` components. Still sound:
**yes**. VERIFIED (backend), REPORTED (UI).

**D13. Backend demo mode: default-off + environment guard.** Still sound: **yes** — this is the
correct pattern. VERIFIED.

**D14. Driver-PWA demo mode: `NEXT_PUBLIC_DEMO_MODE !== 'false'` (default-ON).** Why (at the
time): the real Supabase→AuthContext hydration hadn't landed and demos needed to work with zero
env setup. Lives: `driver-pwa/lib/constants/env.ts:4`, gates in `AuthContext`, `TripContext`,
`api/handshakes.ts`. Still sound: **no — reversed by this document.** Decision: flip to
opt-in (`=== 'true'`) as part of WP10; a production build must fail closed into real mode.
VERIFIED.

**D15. Static-export PWA + Capacitor APK; every driver page `"use client"`.** Why:
`output: 'export'` is required for the Capacitor Android build and is incompatible with Server
Components. Lives: `driver-pwa/next.config.ts`, `capacitor.config.ts`, CLAUDE.md exception.
Still sound: **yes** — the cost (no SSR) is irrelevant for an authenticated capture tool.
REPORTED (sweep), consistent with repo structure.

**D16. Offline queue in `localStorage`, replay on `online`, drop terminal 4xx.** Why: N3 dead
zones are the normal case; dropping 4xx prevents infinite retry loops. Lives:
`driver-pwa/lib/hooks/useOfflineQueue.ts`. Still sound: **partially** — the mechanism is right,
but dropping 4xx silently discards evidence, and the client-generated entry `id` is never sent,
so the server cannot deduplicate replays (F9). Fixed by WP4. Also note: queued evidence
(base64 photos) in `localStorage` will hit quota on multi-photo trips — move the payload store to
IndexedDB in WP4. VERIFIED (hook), INFERRED (quota risk).

**D17. Supabase Storage for artifacts with server-side SHA-256 `file_hash` at upload.** Why:
integrity anchor point per artifact; hash computed server-side so the client can't lie about it.
Lives: `storage/supabase_storage.py:32`, `artifact_service.py`. Still sound: **yes** — this is
the foundation WP1 builds on. VERIFIED.

**D18. Exception severity model:** seal mismatch at H4 = CRITICAL + `exception_hold`; count
mismatch at H5 = WARNING, trip still closes; driver panic/seal-broken = CRITICAL. Why: matches
v7 §5 ("exceptions don't block the trip" except seal-intact failure). Lives:
`handshake_service.py:171-186, 218-238`, `exception_service.py:15`. Still sound: **yes**, once
F7 gives `exception_hold` an exit. VERIFIED.

**D19. BQ2: proof of delivery = POD photo AND on-device signature (resolved 2026-06-29).**
Lives: `db/models/handshakes.py:68-74`, H5 flow. Still sound: **yes in code**; v7 §15.4 still
says the opposite (F10 — doc update owed), and the *operational* confirmation (cargo officer
touch-on-glass) belongs on the visit agenda. VERIFIED (code), REPORTED (doc conflict).

**D20. POPIA driver erasure = anonymisation in place** (wipe PII columns to `[erased]`, keep row
+ FKs, `erased_at/erased_by` audit, admin-only `POST /drivers/{id}/erase`, 409 on active trips or
double-erase). Why: hard delete would cascade-destroy trip evidence; anchored hashes stay valid
(one-way hash of PII is not personal data). Lives:
`docs/superpowers/specs/2026-06-25-driver-popia-erasure-design.md` — **approved, unimplemented**.
Still sound: **yes, with one addition this review found:** erasure must also cover
`driver_events.changed_fields` and `blockchain_receipts.payload_json`, which retain old
license-number values for anchored driver-event diffs (§7.4). REPORTED (spec) + INFERRED (gap).

**D21. No cargo at trip creation (current state, not a decision).** Consignment rows are only
seeded, never created by the wizard/API. This is a gap that FP-114 (wizard) + the consignment
payload close; recorded here so nobody mistakes it for intent. VERIFIED.

---

## 3. Evidence-integrity audit

This is the product's value proposition, so it gets the deepest treatment. Everything in 3.1–3.3
is VERIFIED against source this session.

### 3.1 What is actually anchored today

| Record | Hash exists? | Anchored to Hedera? | Recomputable by `/verify`? |
|---|---|---|---|
| Trip creation (journey lock) | yes — 9 identity/commitment fields | **yes** (`JOURNEY_LOCK` receipt, sync) | **yes** |
| Vehicle critical-field change | yes (event payload) | **yes** | **yes** |
| Driver critical-field change | yes (event payload) | **yes** | **yes** |
| H1 / H3 / H4 events | **no hash at all** | no | no |
| H2 event | `{trip_id, seal_number, driver_visual_count}` | **no** (deferred) | no |
| H5 event | `{trip_id, pp_scan_in_count, driver_visual_count}` | **no** (deferred) | no |
| Evidence artifacts (photos, signatures) | `file_hash` per artifact at upload | no | no |
| Checkpoints | no | no (`merkle_batch_id` forever null) | no |
| Exceptions | no | no (same) | no |
| Driver substitutions | no (`blockchain_receipt_id` column unused) | no | no |
| Manifest / cargo plan | nothing exists to hash (D21) | no | no |

### 3.2 Why this breaks the claim

The chain of custody argument in v7 §11 rests on the record being unalterable after the fact.
Consider the flagship dispute scenario — "the seal was intact and here is the photo":

1. The waybill/seal/POD photos live in Supabase Storage; their `file_hash` lives in the DB row.
   Nothing binds either to Hedera. A malicious admin (or compromised service key) replaces the
   object *and* updates `file_hash` — no detection is possible, because no anchored hash covers
   the artifact. F4's "photos replaceable without detection" is literal.
2. The H2/H5 `event_hash` covers three scalar fields. Even if it were anchored, GPS, timestamps,
   photos, and the manifest snapshot could all be rewritten while the anchored hash still matched.
3. H1/H3/H4 produce no hash. The gate-in/gate-out/arrival evidence — including the H4 seal-intact
   check that v7 calls the highest individual fraud signal — has zero integrity protection.
4. Checkpoints and exceptions — the in-transit trail a hijacking investigation needs — are plain
   mutable rows. The `MerkleBatch`/`MerkleBatchLeaf` models exist with no producer code.
5. The reconciliation "system leg" is the driver's own number (F1, §0.1-2), so even the *content*
   of the count evidence is single-source.

None of this is hidden — module docstrings state anchoring is deferred. But the review's ordering
rule stands and is adopted here: **fix the hash shape before wiring the anchor**, so no receipt
ever has to be re-explained to an insurer or court.

### 3.3 What already exists to build on

- Server-side SHA-256 per artifact at upload (`file_hash`) — the leaf hashes.
- A canonicaliser (`anchor_service.canonicalize_payload`) — sorted keys, compact JSON, the same
  convention as the journey lock. One convention everywhere; keep it.
- `HandshakeEvent.blockchain_receipt_id`, `Checkpoint.merkle_batch_id`,
  `TripException.merkle_batch_id`, `MerkleBatch(Leaf)` models and schemas — the persistence
  surface is pre-built; only producers and verification are missing.
- A real, working Hedera submit + mirror-node verify path, exercised end-to-end for H0.

### 3.4 Target coverage scheme — DECIDED

Four layers, from leaf to chain:

```
L1  Artifact hash        sha256(file bytes) — exists today (file_hash)
L2  Event hash           sha256(canonical per-handshake payload incl. all L1 hashes)
L3  Merkle batch         per-trip tree over checkpoint/exception/ad-hoc-artifact hashes
L4  HCS anchor           L2 anchored per anchored handshake; L3 root anchored at close
```

**L2 canonical event payload (per handshake type).** Common envelope:
`{v: 2, trip_id, handshake_type, sequence_number, completed_at, driver_id,
driver_phone_lat, driver_phone_lng}` plus per-type fields:

| Type | Additional canonical fields |
|---|---|
| H1 | `gate_photo_sha256` |
| H2 | `waybill_photo_sha256`, `seal_number`, `seal_photo_sha256`, `driver_visual_count`, `manifest_snapshot_sha256`, `unit_count_system` |
| H3 | `gate_exit_photo_sha256`, `guard_verified_seal`, `seal_number_at_exit` |
| H4 | `gate_entry_photo_sha256`, `seal_number_at_destination`, `seal_match` (bool) |
| H5 | `pod_photo_sha256`, `pod_signature_sha256`, `driver_visual_count`, `unit_count_system`, `origin_count`, `counts_match` (bool) |

Artifact fields carry the **artifact's `file_hash`**, not its UUID — binding content, not
reference. The `v: 2` version field is embedded in the payload (hash-versioning without a schema
migration; verify dispatches on it). GPS/timestamps are strings in fixed formats (ISO-8601 UTC;
coordinates as the DB's `Numeric(10,7)` string form) so recomputation is bit-exact.

**Anchoring policy.**
- H0: anchored at creation (unchanged).
- **H2 and H5: anchored individually at completion** (`PICKUP_RECEIPT` / `DELIVERY_RECEIPT`
  receipt types) — these are the two commitment/proof moments v7 defines; per-event anchoring
  gives them independent consensus timestamps.
- H1/H3/H4: get L2 hashes (stored on the event) but are **not individually anchored**; they are
  folded into the trip-close Merkle batch. Rationale: v7 designed them as feeders; per-event
  anchoring of five handshakes doubles fees for little evidentiary gain, while batch inclusion
  still makes them tamper-evident.
- **Trip close batch:** at H5 completion (or cancellation), build one Merkle tree over: H1/H3/H4
  event hashes, every checkpoint's canonical hash, every exception's canonical hash, every
  artifact `file_hash` not already inside an event payload. Anchor the root
  (`MERKLE_ROOT` receipt). Leaves persist in `MerkleBatchLeaf` with their proof path index.
  This replaces v7's "daily batch" — per-trip batching aligns the batch boundary with the
  evidence unit (the trip) and avoids a scheduler; long multi-day trips can add an interim daily
  batch later without redesign.

**What `/verify` must recompute (extends `verification_service.py`):**
1. Existing: journey lock, vehicle/driver events (unchanged).
2. `HANDSHAKE_EVENT` subject: rebuild the L2 payload from the DB (event row + linked artifacts'
   `file_hash` + manifest snapshot), hash, compare to the receipt (H2/H5) or to the stored
   Merkle leaf + recomputed root (H1/H3/H4).
3. `MERKLE_ROOT` subject: recompute every leaf hash from DB rows, rebuild the tree, compare root
   to the anchored hash — one mismatched checkpoint row flips the whole batch to `db_mismatch`,
   and the leaf list identifies *which* row.
4. **Deep mode (optional flag):** re-download artifact bytes from Storage and re-hash, catching
   object-store tampering that a DB-only check misses. Default off (slow); exposed in forensic
   mode only.

**Honesty boundary (write this into client-facing material):** anchoring proves the record was
not altered *after capture*. It does not prove the GPS wasn't spoofed or the count wasn't
mis-entered at capture time. That protection comes from multi-source independence (phone GPS vs
Pulsit trackers vs geofence; driver count vs PP scan-in), which is currently degraded to
single-source until Pulsit and PP integrations land. Two different guarantees; never conflate
them in a demo or sales deck.

### 3.5 Sequencing rule

WP1 (hash shape) → WP2 (server reconciliation feeds `unit_count_system`) → WP5 (anchor H2/H5) →
WP6 (Merkle batch + verify extension). FP-113 (journey lock v2) is independent and can run in
parallel. Do not wire any new anchor before its payload spec in 3.4 is implemented.

---

## 4. F1–F11 disposition

Statuses verified against source at `ee4cf32` this session. Effort: S ≤ ½ day, M ≤ 2 days,
L ≤ 5 days, per developer familiar with the codebase.

| F | Finding (2026-07-02) | Status 2026-07-06 | Decided resolution | Effort |
|---|---|---|---|---|
| F1 | Driver types PP scan-in count at H5 | **OPEN, mutated** — VERIFIED: the PWA no longer asks the driver; it silently sends `driverVisualCount` as `pp_scan_in_count` (`handshakes.ts:97-102`). No manifest leak anymore, but reconciliation is self-referential. | WP2: drop `pp_scan_in_count` from `H5CompleteRequest`; server fetches `unit_count_system` from the manifest service (mock now, PP later); reconciliation + exception creation stay server-side; PWA "Reconciliation" step becomes await/result. | M |
| F2 | Linehaul = parcel count, not units; missing seals + vehicle config | **PARTIALLY FIXED** — VERIFIED: unit grain fixed in `ee4cf32` (sums `unit_count_expected`, per-consignment fallback). Seal number(s) and vehicle configuration/trailers still absent from `LinehaulResponse`. | WP8: add `seal_numbers` (from H2 event(s)) + `trailers`/vehicle-config to `LinehaulResponse`; linehaul re-renders after seal capture. Additive fields only (response shape is frozen additively per alignment plan). | S–M |
| F3 | Manifest/linehaul assume one consignment (500 on two) | **FIXED** — VERIFIED: `_load_consignments_and_parcels` loads all; per-consignment grouping; integration tests extended (`test_manifest.py`). | none — done | — |
| F4 | Anchored event hash covers almost no evidence | **OPEN** — VERIFIED (§3.1). Worse than stated: H1/H3/H4 have no hash at all; H2/H5 hashes exist but are never anchored. | WP1 + WP5 + WP6 per §3.4. | L (split across WPs) |
| F5 | H3 `guard_verified_seal` accepted then discarded | **OPEN** — VERIFIED: field in schema (`schemas/handshakes.py:133`), `advance_h3` never persists it. | WP1: persist it (plus `seal_number_at_exit`, new optional field) on the H3 event and include in the L2 hash. Do not drop the field — v7 says the guard verifies seal at gate-out. | S |
| F6 | `parcel_manifest_snapshot` / `parcel_count_origin` never populated | **OPEN** — VERIFIED: columns exist, no writer. | WP2: H2 persists the manifest snapshot (mock-shaped `getSingleWaybill` envelope per consignment) + system origin count; snapshot hash enters the H2 L2 payload. | M |
| F7 | `EXCEPTION_HOLD` is a one-way door | **OPEN** — VERIFIED: no code writes `dispatcher_override_*`; no status transition out of hold. | WP3: `POST /trips/{id}/handshakes/{type}/override` (admin_dispatcher) writes override user+note on the event, restores the pre-hold status (H4 hold → `dest_gate_in`), records a dispatcher-source exception resolution. | M |
| F8 | Five-handshake shape hard-wired at 4 layers | **OPEN by design** — VERIFIED (expected-status chaining, unique constraint, enum-index sequence, fixed frontend records). | Accepted for iteration 2 (D6). Iteration-3 ticket implements review §7 (coarse status, per-stop types, `trip_stop_id` on events, plan-driven PWA). Guard-rail: no new code may branch on `TripStatus` fine states or `HandshakeNumber` literals — reviewers enforce. | L (iter-3) |
| F9 | Offline replays collide with strict sequencing | **OPEN, mutated** — VERIFIED: queue now drops any 4xx as "terminal" (`useOfflineQueue.ts:79-86`) — no more error loops, but silent evidence loss; entry `id` still not sent to the server. | WP4: send `Idempotency-Key: <entry.id>`; server returns 200 + current state for an already-completed handshake with the same key; queue only drops on explicit server "duplicate" acknowledgement, surfaces other 4xx to the driver instead of silently discarding; move payload storage to IndexedDB. | M |
| F10 | BQ2 resolution contradicts v7 | **OPEN (docs)** — VERIFIED code comment vs v7 §15.4. | Update v7 (or supersede via this doc §2 D19); confirm cargo-officer touch-on-glass at the July visit. | S |
| F11 | Status-name semantics; parcel-named unit fields | **OPEN** — VERIFIED (`LOADING` after loading finished; `parcel_count_*` columns are unit-grain). | Fold into the iter-3 per-stop migration (rename columns to `unit_count_*`, coarse statuses). No standalone work now; add a glossary note wherever the fields are read. | S (with iter-3) |

New findings from this review (not in F1–F11): the F1 mutation above; `get_active_trip_for_driver`
multi-trip 500 (§1.2); erasure gap on event payloads (§7.4); localStorage quota risk (D16);
dispatcher exceptions feature mock-only (§6.2).

---

## 5. Parcel Perfect integration

### 5.1 Ground truth: ecomService v28 vs what FreightProof needs

REPORTED from `docs/parcel_perfect_documentation/` + the 2026-07-02 review (which read the CSVs
and Postman collection directly); consistent with everything verified in code this session.

- v28 is an **ecommerce quote/collection API**: auth (`getSalt` → `md5(password+salt)` →
  `getSecureToken`, tokens never expire), places/deftitems lookups, quote→waybill→collection
  writes, and **one read that matters to us: `getSingleWaybill`** (details + contents lines +
  per-parcel `tracks` + references).
- It has **no manifest endpoint** (`manifest` is just an integer "last manifest number" on a
  waybill), **no scan events**, **no scan-in/out status**, no webhooks, no branch topology, no
  read-only credential concept. The v7 §8.1 polling loop and the H5 system leg cannot be built on
  it.
- Wire shape: single `POST {base}/ecomService/v28/Json/`, form-urlencoded
  `method`/`class`/`params`(JSON *string*)/`token_id`; `errorcode/errormessage/results[]`
  envelope; `dd.mm.yyyy` dates; CSV type columns unreliable — parse defensively.

### 5.2 Target integration architecture — DECIDED

1. **`integrations/parcel_perfect.py` built mock-first, now, with the real wire shape** (single
   POST, params-as-JSON-string, cached non-expiring token per account, the review §5 Pydantic
   models `PPEnvelope`/`PPWaybillDetails`/etc.). Canned envelopes behind the same client class;
   live cutover = config change. Only Auth + read methods implemented — **write methods omitted
   entirely**, not implemented-and-guarded (D11).
2. **Credential registry, not singletons:** `PP_ACCOUNTS` as a list of named credential sets
   (client org + branch + base URL) in `core/config.py` — origin and destination may be separate
   PP instances; FedEx/Courier Guy/Seaborne each have their own accounts. The existing
   `PP_API_KEY`/`PP_API_URL`/`PP_USE_MOCK` singleton keys are replaced (they are dead config today
   — `*_USE_MOCK` is referenced nowhere; VERIFIED via sweep grep).
3. **Poll discipline:** Celery task polls only inside active stop windows (gate-in received,
   handshake incomplete), `PP_POLL_INTERVAL_SECONDS` (exists, default 60), backoff on
   `errorcode != 0`. Never poll all trips continuously.
4. **PP is corroboration, never source of truth:** waybill snapshots at trip creation (into
   `pp_raw_json` + journey lock via FP-113) and again at load/unload custody transitions; drift
   between snapshots is a *recorded observation*, never a silent update.
5. **Value to extract from `getSingleWaybill` immediately** (even before negotiation): declared
   value → value-at-risk per trip; dest lat/lng → wizard-time stop-coordinate cross-check;
   actkg/chargemass → declared weight vs vehicle max; `failtype` → delivery-exception
   corroboration; wizard-time reference validation (typos die before the journey lock).

### 5.3 Field mapping (PP → FreightProof)

| PP field (`getSingleWaybill`) | FreightProof target | Notes |
|---|---|---|
| `waybill` | `Consignment.parcel_perfect_reference` | already ≤100 chars, fits |
| `manifest` (int) | `Consignment.pp_manifest_number` | column exists (VERIFIED) |
| `pieces` | `Consignment.parcel_count_expected` | parcel grain, dispatcher-only |
| — (dispatcher-entered) | `Consignment.unit_count_expected` | PP cannot supply pallet grain |
| `declaredvalue` | `Consignment.declared_value` | Numeric(15,2) exists |
| `duedate`/`duetime` | `Consignment.slot_time_destination` | corroboration, not authority |
| `destlatitude`/`destlongitude` | wizard cross-check vs `TripStop.precinct` coords | not persisted as authority |
| `tracks[].trackno` | `Parcel.barcode` | reference data, dispatcher-only |
| `contents[].description` (via `item` link) | `Parcel.description` | |
| full envelope | `Consignment.pp_raw_json` (+ hash into journey lock, FP-113) | |
| `failtype` | exception corroboration on unload | |

### 5.4 The visit agenda (13–18 July) — use directly

This is one week away and cannot be redone. Assign an owner per item; capture written/photo
evidence for everything.

**A. The negotiation asks (the deliverable Bruce requested 24 Jun) — priority order, all
read-only, all keyed by references FedEx already shares with LFG:**
1. Manifest contents by manifest number (waybill list + piece/unit counts).
2. Scan-event history per waybill/tracking number, with timestamp + facility.
3. Destination scan-in status per waybill.
4. Slot/booking windows if they exist server-side.
5. Fallback if 1–3 are refused: scheduled exports of PP's collection/delivery reports, or
   webhooks. Framing: *FreightProof never writes, never competes, and makes PP's data legally
   load-bearing for PP's own customers.*

**B. Questions that decide the data model (watch the floor, don't just ask):**
1. Does LFG scan/identify each consolidated pallet, or only count units + seal the truck?
   → decides `HandlingUnit` (Q1). Observe the FedEx consolidation + LFG handover directly.
2. Does any PP surface visible to FedEx staff show intermediate scan events with
   location/facility — i.e. does the data exist even if v28 doesn't expose it?
3. What exactly is on the printed linehaul the driver carries today? Photograph a real
   (redacted) one — it is the ground truth for `LinehaulResponse` completeness (WP8).
4. What does the physical vehicle waybill and master POD look like; will the destination cargo
   officer sign on the driver's device (BQ2 operational confirmation)?
5. Manifest numbering in practice: branch prefix + sequence (v7's "Manifest 69") — how does it
   appear in PP data, and is it per-branch-instance?

**C. Data-contract asks (concrete artifacts to bring home):**
1. A sample manifest document/export and a sample collection/delivery report (redacted is fine)
   — these define the mock shapes for iteration 2 honesty.
2. One real `getSingleWaybill` response for a live waybill (or a screenshot of equivalent data)
   — validates the review §5 Pydantic models against reality, not just CSVs.
3. Who is the PP technical contact, and which PP environment/branch instances serve FedEx JHB vs
   DBN (separate credentials? separate base URLs?).
4. The exact identifier chain FedEx quotes to LFG on an order (order number → consignment/waybill
   → manifest) — this is the join key architecture for the whole integration.
5. Slot-time reality: where do the "truck at FedEx by 12:00" commitments live (SLA annexure vs PP
   `duedate`)?

**D. Non-PP items to close while on site:** night-shift loading order/priority in practice
(validates `load_priority` semantics); seal application/verification points and who physically
checks at gate-out (F5 evidence value); whether trailers are ever pre-staged inside the precinct
(v7 H1 variant); Pulsit tracker IDs on horse + both trailers (device-ID mapping reality).

**Logistics prerequisites (Bruce, 24 Jun):** ID documents for all attendees in advance; UCT letter
confirming the project and FedEx as case study (Ciaran). REPORTED.

---

## 6. Demo-to-production gap analysis

Sources: subagent sweep (REPORTED) with the highest-impact items re-verified this session
(marked VERIFIED). Risk levels: **P0** = pilot cannot run / evidence claim false;
**P1** = pilot degraded or fragile; **P2** = hygiene.

### 6.1 P0 — blockers

| Gap | Detail | Fix |
|---|---|---|
| Evidence not anchored (§3) | H1–H5, artifacts, checkpoints, exceptions unprotected | WP1–WP6 |
| Driver PWA demo-ON by default | `env.ts:4` `!== 'false'` (VERIFIED); demo path skips upload + completion entirely (`handshakes.ts:25-28`, VERIFIED); code comment says real Supabase→AuthContext hydration still pending | WP10 |
| Driver trips list + active-trip detail read `mockTrips` unconditionally | `trips/page.tsx:55`, `ActiveTripPageClient.tsx:21` (VERIFIED — literal TODO in code) | WP10 |
| Dispatcher exceptions feature is mock-only | `useExceptions.ts` returns `mockExceptions`; no list endpoint is called (VERIFIED). Exceptions are the dispatcher's core investigation surface. | WP11a (backend GET /exceptions list + wire UI) |
| `HEDERA_TOPIC_ID` empty default; network=testnet | All anchoring fails until a topic is provisioned; mainnet decision pending (Q5) | WP13 env runbook |
| Android release build unsigned | No `signingConfig`/keystore in `android/app/build.gradle` release type (REPORTED) | WP13 |
| Integrations don't exist | No IDVS, Pulsit, PP, Twilio, SendGrid code at all; `*_USE_MOCK` flags are dead config (VERIFIED for directory contents; sweep for grep) | WP9 (PP), rest post-pilot; IDVS check currently records `PENDING` forever |

### 6.2 P1 — degraded/fragile

| Gap | Detail | Fix |
|---|---|---|
| Sync Hedera anchoring in-request | ~4–6s p50, 15s timeout; one Hedera outage blocks trip creation | WP5 outbox |
| Celery worker idle | compose starts `celery -A app.tasks worker` with zero tasks (REPORTED) | WP5/WP6 give it work; else drop the service |
| Integration tests never run in CI | `TEST_DATABASE_URL` gate + no Postgres service; 100 tests skipped locally and in CI (VERIFIED baseline + REPORTED mechanism) | WP13 CI Postgres |
| driver-pwa absent from CI | lint/tsc/test run for dispatcher only (REPORTED) | WP13 |
| Offline queue drops 4xx silently; no idempotency; localStorage quota | F9 (VERIFIED) | WP4 |
| Dispatcher dashboard/exception pages enrich from `mockTrips` | mixed real/mock rendering (REPORTED) | WP10/WP11a |
| No prod Dockerfiles / no CD | dispatcher has `Dockerfile.dev` only; no deploy pipeline (REPORTED) | WP13 |
| `ENVIRONMENT`/`ALLOWED_ORIGINS` default dev/localhost | must be overridden in prod (REPORTED) | WP13 runbook |
| EXCEPTION_HOLD unrecoverable | F7 (VERIFIED) | WP3 |
| No trip cancellation | FP-117 unbuilt (VERIFIED) | WP11b |

### 6.3 P2 — hygiene

- Dead config: `AWS_*`/`S3_BUCKET_NAME` (storage is Supabase; `s3_key`/`s3_bucket` column names
  are legacy), `IDVS_/PULSE_/PP_USE_MOCK` flags referenced nowhere. Remove or wire in WP9/WP13.
- Dev pages: dispatcher `/dev/tokens` uses `NEXT_PUBLIC_DEV_EMAIL/PASSWORD` (client-bundled!)
  behind a `NODE_ENV === 'production' → notFound()` guard; driver `/dev/tokens` NODE_ENV-guarded;
  dispatcher `/dev/design` guard unconfirmed. Rule for WP13: dev env vars never set in prod
  builds; confirm every `/dev/*` route 404s in a production build. (REPORTED)
- `datetime.utcnow()` deprecation warnings from `python-jose` (test output) — dependency-level,
  monitor only.
- CLAUDE.md architecture list names integration modules that don't exist (drift; update with this
  document).

### 6.4 Deployment target (state the obvious once)

Nothing is deployed. Production pilot needs: managed Postgres (Supabase, af-south-1 — **verify
the project region**, §7.5), API host (single container), Redis + one Celery worker, dispatcher
Next.js host, driver APK distribution (Q4), Hedera account + topic per environment, Supabase
storage bucket `evidence-artifacts` with service-role key handled server-side only. INFERRED
scope from verified components; sized in WP13.

---

## 7. Security & POPIA

### 7.1 Cross-org isolation / IDOR surface

- Blockchain subjects: `assert_subject_visible` scopes trip/vehicle/driver/vehicle-event/
  driver-event lookups by organisation and raises → 404 (no existence leak). VERIFIED.
- Driver-facing services enforce trip ownership uniformly: artifact upload, checkpoint,
  exception, handshake load all check `trip.driver_id == caller` (VERIFIED in the four services);
  linehaul returns 404 (not 403) for someone else's trip so existence is not confirmed
  (VERIFIED, `manifest_service.py:89-94`). Integration tests cover the handshake-detail IDOR and
  cross-driver linehaul cases (REPORTED, graph).
- Dispatcher queries scope by `operator_organization_id` (trip detail, manifest — VERIFIED);
  precinct listing excludes other orgs' non-shared precincts (REPORTED, tests).
- Residual surface to re-check when built: the exceptions list endpoint (WP11a) and any future
  artifact-download endpoint must repeat the org/driver scoping; the `/verify` endpoint takes
  arbitrary subject UUIDs — it goes through `assert_subject_visible`, keep it that way
  (REPORTED wiring, VERIFIED helper).

### 7.2 Auth hardening status

JWKS: 1h TTL cache + forced refresh on unknown `kid` (rotation-safe); ES256 only; audience
pinned; roles read from `app_metadata` only (service-role-set). Demo bypass guarded at import
time. VERIFIED. Driver OTP provisioning uses `shouldCreateUser: false` so unknown phones can't
mint accounts (REPORTED, approved spec). The Supabase `service_role` key is used server-side
only (`supabase_admin.py`, storage) — per project rule it must never reach frontend config.

### 7.3 PII inventory

| Store | PII | Notes |
|---|---|---|
| Postgres `drivers` | full name, SA ID number, phone, licence number/expiry | primary PII store |
| Postgres `users` | email, full name | dispatchers |
| Handshake/checkpoint rows | GPS coordinates (driver phone), timestamps | location data = personal info under POPIA |
| Supabase Storage `evidence-artifacts` | photos (faces on selfies/gate photos), signatures | keyed by trip; service-role access only |
| `driver_events.changed_fields` + `blockchain_receipts.payload_json` | **old/new licence numbers and similar critical-field values** | see 7.4 |
| Hedera HCS | **none** — only 64-hex SHA-256 digests; enforced by regex in `hedera.py:227-233` (VERIFIED); `test_create_driver_does_not_anchor_pii` exists (REPORTED) | |

Confirmation: **no personal data reaches Hedera.** The submit path physically cannot send
anything but a 64-char hex digest. VERIFIED.

### 7.4 Driver erasure — approved design + one gap found by this review

The approved design (D20) wipes the `Driver` row's PII columns in place. **Gap (INFERRED from
verified schema):** anchored `DriverEvent` diffs store field values (e.g. licence number
from→to) in `driver_events.changed_fields`, duplicated into `blockchain_receipts.payload_json`.
An erased driver's licence number would survive there. Resolution decided: WP12 extends erasure
to redact those JSON values (replace with `[erased]`) — which flips those receipts' `/verify` to
`db_mismatch` by design. That is the honest outcome: record on the erasure audit row that N
receipts were invalidated by a data-subject request, and surface that explanation in forensic
mode. (The alternative — keeping PII to preserve verifiability — is not POPIA-defensible.)

### 7.5 Data residency

Intent: all personal data in `af-south-1` (v7, CLAUDE.md). Reality check: `AWS_REGION` defaults
to af-south-1 but AWS is unused; actual residency = the **Supabase project's region** (DB +
storage) — REPORTED default config, region **unverified**. Action in WP13: confirm the Supabase
project is hosted in af-south-1 (Cape Town) or migrate before any real driver data is captured.
Hedera nodes are global, but only hashes leave the country (7.3).

### 7.6 POPIA capture basis

Company-issued Android devices + SIMs are the legal basis for GPS/selfie monitoring (v7 §3.1;
REPORTED). Pilot prerequisite (non-code): signed driver consent/notice pack aligned to the
National Transport Act + POPIA — FP-122 legal review covers this; keep it on the pilot checklist.

---

## 8. Roadmap — dependency-ordered work packages

Written as self-contained handoffs for a cheaper model. Global rules for every WP:
read `CLAUDE.md` first and follow it (PLAN block, layering, no git writes, TASK COMPLETE
report); tests per the testing section (unit + integration, `cd backend && pytest` green —
integration tests need `TEST_DATABASE_URL` pointing at a throwaway Postgres); never touch
`crypto/hashing.py`, `core/config.py`, `db/models/__init__.py`, or `main.py` unless the WP
explicitly lists them; anything not listed under "Files in scope" is out of scope.

**Dependency graph:**

```
WP1 ──► WP2 ──► WP5 ──► WP6
WP1 ──► WP3        WP7 (parallel, Chiko)   WP9 (parallel)
WP4 (parallel)     WP8 after WP2           WP10 after WP4
WP11a/b, WP12, WP13 independent            WP14/WP15 post-pilot
```

---

**WP1 — Canonical event hashes for all handshakes (F4 core, F5)** · Size M–L
*Objective:* every H1–H5 completion computes and stores an L2 `event_hash` per §3.4 (versioned
payload `v:2`; artifact `file_hash` values, GPS, timestamps, seals, counts; H3 persists
`guard_verified_seal` + new optional `seal_number_at_exit`).
*Files in scope:* `backend/app/orchestration/handshake_service.py`,
`backend/app/schemas/handshakes.py` (H3 field addition only),
`backend/app/db/models/handshakes.py` + one Alembic migration (new nullable column
`seal_number_at_exit`; name it `2026_MM_DD_<dev>_add_h3_seal_exit.py`),
`backend/tests/unit/test_handshake_service.py`, `backend/tests/integration/test_handshakes.py`.
*Out of scope:* anchoring (WP5), Merkle (WP6), manifest snapshot content (WP2 — hash the field if
present, else omit key), frontend.
*Tests:* unit — payload canonicalisation is deterministic and includes every §3.4 field for each
type; changing any single evidence field changes the hash; version key present. Integration —
each `complete_hN` persists a 64-hex `event_hash`; H3 persists the guard-seal fields.
*Done:* all five advance functions store hashes; H2/H5 hash shape matches §3.4 exactly; pytest
green.

**WP2 — Server-side reconciliation + manifest snapshot at H2 (F1, F6)** · Size M
*Objective:* remove `pp_scan_in_count` from `H5CompleteRequest`; H5 fetches `unit_count_system`
server-side from `manifest_service` (sum of `unit_count_expected` with the existing fallback);
H2 persists `parcel_manifest_snapshot` (per-consignment envelope-shaped JSON) +
`parcel_count_origin` (system unit count); reconciliation compares origin system count, H5 system
count, and driver visual counts; exception text names the sources.
*Files in scope:* `orchestration/handshake_service.py`, `orchestration/manifest_service.py`
(add an internal snapshot/count helper), `schemas/handshakes.py`,
`frontend/driver-pwa/lib/api/handshakes.ts` + the H5 reconciliation step component (remove the
fabricated `pp_scan_in_count`; the step becomes an await/result screen),
`backend/tests/{unit,integration}` for handshakes + manifest, PWA vitest for the changed step.
*Out of scope:* real PP calls (WP9), custody ledger (WP15).
*Tests:* H5 request without the field validates; reconciliation mismatch creates the WARNING
exception with three distinct sources; H2 snapshot persisted and its sha256 appears in the H2
event hash (integration with WP1).
*Done:* the driver cannot supply the system count anywhere; snapshots populate; pytest + PWA
tests green.

**WP3 — EXCEPTION_HOLD override endpoint (F7)** · Size M
*Objective:* `POST /api/v1/trips/{trip_id}/handshakes/{handshake_type}/override`
(admin_dispatcher only): writes `dispatcher_override_user_id` + required `note` on the event,
marks the linked exception resolved (`resolved_by/at/note`), restores trip status to the value
the failed handshake would have produced (H4 → `dest_gate_in`), and sets the handshake event
status to `OVERRIDDEN` (add enum value).
*Files in scope:* `api/v1/endpoints/handshakes.py`, `orchestration/handshake_service.py`,
`db/models/enums.py` (HandshakeStatus.OVERRIDDEN), `schemas/handshakes.py`, integration tests.
No migration (columns exist; enum stored as String).
*Out of scope:* dispatcher UI (follow-up ticket), generic pause/resume.
*Tests:* 403 for non-admin; 409 if trip not in `exception_hold`; happy path lands trip in
`dest_gate_in` with override fields set and H5 then completable; audit fields asserted.
*Done:* a seal-mismatch trip can be overridden and closed end-to-end in an integration test.

**WP4 — Idempotent handshake completion + offline queue hardening (F9)** · Size M
*Objective:* PWA sends `Idempotency-Key: <queue entry id>` on handshake completion; backend
stores the key on the `HandshakeEvent` (new nullable column + migration) and returns 200 with
current trip state when the same key re-arrives on a completed handshake; queue stops dropping
non-duplicate 4xx silently (keep entry, surface a visible "needs attention" state); queue payload
storage moves to IndexedDB (photos exceed localStorage quotas).
*Files in scope:* `api/v1/endpoints/handshakes.py`, `orchestration/handshake_service.py`,
`db/models/handshakes.py` + migration, `driver-pwa/lib/hooks/useOfflineQueue.ts`,
`driver-pwa/lib/api/{client,handshakes}.ts`, tests both sides.
*Out of scope:* artifact-upload dedup (uploads are additive; acceptable duplicates), exception
replays (already tolerant).
*Tests:* backend — same key twice → single event, 200 both times; different key on completed
handshake → sequence error unchanged. PWA — flush retries 5xx, holds non-duplicate 4xx visibly,
drops acknowledged duplicates.
*Done:* double-tap/replay after timeout produces one event and no driver-facing error.

**WP5 — Anchor H2/H5 + async outbox (F4 anchor leg)** · Size M–L · *After WP1+WP2.*
*Objective:* on H2/H5 completion create `PICKUP_RECEIPT`/`DELIVERY_RECEIPT` receipts via
`anchor_subject` with the L2 payload; execution via a Celery task (`app/tasks/anchoring.py`)
with an outbox: receipt row created `anchor_status='pending'` in the completion transaction,
task submits to Hedera and fills tx fields / `confirmed`; retry with backoff; `failed` after N
attempts surfaces on the dispatcher timeline. Trip creation (H0) migrates to the same path with
a `--sync` demo fallback flag.
*Files in scope:* `blockchain/anchor_service.py`, new `tasks/anchoring.py`, `tasks/__init__.py`,
`db/models/blockchain.py` + migration (`anchor_status`), `orchestration/{handshake,trip}_service.py`,
`schemas/blockchain.py`, tests (mock HederaService; no live network in tests).
*Out of scope:* Merkle (WP6), mainnet decision (Q5), dispatcher UI beyond status field exposure.
*Tests:* completion transaction commits even when Hedera is down (receipt pending); task retry
transitions pending→confirmed with mocked receipt; H0 sync fallback still passes existing
integration tests.
*Done:* H2/H5 receipts appear with consensus timestamps against a test topic; API p95 for
completion no longer includes Hedera latency.

**WP6 — Per-trip Merkle batching + /verify extension (F4 verify leg, FP-63)** · Size L ·
*After WP5.*
*Objective:* at H5 completion (and cancellation), build the trip's Merkle tree per §3.4 (leaves:
H1/H3/H4 event hashes, checkpoint canonical hashes, exception canonical hashes, unattached
artifact `file_hash`es); persist `MerkleBatch` + ordered `MerkleBatchLeaf` rows; anchor the root;
extend `verification_service.py` with `HANDSHAKE_EVENT` and `MERKLE_ROOT` subjects per §3.4's
recompute rules, plus the optional deep artifact re-hash mode; expose via the existing
`/blockchain/verify` endpoint (subject_type addition) with `assert_subject_visible` coverage.
*Files in scope:* new `blockchain/merkle.py` (pure functions: leaf hash canonicalisation, tree,
proof), `orchestration/{handshake_service,verification_service}.py`, `tasks/anchoring.py`,
`api/v1/endpoints/blockchain.py`, `schemas/blockchain.py`, unit tests for the tree (odd leaf
counts, single leaf, determinism), integration for close→batch→verify and a
tampered-checkpoint-row → `db_mismatch` case.
*Out of scope:* interim daily batches for multi-day trips (note as follow-up), dispatcher UI.
*Done:* closing a seeded trip produces one anchored root; editing any checkpoint row afterwards
makes `/verify` report `db_mismatch` naming the batch.

**WP7 — FP-113: journey lock v2 (Chiko)** · Size M · *Parallel; coordinate — touches
`crypto/hashing.py` (shared).* 
*Objective:* extend the canonical trip payload with a `v:2` version key, ordered stops
(precinct_id + sequence + slot_time), consignment list (waybill ref, client org,
unit_count_expected, declared_value, pickup/delivery stop sequence), and per-consignment
`pp_raw_json` sha256; `verification_service._reconstruct_trip_payload` rebuilds it;
v1 receipts still verify via version dispatch.
*Files in scope:* `crypto/hashing.py`, `orchestration/{trip_service,verification_service}.py`,
unit tests (both versions verify), integration.
*Out of scope:* wizard UI (FP-114), PP client.
*Done:* a multi-stop trip's lock covers its cargo plan; pre-v2 seeded trips still verify.

**WP8 — Linehaul completion (F2 residue)** · Size S–M · *After WP2.*
*Objective:* `LinehaulResponse` gains `seal_numbers: list[str]` (from H2 event(s)),
`trailers: list[{registration, vehicle_type}]`, `vehicle_configuration: str`; PWA linehaul screen
re-renders showing the seal after H2 capture. Additive only — existing fields frozen.
*Files in scope:* `orchestration/manifest_service.py`, `schemas/trips.py` (LinehaulResponse),
`frontend/shared/lib/types/manifest.ts`, the PWA linehaul step component, tests both sides
(assert no parcel-grain keys in driver responses remains true).
*Done:* driver linehaul matches v7 §8.1's definition; photograph-of-real-linehaul from the visit
(§5.4 B3) reconciled against the fields.

**WP9 — `integrations/parcel_perfect.py` mock-first (D11, review §5)** · Size M–L
*Objective:* implement the PP client with the real wire shape + the review §5 Pydantic models;
canned envelope fixtures; `get_single_waybill(reference)` public method; credential registry
`PP_ACCOUNTS` in `core/config.py` (shared file — coordinate) replacing the dead PP singletons;
no session/db imports (layering); write methods absent.
*Files in scope:* new `integrations/parcel_perfect.py`, `core/config.py` + `.env.example`
(add `PP_ACCOUNTS` JSON key; remove `PP_USE_MOCK/PP_API_KEY/PP_API_URL`), fixtures under
`tests/fixtures/pp/`, unit tests (auth flow with mocked httpx, envelope error paths, date
coercion, defensive typing).
*Out of scope:* orchestration wiring (wizard/FP-114 consumes it later), polling task.
*Done:* `PPClient(account).get_single_waybill("...")` returns a validated model from fixtures;
switching a config flag would hit a live URL with identical code paths.

**WP10 — Driver PWA de-mocking + demo default flip** · Size M–L · *After WP4; coordinate with
Tim's branch.*
*Objective:* `IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'` (default OFF); trips
list and active-trip detail fetch from the real API (`fetchMyActiveTrip` / trip detail endpoint)
with mocks only behind the flag; complete the real Supabase-session→AuthContext hydration the
`env.ts` comment says is pending; `generateStaticParams` strategy for `[id]` routes under static
export (switch to a query-param or client-side route for real IDs — mock IDs only exist for demo
builds); verify a real-device end-to-end run (login → H1..H5 → artifacts in storage → receipts).
*Files in scope:* `driver-pwa/lib/constants/env.ts`, `lib/context/{Auth,Trip}Context.tsx`,
`app/(app)/trips/**`, `components/layout/ProfilePanel.tsx`, PWA tests.
*Out of scope:* dispatcher app (WP11a), styling.
*Done:* a production build with no `NEXT_PUBLIC_DEMO_MODE` set performs zero mock reads on the
driver's critical path; demo build still works with the flag set.

**WP11a — Dispatcher exceptions on real API** · Size M
*Objective:* backend `GET /api/v1/exceptions` (org-scoped via trips join; filters: resolved,
trip_id, severity, type; paginated envelope per contract §0) + `GET /trips/{id}` already carries
exceptions; replace `useExceptions` mock with the API; remove `mockTrips` enrichment on
dashboard/exception pages (the list response includes trip_reference via join).
*Files in scope:* `api/v1/endpoints/exceptions.py`, `orchestration/exception_service.py`
(list function), `schemas/transit.py`, dispatcher `lib/hooks/useExceptions.ts` + pages,
integration tests incl. cross-org exclusion (§7.1 rule).
*Done:* exceptions page renders seeded DB exceptions; other-org exceptions invisible (test).

**WP11b — Trip cancellation (FP-117)** · Size S–M
*Objective:* `POST /trips/{id}/cancel` (dispatcher; admin not required) — allowed from any
non-terminal status; records a dispatcher-source exception (`type=trip_cancelled` enum addition)
with required reason; status → `cancelled`; triggers the WP6 close-batch if evidence exists.
*Files in scope:* `api/v1/endpoints/trips.py`, `orchestration/trip_service.py`,
`db/models/enums.py`, tests. *Done:* cancelled trips are terminal (handshakes 409), evidence
retained.

**WP12 — POPIA erasure implementation (approved spec + §7.4 extension)** · Size M
*Objective:* implement `2026-06-25-driver-popia-erasure-design.md` exactly (migration
`erased_at/erased_by`, `[erased]` sentinel in `core/constants.py`, `erase_driver()` orchestration
with 404/409/409 matrix, `POST /drivers/{id}/erase` admin-gated, `DriverRead.erased_at`, admin
UI button + type-to-confirm) **plus** redaction of the erased driver's values inside
`driver_events.changed_fields` and `blockchain_receipts.payload_json`, recording invalidated
receipt count on the audit trail (§7.4 decision).
*Files in scope:* per the spec + `orchestration/driver_service.py`, migration, dispatcher driver
detail page; integration tests for every error-matrix row + payload redaction + subsequent
`/verify` = `db_mismatch` on redacted driver events.
*Done:* full matrix green; an erased driver's licence number appears nowhere in the DB.

**WP13 — CI/CD, packaging, environment runbook** · Size L
*Objective:* (1) CI: Postgres service container + `TEST_DATABASE_URL` so the 100 integration
tests run; add driver-pwa lint/tsc/vitest jobs. (2) Packaging: production Dockerfile for
dispatcher; backend Dockerfile prod target; Android release `signingConfig` + keystore handling
(secrets outside repo) + CI APK build artifact. (3) Environment runbook committed to
`docs/deployment.md`: required env per environment (from §6 sweep list), Hedera topic
provisioning steps, Supabase region verification (§7.5), `ALLOWED_ORIGINS`/`ENVIRONMENT`
production values, dead-config removal (`AWS_*`, `*_USE_MOCK`), confirmation every `/dev/*`
route 404s in production builds and `NEXT_PUBLIC_DEV_*` unset. (4) Optional CD to the chosen
host (Q5 decision).
*Out of scope:* infra-as-code beyond compose; monitoring stack (note: add Sentry or equivalent
as a pilot follow-up).
*Done:* CI runs 224+ tests; a tagged commit produces deployable images + a signed APK; the
runbook alone is sufficient to stand up staging.

**WP14 — Iteration-3: per-stop handshake refactor (F8, review §7)** · Size XL · *Post-pilot;
ticket now.* Coarse `TripStatus (CREATED/ACTIVE/CLOSED/CANCELLED/EXCEPTION_HOLD)`; handshake
ledger + committed plan as the sequencer (`GET /trips/{id}/next-handshake`);
`HandshakeEvent.trip_stop_id` + uniqueness `(trip_id, trip_stop_id, handshake_type)`; per-stop
types with seal segments; plan-driven PWA (keep URL-as-state + capture components); populate
exception scoping FKs; rename `parcel_count_*` → `unit_count_*` (F11). Degenerate 2-stop mapping
preserves one code path.

**WP15 — Custody ledger (`ConsignmentCustodyEvent` + `truck_contents_at`)** · Size L ·
*Iter-2/3 boundary, after WP2.* Per review §8: custody rows at LOAD/UNLOAD with fresh waybill
snapshots + snapshot hashes folded into event hashes; interval query answers "what was in the
truck at 02:14" per consignment; per-client evidence cuts (needs WP11a scoping + FP-112 FKs).
No schema change at PP cutover — that is the point.

**Pilot-readiness definition (the finish line):** WP1–WP6 + WP8 + WP10 + WP11a/b + WP13 complete;
WP7 (FP-113) landed; WP9 fixtures validated against a real waybill from the visit; WP12 before
any real driver data; FP-122 consent pack signed. Everything after (WP14/WP15, Pulsit, IDVS,
notifications) is post-pilot hardening.

---

## Appendix A — verification log

Files read in full this session (VERIFIED basis): `orchestration/handshake_service.py`,
`orchestration/manifest_service.py`, `orchestration/trip_service.py`,
`orchestration/exception_service.py`, `orchestration/artifact_service.py`,
`orchestration/verification_service.py`, `crypto/hashing.py`, `blockchain/hedera.py`,
`blockchain/anchor_service.py`, `blockchain/critical_fields.py`,
`blockchain/subject_visibility.py`, `auth/dependencies.py`, `db/models/trips.py`,
`db/models/handshakes.py`, `db/models/transit.py`,
`driver-pwa/lib/hooks/useOfflineQueue.ts`; spot-verified: `driver-pwa/lib/constants/env.ts`,
`driver-pwa/lib/api/handshakes.ts` (demo gate + H5 payload), `dispatcher/lib/hooks/useExceptions.ts`,
`driver-pwa/app/(app)/trips/[id]/ActiveTripPageClient.tsx`, `schemas/handshakes.py` (field grep),
`storage/supabase_storage.py` (hash grep), `db/models/enums.py` (TripStatus), commit `ee4cf32`
stat, directory listings. Test run: `backend/.venv/bin/python -m pytest -q` → 124 passed /
100 skipped.

Docs read directly: `graphify-out/GRAPH_REPORT.md`, `FreightProof_Full_Picture_v7.md`,
`design-notes/2026-07-02-pp-api-handshake-architecture-review.md`. All other docs
(scope-boundaries, iteration2_master_plan, parcel-traceability, PP documentation set, plans,
specs, meeting minutes, API contract) and the repo-wide demo/mock/infra sweep: REPORTED via two
Explore subagent passes on 2026-07-06, with the highest-impact claims re-verified as noted inline.

## Appendix B — graph/doc drift noted (per CLAUDE.md rule: source wins)

- Graph (built 2026-07-02, pre-`ee4cf32`) predates the multi-consignment manifest fix — F2/F3
  status per this doc, not the graph.
- CLAUDE.md architecture section lists five integration modules that do not exist.
- v7 §14.2 lists FP-113/FP-117 as in-progress; neither exists in code. v7 §15.4 contradicts the
  BQ2 code resolution (F10).
- `backend/docs/api_contract_dispatcher_driver.md` §3.4 says H2/H5 "queue" a Hedera anchor task —
  no queue exists; anchoring is deferred entirely (H2/H5) or synchronous (H0).

---

*Review complete. Corrections → Ciaran. This document supersedes the technical claims of v7 §14;
next revision after the PP visit (target: v1.1 with §5 answers filled in).*
