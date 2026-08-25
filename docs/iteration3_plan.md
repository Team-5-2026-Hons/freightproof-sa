# FreightProof SA — Iteration 3 Plan

> **Status:** active · **Author:** Ciaran · **Date:** 2026-08-24
> **Window:** 4 weeks — Sprint 6 (24 Aug → 7 Sep), Sprint 7 (7 Sep → 21 Sep)
> **Presentation:** week of 21 Sep
> **Artifact (formatted):** https://claude.ai/code/artifact/0560ceef-7ecc-42a2-8877-326fe579533e
> **Meeting agenda (artifact):** https://claude.ai/code/artifact/9f14087e-a5a9-4cf2-a5d1-b3df7991cb91
> **Revised:** 2026-08-25, after verifying the iteration 2 feedback against `dev` —
> see [iteration2-feedback-response-2026-08-25.md](iteration2-feedback-response-2026-08-25.md)
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

Owners are a **proposal** drawn from commit authorship in
[jira-reconciliation-2026-08-04.md](jira-reconciliation-2026-08-04.md) — confirm, don't inherit.

### The capacity call — made deliberately, not discovered in week three

The feedback adds a fourth theme (controls and validation) and a fifth (receiver handover) to two
sprints that already carried two. Everything cannot fit. §7 notes the board has drifted twice
already; the fix is choosing now.

**Cut, with reasons:**

| Cut | Why |
|---|---|
| Client lens — view-as-client toggle + redaction | Contradicts §3's own POPIA deferral of client-grain cuts. Cutting it *because* of that reasoning is a better presentation slide than building it |
| Parcel spine UI | Chiko's parcel *search* (Sprint 6) already answers the reviewer's question. The spine visualisation is polish; iteration 4 |
| File splits — all files except `phase_service.py` | Keep the one file with a real seam and a code-review finding behind it; drop the rest of the merge-conflict risk |

**Rebalanced:** Chiko previously carried three of seven Sprint 7 stories, all frontend. Uneven story
-point distribution is the one criticism we have now received twice — it was raised about Sprint 5.

### Sprint 6 — "Where and who" · Mon 24 Aug → Mon 7 Sep

| Story | Ticket | Owner |
|---|---|---|
| Consignment unique index + failing concurrency test + `IntegrityError`→409 | new | Tom |
| **Vehicle concurrency guard** (horse + trailers) + creation-time overlap check | new | Tom |
| **Minimum trip duration** constant + validator | new | Tom |
| **`/health` DB + Redis probes**; version from config | new | Tom |
| Pulsit mock client behind `PULSE_USE_MOCK`, fixtures shaped to the real API | FP-87 | Ciaran |
| `geofence_service` — haversine against precinct radius, tolerance band | new | Ciaran |
| Write `horse_gps_*`, `pulsit_geofence_confirmed`, `trailer_gps_snapshots` per phase | new | Ciaran |
| **`_normalized_seal()` at `phase_service.py:1125`** + regression test | new | Ciaran |
| Raise `GPS_MISMATCH` on disagreement; surface on dispatcher timeline | new | Tim |
| **Live tamper alert** — emit `TAMPER_DETECTED` from all six system-exception sites | new | Tim |
| **Exception resolve/override** endpoint + dispatcher UI | new | Tim |
| Dev trigger: "move the truck" — drives the demo from the UI, no DB edits | new | Tim |
| **Parcel search** — barcode → current state + derived phase-ledger history | new | Chiko |
| **Driver-side exception photo** (`CameraCapture`) + open-exceptions on the driver trip view | new | Chiko |

Ships a demo where a truck parked 3 km away fails a handshake the phone alone would have passed —
**and the dispatcher's screen lights up the moment it does.**

### Sprint 7 — "Making it answer questions" · Mon 7 Sep → Mon 21 Sep

