# Iteration 2 Feedback — Verification Against the Codebase

> **Status:** draft for team review · **Author:** Ciaran · **Date:** 2026-08-25
> **Verified against:** `dev` @ 0e23afd, 2026-08-25
> **Sources:** Iteration 2 Presentation & Demo Evaluation (57/80) · Coding Presentation Marksheet
> (39.1/56) · Q&A transcript from the 12 August session (Ammar Canani + panel)
> **Companion:** [iteration3_plan.md](iteration3_plan.md)

---

## 0. Why this document exists

Before rewriting the iteration 3 plan around the review feedback, every technical claim in both
marksheets and the Q&A transcript was checked against the actual code on `dev`.

That check was worth doing. **Roughly half the technical feedback describes gaps that genuinely
exist. About a third describes things that are already built — several of them built carefully, with
the reasoning recorded in the code. One paragraph of the code review does not appear to describe
this project at all.**

Building already-built features again would burn Sprint 6 and would read, to a marker who opens the
repo, as a team that does not know its own codebase. The better response is this: answer every point
with a file and line number, act on what is real, and say plainly and politely where we think a
point does not apply.

**Every claim below can be checked by opening the cited file.** If any citation is wrong, that is a
defect in this document — please flag it in review.

---

## 1. Summary

| Verdict | Count | Meaning |
|---|---|---|
| **Confirmed** | 14 | The gap is real. Build it. |
| **Already built** | 7 | Exists on `dev` today. Show it, do not rebuild it. |
| **Partly** | 3 | Half-right — one side built, the other side missing. |
| **Does not apply** | 4 | Appears to describe a different codebase. |

Plus **one gap that no source found** (§6), which we assess as more serious than anything raised —
and which the transcript independently asked us to go and document.

---

## 2. Demonstration feedback — "controls, validation and security"

### 2.1 "The system should validate driver and vehicle availability"

**Verdict: Partly. Driver availability is enforced at activation. Vehicle availability is not
enforced anywhere. Neither is enforced at trip creation.**

What exists — `backend/app/orchestration/phase_service.py:672`, `_reject_if_another_trip_underway`.
A driver cannot *activate* a second trip while another is ACTIVE or EXCEPTION_HOLD. The docstring
gives the reasoning: two live trips claiming the same driver, horse and trailers "makes the custody
chain of both unprovable."

What does not exist:

1. **No vehicle guard at all.** `_other_trips_for_driver` (`phase_service.py:655`) filters on
   `Trip.driver_id`. There is not one `horse_id` or `trailer_id` concurrency check anywhere in
   `phase_service.py`. One horse can be on two live trips simultaneously.
2. **No guard at creation.** `trip_service.create_trip` (`trip_service.py:192-218`) validates
   existence, `is_active`, org ownership, and duplicate `order_number` — nothing else. The code
   already admits this, at `phase_service.py:655`:

   > *"Nothing at trip creation stops a dispatcher assigning a driver two overlapping trips, and
   > until now nothing stopped the driver activating both."*

**Action:** mirror the driver guard onto horse and trailers; add a creation-time overlap check so
the dispatcher is warned at the point of the mistake rather than the driver blocked hours later.

---

### 2.2 "…scheduling…"

**Verdict: Already built.** Three independent layers:

| Layer | Where | What it enforces |
|---|---|---|
| Schema | `schemas/trips.py` — `TripCreateRequest.validate_request` | A resolvable schedule is mandatory; arrival after departure; trailers unique; `trip_type` consistent with consignments; no duplicate `pp_reference` |
| Activation date | `phase_service.py:630` `_reject_if_not_due` | Cannot activate before the scheduled operating day; an unscheduled trip is treated as permanently not-due rather than always-allowed |
| Activation order | `phase_service.py:688` `_reject_if_an_earlier_trip_is_due` | Within one operating day, trips must be started in departure order |

**Action:** none. Demonstrate this explicitly next time — it was built and not shown.

---

### 2.3 "…minimum trip duration…"

**Verdict: Confirmed.**

The only duration rule is `planned_arrival_at <= planned_departure_at` → reject. A
Johannesburg–Durban trip declared as sixty seconds is accepted. There is no `MIN_*` duration constant
in `core/config.py` and no distance-aware plausibility check.

**Action:** add a minimum-duration constant and validator. Consider a softer secondary check against
straight-line distance between origin and destination precincts — the coordinates are already on
`Precinct`.

