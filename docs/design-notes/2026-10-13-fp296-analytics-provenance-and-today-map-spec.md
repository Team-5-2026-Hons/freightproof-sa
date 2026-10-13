# FP-296 — Today's incidents on the map, and a source for every analytics figure

**Status:** SPEC — not started. Written 2026-10-13 from `dev` at `15c44e0`. Every path below was
checked against that commit.
**Owner:** Tom (sign-off after every stage). **Written:** 2026-10-13 by Claude, from a decision
session with Tom. Every choice in §2 was agreed with him.
**Ticket:** FP-296 (Sprint 9, parent epic FP-136 "Evidence Analytics & Live Alerting").
**Branch:** Tom creates it from an up-to-date `dev`; suggested name `feature/fp-296-analytics-provenance`.
The executor never creates or switches branches.

---

## 0. Handoff (paste this first in a new session)

> FreightProof's dispatcher has a fleet **Analytics** page (`frontend/dispatcher/app/(app)/analytics/page.tsx`)
> with four headline tiles and six tabs of chart cards. The **Routes & sites** tab ends with an **incident map**
> (`components/analytics/fleet/map/IncidentMap.tsx`). The vehicle, driver and precinct detail pages each have an
> **Analytics** summary as well. FP-296 makes three changes, all **frontend only** (no backend, no migration,
> no new packages):
> (1) the incident map gets its own **Today | This period** switch, a deep link `/analytics?tab=routes&map=today`,
> and pins that **appear by themselves** when a report is raised;
> (2) every chart card's "i" popover, the tile row and the three detail-page summaries get a **Source** line
> that says where the figure comes from, naming the **simulated Pulsit** and **mock Parcel Perfect** feeds
> where a figure depends on them;
> (3) the "done for vehicle details" text the panel saw gets **checked on the deployed site first** and fixed
> only if it is found.
> Work in **6 stages** (§9). Each ends with something Tom can check in the browser. **Stop after each stage for
> Tom's sign-off.** Follow `CLAUDE.md` exactly: a PLAN block before each stage, TASK COMPLETE after it, no git
> write commands, never `alembic`, never read `.env`. Structural freeze starts 19 Oct: **don't move or rename
> any file**. Start at the first stage in §14 that is not DONE.

---

## 1. Rules for whoever executes this

1. Read `CLAUDE.md` first. It overrides nothing here, and nothing here overrides it.
2. Before each stage, output the CLAUDE.md `PLAN` block. After it, output `TASK COMPLETE` and **stop**. Tom
   reviews in the browser, then says go.
3. Git: only `git status`, `git diff`, `git log --oneline -10`, `git branch --show-current`, `git fetch`,
   `git add <specific files>`. Tom commits once at the end.
4. At the start of each stage, run `git fetch origin`, then `git log --oneline HEAD..origin/dev`. If `dev`
   changed any file this spec touches (§7), stop and tell Tom.
5. Explain things to Tom plainly: the short answer first, then the detail. If he asks for something that
   contradicts §2, say so and explain why before doing it.
6. When this spec and the code disagree, trust the code, note the difference in TASK COMPLETE, and record it in
   §14.
7. **Don't move or rename files** (freeze, 19 Oct). Every change is an edit to an existing file. No new files
   are needed, tests included.
8. **Every Source line must be true.** Before writing one, open the query that produces the figure (the files
   in §7.3) and check the wording against it. If the code says something different from the draft in §5.3,
   follow the code and tell Tom.
9. The browser pane may need Tom to sign in. **Never type a password or credential.** Ask Tom to do it.

---

## 2. Decisions (with reasons). Don't relitigate these.

