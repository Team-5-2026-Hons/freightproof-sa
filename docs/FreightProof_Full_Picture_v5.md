**FreightProof SA**

_The Full Picture — v5_

_A complete walkthrough of what FreightProof is, who uses it, how every handshake in a depot-to-depot trip works, and how the system connects to Pulsit, Parcel Perfect, and the gate security systems that already run South African logistics precincts._

UCT INF4027W Honours Project | 2026

Ciaran Formby, Tim Gultig, Chiko Kasongo, Tom Davis

_What changed from v4: Seven targeted updates based on Bruce van Wyk’s written Q&A responses._

_1\. Gate security model reframed — the SLA is between FreightProof and the principal (e.g. FedEx, The Courier Guy), not between FreightProof and individual security companies. The security provider at any given location is abstracted away by that principal-level agreement._

_2\. Pulse geofence data is now stated as the primary programmatic verification of gate entry/exit, with driver photo or principal data feed as the secondary evidence layer._

_3\. Waybill capture confirmed unchanged._

_4\. Unloading handshake updated to reflect the two-way document exchange sequence Bruce described: driver hands copy of trip waybill to receiving handler → seals and load body are checked → driver receives and photographs the signed POD._

_5\. Manifest scope clarified — FreightProof covers the trunk haul manifest only. The separate last-mile delivery waybills (one FedEx driver, multiple consignees) are out of scope._

_6\. Seal verification updated with Phase 2 design target: guard pre-notification via principal SLA, with FreightProof pushing trip details (ETA, vehicle, driver, seals) to the precinct and receiving confirmation or exception._

_7\. New design principle added — arrival verification carries more evidential weight than departure documentation, with design implications for the unloading handshake._

# **1\. What FreightProof Is, and What It Isn’t**

FreightProof is a cargo theft and disputed delivery evidence platform. Its job is to record — in a tamper-proof way — every handshake that takes place during a road freight trip, from the moment a truck arrives at the origin depot to the moment the vehicle waybill is signed at the destination depot. When something goes wrong (a hijacking, a disputed delivery, a missing parcel, a seal broken en route), FreightProof produces an evidence chain that shows exactly what happened, who signed off on what, where the truck was, and when.

The emphasis on evidence matters. FreightProof does not respond to theft in real time. It does not reroute drivers or dispatch armed response. Those are operational responses that belong to the transport operator and their security protocols. FreightProof consolidates evidence from across the fragmented systems that already run each leg of the journey — Pulsit for vehicle tracking, Parcel Perfect for cargo manifests, gate security systems for access control — and anchors a cryptographic proof of that evidence to a public blockchain. When a dispute or investigation arises, even months later, the record is complete, tamper-proof, and legally credible.

## **1.1 What FreightProof does not replace**

Four systems already do specific jobs in the South African logistics industry. FreightProof is designed to work alongside all of them, not duplicate any of them.

|     |     |
| --- | --- |
| **System** | **Its job (FreightProof does not touch this)** |
| Pulsit Tracking | Live GPS map, route visualisation, geofencing and deviation alerts, ETA calculation, historical GPS breadcrumb trail, hardware panic buttons. |
| Parcel Perfect | Consignment and parcel manifest management, warehouse scan-in and scan-out, inventory management, label and waybill printing. |
| IDVS | National identity verification. FreightProof calls IDVS at trip creation to confirm the assigned driver’s identity is still valid; it does not replicate identity data. |
| Gate security systems (Fidelity, C4S, G4S, etc.) | License scanning at precinct gates, driver sign-in and sign-out, document and seal checks at the gate. Each precinct contracts a different security provider; FreightProof does not manage or integrate with these directly in MVP. |

FreightProof sits at the moment where these systems hand off to each other — and currently do so with no unified record. That moment is the handshake. Bruce described the chain in his own words: “From House Waybill level to manifest level to vehicle supplier level there are handshakes that take place within the chain.” Each handshake is a point where cargo changes hands, accountability transfers, and a signature or scan creates a record somewhere. FreightProof’s job is to capture every one of those handshakes, reconcile them, and produce a single evidence chain from them.

# **2\. The Problem FreightProof Solves**

South African logistics is worth R435 billion annually. 84% of freight moves by road. South Africa accounts for roughly 95% of all truck hijackings across the entire EMEA region — approximately 2,000 incidents in 2024, at a direct cost of around R3 billion per year. Cargo insurance premiums account for 12.5% of cost-per-kilogram for road freight.

The underlying problem is not that the industry lacks tools. Pulsit provides real-time GPS. Parcel Perfect manages manifests. IDVS verifies identity. Gate security systems scan licenses at the gate. Every leg of the journey is instrumented. The problem is that all of these systems are disconnected at the moments when it matters: the handover. There is no single integrated record that says: the same driver who was verified by IDVS entered the precinct through the gate security system, loaded the cargo listed on the Parcel Perfect manifest, had the vehicle waybill signed by the warehouse rep, departed with an intact seal, arrived at the destination precinct, and unloaded the exact same cargo to be scanned into Parcel Perfect at the destination.

Without that integrated record, organised theft exploits the gaps directly: fraudulent drivers presenting legitimate-looking paperwork, vehicles substituted mid-route, trailers decoupled and swapped, cargo quantities disputed at delivery with no neutral source of truth to resolve the claim. FreightProof closes those gaps by pulling evidence from the systems that already exist, adding the handshakes that currently happen on paper, and anchoring the whole chain to a blockchain that cannot be altered after the fact.

_The core claim, plainly stated: at every handshake, FreightProof records the right person, in the right vehicle, with the right cargo, at the right place and time. It verifies those facts from multiple independent sources, not from a single point that could be tampered with, and locks the answer permanently to a public blockchain. Every party in the chain either signs the record or has their system-of-record event pulled into it. The insurer, the client, the operator, or a court can verify it months later._

