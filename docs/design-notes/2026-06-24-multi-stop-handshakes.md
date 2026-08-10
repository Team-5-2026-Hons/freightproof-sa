# Design notes — Multi-stop handshakes (pickups + dropoffs)

> **Status:** IDEAS / forward-looking design. **Not a plan, not iteration-2, do not build.**
> Captured now so the foundational model (handshakes, seal, journey-lock) doesn't get ripped out
> later (Ammar's "lock the model in" critique).
> **Author:** Ciaran · **Date:** 2026-06-24
> **Informs:** FP-113 (journey-lock covers the stop plan) + a future per-stop-handshake ticket.
> **Builds on:** `docs/glossary.md` §3–§4, `docs/superpowers/plans/2026-06-24-fp112-tripstop.md`.
> **Iter-2 reality:** the demo runs the single-seal, single-origin/destination 5-handshake path.

---

## 1. The core physical insight

Multi-stop is **not** "more handshakes of the same kind." It changes the **seal lifecycle**. With one
seal you cannot open the truck mid-route without breaking it. So a multi-stop trip is a chain of
**seal segments**: at every stop where cargo moves, record *seal break → cargo event → reseal (new
number)*. The seal chain is the spine everything else hangs off.

The current lifecycle (`HandshakeType`, `enums.py:33`: `ORIGIN_GATE_IN → LOADING → ORIGIN_GATE_OUT →
DEST_GATE_IN → UNLOADING`) is **single-origin/single-destination shaped** — one seal, applied at
origin, broken at destination.

## 2. Guiding principle — generalise, don't bolt on

Same rule as stops (`glossary.md` §4): the 5-handshake single-O/D flow should become the
**degenerate case** of a general per-stop model, **not** a parallel system. One code path for
validation, hashing, and handshakes.

## 3. Proposed shape (recommended: Option A)

### 3.1 Handshakes attach to a stop
- `HandshakeEvent` gains a nullable `trip_stop_id` (FK → `trip_stops.id`).
- A small set of **generic per-stop types** replaces the fixed five:
  `STOP_GATE_IN → (UNLOAD block) → (LOAD block) → STOP_SEAL → STOP_GATE_OUT`.
- `sequence_number` orders all handshakes across the whole trip.
- **Degenerate single-O/D mapping:** stop 0 `{GATE_IN, LOAD, SEAL, GATE_OUT}` + stop 1
  `{GATE_IN, UNLOAD, close}`. The existing demo path is just this 2-stop instance.

### 3.2 Cargo verification is per-consignment, linked to the stop
- A stop's UNLOAD/LOAD handshake covers the consignments whose `delivery_stop` / `pickup_stop` = that
  stop; each gets a count check.
- This doubles as the **"last seen"** signal for `docs/parcel-traceability.md`: a consignment's last
  verified custody event is its load/unload handshake.

### 3.3 Seal segments (the tamper-evidence win)
- Model the seal as a **chain**: the seal *verified* at stop N gate-in must equal the seal *applied*
  at stop N-1 gate-out.
- Mismatch → `SEAL_MISMATCH` exception. Every leg becomes **independently provable** — a property a
  single-seal trip does not even have.

### 3.4 Dual-role stop (origin for one consignment, destination for another)
Falls out naturally: one `STOP_GATE_IN`, an UNLOAD block (consignment A delivered), a LOAD block
(consignment B picked up), one reseal, one `STOP_GATE_OUT`. Per-consignment records differentiate.

### 3.5 Journey-lock (FP-113)
The lock covers the **ordered stops + each consignment's pickup/delivery-stop assignment**, so the
committed multi-stop *plan* is tamper-evident. Execution is recorded against it; any extra/changed
stop is a **deviation exception**, never a silent edit.

## 4. Alternatives considered (and why not)

- **Option B — keep 5 macro-handshakes + a separate `StopCargoEvent` sub-entity for mid-route
  loads.** Hybrid; two concepts doing one job; diverges the demo path from the real path. Rejected.
- **Option C — purely per-consignment custody events, no vehicle-level stop handshakes.** Loses the
  seal-segment / gate evidence that is FreightProof's whole point. Rejected (but the per-consignment
  records of 3.2 are kept *within* Option A).

## 5. Edge cases to keep in mind

- Partial delivery / short at a stop → `PARCEL_COUNT_MISMATCH` scoped to *that stop + consignment*.
- Empty legs between stops (truck partly loaded) — fine; no cargo event on that leg.
- `TripStatus` stays **coarse** — do not encode "at stop N, action X" into the enum; per-stop
  progress lives in `HandshakeEvent` rows.
- Final stop has no `STOP_GATE_OUT`/reseal — it closes the trip.

## 6. Decisions deferred (record answers when taken)

1. **Generic per-stop handshake types vs. richer set** (e.g. split UNLOAD/LOAD vs a single
   `STOP_CARGO` event with a payload). Lean: explicit `UNLOAD` + `LOAD`.
2. **Should FP-112 pre-add `HandshakeEvent.trip_stop_id` (nullable) now** to avoid a second migration
   on a shared table later? Lean: **no** — keep FP-112 minimal (prime directive); coordinate the
   migration when the per-stop ticket lands.
3. **Seal-segment entity vs. seal fields on the gate handshakes.** Lean: explicit `seal_in` /
   `seal_out` on stop handshakes first; promote to a `SealSegment` entity only if needed.
4. Per-stop POD/signature semantics (ties into BQ2).

## 7. Scope reminder

This is iteration-3+ territory. It is recorded to keep the iteration-2 model **forward-compatible**,
not to expand iteration-2 scope. Nothing here is built until a dedicated ticket is opened.
