# S7 — Checkpoints on the in-transit journey: Implementation Plan

> **PARKED 2026-09-24 — do not execute.** Checkpoints are not used in practice and were dropped
> from the Arrival slice. S7 is now the on-road tracker check (design note §4.7). Kept only in
> case driver checkpoints are revisited; re-verify every file reference before reuse.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A checkpoint the driver logs on the road appears, live and without a reload, as a timestamped node in the dispatcher's in-transit journey timeline, with the phone fix and the tracker corroboration already recorded for it.

**Architecture:** No schema change. The data is already written by `checkpoint_service.log_checkpoint`. The backend adds `checkpoints` to the existing dispatcher trip-detail response and publishes an INFO `checkpoint_logged` realtime event after a new checkpoint commits. The dispatcher's trip page already refetches trip detail on any event for that trip (`useTripResource` → `useLiveResource`), so the new node appears with no new hook. A pure helper scopes checkpoints to a leg and `InTransitTimeline` renders them interleaved with exceptions in time order.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Pydantic v2, pytest + pytest-asyncio; Next.js 15, React 19, TypeScript, Vitest + Testing Library.

**Spec:** [docs/design-notes/2026-09-23-arrival-phase-and-live-journey.md](../../design-notes/2026-09-23-arrival-phase-and-live-journey.md) §3.4 and §4.7 (S7).

## Global Constraints

- Read `CLAUDE.md` first. **Claude never runs `git commit`** — each task ends by staging named files and printing a suggested Conventional Commit; Ciaran commits.
- No migration. No Alembic command of any kind.
- **Recording, not responding** (design note §4.7): nothing here reroutes, dispatches, or alerts. The event is `INFO` so `toastForEvent` stays silent (`dispatcher/lib/realtime/ranking.ts`).
- Realtime events stay thin: ids + kind + severity only, no GPS or notes on the wire (`core/realtime.py` module docstring, POPIA).
- A replayed checkpoint (same `client_report_id`) must **not** publish a second event.
- Layering: `orchestration/` may import `core/`; `db/` imports nothing from `app/`.
- Frontend: no `any`; typed `api` client only; prop interfaces explicit.
- Null is unknown, not zero: a checkpoint with no assessment shows no comparison line, never "within limit".
- Run backend pytest in the **foreground** only (a background run races the Stop hook and drops the test schema).

## Decision recorded here

**Checkpoints ride on `GET /trips/{trip_id}` instead of a new endpoint.** The design note allows either. Chosen because (1) the trip page already refetches that response on every trip event, so no new hook or subscription is needed; (2) leg scoping needs `phases` and `checkpoints` from the **same** snapshot, or a checkpoint can be placed against a stale leg state; (3) one authorised read path, already org-scoped. Cost: `/trips/me/{trip_id}` (driver) also returns the driver's own checkpoints — their own data, no new exposure.

## File map

| File | Change | Responsibility |
|---|---|---|
| `backend/app/schemas/trips.py` | Modify | `TripDetailResponse.checkpoints` |
| `backend/app/orchestration/resource_service.py` | Modify | Load the trip's checkpoints in `get_trip_detail` |
| `backend/app/core/realtime.py` | Modify | `RealtimeKind.CHECKPOINT_LOGGED` |
| `backend/app/orchestration/checkpoint_service.py` | Modify | Enqueue the event for a newly written checkpoint |
| `backend/tests/integration/test_checkpoints.py` | Modify | Detail read + event emission tests |
| `backend/tests/unit/test_realtime_emit.py` | Modify | Closed-set kind test gains `checkpoint_logged` |
| `frontend/shared/lib/types/checkpoint.ts` | Modify | Mirror `driver_captured_at`, `phase_event_id` |
| `frontend/shared/lib/types/trip.ts` | Modify | `Trip.checkpoints` |
| `frontend/dispatcher/lib/realtime/types.ts` | Modify | `'checkpoint_logged'` kind |
| `frontend/dispatcher/lib/realtime/ranking.test.ts` | Modify | Pin: checkpoint events never toast |
| `frontend/dispatcher/lib/format/proximity.ts` | Create | One wording for a driver-vs-truck comparison |
| `frontend/dispatcher/lib/format/proximity.test.ts` | Create | |
| `frontend/dispatcher/components/domain/ExceptionEvidence.tsx` | Modify | Use `fmtProximity` (same text, no behaviour change) |
| `frontend/dispatcher/lib/phase/journey.ts` | Create | Pure: leg scoping, event time, late receipt, label, time merge |
| `frontend/dispatcher/lib/phase/journey.test.ts` | Create | |
| `frontend/dispatcher/components/domain/InTransitTimeline.tsx` | Modify | Render checkpoint nodes |
| `frontend/dispatcher/components/domain/__tests__/InTransitTimeline.checkpoints.test.tsx` | Create | |
| `frontend/dispatcher/components/trips/TripTimeline.tsx` | Modify | Pass the leg's checkpoints |
| `frontend/dispatcher/components/trips/TripTimeline.test.tsx` | Modify | Wiring test |
| `docs/design-notes/2026-09-23-arrival-phase-and-live-journey.md` | Modify | §3.4 "Missing" table + S7 status |

