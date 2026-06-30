# FreightProof SA

The Full Picture — v7

A complete walkthrough of what FreightProof is, who uses it, how every handshake in a depot-to-depot trip works, and how the system connects to Pulsit, Parcel Perfect, and the gate security systems that already run South African logistics precincts.

UCT INF4027W Honours Project | 2026

Ciaran Formby, Tim Gultig, Chiko Kasongo, Tom Davis

**What changed from v6:** Nine targeted updates based on Bruce van Wyk's meeting of 24 June 2026, plus a new section reflecting the current codebase state.

1. **Driver sees only the linehaul document, never the manifest (Sections 3.1, Handshake 2, 8.1) — critical correction.** The driver must never see cargo contents or per-parcel data. The driver's document is the linehaul: vehicle type/configuration, seal numbers, registration, driver details, and a consolidated unit count. The full manifest goes dispatcher-only. Previous v6 text that described "the full parcel manifest appears on the driver's phone, grouped by delivery stop" has been removed.

2. **Multi-client per trip confirmed as standard practice (Section 4).** Multiple clients on one truck is the normal break-bulk/break-box operating model, not an edge case. Explicitly designed for.

3. **Two service models formalised (Section 4.1).** Scheduled break-bulk (clients bring freight to the LFG facility) and ad-hoc collection (truck visits client sites) both fold into the multi-stop model. Both are in scope.

4. **Loading order and priority added (Handshake 2, Section 6.1).** Loading sequence is determined by urgency, yield, and client priority. The dispatcher sees loading order; this affects arrival processing at the destination.

5. **Load configuration and weight management added (Section 9).** Trimming the load (rear-axle weight distribution), maximum legal vehicle weight, weigh bridge compliance, and the responsibility model (FedEx bears cost of non-compliance) are domain-critical context. New section.

6. **Return legs clarified (Section 10).** A return leg is a new trip, not a continuation of the outbound trip. Empty-leg visibility for management and rotation planning are explicit requirements. Scheduling returns is out of scope for iteration 2.

