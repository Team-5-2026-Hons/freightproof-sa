# Phase Refactor — Stage 6: Lifecycle Hardening, Integration & Demo (6.0 – 6.7)

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. Executed by subagents that start cold and cannot ask questions — every decision a
> cold agent would otherwise have to guess at is locked below in §Decisions.

**Created:** 2026-08-01 · **Revised: 2026-08-05** (see §Revision below — the Aug-1 premise changed
materially and this document was rewritten against measured state, not re-dated)
**Owner:** Ciaran · **Branch:** `Phase-refactor` @ `c4205d6`
**Parent plan:** `docs/superpowers/plans/2026-07-25-phase-model-refactor.md` — *that document is the
source of truth. If this plan and the parent disagree, the parent wins.* This plan **supersedes and
expands** the parent's three-bullet Stage 6 sketch (§7): its 6.1/6.2/6.3 become **6.5/6.6/6.7** here,
and five hardening tasks are inserted ahead of them.
**Predecessors:** Stage 4 (`…-stage-4-dispatcher.md`) — read its Findings ledger. Stage 5
(`…-2026-08-04-phase-refactor-stage-5-driver-pwa.md`) — **landed and green** as of 2026-08-05, which
unblocks 6.5.
**Companion:** `docs/phase-model-explained.md` §9 — the plain-English version of the findings below,
with reproduction steps. Findings are cross-referenced by their F-numbers throughout. **§9 F10 is now
stale** — see §Revision.
**Status:** ready to execute. 6.0 is a hard gate on everything else.

**Goal:** get the branch back to a green CI gate, give every trip a reachable terminal state, make the
error surface uniform, then prove the whole thing end-to-end across both surfaces and retire the last
of the handshake vocabulary.

**Tech Stack:** Python 3.13, FastAPI 0.115+, SQLAlchemy 2.0 async (`Mapped`/`mapped_column`), Pydantic
v2, pytest + pytest-asyncio (`asyncio_mode = auto`). Frontend side (6.5 only): Next.js 15 App Router,
React 19, TypeScript 5.5+ (no `any`), vitest 3.

---

## Revision — what changed between 2026-08-01 and 2026-08-05

Four devs merged into `Phase-refactor` in that window. Three of this plan's original premises are no
longer true, and three new problems appeared. **Everything below was re-measured on `c4205d6`, not
carried over.**

### Premises that died

**1. 🔴 The `EXCEPTION_HOLD` dead-end no longer exists — so `release` is cut from this plan.**
The Aug-1 plan's headline task was a `release` endpoint to rescue trips stuck in `EXCEPTION_HOLD`.
That dead-end was closed a different way: `advance_unloading`'s destination-seal mismatch **no longer
sets `EXCEPTION_HOLD` at all**. `phase_service.py:895-911` documents the removal and gives three
reasons — the hold destroyed the remaining evidence of the very trip whose integrity it was reacting
to; it contradicted T3's `_is_resolved`, which already treats `EXCEPTION` as resolved for gating; and
departure's own seal mismatch had never held a trip, so two seal mismatches behaving differently was
inconsistent.

Verified: `grep -rn "\.status = TripStatus" app/ --include="*.py"` returns exactly two writes,
`CLOSED` (`phase_service.py:249`) and `ACTIVE` (`:602`). **Nothing in `app/` can hold a trip.**
Consequences carried into the tasks below:
- `release` is **dropped**. Nothing is stuck, so there is nothing to release. *(Decided 2026-08-05.)*
- `EXCEPTION_HOLD` survives as a documented-unreachable status kept for a future **manual** hold.
  `_gate_and_load`'s check for it (`:205`) is deliberately-retained dead code — the comment at
  `:198-204` says so and names the test that keeps it covered. **Do not delete it.**
- `frontend/driver-pwa/components/trip/HoldNotice.tsx` now renders for a state that cannot occur, and
  still says "handshake" three times. It is dead UI — handled in 6.7, not deleted silently.

**2. ✅ Stage 5 landed. 6.5 is unblocked.**
The Aug-1 plan blocked its end-to-end walk on Tim's driver-PWA cut-over, which had not started.
It is done and green (measured, §Baselines): `tsc --noEmit` **0 errors** (from 56), `eslint` clean,
`vitest` **67 files / 462 tests, all passing** (from 17 collection failures). The driver-pwa CI job
should be green for the first time since `c132f45`.

**3. ✅ The dispatcher is no longer a one-shot fetch.**
Tom's org-wide SSE bus landed (`b46510a`, PR #34): `app/core/realtime.py`, `app/api/v1/endpoints/stream.py`,
and a `RealtimeProvider` on the dispatcher. The Aug-1 note *"the dispatcher does not poll — refresh
manually during the walk"* is obsolete. **Two consequences:**
- 6.5 should now *verify* live updates rather than work around their absence.
- **Any new lifecycle action must `enqueue_event`**, or the dispatcher silently won't update. This is
  new required work the Aug-1 plan could not have known about — see D9.

### Problems that appeared

**4. 🔴 CI is red on this branch. Both linters fail, and mypy checks nothing at all.**
`ruff check .` → **2 errors**; `mypy .` → **1 error that halts collection before a single file is
type-checked**. Both are CI steps (`.github/workflows/ci.yml:60-66`) and both have blocked merges
before (`52ddb3b`, `fa60fe5`). Behind the mypy halt sit **2 genuine type errors** nothing has been
reporting. Full detail and root cause in Task 6.0.

**5. 🔴 A real regression: a trip with no schedule can be created and then never activated.**
`test_create_trip_multistop.py::test_create_trip_output_is_immediately_advanceable` fails with 409
**in isolation** — it is not the shared-DB pollution the Aug-1 plan attributed such failures to
(confirmed by running that file alone). Cause: the new `_reject_if_not_due` gate (`phase_service.py:454-476`)
treats "no schedule at all" as permanently not-due, but `TripCreateRequest.planned_departure_at` is
`Optional` (`schemas/trips.py:138`) and no stop `slot_time` is required either. The dispatcher wizard
*does* require a departure (`trips/new/page.tsx:287`), so the UI path is safe — but the API, a script,
or a seeder can mint a trip that is unactivatable forever. Task 6.0 step 3.

