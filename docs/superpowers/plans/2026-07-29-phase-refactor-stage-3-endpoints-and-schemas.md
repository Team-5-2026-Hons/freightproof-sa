# Phase Refactor — Stage 3: Endpoints & Schemas (3.1 / 3.2 + NEW-9)

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. Executed by subagents that start cold and cannot ask questions — every decision
> a cold agent would otherwise have to guess at is locked below in §Decisions.

**Created:** 2026-07-29 · **Owner:** Ciaran · **Branch:** `Phase-refactor`
**Parent plan:** `docs/superpowers/plans/2026-07-25-phase-model-refactor.md` — *that document is the
source of truth. If this plan and the parent disagree, the parent wins.*
**Predecessor:** `docs/superpowers/plans/2026-07-28-phase-refactor-stage-2-phase-engine.md` — read its
**Findings ledger** before starting. NEW-8, NEW-9, NEW-10 and the "Carried into Stage 3" list are
inputs to this plan, not background reading; §Prerequisites restates the load-bearing ones inline.
**Status:** ready to execute.

**Goal:** the frozen contract (parent §3) becomes live HTTP — `GET /trips/{id}/phases`,
`GET /trips/{id}/next-phase`, `POST /trips/{id}/phases/{phase_event_id}/complete` — served off a
single `PhaseEventRead` schema, with `TripDetailResponse.phases` replacing `.handshakes`, and with
the last `MultipleResultsFound` hazard (NEW-9) closed so a real cross-dock trip reaches `CLOSED`.

**Architecture:** one folded, discriminated-union request shape (`PhaseCompleteRequest`) dispatched by
a single `complete_phase()` service entry point onto Stage 2's existing five wrappers — the schemas
fold, the engine underneath does not change shape. Reads are served by one `PhaseEventRead` built from
a `PhaseEvent` row plus a stop-sequence map plus a server-owned step recipe.

**Tech Stack:** Python 3.13, FastAPI 0.115+, SQLAlchemy 2.0 async (`Mapped`/`mapped_column`),
Pydantic v2 (discriminated unions via `Field(discriminator=...)`), pytest + pytest-asyncio
(`asyncio_mode = auto`), httpx `AsyncClient` + `ASGITransport`.

---

## Invariants — must not break

- Layering: endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db.
  `integrations/` never imports from `api/` or `orchestration/`. `db/` never imports from `app/`.
- POPIA: only SHA-256 hashes reach Hedera. No GPS, photos, names, or parcel details in any canonical
  payload. Personal data stays in Postgres. **This stage adds no new anchor and changes no canonical
  payload** — 3.4 (fatter anchors) is explicitly deferred, see §Out of scope.
- RLS: FastAPI runs as `service_role` and bypasses RLS, so RLS breakage is SILENT. *(No RLS surface in
  this stage — no tables are added or renamed — but the invariant is restated per the template.)*
- **The ledger is the truth.** `current_phase`/`current_stop` are caches — no write path may branch on
  them. `GET /next-phase` derives from the ledger; it must not read `trip.current_phase`.
- **Length is data.** Nothing may hard-code 6 phases or sequence 0..6. A response schema with a fixed
  list length, or a test asserting `len(phases) == 7` as a general rule rather than for one named
  fixture, is a defect.
- **T2 (Stage 2) still binds:** no code path outside `create_trip` may call `db.add(PhaseEvent(...))`,
  and no orchestration lookup may resolve a phase by `(trip_id, phase_type)` without a
  sequence-scoping clause. This stage *removes* the last two violations, it does not add any.
- Never run git write commands. Suggest commits; the developer runs them.
- Latest stable only: SQLAlchemy 2.0 `Mapped`/`mapped_column`, Pydantic v2, async endpoints via
  `get_db()`, no `any` in TypeScript.

---

## Why now

Stage 2 built a correct plan-driven engine and left it reachable only through a shim: five
`/h{n}/complete` routes that resolve a phase by type (`_next_pending`), a `TripDetailResponse` whose
phase list is still called `.handshakes`, and a read schema (`HandshakeEventRead`) missing three of
the frozen contract's descriptor fields (`trip_stop_id`, `stop_sequence`, `anchor_status`). Nothing
downstream can be built against that: Stage 4's dispatcher timeline has no `.phases` to render and no
`anchor_status` to render honestly, and Stage 5's driver app has no `phase_event_id`-addressed route
to POST to. This stage is the Go/No-Go gate's actual content — *backend contract + migration + one
end-to-end walk working* (parent §7, Stage 3).

---

## Prerequisites

### Must be true before the first edit

| # | Condition | How to check | Expected |
|---|---|---|---|
| P1 | Branch is `Phase-refactor`, Stage 2 landed | `git log --oneline -3` | Stage 2's commit present above `db4fce4` |
| P2 | Baseline suite reproduces Stage 2's exit numbers | `cd backend && .venv/bin/python -m pytest -q` | **339 passed, 7 failed, 0 skipped** |
| P3 | Unit suite green | `cd backend && .venv/bin/python -m pytest tests/unit -q` | **201 passed** |
| P4 | Lint/type gates clean | `cd backend && .venv/bin/python -m ruff check . && .venv/bin/python -m mypy .` | `All checks passed!` · `Success: no issues found in 159 source files` |
| P5 | App imports | `cd backend && .venv/bin/python -c "import app.main" && echo IMPORTS-OK` | `IMPORTS-OK` |
| P6 | Test Postgres up | `docker compose -f infrastructure/docker/docker-compose.test.yml ps` | `Up (healthy)`, port 5433 |

**The 7 known-red failures are exactly Stage 2's named set** — do not "fix" them in this stage and do
not let the count rise:
`test_verify_returns_no_receipt_for_unknown_subject`, `test_create_driver_returns_201_with_pending_status`,
`test_create_driver_appears_in_subsequent_list`, `test_create_driver_does_not_anchor_pii`,
`test_create_trip_response_shape`, `test_mixed_patch_anchors_only_critical_field`,
`test_update_vehicle_invalid_vin_leaves_db_state_unchanged`.

> **`test_create_trip_response_shape` is the one exception**, and only incidentally: it fails today on
> `assert body["blockchain_receipts"] == []` (unmocked Hedera, F3/DE2 — real anchoring populates a
> receipt). Task 3.5 rewrites its `handshakes` assertions to `phases` and must **not** claim to have
> fixed it — it stays red for the same unmocked-Hedera reason afterwards. Verified 2026-07-29.

### Carried from Stage 2's Findings ledger — restated because they bind this stage directly

- **NEW-9 — `advance_confirmation`'s origin-count baseline is the last live `MultipleResultsFound`
  hazard.** `phase_service.py:539-545` does
  `select(PhaseEvent).where(trip_id=, phase_type=LOADING).scalar_one()`. On any trip with 2+ `LOADING`
  rows — every real cross-dock pickup pattern — this raises. Stage 2 deferred it because "which
  pickup's count is *the* origin baseline" is a product question. **Ciaran decided it 2026-07-29 —
  see S1.** It is task 3.0, first, because Stage 3's own end-to-end verification cannot pass without it.
- **NEW-8 — `_auto_complete_in_transit` is a Stage 2 stopgap, not a design.** `in_transit` rows are
  auto-completed by `advance_departure` because real checkpoint-Merkle-batch completion (parent D2)
  does not exist in this codebase. **Unchanged in this stage**, deliberately. Do not expose
  `in_transit` as a driver-completable phase in the folded request union (S5) and do not build the
  driver a route to it — that would harden a stopgap into contract.
- **Stage 2's endpoint shim (`_next_pending` in `api/v1/endpoints/handshakes.py:40-57`) is deleted
  wholesale in this stage**, as planned — not ported, not generalised.
- **`get_handshake_detail` (`phase_service.py:225-252`) and its `GET /{handshake_type}` route retire
  whole in this stage** — its `(trip_id, phase_type)` lookup ambiguity is fixed by deletion, not by
  repair. It is the only remaining orchestration lookup that violates T2, and deleting it is what
  makes the T2 fence literally true rather than true-with-an-exception.
