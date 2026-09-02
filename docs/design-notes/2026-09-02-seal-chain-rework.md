# Seal Chain Rework — Making the Seal a Multi-Party Control

> **Status:** design spec, pre-implementation · **Author:** Ciaran · **Date:** 2026-09-02
> **Parent:** [../iteration3_plan.md](../iteration3_plan.md)
> **Sibling:** [2026-09-01-phase-step-event-ledger.md](2026-09-01-phase-step-event-ledger.md) — the
> event structure this rework needs in order to record a non-driver act
> **Sources:** Bruce calls [1 Sep](../meeting_minutes/FreightProof_Meeting_Bruce_Minutes_01September2026.md)
> and [28 July](../meeting_minutes/FreightProof_Meeting_Bruce_Minutes_28July2026.md) ·
> [../scope-boundaries.md](../scope-boundaries.md) §3
> **Verified against `dev`/Ciaran on 2026-09-02.**

The seal mechanism is well engineered and singly sourced. Every seal observation in the
system is produced by the driver, on the driver's device — which puts a single self-reported
source underneath the one field the journey-lock hash commits to. That is the same weakness
Ammar named for GPS, in a place it matters more.

Bruce's 1 September description supplies the fix, because it names **three parties who
legitimately know the seal number**, and none of them is a gate guard.

---

## 1. What exists today

| Where | What happens | File |
|---|---|---|
| Format | `^[A-Z]{2}-\d{4}$` — `AB-1234`, hard-coded, mirrored client-side | `schemas/phases.py:20`, `lib/utils/seal-format.ts` |
| Departure | Driver **types** the number and photographs the seal | `steps/departure/CaptureSeal.tsx` |
| Departure (server) | Written to the row, folded into the canonical payload, anchored | `phase_service.py:993` |
| Guard re-entry | `seal_number_confirmed` / `guard_verified_seal` — **the app has not sent these since 2026-08-05**; the comparison branch is effectively dead | `phase_service.py:1010` |
| Unloading | Driver **types** blind — not shown the expected value, not told the verdict — and photographs it intact | `steps/unloading/SealVerify.tsx` |
| Unloading (server) | Compares normalised destination seal against *this leg's* departure. Mismatch → CRITICAL, never holds the trip | `phase_service.py:1129-1207` |
| Dispatcher | Per-leg seal + photo; verdict read from phase status, never re-derived | `DepartureDetail.tsx`, `UnloadingDetail.tsx` |

The blind entry, the per-leg departure lookup and the refusal to halt the trip are all
correct and should not be touched. **The problem is provenance, not mechanism.**

---

## 2. What Bruce's description changes

> "The seal number is recorded on the waybill between ourselves and RTT. The driver may not
> know that seal — of course he can read it, but nowhere in his set of documents does he
> have it. Johannesburg branch alerts Durban branch that the seal number needs to be intact.
> Durban verifies it by scanning it, and then they break it. And that's the moment when
> custody transfers." — 1 September

Corroborated by 28 July, which is stronger than it looked at the time: the destination
control room *"holds the container-lock keys plus the expected seal number to check
against"*, and all three signals — geofence status, lock key, seal number — *"should
reconcile at the destination when the seals are broken"*.

Three consequences: the seal is a **pre-existing inter-company control value**, not something
the driver originates; the **destination scans it**, not types it; and **breaking it is the
custody-transfer moment**, performed by the receiving party.

---

## 3. Five gaps, in the order I would fix them

### 3.1 The format will reject a real seal · **live demo risk**

`AB-1234` is invented. Real barcoded seals are vendor-numbered — typically 6–10 digits,
sometimes with an alphanumeric prefix. **The moment a real seal is put in front of the app,
both the client pre-check and the server validator reject it**, in the driver app and at
`schemas/phases.py`. It is also a hard-coded magic pattern, against `CLAUDE.md`'s own rule.

*Fix:* relax to a length-and-charset constraint, keep the normalisation (strip + upper),
move the strict pattern to config. Cheap, and it removes a failure mode that would be
maximally visible during a demo with a physical seal.

### 3.2 Nobody in the real process types a seal — they scan it

Both capture points are keyboard entry on a phone. That is what produced FP-144 in the first
place. **FP-266** already scopes a driver-side barcode scanner for the parcel spine
(Sprint 7); pointing it at the two seal steps is incremental, not new work.

*Fix:* scan-or-type on both steps, recording **which** — a scanned value is stronger
evidence than a typed one, and the distinction belongs on the record.

### 3.3 The expected seal has no independent origin

