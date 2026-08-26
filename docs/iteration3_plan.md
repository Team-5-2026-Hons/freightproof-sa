# FreightProof SA — Iteration 3 Plan

> **Status:** active · **Author:** Ciaran · **Date:** 2026-08-24
> **Window:** 4 weeks — Sprint 6 (26 Aug → 7 Sep), Sprint 7 (7 Sep → 21 Sep)
> **Presentation:** week of 21 Sep
> **Artifact (formatted):** https://claude.ai/code/artifact/0560ceef-7ecc-42a2-8877-326fe579533e
> **Meeting agenda (artifact):** https://claude.ai/code/artifact/9f14087e-a5a9-4cf2-a5d1-b3df7991cb91
> **Revised:** 2026-08-25, after verifying the iteration 2 feedback against `dev` —
> see [iteration2-feedback-response-2026-08-25.md](iteration2-feedback-response-2026-08-25.md)
> **Revised again:** 2026-08-26, after the sprint 6 planning meeting. §5 now records what is
> actually on the board with FP numbers. **The Jira board is the source of truth for ownership and
> sprint membership; this document is the reasoning behind it.** Where the two disagree, the board
> is right and this file is stale — say so rather than working from the tables here.
> **Companion documents:** [scale-readiness-2026-08-18.md](scale-readiness-2026-08-18.md) ·
> [design-notes/2026-08-24-corroboration-parcel-client-views.md](design-notes/2026-08-24-corroboration-parcel-client-views.md)

---

## 0. The frame

Bruce set the sequence on 16 April: iteration 1 foundation, iteration 2 Parcel Perfect,
**iteration 3 Pulsit**. The iteration 2 review gives it a sharper job than "integrate a tracker".

Today a driver could complete every handshake on a JHB–DBN trip from their couch. The phone
reports a position, the system records it, and nothing contradicts it. That is a single
self-reported source, and it is the softest point in an evidence platform.

**The one sentence:** iteration 3 turns FreightProof from a system that records one party's
claim into one that **corroborates independent sources** — and then makes the accumulated
evidence answer business questions.

Ammar named the attack precisely in the Q&A: the driver reaches the right town, stops at a friend's
place *just before* the warehouse, and completes the swipe there — on goods "worth millions, not
like a Takealot parcel". That single scenario decomposes the iteration cleanly:

| Half | Answers | Delivered by |
|---|---|---|
| **Where** — was the truck actually at the facility? | Location corroboration | Pulsit geofence (§1) |
| **Who** — did the receiver actually confirm, or did the driver? | Identity corroboration | Receiver-controlled handover (§2) |
| **So what** — what does the accumulated evidence say? | Business value | Analytics + live alerting (§3) |

Worth stating in the presentation: **the Pulsit work already defeats Ammar's attack for location.**
A confirmation handshake signed 2 km from the warehouse fails the destination geofence check. It
does not defeat it for identity — hence the second half.

Two things the review flagged as absent that are, in fact, already built and were simply never
shown: the seal chain (departure application, independent guard re-entry, destination comparison)
and the activation gates (schedule, operating-day order, one-trip-at-a-time). Demonstrate both.

---

## 1. Pulsit is mostly already built — nothing writes to it

Verified against `dev` on 2026-08-23. The corroboration mechanism is pre-wired through the
schema, the enums and the config, and every piece below is never written.

| Already in the schema | Where | State |
|---|---|---|
| Tracker registered per vehicle, unique per org | `vehicles.pulsit_device_id` | Written |
| Driver's phone fix at each handshake | `phase_events.driver_phone_lat/lng` | Written |
| Vehicle tracker fix at each handshake | `phase_events.horse_gps_lat/lng` | **Always null** |
| The corroboration verdict | `phase_events.pulsit_geofence_confirmed` | **Always null** |
| Per-trailer independent reading | `trailer_gps_snapshots` | **No writer** |
| Geofence radius per facility | `precincts.geofence_radius_metres` | Default 200 m |
| Agreement tolerance | `GPS_TOLERANCE_METRES` | Set to 50, unused |
| Exception type for disagreement | `ExceptionType.GPS_MISMATCH` | **Never raised** |
| Mock/real switch and credentials | `PULSE_USE_MOCK`, `PULSE_API_URL` | Declared, unread |

**Consequence: the geofence feature needs no migration.** It needs an integration client, a
comparison service, and the four writes that fill those columns. `phase_service.py:976` carries
the note saying so — *"Pulsit geofence departure confirmation is out of scope until the Pulsit
integration lands; pulsit_geofence_confirmed stays null until then."*

Caveat to state rather than hide: `Checkpoint.horse_gps_lat` *is* written today, but from the
driver's own request payload in `checkpoint_service.py`. That is still one source wearing two
hats. Pulling it from Pulsit is what makes it independent.

### What corroboration checks

Not "is the truck at the warehouse" — Pulsit already answers that, and live tracking is out of
scope per [scope-boundaries.md](scope-boundaries.md). The check is narrower and evidentiary:
**at the moment the handshake was signed, did two independent sources agree the truck and the
driver were both inside the facility geofence?**

