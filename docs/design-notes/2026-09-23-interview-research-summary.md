# Interview research: what could make FreightProof more useful?

Date: 23 September 2026  
Status: research summary and recommendations; not approved development scope.

## Start here

The clearest opportunity is to help people **collect, preserve and explain the evidence
needed when cargo goes missing, arrives damaged or is disputed**. That includes showing
what is missing and what people disagree about. It is not enough to show that a truck
reached its destination or that a database record has not changed.

The interviews describe real problems, but they do **not** prove that FreightProof solves
them, that every operator has them, or that customers will pay for blockchain. Several
participants already have effective scanning, tracking, delivery and investigation systems.

**Recommendation from the research:** position FreightProof around a usable evidence
workflow, then test whether independently verifiable records add value beyond that workflow.
Treat the shared-ledger direction as a hypothesis to test, not a conclusion the interviews
have already established.

This document preserves the important product implications without putting the transcripts
in the repository. It complements:

- [Research-informed iteration 4 recommendations](2026-09-22-research-informed-iteration4-recommendations.md): proposed changes and acceptance criteria.
- [Possible shared custody ledger pivot](2026-09-22-possible-shared-custody-ledger-pivot.md): a separate future direction and its delivery risks.
- [Iteration 4 plan](../iteration4_plan.md): the scheduling document.

## How to interpret this summary

**Finding** means a participant described an experience, practice or opinion.
**Recommendation from the research** means our proposed response to that finding.
**Technical proposal** means a possible design; participants did not specify or validate it.
Illustrative examples below are invented to explain the design, not additional interview cases.

Seven interviews are not seven equivalent votes: some were group discussions, participants
had different expertise, and their organisations used different processes. Some answers
followed explanations or leading prompts about blockchain. Interest after such a prompt is
weaker evidence than an independently described problem. Most participants had not evaluated
FreightProof itself. This is a qualitative product synthesis, not formal thesis coding,
a legal opinion, a market-size estimate or an audit of the current implementation.

### Sources and private traceability

These codes match the existing recommendations note. They are local reference codes, not
the thesis's official coding scheme. Broad source contexts are used instead of identities.

| Code | Source context | Main contribution and limitation |
|---|---|---|
| R1 | Freight operator | Fragmented records, commercial context, integration and common information needs. Already familiar with FreightProof, so less independent as validation. |
| R2 | Legal interview and written privacy specialist follow-up | Preservation, explaining reliability, supporting evidence and privacy design. Professional views on the discussed scenario, not certification of this product. |
| R3 | Logistics software provider | Existing capabilities, physical limits of scans, integration permissions and adoption costs. Describes its experience, not every provider. |
| R4 | Cargo insurance interview | Claims evidence, receipts before inspection, loss data and neutral governance. Some later speaker attribution was reconstructed; verify before quotation. |
| R5 | Digital-forensics interview | Established hashing, evidence handling, independent checking and scepticism about blockchain's additional value. Automated transcript contains errors. |
| R6 | Retail and transport group | Evidence collection, footage expiry, sealed loads, later inspection, access controls and differences between closed and open supply chains. |
| R7 | Retail logistics interview | Established investigation procedures, condition assessment, working integrations, administration and offline operation. |
| M1 | Interview question bank | Research framing, including the null case and marginal benefit. Questions are not participant findings. |
| M2 | Insurer participant briefing | Proposed shared-network concept. Not evidence that participants endorsed the design or the current implementation. |

Keep the originals and identification key in the researcher's controlled research storage.
Do not add names, organisations, personal paths, raw excerpts or identifying case details here.
This summary is sufficient for ordinary product discussion; formal thesis quotations and
contested interpretations still require checking the private source.

## 1. Evidence is scattered, even when it already exists

**Finding — R1, R2, R4, R6.** Investigations assemble records from transport systems,
warehouse systems, tracking providers, cameras, documents, statements and communications.
The work is often finding and connecting these records. The insurer described assessment
using several documents together, rather than one decisive document.

