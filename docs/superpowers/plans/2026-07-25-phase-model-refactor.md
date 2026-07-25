# Phase Model Refactor — Implementation Plan (Scope B)

**Date:** 2026-07-25 · **Author:** Ciaran (plan drafted with Claude) · **Status:** DRAFT — to be
verified & iterated in a separate session, then re-baselined after Tim's branch merges, THEN executed.

> ⚠️ **This is a draft for verification, not an execute-now order.** Its architecture, contract,
> sequencing, and DB strategy are stable. Its *file-level specifics* must be re-confirmed after
> `feature/gps-warehouse-geofencing` merges to `dev` (Stage 0). Do not start Stage 1 before that gate.

---

## HANDOFF BLOCK — paste this first in any fresh session

**What this is.** FreightProof's custody lifecycle is being refactored from a hard-wired 6-step
"Handshake" model (H0–H5, where `TripStatus` doubles as the state machine) into a **plan-driven
"Phase" model** (P0–P6, where the phase order is *data* generated at trip creation and the trip's
position is *derived* from a phase-event ledger). This is Scope B from
`docs/superpowers/specs/2026-07-23-phase-model-redesign-design.md` — the version that proves the
multi-stop, cross-dock feasibility thesis, not a cosmetic rename.

**Why plan-driven (the decision, so nobody relitigates it).** A cosmetic H→P rename proves nothing
new; the prototype's whole point is to demonstrate tamper-evident custody across a *real multi-stop
network*. Only a plan-driven ledger (coarse `TripStatus`, phase order from the committed plan,
per-stop phase events) demonstrates that. Rejected alternatives are recorded in §2.

**Ownership.** Ciaran owns backend + FastAPI + dispatcher + the shared TypeScript contract types.
Tim owns the driver-pwa, building against the frozen contract. This split matches the natural seam
(the API contract) and lets Ciaran prove the contract against a *real consumer* (the dispatcher)
before Tim commits to it — so the demo can stand on backend+dispatcher alone.

**What's done.** P0 (trip creation redesign: `consignments[]`, PP-sourced cargo, empty legs,
versioned lock hash) is merged to `dev`. The `Consignment` model already carries the per-stop
groundwork (`pickup_stop_id`, `delivery_stop_id`, `unit_count_expected`, `pp_manifest_number`,
`pp_raw_json`). The settled anchor policy is H0/P0 fail-closed, everything else fail-open.

**What's next.** Stage 0: land Tim's `gps-warehouse-geofencing`, re-baseline, freeze the contract.
Then Stages 1→6.

**Hard precondition.** Tim's `feature/gps-warehouse-geofencing` (unmerged as of 2026-07-25: ~175
files, ~8k insertions) rewrites `handshake_service.py`, the handshake endpoints/schemas, shared
`handshake-meta.ts`, and adds a migration. It also delivers the GPS/geofence building blocks P1/P2
need. **It must merge to `dev` before this refactor starts**, or the two collide head-on.

---

## 0. Preconditions & the risk this plan manages

