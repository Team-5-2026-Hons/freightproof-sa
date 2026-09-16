# Team05 — Iteration 3 documentation assembly plan

Prepared 16 September 2026. This is an internal writing plan, not the submission itself.

## 1. Handoff and decisions

Build a concise account of the current system and the work delivered since 12 August. Start a fresh submission structure rather than shortening the copied iteration 2 draft paragraph by paragraph. Retain the context needed to understand the project; show changed work products and evidence; explicitly reference unchanged use-case narratives and risks in iteration 2. Preserve the existing documents as source material.

The 16 September lecturer meeting changes how we should apply the written guidelines:

| Decision | Application to our submission |
|---|---|
| The maximum is 70 pages, including title page, contents and everything else in the document. | Target 64 pages. Count references, addendum and test appendix. The remaining six pages are contingency, not a target to fill. |
| Include only new or changed use-case narratives; reference the others to iteration 2. | Maintain a complete use-case index so omitted narratives are deliberate and discoverable. A changed narrative may explain only the changed flow if the retained flow is precisely referenced. |
| Keep context, business problems and objectives even where unchanged. | Write a compact, self-contained opening. Do not replace it with “see iteration 2.” |
| Risks may reference iteration 2 when unchanged, except where feedback requires correction. | Include new/changed risks and repair old incomplete risk treatment. Do not cross-reference a missing register. |
| Portfolio of evidence will have a separate submission. | Prepare it separately, outside the 70 pages. Confirm the announced submission slot is available before uploading. Other appendices remain inside the limit. |
| Presentation remains similar, but the updated marksheet adds requirements. | Include AI-use reporting and explicit scalability/maintainability evidence in preparation, alongside business value and Scrum. |

Authority: lecturer clarification above; the supplied iteration 3 guidelines, presentation instructions and marksheet; historical marker feedback; then current implementation evidence for technical claims. The master remediation plan is a useful feedback inventory, not proof that a described feature exists or that every diagnosis in it is correct.

### Evidence boundary

- Comparison baseline: `0e23afd6311ec6f348c380ed055a3d9731728683`, 11 August 2026 at 21:24 +02:00, the last first-parent commit before the end of 12 August. No later first-parent commit on 12 August was found. Treat this as the repository baseline for the requested period, not proof of the exact build demonstrated in iteration 2.
- Reviewed current snapshot: `40e0d3803a525a26e9d6b026eb0307f76e949366`, 16 September 2026. Untracked iteration 3 documents were read separately; they are not part of the Git diff.
- Graphify was queried to find relationships among receiver handover, verification, phases, corroboration, exceptions and analytics. Source and tests were then checked, with Git history establishing the time boundary.
- A changed file or implemented test is not proof of a passing test, successful live integration or deployed capability. Record those separately in the submission evidence register.
- Include a pre-baseline feature only as essential context, a dependency needed to explain a new flow, or a correction required by feedback. Label a feedback correction as such rather than calling it new functionality.

## 2. Proposed contents and page budget

These are rendered-page allowances, not promises that a given word count will fit. Use Calibri 11, 1.18 line spacing and A4; reduce repetition before reducing readability.

| Section | Pages | What the marker should learn |
|---|---:|---|
| Front matter: cover, contents, compact figure/table navigation | 3 | Team, iteration, version and how to find evidence |
| 1. Project context, problems and objectives | 5 | Why FreightProof exists and what success means |
| 2. Iteration 3 scope and revised plan | 3 | What changed, what was delivered and what remains |
| 3. Updated analysis and design work products | 18 | The changed user flows and the design that implements them |
| 4. Current architecture and integration boundaries | 4 | How the delivered system works and what is live or simulated |
| 5. Risk assessment and treatment changes | 4 | Which risks matter now and how the team manages them |
| 6. Selected UI evidence | 5 | How users perform the important new work |
| 7. Testing approach, results and limitations | 4 | What was checked, with what evidence and what remains uncertain |
| 8. Scrum, progress and reflection | 8 | How the team planned, inspected and adapted during this iteration |
| References and short glossary | 2 | Traceable sources and readable domain terminology |
| Addendum: changes and feedback closure | 2 | Where each material change or correction can be found |
| Appendix A: sample executed test cases | 6 | Reproducible inputs, expected/actual outcomes and selected evidence |
| **Planned total** | **64** | **Six pages below the hard maximum** |

