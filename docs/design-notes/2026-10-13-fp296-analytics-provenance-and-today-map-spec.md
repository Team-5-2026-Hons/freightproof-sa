# FP-296 — Today's incidents on the map, and a source for every analytics figure

**Status: COMPLETE — built and checked 2026-10-13, awaiting Tom's commit and PR into `dev`.**
Stages 0–4 and 6 done; Stage 5 SKIPPED on evidence (§14.1); Stage 2's live browser check deferred
(§14.4). Decisions taken during the build are in §15. Written 2026-10-13 from `dev` at `15c44e0`;
every path below was checked against that commit and re-checked while building.
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
>
> **This work is COMPLETE as of 13 Oct 2026** — the handoff above is kept as written for the
> record. For the state of the work, read §14 (progress and findings) and §15 (decisions taken
> during the build, and what is still open).

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
| 0 Baseline + deployed check | DONE (13 Oct 2026) | dispatcher 1511 pass / 147 files · backend 2622 pass, 4 skipped | Deployed check impossible — see 14.1. Done on localhost instead. Phrase NOT FOUND. Recommend Stage 5 SKIPPED, awaiting Tom. |
| 1 Today switch + deep link + map text | **DONE** (13 Oct 2026) | dispatcher 1521 pass / 147 files (+10) · backend untouched | Deviation: `MapWindow` declared in `navigation.ts`, not `RoutesTab.tsx` (§7.1), so the address parser needn't import a React component. `IncidentsCard`'s prop is `mapWindow`, not `window`, to avoid shadowing the browser global. |
| 2 Live pins | **BUILT** (13 Oct 2026) — live browser check DEFERRED, see 14.4 | dispatcher 1528 pass / 147 files (+7) · backend untouched | R2 cleared: `EXCEPTION_RAISED` is emitted by `orchestration/exceptions/creation.py:401` (driver reports) and `orchestration/evidence/road_check.py:311` (automatic checks), plus 13 other paths. `pinSignature` compares report ids only — position and severity are fixed when a report is raised. |
| 3 Chart source lines | **DONE** (13 Oct 2026) | dispatcher 1537 pass / 147 files (+9) · backend untouched | All 22 cards carry a verified `source`; `ChartCard.source` is required, so tsc enumerated every call site. 11 of §5.3's drafts were wrong and were corrected against the queries (see 14.3). Tom chose D10 option C: the mock-feed note lives in `FLEET_COPY.dataNote` at page level only. |
| 4 Tiles + detail sources | **DONE** (Tom checked, 13 Oct 2026) | dispatcher 1541 pass / 147 files (+4) · backend untouched | `AnalyticsSummaryFrame.source` is required, so tsc named all three summaries. The frame wraps every state, so loading, error, empty and ready all carry it. `FleetTiles` renders its line outside the three state branches for the same reason. The three detail-summary drafts in §5.3 needed no correction. |
| 5 Wording fix (conditional) | **SKIPPED** (Tom, 13 Oct 2026) | n/a | Stage 0 found no such text in code or on screen. Evidence in 14.1. Jira comment drafted in 14.2, not posted. |
| 6 Full checks | **DONE** (13 Oct 2026) | dispatcher: lint 0 errors / type-check clean / 1541 pass / build OK · backend: 2622 pass, 4 skipped — identical to Stage 0 | Both CI blocks run in full, including the deferred `npm run build`. No shared file touched; no migration; no new .env key. |

### 14.1 Stage 0 findings (13 Oct 2026)

**The deployed-site check in §9 could not be performed.** Signing in at
`https://freightproof-sa.vercel.app/` returns "Signed in, but your dispatcher profile could not be
loaded" — Supabase Auth accepts the credentials, then the dispatcher profile fetch fails because the
Railway backend is not serving. A site that cannot load a profile cannot render a vehicle detail page.
**Substituted:** the same check on `localhost:3000` against the current branch, agreed with Tom.
This is a spec/reality disagreement under rule 6: §9 and D11 assume the deployed site is reachable.

**"done for vehicle details" — NOT FOUND.** Evidence:
- Whole-repo grep, frontend *and* backend, at `HEAD` and at the presented commit `d785615`:
  `"done for"` has no user-facing hit (one unrelated Python comment, `orchestration/trips/listing.py:97`).
  `"vehicle details"` appears only as `'Vehicle details updated'`, `components/blockchain/EventTimeline.tsx:36,43`.
