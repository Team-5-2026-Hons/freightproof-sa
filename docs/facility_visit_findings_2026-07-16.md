# Facility Visit Findings — Distribution Hub (RTT / Load Factor client)

**Date of visit:** ~2026-07-16
**Author:** Ciaran (from on-site recollection)
**Status:** DRAFT — first-pass write-up, to be confirmed with the team and, where marked, with LFG/RTT.

---

## 0. How to read this doc

This is written from one person's memory of an information-dense site visit. Some of it
is certain, some is "this is how it made sense to me." Every claim is tagged so we don't
accidentally cement a guess as fact (the way the "pallet grain" assumption nearly was):

| Tag | Meaning |
|-----|---------|
| **[CONFIRMED]** | Seen directly and clearly on-site. |
| **[LIKELY]** | Strong impression, consistent with everything else, but not nailed down. |
| **[UNCERTAIN]** | Half-remembered or inferred — needs checking before we build on it. |
| **[OPEN]** | We genuinely don't know — a question for RTT/LFG. |

Things happened on the visit that aren't captured here yet. This doc is a living record —
add to it as more comes back.

---

## 1. The operation in plain English

The facility visited is a **distribution hub** in a **hub-and-spoke, cross-dock** network.
It is not a point-to-point courier. Goods flow like this:

1. **A truck arrives** at the hub from another hub (e.g. Durban → Joburg), full of goods.
   The hub is *expecting* it — the gate has to know the truck is coming to let it in. **[CONFIRMED]**
2. **Gate scan on arrival.** The guard scans the truck in; the guard can see the
   waybills/manifest — i.e. everything that truck contains — and records that this truck,
   with these goods, arrived at this time. **[CONFIRMED]**
3. **The truck is unloaded.** Parcels come off and are **cross-docked** — sorted and moved
   onto their *next* truck / next manifest for the next leg of their journey. A parcel does
   not stay with one truck end-to-end; it hops truck-to-truck through hubs. **[CONFIRMED]**
4. **Dimensioning stations.** As parcels come off, machines photograph each parcel and
   record its weight, dimensions, and the details tied to its barcode/sticker. **[CONFIRMED]**
5. **The same truck is reloaded** with the *next* trip's waybills — e.g. Joburg → Durban.
   That reload is a **new trip / new manifest**. **[CONFIRMED]**
6. **The driver never enters the loading warehouse** — a deliberate risk control. The driver
   does not load, does not see inside, and **never knows what goods are actually in the truck, however the driver does know the weight of the load and I am pretty sure he knows the number of items/boxes but this needs to be confirmed**. **[CONFIRMED]**
7. **The driver gets a "linehaul" sheet** — a printed reference with everything they need to
   get the goods from A to B, including special instructions per client. Not the manifest. **[CONFIRMED]**
8. **When loaded, the doors are shut and a coded seal is applied and locked.** Exactly how
   the code works — whether it's revealed to the driver only at the destination, or checked
   against a control-hub record — is **[OPEN]**.
9. **Departure gate scan.** The sealed truck leaves the dock, goes to the gate, the guard
   scans it, sees the waybills/manifest, and records that this truck with these goods **left**
   at this specific time. **[CONFIRMED]**
10. **In transit**, the driver and the control hub **call each other every hour** to confirm
    all is well. **[CONFIRMED]**
11. **The control hub has full live visibility** — someone there can see exactly what parcels
    are in any truck at any moment, where each parcel is, and who it belongs to (from its
    waybill). **[CONFIRMED]**
12. The whole thing runs on a **tight schedule**. The destination hub needs to know the exact
    arrival time; the control hub watches every truck to make sure it leaves and arrives on
    time. **[CONFIRMED]**

### The key structural insight

A **truck is a reused asset that lives in the yard.** A **trip is one leg** (one origin hub →
one destination hub, one driver, one manifest). The physical Joburg gate is the *arrival* gate
for the inbound Durban→Joburg trip **and**, hours later, the *departure* gate for a brand-new
Joburg→Durban trip. Stop thinking "truck," think "trip = one leg." Once you do, the
gate-in / gate-out confusion dissolves.

---

## 2. Entities and hierarchy

What we saw, and how it maps to what's already in the codebase:

| Real-world thing | What it is | Current model (`backend/app/db/models/`) |
|------------------|-----------|-------------------------------------------|
| **Piece** | One physical box/parcel. | `Parcel` (trips.py) — has `barcode`, `pp_scan_out_at`, `pp_scan_in_at`. |
| **Waybill** | One client's shipment: 1+ pieces, an owner, a destination. **[CONFIRMED]** | `Consignment` (trips.py) — `parcel_perfect_reference` is the PP waybill no.; carries its own `origin_precinct_id` + `destination_precinct_id`. |
| **Manifest** | The set of waybills on one truck for one trip. **[CONFIRMED]** | Represented as the collection of `Consignment` rows linked to a `Trip`; `Consignment.pp_manifest_number` snapshots PP's manifest field. |
| **"Container"** | RTT's word — **[UNCERTAIN]** whether this means the manifest, a physical consolidation unit (roll cage/ULD/pallet), or an actual shipping container. | Not modelled as a distinct entity. Do not build on this until confirmed — may be RTT's name for a consolidated unit. |
| **Consolidated unit / pallet** | A grouping of pieces below the waybill. With FedEx, LFG received *sealed* pallets it couldn't see inside (Bruce, 24 Jun). Relationship to the new manifest→waybill→piece framing is **[OPEN]**. | Planned `HandlingUnit` idea (FP-112/FP-121) — **not built**; hold pending the open question below. |
| **Trip / leg** | One hub→hub run: one driver, one truck, one manifest. **[CONFIRMED]** | `Trip` (trips.py) — "one row per depot-to-depot trip". |
| **Linehaul sheet** | The driver's printed A→B reference; no contents. **[CONFIRMED]** | Not a stored entity; it's a *view* — the point is it must NOT expose manifest contents to the driver surface. |
| **Seal** | Coded, locked seal on the doors. **[CONFIRMED]** | Already on `HandshakeEvent`: `seal_number` + `seal_photo_artifact_id`. |
| **Hub / precinct** | A depot where trucks arrive, cross-dock, depart. **[CONFIRMED]** | `Precinct` (organisations/precinct model). |

**Grain — the working hierarchy is `manifest → waybill → piece`.** Bruce's updated guidance is
to think of it this way, and it matches the visit: a manifest is the set of waybills on a truck;
a waybill has an owner + a destination + 1 or more pieces; a piece is one physical box. The model
already reflects the waybill/piece levels (`Consignment` = waybill, `Parcel` = piece), so at this
level it's a **terminology alignment**, not a schema change.