| # | Decision | Why |
|---|---|---|
| D1 | The incident map card gets **its own switch: Today \| This period**. Default is *This period*, which keeps today's behaviour. The rest of the Routes & sites tab is unchanged. | Two clicks from the sidebar to today's incidents. Adding a "Today" preset to the whole tab would make busiest sites and lanes go empty (few closed trips depart on the day). Same idea as the busy-pattern charts having their own period (fleet spec D5). |
| D2 | **Deep link** `/analytics?tab=routes&map=today` opens the map on Today. Back from a report opened on the map returns to Today, because the return address carries `map=today`. | A presenter can bookmark it. Back must not lose the view, matching fleet spec D25's Back rule. |
| D3 | **"Today" = the South African calendar day** (`todaySast()`). The request is `start = end = today`. | The backend already accepts a one-day period (`build_period`, `instant_range` in `backend/app/analytics/fleet/periods.py`), and every analytics date is in SAST (fleet spec G5). No backend change. |
| D4 | **Pins appear by themselves.** The map listens for `exception_raised` on the existing live channel (`useLiveResource`) and refetches **silently**, without dimming. It refits the view only when the set of pins actually changed. | A report raised on stage shows up within seconds without a reload. Refitting on every event anywhere in the organisation would make the map jump during a demo. |
| D5 | The map's **empty-state text is corrected.** "Today only panic-button reports send a location" is no longer true. | Driver in-transit reports (`LogExceptionPageClient.tsx`), phase reports (`TripContext.tsx`), panic, and the automatic road checks (`orchestration/evidence/road_check.py`) all save GPS now. Stale text in front of the panel undermines the whole provenance story. |
| D6 | **Source lines go inside the existing "i" popover**, as a labelled last line before the faded-bucket footnote. Card faces are not changed. | Keeps fleet spec D22 (clean card faces), which Tom chose. A presenter is one click from any figure's source. |
| D7 | `source` is a **required** `ChartCard` prop. | The type checker then guarantees "every figure", and a future card can't forget one. |
| D8 | **The tiles get one visible Source line** under the tile row, not an "i" per tile. | Each tile is a whole-tile link, and a button inside a link is invalid HTML. One line covers four tiles that share one kind of source. |
| D9 | **The vehicle, driver and precinct analytics summaries each get a Source line**, through a required `source` prop on `AnalyticsSummaryFrame` (`components/analytics/SummaryParts.tsx`). It shows in every state. | The ticket says "every analytics page". One prop on the shared frame covers all three. |
| D10 | **Source lines name simulated or mock data where a figure depends on it**: the Pulsit tracker feed (`PULSE_USE_MOCK`) and the Parcel Perfect feed (`PP_USE_MOCK`). One page-level note also says the figures come from trips run on this system, test and demo trips included. | The panel already questioned the data behind "risky times". An honest gap is cheaper than a claim the panel catches. Matches the "claim boundaries" theme in `docs/iteration4_plan.md` §11. |
| D11 | **"done for vehicle details"**: check the deployed site first (Stage 0). Change wording **only if the text is found**, and Tom picks the new words. If it isn't found, record "not found" here and on the ticket. | The text is not in `dev` today, nor in the presented commit `d785615`. The closest match is the event title "Vehicle details updated" (`components/blockchain/EventTimeline.tsx:36,43`), which sits in the same panel as the vehicle Analytics tab. The minutes warn the transcript is garbled. Guessing would change a label that the driver and precinct pages share. |
| D12 | **No "Show on map" link from the exception page** in this ticket. | It touches `app/(app)/exceptions/[id]/page.tsx`, outside analytics and close to the freeze. Listed in §11. |
| D13 | **No backend change.** | Everything needed (a one-day period, GPS on reports, the live events) already exists. That leaves zero migration risk and zero Alembic risk. |

### Rejected alternatives (so nobody re-proposes them)

- A "Today" preset for the whole Routes & sites tab (D1).
- Source lines printed on every card face: this undoes D22.
- Provenance served by the backend as response metadata: it would change nine schemas and the shared types for text
  that never varies per request.
- A manual Refresh button on the map (D4 makes it unnecessary).

---

## 3. What it looks like

```
Routes & sites tab
┌ Incident map (i) ─────────────── [ Today | This period ]  [Show table] [⤢] ┐
│  (map: pins for the chosen window)                                         │
│  Showing 3 of 3 · Click a row to find it on the map.                       │
│  Date | Problem | Severity | Trip | Report                                 │
└────────────────────────────────────────────────────────────────────────────┘

"i" popover (every chart):           Tile row:
  Are we getting busier?               [Live trips] [Critical waiting] [Licences] [Unused]
  Closed trips, by … · 16 trips        Source: counted live from this system's trips, …
  (note, if any)
  Source: <one sentence>    ← new    Detail summaries (vehicle / driver / precinct):
  Faded: a part week, …               [month picker] … figures …
                                       Source: <one sentence>      ← new, every state
```