# **3\. Who Uses FreightProof**

Three roles actively use FreightProof. Several others are operational touchpoints whose activity the system observes, captures, or integrates with — but they do not log in.

## **3.1 Users of the system (three roles)**

**Dispatcher**

The dispatcher creates trips, monitors the evidence trail as it accumulates, and investigates exceptions. They use the web application on a desktop or tablet. They are the only role that sees the full system: all active trips, all exceptions, all blockchain receipts, the full trip history, and SLA reporting.

Critically, the dispatcher still uses Pulsit for live route monitoring and geofencing, and still uses Parcel Perfect for manifest management. FreightProof adds a trip creation step, but this is designed to be mostly selection and confirmation rather than re-entry of data. For contractual work (recurring standing arrangements, the bulk of Load Factor’s business), the dispatcher can create a trip from a template in under a minute. For ad-hoc orders — the email-driven kind Bruce described — the dispatcher enters the order number supplied by the client and selects the assigned driver, horse, and trailers. The Pulsit trip reference ID links the two systems.

**Driver**

The driver uses the PWA (Progressive Web App) on their own smartphone throughout the trip. They do not need a separate device. The app works offline and queues events when connectivity drops, which matters for the N3 corridor where signal can be intermittent.

The driver’s role is to be the human presence at every handshake — the common factor who is at the origin gate, at the loading bay, at the destination gate, and at the unloading bay. The app is designed around large touch targets and short, sequential flows. At each handshake, the driver captures what needs to be captured: a photo confirming gate entry, the licence plate thumbnail shown on any relevant screen, a photo of the signed physical vehicle waybill at loading, seal numbers, checkpoint selfies, visual oversight of the unload count, and a photo of the signed physical master POD at delivery. The driver does not scan parcels. The driver does not sign digitally on their own device: the act of capturing evidence artifacts from an authenticated session, with GPS and timestamp logged, is itself the attestation. The driver does, however, have an always-accessible soft panic button.

**Client / Consignee**

The client (typically FedEx or another courier operator) receives a delivery confirmation when their consignment is delivered. If they want to dispute anything, they can access that consignment’s complete evidence chain: every handshake, every system-pulled event, every signed waybill, every blockchain transaction ID. They do not interact with the operational flow at all; their role is purely post-delivery verification, dispute initiation, and — importantly — accessing SLA reports that demonstrate Load Factor’s on-time performance. The client does not log in on MVP; they receive a signed evidence PDF and optionally a deep link to a view-only trip record.

## **3.2 Operational touchpoints (not system users)**

The following roles do not log into FreightProof. The system either observes their activity through integration with their systems of record, or captures it passively through the driver’s device.

|     |     |     |
| --- | --- | --- |
| **Role** | **What they do** | **How FreightProof captures it** |
| Gate guard (Fidelity, G4S, C4S, etc.) | Scans the driver’s license on entry and exit. Checks documents and seal integrity on exit. | MVP: driver photographs licence-scan receipt; Pulsit geofence data provides independent programmatic verification of gate entry/exit. Phase 2: principal SLA data feed replaces manual photo capture. |
| Cargo Handler | Physically loads or unloads parcels, scans them into or out of Parcel Perfect, reconciles count against the manifest. | Captured via Parcel Perfect API. FreightProof polls scan status and pulls the completed manifest. No direct interaction. |
| Cargo Officer / Supervisor | Supervises the load or unload. Signs Load Factor’s physical vehicle waybill at pickup. At destination: receives driver’s waybill copy, checks seals and load body, then hands driver the signed physical master POD. | Captured via photos taken by the driver on the PWA: the signed physical waybill at loading, the signed physical POD at unloading. The paper document remains the legal artifact; FreightProof captures evidence of it alongside the Parcel Perfect manifest. |
| Control-room controllers (Load Factor) | Monitor Pulsit live, investigate deviations, trigger reaction companies when needed. | Not FreightProof users. FreightProof pulls Pulsit deviation events as exceptions in the evidence trail. Controllers’ actions remain in their existing tools. |

_Design principle: the driver is the only human hands-on user at each handshake moment. Every other party either uses their own system (Parcel Perfect, Pulsit, gate security) or signs physically on paper that the driver photographs. This means FreightProof can deploy at a new precinct without needing any new logins, training, or account management for warehouse or security staff — a point Bruce flagged as critical, since “guards are rotated all the time” and warehouse staff already use Parcel Perfect for the scan work that matters._

# **4\. The Journey: Five Handshakes, Start to Finish**

The primary FreightProof flow is Load Factor’s depot-to-depot business: a full truckload from FedEx Johannesburg to FedEx Durban, or any equivalent carrier-to-carrier run. Break-bulk trips (Load Factor’s own branch as the destination) and multi-stop trips (hub-and-spoke, multiple collection or delivery points) are variants of this flow, not separate flows.

A depot-to-depot trip moves through five handshakes. Each handshake produces a signed event, and all events in a trip are ultimately anchored to the Hedera public blockchain as cryptographic proof.

