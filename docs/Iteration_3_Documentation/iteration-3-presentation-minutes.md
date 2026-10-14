# FreightProof — Iteration 3 Presentation Minutes & Feedback

**Date:** 2026-09-18
**Status:** Feedback captured, pending team decisions before sprint 8 planning

## Meeting details

FreightProof (Team 5) presented the iteration 3 system demonstration and took roughly 30 minutes of panel feedback. The panel accepted the build as sound and spent almost all of its time on production-readiness, not on features.

| Item | Detail |
| --- | --- |
| Session | Iteration 3 presentation and demo |
| Date | 18 September 2026 |
| Team presenting | Tim Gultig, Ciaran Formby, Chiko Kasongo, Thomas Davis |
| Panel | Ammar Canani; a second reviewer the transcript names only as "Professor" |
| Outcome | No blocking objections; feedback directed at iteration 4 scope |

The transcript's speaker separation is poor — most team speakers collapse into one label and several sentences are garbled. Figures and technical claims below are recorded as spoken and should be checked against the slides before being quoted anywhere else.

## What we presented

The presentation ran in seven parts and made a large number of specific technical claims, several of which the team will be held to in iteration 4. This section records them as spoken.

### Running order and speakers

1. Framing and problem context — Tim opened, Tom took the agenda, then the market numbers
2. Objectives and delivery status — what is done, what is partial
3. Iteration 3 additions, story map, architecture, data model — Ciaran on the data model
4. Process and engineering discipline — sprints, layering, migrations, shared types
5. Sprint metrics — Chiko on burndown and velocity
6. Status, limitations, business value, AI declaration
7. Live demo — precincts, full trip cycle, exceptions, receiver handover, analytics

### Problem framing as stated

- South African road freight moves roughly R400 billion a year; 84% of freight moves by road rather than rail
- Roughly 2,000 trucks hijacked last year; around R3 billion in direct losses annually; South Africa dominates hijacking volumes in the EMEA region
- Cargo insurance sits near 12.5% locally against an international range of 1–5%
- Existing systems are not broken — Load Factor Group uses Pulsit for tracking and Parcel Perfect for waybills, both working adequately. The gap is the handover moment, where no system talks to another and each party records its own private version
- FreightProof anchors a tamper-evident record at handover; it does not replace the incumbents
- The system was deliberately designed as detection, not prevention

### Capability claims

**Stated as delivered:** secure anchoring, manifest syncing, receiver notifications, exception logging and review, seal integrity.

**Stated as partial:** multi-source location checking — logic fully built and tested, but running on a simulated feed rather than live Pulsit data.

**New in iteration 3:**

- Receiver web app as a third client alongside dispatcher and driver
- Rotating QR code on the driver app (20-second rotation, configurable), issuing a single-use token stored only as a hash
- Receiver identity verification through Didit — document check, biometric match and liveness — currently optional for POPIA reasons because processing happens in the United States
- Configurable precincts with circular geofence radius, plus precinct CRUD and append-only change history
- Driver-phone versus vehicle-tracker corroboration, with truck position simulated for the demo
- Photo evidence attached to exceptions
- Dispatcher exception review recording status, outcome, reviewer and timestamp
- Blockchain-backed receipt on confirmation
- Analytics: four live tiles plus six pages (Activity, On-Time, Problems, Review Desk, Evidence, Routes & Sites), an incident map, and per-vehicle, per-driver and per-precinct views

### Architecture and engineering claims

- Strict service layering: endpoints call orchestration, orchestration calls integration, nothing skips a level; enforced in code review
- Ledger anchoring typically returns in 4–6 seconds, with automatic recovery if the ledger is unavailable
- 43 database migrations this iteration, all through Alembic, no hand edits — the schema can be rebuilt from scratch and its full history is recoverable
- One shared types package consumed by both frontends, so contract changes break at compile time rather than silently at runtime
- Analytics run off read-only live views over the evidence tables, with no refresh cycle and no staleness window
- Management endpoints are admin-gated, every query is scoped to the caller's organisation, and sessions and response headers have been hardened
- Confirmation is one row per phase event and deliberately holds no personal data; precinct, driver and vehicle events are append-only

