# Driver-owned arrival (`in_transit` becomes a submitted phase) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make arrival an explicit driver submission so `in_transit.completed_at` records when the driver actually arrived, and `in_transit` stops being the one ledger row with no owner.

**Architecture:** Add an `InTransitCompleteRequest` member to the `PhaseCompleteRequest` discriminated union and a thin `advance_in_transit` wrapper that records position and marks the row COMPLETED. The existing "Arrive at destination" swipe on the driver-pwa in-transit hub submits it through the same background submitter every other phase uses, then navigates as it does today. Once the row has an owner, `_gate_and_load`'s `IN_TRANSIT` exclusion and `advance_unloading`'s side-effect close of the row are both removable — and that removal is what closes the V3 override strand structurally.

**Tech Stack:** FastAPI 0.115 + Pydantic v2 + SQLAlchemy 2.0 async (backend), pytest/pytest-asyncio; Next.js 15 App Router + TypeScript 5.5 + vitest (driver-pwa).

---

## Decisions locked before starting (Part E.1 of the audit brief)

These are not open. Do not re-litigate them mid-execution.

| # | Decision | Consequence if violated |
|---|---|---|
| 1 | `STEP_SLUGS.in_transit` stays `[]`. The submit happens on the hub swipe, never a step page. | A step recipe perturbs `actionablePhase()`, changes routing, and forces a shared `phase-meta` edit in both languages under `test_phase_meta_contract.py`. |
| 2 | Payload is GPS + timestamp + idempotency key. No photo, no artifact, no anchor. | It becomes a different, more expensive feature. |
| 3 | `isDriving`'s case 2 is DELETED in the same change. | V7 resurrects: Home says "Continue driving" for the whole unloading phase. |
| 4 | The dispatcher's `in_transit` override (`dispatcher/app/(app)/trips/[id]/page.tsx:842-843`) STAYS. | No recovery path for a driver whose phone dies mid-drive and can never submit arrival. |
| 5 | `_gate_and_load`'s `IN_TRANSIT` exclusion comes out **last**, only after the full walk passes without it. Its other three checks (ownership, trip-status, scan gate) are untouched. | Load-bearing gates get collateral damage. |

**Scope fence: hub-to-hub only.** Multi-stop is not being fixed. Multi-leg *tests* are updated where they assert deleted behaviour — that is not the same as fixing multi-stop, and no `build_phase_plan` / `create_trip` change is in scope.

---

## Rules that override anything below

1. **Never run `git commit`, `push`, `merge`, `rebase`, `checkout`, `stash`, `reset` or `restore`.** CLAUDE.md reserves those for the developer. Every task ends by staging its files with `git add <specific paths>` and reporting a suggested Conventional Commit message. The "Commit" steps below have been rewritten accordingly.
2. **The interpreter is `backend/.venv/bin/python -m pytest`.** Bare `pytest` and `python` are not on PATH; `python3` is the wrong (3.11) build.
3. **Never run two pytest processes against the same DB.** Session teardown drops all tables — a concurrent run manufactures fake failures in both.
4. **Read the `N passed / N failed` summary line, never `tail`.** Teardown prints a redis `RuntimeError: Event loop is closed` traceback after the summary on every run. It is noise.

---

## Environment — read before running anything

```bash
# Integration tests SKIP SILENTLY without this. Skipped count must be ~4, not ~364.
echo $TEST_DATABASE_URL
```

Never run two pytest processes against the same DB — session teardown drops all tables and manufactures fake failures.

Baseline on `scan-driven-driver-pwa` @ `dda51c6`: **8 failed / 648 passed / 4 skipped.** Two of those eight are the known V2 stale unit tests (`test_advance_departure_leaves_in_transit_pending` and the multi-leg sibling), which this plan rewrites in Task 8. The other six are **not characterised** — Task 0 pins them by name so a regression is distinguishable from a pre-existing failure.

---

## Task 0: Capture the baseline before touching anything

**DONE 2026-08-09. Results recorded below — do not re-run as part of execution.**

### Environment facts every task depends on

- **The interpreter is `backend/.venv/bin/python -m pytest`.** There is no `pytest` on PATH and no `python`; bare `pytest` fails with "command not found" and `python3` resolves to a 3.11 framework build that is not this project's environment. `.venv/bin/python` is 3.13.13.
- **`TEST_DATABASE_URL` lives in `backend/.env`, not the shell.** `settings.TEST_DATABASE_URL` (pydantic-settings) is what `tests/conftest.py:174` checks. `echo $TEST_DATABASE_URL` printing nothing is expected and means nothing. Integration tests confirmed running: `tests/integration/test_phases.py` = 31 passed, 0 skipped.
- Teardown emits `RuntimeError: Event loop is closed` from redis `__del__` after the summary line. It is noise, not a failure — always read the `N passed / N failed` summary, never `tail`.

### Baseline: 8 failed / 651 passed / 4 skipped (167s)

**Six pre-existing failures, unrelated to this work. These must still be failing at the end — they are not ours to fix:**

```
tests/integration/test_blockchain_verify.py::test_verify_returns_no_receipt_for_unknown_subject
tests/integration/test_drivers.py::test_create_driver_appears_in_subsequent_list
tests/integration/test_drivers.py::test_create_driver_returns_201_with_pending_status
tests/integration/test_drivers_anchor.py::test_create_driver_does_not_anchor_pii
tests/integration/test_vehicles_cosmetic_diff.py::test_mixed_patch_anchors_only_critical_field
tests/integration/test_vehicles_validation.py::test_update_vehicle_invalid_vin_leaves_db_state_unchanged
```

**Two V2 stale failures, which THIS work fixes.** Note these are *not* the tests the plan originally guessed at — verified by running them:

| Test | Fails on | Why it is a fossil |
|---|---|---|
| `tests/unit/test_phase_service.py::test_current_phase_and_current_stop_track_the_ledger` (line 1580) | `assert trip.current_phase == PhaseType.UNLOADING` → got `in_transit` | Asserts the ledger skips straight to unloading after departure — true only while `in_transit` auto-completed. |
| `tests/unit/test_phase_service.py::test_replayed_exception_completion_is_idempotent_no_duplicate_exception` (line 633) | `assert phases["in_transit"].status == PhaseStatus.COMPLETED` → got `pending` | Same fossil, asserted on the replay path. |

Both are **rewritten, not deleted** (Task 8 Step 5a) — the behaviour they cover (position tracking, replay idempotency) still needs coverage and becomes *more* meaningful once arrival is a real submission.

**Expected end state: 6 failed** (the six above), not 0 and not 8.

### Frontend baseline (driver-pwa, captured 2026-08-09)

**`Test Files 1 failed | 76 passed (77)` · `Tests 618 passed (618)`**

Zero failing *tests*. One test FILE fails to collect:

```
FAIL components/map/__tests__/DriverMap.test.tsx
  Failed to resolve import "@googlemaps/js-api-loader" from "components/map/DriverMap.tsx"
```

Pre-existing and unrelated — the `@googlemaps` dependency is imported but not installed (audit Part C flags this exact item as an uncommitted `package.json` change). **Do not install it and do not touch `package.json`** — that is another developer's pending change.

This matters for Task 5: `InTransitPageClient` imports `DriverMap`, yet `InTransitPageClient.test.tsx` passes at baseline, which means that suite already stubs `DriverMap`. Preserve whatever mock it uses; do not let a new test import the real component.

**Expected end state: still 1 failed file (DriverMap only), 0 failed tests, and a higher passing count.**

---

## File structure

### Backend — modified

| File | Responsibility after this change |
|---|---|
| `backend/app/schemas/phases.py` | Gains `InTransitCompleteRequest`; the union comment stops citing a fence that no longer holds. |
| `backend/app/orchestration/phase_service.py` | Gains `advance_in_transit` + dispatch-table entry; loses `_gate_and_load`'s `IN_TRANSIT` exclusion, `advance_unloading`'s in-transit close block, and `_find_in_transit_for_leg`. |
| `backend/tests/integration/test_phases.py` | 422 fence test inverts to a 200 contract test; walks gain an arrival call. |
| `backend/tests/unit/test_phase_service.py` | `_advance_to_unloading` helper gains an arrival call; two V2 tests rewritten to the new contract; stale `_auto_complete_in_transit` prose fixed. |
| `backend/tests/integration/test_handshakes_anchor.py` | Walk gains an arrival call; stale prose fixed. |
| `backend/tests/integration/test_v3_override_hole_probe.py` | Replaced by a permanent regression test; probe file deleted. |

### Driver-pwa — modified

| File | Responsibility after this change |
|---|---|
| `frontend/driver-pwa/lib/types/evidence-draft.ts` | Gains `InTransitEvidence` (timestamp only) and adds it to the `PhaseEvidence` union. |
| `frontend/driver-pwa/lib/api/phases.ts` | Gains `InTransitCompleteRequest` and a real `case 'in_transit'` in `submitPhase`. |
| `frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx` | The swipe submits arrival, then navigates. |
| `frontend/driver-pwa/lib/phase/derive.ts` | `isDriving` collapses to case 1 only. |
| `frontend/driver-pwa/lib/phase/routes.ts` | Comment-only: stops describing in_transit as auto-completed. |
| `frontend/driver-pwa/lib/hooks/useOfflineQueue.ts` | **Task 9 only, decision-gated.** Stops flushing a trip's later phase entries after one transient failure. |

### Not touched

- `frontend/shared/lib/constants/phase-meta.ts` and `backend/app/core/phase_meta.py` — **no shared-file change** (decision 1). `backend/tests/unit/test_phase_meta_contract.py` must still pass untouched; that is the proof.
- `frontend/shared/lib/types/phase.ts` — `PhaseType` already includes `in_transit`.
- `backend/app/orchestration/phase_gate.py` — `IN_TRANSIT` is deliberately absent from `GATED_PHASES`, so arrival is never scan-gated. Correct as-is; Task 3 adds a test pinning it.
- `dispatcher/` — decision 4.
- No migration. No new `.env` key. No new dependency.

---

## Task 1: Backend — `InTransitCompleteRequest` joins the union

**Files:**
- Modify: `backend/app/schemas/phases.py:300-314`
- Test: `backend/tests/unit/test_phase_schemas.py` (create if absent — check first with `ls backend/tests/unit/ | grep schema`)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_phase_schemas.py` (create the file with the imports shown if it does not exist):

```python
import uuid

