# Trip lifecycle — verification brief

**Written:** 2026-08-09
**Branch:** `scan-driven-driver-pwa` @ `dda51c6`
**For:** a cold session, before any further lifecycle work is committed.

---

## What this document is

An audit of the trip lifecycle was run on 2026-08-09 against `d37f24b`. It found a
blocker plus a list of smaller issues. Tim's commit `dda51c6` then fixed the blocker
and several of the others.

**Everything below is a CLAIM, not an established fact.** Your job is to confirm or
refute each one against the code, then report. Do not fix anything until the
verification section is done and the findings have been reviewed — several claims may
already be stale, and at least one is explicitly untested.

Treat "the previous audit said X" as a lead to check, never as a result to build on.

---

## Environment — read this first, it will otherwise cost you an afternoon

### Integration tests skip silently

`backend/tests/conftest.py:174-175` skips every integration test when
`TEST_DATABASE_URL` is unset. Without it the suite reports green while testing
nothing (~364 tests pass by absence).

**Before trusting any backend number, confirm integration tests actually ran:**

```bash
cd backend && grep -c TEST_DATABASE_URL .env     # must be >= 1
./.venv/bin/python -m pytest tests/ -q --tb=no -p no:randomly 2>&1 | tail -2
# The "skipped" count should be ~4, NOT ~364.
```

If it is unset, either bring up the test container
(`docker compose -f infrastructure/docker/docker-compose.test.yml up -d`) or point at
a local Postgres.

### A dirty test DB manufactures fake failures

Reusing a long-lived local `freightproof_test` DB leaves rows behind, which surface as
`409 Conflict` on trip/driver/vehicle creation. These are **not** real failures.

Two independent runs on 2026-08-09 disagreed for exactly this reason (one reported ~45
failures, one reported 8). If you see `assert 409 == 201`, suspect leftover rows before
suspecting the code. A clean tmpfs container is the tiebreaker.

### Reference numbers (2026-08-09, `dda51c6`, integration tests confirmed running)

| Suite | Result |
|---|---|
| backend | 8 failed, 648 passed, 4 skipped |
| driver-pwa | 615 passed, 1 suite fails to load |
| dispatcher | 146 passed, 1 failed |

Of the 8 backend failures: 2 are genuine (see V2), ~4 are `409` leftover-row artefacts,
2 are unclassified (`test_blockchain_verify` 404, `test_vehicles_validation`
MissingGreenlet). **If your genuine-failure count exceeds 2, something regressed.**

The driver-pwa suite failure is `@googlemaps/js-api-loader` — declared in
`driver-pwa/package.json` but not installed and not hoisted to the repo root. Fix with
`npm install` before concluding anything about that suite.

---

## Part A — Verification

Work through these. For each: **CONFIRMED**, **REFUTED**, or **STALE** (the code has
moved on), with the evidence that settles it.

### V1 — The arrival deadlock is fixed

**Claim:** before `dda51c6`, a trip could not advance past `departure`. `IN_TRANSIT`
stayed `PENDING` for the whole drive, and `advance_unloading` — the only thing that
closes it — was rejected by the lower-sequence gate before reaching that code.
`dda51c6` fixed it by excluding `IN_TRANSIT` from the gate.

```bash
cd backend && ./.venv/bin/python -m pytest tests/integration/test_phases.py -q -p no:randomly
```

Expected: all pass, including `test_full_single_leg_walk_over_http_closes_the_trip`
(it returned `409` on the 4th call before the fix).

Read `_gate_and_load` in `backend/app/orchestration/phase_service.py` and confirm the
`PhaseEvent.phase_type != PhaseType.IN_TRANSIT` exclusion is present and reasoned.

### V2 — Two stale unit tests, unowned

**Claim:** `test_current_phase_and_current_stop_track_the_ledger` and
`test_replayed_exception_completion_is_idempotent_no_duplicate_exception`
(`backend/tests/unit/test_phase_service.py`) both assert the pre-`9be7a78` behaviour
where `IN_TRANSIT` auto-completed on departure. They are test debt from an
already-merged change, not regressions.

Confirm each failure is an assertion about `in_transit` being `COMPLETED` /
`current_phase == UNLOADING` immediately after departure. If either fails for any
other reason, that is a real regression — report it.

These should be **rewritten to the new contract**, not deleted: the behaviour they
cover (position tracking, replay idempotency) still needs coverage.

### V3 — Override hole (UNTESTED — this is the one that most needs your judgement)

