# Scan-Driven Loading & Unloading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the driver's un-producible loading count with a warehouse scan feed that gates the `loading` and `confirmation` phases and drives a real origin-vs-destination parcel reconciliation.

**Architecture:** The warehouse scan feed (built by the Stage 4 plan) writes `Parcel.pp_scan_out_at` / `pp_scan_in_at`. A new pure module derives a `blocked_on` field per phase from that scan state; the phase-completion endpoint enforces it with a 409. `advance_loading` stops requiring a driver count, and `advance_confirmation` reconciles scanned-out against scanned-in per consignment. Stages A and B are backend-only and change no frontend file, so the driver app keeps working throughout.

**Tech Stack:** Python 3.13, FastAPI 0.115, SQLAlchemy 2.0 async, Pydantic v2, pytest + pytest-asyncio (`asyncio_mode = auto`), Next.js 15 App Router, TypeScript 5.5+.

**Spec:** `docs/superpowers/specs/2026-08-05-scan-driven-loading-unloading-design.md`. Read §0, §2.1 and §3 before Task 1.

---

## Prerequisite — do not start without this

This plan consumes three modules that **do not exist yet**:

```
backend/app/integrations/scan_feed.py      ← Stage 4 plan, Task 3
backend/app/integrations/mock_state.py     ← Stage 4 plan, Task 2
backend/app/orchestration/scan_service.py  ← Stage 4 plan, Task 4
```

**`docs/superpowers/plans/2026-08-04-scanfeed-dev-trigger-panel.md` must be implemented first.**
`Parcel.pp_scan_out_at` / `pp_scan_in_at` are written by nothing today, so every gate and
every count in this plan would read `NULL` and block every trip.

Verify before Task 1:

```bash
cd backend && ls app/integrations/scan_feed.py app/integrations/mock_state.py app/orchestration/scan_service.py
```

Expected: all three listed. If any is missing, stop and execute the Stage 4 plan.

**Efficiency note:** Task 1 and Task 2 amend files the Stage 4 plan creates. If Stage 4 has
not been started yet, fold Task 1's method and Task 2's trigger into Stage 4's Task 3 and
Task 8 as they are written, rather than building and then amending.

---

## Ordering rationale — read before resequencing

The stages are ordered so that **Stages A and B touch zero files in `frontend/`**. That is
deliberate:

- `frontend/driver-pwa/` and `frontend/shared/` hold Tim's uncommitted refactor, and the
  Stage 4 plan promises isolation from both (its line 41).
- `LoadingCompleteRequest.driver_visual_count` becomes **`Optional`, not removed** (Task 7).
  The driver app keeps sending it and keeps working unchanged; the server ignores it. This
  also means no offline-queue entry can ever 422, which removes the queue-poisoning hazard
  the spec flags in §4 entirely.
- Consequence: after Stage B the product logic is complete and fully testable with the
  existing frontend. Stage C is presentation; Stage D is optional.

**Stage D is the only stage requiring an Alembic migration.** If time runs short, drop
Stage D — the digital linehaul (Bruce's actual stated goal) ships in Stage C without it.

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/app/integrations/scan_feed.py` | Add `is_scan_session_closed` to the Protocol + `MockScanFeed`; add `close_session` staging |
| Modify | `backend/app/schemas/dev.py` | Close-session request/response models |
| Modify | `backend/app/api/v1/endpoints/dev_triggers.py` | Close-session trigger endpoint |
| Modify | `backend/app/orchestration/scan_service.py` | `scanned_counts_for_consignment()` — live counts from `Parcel` rows |
| Create | `backend/app/orchestration/phase_gate.py` | `blocked_on` derivation. One responsibility, no DB writes |
| Modify | `backend/app/schemas/phases.py` | `blocked_on` field; `from_event` takes the map; `driver_visual_count` optional; drop `pp_scan_in_count` from the request |
| Modify | `backend/app/core/exceptions.py` | `PhaseBlockedError` |
| Modify | `backend/app/orchestration/trip_service.py` | Build + pass the `blocked_on` map |
| Modify | `backend/app/orchestration/resource_service.py` | Build + pass the `blocked_on` map |
| Modify | `backend/app/api/v1/endpoints/phases.py` | Build + pass the map (2 sites); map `PhaseBlockedError` → 409 |
| Modify | `backend/app/orchestration/phase_service.py` | Gate enforcement; `advance_loading`; `advance_confirmation` |
| Modify | `frontend/shared/lib/types/phase.ts` | `blocked_on` on `PhaseDescriptor` |
| Modify | `frontend/shared/lib/constants/phase-meta.ts` | `STEP_SLUGS` **and** `STEP_NAMES` |
| Modify | `backend/app/core/phase_meta.py` | `STEP_SLUGS` — must match the TS file |
| Create | `frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx` | Digital linehaul step |
| Delete | `frontend/driver-pwa/components/phase/steps/loading/VisualCount.tsx` | Replaced |
| Modify | `frontend/driver-pwa/components/phase/steps/registry.ts` | Slug union + component map |
| Modify | `frontend/dispatcher/components/domain/LoadingDetail.tsx` | Expected / scanned / missing |
| Create | `backend/alembic/versions/2026_08_05_ciaran_add_linehaul_photo.py` | Stage D only |

### Out of scope — do not build

| Excluded | Reason |
|---|---|
| `ScanFeed` / `MockScanFeed` / `mock_state` / `scan_service` themselves | Stage 4 plan's job. This plan amends them only. |
| `manifest_service.py` | `origin_scan_complete` is fixed by data, not code. |
| `departure/Waybill.tsx` | Spec §10 — open question for Bruce. |
| Pallet-count reconciliation | Spec §5 — deferred with a stated reason. |
| PP drift detection / PP parser widening | Separate tickets. |
| Renaming `pp_scan_in_count` in the anchored payload | Would break hash verification on every historical trip. |

---

# STAGE A — Backend foundations

## Task 1: Scan-session-closed signal

**Files:**
- Modify: `backend/app/integrations/scan_feed.py`
- Test: `backend/tests/unit/test_scan_feed.py` (append)

The gate reads "has the warehouse finished at this stop", not "have all barcodes arrived".
A closed session with a short count unblocks the phase **and** raises a discrepancy — see
spec §3.2.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_scan_feed.py`:

```python
async def test_session_is_open_when_nothing_staged(store: FakeStore):
    feed = MockScanFeed()

    closed = await feed.is_scan_session_closed(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert closed is False


async def test_session_reports_closed_once_closed(store: FakeStore):
    feed = MockScanFeed()
    await feed.close_session(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    closed = await feed.is_scan_session_closed(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert closed is True


async def test_session_close_is_scoped_by_direction(store: FakeStore):
    feed = MockScanFeed()
    await feed.close_session(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    closed = await feed.is_scan_session_closed(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.IN,
    )

    assert closed is False


async def test_session_close_is_scoped_by_stop(store: FakeStore):
    """A cross-dock trip closes one stop's session without touching another's."""
    feed = MockScanFeed()
    await feed.close_session(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    closed = await feed.is_scan_session_closed(
        consignment_reference="WAY001", stop_reference="stop-2",
        direction=ScanDirection.OUT,
    )

    assert closed is False


async def test_closing_a_session_does_not_disturb_staged_barcodes(store: FakeStore):
    """Closing is a separate key — it must not clobber what was staged."""
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001"],
    )

    await feed.close_session(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )
    assert [e.barcode for e in events] == ["WAY0010001"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_scan_feed.py -v -k session`
Expected: FAIL — `AttributeError: 'MockScanFeed' object has no attribute 'is_scan_session_closed'`

- [ ] **Step 3: Implement**

In `backend/app/integrations/scan_feed.py`, add the key kind beside `_SCAN_KEY_KIND`:

```python
# Session state is a SEPARATE key from staged barcodes. Sharing one key would mean
# closing a session rewrites the barcode payload, and a mis-ordered trigger in the
# dev panel would silently wipe what the warehouse "scanned".
_SESSION_KEY_KIND = "scan-session"
```

Add to the `ScanFeed` Protocol:

```python
    async def is_scan_session_closed(
        self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> bool:
        """Whether the warehouse has finished scanning this consignment at this stop.

        This, not set-completeness, is what gates a phase. A real WMS reports when an
        operator closes the session; it does not report "every expected barcode has now
        been seen", because a genuinely missing parcel means that never becomes true.
        Gating on completeness would turn a short count into an indefinite block instead
        of the finding it should be.
        """
        ...
```

Add to `MockScanFeed`:

```python
    def _session_key(
        self, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> str:
        return build_key(
            _SESSION_KEY_KIND, consignment_reference, stop_reference, direction.value,
        )

    async def close_session(
        self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> None:
        """Simulate the warehouse operator closing the scan session. Dev panel only."""
        key = self._session_key(consignment_reference, stop_reference, direction)
        await get_mock_state_store().set_json(
            key, {"closed_at": datetime.now(UTC).isoformat()},
        )
        logger.info(
            "MockScanFeed closed session consignment=%s stop=%s direction=%s",
            consignment_reference, stop_reference, direction.value,
        )

    async def is_scan_session_closed(
        self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> bool:
        key = self._session_key(consignment_reference, stop_reference, direction)
        return await get_mock_state_store().get_json(key) is not None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_scan_feed.py -v`
Expected: PASS — 9 pre-existing + 5 new = 14.

- [ ] **Step 5: Commit**

```bash
git add backend/app/integrations/scan_feed.py backend/tests/unit/test_scan_feed.py
git commit -m "feat(integrations): scan-session-closed signal on the scan feed"
```

---

## Task 2: Close-session dev trigger

**Files:**
- Modify: `backend/app/schemas/dev.py`
- Modify: `backend/app/api/v1/endpoints/dev_triggers.py`
- Test: `backend/tests/integration/test_dev_triggers.py` (append)

Without this the panel cannot demonstrate the discrepancy path at all — staging 2 of 3
barcodes proves nothing until the session closes and the phase unblocks with a mismatch.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/test_dev_triggers.py`:

```python
async def test_close_session_marks_the_session_closed(client, dispatcher_headers, dev_trip):
    """The trigger drives the mock; the mock is what the gate reads."""
    response = await client.post(
        "/api/v1/dev/scans/close-session",
        headers=dispatcher_headers,
        json={
            "trip_id": str(dev_trip["trip_id"]),
            "trip_stop_id": str(dev_trip["stop_id"]),
            "direction": "out",
        },
    )

    assert response.status_code == 200
    assert response.json()["sessions_closed"] == 1


async def test_close_session_rejects_an_unknown_stop(client, dispatcher_headers, dev_trip):
    response = await client.post(
        "/api/v1/dev/scans/close-session",
        headers=dispatcher_headers,
        json={
            "trip_id": str(dev_trip["trip_id"]),
            "trip_stop_id": str(uuid.uuid4()),
            "direction": "out",
        },
    )

    assert response.status_code == 404
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pytest tests/integration/test_dev_triggers.py -v -k close_session`
Expected: FAIL — 404 on the route itself (`/scans/close-session` not registered).

- [ ] **Step 3: Add the schemas**

In `backend/app/schemas/dev.py`:

```python
class CloseScanSessionRequest(BaseModel):
    """Simulate the warehouse operator finishing at one stop.

    Scoped to a stop rather than a trip: a cross-dock trip has several stops, and
    closing them all at once would make the per-stop gate untestable.
    """

    trip_id: UUID
    trip_stop_id: UUID
    direction: ScanDirection


class CloseScanSessionResponse(BaseModel):
    trip_id: UUID
    trip_stop_id: UUID
    direction: ScanDirection
    # One per consignment at this stop — a stop may serve several waybills.
    sessions_closed: int
```

- [ ] **Step 4: Add the endpoint**

In `backend/app/api/v1/endpoints/dev_triggers.py`:

```python
@router.post(
    "/scans/close-session",
    response_model=CloseScanSessionResponse,
    summary="Simulate the warehouse finishing its scan at a stop",
)
async def close_scan_session(
    payload: CloseScanSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> CloseScanSessionResponse:
    """Close the scan session for every consignment at this stop.

    Drives the mock only. The phase gate reads this state through the same
    ScanFeed a real WMS integration would implement, so nothing downstream knows
    a trigger was involved.
    """
    feed = get_scan_feed()
    if not isinstance(feed, MockScanFeed):
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        )

    try:
        consignments = await scan_service.load_consignments_at_stop(
            db, trip_id=payload.trip_id, trip_stop_id=payload.trip_stop_id,
            direction=payload.direction,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc),
        ) from exc

    for consignment in consignments:
        await feed.close_session(
            consignment_reference=consignment.parcel_perfect_reference,
            stop_reference=str(payload.trip_stop_id),
            direction=payload.direction,
        )

    return CloseScanSessionResponse(
        trip_id=payload.trip_id,
        trip_stop_id=payload.trip_stop_id,
        direction=payload.direction,
        sessions_closed=len(consignments),
    )
