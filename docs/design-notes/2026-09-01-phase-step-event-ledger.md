# The Phase Step-Event Ledger — What Happens *Inside* a Phase

> **Status:** design spec, pre-implementation · **Author:** Ciaran · **Date:** 2026-09-01
> **Parent:** [../iteration3_plan.md](../iteration3_plan.md)
> **Sources:** Bruce call 1 Sep ([minutes](../meeting_minutes/FreightProof_Meeting_Bruce_Minutes_01September2026.md)) ·
> [2026-08-24-corroboration-parcel-client-views.md](2026-08-24-corroboration-parcel-client-views.md) ·
> [../scope-boundaries.md](../scope-boundaries.md)
> **Verified against `dev`/Ciaran on 2026-09-01** — every "exists today" claim below cites a file.

A phase has one timestamp. The acts inside it have none. A departure with two capture
steps is one row, one `completed_at`, one anchor — so the ledger knows the phase happened
and cannot say in what order, how long it took, or **who** performed each part.

That last one is the whole problem. Bruce's 1 September description of custody transfer
turns on acts performed by people who are not the driver: the destination branch scans and
breaks the seal, and the receiver signs off once everything is off the truck. Neither act
has anywhere to live in the current model. `UnloadingCompleteRequest` has no field for a
seal break, and `core/phase_meta.py:43` records that the broken-seal photo "was never even
sent to this server".

**The one sentence:** phases stay the custody and anchoring unit; a child ledger records
the individual acts inside them, each with its own actor, its own timestamps and its own
hash — which is what lets a non-driver act be recorded at all.

---

## 1. What exists today

| Layer | Granularity | Where |
|---|---|---|
| `phase_events` | **One row per phase.** One `completed_at`, one `event_hash`, one `idempotency_key`, one anchor | `db/models/phases.py` |
| Steps | **Client-side only** — a capture recipe, never sent as discrete events | `core/phase_meta.py` `STEP_SLUGS`, `components/phase/steps/registry.ts` |
| Drafts | localStorage per `(tripId, phaseEventId)`, submitted in **one POST** at the end | `lib/hooks/usePhaseDraft.ts` |
| `evidence_artifacts.captured_at` | Per-photo capture time — **already written, never surfaced** | `db/models/evidence.py:46` |
| `trip_location_pings` | Append-only per-fix trail — the precedent for what this note proposes | `db/models/locations.py:35` |
| `core/realtime.py` | Thin SSE notifications, publish-after-commit via outbox (D9). Kinds are coarse | `RealtimeKind` |

Per-event timestamps are not foreign to this schema. They exist on artifacts and on pings.
They are simply not first-class, not ordered, and not attributable to an actor.

---

## 2. The design — a child ledger, not a finer phase plan

**Do not make the phase plan finer.** The plan is a domain sequence generated from stops and
consignments (`orchestration/phase_plan.py`); its length is data, and `sequence_number`
plus the D3 unique constraints depend on that meaning. Steps are a capture recipe — a
different axis. Promoting them to phase rows breaks the "position is derived from the
ledger" invariant the whole iteration 2 refactor was built on.

Add `phase_step_events` beneath it, append-only:

```
id
phase_event_id   FK -> phase_events.id
trip_id          denormalised, for org-scoped queries and indexing
step_slug        validated server-side against the phase's recipe
sequence_number  ordinal within the phase
occurred_at      client clock — when the act happened
recorded_at      server clock — when we learned of it (server_default now())
actor_type       driver | receiver | dispatcher | warehouse | pulsit | system
actor_id         nullable
payload          JSONB, small and step-specific
artifact_id      nullable FK -> evidence_artifacts
event_hash       char(64)
idempotency_key  unique partial index, driver-originated rows only
```

### The seven decisions inside that

**1. Two clocks, both recorded.** `occurred_at` is evidence; `recorded_at` is authority.
Offline capture makes a single server clock unachievable, and pretending otherwise is worse
than being explicit about which one we would defend. `lib/hooks/useOfflineQueue.ts` already
applies this principle to position — it stores the fix from swipe time rather than re-taking
it on replay, because a ping recorded on reconnect "would claim the driver completed the
phase wherever they happened to reconnect". Same reasoning, applied to time.

**2. Append-only, never updated.** A retaken photo emits a *new* event superseding the old
one. The driver who reshoots three times leaves that trace, and the trace is itself evidence.

**3. Do not anchor every event.** Hedera charges per transaction, and per-client blockchain
cost is already an open commercial question (iteration 3 §6 — and the team is considering
making Hedera opt-in entirely, which makes per-event anchoring worse still). Instead: each
step event carries an `event_hash`, and the **phase's** canonical payload includes the
ordered list of step hashes — or a Merkle root over them, which is what **FP-63** was always
for. One anchor per phase, identical cost, but the anchor now commits to every intermediate
act *and its timestamp*. Strictly stronger evidence for zero extra spend, and it gives the
dormant Merkle ticket a reason to exist.