import pytest
from pydantic import TypeAdapter, ValidationError

from app.db.models.enums import PhaseType
from app.schemas.phases import InTransitCompleteRequest, PhaseCompleteRequest

_ADAPTER = TypeAdapter(PhaseCompleteRequest)


def test_in_transit_payload_resolves_to_its_own_union_member():
    """Arrival is a driver submission as of 2026-08-09 (audit Part E.1), so the
    discriminator must resolve `in_transit` instead of raising union_tag_invalid."""
    parsed = _ADAPTER.validate_python(
        {"phase_type": "in_transit", "idempotency_key": str(uuid.uuid4())}
    )

    assert isinstance(parsed, InTransitCompleteRequest)


def test_in_transit_payload_carries_the_arrival_position():
    """GPS, timestamp, idempotency key — the whole payload. The position is the only
    substantive evidence an arrival attestation carries."""
    parsed = _ADAPTER.validate_python({
        "phase_type": "in_transit",
        "idempotency_key": "queue-entry-1",
        "driver_phone_lat": -33.9249,
        "driver_phone_lng": 18.4241,
    })

    assert parsed.driver_phone_lat == -33.9249
    assert parsed.driver_phone_lng == 18.4241


def test_in_transit_payload_rejects_a_half_position():
    """Inherited from _PhaseCompleteBase: a lone axis is not a position."""
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python({
            "phase_type": "in_transit",
            "idempotency_key": "queue-entry-2",
            "driver_phone_lat": -33.9249,
        })


def test_trip_creation_is_still_not_driver_addressable():
    """Only in_transit changed. trip_creation has no actor and stays out of the union."""
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python(
            {"phase_type": "trip_creation", "idempotency_key": str(uuid.uuid4())}
        )


def test_phase_type_enum_still_has_seven_members():
    """Guards against someone 'solving' this by adding an enum member."""
    assert len(list(PhaseType)) == 7
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd backend && pytest tests/unit/test_phase_schemas.py -v
```

Expected: `ImportError: cannot import name 'InTransitCompleteRequest' from 'app.schemas.phases'`.

- [ ] **Step 3: Add the schema**

In `backend/app/schemas/phases.py`, insert immediately after `DepartureCompleteRequest` ends (after its `validate_seal_number` validator, before `class UnloadingCompleteRequest`):

```python
class InTransitCompleteRequest(_PhaseCompleteBase):
    # The driver attesting "I have arrived" — the act that closes the driving leg.
    #
    # The whole payload is _PhaseCompleteBase: idempotency key and the phone fix. There
    # is deliberately no photo and no artifact. This is an ATTESTATION, not an evidence
    # capture: the driver performs a physical swipe meaning "I am here", and the only
    # thing worth recording about it is when and where. Giving it a photo would make it a
    # capture step, which would need a step recipe, which would change STEP_SLUGS — the
    # shared contract this design was explicitly shaped to leave alone.
    #
    # Unanchored, like activation/loading/unloading: ANCHORED_PHASES stays
    # trip_creation/departure/confirmation (frontend/shared/lib/constants/phase-meta.ts).
    # An arrival timestamp derives its integrity from the departure and confirmation
    # anchors that bracket it, not from a receipt of its own.
    phase_type: Literal[PhaseType.IN_TRANSIT]
```

Then replace the union block at the end of the file (currently lines 300-314) with:

```python
# Decision S5. One endpoint, six real shapes: Pydantic picks the member from
# `phase_type` and validates it properly, so a missing seal_number is still a
# 422 and not a hand-rolled service-layer error.
#
# in_transit joined this union on 2026-08-09 (audit Part E.1). It used to be excluded
# alongside trip_creation, on the stated grounds that it was "completed by the authorized
# _auto_complete_in_transit stopgap" — a function deleted in 9be7a78 that exists nowhere
# in app/. The fence outlived its reason: since 9be7a78 nothing closed the row except
# advance_unloading's side effect, which meant in_transit.completed_at recorded when the
# unloading PAPERWORK was submitted rather than when the driver arrived, and an
# overridden unloading left the row PENDING forever with no actor able to resolve it.
#
# trip_creation remains absent and always will be: it is written by create_trip before a
# driver is involved at all, and addressing it gets a 409 from complete_phase()'s
# dispatch table.
PhaseCompleteRequest = Annotated[
    Union[
        ActivationCompleteRequest,
        LoadingCompleteRequest,
        DepartureCompleteRequest,
        InTransitCompleteRequest,
        UnloadingCompleteRequest,
        ConfirmationCompleteRequest,
    ],
    Field(discriminator="phase_type"),
]
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd backend && pytest tests/unit/test_phase_schemas.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/phases.py backend/tests/unit/test_phase_schemas.py
# DO NOT COMMIT. CLAUDE.md reserves commits for the developer.
# Files are staged; report this suggested message and stop:
#   feat(api): add in_transit to the PhaseCompleteRequest union
```

---

## Task 2: Backend — `advance_in_transit`

**Files:**
- Modify: `backend/app/orchestration/phase_service.py` (add wrapper before `advance_unloading` at line 1084; add dispatch entry at line 1308)
- Test: `backend/tests/unit/test_phase_service.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/unit/test_phase_service.py`, immediately after `test_advance_departure_leaves_in_transit_pending` (~line 905). Add `advance_in_transit` and `InTransitCompleteRequest` to the module's existing imports from `app.orchestration.phase_service` and `app.schemas.phases`.

```python
# ── advance_in_transit ──────────────────────────────────────────────────────

def _arrival_payload(**overrides) -> InTransitCompleteRequest:
    """The whole arrival payload. Position defaults to a real fix because the point of
    the phase is recording WHERE the driver arrived; tests that care about the
    no-fix path pass driver_phone_lat=None, driver_phone_lng=None explicitly."""
    fields: dict = {
        "phase_type": PhaseType.IN_TRANSIT,
        "idempotency_key": str(uuid.uuid4()),
        "driver_phone_lat": Decimal("-29.8587"),
        "driver_phone_lng": Decimal("31.0218"),
    }
    fields.update(overrides)
    return InTransitCompleteRequest(**fields)


@pytest.mark.asyncio
async def test_advance_in_transit_closes_the_leg_and_records_arrival_position(
    db_session, trip_fixture,
):
    """The point of the whole change: completed_at is stamped when the DRIVER says he
    arrived, not when the unloading paperwork lands."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)

    result = await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].status == PhaseStatus.COMPLETED
    assert phases["in_transit"].completed_at is not None
    assert float(phases["in_transit"].driver_phone_lat) == pytest.approx(-29.8587)
    assert float(phases["in_transit"].driver_phone_lng) == pytest.approx(31.0218)

    in_response = next(p for p in result.phases if p.phase_type == PhaseType.IN_TRANSIT)
    assert in_response.status == PhaseStatus.COMPLETED


@pytest.mark.asyncio
async def test_advance_in_transit_moves_the_position_cache_to_unloading(
    db_session, trip_fixture,
):
    """recompute_position must walk past the now-resolved arrival row to the next
    unresolved one. Without this the driver arrives and the board still reads 'driving'."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )

    await db_session.refresh(trip)
    assert PhaseType(trip.current_phase) == PhaseType.UNLOADING


@pytest.mark.asyncio
async def test_advance_in_transit_before_departure_is_rejected(db_session, trip_fixture):
    """An arrival cannot be claimed on a leg never departed. DEPARTURE sits at a lower
    sequence than IN_TRANSIT, so _gate_and_load's ordinary lower-sequence gate — not any
    in_transit special case — is what refuses this."""
    trip, driver, phases = trip_fixture
    await _advance_to_loading(db_session, trip, driver, phases)

    with pytest.raises(PhaseSequenceError):
        await advance_in_transit(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
        )


@pytest.mark.asyncio
async def test_advance_in_transit_replay_is_idempotent(db_session, trip_fixture):
    """Drivers lose signal at destination gates; the offline queue resends. A replay must
    return current state without re-stamping the arrival time."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    payload = _arrival_payload(idempotency_key="offline-queue-entry-arrival-1")

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=payload,
    )
    await db_session.refresh(phases["in_transit"])
    first_completed_at = phases["in_transit"].completed_at

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=payload,
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].completed_at == first_completed_at


@pytest.mark.asyncio
async def test_advance_in_transit_accepts_a_submission_with_no_fix(db_session, trip_fixture):
    """A destination gate under a canopy must never be a reason arrival goes unrecorded.
    Only activation requires a position."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id,
        payload=_arrival_payload(driver_phone_lat=None, driver_phone_lng=None),
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].status == PhaseStatus.COMPLETED
    assert phases["in_transit"].driver_phone_lat is None


