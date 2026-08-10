# Phase Refactor — Stage 2: The Phase Engine

**Created:** 2026-07-28 · **Owner:** Ciaran · **Branch:** `Phase-refactor`
**Parent plan:** `docs/superpowers/plans/2026-07-25-phase-model-refactor.md` — *that document is the
source of truth. If this plan and the parent disagree, the parent wins.*
**Predecessor:** `docs/superpowers/plans/2026-07-28-phase-refactor-stage-1-data-model-migration-seeder.md`
— read its **Findings ledger** before starting. Its "Carried into Stage 2" section and NEW-1…NEW-7
defects are inputs to this plan, not background reading; §Prerequisites below restates the load-bearing
ones inline so a cold agent doesn't have to cross-reference.
**Status:** ready to execute · executed by subagents that start cold and cannot ask questions.

---

## Invariants — must not break

- Layering: endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db.
  `integrations/` never imports from `api/` or `orchestration/`. `db/` never imports from `app/`.
- POPIA: only SHA-256 hashes reach Hedera. No GPS, photos, names, or parcel details in any
  canonical payload. Personal data stays in Postgres.
- RLS: FastAPI runs as `service_role` and bypasses RLS, so RLS breakage is SILENT. Any new or
  renamed table must be in the enumeration and carry its policies. *(No RLS surface in this stage —
  no tables are added or renamed — but the invariant is restated per the template regardless.)*
- The ledger is the truth. `current_phase`/`current_stop` are caches — no write path may branch
  on them.
- Length is data. Nothing may hard-code 6 phases or sequence 0..6.
- Anchor policy: P0 fail-closed; P3/P6 fail-open with `anchor_status` recorded; P1/P2/P4/P5 not
  anchored.
- Never run git write commands. Suggest commits; the developer runs them.
- Latest stable only: SQLAlchemy 2.0 `Mapped`/`mapped_column`, Pydantic v2, async endpoints via
  `get_db()`, no `any` in TypeScript.

---

## Objective

`create_trip` writes a full committed phase plan (not one static P0 row); one `complete_phase()`
core — reached through five renamed, thin wrappers — replaces `advance_h1..h5`; a trip's position is
derived from the ledger and cached onto `Trip.current_phase`/`current_stop` on every completion;
completion is idempotent by offline-queue key; P3/P6 anchors fail open with `anchor_status` recorded
while P0 stays fail-closed; and the seal moves from loading to departure without becoming
self-referential or trip-wide-ambiguous on a multi-stop plan. This is the stage where "the ledger is
the truth" stops being a sentence in the parent plan and becomes code a reviewer can read.

## Why now

Stage 1 gave the shape the schema needs, but nothing in `app/` uses it yet: `create_trip` still
inserts exactly one `PhaseEvent` row (`trip_creation`) and stops there, and `advance_h1..h5` still
gate on the fine-grained `TripStatus` LEGACY values by design (Stage 1's own S2 fence forbade
touching control flow). Every other stage depends on this one: Stage 3's endpoints have nothing
correct to call, Stage 4's dispatcher timeline has no multi-row plan to render, and Stage 6's
multi-stop proof cannot walk if the engine underneath it still assumes one row per phase type.

---

## Prerequisites

### Must be true before the first edit

| # | Condition | How to check |
|---|---|---|
| P1 | Branch is `Phase-refactor`, Stage 1 landed | `git log --oneline -3` → `db4fce4`, `fe35e5d` present |
| P2 | Baseline suite reproduces Stage 1's exit numbers | `cd backend && .venv/bin/python -m pytest -q` → **319 passed, 8 failed, 0 skipped** |
| P3 | Unit suite green | `cd backend && .venv/bin/python -m pytest tests/unit -q` → **185 passed** |
| P4 | The 8 known-red failures are exactly Stage 1's named set, nothing new | `pytest -q 2>&1 \| tail -20` — cross-check against Stage 1's Findings ledger table (§1.x) |
| P5 | Wiring points at the refactor project | `PYTHONPATH=. .venv/bin/python scripts/check_supabase_wiring.py` → ref `spjugofbopoyrmmpucjr` |
| P6 | Test Postgres up | `docker compose -f infrastructure/docker/docker-compose.test.yml up -d` → `Up (healthy)` |

### Carried from Stage 1's Findings ledger — restated because they bind this stage directly

- **F3 / DE2 — unmocked Hedera in `test_create_trip_multistop.py` and `test_trips.py`
  (`test_create_trip_response_shape`).** `create_trip` anchors P0 synchronously and for real when
  these tests don't mock `anchor_subject`. Stage 2 adds *more* trip-creation-path tests (2.1 below);
  left unmocked, they get slower and flakier, not just pre-existing-red. **Task 2.1's test-writing
  step mocks Hedera in every new/modified creation-path test it touches; the two named pre-existing
  failures are not this stage's job to fix (they predate the phase plan) but must not multiply.**
- **`TripStatus` LEGACY values and `advance_h*` deletion — Stage 1's S1 explicitly named "Stage 2.2"
  as the owner.** This stage deletes them (task 2.2d) rather than deferring again.
- **`trip_service.py:85-92` and `tasks/parcel_perfect.py:31-37` active-status lists** — both
  enumerate the LEGACY `TripStatus` values by name and break the moment they're deleted. Confirmed by
  reading both files while writing this plan: `trip_service.py`'s `_check_order_number_conflict`
  (current lines 84-93) and `tasks/parcel_perfect.py`'s `_ACTIVE_STATUSES` (current lines 28-38).
  Both collapse to the coarse set in task 2.2d, same commit as the enum deletion.
- **Canonical payload re-pointing (Stage 1's S3, this stage's task 2.7) has no backward-compatibility
  obligation.** Confirmed by Ciaran 2026-07-28: the refactor DB holds zero `blockchain_receipts` rows
  anchored over the old payload shape. Keys may be renamed outright.
- **Immutability guards were deliberately not added to `phase_events`/`trips` RLS in Stage 1** — still
  not this stage's job (no RLS surface here at all); still needs its own change and a note to the
  other three devs, unchanged from Stage 1's ledger.

### Read while writing this plan — current, verified shape of every file this stage touches

Confirmed by reading the actual files on `Phase-refactor` (not assumed from the parent, which was
written before Stage 1 ran and is one layer removed from the real line numbers):

- `app/orchestration/handshake_service.py` (381 lines) — `advance_h1..h5` are **completely
  untouched behaviourally** by Stage 1, exactly as its S2 fence required: fine-grained `TripStatus`
  gates, fail-closed H2/H5 anchors, seal read from `phase_type == LOADING` at three call sites
  (current lines ~222-227, ~268-273, ~326-331), all present. `_get_handshake_event`
  (lines 68-83) still creates a row on demand via
  `sequence_number = list(PhaseType).index(handshake_type)` if none exists for `(trip_id,
  phase_type)` — this is the exact fixed-index, one-row-per-type assumption Stage 2 exists to
  remove, and it will silently misbehave the moment a cross-dock trip's plan already has two
  `loading` rows sitting there `pending` (the lookup has no way to pick between them).
- `app/orchestration/trip_service.py` (365 lines) — `create_trip` still writes one hand-built
  `PhaseEvent(phase_type=TRIP_CREATION, sequence_number=0)` (current lines 248-256) and never calls
  `phase_plan.build_phase_plan`. **Genuine gap found, not previously recorded:** the code comment at
  lines 178-182 already flags it — `Consignment.pickup_stop_id`/`delivery_stop_id` are **never
  set** anywhere in the creation path (confirmed: `grep` across
  `app/orchestration/consignment_service.py` finds neither field). `phase_plan.build_phase_plan`
  cannot derive `PlanStop.picks_up`/`drops_off` without them. Task 2.1 must wire this or the plan
  generator has nothing to read.
- `app/orchestration/phase_plan.py` (96 lines, Stage 1) — `build_phase_plan()` and
  `ANCHORED_PHASES` already exist and are unit-tested (`tests/unit/test_phase_plan.py`, 6 tests,
  all green). Nothing here needs changing; task 2.1 only needs to **call** it.