|     |     |     |     |
| --- | --- | --- | --- |
| **#** | **Handshake** | **What gets captured** | **Evidence weight** |
| 0   | Trip Creation | Dispatcher creates trip from order number. Driver, horse, trailer(s), consignment references, Pulsit trip ID, route, and expected gate precincts locked in a journey hash anchored to blockchain. | Baseline commitment |
| 1   | Origin Gate-In | Pulsit geofence confirms vehicle at precinct. Driver photographs gate entry event. GPS cross-reference: phone, horse, each trailer tracker. Driver match confirmed. | Medium — entry confirmed |
| 2   | Loading Handshake | Cargo Handlers load and scan into Parcel Perfect. Warehouse rep signs physical vehicle waybill; driver photographs it. Seal number captured and photographed. Pickup receipt anchored to blockchain. | High — departure signature and seal locked |
| 3   | Origin Gate-Out | Driver photographs gate exit event. Seal verified by guard. Pulsit geofence confirms departure. Trip transitions to in-transit. | Medium — confirmed departure with intact seal |
| 4   | Destination Gate-In | Pulsit geofence confirms vehicle at destination precinct. Driver photographs gate entry. Seal verified unbroken on arrival — highest individual fraud signal. | High — seal-intact confirmation on arrival |
| 5   | Unloading Handshake | Cargo Handlers unload and scan into destination Parcel Perfect. Driver provides waybill copy to receiving handler. Seals broken, load body and doors inspected. Cargo Officer hands driver signed physical master POD; driver photographs it. Three-count reconciliation. Delivery receipt anchored to blockchain. Trip closes. | Highest — arrival verification is primary evidence |

_Design principle — arrival verification is primary: Bruce was explicit that “we rely firstly on the tracking environment at departure e.g. Pulsit and even more so upon arrival as arrival times, seal numbers and the doors and load body of the vehicle is checked.” The evidence chain is deliberately asymmetric. Handshake 5 (unloading) captures more data points and applies stricter validation than Handshake 2 (loading). The departure is the commitment; the arrival is the proof._

Between handshakes, in-transit events (checkpoints, route deviations, exceptions) are captured as they happen. These feed into the evidence trail without being part of the five-handshake sequence. They are covered in Section 5.

|     |     |     |
| --- | --- | --- |
| **Handshake 0** | **Trip Creation** | _Who: Dispatcher_ |

Bruce was explicit: “the journey actually starts by virtue of an order.” The order number is the root reference for everything that follows. It is what the client (FedEx) uses to track the trip, what Load Factor uses to invoice, and what the precinct is told to expect when the driver arrives.

The dispatcher opens FreightProof and creates a trip linked to that order number. For a contractual recurring trip (standing agreement, which is most of Load Factor’s volume), a template auto-fills the client, the route, and the typical vehicle profile. For an ad-hoc order, the dispatcher enters it manually from the email that initiated the job.

**What the dispatcher selects or enters:**

- Order number (from client) — the root reference
- Client and consignment reference(s) from Parcel Perfect
- Assigned driver (from Load Factor’s registered driver list; IDVS verification is rerun at this point to confirm the driver’s identity is still valid)
- Assigned horse (truck cab) and trailer(s) — each with its own Pulsit tracker device ID
- Pulsit trip reference ID (the trip the dispatcher has already created in Pulsit)
- Expected origin and destination precincts — associated with the principal (e.g. FedEx), not with a specific security company
- Planned route and slot times (pulled from Parcel Perfect)

The horse and trailer are modelled as separate entities. An 18-metre vehicle is registered as one horse and two trailers (12-metre and 6-metre). Trailers can be decoupled and reassigned mid-route, so each trailer has its own Pulsit tracker device ID and is verified independently at every gate check. Any mid-route substitution becomes a visible exception in the evidence trail rather than an invisible operational adjustment — which is precisely the Ragel subcontractor fraud scenario this model is designed to detect.

On submission, FreightProof creates a journey lock hash — a cryptographic snapshot of everything committed to this trip (order number, driver, vehicles, cargo references, route, precinct gates, timestamps) — and anchors it to Hedera HCS. From this moment, anything that deviates from the committed trip is recorded as an exception. In parallel, FreightProof sends a pre-notification to the origin precinct — addressed to the principal’s contact, not to the security company directly — confirming expected driver, vehicle, and arrival time. This is standard practice today (currently by email); FreightProof formalises it and captures it as part of the evidence chain.

|     |     |     |
| --- | --- | --- |
| **Handshake 1** | **Origin Gate-In** | _Who: Driver + Gate Security + System_ |

The driver arrives at the origin precinct. The gate security provider on duty (which may be Fidelity, C4S, G4S, or any in-house team contracted by the principal at that location) scans the driver’s license on their own system. This is the authentication event — not something FreightProof performs, but something FreightProof records.

Pulsit’s geofence data is the primary programmatic verification that the vehicle has entered the precinct. The driver’s phone GPS, the horse tracker GPS, and each trailer tracker GPS must all agree within tolerance against the expected precinct coordinates. This cross-reference is independent of whichever security company is operating the gate.

The driver taps “Log gate entry” on their PWA. The app captures a photo confirming the gate entry event, the driver’s phone GPS, and a timestamp. The system runs three checks in parallel:

- Vehicle check: Pulsit is queried for the registered tracker device IDs of the horse and each trailer. All must be active at the origin precinct coordinates.
- GPS cross-reference: driver phone GPS, horse tracker GPS, and each trailer tracker GPS compared against expected precinct coordinates.
- Trip match: the driver’s identity confirmed against the trip assignment.

If any check fails, the dispatcher receives an alert with the specific failure. The driver proceeds only after dispatcher override or resolution. In the nominal case, the gate-in event is recorded as a feeder to the loading handshake that follows — it is not itself anchored to blockchain, because it is not yet a signed record. It becomes part of Handshake 2’s anchored event.

One important nuance: there are scenarios where the trailer is already at the loading bay and the driver arrives later to hook up and depart. In this case, the driver’s gate-in happens before Handshake 2 but the trailer check is skipped (because the trailer is already inside the precinct). When the driver departs (Handshake 3), the trailer tracker is verified as part of that exit. The system handles this as a variant of Handshake 1, not an exception.

