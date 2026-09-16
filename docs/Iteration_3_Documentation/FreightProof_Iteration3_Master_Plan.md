# FreightProof SA — Iteration 3 Master Remediation Plan

**Team 05 | INF4027W 2026 | Prepared from: Iteration 1 document (ES comments), Iteration 1 marksheet, Iteration 2 document (AC comments), Iteration 2 marksheet, Meeting Minutes Set 1 + Therona Moodley feedback**

---

## 0. Where you actually stand

| | Iteration 1 (ES) | Iteration 2 (AC) |
|---|---|---|
| Total | 22 / 30 (73.3%) | 29 / 40 (72.5%) |
| Background / Problem / Objectives | 3.5 / 5 (70%) | 3.5 / 5 (70%) |
| UML (+ DB in It2) | 7 / 10 (70%) | 8 / 10 (80%) |
| Risks | *combined with testing* 4 / 5 (80%) | 3 / 5 (**60%**) |
| Testing | *combined above* | 3.5 / 5 (70%) |
| UI Mock-ups | 4 / 5 (80%) | 4 / 5 (80%) |
| Scrum | 3.5 / 5 (70%) | 7 / 10 (**70%, −3 marks**) |

Two things matter here.

**The percentage did not move.** 73.3% → 72.5%. The UML score improved, everything else held or dropped. Whatever you did between iterations was net neutral, and that is the thing to fix structurally, not by patching individual comments.

**Where the marks actually are.** Weighted by points lost, the order is: Scrum (−3), UML/DB (−2), Risks (−2), Background/Objectives (−1.5), Testing (−1.5), UI (−1). But by *proportion* lost, Risks is worst at 40%, then Scrum at 30%. Risks is a 5-point section where you scored 60% for a reason that takes about four hours to fix. Scrum is a 10-point section where the fix is mostly evidence discipline, not writing.

Iteration 3 is also the iteration where "it's early days" stops working as an excuse. Ammar already flagged this explicitly: *"Need to do better Jira wise considering it is iteration 2 now."*

---

# PART A — Feedback Ledger

## A.1 Elsje's Iteration 1 feedback: what you actually did with it

This is the section you asked for. Elsje's comments are grouped by whether Iteration 2 resolved them. **Anything in the "Not fixed" or "Partially fixed" columns is a repeat offence, and repeat offences cost more than first offences.**

### ✅ Properly resolved in Iteration 2

| ES comment | What she said | What you did |
|---|---|---|
| c22 | "Good problems identified" | Business problems retained and expanded to six. No action needed. |
| c27 | The things you call Business Objectives are really Project Objectives. What would LFG's own organisational objectives be? | You split into 1.3.1 Business (LFG-level), 1.3.2 Project, 1.3.3 System. Structurally correct. **But see Clash 1 — Ammar says the new business objectives still aren't organisational enough.** |
| c30 (partial) | "Why 50 metres? ... It is important for the ignorant reader to understand what these tools do" | Explanations of Pulsit / Parcel Perfect / IDVS now inline in 1.3.3. Good. **But see Clash 5 on the numeric values.** |
| c187 | "No features? A user story map would help to see this in one glance" | Figure 1: User Story Map added in §2.1, plus the Table 57 backlog slice by user journey. Done. |
| c191 | Present everything from Sprint 1 before moving to Sprint 2 | §8.2.2–8.2.4 now do exactly this: each sprint gets summary table, narrative, burndown together. Done. |
| c205 | "Great to show the average velocity" | Retained, and now with honest caveats about Sprint 5's baseline. Improved. |
| c224 | "This part should have been submitted separately" (minutes) | Minutes removed from the main document. Done — **but this created a new problem, see D.1.** |
| c62 | Paste as Text Only to avoid stray degree symbols | Zero `°` artefacts remain in the Iteration 2 document. Verified. Done. |

### ⚠️ Partially fixed — still exposed

| ES comment | What she said | Current state in It2 | What's still owed |
|---|---|---|---|
| **c51** | "Although the packages make sense now, the dependencies of these packages are of cardinal importance and you compromised on this. Just having one dependency arrow from the business layer to the external packages cannot be good." | §3.1 narrative is now entirely about labelled dependencies drawn from their real callers. You did what she asked, thoroughly. | Ammar then rejected the entire diagram type. **This is Clash 2 and it is the single biggest decision in this plan.** |
| **c63** | Verified-driver-at-gate looks like three separate EBPs when it's one. Should GPS cross-referencing link to an external system? Would the warehouse and receiver be secondary actors? | Receiver now appears as an actor in the CC diagram. Use cases were re-cut into CC 1.1–1.9. | Warehouse still not modelled as a secondary actor anywhere despite §7.1.2 describing "warehouse closes its scan session". GPS/external-system linkage still unclear on the diagram. Fish-level vs sea-level distinction not made explicit. |
| **c103** | "Re-look at the use case narrative tables... the purpose is to pass them to developers for deep insights and coding" | Narratives are much tighter: Field/Detail header table, then a/b sub-tables for main and exception flows. Genuine improvement, and this is probably why UML went 7→8. | The sheer count (Tables 3–51, forty-nine tables for nine use cases) recreates the density problem she complained about elsewhere. |
| **c106** | "The class diagram looks good... I am just wondering about those 0..1 multiplicities. They warrant a bit of brainstorming. If so then good, but we must double check" | Class diagram reworked, Person superclass removed, HandshakeEvent → PhaseEvent. | **No evidence the 0..1 multiplicities were ever revisited.** Worse: Appendix B.1, which was created to hold the detailed class information, contains an empty three-column table with no rows. She will open that appendix. |
| **c113 / c118** | "Actived" spelling. Where there are two lines from a node state there should be a decision symbol. | Trip state machine rewritten around phases. | The Consignment state machine was **deleted rather than corrected**. The heading is still plural ("3.5 State-Machine Diagrams") with one diagram under it. The decision-symbol issue needs verifying on the new diagram — the §3.5 narrative describes conditional branching ("asks whether cargo is collected... whether this is the final stop") which is exactly the case she said needs a decision node. |

