# FP-156 — Dispatcher Analytics Screen — Build Spec

Author: Tom (Thomas Davis), with Claude · Written 2026-09-11
Status: **PLANNING — not yet executed. Reviewed against the live repo and corrected on
2026-09-11 (see §0). Sync with `dev` before executing (see §7).** Every claim below was verified against the live
repo (file + line cited) on 2026-09-11, after an earlier attempt this session went wrong
(a research subagent wrote unrequested code; a wrong assumption about local infra was
corrected). Nothing here is carried over from that attempt without being re-checked.
Branch: `fp-156-analytics-screen`, confirmed created off `fp-153-analytics-read-models`.

## How to use this document

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
| 1 | `dev` moved (Chiko's PR #45). Its migration shares a parent with FP-153's, which gives two Alembic heads. It also changed `Sidebar.tsx`, `Sidebar.test.tsx` and `routes.ts`, which FP-156 edits. **Sync before executing.** | §1, §4.1, §6, §7 |
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

---

## 1. Confirmed current repo state (verified 2026-09-11)

- Branch `fp-156-analytics-screen`, current `HEAD` = `1b29dea` (`docs: add FP-153 build
  record and FP-156 handoff`), one commit after `e0cc8e4` (`feat(db): add FP-153 analytics
  materialized views, read layer and refresh task`) — confirmed via `git log --oneline -5`.
  Working tree is clean (`git status`).
- Single Alembic head: **`tom_analytics_read_models`**, confirmed by parsing every
  `revision`/`down_revision` pair in `backend/migrations/versions/*.py` — no migration has
  landed on top of it on this branch.
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
  - **Sync with `dev` before touching these (§7).** §4.1 cites the post-sync (`origin/dev`)
    line numbers.
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
| `backend/app/schemas/analytics_api.py` | Thin response wrappers adding a `name` (or `registration`) field around the frozen `app/schemas/analytics.py` models. Never edits that file. |
| `backend/app/orchestration/analytics_service.py` | Calls `app.analytics.*`, then batch-looks-up display names: drivers and vehicles filtered by `organization_id`, precincts **by id only** (§3.3). Also attaches `trips_since_last_incident` to every row of the streaks result (§3.3). |
| `backend/app/api/v1/endpoints/analytics.py` | The router. |
| `backend/tests/integration/test_analytics_endpoints.py` | Endpoint contract tests. |

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
2. 401 — missing/invalid token.
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
  numbers below are for the **post-sync `origin/dev` version** (§7):
  - `NAV_GROUPS` starts at line 28, with groups OVERVIEW, TRIPS, FLEET and so on. There is
    now an admin-only BLOCKCHAIN group (from line 62), and groups are filtered per role
    through `visibleGroups` (line 144).
  - Follow the existing `{ label, href: ROUTES.x, icon, activePatterns }` shape (e.g. the
    Exceptions entry at line 43).
  - Analytics is for **all** dispatchers: the endpoints use `get_current_dispatcher`, not
    `require_admin_dispatcher`. So it gets no admin-only flag. Which group it sits in is a
    PLAN-time choice.
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
- **One hook per grain**, following `useTripHistory.ts`'s exact pattern: builds a query
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

### 4.3 Components

- `frontend/dispatcher/components/ui/MonthRangePicker.tsx` (new) — modeled on
  `DateRangePicker.tsx`'s `{value, onChange}` props shape (lines 13-18), but month-only, per
  the developer's explicit decision (free start/end month choice, no presets). This is a
  distinct control from `DateRangePicker` (day-granularity `DateRange` type,
  `lib/types/date-range.ts`), not a duplicate of it.
  - **Default on first load (proposed 2026-09-11, confirm in the PLAN):** the current month
    and the two before it (3 months inclusive), taken from the browser's local calendar.
    Dispatchers operate in SAST, which is also the views' month boundary (FP-153 Q4).
  - It must only ever emit first-of-month dates, and must not allow a start after the end.
- `Tabs.tsx` (existing, unmodified) — `Tab[]` array (`{id, label}`), ordered **Facility,
  Vehicle, Lane, Driver**, matching Ciaran's sequencing comment on the FP-156 Jira ticket.
  (That comment was not re-verified in the 2026-09-11 review. Check the ticket before relying
  on the order.)
- `DataTable.tsx` (existing, unmodified) — its `Column.render` function
  (`DataTable.tsx:11`) is exactly where the "67% (2/3)" and "—" display rules get
  implemented, per-column.
- `frontend/shared/lib/types/analytics.ts` (new) — mirrors the wrapped response shapes,
  following `precinct.ts`'s exact conventions: branded id types (line 7-8), `| null` on
  every denominator-zero field, a header comment naming the backend schema it mirrors
  (lines 1-3).

### 4.4 Panel-specific requirements

- **FacilityPanel** — `confirmed_count`/`mismatch_count`/`unwitnessed_count` +
  `corroboration_rate`. Reuses `PhaseLocationSection.tsx`'s exact copy (lines 56-60) for the
  three states so the language matches the rest of the app: *"Awaiting Pulsit" / "Confirmed
  ✓" / "Mismatch ✗"*.
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
- "Data refreshes every ~15 minutes" as a static label (developer's decision) — no live
  timestamp, no backend change. **This is only true if a Celery beat process runs where the
  app is deployed.** Docker Compose runs a worker with no beat (FP-153 §11.6). Confirm
  before shipping the label; otherwise word it "Updated periodically".

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
- **Celery beat in the deployed environment** must be confirmed before the "refreshes every
  ~15 minutes" label ships (§4.5).

---

## 7. Before executing — sync with `dev` (decided 2026-09-11)

Chiko's PR #45 changed three files FP-156 edits (§1), so sync **before** writing code, not
after. Otherwise those edits will conflict later. The developer runs every git write
command; Claude does not (CLAUDE.md).

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