**Recommendation from the research:** give an authorised reviewer a clear trip and incident
timeline, linked to the relevant records. Preserve which system or person each item came
from. Use shared trip, consignment and handover references to connect records correctly.
Integrate with existing sources where permission and access are available.

An evidence package could include a manifest, loading and delivery records, seal checks,
tracking extracts, photographs, statements and relevant communications. The required set
depends on the incident and recipient; not every shipment needs every possible document.

**Boundary:** a new dashboard alone does not solve unavailable records or incorrect matching.
Integration can add value without blockchain.

## 2. Exceptions should preserve what went wrong and what happened afterwards

**Finding — R1, R6, R7.** Participants described theft, route disruption, delays, loading or
unloading problems, discrepancies and incidents that stop normal delivery. R7 distinguished
an incident during transport from a shortage claim raised by a receiving site. Investigation
may conclude that a discrepancy was an operational error rather than theft.

**Recommendation from the research:** treat an exception as an attributed record requiring
context and follow-up, not just a red alert. Keep the original report and later review.

**Technical proposal — minimum useful exception record:**

- The affected trip, stop, cargo and event category.
- Who reported it, what they observed and where the information came from.
- When it reportedly happened, when it was recorded and when it reached the server.
- Supporting evidence, unavailable evidence and any request to preserve external records.
- Its effect on the journey: continuation, interruption, cancellation or return, as reported.
- Review outcome, reviewer, time and explanation; unresolved disagreements remain visible.

Separate three questions: **Can the trip continue? Is the investigation complete? Has the
claim been resolved?** Completing one does not answer the others. Cancellation should not
erase the preceding journey or automatically settle responsibility.

**Boundary:** the research does not prescribe our exact exception categories, screens or
state machine. Recording a return-to-base decision does not authorise FreightProof to
dispatch vehicles, reroute drivers or coordinate an emergency response.

## 3. A receipt needs to say exactly what was checked

**Finding — R3, R4, R6.** A scan may be recorded without the parcel physically being loaded.
A driver may receive a sealed vehicle without witnessing loading. A receiver may sign before
checking contents. R6 described detailed inspection after the vehicle departed.

**Recommendation from the research:** distinguish custody of a sealed load, external
condition, quantity checked and contents inspected. Record inspection pending or limitations
where appropriate. Do not ask a driver to confirm facts they could not observe.

For example, “received four sealed pallets; contents not inspected” communicates more than
“delivery verified”. Identity checking and the meaning of an acknowledgement are separate:
an OTP does not prove that goods were counted, undamaged or accepted by an authorised person.

**Technical proposal:** keep the original handover and attach a later discrepancy report,
with its own author, time and evidence. Link corrections instead of silently replacing the
original. Validate the actual partner process and permissions before adding new reporting roles.

## 4. Physical truth and digital integrity are different

**Finding — R3, R4, R5, R7.** A digital record can be consistent while describing something
incorrectly. A scan is not conclusive loading evidence. A clean receipt may reflect an
unchecked delivery. Vehicle tracking follows a vehicle, not necessarily every item inside it.

**Recommendation from the research:** present the evidence and its limits. Compare relevant
scans, seal observations, photographs, tracking, stock counts and witness statements where
available. Preserve contradictions instead of selecting the most convenient account.

“This file matches the recorded fingerprint” must not become “this delivery definitely
happened as described”. Extra biometrics or signatures do not automatically fix this problem.

## 5. Missing evidence and preservation deserve explicit attention

**Finding — R2, R6.** Useful footage can disappear through routine overwriting before an
investigation starts. This is different from malicious deletion. Records can also be lost
through device damage, delayed reporting or procedures not being followed.

**Recommendation from the research:** identify evidence gaps early. Record what is needed,
who holds it, who requested it, the request date, known expiry and whether it was actually
received and preserved. Distinguish “not requested”, “requested”, “unavailable” and “preserved”.

