**MEETING MINUTES**

FreightProof Capstone — Stakeholder Check\-In with Bruce \(Load Factor\)



<table><tr><td><p><strong>Date</strong></p></td><td><p>5 May 2026</p></td></tr><tr><td><p><strong>Time</strong></p></td><td><p>Morning (exact time not recorded)</p></td></tr><tr><td><p><strong>Location</strong></p></td><td><p>Remote (video call)</p></td></tr><tr><td><p><strong>Attendees</strong></p></td><td><p>Ciaran Formby, Tim, Tom, Chico (FreightProof team); Bruce (Load Factor, Industry Mentor)</p></td></tr><tr><td><p><strong>Recorded by</strong></p></td><td><p>Ciaran Formby</p></td></tr><tr><td><p><strong>Next meeting</strong></p></td><td><p>Two weeks from 5 May 2026 (Iteration 1 deadline)</p></td></tr></table>



# **1\. Purpose of Meeting**

The team convened with industry mentor Bruce \(Load Factor Group\) to clarify outstanding operational questions ahead of the Iteration 1 milestone, which requires a working front\-end demo in approximately two weeks\. The meeting covered trip lifecycle, manifest and waybill documentation, principal structure, driver substitution protocols, device policy, SLA structure, and the approach to live integration with Parcel Perfect and Pulseit\.

# **2\. Iteration 1 Demo Approach**

The team explained the constraints of demoing a logistics tracking system to academic assessors:

- Live geofence triggers \(e\.g\., a truck physically arriving at a location\) cannot be replicated in a classroom demo environment\.
- For Iteration 1, each handshake or stage transition in the chain of custody will be triggered by a button press in the UI to simulate the event\.
- In production, the intended flow is: driver receives trip on app → Pulseit automatically triggers arrival at a geofenced location → system advances to the next stage \(gate entry or parcel loading\)\.

Bruce acknowledged this approach and offered to assist with the demo environment if needed\.

# **3\. Gate Entry and Guard Notification Process**

Bruce clarified the “blue sky” \(ideal state\) notification workflow:

- Load Factor notifies the security company acting as gate operator of an incoming vehicle, providing: vehicle type, colour, registration number, trailer number \(if applicable\), driver ID, and ETA\.
- The guard performs two scans on arrival: \(1\) the vehicle licence disc barcode, \(2\) the trailer licence disc barcode \(if a trailer is present\), and \(3\) the driver’s licence barcode\.
- The guard’s system correlates this data against what was pre\-notified, then uploads the record into the principal’s system \(e\.g\., FedEx\)\.
- FedEx \(as principal\) is the owner of this gate\-entry data\. Load Factor provides the pre\-alert; FedEx/Citix owns the gate record\.

# **4\. Manifest and Waybill Structure**

## **4\.1 The Manifest**

- The manifest is created and owned by FedEx via Parcel Perfect and covers all parcels consolidated onto a single Load Factor vehicle for a given departure\.
- It contains: sender and receiver details, parcel count, weight, and other freight metadata for each of the \(potentially 100\+\) clients whose goods are loaded onto the truck\.
- Manifest reference numbers carry a location prefix indicating the originating branch \(e\.g\., JNB for Johannesburg, CT for Cape Town, DBN for Durban\)\.
- The manifest is the primary document used to verify cargo integrity: upon seal break at destination, FedEx reconciles physical cargo against the manifest line by line\.
- A copy of the manifest travels with the vehicle so that in the event of an accident or incident, the response team can immediately identify cargo and losses\.
- Load Factor runs its own internal system \(IVS\) and issues a Master Waybill that cross\-references the FedEx manifest number \(e\.g\., Master Waybill references Manifest 69\)\.
- The Master Waybill captures the consolidated load: total parcels, total weight, vehicle type, and trip reference\.
- Currently, the trip waybill and master waybill are issued as hard copies that the driver carries in the cab alongside a copy of the manifest\.
- The team confirmed this is the key documentation set that needs to be digitised and linked to a specific trip in FreightProof\.
- FreightProof should allow a specific manifest \(identified by its branch prefix \+ number\) to be associated with a trip record\.
- Bruce confirmed that an API integration between Parcel Perfect and FreightProof is the intended long\-term approach, with data fields to be agreed between the parties per the SLA\.
- The team asked whether they define the data mapping or FedEx does — Bruce confirmed that the principal \(FedEx\) typically specifies their data demands; Load Factor \(and by extension FreightProof\) then implements accordingly\.

## **4\.2 Load Factor Waybill \(Master Waybill\)**

## **4\.3 Linking Documents to a Trip**

# **5\. Principal Structure — FedEx as a Single National Principal**

