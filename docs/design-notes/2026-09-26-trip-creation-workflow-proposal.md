# Trip creation: resumable preparation and explicit journey confirmation

**Date:** 2026-09-26  
**Status:** Unapproved proposal — parked for priority review in the week of 28 September 2026.  
**Priority, owner and estimate:** Not assigned. No implementation authorised by this note.  
**Basis:** Read-only review of the `Ciaran` working tree and stakeholder documents on 26 September. Source and plan status must be rechecked before implementation; the committed graph contains older paths and is only a navigation aid.

## Recommendation

Keep a two-stage lifecycle: **prepare a draft movement → confirm and create the evidence-bearing Trip**. Present it as one resumable, three-step form, with Save draft available throughout. A same-day dispatcher can complete it directly; an advance booking resumes when cargo and assignments are known.

This addresses Bruce's statement that a movement can be booked in advance while the actual horse/trailers and manifest are reconciled on departure day. Reordering the current wizard improves field order but does not solve that problem. Drafts must allow missing cargo as well as missing vehicles; requiring waybills at the first save would recreate the early-assignment problem.

This is a proposal for preparation inside FreightProof's evidence workflow. A saved draft must not imply capacity has been reserved, an external booking accepted, or a client notified. It is not a proposal to replace the client's booking system or build fleet optimisation.

## Smallest useful user flow

| Step | Dispatcher supplies | Behaviour |
|---|---|---|
| **1. Movement** | Client/order reference if known, origin and destination precincts, planned dates; required vehicle class if useful | Save incomplete. A suggested site must be confirmed; a PP town or final delivery address is not necessarily the linehaul depot. |
| **2. Cargo & assignment** | Waybill references, consolidated units per waybill, driver, truck and optional trailers | Pull PP cargo details. Explain missing information and resource conflicts. Allow assignment whenever known, not only on departure day. |
| **3. Review & confirm** | Confirmation of completed order, cargo, route, times and resource facts | Create the Trip, phase plan and journey lock only after server validation. One clear confirmation; avoid repeating the review in another modal. |

- Generate a draft reference automatically and retain a durable link to the resulting Trip.
- Keep **cargo not yet known** distinct from an explicitly **empty leg**. Unknown cargo is not an empty leg.
- Save unverified waybill references during a PP outage, clearly marked as unverified. Do not promote a loaded draft until the required cargo has been verified.
- Capture expected arrival/resource-release time as well as departure before asserting interval availability. Decide how loading time, buffers and overruns affect that interval.
- Select existing vehicles and precincts rather than re-entering their details or coordinates. Receiver ID/selfie and manually entered GPS do not belong in trip setup.
- Distinguish PP-sourced facts, suggestions and dispatcher-confirmed facts with small labels and source/verification context, not extra confirmation screens.
- Preserve the driver's limited linehaul view; dispatcher cargo details must not leak into driver responses.
- Initially support two precincts. Defer genuine intermediate pickup/delivery UI until its backend semantics and lock coverage are implemented.

“Confirm on the day” is an operational pattern, not a proposed calendar restriction. The finalisation point must precede the first driver evidence event that requires the committed Trip; it should not be interpreted as waiting until gate departure.

## Order numbers: generate our reference, preserve theirs

| Identifier | Proposed handling |
|---|---|
| FreightProof draft/trip reference | Generate automatically. Trip creation already generates `FP-YYYYMMDD-XXXXXXXX`. |
| Client order / purchase-order reference | Preserve the client's actual value. Label it **Client order reference**, prefill from a trusted source when available, and allow it to be missing in a draft. Manual entry remains a fallback. |
| PP waybill / manifest reference | Retrieve or select the source system's value. Do not invent replacements. |

The project describes the order number as client-supplied and used for tracking, invoicing and gate expectations. FreightProof can generate an identifier technically, but an invented value does not replace the client's business reference.

PP exposes `client_reference`, but the repository does not establish that it is the transport order number used by LFG. Confirm the order → waybill → manifest mapping before automatic population. Multi-client loads also make a single trip-level order field a modelling question; do not silently change its meaning.

Today the order number additionally supports one-live-trip-per-operator uniqueness and the wizard's timeout recovery lookup. Making it optional or changing its meaning requires explicit duplicate prevention and retry recovery, rather than simply removing the required-field validator. Decide whether an external reference is mandatory at final confirmation and how standing contracts and empty legs are identified.

## Verified findings and implementation implications

The following describe the reviewed working tree, not promises that the proposal is implemented. Function names are more durable than line numbers.