A URL, request, screenshot or hash is not necessarily preservation of the original evidence.
Keep an authorised copy where permitted; otherwise accurately record its external custody
and access restrictions. Do not hardcode one camera-retention period from the interviews.

## 6. Evidence handling starts before a dispute

**Finding — R2, R5.** Reliable evidence depends on collection and handling, not only its final
presentation. R5 described hashing when evidence is acquired and checking copies against
that original fingerprint. Improper copying or missing handling records can undermine trust.
R2 stressed being able to explain collection, gaps and system behaviour.

**Recommendation from the research:** preserve original files, source information, collection
method and an audit trail of relevant handling. Explain transformations such as redaction or
format conversion and keep them distinguishable from originals. Collect routine operational
records under a defined purpose, rather than constructing an apparently contemporaneous
history after a dispute.

**Boundary:** hashing a file today protects comparison from today onward. It does not prove
that nobody changed it before collection. A routine application upload is not automatically
a forensic acquisition.

## 7. Blockchain has a narrower possible role than “proving the delivery”

**Finding — R3, R5, R7.** Audit trails, hashing and integrated records already exist. R5
questioned whether blockchain's implementation cost would be justified. R7 had not observed
the record-manipulation problem described in the interview within its integrations.
R4 wanted parties to work from the same agreed version. R6 wanted confidence in security
and manipulation controls, but those requirements do not establish a blockchain purchase need.

**Recommendation from the research:** assess blockchain against a specific trust problem:
can parties later check what was recorded without relying entirely on one organisation's
current database and its explanation? Compare this with existing audit trails, independently
held copies and signed records. Ask whether the additional benefit justifies total cost.

**Technical proposal — a potentially useful role:** retain an external fingerprint of a
defined record and give the relevant parties a reference to that commitment at the time.
Later, a separate verifier can check that the supplied record matches that commitment.
The reference must be retained independently before a dispute if it is meant to identify
the expected original, rather than whichever commitment an exporter supplies later.

For example, if one operator controls both the export and the receipt reference it contains,
a verifier can confirm that those two match. It cannot, from that alone, establish that the
reference is the original agreed one. An attacker cannot rewrite an existing external
commitment merely by editing the database, but could try to substitute a different record
and a new matching commitment. Independent receipts and linked versions address a different
problem from simple file comparison.

This mechanism can help reveal changes to committed records. It does not prove physical
truth, reveal every omitted event, replace missing files, establish liability or prevent theft.
These are analytical design limits, not claims that the interviews validated this implementation.

## 8. A shared ledger requires shared participation and rules

**Finding — R1, R3, R4, R5, R6.** Participation, standardisation, ownership, cost and access
matter. R4 wanted neutral ownership and fair contribution to shared loss information.
R3 was sceptical about competitors cooperating. R1 and R6 were more open, with conditions.
These perspectives should remain distinct.

M2 described a permissioned network with acknowledgement by both handover parties and
restricted access to underlying details. That concept is not the same as one application
posting hashes to an external ledger.

**Recommendation from the research:** before a shared-ledger pivot, agree what each party
contributes, what acknowledgement means, what each can see, how disputes and corrections
work, who operates the service and what happens when a participant leaves or loses access.

**Technical proposal:** trial one handover between willing organisations, with separately
attributed acknowledgements and independently retained receipts. A real organisational
signing arrangement needs authority and key-management decisions; an application login or
OTP should not be described as equivalent. A network run entirely by the same project team
does not demonstrate independent organisational governance.

This remains a future experiment. The interviews do not justify committing to an industry
network within a month; see the separate pivot note for scope and delivery risks.

## 9. Existing systems are the baseline, not a blank slate

**Finding — R3, R6, R7.** Participants described existing scanning, electronic delivery records,
tracking, audit trails and cross-system integrations. R6 distinguished a relatively controlled
outbound network from inbound deliveries involving many independent suppliers. R7 described
working integrations without observed mismatched seal records.

