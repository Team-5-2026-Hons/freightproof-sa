# FP-139 + FP-142 — One horse cannot be on two live trips, and the dispatcher sees it before picking

**Status: NOT STARTED — spec agreed 2026-10-14.**
Written 2026-10-14 from Tom's branch `feature/fp-139-vehicle-concurrency-guard` at `71d7fd3`
(= `dev` `b7b07da` plus a local merge commit adding `.codex/agents/executor.toml` and 7 lines of
`globals.css`; neither touches this work). Every path below was checked against that commit.
**Owner:** Tom (sign-off after every stage). **Written:** by Claude, from a decision session with Tom.
Every choice in §2 was agreed with him.
**Tickets:** FP-139 (subtasks FP-173 activation guard, FP-174 creation check, FP-175 tests) and FP-142
(the dispatcher sees the clash before creating). Both are Tom's. Parent epic FP-4 "Trip Management & Journey Lock".
**Branch:** `feature/fp-139-vehicle-concurrency-guard` (Tom created it). The executor never creates or switches branches.

---

## 0. Handoff (paste this first in a new session)

> FreightProof lets a dispatcher put one horse (truck) or trailer on two trips whose times overlap, and lets
> two drivers start both. Today the only guard is driver-only: `backend/app/orchestration/phases/scheduling.py`
> refuses activation while **the same driver** has another active or held trip. This work closes the gap
> end to end:
> (1) **planned arrival becomes required** when a trip is created (both creation paths and the wizard);
> (2) **trip creation refuses a clash** (409 `CREW_UNAVAILABLE`) when the driver, horse or any trailer is already
> busy in the new trip's window, with row locks so two dispatchers can't both win;
> (3) **activation refuses** when the horse or a trailer is on another active or held trip;
> (4) a new read, `GET /api/v1/trips/availability?start=&end=`, lists who is busy in a window; and
> (5) the wizard's **driver, horse and trailer pickers grey out busy options** with "On TRP-0038 · free after Thu 16 Oct, 16:00",
> so they can be seen but not picked.
> Work in **7 stages** (§9). Each ends with something Tom can check. **Stop after each stage for Tom's sign-off.**
> Follow `CLAUDE.md` exactly: PLAN block before each stage, TASK COMPLETE after it, no git write commands, never
> `alembic`, never read `.env`. Structural freeze starts 19 Oct: don't move or rename files. Start at the first
> stage in §14 that is not DONE.

---

## 1. Rules for whoever executes this

1. Read `CLAUDE.md` first. It overrides nothing here, and nothing here overrides it.
2. Before each stage, output the `PLAN` block. After it, output `TASK COMPLETE` and **stop**.
3. Git: only `git status`, `git diff`, `git log --oneline -10`, `git branch --show-current`, `git fetch`,
   `git add <specific files>`. Tom commits.
