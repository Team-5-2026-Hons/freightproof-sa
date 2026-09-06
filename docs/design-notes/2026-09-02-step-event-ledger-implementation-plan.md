# Step-Event Ledger — Implementation Plan and the Sequencing Call

> **Status:** authoritative plan, pre-implementation · **Author:** Ciaran · **Date:** 2026-09-02
> · **Last verified:** 2026-09-06
> **Parent:** [2026-09-01-phase-step-event-ledger.md](2026-09-01-phase-step-event-ledger.md)
> **Siblings:** [2026-09-02-step-event-payload-audit.md](2026-09-02-step-event-payload-audit.md) ·
> [2026-09-02-seal-chain-rework.md](2026-09-02-seal-chain-rework.md) ·
> [2026-09-05-live-phase-timeline-handoff.md](2026-09-05-live-phase-timeline-handoff.md) ·
> [2026-09-05-step-event-ledger-plan-corrections.md](2026-09-05-step-event-ledger-plan-corrections.md) ·
> [../iteration3_plan.md](../iteration3_plan.md) §3, §5
> **Verified against `Ciaran` on 2026-09-06.** Line numbers move; match on content.

Three questions were asked of this design: can it be built now, is it worth building now,
and does it invalidate the exception and alert work already committed to Sprint 6. This
document answers all three, then gives the staged plan the answer implies.

The 2026-09-05 correction review is incorporated here. **This file is the single
implementation authority.** The correction note is retained only as a decision record; if
it or the handoff conflicts with this plan, this plan wins.

---

## 0. The three answers, up front

**Can it be built now?** The capture-event rail can: the five existing evidence-producing
steps already have honest client capture times and server receipt times. Making those rows
live requires bounded attribution plumbing, one small migration, completion-time integrity
checks, and a kind-filtered artifact refetch (§5). It does **not** require the `phase_steps`
table.

The full ledger is structurally buildable, but its highest-value half — independent
non-driver corroboration — is still blocked. Q1, Q2 and Q3 are unanswered, and
`Parcel.pp_scan_out_at` / `pp_scan_in_at` are declared columns nothing writes. A full ledger
built today has `actor_type` in every row and the value `driver` or `system` in every one.
That improves operational visibility, but not corroboration.

**Is it worth building now?** Split the answer by release. **Iteration 3 should ship the
capture-event rail in §5. Iteration 4 should ship the complete child ledger in §6.** That
keeps the demo-visible central capability while avoiding a new ledger table, the unresolved
Merkle sequencing decision, and the offline step-event queue change during presentation
fortnight.

**Should it displace the remaining assigned work?** No. FP-146, FP-147 and FP-148 have now
shipped and provide the rail/realtime foundations this plan needs. FP-149 parcel traceability
should not be traded away: Bruce named parcel search as the market gap, and its proposed
`ParcelScanEvent` log creates a real convergence question with `phase_steps` that belongs in
Iteration 4, not in presentation fortnight. FP-167 should still precede ledger Stage 2 if it
lands.

**The earlier collision was real and is now resolved.** It concerned the nesting of
exceptions inside `TimelineEvent` on the trip detail page. §3 preserves the measurement and
§4 the decision; commit `76afa19` moved exceptions onto the act rail, so the capture-event
work extends that pattern instead of reopening it.

---

## 1. What the codebase says that the notes did not

The original four findings are retained below, with shipped items marked as historical. The
anchor-order and timestamp findings remain active constraints.

### 1.1 `phase_service.py` has one completion funnel, but anchoring happens before it

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

That seam is sufficient for Stage 2 derivation, but not for Stage 3 anchoring. Departure and
confirmation build, hash and dispatch their canonical anchor payloads **before** they call
`_finish_phase`. Child rows created only inside `_finish_phase` therefore do not exist when
those payloads are hashed. §6 Stage 3 carries the required sequencing decision explicitly;
the old claim that the funnel alone made Stage 3 implementable was wrong.

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

