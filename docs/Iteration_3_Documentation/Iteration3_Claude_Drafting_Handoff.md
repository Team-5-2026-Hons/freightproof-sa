# Team05 — Iteration 3 drafting handoff for Claude

This is the practical companion to `Iteration3_Documentation_Plan.md`. That file sets the scope, page budget, change inventory and use-case decisions. This file says **where to take text from, what to do with it, and what to write next**. It is a drafting brief, not a finished assessed submission.

## Start here

All source filenames below are relative to `docs/Iteration_3_Documentation/` unless stated otherwise:

- **I2:** `INF4027W_Team05_Iteration2_Document2026.md`.
- **Draft:** `Iteration3_Documentation_Working draft.md`.
- **Feedback:** `FreightProof_Iteration3_Master_Plan.md`.
- **Plan:** `Iteration3_Documentation_Plan.md`.
- **Rules:** `INF4027W Iteration 3 Guidelines_2026.md`, plus the iteration 3 presentation instructions and marksheet in this folder.

Use I2 section headings and use-case IDs as locators. Its Markdown line numbers below are navigation aids for the reviewed export, not final PDF page numbers. Do not copy its cover date, contents entries, table numbers or iteration labels. Rebuild those for the new document.

Action meanings:

- **REUSE:** preserve the underlying information, editing for brevity and accuracy.
- **REWRITE:** use the old section to understand the intent; replace its account with the current one.
- **ADD:** write new material supported by iteration 3 evidence.
- **REFERENCE:** identify the exact old section/UC instead of reproducing it, only where the lecturer permits and it remains accurate.
- **SUPPLY:** the team must provide evidence; Claude must not invent it.

The main document targets 64 pages and must not exceed 70, including front matter, references, addendum and internal appendices. The portfolio of evidence is separate, following the lecturer's 16 September clarification. Keep context/problems/objectives in the main document. Include only new/changed use-case narratives; reference unchanged ones. Apply the same principle to risks, except incomplete risk treatment still needs correction.

## 1. Project context and objectives — 5 pages

### 1.1 Background and operating context

**Take from I2:** §1.1.1 Industry Context, §1.1.2 Client Organisation and §1.1.3 System Overview, starting at lines 503, 513 and 521.

**REUSE:** the road-freight setting; LFG's depot-to-depot operating context; the parties involved; Bruce's role as industry expert; and the evidence gap between existing systems. Retain concrete operational examples only when backed by partner records.

**REWRITE:** “sponsoring organisation” to accurately describe the self-sponsored project and industry partnership. Do not copy claims about named customers, operational use of IDVS, national freight values, hijacking percentages, insurance rates or legal evidential strength without checking their sources. These were statements in I2, not facts verified by this review. Prefer a concise qualitative explanation when an unnecessary statistic cannot be supported.

**Take selectively from Draft:** §1.1.2 System Overview and §1.1.3 The Evidence Gap. Keep the clearer explanation of the integration layer. Restore the organisation/partner context omitted from that draft. Remove unsubstantiated explanations of why vendors have not integrated their products.

**Suggested opening wording:**

> FreightProof brings trip and handover evidence into a common record for road-freight operations. It supports investigation of cargo discrepancies and disputed deliveries by connecting operational records with captured evidence and integrity checks. The project draws on engagement with Load Factor Group to understand depot-to-depot transport workflows. Its purpose is to improve the availability and traceability of evidence across existing operational systems.

**ADD:** one short paragraph identifying what iteration 3 adds: receiver handover, location corroboration, evidence verification, exception review and operational analytics. Leave implementation details to later sections.

### 1.2 Business problems and traceability

**Take from I2:** §1.2 Business Problems, lines 529–555. Preserve the six themes and stable problem IDs where already assigned: fragmented evidence, identity uncertainty, substitution, quantity disputes, later reconstruction and business/insurance exposure.

**REWRITE:** compress each problem to a short explanation of who is affected and its business consequence. Replace absolute claims such as “tamper-proof” or guaranteed legal credibility. Do not imply receiver verification solves driver impersonation. Treat insurance improvement as a longer-term desired outcome, not an achieved benefit.

