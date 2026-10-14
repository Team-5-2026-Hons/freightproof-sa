# Pre-merge fixes: Ciaran → dev (2026-10-06)

From the code review of `ce6a371..24b46cc`. Eight tasks, executed in order, **one combined review at the end** (not per task). Branch: `Ciaran`. No git writes by the implementer: stage only, Ciaran commits.

Decisions already made:
- PP stays mocked for the demo (`PP_USE_MOCK=true`). No work on the live PP path.
- Plan/spec docs under `docs/superpowers/` merge to dev as-is.
- Other branches (Tim's audit packs) are fixed by their owners after merge. Do not touch them.
- Every operations time is SAST (`Africa/Johannesburg`, fixed +02:00, no DST).

Verification commands (used per task and at the end):
```
cd frontend/dispatcher && npx tsc --noEmit && npx vitest run && npx eslint .
cd backend && .venv/bin/pytest -q            # foreground only, never backgrounded
```

---

## Task 0 — Dev DB check (Ciaran, manual, read-only)

Not for the implementer. Run against the shared dev DB:
```sql
select count(*) from trips t
join blockchain_receipts r on r.subject_id = t.id
where r.payload_json ? 'order_number';
```
If it's 0, there's nothing to do. Otherwise, cancel and recreate (or reseed) those trips after merging, before the demo. Also run `scripts/seed_demo.py` on the deployed DB after `alembic upgrade` from dev, which fills in `pp_hub_code`.

---

## Task 1 — Shared SAST calendar helpers (do first; tasks 2 and 3 use them)

**File:** `frontend/shared/lib/utils/datetime.ts`

Export the following. All use one module-scope `Intl.DateTimeFormat` (built once), and `OPERATIONS_TIMEZONE` becomes exported.
- `OPERATIONS_TIMEZONE` (export the existing const)
- `sastCalendarDay(iso: string | Date): string | null`: `"YYYY-MM-DD"` in SAST, or null if unparseable.
- `sastToday(): string`: `sastCalendarDay(new Date())!`.

**Replace the private copies** (delete them, import the shared ones):
- `dispatcher/lib/format/exception.ts`: remove `exceptionCalendarDay` and `EXCEPTION_TIMEZONE`. Update callers in `lib/exceptions/queue.ts` and `app/(app)/exceptions/page.tsx`.
- `dispatcher/app/(app)/history/page.tsx`: remove `OPERATIONS_DATE_FORMATTER` and `todayStr`, use `sastToday()`.
- `dispatcher/lib/format/month.ts` and `lib/format/period.ts`: replace the local `OPERATIONS_TIME_ZONE` const with the shared `OPERATIONS_TIMEZONE`. Where they compute today's date, use `sastToday()`. Keep their own month logic.

**Efficiency (same task):** in `filterQueue` (`lib/exceptions/queue.ts`), compute the day only when `filters.fromDate || filters.toDate` is set.

**Tests:** extend `lib/format/datetime-parts.test.ts`:
- 21:59Z and 22:00Z on 2026-10-05 → `2026-10-05` / `2026-10-06`
- invalid string → null
- `Date` input accepted

Move any `exceptionCalendarDay` tests onto `sastCalendarDay`. Existing history, period and month tests must stay green unchanged.

---

## Task 2 — Create Trip times are SAST, not browser-local (the bug)

**File:** `dispatcher/lib/trips/manifest-form.ts`

`isoToLocalInput` → rename to `isoToSastInput(iso)`. It returns the `datetime-local` value (`YYYY-MM-DDTHH:mm`) in SAST, built from `formatToParts` with `OPERATIONS_TIMEZONE` and `hourCycle: 'h23'`. Never use `getHours()`.

`localInputToIso` → rename to `sastInputToIso(value)`. It returns `new Date(\`${value}:00+02:00\`).toISOString()`. Put a named `SAST_OFFSET = '+02:00'` constant in `shared/lib/utils/datetime.ts` next to `OPERATIONS_TIMEZONE`, with a comment that SA has had no DST since 1944.

Update callers:
- `manifestTimes`
- `overrideToIso`
- `buildEmptyLegPayload`
- `trips/new/page.tsx` summary rows
- `validateSchedule`: it does `new Date(shown.arrival)`. Convert both values through `sastInputToIso` before taking the difference.

**ScheduleFields.tsx:** the visible label says "(SAST)" for both inputs, e.g. "Planned departure (SAST)".

**Tests** (`manifest-form.test.ts`), run with `TZ=UTC` and `TZ=America/New_York` via `vi.stubEnv`/`process.env.TZ`, or by asserting on pure strings:
- `isoToSastInput('2026-10-06T18:00:00Z') === '2026-10-06T20:00'`
- `sastInputToIso('2026-10-06T20:00') === '2026-10-06T18:00:00.000Z'`
- Round trip is the identity.
- Fix up the existing payload/validation tests for the new names.

---

## Task 3 — Exceptions sort onto `sortRows`

**File:** `dispatcher/lib/exceptions/queue.ts`
- Replace the `ExceptionSort` interface with `export type ExceptionSort = Sort<ExceptionSortKey>`, imported from `lib/sort/sort-rows`.
- `sortQueueChronologically` becomes `sortRows(items, { key: 'raised', dir: 'desc' }, ...)` with an id tie-break via `compareText`. The behaviour stays the same: invalid dates go last, then by id.
- In `groupQueueByTrip`, the group order uses the same pattern (newest first, ties by `compareText(tripId)`).

**Tests:** existing `queue.test.ts` stays green. Add one test asserting that ties break by id via the collator. (If that exposes a behaviour change from the raw `<`, accept the collator's order and update the expectation.)

---

## Task 4 — Readable exceptions slice (format only, no behaviour change)

Files:
- `lib/hooks/useExceptionListRestoration.ts`
- `lib/exceptions/view-state.ts`
- `groupQueueByTrip` in `lib/exceptions/queue.ts`
- `app/(app)/exceptions/page.tsx`

Rules:
- One statement per line, blank lines between logical blocks, objects multi-line when there are more than 3 keys, lines ≤ 120 characters. Match `components/ui/Table.tsx`.
- `useExceptionListRestoration`:
  - Add an options-object signature `{ userId, origin, container, ready, identityReady }` with an exported interface. Update the single caller.
  - Replace `value as Partial<Saved>` with a small `isSaved(value: unknown): value is Saved` guard. Use `isRecord` from `lib/api/json`.
  - The `eslint-disable react-hooks/set-state-in-effect` stays only if the reset genuinely needs it. If it stays, add a one-line *why* comment. Preferred: reset `expanded` by keying the state on `key` (the store-previous-key pattern used in `useClaimChanges`), which removes the disable.
- `exceptions/page.tsx`:
  - Extract the group header into `components/exceptions/ExceptionGroupHeader.tsx` with props `{ group, open, bodyId, onToggle }`.
  - Extract the error block into a small `ExceptionsLoadError` component in the same file.
  - Split the long JSX onto multiple lines.
- `view-state.ts`: split `parseExceptionViewState` into a few named helpers: `parseTab`, `parseSeverity`, `parseDateRange`, `parseNavigation`, `parseSort`.

**Tests:** all existing exceptions tests stay green with no edits beyond import paths. Add a render test for `ExceptionGroupHeader`: it shows counts, has `aria-expanded`, and calls `onToggle` on click.

---

## Task 5 — Dashboard Progress sort matches what the cell shows

**File:** `dispatcher/lib/trips/sort.ts`

The `'exceptions'` key orders by `needs_review_count` first, then progress. The cell leads with "⚠ N exceptions", so ascending puts trips needing review first. Encode it as one numeric `SortValue`, e.g. `needs_review_count > 0 ? -needs_review_count : progress ?? null`. Keep "no plan" as `null` (sorts last). Comment the encoding.

Ascending (the first click) therefore puts the most exceptions at the top. Check that `defaultTripSortDirection('exceptions')` is still `'asc'`.

**Tests** (`trips/sort.test.ts`):
- A trip with 3 exceptions at 90% sorts above one with 0 exceptions at 10%.
- 3 exceptions sorts above 1.
- Trips with no exceptions order by progress.
- No plan sorts last in both directions.

---

## Task 6 — Column resize cleanup

**File:** `dispatcher/lib/hooks/useTableColumns.ts`
- In `startResize`, also end the drag on `pointercancel`. Factor the listener teardown into one `stop()` function.
- Keep the active `stop` in a ref. A `useEffect` cleanup calls it on unmount. Starting a new drag first calls any existing `stop`.

**Tests** (`useTableColumns.test.tsx`):
- After `pointercancel`, a `pointermove` no longer changes widths.
- After unmount mid-drag, a `pointermove` doesn't throw or warn. Spy on `removeEventListener`.

---

## Task 7 — Backend: `_load_trip_contexts` in 3 queries

**File:** `backend/app/orchestration/exception_service.py`

Merge the driver and horse lookups into one select over the trips: `select(Trip.id, Driver.full_name, Vehicle.registration).join(Driver, Driver.id == Trip.driver_id).join(Vehicle, Vehicle.id == Trip.horse_id).where(Trip.id.in_(unique))`. Use outer joins, so a missing driver or vehicle still yields `None` as before. That leaves precincts, crew and trailers: 3 queries. Make the docstring match.

**Tests:** existing `tests/integration/test_exception_reads.py` stays green. Make sure it asserts driver, horse, trailers and route names on the queue, history and detail reads. Add those assertions if any are missing.

---

## Task 8 — Dashboard subtitle uses the dispatcher's organisation

The subtitle hardcodes "Load Factor Transport" (`dispatcher/app/(app)/page.tsx`).

Backend:
- `schemas/people.py`: add `class DispatcherProfileRead(UserRead): organization_name: str`.
- `auth/router.py` `GET /auth/me`: `response_model=DispatcherProfileRead`. The endpoint stays thin. Add `async def get_dispatcher_profile(db, user) -> DispatcherProfileRead` in `backend/app/auth/` (new `profile.py`, or the existing auth service module if there is one). It selects `Organization.name` by `user.organization_id`. Add `db: AsyncSession = Depends(get_db)` to the endpoint.
- Tests:
  - `tests/integration/test_auth*.py`: `/auth/me` returns `organization_name` matching the fixture org. 401 is unchanged.
  - Unit test for `get_dispatcher_profile` if the module has unit coverage elsewhere.
- Update `backend/docs/api_contract_dispatcher_driver.md` for the new field.

Frontend:
- `lib/types/user.ts`: add `organization_name: string` to `DispatcherUser`.
- `page.tsx` subtitle: `` `${sastDay} · ${user?.organization_name ?? ''}` ``. Drop the separator when the name is absent. Fix up any `DispatcherUser` fixtures in tests.

---

## Final review (once, after task 8)

One combined Sonnet reviewer over `git diff 24b46cc..` (staged and unstaged) checks:
1. All verification commands green. Paste the counts. Baseline before these fixes: backend 2207 passed / 4 skipped, dispatcher 1454, driver-pwa 821.
2. `grep -rn "Africa/Johannesburg" frontend --include=*.ts --include=*.tsx | grep -v node_modules` → only `shared/lib/utils/datetime.ts` (tests excepted).
3. `grep -rn "getHours\|getMonth()\|getDate()" frontend/dispatcher/lib/trips` → none.
4. `grep -n "Load Factor" -r frontend/dispatcher/app` → none.
5. No file in the diff has a line over 160 chars, except long Tailwind class strings.
6. No changes outside the files named above, apart from tests and fixtures.

Then run a browser check on the dispatcher, with the dev server and Ciaran logged in:
- Create Trip with manifest 81: the input times equal the summary's SAST times.
- The exceptions queue sorts, groups, and restores scroll.
- Dashboard: the Progress sort puts trips with exceptions on top, and the subtitle shows the org name.

The reviewer fixes only what fails, then hands off to Ciaran with suggested commits, one per task, e.g.:
- `fix(dispatcher): enter create-trip times in SAST`
- `refactor(shared): one SAST calendar-day helper`
- `refactor(dispatcher): exceptions sort on sortRows`
- `refactor(dispatcher): split dense exceptions files`
- `fix(dispatcher): progress sort leads with exceptions`
- `fix(dispatcher): end column resize on cancel and unmount`
- `perf(orchestration): trip contexts in three queries`
- `feat(auth): organisation name on /auth/me`
