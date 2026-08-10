# ScanFeed Interface + Dev Trigger Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `ScanFeed` integration interface with a Redis-backed mock, a real reconciliation service that populates the warehouse scan columns and raises stop-scoped exceptions, and a dev-only trigger page that drives all of it without ever writing to the database directly.

**Architecture:** Mirrors the proven `get_pp_client()` pattern exactly — a `Protocol`, a mock implementation, and a factory selected by a config flag, so every consumer is agnostic to which implementation is live. The dev panel stages state into the *mock* (Redis), then calls the same orchestration functions the real flow calls; those functions write every permanent effect. Redis is used rather than process memory because the API and the Celery worker are separate processes on the hosted deployment, and module-level state is invisible across that boundary.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.0 async, Pydantic v2, `redis.asyncio` (already a dependency at `redis==5.0.4`), pytest + pytest-asyncio (`asyncio_mode = auto`), Next.js 15 App Router, TypeScript 5.5+.

---

## Context you must read before starting

Read these before Task 1. They are the source of every decision below.

- `CLAUDE.md` — project rules. The Prime Directive, the layering fence, the git prohibitions, and the TASK COMPLETE format all bind this work.
- `docs/parcel-perfect-integration-spec.md` — §B (especially B2c, B3, B4b, B4b-i) is *why* this exists. Its findings were verified empirically against the live Parcel Perfect API on 2026-08-04. Do not re-derive them.
- `backend/app/integrations/parcel_perfect.py` — the pattern being mirrored. `get_pp_client()` at line 790.

### The one non-negotiable principle

> **Every trigger drives the mock's state. No trigger writes to the database directly.**

If a button `INSERT`s a scan row or flips a status column, the demo proves only that the button works. Every trigger must drive a mock implementation whose events flow through the **real** orchestration path — real reconciliation, real exception raising. Then swapping the mock for a live warehouse feed later changes nothing downstream.

This is the thing an examiner will probe hardest. Task 10 contains the test that proves it.

### Domain facts that shape the design

These were confirmed with the domain expert. Do not design against them.

- **The driver never enters the warehouse and never scans.** Security policy. He verifies a *unit count* (pallets) at the truck, never per-parcel identity.
- **Warehouse staff scan in and out using their own system.** They have no FreightProof accounts. That feed is not reachable through any API we have — hence the mock.
- **Parcel Perfect exposes exactly one read method** (`getSingleWaybill`). There is no scan, event, tracking or manifest-contents endpoint in any version.
- `Parcel.pp_scan_out_at` / `pp_scan_in_at` exist, are exposed in schemas, and are **written by nothing today**. They are warehouse scan timestamps — exactly what the names say. This plan is their first writer.
- Consequently `origin_scan_complete` in `manifest_service.py` (lines 74, 89, 142) is `all(p.pp_scan_out_at is not None ...)` over a permanently-`NULL` column and is structurally always `false`. **This plan fixes that with data, not with a code change** — do not edit `manifest_service.py`.

### Isolation from other developers

Four devs work on separate branches. This plan touches **zero files** in `frontend/shared/` and **zero files** in `frontend/driver-pwa/`, which is where Tim's uncommitted driver-app refactor lives. That isolation is deliberate — preserve it.

Two shared files are modified, both purely additively: `backend/app/main.py` (4 lines) and `backend/app/core/config.py` (2 keys). Flag both in TASK COMPLETE.

