# Parcel Traceability & Granularity — Findings and Target Design

> **Status:** findings + proposed design (not yet built). Feeds **FP-121** (Parcel Perfect
> field-mapping spec + parcel-granularity question) and the **Maya, 8 Jun** investigation
> recorded in `docs/iteration2_master_plan.md` §1.
> **Date:** 2026-06-13 · **Author:** Ciaran
> **Scope reminder:** FreightProof is an *evidence layer that records what happened* — it
> does not run operations. Parcel scanning belongs to Parcel Perfect; FreightProof's job is
> the tamper-evident custody chain and correlating the two so a loss can be *proven*, not
> just noticed.

---

## 0. Why this matters

Two concrete needs from the logistics provider (Load Factor) and the client (FedEx):

1. **Visibility:** "Is FedEx client X's parcel on its way to Durban / has it arrived at the
   port?" — ongoing progress of an individual parcel.
2. **Tracing on loss:** when a parcel goes missing, find **the last place it was reliably
   seen** and **which custody segment it was lost in**, so Load Factor can act — recover it,
   attribute liability, or settle a claim. The three failure modes we must be able to tell
   apart:
   - **Never scanned in** at origin → it was never loaded (incident *before* transit).
   - **Scanned out at the wrong place** → mis-routed / mishandled at a facility.
   - **Lost in transit** → an incident on the road between origin and destination.

The goal of this document is to record exactly **what our data can and cannot do today**,
and to define **how it should work** so tracing is as easy as possible.

---

## 1. What the data model supports today

### 1.1 Per-parcel identity — `Parcel` (`backend/app/db/models/trips.py:76`)

A real row **per parcel** already exists:

| Field | Meaning |
|---|---|
| `barcode` | Parcel Perfect barcode — the parcel's identity |
| `description` | free text |
| `delivery_stop` | free-text string (unverified) |
| `pp_scan_out_at` | **single** timestamp — scanned out (origin) |
| `pp_scan_in_at` | **single** timestamp — scanned in (destination) |
| `status` | `pending → scanned_out → scanned_in → exception` (`enums.py:142`) |
| `consignment_id` | FK → `Consignment` |

So per-parcel granularity is: **one barcode, two timestamps, one coarse status.** That is
enough for a 4-state lifecycle, **not** a location history.

### 1.2 Grouping — `Consignment` → `Trip`

- `Consignment` (`trips.py:46`): `parcel_perfect_reference`, `client_organization_id`,
  `origin_precinct_id`, `destination_precinct_id`, `parcel_count_expected`, `pp_raw_json`,
  and a (nullable) `trip_id`.
- `Trip` (`trips.py:97`): one depot-to-depot journey, with a **single, required**
  `client_organization_id` and `operator_organization_id`, `origin/destination_precinct_id`,
  `journey_lock_hash`, and lifecycle timestamps.

Join path: **`Parcel` → `Consignment` → `Trip`**.

### 1.3 Where the real positioning evidence lives (trip level)

The parcel itself has no GPS. Location comes from the **trip** it rides on:

- **Handshake events** (`handshakes.py`): at each of the 5 custody moments —
  `driver_phone_lat/lng`, `horse_gps_lat/lng`, `pulsit_geofence_confirmed`,
  `parcel_count_origin/destination`, `parcel_manifest_snapshot` (JSONB), gate/seal/POD photos.
- **Checkpoints** (`transit.py:17`): in-transit points — driver + horse GPS,
  `checkpoint_type`, `is_deviation`, optional selfie/cargo photos, notes.
- **Trailer GPS snapshots** (`handshakes.py:88`): continuous `lat/lng` trail of the trailer.
- **Exceptions** (`transit.py:45`): incidents raised by driver/system/dispatcher.
- **Journey-lock hash + Hedera anchoring:** the recorded custody path **cannot be altered
  after the fact** — this is the differentiator that makes a trace *provable*.

