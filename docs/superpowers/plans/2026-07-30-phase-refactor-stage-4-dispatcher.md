# Phase Refactor — Stage 4: Dispatcher Re-wire (4.1 / 4.2 / 4.3 / 4.4 / 4.5)

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. Executed by subagents that start cold and cannot ask questions — every decision
> a cold agent would otherwise have to guess at is locked below in §Decisions.

**Created:** 2026-07-30 · **Owner:** Ciaran · **Branch:** `Phase-refactor`
**Parent plan:** `docs/superpowers/plans/2026-07-25-phase-model-refactor.md` — *that document is the
source of truth. If this plan and the parent disagree, the parent wins.*
**Predecessor:** `docs/superpowers/plans/2026-07-29-phase-refactor-stage-3-endpoints-and-schemas.md` —
read its **Findings ledger** before starting. NEW-15 and NEW-17, and the "Carried into Stage 4" list,
are inputs to this plan, not background reading; §Prerequisites restates the load-bearing ones inline.
**Status:** ready to execute.

**Goal:** the dispatcher stops describing trips as five fixed handshakes and starts rendering whatever
plan the ledger actually holds — a 7-row single-leg trip and an 11-row cross-dock trip through one code
path, with the derived active phase, per-stop evidence, and honest anchor state on screen. This is the
demo (parent §7, Stage 4).

**Architecture:** one pure derivation module (`dispatcher/lib/phase/derive.ts`) mirrors the backend's own
`_is_resolved` / `_recompute_position` logic and is the only place the dispatcher decides "where is this
trip"; every component reads from it. The shared TypeScript trip contract is cut over to the phase model
in a single commit — no parallel `Trip` type, no compatibility shim. Four small read-path fields
(`current_phase`, `current_stop`, `phase_total`, `phase_completed`) are added to the API so the trip
*list*, which carries no phase plan, can still show plan-driven progress.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.5+ (no `any`), Tailwind 3.4, vitest 3 +
jsdom + `@testing-library/react` (already configured at `frontend/dispatcher/vitest.config.ts`). Backend
side: Python 3.13, FastAPI 0.115+, SQLAlchemy 2.0 async, Pydantic v2, pytest + pytest-asyncio.

---

## Invariants — must not break

- Layering: endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db.
  `integrations/` never imports from `api/` or `orchestration/`. `db/` never imports from `app/`.
- POPIA: only SHA-256 hashes reach Hedera. No GPS, photos, names, or parcel details in any canonical
  payload. Personal data stays in Postgres. **This stage adds no anchor and changes no canonical
  payload.** It only *renders* evidence that is already in Postgres.
- RLS: FastAPI runs as `service_role` and bypasses RLS, so RLS breakage is SILENT. *(No RLS surface in
  this stage — no tables are added or renamed — but the invariant is restated per the template.)*
- **The ledger is the truth.** `current_phase`/`current_stop` are caches (parent D6). This stage puts
  them on the wire for the *list* view only, and that is a **read path**. No write path may branch on
  them, and the trip-**detail** page must derive the active phase from `trip.phases`, never from
  `trip.current_phase` — see U3's fence.
- **Length is data.** Nothing may hard-code 6 phases or sequence 0..6. A component with a fixed-length
  prop, an `Array.from({ length: 6 })`, a `Record<0|1|2|3|4|5, …>`, or an SLA denominator that assumes
  6 is a defect. **An 11-phase trip must not render >100%.**
- **Anchor honesty:** a phase may be `completed` while its `anchor_status` is `failed` — that pairing is
  what makes fail-open honest (parent D7, and the comment at `shared/lib/types/phase.ts:39-45`). Never
  render `failed` as an unqualified success.
- Never run git write commands. Suggest commits; the developer runs them.
- Latest stable only: SQLAlchemy 2.0 `Mapped`/`mapped_column`, Pydantic v2, async endpoints via
  `get_db()`, **no `any` in TypeScript**, React 19, App Router only.
- **`backend/tests/unit/test_phase_meta_contract.py` parses a frontend file.** It reads
  `frontend/shared/lib/constants/phase-meta.ts` and fails if `STEP_SLUGS` drifts from
  `backend/app/core/phase_meta.py` (Stage 3 decision S2). **If any task in this stage edits that TS
  file, the BACKEND suite goes red.** Either file may be corrected, but both must move together and the
  backend gate must be re-run. No task in this plan edits it — task 4.2 is fenced against it explicitly.

---

## Why now

Stage 3 made the frozen contract live HTTP. The dispatcher has been on the live API since well before
this refactor — 20 `api.get`/`api.post` call sites, real Supabase bearer auth with token caching in
`lib/api/client.ts`, and `useTripDetail` already calling `GET /api/v1/trips/{tripId}`. **There is no
"API wiring" work in this stage; it exists.** What does not exist is agreement between what that API now
returns and what the TypeScript says it returns, and the dispatcher is broken in four places because of
it (§Prerequisites, "The four live defects").