- Rendered page text (which grep cannot cover — runtime-assembled or DB-sourced strings) on
  horse `CA 123-456` and trailer `CA 789-012`, Analytics tab and Immutable History tab: no "done for",
  no "vehicle details", no standalone "Done". The trailer also exercised the empty state.
- The vehicle-detail right-panel toggle is `Immutable History | Analytics`
  (`app/(app)/fleet/vehicles/[id]/page.tsx:54-57`). Nothing on it reads "done".
- The source minutes hedge: *"something reading 'done for vehicle details'"*
  (`docs/Iteration_3_Documentation/iteration-3-presentation-minutes.md:168`), and `docs/iteration4_plan.md:99`
  already recorded "Not in dispatcher source · Can't verify".
- **Reading offered to Tom, not proven:** the phrase is plausibly a garbled transcription of a spoken
  remark — "[it's] done for vehicle details" — i.e. the analytics toggle was built for vehicle details,
  asking what about elsewhere. FP-296's provenance-on-every-page work is already the answer to that.

**Three incidental findings (not FP-296 work, not fixed here):**
1. `lib/auth/SupabasePasswordAuth.ts:47` — the comment claims "the login page shows this error's own
   message". No longer true: `app/(public)/login/page.tsx` replaces every non-`ProfileUnavailableError`
   with the generic `'Invalid credentials'`. Stale comment.
2. That generic string makes a wrong password indistinguishable from a network, key or timeout failure
   (and `lib/supabase/client.ts` aborts the first auth attempt at 3s). Deliberate anti-enumeration
   choice, but it cost real debugging time. Worth its own ticket.
3. Local `npm run type-check` reports one error in `.next/types/validator.ts` for
   `app/(app)/blockchain/receipts/page.js`, a route deleted in `2a99080` (FP-149). The generated file is
   dated 16 Sep; `tsconfig.json` includes `.next/types/**/*.ts`. A stale local artifact, invisible to CI
   (`.next` is gitignored). Not a real type error.


### 14.2 Drafted FP-296 comment for Stage 5 (NOT posted — Tom posts)

> "done for vehicle details": text not found. Not in the code at the presented commit d785615 or at
> dev 15c44e0 (whole-repo search, frontend and backend), and not on the rendered vehicle detail page —
> Analytics or Immutable History, horse or trailer — checked on 13 Oct 2026. The deployed site could not
> be checked: it authenticates but cannot load a dispatcher profile while the Railway backend is down.
> Closest string in the product is the event title "Vehicle details updated". No wording change made.

**Not run in Stage 0:** `npm run build` (would force a cold rebuild of Tom's dev server's `.next`) and
`git fetch origin` (no SSH key in the agent sandbox; `origin/dev` last fetched 13 Oct 13:16 at `15c44e0`).
Both carried to Stage 6.

### 14.3 Stage 3 — §5.3 corrections made after reading the queries (rule 8)

Verified first: migration `2026_09_13_tom_live_analytics_views.py` turned all five analytics views from
materialized into **plain** views, so the three detail-summary lines may say "live" truthfully.

| Card | Correction | Evidence |
|---|---|---|
| 1.1 Trips over time | added "Closed trips only" | `base.py:closed_trips` filters `status == CLOSED` |
| 1.7 Cancellations | added the denominator: every trip that ended | `activity.py:cancellations_by_bucket` counts cancelled *and* total ended |
| 1.3 Busy patterns | arrivals are the **in-transit** step; overridden steps excluded; **any trip status** | `patterns.py:build_patterns` uses `PhaseType.IN_TRANSIT`; `attested_instants` has no closed-trip filter |
| 2.1 On-time | only trips that had planned times; arrival is *recorded*, not attested | `on_time.py` returns `None` without a plan; `actual_arrival_at` is a Trip column |
| 2.2 How late | same as 2.1 | same source |
| 3.1 / 3.3 / 3.4 Problems | added "on closed trips, dispatcher notes left out" | `EXCLUDED_FROM_PROBLEMS = {DISPATCHER_NOTE}` |
| 3.2 Theft signs | added **trailer-separation**, and that it runs on the simulated Pulsit feed | `constants.py:THEFT_SIGNAL_TYPES` includes `TRAILER_LOCATION_MISMATCH`; the draft omitted it |
| 4.1–4.4 Review desk | any trip status; 4.1–4.3 critical only, 4.4 any severity; legacy markers excluded | `review.py` docstring and `outcomes()` |
| 5.1 Tracker agreement | attested stop steps on closed trips; the driving step has no verdict | `evidence.py:tracker` excludes `IN_TRANSIT`, requires `trip_stop_id` |
| 5.2 Overrides | it is a share of every step on closed trips, not a bare count | `evidence.py:overrides` |
| 1.6 Busiest sites | attested steps, closed trips, empty-run unloadings are not deliveries | `routes.py:site_counts` requires `trip_type == LOADED` for a delivery |

