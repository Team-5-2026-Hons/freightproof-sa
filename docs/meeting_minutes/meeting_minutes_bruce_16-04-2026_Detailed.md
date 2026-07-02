**FreightProof**

**Meeting Minutes**

Meeting with Bruce \(Load Factor\) — 16 April 2026



<table><tr><td><p><strong>Date</strong></p></td><td><p>Thursday, 16 April 2026</p></td></tr><tr><td><p><strong>Time</strong></p></td><td><p>~10:00 AM (concluded by 11:00 AM)</p></td></tr><tr><td><p><strong>Attendees</strong></p></td><td><p>Ciaran Formby (UCT FreightProof team); Bruce (Load Factor)</p></td></tr><tr><td><p><strong>Absent</strong></p></td><td><p>Tom (presentation conflict); Chico (did not join)</p></td></tr><tr><td><p><strong>Purpose</strong></p></td><td><p>Clarifying questions on logistics operations to inform FreightProof system design</p></td></tr><tr><td><p><strong>Prepared by</strong></p></td><td><p>Ciaran Formby</p></td></tr></table>



# **1\. Systems Overview — Parcel Perfect vs Pulseit**

Bruce clarified the distinct roles of the two key systems currently used by Load Factor and clients such as FedEx:

- Parcel Perfect is the tracking and management system for individual parcels — it prints barcoded labels, manages manifests, and records parcel\-level scans\.
- Pulseit handles vehicle tracking and geo\-fencing — it monitors truck location in real time and manages geofence events\.
- These are two separate applications that do not currently talk to each other, which is a core pain point the industry faces\.
- FedEx typically operates Parcel Perfect; Load Factor uses Pulseit for vehicle tracking\.

# **2\. Trip Lifecycle & Order Flow**

A trip \(or "load"\) originates from a client order and moves through the following stages:

## **2\.1 Order Creation**

- FedEx places an order with Load Factor: e\.g\., "I need an 8\-ton vehicle to load tonight for Durban freight\."
- Load Factor assigns a vehicle and driver, and communicates vehicle registration, driver details, and ETA to FedEx's gate/security\.
- For contracted/regular routes, this happens automatically\. For ad hoc loads, an order number is placed via email\.

## **2\.2 Loading & Departure**

- FedEx consolidates up to 100 parcels from multiple clients through Parcel Perfect — each parcel receives a barcoded label and is scanned into a container \(manifest\)\.
- The manifest then represents the full consolidated load for that vehicle\.
- When the truck is sealed, the trip formally begins on\-road\.
- Key insight: the manifest is uploaded to Parcel Perfect at sealing — this is the ideal moment for FreightProof to capture the manifest as an anchored record\.

## **2\.3 Driver Role at Pickup**

- Driver is not responsible for scanning individual parcels — that is FedEx's responsibility\.
- Driver oversees that the cargo officer scans parcels in and physically counts\. Driver's responsibility effectively ends once the truck is unlocked/opened and parcel count is verified\.
- Adding driver\-level per\-parcel scanning would slow the process unacceptably — Bruce explicitly advised against it\.

## **2\.4 Delivery & Proof of Delivery \(POD\)**

- At destination, the FedEx cargo officer scans all parcels in\. If 100 were loaded and only 99 arrive, Parcel Perfect flags an exception\.
- The cargo officer signs the master POD for Load Factor's vehicle\. This is Load Factor's trigger to invoice FedEx\.
- Load Factor's POD covers depot\-to\-depot \(Load Factor's scope\)\. FedEx's separate per\-parcel PODs cover door\-to\-door for its end customers\.
- FreightProof's evidence chain should start at manifest upload and end at POD confirmation\.

# **3\. Hub\-and\-Spoke & Multi\-Stop Consignments**

- Loads can involve multiple collection or delivery points — called a hub\-and\-spoke model\.
- Example \(multi\-collection\): An 18\-meter truck might collect a 6\-meter load from Cummins and a 12\-meter load from another supplier before delivering the full truck to FedEx Durban\.
- Example \(multi\-delivery\): Load Factor delivers 6 meters to Cummins Midrand and 12 meters to SAMBS Jet Park — same truck, two separate consignments\.
- One customer can have two delivery locations \(e\.g\., Cummins has hubs in Midrand and Jet Park\) — these are treated as two consignments\.
- This means FreightProof needs to handle multiple pickup and delivery waypoints per trip, not just a simple A\-to\-B model\.

# **4\. Gate Security & Driver/Vehicle Identity Verification**

- Different security companies operate at different warehouses: FedEx Johannesburg may use Fidelity Security Services; FedEx Durban may use G4S — each runs its own proprietary system\.
- These systems do not integrate with each other due to competitive mistrust between security firms\.
- Bruce's vision: FreightProof should act as a bridge — with IP authority granted by the client \(e\.g\., FedEx\), the system reads from both Fidelity and G4S independently and produces a unified report confirming the driver was scanned in and out\.
- This is aspirational for later iterations; for now, FreightProof should log the gate scan event and note which system performed it\.

# **5\. Insurance & Incident Logging**

- When incidents occur \(e\.g\., hijacking\), FreightProof's role is to log the event with a timestamped, location\-stamped, tamper\-proof audit trail — not to trigger emergency responses\.
- This audit trail becomes a stable, blockchain\-backed evidence package that insurers can rely on for claims assessments\.
- Bruce framed it as an assessor analogy: a lightning strike claim has separate assessors for contents vs\. structure — FreightProof provides the integrity layer that both assessors trust\.
- The value proposition to insurers: the immutability of blockchain records eliminates the possibility of data tampering that exists in current legacy systems\.
- The team agreed: FreightProof logs events; it does not replace emergency or response systems\.

