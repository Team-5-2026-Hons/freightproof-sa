# Phase Model — Replacing "Handshakes" with "Phases" (Assessment + Redesign Spec)

**Date:** 2026-07-23
**Author:** Ciaran (with Claude acting as reviewing systems analyst)
**Status:** DRAFT for team review — no code changed by this document. Decide, then plan, then build.
**Trigger:** RTT facility visit (~2026-07-16) + team discussion to rename/reframe the custody lifecycle.

> **How to read this.** This is an analyst's assessment of a proposed model, not a build order.
> Sections 1–6 answer *does this make sense, is it possible, how big, is it worth it.* Sections
> 7–10 pin down the refined model (what happens / who interacts / what the system does / who sees
> what, per phase). Sections 11–15 are feasibility, sizing, risks, and open questions for the team
> and for RTT/LFG. Every recommendation is a **proposal to confirm**, tagged where it depends on an
> answer we don't yet have.

---

## 1. TL;DR — the verdict up front

1. **Yes, the Phase model makes sense.** "Phase" is a more honest word than "Handshake" — at most
   of the six current steps there is no two-party handshake, just an event being recorded. The
   reframing (loading happens before the driver arrives; in-transit is a first-class phase; the
   driver never sees the cargo count) is **correct** and matches both the facility visit and our own
   2026-07-02 architecture review.

2. **Most of it is not new work — it's a clearer lens on work already on the roadmap.** The
   semantic improvements in the proposal (server-side reconciliation, driver-never-sees-count,
   seal-after-loading, plan-driven sequencing) are already itemised as F1–F11 and §7 in
   `docs/design-notes/2026-07-02-pp-api-handshake-architecture-review.md`. That's a good sign: the
   Phase model is coherent with where we were already heading. It is **not** a fresh rebuild.

3. **One part is not buildable on the real PP API we have.** P1/P2/P5 depend on "poll Parcel
   Perfect until loading/unloading is complete." The documented `ecomService v28` surface has **no
   scan-out/scan-in status and no manifest endpoint** (2026-07-02 review §1). This is **mock-now,
   negotiation-later** — it does not sink the model, but the demo must not over-claim it.

4. **The refactor is possible; size depends entirely on how we scope it.**
   - *Vocabulary + UX reframe only* (keep internal code identifiers, change copy + docs + add a
     phase-descriptor layer): **small–medium, ~2–4 days, low cross-dev risk.**
   - *Deep rename* (enum values, DB-stored strings, ~90 frontend files `H*`→`P*`, endpoints,
     schemas, tests): **large, 1–2+ weeks, high collision risk with Tim's driver-pwa branch.**

5. **Is it worth it? Yes — but not as a standalone big-bang rename.** Adopt the **vocabulary and
   the reframing now** (cheap, high clarity, exam-defensible), and fold the **structural** changes
   into the already-planned iteration-3 *plan-driven / per-stop* refactor (§7 of the 2026-07-02
   review). Doing a hard-wired `P0–P6` rename *now* would make us pay the refactor cost twice,
   because the linear 7-phase shape hard-wires the same assumptions the per-stop model has to undo.

**Bottom line:** rename and reframe conceptually now; converge the *implementation* onto a
plan-driven phase ledger in iteration 3; treat PP load/unload polling as mock-first.

---

## 2. What exists today (the thing we're proposing to replace)

Source of truth: `backend/app/db/models/enums.py`, `orchestration/handshake_service.py`,
`db/models/handshakes.py`, `schemas/handshakes.py`, and `frontend/shared/lib/constants/handshake-meta.ts`.

**Six handshake types, one linear state machine:**

```
HandshakeType:  trip_creation → origin_gate_in → loading → origin_gate_out → dest_gate_in → unloading
TripStatus:     created → origin_gate_in → loading → origin_gate_out → in_transit → dest_gate_in → unloading → closed
                (+ cancelled, exception_hold)
```

| # | Handshake | Trip status after | Anchored? | Driver-facing steps (today) |
|---|-----------|-------------------|-----------|-----------------------------|
| H0 | Trip Creation | `created` | **Fail-closed** (journey lock) | none (dispatcher) |
| H1 | Origin Gate-In | `origin_gate_in` | Fail-open (geofence verdict) | approach-gate, entry-photo, verification |
| H2 | Loading | `loading` | Fail-open | arrive-bay, linehaul, waybill, **seal**, review |
| H3 | Origin Gate-Out | `in_transit` | Fail-open | approach-exit, exit-and-seal, departure |
| H4 | Destination Gate-In | `dest_gate_in` | Fail-open | approach-dest, entry-photo, seal-verify |
| H5 | Unloading | `closed` | Fail-open | hand-waybill, seal-break, visual-count, pod-photo, reconciliation, closed |