Keep the separate portfolio of evidence, meeting minutes/agendas, slides, code archive/access instructions and individual peer evaluations outside this document as their own required submissions. Do not relocate required main-document evidence into the portfolio merely to save pages.

## 3. Exactly what goes in each section

### Section 1 — Project context, problems and objectives: 5 pages

Include a short account of LFG's transport operations, the relevant parties, custody handovers and the consequences of fragmented evidence. Identify the project as self-sponsored and explain the industry partner's role accurately. Lead with FreightProof as an evidence integration layer across existing systems. Explain each external product and its integration role in plain language.

Retain the business problems and the distinction between business, project and system objectives. Add the missing parent business objective, with supporting objectives beneath it. Choose one accurate delivery term—such as a working MVP with stated limitations—and use it consistently; do not alternate between proof of concept and MVP.

Include one traceability table: problem ID → business objective → iteration 3 capability/change ID → observable acceptance measure → evidence location. Measures without collected results remain proposed measures, not achieved outcomes. Avoid claiming reduced losses or improved turnaround without a baseline and measurement.

Remove repeated technology histories, unsupported claims about vendor incentives, and unsupported legal explanations. Use partner/research evidence for barriers to integration. An assumption must be labelled and validated rather than written as fact.

### Section 2 — Iteration scope and revised plan: 3 pages

Use the reviewed baseline and current build to define the reporting period. Show one story map or release slice with iteration 3 stories highlighted; one delivered/partial/deferred table linked to actual issue IDs; and a short revised milestone/release view. Explain meaningful changes from the earlier plan and why they happened.

Use the change groups in section 4 of this plan to select stories. Confirm the actual sprint boundaries from the team's records; do not infer sprint completion from an old plan. Separate implementation completion, tested completion and deployment verification.

Do not repeat the full historical project plan or all old sprint tables. Dedicated step-event ledger and arrival-custody proposals must remain future work unless new implementation evidence establishes otherwise. The supplied guidelines say 17–18 September; older plans mention later dates. Confirm the actual booked deadline before finalising milestone claims.

### Section 3 — Analysis and design: 18 pages

Allocate approximately 2 pages to the use-case index and diagrams, 8 to changed/new narratives, 2 to the package diagram, 2 to the class diagram, 2 to state machines and 2 to the relational schema. These are editorial allocations, not lecturer-prescribed limits.

**Use-case diagrams:** show current actors and system boundaries, including receiver and relevant external systems. Distinguish real integrations from a simulated warehouse scan source. Add analytics, precinct management and exception review where these represent user goals. Keep technical substeps out of the top-level user-goal diagram.

**Narratives:** apply the index in section 5 below. Each new flow needs ID/name, actor, purpose, trigger/preconditions, numbered actor/system steps, postconditions, and material alternatives. For changed flows, give the old reference and the replacement steps/conditions explicitly. Share common security, location and failure rules in one numbered rule table rather than repeating paragraphs across every narrative. Allocate extra detail to receiver handover, evidence verification and exception review; do not force one full page per use case.

**Package diagram:** use UML package notation and labelled dependencies between actual logical packages. Keep infrastructure deployment in section 4. Explain the key dependency directions; avoid a single ambiguous external-systems arrow or a deployment diagram relabelled as a package diagram.

**Class diagram:** show the relevant domain classes and changed relationships, including handover/receiver verification, phase evidence, exception review and precinct audit data. Explain important multiplicities. Check empty-leg/zero-consignment cases against the model. Use a legible focused diagram with sufficient retained trip/stop context, not every attribute in every class. Iteration 2's class-detail appendix contains image-based information: it is not simply an empty appendix as the master plan suggests.

**State machines:** model states, transition triggers and guards from current behaviour. Reconcile trip arrival, phase completion, exception review and handover expiry/reuse where relevant. The old trip diagram already contains choice nodes; verify their semantics instead of assuming that adding diamonds fixes it. If a consignment state model remains relevant, supply or precisely reference a valid one; explain the chosen model scope.