*Also:* `TripCreate` (`schemas/trips.py:149`) carries a duplicate `validate_arrival_after_departure`,
but no endpoint or service uses `TripCreate` — the API path is `TripCreateRequest` throughout. Worth
collapsing.

---

### 2.4 "…seal numbers…"

**Verdict: Already built — one of the stronger parts of the codebase. One real defect inside it.**

The seal chain, all in `phase_service.py`:

1. **Departure** (`:988-1037`) — the driver applies and photographs the seal.
2. **Independent guard re-entry** — the exit-gate guard re-enters the seal, compared intra-request.
3. **Three-state, not two** — `guard_verified_seal` is `Optional[bool]`: "not asked", "could not
   verify", and "verified and did not match" are three different pieces of evidence.
4. **Destination** (`:1122-1155`) — destination seal compared to the departure seal; mismatch writes
   a CRITICAL `SEAL_MISMATCH`.
5. **Deliberately does not halt the trip** (`:1126-1145`), with a four-point rationale — centrally,
   that a hold "DESTROYED the remaining evidence of the very trip whose integrity it was reacting to."

**The defect:** departure normalises the seal before comparing (`_normalized_seal`, `:929` —
`strip().upper()`). The destination comparison at `:1125` does not:

```python
if payload.seal_number_at_destination != departure_event.seal_number:
```

A seal entered as `"abc123 "` against `"ABC123"` raises a CRITICAL mismatch on a seal that matched.
The receiving clerk types this on a phone keyboard, so this will happen.

**Action:** one-line fix, plus the regression test.

---

### 2.5 "…unresolved exceptions…"

**Verdict: Confirmed — and the problem is upstream of what the reviewers described. Nothing in the
system can resolve an exception at all.**

`TripException` carries the full resolution vocabulary (`db/models/transit.py:90-95`):
`resolved`, `resolved_by_user_id`, `resolved_at`, `resolver_note`.

**No code path writes any of them.** `api/v1/endpoints/exceptions.py:1`:

> *"Driver-raised exception endpoint. Dispatcher list/resolve/override (spec §3.6) are out of scope
> for this plan — flagged, not silently dropped."*

So "block progression on unresolved exceptions" is unbuildable: every exception is unresolved
forever, and such a gate would deadlock every trip that ever recorded an anomaly.

**Action:** build the dispatcher resolve/override endpoint and UI **first**. That converts four dead
columns into a working feature and makes the reviewers' actual request possible in iteration 4.

---

### 2.6 "…and departure location"

**Verdict: Confirmed. The iteration 3 plan's §1 claims all check out.**

Every piece of the corroboration mechanism exists in the schema and none of it is ever written:

| Element | Location | State |
|---|---|---|
| `pulsit_geofence_confirmed` | `db/models/phases.py:85` | Never written |
| `PhaseEvent.horse_gps_lat/lng` | `db/models/phases.py:83` | Never written |
| `trailer_gps_snapshots` | `db/models/phases.py:147` | No writer |
| `GPS_TOLERANCE_METRES` | `core/config.py:109` | Declared, never read |
| `precincts.geofence_radius_metres` | `db/models/organisations.py:53` | Declared, never read |
| `ExceptionType.GPS_MISMATCH` | `db/models/enums.py:89` | Never raised |

The plan's honest caveat is correct: `Checkpoint.horse_gps_lat` *is* written today — but from the
driver's own request payload (`checkpoint_service.py:29`), which is one source wearing two hats.

Note the frontend already anticipates this: the driver's exception picker explicitly filters out
`gps_mismatch` as "system-detected" (`LogExceptionPageClient.tsx:20-21`).

**Action:** as planned. Sprint 6's headline.

---

### 2.7 "Reliance on a phone number, WhatsApp and OTP creates an identity risk"

**Verdict: Confirmed in principle. The implication that only authentication exists is not accurate.**

Already present beyond plain authentication:

- Rate-limit middleware, eight named budgets (`core/limits.py`)
- Deliberate middleware ordering (`main.py:67-85`) so a 429 still carries CORS headers
- Single-device enforcement and idle timeout (`auth/sessions.py`)
- Org-scoped filtering at the DB level, so record existence does not leak across orgs
- Artifact size and content-type limits, with a stored-XSS regression test