### Live versus mocked, as stated

| Component | Status claimed |
| --- | --- |
| Receiver app | Live |
| Ledger anchoring | Live, 4–6s typical |
| Receiver notifications | Live but limited to a subset of interactions |
| Pulsit corroboration | Mock data; integration code done, no production credentials |
| Parcel Perfect manifest | Mock data; integration code done, no production credentials |

### Process and sprint metrics

- Two-week sprints, Fibonacci estimation, full-team meeting every Wednesday, everything tracked in Jira, no merge to a protected branch without a pull request and review
- Sprint 6: all 80 points delivered. Sprint 7: 71 points delivered
- Burndown stayed flat then dropped sharply near the end in both sprints — the team named closing work, not planning it, as the weakness
- Sprint 6 and 7 velocity was consistent enough to plan iteration 4 from evidence rather than guesswork
- Admitted: some Sprint 6 items closed just after the sprint ended, and Sprint 7 reported carryover and new work as one combined figure, obscuring real commitment. Fix already running — carried items tracked to done inside the next sprint, carryover reported separately from Sprint 8
- Admitted: points are not spread evenly across the team

### Limitations the team declared

- Receiver verification evidences who confirmed delivery but does not prove identity
- Not all evidence is anchored yet
- Access control and rate-limit gaps found on some newer endpoints, currently being fixed
- Database connection timeouts not properly tested under load

### AI use declaration

Claude and Claude Code were the primary tools, used to understand unfamiliar and complex code. Gemini was used for tests and for reconciling sprint records against what was actually in the repository. The team also used a package search tool for new libraries and models, plus Google API documentation. The stated discipline: every AI-assisted change is traced through the data flow and tested by a team member before it counts as done, with commit history, pull requests and tests as the evidence trail.

## What went wrong in the demo

Five things failed or stumbled live. None was fatal, but each is visible work for iteration 4 and two of them fed directly into the panel's criticism.

| Issue | What happened | Fix needed |
| --- | --- | --- |
| Didit webhook did not return | Verification completed but the portal never received the callback in time; attributed to a localhost-versus-hosted difference between the ngrok tunnel and the hosted API domain | Resolve the webhook on the deployed environment and add a wait state in the UI |
| QR code expired mid-demo | The receiver link timed out before it could be used; framed on the spot as the timeout working | Decide whether 20 seconds is right, and handle expiry gracefully rather than as a dead link |
| Driver OTP not received | The presenter had to resend to get the code, on stage | Ties directly to the panel's question about OTP fallback |
| Precinct creation is coordinate entry | The map did not show the location; only latitude and longitude were captured, typed by hand | Reverse geocoding, raised independently by the panel |
| Trip dates | Past dates are correctly greyed out, but the panel still flagged date handling as one of the "small things" to tidy | Quick pass over form validation and messaging |

The geofence mismatches during the trip flow were deliberate and read correctly as the system working — the truck was moved away from the driver phone to trigger the warning and the 7,000-metre separation exception.

## Feedback — first reviewer

The summary line was "you have the core; now make it production-ready." The single strongest objection was to the receiver's biometric identity check.

### Show the bad day, not the happy day

The demo showed a happy path with light exceptions. The panel already believes the team can do that. What it wants to see in iteration 4 is a genuinely bad scenario — not a burst tyre that gets fixed, but a tyre that cannot be fixed, an accident with other vehicles involved, something where the audit trail is the whole point.

The reasoning: the value proposition is evidence for insurers and police. Demonstrate the platform as the easy route to that complete record.

The team's answer — pulling camera snippets from Pulsit telematics when an exception fires, since telematics providers here run cameras on trucks — landed well, as did the idea of a compiled incident report PDF with the dates and details authorities expect. Both should be treated as commitments now.

### The receiver identity check is a red flag