**ADD:** use Draft §1.2.1 as a structural starting point, but rebuild its capability/status entries using Plan D01–D09. Use this table:

| Problem ID | Operational problem | Business objective | I3 change ID/capability | Evidence location | Remaining limitation |
|---|---|---|---|---|---|

One entry may refer to several capabilities. A problem without a delivered solution remains explicitly partial; do not force a false one-to-one mapping.

### 1.3 Business, project and system objectives

**Take from I2:** §§1.3.1–1.3.4, starting at lines 559, 568, 577 and 588. **Take selectively from Draft:** its parent-objective structure in §1.3.1 and its distinction between session and identity assurance in §1.3.5.

**REUSE:** the three levels of objectives and their underlying intent. **REWRITE:** the missing parent business objective as a clearly labelled project interpretation of partner needs unless partner-approved wording exists. Suggested formulation: “Support LFG's commercial sustainability and client relationships by reducing the operational and financial exposure associated with disputed freight movements.” Keep reduced losses, dispute effort and stronger customer confidence beneath it.

**REWRITE:** project objectives about preventing substitution, permanent records and tamper-proof evidence into defensible goals of detecting discrepancies, preserving evidence and detecting changes. Choose one delivery term consistently and describe its limitations.

**ADD:** a system-objective table with objective, acceptance criterion, I3 capability, current evidence/status and remaining measurement. Carry forward the 60-second anchoring target only as a target unless measured. Confirm runtime settings before publishing a live polling interval; reviewed source default is 60 seconds. Do not equate source defaults with deployment evidence.

## 2. Updated project and iteration plan — 3 pages

**Take from I2:** §2.1 Revised Iteration Plan and User Story Map (line 603), §2.3 Release Plan Summary (667), §9.1.2–9.1.3 carried/deferred work (1694–1705), and §9.3.2 Priorities Moving Into Iteration 3 (1740).

**REUSE:** story-map journey headings and the prior committed direction as a comparison baseline. **REWRITE:** all delivery statuses, dates and “next iteration” wording. Redraw the story map with I3 stories highlighted; do not paste the old image unchanged.

**ADD:** one table: prior commitment → I3 implementation/change ID → tested/deployed status → remaining work → evidence. Use Plan D01–D09 to populate implementation candidates, then reconcile actual Jira IDs and evidence.

Account explicitly for the old commitments to Pulsit/Parcel Perfect/identity integration, multi-stop authoring, artifact hashing, receiver capture, security/deployment, performance measurement and Jira discipline. Do not silently drop an old commitment because it is unfinished. Verify multi-stop authoring and performance claims before marking them delivered.

**Move:** I2 §2.2 architecture material into new §4 where still useful; keep only a short architecture-change pointer here. Integrate the old §9 status/conclusion into this section's delivery table and a brief closing paragraph. A separate repeated status chapter is unnecessary.

**SUPPLY:** actual reporting cutoff, sprint dates, release changes, issue IDs, deployment snapshot and reasons for scope changes. The reviewed code comparison runs from `0e23afd` before 12 August to `40e0d38` on 16 September; it does not establish sprint dates or live deployment.

## 3. UML and database design — 18 pages

### 3.1 Package diagram — approximately 2 pages

**Source:** I2 §3.1 (682). **REUSE:** package names only where they still match the code. **REWRITE:** diagram and dependency explanation using actual callers and UML package notation. Include receiver verification, handover, analytics and location/exception services where relevant. Keep infrastructure boxes in §4. Supply a short rationale for important dependency directions.

### 3.2 Class diagram — approximately 2 pages

**Source:** I2 §3.2 (690) and Appendix B.1 (1842). **REUSE:** retained trip, stop, consignment, driver, vehicle and phase concepts. **ADD:** changed handover/verification, exception review and precinct-audit relationships. Verify multiplicities, including empty-leg cases, against models.

The old appendix includes class-detail images; inspect and select useful content rather than declaring it empty. Do not reproduce all attribute cards. Give important changed attributes/constraints in a compact table next to the diagram.

### 3.3 Use-case model and index — approximately 2 pages