Genuinely missing: **nothing binds a driver to a device or a key.** A duplicated SIM gets the OTP and
gets the session. Ammar gave a concrete Mozambican example — an insider at the carrier issues a
second SIM on someone else's name.

**Action:** device binding stays open decision #4 (spike now, implement iteration 4). Raise it with
Ammar unprompted. Add the existing security surface to the presentation — it exists and was never
shown.

---

### 2.8 "The current swipe/signature confirmation could be completed by the driver"

**Verdict: Confirmed on the substance. The supporting suggestions — GPS, timestamps, photographic
proof — are already built.**

Already captured at confirmation:

| Evidence | Where |
|---|---|
| POD photo | `phase_service.py:1218` `pod_photo_artifact_id` |
| Signed attestation image | `phase_service.py:1219` `pod_signature_artifact_id` |
| GPS fix on **every** phase | `phase_service.py:725` `_record_driver_position` |
| Receiver name + ID number | `DigitalSignature.tsx` — the swipe does not arm without both |
| Timestamp at signing | `signedAt`, taken at the swipe |

And the fix is taken deliberately well (`DigitalSignature.tsx:66-70`):

> *"The fix is taken at the swipe, not on mount: a position captured when the screen opened could be
> minutes and a warehouse away from where the receiver actually signed, and the attestation claims
> the latter."*

**The valid core stands:** all of it is produced on the driver's device. There is no receiver
account, no receiver OTP, and nothing server-side stores the receiver's identity — the name and ID
are rendered *into the signature image* and travel only as far as Supabase Storage (deliberately,
for POPIA: `render-attestation.ts`). A determined driver controls every input.

See §7 for the design position on fixing this.

---

### 2.9 "Terminology should be adapted to driver language"

**Verdict: Weakly supported.** The heavy vocabulary — *handshake*, *precinct*, *attestation*,
*anchored* — lives in code identifiers and comments, not driver-facing copy. A scan of visible JSX
text found only "Phase"/"Phases" leaking (`PhaseProgressBar.tsx:106`, `TripDetailView.tsx:136`).

**Action:** copy pass on "Phase"; walk a real driver through the app. Polish, not a gap.

---

### 2.10 "Identification should accommodate passports"

**Verdict: Partly — already correct for the receiver, genuinely broken for the driver.**

**Receiver: already handled, deliberately.** `driver-pwa/lib/utils/sa-id.ts` names passports
explicitly:

> *"The receiver signing for a delivery is not always an SA ID holder: a foreign driver's passport
> number, a company registration number, or a genuinely mistyped digit all have to be recordable. On
> an evidence platform a wrong-looking value is itself evidence."*

**Driver: hard-blocked.** `Driver.id_number` is `String(13)`; `DriverCreate`/`DriverUpdate` enforce
*"exactly 13 digits (SA ID format)"* (`schemas/people.py:59-91`). A Zimbabwean, Mozambican or
Basotho driver — routine on SA cross-border linehaul — cannot be onboarded.

**Action:** widen `id_number`, add an `id_type` discriminator, validate per type.

---

### 2.11 "Exception logging should support photographs and resolution status"

**Verdict: Confirmed on both halves.**

> **Correction.** An earlier draft of this document marked photographs as "already built end to
> end." That was wrong. The *plumbing* is complete; the *driver-facing capture is missing entirely*,
> which is what actually matters.

The backend and dispatcher are ready:

```
TripException.supporting_artifact_id     db/models/transit.py:79
  ← raise_exception_endpoint             api/v1/endpoints/exceptions.py:44   accepts it
  ← TripContext.tsx:366                  driver PWA forwards it
  → ExceptionEvidence.tsx                dispatcher renders it
```

But `LogExceptionPageClient.tsx` — the page a driver actually uses — has a type picker and a
description box and **no camera**. It calls `logException(type, { description })`. Nothing ever
supplies an artifact, so `supporting_artifact_id` is null on every driver-raised exception.

This is exactly what the panel asked about: *"maybe pictures with time stamps so that we can really
know for sure that this is an incident that really happened."*

**Action:** drop the existing `CameraCapture` component (already used in the phase steps) into the
exception page. Small change; the whole receiving half is already built. Resolution status is §2.5.

---

### 2.12 "…with relevant warnings visible on the driver's mobile interface"

**Verdict: Confirmed, and sharper than the reviewers knew — the one warning component that exists
can never render.**

