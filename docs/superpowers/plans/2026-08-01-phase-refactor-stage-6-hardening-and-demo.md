# Phase Refactor — Stage 6: Lifecycle Hardening, Integration & Demo (6.0 – 6.6)

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. Executed by subagents that start cold and cannot ask questions — every decision a
> cold agent would otherwise have to guess at is locked below in §Decisions.

**Created:** 2026-08-01 · **Owner:** Ciaran · **Branch:** `trip-detail-ui` (or a fresh branch off it)
**Parent plan:** `docs/superpowers/plans/2026-07-25-phase-model-refactor.md` — *that document is the
source of truth. If this plan and the parent disagree, the parent wins.* This plan **supersedes and
expands** the parent's three-bullet Stage 6 sketch (§7): its 6.1/6.2/6.3 become **6.4/6.5/6.6** here,
and four hardening tasks are inserted ahead of them.
**Predecessors:** Stage 4 (`…-stage-4-dispatcher.md`) — read its Findings ledger, NEW-17/NEW-18/NEW-20
are inputs. Stage 5 (`docs/superpowers/stage-5-breakage-inventory.md`) — **not a predecessor in
sequence**: it is Tim's, it has not started, and 6.4 is the only task here that depends on it.
**Companion:** `docs/phase-model-explained.md` §9 — the plain-English version of every finding below,
with reproduction steps. Findings are cross-referenced by their F-numbers throughout.
**Status:** ready to execute. 6.0–6.3 have no external dependency and can start immediately.

**Goal:** close the phase model's unhappy paths so a trip can always reach a terminal state, make the
error surface consistent, then prove the whole thing end-to-end and retire the last of the handshake
vocabulary.

**Why this stage exists at all.** Stages 0–4 built and shipped the happy path, and it is genuinely
solid: 51 phase tests green, the gate reads the plan, idempotent replay works, ownership is checked
before the type cross-check. What no stage owned was **what happens when a trip cannot proceed**. Three
enum values the gating logic already depends on — `PhaseStatus.OVERRIDDEN`, `TripStatus.CANCELLED`, and
the `dispatcher_override_*` columns — are modelled, read, and **written by nothing**. The result is a
trip that detects seal tampering and then can never be completed, closed, cancelled, or released. That
is the exact scenario FreightProof exists to detect, and it is a dead end.

**Tech Stack:** Python 3.13, FastAPI 0.115+, SQLAlchemy 2.0 async (`Mapped`/`mapped_column`), Pydantic
v2, pytest + pytest-asyncio (`asyncio_mode = auto`). Frontend side (6.4 only): Next.js 15 App Router,
React 19, TypeScript 5.5+ (no `any`), vitest 3.

---

## Invariants — must not break

- Layering: endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db.
  `integrations/` never imports from `api/` or `orchestration/`. `db/` never imports from `app/`.
- POPIA: only SHA-256 hashes reach Hedera. No GPS, photos, names, or parcel details in any canonical
  payload. Personal data stays in Postgres. **This stage adds no anchor and changes no canonical
  payload.** Task 6.0 deliberately does *not* anchor overrides — see D3.
- RLS: FastAPI runs as `service_role` and bypasses RLS, so RLS breakage is SILENT. *(No RLS surface in
  this stage — no tables are added or renamed.)*
- **The ledger is the truth.** `current_phase`/`current_stop` are caches (parent D6). Every task here
  that resolves a phase must call `recompute_position()` rather than assigning the cache directly.
- **Length is data.** Nothing may hard-code 6 phases or sequence 0..6.
- **Anchor policy is unchanged:** P0 fail-closed; P3/P6 fail-open with `anchor_status` recorded;
  P1/P2/P4/P5 not anchored. An overridden phase does **not** acquire or clear an anchor obligation (D3).
- Never run git write commands. Suggest commits; the developer runs them.
- Latest stable only: SQLAlchemy 2.0 `Mapped`/`mapped_column`, Pydantic v2, async endpoints via
  `get_db()`, no `any` in TypeScript.