| Story | Ticket | Owner |
|---|---|---|
| `app/analytics/` layer + materialized views + beat refresh | new | Tim |
| **Blockchain receipt search** — optional `subject_id`, filters, lookup by hash/tx id | new | Tim |
| Dispatcher analytics screen — driver trends, **vehicle**, lane, facility, corroboration | new | Chiko |
| **Finish or delete `/sla`** — fold into the analytics screen | new | Chiko |
| **Driver passport support** — widen `id_number`, add `id_type`, per-type validation | new | Chiko |
| **Anchor evidence artifact hashes** + payload versioning + verification-compatibility test | new | Ciaran |
| **Receiver handover** — QR capability token + receiver scan page (design note §9) | new | Ciaran |
| Pulsit completion route report ingest → lane transit metrics | new | Ciaran |
| `phase_service.py` split — post-merge window only, public surfaces unchanged | new | Ciaran |
| **Chain-vs-database boundary document** + write-path walkthrough + demo script | new | Tom |
| **Evidence packet export** — what an insurer would actually need | new | Tom |

Sprint 7 is heavier than Sprint 6. If it has to give, the order of sacrifice is: evidence packet
export → `phase_service.py` split → passport support. **The artifact anchoring and the handover do
not give** — they are the two items that answer the panel directly.

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
| Client lens / view-as-client toggle | Cut from Sprint 7 — contradicts the same POPIA reasoning above. Cutting it *for that reason* is the better slide. **Contested:** specced in design note §11 and prototyped in the specimens artifact. See decision 6. |
| Parcel spine UI | Cut from Sprint 7 — **but contested.** Design note §16 calls it "the demo's best screen" and Bruce named parcel search the market gap twice. Decide in the meeting; see decision 6. |
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

1. **Close Sprint 5**; move anything incomplete to the backlog.
2. **Create and start Sprint 6** dated Mon 24 Aug → Mon 7 Sep; create Sprint 7 now.
   Sprint creation is **board-UI only** — the Atlassian MCP has no board/sprint API.
3. **Account for 11–23 Aug**: close review-response work into Sprint 6 with commit evidence in
   the comments, the approach that worked on 4 August.
4. **Create the iteration 3 epic**, file the stories under it, put the two-source framing in the
   epic description.
5. **Clear the eight outstanding items** from `jira-reconciliation-2026-08-04.md` — FP-125 has no
   parent epic, FP-5/6/7 still describe the superseded five-handshake model, FP-74/FP-91
   duplicate question unresolved.
6. **Adopt one rule:** ticket before branch, FP number in the branch name.
7. **Five minutes of board review** at the Wednesday standup.

---

## 8. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Does corroboration drive `EvidenceTag`? | Yes — but it changes what "High Evidence" means on phase events already anchored in iteration 2. Domain call, not styling. |
| 2 | ~~QR handover instead of receiver OTP?~~ **Decided in the Q&A.** | **Closed.** Ammar asked for it directly and in detail. There is no receiver OTP to replace — nothing is built — so this is greenfield, not a migration. Building tier 2 (§2); `CLAUDE.md` needs correcting. |
| 2b | Does the QR handover need receiver accounts, or is the optical capability token enough? | **Token is enough — no accounts.** The secret moves optically, so a SIM swap gains nothing; a texted code would not. Colluding receiver is the residual, surfaced via recurrence analytics. See §2 and design note §9. |
| 2c | Do driver metrics include ratings/scores, or trends only? | **Trends only.** Promised on the call, but contradicts §3's POPIA line. Decline scores, present the reasoning. Must be settled before the analytics screen is designed. |
| 6 | **Do the contested cuts stand?** Parcel spine UI and client lens | Both are specced in the design note, prototyped in the specimens artifact, and cut here on capacity. The design note calls the spine "the demo's best screen"; the lens contradicts our own POPIA line. **Recommend: restore the spine, keep the lens cut.** Team call — this doc should not silently override the design note. |
| 3 | How far on cross-operator reputation? | Spike the design now, two-org simulation in iteration 4. Strongest idea on the table, easiest to overclaim. |
| 4 | Driver-auth device binding (live SIM-swap surface)? | Risk-list entry + spike now, implement iteration 4. Raise it with Ammar unprompted. |

## 9. Blocked / needs an answer

- **Pallet grain (BLOCKING)** — does a `HandlingUnit` sit between waybill and parcel? No such model
  exists; only `Consignment.unit_count_expected`, a count with no entity. Site-visit open question
  §6.8, parked since July. It now sets the precision of the parcel view — ask Bruce before Sprint 6
  gets far. See the design note §10.
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