`driver-pwa/components/trip/HoldNotice.tsx` shows "Trip on hold", and renders only when
`trip.status === 'exception_hold'`.

`EXCEPTION_HOLD` is set by nothing in `backend/app/`. It was deliberately removed
(`phase_service.py:1126-1145`), and two comments confirm it:

- `trip_service.py:115` — *"EXCEPTION_HOLD is currently unreachable (nothing in app/ sets it)"*
- `phase_service.py:201` — *"EXCEPTION_HOLD survives as a status only"*

So a driver whose trip has just recorded a CRITICAL seal mismatch sees nothing at all. The panel
raised this independently: *"we see done, done, done, but there was an incident reported… maybe
drivers also need to be able to see that on their particular routes."*

**Action:** surface open exceptions on the driver's trip view from the exception list, not from
`trip.status`. Pairs with the resolve endpoint in §2.5.

---

### 2.13 "Ensure that records stored on the blockchain remain searchable and useful after entry"

**Verdict: Confirmed.** `api/v1/endpoints/blockchain.py:23-26`:

```python
async def list_receipts(
    subject_type: SubjectType = Query(...),
    subject_id: UUID = Query(...),
```

Both parameters are **required**. You can only retrieve a receipt whose subject you already know.
There is no search by transaction id, data hash, trip reference or date range — so an investigator
holding only a Hedera transaction id, the realistic dispute scenario, cannot get back to the record.

**Action:** make `subject_id` optional; add filters for trip, date range and receipt type; add lookup
by `data_hash` and `tx_id`.

---

### 2.14 "Reporting and analytics are an important gap"

**Verdict: Confirmed — and the current state is worse than a gap, because a dead page is live in the
deployed dispatcher.**

- `dispatcher/app/(app)/sla/page.tsx` — a live route
- `useSLAMetrics` — *"Phase 1 stub — returns null until the SLA metrics API endpoint is wired up."*
  It returns `null`.
- `db/models/sla.py` — a full `SlaConfig` table with **no endpoint and no writer**
- No aggregation layer anywhere

The raw material is all there, as the plan says: `exceptions` carries type, source, severity,
resolution state and FKs to trip, phase event, checkpoint, consignment and stop; `phase_events` is an
append-only ledger, so every dwell time and delay is derivable.

**Action:** as planned — plus **finish or delete `/sla` this sprint.** A live empty page is the worst
artefact to have in front of a marker.

---

### 2.15 "Clarify the multi-tenant model, cross-company driver relationships…"

**Verdict: Partly. Multi-tenancy is real and reasonably careful. Cross-company drivers are
unmodelled.**

What exists: `OrganizationType` — `OPERATOR` / `PRINCIPAL` / `BOTH` (`db/models/enums.py:9`);
`Precinct.principal_organization_id` with an `is_shared` cross-org visibility opt-in defaulting to
private; trips scoped by `operator_organization_id`; client org derived per-consignment from the PP
accnum; org filtering applied at the DB level so record existence does not leak.

What does not: `Driver.organization_id` is single-valued. A subcontracted owner-driver working two
operators — ordinary in SA linehaul — cannot be represented. A `client_viewer` role name exists in
`auth/dependencies.py` but is rejected everywhere and never issued: the client portal is a
placeholder, as the plan says.

`DriverSubstitution` (`db/models/trips.py:215`) exists as a model; **whether anything writes it is
not yet verified.** Check before citing it in the presentation.

**Action:** the multi-tenant model is presentable today and should be a slide. Cross-company drivers
and cross-operator reputation stay as open decision #3 — spike now, iteration 4.

---

## 3. Code review marksheet

### 3.1 "In some areas, comments outweigh the actual code"

**Verdict: Confirmed, literally, in the largest and most important file.**

Measured (comment + docstring lines vs code lines, blanks excluded):

| File | Comment + docstring | Code | Share |
|---|---|---|---|
| `orchestration/phase_service.py` | 594 | 595 | **50%** |
| `orchestration/trip_service.py` | 204 | 441 | 32% |
| `orchestration/verification_service.py` | 43 | 177 | 20% |
| `orchestration/resource_service.py` | 35 | 222 | 14% |

`phase_service.py` is within one line of an exact 50/50 split, at 1,387 lines.