The reviewer's position, stated bluntly: facial verification plus manual ID number entry for a delivery receiver will not fly in the real world, and it is no surprise nobody has implemented it. The objection is POPIA and GDPR data minimisation — collect the minimum needed to prove delivery happened.

Alternatives named, all in use in South Africa already:

- A PIN or OTP code given to the receiver
- A photo of the parcel at the address
- Geolocation, which the system already captures
- Pickup location confirmation

The team argued that facial verification matters for disputes over who accepted responsibility. The reviewer conceded it could work for high-value or dangerous freight — explosives were the example — but not for everyday citizens. The instruction was to research it rather than defend it.

A secondary point: if the ID is scanned, the ID number should not also be typed. Either scan and auto-populate with a confirm step, or open Didit immediately and skip the first page entirely.

### Cut manual input

Manual input produces mistakes, and the panel saw a lot of it. Specific items:

- Seal number is typed and photographed separately. It should auto-populate — OCR from the photo, or pulled from Pulsit, which supplies the locks to companies. If neither, at minimum a confirm step where the photo verifies the typed number
- Order and waybill numbers must not be added once-off with no confirmation
- Latitude and longitude typed by hand for precincts — use reverse geocoding. The Google paid-tier concern is real but the API key exposure risk is manageable with key restrictions and spend limits, and open-source alternatives exist

### Robustness and completeness

- What happens when the SMS network is down and the driver cannot get an OTP? Look at more than one fallback — WhatsApp, fingerprint, login-based approval. The reviewer explicitly said not to pick just one, but to examine both
- Truck and trailer breakdown should be multi-select, not single-select. One hazard bursts both
- Simulate parcel loading and scanning rather than skipping it
- Simulate location movement along a route. A GPS-spoofing tool works, or simply have one team member walk to another building for a real delivery. A recorded video of a real delivery could add value, but live carries more weight
- Polygon geofences rather than circles, since precincts are few enough to be worth mapping properly
- Automatic ETA from origin, destination and departure time, accounting for time of day and traffic. This opens onto scheduling and a fleet management view — which truck is near Johannesburg for a Johannesburg-to-Cape Town trip

### Analytics must be defensible

The reviewer asked what informs "risky times of day" and was not fully satisfied by the answer that it derives from exceptions logged during testing. Two instructions followed:

1. State the data provenance in the presentation itself
2. Be ready to be asked, live, to show a specific incident on the map — "I would like to see today's incident"

The warning attached to this was the sharpest in the session: if the team cannot show that in iteration 4, it casts doubt on the operational validity of the whole system. Tie these things down even where they are not fully working.

A minor screen note was also raised — something reading "done for vehicle details" on the analytics screens that needs checking.

## Feedback — Ammar Canani

Ammar's feedback was structural rather than detailed: the platform is currently built around one trip at a time, and real freight operations do not work that way. He closed by saying the team does not have to do all of it, and should finish the loose ends before expanding.

### The view is wrong — it should be multi-trip

This was the central point. Nobody watches a single trip that runs for 24 or 48 hours with multiple stops. The dispatcher needs a dashboard showing every trip running simultaneously, and only drills into the single-trip view the team demonstrated when something goes wrong.

That implies an alert and notification layer: email, pop-up, WhatsApp — pushed to the specific person able to act on it.

### Roles, precincts and access control

A large company does not have one person doing this. Questions to resolve:

- Does each precinct have its own person logging in to manage it?
- If so, do they get a map view of the trucks that concern them?
- Who assigns a truck for a Cape Town to Johannesburg trip — the origin staff or the destination staff? Whoever sits in a precinct is likely the one initiating and managing its trips
- What are the role limitations on who can start a trip, and what access control enforces them?
- What is the override path? The example given: a driver phones in because his internet is down or the OTP is not arriving, and someone needs to bypass it — probably requiring supervisor approval

### Receiver model — onboard customers instead

Ammar reached the same conclusion as the first reviewer by a different route. This is freight, not parcel delivery. Consignments worth millions of rand justify giving the customer credentials.

