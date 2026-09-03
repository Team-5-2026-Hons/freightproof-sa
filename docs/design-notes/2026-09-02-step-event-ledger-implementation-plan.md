# Step-Event Ledger — Implementation Plan and the Sequencing Call

> **Status:** plan, pre-implementation · **Author:** Ciaran · **Date:** 2026-09-02
> **Parent:** [2026-09-01-phase-step-event-ledger.md](2026-09-01-phase-step-event-ledger.md)
> **Siblings:** [2026-09-02-step-event-payload-audit.md](2026-09-02-step-event-payload-audit.md) ·
> [2026-09-02-seal-chain-rework.md](2026-09-02-seal-chain-rework.md) ·
> [../iteration3_plan.md](../iteration3_plan.md) §3, §5
> **Verified against `dev`/Ciaran on 2026-09-02** — every claim below cites a file or a line.

Three questions were asked of this design: can it be built now, is it worth building now,
and does it invalidate the exception and alert work already committed to Sprint 6. This
document answers all three, then gives the staged plan the answer implies.

---

## 0. The three answers, up front

**Can it be built now?** The structural half, yes — and more cheaply than §10 estimated,
because `phase_service.py` has a single funnel rather than six independent paths
(§1.1 below). The half that makes it worth building — non-driver actors — cannot. Q1, Q2
and Q3 are unanswered, and `Parcel.pp_scan_out_at` / `pp_scan_in_at` are `declared`
columns nothing writes. A ledger built today has `actor_type` in every row and the value
`driver` or `system` in every one of them. **That is the column existing without the
capability existing.**

**Is it worth building now?** No. A ledger whose every actor is the driver proves nothing
the phase row does not already prove, and it puts the two hottest files in the repository
under edit nineteen days before the presentation. §5 below is what should be built instead
— hours of work, demo-visible, and built to §9's rules so none of it is thrown away.

**Is it more important than the exceptions and alerts?** No, and the dependency runs the
opposite way from the one feared. **FP-147 and FP-148 are prerequisites of the ledger, not
casualties of it.** §9.4 of the parent note requires the realtime refetch strategy to be
settled *before* the live act rail ships; FP-148 is that same decision taken at one fifth
the event volume. Building the ledger first means designing the alert stream against a
channel already flooded with step events.

**The fear is not baseless, but it is smaller and more specific than it looks.** Exactly one
surface collides: the nesting of exceptions inside `TimelineEvent` on the trip detail page.
That is ~40 lines of one file. §3 measures it; §4 is the guard rail that removes it at zero
cost, this sprint.

---

## 1. What the codebase says that the notes did not

Four findings from verifying the design against `dev` today. Two make the build cheaper than
§10 estimated; two are honesty problems the plan has to carry.

### 1.1 `phase_service.py` is one funnel, not six paths

§10 calls the file "the big one — every `advance_*` path derives step events from the payload
it already receives", and sizes the risk from its 1441 lines. The file is better than that:

```
advance_activation    :780  ─┐
advance_loading       :889  ─┤
advance_departure    :1061  ─┤
advance_in_transit   :1100  ─┼─→ _finish_phase(db, trip=, event=, idempotency_key=)  :479
advance_unloading    :1216  ─┤
advance_confirmation :1353  ─┘
```

Six call sites, byte-identical signature, one implementation seventeen lines long. Derivation
lands in **one function plus six small pure mappers**, not in six hot paths.

### 1.2 Derive from the phase row, not from the request payload

§10 says the completion paths "derive step events from the payload they already receive".
Deriving from the **persisted row** instead is strictly better, and `_finish_phase`'s
signature already forces it — it never sees the payload.

By the time `_finish_phase` runs, every value a derived step event needs is on the
`PhaseEvent`: `seal_number`, `driver_phone_lat/lng`, `driver_visual_count`,
`parcel_count_origin`, and every artifact FK. Deriving from the row means:

- the completion contract is untouched **in fact**, not just in intent — no new argument
  crosses six signatures;
- the same mapper backfills history, because a 2026-07 phase row and a 2026-11 one present
  identically. **The migration and the live derivation become one code path**, which is the
  only condition under which the backfill is trustworthy;
- an older app build draining a queued completion produces the same rows as a current one.

### 1.3 The derived rows must not claim a timestamp they do not have

This is the plan's one genuine honesty problem and neither source note states it.