- **`backend/tests/unit/test_phase_meta_contract.py` parses a frontend file.** It reads
  `frontend/shared/lib/constants/phase-meta.ts` and fails if `STEP_SLUGS` drifts from
  `backend/app/core/phase_meta.py`. **No task in this stage edits either file.** If one becomes
  necessary, both must move together and the backend gate must be re-run.

---

## Objective

Give every trip a reachable terminal state — closed, cancelled, or released-then-closed — make the API's
error surface uniform, and then demonstrate a multi-stop trip end-to-end across both surfaces.

## Why now

6.0–6.3 are prerequisites for 6.4, not merely adjacent to it. **A trip in `EXCEPTION_HOLD` cannot be
walked end-to-end**, so the parent plan's "Done when: the feasibility thesis is demoable from a cold
start" is unreachable until the hold has an exit. The empty-leg 404 (F1) blocks the same walk for the
repositioning shape. Doing the hardening first means 6.4 tests a system that can actually finish.

6.4 additionally requires **Stage 5** (Tim, not started as of 2026-08-01). 6.0–6.3, 6.5 and 6.6 do not.

## Prerequisites

- [ ] Backend suite baselined immediately before starting. Expected: **366 passed / 7 failed / 0
      skipped**. The 7 are pre-existing and tracked (Stage 4 ledger: *"same set, unchanged by name"*) —
      1 stale assertion in `test_create_trip_response_shape` plus 6 shared-DB pollution failures
      (409/404). **Do not chase them here; 6.3 step 5 fixes the stale assertion only.**
- [ ] Dispatcher `vitest` baselined: **30 passed / 1 failed**. The failure is NEW-20
      (`lib/api/client.test.ts`, "does not retry a POST when the connection drops"), pre-existing and
      unrelated. **"vitest fully green" is not an achievable exit criterion for any task in this plan.**
- [ ] `ruff check .` and `mypy .` clean. Both have blocked merges before (`52ddb3b`, `fa60fe5`).
- [ ] Confirm the dead-end is still real before building the fix (it is the whole premise):
      ```
      grep -rn "OVERRIDDEN\|dispatcher_override" backend/app/ --include="*.py" \
        | grep -v "models/enums\|models/phases\|schemas/phases"
      grep -rn "\.status = TripStatus" backend/app/ --include="*.py"
      ```
      Expected: the first returns only *reads* (`phase_service.py:105`, `:118`,
      `resource_service.py:114`); the second returns only `CLOSED`, `ACTIVE`, `EXCEPTION_HOLD`.
      **`CANCELLED` and `OVERRIDDEN` must appear as write targets nowhere.** If they now do, someone
      else has started this — stop and reconcile.

---

## Decisions — locked, do not re-derive

### D1 — `release` and `override` are two different actions, not one

The instinct is "add an override and it unsticks everything". It doesn't, because there are **two
distinct dead-ends with different causes**:

| Dead end | Cause | Fix |
|---|---|---|
| `trip.status == EXCEPTION_HOLD` | `advance_unloading`'s destination-seal mismatch (`phase_service.py:495`). `_gate_and_load`'s trip-status check (`:136`) then rejects every subsequent completion. | **release** — a *trip*-level action |
| A phase stuck `PENDING`/`IN_PROGRESS` | The driver cannot complete it — lost phone, left the depot, device wiped. The gate blocks every later phase. | **override** — a *phase*-level action |

Note carefully: on the seal-mismatch path the phase row is set to `EXCEPTION`, and `_is_resolved()`
(`:105`) **already treats `EXCEPTION` as resolved**. So the phase is not what blocks — `trip.status`
is. Overriding that phase would therefore fix nothing. Build both actions, keep them separate.

### D2 — Three endpoints, on their own dispatcher-scoped router

`POST /trips/{trip_id}/release` · `POST /trips/{trip_id}/cancel` ·
`POST /trips/{trip_id}/phases/{phase_event_id}/override`

**All three go in a new `backend/app/api/v1/endpoints/trip_admin.py`**, prefix `/trips/{trip_id}`,
`tags=["trip-admin"]`, `Depends(get_current_dispatcher)`.