- Receiving is usually a department, with one person signing off
- Onboarded customers can track their own goods in transit, giving transparency to everyone
- They log in and sign off on receipt — no biometrics required
- A customer with millions of rand of cargo will not object to an app

### Domain expansion options

Offered as ideas, scope-dependent, explicitly not all required:

| Area | What it covers |
| --- | --- |
| Driver management | Business rules on who may drive, mandatory rest breaks and availability, modelled on pilot hours-of-service rules, especially for overnight trips |
| Fleet management and maintenance | Vehicle availability, and the lifecycle where a roadside quick fix becomes a depot repair later — which then distorts the analytics |
| Cost management | Cost of the trip, the driver, meals — the money dimension the system currently has none of |
| In-house response teams | Large operators run their own breakdown crews; exceptions should notify them directly rather than going through a phone call |

The maintenance point connects to exceptions specifically: a burst tyre is a quick fix on the road today and a workshop job tomorrow, and the system needs a position on how far it tracks that chain.

### Rethink what analytics are for

Ammar's view is that the current analytics are a good start but do not match how people actually use them. Split them in two:

1. **Live, ambient analytics** — the screen on the wall of an operations room that nobody touches and everybody glances at. Work out what belongs on it
2. **Deep-dive analytics** — what people sit down and interrogate after something has gone wrong

The question to answer before building: what should that wall screen show, on a day-to-day basis, to make the operator's job easy?

### Closing instruction

Package what exists and get it to completion for iteration 4. There are a lot of loose ends. Close those first, then consider expanding.

## Decisions needed before iteration 4 planning

Four of these need a team position before sprint 8 is estimated, because they change what gets built rather than how it gets built.

**1. Does biometric receiver verification survive?** Both reviewers attacked it independently, from POPIA and from freight-context angles. The team's planned move to VerifyIt or Smile Africa solves data residency but not the more fundamental objection — that collecting a face and an ID number is disproportionate to proving a delivery happened. Three paths:

- Drop it and replace with PIN plus geolocation plus parcel photo, the South African norm
- Keep it but make it a per-consignment policy setting, defaulting off and enabled only for high-value or dangerous freight, which is the ground the reviewer conceded
- Replace it with Ammar's onboarded-customer model — credentialed receivers who log in and sign off

Option three is probably the strongest: it satisfies both reviewers, removes the POPIA exposure, and produces stronger evidence than a biometric check on a stranger, because the identity is established at onboarding rather than at the door. It also makes the Didit webhook problem disappear.

**2. Scope tension.** Ammar listed driver management, fleet maintenance and cost management, then said to close loose ends first and not expand. These pull opposite ways. The defensible reading is that the multi-trip dashboard and alerting are not expansion — they are completion, because the current single-trip view is not a usable product — while driver, fleet and cost management are genuine expansion and should wait.

**3. How far does the incident deep-dive go?** The panel wants a serious failure scenario demonstrated. That needs a decision on what the evidence bundle actually is: the incident report PDF, the Pulsit camera snippets, or both. The PDF is achievable in one iteration; camera snippets depend on credentials the team does not yet have.

**4. Live integration credentials.** Pulsit and Parcel Perfect are still mocked, and multiple pieces of feedback — seal auto-population, real location movement, waybill autofill — depend on them. If credentials will not arrive in time, that needs saying now so the mitigation is planned rather than improvised on stage again.

## Codebase verification checklist

Every claim below was made on stage. The panel may ask the team to substantiate any of them in iteration 4, and the analytics warning makes clear that an unsupported claim damages credibility more than an admitted gap does. Walk these against the repository before sprint 8 planning.