**No Alembic migration.** Every column this work needs already exists. Do not generate one.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/integrations/mock_state.py` | **Create.** Redis-backed key/value store for simulated external-world state. Key namespace, TTL, factory. Imports only `config` + `redis`. |
| `backend/app/integrations/scan_feed.py` | **Create.** `ScanDirection`, `ScanEvent`, `ScanFeed` Protocol, `MockScanFeed`, `get_scan_feed()`. Mirrors `parcel_perfect.py`'s shape. |
| `backend/app/orchestration/scan_service.py` | **Create.** `ingest_scans()` — the real consumer. Resolves the expected set per stop, writes scan timestamps, reconciles, raises scoped `TripException`s. |
| `backend/app/schemas/dev.py` | **Create.** Pydantic v2 request/response models for the dev endpoints. |
| `backend/app/api/v1/endpoints/dev_triggers.py` | **Create.** Thin router + `dev_panel_enabled()` predicate. |
| `backend/app/core/config.py` | **Modify (shared).** `DEV_PANEL_ENABLED`, `SCAN_FEED_USE_MOCK`. |
| `backend/app/main.py` | **Modify (shared).** Guarded `include_router`. |
| `backend/app/integrations/parcel_perfect.py` | **Modify.** Redis-backed override layer on `MockParcelPerfectClient` so the Celery worker sees staged waybill changes. |
| `backend/.env.example` | **Modify.** Key names only. |
| `frontend/dispatcher/lib/types/dev.ts` | **Create.** TS mirrors of the dev schemas. Dispatcher-local, *not* `frontend/shared/`. |
| `frontend/dispatcher/lib/hooks/useDevTriggers.ts` | **Create.** Typed calls to the dev endpoints. |
| `frontend/dispatcher/components/dev/*.tsx` | **Create.** Trip picker + three trigger groups. |
| `frontend/dispatcher/app/(app)/dev/triggers/page.tsx` | **Create.** The standalone page, operated on a second device. |

### Out of scope — do not build these

| Excluded | Reason |
|---|---|
| Driver-side barcode scanning | Explicitly rejected. The driver cannot scan and never enters the warehouse. |
| Any guard-facing surface | The zero-login guard page is no longer planned. |
| Pulsit / telemetry integration | Out of scope (`phase_service.py:413`). The pattern here generalises to it later; build nothing now. |
| Phase-driving triggers, synthetic evidence artifacts | Humans drive phases on the real driver app. Not needed. |
| `fetch_and_sync_consignment` drift detection | Spec Stage 5, its own ticket. Task 8 triggers the mid-trip edit; **detecting** it is deliberately not built. |
| PP field-parser widening | Spec Stages 1–3, separate. |
| `manifest_service.py` | `origin_scan_complete` is fixed by data, not code. |
| `H5VisualCount.tsx` blind capture | Spec B4c, separate correction. |
| Alembic migration | Every column already exists. |
| `frontend/dispatcher/lib/api/client.ts` | Has no `delete` verb; the flush endpoint is a `POST` specifically to avoid touching it (it has its own test file). |
| Sidebar nav link | Page is reached by URL on the second device. Less surface area. |

---

## Task 1: Config keys

**Files:**
- Modify: `backend/app/core/config.py` (⚠ shared file — additive only)
- Modify: `backend/.env.example`

- [ ] **Step 1: Add the two settings**

In `backend/app/core/config.py`, immediately after the `PP_POLL_INTERVAL_SECONDS: int = 60` line (currently line 97), inside the "Integration mock toggles" block:

```python
    # Warehouse scan feed. True = MockScanFeed (Redis-backed, driven by the dev
    # trigger panel), False = a real WMS/PP-depot feed. Mirrors PP_USE_MOCK.
    # No real implementation exists yet: PP exposes no scan endpoint and we have
    # no depot account, so this stays True until one lands.
    SCAN_FEED_USE_MOCK: bool = True
```

Then in the "Runtime config" block, after `DEMO_MODE: bool = False` (currently line 104):

```python
    # Dev trigger panel. Registers a router that can fire scans, PP lifecycle
    # changes and exceptions. Defaults to False so the panel is absent unless
    # deliberately switched on — ENVIRONMENT != "production" is the second,
    # independent condition (see api/v1/endpoints/dev_triggers.dev_panel_enabled).
    # Both must hold. On an internet-reachable demo host, one switch is not enough.
    DEV_PANEL_ENABLED: bool = False
```

- [ ] **Step 2: Add key names to `.env.example`**

Append to `backend/.env.example`:

```
SCAN_FEED_USE_MOCK=
DEV_PANEL_ENABLED=
```

- [ ] **Step 3: Verify settings load**

Run: `cd backend && python -c "from app.core.config import settings; print(settings.DEV_PANEL_ENABLED, settings.SCAN_FEED_USE_MOCK)"`
Expected: `False True`

- [ ] **Step 4: Verify nothing regressed**

Run: `cd backend && pytest -q`
Expected: same pass count as before this task, no new failures.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/.env.example
git commit -m "feat(core): config flags for the scan feed and the dev trigger panel"
```

---

## Task 2: Mock state store

The simulated outside world lives here. Redis, not process memory, because `app/tasks/parcel_perfect.py` runs in the Celery worker — a **different process** — and must see staged waybill edits.

**Files:**
- Create: `backend/app/integrations/mock_state.py`
- Test: `backend/tests/unit/test_mock_state.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_mock_state.py`:

```python
"""Unit tests for the mock-state key helpers.

The Redis-backed store itself is exercised through MockScanFeed's tests with an
injected fake; these tests cover the pure key-building logic, which is what
guarantees one trigger's state never collides with another's.
"""

from app.integrations.mock_state import MOCK_STATE_PREFIX, build_key


def test_build_key_namespaces_every_key():
    key = build_key("scan", "WAY001", "stop-1", "out")

    assert key.startswith(MOCK_STATE_PREFIX)


def test_build_key_is_stable_for_the_same_parts():
    first = build_key("scan", "WAY001", "stop-1", "out")
    second = build_key("scan", "WAY001", "stop-1", "out")

    assert first == second


def test_build_key_separates_different_parts():
    out_key = build_key("scan", "WAY001", "stop-1", "out")
    in_key = build_key("scan", "WAY001", "stop-1", "in")

    assert out_key != in_key


def test_build_key_separates_different_kinds():
    scan_key = build_key("scan", "WAY001")
    pp_key = build_key("pp", "WAY001")

    assert scan_key != pp_key
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pytest tests/unit/test_mock_state.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.integrations.mock_state'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/integrations/mock_state.py`:

```python
"""Shared store for simulated external-world state, backed by Redis.

Why Redis and not a module-level dict: the FastAPI app and the Celery worker are
separate processes on the hosted deployment, and a hosted API typically runs
several worker processes. A staged waybill edit written into one process's memory
is invisible to the 60-second PP poll in app/tasks/parcel_perfect.py, which is a
different process entirely — so the "PP changed the manifest mid-trip" scenario
could never work in memory. Redis is already a hard dependency (it is the Celery
broker), so this costs no new package and no migration.

What lives here is the *outside world we are pretending to have*: what the
warehouse is about to report, and what the PP portal currently says. It is not
evidence. Every permanent effect of a trigger is written to PostgreSQL by
orchestration, and flushing this store leaves that evidence untouched — see
tests/integration/test_dev_triggers.py::test_flushing_mock_state_leaves_evidence_intact.

Layering: integrations → config only. Never imports from api/ or orchestration/.
"""

import json
import logging
from typing import Any, Protocol

import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# Every key this module writes is namespaced, so a flush can be scoped precisely
# and can never touch Celery's own broker keys in the same Redis instance.
MOCK_STATE_PREFIX = "freightproof:mock:"

# Staged state is demo scaffolding, not evidence. A day is far longer than any
# demo and short enough that abandoned state expires on its own.
MOCK_STATE_TTL_SECONDS = 60 * 60 * 24


def build_key(kind: str, *parts: str) -> str:
    """Build a namespaced Redis key. `kind` separates scan state from PP state."""
    return MOCK_STATE_PREFIX + ":".join([kind, *parts])


class MockStateStore(Protocol):
    """The storage contract MockScanFeed and the PP override layer depend on.

    A Protocol rather than a base class so tests can inject a dict-backed fake
    without pulling in a Redis test dependency.
    """

    async def get_json(self, key: str) -> dict[str, Any] | None: ...

    async def set_json(self, key: str, value: dict[str, Any]) -> None: ...

    async def flush(self) -> int: ...


class RedisMockStateStore:
    """MockStateStore over redis.asyncio, one short-lived connection per call.

    A connection per call rather than a pooled client: these calls happen only on
    dev-panel triggers (a handful per demo), and a module-level pool would bind to
    whichever event loop first touched it — which breaks under Celery's
    asyncio.run() per task and under pytest's function-scoped loops.
    """

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url

    async def get_json(self, key: str) -> dict[str, Any] | None:
        client = redis.from_url(self._redis_url, decode_responses=True)
        try:
            raw = await client.get(key)
        finally:
            await client.aclose()
        if raw is None:
            return None
        try:
            parsed: dict[str, Any] = json.loads(raw)
        except json.JSONDecodeError:
            # Corrupt staged state is a bug in a writer, not a reason to fail a
            # demo. Log loudly and treat it as absent so the trigger still runs.
            logger.error("Corrupt mock state at key %s — treating as unset", key)
            return None
        return parsed

    async def set_json(self, key: str, value: dict[str, Any]) -> None:
        client = redis.from_url(self._redis_url, decode_responses=True)
        try:
            await client.set(key, json.dumps(value), ex=MOCK_STATE_TTL_SECONDS)
        finally:
            await client.aclose()

    async def flush(self) -> int:
        """Delete every namespaced mock key. Returns how many were removed.

        scan_iter, not keys(): keys() blocks Redis for the whole scan, and this
        shares an instance with the Celery broker.
        """
        client = redis.from_url(self._redis_url, decode_responses=True)
        deleted = 0
        try:
            async for key in client.scan_iter(match=f"{MOCK_STATE_PREFIX}*"):
                deleted += await client.delete(key)
        finally:
            await client.aclose()
        logger.info("Flushed %d mock-state key(s)", deleted)
        return deleted


def get_mock_state_store() -> MockStateStore:
    """Return the mock-state store. Mirrors get_pp_client()'s factory shape."""
    return RedisMockStateStore(settings.REDIS_URL)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && pytest tests/unit/test_mock_state.py -v`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/integrations/mock_state.py backend/tests/unit/test_mock_state.py
git commit -m "feat(integrations): Redis-backed store for simulated external state"
```

---

## Task 3: The ScanFeed interface

**Files:**
- Create: `backend/app/integrations/scan_feed.py`
- Test: `backend/tests/unit/test_scan_feed.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_scan_feed.py`:

```python
"""Unit tests for the ScanFeed interface and its mock implementation.

The store is a dict-backed fake injected via monkeypatch, so these run with no
Redis present — the same reason the PP client's tests run with no network.
"""

from typing import Any

import pytest

from app.core.config import settings
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import (
    MockScanFeed,
    ScanDirection,
    get_scan_feed,
)


class FakeStore:
    """Dict-backed MockStateStore. Avoids adding fakeredis to requirements.txt."""

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


async def test_poll_returns_empty_when_nothing_staged(store: FakeStore):
    feed = MockScanFeed()

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert events == []


async def test_staged_barcodes_are_returned_by_poll(store: FakeStore):
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001", "WAY0010002"],
    )

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert [e.barcode for e in events] == ["WAY0010001", "WAY0010002"]
    assert all(e.direction is ScanDirection.OUT for e in events)


async def test_poll_is_scoped_by_direction(store: FakeStore):
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001"],
    )

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.IN,
    )

    assert events == []


async def test_poll_is_scoped_by_stop(store: FakeStore):
    """A cross-dock trip has several stops — a scan at one must not leak to another."""
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001"],
    )

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-2",
        direction=ScanDirection.OUT,
    )

    assert events == []


async def test_staging_replaces_rather_than_appends(store: FakeStore):
    """Re-staging is how a demo is corrected after a mis-click; it must not accumulate."""
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001", "WAY0010002"],
    )

    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001"],
    )
    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert [e.barcode for e in events] == ["WAY0010001"]


async def test_events_carry_their_scan_timestamp(store: FakeStore):
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001"],
    )

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert events[0].scanned_at.tzinfo is not None


def test_factory_returns_the_mock_when_configured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "SCAN_FEED_USE_MOCK", True)

    feed = get_scan_feed()

    assert isinstance(feed, MockScanFeed)


def test_factory_raises_when_no_real_feed_exists(monkeypatch: pytest.MonkeyPatch):
    """No live warehouse feed exists yet — failing loudly beats silently mocking."""
    monkeypatch.setattr(settings, "SCAN_FEED_USE_MOCK", False)

    with pytest.raises(NotImplementedError):
        get_scan_feed()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pytest tests/unit/test_scan_feed.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.integrations.scan_feed'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/integrations/scan_feed.py`:

```python
"""Warehouse scan feed — the inbound interface for what was physically scanned.

Parcel Perfect is the system of record for what was *supposed* to be on the truck;
FreightProof is the system of record for what *actually* was. PP supplies the
expected set at parcel grain (tracks[], already persisted as Parcel rows). The
observed set has to come from the warehouse's own scanning system, and no API we
can reach exposes it — PP's ecomService has exactly one read method
(getSingleWaybill) and our account is Mode: Customer, which cannot manifest or
dispatch. See docs/parcel-perfect-integration-spec.md §B.

So the feed is specified here as an interface and mocked behind it, mirroring
get_pp_client():

    ScanFeed (Protocol)
    ├── MockScanFeed        ← demo: driven by the dev trigger panel
    └── <WmsScanFeed>       ← future: a PP depot API or the courier's WMS

The swap is one config flag (SCAN_FEED_USE_MOCK), and no consumer changes.

The feed is deliberately PULL-shaped, not push-shaped: a real WMS integration
would be polled exactly like PP is, so a push interface would not survive the
swap. MockScanFeed holds a staged script that the dev panel writes and poll_scans
reads back.

Layering: integrations → config, mock_state. Never imports from api/ or orchestration/.
"""

import enum
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from app.core.config import settings
from app.integrations.mock_state import build_key, get_mock_state_store

logger = logging.getLogger(__name__)

# Redis key kind for scan state, keeping it distinct from staged PP state.
_SCAN_KEY_KIND = "scan"


class ScanDirection(str, enum.Enum):
    """Which way through the warehouse door the parcel went.

    Deliberately NOT added to db/models/enums.py: this is the feed's vocabulary,
    it is never persisted as a column, and enums.py is read by every branch.
    """

    OUT = "out"   # scanned onto the truck at a pickup stop  → Parcel.pp_scan_out_at
    IN = "in"     # scanned off the truck at a delivery stop → Parcel.pp_scan_in_at


@dataclass(frozen=True)
class ScanEvent:
    """One barcode scanned at one stop, in one direction.

    Frozen because an observed scan is evidence: nothing downstream may edit it
    in place. `stop_reference` and `consignment_reference` are strings rather
    than UUIDs on purpose — a real WMS keys on a waybill number and a depot code,
    not on FreightProof's primary keys, and the interface has to survive that.
    """

    barcode: str
    direction: ScanDirection
    scanned_at: datetime
    consignment_reference: str
    stop_reference: str


class ScanFeed(Protocol):
    """The contract orchestration depends on. Implementations are swapped by config."""

    async def poll_scans(
        self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> list[ScanEvent]:
        """Return every scan the warehouse has recorded for this consignment at this stop."""
        ...


class MockScanFeed:
    """Redis-backed stub — no warehouse. SCAN_FEED_USE_MOCK=True selects it.

    stage_scans() is the simulated warehouse doing its job; it is called only by
    the dev trigger panel. poll_scans() is the production read path and is all
    that orchestration ever touches.
    """

    def _key(self, consignment_reference: str, stop_reference: str, direction: ScanDirection) -> str:
        return build_key(_SCAN_KEY_KIND, consignment_reference, stop_reference, direction.value)

    async def stage_scans(
        self, *, consignment_reference: str, stop_reference: str,
        direction: ScanDirection, barcodes: list[str],
    ) -> None:
        """Record what the warehouse is about to report. Replaces any prior staging.

        Replace rather than append: re-staging is how a demo is corrected after a
        mis-click, and an appending store would silently accumulate barcodes
        across attempts and produce a discrepancy nobody triggered.
        """
        key = self._key(consignment_reference, stop_reference, direction)
        await get_mock_state_store().set_json(
            key,
            {
                "barcodes": barcodes,
                "scanned_at": datetime.now(UTC).isoformat(),
            },
        )
        logger.info(
            "MockScanFeed staged %d barcode(s) consignment=%s stop=%s direction=%s",
            len(barcodes), consignment_reference, stop_reference, direction.value,
        )

    async def poll_scans(
        self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> list[ScanEvent]:
        key = self._key(consignment_reference, stop_reference, direction)
        staged = await get_mock_state_store().get_json(key)
        if staged is None:
            return []

        scanned_at = datetime.fromisoformat(staged["scanned_at"])
        barcodes: list[str] = staged["barcodes"]
        return [
            ScanEvent(
                barcode=barcode,
                direction=direction,
                scanned_at=scanned_at,
                consignment_reference=consignment_reference,
                stop_reference=stop_reference,
            )
            for barcode in barcodes
        ]


def get_scan_feed() -> ScanFeed:
    """Return the configured scan feed. Mirrors get_pp_client().

    Callers depend on this factory rather than instantiating a feed directly, so
    mock/real selection stays centralised in config.
    """
    if settings.SCAN_FEED_USE_MOCK:
        return MockScanFeed()
    # No live warehouse feed exists: PP exposes no scan endpoint and we hold no
    # depot account. Raising is the honest behaviour — silently falling back to
    # the mock would let a production deployment believe it had real scan data.
    raise NotImplementedError(
        "No live warehouse scan feed is implemented — set SCAN_FEED_USE_MOCK=true"
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && pytest tests/unit/test_scan_feed.py -v`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/integrations/scan_feed.py backend/tests/unit/test_scan_feed.py
git commit -m "feat(integrations): ScanFeed protocol and Redis-backed MockScanFeed"
```

---

## Task 4: Scan reconciliation service — happy path

This is the real consumer. It is production code; the dev panel is only one caller of it.

**Files:**
- Create: `backend/app/orchestration/scan_service.py`
- Test: `backend/tests/unit/test_scan_service.py`

Note on test placement: `CLAUDE.md` puts DB-free logic in `unit/`, but these tests need real `Consignment`/`Parcel` rows, so they use the `db_session` fixture and skip automatically when `TEST_DATABASE_URL` is unset. That matches the existing `tests/unit/test_consignment_service.py`, which does the same — follow that precedent.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_scan_service.py`:

```python
"""Unit tests for scan reconciliation.

Uses the db_session fixture (skips without TEST_DATABASE_URL), matching
test_consignment_service.py — the service's whole job is comparing DB rows
against feed events, so a DB-free test would assert nothing meaningful.
"""

import uuid
from typing import Any

import pytest

from app.db.models.enums import (
    ExceptionSource, ExceptionType, IdvsStatus, OrganizationType, ParcelStatus,
    TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import MockScanFeed, ScanDirection
from app.orchestration import scan_service
from sqlalchemy import select


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


@pytest.fixture
async def seeded(db_session):
    """A one-stop trip with one 3-parcel consignment picked up at that stop."""
    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    precinct = Precinct(
        id=uuid.uuid4(), name="Origin", principal_organization_id=org.id,
        latitude="0", longitude="0",
    )
    db_session.add_all([user, driver, horse, precinct])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY001",
        parcel_count_expected=3, pickup_stop_id=stop.id, delivery_stop_id=stop.id,
    )
    db_session.add(consignment)
    await db_session.flush()

    barcodes = ["WAY0010001", "WAY0010002", "WAY0010003"]
    for barcode in barcodes:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id,
            barcode=barcode, status=ParcelStatus.PENDING,
        ))
    await db_session.flush()

    return {"trip": trip, "stop": stop, "consignment": consignment, "barcodes": barcodes}


async def test_full_scan_out_stamps_every_parcel(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"],
    )

    result = await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    parcels = (await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
    )).scalars().all()
    assert all(p.pp_scan_out_at is not None for p in parcels)
    assert all(p.status == ParcelStatus.SCANNED_OUT for p in parcels)
    assert result.consignments[0].missing_barcodes == []
    assert result.consignments[0].unexpected_barcodes == []


async def test_full_scan_out_raises_no_exception(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"],
    )

    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    exceptions = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalars().all()
    assert exceptions == []


async def test_scan_in_stamps_the_in_column_not_the_out_column(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.IN, barcodes=seeded["barcodes"],
    )

    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.IN,
    )

    parcels = (await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
    )).scalars().all()
    assert all(p.pp_scan_in_at is not None for p in parcels)
    assert all(p.pp_scan_out_at is None for p in parcels)
    assert all(p.status == ParcelStatus.SCANNED_IN for p in parcels)


async def test_nothing_staged_leaves_parcels_untouched(db_session, store, seeded):
    result = await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    parcels = (await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
    )).scalars().all()
    assert all(p.pp_scan_out_at is None for p in parcels)
    assert result.consignments[0].observed_count == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pytest tests/unit/test_scan_service.py -v`
Expected: FAIL — `ImportError: cannot import name 'scan_service' from 'app.orchestration'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/orchestration/scan_service.py`:

```python
"""Warehouse scan reconciliation — expected set vs observed set, per stop.

This is production code. The dev trigger panel is one caller; a Celery poll against
a real WMS feed would be another, and neither changes what happens here.

The expected set is Parcel Perfect's tracks[], already persisted as Parcel rows and
partitioned per stop by Consignment.pickup_stop_id / delivery_stop_id (FP-112). The
observed set comes from the ScanFeed. Any difference between them is an evidence
event, scoped to the consignment and the stop so a multi-client trip's evidence can
be cut per client (v7 §6.1).

This module is the first writer of Parcel.pp_scan_out_at / pp_scan_in_at and the
first writer of TripException.consignment_id / trip_stop_id — both documented in
the models as existing but unpopulated.

Layering: orchestration → integrations, db. Never imports from api/.
"""

import logging
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import (
    ExceptionSeverity, ExceptionSource, ExceptionType, ParcelStatus,
)
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.integrations.scan_feed import ScanDirection, ScanEvent, get_scan_feed

logger = logging.getLogger(__name__)

# A discrepancy is a warning, not a critical: the exception_service's critical set
# is seals and panic buttons — events that stop a trip. A count difference at the
# door is recorded and reviewed, it does not halt anything (FreightProof records,
# it does not operate).
_DISCREPANCY_SEVERITY = ExceptionSeverity.WARNING

# The warehouse scanned it, not a human in our system, so the source is the system.
_DISCREPANCY_SOURCE = ExceptionSource.SYSTEM


@dataclass(frozen=True)
class ConsignmentScanResult:
    """Reconciliation outcome for one consignment at one stop."""

    consignment_id: uuid.UUID
    parcel_perfect_reference: str
    expected_count: int
    observed_count: int
    matched_barcodes: list[str] = field(default_factory=list)
    missing_barcodes: list[str] = field(default_factory=list)
    unexpected_barcodes: list[str] = field(default_factory=list)
    exception_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass(frozen=True)
class ScanIngestResult:
    """Everything that happened across every consignment at this stop."""

    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection
    consignments: list[ConsignmentScanResult]


async def load_consignments_at_stop(
    db: AsyncSession, *, trip_id: uuid.UUID, trip_stop_id: uuid.UUID, direction: ScanDirection,
) -> list[Consignment]:
    """Consignments whose pickup (OUT) or delivery (IN) stop is this stop.

    Public because the dev trigger endpoint needs the same resolution to know
    which consignments to stage barcodes for — reaching into a private helper
    across modules would be a worse coupling than exposing the real one.

    Scoping by direction is what makes a cross-dock trip work: at the middle stop
    of a CPT→BFN→JHB run, some consignments are being dropped and others collected,
    and reconciling all of them against one scan would guarantee a false mismatch.
    """
    stop_column = (
        Consignment.pickup_stop_id if direction is ScanDirection.OUT
        else Consignment.delivery_stop_id
    )
    result = await db.execute(
        select(Consignment)
        .where(Consignment.trip_id == trip_id, stop_column == trip_stop_id)
        .order_by(Consignment.created_at)
    )
    return list(result.scalars().all())


async def ingest_scans(
    db: AsyncSession, *, trip_id: uuid.UUID, trip_stop_id: uuid.UUID, direction: ScanDirection,
) -> ScanIngestResult:
    """Pull scans from the feed for this stop and reconcile them against the manifest.

    Writes Parcel.pp_scan_out_at / pp_scan_in_at and the matching ParcelStatus, and
    raises a TripException per consignment that has missing or unexpected barcodes.

    Idempotent: an already-stamped parcel keeps its original timestamp (the first
    scan is the evidence), and an identical unresolved discrepancy is not raised
    twice — a repeated poll against an unchanged feed must not manufacture rows.

    The caller is responsible for db.commit().

    Raises:
        ResourceNotFoundError: the trip or the stop does not exist, or the stop
        does not belong to the trip.
    """
    trip = (await db.execute(select(Trip).where(Trip.id == trip_id))).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    stop = (await db.execute(
        select(TripStop).where(TripStop.id == trip_stop_id, TripStop.trip_id == trip_id)
    )).scalar_one_or_none()
    if stop is None:
        raise ResourceNotFoundError("TripStop", str(trip_stop_id))

    feed = get_scan_feed()
    consignments = await load_consignments_at_stop(
        db, trip_id=trip_id, trip_stop_id=trip_stop_id, direction=direction,
    )
    results: list[ConsignmentScanResult] = []

    for consignment in consignments:
        events: list[ScanEvent] = await feed.poll_scans(
            consignment_reference=consignment.parcel_perfect_reference,
            stop_reference=str(trip_stop_id),
            direction=direction,
        )
        results.append(
            await _reconcile_consignment(
                db, trip_id=trip_id, trip_stop_id=trip_stop_id,
                consignment=consignment, events=events, direction=direction,
            )
        )

    await db.flush()
    logger.info(
        "ingest_scans trip=%s stop=%s direction=%s consignments=%d",
        trip_id, trip_stop_id, direction.value, len(results),
    )
    return ScanIngestResult(
        trip_id=trip_id, trip_stop_id=trip_stop_id, direction=direction, consignments=results,
    )


async def _reconcile_consignment(
    db: AsyncSession, *, trip_id: uuid.UUID, trip_stop_id: uuid.UUID,
    consignment: Consignment, events: list[ScanEvent], direction: ScanDirection,
) -> ConsignmentScanResult:
    """Compare one consignment's expected parcels against what was scanned."""
    parcels = list((await db.execute(
        select(Parcel).where(Parcel.consignment_id == consignment.id)
    )).scalars().all())
    parcels_by_barcode: dict[str, Parcel] = {p.barcode: p for p in parcels}

    observed_barcodes = [e.barcode for e in events]
    scanned_at_by_barcode = {e.barcode: e.scanned_at for e in events}

    matched = [b for b in observed_barcodes if b in parcels_by_barcode]
    unexpected = [b for b in observed_barcodes if b not in parcels_by_barcode]
    missing = [p.barcode for p in parcels if p.barcode not in set(observed_barcodes)]

    for barcode in matched:
        parcel = parcels_by_barcode[barcode]
        _stamp_parcel(parcel, direction=direction, scanned_at=scanned_at_by_barcode[barcode])

    exception_ids: list[uuid.UUID] = []
    if events and (missing or unexpected):
        exception_id = await _raise_discrepancy(
            db, trip_id=trip_id, trip_stop_id=trip_stop_id, consignment=consignment,
            direction=direction, missing=missing, unexpected=unexpected,
            expected_count=len(parcels), observed_count=len(observed_barcodes),
        )
        if exception_id is not None:
            exception_ids.append(exception_id)

    return ConsignmentScanResult(
        consignment_id=consignment.id,
        parcel_perfect_reference=consignment.parcel_perfect_reference,
        expected_count=len(parcels),
        observed_count=len(observed_barcodes),
        matched_barcodes=matched,
        missing_barcodes=missing,
        unexpected_barcodes=unexpected,
        exception_ids=exception_ids,
    )


def _stamp_parcel(parcel: Parcel, *, direction: ScanDirection, scanned_at) -> None:
    """Record the scan on the parcel, first-write-wins.

    An already-stamped parcel keeps its original timestamp: the first scan is the
    evidence, and a replayed poll must not rewrite when it happened.
    """
    if direction is ScanDirection.OUT:
        if parcel.pp_scan_out_at is None:
            parcel.pp_scan_out_at = scanned_at
            parcel.status = ParcelStatus.SCANNED_OUT
    else:
        if parcel.pp_scan_in_at is None:
            parcel.pp_scan_in_at = scanned_at
            parcel.status = ParcelStatus.SCANNED_IN


async def _raise_discrepancy(
    db: AsyncSession, *, trip_id: uuid.UUID, trip_stop_id: uuid.UUID,
    consignment: Consignment, direction: ScanDirection,
    missing: list[str], unexpected: list[str],
    expected_count: int, observed_count: int,
) -> uuid.UUID | None:
    """Record a scan discrepancy, unless an identical unresolved one already exists.

    Returns the new exception's id, or None when a duplicate was suppressed.

    An unexpected barcode reuses PARCEL_COUNT_MISMATCH rather than introducing a new
    ExceptionType: db/models/enums.py is read by every branch and mirrored by the
    dispatcher's TripContext.tsx, so a new value is a coordination cost this does not
    need. The barcode itself is named in the description, so nothing is lost.
    """
    description = _build_discrepancy_description(
        reference=consignment.parcel_perfect_reference, direction=direction,
        missing=missing, unexpected=unexpected,
        expected_count=expected_count, observed_count=observed_count,
    )

    # Suppress an identical unresolved duplicate. A repeated poll against an
    # unchanged feed is a normal occurrence, and each repeat manufacturing a new
    # exception row would bury the real one under noise on the dispatcher's list.
    existing = (await db.execute(
        select(TripException.id).where(
            TripException.trip_id == trip_id,
            TripException.consignment_id == consignment.id,
            TripException.trip_stop_id == trip_stop_id,
            TripException.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH,
            TripException.description == description,
            TripException.resolved.is_(False),
        )
    )).scalar_one_or_none()
    if existing is not None:
        logger.info(
            "Suppressed duplicate scan discrepancy for consignment=%s stop=%s",
            consignment.id, trip_stop_id,
        )
        return None

    exception = TripException(
        id=uuid.uuid4(),
        trip_id=trip_id,
        consignment_id=consignment.id,
        trip_stop_id=trip_stop_id,
        exception_type=ExceptionType.PARCEL_COUNT_MISMATCH,
        source=_DISCREPANCY_SOURCE,
        severity=_DISCREPANCY_SEVERITY,
        description=description,
    )
    db.add(exception)
    logger.warning("Scan discrepancy recorded: %s", description)
    return exception.id


def _build_discrepancy_description(
    *, reference: str, direction: ScanDirection, missing: list[str], unexpected: list[str],
    expected_count: int, observed_count: int,
) -> str:
    """Human-readable discrepancy summary. Deterministic — duplicate suppression
    above compares on this exact string."""
    action = "scan-out" if direction is ScanDirection.OUT else "scan-in"
    parts = [
        f"Warehouse {action} discrepancy on waybill {reference}: "
        f"expected {expected_count} parcel(s), scanned {observed_count}."
    ]
    if missing:
        parts.append(f"Not scanned: {', '.join(sorted(missing))}.")
    if unexpected:
        parts.append(f"Scanned but not on the manifest: {', '.join(sorted(unexpected))}.")
    return " ".join(parts)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && pytest tests/unit/test_scan_service.py -v`
Expected: PASS, 4 tests. (If `TEST_DATABASE_URL` is unset they SKIP — set it before continuing, or the rest of this plan cannot be verified.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestration/scan_service.py backend/tests/unit/test_scan_service.py
git commit -m "feat(orchestration): warehouse scan reconciliation per stop"
```

---

## Task 5: Reconciliation — the discrepancy paths

The partial scan is the most important behaviour in this whole plan. A demo that only shows the happy path shows nothing worth grading.

**Files:**
- Test: `backend/tests/unit/test_scan_service.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_scan_service.py`:

```python
async def test_partial_scan_raises_a_scoped_exception(db_session, store, seeded):
    """The discrepancy path — 2 of 3 parcels scanned."""
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"][:2],
    )

    result = await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    exception = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalar_one()
    assert exception.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH
    assert exception.consignment_id == seeded["consignment"].id
    assert exception.trip_stop_id == seeded["stop"].id
    assert exception.source == ExceptionSource.SYSTEM
    assert result.consignments[0].missing_barcodes == [seeded["barcodes"][2]]


async def test_partial_scan_stamps_only_the_scanned_parcels(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"][:2],
    )

    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    parcels = {
        p.barcode: p for p in (await db_session.execute(
            select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
        )).scalars().all()
    }
    assert parcels[seeded["barcodes"][0]].pp_scan_out_at is not None
    assert parcels[seeded["barcodes"][2]].pp_scan_out_at is None
    assert parcels[seeded["barcodes"][2]].status == ParcelStatus.PENDING


async def test_unexpected_barcode_raises_an_exception_naming_it(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=[*seeded["barcodes"], "STRANGER-99"],
    )

    result = await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    exception = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalar_one()
    assert "STRANGER-99" in exception.description
    assert result.consignments[0].unexpected_barcodes == ["STRANGER-99"]


async def test_unexpected_barcode_creates_no_parcel_row(db_session, store, seeded):
    """A barcode not on the manifest is not this consignment's parcel — we record
    that we saw it, we do not adopt it."""
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=[*seeded["barcodes"], "STRANGER-99"],
    )

    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    parcels = (await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
    )).scalars().all()
    assert len(parcels) == 3
    assert "STRANGER-99" not in {p.barcode for p in parcels}


async def test_repeated_ingest_does_not_duplicate_the_exception(db_session, store, seeded):
    """A real feed is polled repeatedly; an unchanged feed must not manufacture rows."""
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"][:2],
    )

    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )
    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    exceptions = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalars().all()
    assert len(exceptions) == 1


async def test_repeated_ingest_keeps_the_first_scan_timestamp(db_session, store, seeded):
    """The first scan is the evidence — a replay must not rewrite when it happened."""
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"],
    )
    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )
    first = (await db_session.execute(
        select(Parcel).where(Parcel.barcode == seeded["barcodes"][0])
    )).scalar_one().pp_scan_out_at

    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"],
    )
    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    second = (await db_session.execute(
        select(Parcel).where(Parcel.barcode == seeded["barcodes"][0])
    )).scalar_one().pp_scan_out_at
    assert first == second


async def test_unknown_trip_raises_not_found(db_session, store, seeded):
    from app.core.exceptions import ResourceNotFoundError

    with pytest.raises(ResourceNotFoundError):
        await scan_service.ingest_scans(
            db_session, trip_id=uuid.uuid4(), trip_stop_id=seeded["stop"].id,
            direction=ScanDirection.OUT,
        )


async def test_stop_belonging_to_another_trip_raises_not_found(db_session, store, seeded):
    from app.core.exceptions import ResourceNotFoundError

    with pytest.raises(ResourceNotFoundError):
        await scan_service.ingest_scans(
            db_session, trip_id=seeded["trip"].id, trip_stop_id=uuid.uuid4(),
            direction=ScanDirection.OUT,
        )
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && pytest tests/unit/test_scan_service.py -v`
Expected: PASS, 12 tests total. Task 4's implementation already satisfies these — if any fail, fix `scan_service.py`, not the test.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/unit/test_scan_service.py
git commit -m "test(orchestration): partial-scan, unexpected-barcode and replay coverage"
```

---

## Task 6: PP mock override layer

This is what lets the Celery worker — a separate process — see a staged waybill edit.

**Files:**
- Modify: `backend/app/integrations/parcel_perfect.py`
- Test: `backend/tests/unit/test_pp_mock_overrides.py`

⚠ `parcel_perfect.py` is covered by `tests/unit/test_pp_mock.py`, `tests/unit/test_parcel_perfect_client.py` and `tests/unit/test_seed_fixtures.py`. The override lookup is gated on `DEV_PANEL_ENABLED`, which defaults to `False`, so those suites must run unchanged with no Redis present. Confirm that in Step 5 rather than assuming it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_pp_mock_overrides.py`:

```python
"""Unit tests for the dev-panel override layer on the PP mock.

Overrides exist so a staged waybill change is visible to the Celery worker, which
is a different process from the API and cannot see module-level mutation.
"""

from typing import Any

import pytest

from app.core.config import settings
from app.integrations import parcel_perfect as pp_module
from app.integrations.parcel_perfect import MockParcelPerfectClient, PPUnsupportedError


class FakeStore:
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
def dev_panel_on(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    fake = FakeStore()
    monkeypatch.setattr(pp_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", True)
    monkeypatch.setattr(settings, "PP_USE_MOCK", True)
    return fake


async def test_waybill_is_unchanged_when_nothing_staged(dev_panel_on):
    client = MockParcelPerfectClient()

    waybill = await client.get_single_waybill("WAY001")

    assert waybill.details.poddate == ""
    assert waybill.details.failtype is None


async def test_staged_manifest_number_is_applied(dev_panel_on):
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("WAY001", manifest=999)

    waybill = await client.get_single_waybill("WAY001")

    assert waybill.details.manifest == 999


async def test_staged_poddate_is_applied(dev_panel_on):
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("WAY001", poddate="04.08.2026")

    waybill = await client.get_single_waybill("WAY001")

    assert waybill.details.poddate == "04.08.2026"


async def test_staged_failtype_is_applied(dev_panel_on):
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("WAY001", failtype="Receiver not home")

    waybill = await client.get_single_waybill("WAY001")

    assert waybill.details.failtype == "Receiver not home"


async def test_staged_parcel_count_grows_the_track_list(dev_panel_on):
    """Reproduces the verified 2026-08-04 finding: a portal edit grew tracks[]
    from 2 to 27 barcodes with no version, timestamp or audit field."""
    client = MockParcelPerfectClient()
    original = await client.get_single_waybill("WAY001")
    assert len(original.tracks) == 5

    await client.stage_waybill_override("WAY001", parcel_count=27)
    edited = await client.get_single_waybill("WAY001")

    assert len(edited.tracks) == 27
    assert edited.details.pieces == 27


async def test_overrides_are_ignored_when_the_dev_panel_is_off(
    monkeypatch: pytest.MonkeyPatch, dev_panel_on
):
    """The override lookup must not run — and must not touch Redis — in normal operation."""
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("WAY001", manifest=999)
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", False)

    waybill = await client.get_single_waybill("WAY001")

    assert waybill.details.manifest == 69


async def test_staging_against_live_pp_is_refused(monkeypatch: pytest.MonkeyPatch, dev_panel_on):
    """Staging a fixture change while pointed at live PP is a bug, not a no-op."""
    monkeypatch.setattr(settings, "PP_USE_MOCK", False)
    client = MockParcelPerfectClient()

    with pytest.raises(PPUnsupportedError):
        await client.stage_waybill_override("WAY001", manifest=999)


async def test_staging_an_unknown_waybill_raises_not_found(dev_panel_on):
    from app.integrations.parcel_perfect import PPWaybillNotFoundError

    client = MockParcelPerfectClient()

    with pytest.raises(PPWaybillNotFoundError):
        await client.stage_waybill_override("NOPE-123", manifest=1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pytest tests/unit/test_pp_mock_overrides.py -v`
Expected: FAIL — `AttributeError: 'MockParcelPerfectClient' object has no attribute 'stage_waybill_override'`

- [ ] **Step 3: Add the override layer**

In `backend/app/integrations/parcel_perfect.py`, add to the imports at the top (after `from app.core.config import settings`):

```python
from app.integrations.mock_state import build_key, get_mock_state_store
```

Then replace the whole `MockParcelPerfectClient` class (currently lines 515–542) with:

```python
# Redis key kind for staged PP waybill overrides, distinct from staged scan state.
_PP_KEY_KIND = "pp"


class MockParcelPerfectClient:
    """Fixture-backed stub — no network. PP_USE_MOCK=True selects it via get_pp_client().

    Unknown references raise PPWaybillNotFoundError, matching the real client, so
    the fail-closed 422 path behaves identically in dev/CI and against live PP.

    When the dev trigger panel is enabled, a Redis-held override layer is applied
    on top of each fixture. This exists because PP waybills were verified to be
    mutable after creation (spec §B2c: a portal edit changed 68 fields in one
    10-second poll interval, growing tracks[] from 2 to 27 barcodes), and the
    Celery poll that would observe such a change runs in a different process from
    the API — so a module-level dict mutation would be invisible to it.

    The override lookup is gated on DEV_PANEL_ENABLED so that normal operation
    never touches Redis and every existing PP test runs unchanged.
    """

    supports_manifest_lookup: bool = True

    def _override_key(self, waybill_number: str) -> str:
        return build_key(_PP_KEY_KIND, waybill_number)

    async def stage_waybill_override(
        self,
        waybill_number: str,
        *,
        manifest: Optional[int] = None,
        poddate: Optional[str] = None,
        failtype: Optional[str] = None,
        parcel_count: Optional[int] = None,
    ) -> None:
        """Stage a change to a fixture waybill, as if edited in the PP portal.

        Only supplied fields are staged; the rest of the fixture is untouched.
        Staging is additive across calls, so a manifest number set earlier survives
        a later poddate change — that is how a real waybill accumulates state.

        Raises:
            PPUnsupportedError: PP_USE_MOCK is false. Staging a fixture change
                while pointed at live PP is a bug, and silently ignoring it would
                make a demo look like it worked when nothing happened.
            PPWaybillNotFoundError: the reference is not in the fixture library.
        """
        if not settings.PP_USE_MOCK:
            raise PPUnsupportedError(
                "Cannot stage a waybill override while PP_USE_MOCK is false"
            )
        if waybill_number not in MOCK_WAYBILLS:
            raise PPWaybillNotFoundError(waybill_number)

        key = self._override_key(waybill_number)
        store = get_mock_state_store()
        current = await store.get_json(key) or {}
        staged = {
            **current,
            **{
                field: value
                for field, value in (
                    ("manifest", manifest),
                    ("poddate", poddate),
                    ("failtype", failtype),
                    ("parcel_count", parcel_count),
                )
                if value is not None
            },
        }
        await store.set_json(key, staged)
        logger.info("Staged PP override for waybill=%s fields=%s", waybill_number, sorted(staged))

    async def _apply_overrides(self, waybill: PPWaybillResponse) -> PPWaybillResponse:
        """Apply any staged override to a fixture copy. No-op when none is staged."""
        if not settings.DEV_PANEL_ENABLED:
            return waybill

        staged = await get_mock_state_store().get_json(
            self._override_key(waybill.details.waybill)
        )
        if not staged:
            return waybill

        if (manifest := staged.get("manifest")) is not None:
            waybill.details.manifest = int(manifest)
        if (poddate := staged.get("poddate")) is not None:
            waybill.details.poddate = str(poddate)
        if (failtype := staged.get("failtype")) is not None:
            waybill.details.failtype = str(failtype)
        if (parcel_count := staged.get("parcel_count")) is not None:
            # Regenerate tracks[] to the new size, keeping the fixture's barcode
            # format. This reproduces the real failure mode: the expected parcel
            # set — the baseline every reconciliation is measured against — grows
            # with no version, timestamp or audit field on the waybill.
            count = int(parcel_count)
            reference = waybill.details.waybill
            waybill.tracks = [
                PPTrack(trackno=f"{reference}{n:04d}", parcelno=n, item=1)
                for n in range(1, count + 1)
            ]
            waybill.details.pieces = count

        return waybill

    async def get_single_waybill(self, waybill_number: str) -> PPWaybillResponse:
        """Look up the waybill in the fixture library; raise if unregistered."""
        logger.info("MockParcelPerfectClient.get_single_waybill waybill=%s", waybill_number)
        try:
            # Deep copy: callers may mutate results; module-level fixtures must stay pristine.
            waybill = copy.deepcopy(MOCK_WAYBILLS[waybill_number])
        except KeyError as exc:
            raise PPWaybillNotFoundError(waybill_number) from exc
        return await self._apply_overrides(waybill)

    async def get_waybills_by_manifest(self, manifest_number: int) -> list[PPWaybillResponse]:
        """ASPIRATIONAL — PP v28 has no such endpoint (ask #1, July visit).
        Mock-only so the wizard can demo manifest-keyed trip creation."""
        # Deep copy: callers may mutate results; module-level fixtures must stay pristine.
        return copy.deepcopy(
            sorted(
                (w for w in MOCK_WAYBILLS.values() if w.details.manifest == manifest_number),
                key=lambda w: w.details.waybill,
            )
        )
```

- [ ] **Step 4: Run the new test**

Run: `cd backend && pytest tests/unit/test_pp_mock_overrides.py -v`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify the existing PP suites are unaffected**

Run: `cd backend && pytest tests/unit/test_pp_mock.py tests/unit/test_parcel_perfect_client.py tests/unit/test_seed_fixtures.py tests/unit/test_pp_task.py tests/unit/test_consignment_service.py -v`
Expected: PASS, same counts as before this task. If any fail, the gate on `DEV_PANEL_ENABLED` is wrong — fix that rather than editing those tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/integrations/parcel_perfect.py backend/tests/unit/test_pp_mock_overrides.py
git commit -m "feat(integrations): Redis-backed PP waybill overrides for the dev panel"
```

---

## Task 7: Dev endpoint schemas

**Files:**
- Create: `backend/app/schemas/dev.py`

- [ ] **Step 1: Write the schemas**

Create `backend/app/schemas/dev.py`:

```python
"""Pydantic v2 models for the dev trigger panel.

Response models mirror the orchestration result dataclasses rather than exposing
ORM rows, so the panel's contract is explicit and does not drift with the schema.
"""

import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.enums import ExceptionType
from app.integrations.scan_feed import ScanDirection

# A staged scan cannot exceed this many barcodes. Purely a guard against a typo in
# the panel turning into thousands of rows; no real consignment approaches it.
MAX_STAGED_BARCODES = 500


class DevTripStop(BaseModel):
    """One stop on a trip, with the consignments picked up and dropped there."""

    model_config = ConfigDict(from_attributes=True)

    trip_stop_id: uuid.UUID
    sequence: int
    precinct_name: str
    pickup_consignment_references: list[str]
    delivery_consignment_references: list[str]


class DevTripSummary(BaseModel):
    """Everything the panel needs to populate its pickers for one trip."""

    trip_id: uuid.UUID
    trip_reference: str
    status: str
    current_phase: Optional[str]
    stops: list[DevTripStop]


class ScanTriggerRequest(BaseModel):
    """Stage a warehouse scan, then ingest it through the real reconciliation path.

    Exactly one of `barcodes` or `parcel_count` must be supplied:
      - `parcel_count`: scan the first N expected barcodes (N < expected = partial).
      - `barcodes`: scan this literal list, which may include barcodes that are not
        on the manifest at all.
    """

    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection
    parcel_count: Optional[int] = Field(default=None, ge=0)
    barcodes: Optional[list[str]] = Field(default=None, max_length=MAX_STAGED_BARCODES)

    @field_validator("barcodes")
    @classmethod
    def reject_blank_barcodes(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        if v is not None and any(not b.strip() for b in v):
            raise ValueError("Barcodes must not be blank")
        return v


class ConsignmentScanResultRead(BaseModel):
    """Reconciliation outcome for one consignment, as returned to the panel."""

    consignment_id: uuid.UUID
    parcel_perfect_reference: str
    expected_count: int
    observed_count: int
    matched_barcodes: list[str]
    missing_barcodes: list[str]
    unexpected_barcodes: list[str]
    exception_ids: list[uuid.UUID]


class ScanTriggerResponse(BaseModel):
    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection
    consignments: list[ConsignmentScanResultRead]


class PpTriggerRequest(BaseModel):
    """Stage a change to a mock waybill, as if someone edited it in the PP portal.

    Every field is optional; supplied fields are staged and the rest are untouched.
    `parcel_count` reproduces the verified mid-trip edit (spec §B2c) that grew a
    waybill's tracks[] from 2 to 27 barcodes.
    """

    trip_id: uuid.UUID
    parcel_perfect_reference: str
    manifest: Optional[int] = Field(default=None, ge=0)
    poddate: Optional[str] = Field(default=None, max_length=32)
    failtype: Optional[str] = Field(default=None, max_length=255)
    parcel_count: Optional[int] = Field(default=None, ge=0, le=MAX_STAGED_BARCODES)


class PpTriggerResponse(BaseModel):
    """What the consignment looks like after the real PP sync ran."""

    consignment_id: uuid.UUID
    parcel_perfect_reference: str
    parcel_count_expected: Optional[int]
    pp_manifest_number: Optional[int]
    poddate: str
    failtype: Optional[str]
    warning: Optional[str]


class ExceptionTriggerRequest(BaseModel):
    """Raise an exception through the real exception service."""

    trip_id: uuid.UUID
    exception_type: ExceptionType
    description: str = Field(min_length=1, max_length=1000)


class ExceptionTriggerResponse(BaseModel):
    exception_id: uuid.UUID
    trip_id: uuid.UUID
    exception_type: ExceptionType
    severity: str
    description: str


class FlushMockStateResponse(BaseModel):
    """Result of clearing staged mock state. Evidence in Postgres is untouched."""

    keys_deleted: int
```

- [ ] **Step 2: Verify the module imports**

Run: `cd backend && python -c "from app.schemas.dev import ScanTriggerRequest, PpTriggerRequest; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/dev.py
git commit -m "feat(api): Pydantic schemas for the dev trigger panel"
```

---

## Task 8: Dev trigger router

**Files:**
- Create: `backend/app/api/v1/endpoints/dev_triggers.py`
- Modify: `backend/app/main.py` (⚠ shared file)

- [ ] **Step 1: Write the router**

Create `backend/app/api/v1/endpoints/dev_triggers.py`:

```python
"""Dev-only trigger endpoints — simulate the parts of the world we cannot yet reach.

Registered by main.py ONLY when dev_panel_enabled() is true. On an evidence
platform, an endpoint that can fabricate an exception must be unreachable in
production, so two independent conditions gate it and both default to closed.

THE PRINCIPLE THIS FILE EXISTS TO UPHOLD: every trigger drives a MOCK's state and
then calls the SAME orchestration function the real flow calls. No endpoint here
writes to the database directly. A button that INSERTs a row proves only that the
button works; a button that drives the real path proves the product works.

  scan triggers      → MockScanFeed.stage_scans  → scan_service.ingest_scans
  PP triggers        → MockParcelPerfectClient.stage_waybill_override
                                                 → consignment_service.fetch_and_sync_consignment
  exception triggers → exception_service.raise_exception
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.organisations import Precinct
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.session import get_db
from app.integrations.mock_state import get_mock_state_store
from app.integrations.parcel_perfect import (
    MockParcelPerfectClient, PPUnsupportedError, PPWaybillNotFoundError, get_pp_client,
)
from app.integrations.scan_feed import MockScanFeed, ScanDirection, get_scan_feed
from app.orchestration import consignment_service, exception_service, scan_service
from app.schemas.dev import (
    ConsignmentScanResultRead, DevTripStop, DevTripSummary, ExceptionTriggerRequest,
    ExceptionTriggerResponse, FlushMockStateResponse, PpTriggerRequest, PpTriggerResponse,
    ScanTriggerRequest, ScanTriggerResponse,
)
from app.schemas.people import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dev", tags=["dev-triggers"])

# Returned when a trigger is fired against a non-mock feed. Staging state into a
# mock that is not the live implementation would do nothing at all, and a trigger
# that silently does nothing is worse in a demo than one that fails loudly.
_MOCK_REQUIRED_DETAIL = (
    "This trigger requires the mock implementation — check PP_USE_MOCK and SCAN_FEED_USE_MOCK."
)

_PRODUCTION_ENVIRONMENT = "production"


def dev_panel_enabled() -> bool:
    """Whether the dev trigger router should be registered at all.

    Two independent conditions, both defaulting to closed. On an internet-reachable
    demo host a single switch is not enough: ENVIRONMENT is deployment config that
    is easy to get wrong, and DEV_PANEL_ENABLED is an explicit opt-in that has to
    be typed on purpose. Either one being wrong still leaves the panel absent.
    """
    return settings.DEV_PANEL_ENABLED and settings.ENVIRONMENT != _PRODUCTION_ENVIRONMENT


@router.get("/trips", response_model=list[DevTripSummary], summary="Trips and stops for the panel")
async def list_dev_trips(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[DevTripSummary]:
    """Trips with their stops and per-stop consignment references.

    The panel runs on a second device with no trip context of its own, so it needs
    to populate its own pickers.
    """
    trips = list((await db.execute(
        select(Trip)
        .where(Trip.operator_organization_id == current_user.organization_id)
        .order_by(Trip.created_at.desc())
    )).scalars().all())
    if not trips:
        return []

    trip_ids = [t.id for t in trips]
    stops = list((await db.execute(
        select(TripStop, Precinct.name)
        .join(Precinct, Precinct.id == TripStop.precinct_id)
        .where(TripStop.trip_id.in_(trip_ids))
        .order_by(TripStop.sequence)
    )).all())
    consignments = list((await db.execute(
        select(Consignment).where(Consignment.trip_id.in_(trip_ids))
    )).scalars().all())

    summaries: list[DevTripSummary] = []
    for trip in trips:
        trip_stops: list[DevTripStop] = []
        for stop, precinct_name in stops:
            if stop.trip_id != trip.id:
                continue
            trip_stops.append(DevTripStop(
                trip_stop_id=stop.id,
                sequence=stop.sequence,
                precinct_name=precinct_name,
                pickup_consignment_references=[
                    c.parcel_perfect_reference for c in consignments
                    if c.pickup_stop_id == stop.id
                ],
                delivery_consignment_references=[
                    c.parcel_perfect_reference for c in consignments
                    if c.delivery_stop_id == stop.id
                ],
            ))
        summaries.append(DevTripSummary(
            trip_id=trip.id,
            trip_reference=trip.trip_reference,
            status=str(trip.status),
            current_phase=trip.current_phase,
            stops=trip_stops,
        ))
    return summaries


@router.post("/scans", response_model=ScanTriggerResponse, summary="Simulate a warehouse scan")
async def trigger_scan(
    body: ScanTriggerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ScanTriggerResponse:
    """Stage barcodes into the mock feed, then run the real reconciliation.

    Two calls, deliberately: the first is the simulated warehouse doing its job,
    the second is production code that a real WMS poll would call identically.
    """
    feed = get_scan_feed()
    if not isinstance(feed, MockScanFeed):
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        )

    consignments = await scan_service.load_consignments_at_stop(
        db, trip_id=body.trip_id, trip_stop_id=body.trip_stop_id, direction=body.direction,
    )
    if not consignments:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=(
                f"No consignment is {'picked up' if body.direction is ScanDirection.OUT else 'delivered'} "
                f"at stop {body.trip_stop_id} on this trip."
            ),
        )

    for consignment in consignments:
        barcodes = await _resolve_barcodes(db, consignment=consignment, body=body)
        await feed.stage_scans(
            consignment_reference=consignment.parcel_perfect_reference,
            stop_reference=str(body.trip_stop_id),
            direction=body.direction,
            barcodes=barcodes,
        )

    try:
        result = await scan_service.ingest_scans(
            db, trip_id=body.trip_id, trip_stop_id=body.trip_stop_id, direction=body.direction,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    await db.commit()
    return ScanTriggerResponse(
        trip_id=result.trip_id,
        trip_stop_id=result.trip_stop_id,
        direction=result.direction,
        consignments=[
            ConsignmentScanResultRead(
                consignment_id=c.consignment_id,
                parcel_perfect_reference=c.parcel_perfect_reference,
                expected_count=c.expected_count,
                observed_count=c.observed_count,
                matched_barcodes=c.matched_barcodes,
                missing_barcodes=c.missing_barcodes,
                unexpected_barcodes=c.unexpected_barcodes,
                exception_ids=c.exception_ids,
            )
            for c in result.consignments
        ],
    )


async def _resolve_barcodes(
    db: AsyncSession, *, consignment: Consignment, body: ScanTriggerRequest,
) -> list[str]:
    """Work out which barcodes the simulated warehouse reports.

    An explicit list wins (that is how an unexpected barcode is injected).
    Otherwise the first `parcel_count` expected barcodes are scanned, which is the
    partial-scan path; omitting both scans everything.
    """
    expected = [row[0] for row in (await db.execute(
        select(Parcel.barcode)
        .where(Parcel.consignment_id == consignment.id)
        .order_by(Parcel.barcode)
    )).all()]

    if body.barcodes is not None:
        return body.barcodes
    if body.parcel_count is not None:
        return expected[: body.parcel_count]
    return expected


@router.post("/pp/waybill", response_model=PpTriggerResponse, summary="Simulate a PP waybill change")
async def trigger_pp_change(
    body: PpTriggerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PpTriggerResponse:
    """Stage a waybill override, then run the real consignment sync.

    The sync is fetch_and_sync_consignment — unchanged production code. Note that
    it currently overwrites the reconciliation baseline without raising anything
    (spec §B2c); detecting that drift is Stage 5 and deliberately not built here,
    so this trigger demonstrates the gap rather than a fix.
    """
    pp_client = get_pp_client()
    if not isinstance(pp_client, MockParcelPerfectClient):
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        )

    consignment = (await db.execute(
        select(Consignment).where(
            Consignment.trip_id == body.trip_id,
            Consignment.parcel_perfect_reference == body.parcel_perfect_reference,
        )
    )).scalar_one_or_none()
    if consignment is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Consignment {body.parcel_perfect_reference!r} is not on trip {body.trip_id}.",
        )

    try:
        await pp_client.stage_waybill_override(
            body.parcel_perfect_reference,
            manifest=body.manifest,
            poddate=body.poddate,
            failtype=body.failtype,
            parcel_count=body.parcel_count,
        )
    except PPWaybillNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PPUnsupportedError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        ) from exc

    sync_result = await consignment_service.fetch_and_sync_consignment(
        db, body.parcel_perfect_reference, trip_id=body.trip_id,
    )
    await db.commit()

    details = (sync_result.consignment.pp_raw_json or {}).get("details", {})
    return PpTriggerResponse(
        consignment_id=sync_result.consignment.id,
        parcel_perfect_reference=sync_result.consignment.parcel_perfect_reference,
        parcel_count_expected=sync_result.consignment.parcel_count_expected,
        pp_manifest_number=sync_result.consignment.pp_manifest_number,
        poddate=details.get("poddate", ""),
        failtype=details.get("failtype"),
        warning=sync_result.warning,
    )


@router.post("/exceptions", response_model=ExceptionTriggerResponse, summary="Raise an exception")
async def trigger_exception(
    body: ExceptionTriggerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ExceptionTriggerResponse:
    """Raise through exception_service — the same function the driver's panic page calls.

    The driver id is read from the trip rather than supplied, so the service's own
    "are you the assigned driver" check runs for real instead of being bypassed.
    """
    trip = (await db.execute(select(Trip).where(Trip.id == body.trip_id))).scalar_one_or_none()
    if trip is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=f"Trip {body.trip_id} not found.",
        )

    try:
        raised = await exception_service.raise_exception(
            db, trip_id=body.trip_id, driver_id=trip.driver_id,
            exception_type=body.exception_type, description=body.description,
            supporting_artifact_id=None,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    await db.commit()
    return ExceptionTriggerResponse(
        exception_id=raised.id,
        trip_id=body.trip_id,
        exception_type=body.exception_type,
        severity=str(raised.severity),
        description=raised.description,
    )


@router.post("/mock-state/flush", response_model=FlushMockStateResponse,
             summary="Clear staged mock state")
async def flush_mock_state(
    current_user: UserRead = Depends(get_current_dispatcher),
) -> FlushMockStateResponse:
    """Delete every staged mock key. Evidence in PostgreSQL is untouched.

    A POST rather than a DELETE because the dispatcher's typed fetch wrapper has no
    delete verb, and adding one to a shared, separately-tested client for a dev-only
    endpoint is not a trade worth making.
    """
    deleted = await get_mock_state_store().flush()
    logger.info("Dev panel flushed %d mock-state key(s)", deleted)
    return FlushMockStateResponse(keys_deleted=deleted)
```

- [ ] **Step 2: Register the router in main.py**

In `backend/app/main.py`, add to the import block (after the `checkpoints` import line):

```python
from app.api.v1.endpoints.dev_triggers import dev_panel_enabled
from app.api.v1.endpoints.dev_triggers import router as dev_triggers_router
```

Then after the final `app.include_router(pp_router, prefix="/api/v1")` line:

```python
# Dev trigger panel. Registered only when BOTH DEV_PANEL_ENABLED is set and the
# environment is not production — see dev_triggers.dev_panel_enabled(). These
# endpoints can fabricate scans and exceptions, so on an evidence platform they
# must be structurally absent, not merely guarded, in a production deployment.
if dev_panel_enabled():
    app.include_router(dev_triggers_router, prefix="/api/v1")
```

- [ ] **Step 3: Verify the app still imports with the panel off**

Run: `cd backend && python -c "from app.main import app; print([r.path for r in app.routes if '/dev' in r.path])"`
Expected: `[]` (DEV_PANEL_ENABLED defaults to False)

- [ ] **Step 4: Verify the full suite still passes**

Run: `cd backend && pytest -q`
Expected: no new failures.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/endpoints/dev_triggers.py backend/app/main.py
git commit -m "feat(api): dev trigger router, registered outside production only"
```

---

## Task 9: Integration tests — endpoints

**Files:**
- Create: `backend/tests/integration/test_dev_triggers.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/integration/test_dev_triggers.py`:

```python
"""Integration tests for the dev trigger panel.

The router registers at import time, so a module-scoped fixture flips the settings
and reloads app.main to obtain an app that actually has the routes. Settings are
restored and main reloaded again on teardown so other test modules are unaffected.
"""

import importlib
import uuid
from typing import Any, AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import app.main as app_main
from app.core.config import settings
from app.db.models.enums import (
    ExceptionType, IdvsStatus, OrganizationType, ParcelStatus, TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.integrations import parcel_perfect as pp_module
from app.integrations import scan_feed as scan_feed_module

from tests.conftest import auth_header, make_jwks, make_token


class FakeStore:
    """Dict-backed MockStateStore — keeps these tests off a real Redis."""

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


@pytest.fixture(scope="module")
def dev_app():
    """Reload app.main with the dev panel switched on, then restore."""
    original_environment = settings.ENVIRONMENT
    original_flag = settings.DEV_PANEL_ENABLED
    settings.ENVIRONMENT = "development"
    settings.DEV_PANEL_ENABLED = True
    importlib.reload(app_main)

    yield app_main.app

    settings.ENVIRONMENT = original_environment
    settings.DEV_PANEL_ENABLED = original_flag
    importlib.reload(app_main)


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    fake = FakeStore()
    monkeypatch.setattr(scan_feed_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(pp_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(
        "app.api.v1.endpoints.dev_triggers.get_mock_state_store", lambda: fake
    )
    return fake


@pytest_asyncio.fixture
async def dev_client(
    dev_app, db_session, monkeypatch: pytest.MonkeyPatch
) -> AsyncGenerator[AsyncClient, None]:
    monkeypatch.setattr("app.auth.dependencies._get_jwks", make_jwks)

    async def _get_db():
        yield db_session

    dev_app.dependency_overrides[get_db] = _get_db
    async with AsyncClient(
        transport=ASGITransport(app=dev_app), base_url="http://test",
    ) as ac:
        yield ac
    dev_app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seeded(db_session):
    """A trip with one stop and one consignment whose barcodes match WAY001's fixture."""
    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    precinct = Precinct(
        id=uuid.uuid4(), name="Origin", principal_organization_id=org.id,
        latitude="0", longitude="0",
    )
    db_session.add_all([user, driver, horse, precinct])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    # WAY001 is a real fixture in parcel_perfect.MOCK_WAYBILLS with 5 parcels, so
    # the PP trigger's real sync resolves against data that actually exists.
    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY001",
        parcel_count_expected=5, pickup_stop_id=stop.id, delivery_stop_id=stop.id,
    )
    db_session.add(consignment)
    await db_session.flush()

    barcodes = [f"WAY001{n:04d}" for n in range(1, 6)]
    for barcode in barcodes:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id,
            barcode=barcode, status=ParcelStatus.PENDING,
        ))
    await db_session.flush()

    return {
        "trip": trip, "stop": stop, "consignment": consignment,
        "barcodes": barcodes, "org": org,
    }


def _token(seeded) -> str:
    return make_token(role="dispatcher", org_id=str(seeded["org"].id))


# ── Router registration ───────────────────────────────────────────────────────


def test_dev_router_absent_in_production():
    """A trigger-exception endpoint reachable in production is a catastrophe."""
    original_environment = settings.ENVIRONMENT
    original_flag = settings.DEV_PANEL_ENABLED
    settings.ENVIRONMENT = "production"
    settings.DEV_PANEL_ENABLED = True
    try:
        importlib.reload(app_main)

        assert [r.path for r in app_main.app.routes if "/dev" in r.path] == []
    finally:
        settings.ENVIRONMENT = original_environment
        settings.DEV_PANEL_ENABLED = original_flag
        importlib.reload(app_main)


def test_dev_router_absent_when_flag_is_off():
    original_environment = settings.ENVIRONMENT
    original_flag = settings.DEV_PANEL_ENABLED
    settings.ENVIRONMENT = "development"
    settings.DEV_PANEL_ENABLED = False
    try:
        importlib.reload(app_main)

        assert [r.path for r in app_main.app.routes if "/dev" in r.path] == []
    finally:
        settings.ENVIRONMENT = original_environment
        settings.DEV_PANEL_ENABLED = original_flag
        importlib.reload(app_main)


def test_dev_router_present_when_both_conditions_hold(dev_app):
    assert any("/dev" in r.path for r in dev_app.routes)


# ── Auth ──────────────────────────────────────────────────────────────────────


async def test_scan_trigger_requires_auth(dev_client, seeded, store):
    res = await dev_client.post("/api/v1/dev/scans", json={
        "trip_id": str(seeded["trip"].id),
        "trip_stop_id": str(seeded["stop"].id),
        "direction": "out",
    })

    assert res.status_code == 401


async def test_list_trips_requires_auth(dev_client):
    res = await dev_client.get("/api/v1/dev/trips")

    assert res.status_code == 401


# ── Validation ────────────────────────────────────────────────────────────────


async def test_scan_trigger_rejects_a_bad_direction(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "sideways",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 422


async def test_scan_trigger_rejects_a_negative_count(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
            "parcel_count": -1,
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 422


async def test_scan_trigger_404s_for_a_stop_with_no_consignments(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(uuid.uuid4()),
            "direction": "out",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 404


# ── Scan triggers ─────────────────────────────────────────────────────────────


async def test_full_scan_out_marks_every_parcel(dev_client, db_session, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    parcels = (await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
    )).scalars().all()
    assert all(p.pp_scan_out_at is not None for p in parcels)


async def test_partial_scan_creates_a_scoped_exception(dev_client, db_session, seeded, store):
    """The discrepancy path, end to end through the endpoint."""
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
            "parcel_count": 3,
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    body = res.json()
    assert len(body["consignments"][0]["missing_barcodes"]) == 2
    exception = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalar_one()
    assert exception.consignment_id == seeded["consignment"].id
    assert exception.trip_stop_id == seeded["stop"].id
    assert exception.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH


async def test_unexpected_barcode_is_reported_and_recorded(dev_client, db_session, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
            "barcodes": [*seeded["barcodes"], "STRANGER-99"],
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    assert res.json()["consignments"][0]["unexpected_barcodes"] == ["STRANGER-99"]
    exception = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalar_one()
    assert "STRANGER-99" in exception.description


# ── PP triggers ───────────────────────────────────────────────────────────────


async def test_pp_trigger_sets_the_manifest_number(dev_client, db_session, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/pp/waybill",
        json={
            "trip_id": str(seeded["trip"].id),
            "parcel_perfect_reference": "WAY001",
            "manifest": 999,
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    assert res.json()["pp_manifest_number"] == 999
    consignment = (await db_session.execute(
        select(Consignment).where(Consignment.id == seeded["consignment"].id)
    )).scalar_one()
    assert consignment.pp_manifest_number == 999


async def test_pp_trigger_404s_for_a_consignment_not_on_the_trip(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/pp/waybill",
        json={
            "trip_id": str(seeded["trip"].id),
            "parcel_perfect_reference": "WAY005",
            "manifest": 1,
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 404


async def test_mid_trip_waybill_edit_moves_the_baseline(dev_client, db_session, seeded, store):
    """Reproduces spec §B2c. Drift DETECTION is Stage 5 and deliberately not built,
    so this asserts the gap: the expected count is silently adopted."""
    res = await dev_client.post(
        "/api/v1/dev/pp/waybill",
        json={
            "trip_id": str(seeded["trip"].id),
            "parcel_perfect_reference": "WAY001",
            "parcel_count": 27,
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    consignment = (await db_session.execute(
        select(Consignment).where(Consignment.id == seeded["consignment"].id)
    )).scalar_one()
    assert consignment.parcel_count_expected == 27


# ── Exception trigger ─────────────────────────────────────────────────────────


async def test_exception_trigger_records_a_real_exception(dev_client, db_session, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/exceptions",
        json={
            "trip_id": str(seeded["trip"].id),
            "exception_type": "cargo_damage",
            "description": "Pallet 3 shrink-wrap torn on arrival.",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 200
    exception = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalar_one()
    assert exception.exception_type == ExceptionType.CARGO_DAMAGE


async def test_exception_trigger_404s_for_an_unknown_trip(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/exceptions",
        json={
            "trip_id": str(uuid.uuid4()),
            "exception_type": "cargo_damage",
            "description": "x",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 404


async def test_exception_trigger_rejects_an_empty_description(dev_client, seeded, store):
    res = await dev_client.post(
        "/api/v1/dev/exceptions",
        json={
            "trip_id": str(seeded["trip"].id),
            "exception_type": "cargo_damage",
            "description": "",
        },
        headers=auth_header(_token(seeded)),
    )

    assert res.status_code == 422


# ── The principle ─────────────────────────────────────────────────────────────


async def test_flushing_mock_state_leaves_evidence_intact(dev_client, db_session, seeded, store):
    """THE test for this plan's non-negotiable principle.

    Redis holds only the simulated outside world. Every permanent effect is a
    PostgreSQL row written by orchestration. Wiping the former must not disturb
    the latter — if it does, a trigger was writing state that evidence depends on.
    """
    await dev_client.post(
        "/api/v1/dev/scans",
        json={
            "trip_id": str(seeded["trip"].id),
            "trip_stop_id": str(seeded["stop"].id),
            "direction": "out",
            "parcel_count": 3,
        },
        headers=auth_header(_token(seeded)),
    )
    parcels_before = sorted(
        (p.barcode, p.pp_scan_out_at, p.status)
        for p in (await db_session.execute(
            select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
        )).scalars().all()
    )
    exceptions_before = len((await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalars().all())

    flush = await dev_client.post(
        "/api/v1/dev/mock-state/flush", headers=auth_header(_token(seeded)),
    )

    assert flush.status_code == 200
    parcels_after = sorted(
        (p.barcode, p.pp_scan_out_at, p.status)
        for p in (await db_session.execute(
            select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
        )).scalars().all()
    )
    exceptions_after = len((await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalars().all())
    assert parcels_after == parcels_before
    assert exceptions_after == exceptions_before
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && pytest tests/integration/test_dev_triggers.py -v`
Expected: PASS, 19 tests.

If `test_dev_router_absent_in_production` fails, the guard in `main.py` is wrong — fix `main.py`, never the test. That test is the reason this gate exists.

- [ ] **Step 3: Run the whole suite**

Run: `cd backend && pytest -q`
Expected: green. The module-scoped `dev_app` fixture reloads `app.main` on teardown, so no other module should see a mutated app; if another test file starts failing, that restore is the first place to look.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/integration/test_dev_triggers.py
git commit -m "test(api): dev trigger endpoint coverage and production-absence guard"
```

---

## Task 10: Dispatcher types and hook

**Files:**
- Create: `frontend/dispatcher/lib/types/dev.ts`
- Create: `frontend/dispatcher/lib/hooks/useDevTriggers.ts`

Note: these live in `frontend/dispatcher/`, **not** `frontend/shared/`. The driver never sees parcel-grain scan data (theft-risk rule, `manifest_service.py`), and keeping out of `shared/` also keeps this work clear of the driver-app refactor on another branch.

- [ ] **Step 1: Write the types**

Create `frontend/dispatcher/lib/types/dev.ts`:

```typescript
/**
 * Types for the dev trigger panel. Mirrors backend/app/schemas/dev.py.
 *
 * Dispatcher-local rather than in @shared: the driver surface never sees
 * parcel-grain scan data, so this contract has exactly one consumer.
 */