Stage 3 may move the *call* for the two anchored phase types ahead of anchor construction,
but it does not change the mapper input: the persisted `PhaseEvent` remains authoritative.
Use one idempotent materialisation helper so the pre-anchor and completion-funnel paths cannot
produce duplicate children.

### 1.3 The derived rows must not claim a timestamp they do not have

This is the plan's one genuine honesty problem and neither source note states it.

A derived `seal-applied` has no `occurred_at`. The phase row carries one `completed_at` for
the whole phase; that is the entire reason the ledger exists. Writing `completed_at` into
every derived row's `occurred_at` manufactures a per-act timestamp out of a per-phase one —
which is the exact claim the ledger is built to make honestly, faked on day one, in the
most visible possible place.

For the Iteration 3 rail, show both timestamps already carried by an artifact:

- `captured_at` — client-observed capture time;
- `created_at` — server receipt/persistence time.

Use `captured_at` as the primary event time, but display `created_at` whenever it differs so
an offline or delayed upload is not presented as live server receipt. For later derived
ledger rows, `occurred_at` comes from `captured_at` where an artifact exists and is null
everywhere else. Do not manufacture a per-act timestamp from phase `completed_at`.

**Decision D-8** (§8) settles how a null reads. §9.3's dashed no-timestamp row already
exists for "not yet happened" and must not be reused for "happened, time unknown".

### 1.4 The exception surface was mock-backed — resolved

> **Status update, 2026-09-06:** FP-146 shipped the dispatcher list/resolve API and real
> hook. This subsection is retained as the evidence that established its priority.

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

> **Status update, 2026-09-06:** FP-146, FP-147 and FP-148 have shipped. The table below is
> retained as the sequencing evidence available on 2026-09-02, not as the current backlog.
> The present call is §0: ship the capture-event rail without displacing FP-149, and defer
> the complete ledger to Iteration 4.

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

> **Resolved by `76afa19`.** This section records the pre-change surface and the reasoning
> behind D-10; it is not a description of the current component.

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

This decision was adopted in `76afa19`; the collision in §3 is gone. It remains the rule for
all rail work in this plan.

It is also the correct model independently of the ledger. An exception already has
everything §9 requires of an act row — `source` is an actor type in all but name
(`ExceptionSource.DRIVER` / system / dispatcher), `created_at` is a timestamp, `gps_lat/lng`
is a position, `supporting_artifact_id` is the artifact marker. §9's row shape describes it
without amendment.

What this buys, concretely: when the ledger lands, `TimelineEvent` gains step events beside
exception rows that already render. `ExceptionEvidence` already sits on a row rather than
inside a panel, which is where §9.5 puts artifacts anyway.

**Outcome:** the guard rail was taken before the ledger work and costs this plan no migration.

Two smaller rules worth adopting in the same breath, for the same reason:

- **Severity and kind are separate axes.** Loudness comes from `EventSeverity` and is ranked
  in `dispatcher/lib/realtime/ranking.ts`; `RealtimeKind` says what changed and may filter
  which resource refetches. Artifact-upload events are INFO. See D-11's amendment.
- **Keep the in-transit exception de-duplication rule** (`:737-743`). It is the same rule
  §9.2 needs when `InTransitTimeline` generalises: one act, one row, one owner.

---

## 5. Stage 0 — what to build now

Sprint 7, alongside the committed work. There is no new ledger table, but live phase
attribution does require one hand-written migration extending `evidence_artifacts`, plus
bounded backend and frontend changes. Each item is built to §9's rules so Iteration 4
extends it rather than replacing it.

Iteration 3 must also **decide D-8** before it closes. That decision is documentation-only
now, but it blocks honest Stage 2 derivation later and is cheapest to settle while the rail's
unknown-time state is visible on the density fixture.

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

### S0.3 · The attributed capture-event rail (parent note §8.1) — built to §9's shape