**In our defence, and it is a real defence:** `CLAUDE.md` mandates "comment the *why*, not the
*what*", and these overwhelmingly are *why* comments — recording rejected alternatives and the
reasoning behind non-obvious decisions. That is a deliberate standard, not accidental verbosity, and
it is defensible at examination.

**Action:** do the scheduled `phase_service.py` split, and defend the commenting standard rather than
quietly stripping it.

---

### 3.2 "Health checks could be strengthened"

**Verdict: Confirmed.** `main.py:148-153` returns `status="ok"` unconditionally and never touches
PostgreSQL, Redis, Supabase Storage or Hedera. **With the database down it reports healthy.** The
hardcoded `version="0.1.0"` also violates our own "no magic values" rule; an `APP_VERSION` pattern
already exists on the frontend.

**Action:** DB and Redis probes with a degraded state; version from config. ~20 minutes.

---

### 3.3 "No clear evidence of batch processing"

**Verdict: Does not apply.** Celery with a beat schedule is configured (`tasks/__init__.py:35`),
running the Parcel Perfect consignment poll, alongside the blockchain anchoring task queue
(`tasks/blockchain.py`) which exists specifically to move anchoring off the request path.

Fair reading: it was never *demonstrated*. It is invisible from the UI.

---

### 3.4 "Backend security needs to extend beyond user authentication"

**Verdict: Largely does not apply.** See §2.7. The one real gap is device binding.

---

### 3.5 The "General Comments" paragraph

**Verdict: This paragraph does not appear to describe FreightProof.** Raised politely, because we may
be misreading it.

| Statement | What we find |
|---|---|
| *"revising names such as 'botService'"* | `botService` / `BotService` appears **nowhere** in the repository (full-repo search) |
| *"HTML modules should also be used where appropriate"* | Next.js 15 App Router + React 19 across both surfaces; there is no raw HTML layer |
| *"the student acknowledged substantial reliance on AI"* | Singular *student*; this is a four-person team |
| *"Health checks … stop conditions and keywords"* | Scraper/bot vocabulary that does not map to an HTTP health endpoint |

Two points inside it **do** land and are actioned above: the comment ratio (§3.1) and health checks
(§3.2). Two more deserve a short answer rather than a change:

- **"clearer separation of concerns through interfaces"** — explicit prop interfaces are used
  throughout both frontends and mandated by `CLAUDE.md`. Shared types live in
  `frontend/shared/lib/types/` behind `@shared/*`.
- **"the use of object-oriented principles is currently limited"** — accurate as an observation,
  intentional as a choice. The backend is service-function-oriented over SQLAlchemy 2.0 declarative
  models, which is idiomatic FastAPI; classes carry state or a contract where that is the right shape
  (`ParcelPerfectClient`, `HederaService`, `MockStateStore` as a `Protocol`).

**Action:** ask the convenor whether the paragraph was intended for this team, and prepare a one-slide
answer for the OO/TypeScript points either way.

---

## 4. What the transcript adds that the marksheets missed

The Q&A raised four things that appear in **no** written marksheet.

### 4.1 Live alerting — and it is ~90% already built

> *"Your frequency of reporting… it would be actually great to get a ping if something is tampered.
> I'm not going to tamper with the delivery itself, but if I'm sitting at the office, I actually want
> to know that live."*

Note the second sentence: the panel **pre-empted our own scope boundary.** This is a notification
request, not a dispatch request. It sits inside "evidence, not operations."

And the infrastructure exists. `core/realtime.py` publishes thin `TripEvent` notifications on a
per-org Redis channel, consumed by the dispatcher over SSE — the capability the demo marksheet
praised. But **only driver-raised exceptions emit an event.** `exception_service.py:110` emits
`EXCEPTION_RAISED`; six system-detected exceptions are written directly via
`db.add(TripException(...))` and bypass it:

| Site | Type | Severity | Live ping? |
|---|---|---|---|
| `phase_service.py:1024` | `SEAL_MISMATCH` (guard, departure) | **CRITICAL** | No — `PHASE_COMPLETED` |
| `phase_service.py:1147` | `SEAL_MISMATCH` (destination) | **CRITICAL** | No — `PHASE_COMPLETED` |
| `phase_service.py:916` | `PARCEL_COUNT_MISMATCH` | WARNING | No |
| `phase_service.py:1256` | `WAYBILL_COUNT_MISMATCH` | WARNING | No |
| `phase_service.py:560`, `trip_service.py:525` | `DISPATCHER_NOTE` | WARNING | No |

