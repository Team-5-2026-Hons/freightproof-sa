# FP-156 — Dispatcher Analytics Screen — Build Spec

Author: Tom (Thomas Davis), with Claude · Written 2026-09-11
Status: **COMPLETE — 2026-09-11. Built in three stages, each reviewed by Tom, then checked
in the browser. Read §8 (build record) first.** Not merged yet: FP-156 depends on FP-153,
whose migration is not applied to Supabase (§8.7). Confirmed decisions are in §0.1 and
review corrections in §0. The branch was synced with `dev` on 2026-09-11 (§7). Every claim
below was verified against the live
repo (file + line cited) on 2026-09-11, after an earlier attempt this session went wrong
(a research subagent wrote unrequested code; a wrong assumption about local infra was
corrected). Nothing here is carried over from that attempt without being re-checked.
Branch: `fp-156-analytics-screen`, confirmed created off `fp-153-analytics-read-models`.

## How to use this document

**FP-156 is built. Start with §8, the build record: what exists, how it was verified, and
what is still open. §0 and §0.1 hold the decisions; §1–§7 are the plan it was built from.**

Same purpose as `2026-09-10-fp153-analytics-read-models-spec.md`: a complete handoff so a
fresh session can execute FP-156 correctly without re-deriving decisions. Every fact is
cited to a real file and line. Where something is inferred rather than confirmed (Jira
subtasks with no body text, for instance), that is stated explicitly rather than presented
as settled. Read the FP-153 spec's §11 (build record + handoff) first — this document
follows directly from it and does not repeat its reasoning, only its conclusions.

---

## 0. Review corrections (2026-09-11)

A later review re-checked every citation against the live repo **and** `origin/dev`. The
corrections below have been applied in place; this list exists so nobody works from an
older copy.

