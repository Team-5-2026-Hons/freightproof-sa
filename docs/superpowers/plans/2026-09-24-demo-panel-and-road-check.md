# Demo panel redesign and on-road tracker check — Design and Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A presenter can run the whole demo from one panel that follows the trip: it shows where the trip is, offers only the simulated outside-world actions that fit that moment (warehouse scans, Parcel Perfect, tracker), and records road incidents — an uncoupled trailer, a truck that left before departure, a silent tracker — as real system exceptions.

**Architecture:** Backend: a new `road_check_service` (pure rules + one DB writer) and a `dev_rig_service` that stages every tracker on a trip for a named scenario; a new guarded `/dev/tracker` router drives both. `GET /dev/trips` gains the facts the panel needs to know where a trip is. Frontend: pure stage/preset logic in `lib/dev/`, the 1,070-line panel split into small action components, the old raw controls kept intact inside a collapsed "All controls" section, and an activity log.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Pydantic v2, pytest + pytest-asyncio; Next.js 15, React 19, TypeScript, Vitest + Testing Library.

**Related:** design note [2026-09-23-arrival-phase-and-live-journey.md](../../design-notes/2026-09-23-arrival-phase-and-live-journey.md) §4.7 (stage S7). This document replaces the parked [2026-09-24-s7-journey-checkpoints.md](2026-09-24-s7-journey-checkpoints.md).

---

# Part A — Design (approved in chat, 2026-09-24)

## A1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | The driver's actions always happen on the real phone. The panel simulates only the outside world: warehouse, Parcel Perfect, trackers | The panel must never create driver evidence |
| D2 | The panel follows the trip: pick a trip, it shows where the trip is and only the actions that fit | The presenter should not need to know which card applies at which phase |
| D3 | Presets fire on one click; raw controls (inside "All controls") keep the confirmation modal | Presets are named, known scenarios; raw controls are where mistakes happen |
| D4 | Road incidents are **system** exceptions (`source=SYSTEM`) raised by a check that reads the trackers, never typed into the panel | The evidence must say the tracker detected it, not the driver |
| D5 | Three new exception types: `TRAILER_SEPARATED_IN_TRANSIT` (CRITICAL), `MOVED_BEFORE_DEPARTURE` (CRITICAL), `TRACKER_SILENT` (WARNING) | `TRAILER_LOCATION_MISMATCH` means "outside the precinct at a stop"; the road finding is trailer-to-horse with no fence |
| D6 | The road check runs on demand, never on a timer | Pulsit is mock-only; a poller would re-read a value that only changes on a click |
| D7 | No migration | `exceptions.exception_type` is `String(50)` |
| D8 | Fixed Cape Town waypoints leave the UI; the backend `demo_waypoints` module stays | `scripts/seed_demo.py` imports it |
| D9 | `move-truck` is **unchanged** (horse only, stop-relative scenarios), reachable from "All controls" | Trailer movement comes through rig scenarios; changing a well-tested endpoint buys nothing. (Simplified from the chat design, which added `vehicle_id` to it) |
| D10 | `DevVehicle` carries no `has_tracker` flag | `vehicles.pulsit_device_id` is `NOT NULL`, so every vehicle has a tracker id. (Simplified from the chat design) |

## A2. What the presenter sees

Trip picker (active trips first) → a headline, e.g. **"On the road to Paarl Depot · leg 1 of 1"** → the action groups for that stage → activity log → collapsed "All controls". The panel refetches on every live event for the chosen trip, so it advances when the driver acts on the phone.

| Stage (`DemoStageKind`) | Current phase | Warehouse | Tracker | Parcel Perfect |
|---|---|---|---|---|
| `not_started` | none / `trip_creation` | — | — | edit waybill |
| `before_departure` | activation, loading, departure | scan out: all · one short · stray · close session | at the stop · 3 km away · leaves before departure · horse silent | edit waybill |
| `on_road` | in_transit | — | driving normally · trailer {reg} uncoupled (one per trailer) · horse silent · reaches {next stop} · run tracker check | edit waybill |
| `arrived` | arrival | locked, with the reason | at the stop · 3 km away · horse silent | edit waybill |
| `unloading` | unloading | scan in: all · one missing · stray · close session | at the stop · 3 km away · horse silent | edit waybill |
| `confirming` | confirmation | scan in (still open until confirmation decides) | at the stop · 3 km away · horse silent | delivered · delivery failed · edit waybill |
| `closed` | trip closed or cancelled | — | — | delivered · delivery failed |

"Reset simulated world" (existing flush) is always available.

**Scan gating (changed):** scanning **in** at a stop opens only once that stop's **arrival** is completed (it used to open at the preceding departure), and stays open until confirmation is decided. Scanning out is unchanged.

## A3. The road check

`evaluate_road_readings` (pure) takes the trip's stage and one reading per vehicle:

| Rule | When | Finding | Recorded against | Once per |
|---|---|---|---|---|
| Silent tracker | a reading's status is `NO_FIX` | `TRACKER_SILENT`, WARNING | the current phase | phase + vehicle |
| Trailer separated | trip is on an in-transit leg; horse and trailer both have a position; distance > `TRAILER_HORSE_MAX_SEPARATION_METRES` | `TRAILER_SEPARATED_IN_TRANSIT`, CRITICAL | the in-transit leg | leg + trailer |
| Moved before departure | the current phase is at a stop whose departure is still ahead; the horse has a position outside that stop's geofence (`evaluate_geofence`) | `MOVED_BEFORE_DEPARTURE`, CRITICAL | the pending departure row | departure + horse |

- `UNKNOWN_DEVICE` (never configured or staged) raises nothing. Otherwise every untouched trailer reads as silent.
- No horse position → no separation and no departure finding. NULL never raises.
- Each finding stores `vehicle_id`, the vehicle's fix in `gps_lat`/`gps_lng` (none for silent), a description naming the registration and distance, `source=SYSTEM`, `review_status` via `initial_review_status`, and publishes `EXCEPTION_RAISED` with its severity.
- Skipped entirely for closed and cancelled trips. Never advances a phase.

## A4. Rig scenarios

`POST /dev/tracker/scenario` stages every tracker on the trip, then runs the road check and returns readings and findings.

| Scenario | Needs | Stages |
|---|---|---|
| `at_stop` | `trip_stop_id` | every vehicle at that stop's precinct centre |
| `away_from_stop` | `trip_stop_id` | every vehicle 3 km from that stop (existing `three_km` geometry) |
| `left_before_departure` | trip at a stop, not in transit | every vehicle 3 km from the current stop |
| `en_route` | trip in transit | every vehicle at the midpoint of the current leg |
| `trailer_uncoupled` | trip in transit; `vehicle_id` of a trailer | the rest of the rig at the midpoint; that trailer `max(5 km, 2 × threshold)` from it |
| `silent` | `vehicle_id` of any rig vehicle | that tracker goes dark; the others are untouched |

A scenario that does not fit the trip's stage returns **409** with a readable reason. `POST /dev/tracker/check` runs the road check alone.

## A5. Out of scope

Driver checkpoints (parked). A timed tracker poller. Journey rows that are not exceptions (stationary, entered precinct). Driver actions from the panel. S6 (live photo rows).

---

# Part B — Implementation plan

## Global Constraints

- Read `CLAUDE.md` first. **Claude never runs `git commit`** (nor `git mv`, `git stash`, `git checkout`). Each task ends by staging named files and printing a suggested Conventional Commit; Ciaran commits.
- **No migration, no Alembic command.**
- Run backend pytest in the **foreground** only (`cd backend && pytest …`). A background run races the Stop hook and drops the test schema.
- Layering: `api/` → `orchestration/` → `integrations/`, `db/`, `core/`. `db/` imports nothing from `app/`. Dev endpoints stay thin.
- Every new dev route is behind the existing guards: registered only when `move_truck_enabled()` (`DEV_PANEL_ENABLED` **and** `PULSE_USE_MOCK`), and every route depends on `get_current_dispatcher` and is scoped to the caller's organisation.
- Frontend: no `any`, explicit prop interfaces, `"use client"` only where hooks are used, typed `api` client only.
- Comment the *why*. No magic numbers: every threshold is a named constant with its reason.
- Shared files touched (flag in TASK COMPLETE): `backend/app/db/models/enums.py`, `backend/app/main.py`, `frontend/shared/lib/types/exception.ts`, `frontend/shared/lib/constants/status-meta.ts`.
- Do not touch `backend/scripts/seed_demo.py` (Ciaran has uncommitted changes in it).

## File map

| File | Change |
|---|---|
| `backend/app/db/models/enums.py` | 3 new `ExceptionType` values |
| `backend/app/orchestration/road_check_service.py` | **Create** — pure rules, rig loader, DB writer |
| `backend/app/orchestration/dev_rig_service.py` | **Create** — stage a rig scenario into the Pulsit mock |
| `backend/app/schemas/dev.py` | `DevVehicle`, new stop/summary fields, rig and road-check request/response models |
| `backend/app/api/v1/endpoints/dev_triggers.py` | `GET /dev/trips` gains arrival/unloading status, current stop, vehicles |
| `backend/app/api/v1/endpoints/dev_tracker.py` | **Create** — `POST /dev/tracker/scenario`, `POST /dev/tracker/check` |
| `backend/app/main.py` | Register `dev_tracker` router under `move_truck_enabled()` |
| `backend/tests/unit/test_road_check_service.py` | **Create** |
| `backend/tests/unit/test_dev_rig_service.py` | **Create** |
| `backend/tests/integration/test_road_check.py` | **Create** |
| `backend/tests/integration/test_dev_tracker.py` | **Create** |
| `backend/tests/integration/test_dev_triggers.py` | Summary field tests |
| `frontend/shared/lib/types/exception.ts`, `frontend/shared/lib/constants/status-meta.ts` | New types |
| `frontend/dispatcher/lib/format/exception.ts` | Labels for the new types |
| `frontend/dispatcher/lib/types/dev.ts` | Mirror new backend shapes |
| `frontend/dispatcher/lib/dev/demo-stage.ts` (+ test) | **Create** — stage derivation, scan gating, picker order |
| `frontend/dispatcher/lib/dev/presets.ts` (+ test) | **Create** — scan and PP presets, road-check summary text |
| `frontend/dispatcher/lib/hooks/useDevTriggers.ts` | Rig scenario, road check, activity log |
| `frontend/dispatcher/components/dev/AllControls.tsx` (+ test) | **Create** from the old panel, minus trip picker, header, waypoints, reset |
| `frontend/dispatcher/components/dev/{StageHeader,TripPicker,WarehouseActions,TrackerActions,ParcelPerfectActions,ActivityLog}.tsx` | **Create** |
| `frontend/dispatcher/components/dev/DevTriggerPanel.tsx` (+ test) | **Rewrite** as the composition |
| `docs/demo-script.md`, the design note | Docs |

---

### Task 1: Exception types and the pure road rules

**Files:**
- Modify: `backend/app/db/models/enums.py` (inside `ExceptionType`, directly after `TRAILER_LOCATION_MISMATCH`)
- Create: `backend/app/orchestration/road_check_service.py`
- Test: `backend/tests/unit/test_road_check_service.py`

**Interfaces — Produces:**
- `ExceptionType.TRAILER_SEPARATED_IN_TRANSIT`, `.MOVED_BEFORE_DEPARTURE`, `.TRACKER_SILENT`
- `RigRole(str, Enum)`: `HORSE`, `TRAILER`
- `RigReading(vehicle_id, registration, role, status: PulsitFixStatus, lat: Decimal | None, lng: Decimal | None)`
- `RoadStage(current_phase_event_id, trip_stop_id, on_road: bool, pending_departure_id, stop_precinct: Precinct | None)`
- `RoadFinding(exception_type, severity, phase_event_id, trip_stop_id, vehicle_id, description, lat, lng)`
- `evaluate_road_readings(*, stage, readings, max_separation_metres) -> list[RoadFinding]`

- [ ] **Step 1: Write the failing tests** — `backend/tests/unit/test_road_check_service.py`:

```python
"""Pure road rules: no DB, no Pulsit, no Redis."""

import uuid
from decimal import Decimal

from app.db.models.enums import ExceptionSeverity, ExceptionType
from app.db.models.organisations import Precinct
from app.integrations.pulsit import PulsitFixStatus
from app.orchestration.road_check_service import (
    RigReading,
    RigRole,
    RoadStage,
    evaluate_road_readings,
)

_MAX_SEPARATION = 500.0
# ~1.1 km of latitude per 0.01 degree: far enough to exceed the 500 m threshold.
_ORIGIN = (Decimal("-33.9249000"), Decimal("18.4241000"))
_NEAR = (Decimal("-33.9250000"), Decimal("18.4241000"))    # ~11 m from origin
_FAR = (Decimal("-33.9349000"), Decimal("18.4241000"))     # ~1.1 km from origin


def _reading(role: RigRole, position: tuple[Decimal, Decimal] | None, *,
             status: PulsitFixStatus = PulsitFixStatus.OK, registration: str = "CA 1") -> RigReading:
    return RigReading(
        vehicle_id=uuid.uuid4(), registration=registration, role=role,
        status=status if position is not None or status is not PulsitFixStatus.OK else PulsitFixStatus.NO_FIX,
        lat=position[0] if position else None, lng=position[1] if position else None,
    )


def _on_road() -> RoadStage:
    return RoadStage(
        current_phase_event_id=uuid.uuid4(), trip_stop_id=uuid.uuid4(),
        on_road=True, pending_departure_id=None, stop_precinct=None,
    )


def _at_origin() -> RoadStage:
    precinct = Precinct(
        id=uuid.uuid4(), name="Cape Town DC", principal_organization_id=uuid.uuid4(),
        latitude=_ORIGIN[0], longitude=_ORIGIN[1], geofence_radius_metres=200,
    )
    return RoadStage(
        current_phase_event_id=uuid.uuid4(), trip_stop_id=uuid.uuid4(),
        on_road=False, pending_departure_id=uuid.uuid4(), stop_precinct=precinct,
    )


def test_trailer_far_from_horse_on_road_is_critical_separation():
    stage = _on_road()
    trailer = _reading(RigRole.TRAILER, _FAR, registration="TRL 222")

    findings = evaluate_road_readings(
        stage=stage, readings=[_reading(RigRole.HORSE, _ORIGIN), trailer],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert [f.exception_type for f in findings] == [ExceptionType.TRAILER_SEPARATED_IN_TRANSIT]
    finding = findings[0]
    assert finding.severity == ExceptionSeverity.CRITICAL
    assert finding.phase_event_id == stage.current_phase_event_id
    assert finding.vehicle_id == trailer.vehicle_id
    assert (finding.lat, finding.lng) == _FAR
    assert "TRL 222" in finding.description


def test_trailer_within_threshold_raises_nothing():
    findings = evaluate_road_readings(
        stage=_on_road(),
        readings=[_reading(RigRole.HORSE, _ORIGIN), _reading(RigRole.TRAILER, _NEAR)],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert findings == []


def test_no_horse_position_means_no_separation_verdict():
    findings = evaluate_road_readings(
        stage=_on_road(),
        readings=[_reading(RigRole.HORSE, None), _reading(RigRole.TRAILER, _FAR)],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert [f.exception_type for f in findings] == [ExceptionType.TRACKER_SILENT]


def test_silent_tracker_is_a_warning_on_the_current_phase():
    stage = _on_road()
    silent = _reading(RigRole.TRAILER, None, registration="TRL 333")

    findings = evaluate_road_readings(
        stage=stage, readings=[_reading(RigRole.HORSE, _ORIGIN), silent],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert len(findings) == 1
    assert findings[0].exception_type == ExceptionType.TRACKER_SILENT
    assert findings[0].severity == ExceptionSeverity.WARNING
    assert findings[0].vehicle_id == silent.vehicle_id
    assert findings[0].phase_event_id == stage.current_phase_event_id
    assert (findings[0].lat, findings[0].lng) == (None, None)


def test_unknown_device_raises_nothing():
    findings = evaluate_road_readings(
        stage=_on_road(),
        readings=[
            _reading(RigRole.HORSE, _ORIGIN),
            _reading(RigRole.TRAILER, None, status=PulsitFixStatus.UNKNOWN_DEVICE),
        ],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert findings == []


def test_horse_outside_stop_before_departure_is_critical():
    stage = _at_origin()
    horse = _reading(RigRole.HORSE, _FAR, registration="CA 123")

    findings = evaluate_road_readings(stage=stage, readings=[horse], max_separation_metres=_MAX_SEPARATION)

    assert [f.exception_type for f in findings] == [ExceptionType.MOVED_BEFORE_DEPARTURE]
    assert findings[0].severity == ExceptionSeverity.CRITICAL
    assert findings[0].phase_event_id == stage.pending_departure_id
    assert findings[0].vehicle_id == horse.vehicle_id
    assert "Cape Town DC" in findings[0].description


def test_horse_inside_stop_before_departure_raises_nothing():
    findings = evaluate_road_readings(
        stage=_at_origin(), readings=[_reading(RigRole.HORSE, _NEAR)],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert findings == []


def test_separation_rule_does_not_run_at_a_stop():
    stage = _at_origin()

    findings = evaluate_road_readings(
        stage=stage,
        readings=[_reading(RigRole.HORSE, _NEAR), _reading(RigRole.TRAILER, _FAR)],
        max_separation_metres=_MAX_SEPARATION,
    )

    # Trailer separation at a stop is TRAILER_LOCATION_MISMATCH's job (phase_service).
    assert findings == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && pytest tests/unit/test_road_check_service.py -v`