A derived `seal-applied` has no `occurred_at`. The phase row carries one `completed_at` for
the whole phase; that is the entire reason the ledger exists. Writing `completed_at` into
every derived row's `occurred_at` manufactures a per-act timestamp out of a per-phase one —
which is the exact claim the ledger is built to make honestly, faked on day one, in the
most visible possible place.

Two values are honest, and only two: `evidence_artifacts.captured_at` where an artifact
exists (already written, `db/models/evidence.py:46`), and null everywhere else.

**Decision D-8** (§8) settles how a null reads. §9.3's dashed no-timestamp row already
exists for "not yet happened" and must not be reused for "happened, time unknown".

### 1.4 The exception surface is mock-backed

`dispatcher/lib/hooks/useExceptions.ts` returns `mockExceptions`, filtered in a `useMemo`.
There is no API call. `app/(app)/exceptions/page.tsx` (176 lines) and `[id]/page.tsx` (221)
render off it. Backend-side, `api/v1/endpoints/exceptions.py` has one route — the driver's
POST — and its own docstring says so: *"Dispatcher list/resolve/override (spec §3.6) are out
of scope for this plan — flagged, not silently dropped."*

`TripException` already carries `resolved`, `resolved_by_user_id`, `resolved_at`,
`resolver_note` (`db/models/transit.py:93-98`). **FP-146 needs no migration.** It needs a
service, two endpoints and a hook — and it converts two mock pages into real ones.

Neither route is in the sidebar (`components/layout/Sidebar.tsx:31-53`), so this is not the
`/sla` situation the iteration 3 plan calls *"the worst artefact to have in front of a
marker"*. It is one URL away from being it.

---

## 2. The ranking, with the numbers

| Work | Migration | Blocked on | Panel-visible | Answers a stated ask |
|---|---|---|---|---|
| **FP-147** — emit from the system exception sites | none | nothing | **directly** | *"I actually want to know that live"* — verbatim from the Q&A |
| **FP-146** — resolve + call log | **none** — columns exist | nothing | yes — two mock pages become real | site-visit finding on informal handling |
| **FP-148** — scope the alert stream | none | nothing | yes | *"so the critical one is not buried"* |
| **Step-event ledger** | one new table | **Q1, Q2, Q3 + the scan feed** | no — the panel cannot see a schema | the capability, not the structure |

FP-147 is eight `enqueue_event` calls. Today `db.add(TripException(...))` appears at nine
sites; exactly one of them — `exception_service.py:88`, the driver-raised path — is followed
by `enqueue_event` at `:110`. The other eight are silent:

```
phase_service.py:560, 916, 1031, 1165, 1201, 1310
trip_service.py:565
scan_service.py:344
```

Two of those are the CRITICAL seal sites. **A driver pressing panic pings the dispatcher; a
broken seal does not.** That is the highest value-per-line change available in this
iteration and it is five days from a sprint boundary.

The ledger's own §8 already reached this conclusion — *"landing it in the fortnight before
the presentation puts the anchoring path and the offline queue at risk for a structural gain
the panel cannot see"* — and nothing found today changes it. §1.1 makes the build cheaper;
it does not make the blockers answerable or the presentation later.

### On alert streams and dispatcher assignment

The instinct that alert streams should wait for per-dispatcher trip assignment is right, and
the iteration 3 plan already acted on it: *"Per-dispatcher alert routing / third role tier —
needs a trip-to-dispatcher assignment model that does not exist. Decision 11. Iteration 4."*

**That is not what FP-148 is.** Routing asks *which dispatcher*; FP-148 asks *which events
are loud*. The channel is per-organisation (`core/realtime.py` `CHANNEL_PREFIX = "org:"`) and
every dispatcher in the org already receives every event on it. Severity gating needs no
assignment model, and without it FP-147 makes the stream noisier rather than more useful —
eight new emitters into a channel with four coarse kinds and no severity. FP-147 and FP-148
are one piece of work in two tickets and should not be separated.

---

## 3. The collision, measured

Exceptions render in four places. Three are untouched by anything in the ledger design.

| Surface | File | Ledger impact |
|---|---|---|
| List | `app/(app)/exceptions/page.tsx` (176) | **None.** Standalone table, its own route |
| Detail | `app/(app)/exceptions/[id]/page.tsx` (221) | **None** |
| Banner | `components/domain/ExceptionBanner.tsx` | **None** |
| **Trip timeline** | `app/(app)/trips/[id]/page.tsx` | **This one** |