### ❌ Not fixed — repeat offences

| ES comment | What she said | Current state |
|---|---|---|
| **c71** | "Drivers form a component in your system whereas vehicles also form part of another component. With this use case you are merging the functionality of two different components in one. This does not indicate a separation of concerns. These suggest different EBPs." | **Table 3 is still titled "TLM 1.1 — Register Drivers and Vehicles."** The narrative still handles both in one flow (step 2 = driver path, step 3 = vehicle path). This is the clearest single instruction she gave you and it was not actioned. Ammar didn't flag it because he wasn't marking against It1 feedback — that does not mean it's safe. |
| **c161** | "The risk categorised test cases please need re-formatting — left adjusted text, smaller font size, different column widths. It spans over 5 pages, difficult to comprehend, forfeits the effort to show." | §7.2 is still an 8-column table with 26 rows of prose. It is at least as long as the Iteration 1 version. And Ammar wants you to **add** test inputs and screenshots to it. See Clash 3. |
| **c21** | "Make bullet points either all bold / or not" | Ammar's c42 in Iteration 2: *"Formatting needs fixing not consistent."* **Two markers, two iterations, same complaint.** This is now the most damaging item on the list in proportion to how trivial it is to fix. |
| **c18 / c69** | Widows and orphans | Cannot verify from text extraction. Must be checked visually in Word before submission. Given c21 was ignored, assume this was too. |
| **c59** | "Perhaps you can fit this diagram easily on the previous page to go with the narrative — it just makes it easier for reading and it is much more informative" | **Regressed.** §6 (UI Mock-ups) in Iteration 2 is twenty-nine consecutive figure captions with no narrative text at all between them. Ammar still gave 4/5 on the designs themselves, but he then wrote eight separate comments asking design questions that a narrative would have pre-empted. |
| **c128** | "When showing the technical architecture on a slide I would only provide the headings of each block else it becomes too cluttered and ineligible" | The §4.1 narrative is **verbatim copy-paste from Iteration 1 §5.8**, unchanged. It still describes "six handshake states" — the model you deleted. See D.2. |
| **Overall comment** | "The user experience and the value of this document for both less computer literate and developers would be greatly enhanced if you spent a bit more time on the presentation of the content" | Ammar's c38: *"Use more transport lingo not tech lingo… immerse in the domain."* c39 and c9: *"1st time full then acronym."* c118: *"Hard to read..."* **Both markers, independently, in consecutive iterations, on presentation and reader accessibility.** |

---

## A.2 Ammar's Iteration 2 feedback: full inventory

62 comments, grouped by the work they generate.

### Group 1 — The "why does this not already exist" line of questioning (§1.1, §1.2)

These five comments are one argument, and answering them properly is worth most of the 1.5 marks lost on Background.

| # | Comment | What he's actually asking |
|---|---|---|
| c10 | "you can't be the only one who was like 'oh wait why don't we have all of this in 1 place…' so why did it not happen? What is the 'thing' — whether politics, proprietary, law etc." | Name the barrier. Fragmentation persists for a reason: commercial incentive (Pulsit and Parcel Perfect are competitors with no reason to integrate), proprietary data ownership, no industry data standard, POPIA constraints on sharing driver data between parties, or the fact that no single party in the chain owns the whole journey. Pick the real ones, evidence them, cite them. |
| c16 | "why have they not unified their own platform if they have the tools being used? Are these tools softwares or apis?" | Distinguish product from integration surface for each of the four systems. Which expose APIs, at what tier, and what does that cost LFG? |
| c19 | "if these tools are being used, why develop own tool to replace something doing the job vs creating a unifying place using the tools" | You *say* in §1.1.3 that FreightProof "operates at the integration layer" and doesn't replace anything. He missed it because the point is buried at the end of a long paragraph. Make it a lead sentence, not a closer. |
| c14 | "Would this not be logistics then? If they do vehicle driver and route? Like transport company?" | Your "vehicle supplier" framing for LFG is non-standard. Use the industry term. |
| c23 | "These problems mentioned, from what I saw, they are not matching tbh. The gaps are still there. But could be due to iteration 2" | **Serious.** He is saying your six business problems don't map to what the system actually does. Build an explicit problem → objective → delivered capability traceability table. |

### Group 2 — Objectives (§1.3)

| # | Comment | Action |
|---|---|---|
| c26, c27 | "These two feel like sub obj of a main obj." "There is an overarching obj missing… if I was to ask what do they aim as a company, 2 of these at least would not be their mission vision." Marksheet: *"Bus obj is missing the 'parent' obj."* | Add one parent business objective, with the current four restructured beneath it. See Clash 1 for the tension with Elsje's framing. |
| c29 | "Proof of concept? Mvp?" on "Deliver a Working Foundation, Not Just a Concept" | Commit to and define one term, then use it consistently. The document currently uses "MVP" in §5 and Appendix, "working foundation" in §1.3.2, and "demonstrable" in §8.2. |
| c31 | "What does that mean to a system?" on "periodically check Parcel Perfect" | Give a number. See Clash 5. |
| c34, c35 | "If you want proper, you need to verify ID with person not device gps because then the device is the person not the driver." "how do you verify that name id is the actual person? By then long gone." | Substantive design challenge, not a wording fix. See §D.3 and Clash 5. |
| c38 | "Use more trasport lingo not tech lingo… immerse in the domain" | Domain-language pass across the whole document. Pairs with Elsje's overall comment. |
| c39, c9 | "1st time full then acronym." "1st type type it all" | EMEA, IDVS, PWA, HCS, POPIA, LFG, OTP, POD, SSE, CI, UAT, ERD. Expand-then-abbreviate on first use, then add a glossary. |
| c42 | "Formatting needs fixing not consisten." | See Elsje c21. Repeat offence. |
| c45 | "Pic?" on the It1 technology decisions paragraph | He wants a visual — a decision table or before/after diagram of the Polygon→Hedera, Web3Auth→Supabase, IPFS→Storage changes. |