`evidence_artifacts.captured_at` and `created_at` are already on the wire and rendered only
inside artifact detail behind a chevron. Surface them as always-visible act rows under each
phase card, using the `alwaysExpandedContent` prop that already exists. `captured_at` is the
primary label; when `created_at` differs, show both as “captured” and “received” so delayed
offline sync remains honest.

Completed phases can resolve artifacts through their phase-row FKs, but a newly uploaded
artifact has no phase or step link until completion. For a genuinely live rail, add a named,
nullable `phase_event_id` FK (using the model's deferred-FK pattern because `phase_events`
already references artifacts) and a nullable `step_slug` to `evidence_artifacts`. Expose them
through the upload/read schemas and populate them from both early uploads and submit-time
fallback uploads. The two fields are both present or both absent.

Enforce the all-or-neither invariant with a database `CHECK` constraint as well as service
validation; the FK proves the phase exists, while the service still has to prove trip,
status and slug compatibility.

Use a small typed **evidence-producer catalogue** beside `STEP_SLUGS`; do not promote
`STEP_SLUGS` itself into a domain event catalogue. Its Iteration 3 entries are exactly:

| Phase | Stable event key | Source step slug | Completion field |
|---|---|---|---|
| loading | `linehaul-photographed` | `1-linehaul` | `linehaul_photo_artifact_id` |
| departure | `seal-applied` | `2-capture-seal` | `seal_photo_artifact_id` |
| unloading | `seal-inspected-intact` | `2-seal-verify` | `gate_photo_artifact_id` |
| confirmation | `pod-photographed` | `1-pod-photo` | `pod_photo_artifact_id` |
| confirmation | `pod-signed` | `2-pod-signature` | `pod_signature_artifact_id` |

The upload service must reject half-attribution, a phase from another trip, a phase other
than the trip's current eligible unresolved phase (`PENDING` or `IN_PROGRESS`), and a slug
not allowed for that phase type. “Active” must not mean `IN_PROGRESS` alone — current code
does not promote phase rows into that state. Retakes remain append-only rows with the same
slug; the artifact ID supplied at phase completion is the copy of record.

Upload validation is not enough. Extend
`phase_service._assert_artifacts_belong_to_trip` (or a narrowly named successor) so each
completion field above also verifies the artifact's `(phase_event_id, step_slug)` pair.
An artifact attributed to departure's seal capture must not be accepted as confirmation POD
evidence merely because it belongs to the same trip. During the compatibility window,
**unattributed legacy artifacts remain accepted**; an attributed artifact must match the
current phase and expected slug. The legacy departure waybill field has no current live
producer, but an older offline queue entry may still upload and attach it, so it stays on the
legacy path rather than entering the five-entry catalogue.

**Build it on `app/dev/design/page.tsx` first** (§9.3), fed by `makePhasePlan` from
`shared/lib/mocks/phase-trips.ts`, with the three states that are hard to catch in
production: a live act arriving, a queued-offline bracket, and the 11-phase cross-dock
density case. That route decides whether the always-visible rule survives, before any real
page depends on the answer.

Reuse the exception act rows already on the rail (§4); do not create a second nested
exception presentation.

- **Demonstrable:** five kinds of evidence-producing acts appear under the correct active
  phase, with honest capture/receipt timing and exceptions inline. Label it precisely: *“This
  is the capture-event rail; steps without evidence join when the full child ledger ships.”*
- **Verification:** upload integration tests cover every attribution rule; phase-service
  unit tests reject a same-trip/wrong-phase or wrong-slug artifact while accepting legacy
  unattributed evidence; driver fallback-upload tests preserve attribution; dispatcher tests
  cover both timestamps and the 11-phase density case.
- **Shared files:** `migrations/versions/` and `orchestration/phase_service.py`; coordinate.
  `shared/lib/types/phase.ts` only if a row type is extracted.

### S0.4 · Artifact-upload realtime kind and subscribing consumer