This is also the stage the presentation stands on. Parent §9: *"The presentation must stand on either the
new proof (Stage 4: dispatcher shows a multi-stop trip's derived phases, no driver app) or the existing
flow. Never let the demo depend on Stage 5 landing."* Stage 4 is the half of that sentence being built.

---

## Prerequisites

### Must be true before the first edit

| # | Condition | How to check | Expected |
|---|---|---|---|
| P1 | Branch is `Phase-refactor`, Stage 3 landed | `git log --oneline -3` | top commit is Stage 3's (`f8acfbf` or later) |
| P2 | Backend suite reproduces Stage 3's exit numbers | `cd backend && .venv/bin/python -m pytest -q` | **356 passed, 7 failed, 0 skipped** |
| P3 | Backend lint/type gates clean | `cd backend && .venv/bin/python -m ruff check . && .venv/bin/python -m mypy .` | `All checks passed!` · `Success: no issues found in 161 source files` |
| P4 | App imports | `cd backend && .venv/bin/python -c "import app.main" && echo IMPORTS-OK` | `IMPORTS-OK` |
| P5 | Dispatcher gates green **before** any edit | `cd frontend/dispatcher && npx tsc --noEmit && npx eslint .` | both exit 0 |
| P6 | Dispatcher deps installed | `cd frontend/dispatcher && ls -d node_modules` | present |
| P7 | Test Postgres up | `docker compose -f infrastructure/docker/docker-compose.test.yml ps` | `Up (healthy)`, port 5433 |

**All seven verified 2026-07-29 on `Phase-refactor`.** P2's numbers were measured, not quoted:
`7 failed, 356 passed, 204 warnings in 133.96s`.

**The 7 known-red failures are exactly Stage 3's named set** — they are pre-existing, they are **not this
stage's to fix**, and the count must not rise:
`test_verify_returns_no_receipt_for_unknown_subject`, `test_create_driver_returns_201_with_pending_status`,
`test_create_driver_appears_in_subsequent_list`, `test_create_driver_does_not_anchor_pii`,
`test_create_trip_response_shape`, `test_mixed_patch_anchors_only_critical_field`,
`test_update_vehicle_invalid_vin_leaves_db_state_unchanged`.

> **A new failure means stop.** `test_create_trip_response_shape` is red on
> `assert body["blockchain_receipts"] == []` (unmocked Hedera). Task 4.0 touches the schema that test
> reads; it must stay red **for that same reason** afterwards, and no claim may be made that it was
> fixed.

> ⚠️ **`frontend/driver-pwa/node_modules` is NOT installed.** Its `type-check`, `lint` and `test` scripts
> all report `command not found` while `npm` still exits 0 — a false green (Stage 3 ledger). **This stage
> must never record the driver-pwa gate as passing.** It is recorded as *not run*. See U1 for what this
> stage deliberately does to driver-pwa, and §Out of scope for what it does not.

### The four live defects — this is task 4.2 and 4.5's real content

Verified by reading the files on `Phase-refactor` 2026-07-29. **Neither `tsc --noEmit` nor `eslint .`
catches any of them** — both exit 0 today, while the pages throw against the live backend. They are
invisible to the static gates because the TypeScript still *claims* the old shape exists.

1. **`trip.handshakes` is gone from the API.** `frontend/shared/lib/types/trip.ts:117` declares
   `handshakes: HandshakeEvent[]`; `app/(app)/trips/[id]/page.tsx` reads `trip.handshakes` at `:264` and
   `:268`. The backend returns `phases` (`app/schemas/trips.py:401`). The page throws a `TypeError` on
   every trip-detail load today.
2. **`TripStatus` is still the old 10-value union.** `types/trip.ts:19-29` lists
   `origin_gate_in | loading | origin_gate_out | in_transit | dest_gate_in | unloading` alongside
   `created | closed | cancelled | exception_hold`. The backend went coarse in Stage 2
   (`db/models/enums.py`: `CREATED | ACTIVE | CLOSED | CANCELLED | EXCEPTION_HOLD`).
3. **Every advanced trip has already vanished from the dashboard.** `app/(app)/page.tsx:25-28`
   `ACTIVE_STATUSES` does not contain `'active'`, and `:78` filters on it. A trip that has been advanced
   past creation is silently absent from Active Trips.
4. **`TRIP_STATUS_META['active']` is `undefined`.** `shared/lib/constants/status-meta.ts:16` is keyed on
   the old union, so `statusMeta.chipType` throws at `trips/[id]/page.tsx:257` **and** at
   `ChecklistRow.tsx:108`. `ChecklistRow`'s `STATUS_HINT` (`:34`), `COMPLETED_THROUGH` (`:49`) and
   `IN_PROGRESS_HS` (`:63`) are all `Record<TripStatus, …>` on the same dead values.

**Any task that leaves the TypeScript type and the API response disagreeing is not done.** `tsc` will not
tell you. The browser walk in §Verification is what tells you.

### Already live from Stage 3 — do not rebuild, do not re-spell

- Three **driver-scoped** routes: `GET /api/v1/trips/{trip_id}/phases`,
  `GET /api/v1/trips/{trip_id}/phases/next`, `POST /api/v1/trips/{trip_id}/phases/{phase_event_id}/complete`.
  **The spelling is `/phases/next`, NOT `/next-phase`** — a recorded deviation from parent §3.2
  (Stage 3 ledger, S3–S8 outcome). Do not invent a third spelling.
- **The dispatcher does not call any of those three routes** (Stage 3 decision S3). They use
  `get_current_driver`; the dispatcher is a different auth principal. It reads the whole plan out of
  `GET /api/v1/trips/{id}` → `TripDetailResponse.phases`. **Do not give the dispatcher a second auth
  path.** Nothing in this plan adds a `useNextPhase` hook or similar.
- `TripDetailResponse.phases` carries `PhaseEventRead`: `id`, `trip_id`, `phase_type`,
  `sequence_number`, `status`, `anchor_status`, `trip_stop_id`, `stop_sequence`, `step_recipe`,
  `idempotency_key`, plus the evidence columns. **`stop_sequence` and `step_recipe` are DERIVED
  server-side, not columns** — built by `PhaseEventRead.from_event()`, never by `model_validate()`.
- `POST /trips` returns the **whole** plan, not just the `trip_creation` row (Stage 3 task 3.4).

### Carried from Stage 3's Findings ledger — restated because it binds this stage directly

- **NEW-15 — `PhaseEventRead.from_event()` has three call sites, each building its own stop map:** the
  phases endpoint, `resource_service.get_trip_detail`, and `trip_service.create_trip`. The latter two
  *are* the dispatcher contract this stage renders. `stop_sequence`/`step_recipe` are exactly the fields
  `model_validate()` leaves silently empty. **Task 4.0 adds a fourth construction site's worth of
  fields to the same two response schemas — extend the existing NEW-15 tests rather than writing new
  ones that cover the endpoint only.**
- **NEW-17 — S1's confirmation origin baseline is wrong on a multi-pickup → multi-drop trip.** Not
  fixed; it is F1 / Stage 3-B territory. **It does not block Stage 4** — the dispatcher renders the
  ledger, it does not reconcile counts. But the seeded cross-dock trip (`FP-DEMO-XDOCK-0001`, a 3-stop
  hub shape) is *inside* the shape S1 handles correctly, so the demo is not standing on the broken case.
  Do not seed a multi-pickup → multi-drop trip in task 4.1 without reading NEW-17 first.
- **Only exceptions remain mocked in the dispatcher.** `lib/hooks/useExceptions.ts`,
  `app/(app)/exceptions/page.tsx`, `app/(app)/exceptions/[id]/page.tsx`, and the `mockTrips` lookup at
  `app/(app)/page.tsx:104`. Exception **counts** are already live via `open_exception_count` on trip
  summaries. `backend/app/api/v1/endpoints/exceptions.py` exposes **only `POST ""`** — no list route, no
  get-by-id — so live exceptions need new backend endpoints first. **Out of scope for Stage 4**; recorded
  as its own follow-on stage in §Out of scope.
- **`frontend/shared/lib/types/phase.ts` and `constants/phase-meta.ts` are already correct** (Stage 0.4's
  frozen contract, re-verified 2026-07-29). `phase.ts` documents the seal at departure and carries
  `pod_signature_artifact_id`; `phase-meta.ts` keys step recipes by phase *type* with no fixed-length
  constant. **`phase-meta.ts` must not be edited in this stage** — the backend contract test parses it.

### Read while writing this plan — current, verified shape of every file this stage touches

Confirmed by reading the actual files on `Phase-refactor` at `f8acfbf`:

- `frontend/dispatcher/app/(app)/trips/[id]/page.tsx` (505 lines) — `ACTIVE_HS_FOR_STATUS` declared
  `:25`, used `:266`; `trip.handshakes` read `:264`, `:268`; hard-coded `sequence_number === 0` at `:269`
  and `=== 2` at `:272`; `HANDSHAKE_NAMES[hs.sequence_number as HandshakeNumber]` at `:331`; the
  `hs.sequence_number <= 3 ? originShort : destShort` location guess at `:334`; `sortedHandshakes.length + 1`
  as the anchor denominator at `:486`.
- `frontend/dispatcher/components/domain/HandshakeChain.tsx` (80 lines) — docstring says *"Horizontal
  6-node progress indicator showing handshakes 0–5"*. Takes `handshakes: HandshakeEvent[]`, labels via
  `HANDSHAKE_NAMES[hs.sequence_number as HandshakeNumber]`, draws a connector when `sequence_number > 0`.
- `frontend/dispatcher/components/domain/ChecklistRow.tsx` (200 lines) — **its only consumer.** Three
  dead `Record<TripStatus, …>` tables (`:34`, `:49`, `:63`), `chainNodesFromStatus()` at `:82` with a
  literal `Array.from({ length: 6 })` at `:86` and an `as HandshakeEvent` cast at `:102`. Used by
  `app/(app)/page.tsx:274` and `app/(app)/history/page.tsx:214`.
- `frontend/dispatcher/lib/hooks/useStepIndicator.ts` (23 lines) — imports `HANDSHAKE_NAMES`,
  `HANDSHAKE_STEP_COUNTS`, `STEP_NAMES` and uses `HANDSHAKE_STEP_COUNTS[handshake]` as a fixed
  denominator at `:21`. **Verified 2026-07-29: it has ZERO consumers in the dispatcher.** `grep -rn
  "useStepIndicator" app components lib` returns only its own definition line. It is dead code. (The
  driver-pwa has its own separate copy at `driver-pwa/lib/hooks/useStepIndicator.ts` — a different file,
  Tim's, not touched here.)
- `frontend/dispatcher/lib/hooks/useSLAMetrics.ts` (13 lines) — `handshakeCompletionPct` at `:6`. **The
  whole hook is a stub that returns `null`** (`// Phase 1 stub — returns null until the SLA metrics API
  endpoint is wired up`). Its only consumer is `app/(app)/sla/page.tsx`, which renders an `EmptyState`
  on every card because `metrics` is always null. Task 4.6 is therefore a rename, not a calculation —
  see U12.
- `frontend/dispatcher/lib/hooks/useTrips.ts` (47 lines) — `api.get<TripSummary[]>('/api/v1/trips')`,
  client-side filter on `filter.status`. Shape is fine; only the `TripStatus` values it filters on change.
- `frontend/dispatcher/app/(app)/page.tsx` — `ACTIVE_STATUSES` `:25-28`, active filter `:78`, closed
  filter `:83`, `mockTrips` lookup `:104` (exceptions — out of scope, but the import must keep resolving).
- `frontend/dispatcher/app/(app)/history/page.tsx` — `CLOSED_STATUS: TripStatus[] = ['closed','cancelled']`
  at `:21`. **Both values survive the coarse collapse**, so this file needs no logic change.
- `frontend/shared/lib/types/trip.ts` (159 lines) — `TripStatus` `:19-29`, `TripSummary` `:47-65`,
  `Trip` `:96-125` with `handshakes: HandshakeEvent[]` at `:117`.
- `frontend/shared/lib/types/phase.ts` (159 lines) — correct and frozen. Declares `PhaseDescriptor`,
  `PhaseStatus`, `AnchorStatus`, `CoarseTripStatus`, and **`TripWithPhases` at `:130`, which has zero
  consumers** (verified). U2 deletes it rather than leaving two Trip interfaces to drift apart.
- `frontend/shared/lib/constants/status-meta.ts` (83 lines) — `TRIP_STATUS_META` `:16` on the dead union;
  `HANDSHAKE_STATUS_META` `:31`. Also holds `ChipType`, the exception meta maps and the exception type
  groupings — **all of which stay**, and two of which driver-pwa imports.
- `frontend/shared/lib/mocks/trips.ts` (761 lines) — 7 trips, all built with the same `twoStops()` helper
  (`:46`), so **every mock trip is a 2-stop / 7-row plan**. Exports `TRIP_0035_ID`…`TRIP_0043_ID`, which
  `mocks/checkpoints.ts` and `mocks/manifests.ts` import, and `mockTrips`, from which
  `mocks/exceptions.ts:6` derives `mockExceptions` via `.flatMap(t => t.exceptions)`. **All of those
  exports must survive task 4.2's rewrite.**
- `frontend/shared/lib/mocks/phase-trips.ts` (152 lines) — Stage 0.4's `makePhasePlan()` generator plus
  canonical 7-row and 11-row fixtures. **Kept and reused** by the rewritten `mocks/trips.ts` (U1c).
- `backend/app/schemas/trips.py` — `TripListItemResponse` `:179-203`, `TripDetailResponse` `:377-408`.
  **Neither carries `current_phase`/`current_stop`.** They are DB columns (`db/models/trips.py:154-155`)
  maintained by `phase_service._recompute_position` and never put on the wire. Task 4.0.
- `backend/app/orchestration/resource_service.py` — `list_trips` `:52-127` (already batches an
  `open_exception_count` grouped COUNT, the exact pattern task 4.0 copies), `get_trip_detail` `:130-241`.
- `backend/app/orchestration/trip_service.py:368-372` — completes h0 inline. **Defect found while
  writing this plan: it never seeds `trip.current_phase`/`current_stop`,** so a freshly created trip has
  `current_phase = NULL` until its first advance. See U4.
- `backend/app/orchestration/phase_service.py:159` — `_recompute_position`. **One call site** (`:225`).
  Does not import `trip_service`; `trip_service` does not import `phase_service`. U4's rename introduces
  no cycle.
- `backend/scripts/seed_trips.py` (~180 lines) — seeds `FP-DEMO-SINGLE-0001` (7 rows) and
  `FP-DEMO-XDOCK-0001` (11 rows). **Both are `TripStatus.CREATED` with every phase `PENDING`**, so
  neither exercises the derived-active marker or defect #3. Task 4.1.

### Environment

Python is `backend/.venv/bin/python`. Node commands run from `frontend/dispatcher`. Never read, print or
log `backend/.env` or any `.env.local`. The test DB (`TEST_DATABASE_URL`, port 5433) is `create_all`-built
with no Supabase `auth` schema and no RLS. The **browser** verification in §Verification runs against the
refactor Supabase project via `backend/.env`'s `DATABASE_URL` — parent §5.4's second project, never the
shared dev DB.

---

## Decisions taken while writing this plan

These close forks a cold agent would otherwise guess at. They sit **below** parent §1's D1–D9, Stage 1's
S1–S6, Stage 2's T1–T8 and Stage 3's S1–S8; none reopens a locked decision. They are lettered **U** to
avoid colliding with Stage 1's and Stage 3's overlapping `S` numbering.

### U1 — The clean cut is **full**: four shared modules go phase-only in one commit — *decided by Ciaran, 2026-07-30*

Three options were put to Ciaran: an additive cut (dispatcher moves to `phase.ts`, legacy left intact), a
trip-contract-only cut, and a full cut. **Chosen: the full cut**, on the stated reasoning that the
dispatcher should be *fully* integrated with the phase model and Tim maps driver-pwa onto the same types
in Stage 5.

Concretely, task 4.2:

- **`types/trip.ts`** — `TripStatus` becomes the coarse union; `Trip.handshakes: HandshakeEvent[]` becomes
  `phases: PhaseDescriptor[]`; `Trip` and `TripSummary` both gain `current_phase`/`current_stop`;
  `TripSummary` also gains `phase_total`/`phase_completed` (U3).
- **`types/handshake.ts`** — **deleted.**
- **`constants/handshake-meta.ts`** — **deleted.**
- **`constants/status-meta.ts`** — `TRIP_STATUS_META` re-keyed coarse; `HANDSHAKE_STATUS_META` renamed
  `PHASE_STATUS_META` and keyed on `PhaseStatus`. Everything else in the file is untouched.
- **`mocks/trips.ts`** — rewritten phase-shaped, keeping every currently-exported symbol.

**The cost, stated plainly because it is real and it lands on another developer.** Measured 2026-07-29:

| Shared module | driver-pwa files that stop compiling |
|---|---|
| `types/trip.ts` + `mocks/trips.ts` | 17 |
| `types/handshake.ts` + `constants/handshake-meta.ts` | 21 |
| **Union (the full cut)** | **32** |

`frontend/driver-pwa` will not type-check after task 4.2 lands, and this stage does not repair it — that
is Stage 5, Tim's, and parent §6.1 puts driver-pwa outside Ciaran's ownership. Tim's *total* Stage 5 work
is unchanged by this choice: 5.1 already replaces the fixed `[h]` 1–5 route and the fixed-length
constants, and 5.4 already decides the fate of the `H{n}*.tsx` components. What changes is *when* his
build goes red — the day this stage lands, rather than when he gets to it.

> 🔴 **Executing agent: task 4.2 has a mandatory non-code step.** Tim must be told before the commit is
> pushed, not after. The task's final step produces
> `docs/superpowers/stage-5-breakage-inventory.md` — the enumerated list of driver-pwa files and the
> exact symbols each one loses — so Stage 5's scope is knowable from a document rather than from a build
> failure. Do not skip it; a cold agent cannot judge that this is optional, because it isn't.

**U1c — `mocks/phase-trips.ts` is kept, not folded in.** It already holds `makePhasePlan()`, the plan
generator that mirrors `orchestration/phase_plan.build_phase_plan`, plus the canonical 7-row and 11-row
fixtures. The rewritten `mocks/trips.ts` imports `makePhasePlan` from it. Deleting it would mean either
duplicating the generator or hand-writing 7 plans as literals — both worse. Its header comment, which
currently explains why it was created *alongside* `trips.ts`, is updated in the same task.

### U2 — `TripStatus` keeps its name and becomes an alias of `CoarseTripStatus`; `TripWithPhases` is deleted

Ten files import `TripStatus` from `@shared/lib/types/trip`. Renaming the symbol would churn all of them
for no gain, and `status` is genuinely the trip's own field. So `types/trip.ts` keeps exporting
`TripStatus` — as an alias of the coarse union that `phase.ts` already defines:

```ts
export type { CoarseTripStatus as TripStatus } from './phase'
```

`phase.ts` stays the definition site because "coarse status" is phase-model vocabulary (parent §2.3), and
single-sourcing it means the two files cannot drift. The resulting `trip.ts ↔ phase.ts` cycle is
**type-only**, which TypeScript erases at compile time — but it must be written with `import type` /
`export type` at both ends, never a value import, or the bundler will see a real cycle.

**`TripWithPhases` (`phase.ts:130-159`) is deleted in the same task.** It was Stage 0.4's forward
declaration of what `Trip` would become; after task 4.2, `Trip` *is* that shape. Verified 2026-07-29 that
nothing imports it. Keeping two structurally identical interfaces is precisely the halfway state the
parent forbids.

### U3 — Four read-path fields go on the API: `current_phase`, `current_stop`, `phase_total`, `phase_completed`

Parent §7 task 4.4 requires *"phase-level filter/sort off `current_phase`"* on the trip list. That is not
implementable today: `current_phase`/`current_stop` are DB columns that reach no response schema, and
`TripSummary` carries no phase plan at all — so the dashboard has no way to know a trip is on phase 6 of
11. Ciaran's call, 2026-07-30: **add the fields.**

| Schema | Fields added |
|---|---|
| `TripDetailResponse` | `current_phase: str \| None`, `current_stop: int \| None` |
| `TripListItemResponse` | `current_phase`, `current_stop`, `phase_total: int`, `phase_completed: int` |

`phase_total`/`phase_completed` come from one grouped COUNT in `list_trips`, copying the shape of the
`open_exception_count` query that is already there (`resource_service.py:96-105`) — same batching, no
N+1. They are what make "length is data" visible on a list view: a row can honestly read
`Unloading · stop 2 · 6/11`.

> 🔴 **Fence — these are caches, and the invariant still binds.** They are added for **read paths only**.
> The trip-**detail** page has the full plan in `trip.phases` and **must derive the active phase from it**
> via `derive.ts`, never from `trip.current_phase`. Stage 3's S7 made the same call for
> `GET /phases/next` and gave the reason: if the cache ever diverges from the ledger, the derived view
> tells the truth and the divergence becomes visible instead of being laundered. The *list* view has no
> ledger to derive from, which is the only reason it may read the cache.

### U4 — `create_trip` must seed the position cache; `_recompute_position` becomes public — *defect found while writing this plan*

`trip_service.create_trip` completes the `trip_creation` row inline (`:368-372`) but never sets
`trip.current_phase`/`current_stop`. The cache is only ever populated by `phase_service._recompute_position`,
which runs on the *first advance*. So every freshly created trip sits in the database with
`current_phase = NULL` while phase 1 is plainly next — and after U3 puts that field on the wire, the
dashboard would show a blank phase for exactly the trips a dispatcher just made.

**Fix:** rename `_recompute_position` → `recompute_position` (one internal call site, `phase_service.py:225`)
and call it from `create_trip` after h0 completes and before the response is assembled.

Two things a cold agent must know:

1. **It also closes trips.** `recompute_position` sets `trip.status = CLOSED` and `closed_at` when nothing
   is unresolved. In `create_trip` that branch is unreachable — h0 is the only completed row and
   `build_phase_plan` always emits at least `activation` after it — but the test in task 4.0 asserts the
   trip is still `CREATED` afterwards, so the day that stops being true it fails loudly.
2. **No import cycle.** `phase_service` does not import `trip_service` and vice versa; both already import
   `resource_service`. Verified 2026-07-29.

### U5 — All phase derivation lives in one pure module, `dispatcher/lib/phase/derive.ts`

No component computes "which phase is current" for itself. `derive.ts` is pure — no React, no fetch, no
`Date.now()` — which is what lets vitest prove it. That matters more here than usual: **both static gates
passed green while the trip-detail page was throwing**, so a test on the derivation is the only net this
stage can actually add. It mirrors the backend's own predicate and query
(`phase_service._is_resolved`, `recompute_position`) so the two surfaces cannot disagree about what
"current" means.

### U6 — `PhaseChain` takes normalised nodes, not `PhaseDescriptor[]`

`HandshakeChain`'s only consumer is `ChecklistRow`, which renders in the trip **list** — and after U3 the
list carries counts, not a plan. So a `PhaseDescriptor[]` prop would force `ChecklistRow` back into
faking descriptor objects, which is exactly the `as HandshakeEvent` cast (`ChecklistRow.tsx:102`) this
stage is deleting.

`PhaseChain` therefore takes `nodes: readonly PhaseChainNode[]` where
`PhaseChainNode = { key: string; status: PhaseStatus; label: string }`, and `derive.ts` owns the one
builder, `chainNodesFromCounts(total, completed, currentLabel)`. Length comes from `phase_total`, which
the backend derived from the ledger — not from a status enum, which is what made the old
`chainNodesFromStatus` wrong.

**This is a deliberate reading of parent §7 task 4.3** (*"render N nodes from the phase list"*): N is the
plan's real length, sourced from the ledger; the list view just receives it as a count because it has no
plan to receive. Recorded so a reviewer does not read it as a shortcut.

**U6b — compact nodes are dots, not icons.** The PROGRESS column is 300px and an 11-node chain at the old
compact sizing (`w-5` node + `w-3` connector) needs ~340px, so it would clip. Compact mode renders
`w-2 h-2` dots with `w-2` connectors — 11 nodes fit in ~168px — and `ChecklistRow` puts the literal
`{completed}/{total}` in its hint text, so the number survives even if the chain is ever clipped.
Non-compact mode keeps the icons.

### U7 — Display rules where a phase type occurs more than once

A multi-stop plan repeats `loading`, `departure`, `in_transit` and `unloading`. Three places in the
current page pick "the" one by index and must instead pick by rule:

| What | Old (index) | New (rule) |
|---|---|---|
| Sidebar **Seal** | `handshakes.find(h => h.seal_number)` | the seal on the **highest-sequence `completed` `departure`** — i.e. the seal actually on the vehicle now |
| Sidebar/timeline **parcel count** | `sequence_number === 2` | `parcel_count_origin` of the **lowest-sequence `loading`** — the origin pickup |
| Timeline **event label** | `HANDSHAKE_NAMES[sequence_number]` | `PHASE_NAMES[phase_type]`, disambiguated by a `Stop {stop_sequence} · {precinct}` meta line — **never by index** |
| Timeline **location** | `sequence_number <= 3 ? origin : dest` | resolved from `stop_sequence` → `trip.stops` → precinct name |

Each timeline row still shows **its own** seal in its detail line, so a cross-dock trip visibly carries
two seals across two legs. That is the multi-stop proof made visible, and it is the thing a reviewer is
walked through.

### U8 — The anchor tally is computed from `anchor_status`, never from plan length

`trips/[id]/page.tsx:486` currently renders `{anchoredCount} of {sortedHandshakes.length + 1} receipts
anchored` — a denominator that assumes every phase is anchored. Under parent D7 exactly three phase types
are (`trip_creation`, `departure`, `confirmation`), and a plan may contain several `departure` rows.

`derive.ts` exports `anchorTally(phases) → { owed, anchored, failed }`: `owed` counts phases whose
`anchor_status !== 'not_required'`, `anchored` counts `'anchored'`, `failed` counts `'failed'`. The panel
reads `{anchored} of {owed} receipts anchored`, and **when `failed > 0` it renders a warning line**. The
invariant and `phase.ts:39-45` both require this: a `completed` phase with a `failed` anchor must never
render as an unqualified success.

### U9 — The demo dataset gains a third, partially-walked trip

Both seeded trips are `CREATED` with every phase `PENDING`, so in a browser the timeline is uniformly
grey, the derived-active marker never appears, and live defect #3 (advanced trips missing from the
dashboard) is invisible. `scripts/seed_trips.py` gains an `advance_through: int | None` parameter and a
third trip:

**`FP-DEMO-ACTIVE-0001`** — 3 stops, same cross-dock consignment legs as `FP-DEMO-XDOCK-0001`, 11 rows,
`status=ACTIVE`, phases 0–4 completed (`trip_creation` → `activation` → `loading` → `departure` →
`in_transit` at stop 1), current phase `unloading` at stop 2, with a seal on the completed departure and
a parcel count on the completed loading so the evidence panels have something real to render.

**Fence:** the seeder writes rows directly and does **not** call `advance_phase` — the file's existing
docstring already explains why (P0 anchoring is fail-closed, so `create_trip` would put a Hedera testnet
round-trip inside a seed). `advance_through` therefore sets `status`, `completed_at` and the evidence
fields on the rows it marks, and sets `current_phase`/`current_stop` from the plan — **it must not
reimplement gating, anchoring or reconciliation.** Seeded trips keep `journey_lock_hash = NULL` and an
unanchored P0, exactly as the two existing ones do.

### U10 — The dispatcher's `tsc` gate is red from task 4.2 until task 4.6, by construction

Task 4.2 deletes the types the pages still use; tasks 4.4 and 4.5 are what repair them. This is the same
shape as Stage 3's NEW-13 and it is planned for rather than discovered:

| After task | `cd frontend/dispatcher && npx tsc --noEmit` | What is green instead |
|---|---|---|
| 4.0, 4.1 | ✅ green (backend-only tasks) | backend `pytest`, `ruff`, `mypy` |
| **4.2** | ❌ red — `Module '"@shared/lib/types/handshake"' has no exported member` in `HandshakeChain.tsx`, `ChecklistRow.tsx`, `useStepIndicator.ts`, `trips/[id]/page.tsx`; `Property 'handshakes' does not exist on type 'Trip'` | nothing — commit anyway (U10a) |
| **4.3** | ❌ still red (same files) | `npx vitest run lib/phase` — the new module's own tests |
| **4.4** | ❌ red in `trips/[id]/page.tsx` **only** | `npx vitest run` — full dispatcher suite |
| **4.5** | ✅ green | |
| 4.6 | ✅ green + `eslint` + browser walk | |

**U10a — commit the red intermediate states.** The alternative is one enormous commit spanning the shared
contract and every consumer, which no reviewer can read. Each task's commit is coherent on its own; the
*stage* is what must end green. **A cold agent must not treat the red `tsc` after 4.2/4.3/4.4 as a
failure to debug** — it must check the error list against the table above, and stop only if an error
appears that is **not** in a file the remaining tasks touch.

### U11 — `dispatcher/lib/hooks/useStepIndicator.ts` is deleted, not ported

Verified 2026-07-29: zero consumers in the dispatcher. It is the last dispatcher-side importer of
`HANDSHAKE_STEP_COUNTS`/`STEP_NAMES` and it exists only because it was copied from driver-pwa (which has
its own separate copy that stays Tim's). Porting dead code to the phase model would mean inventing a
"step indicator" concept the dispatcher does not have — the dispatcher never walks driver steps, it
renders completed evidence. Delete.

### U12 — `useSLAMetrics` stays a stub; only the field name and one label change

The hook returns `null` unconditionally and every SLA card renders an `EmptyState`. Parent §7 4.5 says its
denominator "must take its length from the plan" — but there is no denominator, because there is no
calculation. Building a real SLA endpoint is a new feature, not a phase-refactor ripple, and it is not on
the critical path to the demo.

So: `handshakeCompletionPct` → `phaseCompletionPct` in the interface, and `app/(app)/sla/page.tsx`'s
*"Handshake completion rate"* card title → *"Phase completion rate"*. The genuine length-is-data risk the
parent was pointing at is covered where it is real — `derive.ts`'s `completionPct`, which task 4.3 tests
against an 11-row plan for the `>100%` case.

### U13 — An active trip's status chip carries its **phase name**, not the flat word "Active" — *decided by Ciaran, 2026-07-30*

The coarse collapse takes six chip labels (`At Origin Gate`, `Loading`, `Gate Out`, `In Transit`,
`At Dest. Gate`, `Unloading`) down to one. That is correct at the *data* level — `trip.status` genuinely
is just `active` now — but it is a UX regression: the chip is the one thing a dispatcher reads at a
glance, and it would go from naming the step to naming nothing. Ciaran's call, 2026-07-30: *"it originally
showed handshakes so now it should show the dispatcher what phase the trip is in."*

So the chip label for `status === 'active'` is `PHASE_NAMES[current_phase]` — `Loading`, `Departure`,
`Unloading` — keeping `chipType: 'transit'`.

**`exception_hold` shows the phase too, prefixed** — `⚠ Unloading`, keeping `chipType: 'exception'` so
the chip stays amber. Ciaran, 2026-07-30: *"it should probably show the phase as well"* — **as well**, not
instead: a held trip's two facts are that it is held and where it stopped, and the dispatcher needs both.
The `⚠` prefix carries the first, the amber container reinforces it, and the phase name carries the
second. The prefix matches the `⚠` convention this codebase already uses in `ChecklistRow`'s hint
(`⚠ 2 exceptions`) and in the timeline's anchor warning, so it introduces no new vocabulary.

`created`, `closed` and `cancelled` are **unchanged**: terminal or pre-start states where the position
adds nothing. A `created` trip has not started, and a `closed` one has no current phase to name.

**On width:** `Chip` takes no fixed width (`components/ui/Chip.tsx` — a padded `span` with a 6×6 dot, no
icons), and the longest label either branch can produce — `⚠ Confirmation`, 14 characters — is no longer
than `At Origin Gate`, the longest label it renders today. `ChecklistRow`'s 120px STATUS column therefore
needs no change.

One helper, `tripChipMeta(status, currentPhase)`, lives in `derive.ts` (U5: one derivation module) and is
used by both call sites. **The two call sites source `currentPhase` differently, and that is deliberate,
not an inconsistency:**

| Call site | Source | Why |
|---|---|---|
| `ChecklistRow` (list) | `trip.current_phase` | the list carries no plan — this is the read-path exemption U3 grants |
| `trips/[id]/page.tsx` (detail) | `activePhase(trip.phases)?.phase_type` | the detail view has the ledger and **must derive** — U3's fence forbids reading the cache here |

`TRIP_STATUS_META.active` stays in `status-meta.ts` as the fallback for the shouldn't-happen case of an
`active` trip with `current_phase === null`, so a cache gap degrades to the word "Active" rather than to
`undefined` and a TypeError — which is precisely live defect #4, and must not be reintroduced by the fix
for it.

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `backend/app/schemas/trips.py` | modify | `current_phase`/`current_stop` on `TripDetailResponse`; those plus `phase_total`/`phase_completed` on `TripListItemResponse` (U3) |
| `backend/app/orchestration/resource_service.py` | modify | populate the new fields in `list_trips` (grouped COUNT) and `get_trip_detail` |
| `backend/app/orchestration/trip_service.py` | modify | call `recompute_position` after h0 completes; populate the new fields (U4) |
| `backend/app/orchestration/phase_service.py` | modify | `_recompute_position` → `recompute_position` (U4) |
| `backend/scripts/seed_trips.py` | modify | `advance_through` + the third partially-walked trip (U9) |
| `backend/tests/integration/test_trips.py` | modify | assert the four new fields on both shapes |
| `backend/tests/unit/test_phase_service.py` | modify | `recompute_position` rename; create-trip cache assertion |
| `frontend/shared/lib/types/trip.ts` | modify | coarse `TripStatus` alias, `phases`, the cache fields (U1/U2/U3) |
| `frontend/shared/lib/types/phase.ts` | modify | delete `TripWithPhases` (U2). **`PhaseDescriptor` itself is untouched** |
| `frontend/shared/lib/types/handshake.ts` | **delete** | superseded by `phase.ts` (U1) |
| `frontend/shared/lib/constants/handshake-meta.ts` | **delete** | superseded by `phase-meta.ts` (U1) |
| `frontend/shared/lib/constants/status-meta.ts` | modify | coarse `TRIP_STATUS_META`; `HANDSHAKE_STATUS_META` → `PHASE_STATUS_META` |
| `frontend/shared/lib/mocks/trips.ts` | modify | rewritten phase-shaped, same exported symbols (U1) |
| `frontend/shared/lib/mocks/phase-trips.ts` | modify | header comment only — the generator is reused (U1c) |
| `frontend/dispatcher/lib/phase/derive.ts` | **create** | the single derivation module (U5), incl. `tripChipMeta` (U13) |
| `frontend/dispatcher/lib/phase/derive.test.ts` | **create** | vitest, including the 11-row and `>100%` guards |
| `frontend/dispatcher/components/domain/PhaseChain.tsx` | **create** | N-node chain from normalised nodes (U6) |
| `frontend/dispatcher/components/domain/HandshakeChain.tsx` | **delete** | superseded |
| `frontend/dispatcher/components/domain/ChecklistRow.tsx` | modify | three dead `Record<TripStatus,…>` tables out; counts-driven chain in |
| `frontend/dispatcher/app/(app)/trips/[id]/page.tsx` | modify | plan-driven timeline; `ACTIVE_HS_FOR_STATUS` and both index lookups deleted |
| `frontend/dispatcher/app/(app)/page.tsx` | modify | `ACTIVE_STATUSES` → coarse |
| `frontend/dispatcher/lib/hooks/useStepIndicator.ts` | **delete** | dead code (U11) |
| `frontend/dispatcher/lib/hooks/useSLAMetrics.ts` | modify | field rename only (U12) |
| `frontend/dispatcher/app/(app)/sla/page.tsx` | modify | one card title (U12) |
| `docs/superpowers/stage-5-breakage-inventory.md` | **create** | the enumerated driver-pwa handover (U1) |

**No Alembic migration.** No column is added, dropped or renamed — `current_phase`/`current_stop` have
existed since Stage 1, and `phase_total`/`phase_completed` are computed at read time.

**Shared files touched (CLAUDE.md — flag every one in TASK COMPLETE):** `backend/app/schemas/trips.py`,
and all five `frontend/shared/lib/**` files. `backend/app/main.py` and `db/models/__init__.py` are **not**
touched.

---

## Tasks

Seven tasks. Each states **Files**, numbered checkbox steps, and a **Fence**. Commit after each. Tasks
4.0 and 4.1 are backend-only and leave every gate green; 4.2 through 4.5 run inside U10's known-red
window.

---

### Task 4.0 — Expose the position cache and the plan counts on the API

**Files:**
- Modify: `backend/app/schemas/trips.py` (`TripListItemResponse` ~`:179-203`, `TripDetailResponse` ~`:377-408`)
- Modify: `backend/app/orchestration/resource_service.py` (`list_trips` ~`:52-127`, `get_trip_detail` ~`:130-241`)
- Modify: `backend/app/orchestration/phase_service.py` (`:159`, `:225`)
- Modify: `backend/app/orchestration/trip_service.py` (~`:368-372`, ~`:387-420`)
- Test: `backend/tests/integration/test_trips.py`, `backend/tests/unit/test_phase_service.py`

**Fence:** these fields are **read-path only** (U3). Do not add them to any request schema, do not filter
or branch on them anywhere in `orchestration/`, and do not touch `_gate_and_load` or any `advance_*`
wrapper. The only behaviour change in this task is U4's missing `recompute_position` call in
`create_trip`. Do not "fix" any of the 7 known-red tests.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/integration/test_trips.py`. Read the file's existing fixtures first and follow
their construction — do not invent a new trip fixture.

```python
async def test_create_trip_response_carries_seeded_position_cache(async_client, dispatcher_headers):
    """U4: create_trip completes h0 inline but never seeded trip.current_phase,
    so a freshly created trip reported no current phase at all until its first
    advance. The cache must be derived the moment the plan exists."""
    response = await async_client.post(
        "/api/v1/trips", json=_valid_trip_payload(), headers=dispatcher_headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "created"
    assert body["current_phase"] == "activation"
    assert body["current_stop"] == 1


async def test_trip_list_item_carries_plan_counts(async_client, dispatcher_headers):
    """U3: TripSummary has no phase plan, so the dashboard cannot show plan-driven
    progress without these. phase_total is the plan's own length — never 6, never 7
    as a constant."""
    create = await async_client.post(
        "/api/v1/trips", json=_valid_trip_payload(), headers=dispatcher_headers,
    )
    created = create.json()

    response = await async_client.get("/api/v1/trips", headers=dispatcher_headers)

    assert response.status_code == 200
    row = next(t for t in response.json() if t["id"] == created["id"])
    assert row["phase_total"] == len(created["phases"])
    assert row["phase_completed"] == 1          # trip_creation only
    assert row["current_phase"] == "activation"
    assert row["current_stop"] == 1
```

> **Executing agent:** `_valid_trip_payload()` and `dispatcher_headers` are placeholders for whatever this
> file already uses to POST a valid trip — read `test_create_trip_response_shape` and reuse its exact
> payload builder and fixtures. Do not create a second one.

- [ ] **Step 2: Run them and confirm they fail for the right reason**

```
cd backend && .venv/bin/python -m pytest \
  tests/integration/test_trips.py::test_create_trip_response_carries_seeded_position_cache \
  tests/integration/test_trips.py::test_trip_list_item_carries_plan_counts -v
```

Expected: FAIL with `KeyError: 'current_phase'` / `KeyError: 'phase_total'` — the fields are absent from
the response. **If either fails with a 500, a fixture error, or a validation error instead, stop and fix
the test.** A test that fails for the wrong reason proves nothing.

- [ ] **Step 3: Add the fields to the two response schemas**

In `backend/app/schemas/trips.py`, add to `TripDetailResponse` immediately after `closed_at`:

```python
    # Denormalised position cache (parent D6). READ PATH ONLY — the ledger in
    # `phases` below is the truth, and the dispatcher's trip-detail view derives
    # the active phase from it. These exist so list views need not recompute.
    current_phase: Optional[str] = None
    current_stop: Optional[int] = None
```

and to `TripListItemResponse` immediately after `open_exception_count`:

```python
    # The list view carries no phase plan, so it cannot derive position at all —
    # these four are the only thing that lets a row read "Unloading · stop 2 · 6/11".
    # phase_total is the plan's OWN length: 7 on a single-leg trip, 11 on a
    # cross-dock one. Nothing may assume either number.
    current_phase: Optional[str] = None
    current_stop: Optional[int] = None
    phase_total: int
    phase_completed: int
```

- [ ] **Step 4: Populate them in `get_trip_detail`**

In `backend/app/orchestration/resource_service.py`, in the `TripDetailResponse(...)` construction
(~`:218`), add after `closed_at=trip.closed_at,`:

```python
        current_phase=trip.current_phase,
        current_stop=trip.current_stop,
```

- [ ] **Step 5: Populate them in `list_trips`**

In the same file, immediately after the existing `exc_counts` block (~`:96-105`), add a second grouped
COUNT built the same way — one query for the whole page, no N+1:

```python
    # Same batching shape as exc_counts above: one grouped query for the page.
    # `completed` here means "resolved" in the ledger's sense — an overridden phase
    # will never be revisited either, so it counts as done for a progress bar.
    plan_result = await db.execute(
        select(
            PhaseEvent.trip_id,
            func.count(PhaseEvent.id),
            func.count(PhaseEvent.id).filter(
                PhaseEvent.status.in_([PhaseStatus.COMPLETED, PhaseStatus.OVERRIDDEN])
            ),
        )
        .where(PhaseEvent.trip_id.in_(trip_ids))
        .group_by(PhaseEvent.trip_id)
    )
    plan_counts: dict[uuid.UUID, tuple[int, int]] = {
        row[0]: (row[1], row[2]) for row in plan_result.all()
    }
```

and inside the `TripListItemResponse(...)` comprehension, after `open_exception_count=...`:

```python
            current_phase=t.current_phase,
            current_stop=t.current_stop,
            phase_total=plan_counts.get(t.id, (0, 0))[0],
            phase_completed=plan_counts.get(t.id, (0, 0))[1],
```

Add `PhaseStatus` to the existing `from app.db.models.enums import ...` line.

- [ ] **Step 6: Make `recompute_position` public**

In `backend/app/orchestration/phase_service.py`, rename `_recompute_position` → `recompute_position`
(definition `:159`, call site `:225`). Extend its docstring's first line:

```python
async def recompute_position(db: AsyncSession, trip: Trip) -> None:
    """Steps 8-9 of parent §2.4. Public because create_trip must seed the cache the
    moment the plan exists (U4) — before this, a freshly created trip reported
    current_phase = NULL until its first advance.

    trip_stop_id is a FK, not the sequence int D6 wants cached — the join to
    TripStop.sequence is why this can't be a plain PhaseEvent-only query.
    """
```

Update the two comments that name it by its old name (`:504`, `:590`) and the two docstrings in
`tests/unit/test_phase_service.py` (`:757`, `:813`).

- [ ] **Step 7: Call it from `create_trip`, and return the fields**

In `backend/app/orchestration/trip_service.py`, add the import:

```python
from app.orchestration.phase_service import recompute_position
```

Then immediately after the `h0.anchor_status = AnchorStatus.ANCHORED` line (~`:372`) and before the
`await db.flush()`:

```python
    # U4: derive the cache from the ledger now that h0 is resolved. Note this call
    # would also CLOSE a trip whose every phase is resolved — unreachable here,
    # because build_phase_plan always emits at least `activation` after h0, and the
    # test asserts status is still CREATED so the day that changes it fails loudly.
    await recompute_position(db, trip)
```

and in the `TripDetailResponse(...)` construction, after `closed_at=trip.closed_at,`:

```python
        current_phase=trip.current_phase,
        current_stop=trip.current_stop,
```

- [ ] **Step 8: Verify**

```
cd backend && .venv/bin/python -m pytest -q
cd backend && .venv/bin/python -m ruff check . && .venv/bin/python -m mypy .
```

Expected: **the two new tests pass**; `7 failed`, `0 skipped`, and the passed count is `358` (356 + 2).
`ruff` clean; `mypy` clean. **The 7 failures must be the same 7 by name** — re-read §Prerequisites' list
and check. `test_create_trip_response_shape` is still red on `blockchain_receipts != []`; do not claim it
was fixed.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/trips.py backend/app/orchestration/resource_service.py \
        backend/app/orchestration/trip_service.py backend/app/orchestration/phase_service.py \
        backend/tests/integration/test_trips.py backend/tests/unit/test_phase_service.py
# then, per CLAUDE.md, report the suggested message and let the developer commit:
#   feat(api): expose phase position cache and plan counts on trip responses
```

---

### Task 4.1 — Seed a partially-walked trip

**Files:**
- Modify: `backend/scripts/seed_trips.py` (`_seed_trip` ~`:64`, `seed()` ~`:149`)

**Fence:** the seeder writes rows directly and must keep doing so — it does **not** call `advance_phase`,
`complete_phase` or `anchor_subject`, for the reason the file's own docstring already gives (P0 anchoring
is fail-closed; a seed must not contain a Hedera round-trip). `advance_through` sets `status`,
`completed_at` and evidence fields on the rows it marks and nothing else. **Do not reimplement gating,
seal comparison or reconciliation.** Do not change the two existing trips.

- [ ] **Step 1: Add the `advance_through` parameter**

In `backend/scripts/seed_trips.py`, change `_seed_trip`'s signature to accept it, and document it:

```python
async def _seed_trip(
    db: AsyncSession, *, reference, trip_reference: str, order_number: str,
    precinct_names: list[str], consignment_legs: list[tuple[str, int, int]],
    advance_through: int | None = None,
) -> Trip:
    """Create one trip: stops, trailer link, consignments, and the full phase plan.

    `consignment_legs` is [(pp_reference, pickup_stop_seq, delivery_stop_seq), ...].
    A stop's routing role is derived from these, exactly as Stage 2.1 derives it
    from the real consignment rows — the generator never sees a stop "type".

    `advance_through` marks every row up to and including that sequence_number as
    COMPLETED and sets the trip ACTIVE (U9). It exists so the dispatcher has an
    in-flight trip to render: both other seeds are all-PENDING, which never shows a
    derived-active marker on screen. It deliberately does NOT go through
    advance_phase — see this module's docstring — so it writes evidence fields
    directly and performs no gating, anchoring or reconciliation.
    """
```

- [ ] **Step 2: Mark the completed rows**

Replace the block that currently sets the cache (the `trip.current_phase = plan[0].phase_type.value` /
`trip.current_stop = plan[0].stop_sequence` lines and their comment) with:

```python
    # Cache seeded from the ledger, never independently: the current phase is the
    # lowest-sequence row that is not resolved.
    events = sorted(
        (await db.execute(
            select(PhaseEvent).where(PhaseEvent.trip_id == trip.id)
        )).scalars().all(),
        key=lambda e: e.sequence_number,
    )

    if advance_through is not None:
        walked_at = datetime(2026, 7, 30, 6, 0, tzinfo=UTC)
        for event in events:
            if event.sequence_number > advance_through:
                break
            event.status = PhaseStatus.COMPLETED
            event.completed_at = walked_at + timedelta(minutes=event.sequence_number * 20)
            # Evidence the dispatcher's panels actually read, written only where the
            # phase model says it is captured: the seal at departure (D7/§2.6), the
            # driver's count at loading. Nothing here is anchored.
            if event.phase_type == PhaseType.DEPARTURE:
                event.seal_number = _DEMO_SEAL
            elif event.phase_type == PhaseType.LOADING:
                event.driver_visual_count = 12
                event.parcel_count_origin = 12
        trip.status = TripStatus.ACTIVE

    current = next((e for e in events if e.status != PhaseStatus.COMPLETED), None)
    trip.current_phase = current.phase_type.value if current is not None else None
    trip.current_stop = (
        None if current is None or current.trip_stop_id is None
        else next(s.sequence for s in stops if s.id == current.trip_stop_id)
    )
    await db.flush()

    print(f"  {trip_reference:<22} {len(plan):>2} phases  ({len(stops)} stops)"
          f"{'' if advance_through is None else f'  advanced through seq {advance_through}'}")
    return trip
```

Add the constant near `_CPT`/`_BFN`/`_JHB`:

```python
# Format enforced by schemas/phases.py _SEAL_PATTERN — XX-####.
_DEMO_SEAL = "FP-4471"
```

and extend the imports at the top of the file:

```python
from datetime import UTC, datetime, timedelta
```
```python
from app.db.models.enums import (
    AnchorStatus, IdvsStatus, PhaseStatus, PhaseType, TripStatus, TripType, VehicleType,
)
```

- [ ] **Step 3: Seed the third trip**

In `seed()`, after the existing `FP-DEMO-XDOCK-0001` call, add:

```python
            # The in-flight trip. Same 3-stop cross-dock shape as XDOCK (11 rows),
            # walked through seq 4 — trip_creation, activation, loading, departure
            # and the leg-1 in_transit are done; the trip sits at `unloading` at
            # stop 2. This is the trip a reviewer is walked through: it is the only
            # seed on which the derived-active marker, the coarse `active` status
            # filter, and a real seal + parcel count are all visible at once.
            await _seed_trip(
                db, reference=reference,
                trip_reference="FP-DEMO-ACTIVE-0001", order_number="ORD-DEMO-ACTIVE-0001",
                precinct_names=[_CPT, _BFN, _JHB],
                consignment_legs=[
                    ("MOCKWB0005", 1, 3),   # A: straight through
                    ("MOCKWB0006", 1, 2),   # B: dropped at the hub
                    ("MOCKWB0007", 2, 3),   # C: collected at the hub
                ],
                advance_through=4,
            )
```

- [ ] **Step 4: Run the seeder against the refactor database**

```
cd backend && PYTHONPATH=. .venv/bin/python scripts/dev_reset_lifecycle.py
cd backend && PYTHONPATH=. .venv/bin/python scripts/seed_trips.py
```

Expected output, exactly three lines plus the closing message:

```
  FP-DEMO-SINGLE-0001     7 phases  (2 stops)
  FP-DEMO-XDOCK-0001     11 phases  (3 stops)
  FP-DEMO-ACTIVE-0001    11 phases  (3 stops)  advanced through seq 4
Trip seed complete.
```

> **If `dev_reset_lifecycle.py` errors, or `seed_trips.py` reports incomplete reference data, run
> `PYTHONPATH=. .venv/bin/python scripts/seed_demo.py` first** — the trip seeder depends on reference
> rows it does not create (parent §5.5).

- [ ] **Step 5: Confirm the API now serves an in-flight trip**

```
cd backend && .venv/bin/python -m pytest -q
```

Expected: unchanged from task 4.0 — **358 passed, 7 failed, 0 skipped**. The seeder has no test coverage
and is not imported by `app/`; this run is only proving the task broke nothing.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/seed_trips.py
#   feat(db): seed a partially-walked cross-dock trip for the dispatcher demo
```

---

### Task 4.2 — The shared contract clean cut

**Files:**
- Modify: `frontend/shared/lib/types/trip.ts`
- Modify: `frontend/shared/lib/types/phase.ts` (delete `TripWithPhases`, `:130-159`)
- Delete: `frontend/shared/lib/types/handshake.ts`
- Delete: `frontend/shared/lib/constants/handshake-meta.ts`
- Modify: `frontend/shared/lib/constants/status-meta.ts`
- Modify: `frontend/shared/lib/mocks/trips.ts` (rewrite)
- Modify: `frontend/shared/lib/mocks/phase-trips.ts` (header comment only)
- Create: `docs/superpowers/stage-5-breakage-inventory.md`

**Fence:** 🔴 **Do not edit `frontend/shared/lib/constants/phase-meta.ts`.**
`backend/tests/unit/test_phase_meta_contract.py` parses it and the whole backend suite goes red if
`STEP_SLUGS` moves. 🔴 **Do not edit anything under `frontend/driver-pwa/`** — parent §6.1 puts it outside
this owner's scope, and repairing it here would silently do Stage 5's work badly. 🔴 **Do not edit
`PhaseDescriptor`** — it is Stage 0.4's frozen contract and it is already correct. The dispatcher's own
files are repaired in tasks 4.4 and 4.5, not here: expect `tsc` to be red at the end of this task (U10).

- [ ] **Step 1: Rewrite `types/trip.ts`'s status and trip shapes**

Replace the header comment and the `TripStatus` block (`:1-29`) with:

```ts
// Trip: the primary freight movement record, progressed through a phase plan whose
// LENGTH IS DATA — 7 rows on a single-leg trip, 11 on a three-stop cross-dock.
// Mirrors backend TripDetailResponse and TripListItemResponse.

import type { Driver } from './driver'
import type { Vehicle } from './vehicle'
import type { CoarseTripStatus, PhaseDescriptor, PhaseType } from './phase'
import type { TripException } from './exception'
import type { BlockchainReceipt } from './blockchain'

export type TripId = string & { readonly __brand: 'TripId' }

// Mirrors backend TripType enum (app/db/models/enums.py) — a trip either carries
// PP consignments ("loaded") or is a deadhead/repositioning move ("empty_leg").
export type TripType = 'loaded' | 'empty_leg'

// Mirrors backend TripStatus (coarse since Stage 2 — parent plan §2.3). The old
// ten-value union doubled as the sequencer; position now comes from the phase
// ledger, so this is a plain description and nothing may branch on it for order.
// Defined in ./phase.ts because "coarse status" is phase-model vocabulary; aliased
// here because `status` is the trip's own field and ten files import this name.
// The resulting trip <-> phase cycle is TYPE-ONLY and must stay that way.
export type { CoarseTripStatus as TripStatus } from './phase'
```

In `TripSummary`, change `status: TripStatus` to `status: CoarseTripStatus` and add after
`open_exception_count`:

```ts
  // Denormalised position cache (parent D6), read-path only. The list view carries
  // no plan, so these four are the only way a row can show plan-driven progress.
  // phase_total is the plan's own length — never assume 6, never assume 7.
  current_phase: PhaseType | null
  current_stop: number | null
  phase_total: number
  phase_completed: number
```

In `Trip`, change `status: TripStatus` to `status: CoarseTripStatus`, replace
`handshakes: HandshakeEvent[]` with `phases: PhaseDescriptor[]`, and add after it:

```ts
  // Caches of the derivation in `phases` above. The trip-DETAIL view must derive
  // the active phase from `phases` (see dispatcher lib/phase/derive.ts) and must
  // not read these — if the cache ever diverges, the derived view tells the truth.
  current_phase: PhaseType | null
  current_stop: number | null
```

Delete the now-unused `import type { HandshakeEvent } from './handshake'`.

- [ ] **Step 2: Delete `TripWithPhases` from `phase.ts`**

Remove `phase.ts:122-159` (the `TripWithPhases` block and its preceding comment) entirely. Replace with:

```ts
// Trip detail under the phase model lives in ./trip.ts as `Trip` — this file used to
// carry a forward declaration of it (`TripWithPhases`) while the old handshake-shaped
// Trip still existed. Stage 4 cut that over, so the forward declaration is gone:
// two structurally identical interfaces is exactly the halfway state to avoid.
```

- [ ] **Step 3: Delete the two legacy modules**

```bash
rm frontend/shared/lib/types/handshake.ts
rm frontend/shared/lib/constants/handshake-meta.ts
```

- [ ] **Step 4: Re-key `status-meta.ts`**

Replace the two imports at `:1-2` and the two meta maps at `:16-37`:

```ts
import type { CoarseTripStatus, PhaseStatus } from '@shared/lib/types/phase'
import type { ExceptionType, ExceptionSeverity, ExceptionSource } from '@shared/lib/types/exception'
```

```ts
// ─── Trip status ───────────────────────────────────────────────────────────────

// Coarse since Stage 2 — five values, not ten. `active` covers everything between
// creation and closure; WHERE in the plan a trip is comes from the ledger, never
// from here.
export const TRIP_STATUS_META: Record<CoarseTripStatus, StatusMeta> = {
  created:         { label: 'Created',   chipType: 'pending',   iconName: 'Clock' },
  active:          { label: 'Active',    chipType: 'transit',   iconName: 'Truck' },
  closed:          { label: 'Complete',  chipType: 'complete',  iconName: 'CheckCircle2' },
  cancelled:       { label: 'Cancelled', chipType: 'critical',  iconName: 'XCircle' },
  exception_hold:  { label: 'Exception', chipType: 'exception', iconName: 'AlertTriangle' },
}

// ─── Phase status ─────────────────────────────────────────────────────────────

export const PHASE_STATUS_META: Record<PhaseStatus, StatusMeta> = {
  pending:     { label: 'Pending',     chipType: 'pending',   iconName: 'Circle' },
  in_progress: { label: 'In Progress', chipType: 'transit',   iconName: 'Loader' },
  completed:   { label: 'Completed',   chipType: 'complete',  iconName: 'CheckCircle2' },
  exception:   { label: 'Exception',   chipType: 'exception', iconName: 'AlertTriangle' },
  overridden:  { label: 'Overridden',  chipType: 'exception', iconName: 'ShieldAlert' },
}
```

Everything else in the file — `ChipType`, `StatusMeta`, `EXCEPTION_SEVERITY_META`,
`EXCEPTION_SOURCE_META`, `DRIVER_EXCEPTION_TYPES`, `SYSTEM_EXCEPTION_TYPES`,
`DISPATCHER_EXCEPTION_TYPES` — **is unchanged.**

- [ ] **Step 5: Rewrite `mocks/trips.ts` phase-shaped**

Every mock trip is built with `twoStops()`, so every plan is the 7-row single-leg shape. Replace the
`pendingHE` helper and the six `HANDSHAKES_00XX` arrays (`:22-45`, `:56-127`, `:184-203`, `:219-251`,
`:267-329`, `:355-407`, `:433-484`) with a generator call plus one walk helper:

```ts
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import { makePhasePlan, type PlanStopInput } from './phase-trips'

// A trip's stops in the shape the plan generator needs. Every mock trip here is a
// two-stop run (see twoStops below), so every plan is the 7-row single-leg shape —
// the degenerate case of the multi-stop plan, not a special one.
function planStops(stops: TripStop[]): PlanStopInput[] {
  return stops.map((s, i) => ({
    trip_stop_id: s.id,
    sequence: s.sequence,
    picks_up: i === 0,
    drops_off: i === stops.length - 1,
  }))
}

// Mark the plan as walked through `throughSequence` inclusive, and attach the
// evidence the dispatcher's panels read. Mirrors what the backend writes: the seal
// at DEPARTURE (parent D7/§2.6, never at loading), the count at LOADING.
function walkPlan(
  plan: PhaseDescriptor[],
  throughSequence: number,
  at: string,
  evidence?: { seal?: string; count?: number },
): PhaseDescriptor[] {
  return plan.map(phase => {
    if (phase.sequence_number > throughSequence) return phase
    return {
      ...phase,
      status: 'completed',
      completed_at: at,
      anchor_status: phase.anchor_status === 'not_required' ? 'not_required' : 'anchored',
      seal_number: phase.phase_type === 'departure' ? evidence?.seal ?? null : phase.seal_number,
      driver_visual_count:
        phase.phase_type === 'loading' ? evidence?.count ?? null : phase.driver_visual_count,
      parcel_count_origin:
        phase.phase_type === 'loading' ? evidence?.count ?? null : phase.parcel_count_origin,
    }
  })
}

// current_phase / current_stop, derived from the plan exactly as the backend derives
// them — never set independently, or the mock would model a cache that had drifted.
function positionOf(plan: PhaseDescriptor[]): {
  current_phase: PhaseType | null
  current_stop: number | null
} {
  const next = plan.find(p => p.status !== 'completed' && p.status !== 'overridden')
  return {
    current_phase: next?.phase_type ?? null,
    current_stop: next?.stop_sequence ?? null,
  }
}
```

Then rewrite the seven trip objects. Each keeps every field it has today except: `status` takes its new
coarse value, `handshakes: HANDSHAKES_00XX` becomes `phases: PLAN_00XX`, and `...positionOf(PLAN_00XX)`
is spread in. Build each plan above `mockTrips` using this exact table — it is the mapping from each
trip's old fine-grained status to the phase model:

| Trip | Old status | New `status` | `walkPlan` through seq | Evidence |
|---|---|---|---|---|
| `TRIP_0035_ID` | `closed` | `closed` | `6` (all) | seal `FP-1234`, count 18 |
| `TRIP_0038_ID` | `created` | `created` | `0` (trip_creation only) | — |
| `TRIP_0039_ID` | `origin_gate_in` | `active` | `0` | — |
| `TRIP_0040_ID` | `dest_gate_in` | `active` | `4` (through in_transit) | seal `FP-9012`, count 30 |
| `TRIP_0041_ID` | `in_transit` | `active` | `3` (through departure) | seal `FP-3456`, count 24 |
| `TRIP_0042_ID` | `in_transit` | `active` | `3` | seal `FP-5678`, count 42 |
| `TRIP_0043_ID` | `created` | `created` | `0` | — |

e.g. for the canonical demo trip:

```ts
const PLAN_0041 = walkPlan(
  makePhasePlan(TRIP_0041_ID, planStops(STOPS_0041), '2026-05-09T05:30:00Z', 'd1004100-0000-4000-8000'),
  3,
  '2026-05-09T08:10:00Z',
  { seal: 'FP-3456', count: 24 },
)
```

> **Executing agent — three things that must survive this rewrite, verified 2026-07-29:**
> 1. **`TRIP_0035_ID` … `TRIP_0043_ID` must stay exported** — `mocks/checkpoints.ts` and
>    `mocks/manifests.ts` import them, and so do two driver-pwa tests.
> 2. **Each trip must keep its `exceptions` array** — `mocks/exceptions.ts:6` builds `mockExceptions`
>    from `mockTrips.flatMap(t => t.exceptions)`, and the dispatcher's (still-mocked) exceptions pages
>    depend on it.
> 3. **`twoStops()` currently builds stops inline per trip.** Hoist each trip's stops to a named `const`
>    (e.g. `STOPS_0041`) so the same array feeds both `stops:` and `planStops()` — a plan built from a
>    *different* `TripStop[]` instance would carry `trip_stop_id`s that match nothing on the trip.
>
> The `HandshakeEvent`/`HandshakeEventId`/`HandshakeNumber`/`HandshakeType` import at `:2` and the
> `heId` helper at `:9` are deleted with the arrays they served.

- [ ] **Step 6: Update `phase-trips.ts`'s header comment**

Its first paragraph claims it is *"deliberately a NEW file rather than a rewrite of ./trips.ts"* because
that file's shape could not change yet. It has now changed. Replace lines 1-7 with:

```ts
// The phase plan generator and its canonical fixtures.
//
// Written at Stage 0.4 as the artifact that unblocked driver-pwa work against the frozen
// contract before the live endpoints existed (parent plan §6.2, the Tim Gate). Stage 4 cut
// ./trips.ts over to the phase model, and that file now builds its mocks with makePhasePlan
// below — so this is the one generator, not a parallel one. If it and
// orchestration/phase_plan.build_phase_plan ever disagree, the backend wins.
```

- [ ] **Step 7: Confirm `tsc` is red in exactly the expected places**

```
cd frontend/dispatcher && npx tsc --noEmit
```

Expected: **red, and that is correct at this point (U10).** Every error must be in one of these four
files: `components/domain/HandshakeChain.tsx`, `components/domain/ChecklistRow.tsx`,
`lib/hooks/useStepIndicator.ts`, `app/(app)/trips/[id]/page.tsx`.

🔴 **If an error appears in any other file, stop.** That is a real regression this plan did not predict —
record it in the Findings ledger before continuing.

- [ ] **Step 8: Write the Stage 5 breakage inventory**

Create `docs/superpowers/stage-5-breakage-inventory.md`. Generate its contents, do not guess them:

```bash
cd frontend/driver-pwa && grep -rn \
  "types/handshake\|handshake-meta\|mocks/trips\|types/trip'" \
  app components lib --include="*.ts" --include="*.tsx"
```

The document must contain: a one-paragraph statement that `frontend/driver-pwa` does not type-check as of
this commit and why (U1, Ciaran's decision, with the date); the grep output grouped by which shared module
each file lost; the replacement for each dead symbol
(`HandshakeEvent` → `PhaseDescriptor`, `HANDSHAKE_NAMES` → `PHASE_NAMES`,
`STEP_SLUGS[1|2|3|4|5]` → `STEP_SLUGS[phase_type]` from `constants/phase-meta.ts`,
`HandshakeStatus` → `PhaseStatus`, `Trip.handshakes` → `Trip.phases`,
`TripStatus`'s ten values → the coarse five); and a pointer to
`frontend/shared/lib/mocks/phase-trips.ts` as the phase-shaped fixture source. **This is Tim's handover
and it is not optional** — without it Stage 5's scope is discovered by build failure.

- [ ] **Step 9: Commit**

```bash
git add frontend/shared/lib/types/trip.ts frontend/shared/lib/types/phase.ts \
        frontend/shared/lib/constants/status-meta.ts frontend/shared/lib/mocks/trips.ts \
        frontend/shared/lib/mocks/phase-trips.ts docs/superpowers/stage-5-breakage-inventory.md
git add -u frontend/shared/lib/types/handshake.ts frontend/shared/lib/constants/handshake-meta.ts
#   refactor(shared)!: cut the trip contract over to the phase model
#
#   BREAKING: deletes types/handshake.ts and constants/handshake-meta.ts.
#   frontend/driver-pwa does not type-check until Stage 5 — see
#   docs/superpowers/stage-5-breakage-inventory.md.
```

> 🔴 **Tell Tim before this is pushed.** Six shared files (parent D9) and 32 of his files. The inventory
> document is what to send him.

---

### Task 4.3 — `lib/phase/derive.ts`: the one derivation, with tests

**Files:**
- Create: `frontend/dispatcher/lib/phase/derive.ts`
- Create: `frontend/dispatcher/lib/phase/derive.test.ts`

**Fence:** this module is **pure** — no React import, no `use client`, no `fetch`, no `Date.now()`, no
Tailwind. It imports types and `PHASE_NAMES` and nothing else. It must not import from
`@/components` or `@/lib/api`. Every function takes the phase list and returns a value; none takes a
`Trip`. `tsc` is still red on the four files from task 4.2 — that is expected; **vitest is this task's
gate.**

- [ ] **Step 1: Write the failing tests**

Create `frontend/dispatcher/lib/phase/derive.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  SINGLE_LEG_PHASE_PLAN,
  CROSS_DOCK_PHASE_PLAN,
} from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import {
  activePhase, anchorTally, chainNodesFromCounts, completionPct,
  currentSealNumber, isResolved, nodeTypeFor, originParcelCount, sortedPlan, tripChipMeta,
} from './derive'

// Marks phases 0..through as completed. Local to the test on purpose: the module
// under test must not gain a helper that only tests use.
function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map(p => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

describe('activePhase', () => {
  it('is the lowest-sequence unresolved phase', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2)

    expect(activePhase(plan)?.sequence_number).toBe(3)
  })

  it('is null when every phase is resolved', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 6)

    expect(activePhase(plan)).toBeNull()
  })

  it('ignores array order — the ledger is ordered by sequence_number, not by arrival', () => {
    const shuffled = [...walk(SINGLE_LEG_PHASE_PLAN, 2)].reverse()

    expect(activePhase(shuffled)?.sequence_number).toBe(3)
  })

  it('treats an overridden phase as resolved', () => {
    const plan = SINGLE_LEG_PHASE_PLAN.map(p =>
      p.sequence_number === 0 ? { ...p, status: 'overridden' as const } : p)

    expect(activePhase(plan)?.sequence_number).toBe(1)
  })
})

