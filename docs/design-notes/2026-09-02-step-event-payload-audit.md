# Step-Event Payload Audit — What Each Event Can Honestly Carry

> **Status:** working document, `exists` column pre-filled · **Author:** Ciaran · **Date:** 2026-09-02
> **Parent:** [2026-09-01-phase-step-event-ledger.md](2026-09-01-phase-step-event-ledger.md) §9.6
> **Sibling:** [2026-09-02-seal-chain-rework.md](2026-09-02-seal-chain-rework.md)
> **Verified against `dev`/Ciaran on 2026-09-02** — every status below cites a column or a file.

The ledger note's row expansion renders a payload per step event. **Every field it renders is
a claim that the value exists, is stored, and is ours to show.** This document does the first
of the four tests in §9.6 for all twenty-one event types; the remaining three are decisions,
not lookups, and are left blank on purpose.

**Do not treat the interactive mockup's payloads as a specification.** They were written to
make the design judgeable. This table is what the design can actually stand on.

---

## Status vocabulary

| Status | Meaning |
|---|---|
| **exists** | Written to the database today and readable now. Safe to render. |
| **derivable** | Not stored as such, but computable server-side from data we hold. Must be computed at read and labelled derived — §6's rule. |
| **declared** | **A column exists and nothing ever writes it.** The trap this codebase already fell into four times. Rendering one of these puts a permanently blank key in front of the dispatcher. |
| **new** | Requires new capture, or a source that is not integrated. |
| **never** | Must not be stored or rendered. A deliberate exclusion, not a gap. |

`declared` is the status that matters most. `pulsit_geofence_confirmed`,
`horse_gps_lat/lng`, `Parcel.pp_scan_out_at` / `pp_scan_in_at`, `guard_verified_seal` and
`seal_number_confirmed` are all real columns that no code path populates. **Four of the
proposed payloads lean on them.**

---

## The remaining three tests

Filled in during the Sprint 7 spike, in this same table:

| Test | Question | Who decides |
|---|---|---|
| 2 | Stored, or derived at read? | Ciaran — mechanical, follows from §6 |
| 3 | **May we show it?** | Team + POPIA position. The ⚠ rows below are the ones that need it |
| 4 | Already shown at the phase grain? | Ciaran — follows from §9.5's table |

---

## Structural columns — identical on every event

These are the row itself, not its payload. All are **new**, because the table is new — but
each has a precedent already working elsewhere, which is why none of them is a risk.

| Field | Status | Precedent |
|---|---|---|
| `step_slug` | new | `core/phase_meta.py` `STEP_SLUGS` — server-side ordering, decision 7 |
| `sequence_number` | new | Same semantics as `phase_events.sequence_number` |
| `actor_type` | new | No equivalent anywhere. **This column is the reason the ledger exists** |
| `actor_id` | new | Nullable — see the receiver rows below |
| `occurred_at` | new | `trip_location_pings.recorded_at` is the client-clock precedent |
| `recorded_at` | new | `server_default now()` |
| `event_hash` | new | `phase_events.event_hash` — same construction |
| `idempotency_key` | new | `phase_events.idempotency_key`, same partial unique index |
| `artifact_id` | new | FK to `evidence_artifacts`, which already carries `captured_at` |

---

## P0 · trip_creation

### `waybill-looked-up` — dispatcher

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `pp_reference` | exists | `Consignment.parcel_perfect_reference` | |
| `parcels_expected` | exists | `Consignment.parcel_count_expected` | |
| `tracks_returned` | derivable | `Consignment.pp_raw_json` — but that is the *sync* response, not the wizard lookup. If the two differ we would be labelling one as the other | |
| `looked_up_by` | derivable | `Trip.created_by_user_id` — trip-level, not per-lookup | |
| `looked_up_at` | new | The lookup runs in `pp_lookup_service` and persists nothing | |