**Recommendation from the research:** find a specific gap in the partner's workflow and
reuse its existing systems. The stronger starting point may be evidence crossing an
organisational boundary, rather than replacing records inside a well-controlled operation.

R3 said access to customer data requires customer permission. API availability does not
itself grant permission or make integration effortless. Shared identifiers, field meanings,
timestamps, access and failed imports still need agreement.

## 10. Offline reliability and low effort are adoption requirements

**Finding — R6, R7.** Connectivity, availability and what happens to data while offline were
explicit concerns. R7 also highlighted reduced administration. R3 and R4 emphasised costs
and the effort required to change existing practice.

**Recommendation from the research:** make evidence capture dependable and avoid asking
people to enter the same information twice. Explain whether a record is saved locally,
uploaded or externally committed. Preserve data through temporary outages.

**Technical proposal:** use safe retry and duplicate prevention, and keep claimed event
time, server receipt time and external commitment time separate. A later network timestamp
must not be presented as the exact time a physical event occurred. A verification service
being unavailable should produce an unavailable/pending result, not an accusation of tampering.

## 11. Claims need context and human assessment

**Finding — R1, R4, R7.** Contracts, the insured party, policy terms, commercial relationships,
condition assessments and supporting records affect outcomes. R7 described a dispute over
the condition of goods that required a clearer assessment procedure, not a different ledger.
R4 described assessors assembling a picture from multiple sources.

**Recommendation from the research:** help a reviewer understand the incident and locate
relevant assessments and documents. Distinguish a reported loss, an investigator's conclusion
and a claim decision. Preserve who made each judgement and on what basis.

Do not automatically label a driver liable because an item was scanned onto a vehicle.
Do not claim a verified package guarantees payment, successful litigation or lower premiums.
The interviews support preparation for assessment, not replacing assessors, insurers or courts.

## 12. Privacy and controlled sharing are part of the product

**Finding — R2 follow-up, R3, R6, R7.** Participants described restricted access, customer
permission, security review and contractual approval before sharing. The supplied specialist
follow-up emphasised defined processing purposes, context-dependent roles and retention,
and the possibility that a hash remains linkable to a person.

**Recommendation from the research:** define who may see, export and retain each category
of evidence. Share only the relevant authorised material. Record disclosure and distinguish
routine retention from justified incident preservation. Design correction and deletion
handling alongside the evidence history, rather than promising permanent retention of everything.

Keeping personal information off-chain is an important design direction, but is not by itself
proof of compliance. Assess linkability, recipients and cross-border processing. The follow-up
also discussed provider classification under cybercrime legislation; do not infer a specific
reporting duty merely because FreightProof stores evidence.

These are implications of supplied professional views. Any implementation-specific legal
decision needs current advice. Participants' differing retention periods are reported practices,
not a single legal rule to copy into the product.

## 13. Analytics could help, but several different ideas were discussed

**Finding — R1.** Operational trends, service performance and historical context were useful.
**Finding — R4.** Wider loss data could help an insurer avoid relying only on its own experience.
This was interest in pooled insurance information, which is a different product from verifying
one shipment's custody records.

**Recommendation from the research:** start with explainable summaries of recorded incidents,
their review outcomes and missing evidence. Evaluate usefulness before adding broad analytics.

**Analytical caution:** frequent exceptions are not proof of collusion or misconduct. Account
for the number and type of trips, reporting differences and investigation outcomes. Label
allegations separately from confirmed findings. The interviews do not validate a fraud detector.

A future pooled-loss product would require permission, consistent definitions, adequate data,
fair contribution and agreed governance. Do not treat one participant's interest as proof that
insurers will share records or reduce premiums.

## 14. Adjacent ideas should remain separate opportunities

**Findings and exploratory opinions:** R2 discussed the potential usefulness of temperature
records for condition disputes. R3 mentioned an unpursued idea of releasing payment after
delivery conditions were met. R6 and R7 discussed possible batch traceability and recall
benefits, while highlighting implementation effort; R5 was uncertain about related applications.