Expected: FAIL — `ModuleNotFoundError: app.orchestration.road_check_service`.

- [ ] **Step 3: Add the enum values** — in `ExceptionType`, directly after `TRAILER_LOCATION_MISMATCH`:

```python
    # On the ROAD, not at a stop: a trailer tracker is further than
    # TRAILER_HORSE_MAX_SEPARATION_METRES from its horse's tracker while the trip is
    # on an in-transit leg. No fence is involved, which is what keeps it apart from
    # TRAILER_LOCATION_MISMATCH (trailer vs the stop's precinct). See road_check_service.
    TRAILER_SEPARATED_IN_TRANSIT = "trailer_separated_in_transit"
    # The horse's tracker is outside its stop's precinct while that stop's departure is
    # still pending: the truck moved without a recorded seal. See road_check_service.
    MOVED_BEFORE_DEPARTURE = "moved_before_departure"
    # A known tracker returned no position. A gap in the record, not a verdict: nothing
    # else is inferred from it. See road_check_service.
    TRACKER_SILENT = "tracker_silent"
```

- [ ] **Step 4: Create `backend/app/orchestration/road_check_service.py`** with the pure half:

```python
"""On-road tracker check — records road incidents the stop-phase checks cannot see.

Stop phases read the trackers only when the driver completes a phase at a precinct, so
between stops nothing looked: a trailer uncoupled on the N1 stayed invisible until
arrival. This module reads the horse and every trailer once, on demand, and records
SYSTEM exceptions for three findings (design note 2026-09-23 §4.7).

Two halves. evaluate_road_readings is pure: no I/O, exhaustively unit-tested.
check_trip_on_road loads state, calls it, and writes each finding at most once.

Recording, not responding: nothing here advances a phase, holds a trip or contacts
anyone. NULL never raises a verdict: a missing reading is its own finding
(TRACKER_SILENT) or nothing, never a pass or a fail of another rule.

Called by the dev tracker endpoint today. A scheduler would call check_trip_on_road
unchanged once live Pulsit credentials exist.
"""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

from app.core.geo import haversine_metres
from app.db.models.enums import ExceptionSeverity, ExceptionType
from app.db.models.organisations import Precinct
from app.integrations.pulsit import PulsitFixStatus
from app.orchestration.geofence_service import TrackerFix, evaluate_geofence

logger = logging.getLogger(__name__)

# Below 1 km a distance reads better in metres. Same rule as phase_service's
# _format_separation, so the stop and road trailer findings word distance alike.
_KM_THRESHOLD_METRES = 1_000.0


class RigRole(str, Enum):
    HORSE = "horse"
    TRAILER = "trailer"


@dataclass(frozen=True)
class RigReading:
    """One tracker read for one vehicle on the trip."""

    vehicle_id: uuid.UUID
    registration: str
    role: RigRole
    status: PulsitFixStatus
    lat: Decimal | None
    lng: Decimal | None


@dataclass(frozen=True)
class RoadStage:
    """Where the trip is, reduced to what the three rules need.

    on_road: the current phase is an in-transit leg (current_phase_event_id is that leg).
    pending_departure_id / stop_precinct: set only when the truck is at a stop whose
    departure is still ahead — the one situation in which leaving the fence is a finding.
    """

    current_phase_event_id: uuid.UUID
    trip_stop_id: uuid.UUID | None
    on_road: bool
    pending_departure_id: uuid.UUID | None
    stop_precinct: Precinct | None


@dataclass(frozen=True)
class RoadFinding:
    exception_type: ExceptionType
    severity: ExceptionSeverity
    phase_event_id: uuid.UUID
    trip_stop_id: uuid.UUID | None
    vehicle_id: uuid.UUID
    description: str
    lat: Decimal | None
    lng: Decimal | None


def _position(reading: RigReading) -> tuple[Decimal, Decimal] | None:
    # Explicit None checks rather than a property, so mypy can narrow the Decimals.
    if reading.status is not PulsitFixStatus.OK or reading.lat is None or reading.lng is None:
        return None
    return reading.lat, reading.lng


def _fmt_distance(metres: float) -> str:
    if metres < _KM_THRESHOLD_METRES:
        return f"{round(metres)} m"
    return f"{metres / _KM_THRESHOLD_METRES:.1f} km"


def evaluate_road_readings(
    *,
    stage: RoadStage,
    readings: Sequence[RigReading],
    max_separation_metres: float,
) -> list[RoadFinding]:
    """Every finding these readings support at this stage. Pure; never raises."""
    findings: list[RoadFinding] = []

    for reading in readings:
        # NO_FIX only: a known tracker that went dark. UNKNOWN_DEVICE means it was never
        # configured or staged — raising on it would flag every untouched trailer.
        if reading.status is PulsitFixStatus.NO_FIX:
            findings.append(RoadFinding(
                exception_type=ExceptionType.TRACKER_SILENT,
                severity=ExceptionSeverity.WARNING,
                phase_event_id=stage.current_phase_event_id,
                trip_stop_id=stage.trip_stop_id,
                vehicle_id=reading.vehicle_id,
                description=f"The tracker on {reading.role.value} {reading.registration} returned no position.",
                lat=None, lng=None,
            ))

    horse = next((r for r in readings if r.role is RigRole.HORSE), None)
    horse_position = _position(horse) if horse is not None else None
    if horse is None or horse_position is None:
        # Both remaining rules measure against the horse. Without its fix there is
        # nothing to compare, and "could not check" must not read as a verdict.
        return findings

    if stage.on_road:
        for trailer in readings:
            trailer_position = _position(trailer)
            if trailer.role is not RigRole.TRAILER or trailer_position is None:
                continue
            separation = haversine_metres(*trailer_position, *horse_position)
            if separation > max_separation_metres:
                findings.append(RoadFinding(
                    exception_type=ExceptionType.TRAILER_SEPARATED_IN_TRANSIT,
                    severity=ExceptionSeverity.CRITICAL,
                    phase_event_id=stage.current_phase_event_id,
                    trip_stop_id=stage.trip_stop_id,
                    vehicle_id=trailer.vehicle_id,
                    # Registrations identify vehicles, not people, so they may be named.
                    description=(
                        f"On the road, trailer {trailer.registration} is "
                        f"{_fmt_distance(separation)} from horse {horse.registration}. "
                        f"The trailer may have been uncoupled."
                    ),
                    lat=trailer_position[0], lng=trailer_position[1],
                ))
    elif stage.pending_departure_id is not None and stage.stop_precinct is not None:
        verdict = evaluate_geofence(
            TrackerFix(lat=horse_position[0], lng=horse_position[1]), stage.stop_precinct,
        )
        # distance_metres is None when nothing was measured; only a measured "outside" counts.
        if not verdict.confirmed and verdict.distance_metres is not None:
            findings.append(RoadFinding(
                exception_type=ExceptionType.MOVED_BEFORE_DEPARTURE,
                severity=ExceptionSeverity.CRITICAL,
                phase_event_id=stage.pending_departure_id,
                trip_stop_id=stage.trip_stop_id,
                vehicle_id=horse.vehicle_id,
                description=(
                    f"Horse {horse.registration} is {_fmt_distance(verdict.distance_metres)} "
                    f"from {stage.stop_precinct.name}, but departure has not been recorded. "
                    f"The truck moved without a recorded seal."
                ),
                lat=horse_position[0], lng=horse_position[1],
            ))

    return findings
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd backend && pytest tests/unit/test_road_check_service.py -v`
Expected: 8 PASS. If `_reading`'s status expression reads awkwardly to the implementer, simplify it: `status=PulsitFixStatus.NO_FIX if position is None and status is PulsitFixStatus.OK else status`. The behaviour the tests need is: a `None` position with default status becomes `NO_FIX`; an explicit `UNKNOWN_DEVICE` stays.

- [ ] **Step 6: Stage**

```bash
git add backend/app/db/models/enums.py backend/app/orchestration/road_check_service.py backend/tests/unit/test_road_check_service.py
```
Suggested commit: `feat(orchestration): on-road tracker rules and three road exception types`

---

### Task 2: Road check writer

**Files:**
- Modify: `backend/app/orchestration/road_check_service.py` (append)
- Test: `backend/tests/integration/test_road_check.py`

**Interfaces:**
- Consumes: Task 1; `phase_service.current_phase_event(db, trip_id) -> PhaseEvent | None`; `exception_service.initial_review_status(severity)`; `pulsit.get_pulsit_client(organization_id=...)`; `core.realtime.enqueue_event`, `TripEvent`, `RealtimeKind.EXCEPTION_RAISED`, `event_severity`.
- Produces:
  - `RigVehicle(vehicle_id, registration, role, device_id)` and `async load_rig(db, *, trip) -> list[RigVehicle]` (horse first, then trailers by registration)
  - `RoadCheckResult(readings: list[RigReading], recorded: list[RoadFinding], already_recorded: list[RoadFinding], skipped_reason: str | None)`
  - `async check_trip_on_road(db, *, trip) -> RoadCheckResult`

- [ ] **Step 1: Write the failing tests** — `backend/tests/integration/test_road_check.py`:

```python
"""check_trip_on_road against a real test DB and the Pulsit mock (fake Redis store)."""

import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.config import settings
from app.core.realtime import EventSeverity, RealtimeKind
from app.db.models.enums import (
    ExceptionSeverity, ExceptionSource, ExceptionType, IdvsStatus, OrganizationType,
    PhaseStatus, PhaseType, TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.integrations import pulsit as pulsit_module
from app.integrations.pulsit import get_pulsit_client
from app.orchestration.road_check_service import check_trip_on_road
from tests.conftest import FakeMockStateStore

_ORIGIN = (Decimal("-33.9249000"), Decimal("18.4241000"))
_DEST = (Decimal("-33.7342000"), Decimal("18.9621000"))
_MID = (Decimal("-33.8295500"), Decimal("18.6931000"))
_FAR_FROM_MID = (Decimal("-33.8795500"), Decimal("18.6931000"))  # ~5.6 km south of _MID
_PLAN = [
    (PhaseType.TRIP_CREATION, None), (PhaseType.ACTIVATION, 0), (PhaseType.LOADING, 0),
    (PhaseType.DEPARTURE, 0), (PhaseType.IN_TRANSIT, 0), (PhaseType.ARRIVAL, 1),
    (PhaseType.UNLOADING, 1), (PhaseType.CONFIRMATION, 1),
]


@pytest.fixture(autouse=True)
def mock_pulsit(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    fake = FakeMockStateStore()
    monkeypatch.setattr(pulsit_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", True)
    return fake


async def _seed(db_session, *, completed_through: PhaseType) -> dict:
    """A single-leg trip with one trailer; every phase up to `completed_through` completed."""
    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4().hex[:6]}@t.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number=f"DRV-{uuid.uuid4().hex[:4]}",
    )
    horse = Vehicle(id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
                    registration="CA 100-000", pulsit_device_id=f"H-{uuid.uuid4().hex[:8]}")
    trailer = Vehicle(id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.TRAILER,
                      registration="TRL 222", pulsit_device_id=f"T-{uuid.uuid4().hex[:8]}")
    origin = Precinct(id=uuid.uuid4(), name="Cape Town DC", principal_organization_id=org.id,
                      latitude=_ORIGIN[0], longitude=_ORIGIN[1], geofence_radius_metres=200)
    dest = Precinct(id=uuid.uuid4(), name="Paarl Depot", principal_organization_id=org.id,
                    latitude=_DEST[0], longitude=_DEST[1], geofence_radius_metres=200)
    db_session.add_all([user, driver, horse, trailer, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    stops = [
        TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=origin.id, sequence=0),
        TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=dest.id, sequence=1),
    ]
    db_session.add_all(stops)
    db_session.add(TripTrailer(trip_id=trip.id, trailer_id=trailer.id, pulsit_device_id_snapshot=trailer.pulsit_device_id))
    await db_session.flush()
    phases: dict[PhaseType, PhaseEvent] = {}
    done = True
    for sequence, (phase_type, stop_index) in enumerate(_PLAN):
        phases[phase_type] = PhaseEvent(
            id=uuid.uuid4(), trip_id=trip.id, phase_type=phase_type, sequence_number=sequence,
            trip_stop_id=stops[stop_index].id if stop_index is not None else None,
            status=PhaseStatus.COMPLETED if done else PhaseStatus.PENDING,
        )
        if phase_type == completed_through:
            done = False
    db_session.add_all(phases.values())
    await db_session.flush()
    return {"trip": trip, "horse": horse, "trailer": trailer, "phases": phases}


async def _stage(trip: Trip, device_id: str, position: tuple[Decimal, Decimal] | None) -> None:
    client = get_pulsit_client(organization_id=trip.operator_organization_id)
    if position is None:
        await client.stage_no_fix(device_id)
    else:
        await client.stage_position(device_id, lat=position[0], lng=position[1])


async def _exceptions(db_session, trip_id: uuid.UUID) -> list[TripException]:
    return list((await db_session.execute(
        select(TripException).where(TripException.trip_id == trip_id)
    )).scalars().all())


async def test_uncoupled_trailer_on_road_records_one_system_exception(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)
    await _stage(seed["trip"], seed["horse"].pulsit_device_id, _MID)
    await _stage(seed["trip"], seed["trailer"].pulsit_device_id, _FAR_FROM_MID)

    result = await check_trip_on_road(db_session, trip=seed["trip"])

    rows = await _exceptions(db_session, seed["trip"].id)
    assert [r.exception_type for r in rows] == [ExceptionType.TRAILER_SEPARATED_IN_TRANSIT]
    row = rows[0]
    assert row.source == ExceptionSource.SYSTEM
    assert row.severity == ExceptionSeverity.CRITICAL
    assert row.phase_event_id == seed["phases"][PhaseType.IN_TRANSIT].id
    assert row.vehicle_id == seed["trailer"].id
    assert (row.gps_lat, row.gps_lng) == _FAR_FROM_MID
    assert len(result.recorded) == 1 and result.already_recorded == []


async def test_running_the_check_twice_records_once(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)
    await _stage(seed["trip"], seed["horse"].pulsit_device_id, _MID)
    await _stage(seed["trip"], seed["trailer"].pulsit_device_id, _FAR_FROM_MID)

    await check_trip_on_road(db_session, trip=seed["trip"])
    second = await check_trip_on_road(db_session, trip=seed["trip"])

    assert len(await _exceptions(db_session, seed["trip"].id)) == 1
    assert second.recorded == [] and len(second.already_recorded) == 1


async def test_recorded_finding_publishes_critical_realtime_event(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)
    await _stage(seed["trip"], seed["horse"].pulsit_device_id, _MID)
    await _stage(seed["trip"], seed["trailer"].pulsit_device_id, _FAR_FROM_MID)

    await check_trip_on_road(db_session, trip=seed["trip"])

    events = [e for _org, e in db_session.info.get("realtime_outbox", []) if e.kind == RealtimeKind.EXCEPTION_RAISED]
    assert len(events) == 1
    assert events[0].severity == EventSeverity.CRITICAL


async def test_truck_away_from_origin_before_departure_is_recorded_on_departure(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.LOADING)
    await _stage(seed["trip"], seed["horse"].pulsit_device_id, _MID)
    await _stage(seed["trip"], seed["trailer"].pulsit_device_id, _MID)

    await check_trip_on_road(db_session, trip=seed["trip"])

    rows = await _exceptions(db_session, seed["trip"].id)
    assert [r.exception_type for r in rows] == [ExceptionType.MOVED_BEFORE_DEPARTURE]
    assert rows[0].phase_event_id == seed["phases"][PhaseType.DEPARTURE].id


async def test_closed_trip_is_skipped(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.CONFIRMATION)
    seed["trip"].status = TripStatus.CLOSED
    await db_session.flush()

    result = await check_trip_on_road(db_session, trip=seed["trip"])

    assert result.skipped_reason is not None
    assert await _exceptions(db_session, seed["trip"].id) == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && pytest tests/integration/test_road_check.py -v`