@pytest.mark.asyncio
async def test_advance_in_transit_does_not_anchor(db_session, trip_fixture, stub_hedera_service):
    """Unanchored by design — ANCHORED_PHASES is trip_creation/departure/confirmation.
    An arrival receipt would be a fourth anchor nobody asked for."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    stub_hedera_service.return_value.submit_hash.reset_mock()

    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].event_hash is None
    assert phases["in_transit"].blockchain_receipt_id is None
    assert stub_hedera_service.return_value.submit_hash.call_count == 0
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd backend && pytest tests/unit/test_phase_service.py -k advance_in_transit -v
```

Expected: collection error — `cannot import name 'advance_in_transit'`.

- [ ] **Step 3: Implement the wrapper**

In `backend/app/orchestration/phase_service.py`, insert immediately before `async def advance_unloading` (line 1084):

```python
async def advance_in_transit(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: InTransitCompleteRequest,
) -> TripDetailResponse:
    """The driver attesting arrival — the act that closes the driving leg.

    The thinnest wrapper in this module, and that is the design. It writes no evidence of
    its own beyond the phone fix _record_driver_position stores for every phase, and it
    anchors nothing. What it changes is WHO owns the row: before 2026-08-09 in_transit was
    opened by advance_departure and closed as a side effect of advance_unloading, which
    meant its completed_at recorded when the unloading paperwork was submitted, not when
    the truck actually arrived — the dispatcher's elapsed drive time silently swallowed
    the entire unloading phase. It also meant an overridden unloading left the row PENDING
    with no actor able to resolve it, stranding the trip ACTIVE forever (audit V3).

    No _reject_if_not_due and no scan gate: IN_TRANSIT is absent from
    phase_gate.GATED_PHASES on purpose. The destination warehouse has not scanned anything
    when the driver pulls up at the boom — gating arrival on a scan that only happens
    after arrival would deadlock the leg. UNLOADING carries that gate instead, which is
    the correct place for it.

    The driver app submits this from the in-transit hub's existing "Arrive at destination"
    swipe (driver-pwa InTransitPageClient.tsx), NOT from a step page: STEP_SLUGS[in_transit]
    stays empty so actionablePhase() keeps skipping the row and routing is unchanged.
    """
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Arrival",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    event.status = PhaseStatus.COMPLETED

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)
```

Add `InTransitCompleteRequest` to the existing `from app.schemas.phases import (...)` block at the top of the file.

Then extend the dispatch table (line 1308):

```python
_WRAPPER_BY_PHASE_TYPE: dict[PhaseType, _WrapperFn] = {
    PhaseType.ACTIVATION: advance_activation,
    PhaseType.LOADING: advance_loading,
    PhaseType.DEPARTURE: advance_departure,
    PhaseType.IN_TRANSIT: advance_in_transit,
    PhaseType.UNLOADING: advance_unloading,
    PhaseType.CONFIRMATION: advance_confirmation,
}
```

And correct `complete_phase`'s docstring (line 1321-1327), which still names a deleted function:

```python
    """Complete the addressed phase. Idempotent by payload.idempotency_key.

    Raises PhaseTypeMismatchError when the body's phase_type does not match the
    addressed row's — including when the row is trip_creation, which no driver action
    completes (create_trip writes it before a driver is involved). in_transit IS
    driver-completable as of 2026-08-09 (advance_in_transit); it used to be listed here
    alongside trip_creation.
    """
```

- [ ] **Step 4: Run them and watch them pass**

```bash
cd backend && pytest tests/unit/test_phase_service.py -k advance_in_transit -v
```

Expected: 6 passed.

- [ ] **Step 5: Confirm nothing else moved**

```bash
cd backend && pytest tests/unit -q
```

Expected: the same 2 known V2 failures (`test_advance_departure_leaves_in_transit_pending`, `test_advance_departure_leaves_all_in_transit_rows_pending`) and nothing new. They are rewritten in Task 8.

- [ ] **Step 6: Commit**

```bash
git add backend/app/orchestration/phase_service.py backend/tests/unit/test_phase_service.py
# DO NOT COMMIT. CLAUDE.md reserves commits for the developer.
# Files are staged; report this suggested message and stop:
#   feat(orchestration): add advance_in_transit so arrival is a driver submission
```

---

## Task 3: Backend — invert the 422 fence, pin the scan gate, retire the stale prose

**Files:**
- Modify: `backend/tests/integration/test_phases.py:705-728` (the fence test) and `:95` (stale comment)
- Modify: `backend/tests/unit/test_phase_service.py:157`, `:602`, `:918` (stale comments)
- Modify: `backend/tests/integration/test_handshakes_anchor.py:92` (stale comment)

- [ ] **Step 1: Replace the fence test**

In `backend/tests/integration/test_phases.py`, replace the whole of `test_complete_addressing_in_transit_row_returns_422` and its section header with:

```python
# ── (a): in_transit is driver-addressable; trip_creation is not ────────────────

async def test_complete_addressing_in_transit_row_records_arrival(
    client: AsyncClient, db_session, seed_trip,
):
    """The inverse of what this test asserted before 2026-08-09.

    It used to demand a 422, justified like this: "in_transit is completed by the
    authorized _auto_complete_in_transit stopgap (phase_service.py), and making it
    driver-addressable would harden that stopgap into contract." That function was
    deleted in 9be7a78 and exists nowhere under app/ — the fence outlived its reason
    (audit Part E.1). Arrival is now an explicit driver attestation, so the union
    resolves `in_transit` and the row completes.
    """
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_in_transit(client, db_session, trip, token)
    in_transit_id = await _phase_id(client, trip.id, token, "in_transit")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{in_transit_id}/complete",
        json={
            "phase_type": "in_transit",
            "driver_phone_lat": -29.8587, "driver_phone_lng": 31.0218,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 200, resp.text
    row = (await db_session.execute(
        select(PhaseEvent).where(PhaseEvent.id == uuid.UUID(in_transit_id))
    )).scalar_one()
    assert PhaseStatus(row.status) == PhaseStatus.COMPLETED
    assert row.completed_at is not None


async def test_complete_addressing_trip_creation_row_returns_422(
    client: AsyncClient, db_session, seed_trip,
):
    """trip_creation stays out of the union — it is written by create_trip before a
    driver exists. Pydantic's discriminator rejects it (union_tag_invalid -> 422), which
    is a different failure from the 409 a same-union-but-wrong-member mismatch produces."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    trip_creation_id = await _phase_id(client, trip.id, token, "trip_creation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{trip_creation_id}/complete",
        json={"phase_type": "trip_creation", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )

    assert resp.status_code == 422