describe('completionPct', () => {
  it('never exceeds 100 on an 11-phase plan', () => {
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 10)

    expect(plan).toHaveLength(11)
    expect(completionPct(plan)).toBe(100)
  })

  it('uses the plan its own length as the denominator, not a constant', () => {
    // 6 of 11 done is 55%. Against a hard-coded denominator of 6 it would be 100%.
    expect(completionPct(walk(CROSS_DOCK_PHASE_PLAN, 5))).toBe(55)
  })

  it('is 0 on an empty plan rather than NaN', () => {
    expect(completionPct([])).toBe(0)
  })
})

describe('nodeTypeFor', () => {
  it('marks an exception phase warn even though it is also the active one', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2).map(p =>
      p.sequence_number === 3 ? { ...p, status: 'exception' as const } : p)
    const active = activePhase(plan)

    expect(nodeTypeFor(plan[3], active?.phase_event_id ?? null)).toBe('warn')
  })

  it('marks resolved, active and pending phases distinctly', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2)
    const activeId = activePhase(plan)?.phase_event_id ?? null

    expect(nodeTypeFor(plan[2], activeId)).toBe('done')
    expect(nodeTypeFor(plan[3], activeId)).toBe('active')
    expect(nodeTypeFor(plan[4], activeId)).toBe('pending')
  })
})