**Relational schema:** distinguish persisted tables from analytical views. Show new foreign keys, cardinalities and relevant uniqueness constraints; include enough existing entities to follow the relationships. Current analytics mappings describe plain live views, so do not copy the older materialized-view/refresh description. Do not paste migrations or a dense full database dump.

### Section 4 — Architecture: 4 pages

Provide one readable current architecture diagram, with the dispatcher, driver PWA, receiver web application, API/services, database/storage, workers, authentication and external providers. Give one compact runtime/integration table: purpose, data exchanged, implemented interface, observed test mode, deployed verification evidence and limitations.

Explain the new receiver path and trust boundary, location corroboration, asynchronous evidence anchoring and analytics reads. Identify what is stored off-chain and precisely which evidence fields/digests are anchored. Summarise security, maintainability and scaling considerations using current design evidence; do not invent load-test results.

Correct stale “six handshake states,” daily Merkle anchoring and unverified notification claims. The Parcel Perfect polling default in source is 60 seconds, not the draft's 15 minutes; confirm deployed configuration without exposing secrets before calling it the live interval. Parcel Perfect expected-cargo data and simulated observed warehouse scans are distinct. Didit concerns receiver verification; do not describe it as established driver identity verification.

### Section 5 — Risks: 4 pages

Open with a one-paragraph scope note identifying unchanged risks by their iteration 2 IDs and exact section/table. Include all new/changed risks plus old risks whose feedback was not resolved. Repair missing register references before relying on them.

For each included risk, capture ID, cause/event/consequence, likelihood/impact, owner, mitigation, monitoring indicator and threshold, management/contingency action, and residual exposure/status. Use the mitigation/monitoring/management structure requested in feedback. Name actual owners only after team allocation.

Prioritise receiver identity/privacy and unavailable-provider fallback; forwarded QR/remote participation; stale or missing GPS and unknown verdicts; evidence storage/anchoring failures; analytics interpretation and scale; and submission/deployment readiness. Link risk controls to tests and limitations. Unknown location or unavailable verification must not be reported as verified success.

### Section 6 — UI evidence: 5 pages

Select a coherent changed journey: precinct/geofence setup; trip timeline and recorded location comparison; driver exception photograph and dispatcher review; receiver QR/consent/verification/signature; entity and fleet analytics. Group related screens and annotate the user decision, evidence captured and business benefit. Include one important failure or degraded state, not only happy paths.

Label implemented screenshots versus proposed mock-ups and state the build/mode captured. Reuse existing login/basic CRUD screens only when needed to explain a changed interaction. Do not repeat the old gallery of roughly 30 screens. The current draft's 49 relative image links have no matching local assets: restore/export the needed diagrams and screenshots before layout. Scrub real personal information from submission evidence.

### Section 7 — Testing: 4 pages, with samples in Appendix A

Describe unit, integration, UI/end-to-end, security and user acceptance testing actually performed. State test environment, commit, date, mock/live dependencies, selection rationale, results and outstanding defects. Present a compact requirement/risk-to-test matrix and refer to executed samples in Appendix A.

Recommended sample coverage: QR expiry/replay and concurrent redemption; receiver verification and provider-unavailable fallback; evidence modification detection and legacy receipt compatibility; missing/stale GPS; exception review concurrency and retained audit evidence; organisation isolation; analytics correctness after trip completion; and trip/resource validation. Choose roughly 6–8 readable representative cases across the six appendix pages, combining related cases where appropriate.

Each sample needs test ID, requirement/risk, preconditions, concrete synthetic inputs, steps, expected outcome, actual outcome, pass/fail, date/build/mode, and a legible evidence reference. Existing test files are candidate evidence, not execution results. Keep long logs in a referenced evidence location without replacing the required in-document sample cases. Never fabricate UAT sign-off or retrospective pass rates.

### Section 8 — Scrum and progress: 8 pages

Spend about one page on virtual-team roles and mechanisms, then organise the evidence by actual sprint: goal and committed backlog; final task-board/backlog evidence; burndown; delivered/carried-over scope; retrospective finding; action taken and its subsequent result. Finish with a compact velocity/capacity explanation and iteration reflection.