### Group 3 — Package Diagram (§3.1)

| # | Comment |
|---|---|
| c50 | "The key components of the system are not there. This looks like a systems archiecture as a package daigram" |
| Marksheet | "Package has almost no mention of the domain concepts. It looks like a system architecture type. Overall well done." |

**See Clash 2. This is the decision that unblocks the largest amount of Iteration 3 work.**

### Group 4 — Use cases, state machines and DB (§3.4–3.6)

| # | Comment | Action |
|---|---|---|
| c95 | "If by chance takes pic of correct seal but before loading then?" | Seal photo must be bound to the loading-complete event and the warehouse scan session, not just to a timestamp. Add as an exception flow in CC 1.4 and as a test case. |
| c110, c111 | "How do you prevent dispatch creating fraud or being in on it too?" "how do you become preventative vs a camera (open after robbery)" | **The hardest question in the set.** Dispatcher override is currently a single-actor unchecked power. Options: two-person authorisation for override, immutable anchoring of the override itself (you do log it — say so louder), org-admin alerting on override frequency, or an explicit scope statement that FreightProof is evidential rather than preventative. You already make that scope argument in §3.5 ("the platform records rather than intervenes"). It needs to be in §1.1.3 where he'd have seen it first. |
| c114, c115 | "Need to think about what makes departure a transite business rule." "In the diagram" | Make the departure→in-transit guard condition explicit as a labelled guard on the state machine. This also resolves Elsje's decision-symbol comment (c113/c118). |
| c118 | "Hard to read..." on the ERD | Legibility rebuild. Elsje said the same about the technical architecture (c128). Both markers, same class of problem. |

### Group 5 — Risks (§5) — **worst-scoring section, 3/5**

| # | Comment | Action |
|---|---|---|
| c144 | "Risk has 3M Manage Mitigate Monitor (trigger catch)" | Restructure Table 55 from a single "Mitigation Strategy" column to **Manage / Mitigate / Monitor**, with a named trigger or detection signal per risk. This one change is most of the two lost marks. |
| c145 | "Why is this more of a priority then so you can then look for other ways?" on R-01 | Justify R-01's ranking, and state what alternatives you're pursuing given Parcel Perfect access hasn't landed. |
| c146 | "So what is the source of truth then? Is the assumption if not on hedera it did not happen even if it did but hedera is down? Does this mean things stop working?" | Define the source of truth explicitly. Your §7.1.1 fail-safe policy already answers this (local DB is authoritative, Hedera is corroborative) but it is nowhere near §5 where he was reading. |
| c147, c148 | "What about time? Estimate doesn't google map give estimate as an example? So theoretically can map out how long to get to x… so if delay by 5-10 mins raise alert?" "this means no internet no worries call driver follow up" | ETA-deviation as a detection signal, and a documented human fallback when telemetry is unavailable. Feeds the Monitor column. |
| c149, c150, c151, c152 | Evidence binding before anchor; queue ordering; dispatcher-side changes during driver offline; tamper protection of locally stored evidence | Four distinct technical answers needed on R-04, R-05 and R-07. Note R-04 is already on your Iteration 3 priority list (§9.3.2) — cross-reference it. |
| — | **Not a comment, a defect** | §5 opening says *"the full risk register appears in Appendix B."* Appendix B is "Supporting UML Detail." **The full risk register is not in the Iteration 2 document at all.** It was in Iteration 1 and Elsje gave you 4/5 partly for it. See D.1. |

### Group 6 — UI Mock-ups (§6)

| # | Comment | Action |
|---|---|---|
| c158 | "look into a more rich result box… let user know the driver last drove when, when took break etc so you can get an idea when assigning" | Driver selection card in the create-trip wizard: last trip completed, hours since last break, current assignment status. |
| c161 | "Potentially look into driver picture too as one of the ways to identify beyond having the correct device" | Driver photo on the assignment screen. Also partially answers c20/c34/c35. |
| c165 | "What about how many km it has driven? If there is elements of fleet management too then you may need to expand beyond just a list" | Vehicle detail: odometer, service interval, last inspection. |
| c168 | "at some point you may need a way to see driver performance… if a driver is prone to things happening on the way etc (rough driver might have a lot of tire issues)" | Driver detail: exception count, on-time rate, incident history. |
| c171, c172 | "Why does a driver need to know their past trips?" "Is it not just giving historic date for a user who does not need" | **Either justify or cut the Past Trips screen.** A defensible justification exists: drivers need proof of their own completed handovers if they're personally accused in a dispute. Say it. |
| c183 | "Panic one -> think on design -> it does a 5 second count down then sends vs swipe… this way you need to do it twice so panic then swipe to confirm panic" | Redesign the panic flow: tap → 5s countdown → auto-send unless cancelled. He is describing a specific, better pattern. Implement it and show the redesign. |