| Finding | Evidence | Implication |
|---|---|---|
| Current steps are Order & Waybills → Crew & Vehicle → Route & Schedule → Review; form state is held locally | [Wizard](../../frontend/dispatcher/app/(app)/trips/new/page.tsx), `STEP_NAMES`, `TripNewPage` | Put time before assignment; persistence is needed for resumable drafts. |
| Driver and horse are required by the creation request and Trip model; `TripStatus` has no draft state | [Schemas](../../backend/app/schemas/trips.py), `TripCreateRequest`; [models](../../backend/app/db/models/trips.py), `Trip`; [enums](../../backend/app/db/models/enums.py), `TripStatus` | Prefer a separate draft record converted into a Trip, preserving existing evidence/lifecycle assumptions. This is a proposed architecture, not a settled team decision. |
| Wizard selection filters active drivers/horses, but creation does not enforce schedule overlap checks | [Wizard](../../frontend/dispatcher/app/(app)/trips/new/page.tsx); [phase service](../../backend/app/orchestration/phase_service.py), `_reject_if_another_trip_underway` | Availability is new functionality. Label “No conflicting FreightProof assignment” unless broader availability is actually known; enforce conflicts on the server under concurrency. |
| Wizard pre-fills consolidated units from PP parcel count, although the creation schema describes consolidated units as dispatcher-entered | [Wizard](../../frontend/dispatcher/app/(app)/trips/new/page.tsx), `pullWaybill`, `fetchManifest`; [schema](../../backend/app/schemas/trips.py), `TripConsignmentInput` | Remove that default. Verified parcel data does not establish pallet/consolidated-unit counts. This can be assessed as an independent correction. |
| Current journey-lock payload includes identifiers and endpoint precincts, but excludes cargo, planned departure/arrival and intermediate stops | [Hashing](../../backend/app/crypto/hashing.py), `compute_trip_canonical_payload` | Complete lock coverage and verification before promising that all reviewed facts are anchored. Coordinate with existing journey-lock work; preserve verifiability of earlier receipts or explicitly agree a test-data transition. |
| Every consignment is assigned pickup at the first stop and delivery at the last | [Trip service](../../backend/app/orchestration/trip_service.py), `create_trip`; [integration test](../../backend/tests/integration/test_create_trip_multistop.py), `test_multi_stop_create_stamps_consignment_stop_ids` | Multi-stop UI requires per-consignment pickup/delivery inputs, validation, phase-plan generation and hashing. An ordered stop list alone is insufficient. |
| Creation re-fetches PP data and fails closed on PP failure; the journey-lock anchor also fails closed | [Trip service](../../backend/app/orchestration/trip_service.py), `create_trip` | Preserve drafts on failure. If material PP facts changed since review, show the changes and require renewed confirmation instead of silently committing different facts. |
| Real PP client reports no manifest-contents lookup; the mock supports it | [PP client](../../backend/app/integrations/parcel_perfect.py), `supports_manifest_lookup`, `get_waybills_by_manifest` | Do not make manifest lookup the only advertised fast path. Pasting multiple waybill references and resolving each through single-waybill lookup is a candidate improvement. |
| Cancellation exists, but consignment reassignment rejects another trip without exempting cancelled owners | [Trip service](../../backend/app/orchestration/trip_service.py), `cancel_trip`; [consignment service](../../backend/app/orchestration/consignment_service.py), `fetch_and_sync_consignment` | “Cancel and recreate” is not a complete recovery path for loaded trips. Define an evidence-preserving amendment/replacement mechanism before promising it. |

## Scope options for prioritisation

These are relative scope assessments, not delivery estimates. No usability trial or live PP verification was performed in this review.

| Option | Value | Cost/dependencies | Limitation |
|---|---|---|---|
| **A. Targeted existing-wizard improvements** | Put route/time before assignment, correct unit-count defaults, clarify external/internal references and confirmation copy | Smallest UI scope; each change still needs appropriate verification | Does not support advance drafts. Reordering does not itself provide availability checks. |
| **B. Resumable preparation + confirmation — recommended direction** | Supports advance and same-day preparation without committing unknown facts | Draft persistence/API/UI; safe conversion/retries; resource conflict rules and concurrency; review freshness; explicit lock and correction dependencies | Material cross-layer work, not a cosmetic wizard change. Estimate bounded slices before committing to a sprint. |
| **C. Expanded planning experience** | Intermediate cargo stops, lane suggestions, templates and additional import shortcuts | Further domain decisions, integration work and multi-stop/hash support | Defer until the core flow is justified and reliable. Avoid expanding into an operational planning product. |

Separate data-correctness work from convenience work during priority review. The parcel/unit default, lock coverage and correction gap affect evidence quality even if the draft redesign is deferred. They should be compared with the existing defect register and owned work before creating duplicate tasks.

