# Scan-Driven Loading & Unloading — Design

**Status:** Draft for team review · **Author:** Ciaran · **Date:** 2026-08-05
**Scope:** the `loading`, `unloading` and `confirmation` phases, and the warehouse scan feed that drives them.
**Depends on:** `docs/superpowers/plans/2026-08-04-scanfeed-dev-trigger-panel.md` — **not yet built.** See §0.
**Amends:** that same plan, in three ways — see §0.2.

> **Line numbers are deliberately absent from this document.** `phase_service.py` shifted
> ~18 lines during drafting and every cited number went stale. Anchor on symbol names;
> they survive edits.

---

## 0. Prerequisites and amendments — read before planning

### 0.1 Hard dependency: the scan feed does not exist yet

This design consumes four modules that are **specified but not implemented**:

```
backend/app/integrations/scan_feed.py     ✗ absent
backend/app/integrations/mock_state.py    ✗ absent
backend/app/orchestration/scan_service.py ✗ absent
```

`backend/app/integrations/` currently contains only `parcel_perfect.py` and
`supabase_admin.py`. `Parcel.pp_scan_out_at` / `pp_scan_in_at` exist in the model and are
**written by nothing**.

**Consequence:** every gate, every derived count and the entire reconciliation rewrite in
this document reads columns that are permanently `NULL` today. Shipping this design before
the Stage 4 plan lands would block every trip at `loading` with the dispatcher override as
the only route forward. **Stage 4 must be implemented first.** This is a sequencing
constraint, not a preference.

### 0.2 Three amendments to the Stage 4 plan

1. **Phase-driving triggers, currently out of scope.** That plan excludes them on the
   reasoning that "humans drive phases on the real driver app." That reasoning held while
   scans only wrote timestamps; it does not survive the finding that the driver cannot
   honestly produce the loading count (§1). Reversed deliberately. Update that plan's
   out-of-scope table to point here rather than let the two documents contradict.
2. **The `ScanFeed` protocol gains one method** — see §3.2. Cheap to add now, because the
   protocol is written down but not yet built.
3. **The dev panel gains one trigger** — "close scan session" (§7). §7 previously claimed
   no new triggers were needed; that was wrong once the gate moved to session semantics.

### 0.3 Isolation breach — coordinate before starting

The Stage 4 plan states it touches **zero files** in `frontend/shared/` and **zero** in
`frontend/driver-pwa/`, and that *"that isolation is deliberate — preserve it"*, because
Tim's uncommitted driver-app refactor lives there.

**This design breaks that isolation on both counts:** `frontend/shared/lib/constants/phase-meta.ts`
(§4) and several files under `frontend/driver-pwa/` (§4, §5). Plus one Alembic migration
(§4). Per `CLAUDE.md`, coordinate with Tim before any of it is generated.

---

## 1. Why

Today the `loading` phase is closed by a number the driver types into his phone. Three
things are wrong with that, and they compound:

1. **The driver cannot honestly produce it.** He never enters the warehouse (security
   policy, confirmed at the 2026-07-16 site visit) and may arrive at the truck after
   loading is finished. `loading/VisualCount.tsx` instructs him to *"Count the parcels
   physically loaded"* — parcels he did not see being loaded, inside a truck he is not
   permitted to enter.
2. **It contradicts the project's own documented rule.** `manifest_service.py` records
   Bruce's constraint as *"the driver counts pallets, never parcels (Bruce, 24 Jun)"*, and
   `Consignment.unit_count_expected` exists specifically to carry pallet grain because "PP
   cannot supply" it. The driver step asks for the grain the domain expert ruled out.
3. **It makes confirmation's reconciliation circular.**
   `frontend/driver-pwa/lib/api/phases.ts` sends `pp_scan_in_count: e.driverVisualCount`,
   with the circularity flagged in an in-line comment. So `advance_confirmation`'s
   three-way check (`counts_match`) has two of its three terms sourced from the same number
   typed by the same person. It is a two-way check wearing a three-way costume.

