# FP-153 — Analytics Read Models — Build Spec

Author: Tom (Thomas Davis) · Written 2026-09-10, after extended metric-design review
Status: **IMPLEMENTED** (commit `e0cc8e4`, 2026-09-10). §1–§10 are the original spec; §11 is
the build record, the decisions that SUPERSEDE parts of §1–§10, and the FP-156 handoff.
Branch: `fp-153-analytics-read-models` (already exists, already rebased on current `dev`)

## How to use this document

This is a complete handoff spec, written so a fresh session with no memory of the design
conversation can implement FP-153 correctly on the first attempt. Every metric below was
derived from real sources (the Jira ticket, teammates' planning docs, meeting notes) and
then deliberately reworked through a long back-and-forth to fix gaps, remove invented
numbers, and make every rate mathematically correct across arbitrary date ranges. Nothing
here is a first draft — treat every decision as final unless you find a genuine
contradiction with the live codebase, in which case flag it rather than silently picking
a side.

Read this whole document before writing any code. Then follow CLAUDE.md's own
Read → Plan → Execute → Report workflow, producing a normal PLAN block before touching
files.

## 1. What FP-153 actually is

A pure backend read layer. Two tables already capture everything needed, as a side effect
of normal trip operation, with zero new instrumentation:

- `exceptions` (model: `TripException`, `app/db/models/transit.py`) — every anomaly, with
  type, source, severity, resolution state, and FKs to trip, phase event, checkpoint,
  consignment, stop.
- `phase_events` (model: `PhaseEvent`, `app/db/models/phases.py`) — one row per phase per
  trip, append-only, timestamped.

FP-153's job: build four materialized views (driver, vehicle, lane, facility grains) plus
one small incident-streak table, a Python read-model package to query them, a Celery beat
task to refresh them, and tests. **No API endpoint** — that's FP-156's job, a separate
ticket, out of scope here. No new evidence writes of any kind.

FP-156 (the dispatcher-facing analytics screen) depends entirely on what this ticket
produces — get the columns right here and FP-156 becomes pure UI work with no backend
changes needed. That's the whole reason this spec is this thorough.

## 2. Confirmed current repo state (verified 2026-09-10 — re-verify if much time has passed)

- Branch `fp-153-analytics-read-models` exists, created off `dev`, fully up to date with
  `dev` as of this session.
- Current Alembic head: **`ciaran_trip_history_page`**. Confirm this is still the head
  before autogenerating (`git fetch origin`, check `dev` for anything newer, per
  CLAUDE.md's Alembic-conflict protocol) — Ciaran/Tim/Chiko all commit frequently.
- **Ciaran's Pulsit corroboration work has landed** (`app/orchestration/corroboration_service.py`,
  `app/orchestration/geofence_service.py`, `app/integrations/pulsit.py`). This directly
  feeds the Facility grain — see §6 for the exact semantics, which are already correctly
  matched by this spec's design, plus one refinement (excluding `in_transit`) that this
  new code makes necessary.
- `Precinct`, `Trip.origin_precinct_id`/`destination_precinct_id`, and
  `TripStop.precinct_id` are all confirmed live and written (not dead columns) — safe to
  key Lane and Facility off them.
- `backend/.env.example` had real credentials accidentally pasted into it locally this
  session (a Supabase DB password, a Hedera private key, Twilio credentials, Parcel
  Perfect demo credentials). It has been reverted to safe placeholders and verified
  byte-identical to the committed baseline. **If those credentials were ever committed or
  pushed anywhere, rotate them regardless** — this note exists so nobody re-introduces
  them by copying an old local `.env` over the example file again.

## 3. Cross-cutting rules — apply these to every grain, no exceptions

These rules came out of working through real problems with a naive design. Do not
simplify past them without understanding why they're here.

1. **Every rate, percentage, or average is stored as its raw ingredients (a numerator and
   denominator count, or a sum and a count), never pre-divided.** Division happens once,
   at read time, after summing across however many months are in the requested range.
   Reason: averaging two months' pre-computed percentages together is mathematically
   wrong the moment the two months had different trip volumes — you must sum the raw
   counts first, then divide once, or the answer is silently incorrect.
2. **Every grain (except the one exception in §3a) is bucketed by month**, one row per
   (entity, month). This is not about performance — it's the only way "last 1/2/3/6/12/24
   months" filtering can work at all: it's just summing the relevant months' rows
   together. A single lifetime-aggregate row can never be un-summed back into "just last
   month," so the granular version is strictly more capable, not more complex for its own
   sake.
3. **Only CLOSED trips are counted, everywhere.** An in-progress trip's eventual exception
   count / duration isn't final yet — counting it would make a past month's numbers
   silently change later as the trip continues.
4. **Never invent a blended score.** Where a category naturally breaks down (exception
   severity: info/warning/critical), store the raw breakdown as separate counts and let
   the reader judge. Do not invent arbitrary weights (e.g. "critical = 9 points") to
   collapse them into one number — there is no defensible justification for any specific
   weighting, and an examiner can reasonably ask why those numbers and not others.
5. **`in_transit` is excluded from anything that measures "at a place" or "driver
   behavior while stationary.**" It's road time between precincts — distance and traffic,
   not something either the driver or a facility controls. Applied in Driver's phase
   latency, Lane's definition (it's the thing being measured, not excluded, for Lane
   specifically — see §5), and Facility's corroboration counts (see §6).
6. **A trip's month is defined by `actual_departure_at`**, consistently, across every
   grain that buckets by month. Do not use `created_at` or `planned_departure_at` for
   this.