> **Key limitation:** there is **no foreign key back to `parcels`** from any handshake,
> checkpoint, or exception. Parcels are a leaf. Today a parcel cannot be tied to the
> specific custody event where it was last accounted for.

---

## 2. What we can and cannot answer today

| Question | Answerable now? | How / gap |
|---|---|---|
| Has the parcel left origin? | ✅ | `status = scanned_out` / `pp_scan_out_at` |
| Has it arrived at destination? | ✅ | `status = scanned_in` / `pp_scan_in_at` |
| Where is it *right now*? | ⚠️ coarse | Only via its trip's position (handshake/checkpoint/trailer GPS). Resolves to the **truck**, not the box. |
| Was it never loaded? | ✅ | `pending` after the trip closed + H2 count mismatch |
| Lost *in transit*? | ⚠️ segment-level | `scanned_out` with no `pp_scan_in_at` → narrow to a road segment using the trip's GPS + deviations + exceptions |
| **Scanned out at the wrong place?** | ❌ | `pp_scan_out_at` is a *timestamp only* — no scan location/facility/operator. `delivery_stop` is unverified. |
| Full per-parcel scan timeline? | ❌ | No parcel-scan-event history exists — only 2 timestamps + 1 status |
| **Last verified place the parcel was seen?** | ❌ (only endpoints) | We have origin/destination timestamps, nothing in between, and no location attached |

**Bottom line:** we can detect a *missing* scan and bound a loss to a *trip segment*. We
**cannot** yet pinpoint a *misplaced* scan or reconstruct a parcel's journey, because there
is no per-parcel event history with location/source.

---

## 3. The gap, precisely

1. **No `ParcelScanEvent` history** — a parcel has two timestamps, not a log of observations.
2. **No location on a scan** — we never record *where* `pp_scan_out_at` happened, by whom,
   or from which system.
3. **No parcel ↔ custody link** — a parcel can't be tied to the handshake/checkpoint that
   last carried it, so we can't auto-narrow the custody segment.
4. **`delivery_stop` is an unverified string**, not a precinct reference.

---

## 4. Target design — how it should work

The aim: a logistics user opens a parcel and immediately sees **(a) its verified journey**,
**(b) the last place it was reliably seen**, and **(c) the anchored custody chain around that
moment**, so they can locate it or attribute the loss.

### 4.1 New: `ParcelScanEvent`

A per-parcel observation log, ingested from Parcel Perfect (and optionally driver/warehouse):

| Field | Purpose |
|---|---|
| `parcel_id` (FK → parcels) | the parcel observed |
| `scan_type` | `scan_out` · `scan_in` · `transit` · `exception` |
| `occurred_at` | when the scan happened |
| `precinct_id` (FK, nullable) **or** `lat`/`lng` | **where** it was seen (the missing piece) |
| `source` | `parcel_perfect` · `driver` · `warehouse` · `system` |
| `trip_id` (FK, nullable) | the trip carrying it at that time |
| `handshake_event_id` / `checkpoint_id` (FK, nullable) | the custody segment this scan bounds |
| `evidence_artifact_id` (nullable) | optional photo/record |
| `event_hash` / `merkle_batch_id` (nullable) | anchored for tamper-evidence |

This upgrades the two-timestamp model into a **traceable, anchorable chain** — and lets us
finally answer "scanned out at the wrong place" (compare scan `precinct_id` to the expected
origin/destination).

### 4.2 "Last seen" — the concept Load Factor actually needs

Define a computed **`last_seen`** per parcel = the most recent *verified* observation:

- the latest `ParcelScanEvent` (preferred — has its own location), **or**
- failing that, the latest custody event of the parcel's trip (handshake/checkpoint GPS).

Each `last_seen` carries: **location, time, source, confidence** (parcel-scan = high;
inferred-from-trip = medium), and the **custody segment** it falls in. This single derived
value is what powers "the last time this parcel was seen was *here*, at *this time*."

