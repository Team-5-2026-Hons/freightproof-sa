# Meeting Minutes — Post-Iteration 4 Feedback and Integration Roadmap

**Date:** 3 November 2026 (03/11/2026)
**Meeting type:** Industry partner feedback session (online)
**Prepared by:** Ciaran Formby
**Attendees:** Bruce van Wyk (Load Factor Group, industry partner), Ciaran Formby, Tim Gultig, Thomas Davis, Chiko Kasongo
**Also noted:** Bruce said Brandon (who runs Load Factor's IT and software development) was listening in. Brandon did not speak. He and Bruce will both review the recording and send back a combined list of suggestions and cautions.

**Context:** Bruce watched the Iteration 4 demonstration the week before. He had not yet reviewed the presentation material, so this was a first-impressions session, not a formal review. The team asked three things: where the system adds value, where it misses the point, and whether it can be taken further. The demo trip was the unhappy-path scenario: a driver swapped mid-trip because of illness, and the replacement driver then hijacked.

---

## 1. Overall Assessment

- Bruce called FreightProof a **developing package that will add value to the industry**. He described it as both a **management tool** and a **security tool**, and said both purposes are being addressed.
- He offered to be the **first pilot user** ("the first test tube baby") and to put the system in front of his own clients to gauge appetite, as he has done in earlier years.
- Bruce does not want to discourage the project. His next step is to review the recording and the Iteration 4 document, then pass on suggestions "from the branches of the tree", meaning feedback he has tested in a live environment.
- He said there are "not many" gaps. The feedback below is refinement, not a rethink.

## 2. Core Feedback: Every Event Must Tie Back to the Manifest and the Trip

This was the main substantive point of the meeting.

- In the demo, two incidents happened on one trip: **driver A was swapped out because of illness**, and **driver B was then hijacked**. Bruce said this combination does happen in practice.
- Each logged event needs **touchpoints that connect it to the other events on the same trip**. Insurers and customers need to see the whole trip as one story, not as unconnected incidents.
- What binds the events together:
  - The **manifest or waybill**, plus the **seal number**. Together these drive what Load Factor calls the **routing order**.
  - The **vehicle** (horse and trailer registration) and the **trip**. Both events belong to one vehicle on one journey, and the manifest governs that.
- Why it matters:
  - Under the security protocol, the vehicle stops and the control room is asked to agree to the driver swap.
  - **Insurers** will test the link between the events. Did the ill driver go to hospital? Is there a doctor's note? How do the two drivers relate? They are employed by the same company, and a swap followed by a hijack looks coincidental, so the insurer will probe it.
  - **Claims, shipper communication and consignee communication** all start from the manifest and the open trip. Everyone on the trip needs to know there was more than one incident, even though the hijacking was the main one.
- Ciaran's reading, which Bruce confirmed: **the manifest is the core of the trip**, and incidents attach to it.

## 3. Seal Integrity Across a Driver Swap

- The seal number is currently captured in the departure phase. Bruce said it must **also be visible against the incident**.
- His example: the first driver signed off on seal FP2223 as intact when leaving the shipper's premises, then fell ill. After the swap, **a seal check must confirm the same seal is still intact**. This is the handover check.
- From the claimant's side, the question is the seal's integrity from engine start through to the hijack. Having two people on the vehicle is itself something the insurer will test.
- Ciaran asked whether this needs to be shown on the trip history view. Bruce said yes.

## 4. Value to the Shipper, Even When Nothing Goes Wrong

- Ciaran asked whether the system is useful on a fully green trip, or only for operators and incidents. Bruce said **it serves both**.
- Shipper use: timestamps on each phase are a **performance tool**. In the demo, trip creation was at 17:17, activation at 17:18, and loading followed. Bruce noted the loaders were quick on an 8-ton vehicle. A shipper can use this to **manage loading staff or the dispatcher** "backwards" from the data.
- Ciaran confirmed that this aggregates across trips, so trends become visible.

## 5. Feature Suggestion: Positive "Trip Completed" Summary

- At the end of a successful trip, Bruce wants a **green, handshake-style confirmation**, for example:
  - "Trip completed successfully"
  - Average time from point A to point B
  - No driver fatigue or harsh-braking events
- He sees this as a **selling mechanism**: per-trip evidence that gives the customer comfort.
- Ciaran asked whether this should be a **trip summary shown once a trip is completed**. Bruce agreed.
- Bruce read the confirmation and unloading phases of a completed test trip and said they gave him a good bird's-eye view of the successful path.
- The fatigue and braking items depend on Pulse data. See §7.

## 6. Client Visibility: Claims, Disputes and Live Updates

Ciaran asked how much value there is in exporting incidents for a client to open and verify. Bruce's answers:

- If a client **disagrees with part of what is presented**, they must have a way to **remark, raise an observation or raise a concern**.
- The shared page itself **should not be interactive** in the sense of being editable.
- There should be a route for **live updates during a claim**. His example: uploading a **SAPS detail report** as a live event, typically a day or two after the incident depending on the police station.
- Purpose: the operator is **driving the claim with proof**, not waiting for SAPS or a third party. The evidence is submitted as a **bundle to the insurers**, and the customer can see that the claim is in progress and what has happened and why.

## 7. Integrations Roadmap (Pulse and Parcel Perfect)

- Ciaran restated that the system only works properly once it is integrated with **Pulse (tracking)** and **Parcel Perfect**. Data must come in **securely**, with no leakage and no access for outsiders.
- If Pulse shares more, the system could add engine-start time, driver phone use and similar exceptions. That depends on what Pulse will provide.
- Bruce's view of Parcel Perfect and Pulse: much of what he has seen operationally is built on one of the two or a combination.

**Bruce's proposed sequence:**

1. Ciaran sends the meeting recording and presentation material.
2. Bruce and Brandon review it over about a week and return a shortlist of suggestions and cautions. The team works on those in the meantime.
3. Bruce then approaches the Pulse contact (Harry van Wyk, as transcribed; the transcript is inconsistent, see §14). The contact already knows about the project, so it is "lukewarm", not a cold introduction.
4. In parallel, **Giovanni** is also aware of the project and can bring **Parcel Perfect** on board.

**What Bruce will bring to the Pulse conversation, and what the team should prepare:**
- Whether the system is **POPIA compliant**. The transcript says "PAYA", which is probably PAIA; confirm.
- An **NDA** to sign with the partner.
- A clear explanation of the partnership, the "what-ifs" the partner may worry about, and the team's compliance position, so the partner is comfortable opening up.
- Bruce said he has done "quite a bit of work" on NDAs and is prepared to address the partner's concerns in person.

**Risk acknowledged by Ciaran:** if the Pulse contact is reluctant, it will be hard to get the full value from the system, because it depends heavily on the tracking system. Bruce agreed it is hinged on that.

## 8. Security Knowledge and Industry Standards

- Ciaran asked whether Bruce or Brandon could put the team in touch with someone technical on **security in logistics**, since the team has no industry background there. He expects the Pulse contact to ask about security first.
- Bruce's guidance:
  - There is an **industry-wide baseline** for security protocols, which the team should treat as the reference ("as Bible").
  - Each operator then **tweaks** it for its own environment. His examples were Pulse, X International, RTT and FedEx.
  - The team should have a **master document** stating its accepted norms and standards. Each partner can modify it, and the result becomes contract-specific.
- Bruce's analogy was IATA: governed in broad terms by IATA, but each country and airline adds its own rules. He will provide the comparable security baseline for freight, and the team will then adapt it for each partner.

## 9. IP and UCT

- Ciaran said the working assumption is that anything built with the university belongs to UCT. The team is speaking to the university's contracts and commercialisation office about the IP position.
- Tim: UCT's commercialisation office either backs a project and helps with legal and commercial steps, or waives its rights and assigns ownership back. Backing can lead to disagreement over who holds the IP. Tim has emailed the contact to request a meeting.
- Tim noted that having industry support visible in that meeting would show the university the team has backing beyond UCT. Bruce welcomed this and said these discussions will help the team make the right decision at the right time. The transcript is unclear on whether Bruce offered to attend.
- **Status:** no outcome yet. Ciaran expects it to take a few weeks. Bruce's late-November timeline for the Pulse meeting assumes the IP position is sorted by then.

## 10. Additional Contact: GoMetro

- Tim: a contact at Afro Lab (David) has offered to introduce the team to a person who runs **GoMetro**, a software company, for development and product advice. Tim only needs to send a pitch and introduction email.
- Bruce does not know GoMetro intrinsically but knows their value system, and said it can only add value. He is happy to join a short introductory call so the team can compare answers across industry and software perspectives.

## 11. Timing and Availability

- **Target for the Pulse meeting:** third or last week of November, before the holiday break, provided the IP position is resolved.
- **Ciaran:** in Johannesburg around the third week of November, then travelling to the US from December for a couple of months. He can join calls online. He is back in Johannesburg next year.
- Bruce suggested using about two hours of Ciaran's Johannesburg time before the US flight. He would pick Ciaran up and drive to the Pulse contact's offices (location given as "Vereniging Way" in the transcript, possibly Vereeniging; confirm), so the trip ends with a concrete outcome before departure.
- The team still has to meet to decide how the project continues next year.

## 12. Recording and Materials

- The demo recording sits behind a UCT login and PIN, so Bruce could not open it. Ciaran will try to download and send it. If that fails, he will ask Electra (role not stated in the transcript) to share it, or the team can run a short live session that Bruce records.
- Bruce and Brandon want to review the recording closely to "tear it apart" and check it against their operational knowledge.
- Bruce also wants the **Iteration 4 document** once it is available. He will use it as background when he joins later meetings with the Pulse contact, Giovanni, Parcel Perfect and the operators.
- Ciaran explained that the demo was the last iteration's unhappy-day scenario, shaped by the course feedback, and did not show everything built in iterations 3 and 4. He offered a live walkthrough.

---

## 13. Decisions and Outcomes

| # | Outcome |
|---|---------|
| 1 | Bruce will act as pilot user and put the system to his clients once ready. |
| 2 | Next step is a review cycle of about a week by Bruce and Brandon, producing a shortlist of suggestions and cautions. |
| 3 | Target for the Pulse meeting is late November, assuming the UCT IP position is clarified by then. |
| 4 | Giovanni can be approached for Parcel Perfect in parallel. |
| 5 | The team will build a master security and compliance document that Bruce will help tailor per partner. |
| 6 | The team will take the GoMetro introduction. |

## 14. Action Items

| Owner | Action | When |
|-------|--------|------|
| Ciaran | Get the demo recording to Bruce, via a download or by asking Electra to share it | As soon as possible |
| Ciaran | Send Bruce the Iteration 4 document when available | On release |
| Bruce, Brandon | Review recording and document, then return suggestions and cautions | About one week after receipt |
| Bruce | Prepare the Pulse introduction, including NDA and compliance framing | After the IP position is clear |
| Bruce | Bring in Giovanni for the Parcel Perfect route | After the review cycle |
| Bruce | Provide the industry-baseline security and compliance document | Not stated |
| Tim | Chase the UCT commercialisation/contracts office for the IP meeting | Ongoing; email scheduled |
| Tim | Send the pitch and introduction email to the Afro Lab contact for the GoMetro introduction | Not stated |
| Team | Prepare the master security/compliance document and POPIA position for partner discussions | Before the Pulse meeting |
| Team | Decide how the project continues in 2027 | Not stated |

## 15. Items to Verify

Names and terms below are as the auto-transcript produced them, which was inconsistent. Check them before relying on them:

- The Pulse contact appears as "Harry", "Hadi", "Haring" and "Gary van Wyk". Earlier minutes (1 September) name Harry Van, Commercial Director at Pulsit.
- The legal term "PAYA" is probably PAIA, and "POPI" is POPIA.
- The company names GoMetro, Afro Lab and X International were recognised by the transcript only phonetically ("BowMetro", "GoMetric").
- The location "Vereniging Way" is uncertain.
- The Iteration 4 demo used team members' first names for the two drivers, so references to "Kieran" and "Tim" as drivers in the transcript are demo data, not real incident details.
- The transcript uses "Pulse" and "PulseIt" for the same company.