**How it's wired (this is what makes a rename non-trivial):**

- **`TripStatus` *is* the sequencer.** `_load_trip_for_handshake()` gates each step on
  `trip.status == expected_status`. The status enum and the handshake order are the same thing.
- **`UNIQUE(trip_id, handshake_type)`** — exactly one LOADING per trip, forever. Blocks multi-stop.
- **`sequence_number = list(HandshakeType).index(...)`** — enum declaration order is load-bearing.
- **Frontend is fixed-length 1–5.** `HANDSHAKE_STEP_COUNTS: Record<HandshakeNumber, number>`,
  `STEP_SLUGS[1..5]`, `nextHandshakeRoute(handshake: 1|2|3|4|5, …)`, route param `[h]`, and ~20
  per-handshake step components (`H1GateArrival.tsx` … `H5Reconciliation.tsx`).
- **~90 files reference "handshake"** across backend + frontend + tests (`git grep -il handshake`).

**Settled anchor policy (Ciaran, 2026-07-14, confirmed in the H1 geofence spec):** **H0 is the
only fail-closed anchor; every other event is fail-open** — it records regardless of chain
availability; Hedera *verifies* the record, it does not *gate* it. This maps cleanly onto phases
and we keep it.

**What the facility visit already confirmed we got right** (so we don't relitigate it):
trip = one leg; return leg = new trip; departure is a distinct gate-out event; seal is first-class
evidence; per-consignment origin/destination; empty legs; driver swaps; planned-vs-actual times.
The `Consignment` model already carries `unit_count_expected`, `pickup_stop_id`, `delivery_stop_id`,
`pp_manifest_number`, `pp_raw_json` — so the per-stop/multi-consignment groundwork is largely laid.

---

## 3. The proposed Phase model (restated)

As given, seven phases P0–P6:

| Phase | Name | Core idea in the proposal |
|-------|------|---------------------------|
| P0 | Trip Creation | Unchanged — works today (journey lock → Hedera). |
| P1 | Loading | Truck is loaded by warehouse staff, usually **before** the driver arrives; backend pulls loading status from PP once activated, until loading is complete. |
| P2 | Trip Activation | Driver reaches the truck, opens an upcoming trip, activates it. Triggers the PP loading pull. System checks truck is in the right place, matches the driver's phone location, and has the correct trailer. |
| P3 | Begin Transit | Once loading is complete: capture the seal, then flip to in-transit. |
| P4 | In Transit | The journey itself — departure → exceptions en route → arrival. Tracked mainly by Pulsit, cross-checked against the driver's phone. |
| P5 | Unloading | Driver confirms unloading has begun; backend polls PP for unload status to completion. Seal is compared to the original **before the truck is opened**. |
| P6 | Confirmation | Trip concluded; driver captures POD/anything confirming delivery. System confirms (hidden from the driver) that everything loaded came off, via PP. |

The proposal explicitly asks: **should P1 and P2 be swapped?** (See §8 — yes, recommended.)

---

## 4. Assessment — what's right, what's an improvement, what's a risk

### 4.1 Genuine improvements (adopt these)

- **"Phase" over "Handshake" is more honest.** Only P2↔system and P6 (POD attestation) are truly
  two-party. Calling the rest "handshakes" oversells them. The rename improves the exam-defensibility
  of the vocabulary — you can explain what each phase *is* without pretending a handshake occurred.
- **Loading is a background process the system observes, not a driver task.** This directly fixes
  the facility-visit tension (§4.2A of the findings): the driver never enters the warehouse, never
  sees the load. Modelling loading as *polled* rather than *driver-attested* is correct.
- **Driver never sees the cargo count; reconciliation is hidden (P6).** This is exactly F1 in the
  2026-07-02 review (the driver currently *types* the PP scan-in count — a leak **and** a collapse
  of the "three independent counts" into one source). The Phase model bakes in the fix. **Strong yes.**
- **In-Transit is elevated to a first-class phase (P4).** Today the journey is checkpoint machinery
  hanging off `in_transit`, not a phase. Naming it makes the hourly driver↔hub calls, Pulsit-vs-phone
  cross-check, and arrival a coherent evidence unit.
- **Seal captured after loading, at departure (P3).** Matches the facility finding ("when loaded,
  doors shut, coded seal applied") and the review's seal-segment direction. Today the seal is
  captured mid-H2 (loading) and re-touched at H3 — consolidating capture at departure is cleaner.
- **Separating Unloading (P5) from Confirmation (P6).** Splitting "seal-check + unload" from
  "POD + reconciliation" is a reasonable, honest decomposition of today's overloaded H5.

### 4.2 Risks / regressions to resolve before building

- **R1 — The guard / gate scan disappears.** The facility visit was explicit and **[CONFIRMED]**:
  at both origin and destination a **guard scans the truck at the gate, sees the waybills/manifest,
  and records that this truck with these goods left/arrived at a specific time.** That is an
  *independent witness* — arguably the strongest non-driver evidence in the whole chain. The Phase
  model folds gate-in/out into driver-driven activation (P2) and departure (P3) and relies on
  GPS/Pulsit instead. **Decision needed:** does a phase capture the guard's gate scan (via a
  zero-login guard page, as CLAUDE.md envisions, or via a PP/RTT gate-system feed), or do we
  knowingly trade the guard witness for a driver-phone geofence? Losing an independent witness to
  simplify the UI is a real evidence cost, not a free simplification. *(Open question §15.)*

- **R2 — PP load/unload polling has no real data source yet** (the big one — see §6).

- **R3 — A linear 7-phase model re-hard-wires the single-leg assumption.** The proposal is a
  *linear* P0→P6 walk. But cross-dock reality (facility §1) is **multi-stop**: a truck can pick up
  and drop at intermediate hubs, re-seal per leg, and a waybill's final destination can be beyond
  this trip. If we implement P0–P6 as fixed functions the way H0–H5 are fixed functions, we rebuild
  the exact wall (`UNIQUE(trip_id, handshake_type)`, status-as-sequencer, fixed-length frontend)
  the 2026-07-02 review §7 says to tear down. **The Phase vocabulary must sit on a plan-driven
  ledger, not a second hard-wired enum walk** (see §10).

- **R4 — "Correct trailer" check at activation (P2) needs Pulsit, which we don't have.** The
  location check can be done with the driver's phone GPS (we already do a haversine geofence verdict
  at H1). But "has the correct trailer" implies reading trailer identity/telemetry — that's Pulsit,
  and Pulsit isn't integrated. Buildable as: verify the *assigned* trailer(s) from `TripTrailer` and
  display an honest "trailer telemetry not yet cross-checked" line, exactly as H1 does for horse GPS.

