# Fleet Analytics Page — build spec and executable plan

**Status:** READY TO BUILD — nothing built yet. Update the progress table (§14) as stages complete.
**Owner:** Tom (sign-off after every stage). **Written:** 2026-09-15 by Claude, from a two-day
decision session with Tom (every choice below was agreed with him; the reasons are recorded).
**Ticket:** none yet — Tom to create one and put its number here.
**Branch:** `feature/fleet-analytics-page`, created by Tom from an up-to-date `dev`. The executor never
creates or switches branches.

---

## 0. Handoff — paste this first in a new session

> FreightProof's dispatcher app has a sidebar **Analytics** page (`frontend/dispatcher/app/(app)/analytics/page.tsx`)
> that today shows four raw per-entity tables (Facility / Vehicle / Lane / Driver). Per-entity analytics now live on
> each vehicle, driver and precinct detail page, so this page is being **replaced** by one fleet-wide page of
> patterns and trends, mostly charts. The layout is **headline tiles across the top + six tabs** (Activity ·
> On time · Problems · Review desk · Evidence · Routes & sites). Every chart and tile is specified in §5, with the
> exact data definition it must use in §4. The backend adds **live read-only queries** (no migration, no new tables,
> no seed data) behind nine new `GET /api/v1/analytics/fleet/*` endpoints (§6); the frontend uses the already
> installed **Recharts 3.8.1** and **Leaflet 1.9** (§7). Work is split into **8 stages** (§9); each stage ends with
> something visible in the browser, and **you must stop after each stage for Tom's sign-off**. Follow
> `CLAUDE.md` exactly: PLAN block before each stage, TASK COMPLETE after, never run git write commands, never run
> `alembic`, never read `.env`. Real data is sparse (~16 closed trips on the shared DB) — that is expected; every
> chart must handle "not enough data yet" gracefully (§7.6). Start at the first stage in §14 that is not DONE.

---

## 1. Rules for whoever executes this

1. Read `CLAUDE.md` first. It overrides nothing here, and nothing here overrides it.
2. Before each stage: output the CLAUDE.md `PLAN` block for that stage. After: output `TASK COMPLETE` and
   **stop**. Tom reviews in the browser, then says go. Do not start the next stage uninvited.
3. Git: only `git status`, `git diff`, `git log --oneline -10`, `git branch --show-current`, `git fetch`,
   `git add <specific files>`. **Tom commits once at the end** (his workflow) — do not hand him per-stage commit
   commands unless he asks.
4. At the start of every stage run `git fetch origin` then `git diff --stat origin/dev...HEAD` and
   `git log --oneline HEAD..origin/dev`. If `dev` gained changes to any file this spec touches, stop and tell Tom
   (see risk R6).
5. Explain things to Tom plainly: short, jargon-free, plain answer first, then the detail. If he asks for something
   that contradicts a decision in §2, say so and explain why before doing it — don't just agree.
6. When this spec and the code disagree (a file moved, a column renamed), trust the code, note the difference in
   TASK COMPLETE, and update this spec's §14 notes column.
7. Anything not covered here that changes behaviour, scope, or a shared file → ask Tom first.

---

## 2. Decisions (with reasons) — do not relitigate

| # | Decision | Why |
|---|---|---|
| D1 | Replace the old four-tab page entirely; per-entity numbers stay on the detail pages. | Tom moved per-entity analytics to detail pages; this page answers "how is the whole operation doing". |
| D2 | Layout **(b)**: headline tiles always visible on top, then **one tab per section**, only the open tab fetches. | Chosen by Tom over (a) one long scroll with jump bar and (c) overview + drill-in. ~22 charts on one scroll is too much; the old page already used "only the open tab fetches". |
| D3 | Six tabs: **Activity · On time · Problems · Review desk · Evidence · Routes & sites**. | Tom said "do what fits best". The original "Fleet" section shrank to one chart, and lane/site charts were scattered, so everything about *places* became one tab. |
| D4 | Controls live **per tab**, in one row above that tab's charts. Tiles have none (always "right now"). Over-time charts get **View by Week / Month / Year** + **Period**; distribution charts get Period only. | Tom: "the date range works for some but not for active trips and not for the four graphs next to each other". Dataviz rule: filters in one row above what they scope. |
| D5 | The Activity tab's **pattern charts have their own Period** (default **All time**), separate from the tab's trend controls. | Tom's explicit wish; patterns need lots of history to mean anything. |
| D6 | **Real data only. No seed / demo data.** | Tom, 2026-09-15. Consequence: every chart needs empty and low-sample states (§7.6). |
| D7 | **No migration, no new views.** New numbers come from live read-only SQLAlchemy queries over the base tables. | Plain views already proved live queries cost ~3 ms on this data (`2026-09-13-live-analytics-views.md`); monthly views can't answer week/hour grains anyway; a migration risks the 4-dev Alembic head conflicts this team keeps hitting. |
| D8 | Trip-based numbers use **closed trips only**, bucketed by the trip's **first attested departure**, in **South African time** — the exact FP-153 rule. | Keeps every fleet figure consistent with the driver / vehicle / precinct detail pages. (Tom was told "trips count in the period they were completed"; switched to departure date for consistency — labels say "by departure date". Report this deviation to Tom in Stage 2.) |
| D9 | **On time is strict**: on or before the planned time; no grace window. | Matches the driver pages (`on_time_departure_rate`). Chart 2.2 shows the "only a few minutes late" cases so the strict rule doesn't mislead. |
| D10 | **Dispatcher notes are never counted as problems.** | Every cancellation and every dispatcher override auto-creates a `dispatcher_note` exception. Counting them would make "problems" rise whenever a dispatcher does their job. Consequence: fleet problem totals can be lower than driver pages (which include them) — the page says so. |
| D11 | Only list exception types that something actually creates (show types with a count > 0). | Never-created types (`route_deviation` outside the dev panel, `vehicle_substitution`, `driver_substitution`, `checkpoint_timeout`, `sequence_violation`, `escalation`, `trip_hold`) would sit at a permanent 0 that reads as good news. |
| D12 | Theft signals = `seal_mismatch`, `seal_broken_in_transit`, `parcel_count_mismatch`, `waybill_count_mismatch`, `panic_button`. **Not** `seal_unverified`. | `seal_unverified` means "no departure seal to compare against" — a paperwork gap, not tampering (see `ExceptionType.SEAL_UNVERIFIED` comment in `backend/app/db/models/enums.py`). |
| D13 | **No driver ranking of any kind** on this page; driver data only as fleet totals. Reviews-per-dispatcher also left out. | FP-156 Decision 06 (no driver score/rating/rank). Tom left per-dispatcher counts out for the same reason. |
| D14 | Incident map (3.6) **is in scope** — team approved it 2026-09-15. Pins carry no driver name. | POPIA: a pin is where a named driver was. Data stays in-system, dispatcher-only endpoint, no names. Today only panic reports carry a location; a teammate is adding location to all driver reports — the map picks those up automatically, no change needed here. |
| D15 | Remove **all** analytics tiles from the home page (`app/(app)/page.tsx`) in the final stage. | Tom's rule: home = live work, analytics page = numbers. Tom has told Ciaran (owner of the home page). The home "On-time rate (30d)" tile is also buggy (no 30-day filter, looks only at live trips, shows 100 % when empty). |
| D16 | Parked, not built: 1.4 cargo value, 6.1 breakdowns per 1,000 driving hours. Dropped: 1.2 (merged into 1.1), 3.7, 4.5, 5.3, 5.5, 6.4. | Tom's picks. |
| D17 | Keep all existing `/analytics/*` endpoints (drivers, vehicles, vehicles/streaks, lanes, facilities). | Detail pages use them; the lanes endpoint is harmless and useful for a future lane page. Removing endpoints is out of scope. |
| D18 | Chart colours come from a validated palette file (§7.3), not ad-hoc hex. The app's own warning (`#805600`) and critical (`#ba1a1a`) tokens are **not** stacked together. | Validated with the dataviz skill's script: that pair's colour-blind separation is ΔE 2.8 (target ≥ 8) and normal-vision 14.8 (floor 15) — a hard fail. Warning uses the app's light amber `#ffb95f` instead (ΔE 32.4). |
| D19 | New **PeriodControl** component instead of reusing `components/ui/DateRangePicker.tsx`. | `DateRangePicker` computes "today" in UTC (`toISOString`), fixes presets at module load, and cannot express "All time". Don't modify it (other pages use it). |
| D20 | Cancellation notes are **not** parsed into tooltips; the table view lists each cancelled trip with a link to its trip page (where the note is shown). | The note is stored inside a free-text exception description behind an internal prefix (`trip_service._CANCELLED_BY_PREFIX`); parsing that is fragile. |
| D21 | 3.5 "risky times" compares **share of driving time** against **share of problems raised during the driving step** (any severity), not critical-only. | Critical-only would be almost always empty and would include depot findings (a seal mismatch at unloading is not a road risk). Report this refinement to Tom in Stage 4. |
| D22 | **Chart card look (§7.7)**: the question and trip count move behind a small "i" button next to the title; every chart has a y-axis heading; week labels show the Monday–Sunday range ("7–13 Sep") instead of "w/c". Built into the shared card and chart wrappers, so every tab follows it. | Tom's browser review of Stage 2 (2026-09-15): a cleaner card face and clearer axes; "w/c" (week commencing) was not self-explanatory. |
| D23 | **On time review (2026-09-15):** 2.3 becomes five **step tiles** (typical time, change vs the previous period, own-scale trend line); 2.5 becomes a **diverging histogram** (early bands left, grey "On plan" in the middle, over bands right, all growing up from one baseline, whole period); every bucket gets a **tick mark** with evenly spaced one-line labels; card controls sit on the **title row** with no caption; the "Faded…" note moves into the **"i" popover** (§7.7 items 3–5). | Tom's browser review. The stacked 2.3 was flattened by one ~4-day sign-off average (steps differ 100-fold, so one shared scale fails). The downward-only 2.5 looked upside down, and a dot per trip does not scale to 1,000 trips (a pie was rejected: two slices, and it cannot show how far off plan). The 3–9 Aug dot looked misplaced because Recharts' `preserveStartEnd` hid its label and shifted the end label off its point. Tom keeps one-line labels ("13–19 Jul"). |
| D24 | **On time, second review (2026-09-15):** chart **2.3 Where the time goes is removed** (tiles, endpoint field and helpers all deleted). Chart **2.5** gets its **y-axis down the middle**, where "on plan" is: early bands on its left, over bands on its right, **"Trips" written level above the axis**, **"On plan" under it** ("On plan · N trips" when any trip was exactly on plan). There is no grey On plan column and **no summary text on the card face**; the summary moves to the table view. Built as `charts/SplitColumns.tsx`: two ordinary bar charts sharing one count scale. | Tom's browser review. The step tiles read badly on real data (every step "1–3 min", broken sparklines), so Tom removed the chart rather than try a third design. 2.5's axis sat at the far left with the summary line above the bars, where Tom asked for the axis in the middle and no text on the chart. Per-driver step timings stay on the driver detail pages. |
| D25 | **Problems, Review desk, Evidence and Routes review (2026-09-15):** **3.1** draws problem **counts** per bucket (warning under critical), with the rate per trip in the tooltip ("8 problems across 2 trips (4 per trip)") and the table. **`receiver_id_mismatch` joins the theft signs** (extends D12; `receiver_id_unverified` stays out). **4.4** becomes a **donut**, total reviews in the centre, "count · %" per outcome in the legend, a Share column in the table (4.3 is unchanged, left for the team to discuss). **Evidence:** 5.1's agreement line and 5.7's same-phone / rejected-scan line move into the "i" popover; **5.4 Blockchain receipts is removed** (the `receipts` field is gone from `/evidence`; the Receipts owed tile stays and still links to the tab); 5.7 spans the full width. **Routes & sites:** Busiest sites and Lane risk share the top row, Driving time per lane and the map take the full width; 6.3 names each dot (all of them up to 6 lanes, else only the busy-and-risky ones), draws faint lines at the average lane and labels the top-right corner "Busy and risky"; the map's scroll-wheel zoom switches on after a click in the map (street level, the tiles' own max zoom) and off when the pointer leaves; the incident table shows 10 rows plus "Load 10 more", and clicking a row flies to that pin and opens its popup. **Period presets follow View by** (§3). **Back link:** a report opened from the map comes back to the same tab, View by and period (§3). | Tom's browser review. "Per 100 trips" read "400 per 100" on two trips. Tom asked for variety (a pie) on 4.4; a donut suits five parts of one whole and keeps a place for the total. The agreement and flags lines describe the chart rather than being the chart. Receipts were unnecessary for now. Overrides reading 0 was checked and is correct: all 4 overridden steps in the data are on cancelled trips, which trends never count. Map filters are later work. |

