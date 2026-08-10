# FreightProof SA — Scope Boundaries (Defence Document)

> **Ticket:** FP-119 · **Status:** living document — first cut · **Author:** Ciaran · **Date:** 2026-06-24
> **Purpose:** state explicitly what FreightProof *is* and *is not*, so the scope can be defended at
> examination. Reconciles the lecturer's (Ammar/Aisha/Maya) "full TMS" framing against the industry
> partner's (Bruce, Load Factor Group) "evidence layer" framing. Sources:
> `docs/iteration2_master_plan.md`, Bruce minutes (3 Mar · 26 Mar · 16 Apr · 5 May · **24 Jun**).

---

## 0. The scope spine (the one sentence everything defends to)

**FreightProof is an evidence layer that records *what happened* across a custody chain. It does
not run operations.** It observes and anchors; it does not dispatch, reroute, schedule, or replace
Pulsit / Parcel Perfect / gate security. Any time the design is *responding* rather than *recording*,
it is out of scope.

The differentiator is not digitisation — it is **tamper-evident, blockchain-anchored evidence**: the
journey-lock hash makes post-hoc trip tampering provable.

---

## 1. In scope

| Area | What FreightProof does |
|---|---|
| Five-handshake custody chain | Records + anchors each of the 5 custody moments (gate-in, loading, in-transit, destination gate-in, close). |
| Journey-lock hash | SHA-256 of committed trip params at creation, anchored to Hedera HCS; current record ≠ anchored tx = tampering. |
| **Multi-client / multi-stop trips** *(Bruce 24 Jun, confirmed)* | One trip may carry **multiple clients** and visit **multiple pickup + delivery points**. Two service models: scheduled break-bulk (clients deliver to LFG) + ad-hoc collection (truck visits client sites). |
| **Loading configuration + order — as evidence** *(see §3)* | Records the load blueprint + loading priority/order. **Records, does not enforce.** |
| Sealed-load custody | The unit of custody is the **sealed consolidated load (unit count + seal)** — not the parcel. See `docs/parcel-traceability.md`. |
| Parcel correlation (read overlay) | Ingests + correlates Parcel Perfect parcel-level scans against the anchored custody chain so a loss can be *proven* and *bounded to a segment*. Client-scoped, read-only. |
| Exceptions + deviations | Records Pulsit deviations, panic events, seal mismatches, count shorts as anchored evidence. |
| Driver / horse substitution | Logged as a **normal event on the same trip** (4 fields), not an operational action. |
| Trip cancellation | Recorded (closes the chain) — evidence only. |
| Document upload | Physical waybills/PODs photographed + attached to the trip evidence trail. |

---

## 2. Out of scope (defended)

| # | Concern | Why out | Defence |
|---|---|---|---|
| B2 | Trailer subdivisions / cold-chain zones | Never raised by Bruce; JHB–DBN beachhead is dry freight. | Multi-zone modelling would be needed only for refrigerated transport, not a Load Factor product targeted by this MVP. |
| B8 | Fleet availability calendar | Operational tooling — stays in LFG's systems. | "We assign a vehicle to a driver for the month — a management function" (Bruce, 3 Mar). |
| B9 | Driver availability / leave | Operational. | Same as B8. |
| B11 | Cost management (fuel, food, repairs) | Operational, never raised. | Not a custody event; nothing to anchor. |
| — | Per-parcel scanning | Belongs to **Parcel Perfect**; LFG receives sealed units and cannot see inside (theft risk). | FreightProof correlates PP's scans, does not generate them. |
| — | Live operational tracking | Real-time location is **Pulsit's core job**. | FreightProof shows **last verified/anchored** position with time + confidence; going live is a question for Bruce, not a default. POPIA exposure on continuous live location. |

---

## 3. Liability boundaries that shape the model

- **Load configuration / weight compliance is FedEx's responsibility** *(Bruce, 24 Jun)*. LFG supplies
  the **blueprint** of each vehicle (volumetric limits, axle/trim rules); FedEx loads to it. If a
  weighbridge fine or a forklift recovery results, the cost falls on **FedEx** (the client), not LFG.
  → FreightProof may **record** the load configuration + loading order as evidence; it **does not
  enforce** loading rules (that would be operations).
- **Operator (Load Factor) is liable for the depot-to-depot leg**; the driver is overseen, not legally
  on the hook. FreightProof captures the **depot-to-depot** POD; door-to-door is FedEx's.
- The driver is the only hands-on user per handshake; guards/warehouse staff have no accounts. The
  driver receives the **linehaul** (consolidated unit count + seal + reg + driver details) — **never**
  the manifest or per-parcel contents.

---

## 4. Future enhancements (raised, not in MVP)

- **Vehicle camera-feed integration + 5-minute exception clip** (before/after an exception). Bruce
  to raise clip-saving with Pulsit; valuable but out of MVP.
- **Live truck position on the parcel/trip map** — pending Bruce's call (vs. last-verified, §2).
- **Per-pallet (`HandlingUnit`) tracking** — pending the "does LFG scan each pallet?" answer (July
  site visit). See `docs/parcel-traceability.md` §8.

---

## 5. Open boundary questions

| # | Question | Owner |
|---|---|---|
| 1 | Does LFG scan each pallet or only count + seal? (decides leaf-level model) | Bruce / July visit |
| 2 | Depot-to-depot POD handover: on-device signature vs photo-of-paper (BQ2) | Bruce |
| 3 | Load-configuration recording depth — blueprint + order only, or more? | Bruce |
| 4 | Will the lecturer accept "out of scope per industry partner" for B2/B8/B9/B11? | Ammar |