Add one `RealtimeKind`, emitted after a successfully attributed upload at INFO, so S0.3's
rail can fill during the demo without raising an alert toast. An emitter alone is not enough:
`useTripArtifacts` fetches a separate endpoint and has no realtime subscription, while the
existing trip-detail subscription only refetches `GET /trips/{id}`. Extend
`useLiveResource` with an optional kind filter and subscribe the artifact hook so this kind
silently refetches `GET /trips/{id}/artifacts`. Reconcile on reconnect as the existing hook
does, and take §9.4's debounce decision where event ranking already lives.

- **Demonstrable:** the sub-timeline grows without a reload.
- **Verification:** `test_realtime_emit.py` extended; artifact-hook tests prove the matching
  kind refetches the artifact endpoint and unrelated kinds do not; reconnect still refetches;
  debounce measured against the artifacts payload.
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
`GET /trips/{id}/step-events` on the existing router. Expand S0.3's typed event catalogue
into the full server-side domain catalogue: stable event key, phase type, order, allowed
producer, optionality, and retake/supersession policy. Keep it **beside** `STEP_SLUGS`, which
is a mutable driver-screen recipe with empty phases and removed slugs, not an append-only
event authority. `tests/unit/test_phase_meta_contract.py` continues to police the separate
Python/TypeScript screen-recipe mirror.

Nothing writes the table.

- **Demonstrable:** the endpoint returns `[]` with a typed shape, on a real trip, with org
  scoping enforced.
- **Verification:** full suite green and unmodified. Migration up **and** down against a
  copy. `alembic heads` shows one head.
- **Shared files:** `db/models/__init__.py`, `db/models/enums.py`, `migrations/versions/`.
  **`git fetch origin` and check for unmerged migrations on `dev` before writing it.**
  Hand-write this revision; the known autogenerate drift proposes unrelated destructive
  changes. There were 28 revisions on disk at the 2026-09-02 audit. Name it
  `2026_MM_DD_ciaran_add_phase_step_events.py`.
- **Blocked on:** nothing.

### Stage 2 · Derivation, one phase type at a time

Per §1.2: a pure mapper per phase type, `PhaseEvent → list[StepEventDraft]`, plus one
idempotent materialisation helper. In this stage the completion funnel calls it after the
phase-specific wrapper has persisted its fields. Six mappers, one helper, one initial call
site. Stage 3 deliberately changes the call placement for the two anchored phase types.

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

### Stage 3 · Fix anchor sequencing, then add the Merkle root (FP-63)

Each step event carries an `event_hash`; the phase's versioned canonical payload gains a
Merkle root over the ordered step hashes. One anchor per currently anchored phase, unchanged
receipt count.

**Do not implement the old order.** Departure and confirmation currently build, hash and
dispatch their anchor before `_finish_phase`; Stage 2's children therefore do not exist at
hash time. Choose D-12 before this stage. The recommended implementation is to call the same
idempotent materialisation helper before canonical-payload construction in those two wrappers,
and keep `_finish_phase` as the caller for unanchored phase types. The helper must return the
ordered hashes it materialised and make a second call a no-op. Do not duplicate mapper logic
inside the wrappers.

Coverage must be stated honestly. Today this root protects children of departure and
confirmation only. Trip creation has its separate journey-lock anchor; activation, loading,
in-transit and unloading are unanchored. This stage does not claim every phase child is on
chain unless a later anchoring decision explicitly adds that coverage.

Changing the canonical payload changes what every future hash covers. Existing anchors must
still verify under the rules that were in force when they were written. **Add the D-9 payload
version marker before the first root**, so pre-ledger anchors verify under a labelled branch.

- **Demonstrable:** departure and confirmation anchors commit to their ordered child hashes;
  a pre-ledger trip still verifies; unanchored phases are labelled as such.
- **Verification:** `tests/unit/test_phase_anchor_payload.py` extended, not rewritten; tests
  assert child rows exist before payload hashing, materialisation is idempotent, anchor count
  is unchanged, and a pre-ledger fixture verifies.
