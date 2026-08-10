# FreightProof SA — Demo Script & Walkthrough

**Written:** 2026-08-05 · **For:** INF4027W Honours presentation
**Covers:** Stage 6 tasks 6.5 (end-to-end walk) and 6.6 (narrative + prepared answers).

> **Scope decision (2026-08-05, Ciaran):** the demo walks a **single-leg trip — one origin, one
> destination — created live through the dispatcher UI**. No seeded trips are shown. This document is
> written to that decision. §7 records what that choice costs and what to have on a backup tab.

---

## 1. Before you start — the traps that bite on the day

| Check | Why it matters |
|---|---|
| 🔴 **Rebind the driver account to the demo phone** | One driver account is bound to one device (`DriverSession`, enforced in `auth/dependencies.py`). Rehearse on a laptop or a second phone and the presentation device is **not** the bound one. Do this the day before, not on stage. |
| 🔴 **Pre-authenticate the driver device** | Driver login is phone OTP over Twilio. Live SMS on stage depends on network and delivery timing you do not control. Log in beforehand so the session persists, or use a Supabase test number with a fixed OTP. |
| **Confirm which database `DATABASE_URL` points at** | The refactor DB and the original dev DB are different projects, on different schemas. |
| **Have the dispatcher open before the driver acts** | The live-update story only lands if the reviewer sees the screen *change*, not a screen that was already correct. |
| **Backup tab: a cross-dock trip** | See §7. Costs nothing to have open. |

---

## 2. The walk (6.5)

Each step names what the reviewer should *see*, because that is the demo.

**1. Create the trip — dispatcher.**
One origin, one destination, one consignment, a departure time. Point out that the wizard *requires* a
departure — as of 2026-08-05 the API requires one too, so a trip that could never be activated is now
unrepresentable rather than merely discouraged.

→ *On screen:* the trip appears with a **7-row phase plan, all pending**. Say the number out loud. The
plan was generated from the stops and consignments at creation — it was not looked up from a constant.

**2. Show the journey lock.**
→ *On screen:* a `journey_lock` blockchain receipt exists **already**, at creation.
Say: *"P0 is fail-closed. If the anchor fails, the trip is not created at all. Everything after this is
compared against this hash."*

**3. Driver activates — phone.**
→ *On screen (dispatcher, no reload):* the activation node ticks over and the LiveBadge shows the
update arriving. **Do not touch the browser.** This is the SSE bus, and the fact that nobody refreshed
is the point.

**4. Loading.**
The driver enters a blind count. → Say: *"The driver is never shown the expected number. If the driver
could see it, a match would prove nothing. The server reconciles privately."*

**5. Departure — the seal.**
→ *On screen:* seal number and photo captured; a `pickup` receipt anchored, fail-open.

**6. In transit → unloading → confirmation.**
→ *On screen:* the trip reaches `closed`, with a `delivery` receipt.

**7. Cancel and override — the two exits.** *(New. Nothing could do this before 2026-08-05.)*
On a second trip, override a phase the driver cannot complete, with a note.
→ *On screen:* the plan advances past it; the override banner appears with the note and who wrote it;
the dispatcher updates live. Point at `anchor_status`: it is **still pending, deliberately**. Say:
*"The receipt that was owed here never landed, and the system still says so. We could have marked it
'not required' and made the screen look clean. That would be laundering a gap in the evidence chain."*

**8. 🎥 The headline scenario — a seal mismatch at destination.**
Walk a trip where the destination seal does not match.
→ *On screen:* the exception is recorded, and **the trip carries on to `closed`, with the delivery
still anchored.**
Say, on camera: *"It would be easy to freeze the trip here. We deliberately don't. Holding the trip
destroys the remaining evidence of the very trip whose integrity we're reacting to. Recording more
beats recording less — the anomaly is on the ledger, permanently, and the delivery is still proven."*
**This is the most valuable thing to have on film.** It is the product's whole position in one screen.

**9. An empty-leg trip to `closed`.** *(Only possible since 2026-08-05.)*
A repositioning trip carries no cargo, so no loading row is generated. It now reconciles nothing and
closes cleanly, rather than 404-ing forever.

---

## 3. What you must say plainly — the honesty list

Over-claiming is precisely what gets probed at a presentation. Each of these is true today; say them
before you are asked.

- 🔴 **"Parcel Perfect load and unload completion is simulated."** `ecomService v28` cannot supply live
  load/unload status (spec §6). The integration is mocked at that boundary.
- 🔴 **"The manifest shows committed cargo, not scanned cargo."** `pp_scan_out_at` / `pp_scan_in_at`
  are read in three places and written in none; `PPTrack` carries no scan status at all.
  **Never say "actually scanned."** The ScanFeed work that would close this is planned and not built.
- **"Cargo dropped at an intermediate stop is not count-reconciled today."** Loading is checked against
  the manifest, and the final delivery is checked three ways — but an intermediate drop is checked by
  nothing. It is a known gap, scoped to the consignment-mapping stage.
- **"Only SHA-256 hashes reach the blockchain."** No GPS, no photos, no names, no parcel details.
  Personal data stays in PostgreSQL. This is a POPIA position, not an implementation detail.
- **"This records; it does not respond."** FreightProof does not reroute drivers or dispatch a
  response. It is an evidence platform.