Expected: FAIL — `ImportError: cannot import name 'check_trip_on_road'`.

- [ ] **Step 3: Append the writer to `road_check_service.py`** and add these imports at the top of the file:

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import ExceptionSource, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.integrations.pulsit import get_pulsit_client
from app.orchestration.exception_service import initial_review_status
from app.orchestration.phase_service import current_phase_event
```

(merge with the existing `from app.db.models.enums import ...` line rather than duplicating it).

```python
# A finished trip has no road left to watch.
_SKIPPED_STATUSES = frozenset({TripStatus.CLOSED, TripStatus.CANCELLED})


@dataclass(frozen=True)
class RigVehicle:
    vehicle_id: uuid.UUID
    registration: str
    role: RigRole
    device_id: str


@dataclass(frozen=True)
class RoadCheckResult:
    readings: list[RigReading]
    recorded: list[RoadFinding]
    already_recorded: list[RoadFinding]
    skipped_reason: str | None


async def load_rig(db: AsyncSession, *, trip: Trip) -> list[RigVehicle]:
    """The horse, then each trailer by registration.

    Trailer device ids come from TripTrailer.pulsit_device_id_snapshot, as in
    corroboration_service: the tracker that was on the trailer when the trip was
    committed, not whatever the vehicle row says now.
    """
    horse = (await db.execute(select(Vehicle).where(Vehicle.id == trip.horse_id))).scalar_one()
    trailer_rows = (await db.execute(
        select(Vehicle, TripTrailer.pulsit_device_id_snapshot)
        .join(TripTrailer, TripTrailer.trailer_id == Vehicle.id)
        .where(TripTrailer.trip_id == trip.id)
        .order_by(Vehicle.registration)
    )).all()
    return [
        RigVehicle(horse.id, horse.registration, RigRole.HORSE, horse.pulsit_device_id),
        *(RigVehicle(v.id, v.registration, RigRole.TRAILER, device) for v, device in trailer_rows),
    ]


async def _road_stage(db: AsyncSession, *, current: PhaseEvent) -> RoadStage:
    if current.phase_type == PhaseType.IN_TRANSIT:
        return RoadStage(current.id, current.trip_stop_id, True, None, None)
    if current.trip_stop_id is None:
        # trip_creation: no stop, so no fence to have left.
        return RoadStage(current.id, None, False, None, None)
    next_departure = (await db.execute(
        select(PhaseEvent)
        .where(
            PhaseEvent.trip_id == current.trip_id,
            PhaseEvent.phase_type == PhaseType.DEPARTURE,
            PhaseEvent.sequence_number >= current.sequence_number,
        )
        .order_by(PhaseEvent.sequence_number)
        .limit(1)
    )).scalar_one_or_none()
    # Only a departure from THIS stop makes leaving the fence a finding. At the final
    # stop there is no departure ahead; the truck may leave once confirmation is done.
    if next_departure is None or next_departure.trip_stop_id != current.trip_stop_id:
        return RoadStage(current.id, current.trip_stop_id, False, None, None)
    precinct = (await db.execute(
        select(Precinct).join(TripStop, TripStop.precinct_id == Precinct.id)
        .where(TripStop.id == current.trip_stop_id)
    )).scalar_one()
    return RoadStage(current.id, current.trip_stop_id, False, next_departure.id, precinct)


async def _already_recorded(db: AsyncSession, *, trip_id: uuid.UUID, finding: RoadFinding) -> bool:
    existing = (await db.execute(
        select(TripException.id).where(
            TripException.trip_id == trip_id,
            TripException.phase_event_id == finding.phase_event_id,
            TripException.exception_type == finding.exception_type,
            TripException.vehicle_id == finding.vehicle_id,
        ).limit(1)
    )).first()
    return existing is not None


async def check_trip_on_road(db: AsyncSession, *, trip: Trip) -> RoadCheckResult:
    """Read every tracker on the trip once and record what the readings support.

    Once per (phase, type, vehicle): the check can be run as often as the presenter
    likes, and a real scheduler could run it every few minutes, without flooding the
    dispatcher with the same finding. Two checks racing on one trip could both write;
    acceptable for an on-demand dev trigger, and a scheduler would need a lock.
    """
    if TripStatus(trip.status) in _SKIPPED_STATUSES:
        return RoadCheckResult([], [], [], f"Trip is {trip.status}.")
    current = await current_phase_event(db, trip.id)
    if current is None:
        return RoadCheckResult([], [], [], "Trip has no phase plan.")

    rig = await load_rig(db, trip=trip)
    client = get_pulsit_client(organization_id=trip.operator_organization_id)
    fixes = await client.get_positions([v.device_id for v in rig])
    readings = [
        RigReading(v.vehicle_id, v.registration, v.role, fix.status, fix.lat, fix.lng)
        for v, fix in zip(rig, fixes, strict=True)
    ]

    stage = await _road_stage(db, current=current)
    findings = evaluate_road_readings(
        stage=stage, readings=readings,
        max_separation_metres=settings.TRAILER_HORSE_MAX_SEPARATION_METRES,
    )

    recorded: list[RoadFinding] = []
    already: list[RoadFinding] = []
    for finding in findings:
        if await _already_recorded(db, trip_id=trip.id, finding=finding):
            already.append(finding)
            continue
        db.add(TripException(
            trip_id=trip.id,
            phase_event_id=finding.phase_event_id,
            trip_stop_id=finding.trip_stop_id,
            exception_type=finding.exception_type,
            source=ExceptionSource.SYSTEM,
            severity=finding.severity,
            review_status=initial_review_status(finding.severity),
            description=finding.description,
            gps_lat=finding.lat,
            gps_lng=finding.lng,
            vehicle_id=finding.vehicle_id,
        ))
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED, severity=event_severity(finding.severity)),
        )
        logger.info(
            "Road check recorded %s for trip_id=%s vehicle_id=%s",
            finding.exception_type.value, trip.id, finding.vehicle_id,
        )
        recorded.append(finding)
    await db.flush()
    return RoadCheckResult(readings, recorded, already, None)
```

If importing `exception_service` or `phase_service` at module scope causes a circular import, move those two imports inside `check_trip_on_road`, with a comment naming the cycle (same pattern as `phase_service._initial_review_status`).

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && pytest tests/integration/test_road_check.py tests/unit/test_road_check_service.py -v`
Expected: all PASS.

- [ ] **Step 5: Stage**

```bash
git add backend/app/orchestration/road_check_service.py backend/tests/integration/test_road_check.py
```
Suggested commit: `feat(orchestration): record on-road tracker findings once per leg`

---

### Task 3: Rig scenarios and the `/dev/tracker` router

**Files:**
- Modify: `backend/app/schemas/dev.py` (append)
- Create: `backend/app/orchestration/dev_rig_service.py`
- Create: `backend/app/api/v1/endpoints/dev_tracker.py`
- Modify: `backend/app/main.py` (router registration, next to `dev_pulsit_router`)
- Test: `backend/tests/unit/test_dev_rig_service.py`, `backend/tests/integration/test_dev_tracker.py`

**Interfaces:**
- Consumes: `road_check_service.load_rig`, `check_trip_on_road`, `RoadCheckResult`, `RigRole`; `dev_truck_service.resolve_target_stop`, `build_scenario_target`, `destination_point`, `TargetGeometryUnavailableError`; `schemas.dev.SCENARIO_AT_STOP`, `SCENARIO_THREE_KM`; `dev_pulsit.move_truck_enabled`.
- Produces:
  - `RigScenario = Literal["at_stop", "away_from_stop", "en_route", "left_before_departure", "trailer_uncoupled", "silent"]`
  - `RigScenarioRequest`, `RoadCheckRequest`, `RigReadingRead`, `RoadFindingRead`, `RoadCheckResponse`, `RigScenarioResponse`
  - `dev_rig_service.midpoint`, `uncoupled_offset_metres`, `ScenarioNotApplicableError`, `async stage_rig_scenario(db, *, client, trip, scenario, trip_stop_id, vehicle_id) -> str`
  - `POST /api/v1/dev/tracker/scenario`, `POST /api/v1/dev/tracker/check`

- [ ] **Step 1: Write the failing unit tests** — `backend/tests/unit/test_dev_rig_service.py`:

```python
from decimal import Decimal

from app.orchestration.dev_rig_service import (
    UNCOUPLED_TRAILER_MIN_OFFSET_METRES,
    midpoint,
    uncoupled_offset_metres,
)


def test_midpoint_averages_and_keeps_seven_decimals():
    result = midpoint((Decimal("-33.9249000"), Decimal("18.4241000")), (Decimal("-33.7342000"), Decimal("18.9621000")))

    assert result == (Decimal("-33.8295500"), Decimal("18.6931000"))


def test_uncoupled_offset_is_at_least_the_floor():
    assert uncoupled_offset_metres(500.0) == UNCOUPLED_TRAILER_MIN_OFFSET_METRES


def test_uncoupled_offset_doubles_a_large_threshold():
    # A threshold raised in config must not silently break the demo scenario.
    assert uncoupled_offset_metres(4_000.0) == 8_000.0
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && pytest tests/unit/test_dev_rig_service.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Append schemas to `backend/app/schemas/dev.py`** (add `model_validator` to the pydantic import and `ExceptionType` to the enums import if absent):

```python
# ---------------------------------------------------------------------------
# Rig scenarios and the on-road tracker check (design note §4.7, stage S7)
# ---------------------------------------------------------------------------

RigScenario = Literal[
    "at_stop", "away_from_stop", "en_route", "left_before_departure", "trailer_uncoupled", "silent",
]
_NEEDS_STOP: frozenset[str] = frozenset({"at_stop", "away_from_stop"})
_NEEDS_VEHICLE: frozenset[str] = frozenset({"trailer_uncoupled", "silent"})


class RigScenarioRequest(BaseModel):
    """Stage every tracker on a trip for one named scenario, then run the road check."""

    model_config = ConfigDict(extra="forbid")

    trip_id: uuid.UUID
    scenario: RigScenario
    trip_stop_id: Optional[uuid.UUID] = None
    vehicle_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def _required_context(self) -> "RigScenarioRequest":
        if self.scenario in _NEEDS_STOP and self.trip_stop_id is None:
            raise ValueError(f"trip_stop_id is required for {self.scenario}")
        if self.scenario in _NEEDS_VEHICLE and self.vehicle_id is None:
            raise ValueError(f"vehicle_id is required for {self.scenario}")
        return self


class RoadCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trip_id: uuid.UUID


class RigReadingRead(BaseModel):
    vehicle_id: uuid.UUID
    registration: str
    role: Literal["horse", "trailer"]
    status: str
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None


class RoadFindingRead(BaseModel):
    exception_type: ExceptionType
    severity: str
    vehicle_id: uuid.UUID
    description: str
    # False when this run matched a finding already on record — shown, not re-written.
    newly_recorded: bool


class RoadCheckResponse(BaseModel):
    trip_id: uuid.UUID
    readings: list[RigReadingRead]
    findings: list[RoadFindingRead]
    skipped_reason: Optional[str] = None


class RigScenarioResponse(RoadCheckResponse):
    scenario: RigScenario
    label: str
```

- [ ] **Step 4: Create `backend/app/orchestration/dev_rig_service.py`**

```python
"""Stage every tracker on a trip for one named demo scenario (Pulsit mock only).

A rig moves as one: horse and trailers are staged together unless the scenario is
exactly the case where they part. Positions are computed from THIS trip's own stops
(dev_truck_service geometry), never fixed coordinates.

Writes Pulsit mock state and nothing else. Any exception the room then sees is written
by road_check_service reading those positions, called separately by the endpoint.

Layering: orchestration → integrations (MockPulsitClient), db, schemas. Never api/.
"""

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import PhaseType
from app.db.models.organisations import Precinct
from app.db.models.trips import Trip, TripStop
from app.integrations.pulsit import MockPulsitClient
from app.orchestration import dev_truck_service
from app.orchestration.phase_service import current_phase_event
from app.orchestration.road_check_service import RigRole, RigVehicle, load_rig
from app.schemas.dev import SCENARIO_AT_STOP, SCENARIO_THREE_KM, RigScenario