**4. Live is nearly free.** `enqueue_event` onto the existing outbox with a new
`RealtimeKind`. The channel stays thin — ids and a kind, no payload — so the POPIA surface
is unchanged. One caveat: the dispatcher currently refetches `GET /trips/{id}` per event,
and step granularity multiplies that. Debounce client-side, or add a narrow steps endpoint.

**5. Phase completion becomes a fold, not a capture.** The final POST stops carrying the
evidence and asserts completion, with the server verifying the required step events exist.

**6. Migration with no big bang.** Keep the existing completion endpoints accepting the full
payload, and have them *derive* step events from what they receive. Offline queues keep
draining, older app builds keep working, and steps move to live emission one at a time. This
matters more than it sounds: the offline queue and the anchoring path are the two things
that currently work well, and they are what a rushed migration would break.

**7. Step ordering is server-side.** `STEP_SLUGS` lives only in the app today. Mirror it
server-side so an out-of-order or unknown step is rejected, exactly as
`orchestration/phase_gate.py` already gates phases — that file exists in one place
precisely because "both must agree". Without it, "every event has a timestamp" is a
client-trusted list.

---

## 3. The event map

**Legend** — ✅ exists as a recorded thing today · 🔶 the data exists but is not an event
(lumped into the phase row, or on a child table) · 🆕 new
**Actors** — `D` dispatcher · `Dr` driver · `R` receiver · `W` warehouse scan feed ·
`P` Pulsit · `S` server

### P0 · trip_creation — dispatcher, no stop, **anchored**

| # | Event | Actor | State |
|---|---|---|---|
| 1 | `waybill-looked-up` (per PP reference) | D | 🔶 `pp_lookup_service`, wizard-time, not recorded |
| 2 | `consignment-attached` | D | 🔶 `Consignment` row |
| 3 | `stops-committed` | D | 🔶 `TripStop` rows |
| 4 | `resources-assigned` (driver, horse, trailers) | D | 🔶 trip columns |
| 5 | `expected-seal-recorded` | D | ⏸ **conditional — do not build yet**, see §7 Q1 |
| 6 | `plan-generated` (N pending rows) | S | 🔶 `build_phase_plan`, implicit |
| 7 | `journey-lock-hashed` | S | ✅ `compute_journey_lock_hash` |
| 8 | `anchored` | S | ✅ own timestamp on `blockchain_receipts`, async outbox |

### P1 · activation — driver, first stop only, unanchored

| # | Event | Actor | State |
|---|---|---|---|
| 1 | `trip-adopted` | Dr | 🔶 client-side `adoptTrip` only |
| 2 | `schedule-gate-passed` | S | 🔶 `_reject_if_not_due` — decision not recorded |
| 3 | `concurrency-gate-passed` | S | 🔶 `_reject_if_another_trip_underway` |
| 4 | `gate-arrival-position` | Dr | 🔶 columns on the phase row (**required** here, uniquely) |
| 5 | `pulsit-position` | P | 🆕 FP-143 — `horse_gps_lat/lng` exists, always null |
| 6 | `geofence-verdict` | S | 🆕 FP-68 — `pulsit_geofence_confirmed` exists, always null |
| 7 | `activation-attested` | Dr | ✅ step `2-verification` — a bare swipe, no evidence |

### P2 · loading — any stop that picks up, unanchored, **gated on scan-out**

| # | Event | Actor | State |
|---|---|---|---|
| 1 | **`scan-out-complete`** — one event when the warehouse finishes | W | 🔶 today only a gate release (`phase_gate.py`, `ScanDirection.OUT`); `Parcel.pp_scan_out_at` holds N timestamps with no event row |
| 2 | `linehaul-photographed` | Dr | 🔶 artifact **already carries `captured_at`** |
| 3 | `loading-confirmed` | Dr | ✅ step `1-linehaul` swipe |

### P3 · departure — every stop but the last, **anchored (PICKUP)**

| # | Event | Actor | State |
|---|---|---|---|
| 1 | `seal-applied` — number + photo | Dr | ✅ step `2-capture-seal` (typed today; scanned via FP-266) |
| 2 | `seal-checked-against-expected` | S | ⏸ conditional on Q1 — makes departure a comparison rather than an origin |
| 3 | `door-closed / geofence-lock-armed` | P | 🆕 Bruce's own verification signal, iteration 4 |
| 4 | `departure-attested` + phone fix | Dr | ✅ step `4-departure` |
| 5 | `pulsit-position` + `geofence-verdict` | P/S | 🆕 |
| 6 | `seal-mismatch-raised` | S | ✅ but **effectively dead** — depends on `seal_number_confirmed`, which the app has not sent since 2026-08-05 |
| 7 | `hashed` + `anchored` | S | ✅ the seal number is in the canonical payload |