FreightProof first learns the number when the driver types it at departure. A driver who
types `AB-9999` and photographs a seal reading `AB-9999` produces a chain that is internally
consistent and verifies nothing.

*Fix:* an expected seal on the trip, so departure becomes a **comparison** rather than an
origin — and, if the number is known at creation, a commitment inside the **journey-lock
hash**, which is where the real strength is.

> **Do not build this before Q1 is answered** (§5). The commitment at creation is the
> valuable half; a comparison alone is the weak half. This codebase already carries four
> declared-but-never-written fields (`pulsit_geofence_confirmed`, `pp_scan_out_at`/
> `pp_scan_in_at`, `GPS_TOLERANCE_METRES`, `sla_configs`); the PP spec calls a permanently
> false field *"the worst of the three options"* and the iteration 3 plan calls the dead
> `/sla` page *"the worst artefact to have in front of a marker"*. A nullable
> `expected_seal_number` that nothing writes would be the fifth. One column and one
> conditional, once Bruce answers.

### 3.4 We already hold the inter-branch alert — we just never show it

The origin branch phoning the destination is a manual step today. FreightProof captures the
departure seal, hashes it and anchors it to Hedera **at departure** — so the destination's
copy could be tamper-evident and timestamped instead of verbal.

*Fix:* surface the departure seal on the **destination stop's dispatcher view** as "expected
at this stop". Near-zero code, no schema change, and it replaces a real manual step with an
anchored one. **The cheapest credibility win in this whole area.**

Keep it off the driver's screen — the blind entry at `SealVerify.tsx` is deliberate, and the
comment explaining why is one of the better arguments in the codebase.

### 3.5 The moment custody transfers is not recorded

`phase_meta.py:39-43` removed the broken-seal photo because it *"proves nothing about the
journey"*. That is right, and it answers a different question than the one Bruce defined:

| Claim | Evidence | Status |
|---|---|---|
| The trailer was not opened in transit | Intact photo at arrival | ✅ correct today, leave alone |
| **Custody passed to the receiver at time T** | The scan-and-break, by the receiving party | ❌ recorded nowhere |

*Fix:* add the break as a **custody-transfer event with a non-driver actor** — which requires
the step-event ledger (sibling note, P5 event 2). Do **not** restore the broken-seal photo as
journey evidence; that reasoning stands.

---

## 4. The chain this produces

| Observation | Source | Driver controls it? |
|---|---|---|
| Expected seal | Waybill / dispatcher | No |
| Applied seal + photo | Driver, at departure | Yes |
| Found seal, blind | Driver, at arrival | Yes |
| **Break** | Receiving branch | **No** |
| **Door-open event** | Pulsit hardware | **No** |

Four parties, five observations, the driver controls two. The last two are the pairing Bruce
asked for unprompted: *"for a backup it would be great if there's somehow a tie-up with that
scan of the barcode seal."*

### Sizing

| When | Work |
|---|---|
| **Now — hours, demo-visible** | §3.1 format fix · §3.4 destination-side expected seal |
| **Sprint 7 — rides existing tickets** | §3.2 on FP-266 · §3.5 binding on FP-155 |
| **Iteration 4 — own decision** | §3.3 expected seal, pending Q1; Pulsit door-open pairing |

§3.3 touches trip creation and the journey-lock hash. It wants its own decision, not a
squeeze into a sprint that ends in presentation week.

---

## 5. Questions for Bruce

1. **When is the seal number assigned** — pre-issued to a trip, or at the moment of sealing?
   *Gates §3.3 and decides whether the seal can join the journey-lock hash.* The 28 July
   minutes suggest the destination holds an expected number in advance, but not whether it
   exists at trip creation.
2. **A photo of a real seal and its number**, so §3.1's constraint matches reality rather
   than our invention.
3. **Who physically scans at the destination** — a clerk with a WMS scanner, or a phone?
   *Decides whether the QR handover is realistic in that warehouse, and whether `seal-broken`
   has a receiver actor or only a driver witness (sibling note Q3).*
4. **Does the seal number appear on the Parcel Perfect waybill record**, or only on the
   inter-company waybill? *Decides whether §3.3's expected value can ever be automatic.*

---

## 6. Already fixed — do not re-do

**FP-144 is done on `dev`/Ciaran and tested.** The iteration 3 plan §4 still lists the
destination comparison as raw-string, but `phase_service.py:1129` and `:1140` both normalise
through `_normalized_seal()`, and `tests/unit/test_phase_service.py:1289` covers it. Close
the ticket; the plan text is stale, not the code.