**Why a new file rather than adding to `phases.py`:** Stage 3's decision S3 made the phases router
*driver-scoped*, deliberately — *"giving these routes a second auth path would be new security surface
with no consumer."* An override route is dispatcher-only. Putting it in `phases.py` would put two auth
audiences in one file, which is precisely what S3 was protecting against. A separate file keeps the
audience split visible at the filesystem level. FastAPI resolves the overlapping prefixes fine; the
separation is for humans.

### D3 — An override does not touch `anchor_status`

If a `departure` is overridden, no seal evidence exists, so nothing can be anchored. Leave
`anchor_status` exactly as it is — `PENDING` for an anchored phase type. It then honestly reads *"this
phase should have carried a receipt and does not"*, which is true and is what `anchorTally()`
(`derive.ts:96`) will surface as `owed > anchored`. Setting it to `NOT_REQUIRED` would launder a real
gap in the evidence chain; setting it to `FAILED` would claim an anchor was attempted. Neither is true.

### D4 — An overridden phase gets a `completed_at`

Not because it was completed — the `status` field carries that truth — but because the dispatcher
timeline reads `completed_at` for its card timestamp, and an undated row in a chronological view is a
worse lie than a dated one. Mirrors `_finish_phase`'s existing
`event.completed_at = event.completed_at or now()`. Comment it at the assignment.

### D5 — `release` resolves the trip's open exceptions; `override` does not

A release *is* the resolution of whatever held the trip, so it sets `resolved`,
`resolved_by_user_id`, `resolved_at` and `resolver_note` on every unresolved `TripException` for that
trip (columns already exist, `transit.py:90-95`). An override is narrower — it unblocks one phase and
makes no claim about any exception, so it touches none.

Both write a new `TripException` with `source = ExceptionSource.DISPATCHER` recording the action
itself, so the intervention is on the ledger rather than only in an audit column. `DISPATCHER` already
exists in the enum (`enums.py:110`).

### D6 — Both actions require a non-empty note

`min_length=1` on the Pydantic field, so a blank note is a 422 rather than an empty string on the
record. A dispatcher overriding driver-attested evidence without stating why is the single most
audit-sensitive thing in this system.

### D7 — 6.1's `Optional` fix does **not** close NEW-17. Say so in the code.

Making `_find_loading_for_leg` return `None` fixes the *empty-leg* case (no loading row at all). A
multi-pickup → multi-drop trip **still finds a preceding loading row — the wrong one** — so NEW-17's
false `WAYBILL_COUNT_MISMATCH` survives this stage untouched. The docstring must say this explicitly,
or the next reader will assume the Optional return solved both.

### D8 — Row-level locking, not optimistic retry

`_load_phase_event` gains `.with_for_update()`. The second of two concurrent completions then blocks
until the first commits, re-reads the row as resolved, and returns the idempotent 200 that
`_gate_and_load` already implements. No new code path, no retry loop.

This must be a **lock, not a uniqueness check after the fact**: the partial unique index on
`idempotency_key` fires at flush time, which is *after* `_anchor_or_fail_open` has already submitted to
Hedera. A rolled-back transaction cannot un-submit an on-chain message, so an orphan receipt would be
permanent. The lock is what prevents the second submission from ever happening.

---

## Tasks

### Task 6.0 — Lifecycle exits: `release`, `cancel`, `override` *(closes the dead-end)*

**Where:** `backend/app/orchestration/trip_service.py` (release, cancel) ·
`backend/app/orchestration/phase_service.py` (override) ·
`backend/app/api/v1/endpoints/trip_admin.py` (new) · `backend/app/main.py` (router registration) ·
`backend/app/schemas/trips.py` (request bodies).

**Fence:** does not touch `advance_*`, the plan generator, any canonical payload, or any anchor call.
Does not change `_is_resolved`. `main.py` is a **shared file** — flag it in TASK COMPLETE.