- **`frontend/shared/lib/types/phase.ts` and `constants/phase-meta.ts` already exist and are already
  correct** (Stage 0.4's frozen contract). Verified 2026-07-29: `phase.ts` documents the seal at
  departure, `phase-meta.ts` keys step recipes by phase *type* with no fixed-length constant. Stage 2's
  ledger entry claiming shared types "still reflect the old seal-field split" is **accurate only for
  the legacy `handshake.ts`**, which is deliberately retained until Stages 4/5 remove its last
  consumer. **Do not edit `handshake.ts` in this stage.**

### Read while writing this plan — current, verified shape of every file this stage touches

Confirmed by reading the actual files on `Phase-refactor` at `db4fce4` + Stage 2's staged diff:

- `app/schemas/handshakes.py` (~175 lines) — `HandshakeEventBase/Create/Update/Read`,
  `TrailerGpsSnapshot*`, `_SEAL_PATTERN`/`_validate_seal_format`, and `H1..H5CompleteRequest`
  (lines 110-168). **`HandshakeEventRead` is missing `trip_stop_id`, `anchor_status`, and
  `idempotency_key`** — all three are real columns on the model (`db/models/phases.py:61,70,76`) and
  the first two are in the frozen contract's `PhaseDescriptor`. It has no `stop_sequence` either
  (that one is a join, not a column).
- `app/schemas/trips.py:401` — `handshakes: list[HandshakeEventRead]` on `TripDetailResponse`
  (class at line 377). Imported at `trips.py:12`.
- `app/orchestration/resource_service.py` — `get_trip_detail` (lines 130-241) already orders
  `PhaseEvent` by `sequence_number` (161-167) and already unions `PHASE_EVENT`-subject receipts
  (174-197). It already fetches `stops` (199-203). **Only the `handshakes=` kwarg at line 235 and the
  local variable name need to change** — the queries are already correct.
- `app/orchestration/trip_service.py:408` — `handshakes=[HandshakeEventRead.model_validate(h0)]`.
  **Defect found while writing this plan:** `POST /trips` returns only H0 while `GET /trips/{id}`
  returns the whole plan, so the same trip has a 1-row phase list at creation and a 7-row one one
  request later. `phase_events` (the full list) is already in scope at that point (line ~317). Task 3.4.
- `app/api/v1/endpoints/handshakes.py` (176 lines) — five `/h{n}/complete` routes, the `_next_pending`
  shim, and `GET /{handshake_type}`. **Defect found while writing this plan:** the h2 route still
  carries 504/502 `HederaTimeoutError`/`HederaServiceError` handlers (lines 94-97). Task 2.5's fence
  required deleting them; h5's were deleted, h2's were not. They are unreachable —
  `advance_loading` (`phase_service.py:303-321`) does not anchor at all, and `_anchor_or_fail_open`
  (175-213) never re-raises. Dead code that misdescribes the route. Deleted with the file in task 3.2.
- `app/orchestration/phase_service.py` (589 lines) — five wrappers, `_gate_and_load`,
  `_finish_phase`, `_recompute_position`, `_find_departure_for_leg`, `_auto_complete_in_transit`,
  the two canonical-payload builders. **This stage changes exactly three things in it:** NEW-9's
  lookup (3.0), a new `complete_phase()` dispatcher (3.3), and deleting `get_handshake_detail` (3.2).
- `app/orchestration/phase_plan.py` (96 lines) — `build_phase_plan`. Not modified. Its emission rule
  is what makes S1's "nearest preceding loading" well-defined; the exact 7-row and 11-row plans it
  emits are spelled out in S1 so no agent has to re-derive them.
- `app/main.py:14,47` — registers `handshakes_router`. **Shared file (CLAUDE.md) — flag in TASK COMPLETE.**
- `app/schemas/__init__.py:21-24` — re-exports the handshake schemas. **Shared-ish; flag it.**
- `app/core/exceptions.py` — `ResourceNotFoundError(resource, resource_id)`,
  `PhaseSequenceError(trip_status, attempted_handshake)`. One new exception in this stage (S6).
- `frontend/shared/lib/constants/phase-meta.ts` — `STEP_SLUGS: Record<PhaseType, readonly string[]>`
  (lines ~30-38). The literal current values are reproduced in task 3.1's code block; if they have
  changed since 2026-07-29, **the TS file wins and task 3.1's Python must be updated to match**, since
  the drift-guard test (3.1) compares them.

### Environment

Python is `backend/.venv/bin/python`. Never read/print/log `backend/.env`. The test DB
(`TEST_DATABASE_URL`, port 5433) is `create_all`-built with no Supabase `auth` schema and no RLS —
this stage's tests are service-layer and HTTP-layer and exercise neither.

---

## Decisions taken while writing this plan

These close forks a cold agent would otherwise guess at. They sit **below** parent §1's D1–D9,
Stage 1's S1–S6 and Stage 2's T1–T8; none reopens a locked decision.

### S1 — NEW-9's origin count is the **nearest preceding `LOADING`**, leg-scoped — *decided by Ciaran, 2026-07-29*

Three readings were put to Ciaran (sum-of-all-loadings, nearest-preceding, first-only). **Chosen:
nearest preceding.** `origin_count` is the `driver_visual_count` of the `LOADING` row with the
greatest `sequence_number` strictly less than the confirmation's own — i.e. the pickup that loaded
the leg this confirmation is closing.

**Why it is well-defined**, so nobody has to re-derive `build_phase_plan`'s output under pressure.
The generator (`phase_plan.py:73-94`) emits, per stop in sequence: `activation` (first stop) or
`unloading` (if anything delivers here); then `loading` (if anything collects here); then
`departure` + `in_transit` unless final, where `confirmation` is emitted instead. So:

```
Single-leg (stop0 picks up, stop1 drops off) — 7 rows:
  0 trip_creation(-)  1 activation(0)  2 loading(0)  3 departure(0)
  4 in_transit(0)     5 unloading(1)   6 confirmation(1)
  -> confirmation at seq 6; nearest preceding LOADING = seq 2. Identical to today's
     trip-wide .scalar_one() result. Single-leg behaviour is unchanged, by construction.

Three-stop cross-dock (stop0 picks up; stop1 drops off AND picks up; stop2 drops off) — 11 rows:
  0 trip_creation(-)  1 activation(0)  2 loading(0)   3 departure(0)  4 in_transit(0)
  5 unloading(1)      6 loading(1)     7 departure(1) 8 in_transit(1)
  9 unloading(2)     10 confirmation(2)
  -> confirmation at seq 10; nearest preceding LOADING = seq 6 (stop 1's pickup).
```

**What this means in cargo terms, stated plainly because it is a real semantic choice and a reviewer
will ask:** on a cross-dock, confirmation reconciles the count that was loaded on the *final leg*
against what arrived at the *final stop*. Cargo picked up at stop 0 and dropped at stop 1 is not part
of that comparison — it left the vehicle before the final leg began, so including it would guarantee a
false mismatch. **Known limitation, recorded not fixed here:** the intermediate drop-off at stop 1
(`unloading`, seq 5) performs seal continuity but *no* count reconciliation, so cargo delivered
mid-route is never count-checked. That is F1/Stage 3.3 territory (server-side reconciliation), out of
this stage's fence — see §Out of scope, where it is recorded so it can be picked up later.

### S2 — `step_recipe` is served by the backend, and a drift-guard test makes the duplication safe — *vetoable*

Ciaran's stated preference is server-side computation ("it puts all computation serverside which has
always been our goal") with a stated worry about duplicating the slug list in two languages. Both are
right. The resolution is not to pick one horn: the backend owns `STEP_SLUGS` in
`app/core/phase_meta.py` and serves `step_recipe` on every `PhaseEventRead`, **and** a unit test parses
`frontend/shared/lib/constants/phase-meta.ts` and fails if the two lists disagree. Duplication is only
dangerous when it is silent; a failing test makes it loud. If Ciaran vetoes, the fallback is to drop
`step_recipe` from `PhaseEventRead` and have clients map `phase_type → STEP_SLUGS` client-side — in
which case task 3.1 is deleted whole and the frozen contract §3.1 gets a recorded amendment.

### S3 — `GET /phases` and `GET /next-phase` are **driver-scoped**; the dispatcher reads phases through `GET /trips/{id}`

The dispatcher already receives the full, plan-ordered phase list inside `TripDetailResponse.phases`
(task 3.4) on the endpoint it already calls. Giving the two new read routes a dual driver-or-dispatcher
dependency would mean inventing an auth dependency that does not exist today (`get_current_driver` and
`get_current_dispatcher` are separate, `auth/dependencies.py:190,254`) and writing a second org-scoping
path for trip access — new security surface for no consumer. **So:** the phases router uses
`get_current_driver` and scopes every query by `Trip.driver_id == current_driver.id`, exactly as the
handshakes router does today. Stage 4 (dispatcher) consumes `.phases`; Stage 5 (driver) consumes
`/phases` and `/next-phase`.

### S4 — the read schema is `PhaseEventRead` in a new `app/schemas/phases.py`; `app/schemas/handshakes.py` is deleted

Not renamed in place — created new and the old deleted in the same commit, so `git` records it as the
vocabulary change it is and no import can resolve to a stale module. `PhaseEventRead` gains the three
missing model columns (`trip_stop_id`, `anchor_status`, `idempotency_key`) plus two derived fields
(`stop_sequence`, `step_recipe`). `TrailerGpsSnapshot*`, `_SEAL_PATTERN` and `_validate_seal_format`
move across unchanged. `HandshakeEventBase/Create/Update` are **deleted, not ported** — verified
2026-07-29 that `HandshakeEventCreate`/`Update` have zero non-test consumers in `app/`.

### S5 — the folded request is a **discriminated union**, not one flat model with optional fields

Parent §3.2 says "per-phase complete requests folded into one shape". The obvious flat reading — one
model with every field optional plus a cross-field validator — cannot work: the validator would need
`phase_type` to know which fields are required, and `phase_type` is not in the body (it is a property
of the row addressed by `phase_event_id`). Validation would have to move into the service layer,
turning today's honest Pydantic 422s into hand-rolled errors.

**So:** the body carries a `phase_type` literal discriminator, Pydantic v2 picks the member and
validates it properly, and the service cross-checks the body's `phase_type` against the loaded row's,
raising `PhaseTypeMismatchError` → 409 when a client addresses a row of one type with another type's
payload. One endpoint, one schema symbol (`PhaseCompleteRequest`), five real shapes, real 422s.
**`trip_creation` and `in_transit` are deliberately not members** — neither is driver-completable
(`trip_creation` is written by `create_trip`, `in_transit` by NEW-8's stopgap), and a client that
addresses one gets a 409 from the dispatch table, not a 500 from a `KeyError`.

### S6 — `complete_phase()` is the single service entry point; the five wrappers stay and become internal

This is what finally makes parent §2.4's headline ("`advance_phase()` replaces five functions") literally
true at the API boundary, without undoing Stage 2's T1 reasoning (five typed wrappers, because the
evidence each phase writes is genuinely different). `complete_phase()` owns the phase-type dispatch and
the body/row cross-check; the wrappers own their evidence. The endpoint calls exactly one function.

New exception in `core/exceptions.py`:

```python
class PhaseTypeMismatchError(Exception):
    """Raised when a completion payload's phase_type does not match the addressed row's.

    A client bug, not a sequencing problem: the driver app resolved a phase_event_id
    and then sent the wrong shape for it (or addressed a phase — trip_creation,
    in_transit — that no driver action completes). Distinct from PhaseSequenceError
    so the 409 body says which of the two actually happened.
    """

    def __init__(self, expected: str, received: str) -> None:
        super().__init__(
            f"Payload phase_type='{received}' does not match the addressed phase, "
            f"which is '{expected}'."
        )
        self.expected = expected
        self.received = received
```

### S7 — `GET /next-phase` re-derives from the ledger; it does not read `trip.current_phase`

`trip.current_phase`/`current_stop` are caches (parent §2.3, D6) and the stage invariant forbids
branching on them. `next_phase()` runs the same lowest-unresolved-sequence query
`_recompute_position` runs (`phase_service.py:154-173`), read-only. This is deliberate duplication of a
*query*, not of a *decision*: if the cache ever diverges from the ledger, the endpoint tells the truth
and the divergence becomes visible instead of being laundered. Returns `null` for a closed trip.

### S8 — the five `/h{n}/complete` routes are retired outright, with no deprecation window

No external consumer exists: verified 2026-07-29 that `frontend/driver-pwa` and `frontend/dispatcher`
contain **zero** calls to any `/complete` endpoint (both surfaces are still mock-driven; Stage 5 is
what wires the driver app). A deprecation shim would be dead code guarding against a caller that does
not exist. Their integration tests are rewritten against the new route in task 3.5, not deleted.

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `backend/app/core/phase_meta.py` | **create** | `STEP_SLUGS: dict[PhaseType, tuple[str, ...]]` — server-owned step recipes (S2) |
| `backend/app/schemas/phases.py` | **create** | `PhaseEventRead`, the five `*CompleteRequest` shapes, `PhaseCompleteRequest` union, `TrailerGpsSnapshot*`, seal validator (S4/S5) |
| `backend/app/schemas/handshakes.py` | **delete** | superseded by `phases.py` |
| `backend/app/api/v1/endpoints/phases.py` | **create** | `GET /phases`, `GET /next-phase`, `POST /phases/{id}/complete` (S3) |
| `backend/app/api/v1/endpoints/handshakes.py` | **delete** | five `/h{n}` routes + `_next_pending` shim + `GET /{handshake_type}` (S8) |
| `backend/app/orchestration/phase_service.py` | modify | NEW-9 fix (3.0); `complete_phase()` + `next_phase()` (3.3); delete `get_handshake_detail` (3.2) |
| `backend/app/orchestration/resource_service.py` | modify | `handshakes=` → `phases=`, build reads with stop-sequence map (3.4) |
| `backend/app/orchestration/trip_service.py` | modify | return the **whole** plan from `create_trip`, not just H0 (3.4) |
| `backend/app/schemas/trips.py` | modify | `TripDetailResponse.handshakes` → `.phases` (3.4) |
| `backend/app/schemas/__init__.py` | modify | re-export from `phases` not `handshakes` |
| `backend/app/main.py` | modify | **shared file** — swap `handshakes_router` for `phases_router` |
| `backend/app/core/exceptions.py` | modify | add `PhaseTypeMismatchError` (S6) |
| `backend/tests/unit/test_phase_meta_contract.py` | **create** | the TS/Python drift guard (S2) |
| `backend/tests/unit/test_phase_service.py` | modify | NEW-9 tests, `complete_phase`/`next_phase` tests |
| `backend/tests/integration/test_phases.py` | **create** | rewrite of `test_handshakes.py` against the new routes |
| `backend/tests/integration/test_handshakes.py` | **delete** | superseded |
| `backend/tests/integration/test_handshakes_anchor.py` | modify | retarget to the new route (keep the filename — it tests anchoring, not routing) |
| `backend/tests/integration/test_trips.py`, `test_create_trip_multistop.py`, `test_detail_receipts_gating.py` | modify | `handshakes` → `phases` in assertions |

**No Alembic migration.** No column is added, dropped, or renamed. `PhaseEventRead`'s new fields are
columns that already exist (Stage 1) or are derived at read time.

---

## Tasks

Six tasks. Each states **Files**, numbered checkbox steps, and a **Fence**. Commit after each.

---

### Task 3.0 — Close NEW-9: leg-scoped origin count

**Files:**
- Modify: `backend/app/orchestration/phase_service.py` (add helper near `_find_departure_for_leg` at
  line ~358; change `advance_confirmation`'s lookup at lines ~537-545)
- Test: `backend/tests/unit/test_phase_service.py`

**Fence:** this task changes *which row* the origin count comes from. It does not change what is done
with it (the three-way `origin == pp_scan_in == driver_visual` comparison, the
`WAYBILL_COUNT_MISMATCH` exception shape, or the `EXCEPTION` vs `COMPLETED` branch). Single-leg
behaviour must be byte-identical — S1 proves it is, and the existing single-leg tests are the check.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_phase_service.py`. Reuse the cross-dock fixture the file already
has for `test_cross_dock_seal_continuity_correct_seal_per_leg_no_mismatch` — read that test first and
follow its construction exactly rather than inventing a second fixture shape.

```python
async def test_confirmation_origin_count_uses_nearest_preceding_loading_not_trip_wide(
    db_session, cross_dock_trip,
):
    """NEW-9 (Stage 2 ledger), decision S1: on a trip with two LOADING rows a
    trip-wide (trip_id, phase_type=LOADING) .scalar_one() raises
    MultipleResultsFound. The origin baseline is the pickup that loaded the
    FINAL leg — seq 6 in the 11-row plan — not seq 2 and not a crash."""
    trip, events = cross_dock_trip
    by_seq = {e.sequence_number: e for e in events}

    # Stop 0 loads 12; stop 1 loads 7. The final leg carries 7.
    by_seq[2].driver_visual_count = 12
    by_seq[6].driver_visual_count = 7
    await db_session.flush()

    result = await advance_confirmation(
        db_session,
        trip_id=trip.id,
        driver_id=trip.driver_id,
        phase_event_id=by_seq[10].id,
        payload=H5CompleteRequest(
            pod_photo_artifact_id=uuid.uuid4(),
            pod_signature_artifact_id=uuid.uuid4(),
            driver_visual_count=7,
            pp_scan_in_count=7,
            idempotency_key="oq-confirm-crossdock-1",
        ),
    )

    assert result.status == TripStatus.CLOSED
    assert by_seq[10].status == PhaseStatus.COMPLETED
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```
cd backend && .venv/bin/python -m pytest \
  tests/unit/test_phase_service.py::test_confirmation_origin_count_uses_nearest_preceding_loading_not_trip_wide -v
```

Expected: FAIL with `sqlalchemy.exc.MultipleResultsFound`. **If it fails with anything else — an
`AttributeError`, a fixture error, an assertion on a different value — stop and fix the test.** A test
that fails for the wrong reason proves nothing about the fix.

- [ ] **Step 3: Add the helper**

In `backend/app/orchestration/phase_service.py`, immediately after `_find_departure_for_leg`:

```python
async def _find_loading_for_leg(
    db: AsyncSession, *, trip_id: uuid.UUID, before_sequence: int,
) -> PhaseEvent:
    """The LOADING row that loaded the leg ending at `before_sequence` — decision S1.

    Same shape and same reason as _find_departure_for_leg: a cross-dock trip has
    several LOADING rows, so a trip-wide phase_type lookup raises
    MultipleResultsFound (NEW-9 in Stage 2's Findings ledger).

    Semantics, not just mechanics: confirmation reconciles what was loaded onto
    the FINAL leg against what arrived at the final stop. Cargo picked up earlier
    and dropped at an intermediate stop left the vehicle before this leg began —
    counting it would guarantee a false mismatch. Cargo dropped mid-route is not
    count-reconciled at all today; that is F1 / Stage 3.3, deliberately deferred.

    Caller contract: `before_sequence` must be the sequence_number of the
    confirmation's OWN row. Passing anything else silently resolves the wrong leg.
    """
    result = await db.execute(
        select(PhaseEvent)
        .where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.phase_type == PhaseType.LOADING,
            PhaseEvent.sequence_number < before_sequence,
        )
        .order_by(PhaseEvent.sequence_number.desc())
        .limit(1)
    )
    loading = result.scalar_one_or_none()
    if loading is None:
        raise ResourceNotFoundError("PhaseEvent", "loading")
    return loading
```

- [ ] **Step 4: Use it in `advance_confirmation`**

Replace the block currently at `phase_service.py` lines ~537-545 (the comment beginning
`# Origin-count baseline is unaffected by T5` through `origin_count = h2_event.driver_visual_count`)
with:

```python
    # S1 / NEW-9: this leg's loading, not the trip's. A trip-wide phase_type
    # lookup raised MultipleResultsFound on every real cross-dock trip.
    loading_event = await _find_loading_for_leg(
        db, trip_id=trip_id, before_sequence=event.sequence_number,
    )
    origin_count = loading_event.driver_visual_count
```

- [ ] **Step 5: Verify — the new test passes AND single-leg behaviour is unchanged**

```
cd backend && .venv/bin/python -m pytest tests/unit/test_phase_service.py -q
```

Expected: all pass, including every pre-existing single-leg confirmation test
(`test_advance_confirmation_matching_counts_closes_trip` and its mismatch siblings) — **unchanged, not
updated.** If any pre-existing single-leg test needed editing to pass, the change was not
behaviour-preserving; stop and re-read S1.

- [ ] **Step 6: Prove the "Done when" that Stage 2 could not**

Add, in the same file, a full 11-row walk. This is the line Stage 2's ledger recorded as *not met*:

```python
async def test_cross_dock_plan_walks_to_closed(db_session, cross_dock_trip):
    """Stage 2's unmet 'Done when': an 11-row plan walks its final phase and
    closes the trip. Blocked until now only by NEW-9."""
    trip, events = cross_dock_trip
    by_seq = {e.sequence_number: e for e in events}

    # Walk every driver-completable row in plan order. in_transit (seq 4, 8) is
    # auto-completed by advance_departure (NEW-8's stopgap), so it is absent here
    # by design, not by omission.
    ...  # follow the existing cross-dock walk helper in this file; assert
         # trip.status == TripStatus.CLOSED and trip.current_phase is None at the end.
```

> **Executing agent:** the `...` above is the one place this plan cannot give you literal code, because
> the walk must reuse whichever helper `test_cross_dock_seal_continuity_correct_seal_per_leg_no_mismatch`
> already uses in the file as it stands. Read that test, extend its walk past `unloading` to
> `confirmation`, and assert the two closure conditions named. Do not build a third fixture.

- [ ] **Step 7: Commit**

```bash
git add backend/app/orchestration/phase_service.py backend/tests/unit/test_phase_service.py
# then, per CLAUDE.md, report the suggested message and let the developer commit:
#   fix(orchestration): scope confirmation's origin count to its own leg
```

---

### Task 3.1 — Server-owned step recipes + TS drift guard

**Files:**
- Create: `backend/app/core/phase_meta.py`
- Create: `backend/tests/unit/test_phase_meta_contract.py`

**Fence:** this file is a constant table and nothing else — no DB access, no imports from
`orchestration/`, no logic. It is imported by `schemas/phases.py` (task 3.2) only.

- [ ] **Step 1: Create the constant table**

Values copied from `frontend/shared/lib/constants/phase-meta.ts` `STEP_SLUGS` as of 2026-07-29. **If
the TS file has changed, the TS file wins — copy its current values instead, and the drift-guard test
below will confirm you did.**

```python
"""Static per-phase-type driver step recipes — the `step_recipe` half of the
frozen contract's PhaseDescriptor (parent plan §3.1).

Decision S2 (Stage 3): the backend owns this list and serves it, so the client
computes nothing. That duplicates frontend/shared/lib/constants/phase-meta.ts,
which is only safe because tests/unit/test_phase_meta_contract.py parses that
file and fails if the two disagree. If you edit one, edit both — the test will
tell you if you forget.

Keyed by phase TYPE, never by index: how many times a type occurs in a trip is
data (a cross-dock plan has `loading` twice), so a Record<0..5, ...> here would
reintroduce exactly the fixed-length assumption this refactor removes.
"""

from app.db.models.enums import PhaseType

# An empty recipe means no driver interaction:
#   trip_creation — dispatcher-side, before the driver is involved at all.
#   in_transit    — closed by departure today (NEW-8 stopgap) and by checkpoint
#                   Merkle batches once those exist (parent D2); either way the
#                   driver never drives it through a capture flow.
#   loading       — system-observed via the Parcel Perfect poll. The driver must
#                   never see the expected count (F1): if the number is on screen,
#                   a "match" proves nothing.
STEP_SLUGS: dict[PhaseType, tuple[str, ...]] = {
    PhaseType.TRIP_CREATION: (),
    PhaseType.ACTIVATION: ("1-approach-gate", "2-verification"),
    PhaseType.LOADING: (),
    PhaseType.DEPARTURE: ("1-approach-exit", "2-capture-seal", "3-waybill", "4-departure"),
    PhaseType.IN_TRANSIT: ("1-arrival",),
    PhaseType.UNLOADING: (
        "1-hand-waybill", "2-seal-verify", "3-seal-break-inspection", "4-visual-count",
    ),
    PhaseType.CONFIRMATION: ("1-pod-photo", "2-pod-signature", "3-reconciliation", "4-closed"),
}
```

- [ ] **Step 2: Write the drift guard**

Create `backend/tests/unit/test_phase_meta_contract.py`:

```python
"""Decision S2: the backend owns STEP_SLUGS and the frontend mirrors it. This
test is the only thing making that duplication safe — it parses the TS file
rather than trusting a comment. If it fails, the two lists disagree and one of
them is lying to a consumer."""

import re
from pathlib import Path

from app.core.phase_meta import STEP_SLUGS
from app.db.models.enums import PhaseType

_TS_PATH = (
    Path(__file__).resolve().parents[3]
    / "frontend" / "shared" / "lib" / "constants" / "phase-meta.ts"
)
_BLOCK = re.compile(
    r"export const STEP_SLUGS:[^=]*=\s*\{(?P<body>.*?)\n\}", re.DOTALL,
)
_ENTRY = re.compile(r"^\s*(?P<key>\w+):\s*\[(?P<items>[^\]]*)\],\s*$", re.MULTILINE)


def _parse_ts_step_slugs() -> dict[str, tuple[str, ...]]:
    source = _TS_PATH.read_text(encoding="utf-8")
    block = _BLOCK.search(source)
    assert block is not None, f"STEP_SLUGS block not found in {_TS_PATH}"
    parsed: dict[str, tuple[str, ...]] = {}
    for entry in _ENTRY.finditer(block.group("body")):
        items = [i.strip().strip("'\"") for i in entry.group("items").split(",")]
        parsed[entry.group("key")] = tuple(i for i in items if i)
    return parsed


def test_backend_step_slugs_match_shared_typescript_constant():
    ts = _parse_ts_step_slugs()
    py = {phase_type.value: slugs for phase_type, slugs in STEP_SLUGS.items()}

    assert ts == py, (
        "STEP_SLUGS disagree between backend/app/core/phase_meta.py and "
        "frontend/shared/lib/constants/phase-meta.ts. Decision S2 requires them "
        "identical; update whichever one is stale."
    )


def test_every_phase_type_has_a_recipe_entry():
    """A new PhaseType with no entry would KeyError at serialization time, in
    production, on one trip shape only."""
    assert set(STEP_SLUGS) == set(PhaseType)
```

- [ ] **Step 3: Run it**

```
cd backend && .venv/bin/python -m pytest tests/unit/test_phase_meta_contract.py -v
```

Expected: 2 passed. **If `test_backend_step_slugs_match_shared_typescript_constant` fails, do not edit
the test's regex to make it pass** — read the diff it prints, decide which file is stale (the TS file
is the older, frozen-contract one; it usually wins), and fix that file.

- [ ] **Step 4: Commit** — suggested: `feat(orchestration): server-owned phase step recipes with TS drift guard`

---

### Task 3.2 — `app/schemas/phases.py`: the read schema and the folded request union

**Files:**
- Create: `backend/app/schemas/phases.py`
- Delete: `backend/app/schemas/handshakes.py`
- Modify: `backend/app/schemas/__init__.py:21-24`
- Modify: `backend/app/core/exceptions.py` (add `PhaseTypeMismatchError`, S6)
- Modify: `backend/app/orchestration/phase_service.py` (imports; delete `get_handshake_detail`)

**Fence:** field *names* and *types* on the five request shapes do not change — this task moves and
renames the classes and adds the `phase_type` discriminator. The seal-format validator keeps its exact
current pattern (`^[A-Z]{2}-\d{4}$`) and stays on `seal_number` / `seal_number_at_destination` only —
`seal_number_confirmed` remains free-form for the reason its current comment gives.

- [ ] **Step 1: Add the new exception**

Append to `backend/app/core/exceptions.py` the `PhaseTypeMismatchError` class exactly as given in S6.

- [ ] **Step 2: Create `backend/app/schemas/phases.py`**

```python
"""Pydantic v2 schemas for PhaseEvent and TrailerGpsSnapshot.

Replaces schemas/handshakes.py, whose HandshakeEventRead predates the phase
ledger and is missing three real columns (trip_stop_id, anchor_status,
idempotency_key). Serves the frozen contract's PhaseDescriptor — parent plan
§3.1 — which is why stop_sequence and step_recipe appear here as derived fields
rather than as columns.
"""

import re
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.phase_meta import STEP_SLUGS
from app.db.models.enums import AnchorStatus, PhaseStatus, PhaseType

_SEAL_PATTERN = re.compile(r"^[A-Z]{2}-\d{4}$")


def _validate_seal_format(v: str) -> str:
    if not _SEAL_PATTERN.match(v):
        raise ValueError("seal number must be in format XX-#### (e.g. AB-1234)")
    return v


class PhaseEventRead(BaseModel):
    """One entry in a trip's committed phase plan, as served to the UI.

    NOT built with model_validate() — stop_sequence needs a TripStop join and
    step_recipe is derived, so use from_event() and pass the map. Building this
    from the ORM object alone would silently produce stop_sequence=None on every
    row, which the dispatcher renders as "no stop" rather than as an error.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_id: UUID
    phase_type: PhaseType
    sequence_number: int
    status: PhaseStatus
    anchor_status: AnchorStatus

    # Null ONLY for trip_creation (parent D3). in_transit anchors to the stop it
    # DEPARTS FROM, so in_transit at stop 1 means "the leg leaving stop 1".
    trip_stop_id: Optional[UUID] = None
    stop_sequence: Optional[int] = None

    # Capture-component slugs for this phase type (decision S2). Empty for
    # system-observed phases.
    step_recipe: tuple[str, ...] = ()

    # The driver app's offline-queue entry id, echoed so a client can reconcile
    # its own queue against what the server actually recorded.
    idempotency_key: Optional[str] = None

    dispatcher_override_user_id: Optional[UUID] = None
    dispatcher_override_note: Optional[str] = None
    driver_phone_lat: Optional[Decimal] = None
    driver_phone_lng: Optional[Decimal] = None
    horse_gps_lat: Optional[Decimal] = None
    horse_gps_lng: Optional[Decimal] = None
    pulsit_geofence_confirmed: Optional[bool] = None
    seal_number: Optional[str] = None
    seal_photo_artifact_id: Optional[UUID] = None
    waybill_photo_artifact_id: Optional[UUID] = None
    gate_photo_artifact_id: Optional[UUID] = None
    pod_photo_artifact_id: Optional[UUID] = None
    pod_signature_artifact_id: Optional[UUID] = None
    parcel_manifest_snapshot: Optional[Any] = None
    parcel_count_origin: Optional[int] = None
    parcel_count_destination: Optional[int] = None
    driver_visual_count: Optional[int] = None
    event_hash: Optional[str] = None
    blockchain_receipt_id: Optional[UUID] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_event(
        cls, event: Any, *, stop_sequence_by_id: dict[UUID, int],
    ) -> "PhaseEventRead":
        """`event` is a db.models.phases.PhaseEvent. Typed as Any to keep this
        module free of a db-model import — schemas describe the wire, not the
        tables, and app/schemas/ importing app/db/models/ would invert that."""
        read = cls.model_validate(event)
        read.stop_sequence = (
            stop_sequence_by_id.get(event.trip_stop_id)
            if event.trip_stop_id is not None
            else None
        )
        read.step_recipe = STEP_SLUGS[PhaseType(event.phase_type)]
        return read


class TrailerGpsSnapshotBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    phase_event_id: UUID
    trailer_id: UUID
    pulsit_device_id: str
    lat: Decimal
    lng: Decimal
    captured_at: datetime


class TrailerGpsSnapshotCreate(TrailerGpsSnapshotBase):
    pass


class TrailerGpsSnapshotRead(TrailerGpsSnapshotBase):
    id: UUID
    created_at: datetime


class _PhaseCompleteBase(BaseModel):
    # The driver app's offline-queue entry id. Stored on the row unconditionally;
    # a resubmitted completion with the same key returns current state instead of
    # erroring or duplicating — drivers lose signal, replay is normal.
    idempotency_key: str = Field(..., min_length=1)


class ActivationCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.ACTIVATION]
    driver_phone_lat: Decimal
    driver_phone_lng: Decimal


class LoadingCompleteRequest(_PhaseCompleteBase):
    # D7/T5: the seal is applied at departure, not here. Loading only ever
    # captures the driver's own visual parcel count.
    phase_type: Literal[PhaseType.LOADING]
    driver_visual_count: int


class DepartureCompleteRequest(_PhaseCompleteBase):
    # D7/T5: the seal is applied HERE — the driver photographs the waybill and
    # seal as they physically close the trailer at exit.
    phase_type: Literal[PhaseType.DEPARTURE]
    waybill_photo_artifact_id: UUID
    seal_number: str
    seal_photo_artifact_id: UUID
    guard_verified_seal: bool
    # Seal number the exit guard re-entered. When present the server compares it
    # against THIS SAME request's seal_number, superseding the client-computed
    # guard_verified_seal. Free-form on purpose: a mistyped confirmation is
    # itself evidence of a mismatch and must be recordable, not 422'd away.
    seal_number_confirmed: Optional[str] = None

    @field_validator("seal_number")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class UnloadingCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.UNLOADING]
    seal_number_at_destination: str

    @field_validator("seal_number_at_destination")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class ConfirmationCompleteRequest(_PhaseCompleteBase):
    # BQ2 resolved 2026-06-29: proof of delivery is a photo AND an on-device
    # signature — both required, not either/or.
    phase_type: Literal[PhaseType.CONFIRMATION]
    pod_photo_artifact_id: UUID
    pod_signature_artifact_id: UUID
    driver_visual_count: int
    pp_scan_in_count: int


# Decision S5. One endpoint, five real shapes: Pydantic picks the member from
# `phase_type` and validates it properly, so a missing seal_number is still a
# 422 and not a hand-rolled service-layer error. trip_creation and in_transit are
# deliberately absent — neither is completed by a driver action, and addressing
# one gets a 409 from complete_phase()'s dispatch table.
PhaseCompleteRequest = Annotated[
    Union[
        ActivationCompleteRequest,
        LoadingCompleteRequest,
        DepartureCompleteRequest,
        UnloadingCompleteRequest,
        ConfirmationCompleteRequest,
    ],
    Field(discriminator="phase_type"),
]
```

- [ ] **Step 3: Re-point `app/schemas/__init__.py`**

Replace the `from app.schemas.handshakes import (...)` block (lines 21-24) with:

```python
from app.schemas.phases import (  # noqa: F401
    PhaseEventRead,
    ActivationCompleteRequest, LoadingCompleteRequest, DepartureCompleteRequest,
    UnloadingCompleteRequest, ConfirmationCompleteRequest, PhaseCompleteRequest,
    TrailerGpsSnapshotBase, TrailerGpsSnapshotCreate, TrailerGpsSnapshotRead,
)
```

`HandshakeEventBase/Create/Update/Read` are dropped — verified 2026-07-29 that `Create`/`Update` have
zero consumers in `app/`, and `Read` is replaced by `PhaseEventRead` in task 3.4.

- [ ] **Step 4: Delete the old module and its last orchestration consumer**

```bash
rm backend/app/schemas/handshakes.py
```

In `backend/app/orchestration/phase_service.py`: update the `app.schemas.handshakes` import to
`app.schemas.phases` and rename the five payload types (`H1CompleteRequest` →
`ActivationCompleteRequest`, `H2` → `Loading`, `H3` → `Departure`, `H4` → `Unloading`, `H5` →
`Confirmation`) in the five wrapper signatures. **Also delete `get_handshake_detail`**
(lines ~225-252) — its route goes with it in task 3.3, and its `(trip_id, phase_type)` lookup is the
last T2 violation in the file.

- [ ] **Step 5: Verify nothing still imports the deleted module**

```
cd backend && grep -rn "schemas.handshakes\|HandshakeEventRead\|H1CompleteRequest\|H5CompleteRequest" app/ tests/
```

Expected: matches only in `tests/` files not yet updated (tasks 3.4/3.5 handle those) — **zero matches
under `app/`.** Then:

```
cd backend && .venv/bin/python -c "import app.main"
```

Expected: this will still fail until task 3.3 rewrites the endpoint file — that is correct and
expected at this step. Do not paper over it by leaving `handshakes.py` in place.

- [ ] **Step 6: Commit** — suggested: `refactor(api): fold handshake schemas into PhaseEventRead and one discriminated complete request`

---

### Task 3.3 — The three phase endpoints; retire the five `/h{n}` routes

**Files:**
- Create: `backend/app/api/v1/endpoints/phases.py`
- Delete: `backend/app/api/v1/endpoints/handshakes.py`
- Modify: `backend/app/orchestration/phase_service.py` (add `complete_phase()`, `next_phase()`)
- Modify: `backend/app/main.py:14,47` — **shared file, flag in TASK COMPLETE**

**Fence:** match parent §3.2's route shapes exactly. The endpoint stays thin (validate → call service
→ return); no phase-type branching in the endpoint layer, that is `complete_phase()`'s job.