# **6\. POD Structure — Two\-Tier Evidence Model**

Bruce confirmed there are two distinct POD types in a full logistics chain:

- Load Factor POD \(depot\-to\-depot\): Signed by FedEx's cargo officer upon receipt of the vehicle\. This is Load Factor's invoice trigger\.
- FedEx Customer POD \(door\-to\-door\): Issued per parcel/client after FedEx completes last\-mile delivery to each of its 100 clients\.
- FedEx cannot invoice its customers until their individual PODs are fulfilled\. Load Factor gets paid independently once its depot\-to\-depot POD is signed\.
- FreightProof scope: capture both PODs in the audit trail so FedEx has a complete picture — Load Factor's vehicle POD plus the per\-parcel customer PODs\.
- Payment terms note: Load Factor invoices FedEx 30 days after POD signing\. FedEx's own customers may have separate extended terms — this is outside FreightProof's scope\.

# **7\. Parcel Perfect Integration Path**

- Bruce offered to provide mid\-range access to Parcel Perfect — similar to the vehicle tracking access already granted — so the team can explore the reports it generates\.
- Parcel Perfect produces collection reports and delivery reports\. The manifest is the core artefact: it lists all parcels, the vehicle/driver details, and client references\.
- Agreed iteration plan:

- Iteration 1: Begin core FreightProof development; anchor Parcel Perfect into scope\.
- Iteration 2: Integrate Parcel Perfect — pull the manifest at departure and POD at delivery\.
- Iteration 3: Integrate Pulseit for real\-time vehicle location and geo\-fence events\.

- Bruce knows the owner of IDVS personally and can facilitate introductions to developers at Parcel Perfect and Pulseit when the team reaches integration stages\.

# **8\. Tech Stack Confirmed**

- Frontend: Next\.js — Bruce noted this as the current industry standard\.
- Backend: Python — chosen based on team's existing proficiency\.
- Bruce will share this stack with his contacts at Parcel Perfect, IDVS, and Pulseit so integration conversations are technically grounded\.

# **9\. Key Design Decisions & Implications for FreightProof**



<table><tr><td><p><strong>Design Decision</strong></p></td><td><p><strong>Implication</strong></p></td></tr><tr><td><p><strong>No per-parcel driver scanning</strong></p></td><td><p>FreightProof tracks at manifest level, not item level. Driver oversight only.</p></td></tr><tr><td><p><strong>Multiple waypoints per trip</strong></p></td><td><p>Data model must support hub-and-spoke: 1 trip → N pickup/delivery legs.</p></td></tr><tr><td><p><strong>Security systems don't integrate</strong></p></td><td><p>Build a bridge pattern: pull independently from each system, present unified view.</p></td></tr><tr><td><p><strong>Manifest available at truck sealing</strong></p></td><td><p>This is the natural anchor point for trip start evidence on the blockchain.</p></td></tr><tr><td><p><strong>Two POD types exist</strong></p></td><td><p>Store both: Load Factor depot POD and FedEx customer-level POD.</p></td></tr><tr><td><p><strong>Fragmented multi-platform environment</strong></p></td><td><p>FreightProof's value is the unified report, not replacing individual systems.</p></td></tr></table>



# **10\. Action Items**



<table><tr><td><p><strong>Owner</strong></p></td><td><p><strong>Action</strong></p></td><td><p><strong>Priority</strong></p></td></tr><tr><td><p><strong>Bruce</strong></p></td><td><p>Share Parcel Perfect mid-range access so team can explore report outputs</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Bruce</strong></p></td><td><p>Review FreightProof full-picture document over weekend (post-golf Saturday)</p></td><td><p><strong>Medium</strong></p></td></tr><tr><td><p><strong>Bruce</strong></p></td><td><p>Facilitate developer introductions for Parcel Perfect and Pulseit when integration phase begins</p></td><td><p><strong>Medium</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Update full-picture document to reflect: multi-waypoint model, two-tier POD structure, manifest-as-anchor, and bridge architecture for security systems</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Begin Iteration 1 development; scope Parcel Perfect into Iteration 1 planning</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Revise system architecture diagrams to reflect depot-to-depot focus with hub-and-spoke legs</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Define data model for multi-pickup/multi-delivery trips</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Plan Iteration 2: Parcel Perfect manifest pull at departure + POD pull at delivery</p></td><td><p><strong>Medium</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Plan Iteration 3: Pulseit vehicle tracking and geo-fence integration</p></td><td><p><strong>Medium</strong></p></td></tr></table>



# **11\. Next Steps & Notes**

- Bruce has limited availability this week; expects to review documents by end of weekend\.
- Mid\-May is the target for Iteration 1 delivery — development must start imminently\.
- Bruce expressed strong enthusiasm for the project, framing it as a meaningful improvement to a fragmented and security\-challenged industry\.
- The system is extensible beyond road: Bruce explicitly noted air freight works identically in principle \("one has wings, the other has a chassis"\)\.
- No next meeting date set — team to follow up after sharing updated documentation\.

*End of Meeting Minutes — FreightProof \| INF4027W \| UCT 2026*