7. **Parcel Perfect API access model updated (Section 8.1).** Three-party negotiation required: FreightProof + FedEx (PP's paying customer) + Parcel Perfect. FreightProof only reads — no writes, no competitive threat. Post-iteration-2 priority.

8. **Camera integration added to Phase 2 (Section 12).** Vehicle onboard camera access on exceptions, and 5-minute pre/post clip saving on exception events — Bruce has raised this with Pulsit.

9. **Where the Codebase Stands added (Section 14).** New section describing what is built, what is in progress, and what is not yet modelled.

---

# 1. What FreightProof Is, and What It Isn't

FreightProof is a cargo theft and disputed delivery evidence platform. Its job is to record — in a tamper-proof way — every handshake that takes place during a road freight trip, from the moment a truck arrives at the origin depot to the moment the vehicle waybill is signed at the destination depot. When something goes wrong (a hijacking, a disputed delivery, a missing parcel, a seal broken en route), FreightProof produces an evidence chain that shows exactly what happened, who signed off on what, where the truck was, and when.

The emphasis on evidence matters. FreightProof does not respond to theft in real time. It does not reroute drivers or dispatch armed response. Those are operational responses that belong to the transport operator and their security protocols. FreightProof consolidates evidence from across the fragmented systems that already run each leg of the journey — Pulsit for vehicle tracking, Parcel Perfect for cargo manifests, gate security systems for access control — and anchors a cryptographic proof of that evidence to a public blockchain. When a dispute or investigation arises, even months later, the record is complete, tamper-proof, and legally credible.

## 1.1 What FreightProof does not replace

Four systems already do specific jobs in the South African logistics industry. FreightProof is designed to work alongside all of them, not duplicate any of them.

| System | Its job (FreightProof does not touch this) |
|---|---|
| Pulsit Tracking | Live GPS map, route visualisation, geofencing and deviation alerts, ETA calculation, historical GPS breadcrumb trail, hardware panic buttons. |
| Parcel Perfect | Consignment and parcel manifest management, warehouse scan-in and scan-out, inventory management, label and waybill printing. |
| IDVS | National identity verification. FreightProof calls IDVS at trip creation to confirm the assigned driver's identity is still valid; it does not replicate identity data. |
| Gate security systems (Fidelity, C4S, G4S, etc.) | Licence scanning at precinct gates, driver sign-in and sign-out, document and seal checks at the gate. Each precinct contracts a different security provider; FreightProof does not manage or integrate with these directly in MVP. |

FreightProof sits at the moment where these systems hand off to each other — and currently do so with no unified record. That moment is the handshake. Bruce described the chain in his own words: "From House Waybill level to manifest level to vehicle supplier level there are handshakes that take place within the chain." Each handshake is a point where cargo changes hands, accountability transfers, and a signature or scan creates a record somewhere. FreightProof's job is to capture every one of those handshakes, reconcile them, and produce a single evidence chain from them.

---

# 2. The Problem FreightProof Solves

South African logistics is worth R435 billion annually. 84% of freight moves by road. South Africa accounts for roughly 95% of all truck hijackings across the entire EMEA region — approximately 2,000 incidents in 2024, at a direct cost of around R3 billion per year. Cargo insurance premiums account for 12.5% of cost-per-kilogram for road freight.

The underlying problem is not that the industry lacks tools. Pulsit provides real-time GPS. Parcel Perfect manages manifests. IDVS verifies identity. Gate security systems scan licences at the gate. Every leg of the journey is instrumented. The problem is that all of these systems are disconnected at the moments when it matters: the handover. There is no single integrated record that says: the same driver who was verified by IDVS entered the precinct through the gate security system, loaded the cargo listed on the Parcel Perfect manifest, had the vehicle waybill signed by the warehouse rep, departed with an intact seal, arrived at the destination precinct, and unloaded the exact same cargo to be scanned into Parcel Perfect at the destination.

Without that integrated record, organised theft exploits the gaps directly: fraudulent drivers presenting legitimate-looking paperwork, vehicles substituted mid-route, trailers decoupled and swapped, cargo quantities disputed at delivery with no neutral source of truth to resolve the claim. FreightProof closes those gaps by pulling evidence from the systems that already exist, adding the handshakes that currently happen on paper, and anchoring the whole chain to a blockchain that cannot be altered after the fact.

The core claim, plainly stated: at every handshake, FreightProof records the right person, in the right vehicle, with the right cargo, at the right place and time. It verifies those facts from multiple independent sources, not from a single point that could be tampered with, and locks the answer permanently to a public blockchain. Every party in the chain either signs the record or has their system-of-record event pulled into it. The insurer, the client, the operator, or a court can verify it months later.

---

# 3. Who Uses FreightProof

Three roles actively use FreightProof. Several others are operational touchpoints whose activity the system observes, captures, or integrates with — but they do not log in.

## 3.1 Users of the system (three roles)

### Dispatcher

The dispatcher creates trips, monitors the evidence trail as it accumulates, and investigates exceptions. They use the web application on a desktop or tablet. They are the only role that sees the full system: all active trips, all exceptions, all blockchain receipts, the full trip history, and SLA reporting.

Critically, the dispatcher still uses Pulsit for live route monitoring and geofencing, and still uses Parcel Perfect for manifest management. FreightProof adds a trip creation step, but this is designed to be mostly selection and confirmation rather than re-entry of data. For contractual work (recurring standing arrangements, the bulk of Load Factor's business), the dispatcher can create a trip from a template in under a minute. For ad-hoc orders, the dispatcher enters the order number supplied by the client and selects the assigned driver, horse, and trailers.

The dispatcher is the only role that sees the full Parcel Perfect manifest and waybill details for a trip — including all client consignments, loading order, weights, and any exceptions. This is a deliberate design boundary: manifest contents (what is inside the truck) never reach the driver, because knowledge of high-value cargo (electronics, cell phones) significantly increases theft and security risk.

An admin-dispatcher role has additional access to forensic mode — the ability to inspect blockchain receipts, compare journey lock hash snapshots, and detect field-level changes between versions of the trip record. Forensic mode is gated behind this elevated role; standard dispatchers see the evidence trail but not the blockchain detail.

### Driver

The driver uses the PWA (Progressive Web App) on a smartphone throughout the trip. The app works offline and queues events when connectivity drops, which matters for the N3 corridor where signal can be intermittent. In Load Factor's deployment, the PWA runs on a company-issued Android device (Samsung preferred; OPPO handsets have caused compatibility issues and are avoided). Devices are provisioned through carrier agreements. This matters for POPIA compliance: monitoring permissions extend to company-owned devices and SIMs, not to drivers' personal phones. The company-issued device model therefore provides a clear legal basis for GPS tracking, selfie capture, and the other monitoring features the PWA requires.

The driver's role is to be the human presence at every handshake — the common factor who is at the origin gate, at the loading bay, at the destination gate, and at the unloading bay. The app is designed around large touch targets and short, sequential flows. At each handshake, the driver captures what needs to be captured: a photo confirming gate entry, the licence plate thumbnail shown on any relevant screen, a photo of the signed physical vehicle waybill at loading, seal numbers, checkpoint selfies, visual oversight of the unload count, and a photo of the signed physical master POD at delivery.

**The driver never sees the cargo manifest.** This is a hard design constraint, not a UX decision. The driver's document is the digitised linehaul: vehicle type and configuration, seal numbers, vehicle registration number, driver details, and the consolidated unit count. No cargo contents. No per-parcel breakdown. No client identities of what is inside the truck. FreightProof generates this linehaul digitally, replacing the printed hard copy the driver currently carries. Showing cargo contents to the driver is explicitly excluded and poses a direct security risk.

The driver does not scan parcels. The driver does, however, have an always-accessible soft panic button. The act of capturing evidence artifacts from an authenticated session, with GPS and timestamp logged, is itself the attestation.

### Client / Consignee

The client (typically FedEx or another courier operator) receives a delivery confirmation when their consignment is delivered. If they want to dispute anything, they can access that consignment's complete evidence chain: every handshake, every system-pulled event, every signed waybill, every blockchain transaction ID. They do not interact with the operational flow at all; their role is purely post-delivery verification, dispute initiation, and — importantly — accessing SLA reports that demonstrate Load Factor's on-time performance. The client does not log in on MVP; they receive a signed evidence PDF and optionally a deep link to a view-only trip record.

## 3.2 Operational touchpoints (not system users)

The following roles do not log into FreightProof. The system either observes their activity through integration with their systems of record, or captures it passively through the driver's device.

| Role | What they do | How FreightProof captures it |
|---|---|---|
| Gate guard (Fidelity, G4S, C4S, etc.) | Scans the vehicle disc, trailer disc, and driver's licence on entry and exit. Checks documents and seal integrity on exit. | MVP: driver photographs gate entry/exit event; Pulsit geofence data provides independent programmatic verification. Phase 2: principal SLA data feed replaces manual photo capture. |
| Cargo Handler | Physically loads or unloads consolidated units (pallets), scans them into or out of Parcel Perfect as they work — this is their existing workflow, entirely unchanged. | Captured via Parcel Perfect API. FreightProof pulls scan status and the completed manifest. No direct interaction with handlers. |
| Cargo Officer / Supervisor | Supervises the load or unload. Signs Load Factor's physical vehicle waybill at pickup. At destination: receives driver's waybill copy, checks seals and load body, then hands driver the signed physical master POD. | Captured via photos taken by the driver on the PWA: the signed physical waybill at loading, the signed physical POD at unloading. The paper document remains the legal artifact; FreightProof captures evidence of it alongside the Parcel Perfect manifest. |
| Control-room controllers (Load Factor) | Monitor Pulsit live, investigate deviations, trigger reaction companies when needed. | Not FreightProof users. FreightProof pulls Pulsit deviation events as exceptions in the evidence trail. Controllers' actions remain in their existing tools. |

Design principle: the driver is the only human hands-on user at each handshake moment. Every other party either uses their own system (Parcel Perfect, Pulsit, gate security) or signs physically on paper that the driver photographs. This means FreightProof can deploy at a new precinct without needing any new logins, training, or account management for warehouse or security staff.

---

# 4. The Journey: Five Handshakes, Start to Finish

The primary FreightProof flow is Load Factor's depot-to-depot business: a full truckload from FedEx Johannesburg to FedEx Durban, or any equivalent carrier-to-carrier run. A trip may carry consignments from multiple clients simultaneously — this is the standard break-bulk operating model and is fully in scope. Multi-stop trips (hub-and-spoke, multiple collection or delivery points) are a forward-compatible extension of this flow, not a separate system. See Section 4.1 for the two service models.

A depot-to-depot trip moves through five handshakes. Each handshake produces a signed event, and all events in a trip are ultimately anchored to the Hedera public blockchain as cryptographic proof.

| # | Handshake | What gets captured | Evidence weight |
|---|---|---|---|
| 0 | Trip Creation | Dispatcher creates trip from order number. Driver, horse, trailer(s), consignment references (one per client), loading priority order, Pulsit trip ID, route, and expected gate precincts locked in a journey hash anchored to blockchain. | Baseline commitment |
| 1 | Origin Gate-In | Pulsit geofence confirms vehicle at precinct. Driver photographs gate entry event. GPS cross-reference: phone, horse, each trailer tracker. Driver match confirmed. | Medium — entry confirmed |
| 2 | Loading Handshake | Cargo Handlers load and scan into Parcel Perfect. Driver receives and verifies the digitised linehaul document (unit count, seal, vehicle details — no contents). Warehouse rep signs physical vehicle waybill; driver photographs it. Seal number captured and photographed. Pickup receipt anchored to blockchain. | High — departure signature and seal locked |
| 3 | Origin Gate-Out | Driver photographs gate exit event. Seal verified by guard. Pulsit geofence confirms departure. Trip transitions to in-transit. | Medium — confirmed departure with intact seal |
| 4 | Destination Gate-In | Pulsit geofence confirms vehicle at destination precinct. Driver photographs gate entry. Seal verified unbroken on arrival — highest individual fraud signal. | High — seal-intact confirmation on arrival |
| 5 | Unloading Handshake | Cargo Handlers unload and scan into destination Parcel Perfect. Driver provides waybill copy to receiving handler. Seals broken, load body and doors inspected. Cargo Officer hands driver signed physical master POD; driver photographs it. Three-count reconciliation. Delivery receipt anchored to blockchain. Trip closes. | Highest — arrival verification is primary evidence |

Design principle — arrival verification is primary: Bruce was explicit that "we rely firstly on the tracking environment at departure e.g. Pulsit and even more so upon arrival as arrival times, seal numbers and the doors and load body of the vehicle is checked." The evidence chain is deliberately asymmetric. Handshake 5 (unloading) captures more data points and applies stricter validation than Handshake 2 (loading). The departure is the commitment; the arrival is the proof.

Between handshakes, in-transit events (checkpoints, route deviations, exceptions) are captured as they happen. These feed into the evidence trail without being part of the five-handshake sequence. They are covered in Section 5.

## 4.1 Two service models

Both fold into the same multi-stop Trip model. The distinction matters for how a trip is created, not how it is verified.

| Service model | What happens operationally | How it maps in FreightProof |
|---|---|---|
| **Scheduled break-bulk** | Clients (FedEx, Courier Guy, Seaborne, others) bring their consolidated loads to the LFG facility. LFG consolidates all consignments onto one truck, loading in order of urgency, yield, and client priority. | All consignments share a pickup stop at the LFG depot. Deliveries fan out to multiple destination stops per client. Loading order is recorded at trip creation. |
| **Ad-hoc collection** | The truck travels to individual client sites to collect loads (e.g. 3 tonnes from FedEx, then continue to Courier Guy for 4 tonnes). A secondary, on-request service. | Each collection point is a separate pickup stop at the client's precinct. The multi-stop model handles this without any structural difference. |

In both models, the manifest of what is on the truck is communicated operations-to-operations (e.g. LFG Durban to LFG Johannesburg) and never passes through the driver.

---

### Handshake 0 — Trip Creation

**Who:** Dispatcher

Bruce was explicit: "the journey actually starts by virtue of an order." The order number is the root reference for everything that follows. It is what the client (FedEx) uses to track the trip, what Load Factor uses to invoice, and what the precinct is told to expect when the driver arrives.

The dispatcher opens FreightProof and creates a trip linked to that order number. For a contractual recurring trip (standing agreement, which is most of Load Factor's volume), a template auto-fills the client, the route, and the typical vehicle profile. For an ad-hoc order, the dispatcher enters it manually.

What the dispatcher selects or enters:

- Order number (from client) — the root reference
- Client consignment reference(s) from Parcel Perfect — one per client, for multi-client trips
- Loading order and priority for each consignment (e.g. urgent FedEx at the door, Courier Guy at the bulkhead)
- Assigned driver (from Load Factor's registered driver list; IDVS verification is re-run at this point)
- Assigned horse (truck cab) and trailer(s) — each with its own Pulsit tracker device ID
- Pulsit trip reference ID (the trip the dispatcher has already created in Pulsit)
- Expected origin and destination precincts — associated with the principal (e.g. FedEx), not with a specific security company
- Planned route and slot times (pulled from Parcel Perfect)

The horse and trailer are modelled as separate entities. An 18-metre vehicle is registered as one horse and two trailers (12-metre and 6-metre). Trailers can be decoupled and reassigned mid-route, so each trailer has its own Pulsit tracker device ID and is verified independently at every gate check. Any mid-route substitution becomes a visible exception in the evidence trail rather than an invisible operational adjustment.

On submission, FreightProof creates a journey lock hash — a cryptographic snapshot of everything committed to this trip (order number, driver, vehicles, cargo references, route, precinct gates, timestamps) — and anchors it to Hedera HCS. From this moment, anything that deviates from the committed trip is recorded as an exception. In parallel, FreightProof sends a pre-notification to the origin precinct — addressed to the principal's contact, not to the security company directly — confirming expected driver, vehicle, and arrival time.

**Return legs:** A return leg is a new trip, not a continuation of the outbound trip. The dispatcher creates it as a separate entry. If the vehicle returns empty, that fact is recorded on the return trip and is visible to LFG management — empty-leg cost is absorbed by LFG, so visibility drives rotation planning (ensuring the truck is available and positioned for the following night's departure). Scheduling return loads is out of scope for FreightProof; the system records and evidences the return, it does not orchestrate it.

---

### Handshake 1 — Origin Gate-In

**Who:** Driver + Gate Security + System

The driver arrives at the origin precinct. The gate security provider on duty (Fidelity, C4S, G4S, or any in-house team contracted by the principal at that location) performs three scans on their own system: the vehicle disc, the trailer disc, and the driver's licence. This is the authentication event — not something FreightProof performs, but something FreightProof records.

Pulsit's geofence data is the primary programmatic verification that the vehicle has entered the precinct. The driver's phone GPS, the horse tracker GPS, and each trailer tracker GPS must all agree within tolerance against the expected precinct coordinates. This cross-reference is independent of whichever security company is operating the gate.

The driver taps "Log gate entry" on their PWA. The app captures a photo confirming the gate entry event, the driver's phone GPS, and a timestamp. The system runs three checks in parallel:

- Vehicle check: Pulsit is queried for the registered tracker device IDs of the horse and each trailer. All must be active at the origin precinct coordinates.
- GPS cross-reference: driver phone GPS, horse tracker GPS, and each trailer tracker GPS compared against expected precinct coordinates.
- Trip match: the driver's identity confirmed against the trip assignment.

If any check fails, the dispatcher receives an alert with the specific failure. The driver proceeds only after dispatcher override or resolution. In the nominal case, the gate-in event is recorded as a feeder to the loading handshake that follows — it is not itself anchored to blockchain, because it is not yet a signed record. It becomes part of Handshake 2's anchored event.

One important nuance: there are scenarios where the trailer is already at the loading bay and the driver arrives later to hook up and depart. In this case, the driver's gate-in happens before Handshake 2 but the trailer check is skipped (because the trailer is already inside the precinct). When the driver departs (Handshake 3), the trailer tracker is verified as part of that exit. The system handles this as a variant of Handshake 1, not an exception.

---

### Handshake 2 — Loading Handshake

**Who:** Driver + Cargo Officer + System

The driver proceeds to the assigned loading bay. Cargo Handlers load the truck and scan consolidated units (pallets) into Parcel Perfect as they load — this is their existing workflow, entirely unchanged. FreightProof polls Parcel Perfect's API for the scan-out status of the consignment(s) referenced in the trip. There are three possible states:

- Loading complete: all units scanned out. FreightProof pulls the full manifest and presents it to the **dispatcher**. The dispatcher sees all client consignments, unit counts, weights, and loading order.
- Loading in progress: a partial scan list is available. The dispatcher sees current status; the system re-polls every few minutes.
- Not started: the driver sees "waiting for warehouse" and cannot proceed to sign-off.

Once loading is complete, the driver's PWA displays the **linehaul document** — the driver's only view of the trip's cargo information:

- Vehicle type and configuration
- Seal number(s)
- Vehicle registration number
- Driver details
- Consolidated unit count (total sealed units handed to LFG)

The driver does not see the Parcel Perfect manifest, cargo contents, client names of goods inside the truck, or any per-parcel breakdown. This is a deliberate security design: knowledge of high-value cargo (e.g. cell phones, electronics — Bruce's examples) directly increases theft risk. The linehaul is what FreightProof digitises — replacing the printed hard copy the driver currently carries in the cab.

The Cargo Officer signs Load Factor's physical vehicle waybill in pen, as they do today. FreightProof does not replace this physical document. The driver captures a photo of the signed waybill on the PWA. That photo, combined with the Parcel Perfect manifest pulled automatically from the API (and visible to the dispatcher), forms the evidence: what the system of record says was loaded, and what was physically signed for.

The driver then captures the seal number and photographs the sealed trailer door. The seal number is recorded on the vehicle waybill. A broken or substituted seal at delivery is the clearest possible fraud signal, and capturing the number at pickup is what makes that signal meaningful.

At this point, FreightProof assembles the pickup event: the gate-in data from Handshake 1, the Parcel Perfect manifest (dispatcher view), the photo of the signed physical waybill, the seal number and photo, and the GPS and timestamp of each sub-event. The driver taps "Complete Loading Handshake" to advance the trip state; this action, from the driver's authenticated session, is the driver's attestation. A SHA-256 hash of the complete pickup event is submitted to Hedera HCS. This is the pickup blockchain receipt. The hash is on-chain; the actual data stays in FreightProof's database (POPIA compliance by design: no personal data goes to the blockchain). From this point, the pickup record is tamper-proof.

**Load configuration context:** Loading is FedEx's (or the relevant client's) responsibility. LFG provides each client with a vehicle blueprint specifying load configuration — including high-canopy variants for volumetric freight. The blueprint defines how weight must be distributed: more scale weight over the rear axle, not between the front and rear axles (known as "trimming the load"). The consolidated load must not exceed the vehicle's maximum legal weight. South African roads have weigh bridges that enforce these limits; non-compliance results in fines, or in extreme cases the vehicle is confiscated and LFG must send recovery vehicles and forklifts to reload on the roadside. All fines and recovery costs arising from incorrect loading are passed back to the loading client — it is therefore in the client's financial interest to comply with the load configuration blueprint provided. The dispatcher has visibility into declared weights at trip creation; validating compliance with the blueprint is an operational responsibility, not a FreightProof enforcement action.

---

### Handshake 3 — Origin Gate-Out

**Who:** Driver + Gate Security + System

The truck, now loaded and sealed, proceeds to the precinct exit gate. The gate guard verifies the seal number against the vehicle documents. The driver taps "Log gate exit" on the PWA and captures a photo confirming the gate exit event, the seal number as verified by the guard, and the GPS and timestamp. Pulsit's geofence data confirms vehicle departure from the precinct.

At this moment, the trip transitions to in-transit state. The journey lock hash locks the vehicle, driver, cargo, and seal as a fixed combination. Any deviation from that combination — a trailer tracker that goes silent, a GPS that leaves the committed route, a seal number that doesn't match at the destination — will be flagged as an exception.

Driver substitutions during a trip are a normal operational event, not an exception. Planned substitutions occur at pre-agreed exchange points specified in the SLA — for example, the Harrismith fuelling station on JHB-DBN runs. These exchange points are pre-loaded as geofenced locations in Pulsit. If no exchange is planned for a given night, that stop's geofence is removed from the trip in Pulsit so it does not generate a false alert. FreightProof records a planned substitution as a normal trip event, not as an exception, with four required log fields: original driver ID, substituting driver ID, exchange location, and approving dispatcher. The substituting driver is rescanned at the exchange point.

Unplanned substitutions (illness, duty hours breach, unforeseen circumstances) are handled differently: FreightProof flags these as a driver substitution exception attached to the trip, with the substitution event anchored to blockchain. Load Factor notifies the gate of the substitute driver's details in advance of the next gate event. The trip continues; the substitution is evidence, not a failure. The distinction between planned and unplanned substitution matters: the same log fields apply in both cases, but a planned substitution generates no exception flag whereas an unplanned one does.

---

### In-Transit — Checkpoints, Deviations, Exceptions

**Driver + Pulsit**

**Checkpoints.** At fuel stops and rest stops, the driver logs a checkpoint from the PWA. This captures a timestamped selfie, the driver's phone GPS, and an optional photo of the sealed cargo area. Checkpoints are batched: multiple checkpoints across a long trip are combined as a Merkle root and anchored to Hedera once per day or per trip, rather than individually. This keeps blockchain costs down while maintaining a verifiable trail. If the vehicle is stationary for more than 15 minutes without a logged checkpoint, the app prompts the driver.

**Pulsit deviation pull.** Pulsit continues monitoring the route and geofencing entirely independently. If the truck deviates from the assigned route, breaches a geofence, or exhibits unusual behaviour, Pulsit generates an alert in Load Factor's control room. FreightProof pulls that alert event from Pulsit and records it as an exception on the trip's evidence trail, capturing the exact timestamp, GPS coordinates, and route reference.

**Soft panic button.** The driver's PWA has an always-accessible panic button. Activation immediately logs GPS, timestamp, and the trip state to FreightProof, triggers an urgent dispatcher alert, and creates an exception on the trip record. This complements, rather than replaces, the hardware panic buttons that already exist in the truck.

**Document upload.** At any point during the trip, the driver or dispatcher can attach documents to the trip record: photos of cargo damage, signed side-of-road inspection reports, incident photos, or anything else that supports the evidence trail. These are hashed and attached as Merkle leaves in the daily batch.

---

### Handshake 4 — Destination Gate-In

**Who:** Driver + Destination Gate Security + System

The truck arrives at the destination precinct (in this example, FedEx Durban). The gate security provider at this location may be different from the origin — this is irrelevant to FreightProof, because the SLA is with the principal (FedEx), not with the security company.

Pulsit's geofence data confirms vehicle arrival at the destination precinct. The guard scans the driver's licence on their own system. The driver taps "Log destination gate entry" and captures a photo confirming the gate entry event, the seal number as verified by the guard on entry (critical: this is where seal-intact verification happens), GPS, and timestamp. If the seal number on arrival does not match the seal number captured at origin, this is an immediate high-priority exception — the strongest possible signal that the cargo may have been accessed in transit.

---

### Handshake 5 — Unloading Handshake

**Who:** Driver + Cargo Officer + System

This handshake carries the greatest evidential weight. Bruce: "we rely firstly on the tracking environment at departure e.g. Pulsit and even more so upon arrival as arrival times, seal numbers and the doors and load body of the vehicle is checked." The unloading handshake is the primary proof that a trip was completed correctly.

At the unloading bay, the process follows a specific two-way document exchange sequence:

- Driver hands their copy of the trip waybill to the receiving cargo handler.
- The cargo handler and cargo officer break the seals, open the truck, and inspect the load body and doors.
- Cargo Handlers unload and scan consolidated units into the destination Parcel Perfect system. The driver's role is visual oversight — counting against what was loaded, watching that the cargo officer scans each unit into the warehouse.
- Once the load is reconciled and the cargo officer is satisfied, they hand the driver the signed physical master POD.
- Driver photographs the signed POD on the PWA.

FreightProof reconciles three counts automatically as the scan-in completes:

- The unit count signed off at origin (Handshake 2)
- The scan-in count at destination (from destination Parcel Perfect)
- The driver's visual count as the truck is unloaded

If all three agree, the Cargo Officer hands the driver the signed physical master POD. This is Load Factor's proof that the depot-to-depot trip was completed successfully, and it is the document Load Factor invoices FedEx against. FreightProof does not replace this physical document. The driver photographs it.

If any count is short — for example: 10 pallets scanned out in Johannesburg and only 9 received in Durban — the system flags the exception and records the last confirmed checkpoint location of the missing unit. The dispatcher, the client, and the insurer all see the discrepancy immediately. The POD can still be signed (short-delivered), but the exception is permanent in the evidence chain.

The driver taps "Complete Unloading Handshake" to advance the trip to closed state. The delivery event — comprising destination gate-in data, Parcel Perfect reconciliation, POD photo, seal verification, load body inspection confirmation, and full GPS/timestamp metadata — is hashed and anchored to Hedera HCS. This is the delivery blockchain receipt. The trip is now closed from FreightProof's evidentiary perspective.

The physical exit gate-out at the destination is not captured by FreightProof. The truck, now empty, leaves through the same gate it entered. The gate security system will log it anyway in its own records.

---

# 5. Exceptions

Exceptions are not a phase in the journey. They are a cross-cutting layer that can fire at any point — during a handshake, in-transit, or triggered by a driver action. Every exception is captured with timestamp, GPS, source (system or human), and supporting data, and is batched into the daily Merkle root anchored to Hedera. The dispatcher sees exceptions in real time on the dashboard; the client sees them in the final evidence PDF.

## 5.1 System-detected exceptions

These fire automatically from data, with no human action required.

- Seal number mismatch between pickup capture (Handshake 2) and destination arrival (Handshake 4) or unloading (Handshake 5)
- Unit count mismatch between origin manifest and destination scan-in
- GPS mismatch between driver phone, horse tracker, and trailer tracker(s) at any handshake
- Route deviation or geofence breach pulled from Pulsit
- Vehicle or trailer substitution: tracker device ID changes from the committed assignment
- Unplanned driver substitution: licence scan does not match trip assignment and no substitution event was pre-notified
- Checkpoint timeout: vehicle stationary more than 15 minutes without a logged checkpoint
- Waybill count signed by warehouse rep does not match Parcel Perfect manifest count
- Handshake out of sequence: events logged in an order that violates the expected flow

## 5.2 Driver-raised exceptions

- Soft panic button activation (hijacking, security incident)
- Delivery refused or no one at the receiving warehouse
- Cargo damage observed at pickup or en route
- Seal found broken mid-trip (e.g. at a fuel stop during checkpoint)
- Mechanical breakdown or delay
- Document upload with flag for dispatcher review

## 5.3 Dispatcher-raised exceptions

- Driver substitution approval (pre-notified to gate)
- Acknowledgement of Pulsit deviation after controller investigation
- Manual note on a live incident (details, actions taken, outcome)
- Escalation flag for insurance review
- Trip hold or resume for operational reasons

Design principle: exceptions do not block the trip from progressing. The system records the exception, flags it, and continues — unless the dispatcher explicitly halts the trip. This matches how Load Factor actually operates. A geofence breach today does not stop the truck; it triggers controller investigation. FreightProof's job is to record the investigation and its outcome, not to arrest the trip. The exception to this principle is the hard failure of Handshake 2 (no manifest available) or a seal-intact failure at destination gate-in, both of which require dispatcher override before the trip can proceed.

---

# 6. What the Dispatcher Sees in FreightProof

The dispatcher's dashboard is the operational nerve centre of FreightProof. It does not replace Pulsit or Parcel Perfect — those systems are still used for their respective jobs — but it provides a unified view of the evidence trail across all active trips, a searchable history of every completed trip, and SLA reporting that Bruce flagged as a commercial sales tool.

Bruce confirmed during the dispatcher portal demo that the timeline-based trip view is consistent with industry documentation formats used in air freight incident reporting. He highlighted that FreightProof's ability to drill into any event on the timeline — loading, transit exceptions, delivery — and pull the underlying manifest data, consignment numbers, and coordinates is a differentiator over existing market systems, which cannot perform event-level manifest investigation.

## 6.1 Active trip view

Each active trip shows a timeline of events: trip created, gate-in cleared, loading complete and signed, gate-out with seal verified, checkpoints logged, deviations flagged, destination gate-in with seal verified, unloading reconciled, POD signed. Each event links to its full detail: the data captured, the signatures applied, the blockchain receipt. Exceptions are flagged inline with a clear reason.

For multi-client trips, the dispatcher sees all client consignments on the trip: the unit counts per client, the loading order and priority (e.g. urgent FedEx at the door, Courier Guy at the bulkhead — because the door load is unloaded first on arrival, saving processing time at the destination), and any exceptions scoped per consignment. Scoping matters: a FedEx count discrepancy should not surface in Courier Guy's evidence chain.

The dispatcher does not see a live map in FreightProof. The live map lives in Pulsit. FreightProof shows the GPS coordinates recorded at each event as text and timestamps, not a tracking feed.

## 6.2 Trip history and search

Every completed trip is stored and searchable. The dispatcher can filter by date range, driver, vehicle (horse or trailer), route, client, order number, and exception type. A disputed delivery from three months ago is resolved by pulling the trip record, not by relying on human memory or paper records that may have been lost or altered.

## 6.3 SLA reporting

The SLA is the overarching commercial agreement between Load Factor and the principal (e.g. FedEx). It specifies daily service slot times (for example, truck at FedEx by 12:00 daily), per-route insurance cover (R3 million for CT runs, R1 million for DBN day runs), and annexures that define routing and the operational environment for each corridor. These are the commitments FreightProof's evidence chain is designed to demonstrate compliance with.

Bruce was explicit that SLA data has commercial value beyond operations: the FreightProof report becomes a sales tool, not just an operational one. FreightProof includes an SLA dashboard that aggregates trip data against configurable service commitments — on-time pickup, on-time delivery, handshake completion rates, exception rates by type and by route. The dispatcher can export an SLA report for any client over any date range, branded and ready to present.

As FreightProof matures, it will eventually require its own SLA with Load Factor Group and/or FedEx — governing data exchange, uptime requirements, and access to the Phase 2 principal data feed. This is an architectural acknowledgement, not an MVP deliverable.

## 6.4 Example trip timeline

Trip #TRP-2026-0041 | ORDER: FDX-JHB-DBN-8821 | JHB → DBN | Driver: S. Dlamini | Horse: CA 123-456 | Trailer: TR-991

STATUS: IN TRANSIT

```
08:14  Trip created by dispatcher A. Dlamini — Journey lock hash anchored
09:02  Handshake 1: Origin gate-in CLEARED | Linbro Park | Pulsit geofence confirmed | Driver match confirmed
09:47  Handshake 2: 4 sealed units loaded (FedEx consignment FDX-JHB-8821) | Waybill photographed (warehouse rep: J. Ndlovu) | Seal SL-7741 captured | Pickup receipt anchored
10:05  Handshake 3: Origin gate-out CLEARED | Seal SL-7741 verified by guard | Pulsit geofence departure confirmed | Trip in-transit
13:22  Checkpoint logged | N3 Tugela Plaza | GPS confirmed across phone + horse tracker
14:37  EXCEPTION: Route deviation from Pulsit | Vehicle left N3 at Mooi River
14:52  Deviation resolved: vehicle returned to route | Controller note attached
16:30  Handshake 4: Destination gate-in PENDING | FedEx Durban
```

---

# 7. What FreightProof Owns vs What Stays in Other Systems

| FreightProof does | Stays in the existing system |
|---|---|
| Trip creation and driver/vehicle/cargo assignment tied to an order number | Route planning, geofencing, ETA (Pulsit) |
| Handshake capture at all five points (photos, waybill photos, seal numbers) | Live GPS map and tracking (Pulsit) |
| Multi-client manifest reconciliation across origin and destination Parcel Perfect instances | Parcel-level scan-in and scan-out (Parcel Perfect) |
| Digitised linehaul document generation for the driver | Full manifest management (Parcel Perfect, dispatcher view only) |
| Seal capture at pickup and seal verification at delivery | Driver licence scanning at precinct gates (Fidelity, G4S, C4S, etc.) |
| Loading order and priority recording per consignment | Live controller response to deviations (Load Factor control room) |
| Pulsit deviation events logged as exceptions in the evidence trail | Historical GPS breadcrumb (Pulsit) |
| Checkpoint trail with selfie, GPS, and cargo photos | Hardware panic buttons in the truck (Pulsit/reaction company) |
| Soft panic button in the driver's PWA | National identity data (IDVS) |
| Blockchain anchoring of handshake hashes to Hedera HCS | Financial invoicing and credit management (Load Factor finance) |
| SLA dashboards and client-facing evidence reports | Insurance claim processing (insurer systems) |
| Dispute evidence access and trip history search | Load configuration blueprints (LFG-issued vehicle documentation) |

---

# 8. What Data FreightProof Pulls from Each System

FreightProof does not replicate external systems. It queries them at specific moments to verify specific facts. Each integration is narrow, purposeful, and event-triggered.

## 8.1 From Parcel Perfect

Parcel Perfect is queried at trip creation, at the loading handshake, and at the unloading handshake. The origin and destination may be separate Parcel Perfect instances with separate API credentials (branch-level isolation is common).

**Three documents are in play at the loading handshake and it is important to distinguish all three:**

1. **The FedEx Parcel Perfect manifest** — created and owned by FedEx via Parcel Perfect. It covers all parcels consolidated onto the Load Factor vehicle and carries a branch prefix (JNB, CT, or DBN) plus a sequence number (e.g. Manifest 69). This document is used to reconcile cargo on seal break at the destination and goes operations-to-operations (FedEx Johannesburg to FedEx Durban). It never passes through the driver. FreightProof pulls this manifest via the Parcel Perfect API and exposes it to the **dispatcher only**.

2. **The Load Factor Master Waybill** — a separate document issued by Load Factor's own internal system (IVS). It cross-references the FedEx manifest number and travels as a hard copy in the cab alongside the FedEx manifest. This is the physical document whose signed copy the driver photographs at Handshake 2.

3. **The LFG Linehaul** — the driver's operational document. Contains: vehicle type and configuration, seal numbers, vehicle registration, driver details, and consolidated unit count. No cargo contents. Currently a printed hard copy issued manually by LFG. FreightProof digitises this document, generating it from the trip data and presenting it to the driver on the PWA at Handshake 2. This is a primary digitalisation target of the system.

| Data requested | When and why |
|---|---|
| Consignment record (ID, client, origin, destination, unit count, declared value) | Trip creation: establishes what is committed to the trip |
| Full manifest (unit/parcel breakdown, barcode, delivery stop assignment) | Loading handshake: pulled when loading is confirmed complete; shown to the dispatcher; the driver sees only the generated linehaul (unit count + seal) |
| Scan-in status at destination | Unloading handshake: reconciled against origin manifest; the fundamental count check |
| Slot times per leg | Trip creation: captured for SLA reporting |
| Delivery stop details (where multi-stop) | Trip creation: enables independent verification at each stop |

**Parcel Perfect API access model:** Parcel Perfect's developer is protective of their API and publicly available documentation is limited. Access requires a three-party discussion: FreightProof (UCT team) + FedEx (Parcel Perfect's paying customer) + Parcel Perfect (API owner). FedEx instructs Parcel Perfect to share the API, and Parcel Perfect then reviews FreightProof's requirements before granting access. The key framing for this negotiation is that FreightProof **only reads** from Parcel Perfect — it does not write, does not compete with Parcel Perfect's business, and adds value to the Parcel Perfect ecosystem. This removes the perceived threat and strengthens the case for access. The same dynamic applies to other TMS/WMS providers (e.g. ShipMate) that may be integrated in later iterations. This negotiation is post-iteration-2 and requires the mock-up to be sufficiently mature to demonstrate value to all parties before it can begin.

## 8.2 From Pulsit Tracking

| Data requested | When and why |
|---|---|
| Device ID to vehicle registration mapping (one per horse, one per trailer) | Trip creation and at each gate handshake: confirms the physical vehicle matches the assignment |
| Geofence entry/exit events for precinct coordinates | Each gate handshake: primary programmatic confirmation that vehicle is at the correct precinct |
| Point-in-time GPS for a given device ID | Each gate handshake: used in GPS cross-reference check |
| Route deviation and geofence breach events | Continuously during transit: recorded as exceptions in the FreightProof evidence trail |
| GPS coordinates at checkpoint timestamps | Checkpoint logging: cross-references driver phone GPS against fleet tracker position |
| Pulsit trip reference ID (linked, not created) | Trip creation: the dispatcher creates the Pulsit trip as normal; FreightProof captures the reference for later lookups |

## 8.3 From IDVS

IDVS is queried at trip creation to re-verify the assigned driver's identity. The call returns a simple match/no-match result. Personal data is not stored in FreightProof beyond what is needed for display; the identity verification itself lives in IDVS.

## 8.4 From gate security systems — principal SLA model

FreightProof does not integrate with individual gate security providers (Fidelity, G4S, C4S, etc.) in MVP or Phase 2. The relevant agreement is between FreightProof and the principal (FedEx, The Courier Guy), not between FreightProof and whichever security company operates at a given location.

Under this model, the precinct entity in FreightProof stores which principal governs it, not which security company operates the gate. A national operator like FedEx may use Fidelity at one branch and G4S at another; FreightProof does not need to know or care which security company is on duty. The data exchange SLA with the principal covers all locations under that principal's contract.

The data model implication is: one Principal entity, multiple Location records. FedEx JHB and FedEx DBN are not two separate principals — they are two Location nodes under the same FedEx Principal entity. Gate-entry records are owned by the principal (FedEx), not by Load Factor. Load Factor provides the pre-alert; the guard's system uploads the gate-entry record into the principal's system.

| Gate data source | Role in the evidence chain |
|---|---|
| MVP: driver photo of gate entry/exit event | Human-captured evidence that the scan happened, with GPS and timestamp automatically appended by the PWA |
| Pulsit geofence data (primary programmatic check) | System-to-system confirmation that vehicle entered or exited the precinct coordinates, independent of any security company system |
| Phase 2: principal data feed via SLA | Direct data exchange between FreightProof and the principal (e.g. FedEx), replacing manual photo capture |
| Phase 2: guard pre-notification | FreightProof pushes trip details (ETA, vehicle, driver, seal numbers) to the precinct via the principal SLA |

---

# 9. Load Configuration and Weight Management

This section documents the domain context behind the loading handshake that any dispatcher or system designer needs to understand. FreightProof records weight-related data at trip creation; it does not enforce compliance — that responsibility sits with the loading client.

**Load trimming.** When cargo is loaded into a truck, weight distribution across the vehicle must be managed carefully. More scale weight (actual weight) should sit over the rear axle, not between the front axle and the rear axle. This distribution is called "trimming the load." Incorrect trimming makes the vehicle unsafe — Bruce's example was the descent into the valley near Pietermaritzburg on the way to Durban, where freight can shift from the rear axle towards the front of the truck if the load was not trimmed correctly.

**Maximum allowable weight.** The consolidated load across all consignments must not exceed the vehicle's maximum legal weight. South African roads have weigh bridges that enforce these limits. Non-compliance consequences:

- Fines for the operator
- In serious cases: vehicle confiscation at the weigh bridge; LFG must dispatch recovery vehicles and forklifts to unload and reload the cargo at the roadside

**Responsibility.** Loading is the client's (e.g. FedEx's) responsibility. LFG provides each client with a vehicle blueprint specifying the configuration of the assigned vehicle — including high-canopy configurations for volumetric freight — and the maximum allowable weights. FedEx must load in accordance with this blueprint. If non-compliance results in a fine or a recovery operation, all associated costs are passed back to FedEx. It is therefore in the client's direct financial interest to follow the blueprint.

**FreightProof's role.** The dispatcher has visibility into declared unit counts and weights at trip creation. FreightProof records what was declared and what was loaded; it does not enforce the blueprint or calculate axle distributions. The dispatcher is the human check that the declared load is consistent with the vehicle configuration selected for the trip.

---

# 10. Return Legs

Return legs are a distinct trip type with specific operational and financial implications for LFG.

**Definition.** A return leg is a new, separate trip in FreightProof — not a continuation of the outbound trip. The journey lock hash, the driver assignment, the vehicle assignment, and the evidence chain are all fresh for the return. The outbound trip closes when the destination POD is signed; the return is a new work order.

**Empty legs.** If the vehicle returns without cargo, that cost is absorbed by LFG. Management requires visibility into empty-leg frequency and timing to manage P&L and asset utilisation. A return trip with zero consignments is recorded as an empty leg; this is distinguishable in SLA reporting and operational dashboards.

**Return load optimisation.** LFG actively seeks return loads (freight going in the opposite direction) to minimise empty-leg costs. FreightProof does not schedule or source return loads — that is a Load Factor commercial and logistics function. FreightProof records the return trip, whether laden or empty, as evidence. If a return load is found, a new trip with consignments is created; if not, an empty-leg trip is created so the vehicle's return is tracked and accounted for.

**Rotation planning.** Tracking return legs feeds into vehicle rotation planning — ensuring a truck that left Johannesburg on Monday night is confirmed back and available for the following night's departing service. This rotation visibility lives in the dispatcher's active trip view.

**Design decision (open).** Whether a dispatcher initiates a return leg as a new trip entry (the current direction) or as a linked "continuation" trip is not fully resolved at the system design level. The current approach is a standalone new trip with an optional link field back to the originating outbound trip. This keeps the evidence chain clean and avoids coupling the outbound and return records.

---

# 11. Why the Design Works: Corruption Resistance

The most important design principle in FreightProof is that no single data source can be corrupted to produce a false record. Verification at every handshake draws from multiple independent sources simultaneously. To fabricate a clean pickup receipt, an attacker would need to simultaneously manipulate:

- The IDVS identity match result for the assigned driver
- The Pulsit tracker device IDs assigned to the horse and each trailer
- The GPS coordinates reported by multiple independent tracker hardware units
- The GPS coordinates on the driver's phone
- The Pulsit geofence confirmation of precinct entry/exit
- The known coordinates of the origin precinct (not under attacker control)
- The cargo manifest in Parcel Perfect (with a separate instance at the destination)
- The physical seal number recorded at origin and verified at destination
- The photographed physical vehicle waybill (warehouse rep's ink signature) at origin
- The photographed physical POD at destination (with load body and door inspection)
- The SHA-256 hash anchored to Hedera HCS, which is publicly verifiable and immutable

Each of these is independently controlled by a different party or system. Compromising any one is insufficient. This is not an accident of architecture; it is the deliberate design principle that makes FreightProof meaningful as evidence rather than just as a digital form.

The blockchain layer (Hedera HCS) is the final guarantee. It does not store personal data — only the hash of each event goes on-chain, with the actual data remaining in FreightProof's database (POPIA compliance by design). But the hash means the data cannot be altered after anchoring. A FreightProof record from six months ago that matches its Hedera transaction hash is provably unaltered. That is the legal and commercial value of the system.

---

# 12. What Is Deliberately Out of Scope for MVP

The following were considered and deliberately excluded from the initial build. Each exclusion has a specific justification grounded in MVP focus and the resource constraints of a four-person honours team.

| Excluded | Why |
|---|---|
| Direct integration with individual gate security providers | The principal SLA model means FreightProof never needs to integrate with Fidelity, G4S, C4S, or others individually. MVP captures gate events via driver photo + Pulsit geofence. Phase 2 is a principal data feed, not a per-provider integration. |
| NFC passive parcel scanning at truck doors | Valuable Phase 2 addition; requires hardware at loading bays and is outside MVP scope. |
| IPFS / Pinata for evidence storage | A SHA-256 hash anchored to Hedera provides tamper-evidence regardless of where underlying data is stored. Adds no integrity guarantee while adding risk. |
| WhatsApp Business API for notifications | Meta approval process is slow and uncertain; SMS and email are sufficient for MVP notifications. |
| React Native native mobile apps | PWA with Serwist covers driver use cases offline. Three simultaneous mobile strategies exceed team capacity. |
| Cross-border and Ragel subcontractor flows | Load Factor on the JHB-DBN corridor is the MVP beachhead. Ragel's multi-subcontractor architecture is Phase 2. |
| Live map inside FreightProof | Pulsit already does this well. Evidence trail with GPS coordinates is sufficient for MVP. |
| Last-mile OTP-to-consignee flow | Depot-to-depot is the MVP primary flow. The OTP model for named consignees is retained in the data model for Phase 2. |
| Client self-service portal | MVP clients receive signed evidence PDFs and optional deep-link to a view-only trip record. Full self-service portal is Phase 2. |
| Last-mile delivery waybill reconciliation | FreightProof's chain of custody ends at the destination warehouse handover. Last-mile delivery waybills are FedEx's product. |
| Return load scheduling | FreightProof records and evidences the return trip; it does not source or schedule return cargo. |
| Parcel Perfect live API integration (iteration 2) | Iteration 2 uses mock data shaped like the real PP API. Live integration begins after the three-party negotiation (FreightProof + FedEx + Parcel Perfect) is concluded. |
| Vehicle onboard camera integration (Phase 2) | Bruce raised integrating the vehicle camera system so dispatchers can pull a live or recorded feed within an exception event view. Agreed as a Phase 2 enhancement. Bruce has also committed to raising with Pulsit the ability to save a 5-minute clip before and after an exception event. Currently Pulsit does not support this, but it is a planned feature request. |
| HandlingUnit / pallet entity | Whether LFG scans/identifies each consolidated pallet (giving it a tracked entity) or only counts units + seals the truck is an open question targeted for resolution at the July site visit. Until confirmed, the custody record stays a unit count + seal at the handshake level. |

Design principle — monitoring within legal constraints: Driver monitoring features (GPS tracking, selfie capture, checkpoint photos) are designed within the boundaries set by the National Transport Act, applicable transport industry contracts, and POPIA. The company-issued device model (Section 3.1) is the primary mechanism for staying within these constraints.

---

# 13. The Two PODs: What's in Scope and What Isn't

In Bruce's description of how the manifest and POD system works, two distinct proofs of delivery are in play. Understanding which one FreightProof produces, and which it deliberately does not, is important — both for scope clarity and for positioning the evidence output correctly.

## 13.1 The two PODs

| POD | What it covers | Whose product is it? |
|---|---|---|
| Depot-to-depot POD (Load Factor's POD) | The truck and its cargo, from origin depot (FedEx JHB) to destination depot (FedEx DBN). Signed by the destination Cargo Officer when the truck is unloaded, seals checked, and load body inspected. | Load Factor's. This is what Load Factor invoices FedEx against. |
| Door-to-door POD (FedEx's POD) | Each of the individual parcels, from the original sender's door (first mile) through Load Factor's truck (middle mile) to the final recipient's door (last mile). One POD per parcel per end-customer. | FedEx's. This is what FedEx invoices their end-customers against. |

## 13.2 The trunk haul manifest boundary

Bruce clarified that the manifest at the destination is the trunk haul manifest — the load that came off Load Factor's truck. The last-mile delivery waybills are separate: a FedEx driver may take multiple shipments to multiple consignees in a small van. Those last-mile delivery waybills, each signed by an end-customer, are FedEx's product.

FreightProof's chain of custody ends at the destination warehouse handover. The destination cargo officer reconciles the trunk haul manifest and signs the depot-to-depot POD. FreightProof captures and anchors that event. What happens after — the individual parcels being dispatched to their final consignees — is outside FreightProof's scope and outside Load Factor's chain of custody.

## 13.3 Why FreightProof only produces the depot-to-depot POD

Three reasons support this scope boundary:

First, we are not the operator for the first or last mile. Those events happen in FedEx's systems.

Second, the evidentiary strength of the middle-mile chain depends on the integrity-resistance properties of the capture process: multi-source GPS cross-reference, physical seal capture, blockchain anchoring, independent system-of-record reconciliation. Extending to the first and last mile would include events outside our verification envelope.

Third, the door-to-door POD is FedEx's commercial product, not Load Factor's. The beachhead strategy is to sell FreightProof to Load Factor as the vehicle supplier in the chain.

## 13.4 How the evidence output fits into FedEx's door-to-door workflow

Even though FreightProof does not produce the door-to-door POD, the evidence output is keyed by consignment reference — the same reference that FedEx uses in Parcel Perfect. When FedEx accesses a consignment's evidence from FreightProof, they can file it directly alongside their own door-to-door POD for that consignment, without reformatting. The middle-mile evidence and the first-and-last-mile evidence are complementary halves of what an end-customer or their insurer needs.

---

# 14. Where the Codebase Stands

This section records the current build state as of June 2026 (iteration 2 in progress), derived from the live codebase graph. It is not a requirements document — it is a snapshot of what exists so new team members and the full picture doc stay aligned.

## 14.1 Built and operational (iteration 1)

**Backend (FastAPI / Python 3.13 / PostgreSQL):**

- SQLAlchemy 2.0 async models: `Trip`, `TripTrailer`, `Consignment`, `Parcel`, `DriverSubstitution`, `TripTemplate`, plus organisation, precinct, driver, vehicle, handshake, exception, and blockchain receipt models
- Journey lock hash computed at trip creation and anchored to Hedera HCS via SHA-256 + Ed25519 (PyNaCl)
- Hedera HCS adapter: anchoring, verification, and receipt storage
- Pydantic v2 schemas for all API endpoints; full async SQLAlchemy session via `get_db()`
- Alembic initial migration (0001_initial_schema) covering the full schema
- Auth: Supabase JWT (ES256/JWKS), `DispatcherRole` extracted from `app_metadata`, admin-dispatcher role for forensic mode
- `DriverSubstitution` model fully implemented with the four required spec fields (original driver, substituting driver, exchange location, approving dispatcher)
- Hedera verification service and blockchain receipt gating tests green
- Seed script for demo data including canonical trip TRP-2026-0041

**Dispatcher portal (Next.js 15 / TypeScript / Tailwind):**

- Active trips list with column sorting and status filtering
- Trip detail page with full timeline, event drill-down, and evidence packet viewer
- Driver fleet management page (list, create, edit, expiry tracking)
- Vehicle management pages (horses + trailers)
- Exceptions page with exception type breakdown
- Forensic mode gated behind admin-dispatcher role: blockchain receipt diff, journey lock comparison, field-level change humaniser
- Auth guard and API client with typed request wrapper
- Shared design token system and toast notifications
- Mock trip/handshake/exception data (JSON files shaped like real PP/Pulsit responses)
- Demo mode flag for presentation without live APIs

## 14.2 In progress (iteration 2)

**Backend:**

- `TripStop` model and multi-stop/multi-client refactor (FP-112)
- Journey lock hash update to include ordered stops (FP-113)
- Trip cancellation endpoint (FP-117)

**Driver PWA (Next.js 15 + Capacitor Android):**

- Shell built; Capacitor plugins installed: camera, geolocation, background geolocation, push notifications
- Five-handshake state machine and handshake meta constants
- Auth context and driver session management
- Offline evidence queue (FP-70 in progress)
- Individual handshake flows (FP-67 onwards — Tim's branch)

**Dispatcher portal:**

- Multi-stop trip wizard UI (FP-114)
- Simulation harness for end-to-end demo without live driver (`/dev/simulate/[tripId]`, FP-116)

## 14.3 Not yet modelled

- **`TripStop`** — the database entity (FP-112). Currently `Trip` has `origin_precinct_id` / `destination_precinct_id` directly; multi-stop requires the stop model.
- **`HandlingUnit` / pallet** — the consolidated unit entity between `Consignment` and `Parcel`. Open question resolved at the July site visit: does LFG scan each pallet individually, or only count units and seal the truck? Answer determines whether this becomes a tracked entity or stays a count on the handshake.
- **`ParcelScanEvent`** — per-parcel observation history with location/facility, planned post FP-121.
- **Loading order / priority fields** on consignments — confirmed as a required attribute (Bruce, 24 Jun) but not yet on the data model.
- **Return leg link** — a nullable FK on `Trip` back to the originating outbound trip, for management reporting. Not yet added.
- **Load configuration / weight fields** — declared weight and vehicle blueprint reference at trip creation. Useful for dispatcher visibility; not yet modelled.

---

# 15. Appendix: Key Changes by Version

## 15.1 v6 → v7 changes (Bruce van Wyk meeting, 24 June 2026)

| Section affected | Change type | What changed |
|---|---|---|
| Section 3.1 (Driver role) + Handshake 2 | **Critical correction** | Removed incorrect text: "the full parcel manifest appears on the driver's phone, grouped by delivery stop." The driver never sees the manifest or cargo contents. The driver's document is the linehaul: vehicle type/config, seal numbers, registration, driver details, consolidated unit count. FreightProof generates this digitally, replacing the printed hard copy. |
| Section 8.1 (Parcel Perfect) | **Add** | Third document named and defined: the LFG Linehaul (driver's document). Clarified that the full manifest is pulled from PP and shown to the **dispatcher only**. Added three-party API negotiation model: FreightProof + FedEx + Parcel Perfect; read-only framing strengthens the case. |
| Section 4 intro + 4.1 (Service models) | **Add + confirm** | Multi-client per trip confirmed as standard break-bulk/break-box practice, not an edge case. Two service models formalised: scheduled break-bulk and ad-hoc collection. Both fold into the multi-stop Trip model. |
| Handshake 0 (Trip Creation) | **Add** | Loading order and priority per consignment recorded at trip creation (e.g. urgent FedEx at door, Courier Guy at bulkhead). Return leg clarified as a new trip (not a continuation). |
| Handshake 2 (Loading) | **Add** | Load configuration domain context: trimming the load (rear-axle weight distribution), maximum legal vehicle weight, weigh bridge enforcement, and client responsibility model. |
| Section 6.1 (Active trip view) | **Update** | Dispatcher sees all client consignments, loading order and priority, per-consignment unit counts, and per-consignment scoped exceptions. |
| Section 9 (Load Configuration) | **New section** | Full domain knowledge section on load trimming, maximum weight, weigh bridges, responsibility model (client bears cost of non-compliance). |
| Section 10 (Return Legs) | **New section** | Return leg = new trip. Empty-leg visibility for management. Rotation planning feed. Design decision on trip linking noted as open. |
| Section 12 (Out of Scope) | **Add** | Camera integration (Phase 2): live/recorded vehicle camera feed on exceptions; 5-minute pre/post clip saving (Bruce to raise with Pulsit). Parcel Perfect live API integration noted as post-iteration-2. HandlingUnit entity noted as open (July visit). |
| Section 14 (Codebase state) | **New section** | Documents what is built (iteration 1 complete), what is in progress (iteration 2), and what is not yet modelled. Derived from the codebase graph. |

## 15.2 v5 → v6 changes (Bruce van Wyk meeting, 5 May 2026)

| Section affected | Change type | What changed |
|---|---|---|
| Section 8.1 (Parcel Perfect data) + Loading Handshake | Clarify | Distinguished the FedEx Parcel Perfect manifest (branch-prefixed; used for seal-break reconciliation) from the Load Factor Master Waybill (IVS-issued; cross-references FedEx manifest number; hard copy in cab). |
| Section 8.4 + Precinct entity | Clarify + Add | Formalised the data model: one Principal entity, multiple Location nodes. Gate-entry records are owned by the principal; Phase 2 data feed is the principal's own data, not a new security company integration. |
| Section 5 + Handshake 3 (driver substitution) | Reframe + Add | Planned substitutions are normal trip events, not exceptions. Required log fields: original driver ID, substituting driver ID, exchange location, approving dispatcher. |
| Section 3.1 (Driver role) | Correct + Add | Corrected "driver's own smartphone" to "company-issued Android device." POPIA monitoring scope follows device and SIM ownership. |
| Section 6.3 (SLA reporting) | Expand + Add | Added concrete SLA definition: slot times, per-route insurance cover, annexures. |
| New design principle | Add | Monitoring features must be within National Transport Act, transport industry contracts, and POPIA. Company-issued device model is the compliance mechanism. |
| Handshake 1 gate scan | Tighten | Three scans specified: vehicle disc, trailer disc, and driver's licence. |

## 15.3 v4 → v5 changes (Bruce van Wyk Q&A, April 2026)

| Section affected | Change type | What changed |
|---|---|---|
| Gate security model / Precinct entity | Reframe | SLA is with the principal, not with the security company. |
| Gate-in/gate-out verification | Strengthen | Pulsit geofence data is the primary programmatic check. |
| Unloading handshake / POD flow | Update | Documented as a two-way exchange: driver hands waybill copy to receiving handler → seals checked, load body and doors inspected → driver receives signed POD. |
| Manifest scope | Clarify | FreightProof covers the trunk haul manifest only. Last-mile delivery waybills are FedEx's product. |
| Design principles | Add | Arrival verification carries more evidential weight than departure documentation. |

## 15.4 v3 → v4 changes (summarised)

| What changed | Summary |
|---|---|
| Driver digital signature | Removed. Authenticated capture action with GPS and timestamp is the attestation. |
| Warehouse rep sign-off | Driver photographs the signed physical waybill. No digital co-sign on driver's screen. |
| Cargo Officer / POD sign-off | Cargo Officer hands driver the signed physical master POD. Driver photographs it. |
| Driver role at unloading | Visual oversight only, matching Bruce's description. |
| Door-to-door POD scope | FreightProof produces only Load Factor's depot-to-depot POD. FedEx's door-to-door POD is out of scope. |
| Order as root entity | Order number from the client is the root reference. |
| Seal capture | Seal number captured at Handshake 2, verified at Handshakes 3, 4, and 5. |

## 15.5 v2 → v3 changes (summarised)

| What changed | Summary |
|---|---|
| Guard role | Guards are not system users. FreightProof observes the scan event. |
| Driver parcel rescan | Removed. Bruce rejected this. Reconciliation is system-to-system via Parcel Perfect. |
| Receiver OTP model | Removed for depot-to-depot. OTP retained in data model for last-mile / named-consignee variants. |
| Soft panic button | Restored. Always-accessible in the PWA. |
| Document upload | Restored. Driver and dispatcher can attach documents. |
| SLA reporting | Promoted to first-class dispatcher capability. |