- **Shared files:** `orchestration/phase_service.py`, `crypto/`,
  `blockchain/anchor_service.py`.
- **Blocked on:** Stage 2, D-9, and D-12.

### Stage 4 · Extend the dispatcher rail to the complete ledger

Extend S0.3's capture-event rail with the full step-event read path. Generalise
`InTransitTimeline` as §9.2 describes, with the density behaviour already proven on
`app/dev/design/page.tsx`. Act rows stay visible; one `system` strip sits per phase card; the
chevron keeps verdicts and comparisons; four of six `*Detail.tsx` panels shed their
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

Before a step event uses the queue, separate duplicate/replay from unmet-prerequisite
handling. Today every HTTP 409 is disposed before `stalledTripIds` can retain anything:

- duplicate or replayed event → success or safe disposal;
- unmet prerequisite or out-of-order event → retain and retry.

Use a distinct status, typed error body, or endpoint contract; a bare 409 cannot represent
both. Add queue tests proving the prerequisite case survives and blocks later entries for
the trip while the duplicate case drains safely.

Retire `usePhaseDraft.ts` **last**, and only once every step emits.

- **Demonstrable:** one step — start with departure's `2-capture-seal` — producing a live
  event with a true `occurred_at`, with the offline bracket rendering the sync gap.
- **Verification:** existing offline-queue tests stay green; new drain tests cover duplicate
  and prerequisite failures; `occurred_at ≠ recorded_at` survives the round trip; the derived
  path still produces identical rows for steps that have not migrated.
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
| `db/models/evidence.py`, `schemas/evidence.py` | S0.3 | Adds nullable phase/step attribution to the existing artifact contract |
| `api/v1/endpoints/artifacts.py`, `orchestration/artifact_service.py` | S0.3–S0.4 | Validated attributed upload and post-commit event |
| `orchestration/phase_service.py` | S0.3, 2, 3 | Completion-time attribution guard; later derivation and anchor sequencing |
| `migrations/versions/` | S0.3, 1 | Hand-write changes and coordinate revision heads |
| `core/phase_meta.py` | S0.3, 1 | Minimal evidence-producer catalogue, later expanded; `STEP_SLUGS` stays separate |
| `shared/lib/types/evidence.ts` | S0.3 | Both frontends consume the attributed artifact read shape |
| `dispatcher/lib/realtime/useLiveResource.ts`, `hooks/useTripArtifacts.ts` | S0.4 | Kind-filtered refetch of the separate artifact resource |
| `db/models/__init__.py` | 1 | Every migration depends on it |
| `db/models/enums.py` | 1 | `ActorType` |
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

**D-10 · Are exceptions act rows?** (§4) ✅ Decided yes and shipped in `76afa19`.

**D-11 · Where does severity gating live?** (§4) ~~Recommended: `RealtimeKind` and the
provider, not the toast component — so §9.4's debounce has one home.~~