### `consignment-attached` — dispatcher

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `consignment_id` | exists | `Consignment.id` | |
| `origin` / `destination` | exists | `origin_precinct_id` / `destination_precinct_id`, names via join | |
| `parcel_count_expected` | exists | `Consignment.parcel_count_expected` | |
| `declared_value` | exists | `Consignment.declared_value` | **⚠** Commercially sensitive. On a timeline row it is visible to anyone with trip read access |

### `stops-committed` — dispatcher

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `stop_count` | derivable | count of `TripStop` for the trip | |
| `sequence` | exists | `TripStop.sequence` | |

### `resources-assigned` — dispatcher

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `driver` | exists | `Trip.driver_id` → driver record | **⚠** Name of an employee, on every trip timeline |
| `horse` | exists | `Trip.horse_id` → `Vehicle` registration | |
| `trailers` | exists | trip↔vehicle link | |

### `plan-generated` · `journey-lock-hashed` · `anchored` — server

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `phase_count` | derivable | count of `phase_events` rows | |
| `journey_lock_hash` | exists | `Trip.journey_lock_hash` | |
| `hedera_topic_id` / `sequence_number` / `consensus_timestamp` | exists | `blockchain_receipts` | |

---

## P1 · activation

### `trip-adopted` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `adopted_at` | new | Client-side `adoptTrip` only — nothing reaches the server | |
| `device` / `app_build` | new | Nothing captures a device string. **Low value — recommend dropping** | |

### `schedule-gate-passed` · `concurrency-gate-passed` — server

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `outcome` | derivable | The gate runs in `_reject_if_not_due` / `_reject_if_another_trip_underway`; a passing decision is implied by the phase completing, never recorded | |
| `reason` (on failure) | new | Failures raise and are not persisted | |

### `gate-arrival-position` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `lat` / `lng` | exists | `phase_events.driver_phone_lat/lng` — **required at activation, uniquely** | **⚠** Test 3's core case |
| `accuracy_m` | exists *elsewhere* | `trip_location_pings.accuracy_m`. **Not on the phase row** — joining the nearest ping is a guess unless the step event carries its own | |
| `inside_geofence` | derivable | Precinct geofence + point. Note `pulsit_geofence_confirmed` is **declared** | |

### `pulsit-position` — pulsit

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `lat` / `lng` | **declared** | `phase_events.horse_gps_lat/lng` — columns exist, always null. FP-143 | |
| `source` / `device_id` | exists *unpopulated* | `TrailerGpsSnapshot.pulsit_device_id` — table exists, nothing writes it | |

### `geofence-verdict` — server

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `confirmed` | **declared** | `phase_events.pulsit_geofence_confirmed` — always null. FP-68 | |

### `activation-attested` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `method` | derivable | Constant for this step — a swipe | |
| `artifact` | never | No evidence by design. The row's weight is actor + fix | |

---

## P2 · loading

### `scan-out-complete` — warehouse

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `expected_count` | exists | `Consignment.parcel_count_expected` | |
| `scanned_count` | exists *at close* | `phase_events.parcel_count_origin` — stamped once when the phase closes | |
| `scanned_count` (live) | derivable | count of `Parcel` rows with `pp_scan_out_at` set — **but see below** | |
| `session_started_at` | derivable | `MIN(Parcel.pp_scan_out_at)` — **but see below** | |
| `dwell` | derivable | `MAX − MIN` of the same column | |
| `discrepancy` | derivable | `expected − scanned` | |

> **`Parcel.pp_scan_out_at` is `declared`.** The column exists; nothing writes it. Three of
> the six fields above are derivable *in principle* and unavailable *in fact* until the scan
> feed is integrated. **This is the single biggest gap in the audit** — the warehouse event
> is the most valuable non-driver act available before the receiver work lands, and it is
> currently sourced from an empty column.