# 5 km: unmistakably apart on the dispatcher's map, and ten times the default 500 m
# separation threshold, so the scenario still trips the rule if the threshold is tuned.
UNCOUPLED_TRAILER_MIN_OFFSET_METRES = 5_000.0
_COORDINATE_SCALE = Decimal("0.0000001")  # Numeric(10,7), same as precinct columns


class ScenarioNotApplicableError(Exception):
    """The scenario does not fit where the trip is, e.g. en_route while still loading."""


def midpoint(a: tuple[Decimal, Decimal], b: tuple[Decimal, Decimal]) -> tuple[Decimal, Decimal]:
    # A straight average: for a leg of tens of kilometres it lands well clear of both
    # fences, which is all "driving normally" needs. It is not meant to be on a road.
    return (
        ((a[0] + b[0]) / 2).quantize(_COORDINATE_SCALE),
        ((a[1] + b[1]) / 2).quantize(_COORDINATE_SCALE),
    )


def uncoupled_offset_metres(max_separation_metres: float) -> float:
    return max(UNCOUPLED_TRAILER_MIN_OFFSET_METRES, 2 * max_separation_metres)


async def _stage_rig(client: MockPulsitClient, rig: list[RigVehicle], position: tuple[Decimal, Decimal]) -> None:
    for vehicle in rig:
        await client.stage_position(vehicle.device_id, lat=position[0], lng=position[1])


async def _stop_target(
    db: AsyncSession, *, trip: Trip, trip_stop_id: uuid.UUID, scenario: str,
) -> tuple[str, tuple[Decimal, Decimal]]:
    stop, precinct = await dev_truck_service.resolve_target_stop(db, trip_id=trip.id, trip_stop_id=trip_stop_id)
    target = dev_truck_service.build_scenario_target(
        trip_stop_id=stop.id, precinct=precinct, scenario=scenario,
        tolerance_metres=settings.GPS_TOLERANCE_METRES,
    )
    if target.latitude is None or target.longitude is None:
        raise ScenarioNotApplicableError(f"{precinct.name} has no usable coordinates.")
    return precinct.name, (target.latitude, target.longitude)


async def _current_leg(db: AsyncSession, *, trip: Trip) -> tuple[Precinct, Precinct]:
    current = await current_phase_event(db, trip.id)
    if current is None or current.phase_type != PhaseType.IN_TRANSIT or current.trip_stop_id is None:
        raise ScenarioNotApplicableError("The trip is not on the road.")
    rows = (await db.execute(
        select(TripStop, Precinct)
        .join(Precinct, Precinct.id == TripStop.precinct_id)
        .where(TripStop.trip_id == trip.id)
        .order_by(TripStop.sequence)
    )).all()
    index = next(i for i, (stop, _p) in enumerate(rows) if stop.id == current.trip_stop_id)
    if index + 1 >= len(rows):
        raise ScenarioNotApplicableError("The current leg has no next stop.")
    return rows[index][1], rows[index + 1][1]


async def stage_rig_scenario(
    db: AsyncSession,
    *,
    client: MockPulsitClient,
    trip: Trip,
    scenario: RigScenario,
    trip_stop_id: uuid.UUID | None,
    vehicle_id: uuid.UUID | None,
) -> str:
    """Stage the scenario and return a one-line label for the activity log.

    Raises ResourceNotFoundError (unknown stop or vehicle on this trip),
    ScenarioNotApplicableError (wrong stage), TargetGeometryUnavailableError (bad precinct).
    """
    rig = await load_rig(db, trip=trip)

    if scenario == "silent":
        target = next((v for v in rig if v.vehicle_id == vehicle_id), None)
        if target is None:
            raise ResourceNotFoundError("Vehicle", str(vehicle_id))
        await client.stage_no_fix(target.device_id)
        return f"Tracker on {target.role.value} {target.registration} went silent"

    if scenario in ("at_stop", "away_from_stop"):
        assert trip_stop_id is not None  # RigScenarioRequest guarantees it
        offset = SCENARIO_AT_STOP if scenario == "at_stop" else SCENARIO_THREE_KM
        name, position = await _stop_target(db, trip=trip, trip_stop_id=trip_stop_id, scenario=offset)
        await _stage_rig(client, rig, position)
        return f"Truck at {name}" if scenario == "at_stop" else f"Truck 3 km from {name}"

    if scenario == "left_before_departure":
        current = await current_phase_event(db, trip.id)
        if current is None or current.phase_type == PhaseType.IN_TRANSIT or current.trip_stop_id is None:
            raise ScenarioNotApplicableError("The truck can only leave early while it is at a stop.")
        name, position = await _stop_target(db, trip=trip, trip_stop_id=current.trip_stop_id, scenario=SCENARIO_THREE_KM)
        await _stage_rig(client, rig, position)
        return f"Truck left {name} before departure"

    origin, destination = await _current_leg(db, trip=trip)
    middle = midpoint((origin.latitude, origin.longitude), (destination.latitude, destination.longitude))

    if scenario == "en_route":
        await _stage_rig(client, rig, middle)
        return f"Truck driving from {origin.name} to {destination.name}"

    # trailer_uncoupled
    trailer = next((v for v in rig if v.vehicle_id == vehicle_id and v.role is RigRole.TRAILER), None)
    if trailer is None:
        raise ResourceNotFoundError("Trailer", str(vehicle_id))
    await _stage_rig(client, [v for v in rig if v.vehicle_id != trailer.vehicle_id], middle)
    left_at = dev_truck_service.destination_point(
        middle[0], middle[1],
        distance_metres=uncoupled_offset_metres(settings.TRAILER_HORSE_MAX_SEPARATION_METRES),
    )
    await client.stage_position(trailer.device_id, lat=left_at[0], lng=left_at[1])
    return f"Trailer {trailer.registration} uncoupled on the road"
