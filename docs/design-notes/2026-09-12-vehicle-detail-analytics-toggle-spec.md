# Vehicle Detail — Immutable History / Analytics Toggle — Build Spec

Author: Tom (Thomas Davis), with Claude · Written 2026-09-12
Status: **PLANNED, not built.** This is a handoff spec for a fresh session to execute.
Branch: `fp-156-analytics-screen` (current branch at time of writing) or whatever branch
Tom is on when this is pasted into a new chat — confirm before starting, per CLAUDE.md.
No Jira/ticket number exists for this piece of work yet — do not invent one.

## How to use this document

This is step one of a three-step UI iteration on the FP-153/FP-156 analytics work, which
is already built, reviewed, and treated as correct (see
`docs/design-notes/2026-09-10-fp153-analytics-read-models-spec.md` and
`docs/design-notes/2026-09-11-fp156-dispatcher-analytics-screen-spec.md` — **read both
before starting**, this document assumes their content and does not repeat the metric
definitions). The three steps, each needing Tom's sign-off before the next starts:

1. **Vehicles** (this document).
2. **Drivers** — same pattern, once Vehicles is approved. Not started.
3. **Precincts** — a different layout (its info panel and history panel are already
   swapped left/right vs. Vehicles/Drivers). Not started, not designed.

This task is **UI and routing only**. The analytics metrics themselves (backend logic,
view SQL, response shapes) are considered correct and are explicitly not touched.

Follow CLAUDE.md's Read → Plan → Execute → Report workflow: read every file named below
before editing it, output a PLAN block, then execute.

## 1. What this task is

On a **vehicle's own detail page** (`Fleet → Vehicles → select a vehicle`,
`frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`), the right-hand panel
currently shows a static "Immutable History" header followed by the `EventTimeline`
audit-log component (lines 336-341 as of this writing):

```tsx
<div className="flex-1 overflow-y-auto p-6 bg-surf-lowest">
  <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
    Immutable History
  </div>
  <EventTimeline events={vehicle.events} receipts={vehicle.receipts} />
</div>
```

This becomes toggleable between that existing history view and a new "Analytics" view
showing **this specific vehicle's** numbers, drawn from the same FP-153/FP-156 data —
the same fields shown on `/analytics`'s Vehicle tab, but for one vehicle instead of the
whole fleet.

## 2. Confirmed current repo state (verified 2026-09-12)

- `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx` (345 lines): the vehicle
  detail page. `'use client'`. Fetches via `useVehicleDetail(params.id)`
  (`lib/hooks/useVehicleDetail.ts`), which returns a `VehicleDetail`
  (`frontend/shared/lib/types/vehicle.ts`) whose `id` field is already typed `VehicleId`
  (`export type VehicleId = string & { readonly __brand: 'VehicleId' }`,
  `shared/lib/types/vehicle.ts:7`) — the same branded type `VehicleMetrics.vehicle_id` and
  `VehicleStreak.vehicle_id` use (`shared/lib/types/analytics.ts:51,67`). No casting
  needed to compare them.
- Layout: `<div className="flex flex-1 overflow-hidden">` (line 189) wraps a resizable
  left "Vehicle Info" / "Trips Using This Vehicle" column (`shrink-0`, width from
  `useResizablePanel`) and a `flex-1 overflow-y-auto` right column holding "Immutable
  History" (lines 191-341). The Driver detail page
  (`app/(app)/fleet/drivers/[id]/page.tsx`) is a separate file with the identical layout
  and reuses the same `EventTimeline` — confirmed as the template for step 2 of this
  iteration, not part of this task.
- `vehicle.vehicle_type` is `'horse' | 'trailer'` (used at page.tsx:94, 230, 277).
  **FP-153's `vehicle_analytics` / `vehicle_incident_streaks` views are scoped to horses
  only** (`Trip.horse_id`) — FP-153 spec §5: *"Scope: horses only... Trailers are a
  legitimate future extension, deliberately not built now."* There is no analytics data
  for trailers.
