# Research-informed recommendations for iteration 4

Date: 22 September 2026

Status: recommendations for team discussion, not approved sprint scope. Read alongside
[the iteration 4 plan](../iteration4_plan.md). That plan remains the scheduling document;
this note records the evidence, reasoning and proposed acceptance criteria behind changes.
No implementation or architecture change is authorised by this note alone.

## Purpose and proposed outcome

The thesis interviews support improving the collection, preservation and assembly of cargo
evidence. They do not establish widespread demand for blockchain, willingness to pay, reduced
premiums or guaranteed claims outcomes.

**Recommendation from the research:** prioritise a complete, usable dispute-evidence workflow
over additional tracking or analytics features. Test it against the records and procedures an
operator already uses.

Proposed iteration outcome:

> An operator can complete or terminate a trip, preserve appropriately attributed handover and
> incident records, and give an authorised third party an evidence package. The package identifies
> missing evidence and disputed statements, and allows independent checking of the integrity of
> the records that have an external commitment.

The independent-verification mechanism is a **technical proposal informed by the research**,
not an explicit participant request or an already validated commercial requirement.

## How to read the recommendations

- **Research finding:** a participant's reported experience or opinion. It is not automatically
  a general industry fact, verified legal conclusion or requirement for our partner's workflow.
- **Recommendation from the research:** a product recommendation inferred from those findings.
  Each recommendation below identifies the supporting source codes.
- **Technical proposal informed by the research:** an implementation option suggested during
  analysis. Participants did not specify or validate this design.
- **Existing plan or code finding:** something observed in project documents or selected source
  files. The 18 September plan's status inventory needs refreshing before sprint sizing.

Source codes below are local to this note, not the thesis's official coding scheme. There are seven
interviews, some with multiple participants; they are not seven equivalent independent votes.
The detailed analysis and identification key remain with the researcher. Do not add raw
transcripts, personal paths, participant names, company attribution or identifying case details
to this public repository.

## Research evidence register

| Code | Source context | Relevant evidence and limitations |
|---|---|---|
| R1 | Freight operator interview | Fragmentation and integration matter; settlements can also depend on contracts and commercial relationships. Existing familiarity with FreightProof limits independence as market validation. |
| R2 | Legal practitioner interview, plus written specialist follow-up | Missing records and delayed preservation can obstruct investigations. Reliability and evidential weight require more than presenting a ledger. The privacy follow-up qualifies assumptions about off-chain storage and linkable hashes. These are supplied professional views, not a comprehensive legal opinion on FreightProof. |
| R3 | Logistics systems provider interview | Existing products already capture scans, delivery information and audit trails. A scan does not conclusively establish physical loading. Another record layer needs additional value. |
| R4 | Cargo insurance practitioner interview | Uninspected goods can receive clean receipts. Claims depend on multiple records and assessment. Interest in pooled loss statistics concerns a separate data-sharing opportunity. Some speaker attribution in this transcript was reconstructed and needs checking before direct quotation. |
| R5 | Digital-forensics practitioner interview | Established hashing and evidence-handling methods already address integrity. Integration and implementation costs matter. This does not prove that external anchoring has no value. |
| R6 | Retail and transport group interview | Records are spread across systems; delayed investigation can lose footage. Receipt can precede detailed inspection. A driver may receive a sealed vehicle without witnessing loading. These practices must be checked against our partner's workflow. |
| R7 | Retail logistics interview | Existing integrated processes can work well. A condition dispute needed an assessment procedure; reduced administration and reliable offline operation were relevant adoption considerations. |
| M1 | Interview question bank | Explicitly tests the null case, marginal benefit, input reliability and governance. Designed for feasibility research, not a product purchase decision. |
| M2 | Insurer participant briefing | Describes a permissioned network, restricted handover visibility, off-chain operational records and acknowledgement by both parties. It is not a specification of FreightProof's current Hedera implementation. |

M1 softens the earlier criticism that the research design sought only positive blockchain
responses. Actual interview wording still matters: a participant's agreement following a
technology explanation is weaker validation than an independently described operational case.
Do not retroactively assume every participant received or understood every part of M1/M2.

## Proposed changes to the iteration 4 plan