### 4.3 Linking a parcel to its custody segment

`Parcel → Consignment → Trip → {handshakes, checkpoints, trailer GPS}`. Each
`ParcelScanEvent` is stamped with the nearest custody event, so a missing parcel maps
automatically to the bounded segment (e.g. "last verified at Linbro Park gate-out 05:40;
not seen since; truck deviated near Harrismith 09:12 — search that window").

### 4.4 Tracing workflow (the Load Factor story)

1. Open the parcel → see its **lifecycle timeline** (every `ParcelScanEvent`).
2. Read **`last_seen`**: location, time, source, confidence.
3. View the **trip's anchored custody chain** around that time — handshakes, checkpoints,
   trailer GPS, and any deviations/exceptions in the window.
4. The system classifies the failure mode:
   - never scanned out → **not loaded** (point at H2 loading evidence),
   - scan-out precinct ≠ expected origin → **mis-scanned location**,
   - scanned out, never scanned in → **lost in transit** (highlight the deviation/exception
     segment between last-seen and destination).
5. Output a **narrowed location + recommended action**, all backed by tamper-evident records.

### 4.5 Tamper-evidence

Parcel scan events (individually, or batched via the existing Merkle batching, FP-63) are
anchored so the trace itself is **provable** — consistent with the journey-lock model.

---

## 5. Scope boundary — who does what

| Layer | Owner | Role |
|---|---|---|
| Per-parcel barcode scanning + manifest | **Parcel Perfect** | source of truth for scans (`pp_*` fields, `pp_raw_json`) |
| Anchored vehicle custody + GPS + exceptions | **FreightProof** | tamper-evident "what happened to the truck" |
| Tracing / resolution | **Load Factor** | overlays the two to locate a parcel / settle a claim |

FreightProof should **ingest and anchor** PP scan events and **correlate** them with custody
evidence — **not** become a parcel-scanning system. That keeps us inside "evidence, not
operations."

---

## 6. Multi-client consolidated loads (affects tracing)

Load Factor won't send two trucks when one has space, so a trip may carry **FedEx and RAM
cargo together**. The schema half-supports this (`Consignment.client_organization_id` is
per-consignment), but `Trip.client_organization_id` is currently single + required.

Implications for tracing once consolidation opens (Option B / FP-112):

- A trip holds **N consignments, one per client**; a parcel belongs to *a consignment*, which
  belongs to *a client*.
- Tracing and visibility must **scope to the consignment/client** — FedEx sees only FedEx
  parcels, even though they share the truck's custody evidence.
- The **journey-lock hash must cover all consignments** on the trip.
- A missing FedEx parcel is traced *within FedEx's consignment* but *using the shared trip's*
  anchored GPS/exception chain.

---

## 7. Recommended phasing

- **Now (iteration 2 demo, single client):** keep `Parcel` as-is; show coarse per-parcel
  status from the Parcel Perfect mock. Do **not** overbuild — the demo is single-client,
  single-leg by design.
- **FP-121 (next):** finalise the PP field mapping **including whether PP exposes intermediate
  scan events with location**; add `ParcelScanEvent` + the `last_seen` derivation; build the
  parcel tracing view.
- **Iteration 3+:** anchor parcel scan events (Merkle), multi-client consolidation, and
  per-stop sequencing.

---

## 8. Open questions (for Parcel Perfect / Bruce)

1. Does the Parcel Perfect API expose **intermediate** scan events with a **location/facility**,
   or only out/in timestamps? (Determines how much of §4 we can fill from PP vs. must capture
   ourselves.)
2. What granularity does FedEx actually want — **envelope vs parcel vs pallet**?
3. Anchoring policy: **every** parcel scan event, or **Merkle-batched** (FP-63)?
4. Is `delivery_stop` meant to be a real precinct, and can PP give us a structured value?