**A driver pressing the panic button pings the dispatcher. A broken seal does not** — the dispatcher
receives a cheerful "phase completed" toast for a CRITICAL tamper signal. That is precisely backwards
from what was asked for.

**Action:** emit `EXCEPTION_RAISED` (or a new `TAMPER_DETECTED` kind, so the UI can raise a louder
signal) wherever a system exception is written. Small change, high visibility, answers a direct
request. Extend to `GPS_MISMATCH` as Sprint 6 lands it.

Supporting site-visit context from the same discussion, which validates the priority:

> *"Often if the dispatcher sees that there's a live update, that there is an error, he will
> immediately phone."* … *"If the drivers make one or two errors, they'll probably deal with that
> themselves. If something goes really wrong and you need evidence somewhere, somehow."*

That tells us the escalation threshold: minor issues are handled informally; the platform's job is
the serious ones. Severity-based alerting, not everything.

### 4.2 The attack, stated concretely

> *"Even if it's signature… if the truck driver goes to the right place, but just before the
> warehouse, they stop somewhere, they have a friend, and then it's a swiping or even a signature by
> hand when it's high-valued goods… you're looking at people with things that are going to be worth
> millions, not like a Takealot parcel."*

This is more useful than the marksheet's abstract version, because it tells us the threat model
(high-value, insider-assisted, near-destination) and because **it names an attack the Pulsit
corroboration work already defeats.** A confirmation handshake signed 2 km from the warehouse fails
the destination geofence check. Say so in the presentation — it is the plan's strongest validation.

But it only defeats the *location* half. The *identity* half needs §7.

### 4.3 Insurers are the evidence consumer

> *"We need to look into what the insurers would need."*

Absent from both marksheets. Nobody has modelled the insurer, and they are the commercial buyer of
evidence. An `EvidencePacket` dispatcher component exists with **no export path**. A signed,
exportable evidence packet is what makes the platform legible to a business audience.

### 4.4 Pulsit has cameras

> *"They have cameras in the trucks and on the doors of the truck. So if there's an exception, you
> could possibly… pull those camera footages, like a snippet of time for that."*

New information, and a different call pattern from our handshake-moment reads. Design note and a
question for Bruce — not a Sprint 6 build, and mock-only regardless until Pulsit replies.

> **Scope note.** This analysis works from the transcript excerpt covering roughly 1:06:37 onward.
> The design note's §1 records two further speakers from earlier in the session — **Robert Stothers**
> (a driver's record *across operators*, without exposing who; recurrence "along the same routes with
> the same drivers with similar type loads") and **the chair** (quantify what we actually solve, with
> a number, before the demo). Both are already handled in the design note §12 and §13. The comparison
> in §5 below should be read as covering the excerpt, not the whole session.

### 4.5 Also raised, already covered by the plan

- **Problematic truck** — *"is it the driver's fault or the truck's fault"*. The plan's analytics
  table already has a Vehicle grain. Promote it; unlike driver metrics it carries no POPIA weight.
- **Driver ratings** — promised on the call, and in direct tension with the plan's own POPIA line.
  See §8.
- **Smart locks** — Ammar explicitly parked these: *"once you do the main core things, then iteration
  three or four."* Take the deferral he offered.

---

## 5. Where the two sources diverge

Worth noticing, because it tells us who we are answering:

| Theme | Written marksheets | Q&A transcript |
|---|---|---|
| Validation cluster — availability, scheduling, minimum duration, seals, unresolved exceptions, departure location | **The lead item** | Not mentioned once |
| Passports, terminology, seamless ID capture | Raised | Not mentioned |
| Multi-tenancy, privacy-preserving identifiers | Raised | Not mentioned |
| Diagrams, standards, branching, story points, self-sponsorship | Raised in detail | Not applicable |
| Live alerting on tamper | **Absent** | Raised, with reasoning |
| Concrete attack scenario and threat model | Abstract | **Specific** |
| Insurers as evidence consumer | Absent | Raised |
| Pulsit cameras | Absent | Raised |
| Receiver-controlled confirmation | Raised — "authenticated QR-code exchange" | Raised, with a design |
| Chain-vs-database boundary | "searchable and useful after entry" | *"You must sit down and flesh it out nicely"* |

