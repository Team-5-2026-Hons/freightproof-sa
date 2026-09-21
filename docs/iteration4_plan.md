# FreightProof — Iteration 4 Plan (draft for team discussion)

> **Status:** draft, 18 September 2026, written the evening after the iteration 3 presentation.
> Nothing here is decided. It gathers the panel's feedback, every iteration-4 commitment already
> sitting in our own docs and Jira, and a verification pass over the claims we made on stage —
> then proposes a shape. The four decisions in §5 have to be taken before sprint 8 is sized.
>
> **Sources:** [iteration-3-presentation-minutes.md](Iteration_3_Documentation/iteration-3-presentation-minutes.md)
> · [step-event ledger implementation plan](design-notes/2026-09-02-step-event-ledger-implementation-plan.md)
> · [known-issues.md §10](known-issues.md#10-deferred--dedicated-arrival-custody-check-phase-iteration-4-candidate)
> · [SOLID refactor audit](solid-refactor-audit-2026-09-02.md) · [security review 14 Sep](reviews/2026-09-14-security-structure-review.md)
> · [iteration3_plan.md](iteration3_plan.md) §6, §8 · Jira `FP` board (33 open items, Sprint 8 exists but is undated)
> · `graphify-out/GRAPH_REPORT.md` (built at `265d1d2`; three commits behind `dev`).

---

## 0. Where we are

| | |
|---|---|
| Iteration 3 | Presented 18 Sep. Panel: *"you have the core; now make it production-ready"* and *"close loose ends before expanding"*. No blocking objections. |
| Sprint 7 | Closed 17 Sep, 71 pts. Sprint 6 was 80 pts. Planning velocity ≈ **75 pts/sprint**. |
| Sprint 8 | Exists in Jira as a future sprint, **no dates set**. Only FP-149 (parcel traceability, 8 pts) and its six subtasks are carried into it. |
| Code | 44 Alembic migrations (we said 43). 74 unit + 67 integration test files. Deployed on Vercel + Railway. |
| This is the last iteration | Everything below is also the final submission: documentation (50–70 pages), portfolio of evidence, minutes, peer evaluation, zipped code + deployed link, and the final presentation. |

**What we do not know yet:** sprint 8/9 dates, the final submission date, whether iteration 4 guidelines
differ from iteration 3's, and whether Pulsit / Parcel Perfect credentials will arrive. Fill these in
before sizing.

---

## 1. What the panel said, condensed

Two reviewers, two angles, one conclusion: **finish, don't expand.** Everything they asked for falls
into six themes.

| # | Theme | What they actually want to see | Who raised it |
|---|---|---|---|
| T1 | **Show the bad day** | A genuinely unrecoverable scenario — collision, tyre that can't be fixed — where the audit trail is the point. An incident report PDF with the dates and details insurers/police expect. Pulsit camera snippets on exception (credential-dependent). | Reviewer 1 |
| T2 | **Receiver biometrics are a red flag** | Facial verification + typed ID number for a delivery receiver "will not fly". POPIA/GDPR data minimisation. Alternatives already used in SA: PIN/OTP, parcel photo at address, geolocation. Ammar: onboard the customer instead — freight receivers are departments with credentials. | Both, independently |
| T3 | **Cut manual input** | Seal number: OCR from photo, or from Pulsit, or at minimum a photo-confirms-number step. Waybill/order numbers need confirmation. Lat/long typed by hand → reverse geocoding. | Reviewer 1 |
| T4 | **Multi-trip, not single-trip** | Nobody watches one 48-hour trip. Ops dashboard of every live trip; single-trip view is the drill-down when something goes wrong. Alerts pushed (email / WhatsApp / push) to the person who can act. | Ammar |
| T5 | **Analytics must be defensible** | State data provenance *in the presentation*. Be ready to be asked live: *"show me today's incident on the map."* Explicit warning: if we can't, it casts doubt on the whole system. Ammar: split into an ambient wall-screen view and a deep-dive view. | Both |
| T6 | **Robustness and roles** | OTP fallback when SMS is down (WhatsApp / biometric / supervisor approval — examine more than one). Supervisor override path with audit record. Multi-select truck+trailer breakdown. Simulate parcel scanning. Simulate movement along a route (or walk to another building). Polygon geofences. Auto-ETA. Precinct-scoped roles: who starts a trip, who assigns a truck. | Both |

**Explicitly offered as optional, and explicitly told to defer:** driver hours-of-service, fleet
maintenance lifecycle, trip cost management, in-house response-team routing.

---

## 2. What we promised on stage — and what I verified tonight

The minutes list 16 claims a panel could check. I walked the ones that can be checked from the repo.
**Three claims are currently false or weaker than stated.** Fix these before anyone repeats them.

| Claim | Verified? | Finding |
|---|---|---|
| "No endpoint calls the blockchain client or an external integration directly" | ⚠ **Partly false** | Five endpoint files import from `app.blockchain` / `app.integrations`. `dev_*` triggers and `pp.py` (exception types only) are defensible. **`endpoints/handover.py:47` imports `get_idvs_client` directly** — a production endpoint bypassing orchestration. `endpoints/blockchain.py` reads `anchor_service` directly (read path; arguable). A marker who greps will find this in ten seconds. |
| "Access control and rate-limit gaps currently being fixed" | ✗ **Not started** | Security review S1 (nine newer tables with no RLS/revoke — `trip_location_pings`, `driver_sessions`, `user_sessions`, `handover_*`, `precinct_events`, `vehicle_events`, `driver_events`): no migration after 13 Sep touches them. S2 (driver can complete confirmation with a self-uploaded signature, no `HandoverConfirmation` check): `phase_service.py` still has no such check. S4 (`rate_limit.py:153` still keys on the first 64 chars of the JWT — shared across every user). |
| "Database connection timeouts not properly tested under load" | ✗ **Not started** | `db/session.py` still builds the engine with `pool_pre_ping=True` and nothing else — no connect timeout, no bounded pool wait. Known-issue #4, open since July. |
| "Strict service layering… enforced in code review" | ⚠ | See row 1. Also `phase_service.py` is now **1,962 lines** (1,387 on 2 Sep — grew 40% during sprint 7). The FP-167 split was scheduled for the sprint 7 quiet window and did not happen. |
| 43 migrations, no hand edits | ✓ | 44 on disk. Every one is a named, hand-pruned file. |
| Receiver token stored only as a hash | ✓ (per 14 Sep review) | `handover_capability_tokens` — but see S1: the table itself lacks RLS, so hashing doesn't protect it from Data API access. |
| Analytics are read-only live views | ✓ | `2026_09_13_tom_live_analytics_views.py`; explicit `REVOKE` on the analytics objects. |
| "Risky times of day" provenance | ✓ — **better than we said** | `analytics/fleet/problems.py:112`: share of driving minutes per SAST quarter-of-day vs share of in-transit exceptions whose server receipt time falls in that block. Our own ledger, driving step only, any severity. **This is a clean one-sentence provenance statement — put it on the slide.** |
| One shared types package for both frontends | not checked | `frontend/shared/` exists; receiver app is a third consumer now — confirm it imports from it rather than duplicating. |
| Anchoring 4–6 s, auto-recovery | not checked | Needs a timing log and a pointer to the retry path + its test. |
| Sprint 6 = 80, Sprint 7 = 71 | not checked | Jira vs repo. |

Also worth knowing before the receiver decision: `IDVS_USE_MOCK` defaults to `True`,
`HANDOVER_ROTATION_SECONDS = 20`, `HANDOVER_TOKEN_EXPIRY_MINUTES = 10`. The QR "expired mid-demo"
— check which of the two actually fired; a 10-minute token should not have died in a 20-minute demo.
And `frontend/client-portal/` is a README and nothing else.

### 2.1 Is the panel's feedback valid against the code?

Mostly yes — but four items are demo-script gaps rather than build gaps, and two are misframed.
Knowing which is which changes the sizing.

| Panel said | What the code actually does | Verdict |
|---|---|---|
| Seal is typed and photographed separately; no confirm step | `SealInput.tsx`: free-text input + camera, nothing links them. `CaptureSeal.tsx`'s own comment admits a re-typed number "proves nothing the photograph doesn't". And `_SEAL_PATTERN = ^[A-Z]{2}-\d{4}$` at [schemas/phases.py:22](../backend/app/schemas/phases.py:22) **rejects any real vendor seal** — flagged as a live-demo risk on 1 Sep, never fixed | **Valid, and worse than they know** |
| Precinct creation is coordinate entry, no map | `PrecinctForm.tsx` renders a Leaflet `GeofenceMap`; a click places the pin and fills lat/long. No address search or geocoding | **Half valid.** The map exists — either it wasn't shown or tiles failed on the demo network. Geocoding is genuinely missing |
| Waybill/order numbers added once-off with no confirmation | `trips/new/page.tsx`: each waybill goes through a Parcel Perfect lookup (mock) and is "locked in once added"; the manifest path deliberately skips per-item confirm. The **order number** is free text | **Partly valid.** Waybills are validated — against a mock, so it looked like nothing. The order ref isn't |
| Truck/trailer breakdown is single-select | [LogExceptionPageClient.tsx:355–372](../frontend/driver-pwa/app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx:355): `selected={vehicleType === option}` | **Valid**, small |
| OTP didn't arrive; what if SMS is down — look at WhatsApp | [AuthContext.tsx:138–143](../frontend/driver-pwa/lib/context/AuthContext.tsx:138): driver OTP **already goes over WhatsApp** (Twilio sandbox) because SMS to SA isn't enabled. The stage failure *was* WhatsApp. No non-network path, no supervisor override | **Valid but misframed.** The answer is "we're on WhatsApp; the fallback is SMS plus a supervisor override with an audit record" |
| QR expired mid-demo | Rotation is the design (it closes the screenshot-forward attack). Receiver page shows "This link is no longer valid" for every failure state, deliberately | **Valid as UX only.** Say "ask the driver for a fresh code"; show the countdown on the driver screen |
| Simulate parcel loading and scanning | `dev_triggers.py` has `trigger_scan`, `close_scan_session`, `trigger_pp_change` behind the dev panel | **Demo-script gap.** The capability exists; it was skipped on stage |
| Simulate movement along a route | `dev_pulsit.py` + `core/demo_waypoints.py`: six scenario targets (at precinct / 230 m / 260 m / 3 km / 50 km / no signal). Discrete jumps, no polyline playback | **Partly valid.** Continuous playback is new; the jumps already exist |
| The view is single-trip; build a multi-trip dashboard | The home page **is** a live (`useLiveResource('trip')`) list of active trips: trip / order / driver / route / progress / status. No current phase, no last-ping age, no open-exception count (known-issue 11), no fleet map | **Valid as an upgrade, not a new surface.** Ammar was shown the drill-down. Cheaper than first sized |
| Alerts pushed to a person who can act | SSE + in-app toast only. `TWILIO_*` / `SENDGRID_*` keys exist in config; `integrations/twilio.py` and `sendgrid.py` **do not exist** despite `CLAUDE.md` listing them | **Valid.** No push channel at all |
| Analytics provenance for "risky times" | [problems.py:112](../backend/app/analytics/fleet/problems.py:112) documents the rule precisely | **Invalid as a system gap, valid as a slide gap** |
| "done for vehicle details" copy | Not in dispatcher source | Can't verify — check the deployed vehicle-detail analytics toggle |
| Receiver biometric is disproportionate | Bruce, 1 Sep: the receiver is **RTT's receiving branch**; custody ends when *RTT scans and breaks the seal*. The receiver is a business counterparty, never a citizen | **Valid — and Bruce's own description of the handover already says so** |
| Polygon geofences; auto-ETA; precinct roles | Circle only; `planned_arrival_at` is manual; `DispatcherRole` = `dispatcher` / `admin_dispatcher` only | **Valid**, all three |
| Not all evidence anchored | Anchored: trip creation, departure, confirmation, fleet-mutation events. **Unanchored:** activation, loading, in-transit, unloading, **every exception**, **every handover confirmation**, exception photos | **Valid** — the unanchored list is longer than "not all" implies |

---

## 3. Iteration-4 work that was already in our own docs before today

The panel did not know about most of this. It is the "phase child ledger" family plus everything
iteration 3 deliberately deferred. Read it as **debt we owe ourselves**, separate from §1.

### 3.1 The step-event ledger (the "phase child ledger")

[Authoritative plan §6](design-notes/2026-09-02-step-event-ledger-implementation-plan.md) — six
stages, every one demonstrable, success criterion: *32 phase-touching test files stay green and
unmodified through Stages 1–3.* Iteration 3 shipped the capture-event rail (Path A); iteration 4
was always going to be the table.

| Stage | What | Blocked on | Panel relevance |
|---|---|---|---|
| 1 | `phase_steps` table, `ActorType`, read endpoint returning `[]`, server-side event catalogue | nothing | — |
| 2 | Pure mappers `PhaseEvent → StepEventDraft`, one phase type at a time (loading first) | **FP-167 split first**, or Stage 2 edits a 1,962-line file on three branches | — |
| 3 | Merkle root over child hashes in departure/confirmation anchors (FP-63); D-9 payload version marker; D-12 | Stages 2, D-9, D-12 | "Not all evidence is anchored yet" — this is how we close that limitation *honestly* |
| 4 | Dispatcher rail extended to the full ledger; density proven at 11 phases | Stages 1–2 | **The bad-day evidence bundle (T1) renders from this** |
| 5 | Live emission from the driver app, one step at a time; 409 duplicate-vs-prerequisite split | Stages 1–2 | — |
| 6 | Non-driver actors: warehouse scan events, receiver `seal-broken`, `receiver-signed-off` | Q2, Q3 (Bruce), scan feed writing `pp_scan_*_at` | **Directly shaped by the receiver decision (T2)** |

The plan's own order: **Stages 1 → 2 → 4** deliver the read-side ledger; take D-9/D-12; then 3; 5
and 6 as blockers clear. Architecture checkpoint: do `ParcelScanEvent` (FP-149) and `phase_steps`
converge or stay separate?

### 3.2 Dedicated Arrival custody-check phase

[known-issues.md §10](known-issues.md#10-deferred--dedicated-arrival-custody-check-phase-iteration-4-candidate).
Preferred product direction: `… → in_transit → arrival → unloading → confirmation`, with the
destination seal inspection, seal comparison and seal exceptions moving from unloading into
arrival. Six acceptance criteria written. **Must be reconciled with the ledger plan before either is
built** — the ledger spec says "do not make the phase plan finer", and this makes it finer. Needs an
owner and a compatibility fence for existing trips and queued old-client submissions.

### 3.3 Deferred from iteration 3 (plan §6 and decisions table)

| Item | Where recorded | Panel asked for it too? |
|---|---|---|
| Polygon geofences | Decision 8; geometry column + migration; `geofence_service` reads radius either way | **Yes** (T6) |
| Per-dispatcher alert routing / third role tier — needs a trip-to-dispatcher assignment model | Decision 11; FP-215, FP-216 | **Yes** (T4, T6) |
| Stationary-driver push alert — derivable from `trip_location_pings` | Plan §6 | Adjacent to T4 |
| Cross-operator reputation, two-org simulation | Decision 3 — spike only | No |
| Driver device binding (SIM-swap surface) | Decision 4 — spike, raise with Ammar unprompted | No — but it's our answer to "OTP fallback" |
| Seal-chain §3.3: expected seal at trip creation (joins journey-lock hash), Pulsit door-open pairing | [seal-chain-rework](design-notes/2026-09-02-seal-chain-rework.md) — gated on Bruce Q1 | **Yes** (T3, seal auto-population) |
| FP-149 parcel traceability + FP-266 driver-side scanner | Jira, 8 pts, carried Sprint 7 → 8 | **Yes** (T6, "simulate parcel scanning") |
| FP-139 / FP-142 / FP-260 vehicle clash + impossible duration | Jira, 10 pts, deferred 26 Aug | Adjacent to "small things to tidy" |
| FP-83 driver substitution, FP-117 cancellation event, FP-90 PP scan-in reconcile | Jira, unsized | No |
| `parcel_events` ledger, Merkle batching FP-63 | Plan §6 | Covered by ledger Stage 3 |
| Known issues 7 (stamped destination count), 8 (trip detail load time), 9 (call logging, driver substitution), 11 (exception total on trip rows) | known-issues.md | 11 feeds T4 |

### 3.4 The refactoring docs — still valid? (checked 18 Sep)

Three documents propose refactors. Verdict on each, after re-running their own staleness checks.

**[solid-refactor-audit-2026-09-02.md](solid-refactor-audit-2026-09-02.md)** — written because SOLID
is on the rubric. Its §1 fingerprints today: A = **1962** / 770 / 1113 (was 1441 / 754 / 1113 — only
`phase_service.py` moved, +36%); B = 9 copies (unchanged, V2 not started); C = 10 branches
(unchanged, V1 not started); D = **8** mock importers (was 11 — some cleanup happened).
So the findings are still right; the `phase_service` split plan needs re-reading against the
bigger file. Item by item:

| # | Item | Status | Verdict |
|---|---|---|---|
| 1 | `ParcelPerfectPort(Protocol)` | Not done — no `Protocol` in `parcel_perfect.py` | **Do.** 30 min, DIP on a slide |
| 2 | Delete dead models/schemas | Not done, and **the list is now partly wrong**: `TrailerGpsSnapshot` is written by `corroboration_service` (delete it and corroboration breaks); `DriverSubstitution` is FP-83's model and known-issue 9b's plan. `MerkleBatch` — ledger Stage 3 is the first real use. Safe to delete: `TripTemplate`, `SlaConfig` + the `/sla` page (still routable; iteration 3 plan called it "the worst artefact in front of a marker"), `BlockchainReceiptReadLegacy`, the barrel-only `TripBase`/`ParcelBase`/… schemas | **Do the safe subset**, re-verify each with grep first |
| 3 | `SubjectPolicy` registry | Not done | Do — 3 h, OCP |
| 4 | `record_and_anchor()` template | Not done | Do — it is also where anchoring exceptions and handover confirmations lands |
| 5 | Split `create_trip` | Not done | Do — 2 h |
| 6 | Split `phase_service.py` (= FP-167) | Not done; file grew | **Do first, in the quiet window after the next merge.** Gates ledger Stage 2 |
| 7 | `useExceptions` → real API | **Done** (FP-146). `AuthPort` not done | Half done; skip the rest |
| 8 | `useTripDraft` reducer | Not done | Optional — `trips/new/page.tsx` is unchanged at 1113 lines |

**[reviews/2026-09-10-ciaran-branch-review.md](reviews/2026-09-10-ciaran-branch-review.md)** — six
findings. P1 #1 (a blocked phase is silently discarded from the offline queue) is **still open**:
[useOfflineQueue.ts:301](../frontend/driver-pwa/lib/hooks/useOfflineQueue.ts:301) drops every 409.
This is the same defect the 14 Sep review lists under "other hardening" and that ledger Stage 5 is
blocked on. Three reviews, one bug, zero fixes — **Track A**. P1 #3 (type-check gate) — CI now runs
`mypy .`; confirm it is green on `dev`. P2 #6 ("Awaiting Pulsit" promising unscheduled work) —
the copy is gone from live views; only an analytics comment references it.

**[reviews/2026-09-14-security-structure-review.md §Structure](reviews/2026-09-14-security-structure-review.md)** —
seven reuse extractions (shared artifact-ownership assertion, shared frontend transport, shared idle
hook, account-scoped storage adapter, named trip loaders, phase-service extraction, fleet-mutation
plumbing). All still valid, none started. The artifact-ownership assertion is S6 and goes in Track A;
the account-scoped storage adapter is S8. The rest are nice-to-have and overlap with items 4 and 6 above.

**Overall:** the refactor docs are still valid and worth doing, in this order — FP-167, then audit
items 1, 3, 4, 5, then the safe delete subset. About 16 hours. Skip `AuthPort`, `useTripDraft` and the
folder-level extractions unless someone is idle.

### 3.5 The three design-note artifacts — what shipped, what didn't, what to change

Three published pages carry most of the iteration 3 design thinking. Each is checked against
`dev` at `d785615`. Legend: **✓** shipped · **~** shipped differently · **✗** not built.

#### A. "Witness and Pattern" (23–25 Aug) — `claude.ai/artifact/MNg8jPZPNda91oVQa93Pu7`

The synthesis still holds: more independent witnesses per custody moment, patterns read across
them. What happened to its 17 costed pieces:

| Piece | Status | Iteration 4? |
|---|---|---|
| Corroboration in `geofence_service` + freshness threshold in config | ✓ `PULSIT_CORROBORATION_MAX_SKEW_SECONDS=300`, `DRIVER_TRUCK_MAX_FIX_AGE_SECONDS=60` (the doc said 15 min; the code chose 5 min / 60 s — put the real numbers on the provenance slide) | Done |
| `PhaseLocationSection` rewrite | ~ `LocationEvidencePanel` / `LocationEvidenceSummary` | Done |
| WitnessGlyph (5 states), SeparationGauge, glyph gutter + "6 of 7" | ✗ Verdicts render as chips; separation as a number | **Skip the glyphs.** Keep the one rule that mattered — *unwitnessed is never quieter than corroborated* — and check the chips obey it |
| QR capability-token handover + receiver page | ✓ FP-155: 20 s rotation, hashed token, binding cookie | Done |
| Screenshot-hole follow-ups: "confirmed from the driver's own device" signal; receiver-can't-scan fallback | ✗ Neither in `handover_service.py` | **Do the fallback** (it's the OTP-fallback question in receiver clothing); the same-device signal is small and worth a slide |
| Exception resolve with contact method (phoned / WhatsApp / in person) | ✓ `CONTACT_METHOD_LABELS` on the review page | Done |
| `tel:` link on trip detail | ✓ `TripSummary.tsx:65` | Done |
| Live tamper alert with severity ranking | ✓ FP-147/148 | Done |
| Tier 1 analytics + facility corroboration rate | ✓ six pages; `PrecinctAnalyticsSummary` has confirmed / mismatch / unwitnessed | Done |
| Recurrence detector ("same driver, same lane, same load class") | ✗ | **Do — small.** It is a `GROUP BY … HAVING`, it *is* the deep-dive analytics Ammar asked for, and it is how we promised collusion would become visible |
| Impact panel (3 derivable tiles + time-to-proof) | ✗ | Do the three tiles for the final presentation; the fourth needs Bruce (§10) |
| Passive "record, never block" strip on the driver step | ~ Built as a **blocking modal** with Continue/Retry in `f0a985e`. Continue still proceeds, so the principle technically holds | **Alter:** never let it gate on tracker silence or a preview error; keep the swipe live in every state |
| EvidenceTag driven by witness count | ✗ decision 1 still open | Take the cheap option: leave `EvidenceTag` alone |
| Parcel timeline endpoint + parcel spine UI | ✗ FP-149, 8 pts, carried to Sprint 8 | **Do** |
| Client lens | Cut on POPIA (decision 6) | Stay cut — unless receiver decision (c) is taken, in which case it is the receiver's view |
| All / My / Watching filter | ✗ FP-215/216 | Do the filter half with the ops board |
| Vehicle-clash UI | ✗ FP-139/142 | Do — "one horse on two live trips" is a demo embarrassment waiting to happen |
| Device-binding spike · cross-operator reputation · ring diagram · smart locks | ✗ deferred | Stay deferred; device binding becomes a writeup |

#### B. "What happens inside a phase" (1 Sep) — `claude.ai/artifact/1H5j1tLj9e9CnhzQVeaMZ7`
#### C. "The Step-Event Ledger" plan (2 Sep, verified 6 Sep) — `claude.ai/artifact/9xxtrwxeJEp9uYU5SXXSxf`

These are one argument. C decided that iteration 3 ships the *capture-event rail* (S0.1–S0.4) and
iteration 4 ships the table. **The iteration 3 slice did not ship.** Sprint 7 went to exceptions,
realtime, the receiver app, analytics and security instead — defensible, but it means iteration 4
starts one slice further back than the plan assumes.

| Item | Status |
|---|---|
| S0.1 relax the invented seal regex | ✗ **still `^[A-Z]{2}-\d{4}$`** — a real seal is rejected. 30 minutes. Do it this week |
| S0.2 destination-side expected seal | ~ `UnloadingDetail` compares departure vs found seal *after* unloading; nothing shows "expected at this stop" *before* it |
| S0.3 artifact attribution `(phase_event_id, step_slug)` + act rows | ✗ no such columns on `evidence_artifacts` |
| S0.4 INFO realtime kind for uploads | ✗ no `ARTIFACT_UPLOADED` kind |
| D-10 exceptions as act rows · D-11 severity ranking | ✓ |
| D-8, D-9, D-12 | open |
| Stages 1–6 · `phase_steps` · `ActorType` | ✗ not started |
| FP-167 `phase_service` split | ✗ file grew from 1441 to 1962 |
| Seal §3.2 scan-or-type (FP-266) · §3.5 break binding · §3.3 expected seal at creation | ✗ |
| 409 duplicate-vs-prerequisite split (Stage 5 blocker) | ✗ see §3.4 |

**Is the ledger still worth building?** The panel never asked for it. But three things they did ask
for run through it: the bad-day evidence bundle wants per-act timestamps and actors; "not all
evidence anchored" is only closable honestly with a child hash root; and whatever replaces the
biometric check needs a place to record a **non-driver actor** — which is Stage 6's entire point.

**Recommended alteration to the plan:** skip the capture-event rail entirely (it was a
presentation-fortnight compromise and that fortnight is over) and go straight to **Stage 1 → Stage 2
→ Stage 4** — table, derived rows, rendered rail. That gives the PDF its per-act rows. Then, only if
sprint 9 has room, Stage 3 (Merkle root, FP-63). **Do not do Stage 5** (live emission) — it is a
driver-app rework for a gain the panel can't see. Do the **receiver sign-off row of Stage 6** because
the handover already produces the data. And do **not** open the Arrival phase (known-issues §10) —
it changes the phase plan under existing trips in the final iteration; make it a design note with
the acceptance criteria already written.

### 3.6 What the iteration 2 document said iteration 4 would be

> *"Pilot Readiness and Polish: end-to-end reliability, evidence access, exception handling,
> POPIA-related controls, resilience testing, final interface improvements and a presentation-ready
> Johannesburg to Durban demonstration."*

That sentence is still right. It is also exactly what the panel asked for, in different words.

---

## 4. Where the two lists meet

The useful discovery: the panel's list and our own backlog point at the same work far more often
than not. Building the ledger *is* how we show the bad day; the receiver decision *is* ledger Stage 6;
the security review *is* the declared limitations.

| Panel theme | Our existing item | So the work is |
|---|---|---|
| T1 bad day + incident PDF | Ledger Stages 1–2–4; exceptions already on the act rail; `record_and_anchor()` | Build the read-side ledger, then a server-rendered PDF over trip + phases + step events + exceptions + receipts |
| T2 receiver model | Decision 10; ledger Stage 6 Q2/Q3; `client-portal/` stub; Didit webhook | One decision (§5.1), then either strip Didit to a per-consignment policy flag or build credentialed receiver sign-off |
| T3 cut manual input | Seal-chain §3.3; PP waybill autofill | Seal photo-confirms-number step (no creds needed); expected-seal at creation; reverse geocoding on precinct/trip forms |
| T4 multi-trip + alerts | FP-215/216; decision 11; FP-136 epic; known-issue 11 | Ops board over the org SSE stream we already have; one push channel; assignment model only if roles are in scope |
| T5 defensible analytics | `problems.py:112` provenance already precise; incident map exists | Provenance line per tile/page; a "today" filter that can be demonstrated on demand; ambient-vs-deep-dive is a layout split, not new data |
| T6 robustness | Decision 4 device binding; Q2 offline fallback; polygon (decision 8); FP-149 | OTP fallback + supervisor override with audit event; multi-select breakdown; polygon migration; FP-149 finishes "simulate scanning" |
| Declared limitations | Security review S1–S8; known-issue 4; ledger Stage 3 | Fix S1, S2, S4 first (they're the ones we said were "being fixed"); pool/connect timeouts; anchor coverage stated honestly |
| Rubric: SOLID | Refactor audit items 1–6 | Do 1–5 in week one of sprint 8; 6 = FP-167 before ledger Stage 2 |

---

## 5. Four decisions before sprint 8 is sized

These change *what* gets built. The minutes list them; here is a recommendation on each.

### 5.1 Does biometric receiver verification survive?

Options: (a) drop it — PIN + geolocation + parcel photo; (b) keep as per-consignment policy, default
off, on for high-value/dangerous freight; (c) Ammar's onboarded customer — credentialed receiver logs
in and signs off.

**Recommend (b) now, with (c) as the demo story if there is capacity.** Reasoning: (b) is the ground
reviewer 1 conceded and is almost entirely deletion — the code exists, it becomes a flag on the
consignment. It keeps the QR handover (which both reviewers liked and which needs no account) as the
default path, and removes the webhook from the critical demo path. (c) is stronger evidence and
satisfies both reviewers, but it is a fourth frontend surface (`client-portal/` is a README) plus a
receiver account model, in the iteration where we also have to write 70 pages. If we do (c), scope it
as *sign-off only* — no tracking portal. Either way: **do not type the ID number if it was scanned**.

### 5.2 Completion vs expansion

**Recommend:** multi-trip ops board and one alert channel are *completion* — the single-trip view is
not a usable product and Ammar said so. Driver HOS, maintenance lifecycle, cost management,
in-house response teams, auto-ETA and the customer tracking portal are *expansion* — deferred, with
a slide saying we chose to.

Precinct-scoped roles sit on the line. Recommend a **minimal** version: a `precinct_id` on the
dispatcher user, a "my precinct's trips" filter, and a supervisor role that can approve overrides.
That unblocks decision 11 (routing) without building full RBAC.

### 5.3 How far does the bad-day scenario go?

**Recommend:** incident report PDF is in; Pulsit camera snippets are a design note + slide unless
credentials arrive by the sprint 8 midpoint. The scenario: collision in transit → driver raises a
critical exception with photos → tracker/phone corroboration disagrees → dispatcher reviews →
trip cancelled with cause → PDF compiled with phase timeline, step events, exception, artifacts with
hashes, Hedera receipts, and reviewer decisions. Everything in that chain except the PDF exists.

### 5.4 Live credentials

**Recommend:** write the mitigation now, not later. If Pulsit and Parcel Perfect are still mocked at
the final demo, the slide says: integration code complete, `PULSE_USE_MOCK` / `IDVS_USE_MOCK` are
config flags, mock feeds replay recorded real-shaped data, and here is the one-line diff to go live.
Simulated route movement (T6) is buildable against the mock and should be — it makes the demo
better regardless.

---

## 6. Proposed shape: three tracks plus the submission

Ordered by what the panel will look for, then by what unblocks what. Sizes are guesses for a
planning conversation, not estimates.

### Track A — Close and harden (non-negotiable; do first)

These are the things we said were being fixed, or that a marker can find with `grep`.

| Item | Notes | Rough size |
|---|---|---|
| Security S1: RLS/revoke migration for the nine unprotected tables + a test that runs as the API roles | One hand-written migration; copy the analytics-views discipline | 3 |
| Security S2: `advance_confirmation` requires a `HandoverConfirmation` for that trip/phase and takes the signature artifact from it server-side | Closes "driver bypasses receiver"; touches `phase_service.py` — coordinate | 5 |
| Security S4 + S5: rate-limit on verified principal ID; async bounded JWKS refresh with negative cache | `core/rate_limit.py`, `auth/dependencies.py` | 5 |
| Security S3, S6, S7, S8 | Upload pre-parse limits; shared trip-scoped artifact assertion; session ordering; offline queue namespaced by account | 8 |
| Known-issue 4: connect + pool timeouts on the engine, and a load test that proves it | `db/session.py` | 3 |
| Offline queue: distinguish duplicate-replay 409 from blocked/early 409; retain, don't drop | [useOfflineQueue.ts:301](../frontend/driver-pwa/lib/hooks/useOfflineQueue.ts:301). Three reviews flagged it; it is evidence loss in the bad-day scenario | 5 |
| S0.1: relax the seal regex to length + charset; move the strict pattern to config | [schemas/phases.py:22](../backend/app/schemas/phases.py:22). A real seal in front of the app fails today | 1 |
| Layering: move the Didit call out of `endpoints/handover.py` into `handover_service` / `receiver_verification_service` | So the layering claim is true | 2 |
| SOLID audit items 1–5 | ~12 h; all tested already | 8 |
| FP-167: split `phase_service.py` into a package | Gates ledger Stage 2; do it in a quiet window straight after a merge to `dev` | 5 |
| Didit/replacement webhook working on the deployed environment + a waiting state in the receiver UI | Or deleted, per 5.1 | 3 |
| QR expiry handled gracefully; check which timeout fired | Small | 2 |
| Multi-select truck + trailer breakdown | Small | 2 |
| Confirm step on manually entered waybill/order numbers; date-handling tidy | Small | 3 |
| Reverse geocoding on precinct + trip address forms, key-restricted, spend-capped | Open-source geocoder acceptable | 5 |

### Track B — Complete the product (the panel's "completion")

| Item | Notes | Rough size |
|---|---|---|
| Multi-trip operations board: **upgrade the existing live home list** with current phase, last-ping age, open-exception count (known-issue 11), corroboration verdict, All/My/Watching filter (FP-215/216); optional fleet map | The list and SSE already exist; this is columns, not a surface | 8 |
| One push channel beyond in-app — write `integrations/sendgrid.py` (email) and, if creds, `integrations/twilio.py` (WhatsApp); route to the acting dispatcher | Neither module exists today despite `CLAUDE.md` listing both. Needs the minimal assignment from 5.2 | 8 |
| Receiver decision implemented (5.1) | (b) ≈ 5; (c) ≈ 20 | 5–20 |
| OTP fallback + supervisor override with an audit event | Device-binding spike becomes the writeup | 8 |
| Bad-day scenario end-to-end + incident report PDF | Server-rendered, includes hashes and receipts; the demo centrepiece | 13 |
| Analytics: provenance line on every page; "today" incident filter demonstrable on demand; "done for vehicle details" screen text fixed | Data already exists | 5 |
| Simulated route movement for the demo: polyline playback between the six `demo_waypoints` targets that already exist | Also makes corroboration demoable | 3 |
| Seal photo-confirms-number step; scan-or-type via FP-266 | OCR optional; a confirm step is the minimum reviewer 1 named | 5 |
| Recurrence detector (same driver · same lane · same load class, evidence one click away) + three impact tiles | The "deep-dive" half of Ammar's analytics split; a `GROUP BY`, not ML | 5 |
| Demo script: use the dev-panel `trigger_scan` and `move_truck` we already have; show the precinct map | Zero build; it was skipped on stage | 0 |

### Track C — Evidence spine (our own commitments)

| Item | Notes | Rough size |
|---|---|---|
| Ledger Stage 1 (table + empty read path) | Independent; anyone can start it. Skip the S0.3/S0.4 capture-event rail — go straight here (§3.5) | 5 |
| Ledger Stage 2 (mappers, after FP-167) | One phase type at a time, six green runs | 13 |
| Ledger Stage 4 (dispatcher rail over the full ledger) + the receiver sign-off row from Stage 6 | Feeds the PDF; the handover already produces the receiver data | 8 |
| Ledger Stage 3 (Merkle root, D-9, D-12) — *only if* sprint 9 has room | Closes "not all evidence anchored" honestly | 8 |
| ~~Ledger Stage 5 live emission~~ | Driver-app rework for a gain the panel can't see. **Cut.** | 0 |
| FP-149 parcel traceability (carried) + FP-266 | Already 8 pts in Sprint 8 | 8 |
| Polygon geofences | Geometry column, migration, `geofence_service` reads polygon-or-radius | 8 |
| ~~Arrival custody-check phase~~ | Changes the phase plan under existing trips in the final iteration. **Design note only** — the acceptance criteria are already written | 0 |
| FP-139/142/260 vehicle clash, impossible duration | 10 pts already sized | 10 |

### Deferred, with a slide saying so

Driver hours-of-service · fleet maintenance lifecycle · trip cost management · in-house response
routing · auto-ETA and fleet scheduling · customer tracking portal (unless 5.1 = c) · Pulsit camera
snippets (credential-blocked; design note) · cross-operator reputation (spike writeup) · ledger
Stages 5–6 beyond what the receiver decision forces · smart locks.

### Track D — Final submission (runs the whole iteration, not the last week)

- **Documentation, 50–70 pages:** background, problems, objectives, risks, updated plan/architecture
  *with revisions highlighted*, work products (package/class/use-case/state-machine diagrams, schema,
  UI mock-ups, test approach + sample cases in an appendix), development approach, sprint artefacts,
  addendum of what changed. Iteration 3's draft is the base.
- **Portfolio of evidence per person** — scrum role, docs, minutes, presentation, code, research.
- **Minutes** in the required categories; **peer evaluation**; **zipped code + deployed link + README**.
- **Process fixes we committed to on stage:** carryover reported separately from sprint 8; carried
  items tracked to done inside the next sprint; points spread more evenly across four people.
- **Final presentation:** a Johannesburg → Durban storyline, bad day included, provenance stated,
  incident map on demand. Every claim in §2 either true or not made.

---

## 7. Capacity reality check

At ~75 pts/sprint, two sprints ≈ **150 pts** before documentation. After the 18 Sep verification
the tracks size at roughly: Track A ~60, Track B ~55–70, Track C ~60 with Stage 5 and Arrival cut.
**Still over by a third before the 70-page document.** So the sizing conversation is really a
cutting conversation, and the cuts should come from Track C, not A or B — with two exceptions:
FP-167 (it gates everything in C and is a rubric item) and ledger Stage 1 (cheap, and it lets us say
the ledger exists).

A reasonable first cut: Track A whole · Track B whole with receiver option (b) · Track C = FP-167,
Stages 1–2, FP-149, vehicle clash. Stage 4, Stage 3 and polygon go into sprint 9 only if sprint 8
lands clean. That is roughly 150 pts. Documentation is then a fifth track that needs its own points
on the board — it was under-counted in every previous iteration.

---

## 8. This week

1. **Team meeting:** take the four decisions in §5. Record them here with a date, the way the 26 Aug
   changes were recorded in the iteration 3 plan.
2. **Set sprint 8 dates and the final submission date** at the top of this file.
3. **Fix the three false claims in §2** (handover.py layering, S1/S2/S4, pool timeouts) before any
   other feature work — they were "being fixed" on the record.
4. **Size Track A and B** in Jira; put documentation on the board as tickets with points.
5. **Send Bruce the questions in §10** and ask for the Pulsit / PP credential status in writing.
6. **Rebuild the graph on `dev`** after the merge — it is three commits stale.

---

## 9. Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-09-18 | Draft written; nothing decided | Ciaran |

---

## 10. Questions for Bruce — the logistics reality we are guessing at

Every one of these gates a build decision. The ones marked **★** decide something the panel
attacked. Ask them in one sitting; most are five-minute answers from someone who has watched the
job done.

### The handover (★ — decides §5.1)

1. **Who physically receives a linehaul at RTT / X International?** A named clerk with a login to
   their own system, a shift supervisor, whoever is on the dock? Do they carry a company phone?
   *(Decides onboarded-customer vs QR-on-any-phone.)*
2. **On 1 Sep you said "once RTT scans and breaks the seal, custody ends."** Who holds the cutter —
   RTT staff, or the driver under RTT's eye? Does the driver photograph the break, or would RTT?
   *(Ledger Q3. Decides whether `seal-broken` can ever be a non-driver event.)*
3. **What does a paper POD look like today, and who keeps it?** Name, signature, ID number, company
   stamp? Does anyone ever check the ID number? *(Decides whether an ID number was ever proportionate.)*
4. **Has a receiver ever refused to sign, or signed short?** What happens next, operationally?
   *(Decides the "receiver cannot / will not scan" fallback tier.)*
5. **Would a receiving department accept a login to a FreightProof page** if their carrier asked?
   Has any carrier ever asked them to use an app? *(Ammar's model, tested against reality.)*

### The seal (★ — decides seal auto-population)

6. **When is the seal number known?** At booking, at the waybill, or only when the driver picks
   one off the rack? Is it on the waybill *before* departure? *(Ledger Q1. Decides whether the seal
   joins the journey-lock hash at creation.)*
7. **Who supplies the seals** — Pulsit, RTT, a seal vendor? Is there a manifest of issued seal
   numbers we could read? *(The panel suggested "pulled from Pulsit"; is that true?)*
8. **What does a real seal number look like?** Digits only, prefixed, how long? Bring one.
   *(Our validator rejects anything that isn't `AB-1234`.)*
9. **Do drivers ever re-seal en route** (customs, a roadside inspection, a cross-dock)? Who
   authorises it and how is it recorded today?

### The bad day (★ — decides §5.3)

10. **Walk us through the last real incident** — hijack, collision, unrecoverable breakdown. Minute
    by minute: who was called first, what the control room did, what the insurer asked for, what the
    police asked for, and how long it took to assemble.
11. **What does an insurer's evidence request actually contain?** A form, a checklist, an email?
    Which timestamps, which photos, which signatures? *(Decides the incident PDF's contents.)*
12. **How long does it take today to produce proof for a disputed delivery?** A real number, from a
    real case. *(The fourth impact tile; the number that sells the platform. Do not invent it.)*
13. **When a truck breaks down, who decides roadside-fix vs recovery?** Is there an in-house
    breakdown crew, and how are they notified? *(Ammar's response-team point.)*

### The control room (★ — decides §5.2 roles)

14. **How many people watch trips at once, and how are trips divided between them?** By lane, by
    depot, by client, or one room watching everything? *(Decides filter vs routing, and FP-215/216.)*
15. **What is on the wall screen?** If there is one — what does a controller glance at every few
    minutes, and what do they only open when something is wrong? *(Ammar's ambient/deep-dive split.)*
16. **Who is allowed to start a trip, and who assigns the truck** — origin depot, destination depot,
    a central planner? *(Precinct-scoped roles.)*
17. **When a driver phones because the app / OTP / signal is dead, what happens?** Who can say
    "carry on" and how is that recorded? *(Supervisor override.)*
18. **How do controllers get alerted today** — WhatsApp group, phone call, Pulsit's own alerts,
    email? Which of those would they actually act on? *(Which push channel to build.)*

### The precincts

19. **How many depots and client sites do you deliver to regularly?** Tens or hundreds?
    *(Decides whether polygon geofences are worth drawing by hand.)*
20. **Do you have addresses or just "the RTT depot in Pinetown"?** Would a controller enter a
    street address or a pin on a map?

### Integrations and the panel's suggestions

21. **Pulsit cameras:** do your trucks have cab/road cameras through Pulsit, and can footage be
    pulled by time window through their API or only by asking them? *(Decides whether camera
    snippets are buildable at all.)*
22. **Pulsit / Parcel Perfect credentials** — honest status. If they will not arrive before the final
    demo, we plan the mock-with-a-diff slide now.
23. **Do your trailers carry the Pulsit tracker, the horse, or both?** *(The truck/trailer breakdown
    multi-select and the corroboration source both depend on it.)*
24. **Is there an ETA today?** Does Pulsit or the planner give one, and is it trusted? *(Whether
    auto-ETA is expansion or a gap.)*

### Domain expansion (only to scope the "deferred" slide honestly)

25. **Driver rest rules** — what do you actually enforce, and does anything log it?
26. **A roadside fix that becomes a workshop job** — who records that link today, if anyone?
27. **What does a Johannesburg–Durban trip cost** (you said ~R20 000 on 1 Sep) — is that a number
    a controller sees, or only finance?