### Rejected alternatives (so nobody re-proposes them)

- **Layout (a) long scroll / (c) overview + see-more** — rejected by Tom for (b).
- **New materialized or plain SQL views via Alembic** — rejected (D7).
- **Computing everything in the browser from the existing per-entity endpoints** — those are monthly and
  per-entity; they cannot produce weeks, hours, queue history or map pins, and summing them client-side re-derives
  rates the backend is supposed to divide exactly once (FP-153 rule 1).
- **One endpoint per chart (~25 endpoints)** — too many round trips; one endpoint per tab matches "only the open tab
  fetches".
- **Seeding demo trips** — rejected by Tom (D6).
- **Leaflet marker-clustering plugin** — a new dependency (shared `package.json`); not needed at current volumes.

---

## 3. What the page looks like

```
┌ Analytics ─────────────────────────────────────────────────────────────────────────────────┐
│ [Live trips 7] [Critical Exceptions Waiting 4 · oldest 2 d] [Parcels complete 96 %] [Receipts owed 12]  │
│ [Licences & discs: 0 expired · 2 ≤30 d · …] [Unused vehicles 2]            ← tiles, no filter │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  Activity | On time | Problems | Review desk | Evidence | Routes & sites        ← Tabs        │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  View by [Week|Month|Year]   Period [Last 12 weeks ▾]      scope note            ← one row  │
│  ┌ chart card ─────────────┐ ┌ chart card ─────────────┐                                     │
│  │ title · question · n    │ │                         │   2-column grid ≥ lg, 1 column below │
│  │ chart / empty state     │ │                         │                                     │
│  │ [Show table]            │ │                         │                                     │
│  └─────────────────────────┘ └─────────────────────────┘                                     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Tab choice is kept in the URL as `?tab=<id>` so tiles can deep-link (e.g. Receipts owed → `?tab=evidence`).
  Tab ids: `activity`, `on-time`, `problems`, `review`, `evidence`, `routes`. Default `activity`.
- Each tab keeps its own control state for the visit (page-level `Record<TabId, TabControls>`), so switching tabs
  and back does not reset choices.
- Defaults: View by **Week**; Period **Last 12 weeks**. Activity's pattern charts: Period **All time**.
- Period presets depend on View by (D25; `PRESETS_BY_GRAIN` in `lib/format/period.ts`), each list ending in
  **Custom range…** (two date inputs). All dates are SAST calendar dates.
  - Week: **Last 4 weeks · Last 12 weeks · Last 26 weeks · This year · All time**
  - Month: **Last 3 months · Last 6 months · Last 12 months · This year · All time**
  - Year: **This year · Last 3 years · All time**
  - Routes & sites (no View by) and the pattern charts: **Last 4 weeks · Last 12 weeks · Last 12 months · This year ·
    All time** (`GENERAL_PRESETS`).
  - Changing View by keeps a period the new list offers (and any custom range); otherwise it switches to that View
    by's default: Last 12 weeks (Week), Last 12 months (Month), All time (Year) — `periodForGrain`.
- Back link (D25): the map's "Open" links carry `returnTo=/analytics?tab=…&grain=…&period=…` (plus `start`/`end` for a
  custom range), built by `components/analytics/fleet/navigation.ts`. The exception page's Back button already honours
  `returnTo`. On arrival the page restores that tab's View by and period from the address, then replaces the address
  with plain `?tab=…`. Trip links carry no `returnTo`: the trip detail page's Back button does not read it yet.
- A View-by option that would produce more than `MAX_TREND_BUCKETS` (53) buckets for the chosen period is disabled
  with a tooltip "Too many weeks for this period — choose Month"; if the current choice becomes invalid after a period
  change, switch to the next coarser grain and show a one-line note.
- Page scope note (under the controls, `text-[12px] text-on-surf-v`): *"Trends count closed trips, grouped by the
  day they first departed (South African time). Tiles show right now."*

---

## 4. Global data rules — every query follows these

These mirror FP-153's view SQL (`backend/migrations/versions/2026_09_12_tom_analytics_read_models.py`, the
`_CLOSED_TRIPS_CTE`, `_TRIP_PHASES_CTE` and `_GAP_IS_ATTESTED` fragments, lines 51–123). Read that file before
writing any query.

| # | Rule |
|---|---|
| G1 | **Org scope:** every query filters `trips.operator_organization_id = <caller org>` (from the token via `get_current_dispatcher`, never from the request). Exceptions, phase events, handovers are scoped through their trip. |
| G2 | **Attested step:** `phase_events.status IN ('completed', 'exception')` — reuse `ATTESTED_PHASE_STATUSES` from `app/analytics/views.py`. `overridden` steps are excluded from every timing and every tracker measure (their `completed_at` is a dispatcher's click; override never runs corroboration). |
| G3 | **A trip's departure** = `MIN(phase_events.completed_at)` over its attested `departure` rows. **Never** read `trips.actual_departure_at` (overwritten on every leg of a multi-stop trip — known defect). |
| G4 | **Closed-trip set for a period:** `trips.status = 'closed'` AND its departure (G3), converted to SAST, falls on a date in `[start, end]` inclusive. Bucket = `date_trunc(<grain>, departed_at AT TIME ZONE 'Africa/Johannesburg')`. In SQLAlchemy: `func.date_trunc(grain, func.timezone(OPERATIONS_TIME_ZONE_NAME, col))`. |
| G5 | **Time zone:** SQL uses the named zone `'Africa/Johannesburg'` (as the views do); Python uses `timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))` (as the tests do). SAST has no DST, so they agree. A period `[start, end]` becomes the instant range `[start 00:00 SAST, (end + 1 day) 00:00 SAST)`. |
| G6 | **Weeks start Monday** (`date_trunc('week', …)` is ISO/Monday). |
| G7 | **Empty buckets are returned** (zero-filled in Python) from the bucket containing `start` to the bucket containing `end`, so charts show gaps honestly. |
| G8 | **`is_partial`** is true for a bucket that is not a complete week/month/year inside the period: it starts before `start`, ends after `end`, or is not finished yet (contains dates after today SAST). The UI draws partial buckets faded with the label "part week"/"part month"/"so far". |
| G9 | **Rates:** return the raw counts and derive the rate once with `safe_ratio` (`app/analytics/stats.py`) as a Pydantic `computed_field`; `None` when the denominator is 0 — rendered as "—", never 0 %. Averages likewise: sum/count. Medians/P90 use `percentile` from `stats.py` over **pooled raw values**. |
| G10 | **Problems exclude `dispatcher_note`** (D10). Define `EXCLUDED_FROM_PROBLEMS = frozenset({ExceptionType.DISPATCHER_NOTE})` once. |
| G11 | **"All time"** = the frontend omits `start`; the backend resolves it to the SAST date of the org's earliest `trips.created_at` (or today if the org has no trips). |
| G12 | `end` may not be after today (SAST); `start` may not be after `end`; bucket count may not exceed `MAX_TREND_BUCKETS = 53` → otherwise **422** with a plain message. |
| G13 | **Per-occurrence averages** (pattern charts): average = events in that bucket ÷ number of calendar days in the period (clipped to today) that belong to that bucket. Hour of day: every day counts once per hour. Weekday: number of Mondays, Tuesdays, … in the period. Day of month: number of dates in the period that are the 1st, …, the 31st (so the 31st is only divided by months that have one — this is Tom's 28/30/31 fix). Month of year: number of days in the period that fall in January, …, December → "average per day in March". |
| G14 | **Driving legs:** a leg is an attested `in_transit` row whose previous plan step (by `sequence_number`) is an attested `departure`; driving minutes = `in_transit.completed_at − departure.completed_at`. `in_transit.completed_at` is when the driver tapped "arrived" (`phase_service.advance_in_transit`). |
| G15 | **Step gaps** (where the time goes): for each attested row, gap = its `completed_at` minus the previous plan row's `completed_at`, only when both are attested (exactly `_GAP_IS_ATTESTED`). |
| G16 | Precinct names are looked up **by id only** (no org or `is_shared` filter) — same rule and reason as `analytics_service._precinct_names`. |

---

## 5. Metric catalogue — what each tile and chart shows

Legend: **Form** = chart type · **Data** = exact definition · **Bucket** = time grouping · **States** = empty /
low-sample behaviour (general rules in §7.6).

### 5.0 Headline tiles (endpoint `GET /analytics/fleet/tiles`, no parameters)

| Tile | Shows | Data | Click |
|---|---|---|---|
| **Live trips** | "7" | Count of org trips with `status IN LIVE_TRIP_STATUSES` (`created`, `active`, `exception_hold` — constant in `app/db/models/trips.py`). | `/` (the dashboard's Active Trips list) |
| **Critical Exceptions Waiting** | "4 · oldest 2 d" | Count of org exceptions with `severity = 'critical'` AND `review_status = 'needs_review'`; plus `MIN(created_at)` of those, shown as an age. Warn styling + icon when > 0. | `/exceptions` (opens on its Needs Review tab by default) |
| **Parcels complete** | "96 %" + "last 30 days" | Loaded (`trip_type = 'loaded'`) closed trips whose departure is within the last `TILE_WINDOW_DAYS = 30` SAST days; complete = trip has **no** exception of type `parcel_count_mismatch` or `waybill_count_mismatch`. Rate = complete ÷ loaded. Label: *"Loaded trips with every parcel accounted for"*. | `?tab=problems` |
| **Receipts owed** | "12" (+ "3 failed") | Org phase events with `phase_type IN ANCHORED_PHASES` (`trip_creation`, `departure`, `confirmation` — `app/orchestration/phase_plan.py`) AND attested AND `anchor_status IN ('pending','failed')`. Return pending and failed separately. Future plan steps are `pending` by design and overridden steps are never anchored — both are excluded by "attested". | `?tab=evidence` |
| **Licences & discs** | 5 bands, drivers and discs | Active drivers' `license_expiry` and active vehicles' `licence_disc_expiry`, bands relative to today SAST: **expired** (< today) · **≤ 30 days** · **31–90 days** · **91–180 days** · **no date on file**. Bands are separate (never cumulative) and align with the drivers list colours (red ≤ 30, amber ≤ 90 — `app/(app)/fleet/drivers/page.tsx`). | `/fleet/drivers` and `/fleet/vehicles` (two links) |
| **Unused vehicles** | "2 trucks · 1 trailer" + up to 3 registrations | Active org vehicles (horse or trailer) that are **not** the horse or a trailer (`trip_trailers`) of any trip whose departure is in the last 30 SAST days, **and** not on a live trip now. Vehicles only — never drivers (D13). | `/fleet/vehicles` |

### 5.1 Activity tab (`GET /analytics/fleet/activity?start&end&grain`, patterns `GET /analytics/fleet/patterns?start&end`)

**1.1 Trips over time** — *"Are we getting busier?"*
Form: stacked columns per bucket, **loaded** (slot 1) and **empty run** (slot 2). Data: closed-trip set (G4) split by
`trips.trip_type`. Bucket: grain. Subtitle: "Closed trips, by departure date". Tooltip: "41 trips · 38 loaded · 3 empty".

**1.7 Cancellations over time** — *"How often are trips abandoned?"*
Form: line with dots (single series, slot 1, no legend box). Data: trips with `status = 'cancelled'`, bucketed by
`closed_at` (cancel sets it — `trip_service.cancel_trip`) in SAST. Denominator for the tooltip = trips that **ended**
in that bucket = cancelled + closed trips by `closed_at`. Tooltip: "3 cancelled out of 41 trips that ended (7 %)".
Table view: one row per cancelled trip (trip reference linked to `/trips/{id}`, cancelled date) — D20. Drawn directly
under 1.1 with the same x-axis.

**1.3 Busy patterns** (own sub-section, own Period, default All time) — *"When are we busiest?"*
A row of four small column charts: **hour of day (0–23)** · **weekday (Mon–Sun)** · **day of month (1–31)** ·
**month of year (Jan–Dec)**, with a **Departures | Arrivals** switch above them. Data: departures = attested
`departure` rows; arrivals = attested `in_transit` rows (every leg counts; any trip status; overridden excluded).
Timestamp = `completed_at` in SAST. Value = per-occurrence average (G13). Bars stay in clock/calendar order —
**never sorted by size**; the busiest bar is the accent (slot 1), the rest neutral grey (emphasis form). Both event
types come back in one response, so the switch never refetches. Month-of-year note when the period is under a year:
"Needs a full year of history to compare months fairly."

### 5.2 On time tab (`GET /analytics/fleet/on-time?start&end&grain`)

**2.1 On-time departures and arrivals** — *"Are we getting more punctual?"*
Form: two lines (departures slot 1, arrivals slot 2), y = % (0–100), legend + end labels. Data per bucket (closed-trip
set): departures with a plan = trips with `planned_departure_at`; on time = departure (G3) ≤ `planned_departure_at`.
Arrivals with a plan = trips with `planned_arrival_at` and `actual_arrival_at`; on time = `actual_arrival_at` ≤
`planned_arrival_at` (`actual_arrival_at` is the final driving leg's attested arrival; overrides don't set it —
`phase_service.py` ~line 668). Tooltip: "18 of 22 departures (82 %)". Caption: "Left late and arrived late → problem
at the dock. Left on time but arrived late → problem on the road."

**2.2 How late is late** (Period only, **Departures | Arrivals** switch) — *"A little late often, or very late sometimes?"*
Form: columns in fixed order. Delta = actual − planned (minutes). Buckets: **Early** (delta < −15) · **On time**
(−15 ≤ delta ≤ 0) · **1–15 min late** · **15–60 min** · **1–3 h** · **3 h+** (constants `EARLY_THRESHOLD_MINUTES = 15`,
`LATE_BUCKET_EDGES_MINUTES = (15, 60, 180)`). Early + On time bars neutral grey; the four late bars use the validated
lateness ramp (§7.3). Test invariant: Early + On time = the on-time count in 2.1 for the same period.

**2.3 Where the time goes** — **removed (D24).** Neither the stacked columns (Stage 3) nor the step tiles (D23)
read well on real data, so Tom removed the chart. Its endpoint field (`time_steps`), the `previous_period` helper and
the `StepTiles` component are deleted. Per-driver step timings stay on the driver detail pages ("average time in each
phase").

**2.5 Plans vs reality** — *"Are our planned times realistic?"* (D23, reworked in D24; covers the whole period, not
affected by View by)
Form: **split histogram with the y-axis down the middle**, where "on plan" is. Every column grows **upward** from
one baseline:
- **Left of the axis**, furthest first: **3 h+ · 1–3 h · 15–60 min · 0–15 min** (finished early, slot 1 blue).
- **Right of the axis**, nearest first: **0–15 min · 15–60 min · 1–3 h · 3 h+** (ran over, slot 2 orange).
- Both halves share one whole-number count scale (`countTicks`), so their gridlines meet at the axis.
- **"Trips"** is written level above the middle axis, not rotated.
- **"On plan"** sits under the axis. It reads "On plan · N trips" when any trip was exactly on plan: those trips are
  named, not drawn, because a column there would sit on the axis itself.
- The side captions sit under the x-axis: "← Finished early" on the left, "Ran over →" on the right.
- **No text on the card face** (Tom, D24). The legend shows the two colours only.

It is built as `charts/SplitColumns.tsx`: two ordinary Recharts bar charts side by side. The right one draws its
y-axis on its left edge, so every mark keeps the usual rules.

Band edges reuse `LATE_BUCKET_EDGES_MINUTES = (15, 60, 180)`, measured in absolute minutes off plan:
- 0–15 = more than 0 up to 15
- 15–60 = more than 15 up to 60
- 1–3 h = more than 60 up to 180
- 3 h+ = more than 180
- On plan = exactly 0

The data: closed trips with `planned_departure_at`, `planned_arrival_at` and `actual_arrival_at`; delta =
(actual_arrival − departure(G3)) − (planned_arrival − planned_departure). This is identical to the lane view's
`schedule_delta_minutes`.

The one-line summary *"11 finished early (typically 40 min) · 5 ran over (typically 20 min)"* (medians, positive
minutes) appears **only in the table view**, above the band table. Tooltip per column: "5 trips finished 15–60 min
early". Behind the "i": "Faster than planned usually means the plan was too generous — it is not a
measure of driving speed." The table view lists the bands with their counts and the two typical values. Invariant:
the bands add up to the number of trips with a full plan.

### 5.3 Problems tab (`GET /analytics/fleet/problems?start&end&grain`)

All counts: exceptions **on the closed-trip set** (G4), excluding `dispatcher_note` (G10). Tab note: *"Dispatcher notes
(recorded automatically for every cancellation and override) are not counted as problems, so totals can be lower than
on driver pages."*

**3.1 Problems over time** (was "per 100 trips", changed in D25) — *"Are things getting better or worse?"*
Form: stacked columns, **warning** (`#ffb95f`) under **critical** (`#ba1a1a`), legend with icons. Value = the **count**
of problems per bucket. Tooltip: each count, then "8 problems across 2 trips (4 per trip)"; the table has a Per trip
column (one decimal, "—" with no trips). The response still carries `warning_per_100` / `critical_per_100`; the page no
longer reads them. `info` is returned but not drawn (nothing creates it today); it appears in the table view if ever
non-zero.