**The written review is an engineering review; the transcript is an industry review.** They overlap
on only three points — receiver confirmation, exception evidence, and analytics — and those three are
therefore the highest-confidence priorities in the whole feedback set. Everything else has exactly
one source behind it.

Naming this pattern in the iteration 3 presentation is itself worth marks: it shows we read the
feedback as evidence rather than as a to-do list.

---

## 6. The gap no source found — and the transcript asked us to go and find it

> *"When you store that evidence — what goes on your chain and what goes in your relational database?
> That's you must sit down and flesh it out nicely."*

We did. **The evidence artifacts are outside the blockchain anchor.**

`EvidenceArtifact.file_hash` — a SHA-256 of every uploaded file — is computed and stored
(`db/models/evidence.py:36`). But **no artifact hash appears in any anchored payload.**

`compute_confirmation_canonical_payload`:

```python
{
    "phase_event_id": ..., "trip_id": ..., "phase_type": "confirmation",
    "pp_scan_in_count": ..., "driver_visual_count": ...,
}
```

`compute_departure_canonical_payload`: the same shape plus `seal_number`. That is the complete set of
anchored fields. Which means:

- the **POD photograph** is not covered by the anchor
- the **signed attestation image** — carrying the receiver's name, ID, GPS and timestamp — is not
  covered by the anchor
- the **seal photograph** is not covered by the anchor

Anyone with Supabase Storage access can replace the POD image and **every on-chain verification still
passes**, because the anchored hash never referred to the image. On a platform whose entire claim is
tamper-evidence, this is the sharpest available gap.

**The constraint that makes it a good slide:** `verification_service.py:127`
`_reconstruct_phase_event_payload` rebuilds the canonical payload from live rows and must reproduce
the original hash exactly. Adding fields breaks verification of everything already anchored. The fix
needs an explicit payload version carried on the receipt, with the verifier dispatching on it.

**Action:** Sprint 7 — anchor the artifact hashes, with payload versioning and a
verification-compatibility test. Produce the chain-vs-database boundary table as a written artefact
alongside it, since that is what was actually asked for.

---

## 7. Receiver-controlled handover — design position

Ammar's request, and the demo marksheet's, is the same: the confirmation must be produced by the
receiver, not the driver. His suggested mechanism:

> *"Maybe like a phone-to-phone thing where the driver has a QR code and the receiver has to scan the
> code. And then that person has to be registered in your platform."*

### What is not possible

An early internal proposal was to identify the receiver's device from the web page it opens — by IP
and MAC address — so no account would be needed. Three problems:

1. **MAC address is unobtainable.** No browser exposes it, via JavaScript or any header; it is
   stripped at the first network hop. This part cannot be built at all.
2. **IP address is close to worthless here.** South African mobile networks are heavily CGNAT'd —
   thousands of subscribers share one public address. It cannot identify a device or an owner, is not
   stable across a session, and is *identical* for driver and receiver on the same warehouse wifi.
   Worth recording as a weak signal; useless as an identifier.
3. **POPIA runs the other way.** Silently fingerprinting the device of someone with no account and no
   consent is harder to justify than onboarding them, not easier. An account at least implies a
   consent moment.

There is also a documentation drift to note: `CLAUDE.md` describes `crypto/` as "Ed25519 (PyNaCl),
SHA-256, Merkle", but `backend/app/crypto/` contains only `hashing.py`. **There is no signing
implementation.** And since the receiver holds no private key, a literal receiver-side digital
signature is not achievable without enrolment — what is achievable is a **server-attested record**:
the server signs a canonical handover payload and anchors the hash.

### The property that actually matters

Not identity registration. **That the confirmation is produced somewhere the driver cannot produce
it.** Three tiers:

| Tier | Mechanism | Defeats the friend's-driveway attack? | Cost |
|---|---|---|---|
| **1 — Open link** | QR → one-time signed token → web page → confirm. No identity. Record server timestamp, receiver browser GPS, IP, user-agent. | **No.** A driver with a second phone completes it alone. Raises effort, leaves a trace. | Low |
| **2 — Nominated contact** ⭐ | As tier 1, but the one-time code is delivered to a phone number the **client organisation nominated in advance**. No account, no password, no app install. | **Largely.** The driver would need the nominated contact's phone — a different crime, with its own trace. | Medium |
| **3 — Receiver accounts** | Full onboarded users with credentials. | Yes | High onboarding friction |

