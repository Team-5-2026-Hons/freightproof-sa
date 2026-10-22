# Dispatcher assistant: coverage audit (every page's facts → a tool, a pointer, or a refusal)

**Written** 2026-10-21 by Claude (read-only audit, a side session of the assistant build). Branch
`feature/dispatcher-assistant`, working tree as found on 21 Oct (Stages 0–5 built, Stage 6 being built in parallel:
`tools_actions.py` exists but isn't finished). **Nothing else was edited.** Companion to
`2026-10-21-dispatcher-assistant-spec.md` (decisions D0–D14, B1–B31).

**Why:** Tom's three simple test questions (driver licence expiry B29, one driver's trip count B31, a wrong pointer to
the Analytics chat) each hit a gap nobody had listed. This audit lists every fact the dispatcher app shows, page by
page, and says what the assistant does with a question about it, so the gaps are known before an examiner finds them.

---

## 1. Summary

**Tools today (10 read tools):** `trips`, `trip_status`, `needs_attention`, `crew_bookings`, `free_crew`,
`trip_history`, `vehicle_status`, `expiring_documents`, `route_time`, `parcel_lookup`
(`backend/app/orchestration/assistant/tools.py:21`). Stage 6 adds `open_trip_form`, `open_page`, `analytics_redirect`
(`tools_actions.py`, in progress).

**Coverage table (§3): 109 rows, every dispatcher page included.**

| Verdict | Rows | Meaning |
|---|---|---|
| OK | 33 | A tool answers it today (or Stage 6 will, marked "Stage 6") |
| **ADD** | **20** | A real dispatcher question with no tool, or a tool that can give a different number from the page. Covered by 8 changes (below) |
| POINT | 40 | Deliberately not answered; the reply names the page (and the tab) |
| REFUSE | 15 | Out of scope by project rule (numbers, GPS, changes, advice, rankings); each still names the page |
| FIX | 1 | Not a coverage gap: a link to a page that doesn't exist (L0). Two more fixes ride on other rows (S1, and `open_page "trips"` under L0): 3 fixes in all, listed below |

Rows that are partly answered are split into two rows, so each row has one verdict.

### The ADD items, ranked by how likely an examiner is to ask

Each is the smallest change that answers the rows behind it. Numbers in brackets are the §3 rows.

1. **Past "when" words** (`when.py:30-33`). Presets are all forward-looking: no `yesterday`, `last_week`, `this_month`,
   `last_month`, `last_n_days`; `weekday` always means the *next* one (spec §5.3), and `this_week` runs from **now**
   to Monday, so "how many trips did we close this week?" counts nothing before this moment. Every history question
   ("what did Sipho do yesterday?", "trips closed last month") either breaks D12 (the model works out dates) or gets
   the wrong window. Add past presets (`yesterday`, `last_week`, `this_month`, `last_month`, `last_n_days`,
   `last_weekday`) and a `this_week_so_far` (Monday 00:00 to now); add a hint in `hints.py` for "last"/"ago". (H1, H4, C1)
2. **Review queue totals in `needs_attention`.** The Exceptions page header counts every `needs_review` exception in
   the organisation on **any** trip (`exceptions/page.tsx:269-273` → `exceptions/queries.py:216-218`, no trip-status
   filter). `needs_attention` only looks at live trips (`tools_trips.py:385`, `OCCUPYING_STATUSES`), so "how many
   exceptions need review?" can give a **smaller number than the page**: the B29 kind of miss, a wrong fact. Add
   `queue_total`, by severity, plus `claimed`/`unclaimed` counts, from `list_review_queue`. (E1, E2)
3. **Record integrity on `trip_status`.** FreightProof is a blockchain evidence platform; "is this trip on the
   blockchain?" is the examiner's most natural question and nothing answers it. Add the **stored** tally the trip
   page shows (`IntegritySummary.tsx:18-21`, `lib/phase/derive.ts:138-144`): journey lock anchored yes/no (from
   `TripDetailResponse.blockchain_receipts`) and phase receipts anchored / owed / failed (from `phases[].anchor_status`).
   No Hedera call. The reply must not claim "not tampered with": the live check is the page's Verify button (POINT
   for that verdict, T17). (T16)
4. **A `roster` tool** (new, one tool for four lists): counts of active and inactive drivers, horses and trailers,
   and the depots (name, address, owned or shared, **never coordinates**), with names capped like `free_crew`.
   Reuses `list_drivers`, `list_vehicles`, `list_precincts` (the pages' own reads). Today "how many drivers do we
   have?" has no tool: `free_crew` and `expiring_documents` count active records only, in passing. (R1, R2, V1, V2,
   L1, M1)