| # | Correction | Where |
|---|---|---|
| 1 | `dev` moved (Chiko's PR #45). Its migration shares a parent with FP-153's, which gives two Alembic heads. It also changed `Sidebar.tsx`, `Sidebar.test.tsx` and `routes.ts`, which FP-156 edits. **Synced 2026-09-11 (§7).** | §1, §4.1, §6, §7 |
| 2 | Precinct names must be looked up **by id only**, not filtered by the operator's org. Precincts belong to the client organisation, so that filter returns no names. | §3.1, §3.3, §3.5 |
| 3 | The per-vehicle `trips-since-incident` endpoint is removed (it caused one HTTP call per table row). The value now comes back inside the streaks response. | §3.3, §3.5, §4.4, §5 |
| 4 | `Driver.full_name` is at `people.py:57`, not line 31 (that is `User.full_name`). `Trip.driver_id` → `drivers.id` is confirmed, so that open question is closed. | §3.3 |
| 5 | Frontend tests added. vitest and Testing Library already exist in the dispatcher. | §4.6, §6 |
| 6 | Default month range on first load proposed; confirm in the PLAN. | §4.3 |
| 7 | Before the migration is applied, endpoints return **HTTP 500**, not "an empty result". | §4.2, §6 |
| 8 | The "refreshes every ~15 minutes" label is only true if Celery beat runs where the app is deployed. | §4.5, §6 |
| 9 | The `'use client'` note was reclassified: it is a standards gap, not a deprecation. | §4.1 |
| 10 | Tab order source (Ciaran's Jira comment) was not re-verified in review. | §4.3 |
| 11 | Demo seed data is tracked in FP-153 **§11.9**, not "§11.8 item 4" (that item is post-migration checks). | §6 |
| 12 | In local `DEMO_MODE` every request acts as a fixed demo company, so the screen only ever shows that company's closed trips. | §4.2 |
| 13 | *(PLAN review)* A **missing** token returns **403**, not 401 (`get_current_dispatcher`: "Missing authentication credentials."; `test_trip_history.py:451` asserts 403). An **invalid or expired** token returns **401** (`_decode_token`). The tests assert both. | §3.5 |
| 14 | *(PLAN review)* The default month range is computed in `Africa/Johannesburg` with `Intl.DateTimeFormat`, as `history/page.tsx:24-37` does, not from the browser's local calendar. A browser set to UTC would show the previous month from 00:00 to 02:00 SAST on the 1st. | §4.3 |
| 15 | *(PLAN review)* CLAUDE.md requires unit tests for `orchestration/`. The service's name-attaching step is a pure function with its own unit tests (`tests/unit/test_analytics_service.py`). The DB lookups are covered by the integration tests. | §3.1, §3.5 |
| 16 | *(PLAN review)* The hooks must not be built on `useAsyncData`. It does not refetch when its fetcher changes (`run` depends only on `timeoutMs`), so changing the range would keep showing the old range. Use the `useTripHistory` pattern. | §4.2 |
| 17 | *(PLAN review)* Tab order verified against Ciaran's 26 Aug comment on FP-156. Closes #10. | §4.3 |
| 18 | *(PLAN review)* "Awaiting Pulsit" is live-trip copy. On a closed trip a missing reading was never taken, so the facility column is headed **"Unwitnessed (no Pulsit reading)"**. | §4.4 |
| 19 | *(PLAN review)* Nothing in the repo runs Celery beat (the Compose worker has no `-B`; there is no Railway config). After the migration the views would be built once (`WITH DATA`) and never refresh. The refresh label no longer claims an interval, and beat is a team-meeting item. | §4.5, §6, §6.1 |
| 20 | *(Browser check)* Before the migration, the browser does **not** see the HTTP 500. `main.py`'s catch-all `Exception` handler runs outside the CORS middleware, so the 500 has no `access-control-allow-origin` header. The browser drops it, and the panel shows `Request to … failed: Load failed` (the client's `ApiError(0, …)` for "no response"). Verified by an in-process simulation: an unhandled 500 had no CORS header, while a handled 422 on the same path had one. This affects every endpoint's unhandled 500s, not just FP-156. The error state and retry work as intended. | §4.2, §6.1 |

### 0.1 PLAN decisions — confirmed by Tom, 2026-09-11

| # | Decision |
|---|---|
| 1 | **Default range:** the current SAST month plus the previous two (3 months inclusive), computed in `Africa/Johannesburg` (§0 #14). |
| 2 | **Sidebar:** the Analytics link goes in the **OVERVIEW** group, under Dashboard, with no admin-only flag. |
| 3 | **Tabs:** Facility, Vehicle, Lane, Driver, with **Facility selected on load**. |
| 4 | **Label wording:** *"Closed trips only. Figures update periodically, so a recently closed trip may take a while to appear."* No interval is claimed, because beat is unconfirmed (§0 #19). |
| 5 | **Response schemas:** flat subclasses of the frozen models, so the computed rates carry over and the JSON stays flat for `DataTable`'s `key: keyof T` columns. Precedent: `PrecinctDetailResponse(PrecinctRead)`, `DriverDetailResponse(DriverRead)`. `DriverMetricsResponse(DriverMetrics)` + `driver_name: str \| None`; `VehicleMetricsResponse(VehicleMetrics)` + `registration: str \| None`; `VehicleStreakResponse(VehicleStreak)` + `trips_since_last_incident: int` (**no registration**: the panel joins to the monthly rows by `vehicle_id`); `LaneMetricsResponse(LaneMetrics)` + `origin_precinct_name`, `destination_precinct_name: str \| None`; `FacilityMetricsResponse(FacilityMetrics)` + `precinct_name: str \| None`. |
| 6 | **Driver panel:** built **last**, trends only. Decision 06 (per-driver trends, no automated score) is recorded by a Jira comment on FP-156 that Tom posts. |
| 7 | **Unit tests** for `analytics_service`: yes (§0 #15). |
| 8 | **Frontend mechanics:** one private fetch helper plus a thin hook per grain (§0 #16). The streaks hook takes no range, so it doesn't refetch when the range changes. `MonthRangePicker` uses month and year selects, not `<input type="month">`, whose desktop browser support is patchy. |

---

## 1. Confirmed current repo state (verified 2026-09-11)

- Branch `fp-156-analytics-screen`, `HEAD` = `b06a3ac` after the §7 sync. That commit
  merged the fp-153 branch, which had itself merged `origin/dev` at `48b5605`. The branch
  now contains:
  - FP-153 (`e0cc8e4`, `1b29dea`)
  - this spec (`52b99bc`)
  - Chiko's PR #45 (`e6bbcae`)
- **Two Alembic heads on this branch since the sync:** `tom_analytics_read_models` and
  `chiko_receipt_hash_index`. Both have `down_revision = "ciaran_trip_history_page"`
  (confirmed by parsing the migration files; no alembic command was run). Before the sync
  the branch had the single head `tom_analytics_read_models`.
- **`dev` has moved since this branch was cut (found by `git fetch` in the 2026-09-11
  review).** Chiko's PR #45 (merge `e6bbcae`) added
  `backend/migrations/versions/2026_09_11_chiko_add_receipt_hash_index.py`: revision
  `chiko_receipt_hash_index`, `down_revision = "ciaran_trip_history_page"`. That is the
  **same parent** as FP-153's `tom_analytics_read_models`.
  - Once both are on one branch, Alembic has **two heads** and `alembic upgrade head`
    refuses to run. The likely fix is repointing `tom_analytics_read_models.down_revision`
    to `chiko_receipt_hash_index`. It is being coordinated with the team per CLAUDE.md, not
    fixed unilaterally.
  - This blocks *applying* FP-153. It does not block writing FP-156 code, because tests
    build their schema with `create_all`, not Alembic.
  - PR #45 also changed files FP-156 edits:
    - `frontend/dispatcher/components/layout/Sidebar.tsx`: new admin-only BLOCKCHAIN nav
      group and per-role filtering.
    - Its test, `components/layout/__tests__/Sidebar.test.tsx`.
    - `frontend/dispatcher/lib/constants/routes.ts`: new `blockchainReceipts` entry.
    - A new route, `frontend/dispatcher/app/(app)/blockchain/receipts/`.
  - **Synced 2026-09-11 (§7).** §4.1's line numbers are confirmed against this branch's
    working tree after the sync.
- FP-153's read layer is present exactly as its own build record describes, confirmed by
  reading the files directly (not the spec's description of them):
  - `backend/app/analytics/driver_metrics.py` — `get_driver_metrics(db, *, organization_id,
    start_month, end_month, driver_ids=None) -> list[DriverMetrics]`
  - `backend/app/analytics/vehicle_metrics.py` — `get_vehicle_metrics(...)`,
    `get_vehicle_streaks(db, *, organization_id, vehicle_ids=None) -> list[VehicleStreak]`,
    `trips_since_last_incident(db, *, organization_id, vehicle_id) -> int` (live query, no
    month range — matches spec §5's "not a stored column anywhere")
  - `backend/app/analytics/lane_metrics.py` — `get_lane_metrics(...)`, pools monthly arrays
    per lane and calls `DurationStats.from_values` once over the pooled list
  - `backend/app/analytics/facility_metrics.py` — `get_facility_metrics(...)`
  - `backend/app/schemas/analytics.py` — `DriverMetrics`, `VehicleMetrics`, `VehicleStreak`,
    `DurationStats`, `LaneMetrics`, `FacilityMetrics`, all `ConfigDict(frozen=True)`. Every
    rate is a `@computed_field` over stored raw counts, `None` on a zero denominator (see
    `safe_ratio`, `app/analytics/stats.py`). The module docstring (lines 1–15) states
    outright: **"No blended score exists anywhere here, by design."** There is no field
    resembling a driver risk score anywhere in this file.
- **Database reality — this corrects a wrong assumption made earlier in this planning
  session:**
  - `backend/.env.example:2` — `DATABASE_URL=postgresql+asyncpg://postgres:password@db.xxxx.supabase.co:5432/postgres`
  - `infrastructure/docker/docker-compose.dev.yml:3` — *"Database is Supabase-hosted
    Postgres — no local db service."*
  - There is **no per-developer local Postgres**. Running the FastAPI backend "locally"
    still connects to the one shared Supabase instance the whole team and the deployed app
    use. `TEST_DATABASE_URL` (`.env.example:10`, `localhost:5433`) is the only isolated
    database, and it is for `pytest` only.
  - **Explicit constraint from the developer, this session: no `alembic` command runs,
    against anything, until the `fp-153-analytics-read-models` branch is merged to `dev`.**
    This plan does not require one — see §3.4.
- Frontend dispatcher routes, confirmed via `find frontend/dispatcher/app/(app)`:
  `settings`, `exceptions`, `history`, `dev`, `sla`, `precincts`, `fleet`, `trips`
  (`origin/dev` additionally has `blockchain`). No `analytics` route exists yet.
- Existing UI kit, confirmed via `frontend/dispatcher/components/ui/`: `Tabs.tsx`,
  `DataTable.tsx`, `DateRangePicker.tsx`, `EmptyState.tsx`, `Spinner.tsx`, `Button.tsx`, and
  22 others. No shadcn, no other component library. `recharts@^3.8.1` is in
  `frontend/dispatcher/package.json:24` but has zero imports outside `node_modules` —
  installed, never used.

---

## 2. Cross-cutting rules inherited from FP-153 — not re-decided, just carried forward

These are facts about code that already exists and is frozen (FP-153 spec §11.2: *"Do not
change the view SQL or the metric definitions as part of FP-156"*). FP-156 reads through
them; it does not reinterpret them.

1. **No blended score, structurally, not by convention.** `schemas/analytics.py` has no
   field for one. This resolves Jira FP-156's "decision 06" (driver risk scores vs. trends)
   without FP-156 needing to make a UI-level judgment call: there is nothing to score with.
   The panel shows exactly the counts and rates the schema exposes.
2. **Every grain is org-scoped**, confirmed directly: every `app/analytics/*_metrics.py`
   function takes `organization_id` as a required keyword argument. FP-156's endpoints must
   pass `current_user.organization_id` here — never a client-supplied value.
3. **Rates are computed once, after summing** (`safe_ratio`, division only, never
   pre-divided) and are `None` — not `0` — when their denominator is zero. The frontend must
   render that `None` as "no data" (a dash), never as "0%".
4. **Severities stay separate counts** (`info_/warning_/critical_exceptions_count`,
   `mechanical_info_/warning_/critical_count`) — never summed into one number by the API or
   the UI.
5. **Vehicle streaks and "trips since last incident" are separate, un-monthed endpoints**
   (`get_vehicle_streaks`, `trips_since_last_incident`) — they do not take a month range and
   must not be forced into one.
6. **`confirmation_dwell_minutes_avg` carries a caveat in its own schema definition**
   (`schemas/analytics.py`, `@computed_field(description=...)`, confirmed: *"Not purely
   driver behaviour: a slow receiver at the destination also lengthens the gap..."*). This
   description string is the actual source of truth for that caveat's wording — pull it
   from there rather than re-composing it.
7. **Facility's `unwitnessed_count` is a real, separate signal**, not folded into the
   denominator of `corroboration_rate` (`schemas/analytics.py` — confirmed the computed
   field divides only by `confirmed_count + mismatch_count`).

---

## 3. Backend

### 3.1 New files

| File | Purpose |
|---|---|
| `backend/app/schemas/analytics_api.py` | Flat subclasses of the frozen `app/schemas/analytics.py` models that add the name fields (exact shapes: §0.1 #5). Never edits that file. |
| `backend/app/orchestration/analytics_service.py` | Calls `app.analytics.*`, then batch-looks-up display names: drivers and vehicles filtered by `organization_id`, precincts **by id only** (§3.3). Also attaches `trips_since_last_incident` to every row of the streaks result (§3.3). |
| `backend/app/api/v1/endpoints/analytics.py` | The router. |
| `backend/tests/integration/test_analytics_endpoints.py` | Endpoint contract tests. |
| `backend/tests/unit/test_analytics_service.py` | Unit tests for the service's pure name-attaching step (§0 #15). |

### 3.2 Auth and org scoping — confirmed pattern, not invented

`backend/app/auth/dependencies.py:195-249` — `get_current_dispatcher` returns a `UserRead`
directly (with `.organization_id`, `.id`, `.role` populated), after checking the token's
`app_metadata.role` is a dispatcher role. This is exactly what
`backend/app/api/v1/endpoints/precincts.py` uses for every **read** endpoint (`list_precincts_endpoint`,
line 46-50; `get_precinct_detail_endpoint`, line 115-119), reserving
`require_admin_dispatcher` only for writes (`create_precinct_endpoint`, line 60-64). FP-156
is entirely read-only, so every endpoint uses `Depends(get_current_dispatcher)`, and the
organisation always comes from `current_user.organization_id` — matching every call site in
`precincts.py` (lines 50, 68, 96, 124), never a query parameter.

### 3.3 Endpoints

All under `tags=["analytics"]`, all `async def`, all `Depends(get_db)` +
`Depends(get_current_dispatcher)`:

```
GET /api/v1/analytics/drivers?start_month&end_month
GET /api/v1/analytics/vehicles?start_month&end_month
GET /api/v1/analytics/vehicles/streaks        # each row also carries trips_since_last_incident
GET /api/v1/analytics/lanes?start_month&end_month
GET /api/v1/analytics/facilities?start_month&end_month
```

**There is no per-vehicle `trips-since-incident` endpoint (corrected 2026-09-11).** The
Vehicle panel would have called it once per table row, which means N+1 HTTP requests.
Instead:
- The service loops FP-153's `trips_since_last_incident` over the vehicles returned by
  `get_vehicle_streaks`, and returns the count inside each streaks row. That is one HTTP call.
- It is still one DB query per vehicle on the server, because FP-153's function is
  per-vehicle and frozen. That is acceptable at current fleet size, and it avoids editing
  FP-153 files.
- By construction the value equals the open segment of the streaks view (FP-153 §11.5).

`start_month`/`end_month` are inclusive first-of-month dates, matching the signatures in
§1. **A `ValueError` from `app.analytics.stats.validate_month_range` does not become a 422
automatically — this must be written explicitly.** Confirmed directly: `backend/app/main.py:150-151`
registers exactly one global exception handler, `@app.exception_handler(Exception)`, a
last-resort catch-all that returns 500 for anything reaching it uncaught. None of this
codebase's domain exceptions (`backend/app/core/exceptions.py` —
`ResourceNotFoundError`, `DuplicateResourceError`, etc.) have a global handler either; every
endpoint converts its own exceptions explicitly, exactly as `precincts.py`'s endpoints do
(e.g. `except ResourceNotFoundError as exc: raise HTTPException(status_code=404, ...)`,
lines 100-101). So each new analytics endpoint needs its own:

```python
try:
    ...
except ValueError as exc:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
```

Left unhandled, a bad month range would currently fall through to the bare-Exception handler
and return a 500, not a 422 — a real bug this plan would otherwise have shipped.

Declaring `start_month`/`end_month` as `date` query parameters gives FastAPI's own automatic
422 for a malformed date string. The explicit `except ValueError` is still required for the
rules FastAPI cannot see: a date that is not the first of a month, or a start after the end.

Name enrichment — confirmed fields, and how each lookup is scoped (corrected 2026-09-11):
- **Drivers:** `Driver.full_name` (`backend/app/db/models/people.py:57`). Line 31 is
  `User.full_name`, the dispatcher account, not the driver. `Trip.driver_id` is
  `ForeignKey("drivers.id")` (`backend/app/db/models/trips.py:173-174`), which settles the
  earlier open question. Filter `Driver.organization_id == organization_id`.
- **Vehicles:** `Vehicle.registration` (`backend/app/db/models/vehicles.py:60`). Filter
  `Vehicle.organization_id == organization_id`.
- **Precincts:** `Precinct.name` (`backend/app/db/models/organisations.py:46`). **Look up by
  id only. Do not filter by the operator's `organization_id`.**
  - A precinct belongs to the *client* organisation (`Precinct.principal_organization_id`,
    `organisations.py:48`). Dispatcher reads of precincts are "own org OR `is_shared`"
    (`backend/app/orchestration/precinct_service.py:10-11, 94-104`). An operator-org filter
    would therefore return no name for most client depots.
  - Looking up by id is safe: the lane and facility rows are already limited to this
    operator's own closed trips, so naming exactly those precinct ids reveals only places
    the operator's trucks already visited.
  - Do not reuse the `is_shared` visibility rule either. A precinct later switched to
    not-shared would lose its name from historical analytics.
- **A missing name** (for example, a deleted row) → return `null` and render "—". Never drop
  the metrics row.

Router registration: `backend/app/main.py` (shared file) — add the import alphabetically
among the existing `app.api.v1.endpoints.*` imports and `app.include_router(analytics_router,
prefix="/api/v1")` alongside the existing block. **Must be flagged in TASK COMPLETE.**

### 3.4 No Alembic, anywhere, in this ticket

Nothing in §3 requires a schema change — `analytics_api.py` and `analytics_service.py` only
read existing, already-migrated tables/views. Correctness of the endpoint is proven the same
way FP-153 proved the view SQL: by loading the migration's own `UPGRADE_STATEMENTS` inside a
test transaction against the throwaway pytest database (`TEST_DATABASE_URL`,
`localhost:5433` — never the shared Supabase instance), exactly as
`backend/tests/integration/test_analytics.py`'s `views` fixture already does (lines 67-76,
316-319). This never touches Supabase and needs no `alembic upgrade` command from anyone,
satisfying the developer's explicit constraint.

### 3.5 Tests

Primary template: `backend/tests/integration/test_trip_history.py` — the spec's own
recommendation (FP-153 §11.9), confirmed to have exactly the pattern needed:
- `override_get_db` fixture (lines 48-55) swaps in the test's `db_session`.
- `auth_header`/`make_token` from `tests.conftest` (imported line 22) build a real dispatcher
  JWT for a given `org_id`.
- A **cross-org seed helper** (`_seed_other_org`, starting line 96) — exactly what's needed
  to prove operator B's data never appears for operator A, which §11.9 requires explicitly.

Secondary reference: `backend/tests/integration/test_precincts.py` for the simpler
org-scoped-GET shape (lines 21-54) when a full trip-history-style seed isn't necessary.

Test cases: FP-153 §11.9's list (1–5), plus 6–7 added by the 2026-09-11 review:
1. 200, hand-computed values against a small seed (one org, one closed trip with known phase
   events) — not re-deriving FP-153's own metric math, which `test_analytics.py`'s 14 tests
   already cover.
2. 403 — missing token; 401 — invalid or expired token (corrected, §0 #13).
3. 422 — malformed month range (`validate_month_range` raising `ValueError`) and a
   malformed date string (FastAPI's own validation).
4. Cross-org isolation — via the `_seed_other_org` pattern.
5. 403 — a driver-role token rejected by `get_current_dispatcher`'s role check (confirmed:
   `backend/app/auth/dependencies.py` `_require_dispatcher_role` raises
   `HTTP_403_FORBIDDEN`).
6. A precinct owned by the **client** organisation (`principal_organization_id` = client,
   `is_shared = false`), visited by the operator's trip, still gets its name in the lane and
   facility responses. This guards the §3.3 scoping correction.
7. Every streaks row carries `trips_since_last_incident`, equal to calling
   `trips_since_last_incident()` directly for that vehicle.
8. Unit (`tests/unit/test_analytics_service.py`): a missing name gives `None`, and the row is
   kept, in its original order (§0 #15).

Run one pytest at a time. The local test database is shared by every pytest process on
the machine (FP-153 §11.7).

`views` fixture: a **local copy** of the pattern in `test_analytics.py` (own
`_load_migration`/`_MIGRATION`/`views` fixture), not an import — this keeps FP-153's own
test file untouched, per the Prime Directive (don't touch files outside this ticket's scope
without a reason).

---

## 4. Frontend

### 4.1 Route and navigation

- `frontend/dispatcher/app/(app)/analytics/page.tsx`, `'use client'` — matches every
  existing dispatcher page (`history/page.tsx:1`, confirmed directly; no dispatcher page
  uses server-side data fetching despite CLAUDE.md's stated Server Component preference).
  **This is not a deprecation.** Note it in TASK COMPLETE as a gap between CLAUDE.md's
  Server Component preference and the actual codebase (corrected 2026-09-11; this bullet
  previously said "Deprecation warnings"). Follow the existing pattern rather than
  introducing a new per-ticket data-fetching pattern
  (`api.get<T>` relies on a browser-side Supabase session token — `lib/api/client.ts:67-76`
  — with no server-side equivalent anywhere in this app).
- `frontend/dispatcher/components/layout/Sidebar.tsx` — add an item to `NAV_GROUPS`. Line
  numbers below are confirmed against this branch after the §7 sync:
  - `NAV_GROUPS` starts at line 28, with groups OVERVIEW, TRIPS, FLEET and so on. There is
    now an admin-only BLOCKCHAIN group (from line 62), and groups are filtered per role
    through `visibleGroups` (line 144).
  - Follow the existing `{ label, href: ROUTES.x, icon, activePatterns }` shape (e.g. the
    Exceptions entry at line 43).
  - Analytics is for **all** dispatchers: the endpoints use `get_current_dispatcher`, not
    `require_admin_dispatcher`. So it gets no admin-only flag. It goes in **OVERVIEW, under
    Dashboard** (§0.1 #2).
- `frontend/dispatcher/components/layout/__tests__/Sidebar.test.tsx` (exists on `dev`) — add
  a test that the Analytics link renders for a regular dispatcher, in the style of "links to
  the exceptions queue" (line 79).
- `frontend/dispatcher/lib/constants/routes.ts` — add `analytics: '/analytics'` alongside
  the existing flat entries. On `origin/dev` the `ROUTES` object spans lines 4-24 and now
  includes `blockchainReceipts` (line 20).

### 4.2 Data flow — real API only, no mock layer, resolved after direct verification

Confirmed directly: no dispatcher page swaps in mock data at runtime (a grep for non-test
imports of `frontend/shared/lib/mocks/` in `app/(app)/**/page.tsx` returns nothing). The
FP-153 spec's suggestion to build against mocks while the migration isn't yet on Supabase
does not match any existing pattern in this codebase, and was rejected for this plan.
Instead:

- **Presentational panel components take data as props.** They can be built and manually
  checked today using a hand-written example object shaped exactly like §1's confirmed
  Pydantic models — no backend, no database, no Supabase connection needed for this part.
- **One hook per grain**, following `useTripHistory.ts`'s pattern (not `useAsyncData`, §0 #16): builds a query
  string (lines 45-54), calls `api.get<T>(path)` (line 111), tracks `isLoading`/`error`/
  data in state. This always calls the **real** endpoint — nothing to toggle, nothing to
  remember to switch over later.
- Because the hook always hits the real endpoint, the screen shows live data the moment the
  FP-153 migration is applied to the shared Supabase database and a real closed trip exists
  — automatically, with no frontend change. Until then the backend answers **HTTP 500**:
  the query fails with `relation "driver_analytics" does not exist`, which reaches
  `main.py:150`'s catch-all handler. That is an error, not an empty list. `api.get<T>`
  therefore throws an `ApiError` (`lib/api/client.ts:35-45`), which the panel renders through `DataTable`'s existing `error`/
  `onRetry` prop path (`DataTable.tsx:38-53`) — the same failure path every other page
  already has, not a new one.
- **Local `DEMO_MODE` shows only the demo company's data (added 2026-09-11).** With
  `DEMO_MODE=true`, `get_current_dispatcher` returns a fixed stub user whose
  `organization_id` is `00000000-0000-0000-0000-000000000002`
  (`backend/app/auth/dependencies.py:47-60`, "must match the org created by DB seeds").
  Because every analytics endpoint scopes by `current_user.organization_id`, a local
  demo-mode screen shows only closed trips belonging to that org. An empty screen locally
  can therefore mean "no closed demo-org trips", not a bug. Real dispatcher logins see their
  own org.

### 4.3 Components

- `frontend/dispatcher/components/ui/MonthRangePicker.tsx` (new) — modeled on
  `DateRangePicker.tsx`'s `{value, onChange}` props shape (lines 13-18), but month-only, per
  the developer's explicit decision (free start/end month choice, no presets). This is a
  distinct control from `DateRangePicker` (day-granularity `DateRange` type,
  `lib/types/date-range.ts`), not a duplicate of it.
  - **Default on first load (confirmed 2026-09-11, §0.1 #1):** the current month and the
    two before it (3 months inclusive), computed in `Africa/Johannesburg` with
    `Intl.DateTimeFormat`, as `history/page.tsx:24-37` does. Not the browser's local
    calendar (§0 #14). SAST is also the views' month boundary (FP-153 Q4).
  - It must only ever emit first-of-month dates, and must not allow a start after the end.
- `Tabs.tsx` (existing, unmodified) — `Tab[]` array (`{id, label}`), ordered **Facility,
  Vehicle, Lane, Driver**, matching Ciaran's sequencing comment on the FP-156 Jira ticket
  (verified 2026-09-11, §0 #17). Facility is selected on first load.
- `DataTable.tsx` (existing, unmodified) — its `Column.render` function
  (`DataTable.tsx:11`) is exactly where the "67% (2/3)" and "—" display rules get
  implemented, per-column.
- `frontend/shared/lib/types/analytics.ts` (new) — mirrors the wrapped response shapes,
  following `precinct.ts`'s exact conventions: branded id types (line 7-8), `| null` on
  every denominator-zero field, a header comment naming the backend schema it mirrors
  (lines 1-3).

### 4.4 Panel-specific requirements

- **FacilityPanel** — `confirmed_count`/`mismatch_count`/`unwitnessed_count` +
  `corroboration_rate`. Reuses `PhaseLocationSection.tsx`'s copy (lines 57-59) for
  *"Confirmed ✓"* and *"Mismatch ✗"*. The unwitnessed column is headed **"Unwitnessed (no
  Pulsit reading)"**, not "Awaiting Pulsit": that is live-trip copy, and on a closed trip
  the reading was never taken (§0 #18).
- **VehiclePanel** — the monthly `vehicle_analytics` numbers, **plus** the streaks
  endpoint's per-vehicle `highest_streak_trips`, `lowest_streak_trips` (nullable, shown as
  "—") and `trips_since_last_incident`, shown next to them. That is one extra call in total,
  not one per row (§3.3). This is FP-153 §11.9's explicit requirement, and it is easy to drop
  silently because the streaks endpoint has no month range.
- **LanePanel** — `DurationStats` (mean/min/max/median/p90) for both `actual_transit_minutes`
  and `schedule_delta_minutes`, plus `exception_density`.
- **DriverPanel** — trend counts/rates only. No score column exists to add one — see §2.1.
  `confirmation_dwell_minutes_avg`'s caveat text is pulled from the schema's own
  `computed_field` description, not re-written.

### 4.5 Display rules — restated verbatim, not left to memory (FP-153 §11.9)

- Every rate shown with its counts, e.g. "67% (2/3)". "—" for `null`, never "0%".
- Severities always separate counts, never blended.
- The confirmation-dwell caveat is visible next to that specific number.
- `unwitnessed_count` shown as its own Pulsit-coverage figure, not folded into the rate.
- A visible note that only **closed** trips are counted.
- A static label with confirmed wording (§0.1 #4): *"Closed trips only. Figures update
  periodically, so a recently closed trip may take a while to appear."* No live timestamp,
  no backend change. It deliberately claims no interval, because nothing in the repo runs
  Celery beat (§0 #19).

### 4.6 Frontend tests (added 2026-09-11)

The dispatcher already has vitest and Testing Library (`frontend/dispatcher/package.json`:
`"test": "vitest run"`, plus `@testing-library/react` and `@testing-library/user-event`).
Existing examples:
- `components/ui/Modal.test.tsx`, `components/ui/Pagination.test.tsx`,
  `components/blockchain/VerifyButton.test.tsx`
- On `dev`: `components/blockchain/ReceiptLookup.test.tsx`, and the hook test
  `lib/hooks/useBlockchainReceiptLookup.test.tsx`, which is the closest template for testing
  a data-fetching hook.

Tests to write:
- **Display formatting as pure functions** (for example in `frontend/dispatcher/lib/format/`),
  each unit-tested: a rate with its counts renders as "67% (2/3)", and `null` or a zero
  denominator renders as "—", never "0%".
- **`MonthRangePicker`:** default range on first load, a start after the end is prevented,
  and only first-of-month values are emitted.
- **One test per hook:** the query string it builds, and its error path when `api.get`
  throws.
- **Panel render tests:** `null` shows "—", the confirmation-dwell caveat text is visible,
  and `unwitnessed_count` is shown separately from `corroboration_rate`.
- **The Analytics link in `Sidebar.test.tsx`** (§4.1).

Run with `cd frontend/dispatcher && npm test`.

---

## 5. Explicitly out of scope

- `app/analytics/*`, `app/schemas/analytics.py`, the FP-153 migration file — frozen, per its
  own build record §11.2. Not edited by this ticket.
- **No `alembic` command of any kind**, against any database, run by this ticket — explicit
  developer constraint, this session.
- No write of any kind to the shared Supabase database.
- No mock-data-at-runtime layer — rejected after verifying no such pattern exists in this
  codebase (see §4.2).
- No new UI/component library (no shadcn) — Ciaran's FP-156 Jira comment: *"Use the existing
  component library."*
- No chart in this first cut — `recharts` stays installed-but-unused; FP-153 §11.9: *"Tables
  carry most of the information; add charts only where they help."*
- Driver risk score — no field exists to display one (§2.1).
- Kilometers, route repetition, precinct dwell time — explicitly dropped in FP-153 §7/§8, not
  silently re-added.
- A live "last refreshed" timestamp — developer's decision, static label instead.
- A per-vehicle `trips-since-incident` endpoint — folded into the streaks response instead
  (§3.3).

---

## 6. Open items — carried forward honestly, not resolved by this plan

- **The FP-153 migration is still not applied to the shared Supabase database**, and won't
  be attempted by this ticket. Until a teammate coordinates and runs it (after the fp-153
  branch merges to `dev`, per the developer's constraint), every analytics endpoint will
  return **HTTP 500** (`relation ... does not exist`) against the real shared environment.
  That is expected, not a defect in this ticket's code.
- **FP-243–FP-246 (the FP-156 Jira subtasks) have no description text**, confirmed directly
  via the Jira API (`description: null` on all four) — only titles. The panel-by-panel
  breakdown in §4.4 and the "component tests" reading of FP-246 in §4.6 are this document's
  inference from the parent ticket and Ciaran's comment, not confirmed subtask scope.
- **KPI confirmation with Bruce**, flagged as outstanding in FP-153 §10, is still outstanding
  — not resolved by this plan either.
- **Demo-day seed data** (realistic closed trips with phase events and exceptions across
  several drivers/vehicles/precincts) is not built by this ticket, but is needed regardless
  of anything decided here — tracked in FP-153 §11.9 ("Suggested order": prepare closed
  demo trips). (Corrected 2026-09-11: this previously cited "§11.8 item 4", which is the
  post-migration checks.)
- **Two Alembic heads after syncing with `dev`** (§1): `chiko_receipt_hash_index` and
  `tom_analytics_read_models` share the parent `ciaran_trip_history_page`. The fix is being
  coordinated with the team and belongs on the `fp-153-analytics-read-models` branch, not in
  this ticket. Until it lands, nobody runs `alembic upgrade` (the developer's constraint
  already covers this).
- **Nothing in the repo runs Celery beat** (updated 2026-09-11):
  - Compose runs `celery -A app.tasks worker` without `-B` (`docker-compose.dev.yml:73`).
  - The repo has no Railway config for the deployed backend (`README.md:396`).
  - After the FP-153 migration, the views would be built once (`WITH DATA`) and never
    refresh.

  The label no longer claims an interval (§4.5). Where beat runs is a team decision (§6.1).

### 6.1 For the next team meeting

1. **Celery beat.** Nothing runs it, so after the FP-153 migration the analytics views would
   never refresh. The Parcel Perfect poll's beat entry is affected the same way (FP-153
   §11.6). Decide where beat runs on Railway.
2. **Two Alembic heads.** `tom_analytics_read_models` and `chiko_receipt_hash_index` share a
   parent. Agree the `down_revision` fix on the fp-153 branch.
3. **Decision 06.** Tom posts a comment on FP-156 recording "per-driver trends, no automated
   score".
4. **FP-156 is marked Done in Jira** (last updated 7 Sep), while FP-243 to FP-246 are all
   To Do.
5. **KPI confirmation with Bruce** is still outstanding (FP-153 §10, §11.8 item 5).
6. **Unhandled 500s reach the browser as "Load failed"** (§0 #20). `main.py`'s catch-all
   handler sits outside CORS, so the response carries no CORS header. The client then
   treats it as a network failure: it retries once, then shows a generic error instead of
   the server's message. This is a shared-file fix for the whole app, not for FP-156.

---

## 7. Sync with `dev` — DONE 2026-09-11

Chiko's PR #45 changed three files FP-156 edits (§1), so the sync was done **before**
writing any code, to avoid conflicts later. **It is complete — results are at the end of
this section.** The steps are kept as the record, and as the recipe for bringing later
FP-153 changes (such as the `down_revision` fix) into this branch. Use
`git merge --no-edit …` to skip the commit-message editor. The developer runs every git
write command; Claude does not (CLAUDE.md).

```
# on fp-156-analytics-screen: commit this spec first so nothing is left loose
git add docs/design-notes/2026-09-11-fp156-dispatcher-analytics-screen-spec.md
git commit -m "docs: add FP-156 build spec"

# 1. bring dev into the FP-153 branch
git checkout fp-153-analytics-read-models
git fetch origin
git merge origin/dev
git push

# 2. bring the updated FP-153 branch into FP-156
git checkout fp-156-analytics-screen
git merge fp-153-analytics-read-models
git push -u origin fp-156-analytics-screen   # first push of this branch
```

What to expect:
- Both merges should be clean. FP-153 touched none of PR #45's files, and FP-156 has no
  code yet.
- After step 1 the FP-153 branch shows **two Alembic heads** (§6). That is expected and
  harmless while nobody runs `alembic upgrade`.
- When the team agrees the `down_revision` fix, it is committed on
  `fp-153-analytics-read-models`, then brought into FP-156 the same way as step 2.

Then confirm the base is green before building, one run at a time:
1. `cd backend && pytest`
2. `cd frontend/dispatcher && npm test`

If either fails, stop and investigate before starting FP-156 work.

**Results (2026-09-11):**
- **Merges were clean:**
  - `48b5605` brought `origin/dev` into fp-153. It was completed with
    `git commit --no-edit` after the commit-message editor failed.
  - `b06a3ac` brought fp-153 into fp-156.
- **Frontend `npm test`:** 44 files, **485 tests passed**.
- **Backend `pytest`** (isolated throwaway database): **1322 passed, 4 skipped, 1 failed.**
  - The failure was `tests/integration/test_drivers.py::test_create_driver_appears_in_subsequent_list`,
    which returned 504. A real Hedera testnet `submit_hash` call ran past the 15 s
    `HEDERA_SUBMIT_TIMEOUT_SECONDS` limit.
  - Re-run alone, it passed both times (8.2 s and 10.3 s).
  - Chiko's PR #45 changed no submit or timeout logic in `app/blockchain/anchor_service.py`.
  - Classified as a transient Hedera testnet timeout, not a regression. **The base is
    green.**

---

## 8. Build record — COMPLETE (2026-09-11)

### 8.0 Status

- Built on `fp-156-analytics-screen` in three stages. Tom reviewed each one before the next
  began: backend, then frontend building blocks, then panels and page.
- Checked in the browser by Tom on 2026-09-11 against the real local backend (§8.6).
- **Not merged.** FP-156 depends on FP-153, which is also unmerged, and whose migration is not
  applied to Supabase. Until it is, every tab shows its error state (§8.6, §8.7).
- No Alembic command was run, no migration file was touched, and no FP-153 file was edited
  (`app/analytics/*`, `schemas/analytics.py`, the migration, `test_analytics.py`).

### 8.1 Backend — what was built

Five read-only endpoints, all `tags=["analytics"]`, `async`, using `get_db` and
`get_current_dispatcher`. Any dispatcher may call them, not only admins. The organisation
always comes from the token, never from the request.

| Endpoint | Response | Notes |
|---|---|---|
| `GET /api/v1/analytics/facilities?start_month&end_month` | `list[FacilityMetricsResponse]` | + `precinct_name` |
| `GET /api/v1/analytics/vehicles?start_month&end_month` | `list[VehicleMetricsResponse]` | + `registration` |
| `GET /api/v1/analytics/vehicles/streaks` | `list[VehicleStreakResponse]` | No month range. + `trips_since_last_incident` on every row |
| `GET /api/v1/analytics/lanes?start_month&end_month` | `list[LaneMetricsResponse]` | + `origin_precinct_name`, `destination_precinct_name` |
| `GET /api/v1/analytics/drivers?start_month&end_month` | `list[DriverMetricsResponse]` | + `driver_name` |

Status codes, all tested:
- **200:** the rows. An empty list when there are no closed trips.
- **403:** a missing token, or a driver token.
- **401:** a malformed or expired token.
- **422:** a date string that is malformed or missing (FastAPI's own validation), or a
  mid-month date, or a start after the end (explicit, see below).

Files:
- `backend/app/schemas/analytics_api.py`: five flat subclasses of the frozen FP-153 models.
  They add only the name fields, so every computed rate is inherited (§0.1 #5).
- `backend/app/orchestration/analytics_service.py`:
  - `check_month_range`: wraps FP-153's `validate_month_range`, so the endpoint never
    reaches below the orchestration layer.
  - Pure `attach_driver_names`, `attach_vehicle_registrations`, `attach_lane_names` and
    `attach_facility_names`. They keep each row and its order, and a missing name becomes
    `None`. They rebuild each response from the row's stored fields, so the rates are
    recomputed from the same counts.
  - One name query per grain. Drivers and vehicles are filtered by `organization_id`;
    precincts are looked up **by id only** (§3.3). Every rule is in the module docstring.
  - `list_*`, one per endpoint. Streaks run FP-153's `trips_since_last_incident` once per
    vehicle, one after another (a single `AsyncSession` runs one statement at a time).
- `backend/app/api/v1/endpoints/analytics.py`: the router. Only `check_month_range` sits
  inside the `try` that turns `ValueError` into a 422. Any other `ValueError` is a defect
  and still surfaces as a 500, following the trip-history precedent
  (`test_history_does_not_misreport_non_cursor_value_errors_as_422`).
- `backend/app/main.py` (**shared file**): one import and one `include_router`.

### 8.2 Frontend — what was built

- **Route `/analytics`** (`frontend/dispatcher/app/(app)/analytics/page.tsx`, `'use client'`
  like every dispatcher page):
  - Layout: TopBar, the `MonthRangePicker`, then the closed-trips note, then the tabs
    **Facility, Vehicle, Lane, Driver**, with Facility selected on load.
  - A `role="tabpanel"` region holds a section header and the active panel.
  - One small connector per tab, so **only the visible tab fetches**. Switching tabs
    refetches.
- **Navigation:**
  - `lib/constants/routes.ts`: `analytics: '/analytics'`.
  - `components/layout/Sidebar.tsx`: an "Analytics" link in OVERVIEW under Dashboard,
    with the `bars` icon and no admin-only flag.
- **Types:** `frontend/shared/lib/types/analytics.ts` mirrors the five responses. Every rate
  and average is `number | null`, and ids use the existing `DriverId`, `VehicleId` and
  `PrecinctId` types.
- **Formatting:** `lib/format/analytics.ts`:
  - `fmtRate` gives "67% (2/3)". `fmtRatio` gives "1.50 (3/2)", used for exceptions per
    trip.
  - `fmtMinutes` gives "2 h 15 m", and `fmtHours` uses the same form.
  - `fmtScheduleDelta` reuses `fmtDelay` from `schedule.ts`, so "late" and "early" mean the
    same thing everywhere.
  - `fmtOptionalCount` shows a missing count as "—" and a real 0 as 0.
  - `NO_DATA = '—'`.
- **Month logic:** `lib/format/month.ts`:
  - The current month comes from the `Africa/Johannesburg` calendar (§0 #14).
  - `defaultMonthRange()` gives that month plus the two before it.
  - Helpers: `addMonths`, `toMonth`, `parseMonth`.
  - The `MonthRange` type lives in `lib/types/month-range.ts`.
- **`components/ui/MonthRangePicker.tsx`:**
  - Month and year selects for From and To, reusing `Select`.
  - It only ever emits first-of-month dates.
  - The bound the dispatcher moves wins and the other follows it, so the range is never
    inverted.
  - Months after the current SAST month are disabled, and a year change that would land in
    one is pulled back.
  - The earliest year is 2020, matching the history page.
- **`lib/hooks/useAnalytics.ts`:**
  - One private fetch helper, following the `useTripHistory` pattern (not `useAsyncData`,
    §0 #16).
  - A generation counter throws away a slow reply for an old range.
  - Rows are cleared when the range changes, so old numbers never sit under a new label.
  - `refetch` for retry.
  - Hooks: `useFacilityAnalytics`, `useVehicleAnalytics`, `useLaneAnalytics` and
    `useDriverAnalytics`. `useVehicleStreaks` takes no range, so it never refetches on a
    range change.
- **`lib/hooks/useSortedRows.ts`:** client-side sorting for `DataTable`. Clicking a column
  flips its direction or sorts a new column ascending. No data always sorts **last**, in
  both directions.
- **`components/analytics/`:**
  - `FacilityPanel`: Precinct, Corroboration rate, Confirmed ✓, Mismatch ✗, and
    **Unwitnessed (no Pulsit reading)**. A note explains the rate's denominator.
  - `VehiclePanel`:
    - Registration, Trips, and mechanical info, warning and critical as separate columns.
    - Mean time between breakdowns, driving time, longest clean streak, shortest completed
      streak, and trips since last incident.
    - `joinStreaks` joins the single streaks response onto the monthly rows by
      `vehicle_id`.
    - A note says streaks cover the vehicle's whole history.
  - `LanePanel`:
    - Lane ("origin → destination"), Trips, Exceptions per trip, Transit time, and Against
      schedule.
    - Each duration cell leads with the median and P90, with the mean, range and number of
      trips beneath.
    - A note explains which trips count against schedule.
  - `DriverPanel`:
    - Driver, Trips, and Trips with exceptions.
    - Info, warning and critical exceptions as separate columns.
    - On-time departures, dispatcher overrides, and average activation, loading, departure,
      unloading and confirmation times.
    - The confirmation column carries a † pointing to the caveat under the table.
  - `copy.ts`: all analytics copy. The confirmation caveat is copied **verbatim** from the
    backend schema's `computed_field` description; keep the two in step.

### 8.3 Display rules, as implemented

- Every rate is shown with its counts ("67% (2/3)"). A null, or a zero denominator, reads
  "—", never "0%".
- Severities are separate columns. The API's `total_exceptions_count` and
  `mechanical_exceptions_count` are **not shown**, so nothing on screen is a merged number.
- There is **no score, rating or rank column**, and a test checks for this. Every table opens
  sorted by name, so the driver tab never opens as a ranking (decision 06).
- The confirmation caveat is visible beside that column, via †.
- Unwitnessed is its own column and is kept out of the corroboration rate. "Awaiting Pulsit"
  is never used for a closed trip (§0 #18).
- Page note, with the confirmed wording: *"Closed trips only. Figures update periodically, so
  a recently closed trip may take a while to appear."*
- A missing name reads "—", and the row is always kept.

### 8.4 Deviations from §3–§4 (all deliberate)

- **Four files not named in §4:** `lib/format/month.ts`, `lib/types/month-range.ts`,
  `lib/hooks/useSortedRows.ts` and `components/analytics/copy.ts`.
- **Where the copy lives:** analytics copy is in `components/analytics/copy.ts`, not in
  `shared/lib/constants/copy.ts`. That file is imported by both apps, and these strings are
  dispatcher-only. Only 6 dispatcher files use the shared `COPY` anyway.
- **Month-range check placement:** `check_month_range` lives in the service, not the
  endpoint, to keep the layering. It is the only call inside the 422 `try`.
- **Totals not displayed**, as in §8.3.
- **Only the active tab fetches**, rather than all five requests on every visit.
- **No page-level test.** The page was verified in the browser instead (§8.6).

### 8.5 Tests and verification

- **Backend: 61 new tests.**
  - `tests/unit/test_analytics_service.py` (11): month-range checks, missing name gives
    `None` with the row kept, order kept, stored counts and computed rates unchanged, each
    lane end named independently, unwitnessed kept out of the facility rate.
  - `tests/integration/test_analytics_endpoints.py` (50, including parametrized cases):
    - Every status code in §8.1.
    - A service `ValueError` is not misreported as a 422.
    - Empty lists when there are no trips.
    - Hand-computed values for every grain, from one seeded timeline.
    - A client-owned, non-shared precinct is still named.
    - Another organisation's driver comes back with a null name.
    - Isolation between operators on a shared lane.
    - Streak rows equal a direct `trips_since_last_incident()` call.
  - It uses a local copy of FP-153's `views` fixture, which runs the migration's own
    `UPGRADE_STATEMENTS` inside a rolled-back transaction.
- **Frontend: 77 new tests.**

  | File | Tests |
  |---|---|
  | `format/month.test.ts` | 8 |
  | `format/analytics.test.ts` | 17 |
  | `MonthRangePicker.test.tsx` | 7 |
  | `useAnalytics.test.tsx` | 11 |
  | `useSortedRows.test.ts` | 5 |
  | `FacilityPanel.test.tsx` | 7 |
  | `VehiclePanel.test.tsx` | 8 |
  | `LanePanel.test.tsx` | 7 |
  | `DriverPanel.test.tsx` | 6 |
  | `Sidebar.test.tsx` | +1 |
- **Final results:**
  - Backend: **1384 passed, 4 skipped**, which is 1323 base tests plus 61 new. ruff and
    mypy are clean.
  - Frontend: **562 passed** (53 files). `tsc --noEmit` and eslint are clean.
- **To re-run:**
  - `cd backend && pytest tests/unit/test_analytics_service.py tests/integration/test_analytics_endpoints.py`
  - `cd frontend/dispatcher && npm test`
- **Caution:** run one backend pytest at a time, because the local test database is shared.
  The project's Stop hook runs the backend unit tests at the end of every Claude turn. A full
  suite left running in the background across a turn end collides with it, so run the full
  suite in the foreground (about 5 minutes).

### 8.6 Browser check (2026-09-11)

Tom ran the backend (`uvicorn`, port 8000) and the dispatcher (`npm run dev`, port 3000)
locally, and logged in with a real account. `DEMO_MODE` was off: an unauthenticated request
got 403.

Confirmed on screen:
- The Analytics link is lit in OVERVIEW.
- The default range is July–September 2026.
- The tab order is right, with Facility on load, and each tab has its section title.
- The closed-trips note, the facility and lane notes, the whole-history streaks note, and
  the † confirmation caveat are all present.

Every tab shows **"Failed to load" with Try again**. This is expected, because the FP-153
views don't exist on Supabase yet. The message reads `Request to … failed: Load failed`
rather than the server's 500. That is §0 #20: `main.py`'s catch-all 500 carries no CORS
header, so the browser discards it. An in-process simulation proved this. It affects the
whole app, not just FP-156, and is on the team list.

### 8.7 Still open — none of it is FP-156 code

1. **The FP-153 merge, then applying its migration to Supabase**, after the two-heads fix
   (§6). Until then every analytics endpoint returns 500 on the shared DB. Once FP-153
   merges to `dev`, Tom brings FP-156 up to date with `dev`.
2. **Celery beat** runs nowhere, so without it the views never refresh (§6.1 #1).
3. **Unhandled 500s reach the browser as "Load failed"** (§0 #20, §6.1 #6).
4. **Decision 06:** Tom posts this comment on FP-156:
   > **Decision 06: the driver panel shows per-driver trends, not an automated score.** The
   > panel shows trips, exceptions by severity, on-time departures, time in each phase and
   > overrides, every rate beside its counts. There is no score, rating or ranking.
   > - **POPIA:** a score from drivers' location and phase data would be automated profiling
   >   of employees.
   > - **FP-153 §3 rule 4:** there is no defensible weighting for a blended score.
   > - **The data itself:** the schema has no score field
   >   (`app/schemas/analytics.py`: "No blended score exists anywhere here, by design").
   >
   > The facility, vehicle and lane panels come first, so a depot or truck problem isn't read
   > as a driver problem.
5. **Jira:** FP-156 is marked Done while FP-243 to FP-246 are To Do. Close the subtasks
   when this merges.
6. **Demo-day seed data:** realistic closed trips, so the screen isn't empty (FP-153 §11.9).
7. **KPI confirmation with Bruce** is still outstanding.

### 8.8 After the migration is applied — what to check

- Open `/analytics`. Every tab should load tables, not the error state.
- Compare one well-understood closed trip against its phase ledger: facility counts, lane
  transit time, and the driver's time in each phase.
- Change the month range and confirm the tables refetch. Confirm "—" appears where a
  denominator is zero, never "0%".
- If the numbers never change after new trips close, Celery beat isn't running (§8.7 #2).