|     |     |     |
| --- | --- | --- |
| **Handshake 2** | **Loading Handshake** | _Who: Driver + Cargo Officer + System_ |

The driver proceeds to the assigned loading bay. Cargo Handlers load the truck and scan parcels into Parcel Perfect as they load — this is their existing workflow, entirely unchanged. FreightProof polls Parcel Perfect’s API for the scan-out status of the consignment referenced in the trip. There are three possible states:

- Loading complete: all parcels scanned out. FreightProof pulls the full manifest and presents it to the driver.
- Loading in progress: a partial scan list is available. The driver sees current status; the system re-polls every few minutes.
- Not started: the driver sees “waiting for warehouse” and cannot proceed to sign-off.

Once loading is complete, the full parcel manifest appears on the driver’s phone, grouped by delivery stop, with quantities and any flagged discrepancies. Any parcel in the original consignment that was not scanned out is already flagged before the truck is sealed. The driver visually confirms the count against what was physically loaded.

The Cargo Officer signs Load Factor’s physical vehicle waybill in pen, as they do today. FreightProof does not replace this physical document. The driver captures a photo of the signed waybill on the PWA. That photo, combined with the Parcel Perfect manifest pulled automatically from the API, forms the evidence: what the system of record says was loaded, and what was physically signed for.

The driver then captures the seal number and photographs the sealed trailer door. The seal number is recorded on the vehicle waybill. A broken or substituted seal at delivery is the clearest possible fraud signal, and capturing the number at pickup is what makes that signal meaningful.

At this point, FreightProof assembles the pickup event: the gate-in data from Handshake 1, the Parcel Perfect manifest, the photo of the signed physical waybill, the seal number and photo, and the GPS and timestamp of each sub-event. The driver taps “Complete Loading Handshake” to advance the trip state; this action, from the driver’s authenticated session, is the driver’s attestation. A SHA-256 hash of the complete pickup event is submitted to Hedera HCS. This is the pickup blockchain receipt. The hash is on-chain; the actual data stays in FreightProof’s database (POPIA compliance by design: no personal data goes to the blockchain). From this point, the pickup record is tamper-proof.

|     |     |     |
| --- | --- | --- |
| **Handshake 3** | **Origin Gate-Out** | _Who: Driver + Gate Security + System_ |

The truck, now loaded and sealed, proceeds to the precinct exit gate. The gate guard verifies the seal number against the vehicle documents. The driver taps “Log gate exit” on the PWA and captures a photo confirming the gate exit event, the seal number as verified by the guard, and the GPS and timestamp. Pulsit’s geofence data confirms vehicle departure from the precinct.

At this moment, the trip transitions to in-transit state. The journey lock hash locks the vehicle, driver, cargo, and seal as a fixed combination. Any deviation from that combination — a trailer tracker that goes silent, a GPS that leaves the committed route, a seal number that doesn’t match at the destination — will be flagged as an exception.

Bruce confirmed one edge case: if the driver is replaced mid-trip (illness, duty hours, unforeseen circumstances), Load Factor notifies the gate of the substitute driver’s details in advance, and the substitute driver is rescanned at the next gate event. FreightProof handles this as a driver substitution exception attached to the trip, with the substitution event itself anchored to blockchain. The trip continues; the substitution is evidence, not a failure.

|     |     |     |
| --- | --- | --- |
| **In-Transit** | **Checkpoints, Deviations, Exceptions** | _Driver + Pulsit_ |

**Checkpoints.**

At fuel stops and rest stops, the driver logs a checkpoint from the PWA. This captures a timestamped selfie, the driver’s phone GPS, and an optional photo of the sealed cargo area. Checkpoints are batched: multiple checkpoints across a long trip are combined as a Merkle root and anchored to Hedera once per day or per trip, rather than individually. This keeps blockchain costs down while maintaining a verifiable trail. If the vehicle is stationary for more than 15 minutes without a logged checkpoint, the app prompts the driver.

**Pulsit deviation pull.**

Pulsit continues monitoring the route and geofencing entirely independently. If the truck deviates from the assigned route, breaches a geofence, or exhibits unusual behaviour, Pulsit generates an alert in Load Factor’s control room. FreightProof pulls that alert event from Pulsit and records it as an exception on the trip’s evidence trail, capturing the exact timestamp, GPS coordinates, and route reference. “Vehicle left the N3 at Mooi River at 14:37 and did not return to route” is the kind of record that an insurer or criminal investigator needs.

**Soft panic button.**

The driver’s PWA has an always-accessible panic button. Activation immediately logs GPS, timestamp, and the trip state to FreightProof, triggers an urgent dispatcher alert, and creates an exception on the trip record. This complements, rather than replaces, the hardware panic buttons that already exist in the truck.

**Document upload.**

At any point during the trip, the driver or dispatcher can attach documents to the trip record: photos of cargo damage, signed side-of-road inspection reports, incident photos, or anything else that supports the evidence trail. These are hashed and attached as Merkle leaves in the daily batch.

|     |     |     |
| --- | --- | --- |
| **Handshake 4** | **Destination Gate-In** | _Who: Driver + Destination Gate Security + System_ |

The truck arrives at the destination precinct (in this example, FedEx Durban). The gate security provider at this location may be different from the origin — this is irrelevant to FreightProof, because the SLA is with the principal (FedEx), not with the security company.

Pulsit’s geofence data confirms vehicle arrival at the destination precinct. The guard scans the driver’s license on their own system. The driver taps “Log destination gate entry” and captures a photo confirming the gate entry event, the seal number as verified by the guard on entry (critical: this is where seal-intact verification happens), GPS, and timestamp. If the seal number on arrival does not match the seal number captured at origin, this is an immediate high-priority exception — the strongest possible signal that the cargo may have been accessed in transit.