**Claim, by inspection only.** `in_transit` is closed *only* by `advance_unloading`
(`phase_service.py`, the `_find_in_transit_for_leg` block). So:

1. Dispatcher overrides `unloading` (the lost-phone case override exists for).
2. `advance_unloading` never runs → `in_transit` stays `PENDING`.
3. `confirmation` still passes the gate (it skips `in_transit`; `unloading` is
   `OVERRIDDEN`, which counts as resolved).
4. `recompute_position` walks for the first unresolved row, finds `in_transit`
   `PENDING`, sets `current_phase = in_transit` and **never reaches the
   close-the-trip branch**.
5. Trip is stuck `ACTIVE` permanently. The dispatcher has no override control for
   `in_transit` — `frontend/dispatcher/app/(app)/trips/[id]/page.tsx` renders
   `PhaseOverrideAction` only inside the five per-type `expandedContent` branches, and
   `in_transit` falls through to `undefined`.

**Write the test before deciding anything.** Override `unloading`, complete or override
`confirmation`, assert `trip.status`. If it closes, this claim is REFUTED — say so
plainly.

### V4 — Confirmation is gated server-side but silent in the UI

**Claim:** `GATED_PHASES` (`backend/app/orchestration/phase_gate.py`) includes
`CONFIRMATION: ScanDirection.IN`, so the server 409s (`PhaseBlockedError`) if the
destination warehouse has not closed its scan-in session. No confirmation step reads
`blocked_on`:

```bash
grep -rn "blocked_on" frontend/driver-pwa/components/phase/steps/ | grep -v __tests__
```

Expected: hits in `loading/Linehaul.tsx` and `unloading/VisualCount.tsx` only.

If confirmed, the driver captures POD photo, receiver signature and reconciliation, then
takes a hard 409 on the final swipe at the customer's gate. The fix is the pattern those
two files already use.

### V5 — Dispatcher disagrees with the backend about "resolved"

**Claim:** `frontend/dispatcher/lib/phase/derive.ts` defines
`RESOLVED = ['completed', 'overridden']` — excluding `'exception'`. The backend's
`_is_resolved` includes it, and `frontend/driver-pwa/lib/phase/derive.ts` matches the
backend.

Consequence to verify on a trip carrying any exception phase (a departure seal
mismatch, a loading short-scan):
- `activePhase()` pins to the exception row, so the header chip names the wrong phase
- `completionPct()` cannot reach 100% on a closed trip
- every later row gets `nodeType: 'pending'`, which sets `isPending`, which suppresses
  **both** `expandedContent` and `alwaysExpandedContent` — so per-phase evidence panels
  and the in-transit Journey card disappear on exactly the trips that most need
  inspection

That file's own header says "If this file and that one ever diverge, the backend wins
and this is the bug." Confirm the divergence is real before changing anything — the
dispatcher may want a *presentational* distinction, in which case the fix is a
separately-named helper, not a redefinition of `isResolved`.

### V6 — Dead exception-placement fallback in the dispatcher

**Claim:** `dda51c6` made the backend tag driver-raised exceptions with
`phase_event_id` (`exception_service.py` via `current_phase_event`). The dispatcher's
render-time guessing block is now dead weight:
`frontend/dispatcher/app/(app)/trips/[id]/page.tsx` — the `IN_TRANSIT_FRIENDLY` set,
the `findLastIndex` fallback, and `exc.exception_type as any`.

Note the fallback's `nodeType === 'active'` branch was never reachable: `'active'`
requires `status === 'in_progress'`, and nothing in `backend/app/` ever writes it
(`grep -rn "IN_PROGRESS" backend/app/ | grep -v enums.py` — two read sites, no writes).

The `as any` is a CLAUDE.md violation regardless of what happens to the rest.

### V7 — Home shows the wrong CTA for the whole unloading phase

**Claim:** because `in_transit` stays `PENDING` until `unloading` submits, `isDriving()`
returns true for the entire unloading phase. `HomeContent.tsx` and `TripDetailView.tsx`
still use `currentPhase` + a local `firstStepRoute`, not the new `actionablePhase`. So
Home says "Continue driving" while the driver is standing at the destination doing
seal-verify.

Navigable (hub → swipe → step), so it is polish, not a blocker. `actionablePhase` was
built for exactly this distinction and simply was not wired into those two screens.

Also check whether `isDriving`'s second branch (current is `unloading` and the preceding
`in_transit` is resolved) is reachable at all. It appears to be dead under the current
model — confirm before deleting.