## Compare with these existing plans

This note does not supersede or reprioritise any of them. Confirm current ownership and completion status during review.

| Reference | Comparison to make |
|---|---|
| [Iteration 4 plan](../iteration4_plan.md) | Does advance preparation fit the next demonstration/research objective, and what would it displace? |
| [Research-informed Iteration 4 recommendations](2026-09-22-research-informed-iteration4-recommendations.md) | Compare stakeholder value and evidence gaps against other proposed improvements. |
| [Arrival phase and live journey](2026-09-23-arrival-phase-and-live-journey.md) | Establish remaining work before starting another lifecycle change; assess shared phase/evidence code impact. |
| [Demo panel and road check](../superpowers/plans/2026-09-24-demo-panel-and-road-check.md) | Compare demo readiness and outstanding validation work with dispatcher workflow investment. |
| [Possible shared custody-ledger pivot](2026-09-22-possible-shared-custody-ledger-pivot.md) | If adopted, would it change draft/Trip/consignment relationships or make current design choices temporary? |
| [Known issues](../known-issues.md) | Reconcile discovered gaps with existing tasks and priorities. |
| [July creation design](../superpowers/specs/2026-07-14-trip-creation-redesign-design.md) and [waybill UX design](../superpowers/specs/2026-07-17-waybill-search-ux-design.md) | Preserve PP-first cargo and limited driver visibility; explicitly revise early validation and parcel-based unit defaults. The former identifies journey-lock v2 as WP7 / FP-113—verify its current owner/status. |

## Decisions for next week's review

- [ ] Choose: defer, approve only option A, or commission a bounded design/estimate for option B.
- [ ] Confirm the minimum information needed to identify a useful draft, including client, tentative route/date and capacity requirement.
- [ ] Confirm the meaning and uniqueness scope of the client order reference, including standing contracts, multi-client loads and empty legs; obtain a redacted real example if needed.
- [ ] Establish when waybill data and consolidated unit counts are reliably available relative to the first driver phase. If only final at sealing, decide how planned cargo and actual departure cargo are separately recorded.
- [ ] Decide which recorded commitments count as resource conflicts, which are warnings, and how missing end times, turnaround and overruns are represented.
- [ ] Confirm draft visibility, ownership and retention; drafts must not enter driver work queues or operational trip metrics as confirmed trips.
- [ ] Assign or link the lock-coverage and amendment/replacement work; decide the acceptable release boundary.
- [ ] Obtain an estimate broken down into draft persistence/UI, conversion and retry safety, conflict checking, evidence changes and validation. Record assumptions and exclusions rather than one unsupported “wizard” estimate.

**Review outcome:** Pending.  
**Selected scope / priority:** Pending.  
**Owner / estimate / dependent tasks:** Pending.

## Acceptance scenarios to carry into any implementation plan

1. Save and reopen an advance draft with no cargo or assigned vehicle, including during a PP outage.
2. Complete a same-day trip without a mandatory save-and-reopen detour; enforce the loaded/empty-leg distinction.
3. Two dispatchers cannot convert the same draft into separate Trips or concurrently claim conflicting resources. A timeout/retry resolves to the existing result.
4. A changed PP snapshot or draft revision is surfaced before final confirmation; failed finalisation preserves the draft.
5. Confirmed cargo, route and schedule are covered by the agreed canonical evidence payload and verification path; earlier records remain explainable.
6. Drafts stay out of driver queues and confirmed-trip analytics. Drivers receive only authorised linehaul information.
7. A correction/replacement retains the original evidence and handles previously assigned waybills through the agreed mechanism.

Existing tests were inspected, not run: this review changed no application code. These are future acceptance scenarios, not claims of passing coverage.

## Stakeholder and identifier evidence

- [Bruce minutes, 28 July](../meeting_minutes/FreightProof_Meeting_Bruce_Minutes_28July2026.md), sections 7–9: client waybill destination versus linehaul leg, scheduling horizon, and day-of-departure vehicle/manifest reconciliation.
- [Bruce minutes, 16 April](../meeting_minutes/meeting_minutes_bruce_16-04-2026_Detailed.md), section 2: client orders and ad-hoc order references via email; cargo/manifest timing requires reconciliation with later notes.
- [Full Picture v7](../FreightProof_Full_Picture_v7.md), Handshake 0: the client's order reference connects tracking, invoicing and precinct expectations. This is requirement context, not proof every described capability exists.
- [Technical Full Picture](../FreightProof_Technical_Full_Picture_v1.md), data-contract asks: the exact order → waybill → manifest identifier chain still needs confirmation.