**3.2 Theft warning signs** — *"Is theft risk going up?"*
Form: one line (total of D12 types) with dots; tooltip lists each type's count; table view one column per type.

**3.3 Most common problems** (Period) — horizontal bars, one per `exception_type` with count > 0, sorted descending,
each bar stacked by `source` (system slot 1, driver slot 2, dispatcher slot 3). Labels from
`lib/format/exception.ts`.

**3.4 Where in the trip** (Period) — columns in plan order: Loading · Waiting to leave · Driving · Unloading · Sign-off
(+ Activation, Trip creation if non-zero) + **Not linked to a step** (`phase_event_id IS NULL`). Grouped by the
linked phase event's `phase_type`. Single series, slot 1.

**3.5 Risky times of day** (Period) — *"Is any time of day riskier than its share of driving?"*
Blocks (SAST): Night 00–06 · Morning 06–12 · Afternoon 12–18 · Evening 18–24 (constant `DAY_BLOCKS`). Two columns per
block: **share of driving time** (slot 1) — each driving leg (G14) split across the blocks it spans, minute by minute
in Python — and **share of problems raised while driving** (slot 2) — exceptions whose linked phase event is
`in_transit`, by `created_at` (SAST). Caption: "If a block's problem share is much taller than its driving share, that
time of day is riskier." Known caveat in the table view: `created_at` is when the server received the report; a report
sent from a phone with no signal may arrive later (D21).

### 5.4 Review desk tab (`GET /analytics/fleet/review?start&end&grain`)

Not limited to closed trips — review is independent of trip status (`exception_service.review_exception`). Only
**critical** exceptions enter the queue automatically (`initial_review_status`). Exclude
`review_outcome = 'legacy_review'` everywhere (a migration marker, not a real finding).

**4.1 Waiting now, by age** (no period — right now) — columns: under 1 h · 1–24 h · 1–3 days · over 3 days
(`REVIEW_AGE_EDGES_HOURS = (1, 24, 72)`), critical + `needs_review`. Rendered at the top of the tab, with a link to
`/exceptions`.

**4.2 Is the pile growing?** — line: critical exceptions **waiting at the end of each bucket** = `created_at < bucket
end` AND (`reviewed_at IS NULL` OR `reviewed_at ≥ bucket end`); for the partial current bucket use "now". Computed in
Python from the org's critical `(created_at, reviewed_at)` pairs (pure function, unit-tested).

**4.3 How fast critical problems get reviewed** — line: **median** hours from `created_at` to `reviewed_at`, for
critical exceptions reviewed in each bucket (bucket by `reviewed_at`). Tooltip also shows the mean and the count.

**4.4 What reviews concluded** (Period) — a **donut** (D25; `charts/DonutChart.tsx`), one slice per
`DispatcherReviewOutcome` (no action needed · handled elsewhere · evidence confirmed · data discrepancy · referred for
follow-up) in series slots 1–5, fixed per outcome; zero outcomes draw no slice but stay in the legend and table. Total
reviews in the centre ("5 reviews"); legend "Data discrepancy · 3 · 60%"; the table adds a Share column. All
severities, reviews with `reviewed_at` in the period. Caption: "A large *data discrepancy* share means automatic checks
are raising false alarms."

### 5.5 Evidence tab (`GET /analytics/fleet/evidence?start&end&grain`)