**6. 🟠 The dispatcher already renders overrides that nothing can write.**
`89ad3c3` added `components/domain/PhaseOverrideSection.tsx`, which renders
`dispatcher_override_note` / `dispatcher_override_user_id` on every phase type, and its own comment
notes an override is *"never a footnote"*. `lib/phase/derive.ts:recordedExceptionLabel` states outright
that *"the backend has no dispatcher resolve endpoint, so `resolved` is false on every real record"*.
The consumer for Task 6.1's override endpoint is **already built and waiting**. This strengthens 6.1
rather than changing it.

### Also new, and relevant to the demo

- **Driver device binding landed** (`0f8f0d2`): `DriverSession`, migration
  `2026_08_05_tim_add_driver_sessions`, enforced in `auth/dependencies.py`. One driver account is now
  bound to one device. **This is a demo-day trap** — rehearsing on a laptop and presenting from a
  phone means a rebind. Folded into 6.6.
- **Evidence artifacts are fenced to their trip** and a destination seal photo is required
  (`4e4cf93`, `441b986`).
- **`copy.ts`'s dead `'Start trip · Begin Handshake 1'` string is already gone** — one 6.7 item
  closed by Stage 5. `TripException.handshake_event_id → phase_event_id` (F7) is also done.

---

## Baselines — measured 2026-08-05 on `Phase-refactor` @ `c4205d6`

**Do not quote the Aug-1 numbers (366/7, vitest 30/1). They are superseded.**

| Gate | Result | Notes |
|---|---|---|
| `cd backend && ruff check .` | 🔴 **2 errors** | `F841` ×2, `tests/unit/test_phase_anchor_payload.py:282` and `:302` |
| `cd backend && mypy .` | 🔴 **1 error, halts** | `scripts/seed_trips.py: Source file found twice` — **0 files type-checked** |
| `cd backend && mypy app` | 🔴 **2 errors** | `app/api/v1/endpoints/exceptions.py:32` — `float \| None` passed where `Decimal \| None` expected (×2). Masked by the halt above. |
| `cd backend && pytest -q` | **496 passed / 8 failed / 4 skipped** | 2m20s. Failure breakdown below. |
| `cd frontend/dispatcher && npx tsc --noEmit` | ✅ exit 0 | |
| `cd frontend/dispatcher && npx vitest run` | **87 passed / 1 failed** | The 1 is NEW-20, `lib/api/client.test.ts` *"does not retry a POST when the connection drops"* — pre-existing, unrelated |
| `cd frontend/driver-pwa && npx tsc --noEmit` | ✅ **0 errors** | was 56 |
| `cd frontend/driver-pwa && npx eslint .` | ✅ exit 0 | |
| `cd frontend/driver-pwa && npx vitest run` | ✅ **67 files / 462 tests, all pass** | was 17 collection failures |

### The 8 backend failures, classified

| # | Test | Class | Handled by |
|---|---|---|---|
| 1 | `test_create_trip_multistop.py::test_create_trip_output_is_immediately_advanceable` | 🔴 **real regression** — fails in isolation | **6.0 step 3** |
| 2 | `test_trips.py::test_create_trip_response_shape` | stale assertion (`blockchain_receipts == []`; creation returns the journey-lock receipt) | **6.0 step 4** |
| 3 | `test_blockchain_verify.py::test_verify_returns_no_receipt_for_unknown_subject` | shared-DB pollution | not fixed here |
| 4–5 | `test_drivers.py` ×2 (409/404) | shared-DB pollution | not fixed here |
| 6 | `test_drivers_anchor.py::test_create_driver_does_not_anchor_pii` | shared-DB pollution | not fixed here |
| 7–8 | `test_vehicles_cosmetic_diff.py`, `test_vehicles_validation.py` | shared-DB pollution | not fixed here |

**Exit target for this stage: 6 failed, and only the six pollution failures by name.**

> ⚠️ **The 4 skips are intentional** — two parametrised cases in `tests/unit/test_seed_fixtures.py:149,158`
> that are covered by neighbouring tests. The parent plan's "skip floor" language predates them.
> **4 is the floor now, not 0.**

> 🔴 **Never run two pytest invocations concurrently.** Both share one `TEST_DATABASE_URL`. Proven on
> 2026-08-05: two overlapping runs reported **25 failed / 83 errors** against the same tree that a
> single clean run scored **8 failed**. If you see errors in the dozens, you have a second run in
> flight, not a broken branch. Re-run alone before believing any number.

---

## Invariants — must not break

- Layering: endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db.
  `integrations/` never imports from `api/` or `orchestration/`. `db/` never imports from `app/`.
- POPIA: only SHA-256 hashes reach Hedera. No GPS, photos, names, or parcel details in any canonical
  payload. Personal data stays in Postgres. **This stage adds no anchor and changes no canonical
  payload.** Task 6.1 deliberately does *not* anchor overrides — see D3.
- RLS: FastAPI runs as `service_role` and bypasses RLS, so RLS breakage is SILENT. *(No RLS surface in
  this stage — no tables are added or renamed.)*
- **The ledger is the truth.** `current_phase`/`current_stop` are caches (parent D6). Every task here
  that resolves a phase must call `recompute_position()` rather than assigning the cache directly.
- **Length is data.** Nothing may hard-code 6 phases or sequence 0..6.
- **Anchor policy is unchanged:** P0 fail-closed; P3/P6 fail-open with `anchor_status` recorded;
  P1/P2/P4/P5 not anchored. An overridden phase does **not** acquire or clear an anchor obligation (D3).
- **The realtime bus is thin by design.** `TripEvent` carries `{resource, id, kind, ts}` and never trip
  data (`core/realtime.py` module docstring, SSE plan D2). **No task here may put data on the bus** —
  that would create a new PII surface outside the authorised GET.
- Never run git write commands. Suggest commits; the developer runs them.
- Latest stable only: SQLAlchemy 2.0 `Mapped`/`mapped_column`, Pydantic v2, async endpoints via
  `get_db()`, no `any` in TypeScript.
- **`backend/tests/unit/test_phase_meta_contract.py` parses a frontend file.** It reads
  `frontend/shared/lib/constants/phase-meta.ts` and fails if `STEP_SLUGS` drifts from
  `backend/app/core/phase_meta.py`. **No task in this stage edits either file.** If one becomes
  necessary, both must move together and the backend gate must be re-run.

---

## Objective

Restore a green CI gate, give every trip a reachable terminal state — closed, cancelled, or
overridden-past — make the API's error surface uniform, and then demonstrate a multi-stop trip
end-to-end across both surfaces with live dispatcher updates.