- [ ] **Step 1 — write the failing tests first.** `tests/integration/test_trip_admin.py`. Each must
      fail for the right reason (404 route not found), not an assertion error.

- [ ] **Step 2 — `release_trip()` in `trip_service.py`.**
      ```
      Guard: trip.operator_organization_id == user.organization_id, else ResourceNotFoundError (404).
      Guard: trip.status must be EXCEPTION_HOLD, else TripStateError (409).
      trip.status = TripStatus.ACTIVE
      Resolve every unresolved TripException on the trip (D5).
      Add a TripException(source=DISPATCHER, severity=INFO, type=<see below>) recording the release.
      recompute_position(db, trip)   ← the cache must not be assigned by hand
      return get_trip_detail(...)
      ```
      **`recompute_position` may legitimately close the trip here** — if the hold was on the final
      unloading and confirmation is the only row left, releasing does not close it; but if every row is
      resolved, `recompute_position` sets `CLOSED`. That is correct and must not be special-cased.
      Note the ordering: set `ACTIVE` *before* `recompute_position`, so its close-branch can overwrite.

- [ ] **Step 3 — `cancel_trip()` in `trip_service.py`.**
      ```
      Guard: same org check.
      Guard: trip.status not in (CLOSED, CANCELLED), else TripStateError (409).
      trip.status = TripStatus.CANCELLED; trip.closed_at = now()
      Add a TripException(source=DISPATCHER) recording the reason.
      Do NOT touch phase rows — they stay pending forever, which is the honest record of a trip
      that was abandoned mid-plan. Cancelling is not completing.
      ```
      **A cancelled trip is never deleted** — the wizard's own confirmation modal already promises this
      (`trips/new/page.tsx:1044`: *"can only be cancelled to retain evidence"*). This task is what makes
      that promise true.

- [ ] **Step 4 — `override_phase()` in `phase_service.py`.**
      ```
      Guard: same org check (dispatcher-scoped — NOT _load_trip_for_driver).
      Guard: event.status must be PENDING or IN_PROGRESS, else PhaseSequenceError (409).
             An already-resolved row needs no override; a COMPLETED one must not be rewritable.
      event.status = PhaseStatus.OVERRIDDEN
      event.dispatcher_override_user_id = user.id
      event.dispatcher_override_note    = payload.note
      event.completed_at = now()          ← D4, comment it
      # anchor_status deliberately untouched — D3, comment it
      recompute_position(db, trip)
      ```
      **Lives in `phase_service.py`, not `trip_admin.py`** — it writes a `PhaseEvent` and must call
      `recompute_position`, both of which that module owns.

- [ ] **Step 5 — `TripStateError` in `core/exceptions.py`.** Carries `current_status` and
      `attempted_action`; maps to 409. Do **not** reuse `PhaseSequenceError` — it means "out of order in
      the plan", and a cancel on a closed trip is a different thing. Framework-agnostic, per that
      module's docstring.

- [ ] **Step 6 — `trip_admin.py` + register in `main.py`.** Catch `ResourceNotFoundError` → 404,
      `TripStateError`/`PhaseSequenceError` → 409, `SQLAlchemyError` → 500 with `logger.exception`
      (matching `trips.py:81`, and see 6.3).

### Task 6.1 — Empty-leg trips can reach `closed` *(F1)*

**Where:** `backend/app/orchestration/phase_service.py` only.
**Fence:** `_find_departure_for_leg` is NOT changed — every plan that reaches confirmation has a
departure. Only the loading lookup is optional.

- [ ] **Step 1 — failing test.** `test_empty_leg_trip_walks_to_closed` in
      `tests/integration/test_phases.py`. Expect the current failure to be **404**
      (`ResourceNotFoundError("PhaseEvent", "loading")` from `phase_service.py:552`), not an assertion.
- [ ] **Step 2 —** `_find_loading_for_leg` returns `PhaseEvent | None`; drop the raise.
      **Add D7's caveat to the docstring** — this does not fix NEW-17.
