# Arrival phase, anchoring every phase, and a live journey timeline

> **Author:** Ciaran · **Date:** 2026-09-23 · **Status:** S1–S4 implemented on `Ciaran`; S5 pending merge
> **Revised 2026-09-24:** §4.7 rewritten. Pulsit is mock-only (no credentials), so the continuous
> tracker watcher (old S8) and driver checkpoints on the journey (old S7) are dropped. They are
> replaced by one **on-road tracker check** that records system exceptions and is driven from the
> dev trigger panel (§4.7, stage S7). The checkpoint plan is parked:
> [2026-09-24-s7-journey-checkpoints.md](../superpowers/plans/2026-09-24-s7-journey-checkpoints.md).
> **Owner:** Ciaran, whole slice, on his own branch
> **Replaces:** [known-issues.md §10](../known-issues.md#10-deferred--dedicated-arrival-custody-check-phase-iteration-4-candidate)
> (the deferred Arrival proposal) and the capture-event-rail "Path A vs Path B" decision in
> [2026-09-05-live-phase-timeline-handoff.md](2026-09-05-live-phase-timeline-handoff.md) §3.
> **Reverses:** [iteration4_plan.md](../iteration4_plan.md) §3.5 on three points: it said skip the
> capture-event rail, build the child ledger, and do not open Arrival. This note keeps the rail,
> drops the ledger, and builds Arrival.
> Every "exists today" claim was checked against `dev` on 2026-09-23. Line numbers move, so
> match on function and constant names.

---

## 0. The one-paragraph version

Every in-transit leg is followed by a new **Arrival** phase at the destination stop. In it, the
driver records the seal *as found*, before anything is opened, and the server compares it with the
departure seal. Unloading becomes unloading only. **Every phase** is anchored to Hedera when it
completes, not just trip creation, departure and confirmation. Every stop phase checks the driver's
phone, the horse tracker **and every trailer tracker** against the stop's precinct. The dispatcher
timeline shows the individual acts inside each phase (driver actions, photos, exceptions, including
exceptions the tracker raises on the road) as timestamped rows that appear live. The child ledger
(`phase_steps`) is not built; it stays a design note and a future-work slide. All current trip data
is test data, so it is wiped and recreated. No compatibility layer for old trips is written.

---

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Where does Arrival appear? | After **every** `in_transit`, including pickup-only cross-dock stops. Rule: *in_transit is always followed by arrival.* The seal is inspected before the doors open, whatever happens next at that stop |
| D2 | Is Arrival anchored? | Yes, and so is **every phase** on completion (§4.4) |
| D3 | What moves from unloading to arrival? | Destination seal number, intact-seal photo, the departure-to-destination seal comparison, and the `SEAL_MISMATCH` / `SEAL_UNVERIFIED` exceptions. The warehouse scan gate stays on unloading |
| D4 | Record seal opening? | **No, out of scope.** What matters is that the same seal is still closed on arrival. Arrival records the seal's *condition as found*. If the driver finds it already broken, that is recorded as a finding, not as an opening event |
| D5 | Geofence checks | At **every stop phase**, check the phone, the horse tracker and every trailer tracker against the precinct (§4.5). Between phases, an on-demand on-road tracker check records road incidents (§4.7, S7); there is no continuous watcher |
| D6 | Ownership | Ciaran implements all of it. Tom and Tim are told about the parts touching their code (§6) |
| D7 | Existing trips | Wipe trip data and recreate trips. Old trips are neither migrated nor backfilled (§5) |
| D8 | Child ledger | **Not built.** The acts inside a phase come from existing tables (§4.6) |

---

## 2. Why Arrival is its own phase

Departure records the seal and where the truck was when the seal went on. Nothing records the
seal and the truck's location **at the destination gate, before anything is opened** as its own
completed, anchored step. Today that evidence is mixed into unloading (`advance_unloading`),
which has three problems:

1. **Timing.** Reaching the gate and finishing unloading can be hours apart. Unloading's single
   `completed_at` cannot show when the seal was inspected.
2. **Ordering.** The `UnloadingCompleteRequest` schema itself records an unresolved conflict. The
   field is meant to be the seal *as found, intact*, but the driver app photographs the seal
   *after* it is broken. A separate phase, completed before unloading can start, makes "inspected
   before opened" a rule the server enforces rather than an order photos happen to be taken in.
3. **Custody.** The intact-seal check is where in-transit theft is detected. It is the custody
   boundary, so it earns its own anchor.

The ledger spec's rule, "do not make the phase plan finer", is deliberately revised for this one
custody stage and **only** this one. Capture steps are still never promoted to phases.

---

## 3. What exists today

### 3.1 Phase plan and flow

| Fact | Where |
|---|---|
| `PhaseType` has 7 values. `phase_type` is stored as `String(30)`, **not** a Postgres enum, so adding `ARRIVAL` needs no schema migration | `db/models/enums.py`, `db/models/phases.py` |
| Plan generator: 2 stops → 7 rows, 3-stop cross-dock → 11 | `orchestration/phase_plan.py` `build_phase_plan` |
| Frontend mirror must emit identical plans | `frontend/shared/lib/mocks/phase-trips.ts` `makePhasePlan` |
| `uq_phase_events_trip_stop_type` = (trip, stop, phase_type). Arrival anchored to the **destination** stop fits it: one arrival per stop | `db/models/phases.py` |
| Departure completion sets `trip.actual_departure_at`. `in_transit` then stays `PENDING` while driving | `phase_service.py` `advance_departure` |
| The driver's "Arrive at destination" swipe completes `in_transit`. No step page (`STEP_SLUGS[IN_TRANSIT] == ()`), no scan gate | `phase_service.py` `advance_in_transit` |
| Unloading holds the destination seal, `gate_photo_artifact_id` and the seal comparison, and raises `SEAL_UNVERIFIED` / `SEAL_MISMATCH` | `phase_service.py` `advance_unloading`, `schemas/phases.py` `UnloadingCompleteRequest` |
| Steps: `UNLOADING: ("2-seal-verify", "4-visual-count")` | `core/phase_meta.py` `STEP_SLUGS` |
| Scan gate on unloading | `orchestration/phase_gate.py` `GATED_PHASES` |

### 3.2 Anchoring

| Fact | Where |
|---|---|
| `ANCHORED_PHASES = {TRIP_CREATION, DEPARTURE, CONFIRMATION}`. Other rows are created `NOT_REQUIRED` | `phase_plan.py`, `trip_service.py` (row creation) |
| `_PHASE_RECEIPT_TYPES = {DEPARTURE: PICKUP, CONFIRMATION: DELIVERY}`. Receipt verification requires the stored receipt type to match this map | `phase_service.py` |
| `receipt_type` is `String(30)`, so new receipt types need no schema migration | `db/models/blockchain.py` |
| Anchoring is queued after commit, with a recovery sweep | `phase_service.py` `_dispatch_anchor`, `recover_phase_anchor` |

### 3.3 Location checks

| Fact | Where |
|---|---|
| At each stop-phase completion, Pulsit is read for the horse and every trailer | `orchestration/corroboration_service.py` |
| **Horse** gets a geofence verdict (`phase_events.pulsit_geofence_confirmed`, with NULL/TRUE/FALSE meaning could not check / inside / outside) | same |
| **Trailers** get a position snapshot only (`trailer_gps_snapshots`), **no geofence verdict** | `db/models/phases.py` `TrailerGpsSnapshot` |
| Phone vs precinct, horse vs precinct and phone vs horse are combined into one assessment, raising `DRIVER_LOCATION_MISMATCH` / `DRIVER_VEHICLE_SEPARATION` | `orchestration/action_location_service.py` |
| `IN_TRANSIT` gets no geofence verdict, because its stop is the one it departed from | `corroboration_service._PHASES_WITHOUT_A_GEOFENCE_VERDICT` |
| Phone location is captured **only while the app is in use**, with no background permission (POPIA choice) | `driver-pwa/lib/context/LocationContext.tsx` |
| Nothing polls the tracker between driver actions | no Celery beat task. `tasks/` holds `blockchain`, `parcel_perfect`, `verification` only |

### 3.4 The in-transit mini-timeline

**Does it update live? Yes, for what it shows.** `InTransitTimeline` shows three kinds of node:
*Departed* (the departure phase's completion), *exceptions* raised on the leg, and *Arrived*
(the in-transit phase's completion). Phase completion publishes `PHASE_COMPLETED` and exceptions
publish `EXCEPTION_RAISED` over SSE. `useTripResource` subscribes to that trip and refetches
(debounced), so the nodes appear without a page reload.

**What it does not show, although the data exists or nearly exists:**

| Missing | State today |
|---|---|
| Driver-logged **checkpoints** | Written with phone and tracker fixes (`checkpoint_service.log_checkpoint`). **No GET endpoint, no realtime event, never shown to the dispatcher.** Parked 2026-09-24: not used in practice |
| The phone **location trail** | Written (`location_service.record_location_pings`). **No read endpoint.** The module docstring flags the dispatcher map as not done |
| Where the **truck** was while driving | Never recorded. The tracker is only read when the driver acts |
| Tracker-derived events (left depot, stopped for X min, trailer separated from horse, tracker went dark) | Do not exist |

The component's own footer, "Only recorded journey events are shown", is accurate, and currently
that means two movement events per leg.

---

## 4. Design

### 4.1 Phase plan rule

In `build_phase_plan` and `makePhasePlan`, for every stop after the first, emit `arrival` at that
stop before anything else happens there:

```
trip_creation
for stop i:
  i == 0 : activation
  i  > 0 : arrival                      ← new, unconditional
           unloading   (if drops_off, or the final stop — unchanged rule)
  loading              (if picks_up)
  i < last : departure, in_transit
  i == last: confirmation
```

| Route | Before | After |
|---|---|---|
| Single leg (A → B) | 7 | **8**: creation · activation · loading · departure · in_transit · **arrival** · unloading · confirmation |
| 3-stop cross-dock (A → B drop+pick → C) | 11 | **13** |
| Pickup-only intermediate stop | … in_transit · loading … | … in_transit · **arrival** · loading … |

`arrival.trip_stop_id` = the stop being arrived at. `in_transit.trip_stop_id` stays the stop it
departed from, unchanged. Only `trip_creation` has a NULL stop.

### 4.2 The Arrival phase

**Driver flow:** in-transit hub → "Arrive at destination" swipe (completes `in_transit`, as today)
→ Arrival screen → seal number (typed, pre-filled with nothing) → seal condition → photo of the
seal as found → swipe "Seal inspected" → Arrival completes and anchors → Unloading.

**`ArrivalCompleteRequest`** (new, extends `_PhaseCompleteBase`, which already carries the
phone fix, accuracy, `driver_captured_at` and idempotency key):

| Field | Type | Notes |
|---|---|---|
| `phase_type` | `Literal[PhaseType.ARRIVAL]` | |
| `seal_number_at_arrival` | `str` | Required. Normalised with the existing `_normalized_seal` |
| `seal_condition` | `SealCondition` enum: `intact` · `damaged` · `missing` | Required. New enum in `enums.py`, stored as `String`, so no Postgres enum type |
| `seal_photo_artifact_id` | `UUID` | Required in every condition. A missing seal is photographed as a missing seal |

**Server (`advance_arrival`):**

1. `_gate_and_load`, the same ordering rules as every phase. No `_reject_if_not_due`. Arrival is
   **not** in `GATED_PHASES`: the warehouse scans after arrival, so gating on the scan would
   deadlock, the same reasoning `advance_in_transit` gives.
2. `_assert_artifacts_belong_to_trip` for the photo.
3. Store on the phase row. Reuse `phase_events.seal_number` and `seal_photo_artifact_id`, which
   are already per-row, so the arrival row owns its own. Add `seal_condition` as the one new
   column (§4.8).
4. **The seal comparison moves here unchanged in meaning.** Find the leg's departure (the existing
   `_find_departure_for_leg`), then:
   - departure has no seal → `SEAL_UNVERIFIED` (same severity rules as today)
   - condition ≠ `intact` → **CRITICAL** `SEAL_MISMATCH`, or a new `SEAL_COMPROMISED` type if the
     dispatcher should tell "wrong seal" apart from "seal broken" (open question Q1)
   - number ≠ departure seal → **CRITICAL** `SEAL_MISMATCH`
   The existing comments on why a mismatch does **not** hold the trip still apply. Copy the
   reasoning across; do not paraphrase it away.
5. `record_phase_corroboration` and the location assessment against the **destination** precinct,
   for phone, horse and trailers (§4.5).
6. Build the canonical payload, hash it and dispatch the anchor (§4.4).
7. `_finish_phase`. Publishes `PHASE_COMPLETED`.

**Driver app:** a new `trip/arrival` route with its own step page(s). `STEP_SLUGS[ARRIVAL]` gets
the seal steps. The existing seal-inspection component moves from unloading and is re-labelled
for "as found". This also fixes the photo-after-breaking problem: the photo is taken on a screen
that exists before the doors open.

### 4.3 Unloading, slimmed

- `UnloadingCompleteRequest` loses `seal_number_at_destination` and `gate_photo_artifact_id`.
- `advance_unloading` loses the seal block (moved in §4.2).
- It keeps the scan gate, the visual count, the `pp_scan` reconciliation and its location checks.
- `STEP_SLUGS[UNLOADING]` loses `2-seal-verify`. Renumber the slugs freely: after the reset no
  queued client carries the old ones.
- **Ordering guarantee:** unloading cannot complete before arrival, because `_gate_and_load`
  already enforces sequence order. Nothing new is needed.

`phase_events.gate_photo_artifact_id` becomes unused. **Leave the column in place** for this slice
and drop it in a later, separate migration. Removing a column and changing behaviour in one
migration is the risky combination on a shared database.

### 4.4 Anchor every phase

**Rule:** every phase row anchors when it reaches `COMPLETED`. `trip_creation` is already anchored
through the journey-lock hash.

1. `ANCHORED_PHASES` becomes `frozenset(PhaseType)`, so every row is created `PENDING`. Keep the
   constant rather than deleting it, so the rule stays one named, testable fact.
2. Receipt types: keep `PICKUP` (departure) and `DELIVERY` (confirmation) to avoid churn, and add
   one per newly anchored phase: `ACTIVATION`, `LOADING`, `TRANSIT_ARRIVAL` (in_transit),
   `ARRIVAL_INSPECTION`, `UNLOADING`. Extend `_PHASE_RECEIPT_TYPES` to cover every phase. Its
   verification check then works unchanged.
3. One canonical-payload function per newly anchored phase, in the **v2 shape** of
   `compute_departure_canonical_payload_v2`: `payload_version`, `phase_event_id`, `trip_id`,
   `phase_type`, the phase's own facts, and SHA-256 of each evidence photo by role. Follow the
   existing rules in that function's docstring: **no GPS, no artifact IDs or storage paths, no
   PII, and no `completed_at`**. `completed_at` is left out to avoid datetime round-trip problems
   when verification rebuilds the payload.
4. Arrival: seal number, `seal_condition`, `seal_photo_sha256`. In-transit: IDs only (the
   attestation itself is the fact). Activation, loading and unloading: IDs plus their own photo
   hashes and counts. Location evidence stays off-chain in PostgreSQL. It is protected by being
   written on the same row the anchored payload names, not by being hashed.
5. **Overridden phases:** `COMPLETED` is the trigger. Whether a dispatcher `OVERRIDDEN` also
   anchors is open question Q2.
6. Dispatcher: `ChainReceiptTag` needs labels for the new receipt types.

Cost and latency: 8 HCS messages per single-leg trip instead of 3. On testnet this is free; on
mainnet it is a fraction of a cent per trip. The anchor is queued, so the driver's swipe is not
slowed.

### 4.5 Geofence at every stop phase (phone, horse, trailers)

The phone and the horse are already checked at every stop phase. The gap is **trailers**:

1. Add `geofence_confirmed: bool | None` (the same NULL/TRUE/FALSE meaning, same reason
   discriminator) to `trailer_gps_snapshots`, written by `corroboration_service` via the existing
   `evaluate_geofence`.
2. A trailer `FALSE` while the horse is `TRUE` is the **decoupled trailer** case, one of the
   strongest theft signals the system can see. Raise it as its own exception type
   (`TRAILER_LOCATION_MISMATCH`, CRITICAL) rather than folding it into `GPS_MISMATCH`, which is
   about the horse.
3. Arrival gets all of this automatically: it is a stop-anchored phase, so it is not in
   `_PHASES_WITHOUT_A_GEOFENCE_VERDICT`.
4. `IN_TRANSIT` stays without a verdict at completion (no precinct to compare with). Its location
   checks come from the on-road tracker check (§4.7, S7).

### 4.6 The capture-event rail: acts inside each phase, live

Rows **inside** each phase card, each with a timestamp. None of them need the child ledger:

| Row | Source | Live today? |
|---|---|---|
| Driver completed the phase ("Seal applied and departed", "Seal inspected intact", "Loading complete") | `phase_events.completed_at`, plus `driver_captured_at` when captured offline | Yes (`PHASE_COMPLETED`) |
| Photo captured (seal, POD, linehaul, arrival seal) | `evidence_artifacts.captured_at`. Show `created_at` as "received" when it differs, so a delayed offline upload is visible | After completion only. **Live mid-phase needs S6** |
| Exception | `trip_exceptions` | Yes (`EXCEPTION_RAISED`), already on the rail |
| Location verdicts (phone / truck / each trailer vs precinct) | §4.5 fields | With the phase |
| Receiver handover / POD signature | `handover_confirmations.confirmed_at` | With the phase |

**S6 (live mid-phase photos):** hand-written migration adding nullable `phase_event_id` +
`step_slug` to `evidence_artifacts` with an all-or-neither CHECK. Validate them on upload and at
completion. Publish an **INFO** realtime event on upload (INFO, or it raises a red alarm on every
dispatcher screen; see `lib/realtime/ranking.ts`). The full spec is in the 2026-09-05 handoff §3
"Path A"; it still stands.

### 4.7 On-road tracker check (revised 2026-09-24)

**Why this replaced the watcher and checkpoints.** Pulsit is mock-only: there are no
credentials, and every position comes from state the demo stages (`MockPulsitClient`,
behind `PULSE_USE_MOCK`). A Celery beat poller over a mock would re-read a value that
only changes when the presenter clicks, so the poller, its `trip_tracker_fixes` table,
the stationary/entered-precinct rows and the rate-limit question (old Q4/Q5) bought
nothing. Driver checkpoints are not used in practice and are parked. What matters on the
road is **incidents**, and incidents are exceptions, which already appear live on the
journey (`EXCEPTION_RAISED`, scoped to the leg by `phase_event_id`).

**The gap today.** The tracker is read only when the driver completes a stop phase.
Moving the truck mid-journey changes nothing the dispatcher can see, and the
trailer-decoupling rule (`_raise_trailer_decoupling_if_unrecorded`) runs at stops only.

**The check.** One orchestration function reads the horse and every trailer of a trip in
one Pulsit call and records **system** findings (`source=SYSTEM`) against the leg:

| Finding | Rule | Exception | Severity |
|---|---|---|---|
| Trailer separated on the road | A trailer fix is more than `TRAILER_HORSE_MAX_SEPARATION_METRES` from the horse fix, while the trip is on an in-transit leg | New `TRAILER_SEPARATED_IN_TRANSIT` | CRITICAL |
| Moved before departure | Horse fix outside the origin precinct's fence while the leg's departure is still pending | New `MOVED_BEFORE_DEPARTURE` | CRITICAL |
| Tracker silent | A tracker returns no position | New `TRACKER_SILENT` | WARNING |

`TRAILER_SEPARATED_IN_TRANSIT` is deliberately separate from `TRAILER_LOCATION_MISMATCH`:
that one means "trailer outside the precinct at a stop" and is judged against a fence;
this one is judged trailer-to-horse with no fence at all. An insurer reads them differently.

Rules shared with the stop-phase checks: NULL never raises (no fix is its own finding,
not a pass or a fail); each finding is recorded **once per leg, per type, per vehicle**,
however often the check runs; the separated trailer's fix and the distance go on the
exception row (`gps_lat`/`gps_lng`, description). Registrations identify vehicles, not
people, so they may be named in descriptions.

**How it runs.** On demand, never on a timer: the dev panel runs it straight after it
moves a tracker, and offers it as its own action. The tracker **corroborates**, it never
advances a phase; the driver's swipe stays authoritative. A real scheduler, once live
Pulsit exists, is a thin wrapper around the same function and is future work.

**Demo seam.** The dev move-truck endpoint gains a target vehicle (horse or a named
trailer), so a trailer can be staged away from its horse. The dev panel redesign that
drives this is its own spec (see §7, S7).

**POPIA:** tracker fixes are the vehicle's hardware, never the driver's phone; they stay
in PostgreSQL and are never anchored.

### 4.8 Schema changes, all hand-written migrations named `2026_MM_DD_ciaran_*.py`

| Change | Stage |
|---|---|
| `phase_events.seal_condition` (nullable String) | S2 |
| `trailer_gps_snapshots.geofence_confirmed` (nullable Boolean) | S4 |
| `evidence_artifacts.phase_event_id`, `step_slug` + CHECK | S6 |
| Analytics views gain `arrival` dwell (Tom's views, §6) | S1 |

No migration is needed for `PhaseType.ARRIVAL` or the new receipt types (`String(30)`). **Never**
use `alembic revision --autogenerate` output unpruned (CLAUDE.md). **Never** `alembic upgrade`
from the feature branch. Tests build the schema with `create_all`, so the branch is fully testable
without applying anything.

---

## 5. Data reset

Wiping is safer than migrating:

| Option | Why not / why |
|---|---|
| Support old and new trip shapes | Two unloading code paths forever, one of them only there for test data |
| Backfill arrival rows into old trips | Renumbers `sequence_number` and rewrites rows whose hashes are already anchored. That is tampering with our own evidence |
| **Wipe trip data and recreate** | One shape, no legacy fields, nothing to defend |

**How:** the script already exists: `backend/scripts/dev_reset_lifecycle.py`. It is not an Alembic
migration, because deleting data is not a schema change. It uses ordered `DELETE`, not
`TRUNCATE … CASCADE`. It refuses to run unless `--project-ref` matches `DATABASE_URL`, and it
asserts that reference data survives. Run **by Ciaran**, once, **from `dev`, after the Arrival
branch merges and its migrations are applied**.

**It must be updated first (part of S5).** Its `_DELETE_ORDER` predates five trip-scoped tables:

| Missing table | Foreign keys (from the models) | Must be deleted before |
|---|---|---|
| `receiver_identity_verifications` | handover token, handover confirmation, trip, evidence artifact | confirmations, tokens |
| `handover_token_attempts` | handover token | tokens |
| `handover_confirmations` | handover token, phase event, trip, evidence artifact | tokens, `phase_events`, `evidence_artifacts` |
| `handover_capability_tokens` | phase event, trip, trip stop | `phase_events`, `trip_stops` |
| `trip_location_pings` | trip, driver | `trips` |

So the five go at the **front** of `_DELETE_ORDER`, in the order listed.

As it stands, the `DELETE FROM trips` fails on a foreign key. It stops safely, but the reset
cannot complete. Add the tables in dependency order, worked out from the models' `ForeignKey`s
rather than from this table. Also add a unit test asserting that every model with a foreign key
into the trip graph is in either `_DELETE_ORDER` or `_REFERENCE_TABLES`, so the next new table
cannot be missed silently.

- **Keeps** organisations, precincts, vehicles, drivers, users and their registry receipts
  (`vehicle_created`, `driver_created`, …), so no re-seeding of the fleet.
- Evidence files in Supabase Storage for deleted artifacts become orphans. They are harmless
  for test data; empty the bucket in the dashboard if a clean slate matters.
- Analytics read models are refreshed afterwards.
- Old Hedera messages stay on testnet. They are harmless and simply unreferenced.
- Then re-seed trips with `scripts/seed_trips.py` (updated in S2, below).

**`seed_trips.py` must be updated in S2.** It writes phase rows directly rather than calling
`create_trip()`. Its plans come from the generator, so seeded trips gain arrival rows
automatically. But its completed phases put the destination seal on the **unloading** row.
Move that evidence onto the arrival row: seal number, `seal_condition` and the seal photo.
Leave unloading with only its own fields. `tests/unit/test_seed_fixtures.py` should assert
that no seeded unloading row carries seal fields.

**Before running it:**

- [ ] Tim, Chiko and Tom told the day before; it wipes the shared dev database for everyone
- [ ] Every driver app **rebuilt and reinstalled**: an old APK does not know the `arrival` phase
- [ ] Drivers clear app storage. Queued entries for deleted trips would 404; the queue treats a
      4xx as terminal and discards them, which is fine, but clearing avoids confusion
- [ ] New demo trips created afterwards, including one single-leg and one 3-stop cross-dock

---

## 6. Impact on other developers' code

Ciaran owns the implementation. These parts touch code other developers wrote or read, so each
gets a heads-up, not a surprise:

| Area | Owner | What changes |
|---|---|---|
| Analytics read models (`2026_09_12_tom_analytics_read_models.py`, `…_trailer_vehicle_analytics.py`) | Tom | `_DWELL_PHASES` does not include `arrival`, and dwell is measured from the *previous* phase's completion. After this change **unloading dwell becomes arrival→unloading** (real unloading time, better than today) and a new arrival dwell (gate wait until inspection) needs adding. The `in_transit` ← `departure` gap rule is unaffected. Needs a new view migration |
| Incident report PDF / evidence pack | Tim | Reads phases: one more phase type per leg, seal evidence now on the arrival row, more receipts. Check any hardcoded phase lists |
| Shared files | team | `db/models/enums.py` (new enum values) and `frontend/shared` (phase types, plan mirror). Flag in the PR |
| `phase_service.py` | everyone | New `advance_arrival`, slimmed `advance_unloading`, extended receipt map. Merge in a quiet window straight after a `dev` merge |

Other code that hardcodes `UNLOADING` and must be checked for arrival: `core/phase_meta.py`,
`schemas/phases.py`, `phase_gate.py`, `verification_service.py`, `api/v1/endpoints/dev_triggers.py`,
`analytics/fleet/routes.py`, `shared/lib/types/phase.ts`, `shared/lib/mocks/phase-trips.ts`,
`dispatcher/lib/hooks/useDevTriggers.ts`, `dispatcher/components/trips/TripTimeline.tsx`,
`PhaseEvidence.tsx`, `driver-pwa/lib/api/phases.ts`.

---

## 7. Stages

Each stage ends green and visible. S1–S4 are the Arrival core; S5 is the reset; S6–S7 are the
live journey.

| Stage | Delivers | Done when |
|---|---|---|
| **S1** Plan | `PhaseType.ARRIVAL`; both generators emit it; analytics view migration; dispatcher and driver app render the new row (placeholder screen) | Unit tests: single leg = 8 rows, cross-dock = 13, pickup-only stop has arrival; backend/frontend plan-parity test passes; trip detail shows Arrival |
| **S2** Arrival phase | `ArrivalCompleteRequest`, `advance_arrival`, seal logic moved, unloading slimmed, driver-app arrival screens, `seal_condition` migration, `seed_trips.py` puts seal evidence on arrival (§5) | Integration tests: intact + match → completed, no exception; number mismatch → CRITICAL `SEAL_MISMATCH`; `damaged`/`missing` → CRITICAL; no departure seal → `SEAL_UNVERIFIED`; unloading before arrival → rejected; 401 / 404 / 422 |
| **S3** Anchor every phase | `ANCHORED_PHASES` = all, receipt types, per-phase canonical payloads, receipt labels | Every phase row of a completed test trip ends `ANCHORED` with a matching receipt type; payload hash tests per phase; a test asserts no payload contains coordinates, artifact IDs or `completed_at` |
| **S4** Trailer geofence | `trailer_gps_snapshots.geofence_confirmed`, `TRAILER_LOCATION_MISMATCH` | Unit: inside / outside / no fix → TRUE / FALSE / NULL; integration: horse in and trailer out raises CRITICAL |
| **S5** Reset | Add the five missing tables to `dev_reset_lifecycle.py` plus its coverage test; merge to `dev`; apply migrations; run the reset; rebuild APKs; re-seed trips | Coverage test passes; §5 checklist ticked |
| **S6** Live photo rows | Attribution migration, upload validation, INFO upload event, photo rows on the rail | A photo taken mid-phase appears on the dispatcher rail without reload |
| **S7** On-road tracker check | New exception types, road check function, move-truck target vehicle, dev panel actions (§4.7) | Unit: separation / moved-before-departure / silent / no-fix-no-raise / once-per-leg. Integration: staging a trailer away from its horse and running the check raises one CRITICAL `TRAILER_SEPARATED_IN_TRANSIT` that appears on the journey live — **done 2026-09-24** |

S1–S5 must ship together; there is no useful state in between. S6–S7 are independent and can be
cut from the end if time runs out.

---

## 8. Open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Separate `SEAL_COMPROMISED` for damaged/missing, or reuse `SEAL_MISMATCH`? | Separate. "Wrong seal number" and "seal broken" are different findings for an insurer |
| Q2 | Does a dispatcher override anchor? | Yes. Anchor the override record (who, when, reason hash). An override is exactly what a dispute questions |
| Q3 | Should arrival require the tracker to be inside the destination fence? | No. Record the verdict and raise the exception; never block the driver on a tracker that may be dark |
| Q4 | ~~S8 poll interval and thresholds~~ | Dropped 2026-09-24: no poller. Separation reuses `TRAILER_HORSE_MAX_SEPARATION_METRES` |
| Q5 | ~~Pulsit rate limits for continuous polling~~ | Dropped 2026-09-24: Pulsit is mock-only; revisit if live credentials arrive |

---

## 9. What this does not do

- No child ledger (`phase_steps`). Recorded as future work.
- No seal-opening event.
- No automatic phase progression from the tracker.
- No background phone tracking.
- No rerouting, dispatch or response: every new row records something that happened.