|     |     |     |
| --- | --- | --- |
| **Handshake 5** | **Unloading Handshake** | _Who: Driver + Cargo Officer + System_ |

_This handshake carries the greatest evidential weight. Bruce: “we rely firstly on the tracking environment at departure e.g. Pulsit and even more so upon arrival as arrival times, seal numbers and the doors and load body of the vehicle is checked.” The unloading handshake is the primary proof that a trip was completed correctly._

At the unloading bay, the process follows a specific two-way document exchange sequence that Bruce described precisely:

- Driver hands their copy of the trip waybill to the receiving cargo handler.
- The cargo handler and cargo officer break the seals, open the truck, and inspect the load body and doors.
- Cargo Handlers unload and scan parcels into the destination Parcel Perfect system. The driver’s role is visual oversight — counting against what was loaded, watching that the cargo officer scans each parcel into the warehouse.
- Once the load is reconciled and the cargo officer is satisfied, they hand the driver the signed physical master POD.
- Driver photographs the signed POD on the PWA.

FreightProof reconciles three counts automatically as the scan-in completes:

- The manifest count signed off at origin (Handshake 2)
- The scan-in count at destination (from destination Parcel Perfect)
- The driver’s visual count as the truck is unloaded

If all three agree, the Cargo Officer hands the driver the signed physical master POD. This is Load Factor’s proof that the depot-to-depot trip was completed successfully, and it is the document Load Factor invoices FedEx against. FreightProof does not replace this physical document. The driver photographs it.

If any count is short — Bruce’s own example: “100 parcels scanned into this container in Joburg and only 99 received in Durban” — the system flags the exception and records the last confirmed checkpoint location of any missing parcel. The dispatcher, the client, and the insurer all see the discrepancy immediately. The POD can still be signed (short-delivered), but the exception is permanent in the evidence chain.

The driver taps “Complete Unloading Handshake” to advance the trip to closed state. The delivery event — comprising destination gate-in data, Parcel Perfect reconciliation, POD photo, seal verification, load body inspection confirmation, and full GPS/timestamp metadata — is hashed and anchored to Hedera HCS. This is the delivery blockchain receipt. The trip is now closed from FreightProof’s evidentiary perspective.

The physical exit gate-out at the destination is not captured by FreightProof. The truck, now empty, leaves through the same gate it entered. No evidence is added by this event. The gate security system will log it anyway in its own records.

# **5\. Exceptions**

Exceptions are not a phase in the journey. They are a cross-cutting layer that can fire at any point — during a handshake, in-transit, or triggered by a driver action. Every exception is captured with timestamp, GPS, source (system or human), and supporting data, and is batched into the daily Merkle root anchored to Hedera. The dispatcher sees exceptions in real time on the dashboard; the client sees them in the final evidence PDF.

## **5.1 System-detected exceptions**

These fire automatically from data, with no human action required.

- Seal number mismatch between pickup capture (Handshake 2) and destination arrival (Handshake 4) or unloading (Handshake 5)
- Parcel count mismatch between origin manifest and destination scan-in
- GPS mismatch between driver phone, horse tracker, and trailer tracker(s) at any handshake
- Route deviation or geofence breach pulled from Pulsit
- Vehicle or trailer substitution: tracker device ID changes from the committed assignment
- Driver substitution at any gate: license scan does not match trip assignment and no substitution event was pre-notified
- Checkpoint timeout: vehicle stationary >15 minutes without a logged checkpoint
- Waybill count signed by warehouse rep does not match Parcel Perfect manifest count
- Handshake out of sequence: events logged in an order that violates the expected flow

## **5.2 Driver-raised exceptions**

- Soft panic button activation (hijacking, security incident)
- Delivery refused or no one at the receiving warehouse
- Cargo damage observed at pickup or en route
- Seal found broken mid-trip (e.g. at a fuel stop during checkpoint)
- Mechanical breakdown or delay
- Document upload with flag for dispatcher review

## **5.3 Dispatcher-raised exceptions**

- Driver substitution approval (pre-notified to gate)
- Acknowledgement of Pulsit deviation after controller investigation
- Manual note on a live incident (details, actions taken, outcome)
- Escalation flag for insurance review
- Trip hold or resume for operational reasons

_Design principle: exceptions do not block the trip from progressing. The system records the exception, flags it, and continues — unless the dispatcher explicitly halts the trip. This matches how Load Factor actually operates. A geofence breach today does not stop the truck; it triggers controller investigation. FreightProof’s job is to record the investigation and its outcome, not to arrest the trip. The exception to this principle is the hard failure of Handshake 2 (no manifest available) or a seal-intact failure at destination gate-in, both of which require dispatcher override before the trip can proceed._

# **6\. What the Dispatcher Sees in FreightProof**

The dispatcher’s dashboard is the operational nerve centre of FreightProof. It does not replace Pulsit or Parcel Perfect — those systems are still used for their respective jobs — but it provides a unified view of the evidence trail across all active trips, a searchable history of every completed trip, and SLA reporting that Bruce flagged as a commercial sales tool.

## **6.1 Active trip view**

Each active trip shows a timeline of events: trip created, gate-in cleared, loading complete and signed, gate-out with seal verified, checkpoints logged, deviations flagged, destination gate-in with seal verified, unloading reconciled, POD signed. Each event links to its full detail: the data captured, the signatures applied, the blockchain receipt. Exceptions are flagged inline with a clear reason.

The dispatcher does not see a live map in FreightProof. The live map lives in Pulsit. FreightProof shows the GPS coordinates recorded at each event as text and timestamps, not a tracking feed.

## **6.2 Trip history and search**