Unchanged because they were already accurate: Tiles · 2.5 Plans vs reality · **3.5 Risky times** (checked line by
line against `problems.py:112`, the figure the panel challenged) · 2.4 Driving time · 6.3 Lane risk · 3.6 Incident
map · all three detail summaries.

**Finding for Tom, beyond D10's two feeds.** Four integrations default to mock in `core/config.py`, not two:
`PULSE_USE_MOCK`, `PP_USE_MOCK`, **`IDVS_USE_MOCK`** (`integrations/idvs`, which raises `RECEIVER_ID_MISMATCH`, a
theft signal) and **`SCAN_FEED_USE_MOCK`** (`integrations/scan_feed`, which `orchestration/consignments/scans.py`
uses for parcel and waybill mismatches). Tom chose **option C**: name the gap once in the page-level data note
rather than lengthening each card's line or re-opening D10.

### 14.4 Stage 2's live check is deferred, not done

The pin-appears-by-itself behaviour was **not** verified against a running server: the driver app runs on a
team phone Tom did not have. Unit tests cover the wiring (the subscription's resource/id/kinds, that its callback
re-asks only the incidents, that a silent refetch never sets `isRefreshing`, and that an unchanged pin set yields
an unchanged signature), but the real SSE round trip is unproven.

**No phone is needed to close this.** The dispatcher's own dev panel at `/dev/triggers` has a Tracker actions
control (`components/dev/TrackerActions.tsx`, wired at `DevTriggerPanel.tsx:71`) whose **Run road check** button
calls `POST /dev/tracker/check` → `road_check.check_trip_on_road`, which saves `gps_lat`/`gps_lng` from the
simulated Pulsit fix (`road_check.py:305-306`) and publishes `EXCEPTION_RAISED` (`road_check.py:311`) — a real
located pin and a real live event. The panel's plain **Raise exception** control
(`backend/app/dev/endpoints/triggers.py:461`) sends no GPS, which is the other half of the test: the unlocated
count must rise while the map stays still.

Test steps are in the hand-over note Tom holds. If a pin needs a reload, that is the live channel, not the map —
report it, do not change the backend (D13).

### 14.5 Final check run (Stage 6, 13 Oct 2026)

| Check | Stage 0 baseline | Stage 6 | |
|---|---|---|---|
| backend `ruff check .` | passed | passed | — |
| backend `scripts/check_structure.py` | OK | OK | same pre-existing "tree shrank" note |
| backend `lint-imports` | 17 kept, 0 broken | 17 kept, 0 broken | — |
| backend `mypy .` | 505 files, clean | 505 files, clean | — |
| backend `pytest -m "not slow"` | 2622 passed, 4 skipped | **2622 passed, 4 skipped** | unchanged, as intended |
| dispatcher `npm run lint` | 0 errors, 2 warnings | 0 errors, 2 warnings | warnings pre-date FP-296 (`EvidencePhoto.tsx`) |
| dispatcher `npm run type-check` | 1 phantom error | **clean** | the stale `.next` artifact cleared itself |
| dispatcher `npm test` | 1511 passed | **1541 passed** | +30 across stages 1–4 |
| dispatcher `npm run build` | not run | **passed** | every route compiled; `/analytics` 157 kB |

Diff: 36 files, +744 / −37. **No shared file touched** — each of CLAUDE.md's eight was checked explicitly.
No migration, no new dependency, no new `.env` key, no file moved or renamed.

---

## 15. Decisions taken during the build (13 Oct 2026)

§2 holds the decisions agreed before any code. These are the ones the build itself forced, each
agreed with Tom at the time. They are recorded here because the reasoning, not just the result, is
what a reviewer or examiner will ask about.

