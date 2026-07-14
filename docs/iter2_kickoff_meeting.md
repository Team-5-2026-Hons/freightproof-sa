# FreightProof — Iteration 2 Kickoff Meeting

> Pre-read, agenda, and decision register for the iteration 1 debrief and the iteration 2 vac kickoff.
> Read this before the meeting. Decisions taken in the Decision Register (Section 9) go into a follow-up `docs/scope-boundaries.md` within 48h.

| | |
|---|---|
| **Date / time** | TBD — propose this week, before vac |
| **Duration** | 90 minutes |
| **Attendees** | Ciaran, Tim, Chiko, Tom |
| **Pre-read time** | ~15 min |
| **Outputs** | 1. Decisions captured in Section 9. 2. Email to Bruce sent (Section 5). 3. Email to Ammar sent (Section 6). 4. Iter-2 Jira tickets created (Section 7). 5. `docs/scope-boundaries.md` written within 48h |

---

## 1. Context the team needs to walk in with

### 1.1 What we actually shipped in iteration 1

Looking at the 67 closed Jira tickets, iter 1 delivered the **foundation layer** — not the trip lifecycle itself:

- Project scaffolding, CI pipeline, Docker dev environment.
- Auth: Supabase sign-in, dispatcher role guards, token verification in FastAPI, RLS policies.
- Core data model: entities, relationships, Pydantic schemas, Alembic migrations, peer-reviewed schema.
- Blockchain plumbing: Hedera testnet setup, HCS topic creation, message submission, anchoring on trip / vehicle / driver creation.
- Verification endpoint with four outcomes (VERIFIED / TAMPERED / PENDING / ERROR).
- Dispatcher web app: login, dashboard, trip-creation wizard with journey-lock hash, event timeline, vehicle and driver detail pages with receipt history + on-demand verify button.
- Iter-1 deliverable documentation: UML diagrams (class, package, state, use case, network), test plan, risk assessment, wireframes, background and objectives writeup.

### 1.2 What we **didn't** ship — and why Ammar noticed

The 33 open Jira tickets are almost all **trip-lifecycle work** that wasn't built yet:

- The driver PWA itself (FP-69, FP-39 still To Do).
- Every handshake (FP-67/68 gate-in, FP-72/73/74 loading, FP-85/86 gate-out + seal, FP-89/90/91/92 destination + unloading).
- Pulsit deviation polling (FP-87), soft panic button (FP-88), Parcel Perfect manifest pull (FP-84), offline checkpoint queue (FP-70), Merkle batching (FP-63), driver substitution recording (FP-83).
- Documentation Iteration 1 epic (FP-33) still open.

Ammar's "stopping at create a trip" critique is fair — we built the rails and one carriage. The full train comes in iter 2.

### 1.3 Ammar's iter-1 feedback in one paragraph

Two axes. **UX / demo** (small, fixable): hide blockchain TX IDs, hashes, and HashScan URLs from the default dispatcher view (gate behind a super-admin or forensics toggle); drive demo simulation from the UI rather than from DB edits; show the **full 5-handshake circle** end-to-end, even if individual stages are skeletons. **Domain depth** (structural): cargo granularity (item vs box vs parcel); trailer subdivisions / cold-chain zones; multi-client consolidation on one truck; driver vs operator liability; mid-trip flexibility (vehicle breakdown, destination change, route addition); fleet availability + recommendation engine; driver availability / leave; return-leg journey; cost management. He framed all of these as design depth that should be locked in **now** so that we don't have to rip out the model later.

### 1.4 Bruce's accumulated guidance across four meetings

