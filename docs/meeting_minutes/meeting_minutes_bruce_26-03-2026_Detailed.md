**FreightProof**

**Meeting Minutes**

Meeting with Bruce \(Load Factor\) — 26 March 2026



<table><tr><td><p><strong>Date</strong></p></td><td><p>Thursday, 26 March 2026</p></td></tr><tr><td><p><strong>Time</strong></p></td><td><p>Morning (duration approximately 45 minutes)</p></td></tr><tr><td><p><strong>Attendees</strong></p></td><td><p>Ciaran Formby, Tim Gultig, additional team members (UCT FreightProof team); Bruce (Load Factor)</p></td></tr><tr><td><p><strong>Purpose</strong></p></td><td><p>Operational deep-dive: load types, vehicle configurations, waybill/manifest workflows, fraud handling, and scanning technology options</p></td></tr><tr><td><p><strong>Prepared by</strong></p></td><td><p>Ciaran Formby</p></td></tr><tr><td><p><strong>Context</strong></p></td><td><p>Follow-up to Bruce's feedback on the team's earlier presentation; focused on refining application design details</p></td></tr></table>



# **1\. Load Types: Full Truckload vs Break Bulk**

Bruce clarified the two primary service models that FreightProof needs to accommodate:

## **1\.1 Full Truckload \(FTL\) / Dedicated Load**

- A single client \(e\.g\., FedEx\) fills an entire vehicle\. The consolidated cargo travels from origin depot to destination depot — typically Johannesburg to Durban — for last\-mile distribution\.
- Industry term: Full Truckload \(FTL\) or Dedicated Load\.
- This is depot\-to\-depot: Load Factor's scope ends when the cargo is delivered to the client's destination depot\.

## **1\.2 Break Bulk \(Consolidated Load\)**

- Multiple courier companies \(FedEx, RTT, Aramex, etc\.\) each contribute pallets to a single vehicle\. Load Factor trucks to its own Durban branch, deconsolidates, and distributes each company's freight to their respective Durban operations\.
- Industry term: Break Bulk\.
- This model means the destination is always Load Factor's own branch — not directly a client's warehouse — making it simpler to manage from a data perspective\.

## **1\.3 Multi\-Pickup / Multi\-Delivery \(Hub & Spoke\)**

- Even on full truckload jobs, multiple collection or delivery points are common\. Example: RTT books an 18\-meter truck; Load Factor collects 10 pallets from the Blood Bank in Robertsham/Krugersdorp and 8 pallets from Cummins in Johannesburg, then delivers to SAMBS and Cummins in Durban respectively\.
- Slot times govern collection and delivery: each client's DC provides a scheduled time window\. These are uploaded into Parcel Perfect by Load Factor\. Slot times are written on the waybill by the client\.
- Key implication: FreightProof's data model must support N pickup points and N delivery points per trip, with each leg tracked independently\.

# **2\. Waybills — Digital vs Manual**

- For high\-volume, regular clients \(e\.g\., RTT to RTT\), Load Factor deploys label printers and waybill printers on\-site — full Parcel Perfect integration, fully digital\.
- For lower\-volume or irregular clients \(e\.g\., SAMBS\), deploying hardware is not cost\-justified\. Waybills are printed and issued to the driver manually\.
- The waybill \(waybill\) serves as the proof of delivery: the receiving party counts pallets, confirms condition, and signs the waybill\. Two waybills on a multi\-stop truck means two separate PODs — one per consignment/client\.
- Bruce's vision for FreightProof: the app replicates the waybill digitally\. The customer signs on the driver's device \(phone or tablet\) at collection and delivery\. The signed record uploads into the system and marries with Parcel Perfect — this is the "touch\-on\-loss" concept Bruce referenced\.
- This digital signature flow eliminates the paper waybill entirely for clients already on Parcel Perfect, and provides an upgrade path for manual clients\.

# **3\. Vehicle Configurations & Tracking Requirements**

Bruce outlined four vehicle categories, each with different tracking implications:



<table><tr><td><p><strong>Vehicle Type</strong></p></td><td><p><strong>Configuration</strong></p></td><td><p><strong>Tracking Units Required</strong></p></td></tr><tr><td><p><strong>8–14 ton closed body</strong></p></td><td><p>Single unit — horse and body are one</p></td><td><p>1 tracker (horse/body combined)</p></td></tr><tr><td><p><strong>Horse + 12m trailer</strong></p></td><td><p>Two separate units — horse can detach</p></td><td><p>2 trackers: horse + trailer</p></td></tr><tr><td><p><strong>Horse + 6m trailer</strong></p></td><td><p>Two separate units</p></td><td><p>2 trackers: horse + trailer</p></td></tr><tr><td><p><strong>18m configuration</strong></p></td><td><p>Horse + 12m trailer + 6m trailer (two separate trailers)</p></td><td><p>3 trackers: horse + 12m + 6m</p></td></tr></table>