- The switch is a `RadioToggle` (`components/analytics/fleet/controls/RadioToggle.tsx`) with
  `showLabel={false}`, accessible name "Show reports from", options **Today** and **This period**. It sits in the
  card's existing `controls` slot on the title row (fleet spec §7.7 item 5).
- On Today, the card's basis says the date: "N reports with a location today (13 Oct 2026, South African time),
  any trip status. Dispatcher notes are left out."
- Empty on Today: "No reports with a location yet today (South African time)." Empty on This period: the
  corrected text in §5.2.
- Page scope note: the existing `FLEET_COPY.scopeNote` stays. The data note from D10 goes on a second line in the
  same style (`text-[12px] text-on-surf-v`).

---

## 4. API and data changes

**None.** No endpoint, schema, migration or shared-type change. The map reuses
`GET /api/v1/analytics/fleet/incidents?start=<today>&end=<today>`, which is already valid because `end` ≤ today
and `start` ≤ `end`.

---

## 5. Copy

All strings go in `components/analytics/fleet/copy.ts` (fleet page) or `components/analytics/copy.ts` (detail
summaries). Both are dispatcher-only.

### 5.1 Map switch and deep link
- `routes.incidents.window`: `{ label: 'Show reports from', today: 'Today', period: 'This period' }`
- `routes.incidents.basisToday(count, day)`: `` `${count} reports with a location today (${day}, South African time), any trip status. Dispatcher notes are left out.` ``
- `routes.incidents.emptyToday`: `'No reports with a location yet today (South African time).'`

### 5.2 Corrected map empty state (D5)
`'No reports with a location in this period. Driver reports, panic alerts and automatic tracker checks send one; older reports and reports from a phone without a GPS fix have none.'`
Executor: confirm each named source against the GPS writers listed in D5 before writing it.

### 5.3 Source lines (drafts; verify each against its query, rule 8)

`FLEET_COPY.chart.sourceLabel = 'Source'`. Popover line: **Source:** {text}.

Page data note (D10), `FLEET_COPY.dataNote`:
"Every figure comes from FreightProof's own records of trips run on this system, test and demo trips included.
Tracker positions come from a simulated Pulsit feed, and parcel and waybill counts from a mock Parcel Perfect
feed, until live credentials arrive."