| ID | Basis | Proposed adjustment | Plan location |
|---|---|---|---|
| P1 | **Recommendation from the research — R2, R5, R6, R7** | Keep access control, receiver-bypass prevention and offline evidence retention ahead of new features. Existing Track A work directly supports evidence reliability. | Track A |
| P2 | **Recommendation from the research — R3, R4, R6** | Decide what each party acknowledges, separately from how identity is checked. Distinguish sealed custody, external condition, counted contents, inspection pending and later discrepancy. Do not imply a driver witnessed loading where they did not. | §5.1; receiver work |
| P3 | **Recommendation from the research — R2, R4, R6** | Add a missing-evidence section and an attributed preservation note identifying external evidence, its holder, request date and known expiry. Use a minimal extension of evidence handling, not a new case-management system. A link or hash is not preservation of the original. | §5.3; incident pack |
| P4 | **Recommendation from the research — R4, R6, R7** | Keep the collision/cancellation demo and add a small disputed-handover scenario. Preserve later inspection reports without overwriting the original receipt. | §5.3; final demo |
| P5a | **Technical proposal informed by R2, R4, R5 and M2** | Export existing committed payloads, authorised artefacts and receipt references with a standalone integrity verifier. This checks the supplied package against the supplied commitment. | Incident package |
| P5b | **Technical proposal informed by R2, R4, R5 and M2** | Separately scope independently retained counterparty receipts and linked versions, so the expected commitment is identifiable without relying solely on a later export. | Separate decision and estimate |
| P6 | **Technical proposal informed by R2, R5, R6** | Prioritise a bounded direct-anchoring design for critical incident records and their file hashes, cancellation and handover acknowledgement. Confirm coverage and failure handling before implementation. General Merkle batching can be deferred. | Track C coverage decision |
| P7 | **Recommendation from the research — R1, R3, R7** | Measure evidence preparation time, missing records, follow-up requests and capture burden against existing practice. Test willingness to continue using the workflow. Do not invent impact figures. | §10; pilot validation |
| P8 | **Analytical recommendation** | Describe recurrence as a pattern of recorded exceptions, with trip exposure and review outcomes. Recurrence does not establish collusion. The interviews do not validate a collusion detector. | Track B analytics; §3.5 |

P2 does not by itself require receiver accounts, new biometrics, or changes to the phase sequence.
Use the existing role constraints and validate the partner's actual procedure first. An OTP-backed
acknowledgement is not automatically an independently controlled organisational digital signature.

## Scope and capacity recommendation

**Planning judgement informed by the research:** protect a complete evidence workflow across
Tracks A/B/C. Keep the basic multi-trip view, necessary alerting and a bounded movement demo.
Retain the proposed route playback if its remaining effort is small and the team confirms its
assessment value. Recurrence analytics is optional pending a full estimate including exposure,
review outcomes, drill-down and tests; it is not just a query.

Defer optional polygons and the fleet map before cutting the evidence package. Do not count
optional Stage 3 or polygon points as savings from the committed baseline unless they were
actually included. Reserve submission capacity first.

Proposed Track C disposition:

| Work | Recommendation | Reason |
|---|---|---|
| FP-167 phase-service split | Retain where needed for the accepted changes | Coordinates edits and reduces implementation risk; confirm current status. |
| FP-149 parcel traceability | Retain the bounded carried scope | Supports following the disputed consignment through existing records. |
| Vehicle clash and impossible duration | Retain the required correctness fixes | Prevent inconsistent trip setup. |
| P5a portable verifier | Size as a separate bounded deliverable | Makes existing external commitments inspectable outside the application. |
| P6 selected direct anchors | Design and size ahead of general Merkle work | Protects the incident evidence used in the demonstration. |
| Ledger Stages 1, 2 and 4 | Conditional on an accepted feature dependency | A PDF can use existing source records; do not build a table merely to claim it exists. |
| Ledger Stage 3 | Defer unless a demonstrated coverage or volume need justifies it | Departure/confirmation child roots do not protect the selected incident by themselves. |
| P5b and post-delivery reporting | Separate scope and estimate | Do not hide these inside the export-verifier estimate. |
| Polygons and optional fleet map | Defer first | Lower priority than completing the evidence workflow. |