> **Not claimed:** that `advance_loading` mixes grains. It does not — the driver step asks
> for parcels and `_expected_parcel_count` sums parcels, so the comparison is internally
> consistent. An earlier draft asserted a pallets-vs-parcels mismatch; that was wrong and
> is withdrawn. The defect is §1.1 and §1.2, which are not refutable the way the grain
> claim was.

The fix is to source the observed parcel set from the warehouse's own scan system, which
is what `docs/parcel-perfect-integration-spec.md` §B4 concluded and what the Stage 4
`ScanFeed` interface is designed to provide.

**Parcel Perfect cannot supply this.** `getSingleWaybill` is the only read method in the
entire API across v28 and v32 (spec §B1, verified against live WSDLs). What is being mocked
is the **warehouse WMS**, not a PP endpoint. This distinction matters at examination: "we
mocked a PP method that doesn't exist" is indefensible; "PP verifiably has no scan endpoint,
so we specified the warehouse feed as an interface and mocked behind it" is the finding.

---

## 2. Evidence model

| Observer | Supplies | Lands on |
|---|---|---|
| Parcel Perfect | the *expected* parcel set (`tracks[]`) | `Parcel` rows, at trip creation |
| Origin depot scan system | which parcels went **on** | `Parcel.pp_scan_out_at` |
| Destination depot scan system | which parcels came **off** | `Parcel.pp_scan_in_at` |
| Driver | linehaul confirmation, paper-sheet photo, seal chain, pallet count | `PhaseEvent` artifacts + `driver_visual_count` |

Origin and destination are two independent depot systems. That is what makes
scanned-out vs scanned-in a real check rather than a system checking itself.

### 2.1 The storage rule — read this before implementing

> **Scan evidence lives on `Parcel` rows, never on `PhaseEvent`.**
> `PhaseEvent.parcel_count_origin` / `parcel_count_destination` are *cached aggregates*,
> stamped once at phase close from `Parcel` rows that already exist.

This is the same relationship `current_phase` / `current_stop` have to the phase-event
ledger: the ledger is the truth, the aggregate is derived.

**Why it is non-negotiable:** every phase will eventually anchor to Hedera. An anchored
row whose fields are written after close no longer hashes to its Hedera tx — which is
precisely the tampering signal this product exists to detect. A late write to a closed row
would manufacture that signal on a healthy trip.

The general rule, which applies beyond this feature:

> **A phase's anchored payload may only contain data that existed when it closed.
> Anything arriving later belongs to a later record.**

You do not amend a signed document. You append. This is why the destination scan count is
stamped on the `confirmation` row rather than the `unloading` row (§5) — confirmation is
gated on scan-in, so by definition the data exists when confirmation closes. Confirmation
is not recording the scan "a phase late"; it is the first row that can honestly attest to it.

**Corollary for reconciliation:** §5 compares live `Parcel` rows, never the cached
aggregates. The aggregates are for display and for the anchored payload. Reading an
aggregate to make a decision reintroduces staleness by the back door.

---

## 3. The gate

### 3.1 Three states, not two

A derived field on `PhaseDescriptor`:

```
blocked_on: "warehouse_scan" | null
```

| Condition | `blocked_on` |
|---|---|
| No expected parcel set at this stop | `null` — **not blocked** |
| Expected set exists, warehouse scan session not closed | `"warehouse_scan"` |
| Scan session closed | `null` |

**The first row is load-bearing and was missing from the previous draft.** A trip created
without a Parcel Perfect reference has no `Consignment` and no `Parcel` rows at all.
`lib/api/manifest.ts` documents this as *"any trip created without a Parcel Perfect
reference, **which is common**. That is a normal state, not a failure."* Without this state
those trips block at `loading` forever and can only move by dispatcher override — turning
the release valve into the default path for a common, legitimate trip shape.

Every phase other than `loading` and `confirmation` is always `null`. `loading` reads
scan-out at its pickup stop; `confirmation` reads scan-in at its delivery stop.

### 3.2 Why session-closed, not "all barcodes scanned"

Gating on completeness of the scan set breaks in both directions:

- **Any scan unblocks** → the warehouse scans 2 of 3, the driver closes loading,
  `parcel_count_origin` caches as 2, and the third parcel scans a minute later. §2.1
  forbids amending the closed row, so the cached aggregate is permanently wrong.