| Card (copy key) | Query to check | Draft source |
|---|---|---|
| Tiles (`tiles.source`) | `analytics/fleet/tiles.py` | Counted live from this system's trips, exception reports, and the driver and vehicle records dispatchers keep. No refresh delay. |
| 1.1 Trips over time (`activity.trips.source`) | `activity.py`, `base.py` | Trip records, dated by the driver's first attested departure step in our phase ledger. |
| 1.7 Cancellations (`activity.cancellations.source`) | `activity.py` | Trip records: cancelled trips, by when a dispatcher cancelled them. |
| 1.3 Busy patterns (`activity.patterns.source`, all four cards) | `patterns.py` | Departure and arrival steps drivers completed in the app (our phase ledger), by the time each was recorded. |
| 2.1 On-time (`onTime.punctuality.source`) | `on_time.py` | Planned times entered at trip creation, against the driver's attested departure and final arrival. |
| 2.2 How late (`onTime.lateness.source`) | `on_time.py` | Same as 2.1. |
| 2.5 Plans vs reality (`onTime.spread.source`) | `on_time.py` | Planned departure and arrival from trip creation, against the attested first departure and final arrival. |
| 3.1 Problems over time, 3.3 Most common, 3.4 Where in the trip (`problems.source`, shared) | `problems.py` | Exception reports in our ledger, raised by drivers, dispatchers or automatic checks. Automatic tracker and parcel checks run on the simulated Pulsit and mock Parcel Perfect feeds. |
| 3.2 Theft signs (`problems.theft.source`) | `problems.py`, `constants.py` | Seal, parcel, waybill, panic and receiver-ID exception reports in our ledger. Parcel and waybill counts come from the mock Parcel Perfect feed. |
| 3.5 Risky times (`problems.risky.source`) | `problems.py:112` `risky_times` | Our own ledger: driving minutes between each attested departure and arrival, split by South African quarter of the day, against problems linked to the driving step, by when the server received them. Any severity, closed trips only. |
| 4.1–4.4 Review desk (`review.source`, shared) | `review.py` | Reviews dispatchers recorded in this system: when each problem was raised, when it was reviewed and the outcome chosen. |
| 5.1 Tracker agreement (`evidence.tracker.source`) | `evidence.py` | The tracker check stored on each stop step. Truck positions come from a simulated Pulsit feed, not live trackers. |
| 5.2 Overrides (`evidence.overrides.source`) | `evidence.py` | Steps a dispatcher completed for the driver, from our phase ledger. |
| 5.7 Receiver sign-off (`evidence.signoff.source`) | `evidence.py` | Receiver QR scans recorded at hand-over, and rejected scan attempts. |
| 1.6 Busiest sites (`routes.sites.source`) | `routes.py` | Loading and unloading steps in our phase ledger, at the precincts set up in this system. |
| 2.4 Driving time (`routes.laneTimes.source`) | `routes.py` | Each closed trip's attested first departure to its recorded final arrival. |
| 6.3 Lane risk (`routes.laneRisk.source`) | `routes.py` | Closed trips per lane and their exception reports, dispatcher notes left out. |
| 3.6 Incident map (`routes.incidents.source`) | `routes.py` `incident_pins`; GPS writers in D5 | The position saved with each report: the driver's phone for driver reports, the simulated tracker for automatic tracker checks. |
| Vehicle summary (`ANALYTICS_COPY.sources.vehicle`) | `analytics/vehicle_metrics.py`, `views.py` | Closed trips this vehicle ran and the breakdowns drivers reported against it, from live database views over our trip ledger. |
| Driver summary (`ANALYTICS_COPY.sources.driver`) | `analytics/driver_metrics.py`, `views.py` | Closed trips this driver ran (their attested steps, planned times and exception reports), from live database views over our trip ledger. |
| Precinct summary (`ANALYTICS_COPY.sources.precinct`) | `analytics/facility_metrics.py`, `views.py` | Tracker checks at this precinct on your organisation's closed trips. Tracker positions come from a simulated Pulsit feed. |

Stage 3 opens by showing Tom this table, with any corrections, **before** writing code. The wording is
examinable content.

---

## 6. What does not change

The backend; `frontend/shared/`; every `package.json`; everything in `components/ui/` (no UI-kit edits);
the home page; the exception detail page; `DateRangePicker`; fleet spec D1–D27.

---

## 7. Implementation design

### 7.1 Map switch, deep link, live pins (Stages 1–2)

| File | Change |
|---|---|
| `frontend/dispatcher/components/analytics/fleet/tabs/RoutesTab.tsx` | `RoutesTabProps` gains `today: string` and `mapWindow: MapWindow` + `onMapWindowChange`. `export type MapWindow = 'today' \| 'period'`. Incidents period = `mapWindow === 'today' ? { start: today, end: today } : { start: query.start, end: query.end }`. `IncidentsCard` gets the `RadioToggle` in `controls`, the Today basis and empty texts, and its `key` includes the window so rows and selection reset. Stage 2: `useLiveResource('trip', 'any', incidents.refetchSilent, { kinds: ['exception_raised'] })` (same call shape as `lib/hooks/useExceptions.ts:42`). |
| `frontend/dispatcher/app/(app)/analytics/page.tsx` | Holds `mapWindow` state, initialised from the `map` search param (`mapWindowFromSearch`). Passes `today`, `mapWindow` and its setter to `RoutesTab`, and passes `mapWindow` into `analyticsReturnHref`. The tidy-address effect keeps working unchanged. |
| `frontend/dispatcher/components/analytics/fleet/navigation.ts` | `MAP_PARAM = 'map'`; `analyticsReturnHref(tab, controls, mapWindow?)` adds `map=today` only for Today; new `mapWindowFromSearch(search): MapWindow` (anything but `today` → `period`). |
| `frontend/dispatcher/lib/hooks/useFleetAnalytics.ts` | Stage 2: `FleetQueryResult` gains `refetchSilent: () => void`. It re-asks the same path **without** setting pending, so the card doesn't dim, and it keeps the existing generation-counter rule (fleet spec §7.2). Additive only; existing callers are unaffected. |
| `frontend/dispatcher/components/analytics/fleet/map/IncidentMap.tsx` | Stage 2: the pin-placing effect depends on a **pin signature** (exported pure helper `pinSignature(pins)` = sorted exception ids joined), not on the array, so a refetch with the same pins neither redraws nor refits (D4). |
| `frontend/dispatcher/components/analytics/fleet/copy.ts` | §5.1, §5.2. |