Every completed trip is stored and searchable. The dispatcher can filter by date range, driver, vehicle (horse or trailer), route, client, order number, and exception type. A disputed delivery from three months ago is resolved by pulling the trip record, not by relying on human memory or paper records that may have been lost or altered.

## **6.3 SLA reporting**

Bruce was explicit that SLA data has commercial value beyond operations: “if I can prove a 97%+ service record to a prospective client like Aramex, the FreightProof report becomes a sales tool, not just an operational one.” FreightProof includes an SLA dashboard that aggregates trip data against configurable service commitments — on-time pickup, on-time delivery, handshake completion rates, exception rates by type and by route. The dispatcher can export an SLA report for any client over any date range, branded and ready to present.

## **6.4 Example trip timeline**

_Trip #TRP-2026-0041 | ORDER: FDX-JHB-DBN-8821 | JHB → DBN | Driver: S. Dlamini | Horse: CA 123-456 | Trailer: TR-991_

_STATUS: IN TRANSIT_

_08:14 Trip created by dispatcher A. Dlamini — Journey lock hash anchored_

_09:02 Handshake 1: Origin gate-in CLEARED | Linbro Park | Pulsit geofence confirmed | Driver match confirmed_

_09:47 Handshake 2: 14 / 14 parcels loaded | Waybill photographed (warehouse rep: J. Ndlovu) | Seal SL-7741 captured | Pickup receipt anchored_

_10:05 Handshake 3: Origin gate-out CLEARED | Seal SL-7741 verified by guard | Pulsit geofence departure confirmed | Trip in-transit_

_13:22 Checkpoint logged | N3 Tugela Plaza | GPS confirmed across phone + horse tracker_

_14:37 EXCEPTION: Route deviation from Pulsit | Vehicle left N3 at Mooi River_

_14:52 Deviation resolved: vehicle returned to route | Controller note attached_

_16:30 Handshake 4: Destination gate-in PENDING | FedEx Durban_

# **7\. What FreightProof Owns vs What Stays in Other Systems**

|     |     |
| --- | --- |
| **FreightProof does** | **Stays in the existing system** |
| Trip creation and driver/vehicle/cargo assignment tied to an order number | Route planning, geofencing, ETA (Pulsit) |
| Handshake capture at all five points (photos, waybill photos, seal numbers) | Live GPS map and tracking (Pulsit) |
| Parcel manifest reconciliation across origin and destination Parcel Perfect instances | Parcel-level scan-in and scan-out (Parcel Perfect) |
| Seal capture at pickup and seal verification at delivery | Driver license scanning at precinct gates (Fidelity, G4S, C4S, etc.) |
| Pulsit deviation events logged as exceptions in the evidence trail | Live controller response to deviations (Load Factor control room) |
| Checkpoint trail with selfie, GPS, and cargo photos | Historical GPS breadcrumb (Pulsit) |
| Soft panic button in the driver’s PWA | Hardware panic buttons in the truck (Pulsit/reaction company) |
| Blockchain anchoring of handshake hashes to Hedera HCS | National identity data (IDVS) |
| SLA dashboards and client-facing evidence reports | Financial invoicing and credit management (Load Factor finance) |
| Dispute evidence access and trip history search | Insurance claim processing (insurer systems) |

# **8\. What Data FreightProof Pulls from Each System**

FreightProof does not replicate external systems. It queries them at specific moments to verify specific facts. Each integration is narrow, purposeful, and event-triggered.

## **8.1 From Parcel Perfect**

Parcel Perfect is queried at trip creation, at the loading handshake, and at the unloading handshake. The origin and destination may be separate Parcel Perfect instances with separate API credentials (branch-level isolation is common).

|     |     |
| --- | --- |
| **Data requested** | **When and why** |
| Consignment record (ID, client, origin, destination, parcel count, declared value) | Trip creation: establishes what is committed to the trip |
| Parcel-level manifest (barcode, description, delivery stop assignment) | Loading handshake: pulled when loading is confirmed complete; attached to the signed waybill |
| Scan-in status at destination | Unloading handshake: reconciled against origin manifest; the fundamental count check |
| Slot times per leg | Trip creation: captured for SLA reporting |
| Delivery stop details (where multi-stop) | Trip creation: enables independent verification at each stop |

## **8.2 From Pulsit Tracking**

|     |     |
| --- | --- |
| **Data requested** | **When and why** |
| Device ID to vehicle registration mapping (one per horse, one per trailer) | Trip creation and at each gate handshake: confirms the physical vehicle matches the assignment, including trailer-level verification |
| Geofence entry/exit events for precinct coordinates | Each gate handshake: primary programmatic confirmation that vehicle is at the correct precinct. Used alongside driver photo capture for gate-in and gate-out events. |
| Point-in-time GPS for a given device ID | Each gate handshake: used in GPS cross-reference check |
| Route deviation and geofence breach events | Continuously during transit: recorded as exceptions in the FreightProof evidence trail |
| GPS coordinates at checkpoint timestamps | Checkpoint logging: cross-references driver phone GPS against fleet tracker position |
| Pulsit trip reference ID (linked, not created) | Trip creation: the dispatcher creates the Pulsit trip as normal; FreightProof captures the reference for later lookups |

## **8.3 From IDVS**

IDVS is queried at trip creation to re-verify the assigned driver’s identity. The call returns a simple match/no-match result. Personal data is not stored in FreightProof beyond what is needed for display; the identity verification itself lives in IDVS.

## **8.4 From gate security systems — principal SLA model**

FreightProof does not integrate with individual gate security providers (Fidelity, G4S, C4S, etc.) in MVP or Phase 2. This was a key clarification from Bruce: the relevant agreement is between FreightProof and the principal (FedEx, The Courier Guy), not between FreightProof and whichever security company operates at a given location.