The review's 3–5 points for a verifier and roughly 10 points including direct anchoring are
unvalidated suggestions, not adopted estimates. Size P5a, P5b and P6 separately. Include export
authorisation, payload compatibility, verification, failure handling and tests in the estimate.

## Blockchain purpose and boundaries

**Current trust limitation:** the inspected verification path obtains its expected receipt from
FreightProof's own database. It checks consistency with that selected external commitment; it
cannot alone establish that the selected commitment is the original one expected by a counterparty.
This distinction should be explicit in the final demonstration and claims register.

Changing a database record and its stored hash does not by itself defeat the external check. An
attacker also needs a matching external commitment and a way to substitute its reference. They
cannot rewrite the original network message or its consensus time by editing the database.
A standalone verifier given a replacement record and matching replacement receipt can also pass.
Therefore P5a improves portability but does not by itself solve expected-receipt substitution.

Proposed problem to test:

> A counterparty needs to check that supplied evidence is the version committed earlier, without
> relying solely on FreightProof or the operator's current database.

The research motivates testing this problem. It does not quantify its frequency, economic
impact or superiority over signed records retained by both parties or independent timestamping.

**Existing code finding:** [verification_service.py](../../backend/app/orchestration/verification_service.py)
reconstructs supported records, checks relevant evidence bytes and compares commitments through
[hedera.py](../../backend/app/blockchain/hedera.py). The receipt model stores `payload_json`,
which is a starting point for export. Exact serialisation must follow the original hash contract;
arbitrary JSON formatting will not reproduce the digest.

**P5a technical proposal informed by the research:** start with an authorised package containing
`payload_json`, `data_hash`, network, topic, sequence reference and relevant artefact files. Include
payload-version information and a simple Python verifier, with compatibility fixtures for exported
record types. Validate expected network/topic, file content hashes, malformed or missing data and
service outages. Keep personal information private and export only to authorised recipients.

**P5b technical proposal informed by the research:** separately scope a durable receipt retained
by an authorised counterparty before a dispute. Bind acknowledgements to an exact record version
and define later versions and correction references. The retained reference helps identify the
expected commitment; this is a different capability from checking an arbitrary supplied package.
A full counterparty distribution workflow remains a separate team decision. The demonstration
can show prior manual receipt retention without claiming automated distribution is implemented.

The verifier should require neither FreightProof database access nor signing credentials. Network,
topic, expected commitment and record-version checks must be explicit. Querying a mirror service
still has an external availability and trust dependency; do not present this as trust-free.

Successful verification means the supplied version matches a particular external commitment.
It does not prove physical loading, truth of a statement, completeness of all real-world events,
receiver authority, liability, or that an omitted event never happened. Network consensus is not
business agreement between carrier and receiver.

Distinguish claimed occurrence time, server receipt time and consensus time. Late/offline anchoring
must not be portrayed as proof that the record was committed at its earlier claimed capture time.
An unavailable verification service is not evidence of tampering.

## Anchoring coverage and ledger decisions

The [detailed Stage 3 design](2026-09-02-step-event-ledger-implementation-plan.md) explicitly covers
children of departure and confirmation, preserving the existing anchor count. It does not anchor
loading, in-transit or unloading merely by adding a Merkle root. Resolve the broader wording in the
iteration plan before claiming the coverage limitation is closed.

**Bad-day coverage gap:** in the inspected code, exception creation and cancellation do not
anchor their records. Creation/departure receipts in an incident PDF therefore do not protect the
later collision exception, its photographs or cancellation. Label this explicitly until addressed.

**P6 technical proposal informed by the research:** design direct commitments for the selected
critical exception and its file hashes, cancellation and handover acknowledgement before general
child-root batching. This need not depend on a `phase_steps` table or ledger Stages 1–3. It still
requires versioned payloads, receipt subject handling, tenant visibility, export/verifier support,
retry/idempotency behaviour and tests. The proposed `record_and_anchor()` fleet-audit helper is
not already implemented and must not dictate an inappropriate failure model: a network outage
must not roll back or lose critical incident evidence. Preserve it durably with visible anchor debt.

For the selected demo/pilot, agree a coverage matrix: record type, source, capture time, commitment
trigger, maximum target delay, offline/retry behaviour and export inclusion. This is a proposed
design decision, not an instruction to anchor every field or rewrite historical receipts.