- [ ] **Step 1: Add the two service entry points**

In `backend/app/orchestration/phase_service.py`, after the five wrappers:

```python
# Decision S6: the single entry point the API calls. The five wrappers stay —
# each writes genuinely different evidence (Stage 2's T1) — but the phase-type
# dispatch and the body/row cross-check live exactly once, here.
_WRAPPER_BY_PHASE_TYPE = {
    PhaseType.ACTIVATION: advance_activation,
    PhaseType.LOADING: advance_loading,
    PhaseType.DEPARTURE: advance_departure,
    PhaseType.UNLOADING: advance_unloading,
    PhaseType.CONFIRMATION: advance_confirmation,
}


async def complete_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    phase_event_id: uuid.UUID, payload: PhaseCompleteRequest,
) -> TripDetailResponse:
    """Complete the addressed phase. Idempotent by payload.idempotency_key.

    Raises PhaseTypeMismatchError when the body's phase_type does not match the
    addressed row's — including when the row is trip_creation or in_transit,
    neither of which any driver action completes (create_trip writes the first;
    advance_departure's NEW-8 stopgap writes the second).
    """
    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)
    actual = PhaseType(event.phase_type)
    if actual != payload.phase_type:
        raise PhaseTypeMismatchError(expected=actual.value, received=payload.phase_type.value)

    wrapper = _WRAPPER_BY_PHASE_TYPE.get(actual)
    if wrapper is None:
        # Unreachable via the API (the union has no member for these types), but
        # a direct service caller must get the same clear error, not a KeyError.
        raise PhaseTypeMismatchError(expected=actual.value, received=payload.phase_type.value)

    return await wrapper(
        db, trip_id=trip_id, driver_id=driver_id,
        phase_event_id=phase_event_id, payload=payload,
    )


async def next_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
) -> PhaseEvent | None:
    """The lowest-sequence unresolved row — decision S7.

    Re-derived from the ledger, never read off trip.current_phase: the cache is a
    cache (parent §2.3), and if it ever diverges this endpoint tells the truth
    instead of laundering the divergence. Returns None for a closed trip.
    """
    await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number)
    )
    for event in result.scalars().all():
        if not _is_resolved(PhaseStatus(event.status)):
            return event
    return None


async def list_phases(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
) -> list[PhaseEvent]:
    """The trip's committed plan, in plan order. Length is data — never sliced,
    never padded to six."""
    await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number)
    )
    return list(result.scalars().all())
```