```

⚠ `load_consignments_at_stop` does not currently validate that the stop belongs to the
trip — `ingest_scans` does that separately. Add the same `ResourceNotFoundError` guard to
`load_consignments_at_stop` so this endpoint's 404 test passes:

```python
    stop = (await db.execute(
        select(TripStop).where(TripStop.id == trip_stop_id, TripStop.trip_id == trip_id)
    )).scalar_one_or_none()
    if stop is None:
        raise ResourceNotFoundError("TripStop", str(trip_stop_id))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_dev_triggers.py -v`
Expected: PASS, including the pre-existing trigger tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/dev.py backend/app/api/v1/endpoints/dev_triggers.py backend/app/orchestration/scan_service.py backend/tests/integration/test_dev_triggers.py
git commit -m "feat(api): close-scan-session dev trigger"
```

---

## Task 3: Live scan counts per consignment

**Files:**
- Modify: `backend/app/orchestration/scan_service.py`
- Test: `backend/tests/unit/test_scan_service.py` (append)

Spec §2.1: reconciliation compares **live `Parcel` rows**, never the cached aggregates on
`PhaseEvent`. This is the one function that reads them.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_scan_service.py`:

```python
async def test_scanned_counts_are_zero_before_any_scan(db_session, store, seeded):
    counts = await scan_service.scanned_counts_for_consignment(
        db_session, consignment_id=seeded["consignment"].id,
    )

    assert counts.scanned_out == 0
    assert counts.scanned_in == 0
    assert counts.expected == 3


async def test_scanned_counts_reflect_stamped_parcels(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"][:2],
    )
    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    counts = await scan_service.scanned_counts_for_consignment(
        db_session, consignment_id=seeded["consignment"].id,
    )

    assert counts.scanned_out == 2
    assert counts.scanned_in == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_scan_service.py -v -k scanned_counts`
Expected: FAIL — `AttributeError: module 'app.orchestration.scan_service' has no attribute 'scanned_counts_for_consignment'`

- [ ] **Step 3: Implement**

In `backend/app/orchestration/scan_service.py`:

```python
@dataclass(frozen=True)
class ScannedCounts:
    """Live scan tallies for one consignment, read from Parcel rows.

    Deliberately NOT read from PhaseEvent.parcel_count_origin / _destination.
    Those are aggregates cached at phase close; reading one to make a decision
    reintroduces staleness by the back door (design §2.1).
    """

    expected: int
    scanned_out: int
    scanned_in: int


async def scanned_counts_for_consignment(
    db: AsyncSession, *, consignment_id: uuid.UUID,
) -> ScannedCounts:
    """Count this consignment's parcels, and how many carry each scan stamp."""
    result = await db.execute(
        select(
            func.count(Parcel.id),
            func.count(Parcel.pp_scan_out_at),
            func.count(Parcel.pp_scan_in_at),
        ).where(Parcel.consignment_id == consignment_id)
    )
    expected, scanned_out, scanned_in = result.one()
    return ScannedCounts(
        expected=expected, scanned_out=scanned_out, scanned_in=scanned_in,
    )
```

Add `func` to the SQLAlchemy import: `from sqlalchemy import func, select`.

> `func.count(column)` counts non-NULL values of that column — which is exactly
> "how many parcels carry this stamp". `func.count(Parcel.id)` counts rows.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_scan_service.py -v`
Expected: PASS — 12 pre-existing + 2 new = 14.

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestration/scan_service.py backend/tests/unit/test_scan_service.py
git commit -m "feat(orchestration): live scan counts per consignment"
```

---

## Task 4: The `blocked_on` derivation

**Files:**
- Create: `backend/app/orchestration/phase_gate.py`
- Test: `backend/tests/unit/test_phase_gate.py`

One module, one job: given a trip, say which phases are waiting on the warehouse. No
writes, no side effects.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_phase_gate.py`:

```python
"""Unit tests for the warehouse-scan phase gate.

Uses db_session (skips without TEST_DATABASE_URL) — the whole job is reading DB
state, so a DB-free test would assert nothing meaningful. Mirrors
test_scan_service.py, which does the same.
"""

import uuid
from typing import Any

import pytest

from app.db.models.enums import PhaseType
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import MockScanFeed, ScanDirection
from app.orchestration import phase_gate


class FakeStore:
    """Dict-backed MockStateStore — same fake as test_scan_feed.py."""

    def __init__(self) -> None:
        self.data: dict[str, dict[str, Any]] = {}

    async def get_json(self, key: str) -> dict[str, Any] | None:
        return self.data.get(key)

    async def set_json(self, key: str, value: dict[str, Any]) -> None:
        self.data[key] = value

    async def flush(self) -> int:
        count = len(self.data)
        self.data.clear()
        return count


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    fake = FakeStore()
    monkeypatch.setattr(scan_feed_module, "get_mock_state_store", lambda: fake)
    return fake


async def test_loading_is_blocked_before_the_session_closes(db_session, store, seeded):
    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=seeded["trip"].id)

    assert blocked[(PhaseType.LOADING, seeded["stop"].id)] == phase_gate.BLOCKED_ON_SCAN


async def test_loading_unblocks_once_the_session_closes(db_session, store, seeded):
    await MockScanFeed().close_session(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT,
    )

    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=seeded["trip"].id)

    assert blocked[(PhaseType.LOADING, seeded["stop"].id)] is None


async def test_a_short_scan_still_unblocks_when_the_session_is_closed(db_session, store, seeded):
    """The whole point of session semantics — a missing parcel is a finding, not a block."""
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"][:2],
    )
    await feed.close_session(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT,
    )

    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=seeded["trip"].id)

    assert blocked[(PhaseType.LOADING, seeded["stop"].id)] is None


async def test_a_stop_with_no_consignments_is_never_blocked(db_session, store, empty_trip):
    """Trips created without a PP reference have no Parcel rows at all. manifest.ts
    documents this as 'common' and 'a normal state, not a failure' — blocking them
    would make the dispatcher override the default path for a legitimate trip shape."""
    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=empty_trip["trip"].id)

    assert all(value is None for value in blocked.values())


async def test_closing_one_stop_does_not_unblock_another(db_session, store, xdock_trip):
    """A cross-dock trip loads at more than one stop."""
    await MockScanFeed().close_session(
        consignment_reference="WAY001", stop_reference=str(xdock_trip["stop_1"].id),
        direction=ScanDirection.OUT,
    )

    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=xdock_trip["trip"].id)

    assert blocked[(PhaseType.LOADING, xdock_trip["stop_1"].id)] is None
    assert blocked[(PhaseType.LOADING, xdock_trip["stop_2"].id)] == phase_gate.BLOCKED_ON_SCAN


async def test_confirmation_reads_scan_in_not_scan_out(db_session, store, seeded):
    await MockScanFeed().close_session(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT,
    )

    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=seeded["trip"].id)

    assert blocked[(PhaseType.CONFIRMATION, seeded["stop"].id)] == phase_gate.BLOCKED_ON_SCAN


async def test_phases_other_than_loading_and_confirmation_are_never_blocked(
    db_session, store, seeded,
):
    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=seeded["trip"].id)

    assert blocked[(PhaseType.DEPARTURE, seeded["stop"].id)] is None
    assert blocked[(PhaseType.UNLOADING, seeded["stop"].id)] is None
```