### `linehaul-photographed` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `artifact_id` | exists | `phase_events.linehaul_photo_artifact_id` | |
| `captured_at` | exists | `evidence_artifacts.captured_at` | |
| `file_hash` | exists | `evidence_artifacts.file_hash` | |
| `captured_lat` / `captured_lng` | exists | `evidence_artifacts.captured_lat/lng` | **⚠** A second position per photo, on top of the phase row's |
| `pages` / `document_type` | new | Recommend dropping — `artifact_type` already says it | |

### `loading-confirmed` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `method` | derivable | Constant | |

---

## P3 · departure

### `seal-applied` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `seal_number` | exists | `phase_events.seal_number` | |
| `capture_method` (typed / scanned) | new | Seal note §3.2, rides FP-266. **Worth having — a scanned value is stronger evidence than a typed one** | |
| `lat` / `lng` | exists | `phase_events.driver_phone_lat/lng` | **⚠** |
| `artifact_id` | exists | `phase_events.seal_photo_artifact_id` | |

### `seal-checked-against-expected` — server

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `expected_seal_number` | **new — do not create** | Blocked on Q1. A nullable column nothing writes would be the fifth `declared` field | |

### `departure-attested` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `lat` / `lng` | exists | `phase_events.driver_phone_lat/lng` | **⚠** |
| `accuracy_m` | exists *elsewhere* | pings only, as at P1 | |
| `method` | derivable | Constant | |

### `seal-mismatch-raised` — server

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `guard_verified_seal` | **declared** | Schema field exists; **the app has not sent it since 2026-08-05**. The comparison branch at `phase_service.py:1010` is dead | |
| `seal_number_confirmed` | **declared** | Same | |

### `door-closed / geofence-lock-armed` — pulsit

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| all | new | Bruce's own verification signal. Iteration 4 | |

---

## P4 · in_transit

### `departed` · `arrival-attested` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `stop` | exists | `phase_events.trip_stop_id` → `TripStop` | |
| `leg` | derivable | Position in the plan | |
| `artifact` | never | No capture flow at the hub, by design | |

### `checkpoint-recorded` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `checkpoint_type` | exists | `Checkpoint.checkpoint_type` | |
| `lat` / `lng` | exists | `Checkpoint.driver_phone_lat/lng` | **⚠** |
| `note` | exists | `Checkpoint.note` | |
| `is_deviation` | exists | `Checkpoint.is_deviation` | |
| `selfie` / `cargo_photo` | exists | `selfie_artifact_id`, `cargo_photo_artifact_id` | **⚠** A selfie is biometric-adjacent |

### `exception-raised` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| type, source, severity, description, artifact, gps, resolution | exists | `TripException` — the most complete record in the system. **Nothing new needed** | **⚠** `gps_lat/lng` |

### `location-ping` · `route-deviation-detected`

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| pings | exists — **not a step event** | `trip_location_pings`. §4: a sample is not an act | |
| deviation | new | Pulsit, not integrated | |

---

## P5 · unloading

### `seal-inspected-intact` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `seal_number` | exists | `phase_events.seal_number` on the unloading row | |
| `entry` (blind) | derivable | Constant — the step is blind by construction | |
| `capture_method` | new | FP-266, as at P3 | |
| `artifact_id` | exists | `phase_events.gate_photo_artifact_id` | |

### `seal-broken` — **receiver** · the event this whole note exists for

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `occurred_at` | new | `UnloadingCompleteRequest` has no field for it | |
| `actor_id` / actor name | **new + unresolved** | The receiver has no account. **`pod-signed` solves the analogous problem by rendering the name into the image and never storing it — `seal-broken` has no equivalent answer yet** | **⚠⚠ Q3** |
| `seal_number` (as read) | new | Distinct from the driver's blind entry — that is the point | |
| `capture_method` (scanned) | new | Seal note §3.3: the destination *scans*, it does not type | |
| `handover_token` | new | Bound to trip + stop + nonce + short expiry | |
| `artifact_id` | **never** | `phase_meta.py:39-43` — the broken-seal photo proves nothing about the journey. **A deliberate exclusion, not a gap** | |