7. **Consistent join keys, deliberately, so future work can cross-reference without a
   schema change**: `driver_id`, `horse_id` (as `vehicle_id`), and
   `origin_precinct_id`/`destination_precinct_id`, all drawn directly from `trips`. FP-153
   does **not** build any cross-grain query itself (e.g. "this driver's numbers, but only
   on one specific vehicle") — that's explicitly out of scope, matching Robert's
   "recurrence detector" idea from the planning docs, which is a legitimate future ticket,
   not this one. Don't build it now just because the keys make it possible.

### 3a. The one exception to monthly bucketing

`vehicle_incident_streaks` (§5) is **not** month-bucketed — it's one row per vehicle,
holding two facts about the vehicle's whole life (`highest_streak_trips`,
`lowest_streak_trips`), recomputed from full history on every refresh cycle. A streak has
no "filtered to last 3 months" variant that means anything — it's either continuing right
now or it isn't — so the monthly-bucket machinery doesn't apply here. `trips_since_last_incident`
goes further still: it isn't stored anywhere at all, it's a live function, computed fresh
on request (see §5).

## 4. Driver — `driver_analytics`

One row per **(driver_id, month_start)**.

| Column | Definition |
|---|---|
| `trip_count` | Closed trips this driver ran, departed in this month |
| `trips_with_exceptions_count` | Of those, how many had ≥1 exception |
| `total_exceptions_count` | All exceptions across those trips |
| `info_exceptions_count` / `warning_exceptions_count` / `critical_exceptions_count` | Severity breakdown of the above — no invented weighting, ever |
| `departures_with_plan_count` / `on_time_departures_count` | On-time rate: numerator = `actual_departure_at <= planned_departure_at` (strict, no grace window — none is defined anywhere in the codebase or docs); denominator = trips with both timestamps present |
| `activation_dwell_minutes_sum` / `activation_dwell_events_count` | See dwell-time methodology below |
| `loading_dwell_minutes_sum` / `loading_dwell_events_count` | ″ |
| `departure_dwell_minutes_sum` / `departure_dwell_events_count` | ″ |
| `unloading_dwell_minutes_sum` / `unloading_dwell_events_count` | ″ |
| `confirmation_dwell_minutes_sum` / `confirmation_dwell_events_count` | ″ |
| `phase_events_count` / `override_count` | Override rate: numerator = phase events with `dispatcher_override_user_id` set; denominator = all phase events for this driver that month |

**Dwell-time methodology** (applies to all five phase columns above): for each phase type,
dwell = `completed_at` of that phase minus `completed_at` of the *previous phase in
`sequence_number` order on that trip*. Concretely:

- `activation` dwell = time since `trip_creation` completed (trip_creation completes
  near-instantly at trip creation, so this mostly measures driver responsiveness).
- `loading` dwell = time since `activation` completed.
- `departure` dwell = time since `loading` completed.
- `unloading` dwell = time since the preceding `in_transit` completed.
- `confirmation` dwell = time since `unloading` completed. **Caveat to preserve in any UI
  built on this**: this one isn't purely on the driver — a slow receiver at the
  destination drags this number too. Surface that as a note, don't hide it, don't drop
  the metric.
- `in_transit` itself is never measured as a driver dwell (see rule 5 above) — it's excluded
  entirely, not folded into any of the five columns.
- `trip_creation` has no dwell of its own — there's no phase before it to measure a gap
  from. It's structurally excluded, not a sixth thing being dropped.
- **Multi-stop trips**: a phase type like `loading` can occur more than once per trip
  (once per pickup stop). Pool every occurrence into the same monthly bucket — two
  loading events on one cross-dock trip contribute two separate observations that month,
  not one.

All five dwell pairs use the sum/count pattern from rule 1 — never store a pre-computed
average.

## 5. Vehicle — `vehicle_analytics` + `vehicle_incident_streaks`

Scope: **horses only** (`Trip.horse_id`), not trailers. Trailers are a legitimate future
extension, deliberately not built now.

### `vehicle_analytics` — one row per (vehicle_id, month_start)

| Column | Definition |
|---|---|
| `trip_count` | Closed trips this vehicle ran that month |
| `mechanical_exceptions_count` | Count of `ExceptionType.MECHANICAL` only on those trips — **not** `VEHICLE_SUBSTITUTION`, which is a separate, more ambiguous signal (a swap can happen for reasons unrelated to a breakdown) |
| `mechanical_info_count` / `mechanical_warning_count` / `mechanical_critical_count` | Severity breakdown of the mechanical exceptions |
| `mechanical_gap_minutes_sum` / `mechanical_gap_count` | Mean time between breakdowns: for each `MECHANICAL` exception (after the first one ever recorded for this vehicle), the gap in minutes since the *previous* `MECHANICAL` exception on this vehicle. The vehicle's first-ever mechanical exception has no gap — same structural exclusion as `trip_creation` above, not a special case to code around. |
| `driving_hours_sum` | Sum of **in-transit-only** duration (`in_transit.completed_at − departure.completed_at`, per leg — a multi-stop trip has more than one `in_transit` leg, sum all of them). Deliberately **not** door-to-door trip duration — this is meant to track wear/usage for maintenance scheduling, not utilization. Kilometers was considered and dropped — see §7. |

### `vehicle_incident_streaks` — one row per vehicle, NOT month-bucketed

Recomputed from full history every refresh cycle (same Celery job, different query
shape).

| Column | Definition |
|---|---|
| `highest_streak_trips` | `MAX()` over every segment in this vehicle's history: the trip count before its first-ever mechanical exception, the trip count between each subsequent pair of consecutive mechanical exceptions, **and the still-open current segment** (trips since the most recent exception, through now). The current segment counts here — if it already exceeds every past completed segment, it's already the record, no need to wait for a new incident to "confirm" it. |
| `lowest_streak_trips` | `MIN()` over **completed** segments only (every segment above *except* the still-open current one). The current segment is deliberately excluded here — it could still grow, so including it in a "lowest ever" calculation would be premature and would make history quietly change later. `NULL` if the vehicle has had zero mechanical exceptions ever (no completed segment exists yet to measure). |

Streaks are measured in **trips**, not calendar days — deliberately, because a truck
sitting idle in the yard for three weeks between jobs would rack up a big day-streak while
proving nothing about reliability under actual use. A trip-count streak only grows when
the vehicle is actually driven.