- **R5 — Activation timing vs. warehouse access.** The driver isn't allowed on the warehouse floor
  and waits in the yard. So at P2 the driver's phone is near the yard, not the loading bay. Whether
  the geofence at activation should target the *precinct* (depot) rather than a specific gate is an
  open modelling question (the H1 spec already flags "one centre+radius proves *inside the depot*,
  not *which gate*"). Recommend precinct-level geofence at activation; per-gate is a later refinement.


### 4.3 Things the proposal leaves unspecified (we must decide)

- **Who attests at P6 / unloading, in the hub cross-dock case?** At a hub, unloading is done by hub
  staff, not a "receiver." The one-time-OTP *receiver* role (CLAUDE.md) fits *final delivery*, not a
  linehaul leg that ends at another hub. So P6's POD may be a hub-staff touch-on-glass, not a
  customer signature. (This is F10 / BQ2 territory — "cargo officer signs on the driver's device.")
- **What exactly can the driver see?** Facility §1.6 is only *mostly* settled: driver knows the
  **weight**, and *"pretty sure"* the **number of items/boxes** — needs confirming. This sets what
  P1/P2 may show the driver without breaching the linehaul boundary.

---

## 5. The biggest structural clarification: phases are a *view*, the ledger is the *truth*

The single most important recommendation in this document:

> **Do not encode P0–P6 as six more hard-coded functions and a new status enum.** Encode the
> *events* in a handshake/phase **event ledger**, keep `TripStatus` coarse
> (`CREATED → ACTIVE → CLOSED` + `CANCELLED`, `EXCEPTION_HOLD`), and let the backend compute *"which
> phase is the trip in and what's the next valid phase"* from the ledger. The Phase names then become
> **descriptors served to the UI**, not branches in a state machine.

This is exactly §7.1 of the 2026-07-02 review ("Trip status goes coarse; the handshake ledger
becomes the state machine"). If we adopt it, the Phase rename and the multi-stop unblock become the
**same** piece of work, done once. If we don't, the rename is throwaway.

Degenerate single-leg mapping (today's demo path, one code path forever): a two-stop trip's ledger
*is* P0→P6. A three-hub trip's ledger is P0 → {activate, load, seal, depart} → {arrive, unload,
reseal, depart} → {arrive, unload, confirm}. Same phase vocabulary, plan-driven length.

Need to go a bit deeper into this.
---

## 6. Feasibility flag — Parcel Perfect polling (read this before promising P1/P2/P5)

**Claim in the proposal:** the backend polls PP for loading progress (P1/P2) and unloading progress
(P5) until complete.

**Reality (2026-07-02 review §1, from the actual `ecomService v28` docs + Postman collection):**

- The documented PP API is `ecomService v28` — *"a web services interface between an ecommerce site
  and a Parcel Perfect environment"* for **quotes and collection bookings**.
- It has **no scan-out/scan-in status**, **no scan-event history**, and **no manifest endpoint**.
  `manifest` is just an integer ("last manifest number") on a waybill — you cannot enumerate the
  waybills on a manifest, and you cannot observe "loading is 60% done" or "unloading complete."
- The only weak signal available is polling `getSingleWaybill` and watching `manifest` turn
  non-zero (= "this waybill has been manifested"). That is **not** a loading-complete signal.

**Implication for the Phase model:**

- P1/P2/P5's "poll PP until complete" is **not buildable on the real API we have.** It is buildable
  against the **mock manifest service** now (which returns a shaped `getSingleWaybill` envelope), and
  becomes real **only if the PP negotiation lands operational data** (the review's §4.4 ask list:
  manifest contents by number, scan-event history, destination scan-in status).
- **Recommendation:** design P1/P2/P5 around the *mock* now, with the real PP wire-shape (the
  `integrations/parcel_perfect.py` client already exists mock-first). Write into the demo script,
  in plain words, that load/unload *completion* is simulated pending the PP data agreement. Do **not**
  demo it as if PP is telling us loading finished — that's the kind of over-claim that damages the
  evidence story if a reviewer probes it.

This does not kill the model. It scopes it honestly: the *evidence phases the driver drives*
(activate, seal, depart, in-transit, POD) are fully buildable now; the *PP-observed phases*
(loading/unloading completion) are mock-first.

---

## 7. Refined phase model — recommended

Incorporating §4–§6: P1/P2 swapped (§8), guard decision surfaced (R1), plan-driven ledger (§5),
mock-first PP (§6), fail-open anchors except P0.

Legend for actors: **D** = driver · **Sys** = FreightProof backend · **Disp** = dispatcher/control
hub · **WH** = warehouse/dimensioning staff (no account) · **G** = gate guard (no account today) ·
**PP** = Parcel Perfect (read-only) · **Pulsit** = tracking (not yet integrated).

### P0 — Trip Creation *(dispatcher; unchanged)*
- **Happens:** dispatcher builds the trip from PP consignments (waybills), assigns driver/horse/
  trailers/route/stops, commits.
- **Interacts:** Disp (creates). Sys (validates, computes journey lock hash, anchors).
- **System does:** compute journey lock hash over trip + ordered stops + consignment↔stop
  assignments + PP snapshots (FP-113); **fail-closed anchor** to Hedera (the birth certificate).
- **Captured:** committed trip params, PP `pp_raw_json` snapshot per consignment, lock hash.
- **Sees:** Disp sees everything. Driver sees nothing yet.
- **Maps to:** H0. **No change.**

### P1 — Trip Activation *(driver's first action)* — was P2
- **Happens:** driver arrives at the yard, opens their upcoming trips, taps one, activates it. This
  is the driver **taking custody** and the trigger that opens the loading-observation window.
- **Interacts:** D (activates). Sys (verifies + opens PP poll window).
- **System does:** (1) geofence verdict — haversine(driver phone, origin precinct) vs radius, stored,
  display-only (reuse the H1 pattern); (2) confirm assigned horse + trailer(s) from `TripTrailer`
  (identity match now; Pulsit telemetry cross-check later — honest "not yet cross-checked" line);
  (3) **fail-open anchor** of the activation event (verdict + timestamp hash). (4) start the P2 PP poll.
- **Captured:** driver phone GPS, geofence verdict + distance, assigned vehicle/trailer identity,
  activation time.
- **Sees:** D sees "trip active, waiting for loading." Disp sees verdict badge + coordinates + honest
  Pulsit-pending line. **Driver does not see cargo contents.**
- **Maps to:** H1 (origin gate-in) — reframed from "gate arrival" to "custody activation." **R1:** if
  we keep the guard gate scan, it attaches here as an independent witness.

### P2 — Loading *(system-observed; driver waits)* — was P1
- **Happens:** warehouse staff load the truck (may already be underway or complete when the driver
  activates). The system observes progress; the driver cannot enter the floor.
- **Interacts:** WH (load — no account). Sys (polls). D (waits; no data entry).
- **System does:** poll the manifest source (**mock now / PP-negotiation later**, §6) inside the
  active window only (Celery, `PP_POLL_INTERVAL_SECONDS`, backoff) until "loading complete";
  snapshot the manifest + system origin count onto the phase event (fixes F6); **fail-open anchor**
  of the loading snapshot hash.
- **Captured:** manifest snapshot (`parcel_manifest_snapshot`), system origin count
  (`parcel_count_origin`, unit grain), loading-complete timestamp.
- **Sees:** Disp sees full manifest + counts + progress. **Driver sees only a status ("loading… /
  loading complete") and at most weight/piece count if §4.3 confirms** — never the manifest.
- **Maps to:** H2 (loading), minus the driver's seal/count data entry (those move to P3 / are dropped).

### P3 — Departure & Seal *(driver)*
- **Happens:** loading complete, doors shut, coded seal applied and locked by WH. Driver photographs/
  captures the seal, confirms departure; trip goes in-transit.
- **Interacts:** WH (applies seal). D (captures seal number + photo, confirms departure).
  G (departure gate scan — **R1 decision**). Sys (records, anchors).
- **System does:** persist seal number + seal photo; recompute `onboard()` (which consignments are on
  the truck, from *executed* load events); **fail-open anchor** of {seal hash, departure time,
  onboard snapshot hash, seal photo hash} (fixes F4's thin-hash problem).
- **Captured:** seal number, seal photo, actual_departure_at, onboard set.
- **Sees:** D sees the seal step + "depart" CTA. Disp sees seal + departure + onboard-by-client.
- **Maps to:** H3 (origin gate-out) + the seal-capture half of today's H2.

### P4 — In Transit *(system + driver check-ins)*
- **Happens:** the journey. Pulsit tracks the truck; driver's phone is cross-checked; hourly
  driver↔hub "all-well" calls; exceptions en route; arrival at destination.
- **Interacts:** Pulsit (primary track, not yet integrated). D (phone pings, panic/exception,
  hourly check-in). Disp (monitors). Sys (checkpoint batching, arrival detection).
- **System does:** batch checkpoints into Merkle batches, **fail-open**, anchored periodically (not
  per-ping); route-deviation / checkpoint-timeout detection (recorded, not enforced — "evidence, not
  operations"); mark arrival (`actual_arrival_at`). Absence of an expected hourly check is itself
  signal (`CHECKPOINT_TIMEOUT`).
- **Captured:** checkpoint pings (phone; Pulsit later), exceptions, arrival time.
- **Sees:** Disp sees live track + exceptions. D sees own progress + can raise exceptions/panic.
- **Maps to:** currently the checkpoint machinery on `in_transit` — **elevated to a named phase.**

### P5 — Unloading *(driver confirms start; system observes; seal checked first)*
- **Happens:** at destination, driver confirms unloading has begun. **Before the truck is opened,
  the seal is compared to the one applied at P3.** Then hub staff unload; system observes completion.
- **Interacts:** D (confirms unload start, verifies/records seal intact + number **before opening**).
  WH (unloads — no account). Sys (seal comparison, polls unload status). G (arrival gate scan — R1).
- **System does:** compare `seal_at_destination` to the P3 seal → match = continue; mismatch =
  `SEAL_MISMATCH` (CRITICAL) → `EXCEPTION_HOLD` (this is the physical twin of "record hash ≠ Hedera
  tx"); poll unload status to completion (**mock now**, §6); **fail-open anchor** of the seal-verify
  event.
- **Captured:** destination seal number + photo, seal-match verdict, unload-complete timestamp.
- **Sees:** D sees "check seal → confirm intact → confirm unloading." Disp sees seal verdict +
  unload progress. Driver does **not** see PP counts.
- **Maps to:** H4 (dest gate-in, seal verify) + the seal/unload half of H5.

### P6 — Confirmation *(driver POD; system reconciles, hidden)*
- **Happens:** trip concluded. Driver captures POD (photo **and** on-device signature — BQ2). System
  confirms, **without showing the driver**, that everything loaded came off (count reconciliation).
- **Interacts:** D (POD photo + signature — or hub-staff touch-on-glass, §4.3). Sys (reconciliation).
  Disp (reviews reconciliation result). PP (corroborates, read-only).
- **System does:** run the **three-count reconciliation server-side** — system origin count (P2) vs
  system/PP destination count vs driver visual (if any) — the driver never types or sees the PP
  number (fixes F1); on mismatch raise `WAYBILL_COUNT_MISMATCH` (WARNING — trip still closes,
  dispatcher reconciles); **fail-open "delivery" anchor** of {POD photo hash, signature hash,
  reconciliation result, unload snapshot hash}; set trip `CLOSED`.
- **Captured:** POD photo + signature, reconciliation result, closed_at.
- **Sees:** D sees "capture POD → done." **Reconciliation result is dispatcher-only.** Disp sees the
  full per-client evidence chain.
- **Maps to:** the POD + reconciliation half of H5, with the reconciliation input **removed** from the
  driver surface (now an await/result screen).

---

## 8. The P1↔P2 ordering question — recommendation: **swap them**

You asked whether Loading and Activation are the wrong way round. **Yes — put Activation first**
(as in §7). Reasoning:

- **The driver's activation is the first thing the *system* can witness.** Loading is a physical
  process the system only *observes*, and it can only observe it once there's an active trip and an
  open poll window — which activation creates. So as an *evidence sequence*, activation precedes the
  loading observation even though the physical loading may have started earlier.
- **It resolves the awkwardness** of "P1 Loading" being a phase whose data is actually captured
  during "P2 Activation."
- **It handles "already loaded on arrival" cleanly:** driver activates → system polls once → finds
  loading already complete → driver proceeds straight to seal/departure. No special-casing.
- **Keep the *narrative* you had** — "the truck is loaded before the driver arrives" is true and
  worth saying in the linehaul/UX copy. It's the *phase numbering* that flips, not the story.

If the team prefers to keep "Loading" as the first *named* phase to honour physical chronology, that
is defensible as UX narration — but implementation-wise, **activation is the entry point and the poll
trigger.** Don't build a "Loading" state the system can enter before the driver activates.

---

## 9. Actors & visibility — consolidated matrix

The proposal asks for "who sees what and who interacts" per phase. Consolidated:

| Phase | Driver interacts | System does (auto) | Dispatcher sees | Driver sees | Guard/WH |
|-------|------------------|--------------------|-----------------|-------------|----------|
| P0 Creation | — | lock hash, fail-closed anchor | everything | nothing | — |
| P1 Activation | activates, phone GPS | geofence verdict, trailer match, open poll, anchor | verdict, coords, vehicle | "active, awaiting load" | G: gate scan? (R1) |
| P2 Loading | waits | poll (mock/PP), snapshot, count, anchor | manifest + counts + progress | status only (+wt/pieces?) | WH loads |
| P3 Departure/Seal | capture seal, depart | onboard(), anchor seal+departure | seal, onboard-by-client | seal step, depart CTA | WH seals; G: gate scan? |
| P4 In Transit | pings, check-ins, exceptions | checkpoint batches, arrival, anchor | live track, exceptions | own progress | — |
| P5 Unloading | verify seal, confirm unload | seal compare, poll unload, anchor | seal verdict, progress | seal check, confirm | WH unloads; G: gate scan? |
| P6 Confirmation | POD photo + signature | **hidden** reconciliation, delivery anchor, close | full evidence + reconciliation | "capture POD → done" | WH/receiver signs? (§4.3) |

**Invariant across all phases (the linehaul boundary):** the driver surface never exposes manifest
contents or PP counts. Everything the driver "confirms" is either physical (seal, POD photo) or their
own observation — never a number handed to them from the system of record. This is the single rule
that keeps the "three independent sources" evidence claim intact.

---

## 10. Architecture recommendation (how to implement without paying twice)

1. **Coarse `TripStatus`:** `CREATED → ACTIVE → CLOSED` (+ `CANCELLED`, `EXCEPTION_HOLD`). Stop using
   the status enum as the phase sequencer.
2. **Phase event ledger:** keep `HandshakeEvent` (rename to `PhaseEvent` only if we do the deep
   rename — see §11), add `trip_stop_id` (nullable FK) and change uniqueness to
   `(trip_id, trip_stop_id, phase_type)`. `sequence_number` comes from the *committed plan*, not enum
   order.
3. **Server computes the next valid phase** (`GET /trips/{id}/next-phase` conceptually): "previous
   phase in the plan is COMPLETED/OVERRIDDEN and no EXCEPTION_HOLD active."
4. **Frontend becomes plan-driven:** replace `Record<HandshakeNumber, …>` constants and the `[h]`
   1–5 route with a server-served ordered list of phase descriptors (type, stop, step recipe). The
   *step recipes* (which capture components, in what order) stay static per phase type; only the
   *sequence* becomes data. Keep URL-as-state (it's a good pattern — key it by phase-event id or
   `stop/{k}/{type}`). Keep the generic capture components (`CameraCapture`, `SealInput`, `GpsCapture`,
   `SignaturePad`, `EvidenceReview`) — they're already right-shaped.
5. **Anchor payloads get fatter (F4):** every anchored phase folds artifact SHA-256s + GPS +
   timestamps + snapshot hash into its canonical payload, so photos/counts can't be swapped
   undetected. Do this *before* wiring more anchors.
6. **Idempotent phase completion (F9):** re-submitting an already-completed phase with the same
   evidence returns current trip state (200), not `HandshakeSequenceError`. Use the offline-queue
   entry `id` as the idempotency key. N3 dead zones make this the normal case, not an edge case.

Adopting 1–6 *is* the iteration-3 per-stop refactor. The Phase rename rides on top of it for free.

---

## 11. Refactor feasibility & sizing

**It is possible.** The question is scope. Two coherent scopes:

### Scope A — Vocabulary + UX reframe (recommended first step)
Keep internal identifiers (`HandshakeType`, `handshake_events`, `advance_h*`) — change **user-facing
copy, docs, and add the phase-descriptor layer.**

| Area | Work | Size |
|------|------|------|
| Copy/labels | `handshake-meta.ts` names, driver-pwa step copy, dispatcher timeline labels | S |
| Docs | CLAUDE.md "Five handshakes" prose (stale — lists 5, code has 6; needs 4-reviewer PR), Technical Full Picture v1.1, glossary | S |
| Phase-descriptor endpoint | `GET /trips/{id}/phases` returning ordered descriptors (thin; reads existing events) | M |
| Reconciliation → result screen | remove driver PP-count input (F1), make P6 an await/result screen | S–M (Tim) |
| Tests | update copy assertions | S |

**Estimate: ~2–4 focused days. Low cross-dev risk** (no enum/DB/route-shape churn). Delivers the
clarity win and the F1 fix without destabilising anyone's branch.

### Scope B — Deep rename + plan-driven ledger (iteration-3, do it once)
Everything in §10 plus renaming `H*`→`P*` through the stack.

| Area | Work | Size / risk |
|------|------|-------------|
| Enums | `HandshakeType`→`PhaseType`, values become DB-stored strings → **data migration** for existing rows | M, migration risk |
| `TripStatus` → coarse | rewrite `_load_trip_for_handshake` gating; derive phase from ledger | L |
| Model | `HandshakeEvent`→`PhaseEvent`, `trip_stop_id`, uniqueness `(trip, stop, type)` | M + Alembic (4-dev coordination) |
| Schemas/endpoints | `H1..H5CompleteRequest`, `/h{n}/complete` routes → phase/stop-keyed | M |
| Orchestration | `advance_h1..h5` → generic `advance_phase(plan, event)` | L |
| Frontend | `[h]` route → phase/stop route; ~20 `H*` step components regrouped; `HandshakeNumber` type; `nextHandshakeRoute`; progress bars; ~40 driver-pwa files | **L, high collision with Tim's branch** |
| Tests | ~15–20 backend + frontend test files touching handshake shape | L |

**Estimate: 1–2+ weeks, high coordination cost.** ~90 files reference "handshake." This is a real
refactor, and it should be **planned as the multi-stop / plan-driven work**, not as a cosmetic rename
— otherwise the effort buys a new name for the same wall.

---

## 12. Is it worth it? (honest cost/benefit)

- **Scope A: clearly worth it.** Cheap, improves clarity and exam-defensibility, and lands the F1
  reconciliation fix that the evidence claim depends on. Do it soon.
- **Scope B: worth it *as* the iteration-3 refactor, not before, and not as a rename for its own
  sake.** The multi-stop unblock has to happen anyway (cross-dock is the real operation). Bundling
  the Phase vocabulary into that work makes the rename free and permanent. Doing Scope B *now, as a
  standalone rename,* would be the worst option: maximal churn, maximal branch collision, and it
  re-hard-wires the single-leg shape that the same refactor then has to undo.
- **PP polling (P1/P2/P5): worth building mock-first**, because the mock has the real wire shape and
  cutover is a config change — but *not* worth demoing as real until the PP data agreement lands.

**Recommended path:** Scope A now → PP mock-first polling as part of the manifest service → Scope B
folded into the planned per-stop/plan-driven iteration-3 refactor. Three steps, no wasted work.

---

## 13. Risks & cross-dev impact

- **Tim's driver-pwa branch** owns the ~40 handshake UI files. Any deep rename (Scope B) **must** be
  coordinated with Tim, ideally sequenced after his in-flight work merges. Scope A copy changes are
  low-risk but still worth a heads-up.
- **Shared files:** `db/models/enums.py`, `db/models/__init__.py`, `main.py` (router registration if
  routes change), `core/config.py` (`PP_POLL_INTERVAL_SECONDS` new key), `CLAUDE.md` (4-reviewer PR).
  Flag all of these; don't touch unilaterally.
- **Migration discipline:** any enum-value or table change needs `git fetch origin`, check `dev` for
  unmerged migrations, name-tag the file (`2026_MM_DD_ciaran_*`). A DB-stored enum rename needs a
  data migration for existing rows.
- **Anchor-policy consistency:** keep H0/P0 fail-closed, all else fail-open. Converting the currently
  fail-closed H2/H5 anchors to fail-open is an existing open work item — the Phase model should
  inherit the fail-open pattern, not reintroduce fail-closed mid-trip.
- **Don't over-anchor:** P4 checkpoints must batch (Merkle), not anchor per ping.

---

## 14. What maps to what (quick reference for the team)

| Proposed | Recommended (§7) | Today | Net change |
|----------|------------------|-------|-----------|
| P0 Trip Creation | P0 Trip Creation | H0 | none |
| P1 Loading | **P1 Activation** (swap) | H1 origin_gate_in | reframe; add trailer check; PP poll trigger |
| P2 Trip Activation | **P2 Loading** (swap) | H2 loading | system-observed; driver data entry removed |
| P3 Begin Transit | P3 Departure & Seal | H3 origin_gate_out (+ H2 seal) | seal capture consolidated here |
| P4 In Transit | P4 In Transit | checkpoint machinery | elevated to named phase |
| P5 Unloading | P5 Unloading | H4 dest_gate_in (+ H5 seal/unload) | seal-before-open; PP poll |
| P6 Confirmation | P6 Confirmation | H5 unloading (POD + reconcile) | reconciliation hidden from driver |

---

## 15. Open questions

**For the team (decide these before any build slice):**
1. **Guard / gate scan (R1):** do we capture the guard's gate scan as evidence (zero-login guard page
   or PP/RTT gate feed), or knowingly rely on driver-phone geofence + Pulsit? This is an
   independent-witness decision, not a UI preference.
2. **Scope A vs B, and timing:** confirm we do Scope A now and fold Scope B into the iteration-3
   per-stop refactor (not a standalone rename).
3. **P1↔P2 swap:** agree activation-first ordering (§8)?
4. **Deep rename vs keep identifiers:** if Scope B, do we actually rename `HandshakeType`→`PhaseType`
   in code/DB, or keep internal names and only present "Phase" to users? (Recommendation: keep
   internal names until the per-stop refactor rewrites them anyway.)
5. **P6 attestation:** who signs at a hub leg — hub staff touch-on-glass, not a customer OTP receiver?

**For RTT / LFG (carry-overs from the facility findings §6, still blocking):**
6. **Seal mechanism** — who generates the seal code, is it revealed to the driver only at
   destination or verified against a control-hub record? (Decides whether P5's seal check is genuine
   tamper evidence.)
7. **Authoritative count** — who produces the count of record (dimensioning station / loaders /
   manifest) and when? (Decides what P6 reconciliation compares.)
8. **Origin gate-in reality** — for a hub-originating trip where the truck already sits in the yard,
   is there any gate-in at all? (Confirms P1 = activation, not a physical gate arrival.)
9. **Driver at destination** — does the driver stay out of the warehouse at unload too? (Affects who
   attests at P5/P6.)
10. **PP operational data** — can we get manifest-by-number, scan-event history, destination scan-in
    status (read-only)? (Decides whether P1/P2/P5 polling ever becomes real, §6.)

---

## 16. Recommendation & next steps

1. **Adopt the Phase vocabulary and the reframing** (§7) as the shared mental model — update the
   glossary, CLAUDE.md prose (4-reviewer PR), and Technical Full Picture v1.1.
2. **Do Scope A now:** phase copy + descriptor endpoint + remove the driver's PP-count input (F1).
   Small, high-clarity, unblocks the honest reconciliation story.
3. **Build PP load/unload polling mock-first** against the real wire shape; document in the demo
   script that completion is simulated pending the PP data agreement.
4. **Fold Scope B into the iteration-3 per-stop / plan-driven refactor** (§10) — coarse `TripStatus`,
   phase ledger as state machine, `trip_stop_id`, plan-driven frontend. Coordinate with Tim.
5. **Resolve §15 Q1–Q5 with the team and Q6–Q10 with RTT/LFG** before the refactor slice starts.

*This document is assessment + design input only. No code or shared file has been changed. Comments
and corrections → Ciaran.*