Add `PhaseCompleteRequest` and `PhaseTypeMismatchError` to the file's imports.

- [ ] **Step 2: Create the endpoint module**

Create `backend/app/api/v1/endpoints/phases.py`:

```python
"""Phase plan endpoints — the frozen contract's HTTP surface (parent plan §3.2).

Replaces endpoints/handshakes.py and its five /h{n}/complete routes. Decision S3:
these are driver-scoped. The dispatcher reads the same plan through
TripDetailResponse.phases on GET /trips/{id}, which it already calls — giving
these routes a second auth path would be new security surface with no consumer.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import (
    PhaseSequenceError,
    PhaseTypeMismatchError,
    ResourceNotFoundError,
)
from app.db.models.trips import TripStop
from app.db.session import get_db
from app.orchestration.phase_service import complete_phase, list_phases, next_phase
from app.schemas.people import DriverRead
from app.schemas.phases import PhaseCompleteRequest, PhaseEventRead
from app.schemas.trips import TripDetailResponse

router = APIRouter(prefix="/trips/{trip_id}/phases", tags=["phases"])


async def _stop_sequence_map(db: AsyncSession, *, trip_id: UUID) -> dict[UUID, int]:
    """PhaseEventRead.stop_sequence is a join, not a column — see its docstring."""
    result = await db.execute(
        select(TripStop.id, TripStop.sequence).where(TripStop.trip_id == trip_id)
    )
    return {stop_id: sequence for stop_id, sequence in result.all()}


@router.get("", response_model=list[PhaseEventRead], summary="A trip's committed phase plan")
async def list_phases_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> list[PhaseEventRead]:
    try:
        events = await list_phases(db, trip_id=trip_id, driver_id=current_driver.id)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    stop_sequences = await _stop_sequence_map(db, trip_id=trip_id)
    return [
        PhaseEventRead.from_event(e, stop_sequence_by_id=stop_sequences) for e in events
    ]


@router.get(
    "/next",
    response_model=PhaseEventRead | None,
    summary="The next unresolved phase, or null on a closed trip",
)
async def next_phase_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> PhaseEventRead | None:
    try:
        event = await next_phase(db, trip_id=trip_id, driver_id=current_driver.id)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if event is None:
        return None
    stop_sequences = await _stop_sequence_map(db, trip_id=trip_id)
    return PhaseEventRead.from_event(event, stop_sequence_by_id=stop_sequences)


@router.post(
    "/{phase_event_id}/complete",
    response_model=TripDetailResponse,
    summary="Complete a phase (idempotent by idempotency_key)",
)
async def complete_phase_endpoint(
    trip_id: UUID,
    phase_event_id: UUID,
    payload: PhaseCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    """Always 200 on a successful completion, including when the phase records a
    mismatch (that is evidence, not a client error) and including when its Hedera
    anchor failed (fail-open, D7 — dispatchers see anchor_status='failed', not a 504).
    """
    try:
        return await complete_phase(
            db, trip_id=trip_id, driver_id=current_driver.id,
            phase_event_id=phase_event_id, payload=payload,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (PhaseSequenceError, PhaseTypeMismatchError) as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

> **Route-shape note:** parent §3.2 writes the second route as `GET /trips/{id}/next-phase`. Mounting
> it under the `/trips/{trip_id}/phases` prefix as `/next` yields `/trips/{id}/phases/next`, which
> reads better and keeps one router. **Either is acceptable — pick `/phases/next` as written here, and
> record the deviation in the Findings ledger** so Stage 5's driver-app work and the frozen-contract
> TS both use the same string. Do not silently ship a third spelling.

- [ ] **Step 3: Delete the old endpoint module and re-point `main.py`**

```bash
rm backend/app/api/v1/endpoints/handshakes.py
```

In `backend/app/main.py`, line 14: `from app.api.v1.endpoints.phases import router as phases_router`
(keep alphabetical position among the imports). Line 47:
`app.include_router(phases_router, prefix="/api/v1")`.

**`main.py` is a CLAUDE.md shared file — flag this change in TASK COMPLETE.**

- [ ] **Step 4: Verify the app boots and the routes are what you think**

```
cd backend && .venv/bin/python -c "import app.main" && echo IMPORTS-OK
cd backend && .venv/bin/python -c "
import app.main
for r in app.main.app.routes:
    p = getattr(r, 'path', '')
    if 'phase' in p or 'handshake' in p:
        print(sorted(getattr(r, 'methods', [])), p)