- `app/orchestration/resource_service.py` — `get_trip_detail` (lines 130-241) already queries
  `PhaseEvent` ordered by `sequence_number` (lines 162-167) and already unions `PHASE_EVENT`-subject
  receipts (lines 174-197, an unrelated earlier fix). No change needed for this stage — Stage 3.2
  owns renaming its `handshakes=` kwarg to `.phases`.
- `app/orchestration/verification_service.py` — imports and calls
  `compute_h2_canonical_payload`/`compute_h5_canonical_payload` directly from
  `handshake_service` (current line 25) and rebuilds their exact dict shape in
  `_reconstruct_handshake_event_payload` (lines 125-161). Task 2.7 changes both call sites in the
  same commit — this is the single place the parent's byte-identity fence bites.
- `app/blockchain/subject_visibility.py` — **already fully on `PHASE_EVENT`** (Stage 1 finished
  this file). No change in this stage.
- `app/api/v1/endpoints/handshakes.py` (130 lines) — imports `advance_h1..h5` by name and calls
  them directly (lines 18-20, 39, 54, 73, 90, 105). Renaming the service functions without touching
  this file breaks `import app.main` outright — Stage 3.1 owns the *route* retirement, but this file
  cannot be left broken in the meantime. See task 2.2c.
- `app/schemas/handshakes.py` — `H1CompleteRequest..H5CompleteRequest` (lines 111-154) carry no
  `idempotency_key` field today. Task 2.4 adds one to each; Stage 3.2 still owns folding the five
  shapes into one.
- `app/core/exceptions.py` — `HandshakeSequenceError` (lines 38-44). Parent §8 names its rename
  (`PhaseSequenceError`) explicitly among backend files in scope.

### Environment

Same as Stage 1: Python is `backend/.venv/bin/python`; never read/print/log `backend/.env`; the test
DB (`TEST_DATABASE_URL`) is `create_all`-built with no Supabase `auth` schema and no RLS — this
stage's tests are service-layer and DB-backed but exercise none of that, so nothing here needs the
refactor Supabase project except the standard app boot.

---

## Decisions taken while writing this plan

These close forks a cold agent would otherwise have to guess at or — worse — resolve differently at
each of the three call sites they touch. They sit **below** parent §1's D1–D9 and Stage 1's S1–S6;
none reopens a locked decision. Ciaran can veto any of them; if none is vetoed, the executing agent
treats them as settled.

### T1 — `complete_phase()` is a shared core, not a single dispatch function; five typed wrappers keep today's per-phase payload shapes until Stage 3.2 folds them

Parent §2.4 says "`advance_phase()` replaces five functions" and lists nine steps — but six of those
nine steps (load, ownership check, hold/closed check, idempotency short-circuit, gate, recompute
position, close-if-done) are **identical across all five phases** today only by virtue of being
copy-pasted five times; the remaining steps (which evidence fields to write, whether to anchor, which
receipt type) are genuinely phase-specific and stay that way until Stage 3.2 explicitly unifies the
request schema. Building one mega-function with a phase-type `if/elif` ladder inside it would leave
the schemas five different shapes calling into a function that pretends they're one — a worse
abstraction than what exists today, and Stage 3.2 would have to partially undo it.

**So:** one shared core, `_gate_and_load()` + `_finish_phase()` (task 2.2a), and five renamed
wrappers — `advance_activation`, `advance_loading`, `advance_departure`, `advance_unloading`,
`advance_confirmation` (task 2.2b) — that each validate their own typed payload, write their own
evidence fields, then call the shared core for everything generic. This *is* "one advance_phase()
replacing five functions" in every sense that matters for defensibility: the gate, the idempotency
check, the position recompute, and the close-if-done logic exist exactly once.

### T2 — every lookup is by `phase_event_id`, never by `(trip_id, phase_type)`

**Why this is forced, not stylistic:** `_get_handshake_event`'s create-on-demand-by-type lookup
(current lines 68-83) and the three same-shape lookups inside `advance_h3/h4/h5`
(`select(PhaseEvent).where(trip_id=, phase_type=LOADING).scalar_one()`) both assume at most one row
per `(trip_id, phase_type)`. A cross-dock trip's plan has `loading` twice and `departure`/`in_transit`
twice — Stage 1's own seeded 11-row trip already exists with exactly that shape (confirmed in Stage
1's Findings ledger, §1.3). Any of these lookups raises `MultipleResultsFound` the instant they run
against it, which is precisely the trip this whole refactor exists to prove works.

**So:** the frozen contract's endpoint shape — `POST /trips/{id}/phases/{phase_event_id}/complete`
(parent §3.2) — becomes true one stage early: every wrapper takes `phase_event_id`, not
`phase_type`. `_get_handshake_event`'s create-on-demand branch is **deleted outright**, not
guarded — task 2.1 makes `create_trip` the *only* place a `PhaseEvent` row is ever inserted (every
row a driver will ever complete already exists, `pending`, the moment the trip is created). **Fence:
no code path outside `create_trip` may call `db.add(PhaseEvent(...))`.**
`get_handshake_detail`/`GET /{handshake_type}` keeps its existing `(trip_id, phase_type)` lookup
unchanged — it is retired whole in Stage 3.1, and "fixing" a route that's about to be deleted is
scope creep, not correctness.

### T3 — the gate treats `EXCEPTION` as resolved, exactly like `COMPLETED`/`OVERRIDDEN`; only `trip.status == EXCEPTION_HOLD` actually blocks