**Where do pallets/units sit? — [OPEN].** Earlier (Bruce, 24 Jun) custody was framed at the
**consolidated unit / pallet** level for sealed FedEx handoffs (LFG can't see inside a
shrink-wrapped pallet). The new `manifest → waybill → piece` framing doesn't mention pallets. So
we need to resolve: does a consolidated-unit/pallet level still sit **between waybill and piece**
(relevant for sealed, can't-see-inside handoffs), or has it been dropped in favour of pieces?
Keep the concept parked — **do not delete it and do not bake it in** — until Bruce/LFG confirm.
This is captured as an open question in §6.

---

## 3. The trip lifecycle and where evidence is captured

The current build already models the lifecycle the visit describes. From
`backend/app/db/models/enums.py`:

```
TripStatus:   created → origin_gate_in → loading → origin_gate_out →
              in_transit → dest_gate_in → unloading → closed
HandshakeType: trip_creation, origin_gate_in, loading, origin_gate_out,
               dest_gate_in, unloading
```

Mapping the visit onto these:

| Visit moment | Handshake / status | Evidence captured | Notes |
|--------------|--------------------|-------------------|-------|
| Manifest built from waybills, trip committed | `trip_creation` (H0) | Journey lock hash of committed params → Hedera | H0 is the fail-closed anchor. |
| (Truck arrives at origin yard) | `origin_gate_in` | Gate scan, GPS | **See §4.2 — may be degenerate for hub-originating trips.** |
| Truck loaded (driver absent) | `loading` | Parcel counts, manifest snapshot | Loaded by warehouse staff, not the driver. |
| Sealed, leaves via gate | `origin_gate_out` | **`seal_number` + seal photo**, waybill photo, gate photo, departure time | This is the real, evidence-rich **departure** event. |
| Hourly driver↔hub calls | (in transit) | — | Not currently an evidence event — see §5. |
| Arrives destination gate | `dest_gate_in` | Gate scan, **seal verified intact**, arrival time | Seal check here vs §4.2 = tamper detection. |
| Unloaded / cross-docked | `unloading` (H5) | POD photo + signature, destination counts | Delivery anchor. |

**The seal is the physical twin of the journey lock hash.** Capture `seal_number` at
`origin_gate_out`; verify it intact and matching at `dest_gate_in`. A broken or mismatched
seal is tamper evidence, exactly parallel to "current record hash ≠ Hedera tx." The model
already supports this (`ExceptionType.SEAL_MISMATCH`, `SEAL_BROKEN_IN_TRANSIT`).

---

## 4. What the visit CONFIRMS vs what we should CHANGE

### 4.1 Confirmed — no change needed (the redesign holds)

- **Trip = one leg**, truck is a reused asset. ✓ (`Trip` = depot-to-depot)
- **Return leg = a new trip / new manifest.** ✓ (Joburg→Durban is its own `Trip`)
- **Departure is a distinct gate-out event.** ✓ (`ORIGIN_GATE_OUT` already exists — the
  worry from the debrief was unfounded; only the CLAUDE.md prose is out of date, see §4.3)
- **Seal is first-class evidence.** ✓ (`seal_number`, `seal_photo_artifact_id`)
- **Waybill carries its own destination; multi-client / multi-destination manifests.** ✓
  (per-`Consignment` origin+destination; role-derived `TripStop`, FP-112)
- **Driver gets a linehaul, not the manifest.** ✓ (design intent — keep manifest contents off
  the driver surface)
- **Empty repositioning legs.** ✓ (`TripType.EMPTY_LEG`)
- **Driver swaps mid-network.** ✓ (`DriverSubstitution`)
- **Schedule matters; planned vs actual times.** ✓ (`planned_/actual_departure_at`,
  `planned_/actual_arrival_at`, `ExceptionType.CHECKPOINT_TIMEOUT`)

### 4.2 Should change / decide — real tensions

**A. `driver_visual_count` conflicts with "the driver never sees the load." [CHANGE — verify]**
`HandshakeEvent.driver_visual_count` assumes the driver eyeballs and counts the cargo. But the
visit is explicit: the driver never enters the warehouse, never sees inside, never knows the
contents. At `origin_gate_out` the driver can attest to the **seal** (intact, correct number),
**not** a parcel count. We should decide what the driver actually attests to at each handshake —
almost certainly "seal intact + seal number," and let counts come from warehouse/dimensioning,
not the driver. *Why it matters:* a field that can't be truthfully filled becomes fake evidence.

**B. `origin_gate_in` may be degenerate for hub-originating trips. [DECIDE]**
`origin_gate_in` assumes the truck *arrives from outside* to start the trip. In a cross-dock hub
the truck is *already in the yard* (it just finished the inbound leg). So a hub-originating trip
may have no meaningful `origin_gate_in` — its first real event is `loading` then
`origin_gate_out`. We should decide: is `origin_gate_in` optional/skipped for trips that
originate where the truck already sits? *Why it matters:* forcing a handshake that never
physically happens either blocks the flow or produces an empty/synthetic event.

**C. A waybill's *final* destination can be beyond this trip's destination. [DECIDE — modelling]**
Because it's cross-dock, a waybill on the Durban→Joburg leg may be ultimately bound for, say,
Cape Town — it gets re-sorted at Joburg onto another truck. Today a `Consignment` links to **one**
`Trip` (`trip_id`), with `destination_precinct_id` on the consignment. We need to decide what
that destination *means*:
  - **Option 1 (leg-scoped):** `Consignment.destination_precinct_id` = *this leg's* drop hub;
    the waybill's end-to-end journey is reconstructed by joining legs on
    `parcel_perfect_reference`. Cross-leg traceability is a **query**, not a schema chain.
    Simplest; keeps each trip a clean, independent evidence unit.
  - **Option 2 (journey-scoped):** model the waybill's full multi-leg journey explicitly
    (a waybill → many trips chain). Richer traceability, heavier schema.
*Recommendation:* start with **Option 1** (matches "evidence per leg," minimal change) and only
add chaining if a real requirement needs it. **Confirm the intended meaning with the team.**

**D. Dimensioning data is a rich evidence source we don't capture. [OPPORTUNITY — low priority]**
Per-piece photo + weight + dimensions is captured at **inbound cross-dock**, keyed to the
barcode. That's strong corroboration of "what a piece is," but it happens at the hub, not at
outbound load — so it *supplements* the trip lock, it isn't the lock. `Parcel` doesn't store
weight/dims/photo today. Worth noting as future evidence, not a now-change.

### 4.3 Documentation drift to fix

- **CLAUDE.md "Five handshakes" prose is stale.** It lists
  `Trip Created → Origin Gate-In → Loading Complete → In Transit → Destination Gate-In → Closed`,
  but the code has **six** handshake types including `origin_gate_out` and `unloading`. Align the
  prose with the enums. *(CLAUDE.md needs the 4-reviewer PR — coordinate, don't edit unilaterally.)*
- Fold the confirmed findings here into `FreightProof_Technical_Full_Picture` **v1.1**, which was
  explicitly marked "due after the PP/facility visit."

---

## 5. New evidence opportunities (not required, worth logging)

- **Hourly driver↔control-hub calls.** A regular, expected "all-well" checkpoint. Could become a
  lightweight in-transit checkpoint event (batched, not per-call anchored) — an *absence* of the
  expected hourly check is itself signal. Maps to the existing checkpoint/`CHECKPOINT_TIMEOUT`
  machinery. *Only if the team wants it — don't build speculatively.*
- **Scheduled ETA vs actual.** The hub already runs on committed slot times; `planned_*` and
  `actual_*` fields exist, so on-time/late is computable evidence today with no schema change.
- **Dimensioning photo/weight/dims** as per-piece corroboration (see §4.2 D).

---

## 6. Open questions — for RTT / LFG

1. **Seal mechanism.** Who generates the seal code? Who holds it? Is it revealed to the driver
   only at the destination, or verified against a control-hub record? Is the seal number on the
   manifest? *(Determines whether the seal is usable tamper evidence or just a lock.)*
2. **"Container" terminology.** Does "container" mean the manifest, a physical consolidation unit
   (roll cage / ULD), or an actual shipping container? *(Changes the entity hierarchy.)*
3. **Back-to-back drivers.** Can one driver run Durban→Joburg and then straight back
   Joburg→Durban once the truck is turned around? How is a driver assigned to consecutive trips?
4. **Waybill destination meaning.** On a waybill, is the destination the *final* destination or
   *this leg's* drop hub? How does the operation represent a parcel that traverses 3+ hubs?
5. **Authoritative count.** Who produces the count of record — the dimensioning station, warehouse
   loaders, or the manifest itself — and at which moment? *(Decides what "count mismatch" compares.)*
6. **Origin gate-in reality.** For a trip that originates at a hub where the truck already sits,
   is there any gate-in event at all, or does the trip effectively begin at `loading`?
7. **Driver at destination.** At the destination, does the driver also stay out of the warehouse
   (unloaded by hub staff), or do they participate? *(Affects who attests at `unloading`/H5.)*
8. **Pallet / consolidated-unit level.** Given the new `manifest → waybill → piece` framing, does
   a consolidated-unit / pallet level still sit **between waybill and piece** (needed for sealed,
   can't-see-inside FedEx-style handoffs), or is it dropped? *(Decides whether the planned
   `HandlingUnit` entity gets built — see §2.)*

---

## 7. Clarifying questions — for the team (to remove our own confusion)

- Do we agree the atomic unit is the **waybill** (not "pallet")? If so, update
  `parcel-traceability.md` and the memory note.
- For §4.2 A: what does the **driver** actually attest to at each handshake, given they never see
  the cargo? (Proposed: seal number + seal intact only.)
- For §4.2 C: **Option 1 (leg-scoped) or Option 2 (journey-scoped)** for waybill destination?
- Who owns getting answers to the §6 open questions before the next build slice touches trip
  creation / handshakes?

---

## 8. Bottom line

The visit **validates the trip-creation redesign** more than it overturns it. The model already
has departure gate-outs, seals, per-waybill destinations, empty legs, and driver swaps. The real
work is **decisions, not rebuilds**:

1. Fix `driver_visual_count` to reflect that the driver never sees the load (§4.2 A).
2. Decide whether `origin_gate_in` is optional for hub-originating trips (§4.2 B).
3. Decide leg-scoped vs journey-scoped waybill destination (§4.2 C).
4. Get the §6 answers from RTT/LFG (including where pallets/units sit in the hierarchy).
5. Refresh CLAUDE.md's handshake prose and roll findings into Technical Full Picture v1.1 (§4.3).