### Group 7 — Testing (§7) — **3.5/5**

Marksheet: *"Show test inputs. Need to show the tests done which are not UI testing too. To check server and ensure some of the validations of the frontend are also present in the backend. Some tests are unclear what was being tested (server or Ui etc). Add screenshot of automated tests."*

| # | Comment | Action |
|---|---|---|
| c196 | Long comment on one-device binding: "I don't understand what makes this 'security'?… is the device blacklisted?… what is the purpose if the driver can already change phone?" | Justify the control or drop the security framing. It's a session-integrity control, not an identity control. Saying so honestly is stronger than defending it as security. |
| c197 | "offline when you have multiple online players need more thought..." | Conflict model for concurrent dispatcher/driver writes during an offline window. |
| c201 | "Something important to test: Multiple conflicting read writes / Offline mode when goes online / When server goes down how it works" | Three named test cases to add. He has literally written your test plan for you. |
| c202 | "Clean up file when submiting" | There is a stray `.` on its own line at the end of §7.1.4. Proofread pass. |
| c204 | "Why not auto number or have an internal numbering being your primary way of managing IDs? Every company has their own numbering not manually entered" | Design change: internal auto-generated trip reference as primary key, external order number as a searchable secondary reference. |
| c205 | "Can you have conflicts? In a sense of suppose an override and driver confirm same time" | Concurrency test case. You mention row locks in a use case narrative — surface it as a test. |
| c206 | "You should not allow a 2nd send… you should ensure requests don't go twice" | He's saying TC-09 tests the wrong layer. Add the frontend guard (disabled button post-submit) **and** keep the backend idempotency test, labelled clearly as defence-in-depth. |
| c207 | "And what if you want to go to device B again? I don't get the point of this here? Considering login is an otp thing?" | Same as c196. |
| c208, c209 | "I can't tell which type of test was this a backend or a front end. If frontend -> the possibility should not exist to get to that point. If backend -> good." "For frontend you will hit the access control test before it allows you to do anything" | **Add a "Layer (Frontend / Backend / Both)" column to §7.2.** This single column resolves three of his comments. |
| c210, c211, c212 | "Do they type? Coz sometimes typo..." "If picture -> then is it analyzed? Or it is a barcode always scanned?" "Should also ensure seal numbers are unique" | Specify seal capture mechanism (typed / OCR / barcode), and add a uniqueness constraint plus its test case. |

### Group 8 — Scrum (§8) — **7/10, biggest absolute loss**

Marksheet: *"Need to do better Jira wise considering it is iteration 2 now. Need a mini retrospective section but the table added shows steps forward."*

| # | Comment | Action |
|---|---|---|
| c253 | "Retrospective section?" (against §9.3.2 priorities) | You *have* per-sprint retrospectives in Table 63. What he wants is an **iteration-level retrospective** — a section that looks back across Sprints 3–5 as a whole and says what Team 05 learned about how it works, distinct from three sprint rows. Add §8.3 "Iteration 2 Retrospective". |
| Marksheet | "Need to do better Jira wise" | Non-negotiable for Iteration 3. Every sprint opens with committed, estimated, assigned stories. Screenshot the sprint at *open*, not just the burndown at close. See Section E. |
| — | Self-inflicted | §8.1.2 contains: *"But that did not effect the work done just the visual element on Jira."* Spelling error (*affect*), defensive tone, and it undercuts the honesty the rest of the section earns. Cut it. |

### Group 9 — Front matter

| # | Comment | Action |
|---|---|---|
| c1, c3 | "List of ..." on "Table of Tables" and "Table of Figures" | Rename to **"List of Tables"** and **"List of Figures"**. Two-minute fix, visible on page 2, sets his first impression of the document. |
| c20, c21, c22 | "would a driver with someone else's phone not be able to?… like a student card, someone uses yours" / "This is interesting, don't remember this as a thing" (driver swaps) / "But again, this means the invoice would be ocr'd?" | Answer in the business problems narrative. c20 is the device-identity problem again (c34/c35/c161). c22 needs the Parcel Perfect data path stated: API pull, not OCR. |

---

# PART B — Where the two markers clash

You asked for this specifically. Five genuine conflicts, plus two places where they reinforce each other so hard that ignoring them again would be reckless.

## Clash 1 — What a "business objective" is

| | |
|---|---|
| **Elsje (c27)** | "IMHO these are really the Project Objectives… you are saying the primary aim for the Project. Perhaps since Bruce is involved (you call him the Client Organisation) — what would be their overall objectives for their organisation?" |
| **Ammar (c26, c27)** | "These two feel like sub obj of a main obj." "There is an overarching obj missing… if I was to ask what do they aim as a company, 2 of these at least would not be their mission vission." |

**The conflict.** Elsje asked you to *raise the altitude* — move from project-level to organisation-level. You did, producing four flat LFG objectives. Ammar says those four are still not mission-level, and that they want a *hierarchy* with one parent rather than a flat list.

**They are not contradicting each other on direction.** They are contradicting on *shape*. Elsje's comment implies a flat set of organisational objectives; Ammar explicitly wants a tree.

**Recommended resolution.** Adopt Ammar's shape because his is the more recent feedback and the more specific instruction, and it does not violate anything Elsje said. Structure:

> **Parent business objective:** *Protect LFG's margin and contractual standing by making every custody handover provable.*
> Sub-objectives: reduce theft exposure · improve insurability · strengthen client trust and competitiveness · reduce dispute cost and time.

State in one line that the parent was added following Iteration 2 feedback. Markers reward visible response to feedback.

---

## Clash 2 — The Package Diagram *(highest-stakes clash)*