**Recommendation: tier 2.** It is also what Ammar actually described — *"your **client** can be
onboarded"*, the organisation, not each individual receiver. The schema is most of the way there:
`Organization` with `PRINCIPAL` type, and `Consignment.client_organization_id`. What is missing is a
nominated-contacts table per client precinct — no login, just a known number that is not the
driver's.

Design points for whichever tier is chosen:

- Token is single-use, short-lived (5–15 min), bound to the phase event, and issued server-side.
- **Server timestamp only** — never trust the client clock.
- Capture the receiver's browser Geolocation fix. Combined with the driver's fix and Pulsit's, that
  is three independent position sources on the single most disputed moment in the trip.
- Record whether the redeeming request carried the driver's own session — a strong tamper signal,
  recorded as evidence rather than used as a gate, consistent with the seal-mismatch precedent.
- Hash the whole handover record into the confirmation canonical payload — which requires §6 to land
  first, another reason to sequence it early.

### Correction, and where this document defers to the design note

An earlier draft of this section recommended a one-time code delivered to a client-nominated phone
number. **That was wrong** — anything sent over SMS or WhatsApp is defeated by exactly the SIM swap
Ammar described.

[design-notes/2026-08-24-corroboration-parcel-client-views.md](design-notes/2026-08-24-corroboration-parcel-client-views.md)
§9 had already solved this, on 24 August, and its approach stands: **move the secret off the network
and onto the glass.** The QR encodes a one-time capability token bound to trip, stop, nonce and a
~5-minute expiry; it is transferred optically, in person; the receiver's own device reports its
position at receipt. SIM swap gains nothing, physical co-presence is proved, and a third independent
fix is captured from a party with no incentive to help the driver.

What this section still contributes beyond the design note: the device-identification question is
unanswerable (MAC/IP above), there is no signing implementation in `crypto/` despite `CLAUDE.md`
describing one, and the handover record should be hashed into the confirmation canonical payload —
which depends on §6 landing first.

### The honest framing

**This makes fraud provable, not impossible.** A determined driver with a second handset defeats any
browser-based scheme; you cannot prove device ownership without enrolment. For an evidence platform
that is the correct goal, and saying so out loud is stronger than overclaiming — particularly to a
panel that has already told us it is thinking about goods worth millions.

---

## 8. Conflicts to resolve before Sprint 6

### 8.1 Driver ratings versus our own POPIA position

Asked for on the call, and answered in the affirmative:

> *"We have a particularly problematic driver with incidents being reported… is that something we're
> interested in?"* → *"we want to… driver ratings, which comes with the whole analytics part."*

The iteration 3 plan §2 says the opposite:

> *"The moment the dashboard shows driver risk scores, you are profiling employees on POPIA-protected
> location data, and you have crossed the documented boundary from recording into responding."*

Both positions are defensible. Holding both silently is not. **Recommendation:** keep per-driver
*trends* (exception counts, on-time rate) and decline automated *scores* that could affect
employment, and present that reasoning explicitly. Declining a requested feature on a documented
legal ground — while offering the facility-grain alternative — demonstrates more judgement than
either building it quietly or dropping it quietly.

### 8.2 Capacity

Four themes now compete for two sprints: Pulsit corroboration, analytics, receiver handover, and the
validation cluster. Something must be cut deliberately rather than discovered in week three — the
plan's own §6 notes the board has already drifted twice. See the plan's revised §4 and §5.

---

## 9. Open items for the team

1. **Verify the citations.** Every claim here is a file and line. Please spot-check.
2. **Decide the handover tier** (§7). Tier 2 recommended.
3. **Resolve driver ratings versus POPIA** (§8.1) — needed before the analytics screen is designed.
4. **`DriverSubstitution` write path** — model exists (`db/models/trips.py:215`); not verified whether
   anything writes it. Check before citing it in the presentation.
5. **Two `CLAUDE.md` drifts** — it documents "Receiver = one-time OTP" and an Ed25519 `crypto/` layer;
   neither exists. `CLAUDE.md` requires a four-reviewer PR, so both are flagged here rather than
   edited.
6. **Ask the convenor about the General Comments paragraph** (§3.5).
7. **Sprint ownership link** in `CLAUDE.md` is still a placeholder.

---

*This document records verification only. No application code was changed in producing it.*