Under this model, the precinct entity in FreightProof stores which principal governs it, not which security company operates the gate. A national operator like FedEx may use Fidelity at one branch and G4S at another; a regional operator like The Courier Guy may use different local providers in each city. FreightProof does not need to know or care which security company is on duty — the data exchange SLA with the principal covers all locations under that principal’s contract.

|     |     |
| --- | --- |
| **Gate data source** | **Role in the evidence chain** |
| MVP: driver photo of gate entry/exit event | Human-captured evidence that the scan happened, with GPS and timestamp automatically appended by the PWA |
| Pulsit geofence data (primary programmatic check) | System-to-system confirmation that vehicle entered or exited the precinct coordinates, independent of any security company system |
| Phase 2: principal data feed via SLA | Direct data exchange between FreightProof and the principal (e.g. FedEx), replacing manual photo capture. The principal is responsible for exchanging this data regardless of which security company operates at each of their sites. |
| Phase 2: guard pre-notification | FreightProof pushes trip details (ETA, vehicle, driver, seal numbers) to the precinct via the principal SLA. Guard confirms arrival on their device (“yes, all good” or “no, there is a problem”). Problems trigger appropriate exceptions in the evidence trail. |

# **9\. Why the Design Works: Corruption Resistance**

The most important design principle in FreightProof is that no single data source can be corrupted to produce a false record. Verification at every handshake draws from multiple independent sources simultaneously. To fabricate a clean pickup receipt, an attacker would need to simultaneously manipulate:

- The IDVS identity match result for the assigned driver
- The Pulsit tracker device IDs assigned to the horse and each trailer
- The GPS coordinates reported by multiple independent tracker hardware units
- The GPS coordinates on the driver’s phone
- The Pulsit geofence confirmation of precinct entry/exit
- The known coordinates of the origin precinct (not under attacker control)
- The cargo manifest in Parcel Perfect (with a separate instance at the destination)
- The physical seal number recorded at origin and verified at destination
- The photographed physical vehicle waybill (warehouse rep’s ink signature) at origin
- The photographed physical POD at destination (with load body and door inspection)
- The SHA-256 hash anchored to Hedera HCS, which is publicly verifiable and immutable

Each of these is independently controlled by a different party or system. Compromising any one is insufficient. This is not an accident of architecture; it is the deliberate design principle that makes FreightProof meaningful as evidence rather than just as a digital form.

The blockchain layer (Hedera HCS) is the final guarantee. It does not store personal data — only the hash of each event goes on-chain, with the actual data remaining in FreightProof’s database (POPIA compliance by design). But the hash means the data cannot be altered after anchoring. A FreightProof record from six months ago that matches its Hedera transaction hash is provably unaltered. That is the legal and commercial value of the system.

# **10\. What Is Deliberately Out of Scope for MVP**

The following were considered and deliberately excluded from the initial build. Each exclusion has a specific justification grounded in MVP focus and the resource constraints of a four-person honours team.

|     |     |
| --- | --- |
| **Excluded** | **Why** |
| Direct integration with individual gate security providers | The principal SLA model means FreightProof never needs to integrate with Fidelity, G4S, C4S, or others individually. MVP captures gate events via driver photo + Pulsit geofence. Phase 2 is a principal data feed, not a per-provider integration. |
| NFC passive parcel scanning at truck doors | Valuable Phase 2 addition; requires hardware at loading bays and is outside MVP scope. |
| IPFS / Pinata for evidence storage | A SHA-256 hash anchored to Hedera provides tamper-evidence regardless of where underlying data is stored. Adds no integrity guarantee while adding risk. |
| WhatsApp Business API for notifications | Meta approval process is slow and uncertain; SMS and email are sufficient for MVP notifications. |
| React Native native mobile apps | PWA with Serwist covers driver use cases offline. Three simultaneous mobile strategies exceed team capacity. |
| Cross-border and Ragel subcontractor flows | Load Factor on the JHB-DBN corridor is the MVP beachhead. Ragel’s multi-subcontractor architecture is Phase 2. |
| Live map inside FreightProof | Pulsit already does this well. Evidence trail with GPS coordinates is sufficient for MVP. |
| Last-mile OTP-to-consignee flow | Depot-to-depot is the MVP primary flow. The OTP model for named consignees is retained in the data model for Phase 2. |
| Client self-service portal | MVP clients receive signed evidence PDFs and optional deep-link to a view-only trip record. Full self-service portal is Phase 2. |
| Last-mile delivery waybill reconciliation | FreightProof’s chain of custody ends at the destination warehouse handover. The separate last-mile delivery waybills (individual FedEx driver taking multiple consignees on final delivery in a small vehicle) are FedEx’s product, not Load Factor’s. |

# **11\. The Two PODs: What’s in Scope and What Isn’t**

In Bruce’s description of how the manifest and POD system works, two distinct proofs of delivery are in play. Understanding which one FreightProof produces, and which it deliberately does not, is important — both for scope clarity and for positioning the evidence output correctly.

## **11.1 The two PODs**

|     |     |     |
| --- | --- | --- |
| **POD** | **What it covers** | **Whose product is it?** |
| Depot-to-depot POD (Load Factor’s POD) | The truck and its cargo, from origin depot (FedEx JHB) to destination depot (FedEx DBN). Signed by the destination Cargo Officer when the truck is unloaded, seals checked, and load body inspected. | Load Factor’s. This is what Load Factor invoices FedEx against. |
| Door-to-door POD (FedEx’s POD) | Each of the hundred-plus parcels, from the original sender’s door (first mile) through Load Factor’s truck (middle mile) to the final recipient’s door (last mile). One POD per parcel per end-customer. | FedEx’s. This is what FedEx invoices their end-customers against. |