Pulsit is read at **handshake moments** plus the completion route report Bruce described on
26 March — not streamed. That keeps FreightProof recording rather than operating.

**Access position for this iteration: mock-only.** Pulsit has not yet replied to our access
request, so everything is built to the real API shape behind `PULSE_USE_MOCK`, using the Redis
`mock_state` + dev-trigger pattern already proven for Parcel Perfect. When credentials arrive it is
a config change, not a rewrite. Do not let the integration block on their reply.

**New from the Q&A:** Pulsit also has cameras in the cab and on the truck doors, and footage
snippets could in principle be pulled for the window around an exception. That is a different call
pattern from our handshake-moment reads. Design note and a question for Bruce — not a build, and
mock-only regardless.

---

## 2. The other half: receiver-controlled handover

Today every input to the delivery confirmation is produced on the driver's device — the receiver's
name, their ID number, the signature, the GPS fix, the photo. Verified: there is no receiver
account, no receiver OTP, and nothing server-side stores the receiver's identity. The name and ID
are rendered *into* the signature image and go no further (deliberately, for POPIA).

`CLAUDE.md` says "Receiver = one-time OTP". That is design intent — **no such code exists.**

### The property that matters

Not identity registration. **That the confirmation is produced somewhere the driver cannot produce
it — and that the secret never touches a network a SIM swap can intercept.**

The design note §9 already works this through, and its approach stands: **move the secret off the
network and onto the glass.**

1. The driver's device displays a QR encoding a one-time capability token bound to *this* trip,
   *this* stop, a nonce, and a short expiry (~5 min).
2. The receiver scans with their ordinary phone camera. No install, no account, no SIM in the loop.
3. The scan opens a page that captures the receiver's own position and posts the confirmation
   against that capability token.

**Why this beats sending a code to a phone number** — and this corrects an earlier draft of this
section, which proposed exactly that:

- **SIM swap gains nothing.** The token never travels over SMS or WhatsApp; it is transferred
  optically, in person, and expires. Any scheme that texts a code re-opens the hole Ammar named.
- **It proves physical co-presence.** The receiver stood in front of the driver's screen.
- **It supplies a third independent fix** — the receiver's device reports position at receipt, from
  a party with no incentive to help the driver. Ammar's stop-short attack lands *outside* the
  delivery precinct and is caught by the same geofence machinery as §1.
- **No onboarding friction**, so it does not stall on client-side adoption.

**Residual weakness, state it yourself:** a *colluding* receiver at the correct location still
defeats this, and no handover mechanism survives both parties colluding. What FreightProof can do is
make collusion leave a trace — the receiver's device and position are anchored, so the same
"receiver" recurring across unrelated deliveries surfaces in the recurrence analytics.

### What cannot be built, and why it matters that we say so

An early proposal was to skip accounts entirely by identifying the receiver's device from the page
it opens, via IP and MAC address.

- **MAC address is unobtainable from a browser.** Stripped at the first network hop. Not buildable.
- **IP address is close to worthless in this market.** SA mobile is heavily CGNAT'd; thousands share
  one address, and driver and receiver on the same warehouse wifi are identical. Record it as a weak
  signal; never as an identifier.
- **POPIA runs the other way.** Fingerprinting someone with no account and no consent is *harder* to
  justify than onboarding them.

Also: the receiver holds no private key, so a literal receiver-side digital signature is not
achievable without enrolment. What is achievable is a **server-attested record** — the server signs
a canonical handover payload and anchors the hash. Note `backend/app/crypto/` currently contains only
`hashing.py`; there is no signing implementation, despite `CLAUDE.md` describing one.

### Design points

- Single-use token, 5–15 min expiry, bound to the phase event, issued server-side.
- **Server timestamp only** — never trust the client clock.
- Capture the receiver's browser Geolocation fix. With the driver's fix and Pulsit's, that is three
  independent position sources on the most disputed moment in the trip.
- Record whether the redeeming request carried the driver's own session — a strong tamper signal,
  recorded as evidence rather than used as a gate, following the seal-mismatch precedent.
- Hash the handover record into the confirmation canonical payload — which requires the artifact-
  anchoring work (Sprint 7) to land first, since that is what introduces payload versioning.

**The honest framing, for the presentation:** this makes fraud *provable*, not *impossible*. A
determined driver with a second handset defeats any browser-based scheme; device ownership cannot be
proven without enrolment. For an evidence platform that is the correct goal, and stating it is
stronger than overclaiming to a panel already thinking about goods worth millions.

---

## 3. Analytics: read models, not new writes — plus a live tier

No aggregation layer exists — a genuine gap. But nothing needs instrumenting. `exceptions`
already carries type, source, severity, resolution state and FKs to trip, phase event,
checkpoint, consignment and stop; `phase_events` is an append-only ledger, so every dwell time
and delay is derivable. "This driver has too many exceptions" is one `GROUP BY` away today.