### P4 · in_transit — paired with each departure, unanchored

| # | Event | Actor | State |
|---|---|---|---|
| 1 | `location-ping` × many | Dr | ✅ `trip_location_pings` — **stays its own table**, see §4 |
| 2 | `checkpoint-recorded` | Dr | ✅ own table, own timestamp |
| 3 | `exception-raised` — panic, mechanical, cargo damage, refusal, seal broken in transit | Dr | ✅ own table, **already emits realtime** |
| 4 | `route-deviation-detected` | P/S | 🆕 |
| 5 | `arrival-attested` | Dr | ✅ in-transit hub swipe — an attestation, no artifact by design |

### P5 · unloading — any stop that drops off · **the seal break is the first act**

| # | Event | Actor | State |
|---|---|---|---|
| 1 | `seal-inspected-intact` — blind entry + photo | Dr | ✅ step `2-seal-verify` |
| 2 | **`seal-broken`** | **R** | 🆕 **nowhere to put it today.** `UnloadingCompleteRequest` has no field; `phase_meta.py:43` records the photo "was never even sent to this server" |
| 3 | `pulsit-door-open` | P | 🆕 the same moment as 2 — the cross-check Bruce asked for unprompted |
| 4 | **`scan-in-complete`** — one event when the warehouse finishes | W | 🔶 gate release only (`ScanDirection.IN`); `Parcel.pp_scan_in_at` holds N timestamps |
| 5 | `visual-count-recorded` | Dr | ✅ step `4-visual-count`, blind, optional |
| 6 | `seal-continuity-verdict` — match / mismatch / unverified | S | ✅ but as a **phase status + exception**, not as its own event |
| 7 | `unloading-confirmed` | Dr | ✅ |

### P6 · confirmation — final stop only, **anchored (DELIVERY)**

The receiver's sign-off is the **last** act of the trip — after everything is off the truck
and the count is settled. It is not the seal break, which opened the stop at P5.

| # | Event | Actor | State |
|---|---|---|---|
| 1 | `pod-photographed` | Dr | ✅ step `1-pod-photo` |
| 2 | `pod-signed` | Dr | ✅ step `2-pod-signature` — receiver name/ID rendered *into* the image, never stored (POPIA) |
| 3 | `reconciliation-shown` | S | ✅ the server derives `pp_scan_in_count` from `Parcel` rows; the step only displays it |
| 4 | `handover-token-issued` | S | 🆕 bound to trip + stop + nonce + short expiry |
| 5 | `handover-qr-displayed` | Dr | 🆕 |
| 6 | **`receiver-signed-off`** | **R** | 🆕 **the final act** — everything delivered, everything scanned out |
| 7 | `receiver-position-recorded` | R | 🆕 a third independent fix on the most disputed moment |
| 8 | `count-mismatch-raised` | S | ✅ |
| 9 | `hashed` + `anchored` + `trip-closed` | S | ✅ |

### Dispatcher — any time, always online, never queued

`phase-overridden` (✅ with note on the row) · `trip-cancelled` (✅) · `exception-resolved`
(FP-146, in flight) · `dispatcher-note` (✅ `DISPATCHER_NOTE`) · `precinct-edited` (FP-259).

---

## 4. Volume: the ledger records **acts, not samples**

Two streams could each produce hundreds of rows per trip. Neither becomes a step event.

- **Location pings** stay in `trip_location_pings`. A position sample is not an act.
- **Parcel scans** stay on `Parcel.pp_scan_out_at` / `pp_scan_in_at`. The *act* is the
  warehouse finishing, which is also the moment the driver has been waiting for and the
  moment `phase_gate.py` already releases the phase.

So the scan produces **one** event per stop per direction, carrying what a second event
would otherwise have told us:

```
scan-out-complete / scan-in-complete
  started_at      when the session opened  -> facility dwell time, no second row
  expected_count
  scanned_count
  discrepancy     false | short | unexpected_barcode
```

A short scan is the **same** event with a different outcome, not a separate path — and it is
what raises `PARCEL_COUNT_MISMATCH`. This keeps the dwell metric that makes the facility
analytics grain worth having, without doubling the ledger.

---

## 5. Offline — a driver-app concern only

The dispatcher sits at a hub on wifi; the receiver is on their own phone at a warehouse;
the scan feed, Pulsit and the server are all server-side. **Only driver-originated events
can be queued.** Everything else is live-only, and for those `occurred_at == recorded_at`.

