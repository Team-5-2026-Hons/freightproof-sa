# Audit — docs/ relevance + backend simplicity & API efficiency

**Date:** 2026-07-10 · **Branch:** Ciaran · **Status:** analysis only, no changes made.
Findings marked ✔ were independently verified against source; the rest come from a full-repo sweep.

---

## Part 1 — docs/ relevance audit

~80 files audited (excluding `graphify-out/`). Verdict counts: **~34 KEEP · ~50 ARCHIVE · 3 DELETE · 1 DUPLICATE**.

### Delete candidates (highest confidence first)

| File | Why | Confidence |
|---|---|---|
| `docs/README.md` (774 B) | ✔ Points to `FreightProof Full Picture v4.docx` which **no longer exists**, and declares the docx files "authoritative" — contradicts the current Technical Full Picture v1. Actively misleading to teammates and to Claude sessions. Replace with a 10-line index of the *current* docs rather than deleting outright. | High |
| `docs/iter2_kickoff_meeting.docx` (27 KB) | Redundant binary copy of `iter2_kickoff_meeting.md` (the .md is the version other docs reference). Keep the .docx only if it's a required submission format. | Medium-high |
| `docs/GPS_GATE_IN_SUMMARY.md` (10 KB) | Summary for feature branch `feature/gps-warehouse-geofencing` written pre-merge; subsumed by the shipped driver-pwa code and the driver-pwa-functional plans. Zero inbound references. | High |
| `docs/db-models.md` (26 KB) | ✔ Last updated 2026-05-10, migration 0001 — **zero mentions of TripStop**, so it predates FP-112 and misdescribes the schema. Superseded by live models + Technical doc. Judgment call: delete or archive. | High that it's stale |

### Keep — current and load-bearing

- `FreightProof_Technical_Full_Picture_v1.md` — current ADR/source of truth.
- `WP_Roadmap_MVP_Spec.md` — new (2026-07-10), the forward plan.
- `FreightProof_Full_Picture_v7.md` — business-domain source of truth.
- `glossary.md`, `parcel-traceability.md`, `iteration2_master_plan.md`, `iter2_kickoff_meeting.md` — cross-referenced by current docs/plans.
- `scope-boundaries.md` — ✔ referenced from **backend code** (`backend/app/db/models/trips.py` comment cites "scope-boundaries.md §3"). Do not move/rename without updating that comment.
- `known-issues.md` — ✔ live tech-debt tracker (2 open entries, created 2 days ago). Keep.
- `design-notes/` (all 3) — referenced by the Technical doc; the 2026-07-02 PP review feeds next week's Parcel Perfect visit.
- `meeting_minutes/` (all 6) — stakeholder evidence for a graded honours project. Keep all.
- `parcel_perfect_documentation/` (all ~16) — needed live at the 13–18 Jul PP visit. Keep all.

### Archive (move to `docs/archive/`, don't delete)

These are finished-work records with honours-process value but no bearing on current work. Moving them roughly halves the visual clutter in `docs/`:

- `superpowers/plans/` — all 22 plans (features verified shipped; checkboxes were never ticked, completion lives in git). **Exception:** keep `2026-06-24-fp112-tripstop.md` and `2026-07-02-fp112-alignment.md` in place — still cross-referenced by the Technical doc.
- `superpowers/specs/` — all 10 specs (same reasoning).
- `references/*.html` — 12 UI mockups (~1 MB); the real dispatcher/driver-pwa pages now exist, so these are historical design targets only.
- `FreightProof_Full_Picture_v6.md` — superseded by v7; unique content is only its v5→v6 changelog.
- `FreightProof_Frontend_Spec_v1.md` — self-describes "there is no backend"; fully superseded.
- `FreightProof Implementation Plan v2.docx`, `iteration_1_erd.txt`, both `*.drawio.html` diagrams — iteration-1 graded artifacts, zero inbound references.

**Net effect:** ~65 KB deletable, ~2.6 MB archivable. `docs/` root drops from ~25 items to ~12 current ones.