Also inherited: a **dead page is live in the deployed dispatcher.** `useSLAMetrics` is a stub
returning `null`, `/sla` renders nothing, and the `sla_configs` table has no endpoint and no writer.
Finish it or delete it this iteration — an empty live page is the worst artefact to have in front of
a marker.

**Batch architecture:** Postgres materialized views refreshed by the Celery beat schedule that
already exists in `app/tasks/__init__.py` for the Parcel Perfect poll, exposed through a thin
`app/analytics/` layer. No new capture path, no new failure mode, nothing near the evidence chain.

### The live tier — the Q&A's sharpest ask, and it is ~90% built

> *"It would be actually great to get a ping if something is tampered. I'm not going to tamper with
> the delivery itself, but if I'm sitting at the office, I actually want to know that live."*

Note the second sentence: **the panel pre-empted our own scope boundary.** This is a notification
request, not a dispatch request. It sits inside "evidence, not operations", and batch materialized
views cannot answer it — that was exactly the criticism.

The infrastructure already exists. `core/realtime.py` publishes thin `TripEvent` notifications on a
per-org Redis channel, consumed by the dispatcher over SSE — the capability the demo marksheet
praised. But **only driver-raised exceptions emit an event.** `exception_service.py:110` emits
`EXCEPTION_RAISED`; six system-detected exceptions are written directly via
`db.add(TripException(...))` and bypass it entirely — including both CRITICAL `SEAL_MISMATCH` sites
(`phase_service.py:1024`, `:1147`).

**A driver pressing panic pings the dispatcher. A broken seal does not** — the dispatcher gets a
cheerful "phase completed" toast for a CRITICAL tamper signal. Precisely backwards.

Fix: emit `EXCEPTION_RAISED`, or a new `TAMPER_DETECTED` kind so the UI can raise a louder signal,
wherever a system exception is written. Extend to `GPS_MISMATCH` as §1 lands it. Severity-gated, per
the site-visit finding that logistics staff handle minor driver errors informally and escalate only
when evidence is needed.

| Grain | Metric | Derived from |
|---|---|---|
| Driver | Severity-weighted exceptions per 100 trips; on-time departure; phase latency; override rate | exceptions, phase_events |
| **Vehicle** *(promoted)* | Breakdown exceptions per trip; mean time between exceptions; trips since last incident — answers *"is it the driver's fault or the truck's fault?"*, asked directly in the Q&A. Carries no POPIA weight, unlike driver metrics | vehicle_events, exceptions |
| Lane | p50/p90 actual transit vs planned per origin→destination; exception density | trips, trip_stops, phase_events |
| Facility | **Corroboration rate per precinct** | phase_events, precincts |
| Geofence | Corroboration rate per driver — only possible once Pulsit lands | phase_events, exceptions |

The **facility** grain is the one nobody asks for and everybody needs: entirely non-personal,
immediately actionable, and the control that stops driver metrics being read naively. If one
depot corroborates at 40 %, the problem is the depot.

### POPIA line — keep it descriptive

The moment the dashboard shows driver **risk scores**, you are profiling employees on
POPIA-protected location data, and you have crossed the documented boundary from recording into
responding. Trends per driver, yes. Automated scoring that affects someone's employment, not
without an explicit decision on the record. See the reputation section of the design note for
the cross-operator variant of this question.

Client-grain metrics (disputed-delivery rate, POD completeness) are deferred — per-client cuts
are where the POPIA reasoning gets harder. This supersedes the 18 August review, which had the
client grain as the one to build second; the facility grain takes its place.