### 0.1 Branch state (as of 2026-07-25)
- `Ciaran` ≈ `origin/dev` (PR #30 merged). Planning against the working tree = planning against dev.
- `feature/trip-creation-redesign` (P0) is **merged** into dev. No separate P0 landing needed.
- `feature/gps-warehouse-geofencing` (Tim) is **unmerged and large**, and touches the refactor's
  core surface: `orchestration/handshake_service.py` (+85), `api/v1/endpoints/handshakes.py`,
  `schemas/handshakes.py`, `blockchain/anchor_service.py`, `core/config.py`, `db/models/transit.py`,
  a new migration `2026_07_17_tim_add_exception_gps.py`, and shared `handshake-meta.ts`.

### 0.2 The two things that make it safe to write this now but not execute now
1. **The design is Tim-independent; the diffs are not.** Contract, stages, DB strategy, and risks
   don't move when Tim edits a function body. The exact edits to `handshake_service.py` etc. do.
2. **Tim's work is partly an input, not just an obstacle.** GPS warehouse geofencing + `useLocation`
   + trip-gating is the P1-Activation location check and P2 geofence. After his merge, some P1/P2
   work is already done — re-baselining may *shrink* Stages 1–3.

**Therefore execution order is: Tim merges → Ciaran re-baselines the target files against post-merge
dev → contract frozen → build.**

---

## 1. The frozen contract (Stage 0 deliverable — DRAFT v0, finalise post-merge)

This is the single artifact Tim builds to. It is the API shape between backend and both frontends.
Freeze it before either side writes feature code. Draft below; finalise against post-merge dev.

### 1.1 Phase types (activation-first ordering, per spec §7/§8)
```
P0 trip_creation   (dispatcher; journey lock; fail-closed anchor)
P1 activation      (driver; geofence verdict + trailer match; opens PP poll window; fail-open)
P2 loading         (system-observed via mock/PP; manifest snapshot + count; fail-open)
P3 departure       (driver; seal capture; onboard() snapshot; fail-open)
P4 in_transit      (Pulsit vs phone; checkpoint batches; arrival; fail-open)
P5 unloading       (driver seal-verify-before-open; system-observed unload; fail-open)
P6 confirmation    (driver POD; server-side hidden reconciliation; delivery anchor; fail-open)
```
Per-stop generalisation: at a hub, stop k yields {activation/arrival, unload*, load*, seal,
departure}; the single-leg trip's plan *is* P0→P6. The plan is generated at P0 from stops + consignments.

### 1.2 Phase descriptor (served to the UI)
```
PhaseDescriptor {
  phase_event_id: UUID | null    // null until the phase row is created
  phase_type: PhaseType
  trip_stop_id: UUID | null
  sequence_number: int           // position in the committed plan (NOT enum index)
  status: 'pending'|'in_progress'|'completed'|'exception'|'overridden'
  step_recipe: string[]          // static per phase_type — the capture-component slugs
  // evidence fields populated once completed (seal_number, artifact ids, verdict, counts...)
}
```

### 1.3 Endpoints
```
GET  /trips/{id}/phases                         -> PhaseDescriptor[]  (plan + current state)
GET  /trips/{id}/next-phase                      -> PhaseDescriptor | null
POST /trips/{id}/phases/{phase_event_id}/complete -> TripDetailResponse
     (idempotent; body carries an idempotency key = offline-queue entry id)
```
`TripDetailResponse.phases` replaces `.handshakes`. `Trip.status` is coarse; the human "where is it"
label is derived from the phase ledger (and mirrored into a denormalized `current_phase` for lists).

### 1.4 Shared TS types (the contract in TypeScript — Ciaran writes, both consume)
`frontend/shared/lib/types/phase.ts` (replaces `handshake.ts`), plus `handshake-meta.ts` →
`phase-meta.ts` (step recipes per phase type), `status-meta.ts` coarse trip statuses + phase labels.

> **Fence for the whole contract:** it must express the *single-leg* trip as the degenerate case of
> the *multi-stop* plan — one code path. If any part of the contract hard-codes "6 phases" or
> "sequence 0..6", it's wrong. Length is data.

---

## 2. Chosen approach & rejected alternatives

**Chosen — plan-driven phase ledger (Scope B).** Coarse `TripStatus` (`created → active → closed`
+ `cancelled`, `exception_hold`); phase order generated at P0; trip position derived from the
`phase_events` ledger; per-stop phase events with `(trip_id, trip_stop_id, phase_type)` uniqueness;
driver app and dispatcher both plan-driven off the contract.

- *Rejected — cosmetic rename (Scope A only).* Cheapest, but proves nothing new and re-hard-wires
  the single-leg shape. Fails the feasibility thesis. (Keep the *vocabulary* win; it comes free here.)
- *Rejected — per-stop refactor without the rename.* Same engineering, worse clarity, and CLAUDE.md
  prose stays stale. No reason to keep "handshake" once the ledger is plan-driven.
- *Rejected — do it all in one branch, all four devs.* Maximises collision. The contract-seam split
  (Ciaran backend+dispatcher, Tim driver-app) is what makes it parallelisable and demo-safe.

---

## 3. Data strategy — additive DDL + reseed (NOT transform-in-place)

**Schema (Alembic, required):**
- `handshake_events` → phase-event shape: `handshake_type`→`phase_type` (new value set), add nullable
  `trip_stop_id` FK, change uniqueness to `(trip_id, trip_stop_id, phase_type)`, `sequence_number`
  becomes plan-derived. Fold in fatter-anchor columns if in scope (artifact-hash coverage, F4).
- `trips.status` values go coarse; add denormalized `current_phase` / `current_stop` columns.
- Migration name-tagged (`2026_MM_DD_ciaran_phase_model.py`), chained **after** Tim's
  `2026_07_17_tim_add_exception_gps.py` (verify the head after his merge — CLAUDE.md migration rule).

**Data (regenerate, don't migrate):**
- Existing trip/handshake rows are old-shape and anchored over old payloads — not worth transforming.
  **Truncate + reseed the lifecycle tables only:** `trips`, `consignments`, `parcels`, `trip_stops`,
  phase events, `evidence_artifacts`, trip `exceptions`, trip-scoped `blockchain_receipts`.
- **Reference data survives untouched:** organizations, precincts, drivers, vehicles, users.
- The seed script produces both a single-leg trip AND a multi-stop trip in the new phase shape
  (the multi-stop one is the feasibility proof).

> **Fence:** no data-migration that re-derives `trip_stop_id` or splits H4+H5→P5 on existing rows.
> Prototype demo data is regenerated, not preserved.

---

## 4. Stages (each ends with something visible)

Verification lives at each **stage boundary** (run the checks; tests at end of stage, not per step).
Suggested commits are marked `> Suggested commit:` — Ciaran runs git; the plan never does.

### Stage 0 — Land Tim, re-baseline, freeze the contract  *(gate for everything)*
- **0.1 Land Tim's branch.** Ensure `feature/gps-warehouse-geofencing` is merged to `dev`. *(Team
  action — not Claude's to merge.)* **Fence:** do not start Stage 1 until this is true.
- **0.2 Re-baseline.** On fresh `dev`, re-diff the refactor's target files (`handshake_service.py`,
  `enums.py`, `schemas/handshakes.py`, `endpoints/handshakes.py`, `blockchain/anchor_service.py`,
  `db/models/handshakes.py`, `core/config.py`, shared `handshake-meta.ts`). Note what Tim's
  geofence/`useLocation`/trip-gating already delivers for P1/P2. Update §1 and §5 line references.
  **Where:** the spec + this plan. **Fence:** analysis only, no code edits.
- **0.3 Freeze the contract.** Finalise §1 (phase types, descriptor, endpoints, shared TS types)
  against post-merge dev, with Tim in the room. Write the shared `phase.ts` / `phase-meta.ts`
  stub types so both sides compile against them. **Where:** `frontend/shared/lib/types/`,
  `frontend/shared/lib/constants/`, the contract section of this plan.
- **Stage-0 verification:** `dev` builds; shared TS types compile and are importable from both
  `dispatcher` and `driver-pwa` (`tsc --noEmit` in shared/each app); the contract doc is signed off
  by Ciaran + Tim. **Visible:** a frozen, compiling contract both devs agree on.
- **Go/No-Go note:** if 0.1 slips past week 1, fall back to the current H0–H5 flow for the demo (§6).
  > Suggested commit: `docs(orchestration): freeze phase-model contract v1 + shared phase types`

### Stage 1 — Backend data model + migration + reseed  *(Ciaran)*
- **1.1** `enums.py`: `HandshakeType`→`PhaseType` (new values), `TripStatus`→coarse. **Where:**
  `db/models/enums.py`. **Fence:** don't touch `advance_*` logic yet.
- **1.2** Model: `HandshakeEvent`→`PhaseEvent` (or keep table, add columns) with `trip_stop_id`,
  new uniqueness; `Trip` gains `current_phase`/`current_stop`. **Where:** `db/models/handshakes.py`,
  `db/models/trips.py`, `db/models/__init__.py` (shared — flag). **Fence:** additive; no data transform.
- **1.3** Alembic migration chained after Tim's head; name-tagged. **Where:** `migrations/versions/`.
  **Fence:** DDL only; reseed is separate.
- **1.4** Seed script: emit a single-leg AND a multi-stop trip in the new phase shape; truncate only
  lifecycle tables. **Where:** `backend/scripts/seed_demo.py`.
- **Stage-1 verification:** `alembic upgrade head` green on a fresh dev DB; `seed_demo` runs; a
  `GET /trips` shows the new-shape trips; reference data (drivers/vehicles/precincts) intact.
  **Visible:** new-shape phase trips exist and are queryable. `cd backend && pytest` green (model tests).
  > Suggested commit: `feat(db): phase-event model, coarse trip status, current_phase denorm + migration`

### Stage 2 — Backend phase engine  *(Ciaran; the core)*
- **2.1** Plan generation at P0: trip creation emits ordered `PhaseEvent` rows (pending) from
  stops+consignments. **Where:** `orchestration/trip_service.py`. **Fence:** don't change lock-hash
  semantics beyond covering the phase plan (FP-113).
- **2.2** `advance_phase(plan, event)` replacing `advance_h1..h5`; gate on "previous phase completed/
  overridden and no exception_hold" (not `trip.status`). **Where:** `orchestration/handshake_service.py`
  → `phase_service.py`. **Fence:** keep anchor policy (P0 fail-closed, rest fail-open).
- **2.3** `next-phase` computation + `current_phase` maintenance on each completion. **Where:**
  `orchestration/`, resource/read services.
- **2.4** Idempotent completion keyed by offline-queue id (re-submit returns current state, 200).
  **Where:** `phase_service.py`. **Fence:** idempotency by key only; don't loosen sequence checks.
- **Stage-2 verification:** a scripted/`pytest` walk drives a single-leg trip P0→P6 via the service
  layer; phases advance; `next-phase` is correct at each step; a duplicate completion returns 200;
  `current_phase` tracks. **Visible:** a trip walks end-to-end through phases. `pytest` green.
  > Suggested commit: `feat(orchestration): plan-driven phase engine — generation, advance, next-phase, idempotency`

### Stage 3 — Backend endpoints + schemas + reconciliation + fatter anchors  *(Ciaran; realises the contract)*
- **3.1** Endpoints: `GET /phases`, `GET /next-phase`, `POST /phases/{id}/complete`; retire `/h{n}/`.
  **Where:** `api/v1/endpoints/handshakes.py`→`phases.py`, `main.py` (shared — flag). **Fence:** match
  the frozen contract §1 exactly.
- **3.2** Schemas: `PhaseEventRead`, per-phase complete requests folded into one shape; `TripDetailResponse.phases`.
  **Where:** `schemas/handshakes.py`→`phases.py`, `schemas/trips.py`.
- **3.3** Server-side reconciliation (F1): driver never sends/sees PP count; P6 returns a result.
  **Where:** `orchestration/` + `integrations/parcel_perfect.py` (mock). **Fence:** mock-first; do
  not claim live PP load/unload status (ecomService can't supply it — spec §6).
- **3.4** Fatter anchor payloads (F4): fold artifact SHA-256s + GPS + timestamps + snapshot hash.
  **Where:** `blockchain/anchor_service.py`, `phase_service.py`. **Fence:** do this before wiring more anchors.
- **Stage-3 verification:** integration tests hit the live contract endpoints for a full single-leg
  walk; reconciliation returns a result server-side; an anchored phase's payload includes artifact
  hashes. **Visible:** the frozen contract is live over HTTP. `pytest` green.
  **← GO/NO-GO GATE (~2026-08-04, one week before the 08-11 presentation):** backend contract +
  migration + one single-leg end-to-end walk working? Yes → push through Stage 4 (the dispatcher
  proof IS the demo). No → freeze, demo the current H0–H5 flow (§6). Stage 5 (driver app) is stretch,
  never the demo dependency.
  > Suggested commit: `feat(api): phase endpoints, server-side reconciliation, artifact-covering anchors`

### Stage 4 — Dispatcher re-wire  *(Ciaran; proves the contract against a real consumer)*
- **4.1** Shared types already frozen (Stage 0); wire `TripDetailResponse.phases`. **Where:**
  `frontend/shared/lib/types/phase.ts`, `status-meta.ts`.
- **4.2** Trip detail: replace `ACTIVE_HS_FOR_STATUS[trip.status]` with derived-active-phase from the
  ledger; render variable-length phase timeline; re-bind evidence/verdict/seal panels. **Where:**
  `dispatcher/app/(app)/trips/[id]/page.tsx`. **Fence:** reuse existing visual components; no redesign.
- **4.3** `HandshakeChain`→`PhaseChain`: render N nodes from the phase list. **Where:**
  `dispatcher/components/domain/`.
- **4.4** Trip list/filters: active/closed off coarse status; phase-level filter/sort off
  `current_phase`. **Where:** `dispatcher/lib/hooks/useTrips.ts`, `app/(app)/page.tsx`, `history/page.tsx`.
- **Stage-4 verification:** dispatcher trip-detail shows a plan-driven phase timeline for both a
  single-leg AND a multi-stop seeded trip; list filters by derived phase; evidence/verdicts render.
  **Visible (this is the demoable proof):** dispatcher shows a multi-stop trip's derived phases +
  evidence, with no driver app involved.
  > Suggested commit: `feat(dispatcher): plan-driven phase timeline + coarse-status trip lists`

### Stage 5 — Driver-app plan-driven engine  *(Tim; parallel from Stage 0, integrates here)*
- **5.1** Fetch the phase plan; replace `[h]` 1–5 route + fixed-length constants with descriptor-driven
  steps; keep URL-as-state (key by phase-event id / `stop/{k}/{type}`). **Where:** `driver-pwa/app/(app)/trip/…`,
  `lib/navigation/`, `lib/constants/`. **Fence:** keep generic capture components; only the *sequence* becomes data.
- **5.2** P6 reconciliation → await/result screen (no PP-count input). **Where:** `components/handshake/steps/`.
- **5.3** Idempotency key from offline-queue id on submit. **Where:** `lib/hooks/useOfflineQueue.ts`, `lib/api/`.
- **Stage-5 verification:** in the driver app (dev build), a driver walks a seeded trip through its
  phases; offline replay of a completed phase is a no-op; no cargo count shown to the driver.
  **Visible:** driver-side phase walk works against the real contract.
  > Suggested commit (Tim): `feat(driver-pwa): plan-driven phase step engine`

### Stage 6 — Integration, multi-stop proof, demo reseed  *(joint)*
- **6.1** End-to-end: dispatcher + driver on one multi-stop trip; phases stay in sync. **Where:** e2e.
- **6.2** Reseed the demo dataset to the phase shape; script the demo narrative (note: PP load/unload
  completion is simulated — spec §6). **Where:** `seed_demo.py`, demo notes.
- **6.3** Docs: CLAUDE.md handshake prose (4-reviewer PR), Technical Full Picture v1.1, glossary.
- **Stage-6 verification:** a full multi-stop trip is walked end-to-end across both surfaces; backend
  + frontend test suites green; demo dataset loads clean. **Visible:** the feasibility thesis, demoable.
  > Suggested commit: `feat: phase model end-to-end + multi-stop demo dataset` · `docs: phase vocabulary sweep`

---

## 5. Files in scope (re-confirm against post-merge dev in Stage 0.2)

**Backend (Ciaran):** `db/models/enums.py`, `db/models/handshakes.py`, `db/models/trips.py`,
`db/models/__init__.py`*, `orchestration/{trip,handshake→phase,resource,verification}_service.py`,
`api/v1/endpoints/handshakes→phases.py`, `main.py`*, `schemas/handshakes→phases.py`, `schemas/trips.py`,
`blockchain/anchor_service.py`, `core/config.py`* (`PP_POLL_INTERVAL_SECONDS`), `integrations/parcel_perfect.py`,
`migrations/versions/2026_*_ciaran_phase_model.py`, `backend/scripts/seed_demo.py`, backend tests.
**Dispatcher (Ciaran):** `dispatcher/app/(app)/trips/[id]/page.tsx`, `components/domain/HandshakeChain→PhaseChain.tsx`,
`lib/hooks/useTrips.ts`, `app/(app)/page.tsx`, `history/page.tsx`.
**Shared (Ciaran, coordinate):** `shared/lib/types/handshake→phase.ts`, `shared/lib/constants/handshake-meta→phase-meta.ts`,
`shared/lib/constants/status-meta.ts`, `shared/lib/mocks/trips.ts`.
**Driver-pwa (Tim):** the ~40 handshake files — descriptor-driven per the contract.
`*` = heavily-shared registration files — flag every change in the PR.

---

## 6. Risks & tripwires

| Risk | Early warning | Fallback |
|---|---|---|
| **Tim's branch collides with the refactor surface** | Stage 0.2 diff shows conflicts in `handshake_service.py`/`handshakes.py`/shared meta | Tim merges FIRST; re-baseline before any Stage-1 edit. Non-negotiable gate. |
| **Migration chain conflict** (two unmerged migrations) | `alembic history` shows a fork after Tim's `2026_07_17` head | Chain the phase migration after his head; name-tag; never fix the revision chain unilaterally |
| **Contract drift after freeze** (Tim chases a moving target) | Tim reports a type mismatch mid-Stage-5 | The frozen shared TS types are the source of truth; contract changes only by joint agreement + re-freeze |
| **Deadline: presentation 2026-08-11** | **Go/No-Go by ~2026-08-04** (Stages 1–3 green + single-leg walk) not met | Demo the current H0–H5 flow (kept intact on dev); present the phase model as backend proof + direction |
| **Tim's merge date is the pivotal variable** | `gps-warehouse-geofencing` not merged to dev by ~2026-07-30 | The refactor window shrinks 1:1 with every day his merge slips. If not merged by ~Jul 30, drop to Scope A (vocabulary + F1 fix) for the 08-11 demo |
| **Coarse-status ripple wider than expected** | Dispatcher list/SLA breaks in unforeseen spots after Stage 1 | `current_phase` denorm absorbs list/filter needs; derive elsewhere on read |
| **Environment fragility** (stale Docker 500 seen before) | Local API 500s / container shadows uvicorn | Verify against a clean local backend before blaming code; documented in known-issues |
| **Exam-defensibility** (graded; must own the patterns) | Can't explain plan-generation / derived state / idempotency at review | Budget review time per stage; keep patterns conventional, comment the *why* |

**Demo safety net (the deadline decision):** keep `dev`/`main` on the working H0–H5 flow; do this
refactor on a feature branch. The presentation must be able to stand on EITHER the new backend proof
(Stage 4 = dispatcher shows a multi-stop trip's derived phases, no driver app needed) OR the existing
flow. Never let the demo depend on Stage 5 landing.

---

## 7. Open items to resolve in the verification session (next chat)
1. Re-baseline §1/§5 against post-merge dev (what does Tim's geofence work already give P1/P2?).
2. Confirm phase-type value strings + step recipes per phase type.
3. Confirm `current_phase`/`current_stop` denormalization shape.
4. Confirm the guard/gate-scan decision (spec R1) — does any phase capture it, or geofence-only?
5. Presentation is **2026-08-11**; Go/No-Go by **~2026-08-04**. The pivotal variable is Tim's merge
   date — confirm it; if his merge slips past ~Jul 30, fall back to Scope A for the demo.
6. Decide whether fatter-anchor columns (F4) and the custody ledger (spec §8) are in this refactor or deferred.