5. **More fields on `trip_status`**, each computed in code so the model never subtracts: `delivery_confirmed`
   (the trip page's "Delivery confirmed", `TripInformation.tsx:35`), `closed` (`:36`), `departure_delay` and
   `arrival_delay` (the page's delay text, `TripInformation.tsx:67-73`, `lib/format/schedule`), `parcels_booked` and
   `scanned_out` / `scanned_in` counts (`trip-detail.ts:169-180`, `ManifestContent.tsx:80-85`). (T2, T3, T4, T6)
6. **`which_time: "closed"` on `trips`** for the `closed` and `cancelled` groups, filtering on `closed_at` exactly as
   the History page does (`trips/listing.py:225-237`). Today a closed trip is matched by its departure or arrival
   time (`tools_trips.py:195-197`), so "trips closed yesterday" and the History page's date filter can disagree (a
   trip cancelled today for next week's departure isn't "cancelled today"). (H1, H2)
7. **Incidents beyond open ones.** `needs_attention` lists `open` and `investigating` only, with no type or date
   filter (`tools_trips.py:284-291`), and `IncidentLine` has no investigator or unresolved-parcel count. Add optional
   `incident_status` (`open` default, `closed`, `all`), `incident_type` and `when` inputs, and `investigated_by`
   (staff name, D1 allows names), `parcels_unresolved`, `outcome` (enum, never `closure_reason`, which is typed) to
   `IncidentLine`. (I2, I3, J1)
8. **Vehicle specs on `vehicle_status`**: make, model, year, length, GVM (`fleet/vehicles/[id]/page.tsx:278-290`).
   Low likelihood, but a one-line answer and no personal data. (V3)

### The three FIXes (for the Stage 6 session; not edited here)

- **"Open trips list" goes to a 404.** `components/assistant/cards/TripCards.tsx:52` links `ROUTES.trips` (`/trips`),
  but there is no `app/(app)/trips/page.tsx` and no redirect (`next.config` only sets headers). Active trips are on
  the Dashboard (`/`), closed and cancelled on History (`/history`).
- **`open_page` offers `"trips"`** (`schemas/assistant.py:358-361`): same 404.
- **`open_page` offers `"sla"`**: `/sla` is a placeholder that always shows "No data" (`lib/hooks/useSLAMetrics.ts:14`,
  "Phase 1 stub"), and it isn't in the sidebar (`components/layout/Sidebar.tsx:40-71`). On-time figures live on
  the Analytics page.

### Two smaller notes

- `results.ACTIVE_DEFINITION` says "the dashboard's Active trips **tile**". The Dashboard has no tile any more
  (`app/(app)/page.tsx:133`, "No stat strip: fleet figures live on the Analytics page"); it is the **Active Trips
  list**, and the count is its row count. The Analytics page's "Live trips" tile counts the same statuses. Suggest
  "the Dashboard's Active Trips list" so a reply never sends a dispatcher looking for a tile.
- The Analytics chat has **no per-driver or per-vehicle figures** (FP-295 D5, `2026-10-19-fp295-analytics-chat-spec.md:72`)
  and no per-site guard figures. It **does** list the busiest sites and every lane, fleet-wide
  (`analytics_chat/tools.py:242-249`). So: one driver/vehicle/depot → that record's page; fleet-wide → Analytics chat.

---

## 2. Rules used for the verdicts

- **OK**: a tool's trimmed result (`results.py`) holds the fact, read the same way as the page.
- **ADD**: a likely dispatcher question with no tool, or a tool whose number can differ from the page's.
- **POINT**: the page has it, but the chat doesn't send it: typed free text (descriptions, notes, summaries), photos and
  evidence files, identifiers with no use in a chat (VIN, tracker id, seal and case numbers, Hedera ids),
  record-change logs, per-phase timelines, and **one driver's, vehicle's or depot's performance figures** (shown on
  that record's page Analytics tab; the Analytics chat doesn't have them, the assistant must not compute them).
- **REFUSE**: phone, ID or licence **numbers**; GPS coordinates (trucks and depots: spec §5.2 forbids `lat`/`lng`);
  saving or changing anything (D2); advice on responding to an incident; ranking, comparing or scoring drivers. A
  refusal still names the page where the dispatcher can do or see it.
- Personal data (CLAUDE.md POPIA, spec D1): names may go to the model; never ID, phone or licence numbers, email,
  GPS, or typed text.

---

## 3. Coverage table

Backend reads: Dashboard and trip lists `GET /trips` → `orchestration/trips/listing.list_trips`; trip page
`GET /trips/{id}` → `trips/detail.get_trip_detail` (`TripDetailResponse`, `schemas/trips.py:365-414`); History
`GET /trips/history` → `listing.list_trip_history` (closed + cancelled, `listing.py:204`); Exceptions
`GET /exceptions/review-queue` and `/exceptions/history` (`api/v1/endpoints/exceptions.py:95-152`); Incidents
`incidents/queries.list_incidents` (`IncidentRead`, `schemas/incidents.py:233-256`); Drivers/Vehicles
`fleet/drivers`, `fleet/vehicles`; Precincts `list_precincts`; Parcels `parcel_trace.service`.

### Dashboard `/` (`app/(app)/page.tsx`, columns `components/trips/tripColumns.tsx:114-195`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| D1 | Active Trips list: `created` + `active` + `exception_hold` (`page.tsx:36`) | "How many trips are live right now?" | `trips` (`status_group: active`, D10 breakdown) | OK |
| D2 | Per row: trip ID, manifest key and client, driver and horse, route, status chip with phase and "stop · n/m" (`tripColumns.tsx:131-195`) | "Who's driving AB12CD34 and where is it in the trip?" | `trip_status` (current driver, horse, phase, progress) | OK |
| D3 | Exceptions column: "N need review" or "None need review", red edge, attention sort (`tripColumns.tsx:94-105`) | "Which live trips have critical exceptions?" | `needs_attention` (`severity_at_least: critical`) | OK |
| D4 | Search by trip ID, driver or manifest (`page.tsx:136`) | "Which trip has manifest 81?" | `trip_status` (`manifest_number`) | OK |
| D5 | Created date column (`page.tsx:44`) | "When was trip AB12CD34 booked?" | none (`TripLine` has no created time) | POINT (Dashboard row / trip page) |
| D6 | Today's date and organisation name in the header (`page.tsx:109-110`) | "Which company am I signed in for?" | none | POINT (Settings › Account) |