- [ ] **Step 3 —** in `advance_confirmation`, when it returns `None`: skip reconciliation entirely, set
      `PhaseStatus.COMPLETED`, and `logger.info` that no origin baseline existed. **Do not** fall back
      to treating a missing count as `0` — that manufactures a mismatch on a trip that by definition
      carries no cargo.
- [ ] **Step 4 —** guard the same branch for `origin_count is None`. A loading row that was
      **overridden** in 6.0 has a null `driver_visual_count`, and `None == pp_scan_in_count` is `False`
      — so without this, every overridden loading produces a false `WAYBILL_COUNT_MISMATCH`. **6.0
      makes this reachable; it was not before.**

### Task 6.2 — Concurrency: lock the phase row *(D8)*

**Where:** `backend/app/orchestration/phase_service.py`, `_load_phase_event` only.

- [ ] **Step 1 —** add `.with_for_update()` to the `select(PhaseEvent)` in `_load_phase_event`
      (`:86-95`). Every caller goes through it, so one edit covers `complete_phase`, all five wrappers,
      and 6.0's override.
- [ ] **Step 2 —** verify `_auto_complete_in_transit` and `_find_*_for_leg` are **not** locked. They
      read neighbouring rows, and locking them would widen the lock's footprint to most of the plan for
      no benefit.
- [ ] **Step 3 —** confirm asyncpg emits `FOR UPDATE` (`echo=True` on a scratch engine, or read the
      compiled SQL in a unit test). A silently-ignored lock hint is worse than none, because it looks
      handled.

### Task 6.3 — Consistent error surface

**Where:** `backend/app/api/v1/endpoints/phases.py` · `backend/app/main.py` ·
`backend/tests/integration/test_trips.py`.
**Fence:** the global handler must **re-raise `HTTPException` untouched** — swallowing it would turn
every deliberate 404/409 in the codebase into a 500. Test that explicitly.

- [ ] **Step 1 —** add `except SQLAlchemyError` → 500 + `logger.exception` to
      `complete_phase_endpoint` (`phases.py:97-100`). It currently catches three domain exceptions and
      lets DB faults escape as a bare 500; `trips.py:81` already does this correctly — copy that shape.
- [ ] **Step 2 —** add a global `Exception` handler in `main.py` returning a JSON body
      (`{"detail": "Internal server error."}`) and logging with `logger.exception`. There is **none
      today** — verified: `grep -n "exception_handler" app/main.py` returns nothing.
- [ ] **Step 3 —** add `logger` to `main.py` if absent.
- [ ] **Step 4 —** test: a deliberate `HTTPException(404)` still returns 404, not 500.
- [ ] **Step 5 —** fix the stale assertion in
      `test_trips.py::test_create_trip_response_shape` — it asserts `blockchain_receipts == []` but
      creation returns the journey-lock receipt. Assert **one** receipt of type `journey_lock` instead.
      **This is the only one of the 7 pre-existing failures this stage touches.** NEW-19's separate,
      intermittent Hedera-timeout failure on the same test is *not* fixed here — mocking Hedera in the
      create-trip tests is its own task and is out of scope.

### Task 6.4 — End-to-end multi-stop walk *(parent 6.1 · joint · BLOCKED on Stage 5)*

**Blocked:** requires Tim's driver-PWA cut-over. As of 2026-08-01 Stage 5 has not started — last commit
touching `driver-pwa/{app,lib,components}` is `4c2a0de`, 2026-07-25, *before* the refactor began.
**Do not attempt 6.4 until `frontend/driver-pwa` type-checks.**

- [ ] Walk `FP-DEMO-ACTIVE-0001` (3-stop cross-dock, 11 rows) end-to-end: driver completes each phase,
      dispatcher timeline reflects each one.
- [ ] Prove two `loading` rows open **their own** manifest panels (keyed on `phase_event_id`).
- [ ] Prove each departure shows **its own** seal — the multi-stop proof on screen.
- [ ] Walk one **empty leg** to `closed` (needs 6.1).
- [ ] Walk one trip into `EXCEPTION_HOLD` via a destination-seal mismatch, then **release** it and carry
      it to `closed` (needs 6.0). **This is the single most valuable thing to have on film** — it is the
      product's headline scenario and today it dead-ends.