Parent §2.4 step 4 says the gate passes when every lower-sequence phase is "completed or
overridden" — read literally, an `EXCEPTION`-status row would fail the gate and freeze the trip. That
contradicts tested, current behaviour: `test_advance_h3_confirmed_seal_mismatch_creates_exception`
marks the row `EXCEPTION` and the trip **still departs** — H3's mismatch is recorded evidence, not a
hold (only H4's destination mismatch holds, by explicitly setting `trip.status = EXCEPTION_HOLD`).
Reading the gate literally would silently turn every non-blocking exception in the current suite into
a blocking one — a real regression the vocabulary-only fence (Stage 1's S2, still binding here) does
not authorise.

**So:** one predicate, used by both the gate and the position recompute (task 2.3) —

```python
def _is_resolved(status: PhaseStatus) -> bool:
    # A phase blocks the NEXT phase only while PENDING/IN_PROGRESS. EXCEPTION is
    # resolved for gating purposes — it already happened, the trip already moved
    # on, and the anomaly is recorded on the row itself (and, for the mismatches
    # serious enough to actually hold a trip, via trip.status == EXCEPTION_HOLD,
    # checked separately in _gate_and_load — that is the real hold mechanism,
    # not this predicate).
    return status in (PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION, PhaseStatus.OVERRIDDEN)
```

### T4 — seal/count cross-checks anchor to "the nearest preceding `DEPARTURE`", not "the trip's `LOADING` row"

Same MultipleResultsFound problem as T2, one phase-type later, and the reason parent flags this task
🔴 **the highest-risk edit in the refactor**. `advance_h3/h4/h5` (lines ~222-227, ~268-273, ~326-331)
each fetch "the" row of a given `phase_type` for the whole trip. Re-pointing the literal filter from
`LOADING` to `DEPARTURE` (which is all the parent's original wording anticipated, written before the
multi-stop shape was this concrete) does not generalise: a cross-dock trip has two `departure` rows,
and a blind `.scalar_one()` still raises.

**The fix:** fetch the `DEPARTURE` row with the greatest `sequence_number` strictly less than the
current phase's — the departure that opened the leg this phase is closing out.

```python
async def _find_departure_for_leg(
    db: AsyncSession, *, trip_id: uuid.UUID, before_sequence: int,
) -> PhaseEvent:
    """The departure that opened the leg ending at `before_sequence`. Well-defined
    because the plan generator (phase_plan.build_phase_plan) interleaves exactly
    one `in_transit` between any departure and the unloading/confirmation that
    closes its leg (§2.2's generation rule) — there is never a second departure
    to be confused with the right one."""
    result = await db.execute(
        select(PhaseEvent)
        .where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.phase_type == PhaseType.DEPARTURE,
            PhaseEvent.sequence_number < before_sequence,
        )
        .order_by(PhaseEvent.sequence_number.desc())
        .limit(1)
    )
    departure = result.scalar_one_or_none()
    if departure is None:
        raise ResourceNotFoundError("PhaseEvent", "departure")
    return departure
```

### T5 — 🔴 what "moves to departure" is the seal *fields*, not a same-shape comparison; the exit-gate check becomes intra-request, not cross-row

This is the sub-decision inside T4/2.6 that the parent's own wording doesn't resolve, and it deserves
its own callout because getting it wrong either double-checks against nothing or silently deletes
tested behaviour.

**The problem, stated precisely.** Today: `H2CompleteRequest` (loading) carries the *authoritative*
seal (`seal_number`, `seal_photo_artifact_id`, `waybill_photo_artifact_id`) — the seal is *applied* at
loading. `H3CompleteRequest` (origin gate-out) carries only a *re-entry* check
(`guard_verified_seal`, `seal_number_confirmed`) — the exit guard confirms the seal that was already
applied one phase earlier, by fetching H2's row and comparing. Under D7, the seal is applied at
**departure** instead of loading. If departure's own event is both the row that applies the seal
*and* the row a same-`.where(phase_type==DEPARTURE)` lookup would fetch to check against, that lookup
finds itself — a comparison against a value written earlier in the same function call, which is not
what "seal continuity" means and could never actually raise a mismatch of anything.

**Resolution (recommended, not yet executed — flag for veto):** `seal_number`,
`seal_photo_artifact_id`, and `waybill_photo_artifact_id` move from `H2CompleteRequest` to
`H3CompleteRequest`, alongside its existing `guard_verified_seal`/`seal_number_confirmed`. The
mismatch check at departure becomes **intra-request**: if `seal_number_confirmed` is present, compare
it against the `seal_number` submitted in the *same* payload (driver applies and photographs the seal;
the exit guard independently re-enters what they physically see; the server checks the two agree) —
not a fetched prior row. `driver_visual_count` **stays on `H2CompleteRequest` (loading)** — F1
("driver never sees the PP count") is explicitly Stage 3.3, post-Go/No-Go, and out of this stage's
fence. The anchor at departure runs unconditionally regardless of the mismatch outcome (matching
today's H5 precedent: a mismatch is evidence in its own right, not a reason to withhold the anchor).
`advance_unloading` (renamed H4) and `advance_confirmation`'s origin-count read (renamed H5) both then
use T4's `_find_departure_for_leg` to fetch the real prior row — that comparison *is* cross-row, and
correctly so, because unloading/confirmation genuinely happen on a later leg than the departure they
verify against.

**Fence (parent's own, restated): write the failing test first.** A destination seal mismatch on a
multi-stop trip must still raise on the correct leg's departure — task "Tests to write" below names
the exact case (`test_advance_unloading_seal_mismatch_uses_own_legs_departure_not_trip_wide`).

### T6 — `TripStatus` LEGACY values are deleted in this stage; `trip_service.py` and `tasks/parcel_perfect.py` collapse to the coarse set in the same commit

Stage 1's S1 named Stage 2.2 as the deletion owner; deferring again would leave dead-but-still-real
enum members that a future reader could mistake for meaningful. `advance_phase()` gates on the plan
(T3), not `trip.status`, so nothing new may assign `ORIGIN_GATE_IN`/`LOADING`/`ORIGIN_GATE_OUT`/
`IN_TRANSIT`/`DEST_GATE_IN`/`UNLOADING` after this task. `trip.status` becomes exactly `CREATED →
ACTIVE → CLOSED` (+ `CANCELLED`, `EXCEPTION_HOLD`), per parent §2.3.

### T7 — the endpoint file gets a mechanical rename, not a redesign; route behaviour is byte-identical

Renaming the five service functions without updating `api/v1/endpoints/handshakes.py` breaks
`import app.main`. Stage 3.1 owns retiring the routes; Stage 2 cannot leave the app unimportable in
the meantime, and Stage 1 already set the precedent (its own task 1.2e touched this exact file for
identifier-only reasons). **So:** update the five `import`/call-site names
(`advance_h1→advance_activation` etc.) and the payload each route passes now needs a
`phase_event_id` path segment or body field to satisfy T2 — since the *route shape itself* is
Stage 3.1's job and this stage must not pre-empt it, each endpoint resolves the phase event by its
existing `(trip_id, phase_type)` semantics **at the endpoint layer only** (one extra
`select(PhaseEvent.id).where(trip_id=, phase_type=<the type this route has always meant>,
status != COMPLETED).order_by(sequence_number).limit(1)`, i.e. "the next pending row of this type"),
then calls the renamed wrapper with that id. This is a shim that exists in exactly one file, for
exactly one stage, and Stage 3.1 deletes it wholesale when the real `phase_event_id`-addressed routes
land — it is not a compatibility layer inside the orchestration code itself, which never gains a
type-based lookup back (T2's fence holds).

### T8 — canonical payload functions are renamed to match the phase they now describe, not just the keys inside them

`compute_h2_canonical_payload` → `compute_departure_canonical_payload`;
`compute_h5_canonical_payload` → `compute_confirmation_canonical_payload`. Keys:
`"handshake_event_id"` → `"phase_event_id"`; `"handshake_type"` → `"phase_type"`; values
`"loading"`/`"unloading"` → `"departure"`/`"confirmation"` (matching where the seal and the
count-reconciliation evidence actually live post-T5/T4). `BlockchainReceiptType.PICKUP`/`DELIVERY`
**do not rename** — they describe the receipt's business meaning (pickup at origin, delivery at
destination), which D7 keeps fixed regardless of which phase captures the evidence.
`verification_service._reconstruct_handshake_event_payload` is renamed
`_reconstruct_phase_event_payload` and its two branches move from `PhaseType.LOADING`/`CONFIRMATION`
to `PhaseType.DEPARTURE`/`CONFIRMATION` in the **same commit** as the builder change — the parent's
explicit fence (a payload renamed in one and not the other makes `/verify` return `db_mismatch` on a
healthy trip, which the dispatcher renders as *tamper detected*).

---

## Context from the 2026-07-28 industry-partner meeting (Bruce, Load Factor)

Read alongside this plan: `docs/meeting_minutes/FreightProof_Meeting_Bruce_Minutes_28July2026.md`.
Three findings touch the phase model's future shape but **do not change this stage's scope** — they
are recorded here so nobody mistakes their absence from the task list for an oversight.

- **Seals are up to three independent, client-dependent layers** (Pulsit geofence+biometric lock,
  physical container-lock key pair, client-specific numbered seal) — not the single `seal_number`
  field the current model (and this stage's T5) assumes. Widening the schema to multiple seal layers
  is a genuine future migration, and Stage 1's migration is not yet frozen (not landed on `dev`), but
  changing it mid-Stage-2 would blow this stage's own fence (T5 already re-points the *existing*
  single field; redesigning it is a different, larger decision). **Recommendation: raise as its own
  ticket after Go/No-Go**, alongside F1 (Stage 3.3) and F4 (Stage 3.4) — do not fold into this stage.
- **"Container" = manifest**, confirmed a synonym, not a physical unit — no data-model implication,
  informational only.
- **"Tie two trips together"** (a vehicle's inbound arrival on one manifest informing the next
  outbound manifest) and **same-day vehicle/trailer reconciliation** are both `Trip`/`TripTrailer`
  modelling questions orthogonal to the phase ledger — out of scope for this stage, which touches
  neither model.

---

## Tasks

Seven tasks, two of them (2.1, 2.2) with lettered sub-parts. Each states **Where** and a **Fence**.

---

### 2.1 — Plan generation at trip creation

**Where:** `backend/app/orchestration/trip_service.py` (`create_trip`); reads (no changes needed)
`backend/app/orchestration/phase_plan.py`.
**Fence:** don't change lock-hash semantics beyond covering the phase plan (FP-113 stays deferred;
no real multi-stop trip should be anchored ahead of that landing, unchanged from the parent's own
note). Don't touch `compute_journey_lock_hash`/`compute_trip_canonical_payload` signatures.

**2.1a — stamp `pickup_stop_id`/`delivery_stop_id` on synced consignments.** Immediately after the
consignment-sync loop (current lines 211-246, after `consignment_results` is populated) and before
the old H0-creation block:

```python
trip_stops.sort(key=lambda s: s.sequence)  # already true by this point (line 199 above)
for result in consignment_results:
    result.consignment.pickup_stop_id = trip_stops[0].id
    result.consignment.delivery_stop_id = trip_stops[-1].id
```

**Known limitation, recorded not fixed here:** `TripConsignmentInput` (the live `POST /trips` request
shape, `schemas/trips.py`) carries only `pp_reference`/`unit_count_expected` — no per-consignment stop
reference. Every consignment created through the live API therefore runs stop-0 → stop-last, even on
an explicit multi-stop `TripCreateRequest`. This is the schema gap the existing `trip_service.py`
comment (lines 178-182) already flags; it is not this task's fence to close. The seeded 11-row
cross-dock trip (Stage 1, `scripts/seed_trips.py`) sets both fields directly and is unaffected —
that is what Stage 2's "Done when" multi-stop walk exercises. Extending `TripConsignmentInput` with a
real per-consignment stop reference is a follow-on ticket, out of scope here.

**2.1b — build the plan and insert the rows.** Replace the current "6. Create the H0 HandshakeEvent"
block (lines 248-256) with:

```python
from app.orchestration.phase_plan import ANCHORED_PHASES, PlanStop, build_phase_plan

stop_id_by_sequence = {s.sequence: s.id for s in trip_stops}
plan_stops = [
    PlanStop(
        sequence=stop.sequence,
        picks_up=any(r.consignment.pickup_stop_id == stop.id for r in consignment_results),
        drops_off=any(r.consignment.delivery_stop_id == stop.id for r in consignment_results),
    )
    for stop in trip_stops
]
planned = build_phase_plan(plan_stops)

phase_events: list[PhaseEvent] = []
for row in planned:
    stop_id = stop_id_by_sequence[row.stop_sequence] if row.stop_sequence is not None else None
    phase_events.append(PhaseEvent(
        trip_id=trip_id,
        phase_type=row.phase_type,
        sequence_number=row.sequence_number,
        trip_stop_id=stop_id,
        status=PhaseStatus.PENDING,
        anchor_status=(
            AnchorStatus.PENDING if row.phase_type in ANCHORED_PHASES else AnchorStatus.NOT_REQUIRED
        ),
    ))
for event in phase_events:
    db.add(event)
await db.flush()

h0 = phase_events[0]  # trip_creation is always sequence 0 — build_phase_plan guarantees this (§2.2)
```

**An `EMPTY_LEG` trip has zero consignments**, so every `PlanStop.picks_up`/`drops_off` is `False`.
Already handled and unit-tested by `build_phase_plan` (`test_empty_leg_plan_still_closes_custody`,
Stage 1): the final stop still emits `unloading` (the "final stop always closes the custody chain"
rule in `phase_plan.py`'s own docstring) so the ledger never ends on an open leg. No new code needed
for this case — it falls out of the existing generator.

**2.1c — P0 stays inline-completed, sourced from the plan instead of a hand-built literal.** The
remainder of `create_trip` (lock-hash computation, the fail-closed `anchor_subject` call, the
response assembly) is unchanged except that it operates on `h0` from 2.1b instead of a fresh
`PhaseEvent(...)` literal — same fields (`status=COMPLETED`, `completed_at`, `event_hash`,
`blockchain_receipt_id`), same fail-closed semantics (D7, untouched).

---

### 2.2 — The engine: shared core + five renamed wrappers

**Where:** `backend/app/orchestration/handshake_service.py` → renamed
`backend/app/orchestration/phase_service.py`; `backend/app/core/exceptions.py`;
`backend/app/api/v1/endpoints/handshakes.py`; `backend/app/orchestration/trip_service.py` (active
statuses); `backend/app/tasks/parcel_perfect.py` (active statuses); `backend/app/db/models/enums.py`
(`TripStatus`).
**Fence:** evidence-writing bodies (which fields each phase sets) do not change except where T5
explicitly moves seal fields from loading to departure. No new `PhaseEvent` insert anywhere in this
file (T2).

**2.2a — core helpers** (new, in `phase_service.py`):

```python
async def _load_trip_for_driver(db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID) -> Trip:
    result = await db.execute(select(Trip).where(Trip.id == trip_id, Trip.driver_id == driver_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return trip


async def _load_phase_event(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID,
) -> PhaseEvent:
    result = await db.execute(
        select(PhaseEvent).where(PhaseEvent.id == phase_event_id, PhaseEvent.trip_id == trip_id)
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise ResourceNotFoundError("PhaseEvent", str(phase_event_id))
    return event


def _is_resolved(status: PhaseStatus) -> bool:  # T3
    return status in (PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION, PhaseStatus.OVERRIDDEN)


async def _gate_and_load(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    phase_label: str,
) -> tuple[Trip, PhaseEvent] | TripDetailResponse:
    """Steps 1-4 of parent §2.4. Returns (trip, event) to continue, or a
    TripDetailResponse if idempotent replay already short-circuited."""
    trip = await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)

    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED, TripStatus.EXCEPTION_HOLD):
        raise PhaseSequenceError(trip.status, phase_label)

    if event.status == PhaseStatus.COMPLETED:
        # Idempotent replay (task 2.4) — return current state, never a duplicate.
        return await get_trip_detail(
            db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id,
        )

    lower_result = await db.execute(
        select(PhaseEvent.status).where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.sequence_number < event.sequence_number,
        )
    )
    if any(not _is_resolved(PhaseStatus(status)) for (status,) in lower_result.all()):
        raise PhaseSequenceError(trip.status, phase_label)

    return trip, event


async def _recompute_position(db: AsyncSession, trip: Trip) -> None:
    """Steps 8-9 of parent §2.4. Trip_stop_id is a FK, not the sequence int
    D6 wants cached — the join to TripStop.sequence is why this can't be a
    plain PhaseEvent-only query."""
    result = await db.execute(
        select(PhaseEvent.phase_type, PhaseEvent.status, TripStop.sequence)
        .outerjoin(TripStop, TripStop.id == PhaseEvent.trip_stop_id)
        .where(PhaseEvent.trip_id == trip.id)
        .order_by(PhaseEvent.sequence_number)
    )
    for phase_type, status, stop_sequence in result.all():
        if not _is_resolved(PhaseStatus(status)):
            trip.current_phase = phase_type
            trip.current_stop = stop_sequence
            return
    trip.current_phase = None
    trip.current_stop = None
    trip.status = TripStatus.CLOSED
    trip.closed_at = datetime.now(UTC)


async def _finish_phase(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent, idempotency_key: str,
) -> TripDetailResponse:
    event.idempotency_key = idempotency_key
    event.completed_at = event.completed_at or datetime.now(UTC)
    await _recompute_position(db, trip)
    await db.flush()
    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)
```

`_finish_phase` is called **after** each wrapper sets `event.status` (`COMPLETED` or `EXCEPTION`, per
its own evidence-checking logic, unchanged from today) and handles any anchor. It does not set
`event.status` itself — that decision is phase-specific and stays in the wrapper, exactly as it is
today for H3/H4/H5's mismatch branches.

**2.2b — five renamed wrappers.** Rename table (matches Stage 1's S2 phase-type mapping, extended to
function names now that behaviour is changing and the vocabulary swap is no longer identifier-only):

| Old | New | Behaviour change this task makes |
|---|---|---|
| `advance_h1` | `advance_activation` | Gate/idempotency/recompute now via 2.2a; evidence unchanged |
| `advance_h2` | `advance_loading` | Loses `seal_number`/`seal_photo_artifact_id`/`waybill_photo_artifact_id` (T5, task 2.6); keeps `driver_visual_count`; loses its own fail-closed anchor (moves to departure, D7) |
| `advance_h3` | `advance_departure` | Gains the three seal fields (T5); anchors fail-open (task 2.5, `PICKUP` receipt type unchanged) |
| `advance_h4` | `advance_unloading` | Seal comparison re-points to `_find_departure_for_leg` (T4) instead of the trip-wide `LOADING` fetch |
| `advance_h5` | `advance_confirmation` | Origin-count baseline is **unaffected** — `driver_visual_count` stays on `advance_loading` (T5), so this keeps reading the trip's `LOADING` row exactly as today; only *seal* continuity moves phase (T4/T5), not the count. Anchors fail-open (task 2.5, `DELIVERY` receipt type unchanged) |

Each wrapper's shape: validate its typed payload (unchanged schema, except `advance_departure`/
`advance_loading` per T5 and the new `idempotency_key` field on all five, task 2.4) → call
`_gate_and_load` → if it returned a `TripDetailResponse`, return it immediately (idempotent replay) →
otherwise write phase-specific evidence exactly as the current `advance_h*` body does → anchor if D7
says so (task 2.5) → set `event.status` → call `_finish_phase`.

**`_get_handshake_event` and `_load_trip_for_handshake` are deleted outright** (T2) — every
`PhaseEvent` row already exists by the time any wrapper runs (task 2.1), so create-on-demand is dead
code that would only ever paper over a task-2.1 bug.

**2.2c — endpoint file mechanical rewire** (T7). In
`backend/app/api/v1/endpoints/handshakes.py`: update the five imports/calls to the renamed wrapper
names; before each call, resolve `phase_event_id` with the stage-scoped shim:

```python
async def _next_pending(db: AsyncSession, *, trip_id: UUID, phase_type: PhaseType) -> UUID:
    result = await db.execute(
        select(PhaseEvent.id)
        .where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.phase_type == phase_type,
            PhaseEvent.status != PhaseStatus.COMPLETED,
        )
        .order_by(PhaseEvent.sequence_number)
        .limit(1)
    )
    phase_event_id = result.scalar_one_or_none()
    if phase_event_id is None:
        raise ResourceNotFoundError("PhaseEvent", phase_type.value)
    return phase_event_id
```

This shim lives in this one file, exists for this one stage, and is deleted wholesale in Stage 3.1
when the real `phase_event_id`-addressed routes land — no orchestration code gains a type-based
lookup back. `get_handshake_detail`'s route is untouched (retires whole in Stage 3.1).

**2.2d — `TripStatus` LEGACY deletion** (T6). In `db/models/enums.py`: delete `ORIGIN_GATE_IN`,
`LOADING`, `ORIGIN_GATE_OUT`, `IN_TRANSIT`, `DEST_GATE_IN`, `UNLOADING` from `TripStatus`, and its
docstring's "Stage 2 replaces them" note (it's happening now). In `trip_service.py`'s
`_check_order_number_conflict` (current lines 84-93): collapse `active_statuses` to
`[TripStatus.CREATED, TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD]`. In
`tasks/parcel_perfect.py`'s `_ACTIVE_STATUSES` (current lines 28-38): same collapse, keeping its
existing exclusion comment (`CLOSED`/`CANCELLED`/`EXCEPTION_HOLD` excluded) accurate.
`create_trip` already sets `trip.status = TripStatus.CREATED`, unaffected. `_finish_phase`/
`_recompute_position` set `TripStatus.ACTIVE` the first time a trip moves off `CREATED` — add this:
`create_trip` still leaves `trip.status = CREATED` after P0 (P0 is inline-completed but the *trip*
hasn't started moving yet); the first successful `advance_activation` (P1) call sets
`trip.status = TripStatus.ACTIVE` before calling `_finish_phase`.

---

### 2.3 — `next-phase` + `current_phase`/`current_stop` maintenance

Implemented as `_recompute_position` in task 2.2a — no separate work item. **Verification-relevant
detail:** "next phase" (parent §2.3, "current phase = next phase, this is why one query answers
both") is the same lowest-unresolved-sequence row `_recompute_position` finds; Stage 3.1's
`GET /trips/{id}/next-phase` endpoint will call the equivalent read-only query. No endpoint exists in
this stage to expose it — that's explicitly Stage 3's job — but the service-layer tests (below) assert
`trip.current_phase`/`current_stop` directly after each completion, which is the same derivation.

---

### 2.4 — Idempotent completion

**Where:** `backend/app/schemas/handshakes.py` (five `*CompleteRequest` classes);
`backend/app/orchestration/phase_service.py` (`_finish_phase`, already shown in 2.2a).
**Fence:** idempotency by key only — do not loosen the sequence gate (T3's predicate is unaffected by
this task).

Add one field to each of `H1CompleteRequest..H5CompleteRequest`:

```python
idempotency_key: str = Field(..., min_length=1)
```

This is the driver app's offline-queue entry id. `_finish_phase` (2.2a) stores it on the row
unconditionally; Stage 1's partial unique index (`uq_phase_events_idempotency_key`) rejects a
genuinely mistargeted replay (the same queue-entry id landing on two different rows) with an
`IntegrityError` the endpoint layer maps to 409 in Stage 3 — replaying the *same* completion is caught
earlier, by `_gate_and_load`'s `event.status == COMPLETED` check, which returns 200 without touching
the key at all. Two distinct mechanisms for two distinct failure modes: replay (idempotent, 200) vs.
mistargeting (constraint violation, a bug in the client, not silently swallowed).

---

### 2.5 — Fail-open anchors at departure and confirmation

**Where:** `phase_service.py`, `advance_departure` and `advance_confirmation` only.
**Fence:** P0 (`create_trip`) is untouched — stays fail-closed, uncaught propagation, whole-trip
rollback. Do not wrap `create_trip`'s `anchor_subject` call.

```python
async def _anchor_or_fail_open(
    db: AsyncSession, *, event: PhaseEvent, subject_id: uuid.UUID,
    canonical_payload: dict, receipt_type: BlockchainReceiptType, trip_id: uuid.UUID,
) -> None:
    try:
        receipt = await anchor_subject(
            db, subject_type=SubjectType.PHASE_EVENT, subject_id=subject_id,
            canonical_payload=canonical_payload, receipt_type=receipt_type, trip_id=trip_id,
        )
    except (HederaTimeoutError, HederaServiceError):
        logger.error(
            "Anchor failed for phase_event_id=%s (fail-open, D7): retry owed", event.id,
        )
        event.anchor_status = AnchorStatus.FAILED
        return
    event.blockchain_receipt_id = receipt.id
    event.anchor_status = AnchorStatus.ANCHORED
```

Used by `advance_departure` (`PICKUP`) and `advance_confirmation` (`DELIVERY`) in place of today's
uncaught `anchor_subject` call. The 504/502 Hedera exception handlers on the corresponding endpoint
routes (`handshakes.py` lines 59-62, 110-113) are **deleted as part of this task, not left for Stage
3.1** — `HederaTimeoutError`/`HederaServiceError` no longer escape `advance_departure`/
`advance_confirmation`, so a `try/except` around a call that can no longer raise those types is dead
code the moment this task lands, and leaving it in would silently misrepresent the endpoint's actual
behaviour to the next reader.

---

### 2.6 — 🔴 Re-point seal continuity from loading to departure

**Where:** `phase_service.py` (`advance_loading`, `advance_departure`, `advance_unloading`);
`schemas/handshakes.py` (`H2CompleteRequest`, `H3CompleteRequest`).
**Fence: write the failing test first** (parent's own words, restated because this is the highest-risk
task in the stage). Do not merge without a failing-then-passing seal-mismatch test on a multi-stop
trip specifically, not just the single-leg case the existing suite covers.

Implements T5 and T4 (`_find_departure_for_leg`, already specified above). Concretely:

- `H2CompleteRequest` loses `waybill_photo_artifact_id`, `seal_number`, `seal_photo_artifact_id`
  (and the `validate_seal_number` field validator moves with them); keeps `driver_visual_count`.
- `H3CompleteRequest` gains `waybill_photo_artifact_id: UUID`, `seal_number: str` (with the moved
  `validate_seal_number` validator), `seal_photo_artifact_id: UUID`; keeps its existing
  `guard_verified_seal: bool` and `seal_number_confirmed: str | None`.
- `advance_loading` no longer writes any seal field or computes/anchors any payload (D7: loading is
  no longer anchored — the `PICKUP` anchor moves whole to departure).
- `advance_departure` writes `seal_number`/`seal_photo_artifact_id`/`waybill_photo_artifact_id` onto
  its own event; the mismatch check (if `seal_number_confirmed` is present) compares it against the
  *same request's* `seal_number` via `_normalized_seal` — not a fetched row. On mismatch: `EXCEPTION`
  status, `TripException` recorded (unchanged shape/severity from today's H3), trip still proceeds
  (T3 covers why this doesn't block). The `PICKUP` anchor (2.5) runs regardless of mismatch outcome.
- `advance_unloading` fetches its comparison row via
  `_find_departure_for_leg(db, trip_id=trip_id, before_sequence=event.sequence_number)` instead of
  `phase_type == LOADING`; compares `payload.seal_number_at_destination` against that departure's
  `seal_number`; unchanged mismatch/hold semantics (`EXCEPTION` + `trip.status = EXCEPTION_HOLD`).
- `advance_confirmation`'s origin-count baseline (`origin_count = <row>.driver_visual_count`) is
  **unaffected** — `driver_visual_count` never moved (T5), so this keeps reading the trip's `LOADING`
  row exactly as today. Only the seal, not the count, changes phase.

---

### 2.7 — Canonical payload re-pointing

**Where:** `phase_service.py` (renamed payload builders); `verification_service.py`.
**Fence:** builder and rebuilder change in the same commit (parent's byte-identity fence). No
backward-compatibility path — Stage 1 confirmed zero existing receipts anchored over the old shape.

- `compute_h2_canonical_payload` → `compute_departure_canonical_payload`; called from
  `advance_departure` now, not `advance_loading`. Key `"handshake_event_id"` → `"phase_event_id"`;
  `"handshake_type": "loading"` → `"phase_type": "departure"`.
- `compute_h5_canonical_payload` → `compute_confirmation_canonical_payload`; same key renames;
  `"handshake_type": "unloading"` → `"phase_type": "confirmation"`.
- `verification_service._reconstruct_handshake_event_payload` → `_reconstruct_phase_event_payload`;
  its two branches move from `PhaseType.LOADING`/`PhaseType.CONFIRMATION` to
  `PhaseType.DEPARTURE`/`PhaseType.CONFIRMATION`, calling the renamed builders with the renamed keys.
  Its null-guard (currently checking `seal_number`/`driver_visual_count` before hashing) keeps the
  same shape, reading from the departure row instead of loading for the seal half.
- `BlockchainReceiptType.PICKUP`/`DELIVERY` are unchanged (T8) — only the payload's *internal* keys
  and the *function names* change.

---

## Tests to write

All in `backend/tests/unit/` unless noted; DB-backed via `db_session`/`trip_fixture`, same pattern as
the existing (renamed) suite. File rename: `test_handshake_service.py` → `test_phase_service.py`;
`test_handshake_anchor_payload.py` → `test_phase_anchor_payload.py`.

- **`test_phase_service.py`** (renamed, existing 13 tests updated for the new function names and
  T5's field moves; the following are *new*):
  - `test_create_trip_writes_full_pending_plan` — a single-leg `create_trip` call yields 7
    `PhaseEvent` rows, all `pending` except `trip_creation` (`completed`), in `sequence_number` order.
  - `test_advance_activation_out_of_order_raises_sequence_error_reads_the_plan` — attempting
    `advance_confirmation` before `advance_activation` on a freshly created trip raises
    `PhaseSequenceError`, proving the gate reads `PhaseEvent.sequence_number`, not `trip.status`
    (parent §2.4's central claim, now provable).
  - `test_replayed_completion_is_idempotent_returns_200_no_duplicate` — completing the same
    `phase_event_id` twice with the same `idempotency_key` returns the same `TripDetailResponse` and
    the row is not re-anchored (assert `anchor_subject` called exactly once via a spy/mock).
  - `test_exception_status_phase_does_not_block_next_phase` — renamed/kept from today's
    `test_advance_h3_confirmed_seal_mismatch_creates_exception`; asserts the *following* phase
    (`in_transit`/`unloading`) still completes successfully afterward (proves T3's predicate).
  - `test_exception_hold_status_blocks_further_advancement` — renamed from today's H4-mismatch test;
    asserts a subsequent `advance_confirmation` call raises `PhaseSequenceError` while
    `trip.status == EXCEPTION_HOLD`.
  - `test_current_phase_and_current_stop_track_the_ledger` — after each of a single-leg trip's
    completions, assert `trip.current_phase`/`trip.current_stop` match the next unresolved row.
  - `test_trip_closes_when_no_phases_remain` — completing the final (`confirmation`) phase sets
    `trip.status = CLOSED`, `closed_at` set, `current_phase`/`current_stop` both `None`.
  - `test_advance_unloading_seal_mismatch_uses_own_legs_departure_not_trip_wide` — **the T5/T4 proof
    test.** Build a cross-dock (11-row) trip fixture; complete the first leg's departure with seal
    `AB-1111`; complete the second leg's departure with seal `AB-2222`; call `advance_unloading` on
    the *first* leg's unloading event with a destination seal that matches `AB-1111` but not
    `AB-2222` — assert no mismatch is raised (proves the lookup used the correct leg's departure, not
    "the trip's departure" or a `MultipleResultsFound` crash).
  - `test_departure_anchors_fail_open_on_hedera_timeout` — mock `anchor_subject` to raise
    `HederaTimeoutError`; assert `advance_departure` still completes the phase,
    `anchor_status == FAILED`, no exception propagates to the caller.
  - `test_create_trip_anchor_failure_still_rolls_back_whole_trip` — mock `anchor_subject` (P0 only)
    to raise; assert the exception propagates and no `Trip`/`PhaseEvent` rows persist (proves P0
    stayed fail-closed while P3/P6 went fail-open — the two must visibly differ).
- **`test_phase_anchor_payload.py`** (renamed): update the two payload-shape tests
  (`test_h2_canonical_payload_excludes_...` → `test_departure_canonical_payload_excludes_...`, same
  for confirmation) for the renamed keys; update the two `verify_subject`-reconstruction tests for the
  renamed branches.
- **`tests/integration/test_create_trip_multistop.py`**: add
  `test_multi_stop_create_stamps_consignment_stop_ids` and
  `test_multi_stop_create_writes_full_phase_plan` (asserting row count and phase-type sequence match
  `build_phase_plan`'s output for the given stops) — **mock `anchor_subject`** in both, per the
  Prerequisites note on F3/DE2.
- **`tests/unit/test_schema_validators.py`**: move/rename the seal-format validator test from
  `H2CompleteRequest` to `H3CompleteRequest` coverage (or confirm existing coverage already targets
  the validator function directly, in which case no change is needed — check before duplicating).

---

## Out of scope

Named explicitly so a cold agent doesn't drift into adjacent, larger work:

- **Endpoints, schemas-folding, reconciliation, fatter anchors** — Stage 3 (3.1–3.4) entirely. This
  stage's task 2.2c shim exists only to keep the app importable; it is not Stage 3's work done early.
- **Dispatcher/driver-pwa changes** — Stages 4/5. Nothing in `frontend/` changes in this stage.
- **`TripConsignmentInput` gaining a per-consignment stop reference** — a real gap (2.1a), not this
  stage's fence. Flagged as a follow-on ticket.
- **F1 (server-side reconciliation, driver never sees the PP count)** — Stage 3.3, explicitly
  post-Go/No-Go. `driver_visual_count` stays on `advance_loading` in this stage (T5).
- **F4 (fatter anchor payloads — GPS, artifact hashes folded in)** — Stage 3.4, post-Go/No-Go.
- **Multi-seal-layer modelling** (Pulsit geofence lock, physical container-lock key pair, client
  seal) raised in the 2026-07-28 meeting — a future schema decision, not this stage's.
- **Immutability RLS guards on `trips`/`phase_events`** — flagged again in Stage 1's ledger, still not
  this stage's job (no RLS surface here at all).
- **`get_handshake_detail`'s multi-row ambiguity** — real, but the route retires whole in Stage 3.1;
  not worth fixing a function about to be deleted.
- **`main`/`dev` divergence, promotion, `pg_dump`** — parent §0.2/§5.6, unrelated to the engine.

---

## Verification

The standard gate, run locally before CI:

```
cd backend            && ruff check . && mypy . && pytest
cd frontend/dispatcher && npx tsc --noEmit && npm run lint
cd frontend/driver-pwa && npm run type-check && npm run lint && npm test
```

Plus, specific to this stage (parent §7 Stage 2's verification, restated with this stage's exact
mechanisms):

- **A pytest walk drives a single-leg trip P0→P6 through the service layer** — `create_trip` then
  `advance_activation → advance_loading → advance_departure → advance_unloading →
  advance_confirmation` in sequence, asserting `TripDetailResponse` at each step and
  `trip.status == CLOSED` at the end.
- **`next-phase`/`current_phase` correct at each step** — `test_current_phase_and_current_stop_track_the_ledger`.
- **Duplicate completion returns 200, does not re-anchor** —
  `test_replayed_completion_is_idempotent_returns_200_no_duplicate`.
- **A P5 (`advance_unloading`) seal mismatch still raises, on the correct leg** —
  `test_advance_unloading_seal_mismatch_uses_own_legs_departure_not_trip_wide` passing is the bar, not
  just "some" mismatch test passing.
- **A simulated Hedera failure completes the phase with `anchor_status='failed'`** —
  `test_departure_anchors_fail_open_on_hedera_timeout`.
- **P0 still fail-closed** — `test_create_trip_anchor_failure_still_rolls_back_whole_trip`.
- **`/verify` returns `verified` for a freshly anchored phase** — extend
  `test_verify_subject_after_h2_reconstructs_matching_payload` (renamed) to assert `VerifyStatus.VERIFIED`
  end-to-end through `verify_subject`, not just payload-shape equality.
- **An 11-row multi-stop plan walks end to end through the service layer** — drive the Stage-1-seeded
  cross-dock trip (or an equivalent fixture built the same way) through all 11 phases; assert no
  `MultipleResultsFound`, correct per-leg seal continuity, and final `trip.status == CLOSED`.
- **`import app.main` still succeeds** — the cheap check, same as Stage 1's task 1.2:
  ```
  cd backend && .venv/bin/python -c "import app.main" && echo IMPORTS-OK
  ```
- **Skip count still at or below the Stage-0.1 floor; whole-suite failure count does not exceed
  Stage 1's exit number (8)** unless a failure is newly and deliberately recorded here with the same
  rigor as Stage 1's Findings ledger.

---

## Done when

An 11-row multi-stop plan — generated at trip creation, not hand-seeded around it — walks P0 through
its final phase via `complete_phase`'s shared core, closing the trip, with per-leg seal continuity
correct and no phase-type lookup anywhere capable of raising `MultipleResultsFound`; and a single-leg
trip walks P0→P6 the same way with `anchor_status` correctly distinguishing a fail-closed P0 from a
fail-open P3/P6.

---

## Findings ledger

Filled in after execution, same discipline as Stage 1's ledger. Executed by subagents under
subagent-driven-development, each task independently spec-reviewed and code-quality-reviewed
(several through 2-3 fix/re-review rounds), plus a final whole-stage review across the complete
diff before this ledger was written.

### 2.x — Suite numbers after Stage 2

| Metric | Before (Stage 1 exit) | After |
|---|---|---|
| Whole suite passed | 319 | **339** |
| Whole suite failed | 8 | **7** |
| Whole suite skipped | 0 | **0** |
| `tests/unit` passed | 185 | **201** |

`ruff check .` → *All checks passed!* · `mypy .` → *Success: no issues found in 159 source files* ·
`python -c "import app.main"` → `IMPORTS-OK`.

**7 of the original 8 known-red failures remain, unchanged in cause** (`test_verify_returns_no_receipt_for_unknown_subject`,
`test_create_driver_returns_201_with_pending_status`, `test_create_driver_appears_in_subsequent_list`,
`test_create_driver_does_not_anchor_pii`, `test_create_trip_response_shape` — F3/DE2, unmocked Hedera —
`test_mixed_patch_anchors_only_critical_field`, `test_update_vehicle_invalid_vin_leaves_db_state_unchanged`).
**The 8th, `test_h2_complete_hedera_timeout_returns_504_and_trip_unchanged`, is gone — legitimately, not
hidden.** Its entire premise (loading anchors to Hedera and fails closed with a 504) stopped being true
once task 2.6 moved the anchor to departure; it was removed and replaced with equivalent new coverage
at the new call site (`test_h3_complete_anchors_and_returns_event_hash`,
`test_h3_complete_hedera_failure_still_returns_200_fail_open`). Verified independently during task 2.6's
spec-compliance review — the test doesn't exist anywhere else under a new name; it isn't skipped, it's
correctly retired.

### Decisions T1–T8 — outcome

All eight executed as written; none vetoed or amended by Ciaran.

- **T1** — shared core (`_gate_and_load`/`_finish_phase`/`_recompute_position`) + five renamed wrappers,
  no mega-function. As specified.
- **T2** — every lookup by `phase_event_id`; `_get_handshake_event`/`_load_trip_for_handshake` deleted
  outright; no `PhaseEvent` insert anywhere outside `create_trip`. As specified.
- **T3** — `_is_resolved()` predicate implemented byte-for-byte as given. As specified.
- **T4** — `_find_departure_for_leg` implemented byte-for-byte as given, used by `advance_unloading`.
  As specified.
- **T5** — seal fields moved `H2CompleteRequest`→`H3CompleteRequest`; intra-request mismatch comparison
  (no fetched prior row) in `advance_departure`; `driver_visual_count` stays on loading, unanchored, as
  specified. **One consequence the plan's own T5/T8 text didn't spell out, resolved during task 2.6 and
  confirmed sound in review:** `compute_h2_canonical_payload`'s signature had to drop
  `driver_visual_count` entirely — `advance_departure` has no access to that value once it's decoupled
  onto a different `PhaseEvent` row, and folding a cross-row read into the anchor would blur what's
  actually being committed (the seal, not the count). Resolved in task 2.6, not deferred to 2.7 (which
  only renamed the function/keys, not the parameter list).
- **T6** — `TripStatus` LEGACY values deleted; both active-status lists collapsed (their pre-existing
  `EXCEPTION_HOLD` asymmetry preserved intentionally, confirmed in review); `HandshakeSequenceError` →
  `PhaseSequenceError`. As specified.
- **T7** — endpoint file mechanically rewired with the `_next_pending` shim; `GET /{handshake_type}`
  untouched per its own carve-out. As specified.
- **T8** — `compute_h2_canonical_payload`/`compute_h5_canonical_payload` → `compute_departure_canonical_payload`/
  `compute_confirmation_canonical_payload`; keys renamed; the pre-existing `"handshake_type": "unloading"`
  mislabel on the confirmation payload corrected to `"phase_type": "confirmation"` (H5 always mapped to
  confirmation, never unloading — this was wrong from day one, not just renamed).
  `BlockchainReceiptType.PICKUP`/`DELIVERY` confirmed unchanged. As specified.

### Defects found in this plan's own literal code (fixed during execution)

Each caught by actually running a gate or by a reviewer's independent verification, not by reading.

- **NEW-8 — P4 (`in_transit`) has a real ledger row (D2, Stage 1) but no task in this stage's list ever
  completes it.** Found while implementing task 2.2: `create_trip` generates an `in_transit` row on
  every leg, but none of the five `advance_*` wrappers touch it, and `_gate_and_load`'s sequence gate
  means a real trip could never reach `advance_unloading`/`advance_confirmation` — the trip permanently
  stalls at departure. Corroborated against the parent plan's own D2 ("points at checkpoint Merkle
  batches") and confirmed `app/orchestration/checkpoint_service.py` has zero `PhaseEvent` wiring — the
  real completion mechanism doesn't exist yet in this codebase, and isn't clearly scheduled in Stages
  3–5 either. **Escalated to Ciaran; authorized stopgap:** `advance_departure` auto-completes the
  immediately-following `in_transit` row for its own leg (`_auto_complete_in_transit`), on the reasoning
  that departure and being-in-transit are the same instant until real telemetry/checkpoint-based
  completion lands as its own later ticket. Explicitly flagged in code as a stopgap, not a permanent
  design — see its docstring in `phase_service.py`.
- **NEW-9 — `advance_confirmation`'s origin-count baseline still does a trip-wide
  `(trip_id, phase_type=LOADING)` `.scalar_one()` lookup.** T5's own text locks this as unaffected/
  unchanged ("`driver_visual_count` never moves... this keeps reading the trip's `LOADING` row exactly
  as today"), so it was correctly left alone by task 2.6's own fence — but on any trip with 2+ `LOADING`
  rows (any real cross-dock pickup pattern), this raises `MultipleResultsFound` the instant
  `advance_confirmation` runs. Found and independently reproduced during task 2.6's final code-quality
  review. **Escalated to Ciaran; explicitly deferred, not fixed, in this stage.** Direct consequence:
  the stage's own "Done when" (below) is not fully met — the 11-row multi-stop plan walks correctly
  through `advance_unloading` (proving per-leg seal continuity, T4/T5's actual point) but cannot reach
  `advance_confirmation`/`CLOSED` on a trip with more than one `LOADING` row. **Must be resolved before
  Stage 3/4 relies on a real cross-dock trip reaching `CLOSED` end-to-end** — flagged below under
  "Carried into Stage 3."
- **NEW-10 — 🔴 Critical: no trip created through the real API could ever be advanced past creation.**
  Found in the final whole-stage review, after all seven tasks individually passed spec + quality
  review. `create_trip`'s phase-plan generator (task 2.1) writes `h0` (trip_creation) as `PENDING`,
  matching every other row — but nothing in `create_trip` ever promotes it to `COMPLETED`, even though
  the plan's own task 2.1c explicitly says it should ("P0 stays inline-completed... same fields
  (`status=COMPLETED`, `completed_at`, `event_hash`, `blockchain_receipt_id`)"). Task 2.2's new
  sequence-based gate (`_gate_and_load`) blocks every phase until all lower-`sequence_number` rows
  resolve — and `h0` is sequence 0, the lowest possible, so an unresolved `h0` permanently blocks
  everything after it. **This is precisely the seam piecemeal per-task review cannot see**: task 2.1's
  own tests only checked the plan's shape, not downstream gating; every fixture in tasks 2.2–2.7 hand-
  seeded `h0` as already `COMPLETED` (one fixture docstring even claimed, falsely, to mirror
  `create_trip`'s real output), so no test anywhere chained a real `create_trip` call into a real
  `advance_*` call. Proven empirically (a real `POST /trips` followed by a real `POST .../h1/complete`
  returned 409) before being fixed. **Fixed**, matching the plan's own stated intent exactly: `create_trip`
  now sets `h0.status = COMPLETED`, `completed_at`, `blockchain_receipt_id`, `event_hash`
  (`compute_payload_hash` over the same canonical payload already anchored), and `anchor_status =
  ANCHORED`, immediately after its (fail-closed) anchor succeeds. A real end-to-end regression test
  (`test_create_trip_output_is_immediately_advanceable`) now chains `create_trip` into `advance_activation`
  and would fail without the fix. Two stale fixture docstrings and one stale comment
  (`resource_service.py`, `advance_loading`→`advance_departure`, a task-2.6 rename that missed this one
  comment) corrected alongside.
- Numerous smaller defects caught and fixed within individual task review rounds, not carried forward
  as open items: a stale docstring and an inline block needing extraction for testability (task 2.1); a
  real idempotency bug where a replay landing in `EXCEPTION` status wasn't caught by the replay
  short-circuit, plus an exception-message type mismatch rendering literal `"TripStatus.ACTIVE"` in 409
  bodies (task 2.2, caught by code-quality review, independently reproduced before being reported); lost
  diagnostic detail on anchor failure and a parameter-hazard in the fail-open anchor helper's signature
  (task 2.5); a stale "Departure is an unanchored feeder" comment left over from before departure
  anchored (task 2.6); stale test names/docstrings still using the retired H2/H5 numbering, and an
  undocumented mislabel-correction (task 2.7).

### Carried into Stage 3

- **NEW-9 above (`advance_confirmation`'s `MultipleResultsFound` risk on multi-loading trips) must be
  resolved before any stage relies on a real cross-dock trip reaching `CLOSED`.** Not yet scheduled to
  any task as of this writing — needs an owner. The fix shape is the same one already proven for
  `advance_unloading`/`advance_departure` (a leg-scoped lookup, likely resolving to "the trip's *first*
  `LOADING` row" or something equally well-defined) but the exact semantics of "origin count" on a
  multi-pickup trip is a product question (which pickup's count is "the" origin baseline?), not purely
  mechanical — worth a design conversation, not a blind copy of `_find_departure_for_leg`'s pattern.
- The 2.2c endpoint shim (`_next_pending` in `handshakes.py`) — deleted wholesale, not carried, once
  Stage 3.1's real `phase_event_id`-addressed routes land. As planned.
- `TripConsignmentInput`'s missing per-consignment stop reference (2.1a) — as planned.
- `get_handshake_detail`'s multi-row `(trip_id, phase_type)` ambiguity — as planned, retires whole in
  Stage 3.1 when the route is deleted; unchanged behavior, not fixed here.
- The multi-seal-layer schema question from the 2026-07-28 meeting — as planned.
- **New, not previously flagged:** `frontend/shared/lib/types/{handshake,seal,phase}.ts` and
  `frontend/shared/lib/mocks/{trips,phase-trips}.ts` still reflect the old H2/H3 seal-field split (seal
  on loading, not departure) — flagged during task 2.6 but explicitly out of that task's backend-only
  fence. Needs syncing before Stage 4/5's frontend work can drive the new contract correctly.
- **New, not previously flagged:** the anchored departure payload's shape changed (`driver_visual_count`
  dropped, per T5's outcome above) — anyone building the "frozen contract" TypeScript types or mocks
  for the departure/pickup receipt shape needs this reflected, not just the key renames from T8.

### "Done when" — assessment

**Single-leg trip walks P0→P6 with `anchor_status` correctly distinguishing fail-closed P0 from
fail-open P3/P6: met.** Proven by `test_advance_confirmation_matching_counts_closes_trip` (full walk to
`CLOSED`), `test_create_trip_anchor_failure_still_rolls_back_whole_trip` (P0 fail-closed contrast), and
`test_departure_anchors_fail_open_on_hedera_timeout`/`test_confirmation_anchors_fail_open_on_hedera_timeout`
(P3/P6 fail-open).

**11-row multi-stop plan walks through its final phase, closing the trip: not met, by design of the
NEW-9 deferral above.** The generated 11-row plan (via `_build_phase_events`, matching
`build_phase_plan`'s own contract) and per-leg seal continuity across two `DEPARTURE`/`IN_TRANSIT` legs
*are* proven correct end-to-end — `test_cross_dock_seal_continuity_correct_seal_per_leg_no_mismatch`/
`test_cross_dock_seal_continuity_wrong_leg_seal_raises_mismatch` walk a real two-`LOADING`-row cross-dock
fixture through both departures and both unloadings, which is T4/T5's actual point and the highest-risk
part of this stage. But the walk cannot continue to `advance_confirmation`/`CLOSED` on that same trip
shape, for the reason recorded as NEW-9. This is a known, Ciaran-authorized gap, not an oversight — but
it means this stage's literal "Done when" line is partially, not fully, satisfied, and that should be
weighed before treating Stage 2 as unconditionally closed.