Use real Jira/history exports and dated evidence from the reporting period. Explain scope changes and estimation differences; velocity must influence planning rather than merely appear as a chart. If a sprint is still open at the submission cutoff, show its dated snapshot and label it open. Do not reconstruct ideal burndowns from memory or count partially done stories as completed.

Explain how the team handled virtual coordination, reviews, integration and blockers, and include a short AI-use account: tools, tasks, human checking, and team responsibility. Show evidence of what improved after previous feedback. Keep individual contribution details in the separate portfolio, with a short pointer here.

### References, addendum and appendix

References identify the exact iteration 2 submission, the current guidelines and relevant partner/research sources. Expand acronyms on first use; keep only useful glossary entries.

The two-page addendum maps change/feedback ID → former section → new section → change made → evidence/status. Separate documentation corrections from product changes. Do not paste the entire master remediation plan.

Appendix A contains the sample executed tests described above. Avoid creating a second large UML or risk appendix: essential models and changed risks have budgets in the body. Any additional appendix consumes the six-page contingency and still counts toward 70.

## 4. Verified change groups and where to place them

These are documentation priorities from graph navigation, source inspection and the baseline-to-current comparison. They are not a claim that every changed line was audited or that the deployed build has been exercised.

| ID / priority | Change since baseline and important distinction | Submission locations | Repository evidence / candidate tests |
|---|---|---|---|
| D01 / high | Receiver-side rotating QR handover, session-bound confirmation and atomic single-use redemption. Explain expiry/retry and residual risk of forwarding a QR. | Scope; receiver narrative; architecture; UI; risk; tests | `backend/app/orchestration/handover_service.py`; `backend/app/api/v1/endpoints/handover.py`; `frontend/receiver/app/h/[token]/HandoverPageClient.tsx`; `backend/tests/integration/test_handover_token_concurrency.py` |
| D02 / high | Receiver identity/consent and verification tiers, linked to confirmation. Provider availability or partial verification must remain visible. | Receiver narrative; data model; integration table; UI; risk; tests | `backend/app/orchestration/receiver_verification_service.py`; `backend/app/integrations/idvs.py`; `backend/app/db/models/receiver_verification.py`; `backend/tests/integration/test_receiver_verification_endpoints.py` |
| D03 / high | Versioned departure/confirmation evidence payloads include selected artifact hashes; legacy verification and receipt lookup are supported. This is narrower than “all phase evidence and GPS are hashed together.” | Evidence narratives; architecture; tests; addendum | `backend/app/orchestration/phase_service.py`; `backend/app/api/v1/endpoints/blockchain.py`; `backend/tests/unit/test_phase_anchor_payload.py`; `backend/tests/integration/test_phase_anchoring.py`; `backend/tests/integration/test_blockchain_receipt_lookup.py` |
| D04 / high | Recorded horse/trailer/driver location assessment and geofence corroboration, including unknown/stale data and comparison UI. Location is supporting evidence, not proof of personal identity. | Shared rules; phase narrative deltas; state/design; UI; risk; tests | `backend/app/orchestration/corroboration_service.py`; `backend/app/orchestration/action_location_service.py`; `backend/app/orchestration/geofence_service.py`; `backend/tests/integration/test_phase_corroboration.py`; `backend/tests/integration/test_phase_location_preview.py` |
| D05 / high | Exception reporting and photographic evidence, severity-driven updates, and dispatcher evidence review. Describe current review semantics rather than the superseded resolve model. | Exception narratives; data/state design; UI; tests; Scrum | `backend/app/orchestration/exception_service.py`; `backend/app/api/v1/endpoints/exceptions.py`; `backend/tests/integration/test_exception_reads.py`; `backend/tests/integration/test_exception_review_concurrency.py` |
| D06 / high | Driver, vehicle/trailer, lane/facility and fleet analytics provide aggregated operational evidence. Live views replaced the earlier materialized-view approach. | New analytics narrative; architecture/schema; UI; tests | `backend/app/orchestration/analytics_service.py`; `backend/app/orchestration/fleet_analytics_service.py`; `backend/app/analytics/views.py`; `backend/tests/integration/test_analytics_endpoints.py`; `backend/tests/integration/test_fleet_tiles.py` |
| D07 / medium | Precinct create/edit/detail, geofence maps and scoped audit/anchoring. This is more than a cosmetic screen change. | New management narrative; class/schema; UI; tests | `backend/app/orchestration/precinct_service.py`; `backend/app/api/v1/endpoints/precincts.py`; `backend/tests/integration/test_precincts.py` |
| D08 / medium | Trip timeline/history and cancellation UI changes; validation/concurrency protections for trips, resources and consignments; arrival-time correction. Existing core trip creation is not a new iteration 3 feature. | Short narrative deltas; business rules; test matrix; addendum | `backend/app/orchestration/trip_service.py`; `backend/app/orchestration/consignment_service.py`; `backend/tests/integration/test_trip_history.py`; `backend/tests/integration/test_creation_concurrency.py`; `backend/tests/unit/test_arrival_timestamp.py` |
| D09 / supporting | Atomic session handling, idle-session improvements, health probes, security headers and reliability fixes. | Architecture quality paragraph; tests; compact change register | `backend/app/auth/sessions.py`; `backend/app/core/security_headers.py`; `backend/tests/integration/test_session_concurrency.py`; `backend/tests/unit/test_health_probes.py` |