export type ScanDirection = 'out' | 'in'

export interface DevTripStop {
  trip_stop_id: string
  sequence: number
  precinct_name: string
  pickup_consignment_references: string[]
  delivery_consignment_references: string[]
}

export interface DevTripSummary {
  trip_id: string
  trip_reference: string
  status: string
  current_phase: string | null
  stops: DevTripStop[]
}

export interface ConsignmentScanResult {
  consignment_id: string
  parcel_perfect_reference: string
  expected_count: number
  observed_count: number
  matched_barcodes: string[]
  missing_barcodes: string[]
  unexpected_barcodes: string[]
  exception_ids: string[]
}

export interface ScanTriggerRequest {
  trip_id: string
  trip_stop_id: string
  direction: ScanDirection
  parcel_count?: number
  barcodes?: string[]
}

export interface ScanTriggerResponse {
  trip_id: string
  trip_stop_id: string
  direction: ScanDirection
  consignments: ConsignmentScanResult[]
}

export interface PpTriggerRequest {
  trip_id: string
  parcel_perfect_reference: string
  manifest?: number
  poddate?: string
  failtype?: string
  parcel_count?: number
}

export interface PpTriggerResponse {
  consignment_id: string
  parcel_perfect_reference: string
  parcel_count_expected: number | null
  pp_manifest_number: number | null
  poddate: string
  failtype: string | null
  warning: string | null
}