- `frontend/dispatcher/components/ui/Tabs.tsx`: the codebase's segmented control, already
  used identically on `app/(app)/analytics/page.tsx:115-121` to switch between the four
  analytics grains. Its own doc comment: *"Use for switching between mutually exclusive
  views of the same subject — a Switch is for a single on/off setting and cannot express
  three states."* This is the toggle primitive for this task, not `Switch.tsx` (which is
  the binary on/off control already used for the "Active" field on this same page,
  page.tsx:246-253 — a different job).
- `frontend/dispatcher/lib/hooks/useAnalytics.ts` (95 lines): exports
  `useVehicleAnalytics(range: MonthRange): AnalyticsResult<VehicleMetrics>` and
  `useVehicleStreaks(): AnalyticsResult<VehicleStreak>` (no range param — whole-history,
  FP-153 §3a). **Both are unfiltered — they always fetch every vehicle in the org.**
  Confirmed by reading the file directly: `monthlyPath` only ever builds
  `start_month`/`end_month` query params, no vehicle filter.
- `backend/app/analytics/vehicle_metrics.py`'s `get_vehicle_metrics` and
  `get_vehicle_streaks` already accept an optional `vehicle_ids: Sequence[uuid.UUID] |
  None` (FP-153 §11.5), but neither `backend/app/orchestration/analytics_service.py`'s
  `list_vehicle_analytics`/`list_vehicle_streaks` nor
  `backend/app/api/v1/endpoints/analytics.py`'s `GET /analytics/vehicles` /
  `GET /analytics/vehicles/streaks` expose it as a query param — confirmed by reading both
  files. Wiring that through is a real backend change (new param, new tests) and is **out
  of scope** for this task (§4 below).
- `components/analytics/VehiclePanel.tsx` (94 lines): exports `joinStreaks(vehicles:
  VehicleMetrics[], streaks: VehicleStreak[]): VehicleRow[]` — joins the streaks response
  onto the monthly rows by `vehicle_id`, filling `highest_streak_trips`,
  `lowest_streak_trips`, `trips_since_last_incident` with `null` when a vehicle has no
  streaks row. `VehiclePanel` itself renders a multi-row sortable `DataTable` (all
  vehicles compared) — not reused directly here (§4 below), but `joinStreaks` and the
  `COLUMNS` field list (registration, trip_count, mechanical_info/warning/critical_count,
  mean_minutes_between_mechanical, driving_hours_sum, highest/lowest_streak_trips,
  trips_since_last_incident — `VehiclePanel.tsx:43-72`) are the exact field set to reuse.
- `lib/format/analytics.ts`: `NO_DATA = '—'`, `fmtRate`, `fmtRatio`, `fmtMinutes`,
  `fmtHours`, `fmtScheduleDelta`, `fmtOptionalCount` — all pure, all already handle
  `null`/zero-denominator as `NO_DATA`, never `0%`. Reuse verbatim.
- `lib/format/month.ts`: `defaultMonthRange(now?: Date): MonthRange` — current SAST month
  (`Africa/Johannesburg`) plus the two before it (`DEFAULT_RANGE_MONTHS = 3`). Same
  default `app/(app)/analytics/page.tsx:102` uses.
- `components/ui/MonthRangePicker.tsx`: `{value: MonthRange, onChange: (r: MonthRange) =>
  void}` props, month/year selects, never inverts the range, disables future months.
  Already used at `app/(app)/analytics/page.tsx:110`.
- `components/analytics/copy.ts`: `ANALYTICS_COPY.streaksNote` — *"Streaks and trips since
  last incident cover each vehicle's whole history, not only the selected months."* Reuse
  verbatim rather than re-writing.