---

## 4. Prepared answers

**"What happens when the seal doesn't match?"**
⚠️ *The answer changed on 2026-08-04. The old answer — "the trip is held" — is now wrong. Do not give it.*
> The mismatch is recorded as an exception on the ledger and the trip continues to completion, with the
> delivery still anchored. We removed the automatic hold deliberately, for three reasons: holding the
> trip destroyed the remaining evidence of the very trip whose integrity it was reacting to; the gating
> logic already treated an exception as resolved, so the hold contradicted it; and a seal mismatch at
> departure had never held a trip, so two seal mismatches behaving differently was simply inconsistent.

**"Does it catch a short load?"**
> Yes, in two places. At **loading**, the manifest total is compared against the driver's blind count —
> that raises a `PARCEL_COUNT_MISMATCH`. At **final delivery**, the origin count, the Parcel Perfect
> scan-in count and the driver's count are reconciled three ways — that raises a
> `WAYBILL_COUNT_MISMATCH`. **What it does not catch today is a shortfall at an intermediate stop**,
> because unloading captures no count. That gap is real and it is scoped.

**"When is it one trip and when is it two?"**
> It's two trips when nothing rides through. If cargo is loaded at A and all of it comes off at B, and
> different cargo goes B to C, that's two trips. It's one trip when something stays on the vehicle
> across the stop — because then the custody chain is continuous and the seal is the thing that proves
> it.

**"Why not just rename the old five-step model?"**
> Because a rename proves nothing new. The old model welded three things together: `trip.status`
> doubled as the sequencer, the database allowed one of each step per trip, and both frontends counted
> to five. Cape Town → Bloemfontein → Johannesburg, dropping *and* collecting at Bloemfontein, needs two
> loading events and two unloading events. The old schema could not store that. The plan is now data,
> and a single-leg trip is the degenerate case of the multi-stop one — one code path.

**"How do you know the phase order wasn't tampered with?"**
> The committed trip parameters, including the plan, are hashed at creation and anchored to Hedera. If
> the current record's hash doesn't match the on-chain transaction, that's tampering. The ledger is the
> source of truth; the phase label you see is derived from it, never stored as an authoritative fact.

**"What if the blockchain is down?"**
> It depends on the phase, deliberately. Trip creation is **fail-closed** — no anchor, no trip. Pickup
> and delivery are **fail-open**: the phase completes, and we record `anchor_status = failed` so the
> system still knows a receipt is owed. The dispatcher surfaces that as owed-versus-anchored. We chose
> never to let a Hedera outage silently produce a completed phase that nobody knows is missing a receipt.

**"Who attests at the destination?"**
> Today, the driver, with a one-time OTP to the receiver. In a hub cross-dock case the right attester is
> hub staff rather than a customer, and that is an open question we have not closed.

---

## 5. What changed since the last time this was demoed

Worth having ready — reviewers who saw an earlier version will ask.

- The lifecycle is plan-driven. Phase count is data.
- A seal mismatch no longer holds the trip (2026-08-04).
- A dispatcher can now cancel a trip and override a phase, both with a mandatory note, both recorded on
  the ledger as exceptions rather than only in an audit column.
- Empty-leg trips can close.
- Loading counts are scoped to the stop that does the loading.
- Concurrent completion of the same phase is now blocked by a row lock, so one phase cannot submit to
  Hedera twice.

---

## 6. If something breaks on stage

- **Driver device won't authenticate** → it is almost certainly the device binding. Have the rebind
  path ready, or present the dispatcher half alone: the dispatcher demo stands on its own and was
  always designed to.
- **A phase won't advance** → use the override you just built. It is a legitimate part of the product,
  not an admission of failure. Narrate it as one.
- **The live badge stops updating** → refresh. Say the bus is a live-update convenience; the ledger is
  the truth and a reload reads it directly.

---

## 7. What the single-leg-only decision costs

Stated so it is a deliberate choice rather than an accident.

The refactor's thesis is that a plan-driven ledger makes **multi-stop cross-dock custody**
representable — something the old five-step model could not store at all. A single-leg trip is the
**degenerate case** of that plan: 7 rows, one loading, one unloading. It is the shape the old model
already handled.

So a single-leg walk demonstrates that the system *works*, but not the thing that makes it *new*.
The two proofs that only exist on a multi-stop trip are:

- two `loading` rows opening **their own** manifest panels, keyed on phase-event id; and
- each departure showing **its own** seal — the multi-stop custody chain, visible on one screen.

**Cheap mitigation, no extra risk:** have a 3-stop cross-dock trip open on a second browser tab, walked
in advance. You do not have to demo it live. Showing an 11-row plan next to the 7-row one, and saying
*"same code path, the length is data"*, takes about twenty seconds and is the single clearest evidence
of the thesis. If a reviewer asks "does this actually do multi-stop?", that tab is the answer.

---

## 8. Open decisions this document does not make

- **`HoldNotice.tsx`** (driver PWA) renders for a trip status that can no longer occur, and still says
  "handshake" three times. Delete it, or keep it dormant against a future *manual* hold? **Tim's call.**
- **The vocabulary sweep touches `CLAUDE.md`**, which by its own rule needs a PR reviewed by all four
  team members. Raise it now, not on the last day.