**Source:** I2 §3.3 (702), both TLM and CC diagrams. **REWRITE:** actors/relationships to reflect receiver participation and current external boundaries. Add new user goals for receiver acknowledgement, exception review, analytics and precinct management. Clearly distinguish mocked integrations from participating live systems.

**ADD:** the complete retention/replacement index from Plan §5, updating proposed new IDs to the team's convention. Preserve mappings from original IDs. Do not treat every new service or button as a separate business use case.

### 3.4 Changed/new use-case narratives — approximately 8 pages

**Source:** I2 §3.4 (720), TLM 1.1–1.7 and CC 1.1–1.9. Apply **every row** in Plan §5; it is the detailed per-UC instruction set.

Write the new receiver flow and replace CC 1.8's affected actor/confirmation flow. Update evidence verification TLM 1.5/1.6, exception reporting CC 1.6 and new dispatcher review. Split TLM 1.1 into separate driver and vehicle goals as required by feedback. Add analytics and precinct narratives. Use short explicit deltas for smaller changes such as history pagination and validation.

Keep common location/security/verification rules in one numbered table and reference them from affected narratives. For unchanged material use the exact I2 document/version, section and UC ID/title. A changed narrative must specify replacement steps, preconditions or outcomes; “updated in iteration 3” is insufficient.

Use this compact structure for a new narrative: ID/title; actor and goal; trigger/preconditions; numbered actor/system steps; alternatives and failures; postconditions; linked rules and tests. Do not copy all 49 old narrative tables.

### 3.5 State-machine diagrams — approximately 2 pages

**Source:** I2 §3.5 (1190). **REUSE:** the valid plan-driven lifecycle context. **REWRITE:** affected states, guards and transitions using current behaviour, including arrival/completion and any new model selected for handover or exception review. Explain which entity each diagram represents. Do not confuse review with phase override. Validate semantics rather than merely adding decision diamonds; the old diagram already has them.

### 3.6 Relational schema — approximately 2 pages

**Source:** I2 §3.6 (1198). **REUSE:** enough retained tables to understand relationships. **ADD:** new/changed tables, foreign keys and important constraints for handover, receiver verification, exception review and precinct records. Show analytical views separately from persisted tables. Current analytics uses plain live views; replace historical materialized-view descriptions.

## 4. Architecture and integrations — 4 pages

**Sources:** I2 §2.2 (641), §4.1 Technical Architecture Diagram (1208), §4.2 Network Diagram (1216). **REUSE:** valid stack choices and explanations of existing components. **REWRITE:** one current architecture and one concise runtime/data-flow explanation instead of three repetitive architecture descriptions.

**ADD:** receiver web surface and trust boundary; receiver identity provider; captured/corroborated location flow; asynchronous anchoring/recovery; current analytics reads. Explain only the configuration/implementation details necessary to assess these flows.

Use this integration table:

| Component/provider | Purpose and exchanged data | Implemented capability | Mock/live mode evidenced | Failure behaviour | Evidence and limitation |
|---|---|---|---|---|---|

**Suggested wording:**

> Iteration 3 extends the existing trip workflow with receiver-side acknowledgement and additional evidence checks. Receiver confirmation is linked to a handover token and browser session, while identity-verification outcomes are recorded with their assurance level. Location corroboration contributes additional observations to the evidence record. Missing or unavailable observations remain distinguishable from a confirmed match.

Add the exact artifact-hash coverage for departure/confirmation, not a claim that every field in every phase is anchored. Distinguish Parcel Perfect expected cargo from simulated observed warehouse scans. Explain that live end-to-end verification still requires deployment evidence. Briefly address access control, maintainability, scaling constraints and observed performance; do not claim benchmarks that have not run.

## 5. Risk assessment — 4 pages

**Source:** I2 §§5.1–5.4 (1228–1294), especially R-01–R-10. **REUSE:** risk IDs and useful category/scoring definitions. **REWRITE:** risk statements and controls affected by implemented changes; old scores are historical, not automatic current scores.

Specifically reassess location-source risk R-03, artifact-binding risk R-04, offline reliability R-05, off-chain/personal-data risk R-06 and anchoring availability R-07 against I3 evidence. Check whether guard-workflow risk R-08 remains relevant to the current scope rather than carrying it mechanically. Other unchanged risks may be precisely referenced, but fix their missing owner/monitoring/contingency information where required by feedback.