---

## Part 2 — Backend "human-ness" / simplicity audit

### Findings (ranked)

1. **Duplicated "trip belongs to this driver" guard — 3 verbatim copies.** ✔
   `orchestration/artifact_service.py:37-42`, `checkpoint_service.py:17-22`, `exception_service.py:24-29` contain the identical fetch-trip → 404 → `PermissionError("You are not the assigned driver…")` block, with near-variants in `manifest_service.py:91-94` and `handshake_service.py:42-50`. This is the clearest "copy-pasted, not designed" tell in the backend. Fix: one shared `_load_driver_trip(db, trip_id, driver_id)` helper.

2. **Unused CRUD schema scaffolding.** ✔ (spot-checked `TripRead`, `BlockchainReceiptReadLegacy` — zero callers)
   The schema files mechanically emit Base/Create/Update/Read quads for every table whether an endpoint uses them or not: `TripRead/Create/Update`, `TripTemplate*`, `Consignment*`, `Parcel{Create,Update}`, `TripTrailer*`, `DriverSubstitution*`, `MerkleBatch*`, `BlockchainReceipt{Create,Update}`, `HandshakeEvent{Create,Update}`, `TrailerGpsSnapshot*`, plus `BlockchainReceiptReadLegacy` ("kept for backward compatibility", zero callers). This "complete the set" pattern is the most AI-generated-looking thing in the codebase. Fix: delete everything no endpoint returns or accepts.

3. **Duplicated `seed_trip` fixtures in integration tests.**
   `tests/integration/test_artifacts.py:30`, `test_checkpoints.py:29`, `test_handshakes.py:31`, `test_exceptions.py:29` — four ~30-line near-identical fixtures differing only in trip_reference/order_number/status. Fix: one parametrizable fixture in `conftest.py`.

4. **`update_vehicle` snapshot dicts copy-pasted.**
   `orchestration/vehicle_service.py:143-157` vs `162-176` — the same 11 keys (and even the same comment) listed twice for old/new event snapshots. Fix: `_vehicle_snapshot(vehicle)` helper. Same lighter pattern in `driver_service.py:145-164`.

5. **Comment register reads "senior engineer", not "student".**
   Why-comments are good and follow the project rule, but live JIRA refs (`FP-112/113/114` in `trip_service.py`), dated coordination notes ("Bruce, 24 Jun" in `manifest_service.py`), and essay-length inline rationales read like a polished production codebase. If the exam bar is "code I can defend as my own", thin the ticket references; keep the genuinely explanatory why-comments.

6. **Sync I/O inside async functions** (my own finding, ✔):
   - `storage/supabase_storage.py:30-38` — `async def upload_evidence_file` calls the **synchronous** Supabase client (`create_client` + `.upload()`), blocking the event loop during every evidence upload; also builds a new client per call.
   - `blockchain/hedera.py` — sync `httpx.Client` and blocking SDK `tx.execute()`; if called directly from async request handlers, anchoring blocks the loop for the whole Hedera round-trip. Worth confirming whether `anchor_service` offloads this (e.g. `run_in_executor`/Celery) — if not, this is both a perf and a "did you understand async?" exam question.
   - `hedera.py:126` — `except Exception: consensus_timestamp = None` silently swallows, against the project's own no-silent-swallow rule (deliberate for an optional field, but at least log it).

### Explicit non-finding (leave alone)

**`advance_h1..advance_h5` in `handshake_service.py` is fine as-is.** Common parts are already factored into `_load_trip_for_handshake` / `_get_handshake_event` / `_compute_event_hash`; each body is genuinely distinct domain logic (H1 GPS, H2 seal set, H3 departure, H4 seal-mismatch → CRITICAL hold, H5 count reconciliation → close). Collapsing them into a data-driven dispatcher would *hide* the business rules and look more machine-generated, not less.

### Already good