- **All scans unblock** → a genuinely missing parcel blocks the phase forever, and the
  dispatcher override becomes the normal path rather than the exception.

**Resolution: the feed reports when the warehouse has finished, and completeness is a
finding rather than a gate.** A closed session with 2 of 3 scanned unblocks the phase and
raises a discrepancy — which is what an evidence platform should do with a short count.
It is also how a real WMS behaves, so the mock→live swap stays honest.

This adds one method to the Stage 4 `ScanFeed` protocol:

```python
async def is_scan_session_closed(
    self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
) -> bool: ...
```

`MockScanFeed` reads a separate namespaced key; the dev panel writes it (§7). Chosen over
changing `poll_scans`'s return type because it is a strictly additive change to a protocol
that is written down but not yet built.

> **Reversible decision.** If the team prefers gating on count-completeness, only §3.2 and
> the §7 trigger change; §3.1's three states and everything downstream stand as written.

### 3.3 Not a new `PhaseStatus`

`db/models/enums.py` is read by every branch and mirrored by the dispatcher's
`TripContext.tsx`; the Stage 4 plan already declined to add an `ExceptionType` for exactly
this coordination cost. A derived read-model field is additive and needs no migration.

### 3.4 Derivation must not be per-event

`PhaseEventRead.from_event` is **synchronous and pure** — it takes a precomputed
`stop_sequence_by_id` map precisely so it never touches the DB. `blocked_on` needs per-stop
scan state, so it must arrive the same way: **a precomputed `blocked_on_by_stop` map built
from one grouped query per request.**

Deriving it inside `from_event` would require either a DB call from a sync method or an
N+1 across every phase of every trip-detail response.

Four call sites, all of which must build and pass the map:

- `orchestration/trip_service.py`
- `orchestration/resource_service.py`
- `api/v1/endpoints/phases.py` — two sites (list and single-event)

### 3.5 Enforcement

Enforced twice, independently: the driver PWA renders a waiting screen off the field, and
the phase-completion endpoint rejects with `409`. The UI field alone is not enforcement — a
replayed or hand-crafted POST must not slip past.

**Ordering matters.** `_gate_and_load` returns a `TripDetailResponse` on idempotent replay.
The blocked check must run **after** that short-circuit, or a replayed successful
completion `409`s instead of returning current state — breaking the offline queue's retry
contract.

**Release valve:** `PhaseOverrideAction` (already built, backed by `trip_admin.py`)
completes a blocked row with a dispatcher note. A feed that never fires cannot strand a trip.

---

## 4. Loading

**Gated on:** scan-out session closed at this stop's pickup.

### Driver step

`STEP_SLUGS[PhaseType.LOADING]`: `("1-visual-count",)` → `("1-linehaul",)`

⚠ **`frontend/shared/lib/constants/phase-meta.ts` carries `STEP_NAMES` alongside
`STEP_SLUGS`, positionally paired.** Both need updating (`'1-linehaul'` / `'Linehaul'`), in
both the backend `phase_meta.py` and the shared TS file. `test_phase_meta_contract.py`
parses the TS file and fails if they disagree — that is the test doing its job.

New `loading/Linehaul.tsx`, a single step that does two things on one screen:

1. **Renders the digital linehaul** — `LinehaulResponse` (vehicle registration, vehicle
   type, driver name, `consolidated_unit_count`). This restores `H2Linehaul.tsx`, deleted
   in commit `493b9fe` during the phase refactor; `manifest_service.get_linehaul_for_driver`
   and `lib/api/manifest.ts::fetchLinehaul` have had no driver-side consumer since.
   (`manifest.ts`'s comment still references the deleted file — fix while there.)
   This is Bruce's stated goal from 2026-06-24: *"a digital replacement for the current
   printed linehaul/waybill."*
2. **Captures a photo of the paper linehaul sheet** the warehouse hands over. Independent
   third-party evidence of what the warehouse *claimed* was loaded, separate from
   FreightProof's own record.

Both on one screen deliberately: a driver seeing the digital and paper versions together is
what makes a divergence between them visible. Divergence is itself a finding.

**The linehaul must never show contents.** It is the driver-safe view — vehicle, seal, driver,
consolidated unit count only. `LinehaulResponse`'s docstring already enforces this; do not
widen it.

### Backend

- `LoadingCompleteRequest`: drop `driver_visual_count`, add `linehaul_photo_artifact_id`
- `advance_loading`: **delete** the expected-vs-counted comparison and its
  `PARCEL_COUNT_MISMATCH` outright. It dies with the count.
- `parcel_count_origin` is stamped at close from `Parcel` rows with `pp_scan_out_at` set at
  this stop.

### ⚠ Offline-queue migration hazard

Dropping `driver_visual_count` from `LoadingCompleteRequest` means **a loading queued
offline under the old schema replays forever and `422`s.** The team has already been bitten
by this exact class of bug — `lib/api/phases.ts`'s unloading branch carries a defensive
comment about a queued draft replaying from `localStorage` with a property absent entirely.

The implementation plan must include either a queue drain on upgrade or a draft-version
check that discards incompatible entries. Do not leave this to be discovered in the demo.

### Migration

⚠ `PhaseEvent.linehaul_photo_artifact_id` — one nullable UUID FK to `artifacts`.

The Stage 4 plan deliberately required no migration. This design breaks that. Per
`CLAUDE.md`: `git fetch origin`, check for unmerged migrations on `dev`, name the file with
the author (`2026_08_05_ciaran_add_linehaul_photo.py`). Coordinate before generating.

---

## 5. Unloading and confirmation

### Unloading — driver flow unchanged

`("1-hand-waybill", "2-seal-verify", "3-seal-break-inspection", "4-visual-count")` is
untouched, and the phase still closes on seal verification. The driver must break the seal
before the warehouse can unload, so scan-in cannot gate this phase's start; and gating its
*completion* would strand the driver mid-phase waiting on a third party.

The driver's pallet count is still captured here and carried to confirmation by
`useVisualCountCarry`.

### Why confirmation may be gated on a third party when unloading may not

The objection is fair on its face — both wait on the warehouse. Two things differ:

1. **Boundary, not mid-phase.** A blocked `confirmation` is a phase that has not started.
   A blocked `unloading` step 4 is a driver stranded *inside* a phase with completed steps
   behind him and a partially-written evidence row. Every other gate in this codebase sits
   at a phase boundary; putting one mid-phase is a second concept.
2. **The wait is real either way.** The driver cannot sign a POD before the truck is
   empty. Gating confirmation encodes a wait that physically exists; gating unloading step 4
   would additionally block his *pallet count*, which he takes while unloading happens.

### Where the destination scan lands

`Parcel.pp_scan_in_at`, written by `scan_service` whenever the feed delivers — with the
real scan timestamp, not the phase-close time. **No `PhaseEvent` is written.** See §2.1.

**The dispatcher displays these figures under the unloading phase**, because that is where
they physically happened. Display is derived from `Parcel` rows joined to the delivery stop;
it does not require the data to be stored on the unloading row. Presentation and storage are
independent decisions, and separating them is what makes anchoring safe.

### Confirmation

**Gated on:** scan-in session closed for this stop.

- `pp_scan_in_count` is **removed from `ConfirmationCompleteRequest`.** It is derived
  server-side from `Parcel` rows with `pp_scan_in_at` set at this leg's delivery stop.
  This is the fix for the circularity in §1.3.
- ⚠ **Do not rename the `pp_scan_in_count` key in the anchored canonical payload.** It is a
  key in `compute_confirmation_canonical_payload`, and `verification_service` rebuilds from
  it. Renaming it would break hash verification on **every historical trip**. Its
  provenance changes from PP to the warehouse feed; its name is now a mild misnomer, and it
  stays exactly as it is. Note the reason in a comment so a future reader does not "tidy" it.
- `event.parcel_count_destination` is stamped from the derived count at close.
  `verification_service` already rebuilds the canonical payload from
  `event.parcel_count_destination` rather than from the request, so **the anchored payload
  and the verification path are unchanged.**
- `driver_visual_count` (pallets) is still recorded and still anchored. Anchoring is not
  reconciling — dropping it from the payload would weaken the record for no gain.

### Reconciliation — scoped per consignment, not per leg

`advance_confirmation`'s `origin_count = loading_event.driver_visual_count` is removed —
loading no longer captures a driver count, so that lookup would be permanently `None`.

The replacement is **not** driven off `_find_loading_for_leg`. On a CPT→BFN→JHB run, a
consignment picked up at stop 1 and delivered at stop 3 has its scan-out at **stop 1**, not
at the loading row immediately preceding stop 3's confirmation. A leg-based comparison
produces false mismatches on exactly the cross-dock trip a reviewer is walked through
(`FP-DEMO-XDOCK-0001`).

Instead, for each `Consignment` delivered at this stop (`delivery_stop_id`), compare over
live `Parcel` rows:

```
count(pp_scan_out_at set)  vs  count(pp_scan_in_at set)
```

Parcel grain on both sides, two independent depot systems, and the consignment's own
`pickup_stop_id` / `delivery_stop_id` partition (FP-112) supplies the scoping. A difference
raises `WAYBILL_COUNT_MISMATCH` scoped to the consignment and the stop.

### Skip conditions — restated, not inherited

The two existing branches cannot simply be kept, because `origin_count` ceases to exist.

- **`if loading_event is None` (empty-leg trips) survives unchanged.** It keys on the
  loading row's *existence*, not on the driver count, and the plan generator still emits no
  loading row when nothing is picked up.
- **`elif origin_count is None` is replaced.** Left as-is it would swallow reconciliation
  on every trip, since `origin_count` becomes universally `None`.

New conditions, following `_expected_parcel_count`'s None-is-not-zero principle:

| Condition | Behaviour |
|---|---|
| No expected parcel set at this consignment's pickup stop | skip — nothing to compare |
| Loading was dispatcher-overridden and no scans exist | skip |
| Otherwise | compare |

A missing baseline means "nothing to compare", never "compare against nothing and
manufacture a mismatch".

### The pallet count — considered and deliberately not reconciled

`Consignment.unit_count_expected` is the dispatcher-entered pallet baseline, and it is the
one number the driver's pallet count could honestly be checked against — same grain, two
observers.

**Rejected for now**, for one reason: `manifest_service` already documents that
`unit_count_expected` is unset on consignments created before FP-112 and falls back to
`len(parcels)`, which is parcel grain. Reconciling against a field that silently degrades
to the wrong grain would reintroduce the exact fault §1 removes. It becomes viable once
that field is reliably populated, and is recorded here as deferred rather than unconsidered.

Until then the driver's pallet count is **recorded evidence, not an automated check** — a
dispatcher reads it, and it is never compared against a parcel count.

---

## 6. Dispatcher

| Component | Change |
|---|---|
| `LoadingDetail.tsx` | expected (PP `tracks[]`) / scanned / missing barcodes, plus the linehaul photo. Replaces today's expected-vs-driver-count and its agree/discrepancy badge. |
| unloading detail | gains scanned-in count and missing barcodes, derived from `Parcel` rows at the delivery stop (§5). |
| `ConfirmationDetail.tsx` | origin-vs-destination verdict; driver pallet count shown as recorded-only, visually distinct from a checked value. |
| `ManifestPanel` | `origin_scan_complete` becomes true for the first time — it is `all(p.pp_scan_out_at is not None)` over a column nothing has ever written. Fixed by data, not by code; do not edit `manifest_service.py`. |

---

## 7. Trigger panel

The Stage 4 plan's scan-out and scan-in triggers cover most of this. **One trigger is
added: "close scan session"** — the signal §3.2's gate reads.

That makes the demo's most important sequence expressible: stage 2 of 3 barcodes → close
the session → loading unblocks, the driver proceeds, and a discrepancy is raised. A panel
that could only stage a complete scan could not demonstrate the discrepancy path at all.

The plan's non-negotiable principle still holds and is strengthened here: every trigger
drives the mock's state and flows through real orchestration. Under this design a trigger
now visibly unblocks a real driver flow, which is a stronger demonstration than a trigger
that only writes a timestamp.

---

## 8. Testing

- **Unit** — `blocked_on` derivation across all three states of §3.1, including the
  no-expected-set case. Scoped per stop: a cross-dock trip's stop-1 session must not
  unblock stop-2.
- **Unit** — reconciliation scoped per consignment: a consignment picked up at stop 1 and
  delivered at stop 3 reconciles against **stop 1's** scan-out. This is the cross-dock
  regression test; without it a leg-based implementation passes every single-leg test.
- **Unit** — a closed session with an incomplete scan set unblocks the phase *and* raises
  `WAYBILL_COUNT_MISMATCH`. Both halves, in one test — either alone is a false pass.
- **Integration** — `409` on completing a blocked phase. This proves the gate is
  enforcement, not decoration.
- **Integration** — an idempotent replay of an already-completed phase returns current
  state and does **not** `409`, proving §3.5's ordering.
- **Integration** — `PhaseOverrideAction` completes a blocked phase and the trip proceeds.
- **Integration, anti-regression** — a phase row's field set is unchanged after close.
  This protects §2.1 once anchoring extends to every phase, and should fail loudly if
  anyone later reintroduces a post-close write.
- **Performance** — one trip-detail request issues a constant number of queries regardless
  of phase count, guarding §3.4's N+1.

---

## 9. Scope

### In

The three phases above, the `blocked_on` gate, the reconciliation rewrite, the linehaul
step, the dispatcher panels, one migration, one added `ScanFeed` method, one added trigger.

### Out

| Excluded | Reason |
|---|---|
| Building `ScanFeed` / `MockScanFeed` / `mock_state` / `scan_service` | The Stage 4 plan's job. This design **depends on** them (§0.1) and amends their interface (§3.2); it does not implement them. |
| PP drift detection (spec §B2c / Stage 5) | Its own ticket. Serious, unrelated. |
| PP field-parser widening (spec Stages 1–3) | Separate. |
| Driver-operated barcode scanning | Explicitly rejected — the driver never enters the warehouse. |
| Pulsit telemetry | Out of scope (`phase_service.py`, `pulsit_geofence_confirmed` stays null). |
| `manifest_service.py` | `origin_scan_complete` is fixed by data. |
| Pallet-count reconciliation | Deferred with a stated reason — §5. |

---

## 10. Open question — `departure/3-waybill`

`departure/Waybill.tsx` instructs the driver: *"Photograph the physical waybill. This becomes
the legal evidence copy."* This sits in tension with the theft-risk rule that governs
everything else in this design — the driver is not supposed to know the truck's contents,
and `manifest_service` enforces that on the linehaul.

The evidence is genuinely unsettled. `facility_visit_findings_2026-07-16.md` reads:

> *"the driver … **never knows what goods are actually in the truck**, however the driver
> does know the weight of the load and I am pretty sure he knows the number of items/boxes
> but **this needs to be confirmed**."*

Marked `[OPEN]` in that document, and the departure-gate step in the same notes has the
*guard* — not the driver — scanning and seeing the manifest.

**Not resolved here.** Options, for a question to Bruce:

1. Leave as-is — the driver carries and photographs the document.
2. Photograph the sealed document pouch, not its contents — preserves chain-of-custody
   evidence without putting contents on the driver's phone.
3. Remove the step — the driver carries the waybill and hands it over at
   `unloading/1-hand-waybill` but never photographs it.

Recommend (2) if the answer from Bruce is that the driver must not see contents, since it
keeps the evidence and drops the exposure. Do not change this step as part of this work.

---

## Sources

- `docs/parcel-perfect-integration-spec.md` — §B1 (no PP scan endpoint), §B3 (dead columns),
  §B4/B4b (grain division), §B4b-i (mock behind an interface)
- `docs/facility_visit_findings_2026-07-16.md` — site visit, 2026-07-16
- `docs/meeting_minutes/FreightProof_Meeting_Bruce_Minutes_24June2026.md` — §1.1 the linehaul
  document, §2.1 digitisation goal, §2.3 driver app constraints
- `docs/superpowers/plans/2026-08-04-scanfeed-dev-trigger-panel.md` — the feed this depends on