**ADD:** receiver verification/privacy/fallback, forwarded QR and remote participation, analytics interpretation/scale, and release/submission risks. Fill: ID; cause/event/consequence; likelihood/impact; owner; mitigation; monitoring trigger; management/contingency; residual status; test/evidence.

**SUPPLY:** actual owners, agreed scoring and operational thresholds. Do not invent them. Repair the old Appendix B risk-register reference: that appendix is UML material.

## 6. UI evidence — 5 pages

**Source:** I2 §6.1 Dispatcher Web Application (1298), §6.2 Driver PWA (1344). **REUSE:** unchanged screens only where essential to explain a new flow. **REPLACE:** the old screenshot gallery with selected current captures and short annotations.

Capture these groups: precinct/geofence setup; timeline and recorded location comparison; driver exception photograph and dispatcher review; receiver QR/consent/verification/signature; entity/fleet analytics. For each group state user task, important change, business value and one meaningful failure/empty/degraded state where applicable. Label proposed mock-ups separately from implemented UI.

**SUPPLY:** dated screenshots from the documented build/mode, with personal information removed. The current draft's relative images are missing locally. Do not insert broken links or describe an activation photo screen that does not exist in reviewed code.

## 7. Testing — 4 pages plus 6-page Appendix A

**Source:** I2 §§7.1.1–7.1.4 (1439–1495), §7.2 Risk-Categorised Test Cases (1496). **REUSE:** applicable explanations of test types, shortened. **REWRITE:** execution scope, environment and results for I3. Move sample cases into Appendix A as required; do not retain the old wide multi-page case table in the body.

**ADD:** selected tests from Plan D01–D09, tied to requirements and risks. Prioritise token expiry/replay/concurrency, receiver fallback, evidence modification detection, stale/missing GPS, review concurrency, organisation isolation, analytics correctness and validation. The plan lists the relevant source/test paths.

Body table: requirement/risk → test ID/type → build/mode → outcome → appendix/evidence reference. Appendix case: preconditions, synthetic input, steps, expected result, actual result, pass/fail, date/build/mode and evidence.

**SUPPLY:** test execution output and actual UAT/performance evidence. Where unavailable, write “not yet evidenced” or “not executed,” as appropriate. A test file's existence is not a pass. The I2 anchoring performance target remains unmeasured unless new results are supplied.

## 8. Development approach and Scrum — 8 pages

**Source:** I2 §§8.1.1–8.1.3 (1533–1556), §8.2.5–8.2.7 (1636–1674). **REUSE:** only current team mechanisms and the prior process commitments being assessed. **REPLACE:** §8.2's Sprint 3/4/5 evidence and all I2 progress statements with the actual I3 reporting-period evidence.

Write: current roles/virtual coordination; then, for each actual sprint, goal, committed backlog, dated board, burndown, completed/carry-over scope and retrospective; then velocity's effect on subsequent planning and an iteration reflection. Relate earlier ready-before-start/Jira-reconciliation commitments to what actually happened.

**ADD:** brief AI-use disclosure: tools, tasks assisted, human review and responsibility. **SUPPLY:** Jira exports, real sprint dates, estimates/scope changes, retrospectives and role assignments. Label an open sprint as open at the cutoff. Never reconstruct an ideal history or copy the old velocity as the new one.

## References, addendum and separate submissions

**References — 2 pages with glossary:** start from I2 §10 (1750), retaining only sources actually used and checked. Add new sources and the exact I2 submission reference. Expand acronyms on first use; do not import unsupported statistics simply to preserve citations.

**Addendum — 2 pages:** create a new change/feedback matrix from Feedback and Plan D01–D09: feedback/change ID → old section → new location → correction/delivery → evidence/status. Keep unresolved feedback visible. Do not paste the entire master plan.

**Appendix A — 6 pages:** executed sample tests described in §7. **Do not carry I2 Appendix A portfolios into this appendix.** Prepare the portfolio separately, updating roles and contributions for every member with real evidence. The old portfolio can supply its category structure, not current contribution claims.