The collision, precisely:

- `TimelineEventProps` takes `exceptions?: TripException[]`, `showExceptionIndicator?`, and
  `artifactsById?` (`:156-161`).
- The count chip renders at `:242`; the nested list renders at `:300-336`, **inside
  `isExpanded`** — behind the chevron.
- The attach loop at `:652-663` places each exception on the phase carrying its
  `phase_event_id`, with a documented fallback for cancellation notes.
- In-transit legs render their own exceptions inside `InTransitTimeline` instead, to avoid
  drawing each one twice (`:737-743`).

§9 rebuilds exactly this component: acts become always-visible rows, the chevron keeps only
verdicts and comparisons. **An exception nested behind the chevron is neither.** It is an act
— it has an actor, a time, a payload and an artifact FK — sitting in the place §9 reserves
for reconciliations. §9 does not say where it goes, because it was written about steps.

Backend-side there is no collision at all. The payload audit already settled it:
`exception-raised` is *"the most complete record in the system. **Nothing new needed**"*.
`TripException` stays its own table with its own FKs, exactly as `trip_location_pings` does.
FP-147's edit is a line after `db.add(...)`; the ledger's edit is inside `_finish_phase`.
Same file, different functions, no semantic conflict.

**So the exposure is one prop group and ~40 lines of one component** — not the exceptions
feature, and not the alert stream.

---

## 4. The guard rail — decide one thing now, rebuild nothing later

> **An exception is an act row, not a chevron child.**

Adopt that sentence as part of FP-146/148's UI work and the collision in §3 disappears
before it exists. It is not extra work: FP-146 has to touch the timeline anyway to show a
resolution, and rendering a row on the rail is no more work than rendering a nested card
behind a chevron.

It is also the correct model independently of the ledger. An exception already has
everything §9 requires of an act row — `source` is an actor type in all but name
(`ExceptionSource.DRIVER` / system / dispatcher), `created_at` is a timestamp, `gps_lat/lng`
is a position, `supporting_artifact_id` is the artifact marker. §9's row shape describes it
without amendment.

What this buys, concretely: when the ledger lands, exceptions **join** the rail rather than
being migrated onto it. `TimelineEvent` gains step events beside rows that already render;
the `exceptions` prop group and the `:300-336` block are already gone; `ExceptionEvidence`
already sits on a row rather than inside a panel, which is where §9.5 puts artifacts anyway.

**Cost now: zero. Cost if skipped: the ~40 lines in §3, plus a second pass over
`ExceptionEvidence`.** Take it.

Two smaller rules worth adopting in the same breath, for the same reason:

- **FP-148's severity gate is a stream-level decision, not a toast-level one.** Decide which
  kinds are loud in `RealtimeKind` and in the provider, not in the component that shows the
  toast. §9.4's debounce lands in the same place.
- **Keep the in-transit exception de-duplication rule** (`:737-743`). It is the same rule
  §9.2 needs when `InTransitTimeline` generalises: one act, one row, one owner.

---

## 5. Stage 0 — what to build now

Sprint 7, alongside the committed work. No migration, no new table, nothing blocked.
Each item is hours, not days, and each is built to §9's rules so iteration 4 extends it
rather than replacing it.

### S0.1 · Seal format (seal note §3.1) — **do this first, it is a live demo risk**

`^[A-Z]{2}-\d{4}$` is invented. A real barcoded seal is rejected by both
`schemas/phases.py:20` and `lib/utils/seal-format.ts`, in front of the panel, with a
physical seal in hand.

Relax to a length-and-charset constraint, keep the normalisation (`_normalized_seal`), move
the strict pattern to `core/config.py`.

- **Demonstrable:** a real seal number completes a departure.
- **Verification:** `pytest backend/tests/unit/test_phase_service.py` green — the
  normalisation tests at `:1289` already cover the FP-144 behaviour and must not move.
  One new case per accepted format.
- **Shared file:** `core/config.py` — flag it. **New `.env` key** for the strict pattern.

### S0.2 · Destination-side expected seal (seal note §3.4)

Show the departure seal for this leg on the destination stop's dispatcher view, labelled
"expected at this stop". `_find_departure_for_leg` (`phase_service.py:940`) already does the
lookup. Keep it off the driver's screen — `SealVerify.tsx`'s blind entry is deliberate.

