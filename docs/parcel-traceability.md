# Parcel traceability

**Status:** current implementation boundary
**Updated:** 2026-08-10

FreightProof tracks custody at trip and consignment level and overlays parcel data obtained from Parcel Perfect. It does not replace warehouse scanning and must not claim to know an individual parcel's physical position more precisely than its available source evidence supports.

## Current relationships

```text
Trip
 ├─ ordered TripStop rows
 ├─ committed PhaseEvent plan
 └─ Consignment rows
     ├─ Parcel Perfect reference and raw snapshot
     ├─ pickup_stop_id / delivery_stop_id
     └─ Parcel rows identified by barcode
```

- A parcel belongs to one consignment.
- A consignment belongs to one trip.
- A consignment is intended to have one pickup stop and one delivery stop.
- A stop can receive one consignment while collecting another.
- Exceptions may reference the relevant trip, stop, phase event, and consignment.

## What can be shown honestly

| Question | Current answer |
|---|---|
| Which commercial booking contains this barcode? | Resolve the `Parcel` and its `Consignment`. |
| Which vehicle journey carried it? | Follow the consignment to its `Trip`. |
| What route and evidence plan was committed? | Read the trip's ordered stops and phase-event ledger. |
| Was the trip's pickup or delivery evidence anchored? | Inspect the departure and confirmation receipts. |
| At which exact warehouse scan station is the parcel now? | Not available unless a supported external scan source supplies that event. |
| Was an intermediate transfer completed for this specific parcel? | Not proven by the current trip-creation and scan-feed contracts. |

## Parcel Perfect boundary

Parcel Perfect remains the source for waybill and parcel information. FreightProof's integration is read-only. The real client can fetch supported consignment data, while development and demonstrations can use fixtures and mock lifecycle changes.

The available Parcel Perfect service does not supply every live scan-session event required by the proposed custody reconciliation. The warehouse `ScanFeed` abstraction therefore uses a Redis-backed mock when `SCAN_FEED_USE_MOCK=true`; selecting a live feed currently raises `NotImplementedError` rather than silently presenting simulated data as real.

## Evidence interpretation

A trip receipt proves the canonical evidence hash for the relevant custody phase. It does not independently prove the location of every parcel inside a sealed load. Parcel-level conclusions must combine:

1. The Parcel Perfect booking and parcel snapshot.
2. The consignment-to-trip assignment.
3. The committed route and relevant stop mapping.
4. Warehouse scan evidence when a real source exists.
5. The phase evidence and Hedera receipt for the vehicle custody segment.

Where one of these links is absent, the UI and evidence report must state the limitation instead of inferring a stronger result.

## Current gaps

### Per-consignment intermediate stops

The data model contains `pickup_stop_id` and `delivery_stop_id`, and the phase generator can represent work at intermediate stops. However, the current `TripConsignmentInput` does not accept those stop references. Trip creation assigns new consignments to the first and final stops.

This prevents complete end-to-end creation of a cross-dock example in which one consignment ends at the hub and another begins there.

### Live warehouse scans

There is no implemented production scan feed. Mock scan closure is useful for testing phase gates, but it is not external evidence and must be labelled as simulated in demonstrations.

### Handling units

Pallets or other consolidated handling units are not first-class entities. The current system stores counts and parcels without a separately identified physical unit between them. Add such an entity only after the industry workflow and required identifier are confirmed.

## Safe claims for submission

- FreightProof correlates Parcel Perfect consignments and parcels with a trip evidence chain.
- Selected trip evidence hashes are anchored to Hedera.
- The system can bound evidence to a vehicle journey and, where stop mapping exists, a route segment.
- Live parcel scans and intermediate consignment mapping are incomplete and are not represented as production integrations.