export interface ExceptionTriggerRequest {
  trip_id: string
  exception_type: string
  description: string
}

export interface ExceptionTriggerResponse {
  exception_id: string
  trip_id: string
  exception_type: string
  severity: string
  description: string
}

export interface FlushMockStateResponse {
  keys_deleted: number
}

/**
 * Exception types the panel offers. A deliberate subset of the backend enum —
 * the ones with a demo narrative. Scan discrepancies are raised by the
 * reconciliation service itself and are not in this list.
 */
export const DEMO_EXCEPTION_TYPES = [
  'seal_broken_in_transit',
  'panic_button',
  'cargo_damage',
  'delivery_refused',
  'mechanical',
  'route_deviation',
] as const

export type DemoExceptionType = (typeof DEMO_EXCEPTION_TYPES)[number]
```

- [ ] **Step 2: Write the hook**

Create `frontend/dispatcher/lib/hooks/useDevTriggers.ts`:

```typescript
'use client'

import { useCallback, useState } from 'react'

import { api, ApiError } from '@/lib/api/client'
import type {
  DevTripSummary,
  ExceptionTriggerRequest,
  ExceptionTriggerResponse,
  FlushMockStateResponse,
  PpTriggerRequest,
  PpTriggerResponse,
  ScanTriggerRequest,
  ScanTriggerResponse,
} from '@/lib/types/dev'