| Meeting | What Bruce added |
|---|---|
| **3 Mar 2026** | Pulse tracking is the integration partner of choice. Parcel Perfect is the off-the-shelf parcel system. NFC/RFID worth investigating versus barcodes. Driver communication must minimise distraction. Trusted-driver pool is the preferred fraud control, not on-the-spot verification. |
| **26 Mar 2026** | Two load types: **Full Truckload (FTL)** and **Break Bulk** (multiple courier companies share a vehicle). **Hub-and-spoke is common** even on FTL — multiple pickup and delivery legs per trip. Horse and trailers are **separately tracked** units (1–3 trackers per vehicle config). Pulsit produces a full route report with geofence events on completion. Document upload to trip evidence is valuable. NFC at the truck door is "no-brainer if data justifies it". SLA data is a **sales tool**, not just operational. |
| **16 Apr 2026** | Parcel Perfect and Pulsit are **two separate, non-integrated systems** — that's the core pain point FreightProof bridges. **Driver does not scan individual parcels** — that is FedEx's responsibility; per-parcel data is pulled via Parcel Perfect API. Two-tier POD: depot-to-depot (Load Factor's) and door-to-door (FedEx's) — FreightProof captures the first. Iteration plan: iter 1 foundation, iter 2 Parcel Perfect integration, iter 3 Pulsit. |
| **5 May 2026** | Button-press handshake transitions for the demo are **sanctioned** (live geofence can't be reproduced in a classroom). FedEx manifest (branch-prefixed, Parcel-Perfect-issued) is **distinct from** the Load Factor Master Waybill (IVS-issued, hard copy in cab). FedEx = one principal with multiple Location nodes (not multiple principals). SLA defines slot times, per-route insurance cover (R3M CT, R1M DBN), annexures. Driver phones are **company-issued Android (Samsung preferred)** — POPIA scope follows device + SIM ownership. Driver substitution at pre-loaded Pulsit geofence exchange points (e.g. Harrismith) is a **normal event** logged with four fields, not an exception. Action: review National Transport Act + standard driver contract before designing monitoring features. |

### 1.5 The core tension we have to resolve

Ammar approaches FreightProof as a full Transport Management System. Bruce has explicitly scoped it as an **evidence layer that observes** Pulsit / Parcel Perfect / gate security — it doesn't run operations. Most of Ammar's structural critique therefore lands outside our scope **per the industry partner**. That's defensible at examination — but **only if we write the scope boundary down and can name what's in and what's out**. That's the centerpiece of this meeting.

---

## 2. Agenda

| # | Item | Time | Notes |
|---|---|---|---|
| 1 | Recap iter 1 + Ammar's feedback | 10 min | Section 1 above |
| 2 | Map Ammar → Bruce → status | 15 min | Section 3 |
| 3 | **Big decision:** multi-leg / multi-client trip model | 20 min | Section 4.1 |
| 4 | Other open decisions (4.2 – 4.6) | 20 min | Section 4 |
| 5 | Finalise Bruce + Ammar emails | 10 min | Sections 5 – 6 |
| 6 | Iter-2 ticket creation + ownership | 10 min | Section 7 |
| 7 | Vac timeline + checkpoints | 5 min | Section 8 |

---

## 3. Ammar's points reconciled against Bruce's guidance

### 3.1 Already decided — no further discussion

| # | Ammar's concern | Settled because | Status |
|---|---|---|---|
| B1 | Cargo granularity (item / box / parcel) | Bruce 16 Apr: driver does not scan parcels; data is pulled from Parcel Perfect at the level Parcel Perfect provides | Confirmed |
| B4 | Driver vs operator liability | Operator (Load Factor) is liable for the depot-to-depot leg; driver is overseen, not legally on the hook | Confirmed |
| B8 | Fleet availability calendar | Stays in Load Factor's operational tooling (v6 §7) | Out of scope |
| B9 | Driver availability / leave | "We assign a vehicle to a driver for this month — that's a management function" (Bruce, 3 Mar) | Out of scope |
| B11 | Cost management (fuel, food, repairs) | Operational not evidence; never raised by Bruce | Out of scope |

### 3.2 Probably out of scope — confirm in meeting, then defend in writing

| # | Ammar's concern | Why probably OOS | Action |
|---|---|---|---|
| B6 | Trip cancellation / reverse flow | v6 §1: FreightProof records, does not operate. Cancellation is an operational action — its effect (an unclosed trip) is what we record. | Confirm and document |
| B7 | Mid-route pickup / destination change | Journey lock hash explicitly prevents this (v6 §3.0). Any change becomes a visible exception, which is the design. | Confirm and document |
| B2 | Trailer subdivisions / cold-chain zones | Never raised by Bruce. JHB-DBN beachhead is dry freight. | Confirm and document |

### 3.3 Decisions the team **must** take in this meeting

| Ref | Topic | Section |
|---|---|---|
| D1 | Multi-leg / multi-client trip model (the data model gap) | 4.1 |
| D2 | Forensics-view UX (hide blockchain detail) | 4.4 |
| D3 | UI-driven simulation framework (replace DB edits) | 4.5 |
| D4 | Return-leg / round-trip handling | 4.6 |

### 3.4 Decisions blocked on Bruce

| Ref | Topic | Why we need Bruce |
|---|---|---|
| BQ1 | Horse breakdown / mid-trip horse substitution | Bruce described rescue + tow + freight recovery but never said how the trip continues in FreightProof. Affects journey-lock semantics. |
| BQ2 | Digital waybill signature vs paper-photo | Bruce 26 Mar: customer signs on driver's device. v6 §3.1: driver does **not** sign digitally. Direct contradiction — must resolve. |
| BQ3 | Break-bulk modelling for MVP | Bruce 26 Mar said real and common. v6 deferred to Phase 2. Confirm whether single-client MVP is acceptable for academic submission. |
| BQ5 | Return-leg recording | Bruce-implied one-way, never explicit. Confirm. |

### 3.5 Decision blocked on Ammar

| Ref | Topic |
|---|---|
| AQ1 | Will Ammar accept "out of scope per industry partner" as defence for B2/B6/B7/B8/B9/B11? |
| AQ2 | Does his "no DB edits in demo" prohibition include button-press handshake transitions (Bruce sanctioned these), or only DB-level fault injection? |

---

## 4. Decisions to take in the meeting

Each subsection has the same shape: **current state → options → recommendation → defence**. Pick a position together. Write it into Section 9.

### 4.1 D1 — Multi-leg / multi-client trip model **(centerpiece, 20 min)**

**Current state in the code:**
- `Trip.client_organization_id` — single FK. One trip = one client.
- `Trip.origin_precinct_id`, `Trip.destination_precinct_id` — single FKs each. One trip = one origin, one destination.
- `Consignment.trip_id` — multiple consignments can attach to a trip, but each consignment has only one client and one origin / destination precinct.
- No leg / waypoint / stop concept. No sequencing.

**Bruce's position (consistent across 26 Mar + 16 Apr + 5 May):**
- Hub-and-spoke trips with multiple pickup and delivery points are normal even on FTL.
- Break-bulk loads carry parcels for **100+ end clients** via multiple courier companies (FedEx, RTT, Aramex) on one vehicle.
- 16 Apr action item, status open since: *"Define data model for multi-pickup/multi-delivery trips (High)"*.
- 26 Mar action item, status open since: *"Update data model to support multi-leg trips, independent horse + trailer tracking, slot time fields per leg"*.

**v6 spec's position:**
- §4: single client per trip ("FedEx Johannesburg to FedEx Durban").
- §10: cross-border and Ragel multi-subcontractor flows deferred to Phase 2.
- Multi-stop trips mentioned as a "variant of this flow, not separate flows", but the data model wasn't updated to reflect it.

**Options:**

| Option | Description | Pro | Con |
|---|---|---|---|
| A | Keep single-client, single-origin, single-destination for MVP. Document that hub-and-spoke + break-bulk are Phase 2. | Defendable, simple, no refactor, ships fast. | Ignores Bruce's two-month-old action item. Demo can't show realistic LFG operations. |
| B | Refactor to **N-leg per trip + multi-consignment per leg + multi-client per consignment**. | Matches Bruce's actual world. Demo can show realistic break-bulk + hub-and-spoke. | Big refactor (Trip model, migrations, dispatcher trip wizard, journey-lock hash payload). 1–2 weeks of work. |
| C | Hybrid: keep single client at the Trip level, but allow N pickup-stops and N delivery-stops as a new `TripStop` model. Defer break-bulk multi-client to Phase 2. | Solves hub-and-spoke (Bruce's most-pushed item) without break-bulk. Half the refactor. | Doesn't model break-bulk; still single-client trips. |

**Recommendation:** **Option C** for iter 2, with Option B carried as a stretch goal pending Bruce's BQ3 reply. Rationale:
- Bruce's biggest repeated ask is multi-leg (mentioned in 3 of 4 meetings).
- Break-bulk is also real but Bruce's 5-May minutes treat FedEx JHB-DBN as the beachhead, suggesting single-client is acceptable.
- A `TripStop` model is half the work and unblocks the demo story.
- If Bruce answers BQ3 with "you must support break-bulk for academic submission", we extend.

**Defence at exam:** *"We modelled multi-leg per trip because the industry partner has stated multi-stop is common on FTL. We deferred multi-client break-bulk to Phase 2 because the FedEx JHB-DBN beachhead is single-client and the academic MVP scope follows the industry partner's stated beachhead strategy."*

### 4.2 Trailer subdivisions / cold-chain zones (B2)

**Current state:** no zone concept on vehicles.
**Bruce:** never raised.
**Decision:** **Out of MVP scope.** JHB-DBN beachhead is dry freight. Defendable.
**Write into scope-boundaries.md:** *"Trailer zone-level cargo placement is out of scope. The FedEx JHB-DBN beachhead operates dry-freight FTL. Multi-zone modelling would be required for refrigerated transport, which is not a Load Factor product targeted by this MVP."*

### 4.3 BQ1 — Horse substitution mid-trip (B5, blocked on Bruce)

**Decide a working assumption** to unblock the meeting:

| Option | Description |
|---|---|
| A | Horse swap = new trip linked to original. Old trip closes with `truck_failure` exception. New trip starts with cargo handover record. |
| B | Horse swap = exception on the original trip, with `horse_substitution` event anchored. Trip continues. |

**Recommendation:** **Option B as working assumption**, sent to Bruce as BQ1 for confirmation. Mirrors how driver substitution is already modelled (event on the same trip).
**Defence:** consistent with driver substitution; preserves single trip's journey lock semantics; one exception receipt instead of two trip receipts.

### 4.4 D2 — Forensics-view UX (Ammar A1)

**Current state:** dispatcher trip detail page shows blockchain TX IDs, hashes, HashScan links inline.
**Ammar:** hide these from non-investigative users; gate behind a super-admin role or a "demo toggle" / forensics view.

**Options:**

| Option | Description |
|---|---|
| A | New "Forensics view" toggle on each trip — default OFF, shows blockchain detail when ON. No role change. |
| B | New `super_admin` role with full visibility; dispatcher role sees minimal blockchain info. |
| C | Both: forensics toggle within the trip page, plus a global role-gated dev tools page (already exists at `/dev/tokens`). |

**Recommendation:** **Option A** for iter 2. Cleanest, no auth schema changes, matches Ammar's "toggle" suggestion verbatim. Role-based gating (Option B) can wait for Phase 2.
**Defence:** *"We separated everyday dispatcher use from forensic investigation following formative feedback. Blockchain detail surfaces only when an investigator opens the forensics panel."*

### 4.5 D3 — UI-driven simulation framework (Ammar A2 + A3)

**Current state:** iter-1 demo simulated mismatches by editing the database directly.
**Ammar:** never edit the DB at demo time. Inject faults via UI actions.
**Bruce 5 May:** button-press handshake transitions for the demo are explicitly sanctioned.

**The right reading:** button-press = OK (Bruce). DB edits to fake exceptions = not OK (Ammar). Build a **UI-driven simulation harness** that includes both legitimate transitions and fault injectors.

**Scope for iter 2:**
- One dev-only page in the dispatcher (`/dev/simulate/[tripId]`) with buttons:
  - "Advance trip to next handshake"
  - "Inject seal mismatch at destination"
  - "Inject parcel short (1 of N missing)"
  - "Inject Pulsit deviation"
  - "Inject driver substitution (planned / unplanned)"
- Each button calls a real endpoint. The endpoint writes a real event, anchored to Hedera, that the system then reacts to as if it were real.
- Page is hidden behind the forensics view + an env-flag.

**Defence:** *"Simulation is a first-class capability of the system, not a demo hack. Each fault injector exercises a real code path."*

### 4.6 BQ5 / D4 — Return-leg journey (B10, blocked on Bruce)

**Decide a working assumption:**

| Option | Description |
|---|---|
| A | One Trip = one direction. Return leg is a new Trip (possibly empty). |
| B | One Trip = round-trip; outbound and return are two phases of the same record. |

**Recommendation:** **Option A as working assumption**. Matches how Bruce talks about trips (always one-way: "Joburg to Durban"). Empty return is not in scope for FreightProof evidence (no cargo to record).
**Defence:** *"FreightProof captures evidence per consignment journey. An empty return is not a custody event."*

---

## 5. Email to Bruce (finalise + send during the meeting)

> Subject: FreightProof — quick scope-clarification questions before iter 2 vac
>
> Hi Bruce,
>
> Quick context: our iter-1 demo went well and we're heading into the vac to start iter 2. We have a few clarification questions whose answers shape how we scope the next month.
>
> 1. **Horse / truck breakdown mid-trip.** When a horse breaks down and freight has to be transferred to a replacement truck, would you want FreightProof to record this as (a) a `horse_substitution` exception on the same trip — like we already do for driver substitution — or (b) a fresh trip linked back to the original? We're leaning towards (a) for consistency.
>
> 2. **Driver waybill signature.** In your 26 March description you talked about the customer signing on the driver's device (replacing the paper waybill). In our current v6 spec we documented the driver photographing the paper waybill instead. Which do you want for the LFG-FedEx beachhead — paper-photo only, on-device signature, or both depending on the client?
>
> 3. **Break-bulk modelling for MVP.** For an 18-metre truck carrying FedEx + RTT + Aramex parcels on JHB-DBN, would the right MVP scope be (a) one Trip with multiple consignments under different clients, or (b) single-client trips per truck even on break-bulk runs, with multi-client deferred to Phase 2? We're leaning (b) for the academic submission since JHB-DBN FedEx is the beachhead.
>
> 4. **Forensics view UX.** Should dispatchers see blockchain transaction IDs and HashScan links in their default trip view, or only when they explicitly open a forensics panel? Our lecturer asked us to consider hiding this — we'd value your take from the dispatcher-perspective at LFG.
>
> 5. **Return-leg journey.** When a truck has dropped off in Durban and is on its way back to Joburg empty, should FreightProof record that leg? Our current assumption is one trip per direction (the return is out of FreightProof's scope unless cargo is on board).
>
> Replies in any form work — point-form, voice note via WhatsApp, whichever's easiest. We'd like to lock these in by [DATE + 5 days] so iter 2 work can start.
>
> Two carry-overs from your 5 May minutes that we'd love to close off too: (i) the redacted LFG–NGL SLA + annexures, and (ii) a sanitised example manifest.
>
> Thanks Bruce — see you on the other side of vac.
> [signed]

---

## 6. Email to Ammar (finalise + send during the meeting)

> Subject: FreightProof iteration 1 — clarification on your feedback
>
> Hi Ammar,
>
> Thanks for the detailed feedback on our iter-1 demo — it gave us a lot to work with. Two clarifying questions as we plan iter 2:
>
> 1. Several of your design-depth points (multi-zone trailers, fleet availability calendar, driver leave scheduling, mid-route destination changes, cost management) sit outside the scope our industry partner (Bruce, Load Factor Group) has set for FreightProof. He has explicitly framed FreightProof as an **evidence layer** that records what happened in fleet operations rather than running them — those operational concerns stay in his existing systems (Pulsit, Parcel Perfect, internal IVS). We plan to document our scope boundary explicitly and defend it at examination. Could you confirm whether that defence is acceptable, or whether you'd like us to bring those concerns into scope regardless?
>
> 2. Your "no DB edits at demo time" guidance: does that include button-presses that advance handshakes (our industry partner has signed these off as the only realistic way to demo geofence-triggered events in a classroom), or only DB-level fault injection? We're planning a UI-driven simulation harness that exposes buttons for both legitimate transitions and fault scenarios, with each button hitting a real API endpoint and writing a real event.
>
> Aiming to send iter 2 plan over the vac. Replies appreciated.
> [signed]

---

## 7. Iter-2 backlog seed — Jira tickets to create

### 7.1 Add now (independent of open questions) — ~10 tickets

| Ticket | Notes |
|---|---|
| Refactor Trip → introduce `TripStop` model (pickup + delivery legs) | D1 Option C |
| Refactor journey-lock-hash payload to include stops | Follows above |
| Dispatcher trip wizard — multi-stop UI | Follows above |
| Forensics view toggle on trip detail page | D2 |
| UI-driven simulation harness page (`/dev/simulate/[tripId]`) | D3 |
| Document upload feature on trip evidence trail | Bruce 26 Mar action item (still open) |
| `docs/scope-boundaries.md` — defence document | Out of Section 9 of this meeting |
| NFC feasibility + cost analysis writeup | Bruce 26 Mar action item (still open) |
| Parcel Perfect API field mapping spec | Bruce 5 May action item (overdue) |
| National Transport Act + standard driver contract review writeup | Bruce 5 May action item (overdue) |

### 7.2 Hold until Bruce replies

| Ticket | Blocked on |
|---|---|
| Horse substitution flow (exception vs new trip) | BQ1 |
| Digital waybill signature on driver device | BQ2 |
| Break-bulk multi-client extension to TripStop | BQ3 |
| Return-leg recording (if applicable) | BQ5 |

### 7.3 Hold until Ammar replies

| Ticket | Blocked on |
|---|---|
| Whether to in-scope any B-items currently OOS | AQ1 |

### 7.4 Iter-2 handshake tickets already queued (no action needed — finish these)

FP-67, FP-68, FP-69, FP-70, FP-72, FP-73, FP-74, FP-83, FP-84, FP-85, FP-86, FP-87, FP-88, FP-89, FP-90, FP-91, FP-92, FP-63 — finishing the 5-handshake circle.

---

## 8. Vac timeline (rough — refine in meeting)

Three phases over the vac. Each phase ends with a working demo against trunk.

| Phase | Roughly | Goal |
|---|---|---|
| **P1 — Foundations & data model** | First two weeks | TripStop refactor + journey-lock-hash payload update + migration. Forensics view toggle. Send Bruce + Ammar emails on day 1. |
| **P2 — Full handshake circle** | Middle two weeks | Driver PWA + handshakes 1–5 wired end-to-end with simulation harness. Parcel Perfect manifest pull (FP-84). |
| **P3 — Polish + Pulsit + dispatcher SLA + report PDF** | Final week-ish | Pulsit deviation polling (FP-87), SLA dashboard polish, evidence PDF export for clients. |

Mid-vac checkpoint: meet for 60 min after P1 ends to verify the data-model refactor didn't break anyone's branch and to incorporate Bruce's email replies.

---

## 9. Decision Register — fill in during the meeting

| # | Decision | Position taken | Owner | Rationale (for `scope-boundaries.md`) |
|---|---|---|---|---|
| D1 | Multi-leg / multi-client trip model |  |  |  |
| D2 | Forensics view UX approach |  |  |  |
| D3 | UI-driven simulation harness scope |  |  |  |
| D4 | Return-leg handling (working assumption pending Bruce) |  |  |  |
| BQ1-WA | Horse substitution working assumption |  |  |  |
| BQ2-WA | Waybill signature working assumption |  |  |  |
| BQ3-WA | Break-bulk MVP working assumption |  |  |  |
| OOS-B2 | Trailer subdivisions confirmed OOS |  |  |  |
| OOS-B6 | Trip cancellation confirmed OOS |  |  |  |
| OOS-B7 | Mid-route pickup / destination change confirmed OOS |  |  |  |
| OOS-B8 | Fleet availability calendar confirmed OOS |  |  |  |
| OOS-B9 | Driver availability / leave confirmed OOS |  |  |  |
| OOS-B11 | Cost management confirmed OOS |  |  |  |

---

## 10. References

- v6 spec: [docs/FreightProof_Full_Picture_v6.md](FreightProof_Full_Picture_v6.md)
- Frontend spec: [docs/FreightProof_Frontend_Spec_v1.md](FreightProof_Frontend_Spec_v1.md)
- Bruce minutes: 3 Mar 2026, 26 Mar 2026, 16 Apr 2026, 5 May 2026 (all attached to this brief)
- Ammar feedback transcript: 25 May 2026 (attached)
- Iter-1 ERD: [docs/iteration_1_erd.txt](iteration_1_erd.txt)
- Jira board: `FP` project on `inf4027team5.atlassian.net` — 67 done, 33 to do as of 25 May 2026

---

## 11. Iteration 2 Jira backlog — live snapshot (3 Jun 2026)

> Pulled directly from the `FP` board: **33 open issues** (9 epics, 18 stories, 6 subtasks). This section is the single view of everything we are aiming to complete by the end of iteration 2. Tickets are grouped by the handshake they belong to, followed by what to alter, what to add, and what is blocked.

### 11.1 The 5-handshake circle — existing tickets to finish

These are already in the backlog. Iteration 2 = wire the whole circle end-to-end.

| Stage | Tickets | Epic |
|---|---|---|
| **Driver PWA shell** | FP-69 (view assigned active trip), FP-39 (driver app creation), FP-58 (page/UI creation) | FP-7 / FP-69 |
| **1. Origin Gate-In** | FP-67 (tap "Log gate entry" → photo + GPS + timestamp), FP-68 (cross-ref phone GPS / horse / trailer trackers vs geofence) | FP-5 |
| ↳ FP-67 subtasks | FP-78 (camera/file-upload component), FP-79 (capture browser geolocation), FP-80 (POST `/handshake/gate-in` endpoint), FP-81 (image storage — **see 11.2**) | FP-67 |
| **2. Loading Complete** | FP-84 (poll Parcel Perfect API for scan-out + full manifest), FP-72 (driver views manifest to confirm count), FP-73 (photo signed vehicle waybill — **see 11.4**), FP-85 (capture seal number + photo sealed door) | FP-5 / FP-6 |
| **3. In Transit** | FP-86 (photo gate exit + guard verifies seal → transition to in-transit), FP-87 (poll Pulsit API for route deviations / geofence breaches), FP-88 (soft panic button → GPS + dispatcher alert), FP-70 (offline checkpoint queue + sync), FP-63 (Merkle batching — **stretch**) | FP-7 / FP-2 |
| **4–5. Destination, Unload & Close** | FP-89 (log destination gate entry + verify seal vs origin), FP-90 (pull Parcel Perfect scan-in + reconcile vs origin manifest), FP-91 (photo signed master POD after reconcile — **see 11.4**), FP-74 (photo signed master POD at delivery — **see 11.4**), FP-92 (anchor SHA-256 of complete delivery event to Hedera HCS) | FP-6 / FP-2 |
| **Cross-cutting** | FP-83 (record planned/unplanned driver substitution — **see 11.2**) | FP-4 |
| **Documentation** | FP-33 epic (Documentation Iteration 1) — still open, close out remaining children | FP-33 |

**Phasing (maps to Section 8):**
- **P1 (wk 1–2):** `TripStop` refactor + journey-lock-hash payload + migration; forensics toggle; emails sent day 1.
- **P2 (wk 3–4):** Driver PWA (FP-69/39/58) + handshakes 1–5 + simulation harness + FP-84.
- **P3 (final wk):** FP-87 Pulsit polling, SLA dashboard polish, evidence-PDF export.
- **Stretch (can slip):** FP-63 Merkle batching (cost optimisation only); D1 Option B full break-bulk (only if Bruce's BQ3 demands it).

### 11.2 Tickets to **alter** before working them

| Ticket | Problem | Action |
|---|---|---|
| **FP-81** | Reads *"Configure AWS S3 bucket or Supabase for temporary image storage."* AWS S3 contradicts our stack — architecture mandates **Supabase Storage** in `af-south-1` (POPIA: PII stays in-region). | Rewrite: **Supabase Storage only**, drop AWS S3. |
| **FP-83** | Bruce (5 May) reclassified driver substitution as a **normal event (4 fields, planned/unplanned)**, not an exception. | Update description to match the normal-event model. |
| **FP-68** | Programmatic geofence verification cannot be reproduced in a classroom demo. | Keep, but wire through the **D3 simulation harness** for the demo path. |
| **Epics FP-1 / FP-2 / FP-3** | Marked **"To Do"** despite iter-1 children being delivered — board status is stale. | Re-status to In Progress / Done so the board reflects reality at the demo. |

### 11.3 Tickets to **add** (none of these exist on the board yet)

Create after the meeting once §9 decisions are locked. Suggested epic placement in the right column.

| # | New ticket | Source | Epic |
|---|---|---|---|
| 1 | Refactor Trip → introduce `TripStop` model (N pickup + delivery legs) | D1 Option C | FP-4 |
| 2 | Refactor journey-lock-hash payload to include stops | follows #1 | FP-4 |
| 3 | Dispatcher trip wizard — multi-stop UI | follows #1 | FP-8 |
| 4 | Forensics-view toggle on trip detail page | D2 | FP-8 |
| 5 | UI-driven simulation harness page (`/dev/simulate/[tripId]`) | D3 | FP-8 |
| 6 | Document-upload feature on trip evidence trail | Bruce 26 Mar action | FP-8 |
| 7 | `docs/scope-boundaries.md` — defence document | §9 output | FP-33 |
| 8 | NFC feasibility + cost-analysis writeup | Bruce 26 Mar action | FP-33 |
| 9 | Parcel Perfect API field-mapping spec | Bruce 5 May action (overdue) | FP-5 / FP-6 |
| 10 | National Transport Act + standard driver contract review writeup | Bruce 5 May action (overdue) | FP-33 |

### 11.4 Tickets **held** pending Bruce's reply (do not start)

| Ticket(s) | Blocked on |
|---|---|
| FP-73, FP-74, FP-91 (photograph *physical* signed waybill / POD) | **BQ2** — Bruce 26 Mar said customer signs *on device*; v6 says paper-photo. Descriptions may flip to on-device signature. |
| New: Horse substitution flow (exception vs new trip) | BQ1 |
| New: Digital waybill signature on driver device | BQ2 |
| New: Break-bulk multi-client extension to `TripStop` | BQ3 |
| New: Return-leg recording | BQ5 |

### 11.5 Definition of done for iteration 2

By the end of the vac the board should show: all 18 handshake stories Done (FP-63 acceptable as carry-over), the 10 new tickets created and the unblocked ones Done, `docs/scope-boundaries.md` written, foundation epics re-statused, and a working end-to-end demo of all five handshakes driven from the UI (no DB edits).