### V8 — Evidence collected, stored, never displayed

Verify each:

| Item | Claim |
|---|---|
| `linehaul_photo_artifact_id` | Driver uploads it, backend persists it, **no dispatcher component renders it**, and it is absent from `PhaseDescriptor` in `frontend/shared/lib/types/phase.ts` |
| `Checkpoint` rows | POST-only. No GET endpoint; `get_trip_detail` never selects them. **Deliberately out of scope** — confirm and record, do not build |
| Activation "Gate photo" | `dispatcher/components/domain/ActivationDetail.tsx` renders `phase.gate_photo_artifact_id`, but nothing writes that column at activation — it is only ever written by `advance_unloading`. Permanently blank row |

### V9 — Parcels vs pallets

**Decided by the team: it is a PARCEL count.** Confirm what still says otherwise:

- `dispatcher/components/domain/ConfirmationDetail.tsx` — "Pallets counted by driver",
  "Pallet grain — recorded, not reconciled against the parcel counts above"
- `backend/app/schemas/phases.py` — the `ConfirmationCompleteRequest.driver_visual_count`
  comment
- `driver-pwa/.../unloading/VisualCount.tsx` and `.../confirmation/Reconciliation.tsx`
  already say parcels

The count is anchored to Hedera, so the label is describing on-chain evidence. Confirm
`dda51c6`'s optional-count handling keeps the key present with value `null` in
`compute_confirmation_canonical_payload` (it appears to), because
`verification_service` rebuilds that exact dict on every verify.

### V10 — Dead code

`dispatcher/components/domain/ReconciliationRows.tsx` — exported, imported nowhere.
It compares destination count against driver visual count, which is the exact
comparison the scan-driven redesign removed. Confirm it is unreferenced.

---

## Part B — Scope fences

Do not widen past these without asking Ciaran.

- **Hub-to-hub only.** One origin, one destination. Multi-stop and cross-dock are not
  in the MVP demo.
- **Known latent issue, not for fixing now:** `trip_service.create_trip` stamps every
  consignment as pickup-at-first-stop / delivery-at-last-stop, so a middle stop has no
  cargo activity. `build_phase_plan` then emits `departure` + `in_transit` for it with
  no arrival phase, and nothing closes that leg. A 3+ stop trip would stall. Hub-to-hub
  is unaffected — `create_trip` builds exactly two stops. Record it; do not fix it.
- **Checkpoints stay write-only.** Panic is in the demo, checkpoints are not.
- **Do not touch the gate's other three checks.** The `IN_TRANSIT` exclusion is
  deliberate and documented. Ownership, ordering and idempotency are load-bearing.

## Part C — Shared files

Per CLAUDE.md these need the team told, and `CLAUDE.md` itself needs all four:

- `frontend/shared/lib/constants/phase-meta.ts` — already changed in `dda51c6`
  (unavoidable: `backend/tests/unit/test_phase_meta_contract.py` parses this file and
  fails if it drifts from `backend/app/core/phase_meta.py`; edit both together)
- `frontend/shared/lib/types/phase.ts` — will need changing if V8's linehaul field is
  added
- `frontend/driver-pwa/package.json` — if the `@googlemaps` install is committed

## Part D — Dev data

The `1-hand-waybill` unloading step was removed in `dda51c6`. `STEP_SLUGS`,
`STEP_REGISTRY` and the deleted component all agree — the code is consistent. But any
trip already sitting mid-unloading on the dev DB, and any `usePhaseDraft` entry in
localStorage keyed to that slug, now points at a step that no longer exists.

**Reseed the dev DB and clear driver-app localStorage** rather than debugging a
phantom step.

---

## Part E — Open design question (Ciaran's call, do not decide this yourself)

`in_transit` is the only row in the ledger with **no owner**. Every other phase is
completed by whoever did the work. This one is opened by `advance_departure`, closed by
`advance_unloading`, and skipped by the gate — a special case in three places.

Two consequences follow from that, and both are real:

1. `in_transit.completed_at` records **when unloading was submitted**, not when the
   driver arrived. The dispatcher's "elapsed drive time" therefore includes the whole
   unloading phase. This was the stated purpose of `9be7a78`.
2. The V3 override hole exists precisely because no actor is responsible for the row.

The alternative considered but not taken: make arrival an explicit driver submission —
add an `in_transit` variant to the `PhaseCompleteRequest` union and an
`advance_in_transit` wrapper; the existing "Arrive at destination" swipe on the
in-transit hub submits it instead of only navigating. That removes the gate exception,
gives a truthful arrival timestamp, and makes override work through the normal path.