**5.1 Tracker agreement** — stacked columns in this order: **confirmed** (`#006c4c`, ✓) · **unwitnessed** (neutral
grey) · **mismatch** (`#ba1a1a`, ✗) — grey sits between green and red so they never touch. Data = exactly the
facility view: attested phase rows of the closed-trip set, `phase_type <> 'in_transit'`, joined to `trip_stops`,
counted by `pulsit_geofence_confirmed` TRUE / FALSE / NULL. Headline: agreement % = confirmed ÷ (confirmed + mismatch)
— unwitnessed outside the denominator; reuse `ANALYTICS_COPY.facilityRateNote`.

**5.2 Overrides over time** — line of override % = rows with `dispatcher_override_user_id IS NOT NULL` ÷ all phase
rows of the closed-trip set (same definition as the driver view's `override_rate`). Caption: "An override skips the
driver's photos, seal and tracker check — the weakest evidence we hold."

**5.4 Blockchain receipts — REMOVED (D25).** What is still owed stays on the Receipts owed tile. Original design, kept
for reference: (Period) three horizontal bars **anchored · pending · failed** for anchored-phase rows
(`ANCHORED_PHASES`) that were **attested with `completed_at` in the period** (any trip status), plus a separate line
"N steps were overridden and are never anchored". Caption: "A receipt is the tamper-proof stamp proving a step's record
hasn't changed. A failed receipt is one still owed." Note: Chiko's FP-154 (`origin/Chiko`, not on `dev` yet) adds a
scheduled recovery task that re-anchors failed steps; the chart reads `anchor_status` either way — no change needed.

**5.7 Receiver sign-off** (trial) — line of % of attested `confirmation` rows (closed-trip set) that have a
`handover_confirmations` row (`phase_event_id` match), plus two figures for the period: **same-phone confirmations**
(`bearer_token_present = true`) and **rejected scan attempts** (`handover_token_attempts.rejection_reason IS NOT NULL`,
`attempted_at` in the period, scoped by joining `presented_trip_id` to the org's trips). Note: "Receiver QR sign-off
went live on 13 Sep 2026."

(5.6 is the **Parcels complete** tile — §5.0.)

### 5.6 Routes & sites tab (`GET /analytics/fleet/routes?start&end`, map `GET /analytics/fleet/incidents?start&end`) — Period only

**1.6 Busiest sites** — horizontal bars per precinct, stacked **pickups** (slot 1) and **deliveries** (slot 2); top
10 by total, "Show all" expands. Pickups = attested `loading` rows; deliveries = attested `unloading` rows on
`trip_type = 'loaded'` trips (the plan emits an `unloading` row at an empty leg's final stop even when nothing is
delivered — `phase_plan.build_phase_plan`). Closed-trip set; precinct via `trip_stops.precinct_id`.

**2.4 Driving time per lane** — horizontal grouped bars per lane ("Durban DC → Joburg DC"): **typical** (median,
`#3987e5`) and **bad day** (P90, `#0d366b`). Driving minutes per closed trip = `actual_arrival_at − departure(G3)`
(same as the lane view's `actual_transit_minutes`); reuse `DurationStats.from_values`. Lanes with fewer than
`LOW_SAMPLE_TRIPS` (5) trips are drawn faded with "too few trips". This chart is **the only place lanes survive** in the
app after the old page goes — do not drop it.

**6.3 Lane risk** — scatter, one dot per lane (single series, slot 1): x = trips on the lane, y = problems per trip
(G10 exclusions — do **not** reuse the lane view's `exception_count`, which includes dispatcher notes). Hover: lane
name, trips, problems. Hit area ≥ 24 px per dot. Caption: "Top-right = busy **and** risky." Table view sorted by
problems per trip.

**3.6 Incident map** — Leaflet map, one pin per exception with `gps_lat` and `gps_lng` not null, excluding
`dispatcher_note`, `created_at` in the period, any trip status. Pin colour by severity (warning `#ffb95f`, critical
`#ba1a1a`) **with an icon glyph**; legend. Pin popup: type label, severity, date, trip reference, "Open" → `/exceptions/{id}`.
**No driver name, no phone, nothing about the person.** Below the map: a table of the same pins (the keyboard /
screen-reader twin) and the line "N reports in this period had no location". Empty state: "No reports with a location
in this period. Today only panic-button reports send a location; more report types will appear once the driver app
sends one with every report."

---

## 6. API contract

All routes: `GET`, prefix `/api/v1/analytics/fleet`, `tags=["analytics"]`, auth `get_current_dispatcher`
(any dispatcher; read-only, org-scoped). No request bodies. Responses are Pydantic v2 models (frozen, `computed_field`
rates, `None` for no observations), mirrored in TypeScript.

Query parameters:

| Param | Type | Used by | Rule |
|---|---|---|---|
| `start` | `date`, optional | all except tiles | omitted = All time (G11) |
| `end` | `date`, required | all except tiles | ≤ today SAST (G12) |
| `grain` | `week` \| `month` \| `year` | activity, on-time, problems, review, evidence | ≤ 53 buckets (G12) |

Errors: **403** no token (HTTPBearer), **401** malformed/expired token, **403** driver token, **422** bad date /
start > end / end in future / too many buckets. Put only the period validation inside a `try` that converts
`ValueError` to 422 — same pattern as `_require_valid_month_range` in `endpoints/analytics.py` (a `ValueError` from a
query is a defect → 500).

Response shapes (field names are the contract; exact Pydantic class names are the executor's choice):

```text
Common
  Grain            = "week" | "month" | "year"
  PeriodEcho       { start: date, end: date, grain: Grain | null }
  every bucket row { bucket_start: date, is_partial: bool, ... }

GET /tiles -> {
  live_trips: int,
  critical_waiting: { count: int, oldest_created_at: datetime | null },
  parcels_complete: { window_days: int, loaded_trip_count: int, complete_trip_count: int, complete_rate: float | null },
  receipts_owed: { pending_count: int, failed_count: int },
  licence_expiry: { drivers: ExpiryBands, vehicle_discs: ExpiryBands },
      ExpiryBands { expired: int, within_30_days: int, within_90_days: int, within_180_days: int, no_date: int }
  unused_vehicles: { window_days: int, vehicles: [{ vehicle_id, registration, vehicle_type }] },
  all_time_start: date }
      all_time_start = SAST date of the org's first trips.created_at (or today). Added in Stage 1 with Tom's
      OK (2026-09-15): the page loads tiles first, so it knows which View-by options "All time" allows
      (≤ 53 bars) before any tab requests data.

GET /activity -> { period, trips: [{ bucket_start, is_partial, loaded_count, empty_count }],
  cancellations: [{ bucket_start, is_partial, cancelled_count, ended_count, cancelled_rate }],
  cancelled_trips: [{ trip_id, trip_reference, cancelled_at }] }

GET /patterns -> { period, departures: PatternSet, arrivals: PatternSet }
  PatternSet { hour_of_day: [PatternBar x24], weekday: [x7, Monday = 0], day_of_month: [x31, key 1..31],
               month_of_year: [x12, key 1..12] }
  PatternBar { key: int, event_count: int, day_count: int, average_per_day: float | null }

GET /on-time -> { period,
  punctuality: [{ bucket_start, is_partial, departures_with_plan, on_time_departures, arrivals_with_plan,
                  on_time_arrivals, on_time_departure_rate, on_time_arrival_rate }],
  lateness: { departures: [LatenessBar], arrivals: [LatenessBar] },
      LatenessBar { band: "early" | "on_time" | "late_1_15" | "late_15_60" | "late_60_180" | "late_over_180", trip_count }
  plan_spread: { bands: [{ band: "early_over_180" | "early_60_180" | "early_15_60" | "early_0_15" | "on_plan" |
                                 "over_0_15" | "over_15_60" | "over_60_180" | "over_over_180", trip_count }],
                 early_count, over_count, on_plan_count,
                 median_early_minutes: float | null, median_over_minutes: float | null } }   # whole period (D23)

GET /problems -> { period,
  per_trip: [{ bucket_start, is_partial, trip_count, info_count, warning_count, critical_count,
               warning_per_100, critical_per_100 }],
  theft_signals: [{ bucket_start, is_partial, total_count, by_type: { <exception_type>: int } }],
  by_type: [{ exception_type, source, count }],
  by_step: [{ step: <phase_type> | "unlinked", count }],
  risky_times: [{ block: "night" | "morning" | "afternoon" | "evening", driving_minutes, driving_share,
                  road_problem_count, road_problem_share }] }

GET /review -> { period,
  waiting_by_age: [{ band: "under_1h" | "1h_to_24h" | "1d_to_3d" | "over_3d", count }],
  queue: [{ bucket_start, is_partial, waiting_at_end }],
  time_to_review: [{ bucket_start, is_partial, reviewed_count, median_hours, mean_hours }],
  outcomes: [{ outcome, count }] }

GET /evidence -> { period,
  tracker: [{ bucket_start, is_partial, confirmed_count, mismatch_count, unwitnessed_count, agreement_rate }],
  overrides: [{ bucket_start, is_partial, phase_count, override_count, override_rate }],
  receiver_signoff: [{ bucket_start, is_partial, confirmation_count, receiver_scan_count, receiver_scan_rate }],
  signoff_flags: { same_phone_count, rejected_attempt_count } }

GET /routes -> { period,
  sites: [{ precinct_id, precinct_name, pickup_count, delivery_count }],
  lanes: [{ origin_precinct_id, origin_name, destination_precinct_id, destination_name, trip_count,
            driving_minutes: DurationStats, problem_count, problems_per_trip }] }

GET /incidents -> { period, pins: [{ exception_id, trip_id, trip_reference, exception_type, severity, created_at,
                                     lat: float, lng: float }], unlocated_count: int }
```

---

## 7. Implementation design

### 7.1 Backend files (layering: endpoint → orchestration → analytics → db)

| File | Purpose |
|---|---|
| `backend/app/analytics/fleet/__init__.py` | package marker |
| `backend/app/analytics/fleet/constants.py` | every named constant in this spec (`MAX_TREND_BUCKETS`, `TILE_WINDOW_DAYS`, `EARLY_THRESHOLD_MINUTES`, `LATE_BUCKET_EDGES_MINUTES`, `REVIEW_AGE_EDGES_HOURS`, `EXPIRY_BAND_EDGES_DAYS = (30, 90, 180)`, `DAY_BLOCKS`, `THEFT_SIGNAL_TYPES`, `EXCLUDED_FROM_PROBLEMS`, `OPERATIONS_TIME_ZONE_NAME = "Africa/Johannesburg"`) with a *why* comment each |
| `backend/app/analytics/fleet/periods.py` | **pure**: `Grain` enum, `Period` (validated start/end/grain), bucket list + `is_partial`, SAST instant range, per-occurrence day counts, driving-minute block splitting, queue-length reconstruction, lateness banding, expiry banding, age banding |
| `backend/app/analytics/fleet/base.py` | shared SQLAlchemy Core builders: `trip_departures` CTE (G3), `closed_trips(org, period, grain)` CTE with `bucket_start` (G4), `trip_steps` with previous-step columns (LAG over `sequence_number`, G15), `problems` filter (G10) |
| `backend/app/analytics/fleet/tiles.py`, `activity.py`, `patterns.py`, `on_time.py`, `problems.py`, `review.py`, `evidence.py`, `routes.py` | one async query module per endpoint; each returns the schema models |
| `backend/app/schemas/fleet_analytics.py` | all response models (§6) |
| `backend/app/orchestration/fleet_analytics_service.py` | resolves "All time" start (G11), validates the period (raises `ValueError`), calls the query modules, attaches precinct names (by id only, G16 — write a small helper here rather than importing the private `_precinct_names`) |
| `backend/app/api/v1/endpoints/fleet_analytics.py` | `router = APIRouter(prefix="/fleet", tags=["analytics"])`, thin endpoints |
| `backend/app/api/v1/endpoints/analytics.py` | **one line added at the bottom:** `router.include_router(fleet_analytics.router)` — so `main.py` (a shared file) is **not** touched |

Rules: SQLAlchemy 2.0 Core `select()` with typed columns — no raw SQL strings (house style, see `app/analytics/views.py`
docstring). Select columns, never ORM entities (identity-map note in `rollup.py`). All `async def`. No
`app/analytics/fleet` module imports from `orchestration/` or `api/`.

### 7.2 Frontend files

| File | Purpose |
|---|---|
| `frontend/shared/lib/types/fleet-analytics.ts` | TS mirror of §6 (next to the existing `analytics.ts`; same header style: rates are `number \| null`, never re-derived) |
| `frontend/dispatcher/lib/format/period.ts` (+ `.test.ts`) | pure SAST date helpers: `todaySast()`, preset → `{start, end}`, `bucketCount(period, grain)` (same algorithm as backend), bucket labels ("w/c 8 Sep", "Sep 2026", "2026"), `fmtMinutes` ("1 h 20 min"), `fmtAge` ("2 d"). Reuse `lib/format/month.ts` / `lib/format/analytics.ts` helpers where they already exist |
| `frontend/dispatcher/lib/charts/palette.ts` | the validated colour constants in §7.3, each with its validation note |
| `frontend/dispatcher/lib/hooks/useFleetAnalytics.ts` (+ test) | `useFleetQuery<T>(path)` modelled on `useAnalyticsList` (generation counter, drops stale replies) **but** keeps the previous data while refetching (`isRefreshing`) and clears it on error; one typed wrapper per endpoint |
| `frontend/dispatcher/components/analytics/fleet/FleetTiles.tsx` | the six tiles (new `FleetTile`; do **not** modify `components/ui/StatCard.tsx`) |
| `…/fleet/controls/PeriodControl.tsx`, `GrainToggle.tsx`, `EventSwitch.tsx` | controls; toggles are radio groups (`role="radiogroup"`), not `Tabs` |
| `…/fleet/ChartCard.tsx` | title, question subtitle, "based on N …" line, legend, body, **Show table** toggle (uses `components/ui/DataTable.tsx`), empty / low-sample / error / refreshing states |
| `…/fleet/charts/*.tsx` | `TrendColumns`, `TrendLines`, `CategoryBars`, `DivergingColumns`, `PatternStrip`, `LaneScatter` — thin Recharts wrappers applying §7.4 |
| `…/fleet/tabs/ActivityTab.tsx`, `OnTimeTab.tsx`, `ProblemsTab.tsx`, `ReviewDeskTab.tsx`, `EvidenceTab.tsx`, `RoutesTab.tsx` | one per tab; each owns its fetch |
| `…/fleet/map/IncidentMap.tsx` | follows `components/map/GeofenceMap.tsx` exactly: `'use client'`, static `import 'leaflet/dist/leaflet.css'`, Leaflet JS loaded dynamically inside `useEffect`, tiles from `lib/map/tiles.ts` |
| `…/fleet/copy.ts` | all user-facing strings in this spec (dispatcher-only, like `components/analytics/copy.ts`) |
| `frontend/dispatcher/app/(app)/analytics/page.tsx` | rewritten: TopBar, `FleetTiles`, `Tabs` (existing component, `panelId`), active tab; tab in `?tab=` via `useSearchParams` — **wrap the client body in `<Suspense>`** or `npm run build` fails in Next 15 |
| `frontend/dispatcher/vitest.setup.ts` | add a no-op `ResizeObserver` stub (jsdom lacks it; Recharts' `ResponsiveContainer` needs it) |

### 7.3 Colours (validated 2026-09-15 with the dataviz skill's `validate_palette.js`, light mode, surface `#ffffff` — the dispatcher has no dark mode)

| Role | Hex | Use | Validation |
|---|---|---|---|
| Series slot 1 | `#2a78d6` | default single series; loaded; departures; pickups; under plan | slots 1–3 pass adjacent **and** all-pairs (CVD ΔE 9.2, normal 24.0) |
| Series slot 2 | `#eb6834` | empty runs; arrivals; deliveries; over plan | ″ (slot 1 vs 2: CVD 24.7) |
| Series slot 3 | `#1baf7a` | 3rd series | contrast 2.82 → needs legend + table view (always present) |
| Slots 4, 5 | `#eda100`, `#e87ba4` | only the 5-slice "where the time goes" stack | 5 adjacent pass (worst CVD 9.1); sub-3:1 → legend + table view |
| Neutral | `#898781` | de-emphasised bars, Early/On time, unwitnessed | contrast 3.59 |
| Warning | `#ffb95f` (app `warn-c`) | warning severity | vs critical: CVD 32.4, normal 35.4; 1.7:1 contrast → **always icon + label** |
| Critical | `#ba1a1a` (app `err`) | critical severity, tracker mismatch | text contrast 6.46 |
| Good | `#006c4c` (app `ok`) | tracker confirmed | vs grey CVD 12.6; never adjacent to critical |
| Lateness ramp | `#86b6ef`, `#3987e5`, `#1c5cab`, `#0d366b` | 1–15, 15–60, 1–3 h, 3 h+ | `--ordinal` pass (monotone, ΔL ≥ 0.06, light end 2.11:1) |
| Lane pair | `#3987e5` typical, `#0d366b` bad day | 2.4 | members of the validated ramp |
| Grid / axis text | `#e5e2e3` (`surf-high`) / `#46464f` (`on-surf-v`) | hairline grid, axis labels | — |

**Never** use `#805600` and `#ba1a1a` as neighbours (D18). Text never wears a series colour.

### 7.4 Chart rules (dataviz skill — apply to every chart)

- One y-axis only; never dual axis. Grid: `CartesianGrid vertical={false}`, solid hairline `#e5e2e3` (no dash).
- Bars: `maxBarSize={24}`, rounded data end `radius={[4, 4, 0, 0]}` (only the top segment of a stack), 2 px white gap
  between stacked segments and adjacent bars (`stroke="#ffffff" strokeWidth={2}`).
- Lines: 2 px, dots r = 4 with a 2 px white ring. Partial buckets: drawn at 50 % opacity and labelled "part week"
  / "part month" / "so far" (never a dashed line — dashes read as a forecast).
- Legend always for ≥ 2 series (none for one — the title names it); direct-label selectively (last point / largest
  bar), never every point.
- Tooltip on every chart: value first and bold, series name second, short line key; crosshair on line charts; the same
  content on keyboard focus (Recharts 3 `accessibilityLayer` is on by default — keep it).
- Every chart has a **Show table** twin (all values reachable without hover).
- Container height includes the axis band (no nested scroll). Use `ResponsiveContainer width="100%" height={240}`
  (pattern strip 160 each).
- Numbers: `tabular-nums` only on axes and tables, not on tile values.

### 7.5 Tile component

Label (sentence case) · value (semibold, proportional figures) · one sub-line · whole tile is a link
(`next/link`) with a visible focus ring. Warning state = warn colour + icon, never colour alone.

### 7.6 States (every chart card)

| State | Behaviour |
|---|---|
| First load | `components/ui/Skeleton.tsx` in the card's shape |
| Refetch (period/grain changed) | keep the previous chart at 50 % opacity, `aria-busy="true"`, no layout jump |
| Error | message + Retry (refetch only that tab's query) — never leave stale numbers under a new period |
| No observations | `components/ui/EmptyState.tsx`: title "Not enough data yet", body specific to the chart (e.g. "No closed trips departed in this period.") |
| Low sample | chart renders, plus the line "Based on only N trips — read with care" when N < `LOW_SAMPLE_TRIPS = 5` (constant in `period.ts` or `copy.ts`) |

### 7.7 Chart card look — Tom's review of Stage 2 (2026-09-15), applies to every chart (D22)

**1. Info button instead of the question and basis lines.**
- The title stays where it is. Immediately to its right sits a small info button: lucide-react's `Info` icon, 14 px,
  `text-on-surf-v`, hover `text-on-surf`. lucide-react is already a dependency (`DateRangePicker` uses it);
  `components/ui/Ic.tsx` has no info icon.
- Clicking toggles a popover anchored under the button with two lines: the chart's **question**
  (`text-[13px] font-[600] text-on-surf`, e.g. "Are we getting busier?") and its **basis**
  (`text-[12px] text-on-surf-v`, e.g. "Closed trips, by the day they first departed · 16 trips").
  Neither line is printed on the card face any more.
- Behaviour: `aria-label="About this chart: <title>"`, `aria-expanded`, `aria-controls` pointing at the popover.
  It closes on a second click, on **Escape** (focus returns to the button) and on a click outside. Styling: white
  surface, `rounded-lg`, `shadow-level-5`, `p-3`, `max-w-[280px]`, `z-[10]` (the same layer as `DateRangePicker`'s
  popover).
- Build it once as `components/analytics/fleet/InfoPopover.tsx` and use it inside `ChartCard`. No chart builds its own.
- **The low-sample warning stays on the card face** ("Based on only N trips — read with care"). It is a warning,
  not a description, and must be seen without clicking.

**2. A y-axis heading on every chart.**
- Every chart wrapper (`TrendColumns`, `TrendLines`, `PatternStrip`, and later `CategoryBars`, `DivergingColumns`,
  `LaneScatter`) takes a **required** `yLabel: string`. It is drawn rotated −90° along the value axis
  (Recharts `YAxis label={{ value, angle: -90, position: 'insideLeft' }}`) in the axis text style. Widen
  `Y_AXIS_WIDTH` in `charts/chartStyle.ts` so it never overlaps the tick numbers.
- Horizontal bar charts put the heading on their value axis (the x-axis) instead.
- The wording lives in `fleet/copy.ts`:

| Chart | Axis heading |
|---|---|
| 1.1 Trips over time | Trips |
| 1.7 Cancellations | Cancelled trips |
| 1.3 Busy patterns (each of the four) | Avg per day |
| 2.1 On-time departures and arrivals | % on time |
| 2.2 How late is late | Trips |
| 2.3 Where the time goes | removed (D24) |
| 2.5 Plans vs reality | Trips, written level above the middle axis (D24) |
| 3.1 Problems over time | Problems (D25) |
| 3.2 Theft warning signs | Theft signs |
| 3.3 Most common problems / 3.4 Where in the trip | Problems |
| 3.5 Risky times of day | % of total |
| 4.1 Waiting now / 4.2 Is the pile growing | Problems waiting |
| 4.3 Time to review | Hours |
| 4.4 What reviews concluded | none: a donut; the total is in its centre (D25) |
| 5.1 Tracker agreement | Checks |
| 5.2 Overrides | % of steps overridden |
| 5.4 Blockchain receipts | removed (D25) |
| 5.7 Receiver sign-off | % scanned by receiver |
| 1.6 Busiest sites | Pickups and deliveries |
| 2.4 Driving time per lane | Minutes |
| 6.3 Lane risk | y: Problems per trip · x: Trips on the lane |

**3. Week labels show the Monday–Sunday range instead of "w/c".**
- The axis tick, from `fmtBucketLabel(start, 'week')` in `lib/format/period.ts`, reads **"7–13 Sep"** within one
  month, **"29 Jun–5 Jul"** across two months and **"29 Dec–4 Jan"** across a year end. The tick never shows the year.
- The tooltip header and the table view show the full range with the year: "29 Jun – 5 Jul 2026",
  "29 Dec 2025 – 4 Jan 2026". Use an en dash (–).
- Month ("Sep 2026") and year ("2026") labels are unchanged. Partial buckets keep their existing "part week" /
  "so far" wording.
- Labels stay on **one line** ("13–19 Jul") — Tom's choice. Never rotate or shrink the text: the tooltip carries the
  full range. How every bucket stays visible is item 4.

**4. Every bucket is visible on the axis (D23).**
- A small tick mark sits under **every** bucket, labelled or not, so every dot and bar visibly belongs to a week,
  month or year.
- When not every label fits, label every *n*-th bucket counting back from the **newest**. The newest bucket is always
  labelled, directly under its point. *n* is the smallest step at which labels don't collide, worked out from the
  rendered chart width and the label width (both named constants in `chartStyle.ts`). Put it in a pure helper,
  e.g. `labelStep(bucketCount, plotWidth)`, so it can be unit-tested.
- Replace Recharts' `interval="preserveStartEnd"`: it spaces labels unevenly and shifts the end label off its
  point. That is why the 3–9 Aug dot looked misplaced in Tom's review.
- Give the chart enough left and right margin that the first and last labels are centred under their points, never
  pushed inward.
- Applies to every chart with a time axis (`TrendColumns`, `TrendLines`).

**5. Card header: one row, no captions (D23).**
- The title and its "i" sit on the left. Any card control (the Departures | Arrivals switch, "Show all") sits on the
  right, followed by "Show table". All of them are vertically centred on one row.
- No caption above a control: remove the grey "SHOW" label. The control keeps an accessible name instead (e.g.
  `aria-label="Show departures or arrivals"`).
- The row may wrap under the title only when the card is too narrow.

**6. The "Faded…" note goes behind the "i" (D23).**
- "Faded: a part week, month or year at either end of the period, or one still running" becomes the last line of the
  info popover on every card that can show a partial bucket. It no longer appears in the legend row.
- The faded styling itself is unchanged.

**Tests.**
- `labelStep`: the newest bucket is always labelled; step 1 when everything fits; labels never closer than the
  minimum gap.
- `ChartCard`: the "Faded…" line is in the popover, not on the card face. The header has no "Show" caption, and
  the switch has an accessible name.
- Plan spread (D24):
  - the band edges at 0, 15, 16, 60, 61, 180 and 181 minutes either side
  - the bands add up to the trips with a full plan
  - "Trips" above the middle axis, "On plan · N trips" under it
  - no summary on the card face; in the table view it uses positive minutes
  - the On time response has no `time_steps`
- Existing look-pass tests:
- `period.test.ts`: week label within a month, across months, across a year end, and the full form with years.
- `ChartCard.test.tsx`:
  - the popover is closed by default (the question is not visible)
  - clicking shows the question and basis
  - Escape closes it and returns focus to the button
  - a click outside closes it
  - the low-sample warning is visible without opening it
- Chart wrappers: `yLabel` is required by the types. Don't assert SVG geometry, because jsdom draws at zero size.

---

## 8. Tests required

Backend (Arrange / Act / Assert, `uuid4()` ids, no hardcoded timestamps — derive from "now", no inter-test state;
`asyncio_mode = auto`):

- `backend/tests/unit/test_fleet_periods.py` — buckets (week starts Monday, month/year edges, `is_partial` for first,
  last and current bucket), SAST conversion (an event at 23:30 UTC lands on the **next** SAST day), per-occurrence day
  counts (31st only divided by months with a 31st; 5 Mondays vs 4 Sundays), bucket-count cap, All-time resolution.
- `backend/tests/unit/test_fleet_calculations.py` — lateness banding at every edge (−15, 0, 15, 60, 180), driving-minute
  block splitting across midnight and across two blocks, queue reconstruction (created before / reviewed after bucket
  end), expiry bands (expired, exactly 30, 31, 90, 91, 180, 181, none), age bands.
- `backend/tests/integration/_fleet_seed.py` — seeding helpers (operator, trips with full phase ledgers, exceptions,
  handovers), copied in spirit from `tests/integration/test_analytics_endpoints.py` (`_seed_trip`, `_Operator`,
  `_start`, SAST offset from settings). Not a test file; the fleet test files import it.
- `backend/tests/integration/test_fleet_<endpoint>.py`, one per endpoint, each covering: 403 without token, 401
  malformed token, 403 driver token, 422 cases, success with **hand-computed** expected numbers, **another operator's
  trips never counted**, `dispatcher_note` excluded (where problems are counted), overridden steps excluded (where
  timings / tracker are measured), empty org returns zero-filled buckets. The new endpoints read base tables, so they
  need **no** `views` fixture.
- Consistency test (Stage 3): for one seeded month, `/fleet/on-time` monthly departures-with-plan and on-time counts
  equal the sums from `/analytics/drivers` for the same month.

Frontend (vitest + Testing Library; test visible text and table-view values, not SVG geometry):

- `lib/format/period.test.ts` — presets in SAST, bucket counts match the backend's algorithm, labels.
- `lib/hooks/useFleetAnalytics.test.tsx` — refetch keeps previous data, error clears, stale reply dropped.
- Each tab: loading, empty state, low-sample note, table view shows the numbers from a mocked response, controls change
  the request path.
- `FleetTiles.test.tsx` — values, links (`/`, `/exceptions`, `?tab=evidence`, fleet pages), warn state has an icon.
- `app/(app)/analytics/page.test.tsx` — tabs switch, only the active tab's endpoint is requested, `?tab=` deep link.
- `IncidentMap` — table twin lists pins; no driver name appears anywhere in the rendered output.

Commands (copy exactly — these are CI's, from `.github/workflows/ci.yml`):

```bash
cd backend && source .venv/bin/activate && ruff check . && mypy . && pytest -m "not slow"
```

```bash
cd frontend/dispatcher && npm run lint && npm run type-check && npm test && npm run build
```

`mypy .` includes the tests. The backend suite uses one **shared local** test database: never run two pytest processes
at once (another Claude session or the project's Stop hook `.claude/hooks/test-summary.sh` may be running unit tests).
A sudden wall of `relation "organizations" does not exist` errors is interference, not a regression — rerun alone.

---

## 9. Stages

Every stage: PLAN block → build → run that stage's tests → browser check → TASK COMPLETE → **STOP for Tom**.
Browser check setup (Tom's local workflow): Redis in Docker; Terminal 1
`cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000`; Terminal 2
`cd frontend/dispatcher && npm run dev` → <http://localhost:3000/analytics>, signed in as a dispatcher. Use the
in-app Browser pane for screenshots.

### Stage 0 — Baseline (no code)

- **Goal:** know the starting point. **Where:** nothing changes.
- **Verify:** `git branch --show-current` prints `feature/fleet-analytics-page`; run both CI command blocks in §8;
  record pass counts in §14. If anything already fails, report it to Tom before Stage 1 — don't fix unrelated
  failures.
- **Fence:** no file edits.

### Stage 1 — Walking skeleton: periods, tiles, page frame

1. **Periods + constants (backend, pure).** Goal: `constants.py`, `periods.py`, and their unit tests.
   Where: §7.1 files + `tests/unit/test_fleet_periods.py`, `test_fleet_calculations.py`.
   Verify: `pytest tests/unit/test_fleet_periods.py tests/unit/test_fleet_calculations.py -q` green.
   Fence: no DB code yet; no endpoint.
2. **Tiles endpoint.** Goal: `GET /analytics/fleet/tiles` per §5.0/§6. Where: `base.py`, `tiles.py`,
   `schemas/fleet_analytics.py`, `fleet_analytics_service.py`, `endpoints/fleet_analytics.py`, the one-line include in
   `endpoints/analytics.py`, `tests/integration/_fleet_seed.py`, `test_fleet_tiles.py`.
   Verify: `pytest tests/integration/test_fleet_tiles.py -q` green; `http://localhost:8000/docs` lists the route.
   Fence: `main.py` untouched; no other endpoint.
3. **Page frame.** Goal: new page with tiles row, six tabs (each showing its control row and a plain "This tab is
   built in Stage N" placeholder), `?tab=` deep links, palette file, ResizeObserver stub, `ChartCard` shell,
   `PeriodControl`, `GrainToggle`. Old page content removed from `page.tsx` (old panel files stay until Stage 8).
   Where: §7.2 files. Verify: vitest for `period.ts`, hook, tiles, page; `npm run build` passes; browser shows six
   real tiles and the tabs.
   Fence: don't delete old panel files or hooks yet; don't touch the home page.

### Stage 2 — Activity tab (1.1, 1.7, 1.3)

- Backend: `activity.py`, `patterns.py`, schemas, service, endpoints, `test_fleet_activity.py`, `test_fleet_patterns.py`.
- Frontend: `ActivityTab.tsx`, `TrendColumns`, `TrendLines`, `PatternStrip`, `EventSwitch`, tests.
- Verify: those tests green; browser: change View by and Period, pattern Period independent, Departures/Arrivals switch
  doesn't refetch (Network tab shows no request), partial bucket faded, table views match tooltips.
- Tell Tom (plainly): trips are grouped by **departure date**, not completion date (D8), and why; cancellation notes
  are reached through the trip link in the table (D20).
- Fence: no other tab.

### Stage 3 — On time tab (2.1, 2.2, 2.3, 2.5)

- Backend: `on_time.py` + `test_fleet_on_time.py` (including the consistency test in §8 and the Early + On time = 2.1
  on-time invariant). Frontend: `OnTimeTab.tsx`, `DivergingColumns`, tests.
- Verify: tests green; browser: two lines with legend, lateness buckets with grey + ramp, five-slice stack with the
  sign-off caveat visible, diverging over/under columns.
- Fence: don't change FP-153 views or `/analytics/drivers`.

### Stage 4 — Problems tab (3.1–3.5)

- Backend: `problems.py` + `test_fleet_problems.py` (assert `dispatcher_note` and other operators excluded; theft
  types exactly D12; `seal_unverified` not a theft sign). Frontend: `ProblemsTab.tsx`, `CategoryBars`, tests.
- Verify: tests green; browser: warning/critical stack uses `#ffb95f`/`#ba1a1a` with icons; tab note about dispatcher
  notes visible.
- Tell Tom: 3.5 compares driving time with problems raised *while driving*, not critical-only (D21), and why.
- Fence: no change to exception creation code.

### Stage 5 — Review desk tab (4.1–4.4)

- Backend: `review.py` + `test_fleet_review.py` (legacy_review excluded; queue reconstruction across a bucket edge;
  review of another operator's exception never counted). Frontend: `ReviewDeskTab.tsx`, tests.
- Verify: tests green; browser: age bars link to `/exceptions`; median vs mean in tooltip.
- Fence: no change to the review workflow or the Exceptions page.

### Stage 6 — Evidence tab (5.1, 5.2, 5.4, 5.7)

- Backend: `evidence.py` + `test_fleet_evidence.py` (in_transit and overridden rows excluded from tracker; future
  pending plan steps not counted as owed; rejected attempts scoped to the org). Frontend: `EvidenceTab.tsx`, tests.
- Verify: tests green; browser: tracker stack order confirmed · unwitnessed · mismatch; receipts bars + overridden line.
- Fence: no change to anchoring code (Chiko's FP-154 touches it — R6).

### Stage 7 — Routes & sites tab (1.6, 2.4, 6.3, 3.6)

- Backend: `routes.py` (sites, lanes) + incidents query; `test_fleet_routes.py`, `test_fleet_incidents.py` (pins carry
  no driver fields — assert the response keys exactly; `dispatcher_note` excluded; `unlocated_count` correct).
- Frontend: `RoutesTab.tsx`, `LaneScatter`, `IncidentMap.tsx`, tests.
- Verify: tests green; browser: top-10 sites with "Show all", lane bars with "too few trips" fading, scatter hover,
  map pins with legend, pin click opens the exception, table twin under the map.
- Fence: no driver-app changes (the teammate owns GPS capture); no new npm packages.

### Stage 8 — Clean-up, home page, full checks

1. Delete `components/analytics/{DriverPanel,FacilityPanel,LanePanel,VehiclePanel}.tsx` and their tests; remove
   `useLaneAnalytics` and its test cases from `lib/hooks/useAnalytics.ts(.test.tsx)`; remove `ANALYTICS_COPY` keys no
   longer referenced (grep each key first — the detail-page summaries still use several). **Keep**
   `VehicleAnalyticsSummary`, `DriverAnalyticsSummary`, `PrecinctAnalyticsSummary`, `SummaryParts`,
   `MonthRangePicker` and the other hooks — the detail pages use them.
   Verify: `grep -rn "DriverPanel\|FacilityPanel\|LanePanel\|VehiclePanel\|useLaneAnalytics" frontend/dispatcher --include='*.ts*'`
   (excluding `node_modules`, `.next`) returns nothing.
2. Home page (D15; Tom has told Ciaran): in `app/(app)/page.tsx` remove the stat strip (Active trips, Completed
   today, On-time rate (30d)) and the now-unused `closedTrips`, `completedCount`, `onTimePercent` memos and imports.
   Leave everything else on that page exactly as it is. Verify: page renders, active-trips table unchanged.
3. Run the full CI blocks in §8; fill §14; list shared-file changes (`frontend/shared/lib/types/fleet-analytics.ts` —
   new file; `endpoints/analytics.py` one-line include; `vitest.setup.ts` stub). TASK COMPLETE with the suggested
   commit message: `feat(dispatcher): fleet-wide analytics page with trends, tiles and incident map`.
   Fence: no backend endpoint removals (D17).

---

## 10. Risks and tripwires

| # | Risk | Early warning | Fallback |
|---|---|---|---|
| R1 | Sparse real data makes charts look broken. | Stage 2 browser check shows 1–2 non-empty buckets. | Expected (D6). Make sure empty/low-sample states read well; never add seed data. |
| R2 | Recharts draws nothing in jsdom. | First chart test finds no content. | ResizeObserver stub (§7.2) and assert on the table view / text, not SVG. |
| R3 | A live query is slow. | An endpoint takes > 1 s in the browser Network tab against the shared DB. | Run `EXPLAIN ANALYZE` on it and report to Tom. **Do not** add an index or view without Tom's OK (it would need a migration). |
| R4 | Time-zone slip (charts shifted 2 h / wrong day). | The 23:30 UTC unit test fails, or the hour-of-day chart peaks two hours early. | All bucketing through `periods.py` / `base.py` helpers only. |
| R5 | Fleet numbers drift from detail pages. | The Stage 3 consistency test fails. | Re-read G2–G4 against the migration's CTEs; fix the query, not the test. |
| R6 | Teammates change files this build reads. Chiko's `origin/Chiko` (FP-154) changes anchoring and `tasks/`; a teammate is adding GPS to exception reports (`exception_service`, driver app); Ciaran owns the home page. | Rule 4 in §1 shows `dev` changed one of: `phase_service.py`, `exception_service.py`, `tasks/blockchain.py`, `app/(app)/page.tsx`, any model file. | Stop and tell Tom; he decides on merging `dev` in. Never merge/rebase yourself. |
| R7 | `npm run build` fails on `useSearchParams`. | Build error mentioning a Suspense boundary. | Wrap the page body in `<Suspense>`. |
| R8 | Leaflet touches `window` during server render. | Build/SSR error `window is not defined`. | Load Leaflet JS dynamically in `useEffect`, exactly like `GeofenceMap.tsx`. |
| R9 | Scope creep into "respond" features (alerts, rerouting). | Any urge to add actions beyond links. | FreightProof records, it doesn't respond (`CLAUDE.md` domain rule). Links only. |

---

## 11. Out of scope

Migrations or new views · seed/demo data · driver-app changes (GPS on every report — teammate's work) · any change to
FP-153 views, `/analytics/*` endpoints or the detail-page summaries · the SLA page (a stub — decide separately) ·
`DateRangePicker` changes · new npm or pip dependencies · driver or dispatcher rankings · parked items 1.4 and 6.1 ·
alerting, notifications, or any action that responds to a problem.

---

## 12. Open dependencies (not blockers)

- **GPS on every driver report** — a teammate is building it. The map shows panic pins until then; nothing to change
  when it lands.
- **FP-154 (Chiko) anchoring + recovery** — changes how quickly `pending`/`failed` clear; the receipts chart reads
  whatever `anchor_status` says.
- **Home page tile removal** — Tom has told Ciaran; done in Stage 8 as a separate, minimal edit.

### Handle at merge time (recorded 2026-09-15, after Stage 1)

Tom merges `dev` into this branch only once the whole feature is built. `dev` has already moved on with the changes
below. Don't stop for R6 at each stage because of these; only stop if something on this branch breaks.

- **FP-154 anchoring and recovery (Chiko)** is now on `dev`. The Receipts owed tile and chart 5.4 read `anchor_status`
  either way. After merging, re-run `test_fleet_tiles.py` and the Stage 6 evidence tests.
- **Receiver identity verification**, with migration `tim_add_receiver_verification`. Check that the migration chain
  still has one head after the merge (this branch adds no migration). Also check whether chart 5.7 (receiver
  sign-off) should count a verified receiver differently.
- **New exception types `receiver_id_mismatch` and `receiver_id_unverified`.**
  - Adding `receiver_id_mismatch` to `THEFT_SIGNAL_TYPES` (`backend/app/analytics/fleet/constants.py`) is a
    candidate: it means the person who signed was not the expected receiver. Tom to decide.
  - `receiver_id_unverified` is the analogue of `seal_unverified` (a check that couldn't run), so by D12's
    reasoning it is probably not a theft sign.
  - Both need labels in `lib/format/exception.ts` if that file doesn't already cover them on `dev`.
  - Charts 3.3 and 3.4 pick them up automatically, because they list every type with a count above zero.
- **Model tidy-up on `dev` (seen 2026-09-15, before Stage 3)**: commits `31dc4a0`, `c928125` and `970749b` edit
  `db/models/{blockchain,events,handover,transit,trips,vehicles}.py` and add migration
  `tim_close_blockchain_receipt_fk_drift` (Alembic autogenerate drift fix). This branch reads those models but
  never edits them. After merging, re-run the whole backend suite. If a column the fleet queries read was
  renamed, the fleet tests will fail on it.

---

## 13. Research notes (why these KPIs)

- Exception rate is described as a leading indicator in dispatch analytics — rising exception rates tend to precede
  falling on-time performance ([Locus](https://locus.sh/blogs/dispatch-management-platform-performance-analytics/)) →
  3.1 is the Problems tab's anchor chart.
- Dispatcher KPI guides centre on on-time pickup/delivery and time at facilities
  ([FreightWaves](https://www.freightwaves.com/news/the-kpi-breakdown-every-dispatcher-should-know),
  [NetSuite](https://www.netsuite.com/portal/resource/articles/inventory-management/logistics-kpis-metrics.shtml)) →
  2.1 and 2.3. Precinct dwell was deliberately dropped in FP-153, so 2.3 measures step gaps, not facility dwell.
- Delivery disputes hinge on an intact chain of custody and independent POD capture
  ([Parcel Tracker](https://www.parceltracker.com/post/proof-of-delivery-pod-methods-benefits-and-preventing-disputes),
  [PlanLogi](https://planlogi.com/proof-of-delivery)) → the Evidence tab (tracker agreement, overrides, receipts,
  receiver sign-off).
- TAPA's trucking security requirements focus on sealing, route control and incident reporting
  ([Inbound Logistics](https://www.inboundlogistics.com/articles/tapa-standards-safeguard-cargo/)) → 3.2 theft signs
  and 3.6 incident map. No public per-100-trips benchmark was found, so the page shows trends, not targets.

---

## 14. Progress

| Stage | Status | Tests (backend / dispatcher) | Notes |
|---|---|---|---|
| 0 Baseline | DONE 2026-09-15 (awaiting Tom's sign-off) | 1459 passed, 4 skipped, 0 failed / 760 passed (73 files) | ruff + `mypy .` clean (291 files); eslint 0 errors, 2 existing `<img>` warnings in `EvidencePhoto.tsx`; type-check clean; `npm run build` passes. `dev` had nothing new. CI on `dev` is red with 34 known Hedera-config failures (CI has no `HEDERA_TOPIC_ID`); they all pass locally. |
| 1 Skeleton + tiles | DONE 2026-09-15 (Tom checked in the browser and signed off) | 1539 passed, 4 skipped, 0 failed / 821 passed (80 files); lint 0 errors, build passes | Deviations: (1) tiles response gains `all_time_start` (Tom OK'd; §6 updated). (2) Chart colours live in `frontend/dispatcher/lib/tokens.ts`, not `lib/charts/palette.ts`: eslint's no-raw-hex rule exempts only `lib/tokens.ts`. (3) `base.py` holds only the departures + closed-trip builders; the step-gap and problem builders arrive with the stages that first use them. (4) `MONTH_ABBREVIATIONS` exported from `lib/format/month.ts` for reuse. (5) Grain fitting is derived, not stored: a shorter period brings the dispatcher's own grain back. `resolveTabQuery` in `period.ts` is what tabs use from Stage 2. |
| 2 Activity | DONE 2026-09-15 (Tom signed off). Then the §7.7 chart-card look pass (D22) was built the same day; Tom's browser check of it is pending | 1567 passed, 4 skipped, 0 failed (backend unchanged by the look pass) / 854 passed (82 files); lint 0 errors; `npm run build` passes | Look pass: `InfoPopover` in `ChartCard`; a required `yLabel` on `TrendColumns`, `TrendLines` and `PatternStrip` (`Y_AXIS_WIDTH` 36 → 56, `yAxisHeading` in `chartStyle.ts`); `fmtBucketLabel` week → "7–13 Sep", new `fmtBucketRange` ("7–13 Sep 2026", "29 Jun – 5 Jul 2026") for tooltips and tables. **Addition to §7.7:** `ChartCard` gained a `caveat` line on the card face, because the month chart's "Needs a full year of history…" note was in its basis and would otherwise have moved behind the "i". Within one month the full form is "7–13 Sep 2026" (unspaced dash). Earlier Stage 2 notes: | Pattern charts' own control is labelled "Pattern period". The cancellations table shows the per-bucket counts and, under them, the cancelled-trip list with links (D20). Faded partial buckets are explained in a legend note; "so far" / "part week" appear in tooltips and tables, not on the axis. The busiest pattern bar is the highest average (earliest on a tie). `RadioToggle` is shared by View by and Departures/Arrivals. Chart geometry lives in `charts/chartStyle.ts`. An All-time trend request waits for the tiles' `all_time_start`. |
| 3 On time | DONE 2026-09-15 (built in the Stages 3–7 run; Tom's browser check at the end) | fleet backend 119 passed incl. the §8 consistency test against `/analytics/drivers` and the Early + On time invariant; ruff + `mypy .` clean / fleet vitest 103 passed; lint 0 errors | One per-trip query and one step-gap query (`base.trip_steps`, LAG over the whole plan), aggregated in pure functions. Captions (2.1, 2.5) are a third line in the "i" popover (`ChartCard note`); the 2.3 sign-off caveat is on the card face (`caveat`). 2.2's Departures/Arrivals switch sits in a new always-visible `ChartCard controls` slot. 2.5 medians are positive minutes on both sides. New shared wrappers: `CategoryBars` (columns/bars, stacked or side by side) and `DivergingColumns`; fleet helpers in `fleet/format.ts`. |
| 4 Problems | DONE 2026-09-15 (Stages 3–7 run; Tom's browser check at the end) | fleet backend 133 passed; ruff + `mypy .` clean / fleet vitest 111 passed; lint 0 errors | Problems read once, with the linked step (outer join); `dispatcher_note` excluded once via `EXCLUDED_FROM_PROBLEMS`. `by_step` returns every step, zeros included (the page hides trip creation and activation at zero). `by_type` ties sort by type name. The 3.5 shares are divided once in the builder; `periods.day_block` added. Warning/critical legend keys carry icons (`ChartLegend icon`). The D21 caveat sits above the 3.5 table; its caption is in the popover. |
| 5 Review desk | DONE 2026-09-15 (Stages 3–7 run; Tom's browser check at the end) | fleet backend 142 passed; ruff + `mypy .` clean / fleet vitest 117 passed; lint 0 errors | The queue is rebuilt in Python from the organisation's critical (created_at, reviewed_at) pairs, whole history, `legacy_review` excluded, each bucket measured at min(bucket end, period end, now). Outcomes list all five real outcomes in enum order, zeros included. Tab note: the tab covers open and closed trips alike (unlike the rest of the page). "Waiting now" and the queue draw zeros instead of the "not enough data" state. |
| 6 Evidence | DONE 2026-09-15 (Stages 3–7 run; Tom's browser check at the end) | fleet backend 151 passed; ruff + `mypy .` clean / fleet vitest 123 passed; lint 0 errors | Tracker = the facility view's definition (attested stop steps, in_transit and overridden out). Override share over every closed-trip step (the driver view's denominator). Receipts over any trip status by step `completed_at`, with `ANCHORED_PHASES` passed in by the service; overridden steps reported as a line on the card, not a bar. Same-phone = confirmations in the period with `bearer_token_present`; rejected attempts joined to the organisation's trips through `presented_trip_id`. `ChartLegend` icons became any node (lucide ✓/✗ for the tracker). |
| 7 Routes & sites | DONE 2026-09-15 (Stages 3–7 run; Tom's browser check at the end) | full §8 CI: backend 1624 passed, 4 skipped, 0 failed; ruff + `mypy .` clean (318 files) / dispatcher 892 passed (88 files); lint 0 errors; type-check clean; `npm run build` passes (`/analytics` 145 kB) | Sites: deliveries only on loaded trips; top 10 + "Show all". Lanes: DurationStats over pooled driving minutes, problems without dispatcher notes; lanes under 5 trips faded. Precinct names by id only in the service (G16). Incident pins carry exactly the §6 keys (tested: no driver fields). `IncidentMap` follows `GeofenceMap` (dynamic Leaflet, tile-failure tracking reused, street tiles, `isolate` so Leaflet panes can't cover the "i" popovers); popup built with textContent. Every tab is now built, so the page's "built in Stage N" placeholder was removed. |
| 3b On time rework (D23) | DONE 2026-09-15 (after Tom's browser review of On time; his browser check of the rework is pending) | on-time integration + fleet unit tests 102 passed; ruff + mypy clean on every changed file / dispatcher 904 passed (89 files), fleet 144; lint 0 errors; type-check clean; `npm run build` not run (Tom's dev server is up) | **Axis (every time-axis chart):** `charts/axisTicks.tsx` has `labelStep(bucketCount, plotWidth, labelWidth)` and `isLabelled` (every n-th bucket counting back from the newest). It is `.tsx` because it also renders the tick. Plot width is the `width` Recharts passes to the tick, so there is no extra measuring hook. Label width is estimated as characters × `AXIS_CHAR_WIDTH_PX` (6.2), and `AXIS_LABEL_GAP_PX` is 12. A tick mark sits under every bucket (`interval={0}`, new token `TICK_COLOR`). `preserveStartEnd` and `minTickGap` are gone from `TrendColumns` and `TrendLines`. `TIME_CHART_MARGIN` has a 32 px right margin, and `TrendLines` pads 16 px at each end, so end labels sit under their points. **Card header:** `RadioToggle showLabel={false}` names the group with `aria-label`; `EventSwitch` is "Show departures or arrivals" and has no caption. **Faded note:** `ChartCard timeAxis` adds it as the popover's last line (`InfoPopover footnote`); it is off every legend on every tab. **2.3:** `StepTiles` shows five tiles, `fmtDuration`, lucide up/down arrows with words, and a hand-drawn SVG sparkline that is decorative (values in the table) and breaks where a bucket has no gaps. The change is rounded to the minute, and shows "No change" when that rounds to 0 (the spec doesn't cover equal). **2.5:** `CategoryBars` columns in nine bands, a `ChartCard summary` line on the face, a three-key legend, and "← Finished early" / "Ran over →" under the axis. 2.3 and 2.5 span the full width. **Backend:** `periods.previous_period`, `PlanBand` and `plan_band`. `step_gaps` takes a window and an optional grain, and runs a second time for the previous period. `get_on_time(compare_previous=start is not None)`. `DivergingColumns.tsx` was deleted. |
| 3c Tab reviews (D25) | DONE 2026-09-15 (after Tom's browser review of Problems, Review desk, Evidence and Routes; his browser check of the changes is pending) | full suite 1771 passed, 4 skipped, 0 failed; `mypy .` clean; ruff's only error is the unused `sa` import in Tim's `2026_09_15_tim_close_blockchain_receipt_fk_drift.py` (not this branch's) / dispatcher 943 passed (90 files); lint 0 errors; type-check clean; `npm run build` passes (`/analytics` 154 kB) | **Backend:** `RECEIVER_ID_MISMATCH` in `THEFT_SIGNAL_TYPES`; `evidence.receipts()`, the `Receipts` schema and the `receipts` response field deleted. **Frontend:** `fmtExceptionType` writes "ID" in capitals. `ProblemsTab` 3.1 on counts. New `charts/DonutChart.tsx` (Recharts Pie, 58–82 % radii, clockwise from 12 o'clock, 2 px surface gap, centre label as an HTML overlay). `EvidenceTab`: `ReceiptsCard` deleted; the agreement line leads 5.1's basis; the flags line is 5.7's `note`. `LaneScatter` gained `pointLabel`, `cornerLabel` and mean-x / mean-y `ReferenceLine`s in `TICK_COLOR` (solid: dashes would read as a target); a name sits on the side of its dot away from the average. `IncidentMap` keeps a `Map` of markers by exception id and takes `selection` (`{id, seq}`: `seq` lets the same row fly back after the map was moved) and `returnTo`; selecting scrolls the map into view, `flyTo` at zoom ≥ 15, opens the popup on `moveend`. `IncidentsCard` is keyed by the period so a new period starts at 10 rows. `period.ts`: `PRESETS_BY_GRAIN`, `GENERAL_PRESETS`, `periodForGrain`, new presets. `PeriodControl` takes `presets`; `ControlRow` passes the list and applies `periodForGrain` on a View by change. New `fleet/navigation.ts` (`analyticsReturnHref`, `controlsFromSearch`, `hasReturnedControls`, shared `TAB_PARAM`); the return state lives in the address, not browser storage, so the server and browser draw the same first frame. **Follow-up (Tom's check):** 2.4's lane names were crammed (3-line names in 32 px rows, lines 1em apart), so `CategoryBars` gained `categoryAxisWidth`, `rowHeight` and `categoryGap` (defaults unchanged for every other chart) and draws category names with Recharts `Text` at `CATEGORY_LINE_HEIGHT` 1.3em; 2.4 uses a 280 px name column, 64 px rows and a 30 % gap between lanes. |
| 8 Clean-up + home | DONE 2026-09-15 (Tom's browser check pending) | full §8 CI: backend 1771 passed, 4 skipped, 0 failed; `mypy .` clean (334 files); ruff's only error is the unused `sa` import in Tim's `2026_09_15_tim_close_blockchain_receipt_fk_drift.py` / dispatcher 911 passed (86 files; −32 = the deleted panel tests and the lanes hook case); lint 0 errors (2 existing `<img>` warnings); type-check clean; `npm run build` **not run** (Tom's dev server was on :3000 and a build overwrites its `.next`; it passed at 154 kB after D25) | `{Driver,Facility,Lane,Vehicle}Panel.tsx` + tests deleted; `useLaneAnalytics` and its test row removed; `ANALYTICS_COPY.scopeNote`, `streaksNote`, `laneNote` removed (`confirmationDwellCaveat`, `trailerNote`, `facilityRateNote`, `empty` are still used). Comments in the three detail-page summaries that named the deleted panels were reworded, so the step-1 grep returns nothing. Home page: stat strip, `closedTrips`, `completedCount`, `onTimePercent` and the `StatCard` import removed; nothing else changed. `components/ui/StatCard.tsx` is now unused but kept (UI kit). Backend untouched (D17: `/analytics/lanes` etc. stay). Claude's `git fetch` cannot authenticate (no SSH key), so rule 4 used Tom's last fetch: `dev` had nothing new. |