- [ ] Note the dispatcher does **not** poll (`useAsyncData` fetches once on mount). Either refresh
      manually during the walk or accept it; adding polling is out of scope here.

### Task 6.5 — Reseed + demo script *(parent 6.2)*

- [ ] Re-run `scripts/seed_trips.py` against the demo DB; confirm 7-row, 11-row and walked-through-seq-4
      trips all load clean.
- [ ] Write the demo narrative. **State plainly that PP load/unload completion is simulated** (spec §6)
      — over-claiming there is exactly what gets probed at a presentation.
- [ ] **State that the manifest shows committed, not scanned, cargo** (F3). `pp_scan_out_at` /
      `pp_scan_in_at` are read in three places and written in none; `PPTrack` carries no scan status at
      all. The script must not contain the words "actually scanned".
- [ ] Fold in the trip-boundary answer from `docs/phase-model-explained.md` §3 — *"it's two trips when
      nothing rides through"* — as a prepared response, not an improvised one.
- [ ] **Resolve NEW-18 for the demo:** seeded trips are 1-indexed, HTTP-created trips 0-indexed, so a
      trip created live reads "Stop 0". Either unify (a write-path change — its own task) or script
      around it. **Decide before the walk, not during it.**

### Task 6.6 — Vocabulary sweep *(parent 6.3 · 🔴 4-reviewer PR — start early)*

**`CLAUDE.md` requires a PR reviewed by all four team members.** The parent plan warns to raise this
early in Stage 6, not on the last day. **Open the conversation when 6.0 starts, not when 6.6 does.**

- [ ] `CLAUDE.md` — the "Five handshakes" section and the `orchestration/` description both still
      encode the retired model.
- [ ] `docs/glossary.md`, Technical Full Picture → v1.1.
- [ ] `frontend/shared/lib/constants/copy.ts:36` — dead string `'Start trip · Begin Handshake 1'`.
- [ ] **Coordinate the `TripException.handshake_event_id` → `phase_event_id` rename with Tim** (F7).
      It is listed in his Stage 5 inventory as his, because it touches
      `driver-pwa/lib/context/TripContext.tsx`. Renaming it also lets
      `trips/[id]/page.tsx:360`'s index-guessing loop be deleted in favour of an exact match.

---

## Tests to write

| Test | Proves | File |
|---|---|---|
| `test_release_returns_held_trip_to_active` | The dead-end has an exit | `integration/test_trip_admin.py` |
| `test_release_resolves_open_exceptions` | D5 | ″ |
| `test_release_rejects_a_trip_that_is_not_held` | 409, not a silent no-op | ″ |
| `test_cancel_sets_cancelled_and_preserves_phase_rows` | Evidence survives cancellation | ″ |
| `test_cancel_rejects_a_closed_trip` | 409 | ″ |
| `test_override_resolves_a_pending_phase_and_unblocks_the_next` | The gate advances past it | ″ |
| `test_override_rejects_a_completed_phase` | Completed evidence is not rewritable | ″ |
| `test_override_leaves_anchor_status_untouched` | D3 — the gap stays visible | ″ |
| `test_override_requires_a_note` | 422 on blank — D6 | ″ |
| `test_admin_routes_reject_a_foreign_org_trip` | 404, not 403 — no existence disclosure | ″ |
| `test_empty_leg_trip_walks_to_closed` | F1 | `integration/test_phases.py` |
| `test_confirmation_skips_reconciliation_when_no_loading_exists` | No manufactured mismatch | `unit/test_phase_service.py` |
| `test_confirmation_skips_reconciliation_when_origin_count_is_null` | 6.1 step 4 — the overridden-loading case | ″ |
| `test_load_phase_event_emits_for_update` | The lock is real, not ignored | ″ |
| `test_phase_complete_maps_db_error_to_500` | 6.3 step 1 | `integration/test_phases.py` |
| `test_global_handler_preserves_http_exceptions` | The handler doesn't eat 404s | `integration/test_trips.py` |