describe('currentSealNumber', () => {
  it('is the highest-sequence completed departure — the seal actually on the vehicle', () => {
    // Cross-dock: two departures (seq 3 and 7). Leg 1 is sealed and done, leg 2 is
    // sealed and done, so the current seal is leg 2 s.
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 8).map(p =>
      p.phase_type === 'departure'
        ? { ...p, seal_number: p.sequence_number === 3 ? 'AB-1111' : 'AB-2222' }
        : p)

    expect(currentSealNumber(plan)).toBe('AB-2222')
  })

  it('ignores a seal on a departure that has not completed', () => {
    const plan = CROSS_DOCK_PHASE_PLAN.map(p =>
      p.sequence_number === 3 ? { ...p, seal_number: 'AB-1111' } : p)

    expect(currentSealNumber(plan)).toBeNull()
  })
})

describe('originParcelCount', () => {
  it('is the lowest-sequence loading — the origin pickup, not the hub pickup', () => {
    const plan = CROSS_DOCK_PHASE_PLAN.map(p => {
      if (p.sequence_number === 2) return { ...p, parcel_count_origin: 40 }
      if (p.sequence_number === 6) return { ...p, parcel_count_origin: 7 }
      return p
    })

    expect(originParcelCount(plan)).toBe(40)
  })
})

describe('anchorTally', () => {
  it('counts receipts owed from anchor_status, never from plan length', () => {
    // A single-leg plan owes three: trip_creation, departure, confirmation.
    expect(anchorTally(SINGLE_LEG_PHASE_PLAN).owed).toBe(3)
    expect(SINGLE_LEG_PHASE_PLAN).toHaveLength(7)
  })

  it('surfaces a failed anchor separately from an anchored one', () => {
    const plan = SINGLE_LEG_PHASE_PLAN.map(p => {
      if (p.sequence_number === 0) return { ...p, anchor_status: 'anchored' as const }
      if (p.sequence_number === 3) return { ...p, anchor_status: 'failed' as const }
      return p
    })

    expect(anchorTally(plan)).toEqual({ owed: 3, anchored: 1, failed: 1 })
  })
})

describe('chainNodesFromCounts', () => {
  it('renders one node per phase in the plan, however long the plan is', () => {
    expect(chainNodesFromCounts(11, 6, 'Unloading')).toHaveLength(11)
    expect(chainNodesFromCounts(7, 7, 'Confirmation')).toHaveLength(7)
  })

  it('marks completed, current and pending nodes', () => {
    const nodes = chainNodesFromCounts(11, 6, 'Unloading')

    expect(nodes[5].status).toBe('completed')
    expect(nodes[6].status).toBe('in_progress')
    expect(nodes[6].label).toBe('Unloading')
    expect(nodes[7].status).toBe('pending')
  })

  it('has no in-progress node on a fully walked plan', () => {
    expect(chainNodesFromCounts(7, 7, 'Confirmation').every(n => n.status === 'completed')).toBe(true)
  })

  it('is empty rather than throwing when the plan count is 0', () => {
    expect(chainNodesFromCounts(0, 0, '')).toEqual([])
  })
})

