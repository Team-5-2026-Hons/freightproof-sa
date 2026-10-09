# A possible shared custody ledger for FreightProof

Date: 22 September 2026

**Status: possible future pivot for evaluation, not approved iteration 4 scope.**

Read alongside the [iteration 4 plan](../iteration4_plan.md) and the [research-informed recommendations](2026-09-22-research-informed-iteration4-recommendations.md). This note records the separate future direction without changing either document.

## A possible future direction

FreightProof could evolve into a shared record of cargo custody: a history that different organisations contribute to, acknowledge and keep, with checks that make later changes detectable.

This may add more value than holding evidence inside one application, particularly when a dispute involves organisations with competing interests. That extra value is a hypothesis, not a finding already established by the research.

### What we are recording here

This is a possible future pivot, not an approved change to iteration 4. The concern is that a dependable system shared by real organisations may be too difficult to build and deliver within the remaining month. Keep the current delivery commitments while testing whether this direction deserves further work.

### The problem it would try to solve

When goods are missing or damaged, the carrier, depot and receiver may each hold a different part of the story. Records can be incomplete, inconsistent or hard to retrieve. FreightProof could help these parties preserve an agreed handover record and clearly identify any disagreement.

**Recommendation from the research:** Focus on the collection, preservation and assembly of useful evidence. The legal, cargo insurance, systems-provider and retail interviews support this direction. They do not prove that a blockchain network is necessary or that organisations will pay for it.

### How this differs from the current direction

The current direction centres on FreightProof capturing evidence about a journey and checking selected records against external fingerprints. The possible pivot centres on independent organisations contributing to and retaining the same custody history.

Giving several companies logins to one database would create a shared application. Stronger independence requires each party to control its authority to acknowledge records and to retain evidence without depending entirely on FreightProof.

### Connection to the thesis

The insurer briefing describes invited organisations operating nodes, both sides acknowledging handovers and operational details remaining private. A node is a computer or service that maintains and checks the shared record. That concept is broader than a downloadable report or a standalone checking tool.

## What the shared record would do

### An example delivery

A carrier delivers a sealed load. It proposes a handover record identifying the shipment, seal and observed condition. The receiving warehouse sees that exact version and responds: “Delivery received; seal intact; contents not inspected.” Each organisation authorises its own statement.

Both parties keep the record and a reference to its externally recorded fingerprint. If the warehouse later discovers damage, it adds a linked inspection report. The original receipt remains visible and unchanged.

**Recommendation from the research:** Distinguish receiving custody from inspecting contents. A driver who collects a sealed vehicle must not appear to confirm goods they never saw. Support: systems-provider, cargo insurance and retail interviews.

### Disagreement must remain visible

If the warehouse disputes the seal number, its objection should be recorded. If it does not respond, the carrier’s report can remain an attributed, unanswered statement. It must not become a jointly agreed handover. Requiring agreement before recording anything could hide precisely the disputes the system should preserve.

### What tamper evident means

A hash is a digital fingerprint calculated from a record or file. Recording that fingerprint externally is called anchoring. Later, a checking tool can identify whether a supplied version matches the recorded fingerprint.

This does not prove that the original statement was true, the photograph showed the correct goods or the signer physically inspected them. The system records statements and evidence; it does not decide who caused damage or whether an insurance claim should be paid.

### Why both parties need a retained reference

A changed record supplied with a matching new receipt might pass a basic fingerprint check. Keeping the expected receipt reference before a dispute helps identify the version that should be checked. Later corrections must refer back to the original rather than silently replace it.

**Technical proposal informed by the research:** Bind each acknowledgement to an exact version, let each organisation control its signing authority and give relevant parties independently retained records and receipt references. These are proposed design choices, not mechanisms validated by participants.

## What would need to change

### Reuse the useful parts of FreightProof

Retain suitable evidence-capture screens, file handling, trip context, incident reporting, offline capture and hashing code. Verify their suitability before reuse. Do not rebuild the whole application simply to explore a different trust model.

### Design a separate shared custody component

- Follow a shipment across organisations and trips, rather than treating one carrier’s trip as the whole custody history.

- Allow authorised parties to propose, acknowledge or dispute exact record versions. Keep corrections as linked additions.

- Give each organisation control of its signing authority. Plan for staff leaving, lost access and compromised signing credentials. A drawn signature or phone passcode is not automatically independent organisational signing.

- Distribute permitted records and receipts so parties can retain and check them without relying solely on FreightProof’s database.

- Restrict each organisation to the information it should see. Define controlled disclosure for an investigator or insurer.

- Preserve original files, record missing evidence and handle offline capture and network failures without losing records.

### Choose the network after defining the workflow