It is more work and it reverses a documented design fence ("`trip_creation` and
`in_transit` are deliberately absent from the union"), plus it inverts
`test_complete_addressing_in_transit_row_returns_422`.

**Report the trade-off with evidence. Do not implement either option unilaterally.**

---

## Part E.1 — DECIDED (2026-08-09, Ciaran): in_transit becomes driver-owned

The alternative above is now the chosen design. Arrival becomes an explicit driver
submission. Recorded here so the reasoning survives the decision.

### Why the documented fence did not hold

`test_complete_addressing_in_transit_row_returns_422` justifies the exclusion like this:

> "in_transit is completed by the authorized `_auto_complete_in_transit` stopgap
> (phase_service.py), and making it driver-addressable would harden that stopgap
> into contract."

**`_auto_complete_in_transit` does not exist.** It was deleted in `9be7a78`. It appears
in zero files under `backend/app/` and in six places across the test suite, all citing
it as the reason. The fence's stated rationale was already stale; this change does not
reverse a live design decision so much as retire a dead one. Fix those six references
as part of the work.

### Why it is worth doing

`InTransitPageClient.tsx:190` is today:

```tsx
<SwipeToConfirm label="Arrive at destination" onConfirm={() => router.push(currentStepRoute(trip.phases))} />
```

It only navigates. The driver already performs a deliberate physical swipe meaning "I
have arrived", and the system discards it, then later infers arrival from when the
unloading paperwork was submitted. This is not new driver burden — it is recording an
act that already happens. On a platform whose thesis is "we record what happened", the
longest and highest-risk leg being the one segment nobody attests to is the weakest
point in the design.

### Implementation constraints — all four are load-bearing

1. **Submit from the in-transit hub, NOT a step page. Keep `STEP_SLUGS.in_transit = []`.**
   Giving in_transit a step recipe perturbs `actionablePhase()` (which filters on
   `STEP_SLUGS[type].length > 0`), changes driver-pwa routing, and forces an edit to the
   shared `phase-meta` contract in both languages under `test_phase_meta_contract.py`.
   Submitting from the existing swipe avoids all of it, and likely means the shared file
   does not change at all. Verify rather than assume, but design toward it.

2. **Minimal payload.** GPS, timestamp, idempotency key. No photo, no new artifact. This
   is an attestation of arrival, not an evidence capture. If it grows a photo step it has
   become a different, more expensive feature.

3. **DELETE `isDriving`'s case 2 (`driver-pwa/lib/phase/derive.ts`) in the same change.**
   The single easiest thing to get wrong here. Case 2 reads "current is `unloading` AND
   the preceding `in_transit` is resolved -> driving". Once arrival submits, `in_transit`
   is COMPLETED and `unloading` is current, so case 2 fires for the WHOLE unloading phase
   and Home says "Continue driving" while the driver is doing seal-verify — which is
   exactly V7, resurrected by the fix meant to kill it. Case 2 is a fossil of the
   pre-`9be7a78` model where in_transit auto-completed at departure and case 2 was the
   only way to detect driving. Deleting it makes this change SUBSUME V7, so
   `HomeContent.tsx` / `TripDetailView.tsx` need no `actionablePhase` rewiring.

4. **Keep the dispatcher's in_transit override** (added to
   `dispatcher/app/(app)/trips/[id]/page.tsx` on 2026-08-09). The structural fix removes
   the CAUSE of the V3 strand; the override remains the RECOVERY for a driver whose phone
   dies mid-drive and who therefore can never submit arrival.

Remove `_gate_and_load`'s `IN_TRANSIT` exclusion LAST, and only after the full walk test
passes without it. Do not touch the gate's other three checks.

### Sequencing

Do this BEFORE V2. The two stale unit tests assert `in_transit` completion and position
tracking that this redesign changes again — rewriting them first means rewriting them
twice.

---

## Part F — Suggested output

A short report, no code changes:

1. Each of V1–V10: CONFIRMED / REFUTED / STALE, with the evidence.
2. V3 specifically: the test you wrote, and what it proved.
3. Anything the audit missed — it did not deeply review `trip_service.create_trip`,
   `verification_service`, `scan_service`, the SSE/realtime path, or auth.
4. Your recommendation on Part E, with reasoning.
5. Fresh suite numbers, with confirmation that integration tests actually ran.

Then stop and check in before fixing anything.