**Out of scope:** checkpoint photos on the rail (selfie/cargo — that is S6's photo-row work), a map of the leg, tracker-derived rows (S8), the `CurrentLegStrip` count, any driver-app change (the driver app already sends `phase_event_id` — `CheckpointPageClient.tsx` → `contextPhaseEventId`).

---

### Task 1: Checkpoints in the dispatcher trip detail

**Files:**
- Modify: `backend/app/schemas/trips.py` (imports ~line 16; `TripDetailResponse` ~line 533)
- Modify: `backend/app/orchestration/resource_service.py` (imports ~line 28/37; `get_trip_detail` ~line 302–440)
- Test: `backend/tests/integration/test_checkpoints.py`

**Interfaces:**
- Produces: `TripDetailResponse.checkpoints: list[CheckpointRead]`, ordered by `(created_at, id)`. JSON key `checkpoints`. Each item is the existing `CheckpointRead` (includes `phase_event_id`, `driver_captured_at`, `action_location_assessment`, `created_at`).

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/integration/test_checkpoints.py` (`User`, `Checkpoint`, `select`, `datetime` and `UTC` are already imported; change the datetime import to `from datetime import UTC, datetime, timedelta`):

```python
async def _dispatcher_token_for(db_session, trip) -> str:
    user = (
        await db_session.execute(select(User).where(User.organization_id == trip.operator_organization_id))
    ).scalars().first()
    return make_token(sub=str(user.id), role="dispatcher", org_id=str(trip.operator_organization_id))


async def test_trip_detail_includes_logged_checkpoints_in_order(client: AsyncClient, db_session, seed_trip):
    # Rows inserted directly with explicit created_at: two POSTs inside one test
    # transaction would share now(), leaving the order to the random-uuid tiebreaker.
    trip, _driver = seed_trip
    now = datetime.now(UTC)
    db_session.add_all([
        Checkpoint(trip_id=trip.id, checkpoint_type="manual", note="second stop", created_at=now),
        Checkpoint(trip_id=trip.id, checkpoint_type="manual", note="first stop", created_at=now - timedelta(minutes=30)),
    ])
    await db_session.flush()

    resp = await client.get(f"/api/v1/trips/{trip.id}", headers=auth_header(await _dispatcher_token_for(db_session, trip)))

    assert resp.status_code == 200
    checkpoints = resp.json()["checkpoints"]
    assert [c["note"] for c in checkpoints] == ["first stop", "second stop"]
    assert all(c["trip_id"] == str(trip.id) for c in checkpoints)


async def test_trip_detail_checkpoints_empty_when_none_logged(client: AsyncClient, db_session, seed_trip):
    trip, _driver = seed_trip

    resp = await client.get(f"/api/v1/trips/{trip.id}", headers=auth_header(await _dispatcher_token_for(db_session, trip)))

    assert resp.status_code == 200
    assert resp.json()["checkpoints"] == []


async def test_trip_detail_checkpoints_hidden_from_other_org(client: AsyncClient, db_session, seed_trip):
    trip, _driver = seed_trip
    other_org = Organization(id=uuid.uuid4(), name="Other", org_type=OrganizationType.OPERATOR)
    db_session.add(other_org)
    await db_session.flush()
    other_user = User(id=uuid.uuid4(), organization_id=other_org.id, email="o@test.co.za", full_name="O")
    db_session.add(other_user)
    await db_session.flush()
    token = make_token(sub=str(other_user.id), role="dispatcher", org_id=str(other_org.id))

    resp = await client.get(f"/api/v1/trips/{trip.id}", headers=auth_header(token))

    assert resp.status_code == 404
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && pytest tests/integration/test_checkpoints.py -k trip_detail -v`
Expected: the first two FAIL with `KeyError: 'checkpoints'`; the 404 test passes already (auth is unchanged — it stays as a guard).

If `_dispatcher_token_for` returns a 401/403 instead of 200, compare with how `tests/integration/test_trips.py` (~line 153) seeds its dispatcher user and copy that shape; do not change auth code.

- [ ] **Step 3: Implement**

In `backend/app/schemas/trips.py` change the transit import:

```python
from app.schemas.transit import CheckpointRead, TripExceptionRead
```

and in `TripDetailResponse`, directly after `exceptions: list[TripExceptionRead]`:

```python
    # Driver-logged roadside checkpoints, oldest first. On the detail response rather
    # than their own endpoint so the dispatcher places each one against the SAME
    # phases snapshot it arrived with (design note S7).
    checkpoints: list[CheckpointRead] = []
```

In `backend/app/orchestration/resource_service.py` change the transit model import:

```python
from app.db.models.transit import Checkpoint, TripException
```

and the transit schema import:

```python
from app.schemas.transit import CheckpointRead, TripExceptionRead
```

In `get_trip_detail`, directly after the `exceptions = exc_result.scalars().all()` line:

```python
    # id tiebreaker for the same reason as consignments below: rows written in one
    # transaction share created_at.
    checkpoint_result = await db.execute(
        select(Checkpoint)
        .where(Checkpoint.trip_id == trip_id)
        .order_by(Checkpoint.created_at, Checkpoint.id)
    )
    checkpoints = checkpoint_result.scalars().all()
```

and in the `TripDetailResponse(...)` call, after `exceptions=...`:

```python
        checkpoints=[CheckpointRead.model_validate(c) for c in checkpoints],
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && pytest tests/integration/test_checkpoints.py tests/integration/test_trips.py -v`
Expected: all PASS.

- [ ] **Step 5: Stage**

```bash
git add backend/app/schemas/trips.py backend/app/orchestration/resource_service.py backend/tests/integration/test_checkpoints.py
```
Suggested commit: `feat(api): include driver checkpoints in trip detail`

---

### Task 2: `checkpoint_logged` realtime event

**Files:**
- Modify: `backend/app/core/realtime.py` (`RealtimeKind`, ~line 49)
- Modify: `backend/app/orchestration/checkpoint_service.py` (imports; end of `log_checkpoint`)
- Modify: `backend/tests/unit/test_realtime_emit.py` (`test_every_realtime_kind_names_a_change_not_a_loudness`, ~line 447)
- Test: `backend/tests/integration/test_checkpoints.py`

**Interfaces:**
- Produces: `RealtimeKind.CHECKPOINT_LOGGED = "checkpoint_logged"`; one `TripEvent(id=trip.id, kind=CHECKPOINT_LOGGED, severity=INFO)` per newly written checkpoint, enqueued on the org channel.

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/integration/test_checkpoints.py` and add the import `from app.core.realtime import EventSeverity, RealtimeKind`:

```python
_OUTBOX_KEY = "realtime_outbox"


def _checkpoint_events(db_session) -> list:
    # get_db is overridden without a commit, so the outbox the after_commit hook would
    # drain is still on the session — the same technique tests/unit/test_realtime_emit.py uses.
    return [
        (org_id, event) for org_id, event in db_session.info.get(_OUTBOX_KEY, [])
        if event.kind == RealtimeKind.CHECKPOINT_LOGGED
    ]


async def test_logging_checkpoint_enqueues_info_event_for_trip(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/checkpoints",
        json={"checkpoint_type": "manual"},
        headers=auth_header(token),
    )

    assert resp.status_code == 201
    events = _checkpoint_events(db_session)
    assert len(events) == 1
    org_id, event = events[0]
    assert org_id == trip.operator_organization_id
    assert event.id == trip.id
    assert event.severity == EventSeverity.INFO


async def test_replayed_checkpoint_does_not_enqueue_second_event(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    body = {"checkpoint_type": "manual", "client_report_id": str(uuid.uuid4())}

    first = await client.post(f"/api/v1/trips/{trip.id}/checkpoints", json=body, headers=auth_header(token))
    replay = await client.post(f"/api/v1/trips/{trip.id}/checkpoints", json=body, headers=auth_header(token))

    assert first.status_code == 201
    assert replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]
    assert len(_checkpoint_events(db_session)) == 1
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && pytest tests/integration/test_checkpoints.py -k "event" -v`
Expected: FAIL with `AttributeError: CHECKPOINT_LOGGED`.

- [ ] **Step 3: Implement**

In `backend/app/core/realtime.py`, add to `RealtimeKind` after `EXCEPTION_REVIEWED`:

```python
    # Evidence recorded on the road. Always INFO: a checkpoint is a record, not an
    # alarm — any finding it produces arrives separately as EXCEPTION_RAISED.
    CHECKPOINT_LOGGED = "checkpoint_logged"
```

In `backend/app/orchestration/checkpoint_service.py` add the import:

```python
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
```

and at the end of `log_checkpoint`, replacing the final three lines:

```python
    await db.flush()
    await db.refresh(checkpoint)
    # Only a newly written row reaches here — both replay paths returned above — so a
    # queue draining the same checkpoint twice cannot announce it twice. Published
    # after commit by the realtime hook (D9), never mid-transaction.
    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(id=trip.id, kind=RealtimeKind.CHECKPOINT_LOGGED),
    )
    return CheckpointRead.model_validate(checkpoint)
```

In `backend/tests/unit/test_realtime_emit.py`, update the pinned set:

```python
    assert {k.value for k in RealtimeKind} == {
        "trip_created", "phase_completed", "exception_raised", "exception_reviewed",
        "trip_closed", "checkpoint_logged",
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && pytest tests/integration/test_checkpoints.py tests/unit/test_realtime_emit.py tests/unit/test_realtime.py tests/integration/test_stream.py -v`
Expected: all PASS.

- [ ] **Step 5: Stage**

```bash
git add backend/app/core/realtime.py backend/app/orchestration/checkpoint_service.py backend/tests/integration/test_checkpoints.py backend/tests/unit/test_realtime_emit.py
```
Suggested commit: `feat(orchestration): publish checkpoint_logged realtime event`

---

### Task 3: Frontend types and realtime kind

**Files:**
- Modify: `frontend/shared/lib/types/checkpoint.ts`
- Modify: `frontend/shared/lib/types/trip.ts` (`Trip`, ~line 123)
- Modify: `frontend/dispatcher/lib/realtime/types.ts`
- Test: `frontend/dispatcher/lib/realtime/ranking.test.ts`

**Interfaces:**
- Produces: `Checkpoint.driver_captured_at?: string | null`, `Checkpoint.phase_event_id?: string | null`; `Trip.checkpoints?: Checkpoint[]`; `RealtimeKind` includes `'checkpoint_logged'`.

- [ ] **Step 1: Write the failing test** — add to `frontend/dispatcher/lib/realtime/ranking.test.ts` (import `type RealtimeEvent` from `./types` if the file does not already):

```ts
it('never toasts a checkpoint — it is a record, not an alert', () => {
  const event: RealtimeEvent = {
    resource: 'trip', id: 'trip-1', kind: 'checkpoint_logged', severity: 'info', ts: '2026-01-02T02:00:00Z',
  }

  expect(toastForEvent(event)).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend/dispatcher && npx vitest run lib/realtime/ranking.test.ts && npm run type-check`
Expected: type-check FAILS (`'checkpoint_logged'` not assignable to `RealtimeKind`). Vitest may pass at runtime — the type error is the failure.

- [ ] **Step 3: Implement**

`frontend/dispatcher/lib/realtime/types.ts`:

```ts
export type RealtimeKind =
  | 'trip_created'
  | 'phase_completed'
  | 'exception_raised'
  | 'exception_reviewed'
  | 'trip_closed'
  | 'checkpoint_logged'
```

`frontend/shared/lib/types/checkpoint.ts`, after `driver_phone_lng`:

```ts
  // The driver's own submit instant. Optional because demo-mode and older fixtures
  // build Checkpoints without it; the backend always sends it (null when absent).
  driver_captured_at?: string | null
```

and after `action_location_assessment`:

```ts
  // The phase the driver was in when logging — the in-transit leg for a roadside
  // checkpoint. Null on checkpoints from installs that predate attribution.
  phase_event_id?: string | null
```

`frontend/shared/lib/types/trip.ts`: add `import type { Checkpoint } from './checkpoint'` with the other type imports, and in `Trip` after `exceptions: TripException[]`:

```ts
  // Driver-logged roadside checkpoints, oldest first. Optional only because the many
  // hand-built Trip fixtures predate it; GET /trips/{id} always sends an array.
  checkpoints?: Checkpoint[]
```

- [ ] **Step 4: Run to verify**

Run: `cd frontend/dispatcher && npx vitest run lib/realtime && npm run type-check` and `cd ../driver-pwa && npm run type-check`
Expected: PASS for both apps (shared types are consumed by both).

- [ ] **Step 5: Stage**

```bash
git add frontend/shared/lib/types/checkpoint.ts frontend/shared/lib/types/trip.ts frontend/dispatcher/lib/realtime/types.ts frontend/dispatcher/lib/realtime/ranking.test.ts
```
Suggested commit: `feat(shared): checkpoint fields on trip detail and checkpoint_logged kind`

---

### Task 4: Pure journey helpers and one proximity wording

**Files:**
- Create: `frontend/dispatcher/lib/format/proximity.ts`, `frontend/dispatcher/lib/format/proximity.test.ts`
- Modify: `frontend/dispatcher/components/domain/ExceptionEvidence.tsx` (the `System comparison` block, ~line 101–112)
- Create: `frontend/dispatcher/lib/phase/journey.ts`, `frontend/dispatcher/lib/phase/journey.test.ts`

**Interfaces:**
- Consumes: `legDepartureAt(phases, inTransitPhase): string | null` from `lib/phase/derive.ts`.
- Produces:
  - `fmtProximity(assessment: ActionLocationAssessment): string`
  - `checkpointEventTime(checkpoint: Checkpoint): string`
  - `DELAYED_RECEIPT_THRESHOLD_MS: number`
  - `receivedLate(checkpoint: Checkpoint): boolean`
  - `checkpointLabel(checkpointType: string): string`
  - `checkpointsForLeg(checkpoints: readonly Checkpoint[], leg: PhaseDescriptor, allPhases: readonly PhaseDescriptor[]): Checkpoint[]`
  - `mergeByTime<T>(first: readonly T[], second: readonly T[], timeOf: (item: T) => string): T[]`

- [ ] **Step 1: Write the failing tests**

`frontend/dispatcher/lib/format/proximity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fmtProximity } from './proximity'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'

function assessment(overrides: Partial<ActionLocationAssessment>): ActionLocationAssessment {
  return {
    schema_version: 1, policy_version: 'v1', evaluated_at: '2026-01-02T02:00:00Z',
    driver_lat: null, driver_lng: null, driver_captured_at: null, driver_accuracy_metres: null,
    tracker_lat: null, tracker_lng: null, tracker_captured_at: null,
    separation_metres: null, proximity: 'unverified', reasons: [],
    max_separation_metres: 250, max_age_seconds: 300, max_skew_seconds: 120, max_phone_accuracy_metres: 100,
    expected_trip_stop_id: null, precinct_id: null, precinct_lat: null, precinct_lng: null,
    precinct_radius_metres: null, precinct_tolerance_metres: null,
    driver_in_precinct: null, truck_in_precinct: null,
    ...overrides,
  }
}

describe('fmtProximity', () => {
  it('names a separation', () => {
    expect(fmtProximity(assessment({ proximity: 'separated' }))).toBe('Driver and vehicle locations were separated')
  })

  it('names agreement within the limit', () => {
    expect(fmtProximity(assessment({ proximity: 'within_limit' })))
      .toBe('Driver and vehicle locations were within the comparison limit')
  })

  it('says why a comparison could not be made', () => {
    expect(fmtProximity(assessment({ proximity: 'unverified', reasons: ['missing_tracker', 'stale_fix'] })))
      .toBe('Location comparison unverified (missing_tracker, stale_fix)')
  })
})
```

`frontend/dispatcher/lib/phase/journey.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkpointEventTime, checkpointLabel, checkpointsForLeg, mergeByTime, receivedLate } from './journey'
import { makePhase } from '@/components/domain/__tests__/testFixtures'
import type { Checkpoint, CheckpointId } from '@shared/lib/types/checkpoint'
import type { PhaseEventId } from '@shared/lib/types/phase'

const LEG_ID = 'leg-1' as PhaseEventId

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'cp-1' as CheckpointId, trip_id: 'trip-1', checkpoint_type: 'manual',
    driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null,
    selfie_artifact_id: null, cargo_photo_artifact_id: null, note: null, is_deviation: false,
    merkle_batch_id: null, created_at: '2026-01-02T02:00:00Z',
    ...overrides,
  }
}

const departure = makePhase('departure', { phase_event_id: 'dep' as PhaseEventId, sequence_number: 3, status: 'completed', completed_at: '2026-01-02T01:00:00Z' })
const drivingLeg = makePhase('in_transit', { phase_event_id: LEG_ID, sequence_number: 4, status: 'pending', completed_at: null })
const finishedLeg = makePhase('in_transit', { phase_event_id: LEG_ID, sequence_number: 4, status: 'completed', completed_at: '2026-01-02T05:00:00Z' })

describe('checkpointEventTime', () => {
  it('prefers the driver capture instant over server receipt', () => {
    expect(checkpointEventTime(checkpoint({ driver_captured_at: '2026-01-02T01:30:00Z', created_at: '2026-01-02T03:00:00Z' })))
      .toBe('2026-01-02T01:30:00Z')
  })

  it('falls back to server receipt when the phone sent no time', () => {
    expect(checkpointEventTime(checkpoint({ driver_captured_at: null }))).toBe('2026-01-02T02:00:00Z')
  })
})

describe('receivedLate', () => {
  it('is true for an offline replay received well after capture', () => {
    expect(receivedLate(checkpoint({ driver_captured_at: '2026-01-02T01:00:00Z', created_at: '2026-01-02T02:00:00Z' }))).toBe(true)
  })

  it('is false for ordinary network latency', () => {
    expect(receivedLate(checkpoint({ driver_captured_at: '2026-01-02T01:59:55Z', created_at: '2026-01-02T02:00:00Z' }))).toBe(false)
  })

  it('is false when there is no capture time to compare', () => {
    expect(receivedLate(checkpoint({ driver_captured_at: null }))).toBe(false)
  })
})

describe('checkpointLabel', () => {
  it('names a driver checkpoint', () => {
    expect(checkpointLabel('manual')).toBe('Driver checkpoint')
  })

  it('shows an unknown type rather than hiding it', () => {
    expect(checkpointLabel('weighbridge')).toBe('Checkpoint (weighbridge)')
  })
})

describe('checkpointsForLeg', () => {
  it('keeps checkpoints attributed to this leg and drops those of another phase', () => {
    const mine = checkpoint({ id: 'a' as CheckpointId, phase_event_id: LEG_ID })
    const other = checkpoint({ id: 'b' as CheckpointId, phase_event_id: 'another-leg' })

    expect(checkpointsForLeg([mine, other], drivingLeg, [departure, drivingLeg]).map(c => c.id)).toEqual(['a'])
  })

  it('places an unattributed checkpoint by time inside the leg window', () => {
    const during = checkpoint({ id: 'in' as CheckpointId, phase_event_id: null, driver_captured_at: '2026-01-02T03:00:00Z' })
    const before = checkpoint({ id: 'pre' as CheckpointId, phase_event_id: null, driver_captured_at: '2026-01-02T00:30:00Z' })
    const after = checkpoint({ id: 'post' as CheckpointId, phase_event_id: null, driver_captured_at: '2026-01-02T06:00:00Z' })

    expect(checkpointsForLeg([during, before, after], finishedLeg, [departure, finishedLeg]).map(c => c.id)).toEqual(['in'])
  })

  it('places no unattributed checkpoint on a leg that has not departed', () => {
    const pendingDeparture = makePhase('departure', { phase_event_id: 'dep' as PhaseEventId, sequence_number: 3, status: 'pending', completed_at: null })
    const orphan = checkpoint({ phase_event_id: null })

    expect(checkpointsForLeg([orphan], drivingLeg, [pendingDeparture, drivingLeg])).toEqual([])
  })

  it('returns checkpoints oldest first by event time', () => {
    const late = checkpoint({ id: 'late' as CheckpointId, phase_event_id: LEG_ID, driver_captured_at: '2026-01-02T04:00:00Z' })
    const early = checkpoint({ id: 'early' as CheckpointId, phase_event_id: LEG_ID, driver_captured_at: '2026-01-02T02:00:00Z' })

    expect(checkpointsForLeg([late, early], drivingLeg, [departure, drivingLeg]).map(c => c.id)).toEqual(['early', 'late'])
  })
})

describe('mergeByTime', () => {
  it('interleaves two sorted lists by time and keeps each list in its own order', () => {
    const exceptions = [{ id: 'e1', t: '2026-01-02T02:00:00Z' }, { id: 'e2', t: '2026-01-02T04:00:00Z' }]
    const checkpoints = [{ id: 'c1', t: '2026-01-02T03:00:00Z' }]

    expect(mergeByTime(exceptions, checkpoints, item => item.t).map(i => i.id)).toEqual(['e1', 'c1', 'e2'])
  })

  it('puts the first list first on a tie', () => {
    const a = [{ id: 'a', t: '2026-01-02T02:00:00Z' }]
    const b = [{ id: 'b', t: '2026-01-02T02:00:00Z' }]

    expect(mergeByTime(a, b, item => item.t).map(i => i.id)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run lib/format/proximity.test.ts lib/phase/journey.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`frontend/dispatcher/lib/format/proximity.ts`:

```ts
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'

/**
 * One sentence for a server-built driver-vs-vehicle comparison. Shared by exception
 * evidence and journey checkpoints so the same verdict never reads two ways.
 * Unverified lists its reasons: "could not check" must stay distinguishable from "fine".
 */
export function fmtProximity(assessment: ActionLocationAssessment): string {
  if (assessment.proximity === 'separated') return 'Driver and vehicle locations were separated'
  if (assessment.proximity === 'within_limit') return 'Driver and vehicle locations were within the comparison limit'
  return `Location comparison unverified (${assessment.reasons.join(', ')})`
}
```

In `frontend/dispatcher/components/domain/ExceptionEvidence.tsx` add `import { fmtProximity } from '@/lib/format/proximity'` and replace the nested ternary inside the `System comparison` block with:

```tsx
          <div className="text-[12px] text-on-surf">
            {fmtProximity(assessment)}
          </div>
```

`frontend/dispatcher/lib/phase/journey.ts`:

```ts
import { legDepartureAt } from './derive'
import type { Checkpoint } from '@shared/lib/types/checkpoint'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

// Below this gap between the phone's capture time and server receipt, the difference is
// network latency. Above it, the checkpoint was queued offline and replayed later, and
// the dispatcher should see both times rather than assume it arrived live.
export const DELAYED_RECEIPT_THRESHOLD_MS = 60_000

const CHECKPOINT_TYPE_LABELS: Readonly<Record<string, string>> = {
  manual: 'Driver checkpoint',
}

/** When it happened on the road. Server receipt only when the phone sent no time. */
export function checkpointEventTime(checkpoint: Checkpoint): string {
  return checkpoint.driver_captured_at ?? checkpoint.created_at
}

export function receivedLate(checkpoint: Checkpoint): boolean {
  if (!checkpoint.driver_captured_at) return false
  return Date.parse(checkpoint.created_at) - Date.parse(checkpoint.driver_captured_at) > DELAYED_RECEIPT_THRESHOLD_MS
}

/** Unknown types are shown by name, never hidden: a recorded row must always appear. */
export function checkpointLabel(checkpointType: string): string {
  return CHECKPOINT_TYPE_LABELS[checkpointType] ?? `Checkpoint (${checkpointType})`
}

/**
 * The checkpoints that belong on this in-transit leg, oldest first.
 *
 * Attributed rows are matched on phase_event_id — the driver app records which leg it
 * was on at capture, and the server verified it. Unattributed rows (installs that
 * predate attribution) are placed by time inside the leg's own window: from this leg's
 * departure to its completion, or open-ended while driving. A leg that has not departed
 * has no window, so it claims none of them.
 */
export function checkpointsForLeg(
  checkpoints: readonly Checkpoint[],
  leg: PhaseDescriptor,
  allPhases: readonly PhaseDescriptor[],
): Checkpoint[] {
  const departedAt = legDepartureAt(allPhases, leg)
  const start = departedAt === null ? null : Date.parse(departedAt)
  const end = leg.completed_at ? Date.parse(leg.completed_at) : null

  const inWindow = (checkpoint: Checkpoint): boolean => {
    if (start === null) return false
    const at = Date.parse(checkpointEventTime(checkpoint))
    return at >= start && (end === null || at <= end)
  }

  return checkpoints
    .filter(checkpoint => (checkpoint.phase_event_id ? checkpoint.phase_event_id === leg.phase_event_id : inWindow(checkpoint)))
    .sort((a, b) => Date.parse(checkpointEventTime(a)) - Date.parse(checkpointEventTime(b)) || a.id.localeCompare(b.id))
}

/**
 * Interleave two lists that are each already in order, without re-sorting either.
 * Re-sorting would override the caller's own ordering rule for exceptions
 * (sortExceptionsByEventTime), which is not purely created_at.
 */
export function mergeByTime<T>(first: readonly T[], second: readonly T[], timeOf: (item: T) => string): T[] {
  const merged: T[] = []
  let i = 0
  let j = 0
  while (i < first.length && j < second.length) {
    if (Date.parse(timeOf(second[j])) < Date.parse(timeOf(first[i]))) merged.push(second[j++])
    else merged.push(first[i++])
  }
  return [...merged, ...first.slice(i), ...second.slice(j)]
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend/dispatcher && npx vitest run lib/format lib/phase components/domain && npm run type-check`
Expected: all PASS, including existing `ExceptionEvidence` tests (wording unchanged).

- [ ] **Step 5: Stage**

```bash
git add frontend/dispatcher/lib/format/proximity.ts frontend/dispatcher/lib/format/proximity.test.ts frontend/dispatcher/components/domain/ExceptionEvidence.tsx frontend/dispatcher/lib/phase/journey.ts frontend/dispatcher/lib/phase/journey.test.ts
```
Suggested commit: `feat(dispatcher): journey checkpoint helpers and shared proximity wording`

---

### Task 5: Checkpoint nodes on the journey timeline

**Files:**
- Modify: `frontend/dispatcher/components/domain/InTransitTimeline.tsx`
- Create: `frontend/dispatcher/components/domain/__tests__/InTransitTimeline.checkpoints.test.tsx`
- Modify: `frontend/dispatcher/components/trips/TripTimeline.tsx` (the `<InTransitTimeline ... />` element, ~line 147)
- Modify: `frontend/dispatcher/components/trips/TripTimeline.test.tsx`

**Interfaces:**
- Consumes: everything Task 4 produces.
- Produces: `InTransitTimeline` prop `checkpoints?: readonly Checkpoint[]` (already scoped to the leg by the caller); checkpoint nodes carry `data-testid="transit-checkpoint-marker"`.

- [ ] **Step 1: Write the failing component tests** — `frontend/dispatcher/components/domain/__tests__/InTransitTimeline.checkpoints.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InTransitTimeline } from '../InTransitTimeline'
import { makePhase } from './testFixtures'
import type { Checkpoint, CheckpointId } from '@shared/lib/types/checkpoint'
import type { ExceptionId, TripException } from '@shared/lib/types/exception'
import type { PhaseEventId } from '@shared/lib/types/phase'

const LEG_ID = 'phase-event-1' as PhaseEventId
const departure = makePhase('departure', { phase_event_id: 'dep' as PhaseEventId, sequence_number: 3, status: 'completed', completed_at: '2026-01-02T01:00:00Z' })
const leg = makePhase('in_transit', { phase_event_id: LEG_ID, sequence_number: 4, status: 'pending', completed_at: null })

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'cp-1' as CheckpointId, trip_id: 'trip-1', checkpoint_type: 'manual',
    driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null,
    selfie_artifact_id: null, cargo_photo_artifact_id: null, note: null, is_deviation: false,
    merkle_batch_id: null, phase_event_id: LEG_ID,
    driver_captured_at: '2026-01-02T02:00:00Z', created_at: '2026-01-02T02:00:05Z',
    ...overrides,
  }
}