```

Check `dev_truck_service.build_scenario_target`'s `scenario` parameter type (`DevTruckScenario`); pass the constants, which are members of it. If mypy objects to `scenario: str` in `_stop_target`, type that parameter as `DevTruckScenario` (import from `app.schemas.dev`).

- [ ] **Step 5: Create `backend/app/api/v1/endpoints/dev_tracker.py`**

```python
"""Dev-only rig scenarios and the on-road tracker check.

Separate from dev_pulsit.py because that file's rule is "writes Pulsit mock state and
nothing else" (tests/unit/test_dev_pulsit_writes_nothing.py). These routes stage mock
state AND then run the real road check, which records exceptions through
road_check_service — the same function a scheduler would call. The row a reviewer sees
was written by the check reading the trackers, never by this endpoint.

Registered under the same two guards as move-truck (dev_pulsit.move_truck_enabled).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import ResourceNotFoundError
from app.db.models.trips import Trip
from app.db.session import get_db
from app.integrations.pulsit import MockPulsitClient, get_pulsit_client
from app.orchestration import dev_rig_service, road_check_service
from app.orchestration.dev_truck_service import TargetGeometryUnavailableError
from app.schemas.dev import (
    RigReadingRead,
    RigScenarioRequest,
    RigScenarioResponse,
    RoadCheckRequest,
    RoadCheckResponse,
    RoadFindingRead,
)
from app.schemas.people import UserRead

router = APIRouter(prefix="/dev/tracker", tags=["dev-triggers"])

_MOCK_REQUIRED_DETAIL = "Rig scenarios require the Pulsit mock — check PULSE_USE_MOCK."


async def _load_trip(db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID) -> Trip:
    trip = (await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == organization_id)
    )).scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=f"Trip {trip_id} not found.")
    return trip


def _to_response(trip_id: uuid.UUID, result: road_check_service.RoadCheckResult) -> RoadCheckResponse:
    return RoadCheckResponse(
        trip_id=trip_id,
        readings=[
            RigReadingRead(
                vehicle_id=r.vehicle_id, registration=r.registration, role=r.role.value,
                status=r.status.value, latitude=r.lat, longitude=r.lng,
            )
            for r in result.readings
        ],
        findings=[
            RoadFindingRead(
                exception_type=f.exception_type, severity=f.severity.value, vehicle_id=f.vehicle_id,
                description=f.description, newly_recorded=newly,
            )
            for newly, group in ((True, result.recorded), (False, result.already_recorded))
            for f in group
        ],
        skipped_reason=result.skipped_reason,
    )


@router.post("/scenario", response_model=RigScenarioResponse, summary="Stage a rig scenario, then run the road check")
async def run_rig_scenario(
    body: RigScenarioRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> RigScenarioResponse:
    trip = await _load_trip(db, trip_id=body.trip_id, organization_id=current_user.organization_id)
    client = get_pulsit_client(organization_id=current_user.organization_id)
    if not isinstance(client, MockPulsitClient):
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL)
    try:
        label = await dev_rig_service.stage_rig_scenario(
            db, client=client, trip=trip, scenario=body.scenario,
            trip_stop_id=body.trip_stop_id, vehicle_id=body.vehicle_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (dev_rig_service.ScenarioNotApplicableError, TargetGeometryUnavailableError) as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    result = await road_check_service.check_trip_on_road(db, trip=trip)
    base = _to_response(trip.id, result)
    return RigScenarioResponse(**base.model_dump(), scenario=body.scenario, label=label)


@router.post("/check", response_model=RoadCheckResponse, summary="Run the on-road tracker check")
async def run_road_check(
    body: RoadCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> RoadCheckResponse:
    trip = await _load_trip(db, trip_id=body.trip_id, organization_id=current_user.organization_id)
    result = await road_check_service.check_trip_on_road(db, trip=trip)
    return _to_response(trip.id, result)
```

- [ ] **Step 6: Register the router in `backend/app/main.py`** (shared file). Add the import beside the dev_pulsit imports:

```python
from app.api.v1.endpoints.dev_tracker import router as dev_tracker_router
```

and extend the existing block:

```python
if move_truck_enabled():
    app.include_router(dev_pulsit_router, prefix="/api/v1")
    # Same two guards: rig scenarios stage the Pulsit mock too. See dev_tracker.py.
    app.include_router(dev_tracker_router, prefix="/api/v1")
```

- [ ] **Step 7: Write the integration tests** — `backend/tests/integration/test_dev_tracker.py`. Reuse the app/client harness pattern from `tests/integration/test_dev_pulsit.py` (module-scoped `pulsit_app` fixture that sets `DEV_PANEL_ENABLED`/`PULSE_USE_MOCK` and reloads `app.main`; `store` fixture patching `pulsit_module.get_mock_state_store`; `pulsit_client` fixture overriding `get_db` and `_get_jwks`). Copy those three fixtures verbatim into the new file. For the trip, import `_seed` from `tests.integration.test_road_check` (Task 2) and add a dispatcher token for the seeded org's user. Tests:

```python
_SCENARIO_URL = "/api/v1/dev/tracker/scenario"
_CHECK_URL = "/api/v1/dev/tracker/check"


def _token_for(seed) -> str:
    trip = seed["trip"]
    return make_token(sub=str(trip.created_by_user_id), role="dispatcher", org_id=str(trip.operator_organization_id))


def test_tracker_routes_absent_when_pulse_use_mock_is_off() -> None:
    with production_settings(ENVIRONMENT="development", DEV_PANEL_ENABLED=True, PULSE_USE_MOCK=False):
        try:
            importlib.reload(app_main)
            paths = [r.path for r in app_main.app.routes if isinstance(r, APIRoute)]
        finally:
            importlib.reload(app_main)
    assert _SCENARIO_URL not in paths and _CHECK_URL not in paths


async def test_scenario_requires_auth(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)

    resp = await pulsit_client.post(_SCENARIO_URL, json={"trip_id": str(seed["trip"].id), "scenario": "en_route"})

    # 403, not 401: a missing bearer is refused by HTTPBearer before auth runs — the same
    # code test_dev_triggers.test_list_trips_requires_auth pins for the other dev routes.
    assert resp.status_code == 403


async def test_trailer_uncoupled_records_critical_finding(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)

    resp = await pulsit_client.post(
        _SCENARIO_URL,
        json={"trip_id": str(seed["trip"].id), "scenario": "trailer_uncoupled", "vehicle_id": str(seed["trailer"].id)},
        headers=auth_header(_token_for(seed)),
    )

    assert resp.status_code == 200
    body = resp.json()
    assert [f["exception_type"] for f in body["findings"]] == ["trailer_separated_in_transit"]
    assert body["findings"][0]["newly_recorded"] is True
    rows = (await db_session.execute(select(TripException).where(TripException.trip_id == seed["trip"].id))).scalars().all()
    assert [r.source for r in rows] == [ExceptionSource.SYSTEM]


async def test_en_route_while_loading_is_409(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.ACTIVATION)

    resp = await pulsit_client.post(
        _SCENARIO_URL, json={"trip_id": str(seed["trip"].id), "scenario": "en_route"},
        headers=auth_header(_token_for(seed)),
    )

    assert resp.status_code == 409


async def test_at_stop_without_stop_is_422(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)

    resp = await pulsit_client.post(
        _SCENARIO_URL, json={"trip_id": str(seed["trip"].id), "scenario": "at_stop"},
        headers=auth_header(_token_for(seed)),
    )

    assert resp.status_code == 422


async def test_other_org_trip_is_404(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)
    other = await _seed(db_session, completed_through=PhaseType.DEPARTURE)

    resp = await pulsit_client.post(
        _CHECK_URL, json={"trip_id": str(seed["trip"].id)}, headers=auth_header(_token_for(other)),
    )

    assert resp.status_code == 404


async def test_check_alone_reports_readings(pulsit_client, db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)

    resp = await pulsit_client.post(
        _CHECK_URL, json={"trip_id": str(seed["trip"].id)}, headers=auth_header(_token_for(seed)),
    )

    assert resp.status_code == 200
    assert {r["role"] for r in resp.json()["readings"]} == {"horse", "trailer"}
```

(The `_seed` user is `created_by_user_id`; `get_current_dispatcher` looks the user up by JWT subject, so the token must use that id. The `_seed` fixture in Task 2 must therefore be importable: keep it a plain module-level `async def`, not a pytest fixture.)

- [ ] **Step 8: Run the backend checks**

Run: `cd backend && pytest tests/unit/test_dev_rig_service.py tests/integration/test_dev_tracker.py tests/integration/test_dev_pulsit.py tests/unit/test_dev_pulsit_writes_nothing.py -v`
Expected: all PASS — including the existing move-truck route matrix, which must not see the new routes under `/api/v1/dev/pulsit`.

- [ ] **Step 9: Stage**

```bash
git add backend/app/schemas/dev.py backend/app/orchestration/dev_rig_service.py backend/app/api/v1/endpoints/dev_tracker.py backend/app/main.py backend/tests/unit/test_dev_rig_service.py backend/tests/integration/test_dev_tracker.py
```
Suggested commit: `feat(api): dev rig scenarios and on-road tracker check endpoints`

---

### Task 4: Trip facts for the panel and arrival-gated scan-in

**Files:**
- Modify: `backend/app/schemas/dev.py` (`DevTripStop`, `DevTripSummary`, new `DevVehicle`)
- Modify: `backend/app/api/v1/endpoints/dev_triggers.py` (`list_dev_trips`)
- Test: `backend/tests/integration/test_dev_triggers.py`

**Interfaces — Produces:** `DevTripStop.arrival_phase_status`, `.unloading_phase_status`; `DevTripSummary.current_stop_sequence: Optional[int]`, `.vehicles: list[DevVehicle]` with `DevVehicle(vehicle_id, registration, role: Literal["horse","trailer"])`, horse first then trailers by registration.

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/integration/test_dev_triggers.py` (uses its existing `dev_client`, `seeded`, `store`, `_token`):

```python
async def test_list_trips_reports_arrival_and_unloading_status(dev_client, db_session, seeded, store):
    db_session.add_all([
        PhaseEvent(id=uuid.uuid4(), trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
                   phase_type=PhaseType.ARRIVAL, sequence_number=5, status=PhaseStatus.COMPLETED),
        PhaseEvent(id=uuid.uuid4(), trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
                   phase_type=PhaseType.UNLOADING, sequence_number=6, status=PhaseStatus.PENDING),
    ])
    await db_session.flush()

    res = await dev_client.get("/api/v1/dev/trips", headers=auth_header(_token(seeded)))

    trip_body = next(t for t in res.json() if t["trip_id"] == str(seeded["trip"].id))
    stop_body = trip_body["stops"][0]
    assert stop_body["arrival_phase_status"] == PhaseStatus.COMPLETED.value
    assert stop_body["unloading_phase_status"] == PhaseStatus.PENDING.value


async def test_list_trips_reports_vehicles_and_current_stop(dev_client, db_session, seeded, store):
    trailer = Vehicle(id=uuid.uuid4(), organization_id=seeded["org"].id, vehicle_type=VehicleType.TRAILER,
                      registration="TRL 9", pulsit_device_id=f"T-{uuid.uuid4().hex[:6]}")
    db_session.add(trailer)
    await db_session.flush()
    db_session.add(TripTrailer(trip_id=seeded["trip"].id, trailer_id=trailer.id,
                               pulsit_device_id_snapshot=trailer.pulsit_device_id))
    seeded["trip"].current_stop = seeded["stop"].sequence
    await db_session.flush()

    res = await dev_client.get("/api/v1/dev/trips", headers=auth_header(_token(seeded)))

    trip_body = next(t for t in res.json() if t["trip_id"] == str(seeded["trip"].id))
    assert [(v["registration"], v["role"]) for v in trip_body["vehicles"]] == [("ABC123GP", "horse"), ("TRL 9", "trailer")]
    assert trip_body["current_stop_sequence"] == seeded["stop"].sequence
```

Add `TripTrailer` to the file's trips-model import and `Vehicle`/`VehicleType` if not already imported.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && pytest tests/integration/test_dev_triggers.py -k "arrival_and_unloading or vehicles_and_current_stop" -v`
Expected: FAIL — `KeyError: 'arrival_phase_status'`.

- [ ] **Step 3: Implement.** In `schemas/dev.py`:

```python
class DevVehicle(BaseModel):
    """One vehicle on the trip, so the panel can offer a per-trailer scenario."""

    vehicle_id: uuid.UUID
    registration: str
    role: Literal["horse", "trailer"]
```

`DevTripStop` gains, after `confirmation_phase_status`:

```python
    # Scan IN at this stop opens once ARRIVAL is decided: the warehouse scans after the
    # driver has inspected the seal, never while the truck is still at the gate.
    arrival_phase_status: Optional[str] = None
    unloading_phase_status: Optional[str] = None
```

`DevTripSummary` gains (`DevVehicle` must be declared above it):

```python
    # Trip.current_stop: the stop sequence the ledger says the trip is at. A cache, read
    # here only to pick which stop the panel's actions address.
    current_stop_sequence: Optional[int] = None
    vehicles: list[DevVehicle] = []
```

In `list_dev_trips`: add `PhaseType.ARRIVAL` to `phase_event_types` (`[*gated_phase_types, PhaseType.UNLOADING, PhaseType.ARRIVAL, PhaseType.DEPARTURE]`); in the `DevTripStop(...)` call add:

```python
                arrival_phase_status=phase_status_by_stop.get((stop.id, PhaseType.ARRIVAL)),
                unloading_phase_status=phase_status_by_stop.get((stop.id, PhaseType.UNLOADING)),
```

Before the summaries loop, batch the vehicles (one query for horses, one for trailers — keeps the endpoint's batched-query discipline):

```python
    horses = {v.id: v for v in (await db.execute(
        select(Vehicle).where(Vehicle.id.in_([t.horse_id for t in trips]))
    )).scalars().all()}
    trailers_by_trip: dict[uuid.UUID, list[Vehicle]] = {}
    for trip_id_col, vehicle in (await db.execute(
        select(TripTrailer.trip_id, Vehicle)
        .join(Vehicle, Vehicle.id == TripTrailer.trailer_id)
        .where(TripTrailer.trip_id.in_(trip_ids))
        .order_by(Vehicle.registration)
    )).all():
        trailers_by_trip.setdefault(trip_id_col, []).append(vehicle)

    def _vehicles(trip: Trip) -> list[DevVehicle]:
        horse = horses.get(trip.horse_id)
        return [
            *([DevVehicle(vehicle_id=horse.id, registration=horse.registration, role="horse")] if horse else []),
            *(DevVehicle(vehicle_id=v.id, registration=v.registration, role="trailer")
              for v in trailers_by_trip.get(trip.id, [])),
        ]
```

and in `DevTripSummary(...)` add `current_stop_sequence=trip.current_stop, vehicles=_vehicles(trip),`. Add the needed imports (`Vehicle`, `TripTrailer`, `DevVehicle`).

- [ ] **Step 4: Run**

Run: `cd backend && pytest tests/integration/test_dev_triggers.py -v`
Expected: all PASS (existing tests unaffected — fields are additive).

- [ ] **Step 5: Stage**

```bash
git add backend/app/schemas/dev.py backend/app/api/v1/endpoints/dev_triggers.py backend/tests/integration/test_dev_triggers.py
```
Suggested commit: `feat(api): dev trip summary carries arrival status, current stop and vehicles`

---

### Task 5: Frontend types and labels

**Files:**
- Modify: `frontend/shared/lib/types/exception.ts`, `frontend/shared/lib/constants/status-meta.ts`, `frontend/dispatcher/lib/format/exception.ts`, `frontend/dispatcher/lib/types/dev.ts`
- Test: `frontend/dispatcher/lib/format/exception.test.ts`

- [ ] **Step 1: Write the failing test** — add to `frontend/dispatcher/lib/format/exception.test.ts`:

```ts
describe('road exception labels', () => {
  it.each([
    ['trailer_separated_in_transit', 'Trailer separated on the road'],
    ['moved_before_departure', 'Moved before departure'],
    ['tracker_silent', 'Tracker silent'],
  ])('labels %s', (type, label) => {
    expect(fmtExceptionType(type)).toBe(label)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend/dispatcher && npx vitest run lib/format/exception.test.ts`
Expected: the first case FAILS (`Trailer Separated In Transit`). The other two already pass via title-casing; they pin the wording.

- [ ] **Step 3: Implement**

`frontend/shared/lib/types/exception.ts`, after `'trailer_location_mismatch'`:

```ts
  // On the road: a trailer's tracker far from its horse's (no fence involved).
  | 'trailer_separated_in_transit'
  // The horse left its stop's precinct before departure was recorded.
  | 'moved_before_departure'
  // A known tracker returned no position — a gap, not a verdict.
  | 'tracker_silent'
```

`frontend/shared/lib/constants/status-meta.ts`, in `SYSTEM_EXCEPTION_TYPES` after `'trailer_location_mismatch',`:

```ts
  'trailer_separated_in_transit',
  'moved_before_departure',
  'tracker_silent',
```

`frontend/dispatcher/lib/format/exception.ts`, in `EXCEPTION_TYPE_LABELS`:

```ts
  // "In transit" title-cased reads like a phase name; the dispatcher needs the place.
  trailer_separated_in_transit: 'Trailer separated on the road',
```

`frontend/dispatcher/lib/types/dev.ts`:
- `DevTripStop` gains `arrival_phase_status: string | null` and `unloading_phase_status: string | null`.
- Add, and add to `DevTripSummary` `current_stop_sequence: number | null` and `vehicles: DevVehicle[]`:

```ts
export interface DevVehicle {
  vehicle_id: string
  registration: string
  role: 'horse' | 'trailer'
}

// Mirrors RigScenario in backend/app/schemas/dev.py — kept in sync by hand.
export const RIG_SCENARIOS = [
  'at_stop', 'away_from_stop', 'en_route', 'left_before_departure', 'trailer_uncoupled', 'silent',
] as const
export type RigScenario = (typeof RIG_SCENARIOS)[number]

export interface RigScenarioRequest {
  trip_id: string
  scenario: RigScenario
  trip_stop_id?: string
  vehicle_id?: string
}

export interface RigReadingRead {
  vehicle_id: string
  registration: string
  role: 'horse' | 'trailer'
  status: string
  // Decimal serialised as a string — never coerce to number (see WaypointRead).
  latitude: string | null
  longitude: string | null
}

export interface RoadFindingRead {
  exception_type: string
  severity: string
  vehicle_id: string
  description: string
  newly_recorded: boolean
}

export interface RoadCheckResponse {
  trip_id: string
  readings: RigReadingRead[]
  findings: RoadFindingRead[]
  skipped_reason: string | null
}

export interface RigScenarioResponse extends RoadCheckResponse {
  scenario: RigScenario
  label: string
}
```

- [ ] **Step 4: Run**

Run: `cd frontend/dispatcher && npx vitest run lib/format && npm run type-check` then `cd ../driver-pwa && npm run type-check`
Expected: PASS. If type-check reports `DevTripStop`/`DevTripSummary` literals missing the new fields, those are test fixtures in `components/dev/__tests__/DevTriggerPanel.test.tsx`; add `arrival_phase_status: 'completed', unloading_phase_status: null` to `makeStop` and `current_stop_sequence: null, vehicles: []` to its trip factory. The panel rewrite in Task 8 replaces that file anyway.

- [ ] **Step 5: Stage**

```bash
git add frontend/shared/lib/types/exception.ts frontend/shared/lib/constants/status-meta.ts frontend/dispatcher/lib/format/exception.ts frontend/dispatcher/lib/format/exception.test.ts frontend/dispatcher/lib/types/dev.ts frontend/dispatcher/components/dev/__tests__/DevTriggerPanel.test.tsx
```
Suggested commit: `feat(shared): road exception types and dev rig types`

---

### Task 6: Pure stage and preset logic

**Files:**
- Create: `frontend/dispatcher/lib/dev/demo-stage.ts`, `frontend/dispatcher/lib/dev/demo-stage.test.ts`
- Create: `frontend/dispatcher/lib/dev/presets.ts`, `frontend/dispatcher/lib/dev/presets.test.ts`

**Interfaces — Produces:**
- `DemoStageKind`, `DemoStage { kind, stop, nextStop, headline }`, `demoStageFor(trip): DemoStage`, `scanOutOpen(stop): boolean`, `scanInOpen(stop): boolean`, `sortTripsForPicker(trips): DevTripSummary[]`
- `ScanPreset`, `barcodesForPreset(consignments, preset): Record<string, string[]>`, `STRAY_BARCODE_SUFFIX`
- `PpPreset`, `ppRequestForPreset(tripId, consignment, preset, now: Date): PpTriggerRequest`, `ppDate(now: Date): string`, `DEMO_FAILURE_REASON`
- `describeRoadCheck(result: RoadCheckResponse): string`

- [ ] **Step 1: Write the failing tests**

`frontend/dispatcher/lib/dev/demo-stage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { demoStageFor, scanInOpen, scanOutOpen, sortTripsForPicker } from './demo-stage'
import type { DevTripStop, DevTripSummary } from '@/lib/types/dev'

function stop(overrides: Partial<DevTripStop> = {}): DevTripStop {
  return {
    trip_stop_id: 'stop-0', sequence: 0, precinct_name: 'Cape Town DC',
    pickup_consignments: [], delivery_consignments: [],
    loading_phase_status: null, confirmation_phase_status: null, preceding_departure_status: null,
    arrival_phase_status: null, unloading_phase_status: null,
    ...overrides,
  }
}

const ORIGIN = stop()
const MIDDLE = stop({ trip_stop_id: 'stop-1', sequence: 1, precinct_name: 'Worcester Hub' })
const DEST = stop({ trip_stop_id: 'stop-2', sequence: 2, precinct_name: 'Paarl Depot' })

function trip(overrides: Partial<DevTripSummary> = {}): DevTripSummary {
  return {
    trip_id: 'trip-1', trip_reference: 'FP-0042', status: 'active', current_phase: 'loading',
    driver_full_name: 'Driver', created_at: '2026-09-24T08:00:00Z',
    stops: [ORIGIN, DEST], current_stop_sequence: 0, vehicles: [],
    ...overrides,
  }
}

describe('demoStageFor', () => {
  it.each([
    ['activation', 'before_departure'], ['loading', 'before_departure'], ['departure', 'before_departure'],
    ['in_transit', 'on_road'], ['arrival', 'arrived'], ['unloading', 'unloading'], ['confirmation', 'confirming'],
  ])('maps %s to %s', (phase, kind) => {
    expect(demoStageFor(trip({ current_phase: phase })).kind).toBe(kind)
  })

  it('is not_started with no current phase', () => {
    expect(demoStageFor(trip({ current_phase: null })).kind).toBe('not_started')
  })

  it.each(['closed', 'cancelled'])('is closed for a %s trip whatever the phase', status => {
    expect(demoStageFor(trip({ status, current_phase: 'in_transit' })).kind).toBe('closed')
  })

  it('names the next stop and the leg on the road', () => {
    const stage = demoStageFor(trip({ current_phase: 'in_transit', current_stop_sequence: 0 }))

    expect(stage.stop?.trip_stop_id).toBe('stop-0')
    expect(stage.nextStop?.trip_stop_id).toBe('stop-2')
    expect(stage.headline).toBe('On the road to Paarl Depot · leg 1 of 1')
  })

  it('finds the second leg of a cross-dock trip', () => {
    const stage = demoStageFor(trip({ stops: [ORIGIN, MIDDLE, DEST], current_phase: 'in_transit', current_stop_sequence: 1 }))

    expect(stage.headline).toBe('On the road to Paarl Depot · leg 2 of 2')
  })

  it('addresses the stop the ledger says the trip is at', () => {
    expect(demoStageFor(trip({ current_phase: 'arrival', current_stop_sequence: 2, stops: [ORIGIN, MIDDLE, DEST] })).stop?.precinct_name)
      .toBe('Paarl Depot')
  })
})

describe('scan gating', () => {
  const consignment = { consignment_id: 'c', parcel_perfect_reference: 'WB-1', barcodes: ['B1'] }

  it('opens scan out until loading is decided', () => {
    expect(scanOutOpen(stop({ pickup_consignments: [consignment] }))).toBe(true)
    expect(scanOutOpen(stop({ pickup_consignments: [consignment], loading_phase_status: 'completed' }))).toBe(false)
  })

  it('keeps scan in closed until arrival completes', () => {
    expect(scanInOpen(stop({ delivery_consignments: [consignment], preceding_departure_status: 'completed' }))).toBe(false)
    expect(scanInOpen(stop({ delivery_consignments: [consignment], arrival_phase_status: 'completed' }))).toBe(true)
  })

  it('closes scan in once confirmation is decided', () => {
    expect(scanInOpen(stop({ delivery_consignments: [consignment], arrival_phase_status: 'completed', confirmation_phase_status: 'completed' })))
      .toBe(false)
  })
})

describe('sortTripsForPicker', () => {
  it('puts live trips before finished ones and keeps the given order within each', () => {
    const sorted = sortTripsForPicker([
      trip({ trip_id: 'a', status: 'closed' }), trip({ trip_id: 'b', status: 'active' }),
      trip({ trip_id: 'c', status: 'created' }), trip({ trip_id: 'd', status: 'cancelled' }),
    ])

    expect(sorted.map(t => t.trip_id)).toEqual(['b', 'c', 'a', 'd'])
  })
})
```

`frontend/dispatcher/lib/dev/presets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { barcodesForPreset, describeRoadCheck, ppDate, ppRequestForPreset, DEMO_FAILURE_REASON } from './presets'
import type { DevConsignment, RoadCheckResponse } from '@/lib/types/dev'

const WB1: DevConsignment = { consignment_id: 'c1', parcel_perfect_reference: 'WB-1', barcodes: ['A', 'B', 'C'] }
const WB2: DevConsignment = { consignment_id: 'c2', parcel_perfect_reference: 'WB-2', barcodes: ['D'] }

describe('barcodesForPreset', () => {
  it('scans everything for "all"', () => {
    expect(barcodesForPreset([WB1, WB2], 'all')).toEqual({ 'WB-1': ['A', 'B', 'C'], 'WB-2': ['D'] })
  })

  it('drops exactly one parcel from the first waybill for "one_short"', () => {
    expect(barcodesForPreset([WB1, WB2], 'one_short')).toEqual({ 'WB-1': ['A', 'B'], 'WB-2': ['D'] })
  })

  it('adds one stable stray barcode for "stray", so pressing twice stages the same scan', () => {
    const once = barcodesForPreset([WB1], 'stray')

    expect(once['WB-1']).toHaveLength(4)
    expect(barcodesForPreset([WB1], 'stray')).toEqual(once)
  })
})

describe('Parcel Perfect presets', () => {
  const now = new Date('2026-09-24T10:00:00Z')

  it('formats the POD date the way PP does', () => {
    expect(ppDate(now)).toBe('24/09/2026')
  })

  it('builds a delivered request with today as POD date', () => {
    expect(ppRequestForPreset('trip-1', WB1, 'delivered', now)).toEqual({ trip_id: 'trip-1', parcel_perfect_reference: 'WB-1', poddate: '24/09/2026' })
  })

  it('builds a failed delivery with a reason', () => {
    expect(ppRequestForPreset('trip-1', WB1, 'delivery_failed', now).failtype).toBe(DEMO_FAILURE_REASON)
  })

  it('adds one parcel to the waybill for "parcel_added"', () => {
    expect(ppRequestForPreset('trip-1', WB1, 'parcel_added', now).parcel_count).toBe(4)
  })
})

describe('describeRoadCheck', () => {
  const base: RoadCheckResponse = { trip_id: 't', readings: [], findings: [], skipped_reason: null }

  it('says when nothing new was found', () => {
    expect(describeRoadCheck(base)).toBe('Tracker check: nothing new.')
  })

  it('counts new findings and names them', () => {
    expect(describeRoadCheck({
      ...base,
      findings: [
        { exception_type: 'trailer_separated_in_transit', severity: 'critical', vehicle_id: 'v', description: 'd', newly_recorded: true },
        { exception_type: 'tracker_silent', severity: 'warning', vehicle_id: 'w', description: 'd', newly_recorded: false },
      ],
    })).toBe('Tracker check: 1 new finding (Trailer separated on the road).')
  })

  it('reports why the check was skipped', () => {
    expect(describeRoadCheck({ ...base, skipped_reason: 'Trip is closed.' })).toBe('Tracker check skipped: Trip is closed.')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run lib/dev`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`frontend/dispatcher/lib/dev/demo-stage.ts`:

```ts
import { isClosedPhaseStatus, type DevTripStop, type DevTripSummary } from '@/lib/types/dev'

export type DemoStageKind =
  | 'not_started' | 'before_departure' | 'on_road' | 'arrived' | 'unloading' | 'confirming' | 'closed'

export interface DemoStage {
  kind: DemoStageKind
  /** Where the truck is. On the road: the stop it left. */
  stop: DevTripStop | null
  /** On the road only: the stop it is heading to. */
  nextStop: DevTripStop | null
  headline: string
}

const PHASE_STAGE: Readonly<Record<string, DemoStageKind>> = {
  activation: 'before_departure',
  loading: 'before_departure',
  departure: 'before_departure',
  in_transit: 'on_road',
  arrival: 'arrived',
  unloading: 'unloading',
  confirmation: 'confirming',
}

const FINISHED_STATUSES: readonly string[] = ['closed', 'cancelled']

/**
 * Where the trip is, from the ledger-derived current phase and stop. The one place that
 * decides which panel actions show, so the rule is unit-tested rather than scattered
 * across components.
 */
export function demoStageFor(trip: DevTripSummary): DemoStage {
  if (FINISHED_STATUSES.includes(trip.status)) {
    return { kind: 'closed', stop: null, nextStop: null, headline: `Trip ${trip.status}` }
  }
  const kind = trip.current_phase === null ? undefined : PHASE_STAGE[trip.current_phase]
  if (kind === undefined) {
    return { kind: 'not_started', stop: null, nextStop: null, headline: 'Waiting for the driver to activate' }
  }

  const stops = [...trip.stops].sort((a, b) => a.sequence - b.sequence)
  const index = stops.findIndex(s => s.sequence === trip.current_stop_sequence)
  const stop = stops[index] ?? stops[0] ?? null
  const nextStop = kind === 'on_road' && index >= 0 ? stops[index + 1] ?? null : null
  const place = stop?.precinct_name ?? 'the stop'

  const headline: Record<DemoStageKind, string> = {
    not_started: '',
    closed: '',
    before_departure: `At ${place} · before departure`,
    on_road: `On the road to ${nextStop?.precinct_name ?? 'the next stop'} · leg ${index + 1} of ${stops.length - 1}`,
    arrived: `Arrived at ${place} · seal inspection`,
    unloading: `Unloading at ${place}`,
    confirming: `Handing over at ${place}`,
  }
  return { kind, stop, nextStop, headline: headline[kind] }
}

export function scanOutOpen(stop: DevTripStop): boolean {
  return stop.pickup_consignments.length > 0 && !isClosedPhaseStatus(stop.loading_phase_status)
}

/** Scan IN opens once the driver has completed arrival (seal inspected before any door
 *  opens) and stays open until confirmation decides — confirmation is where the origin
 *  and destination scans are reconciled (phase_gate.GATED_PHASES). */
export function scanInOpen(stop: DevTripStop): boolean {
  return stop.delivery_consignments.length > 0
    && isClosedPhaseStatus(stop.arrival_phase_status)
    && !isClosedPhaseStatus(stop.confirmation_phase_status)
}

/** Live trips first; the backend's newest-first order is kept within each group. */
export function sortTripsForPicker(trips: readonly DevTripSummary[]): DevTripSummary[] {
  const live = trips.filter(t => !FINISHED_STATUSES.includes(t.status))
  const finished = trips.filter(t => FINISHED_STATUSES.includes(t.status))
  return [...live, ...finished]
}
```

`frontend/dispatcher/lib/dev/presets.ts`:

```ts
import { fmtExceptionType } from '@/lib/format/exception'
import type { DevConsignment, PpTriggerRequest, RoadCheckResponse } from '@/lib/types/dev'

export type ScanPreset = 'all' | 'one_short' | 'stray'
export type PpPreset = 'delivered' | 'delivery_failed' | 'parcel_added'

// Deterministic, so pressing "stray parcel" twice stages the same scan: MockScanFeed
// REPLACES staged barcodes rather than appending, and a new random stray each press would
// read as a second stranger parcel.
export const STRAY_BARCODE_SUFFIX = '-STRAY'
export const DEMO_FAILURE_REASON = 'Receiver not available'

/** Every waybill's barcodes for the preset. The whole map is always sent: a waybill
 *  absent from it would stage an EMPTY scan (see ScanTriggerRequest). The preset's
 *  change applies to the first waybill only, so the demo shows one clear discrepancy. */
export function barcodesForPreset(consignments: readonly DevConsignment[], preset: ScanPreset): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  consignments.forEach((consignment, index) => {
    const barcodes = [...consignment.barcodes]
    const target = index === 0
    if (target && preset === 'one_short') barcodes.pop()
    if (target && preset === 'stray') barcodes.push(`${consignment.parcel_perfect_reference}${STRAY_BARCODE_SUFFIX}`)
    result[consignment.parcel_perfect_reference] = barcodes
  })
  return result
}

/** dd/mm/yyyy — the format Parcel Perfect itself returns for a POD date. */
export function ppDate(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(now.getUTCDate())}/${pad(now.getUTCMonth() + 1)}/${now.getUTCFullYear()}`
}

export function ppRequestForPreset(tripId: string, consignment: DevConsignment, preset: PpPreset, now: Date): PpTriggerRequest {
  const base = { trip_id: tripId, parcel_perfect_reference: consignment.parcel_perfect_reference }
  if (preset === 'delivered') return { ...base, poddate: ppDate(now) }
  if (preset === 'delivery_failed') return { ...base, failtype: DEMO_FAILURE_REASON }
  // One more parcel than the manifest: the verified mid-trip PP edit (spec §B2c).
  return { ...base, parcel_count: consignment.barcodes.length + 1 }
}

export function describeRoadCheck(result: RoadCheckResponse): string {
  if (result.skipped_reason !== null) return `Tracker check skipped: ${result.skipped_reason}`
  const fresh = result.findings.filter(f => f.newly_recorded)
  if (fresh.length === 0) return 'Tracker check: nothing new.'
  const names = fresh.map(f => fmtExceptionType(f.exception_type)).join(', ')
  return `Tracker check: ${fresh.length} new finding${fresh.length === 1 ? '' : 's'} (${names}).`
}
```

- [ ] **Step 4: Run**

Run: `cd frontend/dispatcher && npx vitest run lib/dev && npm run type-check`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add frontend/dispatcher/lib/dev
```
Suggested commit: `feat(dispatcher): demo stage derivation and scan/PP presets`

---

### Task 7: Hook — rig scenario, road check, activity log

**Files:**
- Modify: `frontend/dispatcher/lib/hooks/useDevTriggers.ts`
- Test: `frontend/dispatcher/lib/hooks/useDevTriggers.test.tsx` (create if absent; if it exists, add to it)

**Interfaces — Produces:** on `UseDevTriggersResult`: `activity: ActivityEntry[]`, `runRigScenario(body: RigScenarioRequest): Promise<RigScenarioResponse | null>`, `runRoadCheck(tripId: string): Promise<RoadCheckResponse | null>`. `ActivityEntry { id: number; at: string; tone: 'ok' | 'error'; text: string; findings: RoadFindingRead[] }`. Existing members unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDevTriggers } from './useDevTriggers'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error { status = 500 },
}))

const post = vi.mocked(api.post)

beforeEach(() => { post.mockReset() })

describe('useDevTriggers activity log', () => {
  it('logs a rig scenario with its label, the check summary and its findings, newest first', async () => {
    post.mockResolvedValueOnce({
      trip_id: 't', scenario: 'trailer_uncoupled', label: 'Trailer TRL 222 uncoupled on the road', readings: [], skipped_reason: null,
      findings: [{ exception_type: 'trailer_separated_in_transit', severity: 'critical', vehicle_id: 'v', description: 'd', newly_recorded: true }],
    })
    post.mockResolvedValueOnce({ trip_id: 't', readings: [], findings: [], skipped_reason: null })
    const { result } = renderHook(() => useDevTriggers())

    await act(async () => { await result.current.runRigScenario({ trip_id: 't', scenario: 'trailer_uncoupled', vehicle_id: 'v' }) })
    await act(async () => { await result.current.runRoadCheck('t') })

    expect(result.current.activity.map(e => e.text)).toEqual([
      'Tracker check: nothing new.',
      'Trailer TRL 222 uncoupled on the road. Tracker check: 1 new finding (Trailer separated on the road).',
    ])
    expect(result.current.activity[1].findings).toHaveLength(1)
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/dev/tracker/scenario', { trip_id: 't', scenario: 'trailer_uncoupled', vehicle_id: 'v' })
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/dev/tracker/check', { trip_id: 't' })
  })

  it('logs a failure as an error entry', async () => {
    post.mockRejectedValueOnce(new Error('The trip is not on the road.'))
    const { result } = renderHook(() => useDevTriggers())

    await act(async () => { await result.current.runRigScenario({ trip_id: 't', scenario: 'en_route' }) })

    expect(result.current.activity[0]).toMatchObject({ tone: 'error', text: 'The trip is not on the road.' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend/dispatcher && npx vitest run lib/hooks/useDevTriggers.test.tsx`
Expected: FAIL — `runRigScenario` is not a function.

- [ ] **Step 3: Implement.** In `useDevTriggers.ts`:

Add imports: `useRef`, `describeRoadCheck` from `@/lib/dev/presets`, and the new types from `@/lib/types/dev`.

```ts
// Enough for a whole demo run to stay on screen; older entries only add scrolling.
const MAX_ACTIVITY_ENTRIES = 20

export interface ActivityEntry {
  id: number
  at: string
  tone: 'ok' | 'error'
  text: string
  findings: RoadFindingRead[]
}
```

Add the three members to `UseDevTriggersResult`. Inside the hook:

```ts
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const nextActivityId = useRef(1)
  const log = useCallback((tone: ActivityEntry['tone'], text: string, findings: RoadFindingRead[] = []): void => {
    const entry: ActivityEntry = { id: nextActivityId.current++, at: new Date().toISOString(), tone, text, findings }
    setActivity(previous => [entry, ...previous].slice(0, MAX_ACTIVITY_ENTRIES))
  }, [])
```

Change `run` so every outcome is also logged — a third optional parameter carries findings:

```ts
  const run = useCallback(async <T,>(
    action: () => Promise<T>,
    describe: (result: T) => string | null,
    findingsOf?: (result: T) => RoadFindingRead[],
  ): Promise<T | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await action()
      const message = describe(result)
      if (message !== null) {
        setLastResult(message)
        log('ok', message, findingsOf ? findingsOf(result) : [])
      }
      return result
    } catch (err: unknown) {
      const message = describeError(err)
      setError(message)
      log('error', message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [log])
```

(`describeError` is declared inside the hook body; move it above `run` or to module scope so `run`'s dependency list stays honest.)

```ts
  const runRigScenario = useCallback(
    (body: RigScenarioRequest) =>
      run(
        () => api.post<RigScenarioResponse>(`${DEV_BASE}/tracker/scenario`, body),
        (result) => `${result.label}. ${describeRoadCheck(result)}`,
        (result) => result.findings.filter(f => f.newly_recorded),
      ),
    [run],
  )

  const runRoadCheck = useCallback(
    (tripId: string) =>
      run(
        () => api.post<RoadCheckResponse>(`${DEV_BASE}/tracker/check`, { trip_id: tripId }),
        (result) => describeRoadCheck(result),
        (result) => result.findings.filter(f => f.newly_recorded),
      ),
    [run],
  )
```

Return `activity, runRigScenario, runRoadCheck` alongside the existing members.

- [ ] **Step 4: Run**

Run: `cd frontend/dispatcher && npx vitest run lib/hooks components/dev && npm run type-check`
Expected: PASS (the old panel tests mock the hook entirely, so they are unaffected).

- [ ] **Step 5: Stage**

```bash
git add frontend/dispatcher/lib/hooks/useDevTriggers.ts frontend/dispatcher/lib/hooks/useDevTriggers.test.tsx
```
Suggested commit: `feat(dispatcher): dev hook runs rig scenarios and keeps an activity log`

---

### Task 8: Split the panel

**Files:**
- Create: `frontend/dispatcher/components/dev/AllControls.tsx` (from the old panel) and `components/dev/__tests__/AllControls.test.tsx` (from the old test)
- Create: `StageHeader.tsx`, `TripPicker.tsx`, `WarehouseActions.tsx`, `TrackerActions.tsx`, `ParcelPerfectActions.tsx`, `ActivityLog.tsx` in `components/dev/`
- Rewrite: `components/dev/DevTriggerPanel.tsx`, `components/dev/__tests__/DevTriggerPanel.test.tsx`
- Modify: `app/(app)/dev/triggers/page.tsx` (heading text only)

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces: `AllControls({ controls, tripId })`; `DevTriggerPanel({ heading })` unchanged signature.

- [ ] **Step 1: Create `AllControls.tsx` from the old panel** (copy the file's content with the Write tool — `git mv` is not allowed). Then, in `AllControls.tsx`:
  1. Rename `export function DevTriggerPanel({ heading }: DevTriggerPanelProps)` to `export function AllControls({ controls, tripId }: AllControlsProps)` with
     ```ts
     interface AllControlsProps {
       controls: UseDevTriggersResult
       // The trip chosen in the parent's picker. Raw controls address exactly that trip.
       tripId: string
     }
     ```
     and replace the `useDevTriggers()` call with destructuring from `controls`.
  2. Delete the `tripId` `useState` and the whole "Target" `<Card>`'s **Trip** `<Select>` and its **Refresh trips** button (keep the "What's happening" `<Select>` in a Card titled "Scan target").
  3. Delete the header `<Card>` (heading, error, lastResult) — the parent's activity log replaces it.
  4. Delete the **Fixed demo locations** `<Card>`, `activeWaypointId` state, the waypoint `onMoveTruck` handler, the `loadWaypoints` mount call, and the now-unused imports (`PRECINCT_WAYPOINT_ID`, `WaypointRead`, `waypoints`). Keep **Move the truck** result card and **Move relative to a trip stop**.
  5. Delete the **Mock state** `<Card>` (the parent owns reset).
  6. In `buildScanOptions`, replace the departure gate for scan IN with the arrival gate:
     ```ts
      const alreadyComplete = isClosedPhaseStatus(stop.confirmation_phase_status)
      // Scan IN waits for ARRIVAL, not departure: the warehouse scans only after the
      // driver has inspected the seal (design note §4.2).
      const notYetArrived = !isClosedPhaseStatus(stop.arrival_phase_status)
      const disabled = alreadyComplete || notYetArrived
      const disabledReason = alreadyComplete
        ? 'Confirmation is already complete at this stop.'
        : notYetArrived
          ? "The driver hasn't completed arrival yet."
          : null
     ```
     and update the block comment above `buildScanOptions` to say "arrival" where it says "departure".
  7. Remove the `latestSelectionRef`/trip-change reset logic **only if** it no longer compiles; otherwise keep it — it still resets state when the `tripId` prop changes.

- [ ] **Step 2: Create `AllControls.test.tsx` from the old test.** Copy `__tests__/DevTriggerPanel.test.tsx` to `__tests__/AllControls.test.tsx`, then:
  1. Stop mocking the hook module. Replace the `vi.mock('@/lib/hooks/useDevTriggers', …)` and every `mockedUseDevTriggers.mockReturnValue(x)` + `render(<DevTriggerPanel …/>)` + `selectTrip(id)` sequence with a helper:
     ```tsx
     function renderAllControls(controls: UseDevTriggersResult, tripId: string) {
       return render(<AllControls controls={controls} tripId={tripId} />)
     }
     ```
     Existing mock objects become the `controls` argument; add `activity: [], runRigScenario: vi.fn(), runRoadCheck: vi.fn()` to the shared mock factory.
  2. Delete the waypoint tests in `describe('DevTriggerPanel — move the truck', …)` (`renders one button per waypoint…`, `calls moveTruck with the pressed waypoint id…`, `renders "no verdict"…` if it presses a waypoint, `posts the precinct waypoint id…`, `does not call moveTruck when no trip is selected yet`). Keep every stop-relative scenario test.
  3. Replace the two departure-gate tests (`disables the IN option before the truck has departed…`, `enables the IN option once the preceding departure has completed`) with the arrival equivalents: `arrival_phase_status: null` → option disabled with text "The driver hasn't completed arrival yet."; `arrival_phase_status: 'completed'` → enabled. In `makeStop`, default `arrival_phase_status: 'completed'` so the other IN tests keep testing only what they name.
  4. Rename every `describe('DevTriggerPanel — …'` to `describe('AllControls — …'`.

- [ ] **Step 3: Run the moved tests**

Run: `cd frontend/dispatcher && npx vitest run components/dev/__tests__/AllControls.test.tsx`
Expected: PASS. Fix the moved component, not the assertions, unless an assertion tests a deleted feature.

- [ ] **Step 4: Write the failing panel tests** — replace `__tests__/DevTriggerPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DevTriggerPanel } from '../DevTriggerPanel'
import { useDevTriggers, type UseDevTriggersResult } from '@/lib/hooks/useDevTriggers'
import type { DevTripStop, DevTripSummary } from '@/lib/types/dev'

vi.mock('@/lib/hooks/useDevTriggers', () => ({ useDevTriggers: vi.fn() }))
vi.mock('@/lib/realtime/useLiveResource', () => ({ useLiveResource: vi.fn() }))

const consignment = { consignment_id: 'c1', parcel_perfect_reference: 'WB-1', barcodes: ['B1', 'B2'] }

function stop(overrides: Partial<DevTripStop>): DevTripStop {
  return {
    trip_stop_id: 'stop-0', sequence: 0, precinct_name: 'Cape Town DC',
    pickup_consignments: [], delivery_consignments: [],
    loading_phase_status: null, confirmation_phase_status: null, preceding_departure_status: null,
    arrival_phase_status: null, unloading_phase_status: null,
    ...overrides,
  }
}

function trip(overrides: Partial<DevTripSummary> = {}): DevTripSummary {
  return {
    trip_id: 'trip-1', trip_reference: 'FP-0042', status: 'active', current_phase: 'in_transit',
    driver_full_name: 'Driver', created_at: '2026-09-24T08:00:00Z', current_stop_sequence: 0,
    stops: [
      stop({ pickup_consignments: [consignment], loading_phase_status: 'completed' }),
      stop({ trip_stop_id: 'stop-1', sequence: 1, precinct_name: 'Paarl Depot', delivery_consignments: [consignment] }),
    ],
    vehicles: [
      { vehicle_id: 'h', registration: 'CA 100', role: 'horse' },
      { vehicle_id: 't1', registration: 'TRL 222', role: 'trailer' },
      { vehicle_id: 't2', registration: 'TRL 333', role: 'trailer' },
    ],
    ...overrides,
  }
}

function controls(overrides: Partial<UseDevTriggersResult> = {}): UseDevTriggersResult {
  return {
    trips: [trip()], waypoints: [], isLoading: false, error: null, lastResult: null, activity: [],
    loadTrips: vi.fn().mockResolvedValue(undefined), triggerScan: vi.fn().mockResolvedValue(null),
    closeScanSession: vi.fn().mockResolvedValue(null), triggerPpChange: vi.fn().mockResolvedValue(null),
    triggerException: vi.fn().mockResolvedValue(null), flushMockState: vi.fn().mockResolvedValue(null),
    loadWaypoints: vi.fn().mockResolvedValue(undefined), moveTruck: vi.fn().mockResolvedValue(null),
    runRigScenario: vi.fn().mockResolvedValue(null), runRoadCheck: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

function renderWith(value: UseDevTriggersResult, tripId = 'trip-1') {
  vi.mocked(useDevTriggers).mockReturnValue(value)
  render(<DevTriggerPanel heading="Demo panel" />)
  fireEvent.change(screen.getByLabelText('Trip'), { target: { value: tripId } })
}

beforeEach(() => { vi.mocked(useDevTriggers).mockReset() })

describe('DevTriggerPanel — follows the trip', () => {
  it('shows where the trip is', () => {
    renderWith(controls())

    expect(screen.getByTestId('demo-stage-headline')).toHaveTextContent('On the road to Paarl Depot · leg 1 of 1')
  })

  it('offers one uncoupled-trailer scenario per trailer on the road, and fires it in one click', () => {
    const value = controls()
    renderWith(value)

    fireEvent.click(screen.getByRole('button', { name: 'Trailer TRL 333 uncoupled' }))

    expect(value.runRigScenario).toHaveBeenCalledWith({ trip_id: 'trip-1', scenario: 'trailer_uncoupled', vehicle_id: 't2' })
    expect(screen.getByRole('button', { name: 'Trailer TRL 222 uncoupled' })).toBeInTheDocument()
  })

  it('moves the rig to the next stop so arrival passes its location check', () => {
    const value = controls()
    renderWith(value)

    fireEvent.click(screen.getByRole('button', { name: 'Truck reaches Paarl Depot' }))

    expect(value.runRigScenario).toHaveBeenCalledWith({ trip_id: 'trip-1', scenario: 'at_stop', trip_stop_id: 'stop-1' })
  })

  it('offers no warehouse scans on the road', () => {
    renderWith(controls())

    expect(screen.queryByRole('button', { name: 'All parcels' })).not.toBeInTheDocument()
  })

  it('offers scan-out presets at the origin before departure', () => {
    const value = controls({ trips: [trip({ current_phase: 'loading', stops: [stop({ pickup_consignments: [consignment] })] })] })
    renderWith(value)

    fireEvent.click(screen.getByRole('button', { name: 'One parcel short' }))

    expect(value.triggerScan).toHaveBeenCalledWith({
      trip_id: 'trip-1', trip_stop_id: 'stop-0', direction: 'out', barcodes_by_reference: { 'WB-1': ['B1'] },
    })
  })

  it('explains why scanning in is locked at arrival', () => {
    renderWith(controls({ trips: [trip({ current_phase: 'arrival', current_stop_sequence: 1 })] }))

    expect(screen.getByText(/Scanning in opens once the driver completes arrival/)).toBeInTheDocument()
  })

  it('shows the activity log, newest first', () => {
    renderWith(controls({ activity: [
      { id: 2, at: '2026-09-24T10:01:00Z', tone: 'ok', text: 'Second', findings: [] },
      { id: 1, at: '2026-09-24T10:00:00Z', tone: 'ok', text: 'First', findings: [] },
    ] }))

    const items = within(screen.getByRole('list', { name: 'Activity' })).getAllByRole('listitem')
    expect(items.map(i => i.textContent)).toEqual([expect.stringContaining('Second'), expect.stringContaining('First')])
  })

  it('keeps the raw controls collapsed until asked', () => {
    renderWith(controls())

    expect(screen.getByText('All controls').closest('details')).not.toHaveAttribute('open')
  })
})
```

- [ ] **Step 5: Run to verify they fail**

Run: `cd frontend/dispatcher && npx vitest run components/dev/__tests__/DevTriggerPanel.test.tsx`
Expected: FAIL — no `demo-stage-headline`.

- [ ] **Step 6: Create the small components.** Each file starts with `'use client'` only if it uses hooks (none of these six do except `DevTriggerPanel`; omit the directive on the others — they render inside a client component).

`StageHeader.tsx`:

```tsx
import type { DemoStage } from '@/lib/dev/demo-stage'
import type { DevTripSummary } from '@/lib/types/dev'

interface StageHeaderProps {
  trip: DevTripSummary
  stage: DemoStage
}

export function StageHeader({ trip, stage }: StageHeaderProps): React.ReactElement {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">
        {trip.trip_reference} · {trip.driver_full_name ?? 'no driver'}
      </p>
      <p className="text-lg font-semibold" data-testid="demo-stage-headline">{stage.headline}</p>
    </div>
  )
}
```

`TripPicker.tsx` (moves `tripOptionLabel` out of the old panel verbatim):

```tsx
import { Select } from '@/components/ui/Select'
import { sortTripsForPicker } from '@/lib/dev/demo-stage'
import type { DevTripSummary } from '@/lib/types/dev'

interface TripPickerProps {
  trips: readonly DevTripSummary[]
  tripId: string
  onChange: (tripId: string) => void
}

// Reference, driver, route, phase — enough to pick the right trip without opening it.
export function tripOptionLabel(trip: DevTripSummary): string {
  const driver = trip.driver_full_name ?? 'no driver'
  const origin = trip.stops[0]?.precinct_name
  const destination = trip.stops.length > 1 ? trip.stops[trip.stops.length - 1]?.precinct_name : undefined
  const route = origin === undefined ? 'no stops' : destination === undefined ? origin : `${origin} → ${destination}`
  return `${trip.trip_reference} · ${driver} · ${route} · ${trip.current_phase ?? trip.status}`
}

export function TripPicker({ trips, tripId, onChange }: TripPickerProps): React.ReactElement {
  return (
    <Select label="Trip" value={tripId} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a trip…</option>
      {sortTripsForPicker(trips).map((trip) => (
        <option key={trip.trip_id} value={trip.trip_id}>{tripOptionLabel(trip)}</option>
      ))}
    </Select>
  )
}
```

Delete `tripOptionLabel` from `AllControls.tsx` if it is still there.

`WarehouseActions.tsx`:

```tsx
import { Button } from '@/components/ui/Button'
import { scanInOpen, scanOutOpen, type DemoStage } from '@/lib/dev/demo-stage'
import { barcodesForPreset, type ScanPreset } from '@/lib/dev/presets'
import type { CloseScanSessionRequest, ScanDirection, ScanTriggerRequest } from '@/lib/types/dev'

interface WarehouseActionsProps {
  tripId: string
  stage: DemoStage
  busy: boolean
  onScan: (body: ScanTriggerRequest) => void
  onCloseSession: (body: CloseScanSessionRequest) => void
}

const PRESET_LABELS: Record<ScanPreset, (direction: ScanDirection) => string> = {
  all: () => 'All parcels',
  one_short: (direction) => (direction === 'out' ? 'One parcel short' : 'One parcel missing'),
  stray: () => 'Stray parcel',
}

export function WarehouseActions({ tripId, stage, busy, onScan, onCloseSession }: WarehouseActionsProps): React.ReactElement | null {
  const stop = stage.stop
  if (stop === null) return null

  const direction: ScanDirection | null =
    stage.kind === 'before_departure' && scanOutOpen(stop) ? 'out'
      : (stage.kind === 'unloading' || stage.kind === 'confirming') && scanInOpen(stop) ? 'in'
        : null

  if (direction === null) {
    return stage.kind === 'arrived' && stop.delivery_consignments.length > 0
      ? <p className="text-xs text-amber-700">Scanning in opens once the driver completes arrival — the seal is inspected before any door opens.</p>
      : null
  }

  const consignments = direction === 'out' ? stop.pickup_consignments : stop.delivery_consignments
  const target = { trip_id: tripId, trip_stop_id: stop.trip_stop_id, direction }
  return (
    <section aria-label="Warehouse" className="space-y-2">
      <h3 className="font-medium">Warehouse — scan {direction === 'out' ? 'out' : 'in'} at {stop.precinct_name}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(Object.keys(PRESET_LABELS) as ScanPreset[]).map((preset) => (
          <Button key={preset} variant="secondary" disabled={busy}
            onClick={() => onScan({ ...target, barcodes_by_reference: barcodesForPreset(consignments, preset) })}>
            {PRESET_LABELS[preset](direction)}
          </Button>
        ))}
      </div>
      <Button variant="danger" disabled={busy} onClick={() => onCloseSession(target)}>
        Close scan session — unblocks the driver
      </Button>
    </section>
  )
}
```

`TrackerActions.tsx`:

```tsx
import { Button } from '@/components/ui/Button'
import type { DemoStage } from '@/lib/dev/demo-stage'
import type { DevVehicle, RigScenarioRequest } from '@/lib/types/dev'

interface TrackerActionsProps {
  tripId: string
  stage: DemoStage
  vehicles: readonly DevVehicle[]
  busy: boolean
  onScenario: (body: RigScenarioRequest) => void
  onCheck: () => void
}

interface TrackerButton {
  label: string
  body: RigScenarioRequest
}

export function TrackerActions({ tripId, stage, vehicles, busy, onScenario, onCheck }: TrackerActionsProps): React.ReactElement | null {
  const horse = vehicles.find(v => v.role === 'horse')
  const trailers = vehicles.filter(v => v.role === 'trailer')
  const buttons: TrackerButton[] = []
  const silentHorse = horse ? [{ label: `Horse ${horse.registration} tracker silent`, body: { trip_id: tripId, scenario: 'silent' as const, vehicle_id: horse.vehicle_id } }] : []

  if (stage.kind === 'on_road') {
    buttons.push({ label: 'Driving normally', body: { trip_id: tripId, scenario: 'en_route' } })
    trailers.forEach(t => buttons.push({ label: `Trailer ${t.registration} uncoupled`, body: { trip_id: tripId, scenario: 'trailer_uncoupled', vehicle_id: t.vehicle_id } }))
    buttons.push(...silentHorse)
    if (stage.nextStop) {
      buttons.push({ label: `Truck reaches ${stage.nextStop.precinct_name}`, body: { trip_id: tripId, scenario: 'at_stop', trip_stop_id: stage.nextStop.trip_stop_id } })
    }
  } else if (stage.stop && ['before_departure', 'arrived', 'unloading', 'confirming'].includes(stage.kind)) {
    const stopId = stage.stop.trip_stop_id
    buttons.push({ label: `At ${stage.stop.precinct_name}`, body: { trip_id: tripId, scenario: 'at_stop', trip_stop_id: stopId } })
    buttons.push({ label: `3 km from ${stage.stop.precinct_name}`, body: { trip_id: tripId, scenario: 'away_from_stop', trip_stop_id: stopId } })
    if (stage.kind === 'before_departure') {
      buttons.push({ label: 'Truck leaves before departure', body: { trip_id: tripId, scenario: 'left_before_departure' } })
    }
    buttons.push(...silentHorse)
  }

  if (buttons.length === 0) return null
  return (
    <section aria-label="Tracker" className="space-y-2">
      <h3 className="font-medium">Tracker <span className="text-xs font-normal text-slate-500">(simulated — every finding comes from the real check)</span></h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {buttons.map(b => (
          <Button key={b.label} variant="secondary" disabled={busy} onClick={() => onScenario(b.body)}>{b.label}</Button>
        ))}
      </div>
      {stage.kind === 'on_road' && <Button variant="ghost" disabled={busy} onClick={onCheck}>Run tracker check</Button>}
    </section>
  )
}
```

`ParcelPerfectActions.tsx`:

```tsx
import { Button } from '@/components/ui/Button'
import type { DemoStage } from '@/lib/dev/demo-stage'
import { ppRequestForPreset, type PpPreset } from '@/lib/dev/presets'
import type { DevConsignment, DevTripSummary, PpTriggerRequest } from '@/lib/types/dev'

interface ParcelPerfectActionsProps {
  trip: DevTripSummary
  stage: DemoStage
  busy: boolean
  onPpChange: (body: PpTriggerRequest) => void
}

const PRESET_LABELS: Record<PpPreset, string> = {
  parcel_added: 'Waybill edited in PP (+1 parcel)',
  delivered: 'Delivered (POD recorded)',
  delivery_failed: 'Delivery failed',
}

/** Each waybill once, whichever stops it is picked up or dropped at. */
function uniqueWaybills(trip: DevTripSummary): DevConsignment[] {
  const byReference = new Map<string, DevConsignment>()
  trip.stops.forEach(s => [...s.pickup_consignments, ...s.delivery_consignments]
    .forEach(c => byReference.set(c.parcel_perfect_reference, c)))
  return [...byReference.values()]
}

export function ParcelPerfectActions({ trip, stage, busy, onPpChange }: ParcelPerfectActionsProps): React.ReactElement | null {
  const outcomesOpen = stage.kind === 'confirming' || stage.kind === 'closed'
  const presets: PpPreset[] = stage.kind === 'closed' ? ['delivered', 'delivery_failed']
    : outcomesOpen ? ['delivered', 'delivery_failed', 'parcel_added'] : ['parcel_added']
  const waybills = uniqueWaybills(trip)
  if (waybills.length === 0) return null

  return (
    <section aria-label="Parcel Perfect" className="space-y-2">
      <h3 className="font-medium">Parcel Perfect</h3>
      {waybills.map(waybill => (
        <div key={waybill.parcel_perfect_reference} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{waybill.parcel_perfect_reference}</span>
          {presets.map(preset => (
            <Button key={preset} size="sm" variant="secondary" disabled={busy}
              onClick={() => onPpChange(ppRequestForPreset(trip.trip_id, waybill, preset, new Date()))}>
              {PRESET_LABELS[preset]}
            </Button>
          ))}
        </div>
      ))}
    </section>
  )
}
```

`ActivityLog.tsx`:

```tsx
import { fmtExceptionType } from '@/lib/format/exception'
import { fmtTime } from '@shared/lib/utils/datetime'
import type { ActivityEntry } from '@/lib/hooks/useDevTriggers'

interface ActivityLogProps {
  entries: readonly ActivityEntry[]
}

export function ActivityLog({ entries }: ActivityLogProps): React.ReactElement {
  if (entries.length === 0) {
    return <p className="text-xs text-slate-500">Nothing yet. Every action you take is listed here.</p>
  }
  return (
    <ul aria-label="Activity" className="space-y-1">
      {entries.map(entry => (
        <li key={entry.id} className={`text-sm ${entry.tone === 'error' ? 'text-red-600' : 'text-on-surf'}`}>
          <span className="mr-2 tabular-nums text-xs text-slate-500">{fmtTime(entry.at)}</span>
          {entry.text}
          {entry.findings.map(f => (
            <span key={`${f.exception_type}-${f.vehicle_id}`} className="ml-2 text-xs font-semibold text-amber-700">
              → {fmtExceptionType(f.exception_type)} ({f.severity})
            </span>
          ))}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 7: Rewrite `DevTriggerPanel.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { demoStageFor } from '@/lib/dev/demo-stage'
import { useDevTriggers } from '@/lib/hooks/useDevTriggers'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import { ActivityLog } from './ActivityLog'
import { AllControls } from './AllControls'
import { ParcelPerfectActions } from './ParcelPerfectActions'
import { StageHeader } from './StageHeader'
import { TrackerActions } from './TrackerActions'
import { TripPicker } from './TripPicker'
import { WarehouseActions } from './WarehouseActions'

interface DevTriggerPanelProps {
  heading: string
}

/**
 * The demo panel: pick a trip, see where it is, and simulate only the outside world
 * that fits that moment. The driver always acts on the real phone; nothing here
 * creates driver evidence. Presets fire on one click; the raw controls under
 * "All controls" keep their confirmation step.
 */
export function DevTriggerPanel({ heading }: DevTriggerPanelProps): React.ReactElement {
  const controls = useDevTriggers()
  const { trips, isLoading, activity, loadTrips } = controls
  const [tripId, setTripId] = useState<string>('')

  useEffect(() => { void loadTrips({ silent: true }) }, [loadTrips])

  // Silent refresh on any event for this trip: the panel moves on when the driver acts.
  const refresh = useCallback(() => { void loadTrips({ silent: true }) }, [loadTrips])
  useLiveResource('trip', tripId === '' ? 'any' : tripId, refresh)

  // After a write, re-read the trip so the stage and gates reflect what just happened.
  const thenRefresh = useCallback(<T,>(pending: Promise<T | null>): void => {
    void pending.then(result => { if (result !== null) refresh() })
  }, [refresh])

  const trip = trips.find(t => t.trip_id === tripId) ?? null
  const stage = trip === null ? null : demoStageFor(trip)

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3 p-4">
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="text-sm text-slate-500">
            Simulates the warehouse, Parcel Perfect and the trackers. The driver acts on the phone.
            Every action runs the same orchestration the real flow runs.
          </p>
          <TripPicker trips={trips} tripId={tripId} onChange={setTripId} />
          {trip !== null && stage !== null && <StageHeader trip={trip} stage={stage} />}
        </div>
      </Card>

      {trip !== null && stage !== null && (
        <Card>
          <div className="space-y-5 p-4">
            <WarehouseActions tripId={trip.trip_id} stage={stage} busy={isLoading}
              onScan={(body) => thenRefresh(controls.triggerScan(body))}
              onCloseSession={(body) => thenRefresh(controls.closeScanSession(body))} />
            <TrackerActions tripId={trip.trip_id} stage={stage} vehicles={trip.vehicles} busy={isLoading}
              onScenario={(body) => thenRefresh(controls.runRigScenario(body))}
              onCheck={() => thenRefresh(controls.runRoadCheck(trip.trip_id))} />
            <ParcelPerfectActions trip={trip} stage={stage} busy={isLoading}
              onPpChange={(body) => thenRefresh(controls.triggerPpChange(body))} />
            <Button variant="ghost" disabled={isLoading} onClick={() => void controls.flushMockState()}>
              Reset simulated world
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="space-y-2 p-4">
          <h3 className="font-medium">Activity</h3>
          <ActivityLog entries={activity} />
        </div>
      </Card>

      <details className="rounded-lg border border-outline-v/20 p-4">
        <summary className="cursor-pointer font-medium">All controls</summary>
        <div className="mt-4">
          <AllControls controls={controls} tripId={tripId} />
        </div>
      </details>
    </div>
  )
}
```

In `app/(app)/dev/triggers/page.tsx` change the heading prop to `"Demo panel — simulated warehouse, Parcel Perfect and trackers"` and the file's doc comment's first line to match.

- [ ] **Step 8: Run all dispatcher checks**

Run: `cd frontend/dispatcher && npm test && npm run lint && npm run type-check`
Expected: all PASS. Record pre-existing lint warnings separately.

- [ ] **Step 9: Stage**

```bash
git add frontend/dispatcher/components/dev "frontend/dispatcher/app/(app)/dev/triggers/page.tsx"
```
Suggested commit: `feat(dispatcher): demo panel follows the trip; raw controls under All controls`

---

### Task 9: Verify end to end and update the docs

**Files:**
- Modify: `docs/demo-script.md`, `docs/design-notes/2026-09-23-arrival-phase-and-live-journey.md`

- [ ] **Step 1: Full backend suite, foreground**

Run: `cd backend && pytest`
Expected: green. Paste the summary line into TASK COMPLETE.

- [ ] **Step 2: Driver app type-check** (shared types changed)

Run: `cd frontend/driver-pwa && npm run type-check && npm test`
Expected: PASS.

- [ ] **Step 3: Live click-through (local database only).** The shared Supabase dev DB lacks the S2/S4 columns until S5; Ciaran points `DATABASE_URL` at a local Postgres and runs `alembic upgrade head` there himself. With `DEV_PANEL_ENABLED=true`, `PULSE_USE_MOCK=true`, `NEXT_PUBLIC_DEV_PANEL=true`: create a single-leg trip with one trailer, open the trip page and `/dev/triggers` side by side, and walk: scan out all → close session → (phone: loading, departure) → "Driving normally" → "Trailer … uncoupled" → confirm a CRITICAL "Trailer separated on the road" appears on the trip's journey without a reload → "Truck reaches …" → (phone: arrive) → scan in one missing → close session → (phone: unload, confirm) → PP delivered. If local services are unavailable, say so; do not claim this step passed.

- [ ] **Step 4: Update `docs/demo-script.md` §2.** Replace "a **7-row phase plan**" with "an **8-row phase plan**" (creation · activation · loading · departure · in transit · arrival · unloading · confirmation), and insert after step 5 (Departure — the seal):

```markdown
**5a. On the road — an uncoupled trailer.** *(Demo panel → Tracker.)*
Press "Driving normally", then "Trailer {registration} uncoupled".
→ *On screen (dispatcher, no reload):* a CRITICAL **Trailer separated on the road** appears on the
in-transit leg's journey, with the trailer's position and its distance from the horse.
Say: *"Nobody typed that. The panel only moved a simulated tracker. The system read both trackers,
measured the gap, and recorded it — source: system. We don't have live Pulsit credentials, so the
tracker is simulated; everything after the position is the real pipeline."*
Then press "Truck reaches {destination}" so the arrival check passes.

**5b. Arrival — the seal as found.** The driver inspects the seal before any door opens. Scanning in
is locked on the panel until this completes; point at the reason it gives.
```

and in step 4 (Loading) add: "Warehouse scans come from the demo panel (Warehouse → All parcels / One parcel short), then **Close scan session** unblocks the driver."

Update §1's traps table with a row: `| **Demo panel flags** | Backend DEV_PANEL_ENABLED=true and PULSE_USE_MOCK=true; dispatcher NEXT_PUBLIC_DEV_PANEL=true. Turn DEV_PANEL_ENABLED off when the demo window closes. |`

- [ ] **Step 5: Mark S7 done in the design note.** In §7, append ` — **done 2026-09-XX**` (real date) to the S7 row's "Done when" cell.

- [ ] **Step 6: Stage and report**

```bash
git add docs/demo-script.md docs/design-notes/2026-09-23-arrival-phase-and-live-journey.md
```
Suggested commit: `docs: demo script for the trip-following panel and road incidents`

Produce the CLAUDE.md TASK COMPLETE block. Shared files: `backend/app/db/models/enums.py`, `backend/app/main.py`, `frontend/shared/lib/types/exception.ts`, `frontend/shared/lib/constants/status-meta.ts`. Migrations: none. New .env keys: none. Tell Tim: three new exception types may need labels in the incident report / evidence pack.