- **Demonstrable:** the inter-branch phone call, replaced by an anchored value.
- **Verification:** dispatcher component test; no backend change.

### S0.3 · The `captured_at` sub-timeline (parent note §8.1) — built to §9's shape

`evidence_artifacts.captured_at` is written today and rendered nowhere. Surface it as act
rows under each phase card, using the `alwaysExpandedContent` prop that already exists
(`page.tsx:154`, in use at `:855`).

**Build it on `app/dev/design/page.tsx` first** (§9.3), fed by `makePhasePlan` from
`shared/lib/mocks/phase-trips.ts`, with the three states that are hard to catch in
production: a live act arriving, a queued-offline bracket, and the 11-phase cross-dock
density case. That route decides whether the always-visible rule survives, before any real
page depends on the answer.

Then render exceptions in the same rail (§4).

- **Demonstrable:** a dispatcher reads capture times per photo, ordered, on the real page,
  with exceptions inline. Labelled for what it is: *"these are the capture times we already
  record; the full sub-event ledger with non-driver actors is iteration 4."*
- **Verification:** existing dispatcher tests green; the dev route renders all three states.
- **Shared file:** none. `shared/lib/types/phase.ts` only if a row type is extracted — defer
  that to Stage 1.

### S0.4 · Artifact-upload realtime kind

One `RealtimeKind`, emitted on upload, so S0.3's rail fills in live during the demo. Ride
FP-147's pattern and take §9.4's debounce decision here, where the volume is small enough to
be measured rather than guessed.

- **Demonstrable:** the sub-timeline grows without a reload.
- **Verification:** `test_realtime_emit.py` extended; debounce measured against
  `GET /trips/{id}` payload size.
- **Shared file:** `core/realtime.py` — flag it. Coordinate with FP-147/148, same file.

---

## 6. The ledger — six stages, iteration 4

Every stage ends with something demonstrable and carries its own verification. The success
criterion is constant and stated once: **the 32 phase-touching backend test files
(~15,895 lines) stay green and unmodified through Stages 1–3.** Capture the baseline before
Stage 1 begins:

```bash
cd backend && pytest -q --tb=no > /tmp/baseline.txt   # record the count, not just the exit code
git diff --stat backend/tests/                        # must stay empty through Stage 3
```

A test that needs editing is the signal that a contract moved. There are three contracts that
must not move, and they are the reason this is attemptable at all: the offline queue's shape,
the anchoring path, and the completion endpoints' contract.

### Stage 1 · The table, and a read path that returns nothing

`db/models/phase_steps.py` (~90 lines), `ActorType` in `enums.py`, registration in
`db/models/__init__.py`, one Alembic revision, a read schema in `schemas/phases.py`, and
`GET /trips/{id}/step-events` on the existing router. Server-side step-order validation
(decision 7) lands here too — `core/phase_meta.py` becomes authoritative over the TS mirror,
which `tests/unit/test_phase_meta_contract.py` already polices in the other direction.

Nothing writes the table.

- **Demonstrable:** the endpoint returns `[]` with a typed shape, on a real trip, with org
  scoping enforced.
- **Verification:** full suite green and unmodified. Migration up **and** down against a
  copy. `alembic heads` shows one head.
- **Shared files:** `db/models/__init__.py`, `db/models/enums.py`, `migrations/versions/`.
  **`git fetch origin` and check for unmerged migrations on `dev` before autogenerate** —
  28 revisions on disk today. Name it `2026_MM_DD_ciaran_add_phase_step_events.py`.
- **Blocked on:** nothing.

### Stage 2 · Derivation, one phase type at a time

Per §1.2: a pure mapper per phase type, `PhaseEvent → list[StepEventDraft]`, called from
`_finish_phase`. Six mappers, one call site.

Order: **loading first** (one step, one artifact, one mapper — proves the pattern on the
smallest surface), then activation, departure, unloading, confirmation, in_transit.

`occurred_at` comes from `evidence_artifacts.captured_at` where an artifact exists and is
null otherwise (§1.3, D-8). Nothing is invented.

- **Demonstrable, per phase type:** complete a phase through the unchanged endpoint; step
  events appear underneath it. The response body is byte-identical to before.
