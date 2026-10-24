# Demo rehearsal manifests (101–130)

Thirty mock Parcel Perfect manifests for rehearsing the demo. They sit beside the walkthrough
manifest (81) and the testing batch (84–98), which are untouched. Source:
`backend/app/integrations/parcel_perfect/manifest_fixtures.py` (the "Rehearsal batch" section);
checks: `backend/tests/unit/test_pp_rehearsal_batch.py` and
`backend/tests/integration/test_pp_rehearsal_batch_trips.py`.

Every manifest is closed, belongs to one client (`MOCK01`, CGY Logistics) and starts with clean
cargo: no POD, no delivery failure, no scans, no trip, no exception. The batch records no outcome.
Happy and unhappy runs come from the real driver flow and the dev triggers panel.
A manifest is spent once a live trip holds it (`MANIFEST_ALREADY_ON_TRIP`); cancel the trip to reuse it.

## Catalogue

Waybills are `MFTWB<manifest><line>`, e.g. `MFTWB10301` and `MFTWB10302` on manifest 103. Parcel
barcodes are the waybill plus a four-digit parcel number, e.g. `MFTWB103010001`.

| Manifest | Route | Hubs | Waybills | Parcels |
|---|---|---|---|---|
| 101 | Cavendish → UCT North Stop | CAV→UCN | 1 | 2 |
| 102 | Cavendish → UCT North Stop | CAV→UCN | 1 | 3 |
| 103 | Cavendish → UCT North Stop | CAV→UCN | 2 | 6 |
| 104 | Cavendish → UCT North Stop | CAV→UCN | 2 | 8 |
| 105 | Cavendish → UCT North Stop | CAV→UCN | 3 | 12 |
| 106 | Cavendish → UCT North Stop | CAV→UCN | 4 | 14 |
| 107 | UCT North Stop → Cavendish | UCN→CAV | 1 | 3 |
| 108 | UCT North Stop → Cavendish | UCN→CAV | 2 | 5 |
| 109 | UCT North Stop → Cavendish | UCN→CAV | 1 | 2 |
| 110 | UCT North Stop → Cavendish | UCN→CAV | 3 | 9 |
| 111 | UCT North Stop → Cavendish | UCN→CAV | 2 | 7 |
| 112 | UCT North Stop → Cavendish | UCN→CAV | 4 | 12 |
| 113 | UCT South Stop → UCT North Stop | UCS→UCN | 1 | 3 |
| 114 | UCT South Stop → UCT North Stop | UCS→UCN | 1 | 2 |
| 115 | UCT South Stop → UCT North Stop | UCS→UCN | 3 | 9 |
| 116 | UCT South Stop → UCT North Stop | UCS→UCN | 2 | 8 |
| 117 | UCT South Stop → UCT North Stop | UCS→UCN | 2 | 6 |
| 118 | UCT South Stop → UCT North Stop | UCS→UCN | 4 | 12 |
| 119 | UCT North Stop → UCT South Stop | UCN→UCS | 1 | 2 |
| 120 | UCT North Stop → UCT South Stop | UCN→UCS | 2 | 5 |
| 121 | UCT North Stop → UCT South Stop | UCN→UCS | 2 | 7 |
| 122 | UCT North Stop → UCT South Stop | UCN→UCS | 1 | 5 |
| 123 | UCT North Stop → UCT South Stop | UCN→UCS | 3 | 9 |
| 124 | UCT North Stop → UCT South Stop | UCN→UCS | 4 | 12 |
| 125 | Cape Town Depot (Epping) → Johannesburg Depot (Linbro) | CPT→JNB | 2 | 10 |
| 126 | Johannesburg Depot (Linbro) → Cape Town Depot (Epping) | JNB→CPT | 1 | 5 |
| 127 | Cape Town Depot (Epping) → Bloemfontein Depot (Hamilton) | CPT→BFN | 3 | 16 |
| 128 | Bloemfontein Depot (Hamilton) → Cape Town Depot (Epping) | BFN→CPT | 2 | 9 |
| 129 | Bloemfontein Depot (Hamilton) → Johannesburg Depot (Linbro) | BFN→JNB | 1 | 4 |
| 130 | Johannesburg Depot (Linbro) → Bloemfontein Depot (Hamilton) | JNB→BFN | 2 | 9 |

Quick physical demonstrations (2–3 parcels): 101, 102, 107, 109, 113, 114, 119.

## Suggested reservations

Each scenario gets a primary and a same-shape backup on the same route.