`checkpoint_service`, `exception_service`, `artifact_service` (short and linear), `verification_service`, `blockchain/critical_fields.py`, `resource_service.list_trips` batch-fetching, `hedera.py`'s adapter/Protocol split (justified — tests inject a fake adapter), `supabase_storage.py`'s size.

---

## Part 3 — API / data-transfer efficiency

### Findings (ranked)

1. **No pagination on any list endpoint.** ✔
   `GET /trips` returns every trip for the org unbounded (`resource_service.py:57-126`); the dispatcher fetches all and filters client-side. Ironic detail: `frontend/shared/lib/types/trip.ts:95` already declares `PaginatedList<T>` "confirmed by API contract §0.2" — the backend just never implemented it. Same for `/drivers`, `/vehicles`, `/precincts`, receipts. Fine at demo scale, indefensible at "every trip Load Factor ever ran" scale.

2. **`parcel_manifest_snapshot` shipped on every handshake, read by nobody.** ✔ (zero frontend references)
   `schemas/handshakes.py:73` — an unbounded JSONB blob serialized up to 6× per `TripDetailResponse`, to both frontends. Drop it from `HandshakeEventRead`.

3. **Driver PWA receives `blockchain_receipts` it never reads.** ✔
   Dispatcher detail strips receipts for non-admins (`endpoints/trips.py:118-119`) but `GET /trips/me/active` returns the full array to drivers (`trips.py:85-94`); the driver app references it only in a test file. Also `journey_lock_hash` is unrendered. Strip both from the driver payload — bytes saved *and* less evidence-chain exposure to the least-trusted client.

4. **Driver PII in every trip list row.** ✔
   `DriverRead` (`schemas/people.py:43-51`) carries `id_number` (SA 13-digit), `phone_number`, `license_number`, and is nested in full in every `TripListItemResponse` and `TripDetailResponse`. The list UI renders only `driver.full_name`. This is a POPIA data-minimisation issue as much as an efficiency one. Fix: `DriverSummary {id, full_name, idvs_status}` for nested contexts.

5. **`TripListItemResponse` over-fetches vehicles.**
   Full `VehicleRead` (VIN, GVM, length, pulsit_device_id, …) for the horse **and every trailer** per row; the list renders only `horse.registration`, and trailers aren't rendered in the list at all. Fix: slim vehicle summary, drop `trailers` from list rows.

6. **Minor:** `get_trip_detail` awaits ~8 independent queries sequentially (`resource_service.py:136-184`) — could be gathered, but it's a single-record path; note only. Dispatcher home maps exceptions against **`mockTrips`** (`dispatcher app/(app)/page.tsx:101`) to label real exceptions — leftover mock wiring that will mislabel production data.

### Already good on the wire

- Evidence uploads are multipart, images never travel as base64-in-JSON; responses return only `s3_key` + `file_hash`.
- `list_trips` batch-fetches drivers/vehicles/exception counts — no N+1.
- No polling anywhere; both frontends are fetch-once with manual refetch.
- Role-aware manifest split: driver gets slim `LinehaulResponse`, dispatcher gets full `ManifestResponse` — correct minimisation.

---

## Top recommendations (in order)

1. **Slim the wire format:** paginate `/trips`, introduce `DriverSummary`/`VehicleSummary` for nested contexts, drop `parcel_manifest_snapshot`, strip `blockchain_receipts` + `journey_lock_hash` from the driver's active trip. (Findings 3.1–3.5 — also your strongest POPIA story for the report.)
2. **Extract `_load_driver_trip()`** and kill the three verbatim guard copies (2.1).
3. **Delete dead schemas** and consolidate `seed_trip` fixtures (2.2, 2.3).
4. **Fix the sync-in-async storage/Hedera calls** or document why they're acceptable (2.6).
5. **docs/:** rewrite `README.md` as a current index; delete `GPS_GATE_IN_SUMMARY.md`, the kickoff `.docx`, and (probably) `db-models.md`; move plans/specs/mockups/v6/Frontend-Spec to `docs/archive/`. Team check first: plans/specs may be individually owned, and archiving changes paths other branches might reference.