- Critical design point: the horse and trailer can be separated mid\-trip\. Example: if SAMBS is delayed, Load Factor may drop the 12m trailer at the destination and redeploy the horse elsewhere while the trailer waits\. FreightProof must track trailer location independently from the horse\.
- FreightProof verification logic update: at trip start, the system must cross\-reference driver location, horse tracker, and each trailer tracker — not just driver and horse\.

# **4\. Pulseit: Route Monitoring, Control Center & Incident Management**

- Pulseit activates when the vehicle leaves the geofence at origin and produces a full route report — speed, route adherence, stops, and deviations — through to delivery completion\.
- Load Factor's control center monitors each route\. Controllers check in on drivers periodically via the camera system \(not phone/WhatsApp — that causes distraction risk\) and monitor driving behaviour: harsh braking, acceleration, route deviation\.
- For full load containers, Load Factor's own control center manages the vehicle\. For clients like FedEx or RTT, protocols are handed over to the client's control center\.

## **4\.1 Panic Button & Hijacking Protocol**

- Two physical panic buttons per truck: one hidden near the driver's exit point \(typically near the door, since drivers instinctively move to the door during a hijacking\), one on the master key\.
- Activation triggers an immediate response from a reaction company — either armed response or towing service depending on context\.
- All of this is hardware\-level data from Pulseit \(analogous to a vehicle tracker\)\.
- The team proposed an additional soft panic button within the driver's phone app\. Bruce confirmed this is valuable — the more alert channels, the faster the reaction\.
- FreightProof implication: the driver app should include an accessible panic trigger\. Activation should be logged to the blockchain audit trail with timestamp and GPS coordinates\.

## **4\.2 Route Deviation & Fraud Flagging**

- If a driver deviates from the route \(e\.g\., stops at an out\-of\-scope fuel station\), the system flags the geofence breach\. Controllers investigate and decide on a response\.
- FreightProof should capture these deviation flags as events in the evidence chain — not just the start and end of a trip, but notable events along the route\.

# **5\. Parcel\-Level Scanning & NFC/Barcode Technology**

## **5\.1 Current Parcel Perfect Scanning**

- Parcel Perfect supports per\-parcel scanning down to sub\-consignment level\. Example: SAMBS loads 20 parcels on one pallet destined for 20 different blood donation outlets\. The pallet scans in as one unit on the truck, but Parcel Perfect can then deconsolidate it and scan each of the 20 parcels to their individual destination outlets\.
- FreightProof can pull this scanning data via the Parcel Perfect API — no need to replicate it independently\.

## **5\.2 NFC vs Barcode — Technology Evaluation**

The team discussed upgrading from standard barcodes to NFC tags for parcel\-level tracking\. Key findings:

- Standard barcode labels: ~R0\.00001 per label\. Requires a handheld scanner to read\.
- NFC tags: approximately R0\.003 per tag \(213 tags for ~R5 at bulk\)\. Every smartphone has a built\-in NFC reader — no additional hardware needed per worker\.
- RFID \(for reference\): ~R20,000\+ for truck\-mounted scanners — ruled out for MVP\.
- NFC advantage: a passive NFC reader at the truck door could automatically log every parcel entering and exiting the vehicle without manual scanning\. This would enrich per\-parcel tracking significantly\.
- Bruce's reaction: enthusiastic\. He confirmed that cross\-deliveries \(wrong parcel dropped at wrong warehouse\) happen daily and are a genuine pain point\. The fractional cost increase from barcode to NFC is, in his words, a no\-brainer if the data it produces justifies it\.
- Action: team to conduct more detailed NFC feasibility analysis and cost modelling at scale before committing to the approach in the design documentation\.

# **6\. Evidence Chain & Fraud — Insurance Value**

- Bruce confirmed that in normal operations, payment speed is not significantly affected by the evidence trail — clients only scrutinise when there is a discrepancy \(hijacking, delay, damage\)\.
- The real commercial value is twofold:

- Incident evidence: In a hijacking or loss claim, a complete, tamper\-proof audit trail with blockchain backing gives the insurer and the client irrefutable evidence\. Current systems can be altered post\-hoc — FreightProof's cannot\.
- SLA compliance reporting: Load Factor operates under SLAs \(e\.g\., 97\.5% on\-time performance for RTT\)\. The data trail allows Load Factor to prove compliance — or diagnose failures — and use that as a competitive differentiator when pitching new clients\.

- Bruce explicitly stated: if he can prove a 97%\+ service record to a prospective client like Aramex, the FreightProof report becomes a sales tool, not just an operational one\.
- Document upload feature confirmed as valuable: drivers or warehouse staff can attach photos, signed waybill images, or other documents to the trip record\. This closes the loop on manual workflows that Parcel Perfect doesn't yet cover\.