- **Verification:** the suite stays green and unmodified after each mapper — six separate
  green runs, not one at the end. Add a contract test asserting the completion response
  schema is unchanged, and a per-mapper test asserting derived rows and their null
  `occurred_at`s.
- **Shared files:** `phase_service.py` is hot on three branches. **Coordinate**, and see the
  FP-167 note below.
- **Blocked on:** nothing.

> **Sequence FP-167 before this stage, not after.** The `phase_service.py` split into a
> package with `_core.py` is already scoped for Sprint 7, in the quiet window after a merge.
> If it lands first, Stage 2 edits one small `_core.py` and six small modules instead of a
> 1441-line file on three branches. That converts this plan's single largest risk into an
> argument for work already committed. If FP-167 slips, Stage 2 still works — the funnel is
> the seam either way — but the merge risk stays.

### Stage 3 · Merkle root into the phase payload (FP-63)

Each step event carries an `event_hash`; the phase's canonical payload gains a Merkle root
over the ordered step hashes. One anchor per phase, unchanged cost, unchanged receipt — the
anchor now commits to every intermediate act.

**The risk this stage owns, which neither source note names:** changing the canonical payload
changes what every future hash covers. Existing anchors must still verify under the rules
that were in force when they were written. **The payload needs a version marker before the
first root goes in**, or verification of pre-ledger trips becomes a special case in the
verifier rather than a labelled branch.

- **Demonstrable:** an anchored phase whose Hedera payload commits to its step hashes;
  a pre-ledger trip that still verifies.
- **Verification:** `tests/unit/test_phase_anchor_payload.py` extended, not rewritten. A test
  asserting anchor **count** per trip is unchanged. A verifier test over a pre-ledger fixture.
- **Shared files:** `crypto/`, `blockchain/anchor_service.py`.
- **Blocked on:** nothing. This is the stage that gives FP-63 its reason to exist.

### Stage 4 · The dispatcher rail

Generalise `InTransitTimeline` into the rail §9.2 describes, on `app/dev/design/page.tsx`
first. Act rows always visible; one `system` strip per phase card; the chevron keeps
verdicts and comparisons; four of six `*Detail.tsx` panels shed their
`EvidencePhoto`/`EvidenceDocument` blocks to the rows (§9.5).

If §4's guard rail was taken, exceptions are already rows here and this stage does not touch
them.

- **Demonstrable:** an 11-phase cross-dock plan rendered at ~55 acts in a 420 px column,
  legible.
- **Verification:** the three dev-route states; existing dispatcher tests green; **the §9.4
  refetch measurement, taken before the live rail ships, not after it is visibly slow.**
- **Shared files:** `shared/lib/types/phase.ts`.
- **Blocked on:** Stages 1–2. Not on Stage 3.

### Stage 5 · Live emission from the driver app

Steps emit at capture instead of being derived at completion — **one step at a time**
(decision 6). `useOfflineQueue.ts` keeps its shape: same enqueue, same never-regenerated
idempotency key, same drain order. A live-emitted step gets a real `occurred_at`; the
derived path stays in place for every step that has not migrated and for older builds.

Retire `usePhaseDraft.ts` **last**, and only once every step emits.

- **Demonstrable:** one step — start with departure's `2-capture-seal` — producing a live
  event with a true `occurred_at`, with the offline bracket rendering the sync gap.
- **Verification:** offline-queue tests unchanged and green; a drain test asserting
  `occurred_at ≠ recorded_at` survives the round trip; the derived path still produces
  identical rows for steps that have not migrated.
- **Shared files:** `shared/lib/constants/phase-meta.ts` (server becomes authoritative).
- **Blocked on:** Stages 1–2.

### Stage 6 · Non-driver actors — the point of the whole thing

Three independent unblockings, each an insert against a table that already exists:

| Event | Actor | Unblocked by |
|---|---|---|
| `scan-out-complete` · `scan-in-complete` | warehouse | The scan feed writing `Parcel.pp_scan_out_at` / `pp_scan_in_at`. **Sequence this before the warehouse events or the first non-driver row in the ledger is empty** |
| `seal-broken` | receiver | **Q3** — who performs it and how they are identified. `pod-signed` is the precedent: the name is rendered into the artifact and never stored |
| `receiver-signed-off` · `receiver-position-recorded` | receiver | **Q2** (offline fallback) and Q3. Gates FP-155 |