describe('tripChipMeta', () => {
  it('names the phase on an active trip, not the word "Active"', () => {
    const meta = tripChipMeta('active', 'unloading')

    expect(meta.label).toBe('Unloading')
    expect(meta.chipType).toBe('transit')
  })

  it('names the phase behind a warning prefix on a held trip, and stays amber', () => {
    const meta = tripChipMeta('exception_hold', 'unloading')

    // Both facts: that it is held, and where it stopped.
    expect(meta.label).toBe('⚠ Unloading')
    expect(meta.chipType).toBe('exception')
  })

  it('leaves terminal and pre-start states alone', () => {
    expect(tripChipMeta('created', 'activation').label).toBe('Created')
    expect(tripChipMeta('closed', null).label).toBe('Complete')
    expect(tripChipMeta('cancelled', null).label).toBe('Cancelled')
  })

  it('never produces a label longer than the widest one it renders today', () => {
    // 'At Origin Gate' is 14 chars. Chip has no fixed width, but ChecklistRow's
    // STATUS column is a fixed 120px, so a regression here would clip silently.
    const widest = (['activation', 'loading', 'departure', 'in_transit', 'unloading',
                     'confirmation'] as const)
      .flatMap(phase => [tripChipMeta('active', phase), tripChipMeta('exception_hold', phase)])
      .reduce((max, meta) => Math.max(max, meta.label.length), 0)

    expect(widest).toBeLessThanOrEqual(14)
  })

  it('degrades to the coarse label rather than undefined when the cache is empty', () => {
    // Live defect #4 was TRIP_STATUS_META[status] returning undefined and the caller
    // reading .chipType off it. This must never throw, whatever the cache holds.
    expect(tripChipMeta('active', null).label).toBe('Active')
    expect(tripChipMeta('active', null).chipType).toBe('transit')
    expect(tripChipMeta('exception_hold', null).label).toBe('Exception')
  })
})