# **7\. API Integration Strategy**

- Bruce confirmed he can facilitate access to the Parcel Perfect API — Load Factor operates on Parcel Perfect, so he will request an API key on the team's behalf\. FreightProof will not be able to obtain direct access independently as it is not a Parcel Perfect customer\.
- Bruce offered to test the Business Analysis document against Parcel Perfect and Pulseit: he will scope the document against what each system can and cannot provide, and return feedback on whether the envisioned integrations are practically achievable\.
- Bruce's broader design philosophy: build FreightProof as a plug\-and\-play integration layer\. If it integrates cleanly with Parcel Perfect and Pulseit, it will be ~90% of the way to working with any logistics system in the market\. The goal is to go to any software vendor and say: integration is easy, cost\-effective, and carries no data integrity risk\.
- There is no public documentation for either Parcel Perfect or Pulseit APIs — Bruce acknowledged this and confirmed that direct facilitation through Load Factor is the only practical path to integration details\.

# **8\. Design Implications Summary**



<table><tr><td><p><strong>Insight</strong></p></td><td><p><strong>Implication for FreightProof</strong></p></td></tr><tr><td><p><strong>FTL and break bulk are distinct load types</strong></p></td><td><p>System must handle both; break bulk always terminates at Load Factor's own branch</p></td></tr><tr><td><p><strong>Multi-stop trips with slot times are common</strong></p></td><td><p>Data model needs N-leg support; slot times should be a captured field</p></td></tr><tr><td><p><strong>Horse and trailer can decouple mid-trip</strong></p></td><td><p>Track horse and each trailer independently; verification checks all three at departure</p></td></tr><tr><td><p><strong>Waybills can be digital or manual depending on client volume</strong></p></td><td><p>Digital signature on driver device replaces paper; syncs to Parcel Perfect</p></td></tr><tr><td><p><strong>NFC tags offer passive auto-scanning at truck door</strong></p></td><td><p>Evaluate for MVP+1; daily cross-delivery errors validate the use case</p></td></tr><tr><td><p><strong>Pulseit produces full route report with geofence events</strong></p></td><td><p>Pull route report at trip end; log deviation events as evidence chain entries</p></td></tr><tr><td><p><strong>Panic button on app adds a reaction channel</strong></p></td><td><p>Driver app must include accessible panic trigger with GPS/timestamp log</p></td></tr><tr><td><p><strong>SLA data has commercial sales value beyond operations</strong></p></td><td><p>Report design should include SLA metrics as a client-facing feature</p></td></tr></table>



# **9\. Action Items**



<table><tr><td><p><strong>Owner</strong></p></td><td><p><strong>Action</strong></p></td><td><p><strong>Priority</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Send Business Analysis & Innovation document to Bruce for him to scope against Parcel Perfect and Pulseit</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Update data model to support: (a) multi-leg trips, (b) independent horse + trailer tracking, (c) slot time fields per leg</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Add digital waybill / touch-on-loss signature flow to driver app design</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Add driver app panic button to system design; ensure GPS + timestamp is logged to audit trail on activation</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Add document upload feature to trip evidence trail (photos, signed waybills, condition images)</p></td><td><p><strong>Medium</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Conduct NFC vs barcode cost-benefit analysis at scale; include in Business Analysis document</p></td><td><p><strong>Medium</strong></p></td></tr><tr><td><p><strong>Ciaran / Team</strong></p></td><td><p>Write detailed background sections on Parcel Perfect and Pulseit for submission documents</p></td><td><p><strong>Medium</strong></p></td></tr><tr><td><p><strong>Bruce</strong></p></td><td><p>Facilitate Parcel Perfect API access for FreightProof team</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Bruce</strong></p></td><td><p>Review Business Analysis document and scope against Parcel Perfect and Pulseit; return written feedback</p></td><td><p><strong>High</strong></p></td></tr><tr><td><p><strong>Bruce</strong></p></td><td><p>Confirm Cape Town trip dates (civil aviation audits, ~2 weeks); arrange warehouse walkthrough for team if feasible</p></td><td><p><strong>Low</strong></p></td></tr></table>



# **10\. Additional Notes**

- Bruce offered to arrange a warehouse walkthrough in Cape Town if his civil aviation audit trip proceeds within the next two weeks\. This would give the team direct exposure to daily logistics operations\. Status: pending date confirmation\.
- The lecturers' feedback from the presentation was positive — the team was noted for strong progress from the start of year\. The key critique was to go deeper into specific workflows and user touchpoints, which this meeting directly addresses\.
- Bruce reiterated his commercial interest: cross\-deliveries happen daily; the insurance evidence use case and SLA reporting use case are both real, validated pain points — not assumptions\.

*End of Meeting Minutes — FreightProof \| INF4027W \| UCT 2026*