Batching is an option for reducing transaction count, not the business benefit. It needs defined
batch boundaries, ordered membership and inclusion proofs, and leaves a pre-commitment interval.
Do not rely solely on final trip confirmation to protect evidence from a terminated trip.
Preserve existing payload-version verification; select a new version if commitment contents change.

Retain D-8's honest treatment of derived rows: unknown occurrence times stay unknown and derived
events remain distinguishable from captured observations. A new step table is an implementation
choice, not an inherent prerequisite for exporting existing evidence. Do not create one solely
to claim that a ledger exists.

## Minimal preservation and later reporting

**Recommendation from the research — R2/R4/R6:** include missing expected uploads and explicitly
noted external evidence in the pack. External CCTV may not be an expected phase upload. Start
with attributed, timestamped notes about its holder, request and known expiry. This is evidence
preservation, not vehicle response or recovery dispatch. A separate request entity and workflow
are not proposed as iteration 4 requirements.

**Recommendation from the research — R4/R6/R7:** keep receipt and later inspection distinct.
Before sizing a new reporting model, inspect the existing post-completion paths: exception review
already supports closed/cancelled trips, and the inspected exception-creation service has no blanket
terminal-state rejection. That does not establish a receiver reporting capability. Define its actor,
permissions, record linkage and retention before choosing reuse or a model change. P4's scenario
can initially be a documented walkthrough; only present it as a live feature when implemented.

## Proposed acceptance checks

These are future acceptance criteria, not tests run or capabilities claimed by this note.

1. Normal receipt and later inspection are separate statements linked to the same handover.
2. A driver receiving a sealed vehicle is not represented as confirming its unseen contents.
3. A completed or cancelled trip produces a readable evidence summary and the authorised data
   needed to check its committed records. Missing material is explicit.
4. An external verifier accepts the original package; altered committed data or files fail;
   removed required files report incompleteness. Uncommitted evidence is labelled separately.
5. For P5b, demonstrate a retained expected reference rejecting a substituted receipt. For P4,
   separately validate linked later reports if implemented. P5a alone must not claim either property.
6. With FreightProof's backend unavailable, exported evidence can still be checked against the
   external commitment when the relevant network service is available. Outages report unavailable.
7. Offline capture preserves the different timestamps and reports pending anchoring accurately.
8. A critical incident ending before delivery has the explicitly agreed commitment coverage.
9. Export access and contents are scoped to the authorised recipient. A verifiable package must
   not expose another customer's records. Retention and preservation authority remain separate
   requirements; this note does not certify privacy compliance.
10. An operator and, if available, a loss adjuster compare the result with their existing process.
    Record time, follow-up requests, unanswered questions, capture effort and perceived value of
    independent verification separately from the value of evidence assembly.

## Decisions for the team

All remain pending:

- Adopt or revise P1–P8, with P5a/P5b separately owned and estimated.
- Select the bounded handover/incident scenarios and exact acknowledgement meanings.
- Choose the commitment coverage and timing policy, including aborted trips and later reports.
- Decide whether independent package verification is a must-have or an explicitly labelled
  experiment; agree which optional items fund its capacity.
- Confirm what an authorised counterparty receives and retains, and how the expected receipt
  is identified independently of a later package supplied by FreightProof.
- Validate partner workflow assumptions and seek an evidence-consumer review.

If evidence assembly is useful but independent anchoring adds no meaningful benefit over the
comparison process, record that result honestly. Do not force a consortium, smart contracts or
automated payouts into scope to manufacture a blockchain use case. Stack changes require the
normal team agreement; this note neither removes Hedera nor approves a replacement.

## Claims for the final presentation

| Claim | Boundary |
|---|---|
| External anchoring is used | Supported for the currently covered records; identify them. |
| FreightProof checks records against Hedera | Supported by the inspected verification path; the receipt is selected from its database. |
| A recipient can verify a package without FreightProof | Claim only after P5a is implemented and demonstrated. |
| The package identifies the original expected commitment independently | Requires a retained reference or another agreed independent basis; P5a alone is insufficient. |
| The incident and all supporting files are anchored | Claim only for the P6 coverage actually implemented and checked. |
| Later inspection can be reported after trip completion | Claim only for the actor-specific path actually implemented. |

These are claim boundaries, not an assertion that the team previously made every statement.