**`trips_since_last_incident(vehicle_id)`** — **not a stored column anywhere.** A live
function, computed fresh on every request: find this vehicle's most recent `MECHANICAL`
exception, count trips on this vehicle since then. Cheap because it only ever scans
backward from *now*, bounded by however recent the last incident was — unlike the monthly
rollups, it doesn't benefit from pre-computation, and forcing it into a monthly bucket
would be conceptually wrong (there's no "trips since last incident, but only counting
March" — it's a single current-state fact, not a period activity count).

## 6. Lane — `lane_analytics`

One row per **(origin_precinct_id, destination_precinct_id, month_start)**.

| Column | Definition |
|---|---|
| `trip_count` | Closed trips over this lane that month |
| `exception_count` | Exceptions on those trips. Exception density = `exception_count ÷ trip_count`, computed at read time. |
| `actual_transit_minutes[]` | Array — one entry per closed trip that month with a known actual duration (`actual_arrival_at − actual_departure_at`) |
| `schedule_delta_minutes[]` | Array — one entry per trip that has **both** an actual and a planned duration, computed as `(actual − planned)` in minutes, **per trip, at build time** — not two separately-built arrays kept in sync afterward. This can have fewer entries than `actual_transit_minutes[]` in a given month, since not every trip has a planned time recorded — that's expected, not a bug. |

**Why arrays, not sum/count, for these two columns specifically**: this grain needs
average, fastest (min), slowest (max), median (P50), and P90 — and unlike a simple rate,
percentiles (median, P90) **cannot** be correctly recombined from two months' separately
computed values. Worked proof: month A has trips of 6h,6h,7h,7h,40h (median 7h); month B
has 9h,9h,9h (median 9h). Averaging the two medians gives 8h — wrong. The true combined
median across all 8 trips (sorted: 6,6,7,7,9,9,9,40) is 8h... **actually compute this
correctly in code, don't hardcode**: the point is that only concatenating the raw arrays
and recomputing the percentile over the pooled values gives the mathematically correct
answer. Average/min/max/median/P90 are all derivable from one array — no separate
`sum`/`count`/`min`/`max` columns needed alongside it, that would just store the same
information twice.

**For multi-month ranges**: concatenate the relevant months' arrays together (order
doesn't matter — none of average/min/max/median/P90 care what order the values arrive
in), then compute every statistic once over the combined list.

**Both array-derived stat sets (actual duration vs. schedule delta) are deliberately kept,
not redundant** — proven, not assumed: a lane can have very consistent actual transit
times (looks great) while being systematically quoted an unrealistic planned time (e.g.
every trip planned at 6h, actually takes 8-9h every time) — raw duration stats alone would
never reveal that the lane is failing its promised schedule. They answer different
business questions: "how long does this route physically take" vs. "are we keeping the
promises we make about it."