`today` comes from the page's existing `todaySast()` call (`app/(app)/analytics/page.tsx:109`). Don't compute
it a second time in the tab.

### 7.2 Source lines (Stages 3–4)

| File | Change |
|---|---|
| `components/analytics/fleet/InfoPopover.tsx` | New optional `source?: string`, rendered after `note` and before `footnote` as `<p className="mt-2 text-[12px] text-on-surf-v"><span className="font-[600] text-on-surf">Source:</span> {source}</p>` (label from copy). |
| `components/analytics/fleet/ChartCard.tsx` | New **required** `source: string`, passed to `InfoPopover`. Nothing new on the card face. |
| `components/analytics/fleet/tabs/{Activity,OnTime,Problems,ReviewDesk,Evidence,Routes}Tab.tsx`, `components/analytics/fleet/charts/PatternStrip.tsx` | Pass `source={…}` to every `ChartCard` (§5.3). `tsc` lists any card that is missing one. |
| `app/(app)/analytics/page.tsx` | Renders `FLEET_COPY.dataNote` under `scopeNote`. |
| `components/analytics/fleet/FleetTiles.tsx` | One `<p className="text-[12px] text-on-surf-v">` under the tile grid with `COPY.source`. It shows in the loading and error states too (the source doesn't depend on the data). |
| `components/analytics/SummaryParts.tsx` | `AnalyticsSummaryFrame` gains a required `source: string`, rendered under the body in every state, styled like the precinct notes (`text-[12px] text-on-surf-v`). |
| `components/analytics/{Vehicle,Driver,Precinct}AnalyticsSummary.tsx` | Pass `source={ANALYTICS_COPY.sources.<x>}`. |
| `components/analytics/copy.ts`, `components/analytics/fleet/copy.ts` | §5.3 strings. |

### 7.3 Queries to read before writing Source lines

`backend/app/analytics/fleet/{tiles,activity,patterns,on_time,problems,review,evidence,routes,base,constants}.py`,
`backend/app/analytics/{vehicle_metrics,driver_metrics,facility_metrics,views}.py`. Read only; don't edit.

### 7.4 Wording fix (Stage 5, conditional on Stage 0)

Only if Stage 0 finds the text. The likely file is `frontend/dispatcher/components/blockchain/EventTimeline.tsx`
(`describeEvent`), plus its test `EventTimeline.test.tsx`. **That label is shared with the driver and precinct
detail pages**, so check all three. Tom picks the wording before any edit.

---

## 8. Tests required

Frontend only (vitest + Testing Library). Test text and requests, not SVG or Leaflet geometry. All tests go in
**existing** test files.

| File | Cases |
|---|---|
| `components/analytics/fleet/tabs/RoutesTab.test.tsx` | the switch defaults to This period and asks incidents for the tab period · choosing Today asks incidents with `start=end=today` and does **not** re-ask routes · `mapWindow='today'` on mount asks for today straight away · the Today basis names the date · the empty Today text · (Stage 2) `useLiveResource` mocked as in `lib/hooks/useExceptions.test.tsx:15`: called with `kinds: ['exception_raised']`; invoking its callback re-asks incidents only · the corrected empty text has no "only panic-button" wording |
| `components/analytics/fleet/navigation.test.ts` | `analyticsReturnHref` adds `map=today` only for Today · `mapWindowFromSearch`: `today` → today; missing or junk → period |
| `app/(app)/analytics/page.test.tsx` | `?tab=routes&map=today` → incidents requested for today · the data note is shown |
| `lib/hooks/useFleetAnalytics.test.tsx` | `refetchSilent` replaces data with `isRefreshing` staying false · a stale silent reply is dropped |
| `components/analytics/fleet/map/IncidentMap.test.tsx` | `pinSignature` is the same for the same pins in a different order, and different when a pin is added |
| `components/analytics/fleet/ChartCard.test.tsx` | the source is in the popover, labelled "Source:", and not on the card face |
| each `tabs/*Tab.test.tsx` | open one card's "i" and see its Source line · `EvidenceTab`: tracker agreement's source says "simulated" · `ProblemsTab`: risky times' source says "closed trips only" |
| `components/analytics/fleet/FleetTiles.test.tsx` | the source line shows when ready, loading and errored |
| `components/analytics/{Vehicle,Driver,Precinct}AnalyticsSummary.test.tsx` | the source line shows when ready, empty and errored · precinct's says "simulated" |
| `components/blockchain/EventTimeline.test.tsx` | Stage 5 only, if the wording changes |

Commands (CI's, `.github/workflows/ci.yml`):

```bash
cd frontend/dispatcher && npm run lint && npm run type-check && npm test && npm run build
```

The backend is untouched. Run the backend CI block once in Stage 0 and once in Stage 6 to show nothing moved:

```bash
cd backend && source .venv/bin/activate && ruff check . && mypy . && pytest -m "not slow"
```

Never run two pytest processes at once (shared local test DB). `npm run build` overwrites `.next`, so don't run
it while Tom's dev server is up. Ask first.

---

## 9. Stages

Each stage runs: PLAN → build → that stage's tests → browser check → TASK COMPLETE → **STOP for Tom**.
Local browser setup: Redis in Docker; `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000`;
`cd frontend/dispatcher && npm run dev` → <http://localhost:3000/analytics>, signed in as a dispatcher (Tom signs in).

### Stage 0 — Baseline and deployed-site check (no code)
- Run `git branch --show-current` (expect Tom's FP-296 branch), then both CI blocks in §8. Record the counts in §14.
- In the built-in browser, open the deployed dispatcher (README lists `https://freightproof-sa.vercel.app/`;
  confirm with Tom). Tom signs in. Open a horse's and a trailer's detail page, look at Immutable History and
  Analytics, and search the page text for "done for", "vehicle details" and "Done". Screenshot what's there.
- **Check:** Tom sees the baseline counts and the screenshots, and says whether Stage 5 happens.
- **Fence:** no file edits.

### Stage 1 — Today switch, deep link, corrected map text
- §7.1 minus the live-pin rows. §5.1, §5.2. Tests: the RoutesTab, navigation and page rows in §8 (not the live ones).
- **Check:** Routes & sites → Today shows only today's pins and the dated basis. `/analytics?tab=routes&map=today`
  opens straight on Today. Open a pin's report → Back returns to Today. The sites and lanes charts didn't change.
  With no reports today, the Today empty text shows.
- **Fence:** no other tab; no `IncidentMap` change yet.

### Stage 2 — Pins appear by themselves
- `refetchSilent`, the `useLiveResource` call, `pinSignature`. Tests: the live rows in §8.
- **Check:** with the map on Today, raise a located report (the driver app's in-transit "Log exception", or a
  road-check trigger from the dev panel). The pin and its table row appear within a few seconds with no reload,
  and the card doesn't dim. Raising a report **without** GPS does not move the map.
- **Fence:** no backend change, even if an event seems missing. Report it instead.

### Stage 3 — Source lines on every chart card
- First, show Tom §5.3's chart rows with any corrections from reading the queries, and wait for his OK.
- Then add the `InfoPopover` `source`, the required `ChartCard` `source`, all cards, and the page data note. Tests: the
  ChartCard, tab and page rows in §8.
- **Check:** open the "i" on any card in each tab; the Source line is last before the faded footnote. Card faces
  look the same as before. Tracker agreement and the map say "simulated".
- **Fence:** card faces unchanged (D6).

### Stage 4 — Source lines on the tiles and detail summaries
- `FleetTiles` line, `AnalyticsSummaryFrame` `source`, the three summaries. Tests: the tiles and summary rows in §8.
- **Check:** the line sits under the tiles; the vehicle (horse and trailer), driver and precinct Analytics tabs each
  show their line, including after picking an empty month range.

### Stage 5 — Wording fix (only if Stage 0 found it)
- Tom picks the wording; edit per §7.4 and its test. If Stage 0 found nothing, mark this stage SKIPPED with the
  evidence, and draft (don't post) a one-line FP-296 comment for Tom: "Text not in code at d785615 or 15c44e0,
  not on the deployed site on <date>."

### Stage 6 — Full checks and wrap-up
- Run both CI blocks; fill in §14; TASK COMPLETE listing shared files (**none expected**). Suggested commit:
  `feat(dispatcher): today filter on the incident map and a source for every analytics figure (FP-296)`.
- Give Tom a three-line demo script: open the bookmark `/analytics?tab=routes&map=today` → raise a located report
  from the driver app → the pin appears; click "i" on Risky times → read the Source line.

---

## 10. Risks and tripwires

| # | Risk | Early warning | Fallback |
|---|---|---|---|
| R1 | No located report exists today on demo day, so the map is empty. | The deep link shows the empty text. | Expected. No seed data (fleet spec D6). The demo script raises one live (Stage 6). |
| R2 | A road-check or other path raises an exception without emitting `exception_raised`. | Stage 2 check: a pin needs a reload. | Note it in TASK COMPLETE for Tom. Don't change the backend (D13). |
| R3 | A refetch refits the map mid-demo. | The view jumps on an unrelated report. | `pinSignature` (D4). |
| R4 | A Source line claims something the query doesn't do. | Rule 8 reading; Tom's Stage 3 review. | Follow the code; reword. |
| R5 | Teammates are editing the same files (Routes tab, `EventTimeline`, the detail pages). | Rule 4 shows `dev` changed one of them. | Stop and tell Tom. |
| R6 | A demo just after midnight shows yesterday's pins as "not today". | — | Correct by design (SAST day, D3). The basis prints the date. |
| R7 | `npm run build` clobbers Tom's dev server. | — | Ask before building (§8). |

---

## 11. Out of scope

A "Show on map" link from the exception page (D12) · any backend, schema, shared-type or migration change ·
"Today" for any other tab or chart · changing what any metric measures (e.g. risky times on live trips) · Ammar's
ambient/deep-dive analytics split · seed or demo data · reversing fleet spec D22 · new npm packages · moving or
renaming files (freeze).

---

## 12. Things found while reading (for Tom, not built here)

- The "done for vehicle details" text is not in the code now or at the presented commit `d785615` (D11).
- The map's empty text was stale (fixed in Stage 1, D5).
- Risky times, and every Problems chart, count **closed** trips only, so today's incident on a live trip appears on
  the map but not in risky times. Stated in its Source line.
- `docs/iteration4_plan.md` §2 cites `analytics/fleet/problems.py:112`; it is now
  `backend/app/analytics/fleet/problems.py:112` and still accurate.

---

## 13. Verification summary

Each stage's browser check (§9) plus the §8 commands. End-to-end: from a fresh dispatcher session, the bookmark
opens today's map. A report raised from the driver app appears as a pin without a reload. Every "i" on the page,
the tile row and the three detail summaries each name a source. `npm run lint`, `type-check`, `test` and `build`
are green. The backend suite is unchanged from Stage 0.

---

## 14. Progress

| Stage | Status | Tests (dispatcher / backend) | Notes |
|---|---|---|---|
| 0 Baseline + deployed check | NOT STARTED | | |
| 1 Today switch + deep link + map text | NOT STARTED | | |
| 2 Live pins | NOT STARTED | | |
| 3 Chart source lines | NOT STARTED | | |
| 4 Tiles + detail sources | NOT STARTED | | |
| 5 Wording fix (conditional) | NOT STARTED | | |
| 6 Full checks | NOT STARTED | | |