## Why now

6.0 is a hard gate: **the branch cannot merge today**, so any work stacked on it is unmergeable too.
Fix the gate before adding to it.

6.1–6.4 are prerequisites for 6.5, not merely adjacent to it. The empty-leg 404 (F1) blocks an
end-to-end walk for the repositioning shape, and a phase the driver physically cannot complete blocks
every later phase with no human exit. Doing the hardening first means 6.5 tests a system that can
actually finish.

## Prerequisites

- [ ] Re-measure every row of §Baselines yourself, **one command at a time, no concurrent pytest**.
      If your numbers differ from the table, reconcile before starting — someone else has landed work.
- [ ] Confirm the two dead-ends this stage closes are still real:
      ```bash
      cd backend
      # Expect: NO write to CANCELLED or OVERRIDDEN anywhere. Reads only.
      grep -rn "OVERRIDDEN\|dispatcher_override" app/ --include="*.py" \
        | grep -v "models/enums\|models/phases\|schemas/phases"
      grep -rn "\.status = TripStatus" app/ --include="*.py"
      # Expect: no output at all — nothing in the codebase locks a row.
      grep -rn "with_for_update" app/ --include="*.py"
      # Expect: no output — main.py still has no global handler.
      grep -n "exception_handler" app/main.py
      ```
      Expected today: the first returns only *reads* (`phase_service.py:165`, `:178`,
      `resource_service.py:114`); the second returns only `CLOSED` (`:249`) and `ACTIVE` (`:602`); the
      third and fourth return nothing. **If `CANCELLED` or `OVERRIDDEN` now appear as write targets,
      someone else has started this — stop and reconcile.**