Use actual backlog IDs alongside D01–D09 once matched. These D IDs are writing/evidence references, not invented Jira identifiers. Omit routine styling, dependency churn, generated graph changes and development mock controls from standalone feature narratives; mention them only where they explain testing, team practice or a material quality improvement.

### Claims that must be corrected before copying text

| Draft/master claim or ambiguity | Required treatment |
|---|---|
| Activation now takes a readiness photograph | Current activation `Verification.tsx` does not capture one. Remove unless new implementation is demonstrated. |
| Phone/device possession verifies the driver personally | Distinguish authenticated session, location corroboration and identity assurance. Receiver verification does not resolve driver identity by itself. |
| Didit integration is fully proven live | Source notes record limited live observations, not a complete observed successful verification/webhook journey. Collect current live evidence or label limits and mock mode. |
| Every phase anchors GPS and all artifact data together | Use the actual versioned departure/confirmation payload coverage in `phase_service.py`. Explain off-chain evidence separately. |
| All external cargo/scan data is live | Distinguish Parcel Perfect expected cargo from the mock observed-scan feed in `backend/app/integrations/scan_feed.py`. |
| Historical plan items are delivered | Check code, tests and deployment; explicitly defer unimplemented ledger/custody proposals. |
| Appendix B is an adequate risk-register reference | It is used for UML material in iteration 2. Supply a valid risk reference or reconstruct the corrected risk entry in this submission. |

## 5. Use-case retention and replacement index

Use the original IDs to avoid breaking references. Proposed new IDs below must be reconciled with the team's naming scheme before writing. “Delta” means a clearly identified replacement to an old narrative, not a vague statement that it changed.