4. At the start of each stage run `git fetch origin`, then `git log --oneline HEAD..origin/dev`. If `dev` changed a
   file in §7, stop and tell Tom. Watch especially for the trip wizard (Ciaran's FP-282 rebuild was planned).
5. Explain plainly to Tom: the short answer first, then the detail. If he asks for something that contradicts §2,
   say so and explain why before doing it.
6. If this spec and the code disagree, trust the code, note it in TASK COMPLETE and in §14.
7. **Structure ratchet** (`scripts/check_structure.py`, `structure-baseline.json`):
   `trips/creation.py::persist_trip` is at its 260-line ceiling and `app/schemas/trips.py` at its 425-line ceiling.
   **Neither may grow.** Never run `check_structure.py --update` to make room; make each edit net-zero or smaller (§7).
8. **Never weaken the rule to make an old test pass.** If an existing test creates two overlapping trips on one
   horse, or a trip without an arrival, fix the test's data (a second horse, a later window, an arrival) and list it
   in TASK COMPLETE.
9. Never run two pytest processes at once (shared local test DB). Ask before `npm run build` (it clobbers Tom's dev server).
10. The browser may need Tom to sign in. **Never type a password.** Ask Tom.

---

## 2. Decisions (with reasons). Don't relitigate these.

| # | Decision | Why |
|---|---|---|
| D1 | **Planned arrival is required at creation**, on both paths. Explicit path: `planned_arrival_at`, or a stop `slot_time` later than departure (the same "effective arrival" the schema already computes). Manifest path: the request's arrival, else the manifest's `expected_arrival_at`, else 422 `NO_PLANNED_ARRIVAL`. Wizard: arrival is a required field. | Tom's call. Without an end time, "is this horse free?" has no answer. |
| D2 | **No migration.** `trips.planned_arrival_at` stays nullable in the database. Requirement is enforced in the request schemas. | Legacy rows have nulls; a NOT NULL change needs a backfill and an Alembic revision on a repo whose autogenerate emits 28 destructive ops (CLAUDE.md). Zero Alembic risk. |
| D3 | **A trip's busy window** (one rule, one function, used everywhere): start = `planned_departure_at`, else the first stop `slot_time` (existing `_scheduled_departure`). End = `planned_arrival_at`, else the last stop `slot_time` after the start. **Half-open** `[start, end)`: a trip ending 16:00 and one starting 16:00 do **not** clash (FP-175's "touching-but-not-overlapping"). | One definition shared by creation, activation, the endpoint and the picker means the screen can't disagree with the server. Half-open is the standard interval rule and makes back-to-back bookings legal. |
| D4 | **Which trips occupy crew:** `CREATED`, `ACTIVE`, `EXCEPTION_HOLD`. `CLOSED` and `CANCELLED` never do. | Same set the existing driver guard uses (`scheduling.py:102`). |
| D5 | **A live trip (`ACTIVE`/`EXCEPTION_HOLD`) stays busy until it is closed or cancelled.** Its window end is `max(planned end, now)`. A not-started (`CREATED`) trip is busy only in its planned window. A legacy trip with **no** resolvable end is busy from its start until closed or cancelled. | Tom: "the horse only becomes available when that trip is officially closed or cancelled". A truck still on the road can't be booked for now. Tom also chose to allow booking a horse today when its *next* trip is tomorrow (time windows, not "one open trip per horse"), so the week can be planned ahead. |
| D6 | **Creation checks driver, horse and every trailer** against D3–D5 and refuses with **409** and a structured body (§4.2), naming **every** clash. The `message` names the first. | FP-174. The wizard already shows a structured 409's `message` (`lib/api/client.ts:45` `detailMessage`), and a list lets the picker grey all of them at once. |
| D7 | **Race guard: row locks.** Before checking, creation locks the driver row, then the horse and trailer rows sorted by id, `FOR NO KEY UPDATE` (`with_for_update(key_share=True)`, as `phases/loaders.py:30` does). The second dispatcher waits, then sees the first trip and gets the 409. | Ciaran's FP-139 comment: two dispatchers must not claim one horse at once. `NO KEY` blocks a second claimer but not ordinary inserts that only reference the vehicle by foreign key (tracker fixes, exceptions), so nothing unrelated stalls during the ~5 s Hedera anchor. No migration, unlike an exclusion constraint. |
| D8 | **Lock order is fixed everywhere:** trip row first (if any), then driver, then vehicles by ascending id. | Matches the migration guide's "phase writes lock the trip row" rule, so a creation and an activation can never deadlock each other. |
| D9 | **Activation refuses if the horse or any trailer is on another `ACTIVE` or `EXCEPTION_HOLD` trip** (the existing "underway" rule, widened). It takes the same crew locks after the trip lock. The reason names the vehicle: "horse CA 441 892 is on another trip that is underway". | FP-173. Tom: "it must refuse if the horse or trailer is in an active or held trip at that time". The lock stops two drivers starting two trips on one horse at the same instant. |
| D10 | **"Start today's trips in order" stays driver-only.** | It is about one driver's day. Applied to a horse shared by two drivers, one driver's unstarted trip would block another's. |
| D11 | **New read: `GET /api/v1/trips/availability?start=&end=`** (dispatcher-only, own organisation). Returns every busy driver, horse and trailer whose window overlaps `[start, end)`. It lives on the existing trips router, so `main.py` is not touched. | FP-142: "a read view over trips that already exist". The same function as the creation check, so what the picker greys is exactly what the server would refuse. |
| D12 | **The wizard greys busy options: driver, horse and trailers.** They stay visible but can't be picked, and each shows a short line: "On TRP-0038 · free after Thu 16 Oct, 16:00", or for a live overdue trip "On TRP-0038 · under way, free when it closes". Times are in SAST. | Tom's design: "you can't physically select that horse or trailer, but you can see it and see how much longer it is unavailable for." The driver is greyed too, because creation refuses a busy driver as well (FP-174). Tom can drop the driver at Stage 5 review. |
| D13 | **The picker asks for availability only once departure and arrival are both valid.** Until then every option is shown with the hint "Enter departure and arrival to see who is free." If the times change, the request is repeated (debounced). An already-picked option that becomes busy shows a field error and blocks Create. | In both wizard modes the times step already comes before "Driver and vehicle" (`app/(app)/trips/new/page.tsx:351,367,382`). The server is still the final guard: a failed availability fetch degrades to "couldn't check" and never blocks creation. |
| D14 | **Built together in one spec and one PR**, backend stages first. | Tom's call. The backend 409 alone is useful, and the picker is a thin read over it. |

### Rejected alternatives (so nobody re-proposes them)

- A Postgres exclusion constraint on time ranges (migration, `btree_gist`, can't easily cover `trip_trailers`).
- "One open trip per horse at a time" regardless of dates (Tom chose windows, D5).
- Ending a no-arrival trip at midnight (Tom chose: make arrival required, D1).
- A turnaround buffer between trips (invents an operations rule; FreightProof records, it doesn't schedule).
- Extending "start in order" to vehicles (D10).
- A separate week-long availability strip or fleet calendar (FP-142 itself scopes the calendar to a later iteration; the greyed picker replaces the strip).

---

## 3. What it looks like

```
Step 3 · Driver and vehicle                (times from step 2: Wed 15 Oct 08:00 → 14:00)

Horse   [ Select horse…                       ▾ ]
        ┌──────────────────────────────────────────────┐
        │ CA 123 456   Volvo FH 2021                    │
        │ CA 441 892   On TRP-0038 · free after          │  ← greyed, not clickable
        │              Thu 16 Oct, 16:00                 │
        │ CA 555 010   On TRP-0041 · under way,          │  ← greyed
        │              free when it closes               │
        └──────────────────────────────────────────────┘
Trailers
  [ ] CA 789 012  13 m
  [■] CA 789 013  On TRP-0038 · free after Thu 16 Oct, 16:00   ← checkbox disabled, row faded
```

- No times yet: pickers work normally, with one hint line under the step title: "Enter departure and arrival to see who is free."
- Times changed after picking CA 441 892, and it is now busy: field error "CA 441 892 is busy in this window: on TRP-0038 until Thu 16 Oct, 16:00. Pick another horse, or change the times." Create is blocked.
- Availability fetch failed: one muted line "Couldn't check who is free. Creating will still refuse a clash." Pickers stay usable.
- Server 409 anyway (race lost): the existing error notice shows the 409 `message`, and the wizard refetches availability so the clash greys out.
- Driver app, activation refused: the existing verbatim 409 text, e.g. "Cannot start this trip: horse CA 441 892 is on another trip that is underway (TRP-0038)."

---

## 4. API and data changes

No migration, no new table, no new `.env` key, no `main.py` change.

### 4.1 Arrival required
- `TripCreateRequest.validate_request` (`app/schemas/trips.py`): 422 when the effective arrival is missing.
  Do it inside `validate_declared_schedule`, which both paths already call: it currently returns silently when either
  end is missing (`schemas/trips.py:94`). Make a missing **arrival** raise
  `"a planned arrival is required (provide planned_arrival_at, or a later stop slot_time)"`. A missing departure keeps
  its own existing errors. Rewrite its docstring, which says arrival is "legitimately optional". Net line change in
  the file: **≤ 0** (rule 7).
- Manifest path (`orchestration/consignments/manifest_import.py:380-389`): after the merge, `arrival is None` →
  `PPManifestUnusableError(PPManifestErrorCode.NO_PLANNED_ARRIVAL, "The manifest has no expected arrival. Enter one.")`,
  checked **before** `validate_declared_schedule`, mirroring `NO_PLANNED_DEPARTURE`. Add `NO_PLANNED_ARRIVAL` to
  `PPManifestErrorCode` (`app/schemas/pp_manifest.py:82`) and to the shared TS type, if that type enumerates the codes.

### 4.2 Creation 409 body (both creation endpoints, via `_trip_http_error`)
```json
{
  "code": "CREW_UNAVAILABLE",
  "message": "Horse CA 441 892 is on TRP-0038 until Thu 16 Oct, 16:00. Pick another horse, or move this departure.",
  "clashes": [ <BusyEntry>, ... ]
}
```
`BusyEntry` (Pydantic v2, `app/schemas/trips.py` is full, so put it in a new `app/schemas/availability.py`):
`resource_type: "driver"|"horse"|"trailer"`, `resource_id: UUID`, `label: str` (driver full name or vehicle
registration), `trip_id: UUID`, `trip_reference: str`, `trip_status: TripStatus`, `busy_from: datetime`,
`busy_until: datetime | None` (None = until the trip closes: live-overdue or legacy no-end), `planned_until: datetime | None`
(the planned end, for "was due …" wording).

### 4.3 `GET /api/v1/trips/availability`
Query: `start`, `end` (aware datetimes; 422 if `end <= start`). Auth: `get_current_dispatcher`; organisation from the
token. Response `CrewAvailabilityResponse { start, end, busy: list[BusyEntry] }`. Must be declared **before**
`GET /{trip_id}` in `endpoints/trips.py`, or "availability" is parsed as a trip id (422). Endpoint stays thin: validate, call
`trips.availability.busy_crew_in_window`, return.

### 4.4 Activation
No API change. `TripActivationBlockedError(blocking_trip_reference, reason)` keeps its signature. Only the `reason`
text varies (§5.2), and it is still a 409 (`endpoints/phases.py:152-161`).

---

## 5. Copy

### 5.1 Dispatcher (wizard copy module that holds `COPY.toast.tripCreated`; the executor locates it)
- `crew.availability.needTimes`: `'Enter departure and arrival to see who is free.'`
- `crew.availability.busyUntil(ref, when)`: `` `On ${ref} · free after ${when}` ``
- `crew.availability.busyLive(ref)`: `` `On ${ref} · under way, free when it closes` ``
- `crew.availability.pickedBusy(label, ref, when|null)`: `` `${label} is busy in this window: on ${ref} until ${when}. Pick another, or change the times.` `` (live variant: `` `…on ${ref}, which is still under way.` ``)
- `crew.availability.unchecked`: `"Couldn't check who is free. Creating will still refuse a clash."`
- `schedule.arrivalRequired`: `'Enter a planned arrival.'`
- `when` format: `Thu 16 Oct, 16:00` in SAST, using the wizard's existing SAST helpers (`isoToSastInput` family in `lib/trips/manifest-form.ts`); don't add a new date library.

### 5.2 Backend (built in `trips/availability.py`, one place)
- Creation `message` (first clash): `"{Kind} {label} is on {ref} until {when}. Pick another {kind}, or move this departure."`;
  live/no-end: `"{Kind} {label} is on {ref}, which is still under way. Pick another {kind}."`
  `when` = `Thu 16 Oct, 16:00`, formatted in the operator timezone (`settings.OPERATIONS_UTC_OFFSET_HOURS`, as `scheduling.operating_day` does).
- Activation `reason`: driver unchanged (`"another trip is already underway"`); horse `"horse {reg} is on another trip that is underway"`;
  trailer `"trailer {reg} is on another trip that is underway"`.

---

## 6. What does not change

The database schema and Alembic; `main.py`; `core/config.py`; `.env.example`; every `package.json`; the driver PWA
(it already shows the 409 text verbatim); the journey lock payload; seed scripts (they write rows directly, so
creation checks don't apply to them); "start today's trips in order" (D10); `TripActivationBlockedError`'s signature.

---

## 7. Implementation design

### 7.1 Backend: the busy rule (Stage 2), new `app/orchestration/trips/availability.py`
A leaf module (imports `db`, `core`, `schemas` only), added to the **lower tier** of the `trips-tier-order` contract in
`backend/.importlinter`: `detail | availability`. `phases.scheduling` may import it, since phases already imports `trips.detail`.

| Function | Kind | Does |
|---|---|---|
| `busy_window(status, start, planned_end, now) -> tuple[datetime, datetime \| None]` | pure | D3 + D5. `None` end = until closed. |
| `windows_overlap(a_start, a_end, b_start, b_end) -> bool` | pure | half-open; `None` end = +∞. `a_start < b_end and b_start < a_end`. |
| `async lock_crew(db, driver_id, horse_id, trailer_ids) -> None` | DB | `FOR NO KEY UPDATE` on the driver, then the vehicles sorted by id (D7, D8). |
| `async occupying_trips(db, *, org_id, driver_id=None, horse_id=None, trailer_ids=(), exclude_trip_id=None) -> list[...]` | DB | Non-terminal trips (D4) of the org sharing any of the given crew; with no crew filter, every non-terminal org trip (for the endpoint). Loads each trip's trailer ids and stop slot times in **one query each** (no N+1). |
| `async busy_crew_in_window(db, *, org_id, start, end, now, crew filter…) -> list[BusyEntry]` | DB | Windows for each occupying trip, keeping those that overlap `[start, end)`; one `BusyEntry` per shared resource. Used by creation, the endpoint and the picker. |
| `clash_message(entries) -> str` | pure | §5.2. |

Add one exception, `CrewUnavailableError(entries)`, to `app/core/exceptions.py` beside `TripActivationBlockedError`.
Map it in `endpoints/trips.py::_trip_http_error` to the 409 body in §4.2.

`_scheduled_departure` in `scheduling.py` and the new window code must not drift. Move nothing (freeze), but have
`availability.py` own the start/end resolution, and have `scheduling._scheduled_departure` keep its current behaviour.
Note the duplication in §12 for after the freeze.

### 7.2 Backend: creation (Stage 2)
`trips/creation.py::persist_trip` step 1 (lines 327-334) becomes one call to a new private helper in `creation.py`,
`_claim_crew(db, new_trip, org_id) -> (driver, horse, trailers)`. It runs `lock_crew` → the existing `_fetch_driver` /
`_fetch_vehicle` (404 rules unchanged) → `busy_crew_in_window(... start/end = the new trip's effective window ...)` → raises
`CrewUnavailableError` if any are found. The new trip's window comes from `new_trip.planned_departure_at`/`planned_arrival_at`,
or else `new_trip.stops`' slot times (same rule as D3). **`persist_trip` must get shorter** (rule 7).
Both creation endpoints inherit it, because both go through `persist_trip`.

### 7.3 Backend: activation (Stage 3), `phases/scheduling.py` and `phases/advance_activation.py`
- `_other_trips_for_driver` → `_other_trips_sharing_crew(db, trip)`: non-terminal trips sharing the driver, the horse or
  any of this trip's trailers (via `availability.occupying_trips`).
- `_reject_if_another_trip_underway(trip, others)` names which resource is shared: the driver first, then the horse, then
  trailers (§5.2).
- `_reject_if_an_earlier_trip_is_due` receives only `[o for o in others if o.driver_id == trip.driver_id]` (D10).
- `advance_activation` calls `availability.lock_crew(...)` after `_gate_and_load` (which already holds the trip lock), and
  before the "others" query. Keep the existing comment's point: all of this stays **after** the idempotent-replay short-circuit.
- Update the docstrings that say "driver only" (`scheduling.py:91-121`, `trips/administration.py:38`).

### 7.4 Backend: endpoint (Stage 4)
`GET /trips/availability` in `endpoints/trips.py`, placed before `/{trip_id}`. `tags` already set on the router.

### 7.5 Frontend (Stages 5–6), `frontend/dispatcher` + `frontend/shared`
| File | Change |
|---|---|
| `frontend/shared/lib/types/availability.ts` (new) | `BusyEntry`, `CrewAvailability` types mirroring §4.2/4.3. |
| `frontend/shared/lib/types/pp-manifest.ts` | `NO_PLANNED_ARRIVAL`, if codes are enumerated there. |
| `lib/api/client.ts` | `getCrewAvailability(startIso, endIso)` on the typed wrapper. |
| `lib/hooks/useCrewAvailability.ts` (new) | Given valid times, fetches (debounced; constant, not a magic number), drops stale replies (same generation-counter idea as `useFleetAnalytics`), exposes `busyById: Map<string, BusyEntry>`, `status`, `refetch`. |
| `lib/trips/manifest-form.ts` | `validateSchedule`: arrival required (§5.1). `validateCrew` gains the busy map: a picked busy driver/horse/trailer is a field error (D13). |
| `lib/trips/trip-api-errors.ts` | `CreateFailure` gains `{ kind: 'crew_unavailable'; message; clashes }` for 409 `CREW_UNAVAILABLE`. |
| `components/ui/SearchSelect.tsx` | `SearchSelectOption` gains optional `disabled?: boolean`. A disabled option renders faded, isn't selectable by click or keyboard, and gets `aria-disabled`. **Additive**: every other caller is unaffected. This is a UI-kit file, so flag it. |
| `components/trips/new/CrewFields.tsx` | New prop `busy: ReadonlyMap<string, BusyEntry>` + `availabilityStatus`. Busy driver/horse options: `disabled` + sublabel from §5.1. Busy trailers: checkbox `disabled`, faded row, the same line. The hint/unchecked lines. |
| `app/(app)/trips/new/page.tsx` | Calls the hook with the shown departure/arrival, passes `busy` to `CrewFields` and `validateCrew`. On `crew_unavailable`, show the message and `refetch()`. |

---

## 8. Tests required

### Backend (pytest; `cd backend && source .venv/bin/activate`)
| File | Cases |
|---|---|
| `tests/unit/test_trip_availability.py` (new) | `windows_overlap`: touching end==start both directions → False · one minute overlap → True · contained → True · identical → True · open end overlaps everything after start. `busy_window`: CREATED uses the plan · ACTIVE before its planned end uses the plan · ACTIVE/HELD after the planned end → `None` (until closed) · no planned end → `None`. `clash_message` wording for horse/trailer/driver, planned and live. |
| `tests/unit/test_schema_validators.py` | explicit create without arrival → 422 message · arrival from a later stop slot satisfies it · existing duration rules unchanged. |
| `tests/integration/test_trips.py` | 409 `CREW_UNAVAILABLE` for driver, horse and trailer clashes, body has `clashes` naming the trip · touching windows (new starts exactly at the other's planned arrival) → 201 · CLOSED and CANCELLED trips don't block · ACTIVE overdue trip blocks a booking for now · CREATED trip tomorrow doesn't block today (D5) · several clashes all listed · 422 without arrival · DB state: no trip row written on 409. |
| `tests/integration/test_trip_from_pp_manifest.py` | 422 `NO_PLANNED_ARRIVAL` when neither the request nor the manifest has one · 409 `CREW_UNAVAILABLE` on the manifest path. |
| `tests/integration/test_trip_availability_endpoint.py` (new) | 200 lists busy driver/horse/trailer overlapping the window · excludes terminal and non-overlapping trips · touching window excluded · another org's trips never appear · 401 without token · 403/401 as a driver (match existing dispatcher-only tests) · 422 when `end <= start`. |
| `tests/unit/test_phase_service.py` (beside the existing guard tests, ~line 2698) | activation refused when **the horse** is on another driver's ACTIVE trip · when **a trailer** is on a HELD trip · names the vehicle in the reason · allowed when the other trip is CLOSED · a CREATED trip on the same horse with **another driver**, earlier today, does **not** block (D10) · idempotent replay still 200. |
| `tests/integration/test_creation_concurrency.py` | Two dispatchers, same horse, overlapping windows, released together on the barrier → exactly one 201, the other 409 `CREW_UNAVAILABLE`. Write it first and confirm it **fails without the lock** (the file's own rule), then add the lock. Barrier before `lock_crew` (see the file's docstring about where barriers go). |
| `tests/integration/test_creation_concurrency.py` (or a sibling `test_activation_concurrency.py`) | Two drivers activating two CREATED trips that share a horse at once → exactly one succeeds. |

### Frontend (vitest; `cd frontend/dispatcher`)
| File | Cases |
|---|---|
| `components/ui/SearchSelect.test.tsx` (existing or new beside it) | a disabled option shows, can't be chosen by click or Enter, has `aria-disabled` |
| `components/trips/new/CrewFields.test.tsx` | busy horse greyed with "free after…" · live one says "free when it closes" · busy trailer checkbox disabled · busy driver greyed · hint shown when no times · "couldn't check" line |
| `lib/trips/manifest-form.test.ts` | arrival required · picked-busy field error |
| `lib/trips/trip-api-errors.test.ts` | 409 `CREW_UNAVAILABLE` → `crew_unavailable` with clashes |
| `lib/hooks/useCrewAvailability.test.tsx` | no fetch until both times valid · refetch on time change · stale reply dropped · error → status `error` |
| `app/(app)/trips/new/page.test.tsx` | picking times asks availability for that window · a 409 clash triggers a refetch |

CI commands (`.github/workflows/ci.yml`):
```bash
cd backend && source .venv/bin/activate && ruff check . && python scripts/check_structure.py && lint-imports && mypy . && pytest -m "not slow"
```
```bash
cd frontend/dispatcher && npm run lint && npm run type-check && npm test && npm run build
```

---

## 9. Stages

Each stage: PLAN → build → that stage's tests → check → TASK COMPLETE → **STOP for Tom**.
Local setup: Redis in Docker; `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000`;
`cd frontend/dispatcher && npm run dev` → <http://localhost:3000/trips/new> (Tom signs in).

### Stage 0: Baseline (no code)
- `git branch --show-current` (expect `feature/fp-139-vehicle-concurrency-guard`), rule-4 fetch, both CI blocks; record counts in §14.
- **Measure the test churn D1/D6 will cause:** list tests that POST a trip with no arrival, and tests that create two
  trips on one driver/horse/trailer with overlapping times. Report the counts to Tom before Stage 1.
- Check `scripts/seed_trips.py` and `scripts/seed_audit_pack_demo.py` for one horse on two simultaneously ACTIVE trips (would
  trip D9 on the demo DB). Report only.
- **Fence:** no edits.

### Stage 1: Arrival required (backend)
§4.1. Tests: the schema rows + the 422 rows. Fix existing tests' data (rule 8).
**Check:** `POST /trips` without arrival → 422 with the new message; manifest without one → 422 `NO_PLANNED_ARRIVAL`; `check_structure.py` passes.

### Stage 2: The busy rule + creation check + race guard
§7.1, §7.2, the 409 mapping. Tests: `test_trip_availability.py`, the creation rows, the creation concurrency test (fail first).
**Check:** two overlapping creates on one horse via `/docs` → second gets 409 naming TRP-x; touching windows both succeed; `persist_trip` shorter than 260; `lint-imports` clean.

### Stage 3: Activation guard
§7.3. Tests: the `test_phase_service.py` rows + the activation race.
**Check:** from `/dev/triggers` or the driver app, start trip A on horse H, then try to start trip B (another driver, horse H) → 409 naming the horse.

### Stage 4: Availability endpoint
§4.3, §7.4. Tests: `test_trip_availability_endpoint.py`.
**Check:** `/docs` → `GET /trips/availability` for tomorrow's window lists the expected busy crew.

### Stage 5: Wizard: arrival required + greyed pickers
§7.5 (all rows). Tests: the frontend table.
**Check (Tom, browser):** new trip → enter times → a horse on another trip in that window is greyed with its "free after…" line and can't be picked; a trailer likewise; move the times to after its arrival → it becomes pickable; leave arrival empty → "Enter a planned arrival."; Tom decides here whether drivers stay greyed (D12).

### Stage 6: Full checks + wrap-up
Both CI blocks; fill §14; TASK COMPLETE listing shared/flagged files (§10 R6). Suggested commits, one per logical change:
`feat(orchestration): require arrival and refuse crew clashes at trip creation (FP-139)` ·
`feat(orchestration): refuse activation when the horse or a trailer is underway elsewhere (FP-139)` ·
`feat(api): crew availability read for the trip wizard (FP-142)` ·
`feat(dispatcher): grey out busy drivers, horses and trailers in the trip wizard (FP-142)`.
Demo script for Tom (3 lines): create TRP-A on horse H Thu 08–16 → new trip Thu 10–14 shows H greyed "free after Thu 16:00" → set 16:00–20:00, H is pickable.

---

## 10. Risks and tripwires

| # | Risk | Early warning | Fallback |
|---|---|---|---|
| R1 | Many existing tests break (no arrival / overlapping fixtures). | Stage 0 count. | Fix test data (rule 8). If more than ~40 files are affected, stop and show Tom before continuing. |
| R2 | Structure ratchet fails (`persist_trip`, `schemas/trips.py`). | `check_structure.py`. | Net-zero edits (§4.1, §7.2). Never `--update`. |
| R3 | Deadlock between creation and activation. | Concurrency tests hang. | Lock order D8. Also grep `fleet/vehicles.py` / `fleet/drivers.py`: if any path locks a vehicle and then a trip, stop and tell Tom. |
| R4 | The demo DB already has one horse on two live trips → activation 409 in a demo. | Stage 0 seed check. | Cancel one of them in the dispatcher; don't weaken D9. |
| R5 | `/trips/availability` swallowed by `/{trip_id}`. | 422 "invalid UUID". | Declare it first (§4.3). |
| R6 | Shared/team files touched: `backend/.importlinter`, `components/ui/SearchSelect.tsx` (UI kit), `frontend/shared/lib/types/*`. None are on CLAUDE.md's coordinate-first list, but all are used by teammates. | — | Additive changes only; flag all three in TASK COMPLETE. |
| R7 | Ciaran's planned wizard rebuild (FP-282) lands on `dev` mid-work. | Rule 4. | Stop and tell Tom; the picker changes then move to Ciaran's new Cargo & assignment step. |
| R8 | Lock held during the ~5 s Hedera anchor makes the second dispatcher wait. | Slow second create in the race test. | Expected and correct: they then get the 409. Only callers that share crew wait (`NO KEY`, D7). |
| R9 | Lots of non-terminal trips make the endpoint slow (windows computed in Python). | — | Fine at project scale; note the SQL-side filter as a later improvement (§12). |

---

## 11. Out of scope

A fleet calendar or week strip · auto-suggesting a free horse · editing a trip's crew or times after creation (not possible
today) · a turnaround buffer · making `planned_arrival_at` NOT NULL in the DB · drafts (FP-283 has no code, and Jira
returns "does not exist" for it; when drafts land, their confirm must go through `persist_trip` to inherit this) ·
driver PWA changes · seed data changes · moving or renaming files (freeze).

---

## 12. Things found while reading (for Tom, not built here)

- The ticket comment points at drafts (FP-283), but no draft code exists in `backend/app` or the wizard, and the
  Jira key returns "does not exist". The concurrency intent is covered by D7 regardless.
- A trip's driver, horse and trailers are never changed after creation (no writer outside `trips/creation.py`), so trip rows are the whole truth for "who is on what".
- `phases/override.py` can complete a phase for the driver, but only `advance_activation` ever sets `ACTIVE`. So an
  overridden activation leaves the trip `CREATED`, which this guard then treats as "planned, not underway". Worth a separate look.
- After the freeze: fold `scheduling._scheduled_departure` into `trips.availability` so the start-of-window rule lives in one place.
- Availability filters windows in Python after an org-wide query. Fine now; a SQL-side window filter is the scale-up.

---

## 13. Verification summary

End to end on localhost: a dispatcher creating a trip sees busy crew greyed with when each is free. Picking a free window
makes them pickable. Forcing a clash via `/docs` gets a 409 naming the trip. Two simultaneous creates on one horse produce
exactly one trip. A driver can't start a trip whose horse is underway on another driver's trip. Both CI blocks are green,
`check_structure.py` and `lint-imports` are clean, and there is no migration and no new `.env` key.

---

## 14. Progress

| Stage | Status | Tests (backend / dispatcher) | Notes |
|---|---|---|---|
| 0 Baseline | NOT STARTED | | |
| 1 Arrival required | NOT STARTED | | |
| 2 Busy rule + creation + race | NOT STARTED | | |
| 3 Activation guard | NOT STARTED | | |
| 4 Availability endpoint | NOT STARTED | | |
| 5 Wizard | NOT STARTED | | |
| 6 Full checks | NOT STARTED | | |

## 15. Decisions taken during the build

(empty; record each with Why and Who, as in the FP-296 spec §15)