- [ ] `frontend/driver-pwa` type-checks (it does — this is 6.5's gate, confirm it has not regressed).

---

## Decisions — locked, do not re-derive

### D1 — `cancel` and `override` are two different actions. `release` is not built.

*(Revised 2026-08-05. The Aug-1 version of this decision described three actions including `release`.)*

| Dead end | Cause | Fix |
|---|---|---|
| A phase stuck `PENDING`/`IN_PROGRESS` | The driver cannot complete it — lost phone, left the depot, device wiped, bound to a device that is gone. The gate blocks every later phase. | **override** — a *phase*-level action |
| A trip abandoned mid-plan | Cargo pulled, vehicle broken down, trip superseded. It sits `ACTIVE` forever, polluting every active-trip list and blocking the driver's next activation via `_reject_if_another_trip_underway`. | **cancel** — a *trip*-level action |
| ~~`trip.status == EXCEPTION_HOLD`~~ | ~~seal mismatch~~ | **Gone.** Nothing sets it — see §Revision 1. No `release`. |

Note carefully: on the seal-mismatch path the phase row is set to `EXCEPTION`, and `_is_resolved()`
(`:165`) **already treats `EXCEPTION` as resolved**. The trip carries straight on to confirmation with
the anomaly recorded. That is the intended behaviour; do not "fix" it.

**Why `cancel` is worth building even though nothing is stuck.** `_reject_if_another_trip_underway`
(`:496`) means one abandoned `ACTIVE` trip stops that driver ever activating another. Cancel is the
only exit. It is also a promise already made to the user: the wizard's confirmation modal says a trip
*"can only be cancelled to retain evidence"* (`trips/new/page.tsx:1044`). This task makes that true.

### D2 — Two endpoints, on their own dispatcher-scoped router

`POST /trips/{trip_id}/cancel` · `POST /trips/{trip_id}/phases/{phase_event_id}/override`

**Both go in a new `backend/app/api/v1/endpoints/trip_admin.py`**, prefix `/trips/{trip_id}`,
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
(`derive.ts:96`) surfaces as `owed > anchored`. Setting it to `NOT_REQUIRED` would launder a real gap
in the evidence chain; setting it to `FAILED` would claim an anchor was attempted. Neither is true.

### D4 — An overridden phase gets a `completed_at`

Not because it was completed — the `status` field carries that truth — but because the dispatcher
timeline reads `completed_at` for its card timestamp, and an undated row in a chronological view is a
worse lie than a dated one. Mirrors `_finish_phase`'s existing
`event.completed_at = event.completed_at or now()` (`:391`). Comment it at the assignment.

### D5 — Both actions write a `TripException` recording themselves

`source = ExceptionSource.DISPATCHER` (already in the enum, `enums.py:110`), so the human intervention
lands **on the ledger** rather than only in an audit column. This is the whole point of an evidence
platform: a dispatcher bypassing a gate is itself an event worth recording.

Neither action resolves *other* exceptions. *(Revised: the Aug-1 D5 had `release` resolving the trip's
open exceptions. With `release` cut, nothing in this stage sets `resolved` — and `derive.ts`'s
`recordedExceptionLabel` already documents and handles that absence deliberately.)*

### D6 — Both actions require a non-empty note

`min_length=1` on the Pydantic field, so a blank note is a 422 rather than an empty string on the
record. A dispatcher overriding driver-attested evidence without stating why is the single most
audit-sensitive thing in this system.

### D7 — 6.2's `Optional` fix does **not** close NEW-17. Say so in the code.

Making `_find_loading_for_leg` return `None` fixes the *empty-leg* case (no loading row at all). A
multi-pickup → multi-drop trip **still finds a preceding loading row — the wrong one** — so NEW-17's
false `WAYBILL_COUNT_MISMATCH` survives this stage untouched. The docstring must say this explicitly,
or the next reader will assume the Optional return solved both.

### D8 — Row-level locking, not optimistic retry

`_load_phase_event` (`:102-111`) gains `.with_for_update()`. The second of two concurrent completions
then blocks until the first commits, re-reads the row as resolved, and returns the idempotent 200 that
`_gate_and_load` already implements. No new code path, no retry loop.

This must be a **lock, not a uniqueness check after the fact**: the partial unique index on
`idempotency_key` fires at flush time, which is *after* the anchor dispatch has already been queued to
Hedera. A rolled-back transaction cannot un-submit an on-chain message, so an orphan receipt would be
permanent. The lock is what prevents the second submission from ever happening.

### D9 — 🆕 Every lifecycle action must `enqueue_event`, reusing the existing four kinds

*(New 2026-08-05 — the realtime bus did not exist when this plan was first written.)*

`_finish_phase` already publishes (`phase_service.py:399`). A `cancel` or `override` that does not will
leave every dispatcher's screen stale until a manual reload — a visible regression in a system that
now advertises "live" in the sidebar.

**Reuse the existing kinds. Do not add new ones:**

| Action | Kind | Why |
|---|---|---|
| `cancel` | `RealtimeKind.TRIP_CLOSED` | Terminal. The list must drop it from Active — the same refetch `trip_closed` already triggers. |
| `override` | `RealtimeKind.PHASE_COMPLETED` | The plan position moved. Same refetch as any completion. |

**Why not a new `TRIP_CANCELLED` / `PHASE_OVERRIDDEN`:** `RealtimeKind`'s own docstring says it is
*"deliberately coarse — the browser refetches for the detail, so the kind only needs to say which
refetch to run and whether to raise a toast."* Adding a value also forces an edit to
`frontend/dispatcher/lib/realtime/types.ts`, which is a hand-maintained mirror of the Python enum — a
contract change for zero behavioural gain.

**Use `enqueue_event`, never `publish_event`.** SSE plan D9: the service layer only `flush()`es, and
`get_db` commits at the request boundary *after* the endpoint returns (`db/session.py:44`). Publishing
inline would race the dispatcher's refetch against an uncommitted transaction.

### D10 — 🆕 A trip must carry a schedule at creation

*(New 2026-08-05. Decided with the developer.)*

Make `planned_departure_at` **required** in the trip-creation request — or, if a stop carries a
`slot_time`, satisfied by that. Rationale: `_reject_if_not_due` treats "no schedule" as permanently
not-due, and its docstring argues for that strictness deliberately (*"an unscheduled trip is a
dispatcher data gap, and letting it activate would mean the rule silently does nothing on exactly the
records least under control"*). The gate is right; the schema is too loose. The dispatcher wizard
already requires a departure (`trips/new/page.tsx:287`), so this **makes the API match the UI** and
turns a permanent, silent 409-at-activation into an immediate, explanatory 422-at-creation.

**Fence:** do not relax `_reject_if_not_due`. The rule stays; the unrepresentable state goes away.

---

## Tasks

### Task 6.0 — 🔴 Pre-flight: get the branch mergeable *(NEW — hard gate on everything below)*

**Where:** `backend/tests/unit/test_phase_anchor_payload.py` · `backend/scripts/__init__.py` (new) ·
`backend/app/api/v1/endpoints/exceptions.py` · `backend/app/schemas/trips.py` ·
`backend/tests/integration/test_create_trip_multistop.py` · `backend/tests/integration/test_trips.py`.

**Why first:** `ruff` and `mypy` are CI steps. The branch cannot merge in this state, and — worse —
`mypy .` dies during collection, so **no file is being type-checked at all**. Every "mypy clean" claim
made on this branch since the break is void.

- [ ] **Step 1 — ruff: 2 × `F841`.** `tests/unit/test_phase_anchor_payload.py:282` and `:302` assign
      `result = await …` and never read it. Delete the assignment, keep the `await`.
      **Fence:** do not `--fix` the whole tree; these two lines only.

- [ ] **Step 2 — mypy: unblock collection, then fix what it finds.**
      Root cause (verified): `tests/unit/test_seed_fixtures.py:22` does `from scripts.seed_trips import …`,
      so mypy sees the module as `scripts.seed_trips`; but `backend/scripts/` has **no `__init__.py`**,
      so the file-walk also names it `seed_trips` — hence *"Source file found twice under different
      module names"*, which is fatal at collection.
      Fix: add an empty `backend/scripts/__init__.py`. *(Prefer this over `--explicit-package-bases` or
      an `exclude`: the import already treats `scripts` as a package, so this makes the tree honest
      rather than teaching mypy to look away. Confirm the scripts still run standalone afterwards —
      `.venv/bin/python scripts/seed_trips.py --help` or equivalent.)*
      Then fix the **2 real errors this has been hiding**: `app/api/v1/endpoints/exceptions.py:32`
      passes `float | None` for `gps_lat` / `gps_lng` where `raise_exception` expects `Decimal | None`.
      **Fence:** convert at the endpoint boundary; do not widen the service signature to `float` —
      GPS is `Decimal` in the model for a reason.
      **Exit:** `mypy .` reports a checked-file count (86+ under `app` alone), not a collection error.

- [ ] **Step 3 — the schedule regression (D10).** `test_create_trip_multistop.py::test_create_trip_output_is_immediately_advanceable`
      returns 409 because `_single_leg_payload` (`:109`) sends no `planned_departure_at`.
      - Write the failing test first: creating a trip with no schedule and no stop `slot_time` must be
        **422 at creation**, naming the missing field.
      - Make `planned_departure_at` required in the creation request (`schemas/trips.py:138`), satisfied
        alternatively by a stop `slot_time` — mirror `_scheduled_departure`'s own two-source resolution
        (`phase_service.py:434-451`) so the validation and the gate can never disagree.
      - Update every creation payload in the test suite and in `scripts/` to carry a departure.
      **Fence:** `_reject_if_not_due` is **not** touched. Do not relax the gate.
      **Fence:** this is `schemas/trips.py`, a busy file — creation only, no edits to update/response models.

- [ ] **Step 4 — the stale assertion.** `test_trips.py::test_create_trip_response_shape` asserts
      `blockchain_receipts == []`, but creation returns the journey-lock receipt (P0 is fail-closed and
      anchors synchronously). Assert **one** receipt of type `journey_lock` instead.
      **This is the only pollution-adjacent failure this stage touches.** NEW-19's separate,
      intermittent Hedera-timeout failure on the same test is *not* fixed here — mocking Hedera in the
      create-trip tests is its own task and is out of scope.

**Exit for 6.0:** `ruff check .` exit 0 · `mypy .` exit 0 with a real file count ·
`pytest -q` → **6 failed** and every one of the 6 a named pollution failure from §Baselines.

> Suggested commit: `fix(ci): restore ruff and mypy gates, require a trip schedule at creation`

---

### Task 6.1 — Lifecycle exits: `cancel` and `override` *(closes the dead-end)*

**Where:** `backend/app/orchestration/trip_service.py` (cancel) ·
`backend/app/orchestration/phase_service.py` (override) ·
`backend/app/api/v1/endpoints/trip_admin.py` (new) · `backend/app/main.py` (router registration) ·
`backend/app/schemas/trips.py` (request bodies).

**Fence:** does not touch `advance_*`, the plan generator, any canonical payload, or any anchor call.
Does not change `_is_resolved`. Does not build `release` (D1). `main.py` is a **shared file** — flag it
in TASK COMPLETE.

- [ ] **Step 1 — write the failing tests first.** `tests/integration/test_trip_admin.py`. Each must
      fail for the right reason (404 route not found), not an assertion error.

- [ ] **Step 2 — `cancel_trip()` in `trip_service.py`.**
      ```
      Guard: trip.operator_organization_id == user.organization_id, else ResourceNotFoundError (404).
      Guard: trip.status not in (CLOSED, CANCELLED), else TripStateError (409).
      trip.status = TripStatus.CANCELLED; trip.closed_at = now()
      Add a TripException(source=DISPATCHER) recording the reason (D5).
      enqueue_event(db, trip.operator_organization_id,
                    TripEvent(id=trip.id, kind=RealtimeKind.TRIP_CLOSED))   ← D9
      Do NOT touch phase rows — they stay pending forever, which is the honest record of a trip
      that was abandoned mid-plan. Cancelling is not completing.
      Do NOT call recompute_position — it would derive the position of a plan that is no longer
      being walked, and its close-branch would overwrite CANCELLED with CLOSED.
      ```
      **A cancelled trip is never deleted** — the wizard's own confirmation modal already promises this
      (`trips/new/page.tsx:1044`). This task is what makes that promise true.

- [ ] **Step 3 — `override_phase()` in `phase_service.py`.**
      ```
      Guard: same org check (dispatcher-scoped — NOT _load_trip_for_driver).
      Guard: event.status must be PENDING or IN_PROGRESS, else PhaseSequenceError (409).
             An already-resolved row needs no override; a COMPLETED one must not be rewritable.
      event.status = PhaseStatus.OVERRIDDEN
      event.dispatcher_override_user_id = user.id
      event.dispatcher_override_note    = payload.note
      event.completed_at = now()          ← D4, comment it
      # anchor_status deliberately untouched — D3, comment it
      Add a TripException(source=DISPATCHER, phase_event_id=event.id) recording it (D5).
      await recompute_position(db, trip)
      enqueue_event(..., kind=RealtimeKind.PHASE_COMPLETED)   ← D9
      ```
      **Lives in `phase_service.py`, not `trip_admin.py`** — it writes a `PhaseEvent` and must call
      `recompute_position`, both of which that module owns.
      **`recompute_position` may legitimately close the trip here** — if the overridden row was the
      last unresolved one, the trip becomes `CLOSED`. That is correct and must not be special-cased.

- [ ] **Step 4 — `TripStateError` in `core/exceptions.py`.** Carries `current_status` and
      `attempted_action`; maps to 409. Do **not** reuse `PhaseSequenceError` — it means "out of order in
      the plan", and a cancel on a closed trip is a different thing. Framework-agnostic, per that
      module's docstring.

- [ ] **Step 5 — `trip_admin.py` + register in `main.py`.** Catch `ResourceNotFoundError` → 404,
      `TripStateError`/`PhaseSequenceError` → 409, `SQLAlchemyError` → 500 with `logger.exception`
      (matching `trips.py:102`, and see 6.4).

- [ ] **Step 6 — verify the dispatcher renders it with no frontend change.**
      `PhaseOverrideSection.tsx` already reads `dispatcher_override_note` / `dispatcher_override_user_id`
      off `PhaseDescriptor`. Confirm both fields are populated in `PhaseEventRead.from_event` and reach
      the wire. **If they do, this task ships a visible feature with zero frontend edits — say so in
      TASK COMPLETE.** If they don't, that is a schema gap, not a licence to edit the component.

### Task 6.2 — Reconciliation baselines: empty legs *(F1)* and stop-scoped counts *(🆕 F13)*

**Where:** `backend/app/orchestration/phase_service.py` only.
**Fence:** `_find_departure_for_leg` is NOT changed — every plan that reaches confirmation has a
departure. Only the loading lookup is optional.
**Fence:** does **not** add a count to unloading. That is entangled with the wizard's
consignment→stop mapping and is out of scope — see §Out of scope, and F13's note below.

**Both halves are the same bug in two places: reconciliation comparing against the wrong baseline.**

#### 6.2a — Empty-leg trips can reach `closed` *(F1)*

- [ ] **Step 1 — failing test.** `test_empty_leg_trip_walks_to_closed` in
      `tests/integration/test_phases.py`. Expect the current failure to be **404**
      (`ResourceNotFoundError("PhaseEvent", "loading")` from `phase_service.py:781`), not an assertion.
- [ ] **Step 2 —** `_find_loading_for_leg` (`:751`) returns `PhaseEvent | None`; drop the raise.
      **Add D7's caveat to the docstring** — this does not fix NEW-17.
- [ ] **Step 3 —** in `advance_confirmation`, when it returns `None`: skip reconciliation entirely, set
      `PhaseStatus.COMPLETED`, and `logger.info` that no origin baseline existed. **Do not** fall back
      to treating a missing count as `0` — that manufactures a mismatch on a trip that by definition
      carries no cargo. *(`_expected_parcel_count` at `:634` already applies exactly this
      None-is-not-zero principle and cites this fix by name — match its reasoning.)*
- [ ] **Step 4 —** guard the same branch for `origin_count is None` (`:978`). A loading row that was
      **overridden** in 6.1 has a null `driver_visual_count`, and `None == pp_scan_in_count` is `False`
      — so without this, every overridden loading produces a false `WAYBILL_COUNT_MISMATCH`. **6.1
      makes this reachable; it was not before.**

#### 6.2b — 🆕 Scope the loading count to its own stop *(F13 — fires on the demo trip)*

**The check itself already exists and works** — `advance_loading` (`:664-683`) compares the manifest
total against `driver_visual_count` and writes a `PARCEL_COUNT_MISMATCH` (WARNING, phase →
`EXCEPTION`, trip carries on). **Do not rebuild it.** The defect is its baseline.

`_expected_parcel_count` (`:629-639`) sums `Consignment.parcel_count_expected` **trip-wide**, with no
stop filter. A cross-dock trip has more than one `loading` row, so *every* loading is compared against
the whole route's declared total:

> On the seeded `FP-DEMO-XDOCK-0001` (A: stop 1→3, B: 1→2, C: 2→3):
> loading at stop 1 counts A+B but is compared against A+B+C; loading at stop 2 counts C but is
> compared against A+B+C. **Both raise a false `PARCEL_COUNT_MISMATCH`** — on the exact trip
> `seed_trips.py:120` calls *"the trip a reviewer is walked through"*.

- [ ] **Step 1 — failing test first.** Walk the 11-row cross-dock plan and assert **zero**
      `PARCEL_COUNT_MISMATCH` exceptions when each loading's driver count matches what that stop
      actually picks up. It fails today with two.
- [ ] **Step 2 —** give `_expected_parcel_count` a `trip_stop_id` parameter and filter on
      `Consignment.pickup_stop_id == trip_stop_id`. Pass `event.trip_stop_id` from `advance_loading`.
      **Keep the None-not-zero contract exactly as documented** — a stop with no mapped consignments
      returns `None` and skips the check rather than manufacturing a zero.
- [ ] **Step 3 — prove the single-leg path is unchanged.** `trip_service.py:332-333` stamps every
      consignment on an API-created trip `pickup_stop_id = trip_stops[0].id`, so on a 2-stop trip the
      stop-scoped sum is identical to the trip-wide sum. **This fix must be a no-op there**, and a
      regression test should pin that.

> **Why this is small enough to belong here, when the rest of the counting story is not.**
> `Consignment.pickup_stop_id` **already exists and is already populated on both creation paths** —
> per-consignment by `seed_trips.py:315-316`, and first-stop-to-last-stop by `trip_service.py:332-333`.
> No schema change, no migration, no wizard change, no driver-app change, no contract change. It is a
> `WHERE` clause. Everything else in the counting story needs the consignment→stop mapping to become
> *expressible by a dispatcher*, which is the F2 block.

### Task 6.3 — Concurrency: lock the phase row *(D8)*

**Where:** `backend/app/orchestration/phase_service.py`, `_load_phase_event` only.

- [ ] **Step 1 —** add `.with_for_update()` to the `select(PhaseEvent)` in `_load_phase_event`
      (`:102-111`). Every caller goes through it, so one edit covers `complete_phase`, all five
      wrappers, and 6.1's override.
- [ ] **Step 2 —** verify `_auto_complete_in_transit` and `_find_*_for_leg` are **not** locked. They
      read neighbouring rows, and locking them would widen the lock's footprint to most of the plan for
      no benefit.
- [ ] **Step 3 —** confirm asyncpg emits `FOR UPDATE` (`echo=True` on a scratch engine, or read the
      compiled SQL in a unit test). A silently-ignored lock hint is worse than none, because it looks
      handled.

### Task 6.4 — Consistent error surface

**Where:** `backend/app/api/v1/endpoints/phases.py` · `backend/app/main.py` ·
`backend/tests/integration/test_trips.py`.
**Fence:** the global handler must **re-raise `HTTPException` untouched** — swallowing it would turn
every deliberate 404/409 in the codebase into a 500. Test that explicitly.

- [ ] **Step 1 —** add `except SQLAlchemyError` → 500 + `logger.exception` to
      `complete_phase_endpoint` (`phases.py:94-110`). It currently catches `ResourceNotFoundError` and
      a four-exception 409 family, and lets DB faults escape as a bare 500; `trips.py:102` already does
      this correctly — copy that shape.
- [ ] **Step 2 —** add a global `Exception` handler in `main.py` returning a JSON body
      (`{"detail": "Internal server error."}`) and logging with `logger.exception`. There is **none
      today** — verified: `grep -n "exception_handler" app/main.py` returns nothing.
      **Fence:** `main.py` also mounts the SSE route. A global handler must not swallow the streaming
      response's disconnect handling — verify `test_stream.py` still passes after this lands.
- [ ] **Step 3 —** add `logger` to `main.py` if absent.
- [ ] **Step 4 —** test: a deliberate `HTTPException(404)` still returns 404, not 500.

### Task 6.5 — End-to-end multi-stop walk *(parent 6.1 · joint · 🟢 UNBLOCKED)*

**No longer blocked.** Stage 5 landed and `frontend/driver-pwa` type-checks clean (§Revision 2). This
is the parent plan's *"demoable from a cold start"* criterion.

- [ ] Walk `FP-DEMO-XDOCK-0001` (3-stop cross-dock, 11 rows) end-to-end: driver completes each phase,
      dispatcher timeline reflects each one.
- [ ] **Verify the dispatcher updates live, with no manual refresh** — the SSE bus is the newest
      moving part and has never been exercised against a real driver walk. Watch the `LiveBadge`.
      Check phase nodes tick over, exceptions appear, and the trip leaves the Active list on close.
- [ ] Prove two `loading` rows open **their own** manifest panels (keyed on `phase_event_id`).
- [ ] Prove each departure shows **its own** seal — the multi-stop proof on screen.
- [ ] Walk one **empty leg** to `closed` (needs 6.2).
- [ ] Walk one trip into a destination-seal mismatch and confirm it **carries on to `closed`** with the
      exception recorded and the delivery still anchored. **This is the single most valuable thing to
      have on film** — it is the product's headline scenario, and the behaviour changed since Aug 1
      (§Revision 1): the trip no longer stops. Say on camera *why* recording more beats recording less.
- [ ] Exercise **cancel** and **override** from the dispatcher against a live trip (needs 6.1), and
      confirm both appear on the timeline and push a live update.
- [ ] **Test the driver device binding on the actual demo device** (`0f8f0d2`). One account is bound to
      one device; rehearsing on one phone and presenting from another needs a deliberate rebind. Do
      this before demo day, not on it.

### Task 6.6 — Reseed + demo script *(parent 6.2)*

- [ ] Re-run `scripts/seed_trips.py` against the demo DB; confirm the 7-row, 11-row and
      partially-walked trips all load clean **after 6.0 step 3's schedule change** — the seeder is a
      creation path and may need departures added.
- [ ] Write the demo narrative. **State plainly that PP load/unload completion is simulated** (spec §6)
      — over-claiming there is exactly what gets probed at a presentation.
- [ ] **State that the manifest shows committed, not scanned, cargo** (F3). `pp_scan_out_at` /
      `pp_scan_in_at` are read in three places and written in none; `PPTrack` carries no scan status at
      all. **The ScanFeed plan that would fix this (`2026-08-04-scanfeed-dev-trigger-panel.md`) has not
      been executed — verified 2026-08-05, `app/integrations/` contains only `parcel_perfect.py` and
      `supabase_admin.py`.** The script must not contain the words "actually scanned".
- [ ] Fold in the trip-boundary answer from `docs/phase-model-explained.md` §3 — *"it's two trips when
      nothing rides through"* — as a prepared response, not an improvised one.
- [ ] **Resolve NEW-18 for the demo:** still real (verified) — `seed_trips.py:411` writes
      `sequence=i + 1` while `trip_service.py:254-255` writes `sequence=0`/`1`, so a trip created live
      reads "Stop 0" next to seeded trips reading "Stop 1". Either unify (a write-path change — its own
      task) or script around it. **Decide before the walk, not during it.**
- [ ] Prepare the answer to *"what happens when the seal doesn't match?"* — the answer changed on
      2026-08-04 and the old one (*"the trip is held"*) is now wrong.
- [ ] 🆕 **Confirm the demo cross-dock trip now walks clean** — after 6.2b, a correctly-counted walk of
      `FP-DEMO-XDOCK-0001` must raise **zero** `PARCEL_COUNT_MISMATCH` exceptions. Before 6.2b it
      raises two, both false, on the trip a reviewer is walked through.
- [ ] 🆕 Prepare the answer to *"does it catch a short load?"* — **yes at loading** (manifest vs the
      driver's blind count, `PARCEL_COUNT_MISMATCH`) and **yes at final delivery** (origin vs PP
      scan-in vs driver count, `WAYBILL_COUNT_MISMATCH`). **Say plainly that cargo dropped at an
      intermediate stop is not count-reconciled today** (F14) — that gap is real, it is scoped to the
      consignment-mapping stage, and claiming otherwise is exactly what gets probed.

### Task 6.7 — Vocabulary sweep *(parent 6.3 · 🔴 4-reviewer PR — start early)*

**`CLAUDE.md` requires a PR reviewed by all four team members.** The parent plan warns to raise this
early in Stage 6, not on the last day. **Open the conversation when 6.0 starts, not when 6.7 does.**

- [ ] `CLAUDE.md` — three sites, verified: line 103 (`orchestration/` described as "handshake
      sequencing"), line 120 (the "**Five handshakes:**" paragraph, which encodes the retired H0–H5
      model outright), line 128 ("Driver is the only hands-on user per handshake").
- [ ] `docs/glossary.md` (3 hits) · `README.md` (5 hits) · Technical Full Picture → v1.1.
- [ ] ~~`frontend/shared/lib/constants/copy.ts` dead string~~ — **already done in Stage 5.** Verified
      gone. Do not go looking for it.
- [ ] ~~`TripException.handshake_event_id` → `phase_event_id` (F7)~~ — **already done.** Verified: the
      backend constructs `TripException(..., phase_event_id=event.id)`.
- [ ] 🆕 **`frontend/driver-pwa/components/trip/HoldNotice.tsx`** — dead UI for an unreachable status
      (§Revision 1) *and* it says "handshake" three times. **Decide with Tim: delete it, or keep it
      dormant against a future manual hold.** If kept, its comment must say the state is currently
      unreachable — right now it describes "an H4 seal mismatch" that no longer holds anything.
- [ ] 🆕 Sweep the remaining `handshake` hits in `driver-pwa` (~30 files). Most are incidental —
      comments, `sw.ts` cache keys, test fixture names. **Judgement call, not a blanket rename:** a
      service-worker cache key change invalidates every installed PWA's cache, which is a demo-week
      risk for zero vocabulary gain. Rename prose and identifiers; leave runtime cache keys alone.

---

## Tests to write

| Test | Proves | File |
|---|---|---|
| `test_create_trip_without_a_schedule_is_422` | D10 — the unactivatable trip is unrepresentable | `integration/test_trips.py` |
| `test_create_trip_with_stop_slot_time_only_is_accepted` | D10's alternative source matches `_scheduled_departure` | ″ |
| `test_cancel_sets_cancelled_and_preserves_phase_rows` | Evidence survives cancellation | `integration/test_trip_admin.py` |
| `test_cancel_rejects_a_closed_trip` | 409 | ″ |
| `test_cancel_frees_the_driver_to_activate_another_trip` | The real reason cancel exists (D1) | ″ |
| `test_override_resolves_a_pending_phase_and_unblocks_the_next` | The gate advances past it | ″ |
| `test_override_rejects_a_completed_phase` | Completed evidence is not rewritable | ″ |
| `test_override_leaves_anchor_status_untouched` | D3 — the gap stays visible | ″ |
| `test_override_requires_a_note` | 422 on blank — D6 | ″ |
| `test_override_of_the_last_pending_phase_closes_the_trip` | `recompute_position` is not special-cased | ″ |
| `test_admin_routes_reject_a_foreign_org_trip` | 404, not 403 — no existence disclosure | ″ |
| `test_cancel_and_override_enqueue_a_realtime_event` | D9 — the dispatcher won't go stale | `unit/test_realtime_emit.py` |
| `test_empty_leg_trip_walks_to_closed` | F1 | `integration/test_phases.py` |
| `test_confirmation_skips_reconciliation_when_no_loading_exists` | No manufactured mismatch | `unit/test_phase_service.py` |
| `test_confirmation_skips_reconciliation_when_origin_count_is_null` | 6.2a step 4 — the overridden-loading case | ″ |
| `test_cross_dock_loading_counts_only_what_that_stop_picks_up` | F13 — the demo trip stops raising two false mismatches | ″ |
| `test_single_leg_loading_count_unchanged_by_stop_scoping` | 6.2b step 3 — the fix is a no-op on 2-stop trips | ″ |
| `test_loading_count_check_skipped_when_stop_has_no_mapped_consignments` | None-not-zero survives stop scoping | ″ |
| `test_load_phase_event_emits_for_update` | The lock is real, not ignored | ″ |
| `test_phase_complete_maps_db_error_to_500` | 6.4 step 1 | `integration/test_phases.py` |
| `test_global_handler_preserves_http_exceptions` | The handler doesn't eat 404s | `integration/test_trips.py` |

---

## Out of scope — named, with why

- **`release` and any manual dispatcher hold.** Decided 2026-08-05 (D1). Nothing sets `EXCEPTION_HOLD`,
  so nothing needs releasing. A *manual* hold + release pair is real product surface and belongs in its
  own plan, not in a hardening stage.
- **F2 / F2b(NEW-17) / F9 / 🆕 F14 — the consignment-mapping block.** Per-consignment stop assignment in
  `TripConsignmentInput`, the multi-stop wizard, per-consignment reconciliation, the
  "is this really one trip?" validation, **and capturing a driver visual count at `unloading`**.
  **All five touch the same consignment→stop mapping and should land together or not at all.** NEW-17's
  own ledger entry says the fix is per-consignment reconciliation, not a better sequence heuristic —
  doing it piecemeal means doing it twice. Its own stage.

  > 🆕 **F14 — `unloading` captures no parcel count at all**, so no count exception can be raised
  > there. Verified: `UnloadingCompleteRequest` (`schemas/phases.py:192-216`) carries only
  > `seal_number_at_destination` and `gate_photo_artifact_id`. This **contradicts parent §2.5**, which
  > specifies P5 as capturing *"seal verified before the doors open; driver visual count"*. Today the
  > only destination-side count check is at P6 `confirmation`
  > (`WAYBILL_COUNT_MISMATCH`, `:1006-1020`), which reconciles the *final leg's* origin count against
  > PP scan-in and the driver's count — so cargo dropped at an **intermediate** stop is never
  > count-reconciled by anything.
  >
  > **Why it cannot be done in Stage 6, even though the backend half is small.** (1) The baseline it
  > would compare against is "what should be dropped at *this* stop" — `Consignment.delivery_stop_id`
  > — and `trip_service.py:333` stamps that as the **last stop for every consignment** on any
  > API-created trip, so an intermediate unloading would reconcile against nothing. The mapping has to
  > become real first, and that is the wizard. (2) Adding a required field to
  > `UnloadingCompleteRequest` **422s every unloading** until the driver PWA sends it — that is Tim's
  > file, and Stage 5 has just been made green. (3) The schema's own comment at `:211-215` already
  > flags an **unresolved contract question** on this phase (the app photographs the seal *after*
  > breaking; the field is specified as the seal *as found, intact*). Land the decision, then the
  > field.
- **The ScanFeed interface and dev trigger panel** (`2026-08-04-scanfeed-dev-trigger-panel.md`).
  Planned, not executed. It is what would make F3 go away; until then 6.6 states the limitation
  honestly.
- **NEW-8 — real `in_transit` completion via checkpoint Merkle batches.** Unchanged since Stage 2 and
  deliberately so; the batching infrastructure does not exist in this codebase.
- **NEW-18 — unifying stop indexing.** A write-path behaviour change. 6.6 scripts around it.
- **The 6 shared-DB pollution failures.** They pass on a clean database. The real fix is per-run schema
  isolation in `conftest.py` (CI already gets this via a throwaway service container) — its own task.
- **F5 — the `isResolved` divergence.** Stage 4 *specified* the frontend predicate and locked it with a
  test. Changing it is a design decision needing a call, not a bug fix — and it changes rendering, which
  6.5 is trying to observe. Do it after the walk, not during.
- **F6 — the unloading manifest's blank reconciliation rows.** Cosmetic; `ReconciliationRows` already
  degrades correctly (null ≠ zero).
- **Mocking Hedera in the create-trip tests (NEW-19).** Real, but its own task — 6.0 step 4 fixes only
  the stale assertion.
- **NEW-20** — the dispatcher's `client.test.ts` POST-retry failure. Pre-existing, unrelated, and
  **"dispatcher vitest fully green" is not an achievable exit criterion for any task in this plan.**
- **New `RealtimeKind` values.** D9 — reuse the four that exist.

---

## Verification

```bash
# Backend — the full gate, all three, from backend/. ONE pytest at a time (see §Baselines).
cd backend
ruff check .                     # expect: All checks passed!
mypy .                           # expect: a real file count, NOT "Source file found twice"
.venv/bin/python -m pytest -q    # expect: ~512 passed / 6 failed / 4 skipped
```

**Read that failure count carefully.** The baseline is 496 passed / **8** failed / 4 skipped. This
stage adds ~21 tests and fixes exactly two pre-existing failures (6.0 steps 3 and 4), so the expected
exit is **~515 passed / 6 failed / 4 skipped**. The 6 remaining are the shared-DB pollution failures
(`blockchain_verify`, drivers ×3, vehicles ×2) and would pass on a clean database. **A different
count, or a different failure by name, means this stage broke something — investigate before
proceeding.**

```bash
# Dispatcher — unchanged by 6.0–6.4, so this is a regression check only
cd frontend/dispatcher
npx tsc --noEmit                 # expect: exit 0
npx eslint .                     # expect: exit 0
npx vitest run                   # expect: 87 passed / 1 failed  (NEW-20, pre-existing)

# Driver-pwa — untouched by this stage; confirm Stage 5 has not regressed
cd frontend/driver-pwa
npx tsc --noEmit                 # expect: 0 errors
npx eslint .                     # expect: exit 0
npx vitest run                   # expect: 67 files / 462 tests, all pass
```

```bash
# The dead-end is closed — the one-command proof
grep -rn "\.status = TripStatus" backend/app/ --include="*.py"
#   must now include CANCELLED (trip_service.py), alongside CLOSED and ACTIVE
grep -rn "PhaseStatus.OVERRIDDEN" backend/app/ --include="*.py"
#   must now include a WRITE in phase_service.py, not only the reads at :165/:178
grep -rn "with_for_update" backend/app/ --include="*.py"
#   must now return exactly one hit, in _load_phase_event
```

**Manual (after 6.1, before 6.5):** create a trip → walk it to a phase the driver cannot complete →
confirm the next phase 409s → `POST /phases/{id}/override` with a note → confirm the plan advances,
the dispatcher timeline shows the override banner (`PhaseOverrideSection`), `anchor_status` is
unchanged, and the dispatcher screen updated **without a reload**. **This is the walk that is
impossible today.**

---

## Done when

The branch passes `ruff`, `mypy` and `pytest` at the numbers above; a trip whose driver cannot complete
a phase can be overridden past it by a dispatcher and carried to `closed`; an abandoned trip can be
cancelled without destroying its evidence; an empty-leg trip reaches `closed` without a 404; and a
3-stop cross-dock trip has been walked end-to-end across the driver PWA and a live-updating dispatcher.

---

## Findings ledger

*(To be completed during execution. Follow the structure Stages 2–4 used: suite numbers before and
after measured by the orchestrator rather than quoted from a subagent, decision-by-decision outcomes,
defects found in this plan's own literal code, anything carried forward, and an honest assessment of
"Done when". Continue the NEW-n numbering from **NEW-21**.)*
