# FP-149: Parcel Search

## User flow

Open **Trips > Parcel Search** (`/parcels`) as a dispatcher or admin dispatcher.
Enter an exact parcel barcode. Leading zeros and case are preserved; surrounding
whitespace is trimmed. A single matching waybill opens automatically. Multiple
matches require an explicit selection and can be paged using **More matching waybills**.

The selected result shows:

- Current recorded state for the newest matching journey, derived from its phase ledger.
- The last recorded vehicle/phone position within the consignment's journey, with
  capture time and phase-record time kept separate.
- Recorded phase history, grouped into individual sealed-load custody legs.
- Parcel scan timestamps, separate from inherited consignment evidence.
- Missing evidence, overrides and relevant exceptions.
- Links to existing trip/phase evidence, preserving the barcode and waybill on return.
- Earlier matching journeys via **Load earlier journeys** when another page exists.

The old `/blockchain/receipts` frontend page is removed. The backend receipt lookup,
receipt listing and verification APIs retain their existing contracts and permissions.
FP-266's scanner is separate work.

## Read contract

Both endpoints use `get_current_dispatcher` and scope associations to the caller's
operator organisation. Neither changes a parcel, trip or phase record.

### `GET /api/v1/parcels/lookup`

Parameters:

- `barcode`: required, 1-100 visible characters.
- `after`: optional waybill reference from `next_after`.

Returns `barcode`, up to 20 `items` (`waybill_reference`, `journey_count`), and
`next_after`. Unknown and foreign-only barcodes both return an empty list.
Barcodes are not globally unique; current and archived associations are deduplicated
by waybill and trip before counting.

### `GET /api/v1/parcels/trace`

Parameters:

- `barcode` and `waybill_reference`: required.
- `cursor`: optional opaque continuation token.
- `limit`: 1-10 journeys; default 5.

Returns `journeys`, newest trip first, `next_cursor`, and a coverage note. Each journey
contains all of its stored phases in ledger order. Missing/foreign traces return 404;
invalid identifiers or cursors return 422. API authentication retains the project's
existing missing-token 403 and invalid-token 401 conventions.

## Evidence rules and coverage

- The join is parcel identity -> consignment -> trip -> stored phase events/stops.
  There is no new event table, migration, write-side collector or external API call.
- Trip progress is derived from the first unresolved phase, respecting completed,
  exception and overridden states. The trace does not call the mutating
  `recompute_position()` helper or trust cached `Trip.current_phase/current_stop`.
- The consignment's pickup/delivery window limits inherited movement. Later truck
  movement is not presented as movement of cargo already delivered. Other cargo's
  loading/unloading at intermediate stops is identified as trip context.
- Legacy plans remain as recorded; arrival phases and capture timestamps are never
  invented. An override is not evidence of physical arrival or an intact seal.
- A seal band compares recorded departure and inspection facts for one leg. Matching
  seal numbers/condition do not assert that loss in transit was physically impossible.
- Scan columns do not record source/mock provenance. The UI explicitly leaves it unknown;
  it does not label them as live Parcel Perfect observations.
- Cancelled/recreated manifest trips can be discovered from retained creation snapshots,
  even after their old parcel rows disappear. These are labelled planned manifest
  associations and never borrow scan stamps from the replacement trip.
- Earlier associations without surviving links or snapshots cannot be reconstructed.
  Missing pickup/delivery boundaries are labelled unknown. Raw PP payloads, contacts,
  hashes and receipt metadata are not included in the trace DTO.

## Verification and demo

Backend tests: `tests/unit/test_parcel_trace_projection.py` and
`tests/integration/test_parcel_trace.py`. Frontend tests live beside the parcel
components, `useParcelTrace`, sidebar and trip page. Existing receipt integration
tests continue to cover the retained APIs. API/auth baseline updates are additive.

For a manual demo, copy a barcode from an existing trip's Cargo view, search it,
expand a departure/arrival entry, then open phase evidence and use Back. Also try an
unknown barcode and a regular dispatcher account. Demonstrate older journeys only
when the selected barcode has retained historical associations.

Run backend DB tests against the disposable database from
`infrastructure/docker/docker-compose.test.yml`, never the shared Supabase database.
On Windows, `python -X utf8 -m pytest` avoids legacy platform-default decoding in
repository source-inspection tests.