**Recommendation from the research:** retain these ideas for future discovery. They are not
validated requirements for FreightProof's current scope. Cold-chain evidence needs trustworthy
measurement and interpretation; payment automation needs an agreed dispute process; product
passports need participation across a much longer chain. None follows automatically from
adding blockchain. The interviews do not establish regulatory requirements for these ideas.

## What should the team prioritise?

These priorities are **recommendations from the research**, not a new sprint commitment.
The linked iteration note contains detailed proposed acceptance criteria.

| Priority | Useful outcome | Research basis |
|---|---|---|
| First | Preserve captured evidence reliably, including offline records and originals, with appropriate access. | R2, R5, R6, R7 |
| First | Make exceptions, handover limitations and later discrepancies clear and attributable. | R3, R4, R6, R7 |
| First | Produce an understandable evidence package showing sources, gaps and outstanding preservation requests. | R1, R2, R4, R6 |
| Test next | Check whether the workflow saves effort or improves evidence completeness compared with existing practice. | R3, R4, R5, R7 |
| Separately scope | Test portable verification and independently held receipt references; decide which records actually need external commitments. | Technical proposals informed by R2, R4, R5 and M2 |
| Future discovery | Shared organisational custody ledger, pooled loss analytics, cold-chain evidence or product passports. | Different opportunities; participation and value remain unproven |

### Questions a small pilot should answer

1. Which real dispute is difficult today, and which evidence is missing or expensive to obtain?
2. Who captures each fact, and did they actually observe it?
3. Can someone assemble the required package faster, with fewer follow-up requests?
4. Does the workflow preserve evidence that would otherwise become unavailable?
5. How much extra effort does it impose on drivers, receivers and reviewers?
6. Can the intended reviewer interpret the package and distinguish facts, statements and gaps?
7. Does independent verification answer a concern that existing controls do not address?
8. Will both sides retain receipts and participate, and who would pay for the total service?

Measure the ordinary workflow, the improved evidence workflow and, if feasible, the same
workflow with independent verification. This separates integration benefits from blockchain
benefits. Include a later shortage report, unavailable footage and an offline handover in the
evaluation. These are proposed test scenarios, not claimed pilot results.

## Private source checkpoints for reviewing the interpretation

Use these topic locators with the researcher's private originals. Times follow the supplied
transcripts and may need checking against recordings. Untimed sources use topic headings.

| Source | Useful checkpoints |
|---|---|
| R1 | 6:59–15:12: records, claims context and fragmentation; 17:52–21:45: common information and participation; 23:36–28:48: retention, security and cost. |
| R2 | 6:54–14:34: evidential weight, preservation and system reliability; 18:21–21:44: automation and condition records; written follow-up questions 1–6: privacy, retention, hashes, cross-border processing and provider classification. |
| R3 | 6:08–16:25: scans, integrations and audit trails; 23:57–26:18: scan versus physical loading; 27:10–42:13: access, pilot conditions, governance, retention and costs. |
| R4 | Claims document requirements; clean receipts before inspection; tracking data; shared loss information; ownership and contribution; same-version records; adoption cost. Check reconstructed attribution before direct quotation. |
| R5 | Forensic readiness; hashing at acquisition; handling failures; routine collection; physical cargo versus records; integration before blockchain; standardisation and return on investment. |
| R6 | 13:51–27:33: evidence, access, sealed loads, footage loss and later inspection; 34:38–38:31: closed outbound versus open inbound networks; 41:59–47:31: governance, cost, connectivity and participation. |
| R7 | 8:20–17:20: incident procedures and condition assessment; 17:58–24:16: tracking and working integrations; 26:46–31:08: trust, efficiency and offline operation. |

The most defensible product claim at this stage is: **FreightProof aims to make cargo-dispute
evidence easier to preserve, assemble and check.** Whether the system achieves that, and
whether blockchain adds enough extra value, must be demonstrated with the intended users.