## **11.2 The trunk haul manifest boundary**

Bruce clarified that the manifest at the destination is the trunk haul manifest — the load that came off Load Factor’s truck. The last-mile delivery waybills are separate: a FedEx driver may take four shipments to four different consignees in a small van. Those four last-mile delivery waybills, each signed by an end-customer, are FedEx’s product.

FreightProof’s chain of custody ends at the destination warehouse handover. The destination cargo officer reconciles the trunk haul manifest and signs the depot-to-depot POD. FreightProof captures and anchors that event. What happens after — the individual parcels being dispatched to their final consignees — is outside FreightProof’s scope and outside Load Factor’s chain of custody.

## **11.3 Why FreightProof only produces the depot-to-depot POD**

Three reasons support this scope boundary:

First, we are not the operator for the first or last mile. Those events happen in FedEx’s systems. Producing a full-journey POD would require integrations that sit outside our reach.

Second, the evidentiary strength of our middle-mile chain depends on the integrity-resistance properties of our capture process: multi-source GPS cross-reference, physical seal capture, blockchain anchoring, independent system-of-record reconciliation. Extending to the first and last mile would include events outside our verification envelope. The story “we can prove our part of the chain is tamper-proof” is cleaner than “we can stitch together evidence of varying quality.”

Third, the door-to-door POD is FedEx’s commercial product, not Load Factor’s. The beachhead strategy is to sell FreightProof to Load Factor as the vehicle supplier in the chain. Giving FedEx’s end-customers a door-to-door evidence chain is a Phase 2 opportunity.

## **11.4 How the evidence output fits into FedEx’s door-to-door workflow**

Even though FreightProof does not produce the door-to-door POD, the evidence output is keyed by consignment reference — the same reference that FedEx uses in Parcel Perfect to track each of their end-customer parcels. When FedEx accesses a consignment’s evidence from FreightProof, they can file it directly alongside their own door-to-door POD for that consignment, without reformatting. The middle-mile evidence and the first-and-last-mile evidence are complementary halves of what an end-customer or their insurer needs.

# **12\. Appendix: Key Changes by Version**

This appendix summarises what changed between major versions and why, for team reference.

## **12.1 v4 → v5 changes (Bruce van Wyk Q&A, April 2026)**

|     |     |     |
| --- | --- | --- |
| **Section affected** | **Change type** | **What changed** |
| Gate security model / Precinct entity | Reframe | SLA is with the principal (FedEx, The Courier Guy), not with the security company. Security company identity is irrelevant to FreightProof. Precinct entity stores which principal governs it. |
| Gate-in/gate-out verification | Strengthen | Pulsit geofence data is now stated as the primary programmatic check for gate entry/exit. Driver photo remains as human-captured evidence; Pulsit geofence is the system-level corroboration. |
| Waybill capture | Confirmed, no change | Driver photographs the physical vehicle waybill. Confirmed as correct and unchanged. |
| Unloading handshake / POD flow | Update | Documented as a two-way exchange: driver hands waybill copy to receiving handler → seals checked, load body and doors inspected → driver receives signed POD. This is not a one-way capture; it is a sequential exchange with inspection in the middle. |
| Manifest scope | Clarify | FreightProof covers the trunk haul manifest only. Last-mile delivery waybills (multiple consignees on a small van) are FedEx’s product and out of scope. Chain of custody ends at destination warehouse handover. |
| Seal verification + Phase 2 vision | Add | Phase 2 design target: guard pre-notification via principal SLA. FreightProof pushes trip details (ETA, vehicle, driver, seals) to the precinct; guard confirms or raises exception. This replaces manual photo capture and aligns with the principal SLA model. |
| Design principles | Add | Arrival verification carries more evidential weight than departure documentation. Handshake 5 captures more data points and applies stricter validation than Handshake 2. This is an explicit design principle, not just an operational observation. |

## **12.2 v3 → v4 changes (summarised)**

|     |     |
| --- | --- |
| **What changed** | **Summary** |
| Driver digital signature | Removed. Authenticated capture action with GPS and timestamp is the attestation. Touchscreen signature added ceremony without evidence weight. |
| Warehouse rep sign-off | Driver photographs the signed physical waybill. No digital co-sign on driver’s screen. Paper document remains the legal artifact. |
| Cargo Officer / POD sign-off | Cargo Officer hands driver the signed physical master POD (as Bruce described). Driver photographs it. |
| Driver role at unloading | Visual oversight only, matching Bruce’s description: counting and watching the cargo officer scan. |
| Door-to-door POD scope | Section 11 added. FreightProof produces only Load Factor’s depot-to-depot POD. FedEx’s door-to-door POD is explicitly out of scope. |
| Order as root entity | Order number from the client is the root reference. Trip is an instance of fulfilling an order. |
| Seal capture | Seal number captured at Handshake 2, verified at Handshakes 3, 4, and 5. Mismatch is a high-priority exception. |

## **12.3 v2 → v3 changes (summarised)**

|     |     |
| --- | --- |
| **What changed** | **Summary** |
| Guard role | Guards are not system users. They operate gate security systems (Fidelity, G4S). FreightProof observes the scan event. |
| Driver parcel rescan | Removed. Bruce rejected this. Reconciliation is system-to-system via Parcel Perfect. |
| Receiver OTP model | Removed for depot-to-depot. OTP retained in data model for last-mile / named-consignee variants. |
| Soft panic button | Restored. Always-accessible in the PWA. Triggers immediate dispatcher alert plus blockchain-anchored exception. |
| Document upload | Restored. Driver and dispatcher can attach documents; hashed into daily Merkle batch. |
| SLA reporting | Promoted to first-class dispatcher capability, per Bruce’s framing of SLA data as a commercial sales tool. |