> **Fixtures needed:** `seeded` already exists in `tests/unit/test_scan_service.py` — move
> it to `tests/conftest.py` so both modules share it rather than duplicating it. Add two
> more there: `empty_trip` (a trip with `TripStop` rows but **no** `Consignment` rows) and
> `xdock_trip` (two pickup stops, one `Consignment` on each, `pickup_stop_id` set
> accordingly). Build them by copying `seeded`'s body and varying only the consignment
> rows — do not invent new model fields.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pytest tests/unit/test_phase_gate.py -v`
Expected: FAIL — `ImportError: cannot import name 'phase_gate' from 'app.orchestration'`

- [ ] **Step 3: Implement**

Create `backend/app/orchestration/phase_gate.py`:

```python
"""Derives which phases are waiting on the warehouse scan feed.

Pure read path: no writes, no side effects, no exceptions raised for business
outcomes. Two consumers — the read schema (so the driver app can render a waiting
screen) and phase_service's completion guard (so a hand-crafted POST cannot slip
past the UI). Both must agree, which is why the logic lives here once rather than
twice.

Gating is per (phase_type, trip_stop_id), never per trip: a cross-dock trip loads
at several stops and each has its own warehouse and its own session.

Three states, not two (design §3.1):
  - no expected parcel set at this stop  -> None. NOT blocked.
  - expected set exists, session open    -> BLOCKED_ON_SCAN
  - session closed                       -> None

The first is load-bearing. A trip created without a Parcel Perfect reference has
no Consignment and no Parcel rows; lib/api/manifest.ts records this as "common"
and "a normal state, not a failure". Without that state such trips would block at
loading forever and move only by dispatcher override.

Layering: orchestration -> integrations, db. Never imports from api/.
"""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseType
from app.db.models.trips import Consignment
from app.integrations.scan_feed import ScanDirection, get_scan_feed

logger = logging.getLogger(__name__)

# The only value blocked_on takes today. A string rather than a bool so a second
# gate (telemetry, customs) can be added later without changing the field's type
# on the wire and breaking the shared TS contract.
BLOCKED_ON_SCAN = "warehouse_scan"

# Which phase reads which direction. Any phase absent from this map is never
# blocked — that is the whole rule, stated once.
_GATED_PHASES: dict[PhaseType, ScanDirection] = {
    PhaseType.LOADING: ScanDirection.OUT,
    PhaseType.CONFIRMATION: ScanDirection.IN,
}


async def blocked_on_by_stop(
    db: AsyncSession, *, trip_id: uuid.UUID,
) -> dict[tuple[PhaseType, uuid.UUID], str | None]:
    """Map (phase_type, trip_stop_id) -> blocked_on, for this whole trip.

    Built once per request and passed down, rather than derived per phase event:
    PhaseEventRead.from_event is synchronous and pure by design, and deriving this
    inside it would mean either a DB call from a sync method or an N+1 across every
    phase of every trip-detail response.
    """
    result = await db.execute(
        select(
            Consignment.parcel_perfect_reference,
            Consignment.pickup_stop_id,
            Consignment.delivery_stop_id,
        ).where(Consignment.trip_id == trip_id)
    )
    consignments = result.all()

    feed = get_scan_feed()
    blocked: dict[tuple[PhaseType, uuid.UUID], str | None] = {}

    for phase_type, direction in _GATED_PHASES.items():
        for reference, pickup_stop_id, delivery_stop_id in consignments:
            stop_id = pickup_stop_id if direction is ScanDirection.OUT else delivery_stop_id
            if stop_id is None:
                # FP-112 partitioning not populated on this consignment — there is no
                # stop to attribute the scan to, so there is nothing to gate.
                continue

            key = (phase_type, stop_id)
            if blocked.get(key) == BLOCKED_ON_SCAN:
                # Already known blocked by another consignment at this stop. A stop
                # serving two waybills is blocked while EITHER session is still open,
                # so nothing a later consignment reports can clear it — skip the call.
                continue

            closed = await feed.is_scan_session_closed(
                consignment_reference=reference,
                stop_reference=str(stop_id),
                direction=direction,
            )
            blocked[key] = None if closed else BLOCKED_ON_SCAN

    return blocked


def blocked_on_for(
    blocked_by_stop: dict[tuple[PhaseType, uuid.UUID], str | None],
    *,
    phase_type: PhaseType,
    trip_stop_id: uuid.UUID | None,
) -> str | None:
    """Look one phase up in the map. Absent means not gated, which is not blocked."""
    if trip_stop_id is None:
        return None
    return blocked_by_stop.get((phase_type, trip_stop_id))
```

⚠ The multi-consignment rule above is subtle: a stop serving two waybills is blocked while
**either** session is open. Verify with this extra test before moving on:

```python
async def test_a_stop_with_two_waybills_blocks_until_both_close(
    db_session, store, two_waybill_stop,
):
    await MockScanFeed().close_session(
        consignment_reference="WAY001",
        stop_reference=str(two_waybill_stop["stop"].id),
        direction=ScanDirection.OUT,
    )

    blocked = await phase_gate.blocked_on_by_stop(
        db_session, trip_id=two_waybill_stop["trip"].id,
    )

    assert blocked[
        (PhaseType.LOADING, two_waybill_stop["stop"].id)
    ] == phase_gate.BLOCKED_ON_SCAN
```

Add a `two_waybill_stop` fixture to `conftest.py` — one stop, two `Consignment` rows both
with `pickup_stop_id` set to it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_phase_gate.py -v`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestration/phase_gate.py backend/tests/unit/test_phase_gate.py backend/tests/conftest.py
git commit -m "feat(orchestration): derive warehouse-scan phase gate per stop"
```

---

## Task 5: Serve `blocked_on` on the read schema

**Files:**
- Modify: `backend/app/schemas/phases.py`
- Modify: `backend/app/orchestration/trip_service.py`
- Modify: `backend/app/orchestration/resource_service.py`
- Modify: `backend/app/api/v1/endpoints/phases.py`
- Test: `backend/tests/integration/test_phases.py` (append)

Four call sites of `from_event`. All must build and pass the map or the field is silently
`None` — the same failure mode `stop_sequence`'s docstring already warns about.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/test_phases.py`:

```python
async def test_phase_list_reports_blocked_on_for_loading(
    client, driver_headers, seeded_trip,
):
    response = await client.get(
        f"/api/v1/trips/{seeded_trip['trip_id']}/phases", headers=driver_headers,
    )

    assert response.status_code == 200
    loading = next(p for p in response.json() if p["phase_type"] == "loading")
    assert loading["blocked_on"] == "warehouse_scan"


async def test_phase_list_reports_null_blocked_on_for_departure(
    client, driver_headers, seeded_trip,
):
    response = await client.get(
        f"/api/v1/trips/{seeded_trip['trip_id']}/phases", headers=driver_headers,
    )

    departure = next(p for p in response.json() if p["phase_type"] == "departure")
    assert departure["blocked_on"] is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pytest tests/integration/test_phases.py -v -k blocked_on`
Expected: FAIL — `KeyError: 'blocked_on'`

- [ ] **Step 3: Add the field and change the signature**

In `backend/app/schemas/phases.py`, add to `PhaseEventRead` immediately after `step_recipe`:

```python
    # Non-null while this phase is waiting on an external system — today only the
    # warehouse scan feed. Derived per request (orchestration/phase_gate.py), never
    # stored: it is a property of the outside world, not of this row.
    blocked_on: Optional[str] = None
```

Change `from_event`:

```python
    @classmethod
    def from_event(
        cls,
        event: Any,
        *,
        stop_sequence_by_id: dict[UUID, int],
        blocked_on_by_stop: dict[tuple[Any, UUID], Optional[str]] | None = None,
    ) -> "PhaseEventRead":
        """`event` is a db.models.phases.PhaseEvent. Typed as Any to keep this
        module free of a db-model import — schemas describe the wire, not the
        tables, and app/schemas/ importing app/db/models/ would invert that.

        blocked_on_by_stop defaults to None so a caller that genuinely has no gate
        state (tests, fixtures) still builds a valid row. Every production caller
        passes it — a missing map silently yields blocked_on=None on every phase,
        the same trap stop_sequence_by_id documents above.
        """
        read = cls.model_validate(event)
        read.stop_sequence = (
            stop_sequence_by_id.get(event.trip_stop_id)
            if event.trip_stop_id is not None
            else None
        )
        read.step_recipe = STEP_SLUGS[PhaseType(event.phase_type)]
        if blocked_on_by_stop is not None and event.trip_stop_id is not None:
            read.blocked_on = blocked_on_by_stop.get(
                (PhaseType(event.phase_type), event.trip_stop_id)
            )
        return read
```