async def test_arrival_is_not_gated_on_the_destination_warehouse_scan(
    client: AsyncClient, db_session, seed_trip,
):
    """IN_TRANSIT is absent from phase_gate.GATED_PHASES and must stay absent. The
    destination warehouse has scanned nothing when the driver pulls up at the boom, so
    gating arrival on a scan that only happens AFTER arrival would deadlock the leg.
    UNLOADING carries that gate instead."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_in_transit(client, db_session, trip, token)

    resp = await client.get(f"/api/v1/trips/{trip.id}", headers=auth_header(token))
    assert resp.status_code == 200, resp.text
    in_transit = next(p for p in resp.json()["phases"] if p["phase_type"] == "in_transit")

    assert in_transit["blocked_on"] is None
```

- [ ] **Step 2: Add the shared walk helper**

`_walk_to_in_transit` does not exist yet. Add it next to `_complete_activation` (~line 1376) in `backend/tests/integration/test_phases.py`, and move it above the tests that use it if pytest reports a NameError:

```python
async def _walk_to_in_transit(client: AsyncClient, db_session, trip, token: str) -> None:
    """activation -> loading -> departure, all as the driver, leaving the trip sitting on
    a PENDING in_transit row. The shortest legal path to the arrival phase."""
    activation_id = await _phase_id(client, trip.id, token, "activation")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": 0.0001, "driver_phone_lng": 0.0001,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    loading_id = await _phase_id(client, trip.id, token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={"phase_type": "loading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_id(client, trip.id, token, "departure")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json={
                "phase_type": "departure",
                "waybill_photo_artifact_id": waybill_id, "seal_number": "AB-1234",
                "seal_photo_artifact_id": seal_photo_id,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )
    assert resp.status_code == 200, resp.text


async def _complete_in_transit(client: AsyncClient, trip, token: str) -> None:
    """The arrival attestation. Every walk that reaches unloading needs this once the
    IN_TRANSIT gate exclusion is removed in Task 8."""
    in_transit_id = await _phase_id(client, trip.id, token, "in_transit")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{in_transit_id}/complete",
        json={
            "phase_type": "in_transit",
            "driver_phone_lat": -29.8587, "driver_phone_lng": 31.0218,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
```

- [ ] **Step 3: Fix the six stale `_auto_complete_in_transit` references**

Find them:

```bash
cd backend && grep -rn "_auto_complete_in_transit" tests/
```

Expected: 6 hits across `tests/unit/test_phase_service.py` (157, 602, 918), `tests/integration/test_phases.py` (95, and the 715 one already replaced in Step 1), `tests/integration/test_handshakes_anchor.py` (92).

Rewrite each so it names what actually happens. The replacements, verbatim:

`tests/unit/test_phase_service.py:154-158` — inside the `trip_fixture` docstring, replace the sentence beginning "The in_transit (P4) row is included for real:" through "a fixture that hid this row could not prove that stopgap works." with:

```
    The in_transit (P4) row is included for real: it is opened PENDING by
    advance_departure and closed by the driver's own arrival submission
    (advance_in_transit, 2026-08-09). A fixture that hid this row could not
    exercise the arrival phase at all, and after Task 8 every walk through
    unloading depends on it being resolvable.
```

`tests/unit/test_phase_service.py:600-603` — in the docstring, replace "and letting _auto_complete_in_transit stamp a fresh completed_at over the already-closed in_transit row." with:

```
    on every resend.
```

`tests/unit/test_phase_service.py:916-921` — replace "that _auto_complete_in_transit resolves the correct leg's row, and only that leg's row." with:

```
    that an arrival submission resolves the correct leg's row, and only that
    leg's row.
```

`tests/integration/test_phases.py:95` — replace "lands — see _auto_complete_in_transit's docstring in phase_service.py." with:

```
    # lands — see advance_in_transit's docstring in phase_service.py.
```

`tests/integration/test_handshakes_anchor.py:92` — same replacement as above, matching that file's existing comment indentation.

- [ ] **Step 4: Verify the stale name is gone**

```bash
cd backend && grep -rn "_auto_complete_in_transit" tests/ app/
```

Expected: no output.

- [ ] **Step 5: Run the integration tests**

```bash
cd backend && pytest tests/integration/test_phases.py -q
```

Expected: all pass. Confirm the skip count is ~0 for this file — if everything skipped, `TEST_DATABASE_URL` is unset and this step proved nothing.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/
# DO NOT COMMIT. CLAUDE.md reserves commits for the developer.
# Files are staged; report this suggested message and stop:
#   test(orchestration): invert the in_transit 422 fence and retire _auto_complete_in_transit references
```

---

## Task 4: Driver-pwa — arrival types on the wire

**Files:**
- Modify: `frontend/driver-pwa/lib/types/evidence-draft.ts`
- Modify: `frontend/driver-pwa/lib/api/phases.ts:91-99` (union), `:319-326` (the throwing case)
- Test: `frontend/driver-pwa/lib/api/__tests__/phases.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/driver-pwa/lib/api/__tests__/phases.test.ts` (match the file's existing mock/setup idiom for `api.post` — read the top of the file before writing):

```ts
describe('submitPhase — in_transit (arrival)', () => {
  it('posts the arrival attestation with the fix and nothing else', async () => {
    const post = mockApiPost({ ...TRIP_FIXTURE })

    await submitPhase(
      'trip-1', 'phase-in-transit-1', 'in_transit',
      { capturedAt: '2026-08-09T10:00:00.000Z' },
      'idem-arrival-1',
      { lat: -29.8587, lng: 31.0218 },
    )

    expect(post).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-in-transit-1/complete',
      {
        phase_type: 'in_transit',
        driver_phone_lat: -29.8587,
        driver_phone_lng: 31.0218,
        idempotency_key: 'idem-arrival-1',
      },
      expect.anything(),
    )
  })

  it('omits the position keys entirely when there is no fix', async () => {
    // Omitted, not null: the backend's _record_driver_position only writes when both
    // arrive, so a failed capture must not overwrite a position an earlier attempt stored.
    const post = mockApiPost({ ...TRIP_FIXTURE })

    await submitPhase(
      'trip-1', 'phase-in-transit-1', 'in_transit',
      { capturedAt: null }, 'idem-arrival-2', null,
    )

    const body = post.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('driver_phone_lat')
    expect(body).not.toHaveProperty('driver_phone_lng')
  })

  it('uploads no artifact — arrival is an attestation, not a capture', async () => {
    mockApiPost({ ...TRIP_FIXTURE })

    await submitPhase(
      'trip-1', 'phase-in-transit-1', 'in_transit',
      { capturedAt: null }, 'idem-arrival-3', null,
    )

    expect(uploadArtifact).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/driver-pwa && npx vitest run lib/api/__tests__/phases.test.ts
```

Expected: FAIL — `submitPhase: "in_transit" is never completed by a driver action`.

- [ ] **Step 3: Add the evidence type**

In `frontend/driver-pwa/lib/types/evidence-draft.ts`, add before `export type PhaseEvidence`:

```ts
// Arrival carries no driver-captured evidence at all — capturedAt and nothing else. The
// substance of the attestation is the phone fix, which every phase now attaches at submit
// time (lib/context/LocationContext.tsx) rather than storing in a draft.
//
// The type exists rather than reusing ActivationEvidence because the two are different
// facts that happen to have the same shape today, and because usePhaseDraft is generic
// per phase. There is deliberately no photo field: adding one would make arrival an
// evidence capture, which would need a step recipe, which would mean editing the shared
// STEP_SLUGS contract — the single thing this design was shaped to avoid (audit Part E.1,
// constraint 1).
export interface InTransitEvidence {
  capturedAt: string | null
}
```

and extend the union:

```ts
export type PhaseEvidence =
  | ActivationEvidence
  | LoadingEvidence
  | DepartureEvidence
  | InTransitEvidence
  | UnloadingEvidence
  | ConfirmationEvidence
```

- [ ] **Step 4: Add the request type and the submit case**

In `frontend/driver-pwa/lib/api/phases.ts`, add after `DepartureCompleteRequest`:

```ts
// Arrival. Mirrors backend schemas/phases.py's InTransitCompleteRequest, which is
// _PhaseCompleteBase and nothing more: no photo, no artifact id, no seal. The driver's
// swipe on the in-transit hub means "I am here", and when + where is the whole record.
export interface InTransitCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'in_transit'>
}
```

Replace the union comment and body (lines 91-99):

```ts
// trip_creation is deliberately absent — schemas/phases.py's own union has no variant for
// it (create_trip writes that row before a driver is involved); addressing it 422s
// server-side by design. in_transit JOINED this union on 2026-08-09: arrival is now an
// explicit driver attestation submitted from the in-transit hub's swipe, not a side
// effect of advance_unloading.
export type PhaseCompleteRequest =
  | ActivationCompleteRequest
  | LoadingCompleteRequest
  | DepartureCompleteRequest
  | InTransitCompleteRequest
  | UnloadingCompleteRequest
  | ConfirmationCompleteRequest
```

Replace the throwing case (lines 319-326) with a real case plus a narrowed guard:

```ts
    case 'in_transit': {
      // No evidence read and no artifact upload: the attestation IS the submission. The
      // fix rides along via driverPosition() exactly as it does for every other phase.
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'in_transit',
        ...driverPosition(position),
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'trip_creation':
      // No PhaseCompleteRequest variant server-side — create_trip writes this row before
      // a driver is involved, and addressing it 422s by design. Reaching this branch means
      // a routing bug upstream landed the driver on a phase they can never submit.
      throw new Error(`submitPhase: "${phaseType}" is never completed by a driver action`)
```

- [ ] **Step 5: Run the test and typecheck**

```bash
cd frontend/driver-pwa && npx vitest run lib/api/__tests__/phases.test.ts && npx tsc --noEmit
```

Expected: 3 new tests pass; `tsc` clean. The `never` exhaustiveness guard at the bottom of the switch proves no phase type is unhandled.

- [ ] **Step 6: Commit**

```bash
git add frontend/driver-pwa/lib/types/evidence-draft.ts frontend/driver-pwa/lib/api/phases.ts frontend/driver-pwa/lib/api/__tests__/phases.test.ts
# DO NOT COMMIT. CLAUDE.md reserves commits for the developer.
# Files are staged; report this suggested message and stop:
#   feat(driver-pwa): add the in_transit arrival request shape
```

---

## Task 5: Driver-pwa — the swipe submits

**Files:**
- Modify: `frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx`
- Test: `frontend/driver-pwa/app/(app)/trip/in-transit/__tests__/InTransitPageClient.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/driver-pwa/app/(app)/trip/in-transit/__tests__/InTransitPageClient.test.tsx`. Read the file's existing render helper and swipe-completion helper first and reuse them rather than inventing new ones.

```ts
describe('Arrive at destination — submits the arrival', () => {
  it('hands the in_transit phase to the background submitter', async () => {
    renderInTransit(tripDrivingLeg())

    await completeSwipe('Arrive at destination')

    expect(startPhaseSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        phaseEventId: 'phase-in-transit-1',
        phaseType: 'in_transit',
      }),
    )
  })

  it('marks the row syncing before navigating, so Home does not re-offer the drive', async () => {
    // Order matters for the same reason it does in PhaseStepPageClient.handOffSubmission:
    // the optimistic marker must be set before the route change, or Home renders one frame
    // with in_transit still pending and isDriving() still true.
    renderInTransit(tripDrivingLeg())

    await completeSwipe('Arrive at destination')

    expect(markPhaseSyncing).toHaveBeenCalledWith('phase-in-transit-1')
    expect(push).toHaveBeenCalledWith('/trip/phase/unloading/step/2-seal-verify')
  })

  it('navigates even when a submission for this row is already running', async () => {
    // startPhaseSubmission returns false on a duplicate. Stranding the driver on the
    // driving screen would only invite a third swipe.
    vi.mocked(startPhaseSubmission).mockReturnValue(false)
    renderInTransit(tripDrivingLeg())

    await completeSwipe('Arrive at destination')

    expect(push).toHaveBeenCalledWith('/trip/phase/unloading/step/2-seal-verify')
  })

  it('rolls the marker back when the ledger refuses the arrival', async () => {
    renderInTransit(tripDrivingLeg())

    await completeSwipe('Arrive at destination')
    const { onOutcome } = vi.mocked(startPhaseSubmission).mock.calls[0][0]
    act(() => { onOutcome({ kind: 'conflict', message: 'an earlier phase is unresolved' }) })

    expect(clearPhaseSyncing).toHaveBeenCalledWith('phase-in-transit-1')
  })

  it('keeps the marker when the arrival is queued offline', async () => {
    // The queue holds it and will replay it; re-offering the swipe would only invite a
    // second copy of the same attestation.
    renderInTransit(tripDrivingLeg())

    await completeSwipe('Arrive at destination')
    const { onOutcome } = vi.mocked(startPhaseSubmission).mock.calls[0][0]
    act(() => { onOutcome({ kind: 'queued' }) })

    expect(clearPhaseSyncing).not.toHaveBeenCalled()
  })
})
```

`tripDrivingLeg()` must build a plan whose `in_transit` row (`phase_event_id: 'phase-in-transit-1'`) is `pending` and whose `departure` is `completed`. Reuse the fixture builder the file already imports from `@/components/phase/__tests__/testFixtures`.

- [ ] **Step 2: Run and watch them fail**

```bash
cd frontend/driver-pwa && npx vitest run "app/(app)/trip/in-transit/__tests__/InTransitPageClient.test.tsx"
```

Expected: FAIL — `startPhaseSubmission` never called; only `push` was.

- [ ] **Step 3: Wire the hub**

In `frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx`:

Replace the file-header paragraph that reads "It exists as a hub, not an evidence capture: `in_transit` has no step recipe and the backend auto-completes it the moment `departure` advances, so there is nothing here to submit." through "...which detects this case by checking if currentPhase is in_transit OR if it's unloading after a resolved in_transit leg." with:

```
// It is a hub, not a step screen — `in_transit` has no step recipe and never will (audit
// Part E.1, constraint 1: a recipe would perturb actionablePhase() and force a change to
// the shared STEP_SLUGS contract). But it is NOT submission-free. The swipe at the bottom
// is the driver attesting "I have arrived", and since 2026-08-09 that attestation is what
// closes the in_transit row — previously the backend inferred arrival from whenever the
// unloading paperwork happened to be submitted, which made every dispatcher-visible drive
// time wrong by the length of an unloading.
//
// Navigation still tests isDriving() (lib/phase/derive.ts), which is now simply "the
// current row is in_transit".
```

Extend the imports and the hook block:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useTrip } from '@/lib/hooks/useTrip'
import { useLocationTrail } from '@/lib/hooks/useLocationTrail'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { useToast } from '@/lib/hooks/useToast'
import { currentPhase, currentStepRoute } from '@/lib/phase'
import {
  startPhaseSubmission, type PhaseSubmissionOutcome,
} from '@/lib/submission/phase-submitter'
```

Inside the component, replace the single `useTrip()` destructure with:

```tsx
  const {
    trip, isLoading, exceptions,
    refetchTrip, adoptTrip, markPhaseSyncing, clearPhaseSyncing,
  } = useTrip()
  const { capturePosition } = useLocationTrail()
  const { enqueuePhase } = useOfflineQueue()
  const { notify } = useToast()
```

Add the handler immediately above the `return` (after `openExceptions` is computed), and note it is defined after the `trip === null` guard so `trip` is non-null here:

```tsx
  // The in_transit row this hub is standing on. currentPhase, not actionablePhase:
  // actionablePhase deliberately skips stepless rows and would hand back `unloading`,
  // which is the row the driver has NOT reached yet.
  const arrivalPhase = currentPhase(trip.phases)

  function handleArrivalOutcome(outcome: PhaseSubmissionOutcome): void {
    switch (outcome.kind) {
      case 'recorded':
      case 'hold':
        // The real plan already shows the row resolved, so dropping the optimistic
        // marker changes nothing the driver can see.
        if (outcome.trip !== null) {
          adoptTrip(outcome.trip)
          clearPhaseSyncing(arrivalPhase!.phase_event_id)
        }
        return
      case 'queued':
        // Marker deliberately KEPT: the queue holds the attestation and will replay it,
        // so re-offering the swipe would only invite a second copy. OfflineBanner already
        // tells the driver something is waiting to sync.
        return
      case 'conflict':
      case 'failed':
        // Roll back — the row reads unresolved again and the driver can swipe once more.
        // No draft to preserve: an arrival carries no captured evidence to lose.
        clearPhaseSyncing(arrivalPhase!.phase_event_id)
        notify({
          kind: 'error',
          title: 'Could not record arrival',
          body: outcome.message,
        })
        return
      default: {
        const unreachable: never = outcome
        throw new Error(`handleArrivalOutcome: unhandled outcome "${String(unreachable)}"`)
      }
    }
  }

  // Synchronous, exactly like PhaseStepPageClient.handOffSubmission: the driver is on the
  // arrival step before the first byte leaves the phone. The GPS promise is handed over
  // un-awaited — a cold fix can take ten seconds and must never sit between the swipe and
  // the transition; the submitter waits for it so the position still travels WITH the
  // attestation, including into the offline queue.
  function handleArrival(): void {
    // Defensive: the swipe only renders on a trip whose current row is in_transit, but a
    // stale tab could get here with the ledger already moved on. Navigating is still the
    // right response — the arrival is recorded, there is simply nothing to submit.
    if (arrivalPhase === null || arrivalPhase.phase_type !== 'in_transit') {
      router.push(currentStepRoute(trip.phases))
      return
    }

    // Return value ignored: `false` means a submission for this row is already running,
    // and the right response is still to mark and navigate.
    startPhaseSubmission({
      tripId: String(trip.id),
      phaseEventId: arrivalPhase.phase_event_id,
      phaseType: 'in_transit',
      evidence: { capturedAt: new Date().toISOString() },
      idempotencyKey: crypto.randomUUID(),
      position: capturePosition(),
      enqueuePhase,
      refetchTrip,
      onOutcome: handleArrivalOutcome,
    })

    // Mark before navigating so the very next render already sees the leg closed.
    markPhaseSyncing(arrivalPhase.phase_event_id)
    router.push(currentStepRoute(trip.phases))
  }
```

Replace the swipe's comment block and JSX:

```tsx
        {/* The way out of this screen, and the record that the drive ended. The driver
            already performs this deliberate physical gesture meaning "I have arrived";
            before 2026-08-09 the system discarded it and inferred arrival from the
            unloading submission instead. currentStepRoute (lib/phase) skips the stepless
            in_transit row and lands the driver on the arrival step.
            Swipe, not a tap: this is the gesture that opens the truck and starts evidence
            capture, and a single accidental tap must never be enough to trigger it. */}
        <div className="flex justify-center">
          <SwipeToConfirm label="Arrive at destination" onConfirm={handleArrival} />
        </div>
```

- [ ] **Step 4: Run and watch them pass**

```bash
cd frontend/driver-pwa && npx vitest run "app/(app)/trip/in-transit" && npx tsc --noEmit
```

Expected: all pass, `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add "frontend/driver-pwa/app/(app)/trip/in-transit/"
# DO NOT COMMIT. CLAUDE.md reserves commits for the developer.
# Files are staged; report this suggested message and stop:
#   feat(driver-pwa): submit the arrival attestation from the in-transit swipe
```

---

## Task 6: Driver-pwa — delete `isDriving` case 2

**Files:**
- Modify: `frontend/driver-pwa/lib/phase/derive.ts:133-166`
- Modify: `frontend/driver-pwa/lib/phase/routes.ts:88-95` (comment only)
- Test: `frontend/driver-pwa/lib/phase/__tests__/derive.test.ts:170-271`

This is the single easiest thing to get wrong. Case 2 fires for the WHOLE unloading phase once arrival resolves `in_transit`, so Home would say "Continue driving" while the driver stands at the destination doing seal-verify — audit V7, resurrected by the fix meant to kill it.

- [ ] **Step 1: Write the failing test**

Add to the `describe('isDriving', ...)` block in `frontend/driver-pwa/lib/phase/__tests__/derive.test.ts`:

```ts
  it('is false once arrival is recorded and unloading is current', () => {
    // The case-2 regression. Before 2026-08-09 in_transit could not be resolved while
    // unloading was current, so "unloading after a resolved in_transit" was a safe proxy
    // for driving. Arrival submission makes that state the NORMAL state of standing at
    // the destination — the exact moment the driver is not driving.
    const plan = walkTo(SINGLE_LEG_PHASE_PLAN, 'unloading', { in_transit: 'completed' })

    expect(isDriving(plan)).toBe(false)
  })

  it('is false when an arrival was overridden by the dispatcher', () => {
    // The lost-phone recovery path (dispatcher override on in_transit). The trip is not
    // driving; a dispatcher just closed the leg on the driver's behalf.
    const plan = walkTo(SINGLE_LEG_PHASE_PLAN, 'unloading', { in_transit: 'overridden' })

    expect(isDriving(plan)).toBe(false)
  })

  it('is still true for the whole drive, before arrival is submitted', () => {
    const plan = walkTo(SINGLE_LEG_PHASE_PLAN, 'in_transit')

    expect(isDriving(plan)).toBe(true)
  })
```

`walkTo(plan, phaseType, overrides?)` must resolve every row before `phaseType` and apply `overrides` by phase type. Reuse the existing `walk` helper in that file if its signature already covers this; otherwise add `walkTo` next to it.

- [ ] **Step 2: Run and watch the first two fail**

```bash
cd frontend/driver-pwa && npx vitest run lib/phase/__tests__/derive.test.ts -t isDriving
```

Expected: the two new `false` assertions FAIL (`expected false, received true`) — that is case 2 firing. The third passes already.

- [ ] **Step 3: Delete case 2**

Replace `isDriving` in `frontend/driver-pwa/lib/phase/derive.ts` (lines 133-166) entirely with:

```ts
/**
 * Whether the driver is on the road right now.
 *
 * One rule: the ledger's current row is an `in_transit`. That row is opened PENDING by
 * `departure` and closed by the driver's own arrival submission (backend
 * `advance_in_transit`, wired to the in-transit hub's swipe), so it is unresolved for
 * exactly as long as the truck is moving and no longer.
 *
 * There used to be a second case — "current is `unloading` AND the preceding `in_transit`
 * is resolved" — and deleting it was mandatory, not tidying. It was a fossil of the
 * pre-9be7a78 model where `in_transit` auto-completed the instant `departure` landed,
 * which made "a resolved in_transit behind the current row" the ONLY way to detect a
 * drive. Under driver-submitted arrival that condition describes the driver standing
 * still at the destination doing seal-verify, so keeping it would have made Home offer
 * "Continue driving" for the whole unloading phase.
 *
 * Keyed on `sequence_number` via currentPhase, never on `phase_type` alone — a cross-dock
 * plan carries one `in_transit` per leg. LENGTH IS DATA (see the module header).
 */
export function isDriving(phases: readonly PhaseDescriptor[]): boolean {
  return currentPhase(phases)?.phase_type === 'in_transit'
}
```

- [ ] **Step 4: Fix the two consumer comments**

In `frontend/driver-pwa/components/home/HomeContent.tsx:54-56` and `frontend/driver-pwa/components/trip/TripDetailView.tsx:71-73`, replace the two-line comment in each with:

```tsx
  // isDriving is true only while the ledger's current row is an unresolved in_transit —
  // i.e. between departure and the driver's own arrival submission. Works the same on
  // single-stop and cross-dock plans.
```

Neither component needs an `actionablePhase` rewiring: deleting case 2 is what makes their existing `isDriving` branch correct, which is how this change subsumes V7.

In `frontend/driver-pwa/lib/phase/routes.ts:92-95`, replace "because in_transit being auto-completed server-side already shows up as 'resolved' by the time the walk reaches it, and the generic rule handles that for free." with:

```
  // because a submitted arrival already shows up as "resolved" by the time the walk
  // reaches it, and the generic rule handles that for free.
```

- [ ] **Step 5: Run the whole driver-pwa suite**

```bash
cd frontend/driver-pwa && npx vitest run && npx tsc --noEmit
```

Expected: green. Existing `isDriving` tests that asserted case 2 (`derive.test.ts` around lines 188, 253, 261, 271, plus `HomeContent.test.tsx:98` and `TripDetailView.test.tsx:281`) will fail first — rewrite each to the new contract rather than deleting it: the behaviour they cover (Home offers the drive during the drive; the hub is reachable) still needs coverage.

- [ ] **Step 6: Commit**

```bash
git add frontend/driver-pwa/lib/phase frontend/driver-pwa/components/home frontend/driver-pwa/components/trip
# DO NOT COMMIT. CLAUDE.md reserves commits for the developer.
# Files are staged; report this suggested message and stop:
#   fix(driver-pwa): isDriving is the in_transit row alone, not unloading after it
```

---

## Task 7: Backend — the full walk, with arrival, gate exclusion still in place

A checkpoint. It proves the new path works before anything load-bearing is removed.

**Files:**
- Create: `backend/tests/integration/test_arrival_lifecycle.py`

- [ ] **Step 1: Write the test**

```python
"""End-to-end proof that a hub-to-hub trip closes with arrival as its own submission.