## 3. Decisions confirmed with Tom (2026-09-12)

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Trailers have no `vehicle_analytics` data. What shows on a trailer's detail page? | **Horses only.** The toggle and Analytics tab only render when `vehicle.vehicle_type === 'horse'`. Trailer detail pages are untouched: Immutable History only, exactly as today, no `Tabs`, no new component. | Matches the data that actually exists (FP-153 §5, §7). Showing an empty "not tracked" state was considered and rejected — simpler to not add UI for data that will never appear there. |
| 2 | `/analytics`'s Vehicle tab is a multi-row `DataTable`. How does one vehicle's data get shown on its own page? | **A dedicated stat-tile/summary layout**, not a 1-row `DataTable`. | A one-row sortable table reads as broken UI on a detail page. The underlying fields and formatters are reused; only the shell changes. |
| 3 | Getting this vehicle's numbers needs either a backend filter or a frontend-side find. Which? | **Client-side filtering. Zero backend changes.** Call the existing unfiltered `useVehicleAnalytics(range)` / `useVehicleStreaks()` hooks (already return every org vehicle) and find this vehicle's row in the frontend. | This task is scoped to UI/routing only — the backend `vehicle_ids` plumbing described in §2 above is a real backend change (new query param on two endpoints, new orchestration-layer code, new tests) and stays out of scope. Flag as a known follow-up in TASK COMPLETE if the full-org payload ever becomes a real problem — do not silently fix it now. |
| 4 | Should the vehicle's Analytics tab have its own month-range control? | **Yes — the same `MonthRangePicker`, same default (`defaultMonthRange()`), scoped to local `useState` inside the new component.** | Matches "the same data that is portrayed in the current analytics page," and lets Tom widen/narrow the range for just this vehicle. |

## 4. Implementation

### 4.1 Modify `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`

In the right-hand panel (currently the static header + `EventTimeline`, lines 336-341):

- When `vehicle.vehicle_type === 'horse'`: render the `Tabs` component
  (`components/ui/Tabs.tsx`) with two tabs, `{ id: 'history', label: 'Immutable History'
  }` and `{ id: 'analytics', label: 'Analytics' }`. Default/active tab on load is
  `'history'` — **no behavior change for the existing view**. Local `useState<'history' |
  'analytics'>('history')` is enough; no need for the `isTabId` guard pattern from
  `analytics/page.tsx` since there are only two fixed ids, but match that file's
  `role="tabpanel"` / `aria-labelledby` wiring for consistency and accessibility.
  - Under `'history'`: render exactly what's there today (`EventTimeline`).
  - Under `'analytics'`: render the new `VehicleAnalyticsSummary` component (§4.2),
    passing `vehicleId={vehicle.id}`.
- When `vehicle.vehicle_type === 'trailer'`: leave this panel **exactly as it is today**.
  No `Tabs`, no new component, no conditional branching visible to a trailer.

### 4.2 New file: `frontend/dispatcher/components/analytics/VehicleAnalyticsSummary.tsx`

```ts
export interface VehicleAnalyticsSummaryProps {
  vehicleId: VehicleId
}
```

Internals:
- Local `useState<MonthRange>(() => defaultMonthRange())`, rendered through
  `MonthRangePicker` at the top of the panel.
- Call `useVehicleAnalytics(range)` and `useVehicleStreaks()` (`lib/hooks/useAnalytics.ts`)
  **unmodified** — same two hooks `VehicleTab` in `analytics/page.tsx:64-81` already calls.
  Combine `isLoading`/`error` the same way that component does (`vehicles.isLoading ||
  streaks.isLoading`; `vehicles.error ?? streaks.error`; retry re-fetches only whichever
  failed).
- `joinStreaks(vehicles.rows, streaks.rows)` (imported from
  `components/analytics/VehiclePanel.tsx`, already exported for this purpose), then
  `.find((row) => row.vehicle_id === vehicleId)` to isolate this vehicle's row.
- **Loading state:** reuse the page's own `Spinner` pattern (page.tsx:73-82), not
  `DataTable`'s built-in loading rows — this isn't a table.
- **Error state:** plain error text + a retry action, matching the page's existing error
  block (page.tsx:84-91), not `DataTable`'s `error`/`onRetry` prop path.
- **No row found** (this vehicle has zero closed trips in the selected range): render the
  existing "no data" convention — `NO_DATA` (`—`) for every field, or a short empty note
  in the style of `ANALYTICS_COPY.empty` (`components/analytics/copy.ts:27-30`). Never
  invent a zero.