Because Stage 1 ships `actor_type` and the read path, each of these is a write and a
renderer — no migration, no rebuild. **That is the whole reason the stages are ordered this
way.**

---

## 7. Shared files and coordination

| File | Stage | Why it is shared |
|---|---|---|
| `core/config.py` | S0.1 | Everyone's `.env`. **New key** for the seal pattern |
| `core/realtime.py` | S0.4, and FP-147/148 | Three tickets, one file, one sprint. Coordinate or serialise |
| `db/models/__init__.py` | 1 | Every migration depends on it |
| `db/models/enums.py` | 1 | `ActorType` |
| `migrations/versions/` | 1 | 28 revisions. `git fetch` first; do not fix a conflicting revision chain alone |
| `orchestration/phase_service.py` | 2 | Hot on three branches. FP-167 first if possible |
| `crypto/`, `blockchain/anchor_service.py` | 3 | The anchoring path — one of the three frozen contracts |
| `shared/lib/types/phase.ts` | 4 | Both frontends |
| `shared/lib/constants/phase-meta.ts` | 5 | Mirrors `core/phase_meta.py`; the contract test polices both |

`backend/app/main.py` is **not** touched — the read endpoint extends the existing phases
router. `requirements.txt` and both `package.json` files are untouched: no new dependency.

---

## 8. Decisions this plan needs

Numbered from the parent note's seven, which stand.

**D-8 · How does a derived row read?** (§1.3) Derived step events have no honest
`occurred_at` unless an artifact supplies one. Options: a nullable `occurred_at` plus a
`derivation` marker on the row; or a `time_grain` column; or refuse to derive rows for steps
with no artifact at all. *Recommendation: nullable `occurred_at` plus an explicit marker, and
a distinct rendering from §9.3's dashed "not yet happened" row.* **Take this before Stage 2 —
it is the difference between a ledger and a ledger-shaped table.**

**D-9 · Canonical payload versioning.** (Stage 3) A version marker in the phase payload
before the first Merkle root lands, so pre-ledger anchors verify under a labelled branch
rather than a special case.

**D-10 · Are exceptions act rows?** (§4) Recommended yes, decided **this sprint** with
FP-146, not in iteration 4 with the ledger.

**D-11 · Where does severity gating live?** (§4) Recommended: `RealtimeKind` and the
provider, not the toast component — so §9.4's debounce has one home.

Still blocked, and routed around rather than through: **Q1** (do not create
`expected_seal_number`), **Q2** (gates FP-155), **Q3** (gates Stage 6's headline events),
and the scan feed (gates the warehouse events).

---

## 9. Corrections to the source notes

Verified today; the code is right and the notes are stale.

| Note | Says | Actually |
|---|---|---|
| Parent §10 | "20 revisions on disk" | **28** |
| Parent §10 | "Every `advance_*` path derives step events from the payload" | One funnel, six identical call sites, and derivation should read the **row** (§1.1, §1.2) |
| Parent §6 | `core/phase_meta.py` ↔ `phase-meta.ts` duplication needs the server to win | Already test-enforced both ways by `tests/unit/test_phase_meta_contract.py`, which parses the TS file. The §6 row about **`phase_plan.py` ↔ `mocks/phase-trips.ts`** is the one with no test — that gap is real |
| Iteration 3 §3 | "six system-detected exceptions bypass `enqueue_event`" | **Eight** — `phase_service.py` ×6, `trip_service.py:565`, `scan_service.py:344` |
| — | *(unstated anywhere)* | The dispatcher exception surface is **mock-backed**; `useExceptions` never calls the API, and the exceptions endpoint has no dispatcher routes (§1.4) |

---

## 10. The order

1. **Now, Sprint 7:** S0.1 seal format · S0.2 destination expected seal · FP-147 + FP-148
   together · FP-146 with D-10 taken · S0.3 the `captured_at` rail on `dev/design` first ·
   S0.4 the upload event with §9.4 measured.
2. **Sprint 7 quiet window:** FP-167, the `phase_service.py` split — which is now also
   Stage 2's preparation.
3. **Iteration 4:** Stages 1 → 2 → 3, then 4 and 5 in either order, then 6 as its blockers
   clear.

The ledger is the right design and the notes hold up under verification. It is not the right
fortnight, and the work that *is* right for this fortnight is the work it depends on.