| # | Decision | Why | Who |
|---|---|---|---|
| B1 | **The deployed-site check in §9 was replaced by the same check on `localhost`.** | The deployed dispatcher authenticates but then fails with "Signed in, but your dispatcher profile could not be loaded": Supabase Auth accepts the credentials and the profile fetch fails because the Railway backend is not serving. A site that cannot load a profile cannot render a vehicle detail page, so the check was impossible as written. | Tom |
| B2 | **Stage 5 SKIPPED: the "done for vehicle details" text does not exist.** | Whole-repo search (frontend *and* backend) at `HEAD` and at the presented commit `d785615` found no user-facing hit; the rendered Analytics and Immutable History tabs of a horse and a trailer showed none either. The minutes themselves hedge ("something reading…"). Changing a label on a guess would have altered text the driver and precinct pages share. Evidence: §14.1. | Tom |
| B3 | **`MapWindow` is declared in `navigation.ts`, not `RoutesTab.tsx` as §7.1 said.** | `navigation.ts` needs the type to annotate `mapWindowFromSearch`. A plain-TypeScript URL parser importing from a React component is the wrong dependency direction. Same type, same behaviour. | Claude, flagged to Tom |
| B4 | **`IncidentsCard`'s prop is `mapWindow`, not `window`.** | A prop named `window` shadows the browser global inside the component. It passed lint and tsc, but it is a trap for the next edit. | Claude, flagged to Tom |
| B5 | **`pinSignature` compares report ids only.** | A pin's position and severity are fixed when the report is raised, so the set of ids is the whole identity. This is what stops a live refetch redrawing the markers and refitting the map mid-demo (D4). Assumes ids contain no comma, which holds because they are UUIDs. | Claude |
| B6 | **11 of the 21 draft Source lines in §5.3 were wrong and were corrected against the queries.** | Rule 8 requires every Source line to be true. Reading the ten fleet query modules showed real errors, not stylistic ones: a missing theft-signal type, a chart that is not limited to closed trips, a rate described as a count. Full table with evidence: §14.3. | Tom approved all 11 |
| B7 | **D10 option C: the mock-feed gap is named once in the page-level data note, not on each card.** | Tracing the theft signals found **four** integrations defaulting to mock, not the two D10 names: `PULSE_USE_MOCK`, `PP_USE_MOCK`, `IDVS_USE_MOCK` (receiver-ID checks) and `SCAN_FEED_USE_MOCK` (parcel and waybill counts). Naming all four on every card line would bloat them; the page note is where a presenter would point anyway. D10 itself was not re-opened. | Tom |
| B8 | **`source` is a *required* prop on both `ChartCard` and `AnalyticsSummaryFrame`.** | D7 applied to the detail pages as well. The compiler, not a manual sweep, is what enumerates every figure: making it required produced the exact list of 21 chart call sites and all 3 summaries. A card added later cannot forget one. | Tom (D7), extended by Claude |
| B9 | **The tile row's and the summaries' Source lines render outside the loading/error/empty branches.** | Where a figure comes from does not depend on whether it arrived. Putting the line in one place per surface means no state can silently lose it, and the tests assert all three states. | Claude |
| B10 | **Em dashes removed from dispatcher-facing analytics copy only; comments, docs and `NO_DATA` left alone.** | Tom's rule is "not customer facing in the dispatcher UI". Seven rendered strings were reworded (paired em dashes became parentheses or commas, not bare hyphens, which read as typos). The 48 pre-existing em dashes in teammates' comments were left: touching them would widen an FP-296 PR into nine unrelated files days before the 19 Oct freeze. `NO_DATA = '—'` (`lib/format/analytics.ts:6`) was left as deliberate typography for an empty cell; it is rendered by 10 files including non-analytics screens. **Open question for Tom.** | Tom |

### 15.1 Still open after this ticket

1. **Stage 2's live behaviour is unverified against a running server** (§14.4). Closeable from the
   dispatcher's own dev panel without the team phone.
2. **The FP-296 Jira comment in §14.2 has not been posted.** Tom posts it.
3. **`lib/auth/SupabasePasswordAuth.ts:47` carries a stale comment** claiming the login page shows
   Supabase's own error message. It does not — `app/(public)/login/page.tsx` replaces every
   non-`ProfileUnavailableError` with a generic "Invalid credentials", which makes a wrong password
   indistinguishable from a network, key or timeout failure. Deliberate anti-enumeration design, but
   it cost real debugging time in this session. Worth its own ticket; outside FP-296.
4. **Busy patterns counts trips of any status**, unlike every other chart on the page, which counts
   closed trips only. Its Source line now says so honestly, but the inconsistency is in the backend
   (`patterns.py:attested_instants` has no closed-trip filter) and a reviewer may ask about it.
5. **`NO_DATA = '—'`** — see B10.

