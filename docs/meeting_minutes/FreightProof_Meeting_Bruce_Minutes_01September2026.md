# Meeting Minutes — Parcel Tracking System: Parcel Perfect & Pulse Integration

**Date:** 1 September 2026 (01/09/2026)
**Attendees:** Bruce (Load Factor Group), Ciaran Formby, Chiko Kasongo, Tim Gultig, Thomas Davis

---

## 1. Parcel Perfect Access

- The team demoed a mocked Parcel Perfect integration using a client sandbox, but found the sandbox only allows retrieval of a waybill — not the live scan status (i.e. cannot tell when a parcel is scanned in/out of a facility).
- Parcel Perfect's owners have been reluctant to grant this access since the team isn't attached to a specific client, and are cautious about what the thesis/project could mean for their system.
- **Workaround:** Bruce has a client, **X International** (Cape Town-based), who also uses Parcel Perfect and has offered to give the team visibility into live events within their environment, circumventing Parcel Perfect's restrictions.
- X International is connected to "Giovanni" (control) and "Nelson Dextera" — Bruce is meeting Giovanni this week and will follow up by early next week (targeting **Monday**) with an introduction and access.

## 2. Pulse (Pulsit) Access

- Bruce has a long-standing relationship with **Harry(if) Van**, Commercial Director at Pulsit, and will set up an introduction between the team and Harry.
- Bruce flagged this needs to be handled carefully/confidentially, and asked Ciaran to be the team's point of contact ("champion") on security/confidentiality, since credential sharing (e.g. to a client environment) is sensitive. Ciaran agreed and will relay findings back to the rest of the team.
- **Interim option:** Bruce offered to give the team access to one of Pulse's key suppliers, e.g. **Modco/Martco**, to get a sense of what data Pulse can offer ahead of the team's mid-September deadline (presentation on the 17th/18th September). Ciaran confirmed this would help and would like to proceed with it.
- Bruce's two action items on this front:
  1. Set the team up with Harry (Pulsit).
  2. Introduce the team to Modco/Martco.

## 3. Truck & Driver Location Tracking

- The team currently has driver phone/device location working in the system.
- By the next iteration (17th–18th September), the goal is to incorporate truck location too — likely mocked using spare phones for demo purposes if a live integration isn't feasible in time.

## 4. Delivery Confirmation / Multi-Party Verification (Chain of Custody)

Question raised: how can receipt at the destination be verified by both the driver and the receiver (not just the driver)?

Bruce explained there are **three locking/verification mechanisms** on the back of a vehicle:
1. **Geofence lock** — installed and run by Pulsit; could form part of the Pulse integration/handshake.
2. **Fifth lock** — a physical mechanical lock over the truck's rear doors.
3. **RTT seal** — a unique barcoded seal. Once RTT scans and breaks the seal, Load Factor's obligation/custody ends. The seal number is recorded on the waybill between Load Factor and RTT (not held by the driver). One branch alerts the destination branch that the seal number must remain intact; the destination branch verifies the seal number, then breaks it — this is the exact moment custody transfers.

- Currently the team's system has the driver take a photo of the seal on departure and another on arrival (mocked, since there's no real lock hardware yet).
- Bruce noted the physical lock mechanism could ideally speak directly to the system when unlocked, and that from Pulse's side, the geofence door opening is their verification moment — it would help to tie this in with the seal barcode scan as a backup/cross-check.

## 5. Analytics Requirements

Prompted by earlier feedback from an industry panel member (from BSG) about the importance of analytics. Bruce's input on what's most valuable:

- **Driver performance:** fatigue, unnecessary braking, and other behavior indicators of a good/bad/indifferent driver.
- **Situational/route risk management:** e.g. identifying hotspots for incidents (protests, unrest) by route/time of year (examples given: Heidelberg, Pietermaritzburg, Colesberg) — used both to reroute vehicles in real time and to build longer-term mitigation action plans.
- **Fuel monitoring:** fuel is ~50% of operating cost, so it's tracked closely, including risks like diesel skimming/leakage by drivers. Tracking includes:
  - Standard metrics (km travelled, vehicle condition/mileage).
  - Fuel tank gauges and 360° camera monitoring for leakage.
  - Hardware for this typically comes through Pulse (or via vehicle manufacturer systems, e.g. Isuzu's own fuel/vehicle monitoring system on new vehicles).
- Cost context given: a Johannesburg–Durban truck run costs ~R20,000, with an estimated ~13,000 vehicles passing through certain routes on a given night — fuel is a large and lucrative cost category, hence the scrutiny.
- Driver fatigue/behavior data (braking, seat sensors that detect slumping and can trigger a dash-cam alert, panic button, etc.) all comes through Pulse's hardware/software.
- Bruce's view: Pulse's hardware (e.g. the geo-locking locks — one of only three suppliers of this in South Africa) and sensor range is extensive, but the **industry doesn't consistently use or standardize what data it pulls from Pulse** — usage is fragmented, with no agreed "five key metrics" that everyone wants tracked.
- Bruce sees FreightProof's value as bridging Parcel Perfect + Pulse + driver management + fuel management into one easy-to-use, non-complicated dashboard for the industry.

## 6. Other Action Items

- Ciaran to message the RTT contact again about setting up another site visit (previous contact was on leave).
- Bruce offered to arrange further site visits with RTT/X International as needed.

## Summary of Bruce's Next Steps (by Monday)
1. Meet Giovanni (Friday) and set up Cape Town / X International access to Parcel Perfect live event visibility.
2. Introduce the team to Harry Van at Pulsit.
3. Introduce the team to Modco/Martco for a sandbox view of Pulse data.