---

## Out of scope — named, with why

- **F2 / F2b(NEW-17) / F9 — the consignment-mapping block.** Per-consignment stop assignment in
  `TripConsignmentInput`, the multi-stop wizard, per-consignment reconciliation, and the
  "is this really one trip?" validation. **All four touch the same consignment→stop mapping and should
  land together or not at all.** NEW-17's own ledger entry says the fix is per-consignment
  reconciliation, not a better sequence heuristic — doing it piecemeal means doing it twice. Its own
  stage.
- **NEW-8 — real `in_transit` completion via checkpoint Merkle batches.** Unchanged since Stage 2 and
  deliberately so; the batching infrastructure does not exist in this codebase.
- **NEW-18 — unifying stop indexing.** A write-path behaviour change. 6.5 scripts around it.
- **F5 — the `isResolved` divergence.** Stage 4 *specified* the frontend predicate and locked it with a
  test. Changing it is a design decision needing a call, not a bug fix — and it changes rendering, which
  6.4 is trying to observe. Do it after the walk, not during.
- **F6 — the unloading manifest's blank reconciliation rows.** Cosmetic; `ReconciliationRows` already
  degrades correctly (null ≠ zero).
- **Dispatcher polling.** `useAsyncData` fetches once. Live-updating the timeline is a feature, not a
  fix.
- **Mocking Hedera in the create-trip tests (NEW-19).** Real, but its own task — 6.3 step 5 fixes only
  the stale assertion.
- **Everything in `frontend/driver-pwa`.** Tim's, Stage 5. 6.4 consumes it and does not modify it.

---

## Verification

```bash
# Backend — the full gate, all three, from backend/
cd backend
ruff check .                     # expect: All checks passed!
mypy .                           # expect: no issues found in 161+ source files
.venv/bin/python -m pytest -q    # expect: 382+ passed / 6 failed / 0 skipped
```

**Read that failure count carefully.** The baseline is 366/7. This stage adds ~16 tests and fixes
exactly one pre-existing failure (6.3 step 5), so the expected exit is **~382 passed / 6 failed**. The
6 remaining are the shared-DB pollution failures (drivers ×3, `blockchain_verify`, vehicles ×2) and
would pass on a clean database. **A different count, or a different failure by name, means this stage
broke something — investigate before proceeding.**

```bash
# Dispatcher — unchanged by 6.0–6.3, so this is a regression check only
cd frontend/dispatcher
npx tsc --noEmit                 # expect: exit 0
npx eslint .                     # expect: exit 0
npx vitest run                   # expect: 30 passed / 1 failed  (NEW-20, pre-existing)
```

```bash
# The dead-end is closed — the one-command proof
grep -rn "\.status = TripStatus" backend/app/ --include="*.py"
#   must now include CANCELLED (trip_service.py) and ACTIVE from release
grep -rn "PhaseStatus.OVERRIDDEN" backend/app/ --include="*.py"
#   must now include a WRITE in phase_service.py, not only the reads at :105/:118
```

**Manual (after 6.0, before 6.4):** create a trip → walk it to unloading → submit a mismatched
destination seal → confirm 409 on the next phase → `POST /release` → confirm the trip completes and
closes. **This is the walk that is impossible today.**

---

## Done when

A trip that detects seal tampering at the destination can be released by a dispatcher, carried to
`closed`, and shows both the exception and the release on its timeline — and an empty-leg trip reaches
`closed` without a 404.

*(6.4's end-to-end walk is the parent plan's "demoable from a cold start" criterion and remains blocked
on Stage 5. 6.0–6.3 are independently shippable and are the point of this stage.)*

---

## Findings ledger

*(To be completed during execution. Follow the structure Stages 2–4 used: suite numbers before and
after measured by the orchestrator rather than quoted from a subagent, decision-by-decision outcomes,
defects found in this plan's own literal code, anything carried forward, and an honest assessment of
"Done when". Continue the NEW-n numbering from **NEW-21**.)*