"
```

Expected: `IMPORTS-OK`, then exactly three lines —
`['GET'] /api/v1/trips/{trip_id}/phases`, `['GET'] /api/v1/trips/{trip_id}/phases/next`,
`['POST'] /api/v1/trips/{trip_id}/phases/{phase_event_id}/complete`. **Zero `/handshakes` lines.**
If any `/h1/complete`-style route survives, the old module is still registered somewhere.

- [ ] **Step 5: Commit** — suggested: `feat(api): phase plan endpoints, retire the five handshake routes`

---

### Task 3.4 — `TripDetailResponse.phases`, and `POST /trips` returns the whole plan

**Files:**
- Modify: `backend/app/schemas/trips.py:12,401`
- Modify: `backend/app/orchestration/resource_service.py:27,161-167,235`
- Modify: `backend/app/orchestration/trip_service.py:27,408`

**Fence:** `get_trip_detail`'s queries are already correct (already ordered by `sequence_number`,
already unions `PHASE_EVENT` receipts). Do not "improve" them. This task renames a field and fixes one
response-content bug.

- [ ] **Step 1: Rename the field on the response schema**

`backend/app/schemas/trips.py` line 12: `from app.schemas.phases import PhaseEventRead`.
Line 401: `phases: list[PhaseEventRead]`.

- [ ] **Step 2: Update `get_trip_detail`**

`resource_service.py` line 27: import `PhaseEventRead` from `app.schemas.phases`. Rename the local
`handshakes` variable (line 167) to `phase_events` and its two downstream uses (`phase_event_ids` at
line ~181 already reads from it). Line 235 becomes:

```python
        phases=[
            PhaseEventRead.from_event(e, stop_sequence_by_id=stop_sequence_by_id)
            for e in phase_events
        ],