function exception(overrides: Partial<TripException> = {}): TripException {
  return {
    id: 'exc-1' as ExceptionId, trip_id: 'trip-1', exception_type: 'panic_button', source: 'driver',
    severity: 'critical', description: 'd', phase_event_id: LEG_ID, checkpoint_id: null,
    supporting_artifact_id: null, review_status: 'recorded', review_outcome: null,
    reviewed_by_user_id: null, reviewed_at: null, review_note: null, contact_method: null,
    vehicle_id: null, merkle_batch_id: null,
    created_at: '2026-01-02T03:00:00Z', updated_at: '2026-01-02T03:00:00Z',
    ...overrides,
  }
}

function renderLeg(checkpoints: Checkpoint[], exceptions: TripException[] = []) {
  return render(
    <InTransitTimeline phase={leg} allPhases={[departure, leg]} exceptions={exceptions}
      checkpoints={checkpoints} originName="Cape Town DC" destinationName="Paarl Depot" />,
  )
}

describe('InTransitTimeline: checkpoint nodes', () => {
  it('shows a logged checkpoint as a journey node with its note', () => {
    renderLeg([checkpoint({ note: 'Fuel stop N1' })])

    const marker = screen.getByTestId('transit-checkpoint-marker')
    expect(within(marker).getByText('Driver checkpoint')).toBeInTheDocument()
    expect(within(marker).getByText('Fuel stop N1')).toBeInTheDocument()
  })

  it('interleaves checkpoints and exceptions in time order', () => {
    renderLeg(
      [checkpoint({ id: 'early' as CheckpointId, driver_captured_at: '2026-01-02T02:00:00Z' }),
       checkpoint({ id: 'late' as CheckpointId, driver_captured_at: '2026-01-02T04:00:00Z' })],
      [exception({ created_at: '2026-01-02T03:00:00Z' })],
    )

    const kinds = screen.getAllByTestId(/transit-(checkpoint|exception)-marker/).map(el => el.dataset.testid)
    expect(kinds).toEqual(['transit-checkpoint-marker', 'transit-exception-marker', 'transit-checkpoint-marker'])
  })

  it('flags a checkpoint the driver marked as off route', () => {
    renderLeg([checkpoint({ is_deviation: true })])

    expect(within(screen.getByTestId('transit-checkpoint-marker')).getByText('Off route')).toBeInTheDocument()
  })

  it('shows the recorded driver-vs-vehicle comparison when one exists', () => {
    renderLeg([checkpoint({
      action_location_assessment: {
        schema_version: 1, policy_version: 'v1', evaluated_at: '2026-01-02T02:00:05Z',
        driver_lat: -33.9, driver_lng: 18.6, driver_captured_at: '2026-01-02T02:00:00Z', driver_accuracy_metres: 10,
        tracker_lat: -33.9, tracker_lng: 18.6, tracker_captured_at: '2026-01-02T02:00:00Z',
        separation_metres: 12, proximity: 'within_limit', reasons: [],
        max_separation_metres: 250, max_age_seconds: 300, max_skew_seconds: 120, max_phone_accuracy_metres: 100,
        expected_trip_stop_id: null, precinct_id: null, precinct_lat: null, precinct_lng: null,
        precinct_radius_metres: null, precinct_tolerance_metres: null, driver_in_precinct: null, truck_in_precinct: null,
      },
    })])

    expect(screen.getByText('Driver and vehicle locations were within the comparison limit')).toBeInTheDocument()
  })

  it('shows no comparison line when none was recorded — unknown is not "fine"', () => {
    renderLeg([checkpoint({ action_location_assessment: null })])

    expect(screen.queryByText(/comparison/)).not.toBeInTheDocument()
  })

  it('shows when a delayed offline checkpoint was received', () => {
    renderLeg([checkpoint({ driver_captured_at: '2026-01-02T02:00:00Z', created_at: '2026-01-02T03:30:00Z' })])

    expect(within(screen.getByTestId('transit-checkpoint-marker')).getByText(/^Received /)).toBeInTheDocument()
  })

  it('renders no checkpoint nodes when none are passed', () => {
    render(<InTransitTimeline phase={leg} allPhases={[departure, leg]} exceptions={[]} originName="A" destinationName="B" />)

    expect(screen.queryByTestId('transit-checkpoint-marker')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run components/domain/__tests__/InTransitTimeline.checkpoints.test.tsx`
Expected: FAIL — no `transit-checkpoint-marker`.

- [ ] **Step 3: Implement `InTransitTimeline`**

Add imports:

```tsx
import { checkpointEventTime, checkpointLabel, mergeByTime, receivedLate } from '@/lib/phase/journey'
import { fmtProximity } from '@/lib/format/proximity'
import type { Checkpoint } from '@shared/lib/types/checkpoint'
```

Add to `Props` after `exceptions`:

```tsx
  // Checkpoints the driver logged on THIS leg, already scoped by the caller
  // (checkpointsForLeg). Optional so existing callers and fixtures without checkpoint
  // data render unchanged; TripTimeline always passes it.
  checkpoints?: readonly Checkpoint[]
```

Change `MiniNode`:

```tsx
type MiniNode = {
  key: string
  kind: 'departed' | 'exception' | 'checkpoint' | 'arrived' | 'awaiting'
  label: string
  timestamp: string | null
  exception?: TripException
  checkpoint?: Checkpoint
}
```

Update the function signature to destructure `checkpoints = []`, and replace the `nodes.push(...exceptions.map(...))` block with:

```tsx
  const exceptionNodes = exceptions.map((exc): MiniNode => ({
    key: exc.id,
    kind: 'exception',
    label: fmtExceptionType(exc.exception_type),
    timestamp: exc.created_at,
    exception: exc,
  }))
  const checkpointNodes = checkpoints.map((checkpoint): MiniNode => ({
    key: checkpoint.id,
    kind: 'checkpoint',
    label: checkpointLabel(checkpoint.checkpoint_type),
    timestamp: checkpointEventTime(checkpoint),
    checkpoint,
  }))
  // Both node kinds always carry a timestamp; `?? ''` only satisfies the shared type.
  nodes.push(...mergeByTime(exceptionNodes, checkpointNodes, node => node.timestamp ?? ''))
```

Add `checkpoint: 'bg-sec',` to `dotStyle`. Change the row's `data-testid` to:

```tsx
data-testid={node.kind === 'exception' ? 'transit-exception-marker' : node.kind === 'checkpoint' ? 'transit-checkpoint-marker' : undefined}
```

Inside the label `<span>`, after the exception `Chip`:

```tsx
                {node.checkpoint?.is_deviation && <Chip type="exception" label="Off route" />}
```

After the closing `</div>` of the `flex items-baseline justify-between` row, still inside `flex-1 pb-[8px] min-w-0`:

```tsx
            {node.checkpoint && <CheckpointFacts checkpoint={node.checkpoint} />}
```

Add below `InTransitTimeline` (same file — private to it):

```tsx
/** The recorded facts under one checkpoint node. Each line renders only when its fact
 *  was recorded: an absent comparison is not a passed one. */
function CheckpointFacts({ checkpoint }: { checkpoint: Checkpoint }) {
  const assessment = checkpoint.action_location_assessment
  const lat = checkpoint.driver_phone_lat
  const lng = checkpoint.driver_phone_lng
  return (
    <div className="mt-[2px] space-y-[1px] text-[11px] text-on-surf-v">
      {checkpoint.note && <div className="text-on-surf">{checkpoint.note}</div>}
      {lat !== null && lng !== null && (
        <div className="font-mono tabular-nums">Phone {lat.toFixed(5)}, {lng.toFixed(5)}</div>
      )}
      {assessment && <div>{fmtProximity(assessment)}</div>}
      {receivedLate(checkpoint) && <div>Received {fmtDateTime(checkpoint.created_at)}</div>}
    </div>
  )
}
```

Update the component doc comment's second paragraph to: "Movement nodes come from the ledger (departure and this leg's completion); driver-logged checkpoints and exceptions are interleaved between them in time order. Tracker-derived rows (S8) are absent rather than faked." The footer line "Only recorded journey events are shown." stays — it is still true.

Note: `driver_phone_lat` arrives from the backend as a JSON number (`CheckpointBase.driver_phone_lat: Optional[float]`). If a test or the live page shows it as a string, stop and check the serialised response before adding any coercion.

- [ ] **Step 4: Run the component tests**

Run: `cd frontend/dispatcher && npx vitest run components/domain`
Expected: all PASS, including the untouched `InTransitTimeline.location.test.tsx`.

- [ ] **Step 5: Write the failing wiring test** — add to `TripTimeline.test.tsx` inside `describe('TripTimeline: transit journey summary stays outside disclosure', ...)`, and add `import type { Checkpoint, CheckpointId } from '@shared/lib/types/checkpoint'`:

```tsx
  it('shows a checkpoint logged on the driving leg in its journey', () => {
    const base = tripFor(TRIP_0041_ID)
    const leg = base.phases.find(p => p.phase_type === 'in_transit')
    if (!leg) throw new Error('fixture TRIP_0041 has no in_transit leg')
    const checkpoint: Checkpoint = {
      id: 'cp-wire' as CheckpointId, trip_id: base.id, checkpoint_type: 'manual',
      driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null,
      selfie_artifact_id: null, cargo_photo_artifact_id: null, note: 'Weighbridge N3', is_deviation: false,
      merkle_batch_id: null, phase_event_id: leg.phase_event_id,
      driver_captured_at: null, created_at: new Date().toISOString(),
    }

    render(
      <TripTimeline trip={{ ...base, checkpoints: [checkpoint] }} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    expect(within(phaseGroupElement('In Transit')).getByText('Weighbridge N3')).toBeInTheDocument()
  })
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd frontend/dispatcher && npx vitest run components/trips/TripTimeline.test.tsx -t "checkpoint logged"`
Expected: FAIL — text not found.

- [ ] **Step 7: Wire it in `TripTimeline.tsx`**

Add `import { checkpointsForLeg } from '@/lib/phase/journey'` and pass the prop on the existing element:

```tsx
          ? <InTransitTimeline
              phase={phase}
              allPhases={trip.phases}
              originName={precinctLabel(precinctAtPhase(trip, phase, precincts))}
              destinationName={precinctLabel(precincts.find(p => p.id === nextTripStop(trip, phase)?.precinct_id))}
              exceptions={exceptions}
              checkpoints={checkpointsForLeg(trip.checkpoints ?? [], phase, trip.phases)}
            />
```

- [ ] **Step 8: Run the full dispatcher checks**

Run: `cd frontend/dispatcher && npm test && npm run lint && npm run type-check`
Expected: all PASS. Record any pre-existing failures separately (the 2026-09-09 log noted two existing `next/image` lint warnings).

- [ ] **Step 9: Stage**

```bash
git add frontend/dispatcher/components/domain/InTransitTimeline.tsx frontend/dispatcher/components/domain/__tests__/InTransitTimeline.checkpoints.test.tsx frontend/dispatcher/components/trips/TripTimeline.tsx frontend/dispatcher/components/trips/TripTimeline.test.tsx
```
Suggested commit: `feat(dispatcher): show driver checkpoints on the in-transit journey`

---

### Task 6: Verify end to end and close the note

**Files:**
- Modify: `docs/design-notes/2026-09-23-arrival-phase-and-live-journey.md`

- [ ] **Step 1: Full backend suite, foreground**

Run: `cd backend && pytest`
Expected: green. Paste the summary line into the TASK COMPLETE report.

- [ ] **Step 2: Other frontend consumers of the shared types**

Run: `cd frontend/driver-pwa && npm run type-check && npm test`
Expected: PASS (only optional fields were added to shared types).

- [ ] **Step 3: Live check (manual, not against the shared Supabase DB)**

This branch's models expect columns the shared dev DB does not have yet (S5 is not applied). Ciaran points `DATABASE_URL` at a local Postgres and runs `alembic upgrade head` there himself — never against the shared database. With the dispatcher open on an in-transit trip, log a checkpoint from the driver app (or `POST /api/v1/trips/{id}/checkpoints` with a driver token). Expected: within about a second the node appears in the journey without a reload, and no toast is shown. If local services are unavailable, say so in the report — do not claim this step passed.

- [ ] **Step 4: Update the design note**

In §3.4's "Missing" table, change the **checkpoints** row's "State today" to: `Shown on the in-transit journey (S7): on GET /trips/{id} as checkpoints, live via INFO checkpoint_logged`. In §7, append ` — **done 2026-09-XX**` to the S7 row's "Done when" cell (fill in the real date).

- [ ] **Step 5: Stage and report**

```bash
git add docs/design-notes/2026-09-23-arrival-phase-and-live-journey.md
```
Suggested commit: `docs: mark S7 journey checkpoints done`

Produce the CLAUDE.md TASK COMPLETE block. Shared files touched: `frontend/shared/lib/types/checkpoint.ts`, `frontend/shared/lib/types/trip.ts` (optional fields only). Migrations: none. New .env keys: none.