`in_transit` is not excluded here — for Lane specifically, in-transit duration *is* the
thing being measured (this is the one grain where road time is the actual subject, unlike
Driver's phase latency where it was noise).

## 7. Vehicle metrics explicitly considered and dropped — do not silently re-add these

- **Kilometers driven**: no route-distance data exists anywhere in the schema. Checked
  whether `trip_location_pings` could approximate it — it can't: the driver app has *no*
  continuous location tracking, by deliberate POPIA design (see
  `frontend/driver-pwa/lib/context/LocationContext.tsx`'s own top-of-file comment) — it
  only records a position at the exact moments the driver interacts with the app (each
  phase swipe), typically 4-5 sparse points per trip, clustered at gates. Summing
  distances between those gives something close to a straight line between buildings, not
  real kilometers. Would need either a stored planned-route distance (nobody captures
  this at trip creation) or a mapping-API integration — out of scope, not something either
  ticket asks for.
- **Route repetition** ("how many times has this vehicle done this specific lane"): a
  legitimate idea, but it's a vehicle-crossed-with-lane question, same territory as
  Robert's recurrence detector (§3, rule 7) — not core to what "vehicle" or "lane" mean on
  their own. Trivially answerable later by joining the two tables on `horse_id` once both
  exist — nothing is lost by not building it now.
- **Precinct dwell time** ("total time a truck spends at a facility, all phases except
  in_transit, arrival to departure"): considered for the Facility grain specifically, and
  dropped as too complex for this iteration. The real complication, for whoever revisits
  this later: there's no explicit "arrival" phase — the true arrival timestamp for a
  destination stop is hiding on the *previous leg's* `in_transit.completed_at`, which is
  filed under the *departure* stop's `trip_stop_id`, not the arrival stop's (per
  `phase_events`' own model comment on why `in_transit` is anchored to the stop it departs
  from). Correctly computing this needs a `sequence_number`-ordered lookup across stops,
  not a naive group-by on `trip_stop_id`. Flagging this so a future attempt doesn't
  rediscover the same wrinkle from scratch.

## 8. Facility — `facility_analytics`

One row per **(precinct_id, month_start)**. This is the metric every source agrees on
without exception — the FP-153 ticket, the Jira comment on FP-156, and both long team
planning documents all name "corroboration rate per precinct" identically. It is not safe
to drop or substitute.

| Column | Definition |
|---|---|
| `confirmed_count` | Phase events at this precinct's stop where `phase_events.pulsit_geofence_confirmed = TRUE` |
| `mismatch_count` | Phase events where it's `FALSE` |
| `unwitnessed_count` | Phase events where it's `NULL` |

Corroboration rate = `confirmed_count ÷ (confirmed_count + mismatch_count)` at read time —
**`unwitnessed_count` is deliberately excluded from that denominator**, matching how the
dispatcher frontend already treats "Awaiting Pulsit" as a genuine third state, not a
failure (see `PhaseLocationSection.tsx`). `unwitnessed_count` still earns its own stored
column rather than being discarded, because a precinct with a large unwitnessed count is
telling you something real and separate — its Pulsit *coverage* is broken, a different
problem from "the truck wasn't actually there."

**Critical filter, confirmed necessary by reading the actual corroboration service
(`app/orchestration/corroboration_service.py`)**: **exclude `phase_type = 'in_transit'`
from this aggregation entirely** — not counted in any of the three columns. That service
has a permanent, deliberate rule (`_PHASES_WITHOUT_A_GEOFENCE_VERDICT`) that `in_transit`
never gets a geofence verdict at all, because `in_transit` is tagged to the stop the truck
just *departed*, not the one it's at — checking it against that precinct would falsely
flag every healthy trip. That means an `in_transit` row reads `NULL` forever, by design,
not because of a coverage gap. If not excluded, every precinct's `unwitnessed_count` gets
permanently polluted with events that were never going to be checked regardless of
anything — muddying the one signal this column exists to give.

**What this means for the data right now**: `pulsit_geofence_confirmed` genuinely has a
live writer now (it didn't when this ticket's investigation started) — `corroboration_service.py`
sets it correctly, with careful three-state semantics (`NULL` = "couldn't check", never
conflated with `FALSE` = "checked, disagreed"). Real numbers will appear here as trips run
through the current code, not permanently empty as originally feared.

**Precinct dwell time** was proposed as an addition and explicitly dropped for now — see
§7's last bullet for the exact reason and the wrinkle to be aware of if it's revisited
later.

## 9. Implementation notes

- **`app/analytics/` package**: one module per grain (`driver_metrics.py`,
  `vehicle_metrics.py`, `lane_metrics.py`, `facility_metrics.py`), each exposing query
  functions that take a date range and return the summed/recombined result — this is
  where the "sum raw columns across the requested months, then divide/percentile once"
  logic actually lives in code, not just as a description in this doc.
- **Materialized views** via Alembic. Each needs a unique index for
  `REFRESH MATERIALIZED VIEW CONCURRENTLY` to work. Before autogenerating: `git fetch
  origin`, check `dev` for unmerged migrations ahead of `ciaran_trip_history_page`, name
  the file `2026_MM_DD_tom_<description>.py` matching team convention.
- **Celery beat task** in a new `app/tasks/analytics.py`, registered in
  `app/tasks/__init__.py` (shared file — flag it in TASK COMPLETE) at a new
  `ANALYTICS_REFRESH_INTERVAL_SECONDS` setting in `core/config.py` (also shared — flag
  it), added to `.env.example` as a key name only.
- **Tests**: FP-153's own subtask (FP-230) calls these "unit tests," but per this
  project's own taxonomy (`backend/tests/unit/` = no DB, `backend/tests/integration/` =
  DB), a materialized view cannot be tested without a real Postgres — these belong in
  `backend/tests/integration/test_analytics.py`, seeding known trips/exceptions/phase
  events and asserting the derived numbers match hand-computed expected values.
- **No API endpoint** in this ticket — FP-156 builds that, against exactly the columns
  above.
- **Registration**: any new model (`vehicle_incident_streaks` if it's a real ORM-mapped
  table rather than a raw view) must be imported in `db/models/__init__.py` (shared file).

## 10. Known open items — carried forward honestly, not resolved

- FP-156's own subtasks (FP-243–246) have never had full descriptions in Jira, only
  titles. If more detail has been added since, prefer that over this document's
  inferences about FP-156's needs.
- Team meeting notes reference a "spend a few hours defining KPIs with Bruce before
  building" step, explicitly assigned and, as far as this investigation could confirm,
  not documented as having happened. Everything in this spec is grounded in real,
  quoted stakeholder asks (Robert's Q&A questions, Bruce's own stated priorities, the
  review chair's ask) — defensible to build now, but treat it as pending real
  confirmation, not as already signed off.
- Jira board status for FP-153/FP-156/FP-259 all read "Done" despite no corresponding
  code having been merged for FP-153/156 specifically — this is a known, intentional
  team practice (confirmed directly by the developer), not a discrepancy to re-investigate.

---

## 11. Build record and FP-156 handoff (added 2026-09-11)

### 11.0 How to use this section

This section records what was actually built for FP-153, every decision taken during the
build, and the agreed starting plan for FP-156. A fresh session starting FP-156 should:

1. Read CLAUDE.md, then **this §11 in full**. §1–§10 above are the original spec and are
   still the rationale, but **§11.2 overrides them wherever they disagree**.
2. Treat the FP-153 code as the contract FP-156 builds on (§11.5). Do not change the
   view SQL or the metric definitions as part of FP-156 — that would need a new migration
   and a new decision.
3. Start FP-156 with a normal CLAUDE.md PLAN block. The open questions it needs answered
   are listed in §11.9.

### 11.1 Status when this was written

- Branch `fp-153-analytics-read-models`, commit `e0cc8e4`
  (`feat(db): add FP-153 analytics materialized views, read layer and refresh task`).
- Being pushed for team review. **NOT merged to `dev`. Migration NOT applied to the shared
  Supabase database.** Until it is applied there, the analytics views exist only inside
  the test suite.
- Verification done: ruff clean; mypy clean on every new module; `alembic heads` shows a
  single head (`tom_analytics_read_models`); offline `alembic upgrade --sql` rendered 5
  views and 5 unique indexes and no reference to `actual_departure_at`. Full backend suite
  on an isolated database: **1288 passed, 4 skipped** (baseline before FP-153: 1247 passed,
  4 skipped; FP-153 added 41 tests, all passing).

### 11.2 Decisions taken during the build — these SUPERSEDE §1–§10 where they differ

Found by reading the live code before building; each was put to the developer and
approved on 2026-09-10.

| # | Problem found in the live code | Decision (now implemented) | Overrides |
|---|---|---|---|
| Q1 | Precincts can be shared between operators (`Precinct.is_shared`). Grains with no organisation key would mix operators' trips in lane and facility rows — a cross-tenant leak. | **Every grain is keyed by `operator_organization_id` first**, including the unique indexes. Every read function requires an `organization_id`. | Grain definitions in §4, §5, §6, §8 |
| Q2 | `trips.actual_departure_at` is overwritten on **every** departure (`phase_service.py:1318`, `advance_departure`), so a multi-stop trip holds its LAST leg's time. | A trip's departure = **`MIN(phase_events.completed_at)` over its `departure` rows with status `completed` or `exception`**, read from the phase ledger. `trips.actual_departure_at` is **never read**. Used for the month bucket, on-time, and lane duration. | §3 rule 6, §4 on-time, §6 `actual_transit_minutes` |
| Q3 | Overridden phases carry a dispatcher-click timestamp, and `override_phase` never runs corroboration, so they are permanently `NULL` — the same pollution §8 excludes `in_transit` for. | **`overridden` phases are excluded from all timings (dwell, driving hours) and from all facility counts.** They still count in `override_count` and `phase_events_count`. A dwell or leg is only measured when **both** ends are `completed`/`exception`. Consequence: a closed trip whose every departure was overridden has no ledger departure and is **excluded from every grain**. | §4 dwell, §5 driving hours, §8 |
| Q4 | Which timezone decides the month? A departure at 00:40 SAST on the 1st is still the previous month in UTC. | **Months are calendar months in SAST** (`Africa/Johannesburg`, i.e. UTC+2, matching `OPERATIONS_UTC_OFFSET_HOURS`). | §3 rule 2 |
| Q5 | Two MECHANICAL reports on one trip: a 0-trip streak between them? | **An incident = a closed trip with ≥1 MECHANICAL exception.** Two reports on one trip are one incident. Back-to-back incident *trips* still give a genuine 0. | §5 streaks |

Other deviations from the original text, all deliberate:

- **Five materialized views, no table.** `vehicle_incident_streaks` is a materialized view
  too (full-history recompute, no write path), so **no ORM model was added to
  `db/models/__init__.py`** (§1 and §9 anticipated a table).
- **Lane rows exclude trips whose `origin_precinct_id` or `destination_precinct_id` is
  NULL** — a trip with an unknown endpoint is on no lane. Those trips still count in the
  driver, vehicle and facility grains.
- **`.env.example` has `ANALYTICS_REFRESH_INTERVAL_SECONDS=900`, not an empty key** (§9
  said "key name only"): a blank integer makes `Settings()` fail validation when the file is
  copied verbatim. Matches the existing `PP_POLL_INTERVAL_SECONDS=60` precedent.
- **§6's median "worked proof" is flawed** — its two datasets give 8h both ways. The tests
  use `[100, 200, 300]` + `[1000]` instead: pooled median 250 vs 600 for the average of the
  monthly medians.
- The views have no `created_at`/`updated_at` — they are derived relations, not tables.
- Two extra modules not named in §9: `app/analytics/rollup.py` (shared sum-across-months
  helper) and `app/analytics/stats.py` (pure maths).

### 11.3 What was built, file by file

**Migration** — `backend/migrations/versions/2026_09_12_tom_analytics_read_models.py`
- Revision `tom_analytics_read_models`, down-revision `ciaran_trip_history_page`.
  Hand-written: Alembic autogenerate cannot emit materialized views.
- Creates `driver_analytics`, `vehicle_analytics`, `vehicle_incident_streaks`,
  `lane_analytics`, `facility_analytics`, each `WITH DATA`.
- One unique index per view on exactly its grain, named `uq_<view>_grain` — required for
  `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- A guarded `DO $$ … $$` block that `REVOKE ALL`s the five views from the `anon` and
  `authenticated` roles when those roles exist (a no-op on plain Postgres). Reason: RLS
  cannot be enabled on a materialized view, and Supabase's default privileges would
  otherwise expose every operator's analytics through the Data API — the hole
  `0003_tom_rls_policies` closed for tables.
- Exposes module-level `UPGRADE_STATEMENTS` and `DOWNGRADE_STATEMENTS` tuples.
  `upgrade()`/`downgrade()` just `op.execute` them. The tests load these same constants.
- The SQL is self-contained (no imports from `app/`), following the repo convention that a
  migration is a frozen record. Shared CTE fragments (`closed_trips` with the ledger
  departure and SAST month, `trip_exceptions`, `trip_phases` with `LAG` over
  `sequence_number`) are Python strings spliced into each view.

**Read layer** — `backend/app/analytics/`
| File | Contents |
|---|---|
| `__init__.py` | Docstring only — deliberately imports nothing (avoids a circular import with `schemas/analytics.py`). |
| `views.py` | Read-only ORM mappings of the five views on a **separate** `AnalyticsViewBase` (not `app.db.models.Base`, or `create_all` in tests and Alembic autogenerate would treat them as tables). Classes: `DriverAnalyticsView`, `VehicleAnalyticsView`, `VehicleIncidentStreaksView`, `LaneAnalyticsView`, `FacilityAnalyticsView`. Also `ANALYTICS_VIEWS`, `ANALYTICS_VIEW_NAMES`, and `ATTESTED_PHASE_STATUSES = (COMPLETED, EXCEPTION)`. |
| `stats.py` | Pure maths: `safe_ratio` (None on a zero denominator), `percentile` (linear interpolation — same as Postgres `percentile_cont`), `validate_month_range`, `MEDIAN_FRACTION`, `P90_FRACTION`. |
| `rollup.py` | `sum_over_months(...)`: SUMs every non-grain column of a monthly view across an inclusive month range, grouped by the entity key, scoped to one organisation. Selects columns, never ORM entities (an entity would sit in the session identity map and serve stale values after a refresh). |
| `driver_metrics.py` | `get_driver_metrics` |
| `vehicle_metrics.py` | `get_vehicle_metrics`, `get_vehicle_streaks`, `trips_since_last_incident` (live query on base tables, same definitions as the streaks view) |
| `lane_metrics.py` | `get_lane_metrics`: concatenates the monthly arrays per lane, then computes statistics once. |
| `facility_metrics.py` | `get_facility_metrics` |
| `refresh.py` | `refresh_analytics_views(conn, *, concurrently=True) -> list[str]` and `AnalyticsRefreshError(failed_views)`. Refreshes each view; a failure is logged and the rest still run; raises at the end if anything failed. |

**Result models** — `backend/app/schemas/analytics.py` (Pydantic v2, frozen). Each model
carries the summed raw counts **plus** `@computed_field` rates derived from them, so a
rate is divided exactly once and can never disagree with its counts. A derived value is
`None` when its denominator is 0 ("no data", not 0%).

**Refresh task** — `backend/app/tasks/analytics.py`: Celery task
`tasks.analytics.refresh_views` (function `refresh_analytics`). Creates a short-lived
engine with `isolation_level="AUTOCOMMIT"` (CONCURRENTLY cannot run inside a transaction),
refreshes concurrently, disposes the engine. Retries up to 3 times, 60 s apart.

**Shared files changed (additive only):**
- `app/tasks/__init__.py` — beat entry `"analytics-refresh-views"` → `tasks.analytics.refresh_views`
  every `settings.ANALYTICS_REFRESH_INTERVAL_SECONDS`, plus an explicit import of the task.
- `app/core/config.py` — `ANALYTICS_REFRESH_INTERVAL_SECONDS: int = 900` (15 min).
- `backend/.env.example` — `ANALYTICS_REFRESH_INTERVAL_SECONDS=900`.

### 11.4 Metric definitions exactly as implemented

Applies to every view: **closed trips only** (`trips.status = 'closed'`); **departure from
the ledger** (Q2); **month = SAST month of that departure** (Q4); **grain starts with
`operator_organization_id`** (Q1); attested = phase status `completed` or `exception`.

- **`driver_analytics`** — (org, `driver_id`, `month_start`)
  - `trip_count`; `trips_with_exceptions_count`; `total_exceptions_count` split into
    `info_/warning_/critical_exceptions_count`. Exceptions of every type and source count.
  - `departures_with_plan_count` = trips with `planned_departure_at`;
    `on_time_departures_count` = ledger departure `<=` planned (strict, no grace).
  - Dwell sum/count for activation, loading, departure, unloading, confirmation = this
    row's `completed_at` minus the previous row's in `sequence_number` order, only when
    **both** rows are attested. Multi-stop occurrences pool (two loadings = two
    observations). `in_transit` and `trip_creation` are never dwell.
  - `phase_events_count` = **all** phase rows of those trips (including `trip_creation` and
    overridden rows — the spec's literal definition); `override_count` = rows with
    `dispatcher_override_user_id` set.
- **`vehicle_analytics`** — (org, `vehicle_id` = `trips.horse_id`, `month_start`)
  - `trip_count`; `mechanical_exceptions_count` (MECHANICAL only, never
    VEHICLE_SUBSTITUTION) split by severity.
  - `mechanical_gap_minutes_sum`/`_count`: for each MECHANICAL exception, minutes since the
    previous one on the same (org, vehicle), by `exceptions.created_at`, over the vehicle's
    whole closed-trip history. The gap belongs to the month of the later breakdown's trip.
    The first-ever breakdown has no gap.
  - `driving_hours_sum`: for each `in_transit` row whose predecessor is `departure`, both
    attested, `in_transit.completed_at − departure.completed_at`, summed across all legs.
- **`vehicle_incident_streaks`** — (org, `vehicle_id`), whole history, no month.
  - A closed trip's segment = how many incident trips came before it, ordered by
    (ledger departure, trip id). Clean trips sharing a segment form one streak. Segments
    `0..incident_count` are enumerated explicitly, so an empty segment (back-to-back
    incidents) exists with length 0.
  - `highest_streak_trips` = MAX over all segments **including** the open (current) one.
  - `lowest_streak_trips` = MIN over **completed** segments only; NULL if the vehicle has
    never had an incident.
  - Worked examples (all asserted in tests), with `.` = clean trip and `X` = incident:
    `..X.XX.` → (2, 0); `.X...` → (3, 1); `..` → (2, NULL); `.2.` (two reports on one trip)
    → (1, 1).
- **`lane_analytics`** — (org, `origin_precinct_id`, `destination_precinct_id`, `month_start`)
  - `trip_count`; `exception_count`.
  - `actual_transit_minutes[]` = `actual_arrival_at − ledger departure` per trip with a
    known arrival. `actual_arrival_at` is stamped by `phase_service` only from a
    **completed** (not overridden) final `in_transit`.
  - `schedule_delta_minutes[]` = actual − (`planned_arrival_at − planned_departure_at`),
    per trip, only when both planned timestamps exist.
  - Arrays are ordered by trip id; empty arrays are `{}`, never NULL.
- **`facility_analytics`** — (org, `trip_stops.precinct_id`, `month_start`)
  - `confirmed_count` / `mismatch_count` / `unwitnessed_count` =
    `pulsit_geofence_confirmed` TRUE / FALSE / NULL, over attested, non-`in_transit` phase
    rows joined to their stop's precinct. `trip_creation` has no stop, so it drops out.

### 11.5 The read API FP-156 builds on

All functions are `async`, take an `AsyncSession` as `db`, and use keyword-only arguments
after it. Month bounds are **inclusive, first-of-month `date`s**; anything else raises
`ValueError` (FP-156 should turn that into a 422). Results are ordered by entity id.
Results contain **ids only — no names** (see §11.9).

```python
get_driver_metrics(db, *, organization_id, start_month, end_month, driver_ids=None) -> list[DriverMetrics]
get_vehicle_metrics(db, *, organization_id, start_month, end_month, vehicle_ids=None) -> list[VehicleMetrics]
get_vehicle_streaks(db, *, organization_id, vehicle_ids=None) -> list[VehicleStreak]   # no month range, by design
trips_since_last_incident(db, *, organization_id, vehicle_id) -> int                    # live; closed trips only;
                                                                                        # no incident ever -> all closed trips
get_lane_metrics(db, *, organization_id, start_month, end_month,
                 origin_precinct_id=None, destination_precinct_id=None) -> list[LaneMetrics]
get_facility_metrics(db, *, organization_id, start_month, end_month, precinct_ids=None) -> list[FacilityMetrics]
```

| Model | Stored fields (summed) | Computed fields (None when denominator is 0) |
|---|---|---|
| `DriverMetrics` | `driver_id`, `trip_count`, `trips_with_exceptions_count`, `total_exceptions_count`, `info_/warning_/critical_exceptions_count`, `departures_with_plan_count`, `on_time_departures_count`, `<phase>_dwell_minutes_sum` + `<phase>_dwell_events_count` for the 5 phases, `phase_events_count`, `override_count` | `exception_trip_rate`, `on_time_departure_rate`, `override_rate`, `activation_/loading_/departure_/unloading_/confirmation_dwell_minutes_avg` (the last carries the "slow receiver" caveat in its schema `description`) |
| `VehicleMetrics` | `vehicle_id`, `trip_count`, `mechanical_exceptions_count`, `mechanical_info_/warning_/critical_count`, `mechanical_gap_minutes_sum`, `mechanical_gap_count`, `driving_hours_sum` | `mean_minutes_between_mechanical` |
| `VehicleStreak` | `vehicle_id`, `highest_streak_trips`, `lowest_streak_trips` (nullable) | — |
| `DurationStats` | `sample_count`, `mean`, `minimum`, `maximum`, `median`, `p90` (all minutes) | built by `DurationStats.from_values(values)` |
| `LaneMetrics` | `origin_precinct_id`, `destination_precinct_id`, `trip_count`, `exception_count`, `actual_transit_minutes: DurationStats`, `schedule_delta_minutes: DurationStats` | `exception_density` |
| `FacilityMetrics` | `precinct_id`, `confirmed_count`, `mismatch_count`, `unwitnessed_count` | `corroboration_rate` = confirmed ÷ (confirmed + mismatch); unwitnessed is excluded from the denominator on purpose |

Computed fields are included when a model is serialised, so a FastAPI `response_model` of
these types returns the rates automatically.

### 11.6 Refresh and operations

- Beat fires `tasks.analytics.refresh_views` every `ANALYTICS_REFRESH_INTERVAL_SECONDS`
  (default 900). The numbers can therefore be up to ~15 minutes old — acceptable because
  only closed trips count. Postgres records no "last refreshed" time for a materialized
  view, so none is exposed yet (see §11.9).
- To see it run locally: `cd backend && celery -A app.tasks worker -B --loglevel=info`.
- `infrastructure/docker/docker-compose.dev.yml` runs `celery -A app.tasks worker` with
  **no beat**, so in Compose neither this refresh nor the existing Parcel Perfect poll ever
  fires. Flagged to the team, not changed (shared file).
- `REFRESH MATERIALIZED VIEW` requires the **owner** of the view. The database user the
  Celery worker connects as must be the user that ran the migration, or refreshes fail
  with "must be owner".

### 11.7 Tests and how to run them

- `backend/tests/unit/test_analytics_stats.py` (19 tests): ratio, percentile (including
  pooled vs averaged medians), month validation, `DurationStats`, computed rates, the
  confirmation caveat, facility rate excluding unwitnessed.
- `backend/tests/unit/test_analytics_task.py` (8 tests): the refresh loop (concurrent and
  plain, partial failure), the AUTOCOMMIT engine and its disposal, task retry, beat
  registration.
- `backend/tests/integration/test_analytics.py` (14 tests). The test DB is built by
  `create_all()`, which knows nothing about views, so the `views` fixture **loads the
  migration file with `importlib` and runs its `UPGRADE_STATEMENTS` inside the test's
  rolled-back transaction** — the SQL under test is the SQL that ships. `_refresh()` then
  refreshes non-concurrently (CONCURRENTLY cannot run inside that transaction). One test
  runs a real CONCURRENTLY refresh on its own AUTOCOMMIT connection and drops the views
  in `finally`. **FP-156's endpoint tests should reuse this `views` fixture pattern.**
- **Shared local test DB caution:** `TEST_DATABASE_URL` is a local Postgres shared by every
  pytest process on the machine. Each run `create_all`s at start and `drop_all`s at the end,
  so two overlapping runs (for example two Claude sessions) delete each other's tables.
  On 2026-09-10 three full runs showed 110–152 failures, all
  `relation "organizations" does not exist`, because another pytest process was running at
  the same time. The fix is to run one suite at a time. To prove a result, run against a
  throwaway database: `CREATE DATABASE`, override `TEST_DATABASE_URL` in the environment for
  that run, then `DROP DATABASE … WITH (FORCE)`.

### 11.8 Known defects and open items carried forward

1. **For Ciaran (not fixed here):** `phase_service.py:1318` sets
   `trip.actual_departure_at = datetime.now(UTC)` on every departure. Suggested fix: only set
   it while it is still NULL. FP-153 is unaffected (it never reads the column); anything
   else using it for multi-stop trips is wrong until fixed.
2. **The views depend on columns of `trips`, `phase_events`, `exceptions` and `trip_stops`.**
   A future migration that ALTERs or DROPs one of those columns will fail ("cannot alter
   type of a column used by a view") unless it drops and recreates the affected views.
   The whole team needs to know this.
3. **The migration has not yet run through Alembic against Supabase.** Its exact SQL is
   exercised by the tests, but its first real `alembic upgrade` will be on the shared DB.
   Before applying: `git fetch`, check that `dev` has no newer migration (if it does,
   `down_revision` needs updating — coordinate, per CLAUDE.md), and run `alembic current`
   (in July 2026 the shared DB was stamped with a revision missing from `dev`).
   `alembic downgrade -1` removes the views.
4. After applying: check that the 5 views exist, that the Supabase Data API **cannot**
   read them with the anon key, that a manual refresh succeeds, and that the numbers match
   one well-understood closed trip.
5. KPI confirmation with Bruce (§10) is still outstanding, now covering Q1–Q5 as well.
6. FP-243 to FP-246 (FP-156 subtasks) still have titles only.

### 11.9 FP-156 — plan agreed on 2026-09-11 (starting point, not yet a PLAN block)

**What FP-156 is:** the dispatcher-facing analytics screen — a working visual frontend,
plus the small backend layer (API endpoints) that FP-153 deliberately did not build.

**Branching and database — read before starting:**
- FP-153 is **not merged**. FP-156 must be built on top of it: create the FP-156 branch
  **from `fp-153-analytics-read-models`**, not from `dev`. After FP-153 merges, rebase
  FP-156 onto `dev` (the developer runs all git write commands). If FP-153 changes during
  review, FP-156 needs rebasing onto the new FP-153 commit.
- The views **do not exist on the shared Supabase DB** until the FP-153 migration is
  applied there with team agreement. Until then:
  - Backend endpoints are built and proven with integration tests using the §11.7
    `views` fixture pattern.
  - The frontend is built against mock data (check how existing dispatcher pages use
    `frontend/shared/lib/mocks/` before choosing the approach).
  - Hitting the real endpoint against the shared DB will fail ("relation does not exist")
    until the migration is applied. That is expected, not a bug.

**Questions to settle in the FP-156 PLAN block, with recommendations:**
1. What "last N months" means → recommend the current SAST month plus the previous N−1
   (the views count only closed trips, so the current month is simply partial). Options:
   1/2/3/6/12/24.
2. Which metrics appear on the first screen → confirm with Bruce if possible; default to all
   four grains as tabs.
3. Entity names (driver name, horse registration, precinct name) → recommend joining them
   server-side in a small service, so the frontend never cross-references ids.
4. Whether to show a "last refreshed" time → it does not exist yet. The cheapest option is
   for the refresh task to record a timestamp (for example in Redis) and an endpoint to
   return it. This is a real backend change, so decide explicitly. The minimum is a static
   "refreshed every 15 minutes" label.
5. Endpoint shape → recommend one GET per grain, plus streaks and trips-since-last-incident.

**Backend (small):**
- New `backend/app/api/v1/endpoints/analytics.py`, `tags=["analytics"]`, every endpoint
  `async def`, `Depends(get_db)` and `Depends(get_current_dispatcher)`. The organisation
  comes from `current_user.organization_id` (`UserRead`), **never from a query parameter**.
- Query params `start_month`/`end_month` (or a months count converted server-side using
  SAST); a `ValueError` from `validate_month_range` becomes a 422.
- Endpoints stay thin (CLAUDE.md): validate, then call a service, then return. Name
  enrichment belongs in a small service (for example `app/orchestration/analytics_service.py`)
  that calls `app.analytics.*` and looks up names scoped to the organisation. Response
  models: the §11.5 schemas, or thin wrappers adding a `name`.
- Register the router in `backend/app/main.py` (**shared file** — flag it in TASK COMPLETE).
- Integration tests per endpoint: 200 with hand-computed values, 401, 422 (bad months),
  and **cross-organisation isolation** (operator B's data never appears for operator A).
  Also check whether a driver token is rejected (403). Follow
  `tests/integration/test_trip_history.py` for endpoint-test style.

**Frontend (dispatcher, Next.js 15 App Router):**
- New route `frontend/dispatcher/app/(app)/analytics/page.tsx`, alongside the existing
  `trips`, `history`, `exceptions`, `fleet`, `precincts`, `sla` routes.
- Navigation: add the link in `frontend/dispatcher/components/layout/Sidebar.tsx` and the
  route constant in `frontend/dispatcher/lib/constants/routes.ts`.
- Data through the existing typed client `frontend/dispatcher/lib/api/client.ts` — never
  raw `fetch()` in components.
- Types in a new `frontend/shared/lib/types/analytics.ts` mirroring §11.5, including the
  computed fields and `null`s. No `any`.
- Charts: **`recharts` ^3.8.1 is already a dispatcher dependency**, so no new package is
  needed (and `package.json` is a shared file, so avoid adding one). Tables carry most of
  the information; add charts only where they help.
- Layout: tabs for Driver / Vehicle / Lane / Facility, a range picker, and sortable tables.
  Vehicle shows streaks and trips since last incident next to the monthly numbers.
- Display rules that keep the data honest (these come from the spec and must not be dropped):
  - Show every rate with its counts, e.g. "67% (2/3)". Show "—" for `null`, never 0%.
  - Severities stay as separate counts. **Never** a blended score.
  - Show the confirmation-dwell caveat (slow receiver) next to that number.
  - Show `unwitnessed_count` as its own Pulsit coverage figure, consistent with the
    existing "Awaiting Pulsit" state (`PhaseLocationSection.tsx`).
  - Explain in the UI that only closed trips count.
- Server Components where possible, `"use client"` only at the lowest interactive level
  (for example the range picker and tabs).

**Suggested order:** settle the questions above → backend endpoints and service with tests →
shared types → page scaffold on mock data → wire to the real API once the migration is on
Supabase → prepare closed demo trips so the screen is not empty on demo day.

**Do not, in FP-156:** read `trips.actual_departure_at`; change the view SQL (that needs a
new migration and a new decision); re-add the metrics dropped in §7; add a blended score;
take the organisation from anywhere but the auth token.

### 11.10 Linearization fix (2026-09-11)

Chiko's FP-157 (`chiko_receipt_hash_index`) landed on `dev` after this branch's migration
was written, moving the Alembic head past `ciaran_trip_history_page`. Fixed before merge:
`down_revision` changed from `ciaran_trip_history_page` to `chiko_receipt_hash_index`
(docstring updated to match), and the migration file renamed
`2026_09_10_tom_analytics_read_models.py` → `2026_09_12_tom_analytics_read_models.py` so
`versions/` stays chronological. `revision = "tom_analytics_read_models"` is unchanged.
`backend/tests/integration/test_analytics.py`'s `_MIGRATION_PATH` was updated to the new
filename in the same commit. No other file references the old filename.