### Trips list `/trips`

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| L0 | **No page.** `ROUTES.trips` (`lib/constants/routes.ts:6`) has no `app/(app)/trips/page.tsx` | "Open the trips list" | `TripCards.tsx:52` and `open_page "trips"` link to a 404 | FIX (link Dashboard for live, History for closed) |

### Trip page `/trips/[id]` (`app/(app)/trips/[id]/page.tsx`, header `components/trips/TripSummary.tsx`, facts `lib/phase/trip-detail.ts:218-233`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| T1 | Reference, manifest label, route, status/phase, current driver, vehicles, next schedule milestone, "N exceptions need review" (`TripSummary.tsx:53-81`) | "What's the status of FP-20261020-AB12CD34?" | `trip_status` | OK |
| T2 | Planned and recorded departure/arrival with "x min late" (`TripInformation.tsx:33-34, 67-73`) | "How late did AB12CD34 arrive?" | `trip_status` gives both times, no delay: the model would subtract (D12) | ADD (#5 `arrival_delay`, `departure_delay`) |
| T3 | Delivery confirmed time (`TripInformation.tsx:35`) | "Has the receiver signed for AB12CD34?" | none | ADD (#5 `delivery_confirmed`) |
| T4 | Closed or cancelled time (`TripInformation.tsx:36`) | "When was AB12CD34 closed?" | none (`TripLine` has no `closed_at`) | ADD (#5 `closed`) |
| T5 | Route stops in order (`TripInformation.tsx:39-55`) | "Which depots does AB12CD34 stop at?" | `trip_status.stops` | OK |
| T5b | Each stop's slot time (`TripInformation.tsx:54`) | "What's the slot time at stop 2?" | none | POINT (trip page › Info › Route) |
| T6 | Cargo: booked parcels, counts recorded at origin/destination (`trip-detail.ts:169-180`); Cargo tab waybills, parcels, scanned out/in, units (`ManifestContent.tsx:80-85`) | "How many parcels are on AB12CD34, and were they all scanned in?" | none | ADD (#5 parcel counts) |
| T6b | Cargo tab: each waybill and parcel line (`ManifestContent.tsx:114-160`) | "Is waybill 12345 on this trip?" | `parcel_lookup` (waybill → trips carrying it) | OK |
| T7 | Custody: last departure seal number (`TripInformation.tsx:30`) | "What's the seal number on AB12CD34?" | none; seal numbers deliberately not sent (B12) | POINT (trip page › Info › Custody) |
| T8 | Driver and handover: current and original driver (`DriverSubstitutionPanel.tsx:76-77`) | "Was AB12CD34 handed over to another driver?" | `trip_status.original_driver` | OK |
| T8b | Custody period, custody integrity chip, handover history, pending handover (`DriverSubstitutionPanel.tsx:78-94, 154`) | "Is there a handover waiting on AB12CD34?" | none | POINT (trip page › Info › Driver and handover) |
| T9 | Driver card: phone, licence number (`DriverModal.tsx:28-29`) | "What's the driver's phone number?" | never sent (§5.2) | REFUSE |
| T9b | Driver card: licence expiry (`DriverModal.tsx:32`) | "Is this trip's driver's licence still valid?" | `expiring_documents` (one driver) | OK |
| T9c | Driver card: identity check status (`DriverModal.tsx:33`) | "Was the driver's identity verified?" | none | POINT (trip page › driver card) |
| T10 | Vehicle card: make, model, year, VIN, GVM, length (`VehicleModal.tsx:31-37`) | "What truck is on AB12CD34?" | `trip_status` (registration); specs see V3 | OK |
| T11 | Timeline: every phase's status, times, evidence (photos, scans, seals, check-ins), receipts (`TripTimeline.tsx`, `PhaseEvidence.tsx`) | "When did loading finish on AB12CD34? Show me the photos." | `trip_status` gives the current phase and progress only | POINT (trip page timeline) |
| T12 | Exceptions tab: each exception's type, severity, review state (`TripExceptionsPanel`) | "What exceptions are open on AB12CD34?" | `trip_status.open_exceptions` (counts by severity + types) | OK |
| T12b | Each exception's description and review note | "What did the driver report?" | typed text never sent (D1 b) | POINT (exception page) |
| T13 | Incidents section on the trip (`TripIncidentsSection.tsx:24`) | "Is there an incident on AB12CD34?" | `trip_status.open_incidents` (open + investigating) | OK |
| T14 | Late driver evidence, awaiting review (`LateDriverEvidencePanel.tsx:48-97`) | "Did the driver upload anything late?" | none | POINT (trip page › Info › Late driver evidence) |
| T15 | Audit packs, police and notifications: SAPS case number, station (`AuditPacksPanel.tsx:97-173`, admin only) | "Has an audit pack been issued? What's the SAPS case number?" | none | POINT (trip page › Info › Audit packs, admin) |
| T16 | Record integrity: "n of m phase receipts anchored", failed anchors (`IntegritySummary.tsx:18-21`) | "Is AB12CD34 anchored on the blockchain?" | none | ADD (#3 stored anchor tally) |
| T17 | Record integrity: live Verify against Hedera, "Checked at" (`IntegritySummary.tsx:22-23`) | "Has AB12CD34 been tampered with?" | none; a stored tally is not a verdict | POINT (trip page › Record integrity › Verify) |
| T18 | Map with GPS positions | "Where exactly is the truck on AB12CD34?" | coordinates never sent; `trip_status` gives the phase | REFUSE (coords) + phase + POINT (trip page map) |
| T19 | Cancel trip, override a phase, report incident, issue audit pack, review exceptions (`TripInformation.tsx:57-61`, `TripDetailPanel.tsx:10-13`) | "Cancel AB12CD34." | never changes anything (D2) | REFUSE + POINT (trip page) |

### Trip form `/trips/new` (`app/(app)/trips/new/page.tsx`, `components/trips/new/*`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| N1 | Manifest preview: client, route hubs, open/closed, can it become a trip, warnings (`ManifestSummary.tsx:18-67`, `schemas/pp_manifest.py:145-159`) | "Can manifest 81 become a trip?" | `open_trip_form` pre-check | OK (Stage 6) |
| N1b | Manifest totals: waybills, parcels, weight (`ManifestSummary.tsx:40-42`) | "How heavy is manifest 81?" | not in any result unless Stage 6's `form_preview` carries totals | POINT (trip form, after lookup) |
| N2 | Crew greyed out when busy in the chosen window (`page.tsx:79-81`, `useCrewAvailability`) | "Can I use Sipho on Thursday at 06:00?" | `crew_bookings` (same FP-139 rule) | OK |
| N3 | Create the trip | "Create a trip with manifest 81." | `open_trip_form` opens the filled form; never saves (D2) | OK (Stage 6) |

### History `/history` (`app/(app)/history/page.tsx` → `list_trip_history`, closed and cancelled, filtered on `closed_at`, `listing.py:225-237`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| H1 | "N closed trips" for a closed-date range (`history/page.tsx:88`) | "How many trips did we close last week?" | `trips` (`closed`) needs a window, but there is no past preset, and it filters on departure/arrival, not `closed_at` | ADD (#1 past presets, #6 `which_time: closed`) |
| H2 | Route filter: trips from or to one depot (`history/page.tsx:93-98`) | "Which trips closed at Durban this month?" | `trips` (`closed`, `precinct_name`, `when`) | OK once #1 and #6 land |
| H3 | Search by driver | "How many trips has Sipho completed?" | `trip_history` (counts as his page, incl. handovers) | OK |
| H4 | Cancelled trips in the same list | "How many trips were cancelled this month?" | `trips` (`cancelled`) | ADD (#1 `this_month`, #6) |
| H5 | Trends in closed trips over weeks | "Are we doing more trips than last quarter?" | Analytics chat (`activity`) | POINT (Analytics) |

### Exceptions `/exceptions` (`app/(app)/exceptions/page.tsx`, columns `components/exceptions/exceptionColumns.tsx:60-145`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| E1 | "N needing review", whole organisation, any trip (`page.tsx:269-273`; `queries.py:216-218`) | "How many exceptions are waiting for review?" | `needs_attention` counts live trips only: can be smaller than the page | ADD (#2 queue totals) |
| E2 | Unreviewed / Claimed by me / claimed by a colleague (`page.tsx:97, 211-219`; `claimed_by_user_id`, `schemas/transit.py:399-401`) | "How many are unclaimed?" | none (`TripAttentionResponse.claimed` exists but isn't passed on) | ADD (#2 claimed/unclaimed) |
| E2b | "Claimed by me" tab | "Which exceptions have I claimed?" | the tools don't know who is asking | POINT (Exceptions › Claimed by me) |
| E3 | Each row: type, severity, description, reference, phase/stop, trip and route, driver and vehicles, raised time, claim (`exceptionColumns.tsx:63-145`) | "What's the newest critical exception?" | trip-level counts and types only | POINT (Exceptions page) |
| E4 | Severity filter, date range, group by trip | "Show me only the critical ones." | `open_page` with `exceptions_severity` | OK (Stage 6) |
| E5 | History tab: reviewed and recorded exceptions, outcomes (`page.tsx:219`, `/exceptions/history`) | "How many exceptions did we review this week, and what did we conclude?" | none for single records; fleet-wide review speed and outcomes are the Review desk tab | POINT (Exceptions › History; Analytics › Review desk) |
| E6 | Claim, release, take over, batch review | "Claim the hijacking alert on AB12CD34." | never changes anything | REFUSE + POINT |

### Exception page `/exceptions/[id]` (`app/(app)/exceptions/[id]/page.tsx:295-388`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| X1 | Type, severity, review state, trip, raised, source, phase, route, driver, truck, trailers (`page.tsx:309-333`) | "Who was driving when the breakdown on AB12CD34 was raised?" | `trip_status` gives the trip's driver and open exception types, not one exception's | POINT (exception page) |
| X2 | Description, review note, outcome, contact method, reviewer, reviewed at (`page.tsx:336-380`) | "What did the reviewer conclude about the GPS mismatch?" | typed text never sent | POINT (exception page) |
| X3 | Evidence and Hedera links (`page.tsx:383-386`) | "Is there a photo for this exception?" | none | POINT (exception page) |

### Incidents `/incidents` (`app/(app)/incidents/page.tsx:25-39`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| I1 | Open and investigating incidents: trip, reference, type, status, received (`page.tsx:33-39`) | "Any open incidents?" | `needs_attention.open_incidents` | OK |
| I2 | Status filter incl. Closed, type filter (`page.tsx:25-29, 72`) | "List the closed incidents." / "Any hijackings this month?" | open and investigating only, no type or date filter | ADD (#7 filters) |
| I3 | "Investigated by", "Unresolved n of m" parcels (`page.tsx:37-38`) | "Who's investigating INC-3?" | none | ADD (#7 `investigated_by`, `parcels_unresolved`) |
| I4 | "What was reported" summary (`page.tsx:36`) | "What happened in INC-3?" | typed text never sent | POINT (incident page) |
| I5 | "Mine only" filter (`page.tsx:78`) | "Which incidents are mine?" | the tools don't know who is asking | POINT (Incidents › Mine only) |
| I6 | Fleet-wide incident trends | "How many hijackings this year compared with last?" | Analytics chat (`problems`: theft warning signs by type) | POINT (Analytics) |

### Incident page `/incidents/[id]` (`components/incidents/IncidentDetailView.tsx:153-235`, `IncidentStatusStrip.tsx:16-40`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| J1 | Strip: trip status, "stopped by this incident", exceptions n of m reviewed, incident status with confidence or outcome (`IncidentStatusStrip.tsx:17-38`) | "Is INC-3 closed, and what was the outcome?" | status only (`IncidentLine.status`) | ADD (#7 `outcome`) |
| J2 | Reported by (role, name), channel, reportedly happened, when we were told, recorded by, established (`IncidentDetailView.tsx:175-181`) | "When were we told about the hijacking?" | `received` only; reporter names and `closure_reason` are typed | POINT (incident page) |
| J3 | Hijacking response guide (`IncidentDetailView.tsx:185-194`) | "What should I do about this hijacking?" | never advises (spec rejected alternatives) | REFUSE + POINT (incident page › Hijacking response) |
| J4 | Affected cargo: each parcel's scan state and finding (`AffectedCargoPanel.tsx:47`) | "Which parcels were on the hijacked truck?" | `parcels_total` only | POINT (incident page › Affected cargo) |
| J5 | Evidence and history of updates (`IncidentDetailView.tsx:201-232`) | "What updates has INC-3 had?" | typed text never sent | POINT (incident page) |
| J6 | Add update, take ownership, mark investigating, close, reopen, stop trip (`IncidentDetailView.tsx:211-224`) | "Close INC-3." | never changes anything | REFUSE + POINT |

### Drivers `/fleet/drivers` (`app/(app)/fleet/drivers/page.tsx`, columns `components/drivers/driverColumns.tsx:56-95`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| R1 | Every driver, Active/Inactive, status filter (`page.tsx:38-40`, `driverColumns.tsx:89`) | "How many drivers do we have? How many are inactive?" | none (`free_crew` and `expiring_documents` count active ones only, in passing) | ADD (#4 `roster`) |
| R2 | The list itself | "List our drivers." | none | ADD (#4 `roster`) |
| R3 | Licence expiry with colour band (`driverColumns.tsx:84`) | "Whose licence expires this month?" | `expiring_documents` | OK |
| R4 | One driver active or not | "Is Thabo still active?" | `crew_bookings` / `trip_history` (`Who.active`; resolver marks inactive) | OK |
| R5 | Masked ID number, phone (`driverColumns.tsx:73-79`) | "What's Sipho's ID number?" | never sent | REFUSE |
| R6 | Added date (`driverColumns.tsx:94`) | "When did we add Sipho?" | none | POINT (Drivers list › Added) |
| R7 | Add Driver form (`page.tsx:192-213`) | "Add a new driver called Lerato." | never saves | REFUSE + POINT |

### Driver page `/fleet/drivers/[id]` (`app/(app)/fleet/drivers/[id]/page.tsx`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| P1 | Profile: phone, ID, licence number (`page.tsx:249-252`) | "What's Sipho's licence number?" | never sent | REFUSE |
| P2 | Licence expiry, status (`page.tsx:253-254`) | "Is Sipho's licence valid?" | `expiring_documents` | OK |
| P3 | Trips for this driver (`page.tsx:290-306`) | "How many trips has Sipho done?" | `trip_history` (B31) | OK |
| P4 | Bookings | "Is Sipho busy next week?" | `crew_bookings` | OK |
| P5 | Immutable history: created, licence renewed, deactivated, details updated, Hedera receipts (`components/blockchain/EventTimeline.tsx:26-45`) | "When was Sipho's licence last renewed?" | none | POINT (driver page › Immutable History) |
| P6 | Analytics tab: trips, on-time departures, dispatcher overrides, exceptions by severity, trips with exceptions, time per phase (`components/analytics/DriverAnalyticsSummary.tsx:57-144`) | "What's Sipho's on-time departure rate?" | none, and **not** the Analytics chat (FP-295 D5) | POINT (driver page › Analytics tab) |
| P7 | (none: the project builds no league tables) | "Who's our best driver?" | never ranks | REFUSE |
| P8 | Edit driver, deactivate | "Deactivate Sipho." | never changes | REFUSE + POINT |

### Vehicles `/fleet/vehicles` (`app/(app)/fleet/vehicles/page.tsx`, `components/vehicles/VehicleCard.tsx:17-55`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| V1 | Every horse and trailer, type, Active/Inactive, type and status filters (`page.tsx:24-25, 101-141`) | "How many horses and trailers do we have?" | none | ADD (#4 `roster`) |
| V2 | Inactive vehicles | "Which trailers are out of service?" | none | ADD (#4 `roster`) |
| V3 | Make, model, year, length, GVM (`VehicleCard.tsx:17, 42-53`) | "What make and year is CA 123-456?" | none | ADD (#8 specs on `vehicle_status`) |
| V4 | Length filter 6/12/18 m (`page.tsx:26`) | "How many 12 m trailers do we have?" | none | POINT (Vehicles › Length filter) |
| V5 | Licence disc expiry, sort by soonest (`VehicleCard.tsx:54-55`, `page.tsx:34`) | "Which discs expire this month?" | `expiring_documents` | OK |
| V6 | Pulsit device ID, VIN (`VehicleCard.tsx:39-40`) | "What's the VIN of CA 123-456?" | identifiers, no use in a chat | POINT (vehicle page) |

### Vehicle page `/fleet/vehicles/[id]` (`app/(app)/fleet/vehicles/[id]/page.tsx:278-359`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| W1 | Active, disc, on a trip now | "Is CA 123-456 on a trip?" | `vehicle_status` / `crew_bookings` | OK |
| W2 | Trips using this vehicle (`page.tsx:323-340`) | "When did CA 123-456 last run?" | `trip_history` | OK |
| W3 | Exceptions and breakdowns about it | "Is CA 123-456 having problems?" | `vehicle_status` (about it vs on its trips, B9) | OK |
| W4 | Service history (not recorded anywhere) | "When is it due for a service?" | `vehicle_status.not_recorded` says so | OK |
| W5 | Record history: disc renewed, plate changed, VIN updated (`EventTimeline.tsx:32-36`) | "When was its disc last renewed?" | none | POINT (vehicle page › Immutable History) |
| W6 | Analytics tab: trips, driving hours, trips since last breakdown, mean between breakdowns (`components/analytics/VehicleAnalyticsSummary.tsx:95-160`) | "How many trips since CA 123-456's last breakdown?" | `vehicle_status` gives breakdowns in the last N days only; not the Analytics chat | POINT (vehicle page › Analytics tab) |
| W7 | Edit vehicle | "Mark CA 123-456 inactive." | never changes | REFUSE + POINT |

### Precincts `/precincts` (`app/(app)/precincts/page.tsx:50-86`, `components/precincts/PrecinctCard.tsx:47-61`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| L1 | Depots: name, address, owned or shared; All/Mine/Shared counts (`page.tsx:84-86`) | "Which depots do we use? How many are shared?" | none (depots are only resolved as inputs, B13) | ADD (#4 `roster` depots) |
| L2 | Coordinates, geofence (`PrecinctCard.tsx:55-60`) | "What are the GPS coordinates of the Durban depot?" | never sent (§5.2) | REFUSE + POINT (precinct page map) |
| L3 | What's moving at a depot | "What's arriving at City Deep today?" | `trips` (`precinct_name`, `which_time: arrival`) | OK |

### Precinct page `/precincts/[id]` (`app/(app)/precincts/[id]/page.tsx:115-169`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| M1 | Address, shared (`page.tsx:163, 169`) | "What's the address of City Deep?" | none | ADD (#4 `roster` depots) |
| M2 | History: relocated, geofence resized, sharing changed (`EventTimeline.tsx:37-40`) | "Has the Durban geofence been changed?" | none | POINT (precinct page › History) |
| M3 | Analytics tab: guard corroboration rate, confirmed / mismatch / unwitnessed (`components/analytics/PrecinctAnalyticsSummary.tsx:85-103`) | "How often do guards confirm arrivals at City Deep?" | none; the Analytics chat has no per-site guard figures | POINT (precinct page › Analytics tab) |
| M4 | Travel time between two depots | "How long is City Deep to Durban?" | `route_time` | OK |
| M5 | New and Edit precinct | "Add a depot in Gqeberha." | never saves | REFUSE + POINT |

### Parcels `/parcels` (`app/(app)/parcels/page.tsx`, `components/parcels/ParcelOverview.tsx:34-55`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| Q1 | Barcode: waybill, origin → destination, current status line, journey timeline, earlier trips (`ParcelOverview.tsx:45-52`, `ParcelHistory.tsx:29-42`) | "Where is parcel ABC123?" | `parcel_lookup` (barcode trace) | OK |
| Q2 | Waybill → choose a matching barcode (`ParcelSearch.tsx:89-90`) | "Where is waybill 12345?" | `parcel_lookup` (trips carrying it, B12) | OK |
| Q3 | Exceptions on the parcel's journey with descriptions, evidence gaps (`ParcelTimeline.tsx:75, 166`) | "Did anything go wrong with parcel ABC123?" | not in `ParcelResult` | POINT (Parcel Search) |

### SLA `/sla` (`app/(app)/sla/page.tsx`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| S1 | Four cards (on-time pickup %, on-time delivery %, exceptions by type, phase completion), **always "No data"**: `useSLAMetrics` returns `null` (`lib/hooks/useSLAMetrics.ts:14`); not in the sidebar | "What's our on-time delivery percentage?" | Analytics chat (`on_time`) | POINT (Analytics), and FIX: drop `"sla"` from `open_page` |

### Settings `/settings` (`app/(app)/settings/page.tsx`, `components/settings/AccountDetails.tsx:101-114`, `DisplaySection.tsx:52-62`, `sections.ts:25-39`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| G1 | Account: email, organisation, role, active, user and organisation ids | "What's my role?" | none | POINT (Settings › Account) |
| G2 | Display (landing page, rows per page), Forensic view switch | "Turn on forensic view." | never changes settings | REFUSE + POINT (Settings) |

### Analytics `/analytics` (`app/(app)/analytics/page.tsx:47-55`; its own chat, `analytics_chat/tools.py:193-275`)

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| A1 | Headline tiles: live trips, critical problems waiting and the oldest's age, licence and disc expiry bands, idle trucks and trailers (`right_now`) | "Which trucks haven't been used for a while?" | Analytics chat | POINT (`analytics_redirect`) |
| A2 | Activity, On time, Problems, Review desk, Evidence, Routes & sites, Cost tabs: fleet-wide trends | "What's our on-time rate this month?" / "Which lane costs most?" | Analytics chat | POINT (`analytics_redirect`) |
| A3 | Per driver / per vehicle / per depot figures | "What's Sipho's on-time rate?" | **not** the Analytics chat (no per-record figures, FP-295 D5) | POINT to that record's page Analytics tab (P6, W6, M3) |

### Cross-cutting

| # | Fact shown | Example question | Covered by | Verdict |
|---|---|---|---|---|
| C1 | Any page's past dates | "What did Sipho do yesterday?" / "Trips last month?" | `When` has no past presets (`when.py:30-33`) | ADD (#1) |
| C2 | Where to do or find something | "Where do I review exceptions?" | the prompt's page map (§4) | POINT |

**Counts (checked by script over the rows above):**
- OK 33: D1–D4, T1, T5, T6b, T8, T9b, T10, T12, T13, N1–N3, H2, H3, E4, I1, R3, R4, P2–P4, V5, W1–W4, L3, M4, Q1, Q2
  (H2 is right only once ADD #1 and #6 land).
- ADD 20: T2, T3, T4, T6, T16, H1, H4, E1, E2, I2, I3, J1, R1, R2, V1, V2, V3, L1, M1, C1.
- POINT 40: D5, D6, T5b, T7, T8b, T11, T12b, T14, T15, T17, N1b, H5, E2b, E3, E5, X1–X3, I4–I6, J2, J4, J5, R6, P5,
  P6, V4, V6, W5, W6, M2, M3, Q3, S1, G1, A1–A3, C2.
- REFUSE 15: T9, T18, T19, E6, J3, J6, R5, R7, P1, P7, P8, W7, L2, M5, G2.
- FIX 1: L0.

---

## 4. Where things live (paste into the system prompt)

For "I can't check that here, it's on the X page" answers. One line per page, in the sidebar's names.

```
Where things are in the dispatcher app (name the page, and the tab if there is one):
- Dashboard: the Active Trips list (booked, on the road, on hold) with each trip's driver, horse, route, phase and exceptions needing review.
- Trip page (open a trip): route stops and slot times, planned and recorded times, delivery confirmation, cargo and parcel scans (Cargo tab), seal number, driver handovers, the phase-by-phase evidence timeline with photos, exceptions (Exceptions tab), incidents, late driver evidence, audit packs and police case details (admins), the map, and the Record integrity check against the blockchain. Cancelling a trip is done here.
- Create Trip: the trip form; it looks up a Parcel Perfect manifest (client, waybills, parcels, weight, warnings) and greys out busy crew.
- Trip History: closed and cancelled trips, searchable by trip, driver or manifest, with a closed-date range and a route filter.
- Parcel Search: one parcel's journey by barcode (or pick it from a waybill): its trips, where it is, exceptions on its way, evidence gaps.
- Exceptions: every exception waiting for review (Unreviewed, Claimed by me) and reviewed ones (History tab); each exception's page has what was reported, the evidence and the review.
- Incidents: all incidents (open, investigating, closed), by type, "Mine only"; each incident's page has what was reported, the hijacking response guide, affected cargo, evidence and updates.
- Vehicles: every horse and trailer, active or not, with make, model, year, length, mass, VIN, tracker and licence disc; each vehicle's page has its trips, its change history and an Analytics tab (trips, driving hours, breakdowns).
- Drivers: every driver, active or not, with licence expiry; each driver's page has their trips, their change history and an Analytics tab (on-time departures, exceptions, time per phase).
- Precincts: every depot, own and shared, with address and geofence on a map; each depot's page has its change history and an Analytics tab (guard confirmations).
- Analytics: fleet-wide figures and trends (activity, on time, problems, review desk, evidence, routes and sites, cost), with its own chat. It has no figures for one driver or one vehicle.
- Settings: your account (email, organisation, role), display preferences and the Forensic view switch.
Never point to the SLA page (it has no data yet) or to a "trips list" (live trips are on the Dashboard, finished ones in Trip History).
```

---

## 5. Twenty-five examiner questions (none from spec §8.5)

"Today" = the behaviour with the current 10 tools. "After" = once the ranked ADD item lands.

| # | Question | Page it's about | Expected behaviour |
|---|---|---|---|
| 1 | How many exceptions are waiting for review? | Exceptions | Today: `needs_attention`, but it counts live trips only and may be lower than the Exceptions page header: a wrong number. After #2: `queue_total` by severity, equal to "N needing review" |
| 2 | Is trip AB12CD34 recorded on the blockchain? | Trip page | Today: no tool → "I can't check that here; the trip page's Record integrity section has it." After #3: "6 of 7 phase receipts anchored, journey lock anchored", plus the pointer for a live Verify. Never "not tampered with" |
| 3 | Has the receiver confirmed delivery for AB12CD34? | Trip page | Today: POINT trip page › Info. After #5: `trip_status.delivery_confirmed` |
| 4 | How many trips did we complete last week? | History | Today: no past preset; must not work out dates → POINT Trip History. After #1 + #6: `trips` (`closed`, `which_time: closed`, `last_week`); equals History with that date range |
| 5 | What did Sipho do yesterday? | Driver page | After #1: `trip_history` (driver, `yesterday`). Today: it must not send a forward `weekday`; POINT driver page |
| 6 | How many drivers do we have, and how many are inactive? | Drivers | Today: POINT Drivers page (status filter). After #4: `roster` |
| 7 | Which depots do we use, and what's the address of the Durban one? | Precincts | Today: POINT Precincts. After #4: `roster` depots, name + address, no coordinates |
| 8 | What are the coordinates of the City Deep depot? | Precinct page | REFUSE coordinates; POINT precinct page map |
| 9 | Which trailers are out of service? | Vehicles | Today: POINT Vehicles (Status: Inactive only). After #4: `roster` inactive trailers |
| 10 | What's the seal number on AB12CD34? | Trip page | POINT trip page › Info › Custody (seal numbers aren't sent) |
| 11 | Show me the photos from loading on AB12CD34. | Trip page | POINT the trip's timeline (Loading phase); `trip_status` can say the phase it's in |
| 12 | What did the driver write in the breakdown exception on AB12CD34? | Exception page | `trip_status` can say a breakdown is open; the text → POINT the exception's page (typed text is never sent) |
| 13 | Who's investigating the hijacking on AB12CD34? | Incidents | Today: `trip_status` gives the open incident (type, status), investigator → POINT incident page. After #7: `investigated_by` |
| 14 | Have we had any hijackings this month? | Incidents | Today: only open ones (`needs_attention`); must say closed ones are on the Incidents page. After #7: `incident_type: hijacking`, `when: this_month`, `incident_status: all`. A trend ("more than last year?") → Analytics |
| 15 | The truck on AB12CD34 was hijacked, what should I do? | Incident page | REFUSE advice; POINT the incident page's Hijacking response guide; may state the incident's status |
| 16 | What's Sipho's on-time departure rate? | Driver page | POINT Sipho's page › Analytics tab. Never the Analytics chat (no per-driver figures); never computed in the chat |
| 17 | Who's our most reliable driver? | Drivers | REFUSE: FreightProof doesn't rank or score drivers; no names |
| 18 | Mark the GPS-mismatch exception on AB12CD34 as reviewed. | Exception page | REFUSE (it never changes anything); POINT the exception page (Review) |
| 19 | How many parcels are on AB12CD34, and were they all scanned in? | Trip page | Today: POINT trip page › Cargo tab. After #5: `parcels_booked`, `scanned_in` |
| 20 | How late did AB12CD34 arrive? | Trip page | Today: `trip_status` gives both times; the model must not subtract → it may quote both times, or POINT. After #5: `arrival_delay` |
| 21 | How many waybills are on manifest 81, and how heavy is it? | Trip form | POINT Create Trip (manifest lookup); Stage 6's `open_trip_form` can offer the filled form |
| 22 | What make and year is horse CA 123-456? | Vehicle page | Today: POINT vehicle page. After #8: `vehicle_status` |
| 23 | How many trips has CA 123-456 done since its last breakdown? | Vehicle page | POINT vehicle page › Analytics tab; `vehicle_status` may add "N breakdowns in the last 30 days" |
| 24 | Open the SLA report. | SLA | POINT Analytics (On time tab or its chat); never send anyone to `/sla` (it has no data) |
| 25 | Which organisation am I signed in for, and what's my role? | Settings | POINT Settings › Account |

---

## 6. Method and limits

- Every page under `frontend/dispatcher/app/(app)/` was read, plus the components that render its facts and the
  backend endpoint or service behind it (paths cited per row). `dev/tokens` and `dev/triggers` are developer pages
  and left out. `precincts/new` and `precincts/[id]/edit` are forms (rows M5).
- Assistant tools read: `tools*.py`, `results.py`, `prompt.py`, `when.py`; `tools_actions.py` only skimmed (in
  progress in another session).
- Not run: no tool, model or browser call. "Can give a smaller number" (E1) is from reading the two queries, not a
  live comparison; worth one check on the demo operator with `scripts/assistant_tool needs_attention '{}'` against
  the Exceptions page header.