### `pulsit-door-open` — pulsit

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `occurred_at`, `source` | new | Not integrated | |
| `delta_from_break` | derivable | Two `occurred_at` values — **must be computed server-side at read**, never sent | |

### `scan-in-complete` — warehouse

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `expected_count` | exists | `Consignment.parcel_count_expected` for consignments delivering here | |
| `scanned_count` | derivable | `Parcel` rows with `pp_scan_in_at` — **`declared`, see P2** | |
| `session_started_at`, `dwell`, `discrepancy` | derivable | Same column, same caveat | |
| stamped count | exists | `phase_events.parcel_count_destination` — written on the **confirmation** row, not this one | |

### `visual-count-recorded` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `count` | exists | `phase_events.driver_visual_count` | |
| `entry` (blind), `required` (no) | derivable | Constants of the step | |

### `seal-continuity-verdict` — server

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `verdict` | derivable | Today it is `phase.status` plus an exception, not a value. **Read, never re-derived from the two seal strings** — `UnloadingDetail`'s rule holds at the row grain too | |

---

## P6 · confirmation

### `pod-photographed` · `pod-signed` — driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `artifact_id` | exists | `pod_photo_artifact_id`, `pod_signature_artifact_id` | |
| `captured_at`, `file_hash` | exists | `evidence_artifacts` | |
| receiver name / ID | **never** | Rendered into the signature image, never stored as a field. POPIA. **This is the precedent `seal-broken` needs** | |

### `reconciliation-shown` — server

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| origin / destination / driver counts | exists | `parcel_count_origin`, `parcel_count_destination`, `driver_visual_count` | |
| verdict | derivable | Server-derived; the step only displays it | |

### `handover-token-issued` · `handover-qr-displayed` — server / driver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| token, nonce, expiry | new | Nothing exists. FP-155 | |

### `receiver-signed-off` — **receiver** · the final act

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `occurred_at` | new | | |
| actor identity | **new + unresolved** | Same question as `seal-broken` | **⚠⚠ Q3** |
| offline fallback | **new + unresolved** | Cannot be queued — they walk away. **Q2 gates FP-155** | |

### `receiver-position-recorded` — receiver

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| `lat` / `lng` | new | A third independent fix on the most disputed moment | **⚠⚠** A *third party's* location, not an employee's. Different POPIA basis entirely |

### `count-mismatch-raised` · `anchored` · `trip-closed` — server

| Field | Status | Source today | ⚠ |
|---|---|---|---|
| mismatch | exists | Raised today | |
| receipt | exists | `blockchain_receipts` | |
| `closed_at` | exists | `Trip.closed_at` | |

---

## What the audit says

**The ledger is better supported than it looks.** Most driver-side payloads are `exists` —
seal numbers, counts, artifacts, positions and hashes are all already written. The step
event mostly gives existing values an actor and an ordering.

**Three findings worth carrying into implementation:**

1. **The warehouse event rests on a `declared` column.** `Parcel.pp_scan_out_at` /
   `pp_scan_in_at` are never written, so `scan-out-complete` and `scan-in-complete` — the
   best non-driver acts available before the receiver work — have no data source today.
   **Sequence the scan feed before the warehouse events, or the first non-driver row in the
   ledger is empty.**

2. **Position appears at three grains** — the phase row, the artifact, and now the step
   event — and test 3 has to settle all three together rather than one at a time. The ⚠ rows
   are concentrated here.

3. **Two events have an unresolved actor.** `seal-broken` and `receiver-signed-off` both
   need an identity answer that `pod-signed` already models. **Q3 is not a detail — it
   decides whether the ledger's headline capability can be built at all.**

**Not blocked on anything:** the structural columns, the driver-side payloads, the anchor
fields and the exception record. That is enough to build the ledger and prove it end to end
with driver and dispatcher actors, leaving the receiver and warehouse rows to land as their
sources arrive.