```

Immediately after the existing `stops` query (currently lines ~199-203), add:

```python
    # PhaseEventRead.stop_sequence is a join, not a column — build the map from
    # the stops already fetched rather than issuing a second query.
    stop_sequence_by_id = {s.id: s.sequence for s in stops}
```

**Ordering note:** the `stops` query currently sits *after* the phase-event query. `stop_sequence_by_id`
must be defined before line 235's response construction — it already is, since `stops` is fetched at
~199 and the response is built at ~213. No query reordering is needed.

- [ ] **Step 3: Fix `create_trip`'s response — return the whole plan, not just H0**

`trip_service.py` line 27: import `PhaseEventRead` from `app.schemas.phases`. Replace line 408:

```python
        # The full committed plan, not just H0. POST and GET must describe the same
        # trip: returning one row here while GET /trips/{id} returns seven made the
        # phase list look like it grew between two reads of an unchanged trip.
        phases=[
            PhaseEventRead.from_event(e, stop_sequence_by_id={s.id: s.sequence for s in trip_stops})
            for e in phase_events
        ],
```

- [ ] **Step 4: Verify no consumer still says `handshakes`**

```
cd backend && grep -rn "handshakes=\|\.handshakes\b" app/
```

Expected: zero matches.

```
cd backend && .venv/bin/python -m mypy . && .venv/bin/python -c "import app.main" && echo OK
```

Expected: `Success: no issues found`, then `OK`.

- [ ] **Step 5: Commit** — suggested: `feat(api): TripDetailResponse.phases and full plan on trip creation`

---

### Task 3.5 — Rewrite the tests against the live endpoints

**Files:**
- Create: `backend/tests/integration/test_phases.py`
- Delete: `backend/tests/integration/test_handshakes.py`
- Modify: `backend/tests/integration/test_handshakes_anchor.py`
- Modify: `backend/tests/integration/test_trips.py` (lines ~171-176, ~445-446),
  `test_create_trip_multistop.py`, `test_detail_receipts_gating.py:158`
- Modify: `backend/tests/unit/test_phase_service.py` (payload class renames; `complete_phase`/`next_phase`)

**Fence:** parent §7 Stage 3's verification is explicit that these must *actually execute*, not skip.
Confirm with `pytest -rs`. Renaming a test is not the same as deleting its coverage — every behaviour
`test_handshakes.py` asserted today must appear in `test_phases.py`, retargeted.

- [ ] **Step 1: Write `backend/tests/integration/test_phases.py`**

Port the six tests in `test_handshakes.py` (read it first — `test_h1_complete_returns_200`,
`test_h1_wrong_state_returns_409`, `test_h1_unknown_driver_token_returns_401`, and the three
`get_handshake_detail` tests). The three detail tests target a route that no longer exists: replace
them with `GET /phases` equivalents asserting the same three properties (returns the plan; unknown
trip → 404; another driver's trip → 404). Reuse `test_handshakes.py`'s existing `seed_trip` fixture
and token helpers exactly — do not build new ones.

New tests this stage owes, in the same file:

```python
async def test_list_phases_returns_the_whole_plan_in_order(client, db_session, seed_trip):
    """Length is data: assert the plan matches build_phase_plan's output for THIS
    fixture's stops, never a hard-coded 7."""