- [ ] **Step 4: Update all four call sites**

`backend/app/api/v1/endpoints/phases.py` — add the import and a helper beside
`_stop_sequence_map`:

```python
from app.orchestration.phase_gate import blocked_on_by_stop
```

In `list_phases_endpoint`, replace the return with:

```python
    stop_sequences = await _stop_sequence_map(db, trip_id=trip_id)
    gate = await blocked_on_by_stop(db, trip_id=trip_id)
    return [
        PhaseEventRead.from_event(
            e, stop_sequence_by_id=stop_sequences, blocked_on_by_stop=gate,
        )
        for e in events
    ]
```

In `next_phase_endpoint`, replace the return with:

```python
    stop_sequences = await _stop_sequence_map(db, trip_id=trip_id)
    gate = await blocked_on_by_stop(db, trip_id=trip_id)
    return PhaseEventRead.from_event(
        event, stop_sequence_by_id=stop_sequences, blocked_on_by_stop=gate,
    )
```

In `backend/app/orchestration/trip_service.py`, add the import and change the
`from_event` call:

```python
from app.orchestration.phase_gate import blocked_on_by_stop
```

```python
            PhaseEventRead.from_event(
                e,
                stop_sequence_by_id={s.id: s.sequence for s in trip_stops},
                blocked_on_by_stop=await blocked_on_by_stop(db, trip_id=trip.id),
            )
```

⚠ That `await` sits inside a list comprehension and would re-query per phase. Hoist it:

```python
    gate = await blocked_on_by_stop(db, trip_id=trip.id)
    phases = [
        PhaseEventRead.from_event(
            e,
            stop_sequence_by_id={s.id: s.sequence for s in trip_stops},
            blocked_on_by_stop=gate,
        )
        for e in events
    ]
```

Apply the identical hoisted pattern in `backend/app/orchestration/resource_service.py`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_phases.py tests/integration/test_trips.py -v`
Expected: PASS, no regressions.

- [ ] **Step 6: Add the query-count guard**

Append to `backend/tests/integration/test_phases.py`:

```python
async def test_phase_list_query_count_is_independent_of_phase_count(
    client, driver_headers, xdock_trip_api, db_engine,
):
    """Guards against blocked_on being derived per event. An 11-row cross-dock plan
    must not issue 11 gate queries."""
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    from sqlalchemy import event as sa_event
    sa_event.listen(db_engine.sync_engine, "before_cursor_execute", record)
    try:
        await client.get(
            f"/api/v1/trips/{xdock_trip_api['trip_id']}/phases", headers=driver_headers,
        )
    finally:
        sa_event.remove(db_engine.sync_engine, "before_cursor_execute", record)

    consignment_queries = [s for s in statements if "consignments" in s.lower()]
    assert len(consignment_queries) == 1
```

Run: `cd backend && pytest tests/integration/test_phases.py -v -k query_count`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/phases.py backend/app/orchestration/trip_service.py backend/app/orchestration/resource_service.py backend/app/api/v1/endpoints/phases.py backend/tests/integration/test_phases.py
git commit -m "feat(api): serve blocked_on on the phase read schema"
```

---

## Task 6: Enforce the gate on completion

**Files:**
- Modify: `backend/app/core/exceptions.py`
- Modify: `backend/app/orchestration/phase_service.py`
- Modify: `backend/app/api/v1/endpoints/phases.py`
- Test: `backend/tests/integration/test_phases.py` (append)

The read field is not enforcement. A replayed or hand-crafted POST must not slip past.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/integration/test_phases.py`:

```python
async def test_completing_a_blocked_loading_returns_409(
    client, driver_headers, seeded_trip,
):
    response = await client.post(
        f"/api/v1/trips/{seeded_trip['trip_id']}/phases/"
        f"{seeded_trip['loading_event_id']}/complete",
        headers=driver_headers,
        json={
            "phase_type": "loading",
            "driver_visual_count": 3,
            "idempotency_key": str(uuid.uuid4()),
        },
    )

    assert response.status_code == 409
    assert "warehouse" in response.json()["detail"].lower()


async def test_an_idempotent_replay_of_a_completed_phase_does_not_409(
    client, driver_headers, completed_activation_trip,
):
    """Ordering guard: the blocked check must run AFTER _gate_and_load's replay
    short-circuit. If it runs first, a resent offline-queue entry for an
    already-successful completion 409s instead of returning current state, and the
    driver app's queue never drains."""
    key = completed_activation_trip["idempotency_key"]

    response = await client.post(
        f"/api/v1/trips/{completed_activation_trip['trip_id']}/phases/"
        f"{completed_activation_trip['activation_event_id']}/complete",
        headers=driver_headers,
        json={
            "phase_type": "activation",
            "idvs_check_passed": True,
            "idempotency_key": key,
        },
    )

    assert response.status_code == 200
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_phases.py -v -k "blocked_loading or idempotent_replay"`
Expected: the first FAILs with 200 (completion succeeds against a blocked phase).

- [ ] **Step 3: Add the exception**

In `backend/app/core/exceptions.py`:

```python
class PhaseBlockedError(Exception):
    """Raised when a phase is waiting on an external system it cannot proceed without.

    Distinct from PhaseSequenceError and PhaseTooEarlyError even though all three map
    to 409, for the same reason those two are distinct from each other: the plan is in
    order and the calendar is fine, a third party simply has not finished. Keeping it
    separate lets the driver app say "waiting for the warehouse" instead of a generic
    "trip state changed".
    """

    def __init__(self, attempted_phase: str) -> None:
        super().__init__(
            f"Cannot complete {attempted_phase}: the warehouse has not finished "
            f"scanning at this stop. This will clear on its own once they do — "
            f"contact your dispatcher if it does not."
        )
        self.attempted_phase = attempted_phase
```

- [ ] **Step 4: Enforce it in `_gate_and_load`**

In `backend/app/orchestration/phase_service.py`, add the imports:

```python
from app.core.exceptions import PhaseBlockedError
from app.orchestration.phase_gate import blocked_on_by_stop
```

In `_gate_and_load`, insert the check **immediately before the final `return (trip, event)`**
— after the `_is_resolved` replay short-circuit, after the trip-status check, and after the
lower-sequence check:

```python
    # AFTER the _is_resolved replay short-circuit above, never before it. A resent
    # offline-queue entry for an already-successful completion must return current
    # state, not 409 — otherwise the driver app's queue never drains. This ordering
    # is covered by test_an_idempotent_replay_of_a_completed_phase_does_not_409.
    if event.trip_stop_id is not None:
        gate = await blocked_on_by_stop(db, trip_id=trip_id)
        if gate.get((PhaseType(event.phase_type), event.trip_stop_id)) is not None:
            raise PhaseBlockedError(phase_label)
