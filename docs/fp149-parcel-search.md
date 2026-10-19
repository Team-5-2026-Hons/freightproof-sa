# FP-149: Parcel Search

## User flow

Open **Trips > Parcel Search** (`/parcels`) as a dispatcher or admin dispatcher.

### Search form and navigation

The page starts with a centred barcode form. Enter an exact parcel barcode. Leading
zeros and case are preserved; surrounding whitespace is trimmed; Enter submits. After
a valid submission, or when the page is opened with a barcode in the URL, the form
compacts above the results and stays compact for loading, ambiguity, no-match and
error outcomes. **Clear** replaces the URL with `/parcels` and restores the centred
layout.

The URL is the submitted query. Editing the box does not clear the result on screen;
while the draft differs from the submitted barcode the page says "Showing results for
{barcode}", so an unsubmitted draft is never presented as searched. An invalid submit
shows an error on the field and leaves the submitted query and its result alone.

- A new search or waybill choice adds a browser-history entry, so Back and Forward
  restore the earlier query, the draft and its result. Resubmitting the same query
  refetches without adding history.
- Results are keyed by the submitted query: a changed query, or a different signed-in
  account or organisation, withdraws the previous evidence before anything new renders.
- After an in-page transition (submit, waybill choice, Back/Forward, retry) focus moves
  to the outcome heading: the barcode summary for a result, the chooser heading for
  several waybills, or the no-match or failure heading. A first load from a deep link
  leaves focus where the browser put it. One status message announces loading and
  completion; the evidence itself is not a live region.

A single matching waybill opens automatically. Multiple matches require an explicit
selection and can be paged using **More matching waybills**.

### Result, in reading order

One column on every screen width, in one card. The selected result shows:

1. **Header**: the barcode heading; a status badge (for a cancelled trip "Trip cancelled
   after {last recorded phase}" or "before any recorded phase", in the same red as the trip
   list; otherwise the journey progress wording); an "i" button opening **How to read this
   parcel record** (parcel scans do not identify their source system or whether it was
   simulated; vehicle and phone positions are inherited from consignment evidence, not
   parcel GPS; the contents of a sealed leg are not observable; and the coverage note);
   and the waybill with the latest journey's route.
2. **Status line**: "Last recorded: {the last recorded step} on {time}." and nothing else.
   What is missing is in the not-recorded row. It never says a parcel is lost, delivered,
   in custody, safe, intact or verified.
3. **What was recorded for this parcel**: a vertical rail of plain steps for the latest
   journey, using the trip page timeline's dots and line, in this order: scan-out per
   parcel record ("Scanned out at origin"), the recorded phases that concern this
   consignment ("Consignment loaded", "Departed, sealed {seal}", "Arrived at {place}" and
   so on, ledger order, never sorted by time), "Trip cancelled" on a cancelled journey
   (with no time, because none is recorded), and scan-in per parcel record. Several parcel
   records stay separate steps ("· parcel record n"). Each step is a native disclosure
   whose summary is the title and one line of time, place and (for loading) vehicle, with
   at most one issue pill: the exception count with how many need review, else a location
   finding that needs attention. An overridden step says so, and a phase whose relevance
   the backend could not decide is tagged "Relevance unknown". Opening a step shows its
   exceptions as compact one-line links (time, type, severity, review state; the
   description is read on the exception page), then a label/value list: location finding,
   the last recorded vehicle or phone position (on the phase it was captured for, with
   capture time and phase-record time kept apart), device capture time, recorded seal and
   anchor state; then the "not parcel GPS or live tracking" note, "Contents of a sealed
   load are not observable" on a sealed departure, any override note, and **Open phase
   evidence**. Phases that do not concern this consignment are not steps; they are counted
   beside **View trip**.
4. **Not recorded**: one muted row naming what has no record, in ledger order: origin
   scan-out, each unrecorded consignment phase (with its place when a phase repeats),
   seal check, destination scan. The journey's evidence gaps follow, verbatim from the
   API. With no not-recorded row the gaps are the last row. When no phase is attributed
   to the consignment the timeline says "No phases are attributed to this consignment.
   See the full trip ledger."
5. **View trip**: a button to the trip page, with "{n} phases · {k} trip-wide exceptions"
   beside it.
6. **Earlier trips**: a plain section at the bottom, shown only when there are earlier
   trips or more to load, with how many are loaded and "more available" when more exist.
   Each earlier trip is one compact row (reference, its trip status chip, route, and
   "Planned manifest only" when it is a manifest association) that opens to that
   journey's own timeline and **View trip** button, with its own scans only. **Load earlier
   journeys** fetches the next page, and open rows stay open.

Review states read Recorded, Needs review or Reviewed; any other value is shown as it
arrives. Links to existing trip, phase and exception evidence preserve the barcode and
waybill on return. A barcode with no associated journey shows its identity and the
message "No associated journey is recorded", and the same "i" button.

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
- A sealed leg compares recorded departure and inspection facts for one leg. Matching
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
expand a step, then open phase evidence and use Back. Also try an
unknown barcode and a regular dispatcher account. Demonstrate older journeys only
when the selected barcode has retained historical associations.

Run backend DB tests against the disposable database from
`infrastructure/docker/docker-compose.test.yml`, never the shared Supabase database.
On Windows, `python -X utf8 -m pytest` avoids legacy platform-default decoding in
repository source-inspection tests.