**Unresolved conflict — decide before the analytics screen is designed.** Driver ratings were asked
for in the Q&A (*"a particularly problematic driver with incidents being reported — is that
something we're interested in?"*) and answered in the affirmative on the call. That contradicts the
paragraph above. Both positions are defensible; holding both silently is not.

Recommendation: keep per-driver **trends** (exception counts, on-time rate), decline automated
**scores** that could affect employment, and present that reasoning explicitly. Declining a
requested feature on a documented legal ground — while offering the facility grain as the
alternative that actually finds the problem — demonstrates more judgement than either building it
quietly or dropping it quietly.

---

## 4. Controls, validation, and the open bug

The demo marksheet's lead sentence was *"The next iteration should focus on controls, validation and
security."* Verification found the picture is mixed — scheduling and the seal chain are already
built and were simply never demonstrated, but six real gaps remain. All are small, all are visible,
and together they are the cheapest marks available this iteration.

| Gap | Evidence | Fix |
|---|---|---|
| **No vehicle concurrency guard** | `_other_trips_for_driver` (`phase_service.py:655`) filters on `Trip.driver_id` only. One horse can be on two live trips | Mirror `_reject_if_another_trip_underway` onto horse + trailers |
| **No overlap check at creation** | `create_trip` checks existence, `is_active`, org, duplicate `order_number` — nothing else. The code admits it: *"Nothing at trip creation stops a dispatcher assigning a driver two overlapping trips"* | Warn the dispatcher at the point of the mistake |
| **No minimum trip duration** | Only `arrival <= departure` is rejected. A JHB–DBN trip declared as 60 seconds passes | Constant + validator; optional distance sanity check (precinct coords already exist) |
| **Exceptions can never be resolved** | `resolved`, `resolved_by_user_id`, `resolved_at`, `resolver_note` all exist (`transit.py:90-95`); **nothing writes them** (`endpoints/exceptions.py:1`) | Dispatcher resolve/override endpoint + UI. **Prerequisite** — "block on unresolved exceptions" would deadlock every trip until this exists |
| **Driver sees no warnings** | `HoldNotice.tsx` renders on `trip.status === 'exception_hold'`; nothing in `app/` ever sets that status (`trip_service.py:115`). Dead code | Surface open exceptions from the exception list, not from `trip.status`. Asked for in the Q&A too |
| **Driver cannot photograph an exception** | Backend accepts `supporting_artifact_id`, dispatcher renders it — but `LogExceptionPageClient.tsx` has a picker and a textarea and **no camera** | Drop in the existing `CameraCapture` component. Q&A: *"pictures with time stamps so that we can really know for sure"* |

**What of this is actually committed for Sprint 6** (26 Aug): the seal defect (FP-144), exception
resolution (FP-146), driver warnings and the exception photo (FP-150), and `/health` (FP-141). The
vehicle concurrency guard (FP-139), the creation-time clash view (FP-142) and minimum trip duration
(FP-260) went to the backlog — done this iteration if room appears, otherwise iteration 4. Every gap
in the table above is still real; three of them are simply not promised this sprint. See §5.

**One defect inside otherwise-good code:** the destination seal comparison (`phase_service.py:1125`)
compares raw strings, while departure normalises via `_normalized_seal()` (`:929`). A seal typed as
`"abc123 "` against `"ABC123"` raises a CRITICAL mismatch on a seal that matched. The receiving clerk
types this on a phone keyboard, so this will happen.

Two more, from the code marksheet: `/health` returns `status="ok"` unconditionally and never touches
the database (`main.py:148-153`) — it reports healthy with Postgres down; and `GET
/blockchain/receipts` requires **both** `subject_type` and `subject_id`, so an investigator holding
only a Hedera transaction id cannot get back to the record.

### The open bug — still goes first

Carried from the 18 August review, still unfixed. In `consignment_service.py` the reassignment
guard reads `consignment.trip_id`, compares, and raises — with no row lock, and no unique
constraint on `parcel_perfect_reference`. Two dispatchers citing the same waybill concurrently
both pass the check. The same cargo lands on two trips, each anchoring its own journey-lock hash.

On a platform whose claim is evidentiary integrity that is a credibility failure. It is one
migration: a unique index, then let `IntegrityError` become the 409 exactly as
`vehicle_service.py` already does.

**Write the failing concurrency test first** — two simultaneous `create_trip` calls on one
waybill. A race only reasoned about is a race you cannot prove you fixed, and that test is the
most convincing single artifact for the concurrency question.

---

## 5. The two sprints

**Confirmed at the planning meeting on 26 August, and this section now matches the board.** The
owners below are no longer a proposal drawn from commit authorship — they are what is assigned in
Jira. Sprint 6 started 26 August at 09:33 and runs to 7 September; every scope change described here
was made on day 0, in one batch, so the burndown records a single step rather than a drift.

### What changed on 26 August

| Change | Where it landed |
|---|---|
| **Pulsit and the geofence are Tim's**, not Ciaran's — FP-68, FP-87, FP-116 as one block | Sprint 6 |
| **Documentation moved to Sprint 7** — FP-151, FP-152 join FP-162 to FP-166 | Realistic: it gets written in the fortnight before the presentation regardless |
| **Precinct CRUD added** — FP-259, five subtasks | New. Nothing on the board wrote precincts; the geofence demo could not be staged without hand-written database rows |
| **Analytics screen pulled forward** — FP-156 | Sprint 6, so it runs alongside the read models it depends on |
| **Controls partly deferred** — FP-139, FP-142, FP-260 to the backlog | Done this iteration if there is room, otherwise iteration 4 |
| **Driver-side barcode scanner** — FP-266, subtask of FP-149 | Demo kit, behind the dev panel, because Parcel Perfect has not replied |
| **Passport support dropped** | Had no ticket; not carried into either sprint |

Three things raised in the meeting were checked against `dev` and turned out to be **already built**:
the `precincts` table itself (the meeting assumed it needed creating), the `admin_dispatcher` role
and its gates, and dispatcher call logging — which FP-146 already covers via `DISPATCHER_NOTE`, with
no migration. Two were **rejected on evidence**: BLE handover (see decision 7) and polygon geofences
(decision 8).

One claim made in the meeting is **false and must not reach the panel**: that the driver portal is
disabled outside the geofence. Nothing reads `geofence_radius_metres` or `GPS_TOLERANCE_METRES`
today — that is precisely what FP-68 builds. Until it lands, we do not have geofence enforcement.

### The capacity call — made deliberately, not discovered in week three

The feedback adds a fourth theme (controls and validation) and a fifth (receiver handover) to two
sprints that already carried two. Everything cannot fit. §7 notes the board has drifted twice
already; the fix is choosing now.

**Cut, with reasons:**

| Cut | Why |
|---|---|
| Client lens — view-as-client toggle + redaction | Contradicts §3's own POPIA deferral of client-grain cuts. Cutting it *because* of that reasoning is a better presentation slide than building it |
| ~~Parcel spine UI~~ | **Reversed 26 Aug** — restored as FP-149 (Sprint 7, Ciaran), plus FP-266 for the driver-side scanner. See decision 6 |
| File splits — all files except `phase_service.py` | Keep the one file with a real seam and a code-review finding behind it; drop the rest of the merge-conflict risk |

**Rebalanced:** Chiko previously carried three of seven Sprint 7 stories, all frontend. Uneven story
-point distribution is the one criticism we have now received twice — it was raised about Sprint 5.

### Sprint 6 — "Where and who" · Tue 26 Aug → Mon 7 Sep

15 stories, 80 points. Committed.

| Ticket | Story | Owner | Pts |
|---|---|---|---|
| FP-138 | The same waybill cannot land on two trips — unique index, failing concurrency test first, `IntegrityError`→409 | Ciaran | 5 |
| FP-144 | A seal typed with a trailing space raises a false CRITICAL tamper alert — `_normalized_seal()` at the destination comparison | Ciaran | 2 |
| FP-146 | Exceptions can be resolved, and the phone call gets recorded | Ciaran | 8 |
| FP-147 | A broken seal pings the dispatcher — emit from all six system-exception sites | Ciaran | 5 |
| FP-148 | Scope the alert stream so the critical one is not buried | Ciaran | 5 |
| FP-141 | A health endpoint that actually probes | Ciaran | 3 |
| FP-259 | An admin dispatcher can create and edit a precinct | Ciaran | 5 |
| FP-68 | Geofence service — haversine against precinct radius, tolerance band | Tim | 3 |
| FP-87 | Pulsit client, mock-backed and credential-ready | Tim | 5 |
| FP-116 | "Move the truck" — drive the demo from the UI | Tim | 2 |
| FP-143 | Fill the four corroboration columns that are always null | Tim | 5 |
| FP-145 | Position disagreement raises `GPS_MISMATCH` and shows on the timeline | Tim | 3 |
| FP-150 | The driver can photograph an exception | Tim | 5 |
| FP-153 | Analytics read models over the existing ledger | Thomas | 8 |
| FP-156 | Dispatcher analytics screen *(pulled forward)* | Thomas | 8 |
| FP-154 | Anchor the evidence artifact hashes | Chiko | 8 |

Distribution: Ciaran 33 · Tim 23 · Thomas 16 · Chiko 8. Uneven, and knowingly so — Chiko's single
story is on the critical path. If it needs rebalancing mid-sprint, FP-259's subtasks split cleanly.

**The corroboration chain must land in order:** FP-68 → FP-87 → FP-143 → FP-145. FP-259 gates the
demo staging for all of them, because a geofence check is only as good as the precinct it measures
against. FP-138 still goes first regardless — the failing concurrency test is the most convincing
single artifact we can put in front of the concurrency question.

Ships a demo where a truck parked 3 km away fails a handshake the phone alone would have passed —
**and the dispatcher's screen lights up the moment it does.**

### Sprint 7 — "Making it answer questions" · Mon 7 Sep → Mon 21 Sep

14 stories. Not yet started; still movable.

| Ticket | Story | Owner |
|---|---|---|
| FP-149 | Find a parcel by barcode and see everywhere it has been *(incl. FP-266, driver-side scanner for the demo — Tim)* | Ciaran |
| FP-167 | `phase_service.py` split — post-merge window only, public surfaces unchanged | Ciaran |
| FP-155 | Receiver confirms on their own phone, via a rotating QR | Tim |
| FP-158 | Pulsit route reports feed lane transit metrics | Tim |
| FP-161 | Evidence packet export — what an insurer would actually need | Thomas |
| FP-162 | Chain-versus-database boundary document and write-path walkthrough | Thomas |
| FP-163 | Two feedback slides: verified as built, and declined with reasons | Thomas |
| FP-151 | Solution architecture slide and readable package and DB diagrams *(moved from Sprint 6)* | Thomas |
| FP-157 | Look up a blockchain receipt by hash or transaction id | Chiko |
| FP-159 | Finish or delete `/sla` | Chiko |
| FP-164 | Standards adopted, branching strategy and story-point distribution | Chiko |
| FP-165 | Demo script for what already exists and was never shown | Chiko |
| FP-166 | Demo rehearsal and reliable phone mirroring | Chiko |
| FP-152 | Rebuild the state machine as states, not process *(moved from Sprint 6)* | Chiko |

Sprint 7 is heavier than Sprint 6 and ends in presentation week. If it has to give, the order of
sacrifice is: evidence packet export → `phase_service.py` split. **The artifact anchoring (FP-154,
Sprint 6) and the receiver handover (FP-155) do not give** — they are the two items that answer the
panel directly.

**The documentation risk this creates, stated so nobody is surprised by it.** All six documentation
tickets now sit in the fortnight that also carries the receiver handover, the parcel search and the
demo rehearsal. Diagrams are the cheapest marks on the marksheet and the easiest thing to run out of
time for. Start FP-151 and FP-152 in the first week of Sprint 7, not the last.

### The backlog pool — "if there is time"

Deferred on 26 August rather than cut. Done this iteration if room appears, otherwise iteration 4.
Query them with `labels = "iteration-3" AND sprint IS EMPTY`.

| Ticket | Story |
|---|---|
| FP-139 | One horse cannot be on two live trips — vehicle concurrency guard |
| FP-142 | The dispatcher sees the vehicle clash before creating a trip |
| FP-260 | A trip cannot be declared with an impossible duration |
| FP-120 | NFC feasibility and cost analysis vs barcodes and RFID |

### On the file splits

`phase_service.py` (1,387 lines) has an obvious seam — six `advance_*` wrappers over one
`_finish_phase` — and becomes a `phase_service/` package with the shared gate, lock and finish
primitives in `_core.py`. Scheduled late deliberately: those files are hot on three branches,
and splitting a 1,387-line file mid-sprint is a merge-conflict grenade. Execute in the quiet
window straight after a merge to `dev`, tests first.

---

## 6. Explicitly not in iteration 3

| Cut | Why |
|---|---|
| `parcel_events` append-only ledger | The derived timeline already answers the reviewer's question. Revisit iteration 4. |
| Client-portal scaffold | Still a stub. A third frontend surface while two features land is how iterations slip. |
| Client-grain analytics | Deferred on the POPIA cut, not on effort. |
| Client lens / view-as-client toggle | Cut from Sprint 7 — contradicts the same POPIA reasoning above. Cutting it *for that reason* is the better slide. **Confirmed cut on 26 Aug**; decision 6 is closed. |
| ~~Parcel spine UI~~ | **No longer cut.** Restored on 26 Aug as FP-149 (Sprint 7), with FP-266 adding the driver-side scanner. Design note §16 called it "the demo's best screen" and Bruce named parcel search the market gap twice. |
| BLE receiver handover | Not buildable receiver-side — no Web Bluetooth on iOS, and a browser cannot advertise as a peripheral. Decision 7. The QR is the mechanism. |
| Polygon geofences | Circle and radius only; polygon is a geometry column and a migration. Decision 8. Iteration 4. |
| Per-dispatcher alert routing / third role tier | Needs a trip-to-dispatcher assignment model that does not exist. Decision 11. Iteration 4. |
| Stationary-driver push alert | Raised 26 Aug. Derivable from `trip_location_pings` without Pulsit, so it is feasible — but it is new scope and brushes the live-position boundary. Iteration 4. |
| Blockchain opt-in / opt-out per client | Raised 26 Aug as a commercial question — Hedera costs per transaction, and a client may not want to pay for immutability. A real product question, not iteration 3 work. Note it for the report. |
| Merkle batching (FP-63) | Iteration 2 carry-over; nothing in the review asked for it. |
| Real Pulsit sandbox wiring | Mock-only — Pulsit has not replied. `PULSE_USE_MOCK` means real creds are a config change, not a rewrite. |
| Pulsit cab/door camera footage | New from the Q&A. Different call pattern; design note and a question for Bruce, not a build. |
| Smart locks / receiver-controlled unlocking | Ammar explicitly parked these — *"once you do the main core things, then iteration three or four."* Take the deferral he offered. |
| Cross-company driver model | `Driver.organization_id` is single-valued. Spike only — see decision 3. |
| Live truck position on the trip map | Out of scope per scope-boundaries.md; still pending Bruce. |

---

## 7. Jira

The board has drifted twice the same way. Sprint 5 ran 27 July → 10 August, and the fortnight
since — including the iteration 2 presentation and the review response — sits in no sprint.
The fix is starting the sprint on the day the work starts.

1. ~~**Close Sprint 5**; move anything incomplete to the backlog.~~ **Done.**
2. ~~**Create and start Sprint 6**; create Sprint 7 now.~~ **Done 26 Aug** — Sprint 6 is active
   (26 Aug 09:33 → 7 Sep), Sprint 7 exists and is unstarted. Sprint creation is **board-UI only**;
   the Atlassian MCP has no board or sprint API, though issues can be moved between existing
   sprints through the sprint field.
3. **Account for 11–23 Aug**: close review-response work into Sprint 6 with commit evidence in
   the comments, the approach that worked on 4 August. *Still outstanding.*
4. ~~**Create the iteration 3 epic**, file the stories under it.~~ **Done** — every Sprint 6 and 7
   story sits under an epic (FP-2, FP-4, FP-6, FP-7, FP-8, plus FP-136 *Evidence Analytics & Live
   Alerting* and FP-137 *Documentation Iteration 3*). Put the where/who/so-what framing in the epic
   descriptions if it is not there yet.
5. **Clear the eight outstanding items** from `jira-reconciliation-2026-08-04.md` — FP-125 has no
   parent epic, FP-5/6/7 still describe the superseded five-handshake model, FP-74/FP-91
   duplicate question unresolved. *Still outstanding.*
6. **Adopt one rule:** ticket before branch, FP number in the branch name.
7. **Five minutes of board review** at the Wednesday standup.

**Housekeeping done 26 Aug:** FP-128 to FP-134 (the iteration 2 phase-refactor stages, all Done)
were re-labelled `iteration-2`. They had been carrying `iteration-3` and polluting every label
query — `labels = "iteration-3"` now returns only current work.

---

## 8. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Does corroboration drive `EvidenceTag`? | Yes — but it changes what "High Evidence" means on phase events already anchored in iteration 2. Domain call, not styling. |
| 2 | ~~QR handover instead of receiver OTP?~~ **Decided in the Q&A.** | **Closed.** Ammar asked for it directly and in detail. There is no receiver OTP to replace — nothing is built — so this is greenfield, not a migration. Building tier 2 (§2); `CLAUDE.md` needs correcting. |
| 2b | Does the QR handover need receiver accounts, or is the optical capability token enough? | **Token is enough — no accounts.** The secret moves optically, so a SIM swap gains nothing; a texted code would not. Colluding receiver is the residual, surfaced via recurrence analytics. See §2 and design note §9. |
| 2c | Do driver metrics include ratings/scores, or trends only? | **Trends only.** Promised on the call, but contradicts §3's POPIA line. Decline scores, present the reasoning. Must be settled before the analytics screen is designed. |
| 6 | ~~**Do the contested cuts stand?** Parcel spine UI and client lens~~ **Settled 26 Aug.** | **Closed.** The spine is restored as **FP-149** in Sprint 7 — barcode in, everywhere it has been out — with **FP-266** adding a driver-side scanner so it can be demonstrated from a physical label rather than a typed reference. The client lens stays cut, on the POPIA reasoning in §3 rather than on capacity. |
| 7 | ~~BLE handover instead of the QR?~~ **Settled 26 Aug.** | **Closed — QR stays primary, BLE is not buildable.** The receiver has no app, so their side is a browser: Web Bluetooth does not exist in Safari on iOS at all, and a phone browser cannot advertise as a BLE peripheral — it is a GATT client only. It also costs us the property the design rests on: no install, no account, no SIM in the loop. Recorded on FP-155. **Worth a slide** — evaluating and rejecting it on evidence answers the panel better than never considering it. NFC is a different case: the seal tap is on the driver's own Capacitor Android build, where a native plugin works (FP-120, writeup only). |
| 8 | ~~Polygon geofences for precincts?~~ **Settled 26 Aug.** | **Closed — circle and radius this iteration.** A polygon needs a geometry column and a migration; `geofence_service` reads a radius either way, so the circle version is what FP-68 consumes with no rework when polygon lands in iteration 4. FP-259 is explicitly scoped without it. |
| 9 | ~~Can a precinct belong to more than one organization?~~ **Settled 26 Aug.** | **Closed — the schema already answers it.** `principal_organization_id` is the owner, `is_shared` is the cross-org visibility opt-in (SEC-PRECINCT-1). True many-to-many ownership is a migration plus a rework of every org-scoped query, which is a security surface. Not this iteration. Do not reopen. |
| 10 | Does the receiver handover store an ID number and a selfie? | **Open, and it gates FP-239.** Proposed on 26 Aug. Today receiver name and ID are rendered *into* the signature image and go no further — deliberately. Storing an ID number and a facial image for a person with **no account and no consent** is a materially heavier POPIA position than anything we currently hold. **Recommend: position only for iteration 3**, and present the reasoning. Settle before the scan page is written. |
| 11 | Per-dispatcher alert routing and a third role tier | **Iteration 4, not now.** Raised on 26 Aug: at RTT scale a tamper alert should ping only the dispatcher who owns that trip. Blocked on four things that do not exist — a trip-to-dispatcher assignment (`created_by_user_id` and `approving_dispatcher_user_id` mean neither), a third `DispatcherRole` value, a per-person Redis channel, and the SSE consumer to match. FP-148 stays org-scoped this sprint; severity scoping is its actual job and is unaffected. |
| 3 | How far on cross-operator reputation? | Spike the design now, two-org simulation in iteration 4. Strongest idea on the table, easiest to overclaim. |
| 4 | Driver-auth device binding (live SIM-swap surface)? | Risk-list entry + spike now, implement iteration 4. Raise it with Ammar unprompted. |

## 9. Blocked / needs an answer

- **Pallet grain (BLOCKING)** — does a `HandlingUnit` sit between waybill and parcel? No such model
  exists; only `Consignment.unit_count_expected`, a count with no entity. Site-visit open question
  §6.8, parked since July. **Not raised at the 26 August meeting, and it now sets the precision of
  FP-149**, which is in Sprint 7. Ask Bruce this week. See the design note §10.
- **Driver trends versus scores (BLOCKING FP-156)** — decision 2c above, still unsettled, and FP-156
  moved into Sprint 6 on 26 August. It only gates the driver panel: build facility, then vehicle,
  then lane, and leave the driver panel until the call is minuted. Settle it this week regardless —
  the answer shapes how the whole screen is framed to the panel.
- **Receiver ID number and selfie** — decision 10 above. Gates FP-239. Do not add either to the scan
  page before it is decided.
- **Time-to-proof manual baseline** — needed from Bruce for the impact panel. Do not invent a
  figure for an industry panel.
- **Pulsit access** — no reply yet. Everything stays mock-only behind `PULSE_USE_MOCK`; the
  integration must not block on them. Chase, but do not wait.
- **What insurers actually need** — raised in the Q&A (*"we need to look into what the insurers would
  need"*), and nobody has modelled the insurer as the evidence consumer. Ask Bruce and Ammar; it
  shapes the evidence-packet export.
- **Two `CLAUDE.md` drifts** — it documents "Receiver = one-time OTP" and an Ed25519 `crypto/` layer.
  Neither exists (`backend/app/crypto/` holds only `hashing.py`). Four-reviewer PR required.
- **`DriverSubstitution` write path** — the model exists (`db/models/trips.py:215`); whether anything
  writes it is unverified. Check before citing it in the presentation.
- **Sprint ownership link** in `CLAUDE.md` is still a placeholder.

---

## 10. What changes in the presentation

Half the last round's engineering feedback was a documentation failure, not a code failure. The
transactional outbox, the row lock on the Hedera anchor, and the offline queue's refusal to
re-take a GPS fix on replay are all decisions worth more than the features around them — and
none were visible from the outside. **Walk the panel through the write path before the screens**,
and open with the corroboration demo rather than closing on it.

That argument is now measurable. Of the technical feedback we received, **seven points describe
things that already exist on `dev`** — scheduling validation, the seal chain, GPS and timestamps at
POD, exception photo plumbing, passport handling for receivers, batch processing, and security
beyond authentication. None of it was visible from the demo. See
[iteration2-feedback-response-2026-08-25.md](iteration2-feedback-response-2026-08-25.md).

### Demonstrate what already exists

- The **seal chain** end to end: applied and photographed at departure, independently re-entered by
  the exit guard, compared again at destination, mismatch → CRITICAL exception that deliberately
  does *not* halt the trip. Explain that last choice — it is the strongest judgement call in the code.
- The **activation gates**: schedule, operating-day ordering, one-trip-at-a-time.
- The **async pipeline**: Celery beat, the anchoring queue, the transactional outbox.
- The **security layer**: rate-limit budgets, single-device enforcement, idle timeout, org-scoped
  queries.

### Answer the written feedback directly

Two slides. First: the points we verified as already built, with file references — showing we
audited rather than assumed. Second: the points we are declining, with reasons — driver *scores*
on POPIA grounds, smart locks because Ammar deferred them, the client lens because it contradicts
our own privacy position. **A defended cut scores better than a silent one.**

### Address the presentation marksheet directly

The engineering feedback and the presentation feedback are almost disjoint sets — the marksheet
raised validation, diagrams and process; the Q&A raised live alerting, the attack scenario and
insurers. Both need answering:

- State explicitly that FreightProof is **self-sponsored**, and clarify Ammar's role as industry input
- Add a **high-level solution architecture** slide — flagged as missing
- Name the **standards adopted**
- Explain the **branching strategy** and the **story-point distribution**, including why Sprint 5 was
  heavier and what §5's capacity call does about it this time
- **Enlarge or segment** the package/database diagram; explain the data layer and DB boundary
- **Rebuild the state machine as states, not process.** The reviewers were right: the phase sequence
  is a process; `TripStatus` (CREATED → ACTIVE → CLOSED / CANCELLED) is the state model. Show both,
  labelled as what they are
- Bring the **chain-vs-database boundary** document — asked for directly: *"what goes on your chain
  and what goes in your relational database? You must sit down and flesh it out nicely"*
- Arrange **reliable phone mirroring** — mobile interaction was hard to see
- Present **from prompts, not notes**. Several presenters read from slides; it cost us marks under
  General

### Open on the attack, not the architecture

Ammar handed us the demo script: a driver stops at a friend's place two kilometres short of the
warehouse and signs for the delivery. Show it failing the geofence, show the dispatcher's screen
lighting up in the same second, then show the handover the driver cannot complete alone. Everything
else in the iteration is context for that ninety seconds.
