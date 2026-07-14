# FreightProof SA — Domain Glossary

> **Purpose:** one shared vocabulary mapping **real Load Factor (LFG) operations** to **our system
> entities**, so the team designs against the same mental model and confusion stays low.
> **Status:** living document · **Author:** Ciaran · **Date:** 2026-06-24
> **Sources:** Bruce minutes (3 Mar · 26 Mar · 16 Apr · 5 May · **24 Jun**), `docs/parcel-traceability.md`,
> `docs/scope-boundaries.md`, `docs/iteration2_master_plan.md`.
> **Confidence column:** High = Bruce-confirmed / standard logistics; Medium = strongly implied;
> Low = unconfirmed, flagged for the **13–18 July site visit**.

---

## 1. Term map (real ops → our system)

| Real-world term | What it is in LFG ops | Our system entity | Cardinality | Confidence |
|---|---|---|---|---|
| **Parcel** | Individual box/envelope. FedEx / Parcel Perfect identity (barcode). **LFG never sees these** — sealed inside a unit. | `Parcel` *(reframed: PP-sourced overlay, not LFG's custody leaf)* | many per unit | **High** |
| **Consolidated unit / pallet** | ~50 parcels shrink-wrapped + sealed by the client, handed to LFG as **one opaque sealed thing**. The smallest thing **LFG physically handles & counts**. | **❌ not yet modelled** (`HandlingUnit` — the July-visit gap) | many per trip | **High** it exists; **Low** on tracking |
| **Consignment** | A **commercial booking / waybill**: one consignor → one consignee, **one client, one origin, one destination**, under one PP reference. The "what was booked." | `Consignment` | many per trip | **High** |
| **Linehaul / Master Waybill** | The **driver's** document: consolidated **unit count** + seal numbers + reg + driver details. **No contents.** (IVS-issued, hard copy in cab.) | *generated from `Trip` — not a stored cargo entity* | one per trip | **High** |
| **Manifest** | Full list of what's in the truck (PP-issued). Goes **ops-to-ops, never to the driver** (theft risk). | `Consignment.pp_raw_json` / `Parcel` rows (dispatcher-only) | — | **High** |
| **Trip / leg / load** | The depot-to-depot **vehicle journey**; LFG consolidates many consignments onto it. | `Trip` (+ its consignments + stops) | the spine | **High** |
| **Stop / waypoint** | A place the truck **visits** in the route. Can serve several consignments at once (see §3). | `TripStop` (FP-112) | many per trip | **High** (design) |
| **Origin / destination** | The **precinct** (facility or client site) where a consignment is picked up / dropped off. **A role, not a place** (see §3). | `Precinct`, via a consignment's pickup/delivery `TripStop` | one origin + one destination *per consignment* | **High** |
| **Precinct** | A physical location (LFG depot, client facility, gate). | `Precinct` | — | **High** |

---

## 2. Containment hierarchy

```
Trip  ──<  Consignment            one client each; multi-client trip = N consignments   ✅ confident
              │
              ├─ pickup_stop  ─→ TripStop ─→ Precinct     (its ONE origin)               ✅
              └─ delivery_stop ─→ TripStop ─→ Precinct    (its ONE destination)          ✅
              │
              └─<  HandlingUnit / pallet  ??  ──<  Parcel (opaque to LFG)
                   ▲ cardinality (1:N vs N:M) UNCONFIRMED — July visit
```

The **confident layer** (Trip → Consignment → origin/destination) is what FP-112 builds. The
`HandlingUnit` (pallet) layer and its cardinality are deliberately deferred.

---

## 3. How the route works — origins & destinations as *roles*, not *places*

The single most confusing point, resolved:

- A **truck can have multiple origins and multiple destinations** — modelled as multiple `TripStop`s
  on one `Trip`.
- **Each consignment has exactly one origin and one destination** (standard waybill definition).
- **A stop has no inherent type.** The *same physical stop* can be an **origin for one consignment
  and a destination for another** at the same time. Example: the truck reaches LFG Durban and (a)
  drops consignment A there (A's destination) while (b) collecting consignment B for an onward leg
  (B's origin). One `TripStop` row, two roles.
- Therefore the **origin/destination role lives on the consignment→stop link**
  (`Consignment.pickup_stop_id` / `delivery_stop_id`), **not** on the stop.
- A stop's role is **derived**: origin for every consignment picked up there, destination for every
  one dropped there, possibly both.
- Stops are **differentiated and ordered** by `TripStop.sequence`; they all belong to the **same
  trip** via `trip_id`. Sanity rule: for each consignment, `pickup_stop.sequence <
  delivery_stop.sequence`.

This composes cleanly as consignments grow — no special cases. It matches Bruce's hub-and-spoke
(multiple pickups/deliveries per FTL) and ad-hoc collection (truck visits FedEx, then Courier Guy)
worlds (Bruce, 26 Mar + 24 Jun).

---

## 4. Trip boundaries — what starts and ends a trip

A trip is bounded not by a number of stops but by **one locked custody commitment over one
continuous vehicle custody run**:

- **Start:** trip creation → the **journey-lock hash is computed and anchored** → origin gate-in.
  The plan (vehicle, driver, consignments, ordered stops) is *locked* at this moment.
- **End:** every consignment has reached its delivery stop **and** the final destination
  gate-in → unload → close fires → `TripStatus.CLOSED`.
- The real anchor is the **seal + journey-lock**, not geography. A trip is one sealed run,
  **depot-to-depot, one direction** (Bruce). The return leg is a **new trip** (master plan D4).

**Can a trip have unlimited stops?** The count is open, but the **set is frozen at creation** —
because the journey-lock hash exists to make post-creation changes *detectable*. Adding a stop
mid-trip is a **journey deviation / exception event**, never a silent edit (that would be the very
tampering the lock guards against).

**One model, not two trip "types".** A single-origin/single-destination trip is just the
**degenerate case** of a multi-stop trip (2 stops, 1 consignment). There is **no `trip_type`
field** — "direct" vs "multi-drop" is a *derived label* (stop count), never a stored type. The
dispatcher wizard may offer a simple vs advanced *flow* (progressive disclosure), but both write the
same `Trip` / `TripStop` / `Consignment` rows. See FP-112 plan §A.6.

> **Handshake caveat (iter-2 scope):** the current 5-handshake lifecycle (`HandshakeType`,
> `enums.py:33`) is **single-origin/single-destination shaped** — one gate-in, one load, one
> unload. True mid-route load/unload needs **handshakes attached to stops** (each is a seal
> break + reseal). That is a follow-on (FP-113 / a new per-stop-handshake ticket), **out of FP-112
> and the iter-2 demo**, which run the single-seal depot-to-depot path.

## 5. Two service models (both fold into the stop model)

| Model | What happens | How it maps |
|---|---|---|
| **Scheduled break-bulk** | Clients deliver freight to the LFG facility; LFG consolidates onto one truck. | Consignments share an early pickup stop (the LFG depot); deliveries fan out to multiple destination stops. |
| **Ad-hoc collection** | Truck visits client sites to collect (e.g. FedEx 3t, then Courier Guy 4t). | Each collection is a pickup stop at the client's precinct. |

---

## 6. Open questions (→ July site visit / Bruce)

1. **Does LFG scan/identify each pallet, or only count units + seal the truck?** Decides whether
   `HandlingUnit` is a tracked entity or just a count. (`parcel-traceability.md` §8)
2. **Consignment ↔ HandlingUnit cardinality:** can one consignment span several pallets, and/or one
   pallet hold several consignments (Bruce's "2–3 clients on a pallet" = FedEx's *downstream*
   clients, all under one principal in our model)? 1:N vs N:M.
3. **Depot-to-depot POD signature:** on-device vs photo-of-paper (BQ2).

> Record the answers here after the visit — this file is the team's single source of truth for
> terminology.