- **Populated state:** a stat-tile/summary layout (cards or label/value rows, matching the
  visual language already used in the left "Vehicle Info" panel via `InfoRow` — consider
  reusing `InfoRow` itself, `components/ui/InfoRow.tsx`, for a consistent look) covering
  exactly the fields `VehiclePanel`'s `COLUMNS` show (`VehiclePanel.tsx:43-72`), minus
  `registration` (redundant — it's already the page's `TopBar` title):
  - `trip_count`
  - `mechanical_info_count` / `mechanical_warning_count` / `mechanical_critical_count`
    — **three separate values, never summed** (FP-153 §3 rule 4, carried forward by
    FP-156 §2 rule 4 — no blended score, ever).
  - `mean_minutes_between_mechanical` via `fmtMinutes`
  - `driving_hours_sum` via `fmtHours`
  - `highest_streak_trips` / `lowest_streak_trips` via `fmtOptionalCount`
  - `trips_since_last_incident` via `fmtOptionalCount`
  - The `ANALYTICS_COPY.streaksNote` text beneath the streak/incident figures, verbatim —
    it exists specifically because streaks and trips-since-incident are whole-history
    facts, not scoped to the selected month range, and that's easy to misread otherwise.

Import formatting helpers from `lib/format/analytics.ts` (`fmtMinutes`, `fmtHours`,
`fmtOptionalCount`, `NO_DATA`) rather than reimplementing them.

### 4.3 Files explicitly NOT touched

- `backend/app/analytics/*`, `backend/app/orchestration/analytics_service.py`,
  `backend/app/schemas/analytics.py`, `backend/app/schemas/analytics_api.py`,
  `backend/app/api/v1/endpoints/analytics.py` — no backend work in this task (§3 decision
  3).
- `frontend/dispatcher/app/(app)/analytics/page.tsx` and every existing panel under
  `components/analytics/` (`VehiclePanel.tsx`, `FacilityPanel.tsx`, `LanePanel.tsx`,
  `DriverPanel.tsx`) — read from, not edited. `joinStreaks` is imported, not duplicated.
- `frontend/dispatcher/app/(app)/fleet/drivers/[id]/page.tsx` — step 2, not this task.
- `frontend/dispatcher/app/(app)/precincts/[id]/page.tsx` — step 3, different layout, not
  this task.
- `frontend/dispatcher/lib/hooks/useAnalytics.ts` — reused unmodified. Do not add a
  `vehicleId` param here; that would be the backend-filtering path rejected in §3.

## 5. Tests

Follow the existing frontend test conventions (vitest + Testing Library, per FP-156 §4.6
— e.g. `components/analytics/VehiclePanel.test.tsx` if one exists, or the pattern used for
`FacilityPanel.test.tsx` etc.):

- `VehicleAnalyticsSummary.test.tsx`: loading state; error state with retry; empty state
  (no matching row for the given `vehicleId`); populated state with known input data —
  assert severities render as three separate numbers (never summed), a `null` streak
  renders `—` not `0`, `mean_minutes_between_mechanical: null` renders `—` not `0m`.
- Extend or add a test on the vehicle detail page: a horse-type vehicle renders the `Tabs`
  toggle defaulting to `history`; a trailer-type vehicle renders no toggle and the
  `EventTimeline` exactly as before (a regression guard for §3 decision 1).

Run with `cd frontend/dispatcher && npm test`.

## 6. Verification

1. `cd frontend/dispatcher && npm run build` (or `tsc --noEmit` / `next lint`) — no type
   errors, no `any`.
2. `cd frontend/dispatcher && npm test` — full suite stays green, new tests included.
3. Manual browser check:
   - Open a **horse**'s detail page: confirm the tab toggle appears, defaults to
     Immutable History (identical to today), switching to Analytics loads/shows data,
     changing the month range refetches, an empty range shows the no-data state, and a
     failed request shows an error with a working retry.
   - Open a **trailer**'s detail page: confirm nothing changed — no toggle, Immutable
     History only.
4. Confirm severities stay separate (info/warning/critical, never summed), `—` (never
   `0%`/`0`) shows for a `null` value, and the streaks note text matches
   `ANALYTICS_COPY.streaksNote` on `/analytics` verbatim.

## 7. Out of scope, restated

- Drivers detail page changes (step 2 — separate approval).
- Precincts detail page changes (step 3 — separate approval, different layout).
- Any trailer analytics (the data doesn't exist — FP-153 §7).
- Any backend endpoint, service, or query-param change.
- Any change to FP-153/FP-156 metric definitions, view SQL, or response schemas.