| Claim made | Where to verify | Verified |
| --- | --- | --- |
| No endpoint calls the blockchain client or an external integration directly | Grep the endpoint layer for integration and ledger imports | ☐ |
| Anchoring returns in 4–6 seconds typically | Timing logs or instrumentation on the anchor call | ☐ |
| Automatic recovery when the ledger is unavailable | The retry or recovery path, and whether it has a test | ☐ |
| 43 Alembic migrations, no hand edits | Migration count in the repo; confirm the figure | ☐ |
| Schema rebuilds from scratch on a fresh machine | Actually run it against an empty database | ☐ |
| One shared types package consumed by both frontends | Both frontends import it, with no duplicated local type definitions | ☐ |
| Analytics are read-only live views with no staleness window | View definitions; confirm no materialised tables or cache layer | ☐ |
| Management endpoints admin-gated; every query org-scoped | Audit each management endpoint and the query scoping — this is a stated gap area | ☐ |
| Receiver token stored only as a hash | The token table and its write path | ☐ |
| Confirmation row holds no personal data | The confirmation schema, against what Didit returns | ☐ |
| Precinct, driver and vehicle events are append-only | Confirm no in-place updates anywhere in those paths | ☐ |
| Pulsit and Parcel Perfect integration code is done, only credentials missing | Read both integration modules — is it complete or scaffolded? | ☐ |
| Multi-source location logic fully built and tested | Find the tests; confirm they cover more than the simulated feed | ☐ |
| Receiver notifications live for a limited set | List which interactions actually notify | ☐ |
| Sprint 6: 80 points, Sprint 7: 71 points | Jira, against the repo — Gemini was used for this reconciliation once already | ☐ |
| Every AI-assisted change traced and human-tested before done | Spot-check commits and pull requests; this claim was made explicitly | ☐ |

The last row matters more than it looks. The team stated on the record that it is responsible for every line and that the commit history, pull requests and tests are the proof. That is a claim a panel can check directly.

Also worth a look while you are in there: the four declared limitations — unanchored evidence, endpoint access control, rate limits, and database connection timeouts under load — were promised as fixes and will be assumed done next time.

## Iteration 4 candidate backlog

Ordered by what the panel will actually look for. The first group is non-negotiable — these were either promised as fixes or explicitly flagged as credibility risks.

### Must do

- [ ] Multi-trip operations dashboard, with the single-trip view as the drill-down
- [ ] Alerts pushed to a person who can act — pick at least one channel beyond in-app
- [ ] Resolve the receiver identity decision and implement whatever replaces or gates the biometric check
- [ ] Close the four declared limitations: anchor remaining evidence, fix endpoint access control and rate limits, test connection handling under load
- [ ] Build one real failure scenario end to end — unrecoverable breakdown or collision — with the resulting evidence bundle
- [ ] Incident report PDF export, compiled with the dates and detail authorities expect
- [ ] Make the incident map demonstrable on demand, and be able to state where every analytics figure comes from
- [ ] Fix the Didit or replacement webhook on the deployed environment

### High value

- [ ] Seal number auto-population, by OCR or from Pulsit, with a confirm step
- [ ] Reverse geocoding for precinct and trip addresses, with API key restrictions and spend limits
- [ ] Multi-select on truck and trailer breakdown
- [ ] Simulated location movement along a route, or a live walk-to-another-building delivery
- [ ] Simulated parcel loading and scanning
- [ ] OTP fallback path for network failure, plus supervisor override with an audit record
- [ ] Confirmation step on manually entered order and waybill numbers
- [ ] Live Pulsit and Parcel Perfect credentials, or a stated mitigation

### If capacity allows

- [ ] Polygon geofences instead of circles
- [ ] Automatic ETA from origin, destination and departure time
- [ ] Precinct-scoped roles and access control, including who assigns trucks across precincts
- [ ] Split analytics into an ambient operations view and a deep-dive view
- [ ] Pulsit camera snippet retrieval attached to exceptions
- [ ] Onboarded customer portal for consignment tracking

### Deliberately deferred

Driver hours-of-service rules, fleet maintenance lifecycle, and trip cost management. All were offered as optional, and Ammar's closing instruction was to finish rather than expand.

### Process fixes already committed

- [ ] Report carryover separately from new work, from sprint 8
- [ ] Track carried items to done inside the following sprint
- [ ] Even out point distribution across the four team members