- The team asked whether FedEx Johannesburg and FedEx Durban should be modelled as separate principals in the system\.
- Bruce confirmed they should be treated as one national principal with separate location nodes, not separate principals\.
- FedEx operates a national control centre \(typically JHB or Cape Town\) that enforces standardised operating procedures across all branches\.
- Conclusion for data model: one Principal entity \(FedEx\), multiple Location records, each capturing their own gate, manifest, and departure data to a common standard\.

# **6\. SLA \(Service Level Agreement\) Structure**

- The SLA is an overarching agreement between Load Factor and the principal \(e\.g\., FedEx\), not a per\-trip document\.
- It defines service requirements \(e\.g\., truck must be at the FedEx depot by 12:00 daily\), cargo insurance requirements per route \(e\.g\., R3M cover for Cape Town runs, R1M for Durban day runs\), and operational conformance standards\.
- Bruce will forward a redacted sample SLA \(LFG–NGL agreement\) including its annexures \(covering routing, operational environment, etc\.\) for the team’s reference\.
- Bruce noted that FreightProof itself will eventually require its own SLA with LFG and/or FedEx, and understanding the LFG–NGL structure gives useful context for what that SLA should contain\.

# **7\. Driver Devices and Operating System**

- Drivers carry two phones: a personal phone and a company\-issued device\.
- Load Factor standardises on Android \(Samsung preferred\) for company phones; other Android brands \(e\.g\., OPPO\) have caused operational issues and are avoided\.
- Devices are provisioned through carrier agreements \(e\.g\., MTN\); when drivers turn over, the device is reassigned or replaced with a similar/upgraded model\.
- POPIA applies to personal devices; the company’s monitoring reach is limited to company\-owned SIM cards and devices\.

# **8\. Labour Law and Driver Monitoring**

- Tim raised the question of whether union labour agreements restrict GPS tracking, selfie signatures, or other monitoring of drivers\.
- Bruce confirmed this is governed by the National Transport Act and industry\-specific transport contracts, which intersect with POPIA\.
- The team can source a standard transport industry driver contract online to understand permitted monitoring parameters\.
- Action: Team to review the relevant section of the Transport Act and a standard driver contract before designing monitoring features\.

# **9\. Mid\-Trip Driver Substitutions**

- Driver substitutions during a trip are a known operational event and should be recorded as such in FreightProof, not flagged as an exception\.
- Standard exchange points are pre\-agreed in the SLA and included as geofenced locations in Pulseit \(e\.g\., the fuelling station at Harrismith for JHB–DBN runs, used for both northbound and southbound exchanges\)\.
- If a driver exchange is not planned for a given night, the geofence for that stop can be removed from the trip in Pulseit so it does not generate a false alert\.
- The system should log: original driver ID, substituting driver ID, exchange location, and approving dispatcher\.

# **10\. Action Items**



<table><tr><td><p><strong>#</strong></p></td><td><p><strong>Action</strong></p></td><td><p><strong>Owner</strong></p></td><td><p><strong>Due</strong></p></td></tr><tr><td><p>1</p></td><td><p>Send redacted SLA (LFG–NGL) including annexures to the team</p></td><td><p>Bruce</p></td><td><p>ASAP</p></td></tr><tr><td><p>2</p></td><td><p>Send an example manifest (sanitised) so the team can understand fields and unique identifiers</p></td><td><p>Bruce</p></td><td><p>ASAP</p></td></tr><tr><td><p>3</p></td><td><p>Review Transport Act (transport industry driver contract section) to understand GPS/monitoring constraints</p></td><td><p>Ciaran / Tim</p></td><td><p>Before Iter. 1</p></td></tr><tr><td><p>4</p></td><td><p>Complete UI mockups and front-end implementation for Iteration 1 demo (button-triggered chain-of-custody flow)</p></td><td><p>Full team</p></td><td><p>~19 May 2026</p></td></tr><tr><td><p>5</p></td><td><p>Map data model fields for Parcel Perfect API integration (manifest fields, waybill cross-reference)</p></td><td><p>Ciaran / Tim</p></td><td><p>Before Iter. 1</p></td></tr><tr><td><p>6</p></td><td><p>Confirm geofenced exchange points (e.g., Harrismith) are included in demo trip route</p></td><td><p>Full team</p></td><td><p>Before Iter. 1</p></td></tr><tr><td><p>7</p></td><td><p>Contact Bruce if demo assistance is needed (WhatsApp or email — Bruce is available between civil aviation audits)</p></td><td><p>Ciaran</p></td><td><p>As needed</p></td></tr></table>



# **11\. Next Steps**

- Iteration 1 document and demo due in approximately two weeks \(c\. 19 May 2026\)\.
- Demo will present the full JHB–DBN FedEx trip lifecycle as a button\-triggered UI walkthrough\.
- Backend and API integration work \(Parcel Perfect, Pulseit\) will be prioritised in Iteration 2 and beyond\.
- Bruce offered continued availability for ad\-hoc questions via WhatsApp and email\.

*\-\-\- End of Minutes \-\-\-*