For driver events the existing queue extends unchanged in shape: each event is enqueued at
capture with its `occurred_at` and an idempotency key generated once (never regenerated on
retry, per `useOfflineQueue.ts`), and drained **in recorded order** when signal returns.
`recorded_at` will bunch up on reconnect. That is honest and must be visible rather than
smoothed — the dispatcher timeline shows each queued act as its own event at its own
`occurred_at`, with the sync gap legible.

**The one thing this cannot cover:** the receiver's sign-off is on *their* phone and cannot
be queued, because they walk away. If the warehouse is a dead zone the handover fails. A
documented fallback is required — today's driver-captured signature, explicitly recorded at
a lower evidence tier. **Decide this before FP-155 is written, not after.**

---

## 6. Client versus server computation

The rule, stated once: **the client may pre-check, only the server may decide, and no value
the client computes is ever stored as fact.**

The codebase is already largely disciplined about this. `UnloadingDetail.tsx` reads the seal
verdict from phase status and explicitly refuses to re-derive it from the two strings;
`phase_gate.py` centralises gating so the read schema and the completion guard cannot drift.
Four places where the rule is not clean:

| Where | Issue | Verdict |
|---|---|---|
| `lib/utils/seal-format.ts` ↔ `schemas/phases.py:20` | The same regex in two places | **Acceptable** — client pre-checks for UX, server decides. This is the pattern to standardise, not remove |
| `orchestration/phase_plan.py` ↔ `shared/lib/mocks/phase-trips.ts` | The docstring admits it: *"the two must emit identical plans; the backend is authoritative if they ever drift."* No test enforces it | Add the equivalence test |
| `core/phase_meta.py` ↔ `shared/lib/constants/phase-meta.ts` | Recipes duplicated. Once the server validates step order (§2 decision 7), the server copy must win | Server-authoritative |
| `DepartureCompleteRequest.guard_verified_seal` | The schema says the server comparison "supersedes the client-computed" flag — right direction, but the client-computed field is still on the wire | Remove once no client can still send it |

None is a live security hole. All four are the kind of drift that becomes one.

---

## 7. Open questions

**Q1 — When is the seal number assigned: pre-issued to a trip, or at the moment of sealing?**
*(Bruce.)* This gates `expected-seal-recorded` at P0 and `seal-checked-against-expected` at
P3, and it decides whether the seal can join the **journey-lock hash** — which is the entire
value of the idea. A comparison without commitment at creation is the weak half.

**Do not build the column before the answer.** This codebase already carries four declared-
but-never-written fields (`pulsit_geofence_confirmed`, `pp_scan_out_at`/`pp_scan_in_at`,
`GPS_TOLERANCE_METRES`, `sla_configs`), the Parcel Perfect spec calls leaving a permanently
false field *"the worst of the three options"*, and the iteration 3 plan calls the dead
`/sla` page *"the worst artefact to have in front of a marker"*. A nullable
`expected_seal_number` that nothing writes would be the fifth. It is one column and one
conditional when the answer arrives.

**Q2 — Receiver fallback when the warehouse has no signal.** §5. Gates FP-155.

**Q3 — Does `seal-broken` require the receiver, or can the driver witness it?** The receiver
performing it is what makes it non-driver evidence. If in practice the driver photographs a
break performed by staff who will not touch a QR, the event survives but its actor —
and therefore its evidential weight — changes. Ask alongside the seal questions.

**Q4 — Step-event retention and POPIA.** Each driver event carries a position. More events
means a denser location record on an employee. The §5 boundary in the corroboration note
applies unchanged, but the volume argument is new and should be stated before it is built.

---

## 8. Sizing — and what to do before the presentation

This is a migration, a new model, new endpoints, a driver-app rework and a dispatcher
timeline rework. **It is not Sprint 6 or Sprint 7 work.** Landing it in the fortnight before
the presentation puts the anchoring path and the offline queue — the two things that
currently work — at risk for a structural gain the panel cannot see.

**Sequencing: spike and this note in Sprint 7, implement in iteration 4.**

What ships cheaply now, and demonstrates the same idea honestly:

1. **Render `evidence_artifacts.captured_at` as a sub-timeline under each phase** on the
   dispatcher trip detail. Those timestamps already exist and are already written — this
   surfaces data we hold. No migration, no schema change.
2. **Emit a realtime event on artifact upload**, so the sub-timeline fills in live during
   the demo.

Labelled for what it is: *"these are the capture times we already record; the full
sub-event ledger with non-driver actors is iteration 4."* A defended partial beats a rushed
migration, and it is the same argument §10 of the iteration 3 plan makes about declining
features on stated grounds.