| Iteration 2 ID / proposed addition | Treatment in iteration 3 | Reason and writing scope |
|---|---|---|
| TLM 1.1 Register Drivers and Vehicles | Split into two labelled successor narratives; keep a mapping to TLM 1.1. | Explicit unresolved feedback. Describe separate goals and relevant uniqueness/validation changes; classify as correction plus changed rules. |
| TLM 1.2 Create a Trip | Short delta; reference unchanged main flow. | Updated validation/concurrency rules and any evidenced planning changes; do not repeat the whole trip-creation walkthrough. |
| TLM 1.3 Monitor Active Trips | Changed narrative/delta. | New timeline, location evidence and exception presentation. Refer to the separate exception-review goal. |
| TLM 1.4 Access Trip History and Evidence | Short delta. | Paginated history and changed evidence access; retain unchanged search/context by reference. |
| TLM 1.5 Verify Evidence Against the Blockchain | Changed narrative. | Versioned artifact verification, tamper results, legacy handling and unavailable evidence. |
| TLM 1.6 View Forensic Detail | Short delta, sharing D03 rules with TLM 1.5. | Receipt lookup and current authorisation/evidence visibility. Avoid duplicating the cryptographic explanation. |
| TLM 1.7 Cancel a Trip | Verify old contract against current endpoint/UI, then reference or give a short delta. | Cancellation existed as an iteration 2 narrative. New UI alone does not justify claiming a new business use case. |
| CC 1.1 Sign In with Phone OTP | Reference retained flow plus concise security-rule correction. | Session/idle/concurrency changes; remove unsupported personal-identity guarantees. |
| CC 1.2 Activate Trip at Origin | Delta linked to shared location rules. | Corroboration changes; no invented activation photograph. |
| CC 1.3 Confirm Loading | Delta linked to shared location/scan rules. | Current corroboration and expected-versus-observed scan boundary. |
| CC 1.4 Seal and Depart | Changed narrative/delta. | Artifact anchoring and updated seal/location handling. |
| CC 1.5 Log Transit Checkpoint | Short delta. | Capture timing/location evidence and applicable separation findings. |
| CC 1.6 Raise Exception or Panic | Changed narrative. | Photograph, severity and current report behaviour; pair with dispatcher review. |
| CC 1.7 Unload at Destination | Delta if affected rules/steps differ; reference retained flow. | Loading/unloading comparison, location and custody wording must agree with current code. |
| CC 1.8 Confirm Delivery and Close Trip | Replacement narrative with receiver subflow reference. | Receiver-side QR/signature/verification and confirmation evidence change the actor flow materially. |
| CC 1.9 Override a Blocked Phase | Validate, then reference unchanged flow or replace affected rules. | Do not conflate phase override with exception review or assume an override creates driver corroboration. |
| Proposed I3-UC-RCV: Receive and acknowledge delivery | New receiver goal linked to CC 1.8. | Consent, verification tiers, signature, single-use confirmation, expiry and unavailable-provider paths. |
| Proposed I3-UC-REV: Review an exception | New/current dispatcher goal. | Review outcome, recorded reviewer/time and preservation of original evidence. |
| Proposed I3-UC-ANA: Inspect operational analytics | New narrative with entity/fleet variants. | User question, filters, metric meaning, drill-down and no-data states. |
| Proposed I3-UC-PRE: Manage a precinct | New narrative; separate create/edit variants where appropriate. | Geofence configuration, validation and audit effects. |

Only declare a use case unchanged after checking its actors, preconditions, steps, alternatives and postconditions. Several narratives share one changed rule; referencing that rule can save space without hiding changes. If eight narrative pages prove insufficient, use contingency first or shorten duplicate UI/architecture prose. Do not delete material exception paths just to hit a per-use-case quota.

Cross-reference pattern: “The unchanged flow is retained from Team05, Iteration 2 final submission, §3.4, UC [exact ID and title], Table [verified number]. Iteration 3 replaces steps [numbers] and adds rule [ID] as specified below.” Replace every bracketed field before submission. Add the exact submitted filename/version in the references. Page numbers are optional navigation aids verified after rendering; they are not the only locator. Do not point readers to known inaccurate old claims as if they remain current.

## 6. Evidence collection and assembly sequence

| Stage | Deliverable / where to work | Observable completion check | Scope fence |
|---|---|---|---|
| 1. Freeze evidence | Working evidence register for D01–D09: owner, issue/PR, commit, implemented/tested/deployed status, artifact path and limitations. Gather actual sprint dates and submission slot details. | Every planned delivery claim has a source and explicit evidence status. | Do not change product behaviour or manufacture missing evidence. |
| 2. Write the submission skeleton | Create the new submission using the contents/page allocations above; write §§1–2 and the use-case index first. | Every official documentation requirement has a destination; every problem maps to scope/evidence. | Preserve original iteration 2 and current working draft. |
| 3. Update technical work products | Write changed narratives and build readable UML/schema/architecture from D01–D09. | Actors, relationships, states, integration modes and payload claims agree across the document and source. | Do not redraw unchanged detail without a reason. |
| 4. Assemble proof | Capture selected UI states, execute relevant tests through the team's normal workflow, collect risk/Scrum evidence and write §§5–8 and Appendix A. | Every reported result has date/build/mode and actual evidence; open items remain explicitly open. | No invented Jira history, UAT, metrics or test outcomes. |
| 5. Close feedback and package | Populate addendum; assemble separate portfolio, minutes, slides, code/access package and peer evaluations. | Historical feedback is resolved, justified or explicitly outstanding; all required uploads have owners. | The portfolio does not replace main-document Scrum or testing evidence. |
| 6. Render and inspect | Export final submission and inspect every page, TOC, figure, table and cross-reference. | At most 70 pages including all internal appendices; all figures readable; no broken assets or unresolved placeholders. | Do not claim page compliance from Markdown alone. |