| Scenario | Primary | Backup | Why |
|---|---|---|---|
| Clean delivery | 101 (1 waybill, 2 parcels) | 102 | Smallest cargo, nothing to go wrong |
| Discrepancy | 103 (2 waybills, 6 parcels) | 104 | A missing or extra parcel needs more than one parcel on a waybill |
| Serious incident | 105 (3 waybills, 12 parcels) | 106 | Enough cargo for a believable loss |
| Driver transfer | 129 (1 waybill, 4 parcels; BFN→JNB, the shortest national leg) | 130 | A handover reads naturally on a long leg. For a walkable version use 113 / 114 |
| Spares | 107–124, 125–128 | | Any local or national manifest not listed above |

## Precinct selection

**The three local routes need a manual precinct pick.** Cavendish, UCT North Stop and UCT South
Stop were created by hand in the dispatcher. Nothing in the app writes `pp_hub_code`
(only `scripts/seed_demo.py` does, and only for the three national depots), so the local hubs
`CAV`, `UCN` and `UCS` preview as unlinked. The preview shows two non-blocking prompts,
`ORIGIN_HUB_UNLINKED` and `DESTINATION_HUB_UNLINKED`, and the presenter chooses:

| Manifest hubs | Origin precinct | Destination precinct |
|---|---|---|
| CAV→UCN (101–106) | Cavendish | UCT North Stop |
| UCN→CAV (107–112) | UCT North Stop | Cavendish |
| UCS→UCN (113–118) | UCT South Stop | UCT North Stop |
| UCN→UCS (119–124) | UCT North Stop | UCT South Stop |

Without a pick, create fails with `PRECINCT_REQUIRED`. The wizard sends the picks as
`origin_precinct_id` and `destination_precinct_id`.

No local route is ever mapped to a national depot. The national manifests (125–130) use
`CPT`, `BFN` and `JNB`, which `seed_demo.py` links, so they resolve with no prompts. This
needs the seeder to have been run since the FP-281 migration.

Before rehearsing, check that each local precinct belongs to the issuing client (CGY Logistics,
account `MOCK01`) and is shared with the operator. The pick is refused with
`PRECINCT_NOT_AVAILABLE` otherwise. This was not checked against the live database.

If the database owner later sets `pp_hub_code` to `CAV`, `UCN` and `UCS` on those precincts, the
existing automatic mapping takes over and the picks are no longer needed. Nothing in this
batch does that.

## Default schedule

Times are South African time and re-resolved against today on every lookup, so no manifest
carries a calendar date.

| Manifests | Created | Closed | Departs | Arrives |
|---|---|---|---|---|
| Local, 101–124 | 07:00 | 08:15 | 09:00 | 09:45 |
| CPT↔JNB, 125–126 | 12:00 | 16:30 | 20:00 | 11:00 next day |
| CPT↔BFN, 127–128 | 12:00 | 16:30 | 20:00 | 07:00 next day |
| BFN↔JNB, 129–130 | 12:00 | 16:30 | 20:00 | 01:30 next day |

What this means for a rehearsal:

- **Activation needs no adjustment.** It only checks that today is the scheduled day, so a trip
  can start at any hour. Starting after the planned departure is allowed and shows as late.
- **Adjust only for looks.** To avoid a trip showing as late or overdue, override the planned
  departure and arrival in the wizard before creating, or stage them with
  `POST /api/v1/dev/pp/manifest {"manifest_number": 101, "planned_departure_at": ..., "expected_arrival_at": ...}`
  before the preview. A staged value is stored once, so the preview and the create hash the
  same snapshot.
- **One crew per local trip.** All 24 local manifests share the 09:00–09:45 window, so the same
  driver, horse or trailer on two of them is refused as `CREW_UNAVAILABLE`. Use a different
  crew for each, or stagger the times in the wizard.
- **Start-in-order.** One driver's trips on one day must be started in departure order. Equal
  times never block each other.
- **Driver transfer.** The incoming driver must have no other trip in the window, or the
  handover is blocked as `DRIVER_UNAVAILABLE`.
- **Midnight.** If the clock crosses midnight between a preview and its create, the manifest
  dates move and the create returns `MANIFEST_CHANGED`. Preview again.

## Notes on the fixture data

- Local addresses are descriptive text on the waybills (for example "UCT North Stop, Upper
  Campus, Rondebosch"), not geocoded. Adjust them in `waybill_fixtures.py` if they should match
  the precinct addresses exactly.
- UCT North and South Stop share the town `RONDEBOSCH`; the address and receiver name tell them apart.