**Option one — extend the Hedera approach:** Organisations operate services that retain and check permitted records; Hedera supplies the external ordering and timestamps. This reuses more of the current approach. The participants would not themselves operate the underlying Hedera consensus network.

**Option two — a permissioned consortium ledger:** Invited organisations operate the ledger infrastructure and agree membership and validation rules. This is closer to the briefing’s network model, but brings more setup, maintenance and coordination. Hyperledger Fabric is one possible technology to investigate, not an adopted choice.

### Agree who runs it

The parties need rules for joining, removing access, changing software and validation rules, paying operating costs and retaining evidence when a participant leaves. Multiple nodes controlled by one project team can demonstrate software behaviour; they do not prove independent governance.

## What is realistic within a month

Planning judgement: do not promise a dependable multi-organisation ledger within the remaining month. The work includes identity, signing, permissions, record distribution, recovery, testing and partner coordination. This is a scope assessment, not a team estimate.

### A small experiment may be possible

If the team can protect the current submission work, explore one carrier-to-receiver handover using synthetic data. Use separate signing credentials and separately retained copies to represent the two parties. Demonstrate an agreed record, a disagreement, a later correction and verification of an altered file.

Clearly label simulated organisations. A test where the team controls every component demonstrates technical behaviour, not real-world adoption or independent organisational control. Do not turn the experiment into a second full product.

### An illustrative four week sequence

**Week one:** Confirm one real handover procedure with a carrier and receiver. Ask an evidence reviewer what the resulting record would need to show. Agree the smallest test and the time the team can spare.

**Week two:** Prototype that single handover, its two acknowledgements and independently retained references. Reuse the existing evidence capture where practical.

**Week three:** Test disagreement, corrections, missing files and network failure. Check which parts still rely on FreightProof. Keep incomplete capabilities explicitly labelled.

**Week four:** Compare with the same signed records retained by both parties without a distributed ledger. Record results and decide whether to pursue the pivot after submission.

This sequence is an experiment outline, not a delivery commitment. If partner access or implementation takes longer, reduce the test to a walkthrough and evaluation rather than expanding the deadline or weakening the current submission.

### What would justify continuing

**Recommendation from the research:** Measure preparation time, missing evidence, follow-up requests and capture effort against existing practice. Then assess the additional value of independent checking separately. Support: operator, systems-provider and retail logistics interviews.

Continue only if the workflow helps, both sides are willing to participate and shared control adds value beyond simpler signed records. The thesis can still make a useful contribution by explaining why the network would be difficult or when it would add little.

## Decisions to revisit after the experiment

### The recommendation recorded today

Treat the shared custody ledger as a possible future product direction. Reuse FreightProof as the evidence-capture foundation, design the shared-record component separately and test it before committing to a full pivot. Preserve the current one-month delivery scope.

### Questions the team needs to answer

- Is the aim a thesis prototype, a later product pivot or an immediate delivery requirement? These need different levels of reliability and validation.

- Which carrier and receiving organisation would participate in a real trial, and who would review the evidence?

- What exactly does each party acknowledge, and how should disputed or unanswered handovers appear?

- Must participating organisations operate ledger nodes, or would independently retained signed records with Hedera anchoring answer the research question?

- Who controls signing credentials, access, rule changes, recovery and ongoing costs?

- What measurable improvement would justify the additional work compared with simpler recordkeeping?

### Reasons to pause or reject the pivot

Pause if the project cannot secure participation from both sides of a handover, if duplicate data entry creates too much burden, or if the independent ledger adds little beyond a clear evidence package. A technically working demonstration is not enough to settle those questions.

### Sources and how to interpret them

Research basis: the seven supplied thesis interviews, interview question bank and insurer participant briefing. The interviews describe professional perspectives, not a representative market survey. The briefing defines a proposed system; it is not evidence that this system has been validated.

Technical context: the FreightProof planning and research notes discussed on 22 September 2026. Earlier implementation findings need refreshing before any build estimate. This document does not change those notes or approve a change to the project stack.

Architecture references for future investigation: Hedera, “The Hedera Consensus Service: Beyond Smart Contracts” (hedera.com/blog/a-better-approach-to-distributed-applications/); Hyperledger Fabric documentation, “Endorsement policies” and “Private data” (hyperledger-fabric.readthedocs.io). Network validation and human agreement are different requirements.

### Technical references

- [Hedera application network architecture](https://hedera.com/blog/a-better-approach-to-distributed-applications/)
- [Hyperledger Fabric endorsement policies](https://hyperledger-fabric.readthedocs.io/en/latest/endorsement-policies.html)
- [Hyperledger Fabric private data](https://hyperledger-fabric.readthedocs.io/en/latest/private-data/private-data.html)