Assign one accountable editor and real section/evidence owners at kickoff. The final editor should reconcile terminology, numbering, repeated rules and status claims across contributions. This plan deliberately does not guess team allocations.

### Separate portfolio checklist

For each member include Scrum role(s), documentation tasks, meeting minutes, presentation work, code contributions, research and other contributions with dated evidence references. Where earlier feedback requested category ratings and other-member sign-off, retain these unless superseded by current instructions. Use actual contributions. Confirm the separate portfolio slot announced on 16 September; if unavailable, ask the lecturer how to submit rather than silently placing it back into an over-length document.

### Presentation alignment without duplicating the report

Use the same delivered story and evidence for a 15-minute presentation, 20-minute end-to-end demo and 15-minute Q&A. The supplied iteration 3 presentation marksheet allocates 30 presentation marks and 40 demo marks; these are not documentation-section weights. Include background/objectives, progress/story map, Scrum, AI use, business value, security, scalability and maintainability where the marksheet asks for them. Show the new flow extending the old system rather than replaying all old functionality.

## 7. Graphify status and document ingestion

Graphify is useful for the codebase and its CLI queries work. The reviewed graph represents code through the 16 September `265d1d2a` merge, before the current cost-tracking-only commit. Its source inventory does not contain the six supplied iteration 3 Markdown documents. A detector check found all six eligible documents, so their absence is not caused by an ignore rule excluding their Markdown paths.

`graphify hook status` reports no post-commit hook, no post-checkout hook and no registered merge driver. The repository update script is an explicit maintainer workflow, not evidence of automatic document updates. Consequently, saving this plan will not by itself make it searchable in the current graph.

Maintainer follow-up: include the final canonical Markdown documents in the authorised update via `scripts/update-graph.sh` on `dev`; verify their paths appear in the resulting inventory and query distinctive headings such as “Iteration 3 documentation assembly plan” and “Receiver-side rotating QR handover.” Check returned text against the actual documents. Respect the repository's designated-merger policy; no shared graph rebuild was performed for this review.

Before ingestion, prefer readable Markdown plus maintained image assets and useful text descriptions over embedded base64 images. Iteration 2 has about 23,000 words of prose/tables but a 13 MB Markdown file because of its embedded images. The documents are readable in full in sections; their size is not a reason to omit context. The submission problem is repetition and rendering, not an inability to read the material. Graph navigation supplements full document reading; it does not replace it.

## 8. Source register and final acceptance

Source documents in this folder:

- `INF4027W_Team05_Iteration2_Document2026.md` — baseline narrative, tables and diagrams; verify final submitted filename when creating cross-references.
- `Iteration3_Documentation_Working draft.md` — reusable opening material, but substantial old content and missing relative image assets remain.
- `FreightProof_Iteration3_Master_Plan.md` — historical feedback inventory and remediation suggestions, checked against the actual document and implementation.
- `INF4027W Iteration 3 Guidelines_2026.md` — official work products, format, addendum and submission requirements.
- `INF4027W_Iteration3PresentationInstructions2026.md` and `INF4027W_TeamXY_Iteration3_Pres_MrkSht_2026.md` — presentation instructions and updated marking emphasis.
- Lecturer meeting transcript supplied by the user, dated 16 September 2026 — page-limit, unchanged-use-case/risk cross-reference and separate-portfolio clarification. Retain it with team meeting records.

Supporting historical records: `docs/iteration2-feedback-response-2026-08-25.md`, `docs/iteration3_plan.md`, and the iteration 2 presentation/coding marksheets. These are dated context, not the current implementation specification.

Ready to submit means: context is self-contained; only relevant changed work is expanded; unchanged references are precise; all mandatory work products have a home; the feedback addendum is complete; source/test/live statuses are honest; sprint and contribution evidence is authentic; diagrams and screenshots are legible and present; all placeholders are resolved; the rendered document is within 70 pages; and separate submission artifacts are prepared under the Team05 naming convention. Documentation must not be zipped; the code archive must include deployed access guidance as required.
