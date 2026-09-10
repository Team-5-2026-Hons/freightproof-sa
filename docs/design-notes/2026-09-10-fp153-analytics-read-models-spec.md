# FP-153 — Analytics Read Models — Build Spec

Author: Tom (Thomas Davis) · Written 2026-09-10, after extended metric-design review
Status: metrics locked, ready to implement
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