describe('sortedPlan / isResolved', () => {
  it('does not mutate its input', () => {
    const input = [...CROSS_DOCK_PHASE_PLAN].reverse()
    const before = input.map(p => p.sequence_number)

    sortedPlan(input)

    expect(input.map(p => p.sequence_number)).toEqual(before)
  })

  it('treats completed and overridden as resolved and nothing else', () => {
    const of = (status: PhaseDescriptor['status']) => isResolved({ ...SINGLE_LEG_PHASE_PLAN[0], status })

    expect(of('completed')).toBe(true)
    expect(of('overridden')).toBe(true)
    expect(of('pending')).toBe(false)
    expect(of('in_progress')).toBe(false)
    expect(of('exception')).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and confirm they fail for the right reason**

```
cd frontend/dispatcher && npx vitest run lib/phase
```

Expected: FAIL — `Failed to resolve import "./derive"`. **Not** a type error, not an assertion failure.

- [ ] **Step 3: Write the module**

Create `frontend/dispatcher/lib/phase/derive.ts`:

```ts
// The dispatcher's single source of "where is this trip, and what has it evidenced".
//
// Mirrors the backend's own derivation — orchestration/phase_service.py's _is_resolved
// predicate and recompute_position query — so the two surfaces cannot disagree about
// what "current" means. If this file and that one ever diverge, the backend wins and
// this is the bug.
//
// Deliberately pure: no React, no fetch, no clock. That is what lets vitest prove it,
// and it is the only net this stage can add — both static gates (tsc, eslint) passed
// green while the page this replaces was throwing a TypeError on every load.
//
// LENGTH IS DATA. Nothing here may assume 6 phases or sequence 0..6.

import type { CoarseTripStatus, PhaseDescriptor, PhaseStatus, PhaseType } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { TRIP_STATUS_META, type StatusMeta } from '@shared/lib/constants/status-meta'

/** How a phase renders in the timeline and in the chain. */
export type PhaseNodeType = 'done' | 'active' | 'warn' | 'pending'

/** One node in a PhaseChain. Normalised so the trip LIST (which has counts but no
 *  plan) and any plan-holding caller can feed the same component — see U6. */
export interface PhaseChainNode {
  key: string
  status: PhaseStatus
  label: string
}

// Mirrors phase_service._is_resolved: a phase the ledger will never revisit.
// `exception` is NOT resolved — the trip is stuck on it, which is why it stays the
// active phase and renders as a warning rather than being skipped over.
const RESOLVED: readonly PhaseStatus[] = ['completed', 'overridden']

export function isResolved(phase: PhaseDescriptor): boolean {
  return RESOLVED.includes(phase.status)
}

/** Plan order. Never trust the array order off the wire. */
export function sortedPlan(phases: readonly PhaseDescriptor[]): PhaseDescriptor[] {
  return [...phases].sort((a, b) => a.sequence_number - b.sequence_number)
}

/** The lowest-sequence unresolved phase — the same derivation recompute_position
 *  runs server-side. Null on a closed trip. */
export function activePhase(phases: readonly PhaseDescriptor[]): PhaseDescriptor | null {
  return sortedPlan(phases).find(phase => !isResolved(phase)) ?? null
}

export function nodeTypeFor(
  phase: PhaseDescriptor,
  activePhaseEventId: string | null,
): PhaseNodeType {
  if (isResolved(phase)) return 'done'
  // Checked before the active test on purpose: an exception phase IS the active one
  // (it blocks the plan), and it must never render as ordinary progress.
  if (phase.status === 'exception') return 'warn'
  if (phase.status === 'in_progress') return 'active'
  return phase.phase_event_id === activePhaseEventId ? 'active' : 'pending'
}

/** Completed share of the plan, 0-100. Denominator is the plan's OWN length, which
 *  is why an 11-phase trip cannot render >100%. */
export function completionPct(phases: readonly PhaseDescriptor[]): number {
  if (phases.length === 0) return 0
  return Math.round((phases.filter(isResolved).length / phases.length) * 100)
}

/** The seal actually on the vehicle: the highest-sequence COMPLETED departure's.
 *  A cross-dock trip carries a different seal per leg (parent D7/§2.6 — the seal is
 *  captured at departure, never at loading), so "the first seal we find" is wrong. */
export function currentSealNumber(phases: readonly PhaseDescriptor[]): string | null {
  const departures = sortedPlan(phases).filter(
    phase => phase.phase_type === 'departure' && isResolved(phase) && phase.seal_number !== null,
  )
  return departures.length === 0 ? null : departures[departures.length - 1].seal_number
}

/** The origin pickup's count: the LOWEST-sequence loading. On a cross-dock the hub
 *  pickup is a different, later loading row and is not the origin count. */
export function originParcelCount(phases: readonly PhaseDescriptor[]): number | null {
  return sortedPlan(phases).find(phase => phase.phase_type === 'loading')?.parcel_count_origin ?? null
}

export interface AnchorTally {
  /** Phases that owe a Hedera receipt — anchor_status !== 'not_required'. */
  owed: number
  anchored: number
  /** Fail-open casualties (parent D7). A completed phase with a failed anchor must
   *  never render as an unqualified success. */
  failed: number
}

/** Computed from anchor_status, never from plan length: exactly three phase TYPES
 *  are anchored, and a multi-stop plan may hold several departures. */
export function anchorTally(phases: readonly PhaseDescriptor[]): AnchorTally {
  return {
    owed:     phases.filter(p => p.anchor_status !== 'not_required').length,
    anchored: phases.filter(p => p.anchor_status === 'anchored').length,
    failed:   phases.filter(p => p.anchor_status === 'failed').length,
  }
}

export function phaseLabel(phase: PhaseDescriptor): string {
  return PHASE_NAMES[phase.phase_type]
}

/** The status chip's label and colour — U13.
 *
 * An active trip's chip names its PHASE, because the coarse collapse otherwise takes
 * six readable chip labels down to the single word "Active" and the chip is what a
 * dispatcher reads at a glance. A held trip names its phase too, behind a warning
 * prefix: being held and where it stopped are two different facts and a dispatcher
 * needs both. `created`, `closed` and `cancelled` keep their own label — terminal or
 * pre-start states where the position adds nothing.
 *
 * Falls back to TRIP_STATUS_META[status] whenever there is no cached phase. That
 * should not happen — create_trip seeds the cache (U4) and every advance recomputes
 * it — but degrading to "Active" / "Exception" is the point: returning undefined
 * here is live defect #4, the TypeError this stage exists to fix.
 */
export function tripChipMeta(
  status: CoarseTripStatus,
  currentPhase: PhaseType | null,
): StatusMeta {
  const base = TRIP_STATUS_META[status]
  if (currentPhase === null) return base
  if (status === 'active') return { ...base, label: PHASE_NAMES[currentPhase] }
  // chipType stays 'exception', so the chip is amber whatever the label says.
  if (status === 'exception_hold') return { ...base, label: `⚠ ${PHASE_NAMES[currentPhase]}` }
  return base
}

/** Build chain nodes from the ledger-derived counts the trip LIST carries.
 *  `total` is the plan's own length, computed server-side — not a constant, and not
 *  inferred from trip.status the way the deleted chainNodesFromStatus was. */
export function chainNodesFromCounts(
  total: number,
  completed: number,
  currentLabel: string,
): PhaseChainNode[] {
  return Array.from({ length: total }, (_, i) => ({
    key: `phase-${i}`,
    status: i < completed ? 'completed' : i === completed ? 'in_progress' : 'pending',
    label: i === completed ? currentLabel : `Phase ${i}`,
  }))
}
```

- [ ] **Step 4: Run the tests**

```
cd frontend/dispatcher && npx vitest run lib/phase
```

Expected: **all pass.** If `completionPct(walk(CROSS_DOCK_PHASE_PLAN, 5))` is not 55, re-read the
11-row plan in parent §2.2 before changing the assertion — 6 of 11 is 54.5%, which `Math.round` takes
to 55.

- [ ] **Step 5: Prove the guard bites**

Temporarily change `completionPct`'s denominator from `phases.length` to `7` and re-run. The
`uses the plan its own length as the denominator` test must **fail**. Restore it and re-run to green.
(Stage 3's S2 outcome is the precedent: a guard proven only to be green is not proven.)

- [ ] **Step 6: Commit**

```bash
git add frontend/dispatcher/lib/phase/derive.ts frontend/dispatcher/lib/phase/derive.test.ts
#   feat(dispatcher): pure phase-derivation module with plan-length regression tests
```

---

### Task 4.4 — `PhaseChain` and `ChecklistRow`: the trip list goes plan-driven

**Files:**
- Create: `frontend/dispatcher/components/domain/PhaseChain.tsx`
- Delete: `frontend/dispatcher/components/domain/HandshakeChain.tsx`
- Modify: `frontend/dispatcher/components/domain/ChecklistRow.tsx`
- Modify: `frontend/dispatcher/app/(app)/page.tsx` (`:25-28` only)

**Fence:** **reuse the existing visual language — no redesign** (parent §7 4.2's fence). `PhaseChain`
keeps `HandshakeChain`'s node/connector structure, its `statusConfig` colour map and its `cn()` usage;
only the data shape and the compact sizing change.

**Two files parent §7 4.4 names that need no change, verified 2026-07-29 — do not touch either:**
`lib/hooks/useTrips.ts` (its `TripsFilter.status?: TripStatus[]` narrows automatically via task 4.2's
alias, and its client-side filter is value-agnostic) and `app/(app)/history/page.tsx` (its
`CLOSED_STATUS = ['closed','cancelled']` are both still valid coarse values). Also do not touch
`app/(app)/page.tsx:104`'s `mockTrips` lookup (exceptions, out of scope). `tsc` stays red on
`trips/[id]/page.tsx` after this task — that is task 4.5.

- [ ] **Step 1: Create `PhaseChain.tsx`**

```tsx
import { CheckCircle2, Clock, Circle, AlertCircle, ShieldAlert } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import type { PhaseStatus } from '@shared/lib/types/phase'
import type { PhaseChainNode } from '@/lib/phase/derive'

interface PhaseChainProps {
  /** Already in plan order. Length is DATA — 7 nodes on a single-leg trip, 11 on a
   *  cross-dock one, and this component must never assume either. */
  nodes: readonly PhaseChainNode[]
  /** Compact mode renders dots instead of icons — used in table rows, where an
   *  11-node chain would otherwise overflow the 300px PROGRESS column. */
  compact?: boolean
  className?: string
}

const statusConfig: Record<PhaseStatus, {
  icon: typeof CheckCircle2
  colorClass: string
  bgClass: string
  animated?: boolean
}> = {
  completed:   { icon: CheckCircle2,  colorClass: 'text-success',             bgClass: 'bg-success-container' },
  in_progress: { icon: Clock,         colorClass: 'text-tertiary-fixed-dim',  bgClass: 'bg-tertiary-container', animated: true },
  pending:     { icon: Circle,        colorClass: 'text-outline',             bgClass: 'bg-surface-container-highest' },
  exception:   { icon: AlertCircle,   colorClass: 'text-error',               bgClass: 'bg-error-container' },
  overridden:  { icon: ShieldAlert,   colorClass: 'text-secondary',           bgClass: 'bg-secondary-fixed' },
}

/**
 * Horizontal progress indicator over a trip's committed phase plan.
 *
 * Replaces HandshakeChain, whose docstring read "6-node progress indicator showing
 * handshakes 0-5" and whose labels were indexed by sequence_number into a
 * fixed-length Record. The plan's length is data: nothing here counts.
 */
export function PhaseChain({ nodes, compact = false, className }: PhaseChainProps) {
  return (
    <div className={cn('flex items-center', compact ? 'gap-1' : 'gap-2', className)}>
      {nodes.map((node, index) => {
        const config = statusConfig[node.status]
        const Icon = config.icon
        const isDone = node.status === 'completed' || node.status === 'overridden'

        return (
          <div key={node.key} className="flex items-center gap-1">
            {/* Connector — not before the first node. Keyed off array index, not
                sequence_number: a plan is contiguous but need not start at 0 if a
                caller ever renders a slice. */}
            {index > 0 && (
              <div
                className={cn(
                  'h-0.5 rounded-full',
                  compact ? 'w-2' : 'w-6',
                  isDone ? 'bg-success' : 'bg-surface-dim',
                )}
              />
            )}

            <div className={cn('flex items-center gap-1.5', !compact && 'flex-col')} title={node.label}>
              {compact ? (
                // A dot, not an icon: 11 nodes at icon size overflow the PROGRESS
                // column. ChecklistRow prints the literal completed/total alongside,
                // so the count survives even if the chain is ever clipped.
                <span
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    config.bgClass,
                    config.animated && 'animate-pulse',
                  )}
                />
              ) : (
                <>
                  <span
                    className={cn(
                      'flex items-center justify-center rounded-full w-8 h-8',
                      config.bgClass,
                      config.animated && 'animate-pulse',
                    )}
                  >
                    <Icon className={cn(config.colorClass, 'w-4 h-4')} />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-surface-on-variant whitespace-nowrap">
                    {node.label}
                  </span>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Delete `HandshakeChain.tsx`**

```bash
rm frontend/dispatcher/components/domain/HandshakeChain.tsx
```

- [ ] **Step 3: Rewrite `ChecklistRow`'s status logic**

In `frontend/dispatcher/components/domain/ChecklistRow.tsx`, replace the imports at `:6` and `:9-10`:

```tsx
import { PhaseChain } from './PhaseChain'
```
```tsx
import type { TripSummary } from '@shared/lib/types/trip'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { chainNodesFromCounts, tripChipMeta } from '@/lib/phase/derive'
```

The `TRIP_STATUS_META` import at `:8` goes with it — `tripChipMeta` wraps it (U13), and importing both
here invites someone to reach past the wrapper and reintroduce live defect #4.

Delete `STATUS_HINT` (`:34-45`), `COMPLETED_THROUGH` (`:47-60`), `IN_PROGRESS_HS` (`:62-74`) and
`chainNodesFromStatus` (`:80-104`) **entirely** — all four are `Record<TripStatus, …>` tables on the
dead ten-value union, and the last one contains this stage's most literal length assumption
(`Array.from({ length: 6 })`). Replace with a single hint builder:

```tsx
// What the row says the trip is doing. Exceptions win: a dispatcher must see them
// before anything else. Otherwise the coarse status covers the terminal states and
// current_phase covers everything in between — derived server-side from the ledger,
// never inferred from trip.status the way the three deleted tables did.
function progressHint(trip: TripSummary): string {
  if (trip.open_exception_count > 0) {
    return `⚠ ${trip.open_exception_count} exception${trip.open_exception_count > 1 ? 's' : ''}`
  }
  if (trip.status === 'closed')    return '✓ Closed'
  if (trip.status === 'cancelled') return 'Cancelled'
  if (trip.current_phase === null) return 'Pending start'

  const stop = trip.current_stop === null ? '' : ` · stop ${trip.current_stop}`
  return `${PHASE_NAMES[trip.current_phase]}${stop} · ${trip.phase_completed}/${trip.phase_total}`
}
```

In the component body, replace `const statusMeta = TRIP_STATUS_META[trip.status]` (`:108`),
`const chainNodes = chainNodesFromStatus(trip.status)` and the `hint` block (`:116-121`) with:

```tsx
  // U13: the chip names the phase — `Unloading`, not `Active`; `⚠ Unloading` when
  // held. The list reads the cache because it has no plan to derive from; that is
  // U3's read-path exemption, and the ONLY place in the dispatcher allowed to do it.
  const statusMeta = tripChipMeta(trip.status, trip.current_phase)

  const chainNodes = chainNodesFromCounts(
    trip.phase_total,
    trip.phase_completed,
    trip.current_phase === null ? '' : PHASE_NAMES[trip.current_phase],
  )

  const hint = progressHint(trip)
```

The `<Chip type={statusMeta.chipType} label={statusMeta.label} />` at `:196` is unchanged — it now
receives a phase name where it used to receive a status name.

and at `:174` change the element to:

```tsx
          <PhaseChain nodes={chainNodes} compact className="shrink-0" />
```

`TripStatus` is no longer referenced in this file — remove it from the import.

- [ ] **Step 4: Fix the dashboard's active filter**

In `frontend/dispatcher/app/(app)/page.tsx`, replace `:25-28`:

```tsx
// Coarse since Stage 2 (parent §2.3): `active` is every trip between creation and
// closure. The old list enumerated six per-handshake statuses that no longer exist,
// so every advanced trip silently disappeared from this dashboard.
const ACTIVE_STATUSES: TripStatus[] = ['created', 'active', 'exception_hold']
```

Nothing else in this file changes.

- [ ] **Step 5: Verify**

```
cd frontend/dispatcher && npx vitest run
cd frontend/dispatcher && npx tsc --noEmit
```

Expected: **vitest fully green.** `tsc` **red in `app/(app)/trips/[id]/page.tsx` and nowhere else** —
`HandshakeChain`, `ChecklistRow` and `page.tsx` are now repaired, and `useStepIndicator.ts` is deleted in
task 4.6. 🔴 If `useStepIndicator.ts` still errors, that is expected too — it is in the U10 table. Any
error in a *fifth* file means stop.

- [ ] **Step 6: Commit**

```bash
git add frontend/dispatcher/components/domain/PhaseChain.tsx \
        frontend/dispatcher/components/domain/ChecklistRow.tsx \
        "frontend/dispatcher/app/(app)/page.tsx"
git add -u frontend/dispatcher/components/domain/HandshakeChain.tsx
#   feat(dispatcher): plan-driven phase chain and coarse-status trip list
```

---

### Task 4.5 — The trip-detail timeline goes plan-driven

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`

**Fence:** **reuse the existing `TimelineEvent`, `ChainReceiptTag` and sidebar components — no visual
redesign** (parent §7 4.2). Do not change `TripCreatedDetail.tsx` (it reads only
`blockchain_receipts` and `pulsit_trip_reference_id`, both unchanged). Do not add a call to
`GET /phases` or `GET /phases/next` — those are driver-scoped (Stage 3 S3) and this page already has the
whole plan in `trip.phases`. **Do not read `trip.current_phase` here** — the detail view derives from the
ledger (U3's fence).

- [ ] **Step 1: Replace the imports and delete `ACTIVE_HS_FOR_STATUS`**

Replace `:14-21`:

```tsx
import { PHASE_NAMES }      from '@shared/lib/constants/phase-meta'
import { VerifyButton }       from '@/components/blockchain/VerifyButton'
import { ForensicOnly }       from '@/components/blockchain/ForensicOnly'
import { TripCreatedDetail }  from '@/components/domain/TripCreatedDetail'
import {
  activePhase, anchorTally, currentSealNumber, nodeTypeFor, originParcelCount,
  sortedPlan, tripChipMeta,
} from '@/lib/phase/derive'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Trip } from '@shared/lib/types/trip'
import type { BlockchainReceipt, BlockchainReceiptType, VerifyResult } from '@shared/lib/types/blockchain'
```

**`TRIP_STATUS_META` is no longer imported here** — `tripChipMeta` wraps it (U13). Importing both would
let a later edit reach past the wrapper and bring back live defect #4.

Delete `ACTIVE_HS_FOR_STATUS` (`:23-31`) entirely — the comment above it (*"Maps trip status to which
sequence number is currently the active handshake"*) describes exactly the coupling this refactor exists
to remove.

- [ ] **Step 2: Replace the derivation block**

**Delete line `:257`** (`const statusMeta = TRIP_STATUS_META[trip.status]`) — it has to move, because
under U13 the chip now depends on the derived active phase, which is computed below it. Leave `:258-262`
(`originPrecinct`/`destPrecinct`/`originShort`/`destShort`) exactly as they are: the TopBar subtitle and
the sidebar's Origin/Destination rows still use them.

Then replace `:264-299` (from `const sealNumber = …` through the exception-attachment loop) with:

```tsx
  const plan          = sortedPlan(trip.phases)
  const active        = activePhase(trip.phases)
  const tripCreation  = plan.find(p => p.phase_type === 'trip_creation') ?? null

  // U13: the chip names the phase — `Unloading` when active, `⚠ Unloading` when held.
  // Derived from the ledger, NOT from trip.current_phase — U3's fence. The list view
  // is allowed the cache because it has no plan; this page has one, so it must use it.
  const statusMeta = tripChipMeta(trip.status, active?.phase_type ?? null)

  // Everything except trip_creation, which is rendered above the loop as the trip's
  // opening event. Filtered by TYPE, not by `sequence_number === 0` — the plan index
  // is data and the old lookup would silently pick the wrong row on any plan that
  // ever started elsewhere.
  const timelinePhases = plan.filter(p => p.phase_type !== 'trip_creation')

  const sealNumber  = currentSealNumber(trip.phases)
  const originLoad  = plan.find(p => p.phase_type === 'loading') ?? null
  const parcelCount = originParcelCount(trip.phases) ?? 0
  const tally       = anchorTally(trip.phases)

  // A phase is anchored to a STOP, not to "origin or destination" — a cross-dock
  // trip has three, and the old `sequence_number <= 3 ? origin : dest` guess cannot
  // express the middle one.
  function precinctForStop(stopSequence: number | null): string {
    if (stopSequence === null) return '—'
    const stop = trip!.stops.find(s => s.sequence === stopSequence)
    const precinct = stop ? precincts.find(p => p.id === stop.precinct_id) : undefined
    return precinct?.name.split('—')[0]?.trim() ?? '—'
  }

  type TimelineItem = {
    phase: PhaseDescriptor
    nodeType: ReturnType<typeof nodeTypeFor>
    exceptions: Trip['exceptions']
  }
  const timelineItems: TimelineItem[] = timelinePhases.map(phase => ({
    phase,
    nodeType: nodeTypeFor(phase, active?.phase_event_id ?? null),
    exceptions: [],
  }))
  for (const exc of trip.exceptions) {
    const targetIdx = timelineItems.findLastIndex(i => i.nodeType === 'done' || i.nodeType === 'warn')
    if (targetIdx >= 0) timelineItems[targetIdx].exceptions.push(exc)
  }
```

- [ ] **Step 3: Replace the timeline render**

Change the `isLast` prop on the Trip Created event (`:320`) to `timelinePhases.length === 0`, and
`timestamp` (`:324`) to `tripCreation?.completed_at ?? trip.created_at`.

Then replace the whole `timelineItems.map(...)` block (`:329-390`) with:

```tsx
          {timelineItems.map((item, idx) => {
            const phase = item.phase
            const name  = PHASE_NAMES[phase.phase_type]
            const isLastItem = idx === timelineItems.length - 1

            // The same phase TYPE occurs more than once on a multi-stop plan, so the
            // stop is what disambiguates two `Loading` rows — never the index.
            const stopLabel = phase.stop_sequence === null
              ? ''
              : `Stop ${phase.stop_sequence} · ${precinctForStop(phase.stop_sequence)}`
            const meta = phase.completed_at
              ? stopLabel
              : item.nodeType === 'active' ? `In progress${stopLabel ? ` · ${stopLabel}` : ''}`
              : item.nodeType === 'warn'   ? `Exception${stopLabel ? ` · ${stopLabel}` : ''}`
              : `Pending${stopLabel ? ` · ${stopLabel}` : ''}`

            const detailParts: string[] = []
            if (phase.pulsit_geofence_confirmed === true)  detailParts.push('Pulsit geofence confirmed ✓')
            if (phase.pulsit_geofence_confirmed === false) detailParts.push('Pulsit geofence mismatch ✗')
            if (phase.parcel_count_origin !== null) detailParts.push(`${phase.parcel_count_origin} parcels`)
            // Each departure shows its OWN seal, so a cross-dock trip visibly carries
            // a different seal per leg. That is the multi-stop proof on screen.
            if (phase.seal_number)                  detailParts.push(`Seal ${phase.seal_number}`)
            // Fail-open (parent D7): a completed phase whose anchor failed still owes
            // a receipt, and must never read as an unqualified success.
            if (phase.anchor_status === 'failed')   detailParts.push('⚠ Anchor failed — receipt owed')
            const detail = detailParts.length > 0 ? detailParts.join(' · ') : undefined

            const linkedReceipt = phase.blockchain_receipt_id
              ? trip.blockchain_receipts.find(r => r.id === phase.blockchain_receipt_id)
              : undefined

            const excItems = item.exceptions

            return (
              <div key={phase.phase_event_id}>
                <TimelineEvent
                  nodeType={item.nodeType}
                  nodeLabel={phase.sequence_number}
                  isLast={isLastItem && excItems.length === 0}
                  label={
                    item.nodeType === 'active'
                      ? `${name} — IN PROGRESS`
                      : item.nodeType === 'pending'
                      ? `${name} — PENDING`
                      : name
                  }
                  meta={meta}
                  detail={detail}
                  timestamp={phase.completed_at ?? undefined}
                  chainReceipt={linkedReceipt}
                />
                {excItems.map((exc, ei) => (
                  <TimelineEvent
                    key={exc.id}
                    nodeType="warn"
                    nodeLabel="!"
                    isLast={isLastItem && ei === excItems.length - 1}
                    label={`Exception: ${exc.exception_type.replace(/_/g, ' ')}`}
                    meta={`${new Date(exc.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })} · Source: ${exc.source}`}
                    excText={exc.description}
                    resText={
                      exc.resolved && exc.resolver_note
                        ? `Resolved · ${exc.resolver_note}`
                        : undefined
                    }
                  />
                ))}
              </div>
            )
          })}
```

- [ ] **Step 4: Fix the two sidebar panels**

In the Cargo panel, change the completion check (`:460`) from `loadingHs?.status === 'completed'` to
`originLoad?.status === 'completed'`.

In the Blockchain panel, replace the receipt-count line (`:485-487`) with:

```tsx
                    <span className={`text-[11px] font-[500] tracking-[0.04em] ${labelCl}`}>
                      {tally.anchored} of {tally.owed} receipts anchored
                    </span>
                  </div>
                  {tally.failed > 0 && (
                    <div className="text-[11px] font-[600] text-warn mb-1">
                      ⚠ {tally.failed} anchor{tally.failed > 1 ? 's' : ''} failed — receipt{tally.failed > 1 ? 's' : ''} still owed
                    </div>
                  )}
```

> **Executing agent:** the closing `</div>` placement matters — the `<div className="flex items-center
> gap-[5px] mb-1">` that opened at `:483` must close *before* the new `tally.failed` block, which is a
> sibling. Read the surrounding JSX before pasting.

`anchoredCount` (`:276`) is now unused — delete it.

- [ ] **Step 5: Verify the gate is finally green**

```
cd frontend/dispatcher && npx tsc --noEmit && npx eslint . && npx vitest run
```

Expected: **all three exit 0.** This is the first point in the stage where `tsc` passes since task 4.2
(U10). 🔴 **`tsc` passing does not mean the page works** — that is the whole lesson of §Prerequisites'
four live defects. The browser walk in §Verification is what proves it.

- [ ] **Step 6: Commit**

```bash
git add "frontend/dispatcher/app/(app)/trips/[id]/page.tsx"
#   feat(dispatcher): plan-driven trip-detail timeline with per-stop evidence
```

---

### Task 4.6 — The ripple sweep, and the browser proof

**Files:**
- Delete: `frontend/dispatcher/lib/hooks/useStepIndicator.ts`
- Modify: `frontend/dispatcher/lib/hooks/useSLAMetrics.ts`
- Modify: `frontend/dispatcher/app/(app)/sla/page.tsx`

**Fence:** **do not implement SLA metrics** (U12). The hook is a stub that returns `null`; this task
renames one field and one label. Do not add an `/api/v1/sla` call, do not compute percentages from
`useTrips`. Do not delete `driver-pwa/lib/hooks/useStepIndicator.ts` — that is a different file and it is
Tim's.

- [ ] **Step 1: Delete the dead hook**

```bash
rm frontend/dispatcher/lib/hooks/useStepIndicator.ts
```

Then prove it was dead:

```
cd frontend/dispatcher && grep -rn "useStepIndicator" app components lib
```

Expected: **no output.** If anything is returned, stop — U11's premise was wrong and the hook needs
porting rather than deleting.

- [ ] **Step 2: Rename the SLA field**

In `frontend/dispatcher/lib/hooks/useSLAMetrics.ts`:

```ts
interface SLAMetrics {
  onTimePickupPct: number
  onTimeDeliveryPct: number
  // Renamed from handshakeCompletionPct. Still a stub — when this is really
  // implemented its denominator must be each trip's OWN plan length (see
  // lib/phase/derive.ts completionPct), never a fixed count of phases.
  phaseCompletionPct: number
  exceptionsByType: Record<string, number>
}
```

In `frontend/dispatcher/app/(app)/sla/page.tsx`, change the card title *"Handshake completion rate"* to
*"Phase completion rate"* and `metrics.handshakeCompletionPct` to `metrics.phaseCompletionPct`.

- [ ] **Step 3: Prove no handshake vocabulary survives in the dispatcher**

```
cd frontend/dispatcher && grep -rni "handshake" app components lib
cd frontend/shared && grep -rni "handshake" lib
```

Expected: **no output from the first.** The second may return only *comments* that name the old model
historically (e.g. `phase.ts`'s "Replaces ./handshake.ts"); **any live import, type, or identifier is a
defect** — find and remove it before continuing.

- [ ] **Step 4: Run every gate**

```
cd backend             && .venv/bin/python -m ruff check . && .venv/bin/python -m mypy . && .venv/bin/python -m pytest -q -rs
cd frontend/dispatcher && npx tsc --noEmit && npx eslint . && npx vitest run
```

Expected: backend **358 passed / 7 failed / 0 skipped**, the 7 unchanged by name; ruff and mypy clean;
all three dispatcher gates exit 0.

> **`cd frontend/driver-pwa && npm run type-check` is deliberately NOT in this list.** Its `node_modules`
> is not installed, so it exits 0 while running nothing (Stage 3 ledger). Recording it as passing would
> be a false green, and after task 4.2 it would be false in the other direction too — the app genuinely
> does not compile. Record it as **not run**, and point at
> `docs/superpowers/stage-5-breakage-inventory.md`.

- [ ] **Step 5: The browser walk — this is the real verification**

Follow §Verification's "Browser walk" section in full and record the result. **The stage is not done
until this has been done by a human against a running backend.** The four live defects this stage fixes
were all invisible to `tsc` and `eslint`, and both gates were green while the page threw.

- [ ] **Step 6: Commit**

```bash
git add frontend/dispatcher/lib/hooks/useSLAMetrics.ts "frontend/dispatcher/app/(app)/sla/page.tsx"
git add -u frontend/dispatcher/lib/hooks/useStepIndicator.ts
#   refactor(dispatcher): retire the fixed-length step indicator and handshake vocabulary
```

---

## Verification

### The standard gate

```
cd backend             && ruff check . && mypy . && pytest -q -rs
cd frontend/dispatcher && npx tsc --noEmit && npm run lint && npm test
```

Expected: backend **358 passed, 7 failed, 0 skipped** — the 7 exactly the pre-existing set named in
§Prerequisites, unchanged in name and cause. `ruff` clean. `mypy` clean. All three dispatcher gates
exit 0.

**`cd frontend/driver-pwa && npm run type-check` must be recorded as NOT RUN, never as passing.** Its
dependencies are not installed, so it exits 0 without executing anything; and after task 4.2 the app
genuinely does not compile (U1). See `docs/superpowers/stage-5-breakage-inventory.md`.

### Browser walk — the part the static gates cannot do

🔴 **This is not optional and it is not substitutable by tests.** Every one of the four defects this
stage fixes was invisible to `tsc --noEmit` and `eslint .`; both were verified green on 2026-07-29 while
the trip-detail page was throwing a `TypeError` on every load.

**Seeding path** — run in this order, against the **refactor** Supabase project (parent §5.4's second
project, the one `backend/.env`'s `DATABASE_URL` points at while on this branch). **Never the shared dev
database.**

```
cd backend && PYTHONPATH=. .venv/bin/python scripts/dev_reset_lifecycle.py
cd backend && PYTHONPATH=. .venv/bin/python scripts/seed_demo.py        # only if reference data is missing
cd backend && PYTHONPATH=. .venv/bin/python scripts/seed_trips.py
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend/dispatcher && npm run dev                                    # port 3000
```

Then, signed in as the seeded dispatcher, confirm all nine:

| # | Where | What must be true |
|---|---|---|
| 1 | Active Trips | **`FP-DEMO-ACTIVE-0001` is listed.** It is `active`; before this stage the dashboard's filter dropped it silently. Its status chip reads **"Unloading"** — the phase name, not the word "Active" (U13) — and does not throw. |
| 1b | Active Trips | `FP-DEMO-SINGLE-0001` and `FP-DEMO-XDOCK-0001` both show **"Created"**. Only `active` trips take a phase name on the chip; a created trip has not started. |
| 2 | Active Trips | Its PROGRESS column shows **11 dots**, 5 filled, and the hint reads `Unloading · stop 2 · 5/11`. A 7-dot chain here means `phase_total` is not reaching the row. |
| 3 | Active Trips | `FP-DEMO-SINGLE-0001` shows **7 dots** in the same column. **Two different lengths on one screen is the length-is-data proof.** |
| 4 | `FP-DEMO-SINGLE-0001` detail | Timeline renders **7 events**, `Trip Created` completed, the rest pending, no TypeError in the console. |
| 5 | `FP-DEMO-XDOCK-0001` detail | Timeline renders **11 events**, and the two `Loading` rows are distinguishable — each carries its own `Stop N · <precinct>` meta line. |
| 6 | `FP-DEMO-ACTIVE-0001` detail | Phases 0–4 are green, **`Unloading` is the active node**, phases 6–10 pending. The active marker came from the ledger, not from `trip.status`. |
| 7 | `FP-DEMO-ACTIVE-0001` detail | The completed `Departure` row shows `Seal FP-4471`; the sidebar **Seal** field shows the same value; the completed `Loading` row shows `12 parcels`. |
| 8 | `FP-DEMO-ACTIVE-0001` detail | The Blockchain panel reads **`0 of 4 receipts anchored`** (seeded trips are deliberately unanchored) — **not** `0 of 11`. A denominator equal to the plan length (11) means `anchorTally` was bypassed. ⚠️ **The plan originally said `0 of 3` here; that was wrong — see NEW-23.** A cross-dock plan owes **four** receipts, because it has **two** `departure` rows (seq 3 and 7) plus `trip_creation` and `confirmation`. Verified directly against the seeded database. `0 of 3` is the correct figure for a *single-leg* trip only. |
| 9 | SLA page | Renders without error; the fourth card is titled **"Phase completion rate"**. It still shows `No data` — the hook is a stub (U12). |
| 10 | `FP-DEMO-ACTIVE-0001` detail | The header chip reads **"Unloading"**, matching the list row from check 1 — the same phase name from two different sources (the list reads the cache, the detail derives from the ledger; U13). **A mismatch here means the cache has drifted from the plan**, which is exactly the divergence U3's fence exists to make visible rather than launder. |

**Record the console.** An empty browser console across all ten is part of the pass. A green `tsc` with a
red console is exactly the state this stage exists to end.

### Specific to this stage

- **`trip.current_phase` is never read on the trip-detail page** —
  `grep -n "current_phase" "frontend/dispatcher/app/(app)/trips/\[id\]/page.tsx"` returns nothing (U3's fence).
- **`TRIP_STATUS_META` is reached only through `tripChipMeta`** —
  `grep -rn "TRIP_STATUS_META" frontend/dispatcher` returns exactly one hit, in `lib/phase/derive.ts`
  (U13). A second hit means a call site bypassed the wrapper and can return `undefined` again.
- **No fixed-length assumption survives in the dispatcher** —
  `grep -rn "length: 6\|0 | 1 | 2 | 3 | 4 | 5\|HANDSHAKE_STEP_COUNTS" frontend/dispatcher` returns nothing.
- **No handshake vocabulary survives in the dispatcher** — task 4.6 step 3's two greps.
- **The plan-length guard bites** — task 4.3 step 5 was performed, not merely read.
- **`phase-meta.ts` was not edited**, so `backend/tests/unit/test_phase_meta_contract.py` is still green:
  `git diff --name-only main -- frontend/shared/lib/constants/phase-meta.ts` returns nothing.

## Done when

A dispatcher signed into the running app sees `FP-DEMO-SINGLE-0001` and `FP-DEMO-XDOCK-0001` side by side
on Active Trips with **7-node and 11-node progress chains respectively**, sees `FP-DEMO-ACTIVE-0001`
chipped **"Unloading"** rather than a flat "Active", opens it and is shown an 11-event timeline whose
active node is `Unloading at stop 2` — derived from the phase ledger, with each leg's own seal and each
stop's own precinct on its own row, and an anchor tally counted from `anchor_status` rather than from the
plan's length — with **no `handshake` identifier left anywhere under `frontend/dispatcher`**, every
dispatcher gate green, and the backend suite unchanged at 358/7/0.

---

## Out of scope

Named explicitly so a cold agent does not drift into adjacent, larger work.

### Its own follow-on stage — live exceptions

**The dispatcher's exception views stay mocked.** `lib/hooks/useExceptions.ts` reads
`mocks/exceptions.ts`; `app/(app)/exceptions/page.tsx`, `app/(app)/exceptions/[id]/page.tsx` and
`app/(app)/page.tsx:104` look trips up in `mockTrips`. Exception **counts** are already live
(`open_exception_count` on trip summaries) — it is the list and detail views that are not.

**This cannot be fixed frontend-first.** `backend/app/api/v1/endpoints/exceptions.py` exposes **only
`POST ""`** — no list route, no get-by-id. Making the views live needs, in this order: a
`GET /api/v1/exceptions` (org-scoped, filterable by `resolved` and `trip_id`) and a
`GET /api/v1/exceptions/{id}`, both served from `orchestration/exception_service.py`; then
`useExceptions` re-pointed at them; then the two pages' `mockTrips` lookups replaced by whatever the new
responses embed. **Recorded here as a Stage 4-B so it is not lost.** Note it is also the last consumer of
`mocks/trips.ts` inside the dispatcher — until it lands, that mock file cannot be deleted.

### Not this stage's work

- **`frontend/driver-pwa` — all of it.** Parent §6.1 puts it outside this owner. Task 4.2 knowingly breaks
  32 of its files (U1); repairing them here would be doing Stage 5 badly and without Tim. The handover is
  `docs/superpowers/stage-5-breakage-inventory.md`. **Also: install its `node_modules`** — its gate has
  been silently no-opping since Stage 3.
- **A real SLA implementation.** `useSLAMetrics` is a stub returning `null` and stays one (U12). Building
  an SLA endpoint is a new feature, not a phase-refactor ripple.
- **Any visual redesign of the dispatcher.** Parent §2.6 names it a non-goal, and 4.2/4.3's fences repeat
  it. `TimelineEvent`, `ChainReceiptTag`, `Chip`, `StatCard` and the sidebar layout are reused as they
  stand.
- **NEW-17 / server-side reconciliation (F1) and fatter anchor payloads (F4).** Deferred to Stage 3-B per
  Stage 3's §Out of scope. NEW-17 in particular is a *product* decision (per-consignment reconciliation
  via `Consignment.pickup_stop_id`/`delivery_stop_id`), not a rendering one, and the dispatcher renders
  the ledger rather than reconciling it. Do not seed a multi-pickup → multi-drop trip in task 4.1.
- **NEW-8's `_auto_complete_in_transit` stopgap.** Unchanged, deliberately. The dispatcher renders
  `in_transit` rows as ordinary timeline events; it must not offer any action on them.
- **`TripConsignmentInput`'s missing per-consignment stop reference.** A cross-dock trip still cannot be
  created over HTTP, which is why task 4.1 seeds one directly. Carried since Stage 2 task 2.1a.
- **Multi-seal-layer modelling** (Pulsit geofence lock, container-lock key pair, client seal) from the
  2026-07-28 Bruce meeting — a future schema decision.
- **Immutability RLS guards on `trips`/`phase_events`** — flagged since Stage 1, still unowned.
- **`main`/`dev` divergence, promotion, `pg_dump`** — parent §0.2/§5.6. **Do not promote the migration to
  the shared dev database in this stage** (parent §5.6's sequencing rule: the fallback demo needs the old
  schema until after the presentation).
- **`frontend/shared/lib/constants/phase-meta.ts`** — correct and frozen, and parsed by a backend test.
  Do not edit it.

---

## Findings ledger

*(To be completed during execution. Follow the structure Stage 2 and Stage 3 used: suite numbers before
and after, decision-by-decision outcomes, defects found in this plan's own literal code, anything carried
forward, and an honest assessment of "Done when".)*

### 4.x — Suite numbers after Stage 4

All "after" figures measured by the orchestrator, not quoted from a subagent.

| Metric | Before (Stage 3 exit) | After |
|---|---|---|
| Backend whole suite passed | 356 | **358** (+2, task 4.0's new tests) |
| Backend whole suite failed | 7 | **7** — same set, unchanged by name |
| Backend whole suite skipped | 0 | **0** |
| Backend `ruff` | clean | clean (`All checks passed!`) |
| Backend `mypy` | 161 files | clean, `no issues found in 161 source files` |
| Dispatcher `vitest` | 1 file, **never baselined** | 2 files — **30 passed / 1 failed**; the 1 is pre-existing (NEW-20) |
| Dispatcher `tsc --noEmit` | exit 0 (green over a throwing page) | **exit 0** — green, and now green over a page that works |
| Dispatcher `eslint .` | exit 0 | exit 0 |
| driver-pwa gates | not run (no `node_modules`) | **NOT RUN** — and now genuinely broken by design (U1) |

New tests added by this stage: **2** backend integration, **25** dispatcher vitest cases in
`lib/phase/derive.test.ts`.

### Decisions U1–U13 — outcome

| # | Outcome | Note |
|---|---|---|
| **U1** | **executed** | The full cut landed. **The 32-file prediction was exact** — an independent grep set confirmed it with no discrepancy. The mandatory handover doc was written (139 lines). |
| **U1c** | **executed** | `phase-trips.ts` kept; `mocks/trips.ts` imports `makePhasePlan` from it. Header comment updated, and the diff is the header only. |
| **U2** | **executed** | `TripStatus` kept its name as a type-only re-export of `CoarseTripStatus`; `TripWithPhases` deleted after confirming zero consumers. The `trip.ts ↔ phase.ts` cycle is type-only at both ends. |
| **U3** | **executed** | All four fields on the wire. **The fence held and was verified mechanically:** `grep current_phase` on the trip-detail page is empty. |
| **U4** | **executed** | The defect was real. `recompute_position` is public and `create_trip` seeds the cache. Task 4.0's test asserts the trip is still `CREATED` afterwards, so the unreachable close-branch fails loudly if it ever becomes reachable. **Amended:** the asserted `current_stop` is `0`, not `1` — see U-D1/NEW-18. |
| **U5** | **executed** | `derive.ts` is the one derivation module and is genuinely pure — verified independently: no React, `fetch`, `Date.now`, `@/components` or `@/lib/api`, and **no exported function takes a `Trip`**. |
| **U6** | **executed** | `PhaseChain` takes normalised nodes; `chainNodesFromCounts` is the one builder. The `as HandshakeEvent` cast is gone with `chainNodesFromStatus`. |
| **U6b** | **executed, unamended** | Compact dots shipped as specced. **No column width changed** — the diff contains no width/layout token — so the 300px PROGRESS column is intact. Whether 11 dots actually fit without clipping is a **browser-walk** question (check 2), not a static one. |
| **U7** | **executed** | All four index-based lookups replaced by rules. `sequence_number === 0`, `=== 2` and `<= 3` are all gone from the page. |
| **U8** | **executed** | `anchorTally` counts from `anchor_status`; the panel reads `{anchored} of {owed}` and renders a warning line when `failed > 0`. |
| **U9** | **executed** | `FP-DEMO-ACTIVE-0001` seeded and verified in the DB at `unloading` / stop 2, with a real seal and parcel count. |
| **U10** | **amended twice** | The window is right in shape but the table is wrong in two rows — see **U-D3** (4.2 breaks 5 files, not 4) and **U-D6** (`tsc` is NOT green after 4.5; it goes green at 4.6). |
| **U10a** | **executed** | Each task's changes are coherent on their own; the stage ends green. |
| **U11** | **executed** | The hook was genuinely dead — `grep useStepIndicator` returned nothing after deletion. Deleting it is what finally made `tsc` green. driver-pwa's separate copy untouched. |
| **U12** | **executed** | Field and card title renamed; no SLA implementation attempted. The stub still returns `null` and the card still shows `No data`. |
| **U13** | **executed, unamended** | The 14-char ceiling holds **exactly**: `⚠ Confirmation` is 14 characters, passing `toBeLessThanOrEqual(14)` at the boundary. The two call sites source `currentPhase` differently as designed — list from the cache, detail from `activePhase(trip.phases)` — and the detail side is grep-verified. |

### Defects found in this plan's own literal code (fixed during execution)

**U-D1 — Task 4.0 step 1's test asserted `current_stop == 1`; the correct value is `0`.**
The plan assumed stop sequences are 1-indexed. On the HTTP creation path they are **0-indexed**:
`trip_service.py:235-236` builds `TripStopCreate(precinct_id=origin, sequence=0)` and
`sequence=1` for the destination, and `activation` anchors to the origin stop. Both new tests were
corrected to `== 0` with an explanatory comment. Confirmed by re-running them green, and independently
verified by the orchestrator reading `trip_service.py:235-236`. This is a *test-code* defect only —
`recompute_position` and `build_phase_plan` are both correct.

**NEW-18 — the codebase has TWO stop-numbering conventions, and the plan noticed neither.** Found while
verifying U-D1. `trip_service.create_trip` (the HTTP path) numbers stops **from 0**
(`trip_service.py:235-236`); `scripts/seed_trips.py:92` numbers them **from 1**
(`sequence=i + 1`). Each path is internally self-consistent, so nothing is broken and no task in this
stage is blocked — but two consequences bind later tasks and are recorded rather than fixed:

- **§Verification's browser walk is correct as written.** Its `stop 2` expectations describe *seeded*
  trips, which are 1-indexed. A trip created over HTTP in the same browser session will honestly read
  `stop 0` — surprising, not wrong.
- 🔴 **`current_stop === 0` is falsy in JavaScript.** The plan's literal code for `progressHint`
  (task 4.4) and the timeline's `stopLabel` (task 4.5) both correctly test `=== null` / `!== null`.
  **Any "simplification" of those to a truthiness check would silently drop the origin stop on every
  HTTP-created trip.** Flagged into both task packets.
- Unifying the two conventions is **out of scope** for Stage 4: it is a write-path behaviour change,
  which task 4.0's fence forbids. Carried forward.

**U-D2 — Task 4.1 step 2's `current.phase_type.value` raises `AttributeError: 'str' object has no
attribute 'value'`.** `PhaseEvent.phase_type` is a plain `String(30)` column, not a SQLAlchemy `Enum`.
After the **multi-row** plan insert, SQLAlchemy's `insertmanyvalues` RETURNING optimisation repopulates
every column on the Python objects from the raw DB row, overwriting the `PhaseType` instance originally
assigned with a plain `str`. A single-row insert does not trigger it; a 7- or 11-row plan insert always
does. Fixed by coercing first — `PhaseType(current.phase_type).value` — which is **the same guard the
codebase already uses** at `phase_service.py:637` (`actual = PhaseType(event.phase_type)`). Confirmed by
the seeder running clean and by querying the resulting rows. Note the sibling comparisons
(`event.phase_type == PhaseType.DEPARTURE`) are unaffected because `PhaseType` is a str-mixin enum, and
the seeded evidence landed on the right rows, which proves it.

**NEW-19 — the two tests task 4.0 added inherit a network dependency, and one was observed to fail
intermittently.** During task 4.1, one full-suite run returned **8 failed / 357 passed**, the extra
failure being `test_create_trip_response_carries_seeded_position_cache`. **Not reproduced since:** the
orchestrator ran it 6/6 green in isolation and the full suite green at 358/7/0 immediately after. The
subagent's diagnosis ("environmental flake") is **not accepted as established** — but there is a
plausible mechanism worth recording: `POST /api/v1/trips` performs a **fail-closed** P0 Hedera anchor
(the reason `scripts/seed_trips.py` deliberately writes rows directly rather than calling
`advance_phase`, and the reason the pre-existing `test_create_trip_response_shape` is red on unmocked
Hedera). A slow or unavailable testnet round-trip would surface as a non-201 from the POST, which is the
first assertion in both new tests. **This is a pre-existing property of the create-trip path, not
something Stage 4 introduced**, but the two new tests now sit on top of it. Recorded as a risk, not
diagnosed. If it recurs, mocking Hedera in those two tests is the fix — not weakening the assertions.

**U-D3 — U10's table omits `app/(app)/page.tsx` from the files red after task 4.2.** The table names four
files (`HandshakeChain.tsx`, `ChecklistRow.tsx`, `useStepIndicator.ts`, `trips/[id]/page.tsx`). Reality
after 4.2 is **five**: `app/(app)/page.tsx` contributes 6 errors, because its `ACTIVE_STATUSES` array
hard-codes all ten legacy status literals and `TripStatus` is now the coarse five
(`TS2322: Type '"origin_gate_in"' is not assignable to type 'CoarseTripStatus'`).

**This is a defect in the table, not a regression in the code, and nothing was done about it.** The file
is §Prerequisites' **live defect #3**, and **task 4.4 step 4 already rewrites exactly those lines**
(`:25-28`). U10a's real stop criterion is *"stop only if an error appears that is **not** in a file the
remaining tasks touch"* — this file is touched by a remaining task, so it was never a stop condition.
The orchestrator's first 4.2 dispatch packet paraphrased the criterion as "exactly these four files",
which is stricter than the plan; the subagent correctly halted on that stricter wording. Corrected by the
orchestrator rather than by editing code. **The U10 table should read five files after 4.2, and four
after 4.4** (`trips/[id]/page.tsx` plus `useStepIndicator.ts`, which is not deleted until 4.6).

**NEW-20 — the dispatcher's `vitest` suite is ALREADY RED, and §Prerequisites never baselined it.**
P5 gates only `tsc --noEmit` and `eslint .`. It does not run `vitest`, so nobody measured it before the
first edit. Measured now: `lib/api/client.test.ts` → **1 failed | 5 passed (6)**. The failure is
`network-layer retry > does not retry a POST when the connection drops` —
`expected ApiError … to be an instance of TypeError` at `lib/api/client.test.ts:125`.

**Pre-existing and unrelated to this stage.** That test file imports only `./client` and
`@/lib/supabase/client`; neither is touched by any task in Stage 4, and `git status` confirms no
dispatcher file was modified by task 4.2 at all.

🔴 **Consequence for tasks 4.3, 4.4, 4.5 and 4.6:** every one of them states an expected result of
"**vitest fully green**". **That is unachievable and must not be chased.** The correct standard for the
rest of this stage is: *every new test passes, and `lib/api/client.test.ts`'s single pre-existing failure
is the only red.* Carried into each remaining task packet so no agent burns time debugging it.

### 4.2 — outcome

Fences verified by the orchestrator, not merely reported:
`git diff --name-only frontend/shared/lib/constants/phase-meta.ts` → **empty**;
`git status --short frontend/driver-pwa` → **empty**; `phase-trips.ts`'s diff is the **header comment
only**. `frontend/shared/lib/**` compiles clean — no error originates there. All eight
`mocks/trips.ts` exports survive with unchanged values (`TRIP_0035_ID`…`TRIP_0043_ID`, `mockTrips`), and
every trip keeps its `exceptions` array so `mocks/exceptions.ts` still builds.

**The mandatory non-code step was done:** `docs/superpowers/stage-5-breakage-inventory.md`, 139 lines,
generated from real greps — why driver-pwa does not type-check, files grouped by which shared module each
lost, the dead-symbol → replacement map, `phase-trips.ts` named as the fixture source, and the
`node_modules` false-green trap. **The 32-file prediction in U1 was exact** — an independent grep set
(adding `HANDSHAKE_STATUS_META`, `HandshakeEvent`, `HANDSHAKE_NAMES`, `.handshakes`) found the same 32,
no discrepancy. One extra non-code hit: a comment naming `handshake-meta.ts` at
`driver-pwa/next.config.ts:77`.

Observation, left alone deliberately: `types/phase.ts` retains imports (`Driver`, `Vehicle`,
`TripException`, `BlockchainReceipt`, `ConsignmentRead`, `TripId`, `TripStop`, `TripType`) that only
`TripWithPhases` used. `noUnusedLocals` is not enabled in either tsconfig so this is not an error. Not
cleaned up, because fence 3 restricted the edit to deleting `TripWithPhases` and nothing else.

**U-D4 — Task 4.3's `chainNodesFromCounts` does not type-check as literally written.**
`status: i < completed ? 'completed' : i === completed ? 'in_progress' : 'pending'` inside an
un-annotated object literal infers as `string`, not `PhaseStatus`, so the result does not satisfy
`PhaseChainNode[]`. Fixed by annotating the `Array.from` callback's return type —
`(_, i): PhaseChainNode => ({ … })` — **not** by adding `any` or loosening the interface.

**U-D5 — Task 4.3's `nodeTypeFor` declares `activePhaseEventId: string | null`, which silently discards a
brand.** `PhaseDescriptor.phase_event_id` is `PhaseEventId = string & { readonly __brand: 'PhaseEventId' }`.
The plan's signature still *compiles* (the brand is a subtype of `string`, so there is no
no-overlap error), so this was a latent weakening rather than a build break. Changed to
`PhaseEventId | null`, which every call site already produces (`activePhase(plan)?.phase_event_id ?? null`)
with no cast.

Checked and found **not** defective, contrary to the orchestrator's suspicions: `noUncheckedIndexedAccess`
is **not** enabled in the dispatcher's `tsconfig.json` (only `strict: true`, which does not imply it), so
`currentSealNumber`'s `departures[departures.length - 1].seal_number` types as `string | null` exactly as
declared. `PhaseStatus` is exactly `pending | in_progress | completed | exception | overridden`.
`PHASE_NAMES` strings, `StatusMeta`'s export, and every `TRIP_STATUS_META` label the tests assert all match
as written. `vitest.config.ts` resolves `@shared` before the broader `@` prefix.

**U6b's 14-character ceiling is exact, not approximate.** `'⚠ Confirmation'` is 2 + 12 = **14** chars,
passing `toBeLessThanOrEqual(14)` at the boundary. Any longer phase label added later trips this test —
which is the point.

### 4.3 — the plan-length guard was proven to bite, not merely proven green

Step 5 was genuinely performed. With `completionPct`'s denominator hard-coded to `7`:

```
FAIL  completionPct > never exceeds 100 on an 11-phase plan
AssertionError: expected 157 to be 100
FAIL  completionPct > uses the plan its own length as the denominator, not a constant
AssertionError: expected 86 to be 55
Tests  2 failed | 23 passed (25)
```

Restored → `25 passed (25)`. **157% is precisely the ">100% on an 11-phase trip" failure the
length-is-data invariant exists to forbid**, reproduced on demand. Purity fence verified independently by
the orchestrator: no React, `fetch`, `Date.now`, `@/components` or `@/lib/api` import in `derive.ts` (the
only grep hits are inside its own comments), and **no exported function takes a `Trip`** — every one takes
`readonly PhaseDescriptor[]` or scalars. `eslint lib/phase` clean.

**U-D6 — U10's table and task 4.5 step 5 both claim `tsc` goes GREEN after task 4.5. It does not.**
`lib/hooks/useStepIndicator.ts` imports the two deleted modules and is **not deleted until task 4.6
step 1**. So after 4.5, `tsc` is still red — on that one file, with 2 errors. Task 4.4's own step 5 says
this outright (*"`useStepIndicator.ts` is deleted in task 4.6. 🔴 If `useStepIndicator.ts` still errors,
that is expected too"*), which contradicts U10's `4.5 → ✅ green` row and 4.5 step 5's *"all three exit
0"*. The corrected window is:

| After task | dispatcher `tsc --noEmit` |
|---|---|
| 4.2 | ❌ red — 5 files (U10 said 4; see U-D3) |
| 4.3 | ❌ red — same 5 |
| 4.4 | ❌ red — 2 files: `trips/[id]/page.tsx`, `useStepIndicator.ts` |
| **4.5** | ❌ **red — 1 file: `useStepIndicator.ts` only** (U10 said green) |
| 4.6 | ✅ green — the dead hook is deleted in step 1 |

Resolved by **keeping task 4.5's file scope** (deleting the hook early would steal 4.6 step 1, whose grep
proves the hook was dead before removing it) and telling 4.5's implementer to expect the single red file.
Recorded so the stage's "first point `tsc` passes" claim is not overstated: it is **task 4.6**, not 4.5.

**Not a defect, but a gate that is premature:** §Verification's *"`TRIP_STATUS_META` returns exactly one
hit, in `lib/phase/derive.ts`"* cannot pass until task **4.5** removes the import from
`trips/[id]/page.tsx`. After 4.4 there are legitimately two importers. Checked at 4.6, not before.

### 4.4 — outcome

`tsc` red in exactly the two predicted files. All four dead lookup tables are gone from `ChecklistRow`
(`STATUS_HINT`, `COMPLETED_THROUGH`, `IN_PROGRESS_HS`, `chainNodesFromStatus`), verified by the
orchestrator: a grep for those names plus `length: 6`, `HandshakeEvent`, `TripStatus` and
`TRIP_STATUS_META` in that file returns **nothing**. **No column width or layout token changed** — the
diff contains no `w-[`, `grid`, `flex-`, `300` or `120` line, so U6b's 300px PROGRESS column is intact and
the compact-dot sizing is what absorbs an 11-node chain. No Tailwind token or icon-type substitution was
needed: every token in the plan's `PhaseChain` snippet, including the `exception` and `overridden` states,
was already present in the real `HandshakeChain.tsx`, so U6's "reuse the visual language" fence holds
literally. `progressHint` and the `chainNodes` block both retain `=== null` — no truthiness check was
substituted, so NEW-18's stop-0 trap is not triggered.

**Live defect #3 is fixed and visible in the diff:** `ACTIVE_STATUSES` went from the eight-value legacy
list (which omitted `'active'`) to `['created', 'active', 'exception_hold']`.

**U-D7 — task 4.5's own literal comments contain the exact substrings §Verification's greps forbid.**
The plan's inserted comments include `trip.current_phase` (in the U13 chip comment),
`` `sequence_number === 0` `` (in the `timelinePhases` comment) and
`` `sequence_number <= 3 ? origin : dest` `` (in the `precinctForStop` comment). §Verification requires
`grep -n "current_phase" trips/[id]/page.tsx` to return **nothing**, and task 4.6 step 3 requires no
`handshake` vocabulary. **Pasting the plan's code verbatim makes its own verification fail** — on comment
text, while the logic underneath is fully migrated.

Resolved by **rewording the three comments to preserve their meaning without the flagged substrings**
(e.g. "NOT from the trip's denormalised position cache — U3's fence"), not by weakening the greps. A
grep-based guard that needs a human to decide which hits are "only comments" is not a guard. Verified by
the orchestrator: the fence grep is empty **and** the reworded comment still documents U3's fence
explicitly.

**U-D8 — the plan's `trip!.stops` hedge is backwards.** It suggested the non-null assertion "may be
unnecessary… drop the `!` if the narrowing carries." It does **not** carry: removing it yields
`TS18047: 'trip' is possibly 'null'`, because TypeScript does not propagate an outer `if (!trip) return`
narrowing into a **nested `function` declaration**'s body. The `!` is required. Kept, with a comment
explaining why it is not a lazy cast. `eslint` raised nothing (`no-non-null-assertion` is not configured).

**Observation, left as the plan intended:** the exception-attachment loop recomputes `targetIdx`
identically on each iteration, so **every** open exception attaches to the *same* latest `done`/`warn`
timeline row rather than being distributed. That is a simplification of the old implicit per-row
behaviour and it was explicit plan intent, so it stands — but it is worth knowing before a demo on a trip
with several exceptions. None of the three seeded demo trips has any.

### Whole-diff review across all seven tasks — the cross-task seams

Per-task review cannot see these; Stage 2's NEW-10 and Stage 3's NEW-15 were the same shape. Two found.

**NEW-22 — 🔴 `derive.ts`'s `isResolved` does NOT mirror the backend's `_is_resolved`, though it says it
does.** This is the significant find of the stage.

| Implementation | Treats as resolved | Drives |
|---|---|---|
| `phase_service._is_resolved` (`:~150`) | `COMPLETED`, **`EXCEPTION`**, `OVERRIDDEN` | `current_phase` cache, trip closure |
| `resource_service.list_trips` COUNT (task 4.0) | `COMPLETED`, `OVERRIDDEN` | `phase_completed` |
| `derive.ts isResolved` (task 4.3) | `completed`, `overridden` | `activePhase`, `completionPct`, `nodeTypeFor` |
| `seed_trips.py` (task 4.1) | `!= COMPLETED` | seeded cache (moot — only writes `COMPLETED`) |

The backend counts a phase in `EXCEPTION` as **resolved** — a deliberate T3 decision, whose own comment
explains that an exception serious enough to stop a trip does so via `trip.status = EXCEPTION_HOLD`, so
the plan otherwise continues past a non-blocking one. `derive.ts` counts it as **unresolved**, on purpose,
so that `nodeTypeFor` can render it `warn` and the timeline shows *where* the trip is stuck.

**Both behaviours are defensible; the problem is that `derive.ts`'s header claims to mirror the backend
and says "if this file and that one ever diverge, the backend wins and this is the bug."** By its own
standard, this is the bug. Task 4.0's new COUNT also describes itself as "resolved in the ledger's sense"
while omitting `EXCEPTION`, so that comment is inaccurate too.

**Observable consequence:** on a trip with a phase in `EXCEPTION` status, the **list** row (cache, via
`_is_resolved`) and the **detail** header chip (derived, via `isResolved`) would name **different phases** —
and §Verification's **check 10** would read that as cache drift when it is really a predicate mismatch.

**Not fixed, deliberately.** Aligning `derive.ts` to the backend would delete the `warn` rendering that
U7/U8 designed and break task 4.3's `isResolved('exception') === false` test; aligning the backend is a
**write-path** change that task 4.0's fence forbids. **The demo is not exposed:** none of the three seeded
trips has an `EXCEPTION`-status phase, verified against the database. Carried forward as a decision for
Stage 3-B/F1, where reconciliation already lives. **Minimum action before it bites: correct `derive.ts`'s
header comment so it states the deviation instead of denying it.**

**NEW-23 — §Verification's browser check 8 had the wrong number, and would have sent the reviewer
debugging correct code.** It expected `0 of 3 receipts anchored` on `FP-DEMO-ACTIVE-0001`. The true value
is **`0 of 4`**. `ANCHORED_PHASES` is `{trip_creation, departure, confirmation}`, and the 11-row cross-dock
plan contains **two** `departure` rows — so it owes 4. Confirmed by querying the seeded database directly:

```
plan length=11  owed=4  anchored=0
  seq  0 trip_creation  completed  anchor=pending
  seq  3 departure      completed  anchor=pending
  seq  7 departure      pending    anchor=pending
  seq 10 confirmation   pending    anchor=pending
```

U8's own prose already implies this (*"a plan may contain several `departure` rows"*); the number `3` was
carried over from the single-leg case, where it is right and where task 4.3's test correctly asserts it.
The strawman was wrong too — a length-based denominator would read `11`, not `12`. **§Verification's table
has been corrected in place** so the browser walk tests the right number.

### 4.5 — outcome, verified independently by the orchestrator

`tsc --noEmit` → **exactly 2 errors, both `lib/hooks/useStepIndicator.ts`** (per U-D6, expected).
`eslint .` → **exit 0**. `vitest` → derive's 25 pass; the only red is NEW-20's pre-existing
`client.test.ts` failure. Fence greps, run by the orchestrator rather than taken on report:

- `grep -n "current_phase\|current_stop" "app/(app)/trips/[id]/page.tsx"` → **empty.** U3's fence holds:
  the detail page derives from the ledger and never reads the cache.
- `grep -rn "TRIP_STATUS_META" app components lib` → **only `lib/phase/derive.ts`** (import + 2 uses),
  plus a comment in `derive.test.ts`. No call site can bypass `tripChipMeta` and get `undefined` back,
  which is live defect #4 closed at the structural level rather than patched at one call site.
- `ACTIVE_HS_FOR_STATUS`, `sortedHandshakes`, `allSorted`, `tripCreationHs`, `loadingHs` and
  `anchoredCount` are all **gone** from the file.

`TimelineEvent` needed **no** prop adaptation — `nodeLabel` is genuinely `string | number` and `nodeType`
is a superset of `PhaseNodeType`. `text-warn` is a real token already used in this file. No visual
redesign: `TimelineEvent`, `ChainReceiptTag` and the sidebar were reused as they stand.

### 4.1 — seeded state, verified against the database

`FP-DEMO-ACTIVE-0001`: `status=active`, `current_phase="unloading"`, `current_stop=2`,
`journey_lock_hash=NULL` — exactly as U9 predicted. `seal_number="FP-4471"` landed on
`sequence_number=3` (`departure`, stop 1); `driver_visual_count=parcel_count_origin=12` on
`sequence_number=2` (`loading`, stop 1). Rows 0–4 `completed` at 20-minute increments from
2026-07-30 06:00 UTC; rows 5–10 `pending`. `_DEMO_SEAL="FP-4471"` was confirmed against the real
`_SEAL_PATTERN = r"^[A-Z]{2}-\d{4}$"` in `app/schemas/phases.py`. `MOCKWB0005/6/7` do not collide
(`parcel_perfect_reference` carries no unique constraint). Seeder stdout matched the plan's expected
three lines exactly.

⚠️ **Left as written, deliberately:** the seeder's "current" predicate is
`event.status != PhaseStatus.COMPLETED`, which does **not** treat `OVERRIDDEN` as resolved, unlike
`phase_service._is_resolved` and `derive.ts`'s `isResolved`. Harmless here because this seeder only ever
writes `COMPLETED`. **Do not copy this predicate anywhere else.**

### 4.6 — outcome

`useStepIndicator.ts` was genuinely dead: `grep -rn useStepIndicator app components lib` → **empty** after
deletion. Deleting it is what finally turned `tsc` green. driver-pwa's separate copy untouched.
`handshakeCompletionPct` → `phaseCompletionPct` in the stub interface plus its one consumer; **no SLA
implementation attempted** — the hook still returns `null` and the card still renders `No data`.

**U-D9 — task 4.6 step 2's own literal comment fails task 4.6 step 3's grep.** The plan's replacement
interface includes `// Renamed from handshakeCompletionPct.`, which contains the word the very next step
requires to be absent from `frontend/dispatcher`. Same class as U-D7. Reworded to keep the meaning
("Renamed to reflect the phase-based model") without the word.

**Fence conflict, resolved by the orchestrator.** The 4.6 dispatch packet listed `app/(app)/page.tsx`,
`PhaseChain.tsx` and `ChecklistRow.tsx` as do-not-edit ("settled"), but all three carried the word
`handshake` in comments, which step 3 forbids. The subagent correctly **stopped and escalated instead of
guessing**. Ruling: the fence meant "do not change their *logic*"; three comment-only rewords were
authorised and applied. Final dispatcher grep is **empty**, verified independently by the orchestrator.

`grep -rni "handshake" frontend/shared/lib` still returns hits. Classified: **historical comments (fine)**
in `phase-trips.ts`, `evidence.ts`, `phase.ts`, `seal.ts`, `phase-meta.ts`; **live code (NEW-21, carried,
not fixed)** in `types/exception.ts` (`handshake_event_id`), `mocks/trips.ts` (9 keys of the same name) and
`constants/copy.ts` (an unused string).

`HANDSHAKE_STEP_COUNTS` is gone. `grep "STEP_NAMES"` returns one hit — a **local, unrelated** wizard-step
array in `app/(app)/trips/new/page.tsx` (`['Order & Waybills', 'Crew & Vehicle', …]`), not an import from
the deleted module. Not a defect. `grep "length: 6"` → empty. driver-pwa's gate **NOT RUN**, recorded as
not run, dependencies deliberately not installed.

### Browser walk — result

🔴 **NOT YET RUN. This is Ciaran's, and the stage is NOT done until it is.**

All code work (tasks 4.0–4.6 steps 1–4) is complete and every static gate is in its expected state, but
**every one of the four live defects this stage fixes was invisible to `tsc` and `eslint`** — both were
green on 2026-07-29 while the trip-detail page threw a `TypeError` on every load. The static gates being
green again therefore proves only that the code compiles, not that the page works.

Two corrections to make before walking it, both found by the orchestrator's whole-diff review:
- **Check 8 expects `0 of 4 receipts anchored`, not `0 of 3`** (NEW-23) — already corrected in
  §Verification above. Seeing `0 of 4` is a **PASS**.
- **Check 10** (list chip matches detail chip) is a valid test on all three seeded trips, but be aware it
  can legitimately mismatch on a trip with an `EXCEPTION`-status phase for reasons that are **not** cache
  drift (NEW-22). No seeded trip has one, so it should not fire.

Expected on the seeded data, for reference while walking: `FP-DEMO-SINGLE-0001` 7 phases / 2 stops /
`created`; `FP-DEMO-XDOCK-0001` 11 phases / 3 stops / `created`; `FP-DEMO-ACTIVE-0001` 11 phases /
3 stops / `active`, `current_phase=unloading`, `current_stop=2`, seal `FP-4471` on seq 3, 12 parcels on
seq 2, rows 0–4 completed and 5–10 pending — all verified directly against the database.

*(To be completed by Ciaran: all ten rows, pass/fail, with the console state. An empty console across all
ten is part of the pass.)*

### Carried into Stage 5 / later

**1. driver-pwa breakage — handover written, NOT yet sent.**
`docs/superpowers/stage-5-breakage-inventory.md` exists (139 lines, grep-generated). **32 files**, exactly
as U1 predicted. 🔴 **Tim must be told before this is pushed, not after** — U1's instruction, still
outstanding as of the handover to Ciaran. The inventory document is what to send him. Also carried: its
`node_modules` is not installed, so its gates have been silently no-opping since Stage 3; installing them
is Stage 5's first step.

**2. NEW-21 — `TripException.handshake_event_id` is stale in shared TS. Latent, not live.**
Found during task 4.6's vocabulary sweep and verified by the orchestrator:
`frontend/shared/lib/types/exception.ts:43` declares `handshake_event_id: string | null`, while the
backend returns **`phase_event_id`** (`backend/app/schemas/transit.py:77`). Genuine contract drift of
exactly the kind this stage exists to end — **but nothing under `frontend/dispatcher` reads that field**
(grep confirms), so it throws nothing today. Also propagated into `mocks/trips.ts` as 9 `handshake_event_id: null`
keys, and **live-consumed by `frontend/driver-pwa/lib/context/TripContext.tsx`**.

**Deliberately NOT fixed.** `types/exception.ts` is outside this stage's declared file list, and the fix
changes a shared type that another developer's live code consumes — coordination, not a drive-by. It
belongs with Stage 5, since Tim must touch `TripContext.tsx` anyway. **Add it to the breakage inventory
before sending.**

**3. Two cosmetic stragglers, flagged not fixed** (both shared, both harmless):
`frontend/shared/lib/constants/copy.ts:36` — unused string `startTrip: 'Start trip · Begin Handshake 1'`.
`frontend/shared/lib/types/phase.ts:96` — comment cites `backend/app/schemas/handshakes.py:153`, a file
Stage 3 retired; the pointer is stale.

**4. Stage 4-B — live exceptions.** Unchanged from §Out of scope. The dispatcher's exception list and
detail views stay mocked; counts are already live via `open_exception_count`. Needs
`GET /api/v1/exceptions` and `GET /api/v1/exceptions/{id}` first — `exceptions.py` still exposes only
`POST ""`. **`mocks/trips.ts` therefore CANNOT be deleted yet**: three dispatcher files
(`app/(app)/page.tsx`, `exceptions/page.tsx`, `exceptions/[id]/page.tsx`) still import `mockTrips`, and 9
driver-pwa files do too.

**5. NEW-18 — two stop-numbering conventions** (HTTP path 0-indexed, seeder and mock fixtures 1-indexed).
Not unified; unifying is a write-path change. The live consequence to remember: **`current_stop` can be
`0`, which is falsy in JS.** Every null check in this stage's code is `=== null` for that reason.

**6. NEW-19 — the two new backend tests inherit a fail-closed Hedera round-trip** in `POST /trips` and one
was seen to fail once, unreproduced in 7 subsequent runs. If it recurs, mock Hedera in those tests rather
than weakening the assertions.

**7. NEW-20 — `lib/api/client.test.ts`'s POST-retry test is red and was never baselined** by
§Prerequisites. Pre-existing, unrelated to the phase model. A future Prerequisites block should gate
`vitest` alongside `tsc` and `eslint`, or the next stage inherits the same blind spot.

### "Done when" — assessment

**Partially met — every code condition is met; the one condition that actually proves the stage has not
been performed.**

Met, and verified by the orchestrator rather than taken on report:
- The dispatcher renders whatever plan the ledger holds, through one code path. 7-row and 11-row plans
  both exist in the seeded data and both flow through `derive.ts`.
- **No `handshake` identifier survives anywhere under `frontend/dispatcher`** — grep empty, including
  comments.
- The anchor tally is computed from `anchor_status`, not plan length (`anchorTally`, tested).
- The detail page derives its position from the ledger and **never reads the cache** — grep-verified,
  which is U3's fence made mechanical.
- `TRIP_STATUS_META` is reachable **only** through `tripChipMeta`, so live defect #4 is closed
  structurally rather than patched at one call site.
- No fixed-length assumption survives: `length: 6` gone, `HANDSHAKE_STEP_COUNTS` gone, and the
  plan-length guard was **proven to bite** (157% on a deliberately broken denominator).
- Every gate in its expected state: backend **358/7/0** with the 7 unchanged by name, ruff and mypy clean,
  dispatcher `tsc` **green**, `eslint` clean, `vitest` 30 passed with only NEW-20's pre-existing red.
- `phase-meta.ts` untouched, so the backend contract test still passes. `driver-pwa` untouched.

**Not met:**
- 🔴 **The browser walk has not been done.** The "Done when" sentence is written from the point of view of
  *"a dispatcher signed into the running app sees…"* — nobody has yet signed in. Given that all four
  defects this stage fixes were invisible to both static gates, **this is the load-bearing condition, and
  it is outstanding.** The stage must not be recorded as complete until Ciaran has walked it.

**Met only in the narrow sense, stated rather than glossed:**
- §Verification's *"no handshake vocabulary survives"* is fully met for `frontend/dispatcher` (the
  load-bearing tree) but **not** for `frontend/shared`, where three live handshake-named items remain
  (NEW-21). The plan's step 3 text asked for those to be removed; they were deliberately left, because
  `types/exception.ts` is outside this stage's file list and the fix mutates a shared type that another
  developer's live code consumes. Recorded as carried work, not as done.
- U1's obligation to **tell Tim before this is pushed** is outstanding. The inventory document exists;
  sending it is a human action.
- `derive.ts` claims to mirror the backend's resolved-predicate and does not (NEW-22). Nothing in the demo
  path is exposed, but the claim in the comment is currently false.