async def test_list_phases_includes_stop_sequence_and_step_recipe(client, db_session, seed_trip):
    """The two derived PhaseEventRead fields — the ones model_validate() alone
    would silently leave empty. trip_creation must have stop_sequence None and an
    empty step_recipe; activation must have stop_sequence 0 and a non-empty one."""


async def test_next_phase_tracks_the_ledger_and_returns_null_when_closed(
    client, db_session, seed_trip,
):
    """After each completion GET /phases/next returns the lowest unresolved row;
    after the final confirmation it returns null (decision S7)."""


async def test_complete_with_wrong_phase_type_in_body_returns_409(client, db_session, seed_trip):
    """Decision S5/S6: addressing the activation row with a loading payload is a
    client bug and must be a distinguishable 409, not a 500 or a silent no-op."""


async def test_complete_addressing_in_transit_row_returns_409(client, db_session, seed_trip):
    """in_transit is not driver-completable (NEW-8's stopgap owns it). The union
    has no member for it, so this is a 422 from Pydantic if phase_type is
    'in_transit' — assert whichever of 422/409 the stack actually produces, and
    write the assertion to match observed behaviour, not to guess it."""


async def test_complete_missing_required_field_returns_422(client, db_session, seed_trip):
    """The discriminated union's whole justification (S5): a departure payload
    without seal_number is a real Pydantic 422, not a hand-rolled service error."""


async def test_replayed_complete_returns_200_and_does_not_duplicate(client, db_session, seed_trip):
    """Idempotency over HTTP, not just at the service layer."""