const DEV_BASE = '/api/v1/dev'

export interface UseDevTriggersResult {
  trips: DevTripSummary[]
  isLoading: boolean
  error: string | null
  lastResult: string | null
  loadTrips: () => Promise<void>
  triggerScan: (body: ScanTriggerRequest) => Promise<ScanTriggerResponse | null>
  triggerPpChange: (body: PpTriggerRequest) => Promise<PpTriggerResponse | null>
  triggerException: (body: ExceptionTriggerRequest) => Promise<ExceptionTriggerResponse | null>
  flushMockState: () => Promise<FlushMockStateResponse | null>
}

/**
 * Calls the dev trigger endpoints. Every failure is surfaced as readable text
 * rather than swallowed — an unexplained no-op mid-demo is the worst outcome,
 * and a 404 here usually means DEV_PANEL_ENABLED is not set on the backend.
 */
export function useDevTriggers(): UseDevTriggersResult {
  const [trips, setTrips] = useState<DevTripSummary[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const describeError = (err: unknown): string => {
    if (err instanceof ApiError) {
      return err.status === 404
        ? `${err.message} (is DEV_PANEL_ENABLED set on the backend?)`
        : err.message
    }
    return err instanceof Error ? err.message : String(err)
  }

  const run = useCallback(async <T,>(
    action: () => Promise<T>,
    describe: (result: T) => string,
  ): Promise<T | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await action()
      setLastResult(describe(result))
      return result
    } catch (err: unknown) {
      setError(describeError(err))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  const loadTrips = useCallback(async (): Promise<void> => {
    await run(
      () => api.get<DevTripSummary[]>(`${DEV_BASE}/trips`),
      (result) => {
        setTrips(result)
        return `Loaded ${result.length} trip(s).`
      },
    )
  }, [run])

  const triggerScan = useCallback(
    (body: ScanTriggerRequest) =>
      run(
        () => api.post<ScanTriggerResponse>(`${DEV_BASE}/scans`, body),
        (result) => {
          const missing = result.consignments.reduce((n, c) => n + c.missing_barcodes.length, 0)
          const unexpected = result.consignments.reduce((n, c) => n + c.unexpected_barcodes.length, 0)
          const scanned = result.consignments.reduce((n, c) => n + c.observed_count, 0)
          return `Scanned ${scanned}. Missing ${missing}. Unexpected ${unexpected}.`
        },
      ),
    [run],
  )

  const triggerPpChange = useCallback(
    (body: PpTriggerRequest) =>
      run(
        () => api.post<PpTriggerResponse>(`${DEV_BASE}/pp/waybill`, body),
        (result) =>
          `${result.parcel_perfect_reference}: expected ${result.parcel_count_expected}, ` +
          `manifest ${result.pp_manifest_number ?? 'none'}.`,
      ),
    [run],
  )

  const triggerException = useCallback(
    (body: ExceptionTriggerRequest) =>
      run(
        () => api.post<ExceptionTriggerResponse>(`${DEV_BASE}/exceptions`, body),
        (result) => `Raised ${result.exception_type} (${result.severity}).`,
      ),
    [run],
  )

  const flushMockState = useCallback(
    () =>
      run(
        () => api.post<FlushMockStateResponse>(`${DEV_BASE}/mock-state/flush`, {}),
        (result) => `Cleared ${result.keys_deleted} staged key(s). Evidence untouched.`,
      ),
    [run],
  )

  return {
    trips, isLoading, error, lastResult,
    loadTrips, triggerScan, triggerPpChange, triggerException, flushMockState,
  }
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend/dispatcher && npx tsc --noEmit`
Expected: no errors from `lib/types/dev.ts` or `lib/hooks/useDevTriggers.ts`. Pre-existing errors elsewhere are not this task's problem — note them for TASK COMPLETE.

- [ ] **Step 4: Commit**

```bash
git add frontend/dispatcher/lib/types/dev.ts frontend/dispatcher/lib/hooks/useDevTriggers.ts
git commit -m "feat(dispatcher): typed client for the dev trigger endpoints"
```

---

## Task 11: Dev trigger page

Operated on a second device the audience does not see. It therefore needs its own trip and stop pickers rather than inheriting context from a trip page.

**Files:**
- Create: `frontend/dispatcher/components/dev/DevTriggerPanel.tsx`
- Create: `frontend/dispatcher/app/(app)/dev/triggers/page.tsx`

- [ ] **Step 1: Write the panel component**

Create `frontend/dispatcher/components/dev/DevTriggerPanel.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useDevTriggers } from '@/lib/hooks/useDevTriggers'
import { DEMO_EXCEPTION_TYPES, type ScanDirection } from '@/lib/types/dev'

interface DevTriggerPanelProps {
  /** Shown at the top so nobody mistakes this for a product surface. */
  readonly heading: string
}

export function DevTriggerPanel({ heading }: DevTriggerPanelProps): React.ReactElement {
  const {
    trips, isLoading, error, lastResult,
    loadTrips, triggerScan, triggerPpChange, triggerException, flushMockState,
  } = useDevTriggers()

  const [tripId, setTripId] = useState<string>('')
  const [stopId, setStopId] = useState<string>('')
  const [direction, setDirection] = useState<ScanDirection>('out')
  const [parcelCount, setParcelCount] = useState<string>('')
  const [extraBarcode, setExtraBarcode] = useState<string>('')
  const [ppReference, setPpReference] = useState<string>('')
  const [ppManifest, setPpManifest] = useState<string>('')
  const [ppPodDate, setPpPodDate] = useState<string>('')
  const [ppFailType, setPpFailType] = useState<string>('')
  const [ppParcelCount, setPpParcelCount] = useState<string>('')
  const [exceptionType, setExceptionType] = useState<string>(DEMO_EXCEPTION_TYPES[0])
  const [exceptionNote, setExceptionNote] = useState<string>('Raised from the dev panel.')

  useEffect(() => {
    void loadTrips()
  }, [loadTrips])

  const selectedTrip = trips.find((t) => t.trip_id === tripId) ?? null
  const selectedStop = selectedTrip?.stops.find((s) => s.trip_stop_id === stopId) ?? null

  // References available at the selected stop, in the selected direction. Shown so
  // the operator picks a reference that actually exists there rather than typing one.
  const referencesAtStop = selectedStop
    ? direction === 'out'
      ? selectedStop.pickup_consignment_references
      : selectedStop.delivery_consignment_references
    : []

  const canScan = tripId !== '' && stopId !== ''

  const onFullScan = async (): Promise<void> => {
    await triggerScan({ trip_id: tripId, trip_stop_id: stopId, direction })
  }

  const onPartialScan = async (): Promise<void> => {
    const count = Number.parseInt(parcelCount, 10)
    if (Number.isNaN(count)) return
    await triggerScan({
      trip_id: tripId, trip_stop_id: stopId, direction, parcel_count: count,
    })
  }

  const onUnexpectedBarcode = async (): Promise<void> => {
    if (extraBarcode.trim() === '') return
    await triggerScan({
      trip_id: tripId, trip_stop_id: stopId, direction, barcodes: [extraBarcode.trim()],
    })
  }

  const onPpChange = async (): Promise<void> => {
    if (ppReference === '') return
    await triggerPpChange({
      trip_id: tripId,
      parcel_perfect_reference: ppReference,
      manifest: ppManifest === '' ? undefined : Number.parseInt(ppManifest, 10),
      poddate: ppPodDate === '' ? undefined : ppPodDate,
      failtype: ppFailType === '' ? undefined : ppFailType,
      parcel_count: ppParcelCount === '' ? undefined : Number.parseInt(ppParcelCount, 10),
    })
  }

  const onException = async (): Promise<void> => {
    if (tripId === '') return
    await triggerException({
      trip_id: tripId, exception_type: exceptionType, description: exceptionNote,
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3 p-4">
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="text-sm text-slate-500">
            Every button here drives a mock and then calls the same orchestration the
            real flow calls. Nothing writes to the database directly.
          </p>
          {error !== null && (
            <p role="alert" className="text-sm text-red-600">{error}</p>
          )}
          {lastResult !== null && (
            <p className="text-sm text-emerald-700">{lastResult}</p>
          )}
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Target</h3>
          <Select
            label="Trip"
            value={tripId}
            onChange={(e) => { setTripId(e.target.value); setStopId('') }}
          >
            <option value="">Select a trip…</option>
            {trips.map((trip) => (
              <option key={trip.trip_id} value={trip.trip_id}>
                {trip.trip_reference} — {trip.status}
                {trip.current_phase !== null ? ` (${trip.current_phase})` : ''}
              </option>
            ))}
          </Select>
          <Select label="Stop" value={stopId} onChange={(e) => setStopId(e.target.value)}>
            <option value="">Select a stop…</option>
            {(selectedTrip?.stops ?? []).map((stop) => (
              <option key={stop.trip_stop_id} value={stop.trip_stop_id}>
                #{stop.sequence} — {stop.precinct_name}
              </option>
            ))}
          </Select>
          <Select
            label="Direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as ScanDirection)}
          >
            <option value="out">Scan OUT (loading)</option>
            <option value="in">Scan IN (unloading)</option>
          </Select>
          {selectedStop !== null && (
            <p className="text-xs text-slate-500">
              Consignments here: {referencesAtStop.join(', ') || 'none'}
            </p>
          )}
          <Button onClick={() => void loadTrips()} disabled={isLoading}>
            Refresh trips
          </Button>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Warehouse scan feed</h3>
          <Button onClick={() => void onFullScan()} disabled={!canScan || isLoading}>
            Scan everything at this stop
          </Button>
          <div className="flex gap-2">
            <Input
              label="Parcels to scan"
              type="number"
              min={0}
              value={parcelCount}
              placeholder="N parcels"
              onChange={(e) => setParcelCount(e.target.value)}
            />
            <Button onClick={() => void onPartialScan()} disabled={!canScan || isLoading}>
              Partial scan
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              label="Unexpected barcode"
              value={extraBarcode}
              placeholder="Barcode not on the manifest"
              onChange={(e) => setExtraBarcode(e.target.value)}
            />
            <Button onClick={() => void onUnexpectedBarcode()} disabled={!canScan || isLoading}>
              Scan unexpected
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Parcel Perfect lifecycle</h3>
          <Select label="Waybill" value={ppReference} onChange={(e) => setPpReference(e.target.value)}>
            <option value="">Select a waybill…</option>
            {referencesAtStop.map((reference) => (
              <option key={reference} value={reference}>{reference}</option>
            ))}
          </Select>
          <Input
            label="Manifest number"
            type="number"
            value={ppManifest}
            placeholder="e.g. 999"
            onChange={(e) => setPpManifest(e.target.value)}
          />
          <Input
            label="POD date"
            value={ppPodDate}
            placeholder="e.g. 04/08/2026"
            onChange={(e) => setPpPodDate(e.target.value)}
          />
          <Input
            label="Failure reason"
            value={ppFailType}
            placeholder="e.g. Receiver not home"
            onChange={(e) => setPpFailType(e.target.value)}
          />
          <Input
            label="Edit waybill: new parcel count"
            type="number"
            value={ppParcelCount}
            placeholder="e.g. 27"
            onChange={(e) => setPpParcelCount(e.target.value)}
          />
          <Button onClick={() => void onPpChange()} disabled={ppReference === '' || isLoading}>
            Apply PP change and re-sync
          </Button>
          <p className="text-xs text-slate-500">
            Editing the parcel count reproduces the verified 2026-08-04 finding: PP
            waybills are mutable after creation and the sync adopts the new figure.
            Drift detection is a separate ticket.
          </p>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Exceptions</h3>
          <Select
            label="Exception type"
            value={exceptionType}
            onChange={(e) => setExceptionType(e.target.value)}
          >
            {DEMO_EXCEPTION_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </Select>
          <Input
            label="Description"
            value={exceptionNote}
            onChange={(e) => setExceptionNote(e.target.value)}
          />
          <Button onClick={() => void onException()} disabled={tripId === '' || isLoading}>
            Raise exception
          </Button>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Mock state</h3>
          <Button onClick={() => void flushMockState()} disabled={isLoading}>
            Clear staged mock state
          </Button>
          <p className="text-xs text-slate-500">
            Clears only the simulated outside world. Scans, exceptions and phase
            history already recorded stay exactly as they are.
          </p>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Write the page**

Create `frontend/dispatcher/app/(app)/dev/triggers/page.tsx`:

```typescript
'use client'

import { DevTriggerPanel } from '@/components/dev/DevTriggerPanel'
import { PageShell } from '@/components/layout/PageShell'

/**
 * Dev trigger page — simulates the parts of the world FreightProof cannot yet
 * reach: the warehouse's scanning system and Parcel Perfect's depot functions.
 *
 * Reached by URL only, with no nav link: it is operated on a second device during
 * a demo and is not a product surface. The backend router is absent entirely
 * unless DEV_PANEL_ENABLED is set and ENVIRONMENT is not production, so every call
 * from this page 404s in a production deployment regardless of this flag.
 */
export default function DevTriggersPage(): React.ReactElement {
  const enabled = process.env.NEXT_PUBLIC_DEV_PANEL === 'true'

  if (!enabled) {
    return (
      <PageShell>
        <p className="text-sm text-slate-500">
          The dev trigger panel is disabled. Set NEXT_PUBLIC_DEV_PANEL=true to enable it.
        </p>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <DevTriggerPanel heading="Dev triggers — simulated warehouse and Parcel Perfect" />
    </PageShell>
  )
}
```

- [ ] **Step 3: Confirm the UI component signatures**

These were verified while writing this plan and the code above matches them:

| Component | Export | Required props |
|---|---|---|
| `components/ui/Button.tsx` | `Button` (named) | none — extends `ButtonHTMLAttributes` |
| `components/ui/Card.tsx` | `Card` (named) | `children`. No padding of its own, hence the inner `p-4` div. |
| `components/ui/Input.tsx` | `Input` (named) | **`label: string` is required** — every `Input` above supplies one |
| `components/ui/Select.tsx` | `Select` (named) | **`label: string` is required** — every `Select` above supplies one |
| `components/layout/PageShell.tsx` | `PageShell` (named) | `children` |

Run: `cd frontend/dispatcher && ls components/ui/Button.tsx components/ui/Card.tsx components/ui/Input.tsx components/ui/Select.tsx components/layout/PageShell.tsx`
Expected: all five listed.

If a signature has drifted since this plan was written, adapt the panel to the real one. Do not change the shared UI components to fit this page — they are used across the dispatcher.

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend/dispatcher && npx tsc --noEmit && npm run lint`
Expected: no new errors from `components/dev/` or `app/(app)/dev/triggers/`.

- [ ] **Step 5: Commit**

```bash
git add frontend/dispatcher/components/dev frontend/dispatcher/app/\(app\)/dev/triggers
git commit -m "feat(dispatcher): dev trigger page for simulated scan and PP events"
```

---

## Task 12: Full verification and handover

**Files:** none created.

- [ ] **Step 1: Run the whole backend suite**

Run: `cd backend && pytest -q`
Expected: green, no skips other than those caused by an unset `TEST_DATABASE_URL`.

- [ ] **Step 2: Prove the production guard once more, in isolation**

Run: `cd backend && ENVIRONMENT=production DEV_PANEL_ENABLED=true python -c "from app.main import app; paths=[r.path for r in app.routes if '/dev' in r.path]; assert paths == [], paths; print('dev router absent in production: OK')"`
Expected: `dev router absent in production: OK`

- [ ] **Step 3: Prove the router appears when both switches are on**

Run: `cd backend && ENVIRONMENT=development DEV_PANEL_ENABLED=true python -c "from app.main import app; paths=[r.path for r in app.routes if '/dev' in r.path]; assert paths, 'no dev routes'; print(len(paths), 'dev routes registered')"`
Expected: a count of 5 or more.

- [ ] **Step 4: Manual end-to-end check against a real Redis**

Every automated test injects a fake store, so nothing so far has exercised `RedisMockStateStore`. This step is the only thing that proves the Redis path works, and it is the path the demo depends on.

```bash
cd backend
export DEV_PANEL_ENABLED=true
uvicorn app.main:app --reload --port 8000
```

Then, in the dispatcher with `NEXT_PUBLIC_DEV_PANEL=true`, open `/dev/triggers` and confirm:
1. The trip list populates.
2. A partial scan reports missing barcodes and the exception appears on the dispatcher's exceptions page.
3. "Clear staged mock state" reports a non-zero key count — this proves real Redis was written, not a fake.
4. After clearing, the parcel scan timestamps and the exception are still there.

- [ ] **Step 5: Confirm the isolation claim**

Run: `git diff --stat main...HEAD -- frontend/shared frontend/driver-pwa`
Expected: **empty output.** If anything is listed, this work has touched the driver-app refactor's territory — revert those files before finishing.

- [ ] **Step 6: Write TASK COMPLETE**

Use the exact format in `CLAUDE.md`. It must record:
- **Shared files:** `backend/app/main.py` (router registration), `backend/app/core/config.py` (two additive keys). Both need flagging to the team.
- **New .env keys:** `DEV_PANEL_ENABLED` — registers the dev trigger router, must stay unset/false in production; `SCAN_FEED_USE_MOCK` — selects `MockScanFeed`; `NEXT_PUBLIC_DEV_PANEL` (dispatcher) — renders the page.
- **Migrations:** none. Every column already existed.
- **Deprecations:** anything encountered in touched files, unfixed.
- **Next:** `origin_scan_complete` in `manifest_service.py` now returns true once a full scan-out has run, with no code change — verify it on the dispatcher manifest. PP drift detection (spec §B2c / Stage 5) remains unbuilt and the panel demonstrates the gap. The driver PWA must compile and be hosted before the trip can be walked end to end.

---

## Notes for the executing engineer

**Do not run git write commands beyond `git add`.** `CLAUDE.md` prohibits `commit`, `push`, `merge`, `rebase`, `checkout`, `stash`, `reset` and `restore`. The commit steps above are written for the human to run; stage the files and hand the suggested message over.

**If a test fails, fix the code, not the test.** The two that matter most are `test_dev_router_absent_in_production` and `test_flushing_mock_state_leaves_evidence_intact` — the first is a safety property on an evidence platform, the second is this plan's whole architectural claim.

**If you find yourself writing a `db.add(...)` inside `dev_triggers.py`, stop.** That is the failure mode this design exists to prevent. Every persistent write belongs in `scan_service`, `consignment_service` or `exception_service`.