**I2 Appendix B:** selectively reuse verified class detail in §3.2; do not copy the entire appendix by default. All internal appendices count toward 70 pages.

Prepare minutes/agendas, slides, code archive/deployed access guidance and peer evaluations as the prescribed separate deliverables. Confirm the portfolio slot announced by the lecturer. Keep Team05 naming consistent.

## Information to give Claude before calling a draft complete

1. Exact submitted I2 filename/version for cross-references, and current submission deadline/slots.
2. Actual I3 sprint dates, Jira exports, burndowns, retrospectives and team-role assignments.
3. Current deployment/build identity and observed mock/live integration modes.
4. Test/UAT/performance results with dates and environments.
5. Selected screenshots and diagrams, or permission to generate diagrams from verified source.
6. Partner evidence supporting context, business priorities and any quantitative claims.
7. Risk owners/scoring and member contribution evidence.

Claude can draft the supported prose immediately. Use `[EVIDENCE NEEDED: specific item]`, `[FIGURE NEEDED: content and purpose]` and `[VERIFY: specific claim/source]` for gaps. These are visible drafting markers, not text to leave in the final submission. Collect them in one checklist with their destination sections.

## Copy this prompt into Claude

```text
Create the actual Team05 iteration 3 documentation draft in Markdown.

Read CLAUDE.md and applicable repository instructions first. Read these files in full (including narrative tables; inspect relevant diagrams rather than treating base64 image data as prose):
- docs/Iteration_3_Documentation/Iteration3_Documentation_Plan.md
- docs/Iteration_3_Documentation/Iteration3_Claude_Drafting_Handoff.md
- docs/Iteration_3_Documentation/INF4027W_Team05_Iteration2_Document2026.md
- docs/Iteration_3_Documentation/Iteration3_Documentation_Working draft.md
- docs/Iteration_3_Documentation/FreightProof_Iteration3_Master_Plan.md
- The supplied iteration 3 guidelines, presentation instructions and marksheet in the same folder.

Apply the lecturer's 16 September clarification recorded in the plan: 70 pages includes all front matter and internal appendices; portfolio is separate; retain context/problems/objectives; include only changed/new use-case narratives and precisely reference unchanged ones; unchanged risks can be referenced except where feedback requires correction.

Create docs/Iteration_3_Documentation/Iteration3_Submission_Content_Draft.md as a new file. If it already exists, inspect it and preserve existing user work. Do not overwrite the source documents or either planning file. Write actual report prose, compact tables and explicit use-case flows, not another plan. Follow the section structure and 64-page allocation in the plan. Do not claim a rendered page count from Markdown.

Use the handoff's exact I2 source sections and reuse/rewrite/add instructions. Implement the plan's entire use-case mapping. Focus delivery reporting on changes since 12 August, using baseline 0e23afd and reviewed snapshot 40e0d38; inspect any later source changes before incorporating them. Distinguish earlier context, feedback corrections and newly implemented functionality.

Use the existing Graphify report and graph to navigate the code, then verify important claims in source. The supplied new documents were absent from the reviewed graph: read them directly. Do not rebuild shared Graphify output. Do not equate graph presence, a commit or test-file existence with passing tests or a deployed feature.

Separate implemented, tested and deployed status. Do not invent statistics, citations, sprint evidence, test outcomes, UAT, risk owners, measured benefits or contribution records. Insert specific EVIDENCE NEEDED, FIGURE NEEDED or VERIFY markers where information is missing and finish with a consolidated checklist of those gaps. Complete all supported sections rather than stopping at the first missing item.

Keep wording suitable for the assessed document. Put code-path provenance and drafting queries in clearly labelled editorial notes, not unexplained developer jargon in the report. Use stable requirement/use-case/figure references. Keep common rules in one place and reference them. Remove stale iteration 2 statuses, unsupported all-phase hashing/identity claims and broken image links.

Finally check requirement coverage, factual consistency, use-case references, figure assets and unresolved evidence markers. Report what is drafted and what evidence is still required. Make no application-code changes and perform no Git mutations.
```