```

> **Executing agent:** for `test_complete_addressing_in_transit_row_returns_409`, run it first and
> record what the stack actually returns before writing the assertion. A discriminated union with no
> matching member produces a 422, not a 409 — if that is what happens, assert 422 and rename the test
> accordingly. Do not force a 409 by adding an `in_transit` union member; that would make a stopgap
> driver-addressable, which NEW-8's carry-forward explicitly forbids.

- [ ] **Step 2: Delete the superseded file**

```bash
rm backend/tests/integration/test_handshakes.py
```

- [ ] **Step 3: Retarget `test_handshakes_anchor.py`**

Keep the filename — it tests anchoring policy, not routing. Change its `_complete_h1`/`_complete_h2`
helpers and its three tests to POST
`/api/v1/trips/{trip_id}/phases/{phase_event_id}/complete` with a `phase_type` field in each body,
resolving `phase_event_id` from a `GET /phases` call. Its `body["handshakes"]` reads (lines 182, 186,
219, 253) become `body["phases"]`.

- [ ] **Step 4: Update the remaining `handshakes` assertions**

- `test_trips.py:171-176` — `body["handshakes"]` → `body["phases"]`, and `len(...) == 1` becomes
  `len(...) == 7` (task 3.4 now returns the whole plan). **This test stays red afterwards** for its
  pre-existing unmocked-Hedera reason (`blockchain_receipts != []`) — do not claim to have fixed it.
- `test_trips.py:445-446` — `body["handshakes"]` → `body["phases"]`; the `== 7` stays.
- `test_create_trip_multistop.py` — same rename wherever it reads the field.
- `test_detail_receipts_gating.py:158` — `handshakes=[]` → `phases=[]`.

- [ ] **Step 5: Update `tests/unit/test_phase_service.py`**

Rename the five payload classes at every construction site (`H1CompleteRequest` →
`ActivationCompleteRequest` etc.) and add `phase_type=PhaseType.<TYPE>` to each. Add two tests for the
new service entry points:

```python
async def test_complete_phase_rejects_payload_for_a_different_phase_type(db_session, trip_fixture):
    """S6: complete_phase raises PhaseTypeMismatchError rather than writing
    activation's evidence onto a loading row."""


async def test_next_phase_derives_from_ledger_not_from_trip_current_phase(db_session, trip_fixture):
    """S7: corrupt trip.current_phase to a deliberately wrong value, then assert
    next_phase() still returns the true lowest-unresolved row. This is the test
    that makes 'the ledger is the truth' provable rather than asserted."""
```

- [ ] **Step 6: Run the whole gate**

```
cd backend && .venv/bin/python -m ruff check . && .venv/bin/python -m mypy . && .venv/bin/python -m pytest -q -rs
```

Expected: `All checks passed!` · `Success: no issues found` · **0 skipped** · failures **≤ 7** and
every one of them from the Prerequisites' named list. A new failure means stop and fix, not record.

- [ ] **Step 7: Commit** — suggested: `test(api): phase endpoints integration coverage, retire handshake route tests`

---

## Verification

The standard gate, run locally before CI:

```
cd backend             && ruff check . && mypy . && pytest -q -rs
cd frontend/dispatcher && npx tsc --noEmit && npm run lint
cd frontend/driver-pwa && npm run type-check && npm run lint && npm test
```

The frontend gates should be **unchanged** by this stage — nothing in `frontend/` is edited. Run them
anyway: `test_phase_meta_contract.py` reads a TS file, so a frontend change during this stage is
exactly the kind of thing that should surface here.

Plus, specific to this stage:

- **`import app.main` succeeds and exposes exactly three phase routes, zero handshake routes** — the
  route-dump command in task 3.3 step 4.
- **A full single-leg walk over live HTTP** — `POST /trips`, then `GET /phases`, then
  `POST /phases/{id}/complete` five times addressing ids from the plan, asserting 200 each time and
  `status == "closed"` at the end. This is parent §7 Stage 3's literal bar: *integration tests hit the
  live endpoints for a full single-leg walk and actually execute.*
- **The 11-row cross-dock plan walks to `CLOSED`** — task 3.0 step 6. This is the "Done when" Stage 2
  recorded as unmet; it is met here or this stage is not done.
- **`GET /phases/next` returns null on a closed trip, and never reads `trip.current_phase`** —
  `test_next_phase_derives_from_ledger_not_from_trip_current_phase`.
- **`step_recipe` agrees with the frontend** — `test_phase_meta_contract.py`.
- **Skip count still 0; whole-suite failure count ≤ 7**, all from the named pre-existing set.

## Done when

A driver-authenticated client can `GET /trips/{id}/phases` on a trip it owns, receive the full
plan-ordered `PhaseEventRead[]` with `stop_sequence`, `anchor_status` and `step_recipe` populated,
`POST /trips/{id}/phases/{phase_event_id}/complete` each phase in turn with one discriminated request
shape, watch `GET /phases/next` track the ledger and go null at the end — on both a 7-row single-leg
trip and an 11-row cross-dock trip, the latter reaching `CLOSED` — with `TripDetailResponse.phases`
serving the same plan to the dispatcher and no `/handshakes` route left in the app.

---

## Out of scope

Named explicitly so a cold agent doesn't drift into adjacent, larger work.

### Deferred to their own plan, post-Go/No-Go — recorded here in full so they are not lost

Ciaran's instruction, 2026-07-29: *"go with option 1 but make sure it is recorded clearly so that it
can be done later."* Both belong in a **Stage 3-B plan** written after the ~2026-08-04 gate.

- **3.3 — Server-side reconciliation (F1).** The driver never sends or sees a Parcel Perfect count; the
  server reconciles privately and P6 returns a verdict. Concretely, this means:
  `LoadingCompleteRequest.driver_visual_count` and `ConfirmationCompleteRequest.pp_scan_in_count` come
  off the wire; `parcel_count_origin`/`parcel_manifest_snapshot` (columns that exist and are never
  populated — finding F6) get filled from the PP poll; confirmation returns a reconciliation result
  rather than comparing numbers the client supplied. **Fence when it happens: mock-first. Do not claim
  live PP load/unload status — `ecomService v28` cannot supply it (spec §6).** Related and currently
  unaddressed: intermediate `unloading` rows perform seal continuity but **no count reconciliation at
  all** (see S1's "known limitation"), so mid-route deliveries are never count-checked. That gap
  belongs to this work item.
- **3.4 — Fatter anchor payloads (F4).** Fold artifact SHA-256s, GPS, timestamps and the manifest
  snapshot hash into the anchored canonical payloads, which today cover four fields at departure and
  four at confirmation. **Fence when it happens: do this before wiring any further anchors**, and
  change `compute_*_canonical_payload` and `verification_service._reconstruct_phase_event_payload` in
  the same commit — the byte-identity fence that has bound every stage still binds. POPIA still binds
  harder: hashes of evidence may go on-chain, the evidence itself never may.

### Not this stage's work, unchanged from Stage 2's carry-forward

- **NEW-8's `_auto_complete_in_transit` stopgap** — real checkpoint-Merkle-batch completion of
  `in_transit` (parent D2) has no owner and no scheduled stage. It needs a ticket. Not this stage.
- **`TripConsignmentInput`'s missing per-consignment stop reference** — every consignment created
  through the live API runs stop-0 → stop-last, so a multi-stop trip created over HTTP cannot yet
  express a real cross-dock routing. The 11-row proof runs off a fixture that sets the fields directly.
  A follow-on ticket, flagged since Stage 2 task 2.1a.
- **Multi-seal-layer modelling** (Pulsit geofence lock, physical container-lock key pair, client seal)
  from the 2026-07-28 Bruce meeting — a future schema decision.
- **Immutability RLS guards on `trips`/`phase_events`** — flagged since Stage 1, still unowned, still
  needs its own change and a note to the other three devs.
- **Dispatcher and driver-pwa changes** — Stages 4 and 5. Nothing in `frontend/` is edited here, with
  the single exception that task 3.1's test *reads* a TS file.
- **`frontend/shared/lib/types/handshake.ts`** — legacy, deliberately retained until Stages 4/5 remove
  its last consumer. Do not edit it.
- **`main`/`dev` divergence, promotion, `pg_dump`** — parent §0.2/§5.6.

---

## Findings ledger

*Fill in after execution, same discipline as Stages 1 and 2.* At minimum record: the suite numbers
before and after; whether S2 survived review or was vetoed; the `/phases/next` vs `/next-phase` route
spelling actually shipped (task 3.3 step 2's note); what
`test_complete_addressing_in_transit_row_returns_409` was renamed to once its real status code was
observed; and every defect found in this plan's own literal code.