| | |
|---|---|
| **Elsje (c51)** | "**Although the packages make sense now** — the dependencies of these package are of cardinal importance and you compromised on this. Just having one dependency arrow from the business layer to the external packages cannot be good. These documents are specifically designed to inform both the not so technical inclined as well as the developers. You are not showing important information." |
| **Ammar (c50 + marksheet)** | "The key components of the system are not there. This looks like a systems archiecture as a package daigram." "Package has almost no mention of the domain concepts." |

**This is a direct contradiction.** Elsje explicitly validated the package *structure* and asked only for richer dependency modelling. You delivered exactly that — the §3.1 narrative is a dense account of every labelled dependency drawn from its real caller (auth from four places, Redis from Celery and the realtime bus, Storage from both storage and the browser). It is a faithful, thorough response to Elsje.

Ammar then said the whole diagram is the wrong *kind*: routers, orchestration, Alembic, Redis, Celery and SQLAlchemy are architecture concerns, not domain packages. He wants to see Trip, Consignment, Custody Chain, Evidence, Fleet, Identity.

**You cannot satisfy both in one diagram.** Richer technical dependencies and domain-concept packages are competing purposes for the same figure.

**Recommended resolution — split the concern across two figures:**

1. **§3.1 Package Diagram → rebuild around domain packages.** Trip Management, Custody Chain, Evidence & Anchoring, Fleet & Identity, Integration, Shared Kernel. Keep every dependency arrow fully labelled and drawn from its real source — this is how you honour Elsje inside Ammar's structure. Her comment was about dependency *rigour*, and rigour transfers.
2. **§4.1 Technical Architecture Diagram → absorbs the technical layering.** It is the correct home for FastAPI routers, Celery, Redis, Alembic and the external service topology, and it needs rewriting anyway (see D.2).

Then add two sentences under §3.1 explaining that the package diagram was reframed from architectural layers to domain packages following Iteration 2 feedback, with the technical view now carried in §4.1. Both markers see their comment answered, and you get credit for reconciling them deliberately rather than accidentally.

**Effort: high.** Treat this as the first thing scheduled, because §3.2, §3.3 and Appendix B.1 all have to agree with whatever you decide.

---

## Clash 3 — Density vs. completeness in the test section

| | |
|---|---|
| **Elsje (c161)** | "The risk categorised test cases please need re-formatting — left adjusted text, smaller font size, different column widths. It spans over 5 pages, difficult to comprehend, **forfeits the effort to show**." |
| **Elsje (c166, c191)** | "If the font size is made smaller (but readable), it could be accomplished." "if you collapse tables more the presentation and understanding can greatly be enhanced" |
| **Ammar (marksheet)** | "**Show test inputs.** Need to show the tests done which are not UI testing too… Some tests are unclear what was being tested (server or Ui etc). **Add screenshot of automated tests.**" |
| **Ammar (c208, c209)** | Wants an explicit frontend/backend layer distinction per test |

**The conflict.** Elsje wants the table *smaller*. Ammar wants test inputs, a layer column, non-UI test coverage and screenshots — all of which make it *bigger*. The Iteration 2 table is already 8 columns × 26 rows and Elsje already said it forfeits the effort.

**Recommended resolution — two-tier structure:**

- **§7.2 in the main body:** a compact summary table. `TC ID · Description · Layer · Risk Category · Result`. Five columns, landscape, 9pt, left-aligned, fits on two pages. This is Elsje's version.
- **Appendix C — Detailed Test Cases:** the full record with pre-conditions, **test inputs**, steps, expected vs actual. This is Ammar's version, and an appendix is the conventional home for it.
- **§7.3 — Automated Test Evidence:** CI run screenshots (pytest, Vitest, ruff, mypy, coverage), captioned as figures. Directly closes "Add screenshot of automated tests."

Say in one line at the top of §7.2 that summary lives in the body and detail in Appendix C. That framing turns a conflict into a deliberate structural choice, and both markers will read it that way.

---

## Clash 4 — Precision in system objectives

| | |
|---|---|
| **Elsje (c30)** | "Why 50meter? Also not sure about the 5 minutes — **exact values might sometimes be difficult?**" |
| **Your It2 response** | "in the order of tens of meters" · "configurable rather than fixed at an exact value" · "a configurable setting to be validated during testing, not a fixed guarantee" |
| **Ammar (c31)** | "**What does that mean to a system?**" on "must *periodically* check Parcel Perfect" |

**The conflict.** Elsje's push made you strip the numbers. Ammar's push demands them back. And §1.3.3 still opens by claiming these objectives "must be specific, measurable, and time bound", which the hedged versions are not — that sentence now contradicts the bullets underneath it.

**Recommended resolution — number plus basis plus status.** This satisfies both because Elsje's objection was to *unjustified* precision, not to precision:

> "Geofence tolerance is set at 75 m, chosen from measured device accuracy at the RTT Durban and RTT Johannesburg precincts during Iteration 2 testing (see §7.x). The value is configurable per precinct and will be re-validated against live Pulsit data in Iteration 3."

Same pattern for the manifest polling interval: state the interval, state the API constraint that drives it, state its validation status. Elsje gets justification, Ammar gets a number, and the "specific and measurable" claim becomes true.

---

## Clash 5 — Is device-based verification a real control?

| | |
|---|---|
| **Elsje (c30, c63)** | Treated the GPS cross-check as sound in principle, questioning only the tolerance and whether GPS should link to an external system |
| **Ammar (c20)** | "would a driver with someone else's phone not be able to? In essence changing physical to digital like a student card… someone uses yours" |
| **Ammar (c34)** | "If you want proper, you need to verify ID with person not device gps because then the device is the person not the driver" |
| **Ammar (c35)** | "how do you verify that name id is the actual person? By then long gone." |
| **Ammar (c196, c207)** | "what is the purpose if the driver can already change phone?" |