Hub-to-hub only (audit Part B): one origin, one destination, exactly two stops and one
in_transit row. Multi-stop is a known latent stall and is not in scope.
"""

import uuid
from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy import select

from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip

from tests.conftest import auth_header, make_token
from tests.integration.test_phases import (
    _complete_in_transit, _fake_hedera_receipt, _make_artifact, _phase_id,
    _walk_to_in_transit,
)


async def test_arrival_timestamp_precedes_the_unloading_submission(
    client: AsyncClient, db_session, seed_trip,
):
    """The reason this change exists. in_transit.completed_at must record the arrival,
    not the paperwork: before 2026-08-09 the two were the same instant, so every
    dispatcher-visible drive time silently included the whole unloading phase."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_in_transit(client, db_session, trip, token)

    await _complete_in_transit(client, trip, token)

    gate_photo_id = await _make_artifact(db_session, trip.id)
    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={
            "phase_type": "unloading", "seal_number_at_destination": "AB-1234",
            "gate_photo_artifact_id": gate_photo_id,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    rows = {
        PhaseType(r.phase_type): r
        for r in (await db_session.execute(
            select(PhaseEvent).where(PhaseEvent.trip_id == trip.id)
        )).scalars().all()
    }
    assert rows[PhaseType.IN_TRANSIT].completed_at < rows[PhaseType.UNLOADING].completed_at
    assert rows[PhaseType.DEPARTURE].completed_at <= rows[PhaseType.IN_TRANSIT].completed_at


async def test_full_hub_to_hub_walk_with_arrival_closes_the_trip(
    client: AsyncClient, db_session, seed_trip,
):
    """activation -> loading -> departure -> ARRIVAL -> unloading -> confirmation."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_in_transit(client, db_session, trip, token)
    await _complete_in_transit(client, trip, token)

    gate_photo_id = await _make_artifact(db_session, trip.id)
    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={
            "phase_type": "unloading", "seal_number_at_destination": "AB-1234",
            "gate_photo_artifact_id": gate_photo_id,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    pod_photo_id = await _make_artifact(db_session, trip.id)
    pod_signature_id = await _make_artifact(db_session, trip.id)
    confirmation_id = await _phase_id(client, trip.id, token, "confirmation")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{confirmation_id}/complete",
            json={
                "phase_type": "confirmation",
                "pod_photo_artifact_id": pod_photo_id,
                "pod_signature_artifact_id": pod_signature_id,
                "driver_visual_count": 42,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )
    assert resp.status_code == 200, resp.text

    fresh = (await db_session.execute(select(Trip).where(Trip.id == trip.id))).scalar_one()
    assert TripStatus(fresh.status) == TripStatus.CLOSED
    assert fresh.current_phase is None

    statuses = {
        PhaseType(r.phase_type): PhaseStatus(r.status)
        for r in (await db_session.execute(
            select(PhaseEvent).where(PhaseEvent.trip_id == trip.id)
        )).scalars().all()
    }
    assert statuses[PhaseType.IN_TRANSIT] == PhaseStatus.COMPLETED


async def test_overridden_unloading_still_closes_the_trip_when_arrival_was_submitted(
    client: AsyncClient, db_session, seed_trip,
):
    """The V3 strand, structurally closed. The strand existed because nothing but
    advance_unloading could resolve in_transit, so overriding unloading left the row
    PENDING and recompute_position never reached its close-the-trip branch. With arrival
    already submitted by the driver, the override path closes cleanly.

    The dispatcher's in_transit override control stays regardless — it is the recovery for
    a driver whose phone dies mid-drive and can therefore never submit this at all.
    """
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    dispatcher_token = _dispatcher_token_for(seed_trip)
    await _walk_to_in_transit(client, db_session, trip, token)
    await _complete_in_transit(client, trip, token)

    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/override",
        json={"note": "driver phone destroyed at destination gate"},
        headers=auth_header(dispatcher_token),
    )
    assert resp.status_code == 200, resp.text

    pod_photo_id = await _make_artifact(db_session, trip.id)
    pod_signature_id = await _make_artifact(db_session, trip.id)
    confirmation_id = await _phase_id(client, trip.id, token, "confirmation")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{confirmation_id}/complete",
            json={
                "phase_type": "confirmation",
                "pod_photo_artifact_id": pod_photo_id,
                "pod_signature_artifact_id": pod_signature_id,
                "driver_visual_count": 42,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )
    assert resp.status_code == 200, resp.text

    fresh = (await db_session.execute(select(Trip).where(Trip.id == trip.id))).scalar_one()
    assert TripStatus(fresh.status) == TripStatus.CLOSED
```

`_dispatcher_token_for` does not exist. Before writing this test, open `backend/tests/integration/test_trip_admin.py` and read its `_dispatcher_token(seed)` helper plus the `seed` fixture. Either import `_dispatcher_token` and switch this file to the `seed`/`_make_trip` fixtures that helper expects, or add a local equivalent that mints a `role="dispatcher"` token for `seed_trip`'s operator org. Do not guess — the probe file being deleted in Step 3 shows the working combination.

- [ ] **Step 2: Run it**

```bash
cd backend && pytest tests/integration/test_arrival_lifecycle.py -v
```

Expected: 3 passed. If everything skips, `TEST_DATABASE_URL` is unset.

- [ ] **Step 3: Delete the throwaway probe**

`backend/tests/integration/test_v3_override_hole_probe.py` is a print-only diagnostic whose own docstring says "Delete this file once the finding is recorded and a real regression test exists." Step 1 is that test.

```bash
git rm backend/tests/integration/test_v3_override_hole_probe.py
```

- [ ] **Step 4: Commit**

```bash
git add backend/tests/integration/test_arrival_lifecycle.py
# DO NOT COMMIT. CLAUDE.md reserves commits for the developer.
# Files are staged; report this suggested message and stop:
#   test(orchestration): pin the arrival lifecycle and retire the V3 probe
```

---

## Task 8: Backend — remove the gate exclusion and the side-effect close

The load-bearing removal. Nothing before this point changed existing behaviour; this does.

**Files:**
- Modify: `backend/app/orchestration/phase_service.py:253-276` (gate), `:963-989` (`_find_in_transit_for_leg`), `:1098-1107` (close block)
- Modify: `backend/tests/unit/test_phase_service.py` (helper + two V2 tests + cross-dock walker)
- Modify: `backend/tests/integration/test_phases.py`, `backend/tests/integration/test_handshakes_anchor.py` (walks)

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/unit/test_phase_service.py`, in the `advance_in_transit` section from Task 2:

```python
@pytest.mark.asyncio
async def test_unloading_is_refused_while_the_arrival_is_unrecorded(db_session, trip_fixture):
    """The gate exclusion's removal, stated as a contract. IN_TRANSIT used to be skipped
    by _gate_and_load's lower-sequence check because nothing could resolve it before
    unloading ran — gating on it made advance_unloading unreachable. Now the driver
    resolves it himself, so the ordinary ordering rule applies and no special case is
    needed."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)

    with pytest.raises(PhaseSequenceError):
        await advance_unloading(
            db_session, trip_id=trip.id, driver_id=driver.id,
            phase_event_id=phases["unloading"].id,
            payload=UnloadingCompleteRequest(
                phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
                gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
                idempotency_key=str(uuid.uuid4()),
            ),
        )


@pytest.mark.asyncio
async def test_unloading_no_longer_stamps_the_arrival_row(db_session, trip_fixture):
    """advance_unloading must not touch in_transit at all. Its old close block was what
    made the arrival timestamp untruthful; with ordering enforced above, the block is
    unreachable, and unreachable code that rewrites evidence is worse than none."""
    trip, driver, phases = trip_fixture
    await _advance_to_departure(db_session, trip, driver, phases)
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )
    await db_session.refresh(phases["in_transit"])
    arrival_at = phases["in_transit"].completed_at

    await advance_unloading(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["unloading"].id,
        payload=UnloadingCompleteRequest(
            phase_type=PhaseType.UNLOADING, seal_number_at_destination="AB-1234",
            gate_photo_artifact_id=await _make_artifact(db_session, trip.id),
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    await db_session.refresh(phases["in_transit"])
    assert phases["in_transit"].completed_at == arrival_at
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd backend && pytest tests/unit/test_phase_service.py -k "arrival_is_unrecorded or no_longer_stamps" -v
```

Expected: the first FAILS (`DID NOT RAISE PhaseSequenceError` — the exclusion is still there). The second passes vacuously (the close block only fires on a PENDING row) and is there to stay green afterwards.

- [ ] **Step 3: Remove the exclusion**

In `backend/app/orchestration/phase_service.py`, replace the comment block and query at lines 253-271 with:

```python
    # No phase-type exclusion here. IN_TRANSIT used to be skipped, and had to be: since it
    # stopped auto-completing on departure it stayed PENDING for the whole drive at a LOWER
    # sequence than the arrival phase, so gating on it made advance_unloading unreachable —
    # the call was rejected here, hundreds of lines before the branch that closed the row.
    # The trip could never leave the driving leg.
    #
    # The exclusion went away with its cause (2026-08-09): in_transit is now closed by the
    # driver's own arrival submission (advance_in_transit), at its own sequence position,
    # so the ordinary ordering rule covers it and a PENDING in_transit correctly blocks an
    # unloading — an arrival that was never attested to is exactly the gap this platform
    # exists to surface. A driver who cannot submit it (dead phone) is recovered by the
    # dispatcher's in_transit override, which resolves the row through the normal path.
    lower_result = await db.execute(
        select(PhaseEvent.status).where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.sequence_number < event.sequence_number,
        )
    )
```

Do not touch the ownership check, the trip-status check, or the scan gate below it.

- [ ] **Step 4: Remove the side-effect close and its now-unused finder**

Delete lines 1098-1107 of `advance_unloading` — the comment block plus the `in_transit_event = await _find_in_transit_for_leg(...)` call and the `if in_transit_event.status == PhaseStatus.PENDING:` branch — leaving `_record_driver_position(event, payload)` followed directly by the `# T4: this LEG's departure ...` comment.

Delete `_find_in_transit_for_leg` entirely (lines 963-989). Confirm it has no other caller:

```bash
cd backend && grep -rn "_find_in_transit_for_leg" app/ tests/
```

Expected: no output. `_find_departure_for_leg` stays — it is still used for seal continuity.

Also correct `advance_departure`'s trailing comment (lines 1076-1079):

```python
    # IN_TRANSIT stays PENDING while the driver is moving. It is closed by the driver's own
    # arrival submission (advance_in_transit), which is what gives the dispatcher a drive
    # time measured from departure to actual arrival rather than to whenever the unloading
    # paperwork happened to land.
```

- [ ] **Step 5: Run the unit suite and fix every walk it breaks**

```bash
cd backend && pytest tests/unit/test_phase_service.py -q
```

Every test that drives a trip past `in_transit` now fails with `PhaseSequenceError`. Fix each by inserting the arrival call. The canonical insert, used everywhere:

```python
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )
```

Known sites, each with its specific fix:

**5a. The two V2 stale tests — these are ALREADY FAILING at baseline and this task is what fixes them.** They are not `test_advance_departure_leaves_in_transit_pending`; the plan originally misnamed them. Verified by running them at baseline:

- **`test_current_phase_and_current_stop_track_the_ledger` (assertion at line 1580)** — fails with `assert 'in_transit' == 'unloading'`. It walks the ledger asserting the cached position after each phase, and asserts departure lands the trip on `unloading`. Under driver-owned arrival, departure correctly lands it on `in_transit`. Fix by pinning both hops rather than deleting the assertion — this is the position-tracking coverage the audit brief said must survive:

```python
    # Departure opens the driving leg; the cache sits on in_transit for the whole drive.
    assert trip.current_phase == PhaseType.IN_TRANSIT
    assert trip.current_stop == 0

    # The driver's own arrival submission is what moves the cache to the arrival phase.
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )
    await db_session.refresh(trip)
    assert trip.current_phase == PhaseType.UNLOADING
    assert trip.current_stop == 1
```

Confirm `current_stop` against the fixture's actual stop sequences before asserting `1` — read the `trip_fixture` rows rather than trusting this number.

- **`test_replayed_exception_completion_is_idempotent_no_duplicate_exception` (assertion at line 633)** — fails with `assert 'pending' == 'completed'`. The test's real subject is that replaying a completion which resolved to EXCEPTION does not write a second `TripException`; the `in_transit` assertion was only ever checking the old auto-complete side effect and is now noise. Delete just that one assertion line (`assert phases["in_transit"].status == PhaseStatus.COMPLETED`) and its sibling `completed_at` line if present, keeping every exception-count assertion intact. Its docstring is also fixed in Task 3 Step 3.

**5b. Tests that currently PASS and will break** — these need the arrival call inserted:

1. **`_advance_to_unloading` (line 283)** — insert the arrival call between `await _advance_to_departure(...)` and `return await advance_unloading(...)`. This one fix covers most callers.

2. **`test_advance_departure_leaves_in_transit_pending` (line 872)** — currently passing. It asserts unloading closes in_transit, which this task deletes. Keep the first half verbatim (departure leaves the row PENDING — still true and still worth pinning) and replace everything from `# IN_TRANSIT is closed by advance_unloading` onward with:

```python
    # IN_TRANSIT is closed by the driver's own arrival submission.
    result = await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit"].id, payload=_arrival_payload(),
    )

    in_transit_in_response = next(p for p in result.phases if p.phase_type == PhaseType.IN_TRANSIT)
    assert in_transit_in_response.status == PhaseStatus.COMPLETED
    assert in_transit_in_response.completed_at is not None
```

Rename it to `test_advance_departure_leaves_in_transit_pending_until_arrival` and update its docstring to say the row closes when the driver submits arrival.

3. **`test_advance_departure_leaves_all_in_transit_rows_pending` (line 1008)** — the second V2 stale test, multi-leg. Replace the final `advance_unloading` block and its two assertions with an arrival submission against `phases["in_transit_2"]`, asserting that `in_transit_1` is untouched:

```python
    # Arrival on leg 2 closes leg 2's row and only leg 2's row.
    await advance_in_transit(
        db_session, trip_id=trip.id, driver_id=driver.id,
        phase_event_id=phases["in_transit_2"].id, payload=_arrival_payload(),
    )

    await db_session.refresh(phases["in_transit_1"])
    await db_session.refresh(phases["in_transit_2"])
    assert phases["in_transit_2"].status == PhaseStatus.COMPLETED
    assert phases["in_transit_1"].status == PhaseStatus.PENDING
```

**CORRECTED DURING EXECUTION — the instruction above is unreachable as written.** `in_transit_1` (seq 4) sits BELOW `departure_2` (seq 5), so once the exclusion is gone, leaving it PENDING blocks leg 2 entirely. The test must walk both arrivals: departure_1 → both PENDING → arrival on `in_transit_1` → departure_2 (`in_transit_2` still PENDING, leg 1's `completed_at` unchanged) → arrival on `in_transit_2`. That preserves the test's real subject — no phase reaches back into another leg's drive row — and adds the arrival-ownership claim.

Record, do not fix (audit Part B): `build_phase_plan` emits `DEPARTURE + IN_TRANSIT` for every non-final stop but no arrival phase at a pass-through waypoint. **Nuance found during execution:** the row IS now resolvable at the service level — a driver can submit an arrival against any `in_transit`, which is why the test can drive it — so the residual multi-stop gap is driver-app routing on non-final legs, not orchestration. Do not extend any assertion into a trip-closes claim on a 3-stop plan.

4. **`_walk_cross_dock_leg1_unloading_to_leg2_departure` (line 1702)** — insert an arrival call against `phases["in_transit_1"]` before `advance_unloading(unloading_1)`. Update the docstring's `[in_transit(leg1) auto-completes]` / `[in_transit(leg2) auto-completes]` to `-> in_transit(leg1) arrival ->` and drop the leg-2 bracket, since the walk stops before leg 2's arrival.

Re-run after each fix. Stop when the unit suite is green.

- [ ] **Step 6: Run the integration suite and fix its walks the same way**

```bash
cd backend && pytest tests/integration -q
```

Insert `await _complete_in_transit(client, trip, token)` (added in Task 3) before every unloading POST in `tests/integration/test_phases.py` and `tests/integration/test_handshakes_anchor.py`. Re-run until green.

- [ ] **Step 7: Full suite and the contract proof**

```bash
cd backend && pytest -q
cd backend && pytest tests/unit/test_phase_meta_contract.py -v
```

Expected: **exactly the six baseline failures recorded in Task 0, and nothing else.** The two V2 stale tests are fixed by this task, so 8 becomes 6. Diff against the baseline rather than eyeballing the count:

```bash
cd backend && .venv/bin/python -m pytest -q --no-header 2>&1 | grep -E "^(FAILED|ERROR)" | sort > /tmp/after-failures.txt
diff <(grep -v "test_current_phase_and_current_stop_track_the_ledger\|test_replayed_exception_completion_is_idempotent" /tmp/baseline-failures.txt) /tmp/after-failures.txt
```

Expected: **empty diff** — the six unrelated failures, unchanged. Any added line is a regression from this task and must be fixed before staging. The contract test passing untouched is the proof that decision 1 held and no shared file changed.

- [ ] **Step 8: Commit**

```bash
git add backend/app/orchestration/phase_service.py backend/tests/
# DO NOT COMMIT. CLAUDE.md reserves commits for the developer.
# Files are staged; report this suggested message and stop:
#   refactor(orchestration): drop the IN_TRANSIT gate exclusion now that arrival has an owner
```

---

## Task 9 — APPROVED (Ciaran, 2026-08-09): offline queue ordering

Approved for execution. It touches a shared driver-pwa file that no other task in this plan touches, and it exists to cover a failure mode the gate change introduces. Commit it separately (Step 5) so it can be reverted on its own if it turns out to interact badly with the queue's other consumers.

**The failure mode.** `useOfflineQueue.flushQueue` (`frontend/driver-pwa/lib/hooks/useOfflineQueue.ts:210-239`) walks queued entries in order and, on a terminal 4xx, drops the entry — with the explicit comment "A 409 means an earlier attempt already succeeded server-side — the drop is correct". After Task 8 that assumption is no longer sound: a 409 can now mean "the arrival ahead of this in the queue has not landed yet". Sequence:

1. Driver arrives in a dead zone; the arrival submission fails transiently and is queued.
2. Driver does seal-verify; the unloading submission also fails and is queued behind it.
3. A flush runs while the server is flaky: the arrival entry fails transiently (5xx) and stays queued; the flush continues to the unloading entry, which now 409s on the unresolved arrival, and is **dropped as terminal**. Photo evidence for unloading is silently lost.

Steps 1-2 alone are safe (both replay in order). The online variant — arrival queued, signal returns, unloading POSTs live and 409s — is already recoverable: `PhaseStepPageClient` keeps the draft and rolls the optimistic marker back on `conflict`. Only the in-flush case loses evidence.

**Assessment:** narrow window, but the loss is silent and it is unloading photo evidence on an evidence platform. Roughly six lines to close.

**Files:**
- Modify: `frontend/driver-pwa/lib/hooks/useOfflineQueue.ts:210-239`
- Test: `frontend/driver-pwa/lib/hooks/__tests__/useOfflineQueue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('does not send a later phase entry for a trip whose earlier phase entry just failed transiently', async () => {
  // The backend enforces ledger ordering as of 2026-08-09 (advance_in_transit + the
  // removal of _gate_and_load's IN_TRANSIT exclusion), so a phase entry sent out of order
  // 409s — and flushQueue drops 409s as "already landed", which would silently discard
  // the unloading evidence behind a still-queued arrival.
  seedQueue([
    phaseEntry({ id: 'q1', tripId: 't1', phaseType: 'in_transit' }),
    phaseEntry({ id: 'q2', tripId: 't1', phaseType: 'unloading' }),
  ])
  mockSendEntry.mockRejectedValueOnce(new ApiError('server error', 500))

  await flushQueueForTest()

  expect(mockSendEntry).toHaveBeenCalledTimes(1)
  expect(loadQueueForTest().map((e) => e.id)).toEqual(['q1', 'q2'])
})

it('still flushes a different trip after one trip stalls', async () => {
  seedQueue([
    phaseEntry({ id: 'q1', tripId: 't1', phaseType: 'in_transit' }),
    phaseEntry({ id: 'q2', tripId: 't2', phaseType: 'unloading' }),
  ])
  mockSendEntry.mockRejectedValueOnce(new ApiError('server error', 500))

  await flushQueueForTest()

  expect(loadQueueForTest().map((e) => e.id)).toEqual(['q1'])
})
```

Match the file's existing seeding/mocking helpers — read it first and reuse them.

- [ ] **Step 2: Run and watch the first fail**

```bash
cd frontend/driver-pwa && npx vitest run lib/hooks/__tests__/useOfflineQueue.test.ts
```

Expected: the first test FAILS — `sendEntry` was called twice.

- [ ] **Step 3: Implement the ordering guard**

In `flushQueue`, add before the loop:

```ts
    // Trips whose phase queue has stalled this pass. The backend enforces ledger ordering
    // (a PENDING earlier phase 409s the next one), and the catch below drops 409s on the
    // premise that they mean "already landed" — a premise that stops holding the moment a
    // phase entry ahead of this one is still sitting in the queue. Skipping the rest of
    // that trip's phase entries keeps the premise true. Exception, checkpoint and ping
    // entries carry no ordering constraint and keep flushing.
    const stalledTripIds = new Set<string>()
```

Change the loop head to:

```ts
    for (const entry of queue) {
      if (entry.kind === 'phase' && stalledTripIds.has(entry.tripId)) continue
```

and in the `catch`, after the `isTerminal4xx` block's `continue`:

```ts
        // Transient failure (network error, 5xx, or a status-0 timeout): leave it out of
        // disposedIds so the filter below keeps it queued, and stall the rest of this
        // trip's phase chain behind it.
        if (entry.kind === 'phase') stalledTripIds.add(entry.tripId)
```

Verify the discriminator and field names against the real `QueueEntry` union at the top of the file (`kind`, `tripId`) before writing — adjust the code to match what is actually there.

- [ ] **Step 4: Run and watch them pass**

```bash
cd frontend/driver-pwa && npx vitest run lib/hooks/__tests__/useOfflineQueue.test.ts && npx tsc --noEmit
```

Expected: both new tests pass, existing ones unaffected.

- [ ] **Step 5: Commit**

```bash
git add frontend/driver-pwa/lib/hooks/useOfflineQueue.ts frontend/driver-pwa/lib/hooks/__tests__/useOfflineQueue.test.ts
# DO NOT COMMIT. CLAUDE.md reserves commits for the developer.
# Files are staged; report this suggested message and stop:
#   fix(driver-pwa): stall a trip's queued phase chain behind a transient failure
```

---

## Task 10: Final verification

- [ ] **Step 1: Backend, whole suite, integration confirmed running**

```bash
cd backend && pytest -q 2>&1 | grep -E "^(FAILED|ERROR)" | sort > /tmp/final-failures.txt
diff /tmp/baseline-failures.txt /tmp/final-failures.txt
cd backend && pytest -q 2>&1 | tail -3
```

Expected: the diff shows only the two V2 lines removed and nothing added — i.e. the six Task 0 baseline failures survive and no new failure appeared. Skip count **~4, not ~364** (the latter means `TEST_DATABASE_URL` is unset and the integration tests never ran).

- [ ] **Step 2: Shared contract untouched**

```bash
cd backend && .venv/bin/python -m pytest tests/unit/test_phase_meta_contract.py -q --no-header 2>&1 | grep -E "passed|failed"
git diff HEAD --stat -- frontend/shared/
git diff HEAD -- backend/app/core/phase_meta.py | grep -E "^[+-]" | grep -v "^[+-][+-]" | grep -vE "^[+-]\s*#"
```

Expected: contract test passes; the first `git diff` prints **nothing**; the second prints **nothing**. (The second command exits **1** when it passes — that is `grep` reporting "no matches", which is the success case here. Do not chain it with `&&`.) Together those are the proof of decision 1 — `STEP_SLUGS.in_transit` is still `()`/`[]` in both languages, so no team coordination is owed for `phase-meta`.

**Why the check is split rather than one command.** `backend/app/core/phase_meta.py` IS modified by this work — comment-only. Its `in_transit` note described the row as "closed by departure today (NEW-8 stopgap)", which this change makes false, and leaving a shared file asserting the opposite of the code is worse than editing it. The second command is what proves the edit is comment-only: it strips diff headers and comment lines, and an empty result means no declaration moved. A single `git diff --stat` over both paths would print a modified file and read as a decision-1 breach that did not happen.

**Report it anyway.** `phase_meta.py` is the shared half of the `STEP_SLUGS` contract, so TASK COMPLETE must list it under `Shared files` as *comment-only, contract test green* — not claim `NONE`. `frontend/shared/lib/constants/phase-meta.ts` is genuinely untouched.

**Diff against `HEAD`, not `main`.** Neither `frontend/shared/` nor `backend/app/core/phase_meta.py` exists on `main` — they were added by earlier commits on this branch — so `git diff main` prints those whole files and reads as false drift.

- [ ] **Step 3: Driver-pwa**

```bash
cd frontend/driver-pwa && npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"
cd frontend/driver-pwa && npx tsc --noEmit 2>&1 | grep -v "DriverMap\|js-api-loader"
```

Expected: `Test Files 1 failed | 76 passed`, **0 failed tests**, pass count ≥ 621. The single failed file must still be only `DriverMap.test.tsx`.

For `tsc`, the filtered output must be **empty**. Do not expect a clean unfiltered run: `components/map/DriverMap.tsx` imports `@googlemaps/js-api-loader`, which is not installed (another dev's pending `package.json` change, audit Part C). Those errors are baseline.

**`npx next build` is expected to FAIL on that same missing import and is therefore not a usable gate for this work.** Do not install the dependency to make it pass — that would commit another developer's pending change. Record the build as blocked-on-`@googlemaps` and verify the export-compatibility concern the build would have caught by inspection instead: confirm every page under `app/` that this work touched still carries `'use client'` at the top (required because `output: 'export'` for the Capacitor APK is incompatible with Server Components):

```bash
head -3 "frontend/driver-pwa/app/(app)/trip/in-transit/page.tsx" "frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx"
```

- [ ] **Step 4: Dispatcher untouched but still green**

```bash
cd frontend/dispatcher && npx vitest run && npx tsc --noEmit
```

**Expected: 1 failed / 150 passed — NOT green.** `lib/api/client.test.ts > network-layer retry > does not retry a POST when the connection drops` fails at baseline (expects `TypeError`, gets `ApiError { status: 0 }`). It is pre-existing, lives in the HTTP retry layer, and has nothing to do with phases — confirmed by `git diff HEAD -- frontend/dispatcher/` being empty apart from one comment fix. Do not fix it here; it belongs to whoever owns the network layer.

The only dispatcher change in this work is a comment: the `in_transit` override's rationale (`app/(app)/trips/[id]/page.tsx`) described the strand that this work removed, so it now states its real remaining purpose — recovery for a driver whose phone dies mid-drive. The control itself stays (decision 4).

The dispatcher reads `in_transit.completed_at` for its Journey card elapsed time; no logic changes, but the value it renders is now truthful.

- [ ] **Step 5: The stale name is gone repo-wide**

```bash
grep -rn "_auto_complete_in_transit" backend/ frontend/ --exclude-dir=node_modules
```

Expected: **no output.** (The four `docs/superpowers/plans/*.md` and `docs/superpowers/specs/*.md` hits are historical plan records describing what was true when written — leave them. `docs/phase-model-explained.md` is current-state documentation and DOES need updating; do that in Step 6.)

- [ ] **Step 6: Update the one live doc**

In `docs/phase-model-explained.md`, find the `_auto_complete_in_transit` reference and rewrite the surrounding passage so it describes the current model: `in_transit` is opened PENDING by `advance_departure` and closed by the driver's own arrival submission (`advance_in_transit`), submitted from the in-transit hub's "Arrive at destination" swipe rather than from a step page.

- [ ] **Step 7: Reseed dev data before demoing**

Any trip already sitting mid-drive on the dev DB has a PENDING `in_transit` that the old model would have closed at unloading and the new one will now block on. Reseed rather than debugging a stalled fixture:

```bash
cd backend && python scripts/seed_trips.py
```

Clear driver-app localStorage in the browser too (audit Part D).

- [ ] **Step 8: Commit the doc fix**

```bash
git add docs/phase-model-explained.md
# DO NOT COMMIT. CLAUDE.md reserves commits for the developer.
# Files are staged; report this suggested message and stop:
#   docs: describe arrival as a driver submission in the phase model
```

---

## TASK COMPLETE report — fill this in at the end

```
TASK COMPLETE
Summary: [one paragraph]

Modified: backend/app/schemas/phases.py, backend/app/orchestration/phase_service.py,
          frontend/driver-pwa/lib/{types/evidence-draft.ts,api/phases.ts,phase/derive.ts,phase/routes.ts},
          frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx,
          frontend/driver-pwa/components/{home/HomeContent.tsx,trip/TripDetailView.tsx},
          docs/phase-model-explained.md, [+ tests]
Created:  backend/tests/unit/test_phase_schemas.py,
          backend/tests/integration/test_arrival_lifecycle.py
Deleted:  backend/tests/integration/test_v3_override_hole_probe.py
Excluded: frontend/shared/lib/constants/phase-meta.ts + backend/app/core/phase_meta.py —
          decision 1 keeps STEP_SLUGS.in_transit empty, so neither changes
          dispatcher/app/(app)/trips/[id]/page.tsx — decision 4, the override stays
          build_phase_plan / create_trip — multi-stop stall recorded, not fixed (Part B)

Migrations:     none
Shared files:   NONE — verify with `git diff --stat main -- frontend/shared/`
Deprecations:   [findings / none]
New .env keys:  none
```

---

## Self-review

**Spec coverage against Part E.1:** union member (T1) ✓; `advance_in_transit` (T2) ✓; hub swipe submits, not a step page (T5) ✓; `STEP_SLUGS.in_transit = []` untouched, proven by T10 S2 ✓; minimal payload, no artifact, asserted in T4 S1 ✓; `isDriving` case 2 deleted (T6) ✓; dispatcher override kept, asserted in T7 ✓; gate exclusion removed LAST, after the full walk passes (T7 → T8) ✓; other three gate checks untouched, stated in T8 S3 ✓; six `_auto_complete_in_transit` references fixed (T3 S3, verified T10 S5) ✓; 422 test inverted (T3 S1) ✓; V2 stale tests rewritten not deleted, sequenced after the redesign (T8 S5) ✓; hub-to-hub fence held, multi-stop stall recorded not fixed (T8 S5 item 3) ✓.

**Additions beyond the brief, both flagged:** Task 9 is decision-gated and separately committed. Task 7's `test_overridden_unloading_still_closes_the_trip_when_arrival_was_submitted` proves V3 is structurally closed, which the brief asks for as a goal but does not specify a test for.

**Naming consistency checked:** `advance_in_transit` / `InTransitCompleteRequest` / `InTransitEvidence` / `_arrival_payload` / `_walk_to_in_transit` / `_complete_in_transit` are used identically in every task that references them. `phase_label="Arrival"` (T2) is the string that appears in the 409 the driver app surfaces.

**Two helpers this plan cannot fully specify, both called out inline rather than left as placeholders:** `_dispatcher_token_for` (T7 S1 — read `test_trip_admin.py` first) and the `QueueEntry` discriminator field names (T9 S3 — read the union first).
