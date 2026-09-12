# Trailer Analytics — Per-Vehicle Breakdown Attribution — Build Spec

Author: Tom (Thomas Davis), with Claude · Written 2026-09-12
Status: **PLANNED, not built.** A handoff spec for a fresh session to execute.
Branch: `trailer-analytics`, created 2026-09-12 from `origin/dev` at `df9c2be` (after FP-156
merged as PR #47). Only §4 step 6 (commit and push this spec) remains before Stage 1.
No Jira ticket exists for this work yet. Do not invent one.

## How to use this document

This extends the FP-153 read models and the FP-156 analytics UI from **horses only** to
**horses and trailers**. It records every decision from the planning session on
2026-09-12, so a new session can build it without re-deriving anything.

**Read these first**, in this order. This document assumes their content and does not
repeat their metric definitions:

1. `CLAUDE.md` — workflow (Read → Plan → Execute → Report), standards, git rules.
2. `docs/design-notes/2026-09-10-fp153-analytics-read-models-spec.md` — §5 and §11
   (what the vehicle views measure and how they were built).
3. `docs/design-notes/2026-09-11-fp156-dispatcher-analytics-screen-spec.md` — §0.1 and §8.
4. `docs/design-notes/2026-09-12-vehicle-detail-analytics-toggle-spec.md` — the
   vehicle detail page toggle.

**This document supersedes two earlier decisions.** Do not "fix" code back to them:

- FP-153 spec §5: *"Scope: horses only… Trailers are a legitimate future extension."*
- Toggle spec §3 decision 1: *"Horses only. The toggle… only render[s] when
  `vehicle.vehicle_type === 'horse'`."*

The work is split into **four stages** (§5–§8). **Stop for Tom's review after each
stage.** Each stage gets its own PLAN block (CLAUDE.md format) before any code, and its
own TASK COMPLETE after.

Every file:line below was checked against the repo on 2026-09-12 on
`fp-156-analytics-screen` at `46accf6`. Re-check anything that has moved.

---

## 0. Decisions confirmed with Tom (2026-09-12)

| # | Question | Decision |
|---|---|---|
| 1 | How is a breakdown tied to the right vehicle? | **Option A.** Add a nullable `exceptions.vehicle_id`. It is set when the driver reports the breakdown. (Other options and why they were rejected: §10.) |
| 2 | What happens to breakdowns with no vehicle — every existing one, and reports from phones still on the old app? | **They keep counting against the horse, exactly as today.** Horse numbers do not change. |
| 3 | Trailer streaks will look too clean for trips before rollout (old breakdowns can't be tied to a trailer). How is that shown? | **A note, with no date in it**, so there is no hard-coded rollout constant. Wording in §8. |
| 4 | Branch? | **Merge FP-156 to `dev` first, then a new branch `trailer-analytics` off `dev`.** Fallback if the merge is slow: branch off `fp-156-analytics-screen`. |
| 5 | Ownership of the code this touches? | **Cleared by Tom** — with Ciaran (exception model and service) and with the driver-app owner. |
| 6 | What does the driver get asked? | **Only "Truck or Trailer?"** The **server** works out the exact vehicle from the trip. The button says "Truck"; the code says `horse` (`VehicleType.HORSE`). |
| 7 | A trip with 2+ trailers can't be narrowed from "Trailer" alone. What then? | **Only on those trips, one extra step lists each trailer's registration plate.** The driver can read the plate off the trailer. |
| 8 | On the fleet-wide `/analytics` Vehicle tab, how do trailers appear? | **In the same table as horses, with a new Type column.** |
| 9 | Write a spec doc? | **Yes** — this file. |

---

## 1. The problem in one paragraph

A horse is a single foreign key on the trip (`trips.horse_id`, `db/models/trips.py:176`).
Every horse metric can therefore say exactly which trips a horse ran. Trailers attach
through a **many-to-many** table, `trip_trailers` (`db/models/trips.py:243-254`), and
multi-trailer trips (interlink/superlink) are supported. An exception records only its
trip — `TripException` has no vehicle column (`db/models/transit.py:58-167`). So on a trip
with two trailers, nothing says which one broke down. Crediting the breakdown to every
trailer on the trip would put one breakdown on several trailers, and Tom ruled that out:
**the right breakdown must belong to the right trailer.**

## 2. What is and isn't affected

- **Trip count and driving hours are safe to credit to every trailer on the trip.**
  `trip_trailers` is written only at trip creation (`orchestration/trip_service.py:264-272`).
  No code ever adds, drops or swaps a trailer mid-trip (searched 2026-09-12). Every
  trailer on a trip really did travel every leg of it.
- **Only mechanical exceptions need a vehicle.** That covers everything built from them:
  the three severity counts, mean time between breakdowns, the streaks, and trips since
  last incident.
- **Only one path creates mechanical exceptions:** the driver app's "Vehicle breakdown"
  option (`driver-pwa/app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx:29`),
  which calls `raise_exception` (`orchestration/exception_service.py:114`). No
  system-detected code path raises `MECHANICAL` (grep 2026-09-12: the only backend
  references are the enum and the analytics files).
- **Adding a column changes no evidence hash.** Exceptions are not hashed or anchored
  anywhere: nothing writes `exceptions.merkle_batch_id`, and nothing in `crypto/` or
  `blockchain/` reads exception fields.
- **The driver app already has the trip's horse and trailers.** `GET /trips/me/active`
  returns `TripDetailResponse` (`api/v1/endpoints/trips.py:176-185`), which includes
  `horse: VehicleRead` and `trailers: list[VehicleRead]` (`schemas/trips.py:593-605`).
  The shared TS `Trip` type has `horse: Vehicle | null` and `trailers: Vehicle[]`
  (`frontend/shared/lib/types/trip.ts:151-152`). **No new API is needed.**

### FYI — an existing fact, not something to change

Driver-raised breakdowns are always saved as `warning`. `raise_exception` makes only the
types in `_CRITICAL_TYPES` critical and everything else a warning
(`exception_service.py:38`, `:184-187`). The info and critical breakdown counts will
therefore read 0 for horses and trailers alike. That is true today and is out of scope.

---

## 3. Confirmed current repo state (2026-09-12)

### Backend
| What | Where |
|---|---|
| `TripException` model — trip-scoped, no vehicle column | `backend/app/db/models/transit.py:58-167` |
| `TripTrailer` — composite PK `(trip_id, trailer_id)`, **no position/order column** | `backend/app/db/models/trips.py:243-254` |
| `VehicleType` enum: `HORSE = "horse"`, `TRAILER = "trailer"` | `backend/app/db/models/enums.py:15-17` |
| `raise_exception` — trip + driver checks, artifact ownership check, idempotent replay, severity, row build | `backend/app/orchestration/exception_service.py:114-265` |
| Precedent for **ignoring a bad client claim instead of rejecting it** | `_resolve_phase_context`, `exception_service.py:66-99` |
| `get_exception_detail` | `exception_service.py:575-` |
| `DriverExceptionCreateBody` | `backend/app/schemas/transit.py:151-188` |
| `TripExceptionDetail` / `TripExceptionRead` | `schemas/transit.py:241-263` / `:266-` |
| Driver raise endpoint | `backend/app/api/v1/endpoints/exceptions.py:54-80` |
| FP-153 migration — shared CTEs `:55-115`, `vehicle_analytics` `:206-276`, `vehicle_incident_streaks` `:283-350`, grains `:423-431`, REVOKE block `:444-455`, statement tuples `:457-469` | `backend/migrations/versions/2026_09_12_tom_analytics_read_models.py` |
| View ORM mappings — **columns stay the same, so this file does not change** | `backend/app/analytics/views.py:62-86` |
| `trips_since_last_incident` — live query, horse-only (`Trip.horse_id == vehicle_id` at `:95`) | `backend/app/analytics/vehicle_metrics.py:66-127` |
| Registration lookup + attach | `backend/app/orchestration/analytics_service.py:95-102`, `:147-158` |
| `VehicleMetricsResponse` (`registration` only) | `backend/app/schemas/analytics_api.py:32-35` |
| Analytics tests load the migration file by path | `tests/integration/test_analytics.py:54-76` (fixture `:316-320`, downgrade/upgrade round-trip `:799-812`); `tests/integration/test_analytics_endpoints.py:63-66` |
| Example add-a-column migration to copy the style of | `backend/migrations/versions/2026_07_17_tim_add_exception_gps.py` |

### Driver app (`frontend/driver-pwa`)
| What | Where |
|---|---|
| Exception picker labels and buttons | `app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx:25-36`, `:257-269` |
| Queued body (offline path) | same file `:93-104` |
| Online submit via `logException` | same file `:185-189` |
| `RaiseExceptionBody` | `lib/api/exceptions.ts:5-29` |
| `logException(type, payload: Record<string, unknown>)` | `lib/context/TripContext.tsx:76`, impl `:363-` |
| Offline queue stores the built body; `sendException` posts it as-is | `lib/hooks/useOfflineQueue.ts:54-58`, `:189-` |
| Shared exception type | `frontend/shared/lib/types/exception.ts` (`'mechanical'` at `:37`) |

### Dispatcher (`frontend/dispatcher`)
| What | Where |
|---|---|
| Horse-only toggle gate | `app/(app)/fleet/vehicles/[id]/page.tsx:349-352` (comment + `vehicle.vehicle_type === 'horse' ? (`) |
| Type label wording already used on that page (`'Horse'` / `'Trailer'`) | same file `:108` |
| `VehicleAnalyticsSummary` props (`vehicleId` only) | `components/analytics/VehicleAnalyticsSummary.tsx:16-17`, `:49` |
| Fleet table columns + "Horses only" comment | `components/analytics/VehiclePanel.tsx:43-72`, `:74` |
| Analytics copy (`streaksNote` etc.) | `components/analytics/copy.ts:18` |
| Shared `VehicleMetrics` type | `frontend/shared/lib/types/analytics.ts:50-` |
| Exception detail info rows | `app/(app)/exceptions/[id]/page.tsx:320` (`['Raised', …]`) |

### Tests that already exist for touched files
- Backend integration: `tests/integration/test_exceptions.py`, `test_exception_reads.py`,
  `test_exception_idempotency_concurrency.py`, `test_analytics.py`,
  `test_analytics_endpoints.py`
- Backend unit: `tests/unit/test_exception_service.py`, `tests/unit/test_analytics_service.py`
- Driver app: `app/(app)/trip/in-transit/exception/__tests__/LogExceptionPageClient.test.tsx`,
  `lib/context/__tests__/TripContext.test.tsx`, `lib/hooks/__tests__/useOfflineQueue.test.ts`
- Dispatcher: `components/analytics/VehiclePanel.test.tsx`,
  `components/analytics/VehicleAnalyticsSummary.test.tsx`,
  `app/(app)/fleet/vehicles/[id]/page.test.tsx`, `app/(app)/exceptions/[id]/page.test.tsx`

---

## 4. Step 0 — branch setup (Tom runs these, not Claude)

**Status 2026-09-12: steps 1–5 are DONE.** FP-156 merged as PR #47 (`df9c2be`), and
`trailer-analytics` was created from `origin/dev`. **Only step 6 remains.** Steps 1–5 are
kept below for the record.

**Why step 6 uses `push -u`:** `git switch -c trailer-analytics origin/dev` makes the new
branch track `origin/dev`. `push -u origin trailer-analytics` points it at its own remote
branch instead. Until step 6 has run, don't use a bare `git push`.

CLAUDE.md forbids Claude from running git write commands. Tom runs each command below
**one at a time**. This spec file is currently **untracked** on `trailer-analytics`.

Step 1 — open the FP-156 pull request:

```bash
gh pr create --base dev --head fp-156-analytics-screen --title "feat(dispatcher): FP-156 analytics screen and detail-page analytics toggle" --body "Adds the dispatcher analytics screen, its read-only API, and the analytics toggle on the vehicle, driver and precinct detail pages."
```

Step 2 — get the team's approval on GitHub, then merge with **Create a merge commit**
(same as PR #46).

Step 3 — fetch:

```bash
git fetch origin
```

Step 4 — create the branch from `dev`:

```bash
git switch -c trailer-analytics origin/dev
```

Fallback, only if the FP-156 merge is stuck in review (skip steps 3–4 and run this):

```bash
git switch -c trailer-analytics fp-156-analytics-screen
```

Step 5 — confirm the branch (it should print `trailer-analytics`):

```bash
git branch --show-current
```

Step 6 — commit this spec as the branch's first commit:

```bash
git add docs/design-notes/2026-09-12-trailer-analytics-spec.md
```

```bash
git commit -m "docs: add trailer analytics spec"
```

```bash
git push -u origin trailer-analytics
```

---

## 5. Stage 1 — record which vehicle broke down (backend)

**Goal:** a mechanical exception stores the exact vehicle, worked out by the server from
the driver's "truck or trailer" answer.

### 5.1 Request shape
Add two optional fields to `DriverExceptionCreateBody` (`schemas/transit.py:151`), each
with a "why" comment:

```python
vehicle_type: Optional[VehicleType] = None   # the driver's answer: horse ("Truck") or trailer
trailer_id: Optional[UUID] = None            # sent only when the trip has 2+ trailers
```

Both are optional because older installed apps, and reports already sitting in a phone's
offline queue, send neither. Those land with no vehicle (decision 2).

### 5.2 Working out the vehicle (orchestration)
Put the rules in a **pure function** in `exception_service.py`, so they get unit tests
without a database (CLAUDE.md: unit tests for `orchestration/`):

```python
def pick_breakdown_vehicle(
    *, exception_type: ExceptionType, vehicle_type: VehicleType | None,
    trailer_id: uuid.UUID | None, horse_id: uuid.UUID, trip_trailer_ids: Sequence[uuid.UUID],
) -> uuid.UUID | None
```

| exception_type | vehicle_type | trailers on trip | Result |
|---|---|---|---|
| not `MECHANICAL` | anything non-null | — | `None`, log warning |
| `MECHANICAL` | `None` | — | `None` (old client) |
| `MECHANICAL` | `horse` | — | `horse_id` (ignore `trailer_id`; warn if one was sent) |
| `MECHANICAL` | `trailer` | 0 | `None`, log warning |
| `MECHANICAL` | `trailer` | 1 | that trailer (ignore `trailer_id`; warn if it differs) |
| `MECHANICAL` | `trailer` | 2+ | `trailer_id` if it is one of them, else `None` and log warning |

A thin async step loads `trip_trailer_ids` (`select(TripTrailer.trailer_id).where(TripTrailer.trip_id == trip_id)`)
and calls it.

**Never reject — store `None` and log instead.** The driver app's offline queue treats
any 4xx as final and **discards the report**. That is why `_resolve_phase_context`
(`exception_service.py:66-99`) ignores a bad `phase_event_id` instead of returning 422.
A breakdown report must never be lost because the vehicle part of it was wrong. Say this
in a "why" comment.

**Where it runs in `raise_exception`:** after the idempotent-replay check (a replay
returns the stored row untouched, `:167-172`), before the `TripException(...)` is built
(`:189`). Set `vehicle_id=` on the row.

**Known edge (§11 #2):** an unresolvable trailer answer stores `None`, and under decision 2
`None` counts for the horse. The app in Stage 3 makes this unreachable: it hides "Trailer"
on a trip with no trailers and requires a plate on trips with 2+ trailers. Keep the
warning log so it is visible if it ever happens.

### 5.3 Files
- **Modify** `backend/app/db/models/transit.py` — `TripException.vehicle_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=True)`, with a "why" comment (only set for mechanical; `None` means the vehicle wasn't recorded).
- **Modify** `backend/app/schemas/transit.py` — the create body (§5.1). Add `vehicle_id: Optional[UUID] = None` to `TripExceptionRead`. Add `vehicle_id`, `vehicle_registration: Optional[str]` and `vehicle_type: Optional[VehicleType]` to `TripExceptionDetail`.
- **Modify** `backend/app/orchestration/exception_service.py` — §5.2. `raise_exception` gains keyword args `vehicle_type` and `trailer_id`. `get_exception_detail` looks up the vehicle's registration and type when `vehicle_id` is set.
- **Modify** `backend/app/api/v1/endpoints/exceptions.py:69-76` — pass the two fields through.
- **Create** `backend/migrations/versions/<YYYY_MM_DD>_tom_add_exception_vehicle.py` — revision `tom_add_exception_vehicle`. `down_revision` = the current head. That was `tom_analytics_read_models` on 2026-09-12; **run `git fetch origin` and check `dev` for newer migrations first** (CLAUDE.md, Alembic conflicts). `op.add_column("exceptions", sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicles.id"), nullable=True))`. No backfill — old breakdowns can't be attributed truthfully. Copy the style of `2026_07_17_tim_add_exception_gps.py`.

### 5.4 Tests
- `tests/unit/test_exception_service.py` — every row of the §5.2 table.
- `tests/integration/test_exceptions.py` — POST as the driver, then assert the stored `vehicle_id` in the DB:
  - horse → the trip's `horse_id`
  - one trailer → that trailer
  - two trailers plus a valid `trailer_id` → it
  - two trailers with no `trailer_id` → `None`, still 201
  - a `trailer_id` from another trip → `None`, still 201
  - `vehicle_type` on a non-mechanical type → `None`
  - fields omitted → `None`
  - unknown `vehicle_type` value → 422
  - the existing 401/403 cases still pass
- `tests/integration/test_exception_reads.py` — the detail returns the vehicle fields; all `None` when unattributed.
- Idempotency: replaying the same `client_report_id` with a different `vehicle_type` returns the original row unchanged.

### 5.5 Done when
`cd backend && pytest` is green. Don't run two pytest runs at once — they share one test
database and wipe each other's tables. Then TASK COMPLETE, and stop for Tom's review.

Suggested commit: `feat(orchestration): record which vehicle a mechanical exception belongs to`

---

## 6. Stage 2 — read models (backend)

**Goal:** `vehicle_analytics` and `vehicle_incident_streaks` cover horses **and**
trailers, with each breakdown counted only for its own vehicle.

### 6.1 The attribution rules (write these as SQL comments too)
1. **Vehicle rows:** every closed trip gives one row for its horse, plus one row per
   trailer in `trip_trailers`.
2. **Trip count and driving hours:** credited to every vehicle row of the trip (§2).
3. **A mechanical exception counts for a vehicle** when
   `e.vehicle_id = that vehicle`, **or** `e.vehicle_id IS NULL` **and** that vehicle is the
   trip's horse (decision 2).
4. **The grain stays unique.** A vehicle can't be both the horse and a trailer on one trip
   (different `vehicle_type`), and `trip_trailers`' PK stops a trailer appearing twice.

### 6.2 Migration
**Create** `backend/migrations/versions/<YYYY_MM_DD>_tom_trailer_vehicle_analytics.py`:
revision `tom_trailer_vehicle_analytics`, `down_revision = "tom_add_exception_vehicle"`.
Hand-written (autogenerate can't emit materialized views). Self-contained — it **copies**
the shared CTE strings from the FP-153 migration rather than importing them, because a
migration is a frozen record (FP-153 spec §11.3).

A materialized view can't be altered, so **drop and recreate** the two views:

```sql
-- sketch — the new session writes the real SQL
vehicle_trips AS (
    SELECT ct.trip_id, ct.operator_organization_id, ct.month_start, ct.departed_at,
           ct.horse_id AS vehicle_id, TRUE AS is_horse
    FROM closed_trips ct
    UNION ALL
    SELECT ct.trip_id, ct.operator_organization_id, ct.month_start, ct.departed_at,
           tt.trailer_id AS vehicle_id, FALSE AS is_horse
    FROM closed_trips ct
    JOIN trip_trailers tt ON tt.trip_id = ct.trip_id
)
-- attribution predicate, used by both views:
--   e.exception_type = 'mechanical'
--   AND (e.vehicle_id = vt.vehicle_id OR (e.vehicle_id IS NULL AND vt.is_horse))
```

- **`vehicle_analytics`:**
  - `trip_totals` groups `vehicle_trips` by (org, vehicle_id, month_start).
  - `mechanical` joins `exceptions` to `vehicle_trips` with the predicate. `LAG` is
    partitioned by (org, vehicle_id) and ordered by `(e.created_at, e.id)`, as today.
  - `driving_totals`: first compute driving hours **per trip** (the same in-transit-after-
    departure, both-attested rule as `:247-254`), then join to `vehicle_trips` on `trip_id`
    and sum per (org, vehicle_id, month_start).
  - **Output columns identical to today**, so `views.py`, `rollup.py` and the refresh task
    don't change.
- **`vehicle_incident_streaks`:** `trip_incidents` is built from `vehicle_trips`, with
  `is_incident = EXISTS (mechanical exception on this trip matching the predicate)`.
  Everything else is unchanged, but partitioned by (org, vehicle_id) instead of
  (org, horse_id).
- Recreate both unique indexes, `uq_vehicle_analytics_grain` and
  `uq_vehicle_incident_streaks_grain`. Dropping a view drops its index.
- Repeat the guarded `REVOKE ALL … FROM anon, authenticated` block for these two views
  (`:444-455`). Without it the Data API exposes them across operators.
- Expose `UPGRADE_STATEMENTS` and `DOWNGRADE_STATEMENTS` like the FP-153 file, so tests
  run the shipped SQL. **Downgrade** drops both views and recreates FP-153's horse-only
  versions from a frozen copy of their SQL, plus indexes and REVOKE.

### 6.3 Read layer and API
- **Modify** `backend/app/analytics/vehicle_metrics.py`:
  - `trips_since_last_incident` must match the view exactly. The vehicle is on a trip when
    `Trip.horse_id == v` **or** a `trip_trailers` row links them. An incident is a
    mechanical exception on that trip where `vehicle_id == v`, or `vehicle_id IS NULL`
    and `Trip.horse_id == v`.
  - Update the module docstring (`:1`, "horses only").
- **Modify** `backend/app/schemas/analytics_api.py` — `VehicleMetricsResponse.vehicle_type: VehicleType | None` (`None` when the id isn't found, the same as `registration`).
- **Modify** `backend/app/orchestration/analytics_service.py`:
  - `_vehicle_registrations` returns registration **and** `vehicle_type` per id.
  - `attach_vehicle_registrations` sets both.
  - Reword "horse" → "vehicle" in docstrings where it is now wrong (`:98`, `:203-208`).
- **Modify** `backend/app/api/v1/endpoints/analytics.py` — summaries/docstrings that say
  "per horse" (`:4`, `:84`, `:104`). Text only.
- Grep `horse` across `backend/app/analytics/` and `backend/app/schemas/analytics.py`.
  Fix only wording that is now false.

### 6.4 Tests
- `tests/integration/test_analytics.py`:
  - The `views` fixture runs FP-153's `UPGRADE_STATEMENTS` and then this migration's.
    Load the second file the same way (`:54-76`).
  - Update the round-trip test (`:799-812`) to cover both files.
  - **Every existing horse test must pass unchanged.** That is the regression proof that
    decision 2 holds.
  - New cases:
    - a single-trailer trip — the trailer gets trip_count and driving hours
    - an interlink trip where only trailer 2 has a breakdown — trailer 2 counts it;
      trailer 1 and the horse do not
    - an unattributed breakdown counts for the horse only
    - a breakdown attributed to the horse counts for the horse and no trailer
    - trailer streaks, including the worked examples from FP-153 §11.4 applied to a trailer
    - `trips_since_last_incident` for a trailer equals its open segment
- `tests/integration/test_analytics_endpoints.py` — load the new migration too. A trailer
  row comes back with `vehicle_type: "trailer"`; the streaks response includes trailers.
- `tests/unit/test_analytics_service.py` — the attach function sets `vehicle_type`.

### 6.5 Done when
`cd backend && pytest` is green, then TASK COMPLETE, then stop for Tom's review.

Suggested commit: `feat(db): extend vehicle analytics views to trailers`

---

## 7. Stage 3 — driver app asks "Truck or Trailer?"

**Goal:** when the driver chooses "Vehicle breakdown", they answer one extra question,
and sometimes pick a plate.

### 7.1 Behaviour
| Trip has | What the driver sees after choosing "Vehicle breakdown" | Body sent |
|---|---|---|
| no trailers (rigid truck) | **nothing extra** | `vehicle_type: "horse"` |
| 1 trailer | **Truck** / **Trailer** | `vehicle_type` only |
| 2+ trailers | **Truck** / **Trailer**; if Trailer, a list of each trailer's registration plate | `vehicle_type`, plus `trailer_id` when Trailer |

- **Submit stays disabled** until the question (and plate, when shown) is answered.
- Choosing a different exception type **clears** the answer, and non-mechanical types
  send neither field.
- Use `trip.horse` / `trip.trailers` from `useTrip()` — already loaded, no new API.
- The fields go in **both** the online body (`logException`) and the queued body
  (`queueForLater`, `:93-104`), so an offline report keeps its answer.

### 7.2 Files
- **Modify** `frontend/driver-pwa/lib/api/exceptions.ts` — add `vehicle_type?: VehicleType` and `trailer_id?: string` to `RaiseExceptionBody`, with "why" comments.
- **Modify** `frontend/driver-pwa/app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx` — the question and plate list (§7.1). Match the existing option-button styling (`:257-269`).
- **Modify** `frontend/driver-pwa/lib/context/TripContext.tsx` — `logException` reads `vehicleType` and `trailerId` from the payload and puts them in the body. Demo mode sets a matching `vehicle_id` on its local exception.
- **Modify** `frontend/shared/lib/types/exception.ts` — `TripException.vehicle_id: VehicleId | null`. Run `tsc` to find mocks and demo builders that construct a `TripException` and need the field.

### 7.3 Tests
`LogExceptionPageClient.test.tsx`:
- no trailers → no question, and the body has `vehicle_type: "horse"`
- one trailer → Truck/Trailer; choosing Trailer sends no `trailer_id`
- two trailers → plate list, and the body carries the chosen `trailer_id`
- submit is disabled until the question is answered
- non-mechanical types send neither field
- the queued (offline) path carries the fields

`TripContext` and `useOfflineQueue` tests: the fields pass through unchanged.

### 7.4 Done when
`cd frontend/driver-pwa && npx tsc --noEmit && npm test` is green, then TASK COMPLETE,
then stop for Tom's review.

**Heads-up for Tom:** Android drivers need a **new APK build** to get the question.
Until they update, their breakdowns arrive with no vehicle and count for the horse
(decision 2).

Suggested commit: `feat(driver-pwa): ask truck or trailer when reporting a breakdown`

---

## 8. Stage 4 — dispatcher UI

**Goal:** trailers show up in analytics, and a dispatcher can see which vehicle each
breakdown was recorded against.

### 8.1 Files
- **Modify** `frontend/shared/lib/types/analytics.ts` — add `vehicle_type: VehicleType | null` to `VehicleMetrics`.
- **Modify** `frontend/dispatcher/components/analytics/copy.ts` — add the dateless note Tom approved:
  > *"Trailer breakdowns are only counted from when drivers began naming the vehicle, so earlier trips count as clean."*
- **Modify** `frontend/dispatcher/components/analytics/VehiclePanel.tsx`:
  - a sortable **Type** column after Registration, using the page's wording `'Horse'` / `'Trailer'` (`vehicles/[id]/page.tsx:108`), and `NO_DATA` when `null`
  - update the "Horses only" doc comment (`:74`)
  - show the trailer note under the table beside `streaksNote`
- **Modify** `frontend/dispatcher/components/analytics/VehicleAnalyticsSummary.tsx` — a new `vehicleType: VehicleType` prop. Show the trailer note only for trailers.
- **Modify** `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx` — remove the horse-only ternary at `:352` so **every** vehicle gets the History/Analytics toggle. Update the comment at `:349-350`. Pass `vehicleType={vehicle.vehicle_type}`.
- **Modify** `frontend/dispatcher/app/(app)/exceptions/[id]/page.tsx` — on **mechanical** exceptions only, add a "Vehicle" row near `:320`: `Trailer · <registration>` / `Horse · <registration>`, or `Not recorded` when `vehicle_id` is null. Add the three fields to the dispatcher's TS type for `GET /exceptions/{id}` (find it with `grep -rn "TripExceptionDetail" frontend/`).

### 8.2 Tests
- `VehiclePanel.test.tsx` — the Type column, `null` → `—`, and the note is shown.
- `VehicleAnalyticsSummary.test.tsx` — the note appears for trailers only.
- `fleet/vehicles/[id]/page.test.tsx` — **flip the old trailer regression test**: a
  trailer now gets the toggle. The horse test is unchanged.
- `exceptions/[id]/page.test.tsx` — the Vehicle row shows for mechanical, reads "Not
  recorded" when null, and is absent for other types.

### 8.3 Done when
`cd frontend/dispatcher && npx tsc --noEmit && npm test` is green, then TASK COMPLETE,
then stop for Tom's review. The browser check is §9 step 3.

Suggested commit: `feat(dispatcher): show trailer analytics and the breakdown vehicle`

---

## 9. Applying the migrations and final checks

**The session never runs `alembic upgrade`.** `migrations/env.py` uses
`settings.DATABASE_URL`, which is the team's **shared** Supabase database. Tests don't
need it: they build tables with `create_all` and run the view SQL from the migration
modules.

**Warning — don't point this branch's backend at the shared database before the
migrations are applied there.** From Stage 1 onward, `TripException` maps a `vehicle_id`
column. Every exception query selects it, and on a database without the column each one
fails with "column exceptions.vehicle_id does not exist". Applying a migration to the
shared database before the branch is merged is also a problem: the database then records
a revision that teammates' code doesn't have. So the order is:

1. Stages 1–4 built and reviewed. Tom opens the PR `trailer-analytics` → `dev`, and the
   team merges it.
2. Tom applies both migrations:

   ```bash
   cd backend && alembic upgrade head
   ```

   Post-apply checks, the same as FP-153 §11.8:
   - `alembic current` shows `tom_trailer_vehicle_analytics (head)`.
   - Both views exist, with rows for horses **and** trailers.
   - The `anon` / `authenticated` grants on both views are empty.
   - `REFRESH MATERIALIZED VIEW CONCURRENTLY` succeeds on both.

   Nothing runs Celery beat yet (FP-156 §0 #19). The migration builds the views
   `WITH DATA`, but new trips appear only after a manual refresh.
3. **Browser check:**
   - A horse's detail page is unchanged.
   - A trailer's detail page now has the toggle, with the trailer note.
   - The `/analytics` Vehicle tab shows the Type column, with horses and trailers together.
   - A breakdown logged from the driver app (Truck, Trailer, and a plate on a 2+ trailer
     trip) shows the right Vehicle row on its exception page. After a refresh, it counts
     for that vehicle only.

---

## 10. Options considered and rejected (for the record and for examination)

| Option | Why rejected |
|---|---|
| **Credit the trip's breakdowns to every trailer on the trip** (no new column) | One breakdown would land on every trailer of an interlink. Tom: the right breakdown must belong to the right trailer. |
| **The dispatcher assigns the vehicle during review** | Mechanical exceptions start `RECORDED`; only critical ones enter the review queue (`exception_service.py:45-63`). Most would never be reviewed, so trailer analytics would stay mostly empty. The dispatcher is also further from the facts than the driver. |
| **Split the type into `MECHANICAL_HORSE` / `MECHANICAL_TRAILER`** | Still can't say *which* trailer on an interlink. Changes the exception type list in about four places across both apps. |
| **Infer the vehicle from other data** | There is nothing to infer from. An exception carries no device or vehicle reference. |
| **Record a front/rear position on `trip_trailers`** (for decision 7) | Needs a new column set at trip creation (dispatcher form, `trip_service`, schemas). The trailer list is part of the journey-lock canonical payload (`crypto/hashing.py:36`), so the position would either change that hash or sit outside it. The plate list gets the same result with no schema change. |
| **Ask only Truck/Trailer, even on 2+ trailer trips** | Can't attribute interlink trailer breakdowns. Under decision 2 an unattributed breakdown counts for the horse, which would be wrong here. |

## 11. Known limitations carried forward

1. **Historic breakdowns stay unattributed** and count for the horse. They can't be
   backfilled truthfully.
2. **An unresolvable trailer answer is stored as `None` and so counts for the horse.**
   The Stage 3 app makes this unreachable, and the server logs a warning if it happens.
3. **Old APKs** send no vehicle until drivers update (§7.4).
4. **Driver breakdowns are always `warning`** (§2 FYI), so the info and critical counts
   read 0.
5. **Dev triggers** (`api/v1/endpoints/dev_triggers.py:475`) don't send a vehicle. Their
   breakdowns count for the horse. Out of scope.
6. **Celery beat is still not deployed.** Views refresh only when refreshed manually.

## 12. Out of scope

- Backfilling old exceptions.
- The severity rule for driver breakdowns.
- `dev_triggers.py`.
- A `vehicle_ids` filter on the analytics endpoints.
- Deploying Celery beat.
- Driver, lane and facility analytics.
- `VEHICLE_SUBSTITUTION`.
- Editing the FP-153 migration file (it is frozen — changes go in the new migrations).

## 13. Build record

*(Filled in by the implementing session, stage by stage: what was built, test counts,
deviations from this spec with Tom's approval, and the commit Tom made.)*

| Stage | Status | Commit | Notes |
|---|---|---|---|
| 0 — branch | steps 1–5 done 2026-09-12; step 6 (commit + push this spec) pending | FP-156 = PR #47, `df9c2be` | branch created from `origin/dev` |
| 1 — capture | not started | | |
| 2 — read models | not started | | |
| 3 — driver app | not started | | |
| 4 — dispatcher | not started | | |
| Migrations applied to shared DB | not started | | |