**Softer than a contradiction, but material.** Elsje's feedback implied refining the control. Ammar's implies the control doesn't do what §1.3.4 claims — your cross-reference table asserts that a name-and-ID signature *"prevents cargo from being signed off to an impersonator"*, and Ammar's c35 is a direct rebuttal.

It gets worse: **§9.1.2 admits the receiver name and ID are not even captured** ("Delivery is confirmed by a timestamped swipe"). So §1.3.4 claims a preventative control that §9.1.2 says doesn't exist. He will find that.

**Recommended resolution.**
1. Rewrite §1.3.4 from *prevent* to *evidence*: the signature does not prevent impersonation, it creates an attributable, anchored record that an impersonator must produce and that can be challenged later. That is honest and defensible.
2. Add driver photo capture at activation (his c161), which is a genuine identity signal rather than a device signal.
3. Add a short subsection — "Identity assurance: what FreightProof can and cannot claim" — stating plainly that device possession is not identity, listing the compensating controls, and naming IDVS integration as the Iteration 3 closure. Markers reward that kind of candour heavily. Elsje's Iteration 1 overall comment and Ammar's whole line of questioning both point at it.

---

## Reinforced (both markers, same point, twice — fix these or accept the penalty)

| Theme | Elsje | Ammar |
|---|---|---|
| **Formatting consistency** | c21 "Make bullet points either all bold / or not" | c42 "Formatting needs fixing not consisten." |
| **Reader accessibility / diagram legibility** | Overall comment; c128 "too cluttered and ineligible"; c161 "difficult to comprehend" | c118 "Hard to read..."; c38 "Use more trasport lingo not tech lingo"; c39/c9 acronym expansion |

Two markers, two iterations, identical complaints. If Iteration 3 lands with inconsistent bullet formatting and an unreadable ERD, the presentation marks will not recover — and both of these are hours of work, not days.

---

# PART C — Defects neither marker caught

Found during audit. Fix these quietly; they cost nothing now and would cost marks if spotted.

### D.1 The full risk register has vanished

§5 opens: *"A summary of the most significant risks is presented below, while the full risk register appears in Appendix B."*

Appendix B is **"Supporting UML Detail."** There is no risk register appendix in the Iteration 2 document.

Iteration 1 had it (Appendix B: Full Risk Register, p.89) and Elsje gave 4/5 with "Comprehensive — good." Iteration 2 dropped it and scored 3/5. When you removed the minutes appendix in response to Elsje's c224, the risk register appears to have gone with it. **Restore it as Appendix D, with the 3Ms structure from Ammar's c144.** This alone likely recovers a mark.

### D.2 §4.1 and §4.2 are stale copy-paste from Iteration 1

The §4.1 Technical Architecture narrative is **verbatim** from Iteration 1 §5.8. It still says:

- *"A trip moves through **six handshake states**"* — the model you deleted and replaced with the phase lifecycle. This directly contradicts §2.1, §3.5 and §9.1.1.
- *"GPS cross-referencing via Pulsit, and parcel count reconciliation through Parcel Perfect"* as though both are live. §2.2 and §9.2.3 say neither is.
- *"daily Merkle batch submissions"* — no longer matches the per-phase anchoring described in §7.1.1.
- Twilio and SendGrid as operational; §3.1 greys them as planned.

§4.2 (Network Diagram) has the same problems, still lists **"Camera/QR"** among browser capabilities after §2.2 confirms QR workflows were removed, and **the final sentence is truncated mid-word**: *"accessed directly by the frontends they s"*.

A marker who notices an unchanged Iteration 1 paragraph describing a deleted architecture will discount the rest of the document. **Rewrite both sections from scratch.** High priority, low effort.

### D.3 Internal contradiction: receiver identity verification

- §1.3.3 System Objective: *"the receiver digitally signs on the drivers app with their name and ID number"*
- §1.3.4 Cross-reference: *"A digital signature completed at confirmation with name and ID number, **prevents** cargo from being signed off to an impersonator"*
- §9.1.2: *"Delivery is confirmed by a **timestamped swipe, not by a captured name and ID number** as the objective requires"*
- §9.2.3 table: *"Receiver identity verification — Partial. No name or ID captured."*

Sections 1.3.3 and 1.3.4 describe a capability that sections 9.1.2 and 9.2.3 confirm does not exist. Either build it in Iteration 3 (it is already on your §9.3.2 priority list) or flag the gap at the point of claim, not 60 pages later.

### D.4 Broken internal cross-references

| Where | Says | Should say |
|---|---|---|
| §3.2 | "Unlike the database design in **Section 3.7**" | §3.6 |
| Appendix B.1 | "The main analysis class diagram in **Section 3.3**" | §3.2 |
| §5 intro | "the full risk register appears in **Appendix B**" | Does not exist — see D.1 |

### D.5 Appendix B.1 is empty

Appendix B.1 has an explanatory paragraph, then a three-column table **with no rows**. Elsje's c106 asked you to double-check the 0..1 multiplicities and this appendix is where that answer should live. As it stands it's an empty promise, immediately after text explaining what it contains.

### D.6 Figure 3 is used twice

`Figure 3: Class Diagram` (§3.2) and `Figure 3: Trip Lifecycle Management Use Case Diagram` (§3.3). Every subsequent figure number is off by one against the List of Figures. Rebuild the caption sequence with Word field-based cross-references so this cannot recur.

### D.7 Citation mismatch