```

- [ ] **Step 5: Map it to 409**

In `backend/app/api/v1/endpoints/phases.py`, add `PhaseBlockedError` to the import list and
to the existing 409 `except` tuple:

```python
    except (
        PhaseSequenceError, PhaseTooEarlyError, PhaseTypeMismatchError, PhaseBlockedError,
    ) as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=str(exc),
        ) from exc
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_phases.py -v`
Expected: PASS.

⚠ Pre-existing loading/confirmation tests will now fail, because their fixtures never close
a scan session. Fix them by closing the session in the fixture — **not** by weakening the
gate:

```python
    await MockScanFeed().close_session(
        consignment_reference=<the fixture's pp ref>,
        stop_reference=str(<the fixture's stop id>),
        direction=ScanDirection.OUT,
    )
```

- [ ] **Step 7: Run the full suite**

Run: `cd backend && pytest -q`
Expected: green. Fix fixtures, never the gate.

- [ ] **Step 8: Commit**

```bash
git add backend/app/core/exceptions.py backend/app/orchestration/phase_service.py backend/app/api/v1/endpoints/phases.py backend/tests/
git commit -m "feat(orchestration): enforce the warehouse-scan gate on phase completion"
```

---

# STAGE B — Backend semantics

## Task 7: `advance_loading` stops requiring a driver count

**Files:**
- Modify: `backend/app/schemas/phases.py`
- Modify: `backend/app/orchestration/phase_service.py`
- Test: `backend/tests/unit/test_phase_service.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_phase_service.py`:

```python
async def test_loading_completes_without_a_driver_count(db_session, store, ready_to_load):
    """The driver never enters the warehouse and may arrive after loading finished.
    A count he cannot honestly produce must not be what closes the phase."""
    result = await phase_service.advance_loading(
        db_session,
        trip_id=ready_to_load["trip"].id,
        driver_id=ready_to_load["driver"].id,
        phase_event_id=ready_to_load["loading_event"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(PhaseEvent, ready_to_load["loading_event"].id)
    assert event.status == PhaseStatus.COMPLETED
    assert event.driver_visual_count is None


async def test_loading_stamps_parcel_count_origin_from_scans(
    db_session, store, ready_to_load,
):
    await phase_service.advance_loading(
        db_session,
        trip_id=ready_to_load["trip"].id,
        driver_id=ready_to_load["driver"].id,
        phase_event_id=ready_to_load["loading_event"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(PhaseEvent, ready_to_load["loading_event"].id)
    assert event.parcel_count_origin == 3


async def test_loading_raises_no_exception_for_a_matching_scan(
    db_session, store, ready_to_load,
):
    await phase_service.advance_loading(
        db_session,
        trip_id=ready_to_load["trip"].id,
        driver_id=ready_to_load["driver"].id,
        phase_event_id=ready_to_load["loading_event"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=str(uuid.uuid4()),
        ),
    )

    exceptions = (await db_session.execute(
        select(TripException).where(TripException.trip_id == ready_to_load["trip"].id)
    )).scalars().all()
    assert exceptions == []


async def test_a_legacy_payload_with_a_count_is_accepted_and_ignored(
    db_session, store, ready_to_load,
):
    """A loading queued offline under the old schema replays with the field present.
    Accepting and ignoring it is what stops the queue poisoning itself forever."""
    result = await phase_service.advance_loading(
        db_session,
        trip_id=ready_to_load["trip"].id,
        driver_id=ready_to_load["driver"].id,
        phase_event_id=ready_to_load["loading_event"].id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING,
            driver_visual_count=99,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(PhaseEvent, ready_to_load["loading_event"].id)
    assert event.status == PhaseStatus.COMPLETED
    assert event.parcel_count_origin == 3
```

> **Fixture:** `ready_to_load` = the `seeded` trip with its scan-out session staged in full
> and closed, and its `activation` phase already completed so `loading` is the next
> unresolved row.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_phase_service.py -v -k loading`
Expected: FAIL — `ValidationError: driver_visual_count Field required`

- [ ] **Step 3: Make the field optional**

In `backend/app/schemas/phases.py`:

```python
class LoadingCompleteRequest(_PhaseCompleteBase):
    # D7/T5: the seal is applied at departure, not here.
    #
    # driver_visual_count is Optional and IGNORED by advance_loading as of the
    # scan-driven redesign. It is kept on the schema rather than removed for one
    # reason: a loading queued offline under the old schema replays from
    # localStorage with the field present, and removing it would 422 that entry
    # forever — the queue would never drain. The driver app stops sending it in
    # Stage C; this field is deleted only once no client can still be holding one.
    phase_type: Literal[PhaseType.LOADING]
    driver_visual_count: Optional[int] = None
```

- [ ] **Step 4: Rewrite `advance_loading`**

Replace the body of `advance_loading` from `_record_driver_position(event, payload)` to the
`return`:

```python
    _record_driver_position(event, payload)

    # The observed set, not a driver-entered number. The gate in _gate_and_load has
    # already established that the warehouse closed its session at this stop, so these
    # counts are final for this loading — which is what makes stamping the aggregate
    # here safe under the "anchored payload contains only data that existed at close"
    # rule (design §2.1).
    consignments = await scan_service.load_consignments_at_stop(
        db, trip_id=trip_id, trip_stop_id=event.trip_stop_id,
        direction=ScanDirection.OUT,
    )

    scanned_out_total = 0
    expected_total = 0
    for consignment in consignments:
        counts = await scan_service.scanned_counts_for_consignment(
            db, consignment_id=consignment.id,
        )
        scanned_out_total += counts.scanned_out
        expected_total += counts.expected

        if counts.scanned_out != counts.expected:
            db.add(TripException(
                trip_id=trip_id, phase_event_id=event.id,
                consignment_id=consignment.id, trip_stop_id=event.trip_stop_id,
                exception_type=ExceptionType.PARCEL_COUNT_MISMATCH,
                source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
                description=(
                    f"Warehouse closed its scan-out session on waybill "
                    f"{consignment.parcel_perfect_reference} with "
                    f"{counts.scanned_out} of {counts.expected} parcel(s) scanned."
                ),
            ))

    # None, not 0, when this stop has no consignments at all: a trip created without
    # a Parcel Perfect reference has no manifest baseline, and 0 would read as
    # "nothing was loaded" rather than "nothing was declared". Same None-is-not-zero
    # principle as _expected_parcel_count.
    event.parcel_count_origin = scanned_out_total if consignments else None

    # A short scan is recorded, never blocking — FreightProof records what happened,
    # it does not dispatch. Matches departure's and unloading's seal-mismatch precedent.
    event.status = (
        PhaseStatus.EXCEPTION
        if consignments and scanned_out_total != expected_total
        else PhaseStatus.COMPLETED
    )

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)
```

Add the imports at the top of `phase_service.py`:

```python
from app.integrations.scan_feed import ScanDirection
from app.orchestration import scan_service
```

⚠ Delete `_expected_parcel_count` if `advance_loading` was its only caller — check first:

```bash
cd backend && grep -rn "_expected_parcel_count" app/ tests/
```

If other callers exist, leave it. If not, delete it and its tests in the same commit.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_phase_service.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/phases.py backend/app/orchestration/phase_service.py backend/tests/unit/test_phase_service.py
git commit -m "feat(orchestration): close loading on the warehouse scan, not a driver count"
```

---

## Task 8: `advance_confirmation` reconciles scan against scan

**Files:**
- Modify: `backend/app/schemas/phases.py`
- Modify: `backend/app/orchestration/phase_service.py`
- Test: `backend/tests/unit/test_phase_service.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_phase_service.py`:

```python
async def test_confirmation_derives_scan_in_count_from_parcels(
    db_session, store, ready_to_confirm,
):
    """The count comes from the warehouse, not from the driver's own number echoed
    back — which is what made the old three-way check circular."""
    await phase_service.advance_confirmation(
        db_session,
        trip_id=ready_to_confirm["trip"].id,
        driver_id=ready_to_confirm["driver"].id,
        phase_event_id=ready_to_confirm["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=ready_to_confirm["pod_photo_id"],
            pod_signature_artifact_id=ready_to_confirm["pod_signature_id"],
            driver_visual_count=1,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(PhaseEvent, ready_to_confirm["confirmation_event"].id)
    assert event.parcel_count_destination == 3
    # The driver's pallet count is recorded, never compared against a parcel count.
    assert event.driver_visual_count == 1


async def test_confirmation_raises_nothing_when_both_scans_agree(
    db_session, store, ready_to_confirm,
):
    await phase_service.advance_confirmation(
        db_session,
        trip_id=ready_to_confirm["trip"].id,
        driver_id=ready_to_confirm["driver"].id,
        phase_event_id=ready_to_confirm["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=ready_to_confirm["pod_photo_id"],
            pod_signature_artifact_id=ready_to_confirm["pod_signature_id"],
            driver_visual_count=1,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    exceptions = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == ready_to_confirm["trip"].id,
            TripException.exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH,
        )
    )).scalars().all()
    assert exceptions == []


async def test_a_parcel_lost_in_transit_raises_a_scoped_mismatch(
    db_session, store, ready_to_confirm_short,
):
    """3 scanned out at origin, 2 scanned in at destination. This is the theft case,
    and it is the single most important assertion in this plan."""
    await phase_service.advance_confirmation(
        db_session,
        trip_id=ready_to_confirm_short["trip"].id,
        driver_id=ready_to_confirm_short["driver"].id,
        phase_event_id=ready_to_confirm_short["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=ready_to_confirm_short["pod_photo_id"],
            pod_signature_artifact_id=ready_to_confirm_short["pod_signature_id"],
            driver_visual_count=1,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    exception = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == ready_to_confirm_short["trip"].id,
            TripException.exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH,
        )
    )).scalar_one()
    assert exception.consignment_id == ready_to_confirm_short["consignment"].id
    assert exception.trip_stop_id == ready_to_confirm_short["delivery_stop"].id
    assert "3" in exception.description and "2" in exception.description


async def test_crossdock_reconciles_against_the_pickup_stop_not_the_preceding_leg(
    db_session, store, xdock_ready_to_confirm,
):
    """A consignment picked up at stop 1 and delivered at stop 3 must compare against
    STOP 1's scan-out. A leg-based lookup finds stop 2's loading row instead and
    manufactures a mismatch on a healthy trip — on FP-DEMO-XDOCK-0001, the trip a
    reviewer is walked through."""
    await phase_service.advance_confirmation(
        db_session,
        trip_id=xdock_ready_to_confirm["trip"].id,
        driver_id=xdock_ready_to_confirm["driver"].id,
        phase_event_id=xdock_ready_to_confirm["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=xdock_ready_to_confirm["pod_photo_id"],
            pod_signature_artifact_id=xdock_ready_to_confirm["pod_signature_id"],
            driver_visual_count=2,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    exceptions = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == xdock_ready_to_confirm["trip"].id,
            TripException.exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH,
        )
    )).scalars().all()
    assert exceptions == []


async def test_a_stop_with_no_consignments_skips_reconciliation(
    db_session, store, empty_leg_ready_to_confirm,
):
    """No manifest baseline means nothing to compare — never 'compare against nothing
    and manufacture a mismatch'."""
    await phase_service.advance_confirmation(
        db_session,
        trip_id=empty_leg_ready_to_confirm["trip"].id,
        driver_id=empty_leg_ready_to_confirm["driver"].id,
        phase_event_id=empty_leg_ready_to_confirm["confirmation_event"].id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            pod_photo_artifact_id=empty_leg_ready_to_confirm["pod_photo_id"],
            pod_signature_artifact_id=empty_leg_ready_to_confirm["pod_signature_id"],
            driver_visual_count=0,
            idempotency_key=str(uuid.uuid4()),
        ),
    )

    event = await db_session.get(
        PhaseEvent, empty_leg_ready_to_confirm["confirmation_event"].id,
    )
    assert event.status == PhaseStatus.COMPLETED
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_phase_service.py -v -k confirmation`
Expected: FAIL — `ValidationError: pp_scan_in_count Field required`

- [ ] **Step 3: Drop the field from the request**

In `backend/app/schemas/phases.py`:

```python
class ConfirmationCompleteRequest(_PhaseCompleteBase):
    # BQ2 resolved 2026-06-29: proof of delivery is a photo AND an on-device
    # signature — both required, not either/or.
    #
    # pp_scan_in_count is GONE from the wire. The driver app used to send its own
    # driver_visual_count in this field, which made the reconciliation compare a
    # number against itself. The server now derives it from Parcel.pp_scan_in_at.
    # The KEY of the same name in the anchored canonical payload is unchanged and
    # must stay — verification_service rebuilds from it, so renaming it would break
    # hash verification on every historical trip.
    phase_type: Literal[PhaseType.CONFIRMATION]
    pod_photo_artifact_id: UUID
    pod_signature_artifact_id: UUID
    # Pallet grain. Recorded and anchored as evidence; never compared against a
    # parcel count (design §5).
    driver_visual_count: int
```

- [ ] **Step 4: Rewrite the reconciliation**

In `advance_confirmation`, delete the `loading_event` / `origin_count` lookup entirely and
replace the reconciliation block. The artifact assignment, the anchor dispatch and the
trailing `trip.actual_arrival_at` line stay exactly as they are.

```python
    # Per consignment delivered at THIS stop, not per leg. A consignment picked up at
    # stop 1 and delivered at stop 3 has its scan-out at stop 1; _find_loading_for_leg
    # would resolve stop 2's loading row and manufacture a mismatch on a healthy
    # cross-dock trip. Consignment.pickup_stop_id / delivery_stop_id (FP-112) is the
    # partition that makes this correct.
    consignments = await scan_service.load_consignments_at_stop(
        db, trip_id=trip_id, trip_stop_id=event.trip_stop_id,
        direction=ScanDirection.IN,
    )

    scanned_in_total = 0
    mismatched = False
    for consignment in consignments:
        counts = await scan_service.scanned_counts_for_consignment(
            db, consignment_id=consignment.id,
        )
        scanned_in_total += counts.scanned_in

        if counts.scanned_out == 0 and counts.scanned_in == 0:
            # No baseline at either end — nothing to compare. Covers empty-leg trips
            # and dispatcher-overridden loadings alike, without either needing its own
            # branch keyed on a field that no longer exists.
            continue

        if counts.scanned_out != counts.scanned_in:
            mismatched = True
            db.add(TripException(
                trip_id=trip_id, phase_event_id=event.id,
                consignment_id=consignment.id, trip_stop_id=event.trip_stop_id,
                exception_type=ExceptionType.WAYBILL_COUNT_MISMATCH,
                source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
                description=(
                    f"Parcel count changed in transit on waybill "
                    f"{consignment.parcel_perfect_reference}: "
                    f"{counts.scanned_out} scanned out at origin, "
                    f"{counts.scanned_in} scanned in at destination."
                ),
            ))

    event.driver_visual_count = payload.driver_visual_count
    event.parcel_count_destination = scanned_in_total

    canonical_payload = compute_confirmation_canonical_payload(
        phase_event_id=event.id, trip_id=trip_id,
        # Key name unchanged — see the schema comment. Its provenance is now the
        # warehouse feed rather than Parcel Perfect; its name is a mild misnomer and
        # stays, because verification_service rebuilds every historical anchor from it.
        pp_scan_in_count=scanned_in_total,
        driver_visual_count=payload.driver_visual_count,
    )
    event.event_hash = compute_payload_hash(canonical_payload)

    _dispatch_anchor(
        db, event=event, canonical_payload=canonical_payload,
        receipt_type=BlockchainReceiptType.DELIVERY,
    )

    event.status = PhaseStatus.EXCEPTION if mismatched else PhaseStatus.COMPLETED
```

⚠ `_find_loading_for_leg` may now be unused. Check before deleting:

```bash
cd backend && grep -rn "_find_loading_for_leg" app/ tests/
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_phase_service.py -v`
Expected: PASS.

- [ ] **Step 6: Verify the anchor contract is intact**

Run: `cd backend && pytest tests/unit/test_phase_anchor_payload.py tests/integration/test_blockchain_verify.py -v`
Expected: PASS, unchanged. If either fails, the canonical payload's **keys** changed —
revert that part; only the source of the values may change.

- [ ] **Step 7: Add the post-close immutability guard**

This is the test that protects design §2.1 once anchoring extends to every phase. Without
it, a future change that writes late-arriving scan data onto a closed row passes every
other test in this suite and silently produces a false tampering signal in production.

Append to `backend/tests/integration/test_phases.py`:

```python
async def test_a_closed_phase_row_is_never_written_again(
    db_session, store, completed_unloading_trip,
):
    """Design §2.1: a phase's anchored payload may only contain data that existed when
    it closed. Scan data arriving after close belongs on a LATER row, never back-written
    onto this one — an anchored row whose fields change no longer hashes to its Hedera
    tx, which is precisely the tampering signal this product exists to detect."""
    event = await db_session.get(PhaseEvent, completed_unloading_trip["unloading_event_id"])
    before = {
        "parcel_count_destination": event.parcel_count_destination,
        "parcel_count_origin": event.parcel_count_origin,
        "event_hash": event.event_hash,
        "completed_at": event.completed_at,
    }

    # A late scan-in lands well after unloading closed — the realistic ordering.
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=completed_unloading_trip["pp_reference"],
        stop_reference=str(completed_unloading_trip["delivery_stop_id"]),
        direction=ScanDirection.IN,
        barcodes=completed_unloading_trip["barcodes"],
    )
    await scan_service.ingest_scans(
        db_session,
        trip_id=completed_unloading_trip["trip_id"],
        trip_stop_id=completed_unloading_trip["delivery_stop_id"],
        direction=ScanDirection.IN,
    )
    await db_session.commit()

    await db_session.refresh(event)
    assert {
        "parcel_count_destination": event.parcel_count_destination,
        "parcel_count_origin": event.parcel_count_origin,
        "event_hash": event.event_hash,
        "completed_at": event.completed_at,
    } == before
```

> **Fixture:** `completed_unloading_trip` — a trip driven through to a `COMPLETED`
> `unloading` row, with its delivery stop id, PP reference and barcodes exposed.

Run: `cd backend && pytest tests/integration/test_phases.py -v -k never_written_again`
Expected: PASS. A failure means something writes `PhaseEvent` from the scan path — fix the
writer, never this test.

- [ ] **Step 8: Run the full suite**

Run: `cd backend && pytest -q`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/phases.py backend/app/orchestration/phase_service.py backend/tests/
git commit -m "feat(orchestration): reconcile origin scan against destination scan"
```

---

# STAGE C — Frontend

> ⚠ **Everything below touches `frontend/shared/` and `frontend/driver-pwa/`, which the
> Stage 4 plan promised to leave alone because Tim's uncommitted refactor lives there.
> Coordinate with Tim before starting Stage C.** Stages A and B are complete and shippable
> without it.

## Task 9: Shared contract

**Files:**
- Modify: `frontend/shared/lib/types/phase.ts`
- Modify: `frontend/shared/lib/constants/phase-meta.ts`
- Modify: `backend/app/core/phase_meta.py`
- Test: `backend/tests/unit/test_phase_meta_contract.py` (existing — must stay green)

- [ ] **Step 1: Add `blocked_on` to the TS contract**

In `frontend/shared/lib/types/phase.ts`, inside `PhaseDescriptor` immediately after
`step_recipe`:

```typescript
  // Non-null while this phase waits on an external system — today only the warehouse
  // scan feed ('warehouse_scan'). Derived server-side per request, never stored: it is
  // a property of the outside world, not of this row. A phase carrying a non-null value
  // must not be submittable; the server independently 409s if one is.
  blocked_on: string | null
```

- [ ] **Step 2: Update both step tables**

In `backend/app/core/phase_meta.py`, change the `LOADING` entry:

```python
    PhaseType.LOADING: ("1-linehaul",),
```

Replace the long `loading is NOT empty` comment block above `STEP_SLUGS` with:

```python
# loading's step is the LINEHAUL, not a count (2026-08-05). The driver never enters the
# warehouse and may reach the truck after loading finished, so a parcel count is a number
# he cannot honestly produce — and manifest_service records Bruce's rule that he counts
# pallets, never parcels, in any case. The phase is now gated on the warehouse closing its
# scan session (orchestration/phase_gate.py) and closed by the driver confirming the
# linehaul document, which is the driver-safe view he is actually given.
```

In `frontend/shared/lib/constants/phase-meta.ts`, update **both** tables — they are paired
positionally and the contract test parses both:

```typescript
  loading: ['1-linehaul'],
```

```typescript
  loading: ['Linehaul'],
```

- [ ] **Step 3: Run the contract test**

Run: `cd backend && pytest tests/unit/test_phase_meta_contract.py -v`
Expected: PASS. A failure here means the two files disagree — fix the mismatch, never the
test.

- [ ] **Step 4: Commit**

```bash
git add frontend/shared/lib/types/phase.ts frontend/shared/lib/constants/phase-meta.ts backend/app/core/phase_meta.py
git commit -m "feat(shared): blocked_on contract and the linehaul step slug"
```

---

## Task 10: The driver's linehaul step

**Files:**
- Create: `frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx`
- Delete: `frontend/driver-pwa/components/phase/steps/loading/VisualCount.tsx`
- Modify: `frontend/driver-pwa/components/phase/steps/registry.ts`
- Modify: `frontend/driver-pwa/lib/api/phases.ts`
- Modify: `frontend/driver-pwa/lib/types/evidence-draft.ts`
- Test: `frontend/driver-pwa/components/phase/steps/__tests__/linehaul.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/driver-pwa/components/phase/steps/__tests__/linehaul.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Linehaul } from '../loading/Linehaul'
import { makePhase } from './testFixtures'

const linehaul = {
  trip_id: 'trip-1',
  vehicle_registration: 'ABC123GP',
  vehicle_type: 'horse',
  driver_full_name: 'Test Driver',
  consolidated_unit_count: 4,
  origin_scan_complete: true,
  pulled_at: '2026-08-05T10:00:00Z',
}

describe('Linehaul', () => {
  it('shows the consolidated unit count', () => {
    render(
      <Linehaul
        tripId="trip-1"
        phase={makePhase('loading')}
        stepIndex={0}
        linehaul={linehaul}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText(/4/)).toBeInTheDocument()
  })

  it('never renders per-parcel data', () => {
    render(
      <Linehaul
        tripId="trip-1"
        phase={makePhase('loading')}
        stepIndex={0}
        linehaul={linehaul}
        onComplete={vi.fn()}
      />,
    )

    // The theft-risk rule: the driver must never learn what is in the truck.
    expect(screen.queryByText(/barcode/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/waybill no/i)).not.toBeInTheDocument()
  })

  it('renders a waiting state instead of the confirm control when blocked', () => {
    render(
      <Linehaul
        tripId="trip-1"
        phase={{ ...makePhase('loading'), blocked_on: 'warehouse_scan' }}
        stepIndex={0}
        linehaul={null}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText(/waiting for the warehouse/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend/driver-pwa && npx vitest run components/phase/steps/__tests__/linehaul.test.tsx`
Expected: FAIL — cannot resolve `../loading/Linehaul`.

- [ ] **Step 3: Implement the component**

Create `frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx`:

```typescript
// frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Linehaul as LinehaulDocument } from '@shared/lib/types/manifest'

interface LinehaulProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  linehaul: LinehaulDocument | null
  onComplete: () => void | Promise<void>
}

// Replaces loading/VisualCount.tsx. The driver never enters the warehouse, so he cannot
// honestly count what was loaded; what he IS given is the linehaul sheet — the driver-safe
// summary (vehicle, driver, consolidated unit count, no contents). This step restores
// H2Linehaul.tsx, deleted in 493b9fe, and reconnects manifest_service.get_linehaul_for_driver,
// which has had no driver-side consumer since.
//
// NEVER render per-parcel data here. LinehaulResponse is deliberately narrow (its docstring
// enforces the theft-risk rule); widening what this screen shows would defeat the reason the
// endpoint is separate from the dispatcher's manifest in the first place.
export function Linehaul({ tripId, phase, stepIndex, linehaul, onComplete }: LinehaulProps) {
  // The server is the authority — it 409s a blocked completion regardless of what this
  // renders. This is the courteous half: tell the driver why nothing is actionable rather
  // than showing him a control that will fail.
  const isBlocked = phase.blocked_on !== null

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {isBlocked ? (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 flex flex-col gap-2">
            <p className="text-sm font-semibold">Waiting for the warehouse</p>
            <p className="text-sm text-surface-on-variant">
              Loading is still in progress. This will unlock on its own once the warehouse
              finishes. No action is needed from you.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-surface-on-variant">
              Check this against the linehaul sheet you were given, then confirm.
            </p>
            <dl className="rounded-xl border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant">
              <Row label="Vehicle" value={linehaul?.vehicle_registration ?? '—'} />
              <Row label="Type" value={linehaul?.vehicle_type ?? '—'} />
              <Row label="Driver" value={linehaul?.driver_full_name ?? '—'} />
              <Row label="Units on board" value={String(linehaul?.consolidated_unit_count ?? '—')} />
            </dl>
          </>
        )}
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        {!isBlocked && <SwipeToConfirm label="Confirm linehaul" onConfirm={onComplete} />}
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-3">
      <dt className="text-sm text-surface-on-variant">{label}</dt>
      <dd className="text-sm font-semibold">{value}</dd>
    </div>
  )
}
```

- [ ] **Step 4: Update the registry**

In `frontend/driver-pwa/components/phase/steps/registry.ts`:

```typescript
import { Linehaul } from './loading/Linehaul'
```

```typescript
type LoadingSlug = '1-linehaul'
```

```typescript
  loading: {
    '1-linehaul': Linehaul,
  },
```

Remove the `VisualCount as LoadingVisualCount` import, then delete
`frontend/driver-pwa/components/phase/steps/loading/VisualCount.tsx`.

- [ ] **Step 5: Stop sending the count**

In `frontend/driver-pwa/lib/api/phases.ts`, the `case 'loading':` branch becomes:

```typescript
    case 'loading': {
      // No evidence fields: the warehouse scan is what records what was loaded, and the
      // server derives parcel_count_origin from it. driver_visual_count is still ACCEPTED
      // by the backend (Optional) purely so a pre-existing offline-queue entry can drain;
      // nothing sends it any more.
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'loading',
        ...driverPosition(position),
        idempotency_key: idempotencyKey,
      })
      break
    }
```

In `frontend/driver-pwa/lib/types/evidence-draft.ts`, remove `driverVisualCount` from
`LoadingEvidence`, leaving the type with only its shared fields.

- [ ] **Step 6: Run the tests**

Run: `cd frontend/driver-pwa && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors. Registry tests will flag the slug change — update
`__tests__/registry.test.ts`'s expected slug set to `['1-linehaul']`.

- [ ] **Step 7: Commit**

```bash
git add frontend/driver-pwa/components/phase/steps/ frontend/driver-pwa/lib/api/phases.ts frontend/driver-pwa/lib/types/evidence-draft.ts
git commit -m "feat(driver-pwa): replace the loading count with the linehaul step"
```

---

## Task 11: Dispatcher loading panel

**Files:**
- Modify: `frontend/dispatcher/components/domain/LoadingDetail.tsx`
- Test: `frontend/dispatcher/components/domain/__tests__/LoadingDetail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/dispatcher/components/domain/__tests__/LoadingDetail.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LoadingDetail } from '../LoadingDetail'
import { makePhase } from './testFixtures'

describe('LoadingDetail', () => {
  it('shows scanned against expected', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), parcel_count_origin: 2 }}
        expectedCount={3}
      />,
    )

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('flags a short scan', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), parcel_count_origin: 2 }}
        expectedCount={3}
      />,
    )

    expect(screen.getByText(/1 not scanned/i)).toBeInTheDocument()
  })

  it('shows no verdict when there is no manifest baseline', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), parcel_count_origin: null }}
        expectedCount={null}
      />,
    )

    expect(screen.queryByText(/not scanned/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend/dispatcher && npx vitest run components/domain/__tests__/LoadingDetail.test.tsx`
Expected: FAIL — `expectedCount` is not a prop.

- [ ] **Step 3: Implement**

Replace `frontend/dispatcher/components/domain/LoadingDetail.tsx`:

```typescript
'use client'

import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

interface Props {
  phase: PhaseDescriptor
  /** Manifest baseline from Parcel Perfect's tracks[]. Null when the trip carries no
   *  PP reference — common, and not a failure. */
  expectedCount: number | null
}

// Loading is now system-observed: the warehouse's scan is what records what went on the
// truck, and parcel_count_origin is the scanned tally stamped at close. The driver's own
// count is gone — he never enters the warehouse and could not honestly produce one.
export function LoadingDetail({ phase, expectedCount }: Props) {
  const scanned = phase.parcel_count_origin
  // Null is not zero: no baseline means nothing to compare, not "nothing was loaded".
  const hasBoth = expectedCount !== null && scanned !== null
  const missing = hasBoth ? expectedCount - scanned : 0

  return (
    <PhaseDetailCard>
      <Section title="Warehouse scan">
        <Field label="Expected (manifest)" value={expectedCount?.toString()} />
        <Field label="Scanned onto truck" value={scanned?.toString()} />
      </Section>
      {hasBoth && (
        <div className={`text-[11px] font-[600] px-3 pb-3 ${missing === 0 ? 'text-ok' : 'text-warn'}`}>
          {missing === 0 ? 'All parcels scanned ✓' : `${missing} not scanned ✗`}
        </div>
      )}
      <PhaseOverrideSection phase={phase} />
    </PhaseDetailCard>
  )
}
```

Update the call site to pass `expectedCount` — find it with:

```bash
cd frontend/dispatcher && grep -rn "LoadingDetail" app/ components/ --include=*.tsx
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend/dispatcher && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/dispatcher/components/domain/LoadingDetail.tsx frontend/dispatcher/components/domain/__tests__/LoadingDetail.test.tsx
git commit -m "feat(dispatcher): show the warehouse scan on the loading panel"
```

---

## Task 12: Dispatcher unloading and confirmation panels

**Files:**
- Modify: `frontend/dispatcher/components/domain/ConfirmationDetail.tsx`
- Modify: `frontend/dispatcher/components/domain/UnloadingDetail.tsx`
- Test: `frontend/dispatcher/components/domain/__tests__/ConfirmationDetail.test.tsx`

Spec §5: the destination scan figures display under **unloading**, because that is where
they physically happened, even though the data is stamped on the confirmation row. Display
and storage are independent — that separation is what keeps anchoring safe.

- [ ] **Step 1: Write the failing tests**

Create `frontend/dispatcher/components/domain/__tests__/ConfirmationDetail.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConfirmationDetail } from '../ConfirmationDetail'
import { makePhase } from './testFixtures'

describe('ConfirmationDetail', () => {
  it('shows the origin-vs-destination verdict', () => {
    render(
      <ConfirmationDetail
        phase={{
          ...makePhase('confirmation'),
          parcel_count_origin: 3,
          parcel_count_destination: 3,
          driver_visual_count: 1,
        }}
        originScannedCount={3}
      />,
    )

    expect(screen.getByText(/counts agree/i)).toBeInTheDocument()
  })

  it('flags a parcel lost in transit', () => {
    render(
      <ConfirmationDetail
        phase={{
          ...makePhase('confirmation'),
          parcel_count_destination: 2,
          driver_visual_count: 1,
        }}
        originScannedCount={3}
      />,
    )

    expect(screen.getByText(/1 parcel unaccounted for/i)).toBeInTheDocument()
  })

  it('marks the driver pallet count as recorded, not checked', () => {
    render(
      <ConfirmationDetail
        phase={{
          ...makePhase('confirmation'),
          parcel_count_destination: 3,
          driver_visual_count: 1,
        }}
        originScannedCount={3}
      />,
    )

    // Pallet grain vs parcel grain — it must never read as part of the verdict.
    expect(screen.getByText(/recorded, not reconciled/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend/dispatcher && npx vitest run components/domain/__tests__/ConfirmationDetail.test.tsx`
Expected: FAIL — `originScannedCount` is not a prop.

- [ ] **Step 3: Implement `ConfirmationDetail`**

```typescript
'use client'

import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

interface Props {
  phase: PhaseDescriptor
  /** Parcels scanned onto the truck at this consignment's PICKUP stop — which on a
   *  cross-dock trip is not the stop immediately before this one. */
  originScannedCount: number | null
}

// The reconciliation is parcel-grain on both sides and sourced from two independent depot
// systems. The driver's pallet count is shown but deliberately excluded from the verdict:
// it is a different unit, and comparing it against a parcel count was the fault this
// redesign removed.
export function ConfirmationDetail({ phase, originScannedCount }: Props) {
  const destination = phase.parcel_count_destination
  const hasBoth = originScannedCount !== null && destination !== null
  const unaccounted = hasBoth ? originScannedCount - destination : 0

  return (
    <PhaseDetailCard>
      <Section title="Chain of custody">
        <Field label="Scanned out (origin depot)" value={originScannedCount?.toString()} />
        <Field label="Scanned in (destination depot)" value={destination?.toString()} />
      </Section>
      {hasBoth && (
        <div className={`text-[11px] font-[600] px-3 pb-3 ${unaccounted === 0 ? 'text-ok' : 'text-warn'}`}>
          {unaccounted === 0
            ? 'Counts agree ✓'
            : `${unaccounted} parcel unaccounted for in transit ✗`}
        </div>
      )}
      <Section title="Driver observation">
        <Field label="Pallets counted by driver" value={phase.driver_visual_count?.toString()} />
      </Section>
      <div className="text-[11px] text-surface-on-variant px-3 pb-3">
        Pallet grain — recorded, not reconciled against the parcel counts above.
      </div>
      <PhaseOverrideSection phase={phase} />
    </PhaseDetailCard>
  )
}
```

- [ ] **Step 4: Show the destination scan under unloading**

In `UnloadingDetail.tsx`, add a section above the existing seal fields:

```typescript
      <Section title="Warehouse scan">
        <Field label="Scanned off truck" value={destinationScannedCount?.toString()} />
      </Section>
```

with the matching prop:

```typescript
  /** Derived from Parcel rows at this delivery stop, NOT from this phase row — the
   *  scan lands after unloading closes, and a closed row is never written again. */
  destinationScannedCount: number | null
```

- [ ] **Step 5: Run the tests**

Run: `cd frontend/dispatcher && npx vitest run && npx tsc --noEmit`
Expected: PASS. Update the call sites the type errors point at.

- [ ] **Step 6: Commit**

```bash
git add frontend/dispatcher/components/domain/
git commit -m "feat(dispatcher): show the scan reconciliation on unloading and confirmation"
```

---

# STAGE D — Paper linehaul photo (optional)

> **This is the only stage requiring an Alembic migration, and the only backend change
> that collides with other branches. Drop it under time pressure — Stage C already
> delivers the digital linehaul, which is Bruce's stated goal.** Everything above is
> complete and shippable without this.

## Task 13: Capture the paper linehaul sheet

**Files:**
- Create: `backend/alembic/versions/2026_08_05_ciaran_add_linehaul_photo.py`
- Modify: `backend/app/db/models/phases.py`
- Modify: `backend/app/schemas/phases.py`
- Modify: `backend/app/orchestration/phase_service.py`
- Modify: `frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx`

- [ ] **Step 1: Check for migration conflicts first**

```bash
git fetch origin && git log --oneline origin/dev -- backend/alembic/versions/ | head -10
```

If another dev has an unmerged migration, **stop and coordinate** — do not fix the revision
chain yourself (`CLAUDE.md`).

- [ ] **Step 2: Add the column to the model**

In `backend/app/db/models/phases.py`, beside the other artifact FKs on `PhaseEvent`:

```python
    # The paper linehaul sheet the warehouse hands the driver at loading. Distinct from
    # waybill_photo_artifact_id (departure): that is the legal waybill copy, this is the
    # driver-safe summary. Third-party evidence of what the warehouse CLAIMED was loaded,
    # independent of FreightProof's own record.
    linehaul_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("artifacts.id"), nullable=True,
    )
```

- [ ] **Step 3: Generate and inspect the migration**

```bash
cd backend && alembic revision --autogenerate -m "ciaran add linehaul photo"
```

Rename the generated file to `2026_08_05_ciaran_add_linehaul_photo.py`. Open it and confirm
it contains **only** the one `add_column` — autogenerate picks up unrelated drift. Delete
anything else it produced.

- [ ] **Step 4: Apply and verify**

```bash
cd backend && alembic upgrade head && alembic current
```

Expected: the new revision is head.

- [ ] **Step 5: Wire it through**

In `backend/app/schemas/phases.py`, add to `LoadingCompleteRequest`:

```python
    linehaul_photo_artifact_id: Optional[UUID] = None
```

and to `PhaseEventRead`, beside the other artifact ids:

```python
    linehaul_photo_artifact_id: Optional[UUID] = None
```

In `advance_loading`, after `_record_driver_position(event, payload)`:

```python
    if payload.linehaul_photo_artifact_id is not None:
        await _assert_artifacts_belong_to_trip(
            db, trip_id=trip_id, artifact_ids=(payload.linehaul_photo_artifact_id,),
        )
        event.linehaul_photo_artifact_id = payload.linehaul_photo_artifact_id
```

> Optional, not required: a driver at a warehouse that has already gone paperless has no
> sheet to photograph, and blocking his trip over a document that does not exist would be
> the wrong failure direction on an evidence platform.

- [ ] **Step 6: Add the capture to the step**

In `Linehaul.tsx`, add these imports:

```typescript
import { CameraCapture } from '@/components/phase/CameraCapture'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import type { LoadingEvidence } from '@/lib/types/evidence-draft'
```

Add `draft` and `onUpdate` to `LinehaulProps`:

```typescript
  draft: LoadingEvidence
  onUpdate: (patch: Partial<LoadingEvidence>) => void
```

Add the handler inside the component, above the `return`:

```typescript
  const { uploadNow } = useArtifactUpload(tripId)

  // Upload starts the moment the photo exists, not when the driver swipes — the walk
  // between the two is dead time otherwise. Mirrors departure/Waybill.tsx exactly.
  function handleCapture(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ linehaulPhotoDataUrl: dataUrl, linehaulPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt).then((artifactId) => {
      if (artifactId !== null) onUpdate({ linehaulPhotoArtifactId: artifactId })
    })
  }
```

Render it directly below the `</dl>`, inside the same non-blocked branch:

```typescript
            <CameraCapture
              label="Linehaul sheet"
              dataUrl={draft.linehaulPhotoDataUrl}
              onCapture={handleCapture}
            />
```

And gate the swipe:

```typescript
        {!isBlocked && (
          <SwipeToConfirm
            label="Confirm linehaul"
            onConfirm={onComplete}
            disabled={!draft.linehaulPhotoDataUrl}
          />
        )}
```

Add both fields to `LoadingEvidence` in `frontend/driver-pwa/lib/types/evidence-draft.ts`:

```typescript
  linehaulPhotoDataUrl: string | null
  linehaulPhotoArtifactId: string | null
```

And send the id in `phases.ts`'s `case 'loading':`:

```typescript
        linehaul_photo_artifact_id: e.linehaulPhotoArtifactId,
```

- [ ] **Step 7: Run everything**

Run: `cd backend && pytest -q && cd ../frontend/driver-pwa && npx vitest run && npx tsc --noEmit`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic/versions/ backend/app/db/models/phases.py backend/app/schemas/phases.py backend/app/orchestration/phase_service.py frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx
git commit -m "feat(orchestration): capture the paper linehaul sheet at loading"
```

---

## Final verification

- [ ] `cd backend && pytest -q` — green
- [ ] `cd frontend/driver-pwa && npx vitest run && npx tsc --noEmit` — green
- [ ] `cd frontend/dispatcher && npx vitest run && npx tsc --noEmit` — green
- [ ] Demo path by hand: create a trip → dev panel stages **2 of 3** scan-out barcodes →
      close the session → the driver's loading unlocks → confirm the linehaul → the
      dispatcher's loading panel shows `2 / 3` with `1 not scanned` and a
      `PARCEL_COUNT_MISMATCH` on the timeline.

That last one is the demonstration. If it works end-to-end, the feature is done.

---

## Shared files touched

- `backend/app/schemas/phases.py` — the frozen phase contract
- `backend/app/core/phase_meta.py` + `frontend/shared/lib/constants/phase-meta.ts` — paired
- `frontend/shared/lib/types/phase.ts` — read by both frontends
- `backend/app/api/v1/endpoints/phases.py`, `backend/app/orchestration/phase_service.py`
- `backend/app/core/exceptions.py`

Flag all of these in TASK COMPLETE.

## Migrations

Stage D only: `2026_08_05_ciaran_add_linehaul_photo.py` — one nullable column. Stages A–C
require none.

## New .env keys

None. `SCAN_FEED_USE_MOCK` and `DEV_PANEL_ENABLED` arrive with the Stage 4 plan.