> **Amended 2026-09-05 — taken, and not as recommended.** Half of this shipped, half was
> wrong. The half that held: ranking does not live in the toast component. The half that did
> not: it is **not** `RealtimeKind`, and it is not in the provider either.
>
> Encoding loudness into the kind conflates *what changed* with *how much it matters*, and
> the conflation produced a real inversion. Ranking on kind meant `exception_service` could
> not participate — every driver-raised exception published as the ordinary kind while
> system-detected seal checks published as the loud one, so **a panic button pressed during a
> hijacking reached the dispatcher quieter than an automated parcel-count mismatch.**
>
> Shipped instead (`4b5512c`): a `severity` field on `TripEvent` (`core/realtime.py`,
> `EventSeverity` + `event_severity()`), derived from the same value written onto the
> `TripException` row so the two cannot drift; and ranking in
> `frontend/dispatcher/lib/realtime/ranking.ts` — a pure module with no React imports, the
> same split `sse.ts` already makes for frame parsing. Not the provider: a function that can
> be unit-tested without standing up an SSE stream and two context providers is worth more
> than one that cannot.
>
> **§9.4's debounce still has one home, and it is `ranking.ts`.** That is the only place
> that sees every event, so it is the only place that can weigh one against another — which
> is the property D-11 was actually asking for. Stage 4 should extend that module, not the
> provider and not `RealtimeKind`.
>
> The gate that matters when the ledger joins this channel: `toastForEvent` bails on
> `severity === 'info'`. Without it a resolution (published as `exception_raised` at INFO so
> the queue refetches) raised a sticky red alarm on every colleague's screen. Any ledger kind
> that rides this channel for refetch purposes must publish at INFO for the same reason.
>
> See [2026-09-04-exception-queue-scaling.md](2026-09-04-exception-queue-scaling.md) for the
> subscription-filter work this makes possible, and
> [../2026-09-03-sprint6-remaining-plan.md](../2026-09-03-sprint6-remaining-plan.md) §8 for
> the same correction recorded against FP-147's original `TAMPER_DETECTED` design.

**D-12 · Where are anchored-phase children materialised?** (Stage 3) They cannot be created
only in `_finish_phase`, because departure and confirmation dispatch their anchors first.
*Recommendation: one idempotent materialisation helper, called pre-anchor by those two
wrappers and by `_finish_phase` for unanchored phases.* Take this before Stage 3 and preserve
the current anchor count.

Still blocked, and routed around rather than through: **Q1** (do not create
`expected_seal_number`), **Q2** (gates FP-155), **Q3** (gates Stage 6's headline events),
and the scan feed (gates the warehouse events).

---

## 9. Corrections to the source notes

Verified during the 2026-09-02 audit and retained with later status amendments; the code was
right and the source notes were stale at that point.

| Note | Says | Actually |
|---|---|---|
| Parent §10 | "20 revisions on disk" | **28** |
| Parent §10 | "Every `advance_*` path derives step events from the payload" | One funnel, six identical call sites, and derivation should read the **row** (§1.1, §1.2) |
| Parent §6 | `core/phase_meta.py` ↔ `phase-meta.ts` duplication needs the server to win | Already test-enforced both ways by `tests/unit/test_phase_meta_contract.py`, which parses the TS file. The §6 row about **`phase_plan.py` ↔ `mocks/phase-trips.ts`** is the one with no test — that gap is real |
| Iteration 3 §3 | "six system-detected exceptions bypass `enqueue_event`" | **Eight** — `phase_service.py` ×6, `trip_service.py:565`, `scan_service.py:344` |
| — | *(unstated on 2026-09-02)* | The dispatcher exception surface was **mock-backed**; FP-146 has since replaced it (§1.4) |

---

## 10. The order

1. **Iteration 3:** keep FP-149; ship S0.3's attributed capture-event rail on `dev/design`
   first and then the real trip page; ship S0.4's INFO upload event **with** its
   kind-filtered artifact consumer; prove the 11-phase density case; decide D-8. S0.1 and
   S0.2 remain independently valuable if still unassigned.
2. **Iteration 3 quiet window:** FP-167, the `phase_service.py` split — also preparation for
   Stage 2.
3. **Iteration 4:** Stages 1 → 2 → 4 deliver the complete read-side ledger. Take D-9 and
   D-12, then Stage 3 adds honest anchor coverage for the phases that are actually anchored.
   Stage 5 migrates live step writes only after the queue distinguishes duplicate from
   prerequisite failures. Stage 6 follows as its actor/scan blockers clear.
4. **Iteration 4 architecture checkpoint:** decide whether `ParcelScanEvent` and
   `phase_steps` remain separate observation logs or converge. Do not leak either schema
   into the other during Iteration 3.

The full ledger is the right central design, but not the right Iteration 3 blast radius. The
attributed capture-event rail is the useful slice to ship now: visible, honest about what it
does not cover, and directly extensible by the complete ledger.