In-text: **(Cartrack, 2023)**. Reference list: **Ctrack. (2023).** Different companies. The source URL (`ctrack.com`) confirms the reference entry is right and the in-text citation is wrong. Also: only four references for a document making claims about R435bn market value, 84% modal share, 95% of EMEA hijackings, 2 000 incidents and 12.5% insurance cost. The 12.5% figure is cited to SAPS and SAICB, neither of which is an obvious source for an insurance-cost-per-kilogram statistic. Verify or re-source it.

### D.8 Smaller items

- §5.1 and elsewhere still use "handshake points" / "handshake moments" — Iteration 1 vocabulary for a model you replaced with phases. Global find-and-replace needed.
- §5.1 references *"The v6 document"* twice. External artefact, undefined to a reader.
- §7.1.4 ends with a stray `.` on its own line (Ammar's c202).
- §8.1.2: *"that did not effect the work"* → *affect*.
- §3.5 heading is plural ("State-Machine Diagrams") with one diagram beneath it.
- TC-10 description: *"Phases is anchored"* → *"Phases are anchored"*.
- TC-26 has a blank Pass/Fail cell.

---

# PART D — The fix plan, section by section

Priority: **P1** = marks at stake or credibility damage · **P2** = direct marker instruction · **P3** = polish. Effort in person-hours.

### Front matter — P1, 1h
Rename to "List of Tables" / "List of Figures" (c1, c3). Rebuild figure numbering with Word cross-reference fields (D.6). Add a glossary/acronym table (c9, c39). Widows-and-orphans pass in Word (ES c18, c69).

### §1.1 Background — P1, 6h
Add a subsection answering *why the fragmentation persists* (c10, c16, c19): commercial incentive, proprietary ownership, absent industry standard, POPIA constraints on inter-party data sharing. Evidence it. Move the "we integrate, we don't replace" statement to the **front** of §1.1.3. Correct LFG's industry descriptor (c14). State the Parcel Perfect data path as API-pull, not OCR (c22).

### §1.2 Business Problems — P1, 3h
Build a **problem → objective → delivered capability → evidence** traceability table answering c23 directly. This is the single best response available to "they are not matching tbh."

### §1.3 Objectives — P1, 4h
Parent business objective with four sub-objectives (Clash 1). Restore numeric targets with stated basis (Clash 4). Rewrite §1.3.4 from *prevent* to *evidence* (Clash 5, D.3). Settle "MVP" vs "working foundation" and use one term document-wide (c29).

### §2 Project Plan — P2, 2h
Add the technology-decision visual Ammar asked for (c45). Domain-language pass (c38).

### §3.1 Package Diagram — P1, 8h ⚠️ **schedule first**
Rebuild around domain packages with fully-labelled dependencies (Clash 2). Add the reconciliation note. Confirm §3.2, §3.3 and Appendix B.1 still agree with the new structure.

### §3.2 Class Diagram + Appendix B.1 — P1, 4h
**Populate the empty appendix table** (D.5). Revisit and justify the 0..1 multiplicities (ES c106). Fix the §3.7 cross-reference (D.4).

### §3.3–3.4 Use Cases — P1, 6h
**Split TLM 1.1 into Register Driver and Register Vehicle** (ES c71 — outstanding since Iteration 1). Model the warehouse as a secondary actor (ES c63). Make sea-level vs fish-level explicit. Add the seal-photo-timing exception flow to CC 1.4 (c95). Strengthen the override narrative in CC 1.9 against the dispatcher-collusion question (c110, c111).

### §3.5 State Machine — P1, 4h
Add decision nodes and labelled guards where transitions branch (ES c113/c118, AC c114/c115). Either restore a corrected Consignment state machine or make the heading singular. Verify no "Actived" spelling survives.

### §3.6 Database Design — P2, 3h
Legibility rebuild of the ERD (c118, and ES c128 on the same class of problem). Fix the §3.3 back-reference in Appendix B.1.

### §4 Technology Diagrams — P1, 5h ⚠️
**Rewrite both sections from scratch** (D.2). Remove "six handshake states", Merkle batching, live Pulsit/Parcel Perfect claims, Camera/QR, and complete the truncated sentence. Absorb the technical layering displaced from §3.1.

### §5 Risk Assessment — P1, 6h 🎯 **best marks-per-hour in the plan**
Restructure Table 55 into **Manage / Mitigate / Monitor** with a named trigger per risk (c144). **Restore the full risk register as Appendix D** (D.1). Add risk owners. Justify R-01's priority and name alternatives (c145). Define the source of truth and Hedera-down behaviour (c146). Add ETA-deviation monitoring and the human fallback (c147, c148). Answer c149–c152 on R-04, R-05, R-07. Purge "handshake" and "v6 document".

### §6 UI Mock-ups — P2, 6h
**Add narrative between the figures** (ES c59 — currently 29 bare captions). Rich driver selection card (c158). Driver photo (c161). Vehicle km/service data (c165). Driver performance view (c168). Justify or cut Past Trips (c171, c172). Redesign the panic flow as countdown-with-cancel (c183).

### §7 Testing — P1, 8h
Two-tier split: compact §7.2 summary, full detail in Appendix C (Clash 3). **Add the Layer column** (c208, c209 — one column, three comments closed). Add test inputs in the appendix. New cases for concurrent read/write, offline-to-online transition, server-down behaviour (c201), override-vs-driver-confirm race (c205), seal uniqueness (c212). **New §7.3 with CI screenshots.** Frontend double-submit guard alongside backend idempotency (c206). Specify seal capture mechanism (c210, c211). Auto-generated internal trip reference (c204). Honest reframing of device binding (c196, c207). Remove the stray `.` (c202).

### §8 Scrum — P1, 5h
**New §8.3 Iteration 2 Retrospective** at iteration level, not sprint level (c253). Jira evidence: sprint-open screenshots with committed and estimated scope, not just closing burndowns. Cut the defensive sentence in §8.1.2. Show the ready-before-start rule being *applied*, not just agreed.

### §9 Status — P2, 3h
Reconcile against the corrected §1.3 objectives. Resolve the receiver-identity contradiction at source (D.3).

### §10 References — P2, 2h
Fix Cartrack/Ctrack (D.7). Verify or re-source the 12.5% insurance figure. Expand the reference base. APA 7th throughout.

### Document-wide — P1, 6h
Bullet and heading formatting consistency (ES c21 + AC c42 — **repeat offence**). "Handshake" → "phase" everywhere. Acronym expansion on first use. Domain-language pass (c38). Full proofread (c202). Widows and orphans.

**Total estimate: ~85 person-hours ≈ 21 hours each across four members.**

---

# PART E — Sequencing

**Week 1 — Structural decisions.** Package diagram rebuild (it gates §3.2, §3.3, §4.1 and Appendix B.1). Objectives restructure. §4.1/§4.2 rewrite. Risk 3Ms restructure and register restoration.

**Week 2 — Content.** Use case split and warehouse actor. State machine decisions. Test two-tier restructure plus new cases. UI narrative and design changes. §8.3 retrospective.

**Week 3 — Consistency and polish.** Cross-reference audit. Figure and table renumbering. Terminology sweep. Formatting consistency. Appendix B.1 population. References. Full proofread.

**Before submission — the checklist that actually matters:**
1. Open in Word, page through every page, check widows/orphans and that no table splits badly.
2. Confirm no "handshake", "Merkle batch", "QR", "v6 document", "six handshake states", or "Actived" survives.
3. Confirm every "see Section X" and "see Appendix Y" resolves to the right place.
4. Confirm every figure and table number is unique and sequential.
5. Confirm no table in the body runs past two pages.
6. Confirm every acronym is expanded on first use.
7. Confirm bullet formatting is uniform (this is the third iteration of this instruction).

---

# PART F — Refining questions

Answer these and I'll turn the plan into the actual Iteration 3 edits.

**Blocking — I need these to proceed**

1. **Who marks Iteration 3?** Elsje, Ammar, or both? This directly changes how I resolve Clashes 2, 3 and 4. If it's Elsje, the density and presentation resolutions weight toward her; if Ammar, toward domain depth. If both, my two-tier recommendations stand.

2. **Package diagram — do you accept the split?** (Domain packages in §3.1, technical layering absorbed into §4.1.) It's the highest-effort item and everything in §3 depends on it. If you'd rather argue back to Ammar that Elsje validated the current structure, that's defensible, but you'd need to say so explicitly in the document and I'd write it differently.

3. **Do you have the diagram source files?** draw.io, Lucidchart, PlantUML, something else? Adding decision nodes, rebuilding the package diagram and improving ERD legibility all depend on whether these are editable or exported images.

4. **Is the Iteration 3 document a revision of the Iteration 2 file, or a fresh document?** Changes whether I work in tracked changes against the existing .docx or build new.

**Affects scope**

5. **Pulsit, Parcel Perfect and IDVS — has live access landed?** At least eight fixes across §1.3, §5, §9 and the objectives read completely differently depending on the answer. If still blocked, I write the honest-limitation version. If live, several "Partial" statuses become "Met".

6. **Which of Ammar's design suggestions are you actually building** versus documenting as considered-and-deferred? Specifically: driver photo capture (c161), panic countdown redesign (c183), internal auto-numbering (c204), seal uniqueness constraint (c212), receiver name and ID capture (D.3), rich driver/vehicle cards (c158, c165, c168). Built items go in §9.1.1; deferred items need a defensible reason in §9.1.3.

7. **Is there a page or word limit for Iteration 3?** The Iteration 2 document ran to roughly 100 pages and both markers commented on density. If there's a cap, the appendix strategy in Clash 3 needs adjusting.

8. **Do you know the Iteration 3 rubric and weighting?** It went 30 → 40 marks between iterations. If Iteration 3 reweights (a deployment or demo component, for instance), effort allocation should shift.

**Lower priority**

9. **Meeting minutes.** Therona Moodley's feedback on Set 1 (initials, named secretary/admin, named chair, agenda as a separate document, minute items correlating to agenda items) applies to the Set 2 submission. Is that a separate deliverable you want covered, and is it due alongside Iteration 3?

10. **Appendix B.1 content.** Do you have the detailed class attributes and operations somewhere already, or does that table need building from the codebase?

11. **The 12.5% insurance figure.** Do you have the actual source? It's currently attributed to SAPS and SAICB, neither of which plausibly publishes insurance-cost-per-kilogram. It appears three times in the document and is load-bearing for one of your business objectives.

---

## One thing worth saying plainly

The Iteration 2 document is better written than the Iteration 1 document, and the score didn't move. That's because the marks were lost in places that aren't about writing quality: a missing appendix, a copy-pasted stale section, an empty table, a risk column structure, Jira hygiene, and a formatting instruction ignored twice.

The highest-value work in this plan is not the difficult conceptual stuff. It's §5 (restore the register, restructure to 3Ms — roughly six hours for what looks like two marks), §4 (rewrite two stale sections — five hours, prevents credibility damage), and the document-wide consistency pass (six hours for something two markers have now asked for across two iterations).

Do those three first. They're about twenty hours and they're the difference between 72% and something that starts with an 8.
