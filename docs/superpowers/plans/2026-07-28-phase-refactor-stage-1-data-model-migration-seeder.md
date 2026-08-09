# Phase Refactor — Stage 1: Data Model, Migration, Seeder

**Created:** 2026-07-28 · **Owner:** Ciaran · **Branch:** `Phase-refactor`
**Parent plan:** `docs/superpowers/plans/2026-07-25-phase-model-refactor.md` — *that document is the
source of truth. If this plan and the parent disagree, the parent wins.*
**Predecessor:** `docs/superpowers/plans/2026-07-27-phase-refactor-stage-0-test-infra-and-contract.md`
— read its **Findings ledger** before starting; DE1/DE2 there are inputs to task 1.5.
**Status:** ready to execute · executed by subagents that start cold and cannot ask questions.

---

## Invariants — must not break

- Layering: endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db.
  `integrations/` never imports from `api/` or `orchestration/`. `db/` never imports from `app/`.
- POPIA: only SHA-256 hashes reach Hedera. No GPS, photos, names, or parcel details in any
  canonical payload. Personal data stays in Postgres.
- RLS: FastAPI runs as `service_role` and bypasses RLS, so RLS breakage is SILENT. Any new or
  renamed table must be in the enumeration and carry its policies.
- The ledger is the truth. `current_phase`/`current_stop` are caches — no write path may branch
  on them.
- Length is data. Nothing may hard-code 6 phases or sequence 0..6.
- Anchor policy: P0 fail-closed; P3/P6 fail-open with `anchor_status` recorded; P1/P2/P4/P5 not
  anchored.
- Never run git write commands. Suggest commits; the developer runs them.
- Latest stable only: SQLAlchemy 2.0 `Mapped`/`mapped_column`, Pydantic v2, async endpoints via
  `get_db()`, no `any` in TypeScript.

---

## Objective

The phase ledger exists in the database — `phase_events` with per-stop anchoring, anchor state and
an idempotency key, RLS intact — and a single-leg (7-row) and a cross-dock (11-row) trip can be
seeded into it from a clean database on real Supabase Auth.

## Why now

The engine (Stage 2) has nowhere to write until the shape exists, and the migration is the one step
that is genuinely hard to undo. Two things also expire if this slips: the refactor DB is currently
empty of trips (0 rows in `auth.users`), which is the cheapest moment this migration will ever face;
and `seed_demo.py` cannot bootstrap a clean database at all today — it predates the `0002` auth FKs
— so nothing downstream can be demonstrated from cold until 1.5 lands.

---

## Prerequisites

### Must be true before the first edit

| # | Condition | How to check |
|---|---|---|
| P1 | Branch is `Phase-refactor`, tree clean | `git branch --show-current`, `git status` |
| P2 | Test Postgres is up | `docker compose -f infrastructure/docker/docker-compose.test.yml up -d` then `ps` → `freightproof-test-db  Up (healthy)` |
| P3 | Baseline suite reproduces | `cd backend && .venv/bin/python -m pytest -q` → **70 failed, 250 passed, 0 skipped** |
| P4 | Unit suite green (the Stop hook's gate) | `cd backend && .venv/bin/python -m pytest tests/unit -q` → **178 passed** |
| P5 | Wiring points at the refactor project | `cd backend && PYTHONPATH=. .venv/bin/python scripts/check_supabase_wiring.py` → all checks pass, ref `spjugofbopoyrmmpucjr` for **both** `DATABASE_URL` and `SUPABASE_URL` |
| P6 | Migration head is `tim_add_exception_gps`, single | `cd backend && .venv/bin/alembic heads` |
| P7 | RLS before-numbers recorded | `pg_policies` on `handshake_events` = **3**; `public` total = **45** (Stage 0 ledger) |

### Human confirmations — answered by Ciaran 2026-07-28

Neither could be verified from inside this repo. Both are now closed; a cold agent must **not**
block on them.

- [x] **Storage bucket `evidence-artifacts` exists** in project `spjugofbopoyrmmpucjr`
      (`_BUCKET`, `app/storage/supabase_storage.py:16` — "one bucket per environment, never
      configurable"). Alembic knows nothing about it; artifact upload fails without it.
      **Confirmed created 2026-07-28.**
- [x] **`pg_dump` of the old project `smaurrwbawosufedubeq` — deliberately NOT taken.**
      Decision by Ciaran, 2026-07-28: the old project is a separate database that Stage 1 never
      writes to. `DATABASE_URL` points at `spjugofbopoyrmmpucjr`, the migration and the lifecycle
      reset both run there, and nothing in this stage connects to the old project. Parent §5.4's
      dump requirement was written against a single shared dev DB and does not bind here.

> 🔴 **What the dump was actually insuring against, and how it is covered instead.** The one real
> risk is `dev_reset_lifecycle.py --yes` running while `DATABASE_URL` is misconfigured — not
> hypothetical, since Stage 0 found three wiring values still pointing at the old project. Mitigated
> at the source rather than with a backup: **1.5b's reset script takes a required `--project-ref`
> and refuses to run unless it matches the host in `DATABASE_URL`.** Verification step 6 runs
> `check_supabase_wiring.py` before anything destructive.
>
> **Where the dump becomes mandatory again: promotion (parent §5.6).** Pointing `DATABASE_URL` at
> the old project and running `alembic upgrade head` + the lifecycle reset is the moment reference
> data created through the UI — drivers, vehicles and precincts that `seed_demo.py` does not
> recreate — becomes unrecoverable. **Dump before that step, not before this one.** Promotion is
> post-presentation by design (parent §5.6's sequencing rule), so this is not Stage 1's problem.

### Environment

- Python is **`backend/.venv/bin/python`**. No bare `python`. Alembic is `backend/.venv/bin/alembic`.
- **Never read, print, or log `backend/.env`.** Use `check_supabase_wiring.py` when you need to know
  what it points at — it masks everything.
- The **test** database (`TEST_DATABASE_URL`, localhost:5433) is built by
  `Base.metadata.create_all()` in `tests/conftest.py:172`, **never by Alembic**. It has no Supabase
  `auth` schema and therefore **cannot** run `alembic upgrade head` (migrations `0002`/`0003` call
  `auth.jwt()` / `auth.uid()`). Migration verification runs against the refactor Supabase project
  only. This is why a broken migration passes CI clean, and why the Verification section runs
  Alembic by hand.

---

## Decisions taken while writing this plan

These close forks a cold agent would otherwise have to guess at. They sit **below** parent §1's
D1–D9 — none of them reopens a locked decision. Ciaran can veto any of them; if none is vetoed, the
executing agent treats them as settled.

### S1 — `TripStatus` coarsens **additively**. No value is deleted in Stage 1.

`advance_h1..h5` gate on fine-grained `TripStatus` (`expected_status=TripStatus.ORIGIN_GATE_IN`,
`handshake_service.py:117,162,206,264,322`) and 12 unit tests assert those transitions. Deleting the
fine values in Stage 1 would either break the module at import time or silently collapse every
sequence gate to a no-op — destroying the 24-test net Stage 0 exists to provide, one stage before
Stage 2 rebuilds it.

**So:** `TripStatus` gains `ACTIVE`. `CREATED`, `CLOSED`, `CANCELLED`, `EXCEPTION_HOLD` are already
coarse. `ORIGIN_GATE_IN`, `LOADING`, `IN_TRANSIT`, `DEST_GATE_IN`, `ORIGIN_GATE_OUT`, `UNLOADING`
stay, each marked `# LEGACY (H-model)` with the deletion owner named as Stage 2.2. That is the
coarse collapse, done in the order that keeps the net alive. Same shape as Stage 0's own correction
on `mocks/trips.ts`: **add alongside; subtract later.**

### S2 — The vocabulary swap is total; the behaviour change is zero.

The parent's fence for 1.1 is *"don't touch `advance_*` yet"*. Renaming the model class, the column,
and the enum makes that literally unsatisfiable — `handshake_service.py` would not import. The fence
is therefore read precisely:

> **Stage 1 may rewrite identifiers anywhere in `backend/app/` and `backend/tests/`. It may not
> change a single control-flow decision, sequence gate, status transition, anchor call, exception
> raised, or canonical payload byte.**

Concretely: `advance_h1..h5` keep their names, their fine-grained `TripStatus` gates, their
fail-closed anchors, and their seal-at-`LOADING` lookups. Only the symbols they reference change.
No compatibility shim, no alias, no `HandshakeEvent = PhaseEvent`: a shim has to be removed in Stage
2 anyway and would hide exactly the breakage this stage needs to surface.

**Old → new identifier map, applied everywhere:**

| Old | New |
|---|---|
| `HandshakeEvent` (model) | `PhaseEvent` |
| `db/models/handshakes.py` | `db/models/phases.py` |
| `handshake_events` (table) | `phase_events` |
| `handshake_type` (column + attr) | `phase_type` |
| `HandshakeType` (enum) | `PhaseType` — **new value set, D5** |
| `HandshakeStatus` (enum) | `PhaseStatus` — values identical |
| `SubjectType.HANDSHAKE_EVENT` | `SubjectType.PHASE_EVENT` (value `"phase_event"`) |
| `trailer_gps_snapshots.handshake_event_id` | `.phase_event_id` |
| `exceptions.handshake_event_id` | `.phase_event_id` |

**Phase-type mapping used when re-pointing `advance_h*` (parent §2.5):**

| Function | Old `HandshakeType` | New `PhaseType` |
|---|---|---|
| `create_trip` (H0) | `TRIP_CREATION` | `TRIP_CREATION` |
| `advance_h1` | `ORIGIN_GATE_IN` | `ACTIVATION` |
| `advance_h2` | `LOADING` | `LOADING` |
| `advance_h3` | `ORIGIN_GATE_OUT` | `DEPARTURE` |
| `advance_h4` | `DEST_GATE_IN` | `UNLOADING` |
| `advance_h5` | `UNLOADING` | `CONFIRMATION` |

### S3 — `compute_h2_canonical_payload` / `compute_h5_canonical_payload` are **not touched at all**.

*Reviewed by Ciaran 2026-07-28: deferring is fine, recording it is the requirement. Done — see
**Carried into Stage 2**, which now also records the constraint this removes from Stage 2.7.*

Not their bodies, not their parameter names, not the literal keys `"handshake_event_id"` and
`"handshake_type": "loading"` / `"unloading"`. Those strings are hashed and anchored; changing one
changes every event hash. Payload re-pointing is Stage 2.7, behind its own byte-identity fence
(parent §9: a rebuilt payload that differs makes `/verify` return `db_mismatch` on a healthy trip,
which the dispatcher renders as **tamper detected** — worse than an error).

### S4 — Pydantic classes keep their names; only the field the ORM forces is renamed.

`HandshakeEventRead` etc. are `from_attributes=True`, so `model_validate(phase_event_row)` fails the
moment the ORM attribute is `phase_type`. The **field** `handshake_type: HandshakeType` therefore
becomes `phase_type: PhaseType`. The **class** names (`HandshakeEventRead`, …) and
`TripDetailResponse.handshakes` do **not** change — parent §7 assigns `PhaseEventRead` and
`.phases` to Stage 3.2.

**Known, accepted consequence:** the wire key `handshakes[].handshake_type` becomes
`handshakes[].phase_type`, so the dispatcher's trip-detail page reads `undefined` for that field
between now and Stage 4. The five `/h{n}/complete` routes are retired in Stage 3.1 regardless. Do
not "fix" the dispatcher here — Stage 4 owns it.

### S5 — The lifecycle reset uses ordered `DELETE`, not `TRUNCATE … CASCADE`.

Parent §5.3 states the intent (*"trip-scoped `blockchain_receipts`"*) and suggests the method
(*"`TRUNCATE … CASCADE` from `trips`"*). Verified: those two conflict.
`blockchain_receipts.trip_id → trips.id`, and `vehicle_events.blockchain_receipt_id` /
`driver_events.blockchain_receipt_id → blockchain_receipts.id`. `TRUNCATE … CASCADE` empties whole
referencing **tables**, not matching rows — so truncating `trips` would wipe every
`vehicle_created`/`driver_updated` receipt and the entire fleet audit trail with them, silently.

Ordered `DELETE` inside one transaction delivers the stated scope exactly, is trivially fast at demo
volumes, and has no cascade surprises. The reference-count assertion the parent asks for then
actually means something.

> 🔴 **A trip is immutable evidence. Nothing in the application may ever delete one** — no endpoint,
> no orchestration path, no UI affordance, no service function. Confirmed by Ciaran 2026-07-28.
>
> `scripts/dev_reset_lifecycle.py` is an out-of-band **developer tool for the refactor database**,
> in the same category as `seed_demo.py`: it is why the file is `dev_`-prefixed, why it demands
> `--project-ref` *and* `--yes`, and why it lives in `scripts/` and not in `app/`. It exists for one
> reason — `trips.trip_reference` is `UNIQUE`, so re-running the trip seeder during Stages 1–4 fails
> on the second run without it. It is a **no-op on the refactor DB today**, which currently holds
> zero trips.
>
> **Fence:** nothing under `backend/app/` may import from this script, and no part of it may be
> lifted into a service or endpoint. If a future ticket asks for trip deletion as a product feature,
> that is a new design decision about the evidence model — not a reuse of this file.
>
> **Related observation, recorded not acted on:** `0003_tom_rls_policies.py:487-502` puts
> `no_update_*` / `no_delete_*` guards on six evidence tables — `evidence_artifacts`,
> `blockchain_receipts`, `merkle_batch_leaves`, `checkpoints`, `trailer_gps_snapshots`,
> `driver_substitutions` — but **`trips` and `handshake_events` are not among them.** If trips are
> immutable evidence, `trips` and `phase_events` arguably belong in that list. Deliberately **not**
> added in Stage 1: it would take `phase_events` from 3 policies to 5 and move the Stage-1 RLS gate
> off Stage 0's recorded baseline, destroying the one check that makes the rename verifiable. It
> also changes the immutability posture for all four devs. Raise it as its own change. See
> *Carried into Stage 2*.

### S6 — The plan generator lands in a new module, not in `trip_service.py`.

`app/orchestration/phase_plan.py`, a pure function with no DB and no I/O. Stage 2.1 calls it from
`trip_service.create_trip`; Stage 1.5's seeder calls it now. Putting it in `trip_service.py` today
would collide head-on with Stage 2's largest edit. It is unit-testable, so the Stop hook keeps
covering it.

---

## Tasks

Nine tasks. Each states **Where** and a **Fence**. Verification is one section at the end — do not
run gates between tasks except the cheap import check noted in 1.2.

---

### 1.1 — `enums.py`: `PhaseType`, `PhaseStatus`, `AnchorStatus`, coarse `TripStatus`, `SubjectType.PHASE_EVENT`

**Where:** `backend/app/db/models/enums.py` only.
**Fence:** this file only. Do not update any importer in this task — 1.2 does that, and a broken
import between the two is expected. Do not delete any `TripStatus` value (S1).

Replace the `TripStatus` block (`enums.py:20-30`):

```python
class TripStatus(str, enum.Enum):
    """Coarse trip lifecycle. The phase ledger — not this field — sequences a trip.

    CREATED / ACTIVE / CLOSED (+ CANCELLED, EXCEPTION_HOLD) are the whole model
    after Stage 2. The LEGACY values below are still assigned by advance_h1..h5,
    which Stage 2.2 replaces with advance_phase(); they are deleted with it.
    Nothing new may branch on a LEGACY value.
    """

    CREATED          = "created"
    ACTIVE           = "active"
    CLOSED           = "closed"
    CANCELLED        = "cancelled"
    EXCEPTION_HOLD   = "exception_hold"

    # LEGACY (H-model) — assigned only by advance_h1..h5. Deleted in Stage 2.2.
    ORIGIN_GATE_IN   = "origin_gate_in"
    LOADING          = "loading"
    ORIGIN_GATE_OUT  = "origin_gate_out"
    IN_TRANSIT       = "in_transit"
    DEST_GATE_IN     = "dest_gate_in"
    UNLOADING        = "unloading"
```

Replace `HandshakeType` and `HandshakeStatus` (`enums.py:39-53`) with:

```python
class PhaseType(str, enum.Enum):
    """One entry in a trip's committed phase plan — parent plan D5.

    The plan's LENGTH is data, generated at trip creation from the trip's stops
    and consignments. A 2-stop trip is 7 rows, a 3-stop cross-dock is 11. Any
    code that treats this enum's cardinality as the number of phases in a trip
    is wrong: the same type appears more than once on a multi-stop route.
    """

    TRIP_CREATION = "trip_creation"
    ACTIVATION    = "activation"
    LOADING       = "loading"
    DEPARTURE     = "departure"
    IN_TRANSIT    = "in_transit"
    UNLOADING     = "unloading"
    CONFIRMATION  = "confirmation"


class PhaseStatus(str, enum.Enum):
    PENDING     = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED   = "completed"
    EXCEPTION   = "exception"
    OVERRIDDEN  = "overridden"


class AnchorStatus(str, enum.Enum):
    """Hedera anchor state for one phase event — parent plan D4.

    A phase may be `completed` while its anchor is `failed`: that combination is
    what makes the fail-open policy (D7) honest, because the system still knows a
    receipt is owed. Never render `failed` as success.
    """

    NOT_REQUIRED = "not_required"
    PENDING      = "pending"
    ANCHORED     = "anchored"
    FAILED       = "failed"
```

In `SubjectType` (`enums.py:107-113`) rename the member and its value:

```python
    PHASE_EVENT     = "phase_event"
```

**Exit:** `HandshakeType` and `HandshakeStatus` no longer exist in this file.

---

### 1.2 — Models: `PhaseEvent`, `Trip` denorm columns, re-pointed FKs, and the identifier ripple

**Where:**
`backend/app/db/models/handshakes.py` → **renamed to** `backend/app/db/models/phases.py`;
`backend/app/db/models/trips.py`; `backend/app/db/models/transit.py`;
`backend/app/db/models/__init__.py` *(shared — flag it)*;
plus every importer listed in the ripple table below.
**Fence:** identifiers only outside `db/models/` (S2). Do not touch
`compute_h2_canonical_payload` / `compute_h5_canonical_payload` in any way (S3). Do not touch
`app/auth/dependencies.py`. Do not add relationships (`relationship()`) — none exist today and
adding them changes lazy-load behaviour, which is a live bug family here (Stage 0 finding F2 item 5).

**1.2a — `db/models/phases.py`** (the file is `git mv`-able, but the developer runs git; just create
the new file with this content and delete the old one):

```python
"""SQLAlchemy models for phase events and per-trailer GPS snapshots."""

import uuid
from decimal import Decimal
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Index, Integer, Numeric,
    SmallInteger, String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import AnchorStatus, PhaseStatus, PhaseType


class PhaseEvent(Base):
    """One row per phase per trip — the ledger the trip's position is DERIVED from.

    Rows are written at trip creation, all `pending`, in plan order; completion
    fills them in. `sequence_number` is the row's index in that committed plan,
    NOT an enum index and NOT bounded by 6 — a three-stop cross-dock has 11 rows
    and contains `loading` twice.
    """

    __tablename__ = "phase_events"
    __table_args__ = (
        # D3: only trip_creation has a NULL trip_stop_id, so this constraint is
        # total for P1..P6. PostgreSQL treats NULLs as distinct in a unique
        # constraint, which is exactly why in_transit is anchored to the stop it
        # DEPARTS FROM rather than left NULL — otherwise duplicate NULL-stop rows
        # would slip through this.
        UniqueConstraint("trip_id", "trip_stop_id", "phase_type", name="uq_phase_events_trip_stop_type"),
        # The other half of D3: exactly one P0 per trip, which the constraint
        # above cannot express because its trip_stop_id is NULL.
        Index(
            "uq_phase_events_trip_creation",
            "trip_id",
            unique=True,
            postgresql_where=text("phase_type = 'trip_creation'"),
        ),
        # Replay protection for the driver app's offline queue. Partial, because
        # server-generated rows (the whole plan at creation) carry no key.
        Index(
            "uq_phase_events_idempotency_key",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
        Index("ix_phase_events_trip_sequence", "trip_id", "sequence_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    # NULL only for trip_creation (D3). in_transit anchors to its departure stop.
    trip_stop_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=True
    )
    phase_type: Mapped[PhaseType] = mapped_column(String(30), nullable=False)
    sequence_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[PhaseStatus] = mapped_column(String(20), nullable=False, server_default="pending")
    # D4. Decoupled from `status` on purpose: a completed phase whose anchor
    # failed is a real state under the fail-open policy, and the system must be
    # able to say a receipt is owed.
    anchor_status: Mapped[AnchorStatus] = mapped_column(
        String(20), nullable=False, server_default="not_required"
    )
    # The driver app's offline-queue entry id, echoed back on replay. Drivers lose
    # signal; a resubmitted completion must return the current state, never a
    # duplicate row and never an error.
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    dispatcher_override_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    dispatcher_override_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    driver_phone_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    driver_phone_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    horse_gps_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    horse_gps_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    pulsit_geofence_confirmed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    seal_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    # Artifact FKs use use_alter=True to break the circular dependency in the
    # migration: evidence_artifacts is created before trips, so these FKs are
    # added via ALTER TABLE after all tables exist.
    seal_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_seal_photo"),
        nullable=True,
    )
    waybill_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_waybill_photo"),
        nullable=True,
    )
    gate_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_gate_photo"),
        nullable=True,
    )
    pod_photo_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_pod_photo"),
        nullable=True,
    )
    # Proof of delivery is a photo AND an on-device signature (BQ2 resolved 2026-06-29) —
    # both are required at confirmation, not either/or.
    pod_signature_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_pod_signature"),
        nullable=True,
    )
    parcel_manifest_snapshot: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    parcel_count_origin: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    parcel_count_destination: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    driver_visual_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    event_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("blockchain_receipts.id", use_alter=True, name="fk_phase_blockchain_receipt"),
        nullable=True,
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class TrailerGpsSnapshot(Base):
    """Per-trailer GPS reading at each phase — independent Pulsit source for cross-reference."""

    __tablename__ = "trailer_gps_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phase_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=False
    )
    trailer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False
    )
    pulsit_device_id: Mapped[str] = mapped_column(String(100), nullable=False)
    lat: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
```

> The old `HandshakeEvent` declared its index in the migration only
> (`0001_initial_schema.py:452`) and not on the model, so `create_all` never built it — the test DB
> and the real DB disagreed. Declaring `ix_phase_events_trip_sequence` in `__table_args__` closes
> that gap; the migration in 1.3 renames the existing one rather than creating a second.

**1.2b — `db/models/trips.py`**, in `Trip`, immediately after the `status` column (`trips.py:148`):

```python
    # Denormalised caches of the ledger derivation (D6), maintained on every phase
    # completion so list views don't recompute across every trip. READ PATHS ONLY.
    # No write path may branch on these: the ledger is the truth, and a stored
    # position can drift from what actually happened — which is the entire reason
    # this refactor exists.
    current_phase: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    current_stop: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
```

**1.2c — `db/models/transit.py`**, in `TripException` (`transit.py:58-60`), rename the column and
update the comment at `:64-67` (it currently says handshakes "learn their stop in the iter-3 per-stop
refactor" — that refactor is this one):

```python
    phase_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=True
    )
```

Also update `Checkpoint`'s docstring (`transit.py:18`): "between handshakes" → "between phases".

**1.2d — `db/models/__init__.py`** *(shared file — flag in TASK COMPLETE)*, line 33:

```python
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot  # noqa: E402,F401
```

**1.2e — the identifier ripple.** Every file below must be updated in this task or the package will
not import. Nothing here is a behaviour change.

| File | Edit |
|---|---|
| `app/orchestration/handshake_service.py` | Imports; `HandshakeEvent`→`PhaseEvent`, `.handshake_type`→`.phase_type`, `HandshakeStatus`→`PhaseStatus`, `SubjectType.HANDSHAKE_EVENT`→`.PHASE_EVENT`. Apply the S2 phase-type mapping at `:119, :164, :208, :224, :266, :270, :324, :328`. `TripException(handshake_event_id=…)`→`phase_event_id=…` at `:244, :282, :361`. `_get_handshake_event`'s `list(HandshakeType).index(...)` → `list(PhaseType).index(...)` (`:76`). **Do not touch `:136-154` or `:298-314`.** |
| `app/orchestration/trip_service.py` | `:18-19, :25` imports; `:248-254` H0 row → `PhaseEvent(trip_id=…, phase_type=PhaseType.TRIP_CREATION, sequence_number=0, status=PhaseStatus.PENDING)`; `:203-206` comment wording. **Leave `:85-92`'s `active_statuses` list exactly as it is** — the LEGACY values are still real (S1). |
| `app/orchestration/resource_service.py` | `:20, :27` imports; `:163-165` query; `:180-191` `SubjectType.PHASE_EVENT`; local name `handshake_event_ids`→`phase_event_ids`. Keep the `handshakes=` kwarg at `:235` (S4). |
| `app/orchestration/verification_service.py` | `:22-23` imports; `:138` query; `:142` → `PhaseType.LOADING`; **`:153` → `PhaseType.CONFIRMATION`** (advance_h5 now writes `confirmation`, per S2's mapping — this is the one line in this task where a wrong mechanical substitution silently breaks `/verify`); `:198` `SubjectType.PHASE_EVENT`. Function may keep its name. |
| `app/blockchain/subject_visibility.py` | `:15` import; `:62` `SubjectType.PHASE_EVENT`; `:66-69` query. |
| `app/schemas/handshakes.py` | `:11` import; `:18` field → `phase_type: PhaseType`; `:34, :59` → `PhaseStatus`; `:87` → `phase_event_id: UUID`. (1.4 also deletes `:23-28`.) |
| `app/schemas/transit.py` | `:77` → `phase_event_id: Optional[UUID] = None`. |
| `app/schemas/__init__.py` | No symbol changes (S4) — verify it still imports. |
| `app/api/v1/endpoints/handshakes.py` | `:16` import; `:116-129` path param `handshake_type: PhaseType` (route string unchanged). |
| `app/api/v1/endpoints/trips.py` | `:50` docstring wording only. |
| `tests/unit/test_handshake_service.py` | Identifier substitutions + the S2 phase-type mapping in fixtures/asserts. **Every `TripStatus` assertion stays exactly as written** — those transitions do not change in Stage 1. |
| `tests/unit/test_handshake_anchor_payload.py` | Identifiers + `SubjectType.PHASE_EVENT` (`:184, :205, :238, :263`). **Payload dict literals at `:146-166` must not change** (S3). |
| `tests/unit/test_subject_visibility.py` | `SubjectType.PHASE_EVENT` (`:46, :59`). |
| `tests/integration/test_trips.py` | `:23` import; `:169, :456` → `"phase_type"`; `:231` → `PhaseType.TRIP_CREATION`; `:536` query. |

**Cheap check before moving on** (not the gate — that's at the end):

```bash
cd backend && .venv/bin/python -c "import app.main" && echo IMPORTS-OK
```

---

### 1.3 — Alembic migration, RLS work enumerated

**Where:** create `backend/migrations/versions/2026_07_28_ciaran_phase_model.py`.
**Fence:** one migration file. Do not edit any existing migration. Do not run it against the old
project `smaurrwbawosufedubeq`. Do not autogenerate — write it by hand; autogenerate cannot see a
rename and will emit drop+create, which destroys the RLS policies, the five inbound FKs and the
`use_alter` arrangement that D1 exists to preserve.

```python
"""Phase model: handshake_events -> phase_events, per-stop ledger, anchor state.

Renames rather than rebuilds (parent plan D1): the rename carries the three RLS
policies, the indexes and the five inbound FKs across automatically, and preserves
the evidence_artifacts circular-FK use_alter arrangement that 0001 works hard to
get right. What a rename does NOT carry is policy and constraint NAMES — they stay
spelled "handshake_events" on a phase_events table — so this migration renames them
explicitly. FastAPI connects as service_role and bypasses RLS, so an RLS mistake
here produces no error anywhere: it produces a phase ledger carrying driver GPS and
seal data readable outside the POPIA posture via PostgREST. Treat §5.2 of the parent
as a security control, not housekeeping.

Revision ID: 2026_07_28_ciaran_phase
Revises: tim_add_exception_gps
Create Date: 2026-07-28
Author: ciaran
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_07_28_ciaran_phase"
down_revision = "tim_add_exception_gps"
branch_labels = None
depends_on = None


# (table, old_constraint_name, new_constraint_name). Guarded by an existence check
# because 0001 let PostgreSQL auto-name the pkey and the plain FKs — those names are
# conventional, not asserted anywhere, and a hard rename would fail the whole
# migration over a cosmetic mismatch.
_CONSTRAINT_RENAMES = [
    ("phase_events", "handshake_events_pkey", "phase_events_pkey"),
    ("phase_events", "handshake_events_trip_id_fkey", "phase_events_trip_id_fkey"),
    ("phase_events",
     "handshake_events_dispatcher_override_user_id_fkey",
     "phase_events_dispatcher_override_user_id_fkey"),
    ("phase_events", "fk_handshake_seal_photo", "fk_phase_seal_photo"),
    ("phase_events", "fk_handshake_waybill_photo", "fk_phase_waybill_photo"),
    ("phase_events", "fk_handshake_gate_photo", "fk_phase_gate_photo"),
    ("phase_events", "fk_handshake_pod_photo", "fk_phase_pod_photo"),
    ("phase_events", "fk_handshake_pod_signature", "fk_phase_pod_signature"),
    ("phase_events", "fk_handshake_blockchain_receipt", "fk_phase_blockchain_receipt"),
    ("trailer_gps_snapshots",
     "trailer_gps_snapshots_handshake_event_id_fkey",
     "trailer_gps_snapshots_phase_event_id_fkey"),
    ("exceptions", "exceptions_handshake_event_id_fkey", "exceptions_phase_event_id_fkey"),
]

_POLICY_RENAMES = [
    ("phase_events", "handshake_events_dispatcher_select", "phase_events_dispatcher_select"),
    ("phase_events", "handshake_events_driver_select", "phase_events_driver_select"),
    ("phase_events", "handshake_events_client_viewer_select", "phase_events_client_viewer_select"),
]


def _rename_constraints(pairs) -> None:
    for table, old, new in pairs:
        op.execute(f"""
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{old}') THEN
                    ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new};
                END IF;
            END $$;
        """)


def _rename_policies(triples) -> None:
    for table, old, new in triples:
        op.execute(f"""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = '{table}' AND policyname = '{old}'
                ) THEN
                    ALTER POLICY {old} ON {table} RENAME TO {new};
                END IF;
            END $$;
        """)


def upgrade() -> None:
    # ── 1. The rename itself ────────────────────────────────────────────────
    op.rename_table("handshake_events", "phase_events")
    op.alter_column("phase_events", "handshake_type", new_column_name="phase_type")
    op.execute("ALTER INDEX IF EXISTS ix_handshake_events_trip_sequence "
               "RENAME TO ix_phase_events_trip_sequence")
    _rename_constraints(_CONSTRAINT_RENAMES)

    # ── 2. New columns ──────────────────────────────────────────────────────
    op.add_column(
        "phase_events",
        sa.Column("trip_stop_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_phase_events_trip_stop", "phase_events", "trip_stops", ["trip_stop_id"], ["id"],
    )
    op.add_column(
        "phase_events",
        sa.Column("anchor_status", sa.String(length=20),
                  nullable=False, server_default="not_required"),
    )
    op.add_column(
        "phase_events",
        sa.Column("idempotency_key", sa.String(length=100), nullable=True),
    )

    # ── 3. D3 uniqueness ────────────────────────────────────────────────────
    # The old constraint allowed exactly one row per (trip, type) — which is the
    # wall this refactor exists to remove: a cross-dock trip loads twice.
    op.drop_constraint("uq_handshake_events_trip_type", "phase_events", type_="unique")
    op.create_unique_constraint(
        "uq_phase_events_trip_stop_type", "phase_events",
        ["trip_id", "trip_stop_id", "phase_type"],
    )
    # PostgreSQL treats NULLs as distinct in a UNIQUE constraint, so the constraint
    # above cannot stop two trip_creation rows (both NULL-stop). This closes it.
    op.execute("""
        CREATE UNIQUE INDEX uq_phase_events_trip_creation
        ON phase_events (trip_id) WHERE phase_type = 'trip_creation';
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_phase_events_idempotency_key
        ON phase_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
    """)

    # ── 4. Inbound references ───────────────────────────────────────────────
    op.alter_column("trailer_gps_snapshots", "handshake_event_id",
                    new_column_name="phase_event_id")
    op.alter_column("exceptions", "handshake_event_id", new_column_name="phase_event_id")

    # ── 5. Trip denormalisation (D6) — caches, never sources of truth ───────
    op.add_column("trips", sa.Column("current_phase", sa.String(length=30), nullable=True))
    op.add_column("trips", sa.Column("current_stop", sa.Integer(), nullable=True))

    # ── 6. Stored subject-type discriminator ────────────────────────────────
    op.execute("UPDATE blockchain_receipts SET subject_type = 'phase_event' "
               "WHERE subject_type = 'handshake_event';")

    # ── 7. 🔴 RLS (parent §5.2) ─────────────────────────────────────────────
    # relrowsecurity is a table property and follows the rename, so RLS stays
    # ENABLED without action here — the gate asserts it rather than assuming it.
    # The three SELECT policies also follow the table, but keep stale names.
    _rename_policies(_POLICY_RENAMES)

    # trailer_gps_snapshots_dispatcher_select JOINs through this table
    # (0003_tom_rls_policies.py:456-462). PostgreSQL stores policy expressions
    # parsed, so the reference would in fact survive the rename — but "would in
    # fact" is not a security posture. Dropped and recreated so the policy body
    # visibly names phase_events / phase_event_id.
    op.execute("DROP POLICY IF EXISTS trailer_gps_snapshots_dispatcher_select "
               "ON trailer_gps_snapshots;")
    op.execute("""
        CREATE POLICY trailer_gps_snapshots_dispatcher_select ON trailer_gps_snapshots
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM phase_events pe
                JOIN trips t ON t.id = pe.trip_id
                WHERE pe.id = phase_event_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)


def downgrade() -> None:
    # ⚠️ Only reversible while no multi-stop plan exists. Restoring
    # uq_handshake_events_trip_type below fails on any trip carrying two `loading`
    # rows — which is the whole point of the forward migration. The Stage-1 gate
    # runs this against a trip-free database deliberately; do not run it blindly
    # against a seeded one.
    op.execute("DROP POLICY IF EXISTS trailer_gps_snapshots_dispatcher_select "
               "ON trailer_gps_snapshots;")
    op.execute("""
        CREATE POLICY trailer_gps_snapshots_dispatcher_select ON trailer_gps_snapshots
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM handshake_events he
                JOIN trips t ON t.id = he.trip_id
                WHERE he.id = handshake_event_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)
    _rename_policies([(t, new, old) for t, old, new in _POLICY_RENAMES])

    op.execute("UPDATE blockchain_receipts SET subject_type = 'handshake_event' "
               "WHERE subject_type = 'phase_event';")

    op.drop_column("trips", "current_stop")
    op.drop_column("trips", "current_phase")

    op.alter_column("exceptions", "phase_event_id", new_column_name="handshake_event_id")
    op.alter_column("trailer_gps_snapshots", "phase_event_id",
                    new_column_name="handshake_event_id")

    op.execute("DROP INDEX IF EXISTS uq_phase_events_idempotency_key;")
    op.execute("DROP INDEX IF EXISTS uq_phase_events_trip_creation;")
    op.drop_constraint("uq_phase_events_trip_stop_type", "phase_events", type_="unique")
    op.create_unique_constraint(
        "uq_handshake_events_trip_type", "phase_events", ["trip_id", "phase_type"],
    )

    op.drop_column("phase_events", "idempotency_key")
    op.drop_column("phase_events", "anchor_status")
    op.drop_constraint("fk_phase_events_trip_stop", "phase_events", type_="foreignkey")
    op.drop_column("phase_events", "trip_stop_id")

    _rename_constraints([(t, new, old) for t, old, new in _CONSTRAINT_RENAMES])
    op.execute("ALTER INDEX IF EXISTS ix_phase_events_trip_sequence "
               "RENAME TO ix_handshake_events_trip_sequence")
    op.alter_column("phase_events", "phase_type", new_column_name="handshake_type")
    op.rename_table("phase_events", "handshake_events")
```

> **The policy rename must be in this migration, not a follow-up.** The moment this file lands on
> `dev` it is frozen (parent §5.6) and any correction needs a whole new migration — and the failure
> it would be correcting produces no error, no failing test, and no log line.

---

### 1.4 — Delete `validate_sequence_number`

**Where:** `backend/app/schemas/handshakes.py`; `backend/tests/unit/test_schema_validators.py`.
**Fence:** delete only. Do not replace it with a different bound — sequence length is data now, and
any ceiling is the fixed-length assumption wearing a new number.

In `schemas/handshakes.py`, `HandshakeEventCreate` (`:22-28`) loses its body and its
`field_validator` import if unused:

```python
class HandshakeEventCreate(HandshakeEventBase):
    # No sequence bound. `0 <= v <= 5` encoded "H0–H5" as a schema rule; a
    # three-stop cross-dock legitimately reaches sequence 10, and the length of a
    # plan is a property of the trip's stops, not of any enum.
    pass
```

In `tests/unit/test_schema_validators.py`, delete the three tests at `:120-155`
(`test_handshake_sequence_number_valid`, `_too_high`, `_negative`) and their section comment. They
assert the deleted rule; keeping any of them re-imposes it. Their replacement is
`tests/unit/test_phase_plan.py` (below), which proves an 11-row plan is representable.

---

### 1.5 — Seeders: real-auth reference data, lifecycle reset, phase-shaped trips, test-auth conversion

**Where:** create `backend/app/orchestration/phase_plan.py`, `backend/scripts/dev_reset_lifecycle.py`,
`backend/scripts/seed_trips.py`; rewrite `backend/scripts/seed_demo.py`; convert 11 files under
`backend/tests/integration/`.
**Fence:** no new `.env` keys, no `core/config.py` change (`DISPATCHER_SEED_PASSWORD` is reused as a
script-time env var exactly as `scripts/seed_dispatcher.py` already does). Do not touch
`app/auth/dependencies.py` — `_DEMO_ORG_ID` / `_DEMO_USER_ID` stay where they are; the DEMO_MODE
stub is not being removed in this stage. Seeders must not call Hedera.

**1.5a — `app/orchestration/phase_plan.py`** (S6). This is a **port** of the verified reference
implementation `makePhasePlan()` in `frontend/shared/lib/mocks/phase-trips.ts:82-114`. Read that
function before writing this one; if the two ever disagree, one of them is a bug.

```python
"""Phase-plan generation — parent plan §2.2.

Pure and DB-free on purpose: the rule is the refactor's central claim ("length is
data") and it is easier to defend, and to test, as a function of the route than as
a side effect of trip creation. Stage 2.1 calls this from trip_service.create_trip.

This is a port of makePhasePlan() in frontend/shared/lib/mocks/phase-trips.ts,
which is the frozen contract's executable statement of the same rule. The two must
emit identical plans; the backend is authoritative if they ever drift.
"""

from dataclasses import dataclass

from app.db.models.enums import PhaseType

# D7 — the phases that carry a Hedera receipt. P1/P2/P4/P5 are feeders.
ANCHORED_PHASES: frozenset[PhaseType] = frozenset({
    PhaseType.TRIP_CREATION,
    PhaseType.DEPARTURE,
    PhaseType.CONFIRMATION,
})


@dataclass(frozen=True)
class PlanStop:
    """One stop's routing role — all the generator needs to decide what happens there.

    Derived from the trip's consignments: `picks_up` if any consignment's
    pickup_stop_id is this stop, `drops_off` if any consignment's delivery_stop_id is.
    A TripStop has no inherent origin/destination role (FP-112).
    """

    sequence: int
    picks_up: bool
    drops_off: bool


@dataclass(frozen=True)
class PlannedPhase:
    sequence_number: int
    phase_type: PhaseType
    # None only for trip_creation (D3).
    stop_sequence: int | None


def build_phase_plan(stops: list[PlanStop]) -> list[PlannedPhase]:
    """Emit a trip's committed phase plan, in order, from its stops.

    The rule: `trip_creation` once with no stop; then for each stop in sequence,
    `activation` (first stop only) or `unloading` (if anything delivers here); then
    `loading` (if anything collects here); then `departure` + `in_transit` unless it
    is the final stop, where `confirmation` is emitted instead.

    `in_transit` anchors to the stop it DEPARTS FROM, never the one it arrives at
    (D3) — which is what keeps trip_creation the only NULL-stop row and lets one
    partial unique index close the duplicate-P0 hole.

    2 stops -> 7 rows. 3-stop cross-dock -> 11 rows. The single-leg trip is the
    degenerate case of the multi-stop plan: one code path, forever.
    """
    if not stops:
        raise ValueError("a trip needs at least one stop to generate a phase plan")

    plan: list[PlannedPhase] = []

    def emit(phase_type: PhaseType, stop: PlanStop | None) -> None:
        plan.append(PlannedPhase(
            sequence_number=len(plan),
            phase_type=phase_type,
            stop_sequence=None if stop is None else stop.sequence,
        ))

    emit(PhaseType.TRIP_CREATION, None)

    last_index = len(stops) - 1
    for i, stop in enumerate(stops):
        if i == 0:
            emit(PhaseType.ACTIVATION, stop)
        elif stop.drops_off:
            emit(PhaseType.UNLOADING, stop)

        if stop.picks_up:
            emit(PhaseType.LOADING, stop)

        if i < last_index:
            emit(PhaseType.DEPARTURE, stop)
            emit(PhaseType.IN_TRANSIT, stop)
        else:
            # The final stop always closes the custody chain, even on an empty leg
            # where nothing is dropped — otherwise a repositioning run would end
            # with no unloading row and the ledger would not be a complete story.
            if i != 0 and not stop.drops_off:
                emit(PhaseType.UNLOADING, stop)
            emit(PhaseType.CONFIRMATION, stop)

    return plan
```

**1.5b — `scripts/dev_reset_lifecycle.py`** (S5).

```python
"""DEVELOPER TOOL — delete every lifecycle row from the refactor database.

A trip is immutable evidence. FreightProof has no trip-deletion feature and must
never grow one: no endpoint, no orchestration path, no UI affordance. This script is
out-of-band maintenance for a disposable refactor database, in the same category as
seed_demo.py, and nothing under app/ may import from it. It exists because
trips.trip_reference is UNIQUE, so re-seeding demo trips during Stages 1-4 fails on
the second run without it.

Existing trips are old-shape and anchored over old payloads; parent §5.3 regenerates
them rather than migrating them. Reference data — organizations, precincts, users,
drivers, vehicles, templates, SLA configs — survives untouched, and the script
asserts that rather than hoping.

Ordered DELETE, not TRUNCATE ... CASCADE. TRUNCATE CASCADE empties whole referencing
TABLES, not matching rows: blockchain_receipts.trip_id -> trips, and
vehicle_events / driver_events -> blockchain_receipts, so truncating trips would
silently wipe the entire fleet audit trail. At demo volumes DELETE costs nothing.

--project-ref is required and is checked against DATABASE_URL's host before a
single row is touched. No pg_dump stands behind this script (decision 2026-07-28),
so the guard IS the safety net: the failure mode that matters is running it while
DATABASE_URL still points at the old fallback project, which is exactly the class
of misconfiguration Stage 0 found three instances of.

Usage:
    cd backend
    PYTHONPATH=. .venv/bin/python scripts/dev_reset_lifecycle.py --project-ref spjugofbopoyrmmpucjr --yes
"""

import argparse
import asyncio
from urllib.parse import urlsplit

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# FK-safe order: children before parents. phase_events precedes evidence_artifacts
# and blockchain_receipts because it points at both; exceptions and checkpoints
# precede merkle_batches for the same reason.
_DELETE_ORDER = [
    "merkle_batch_leaves",
    "trailer_gps_snapshots",
    "driver_substitutions",
    "exceptions",
    "checkpoints",
    "phase_events",
    "parcels",
    "consignments",
    "evidence_artifacts",
    "merkle_batches",
    "trip_trailers",
    "trip_stops",
]

# Trip-scoped receipts only. Vehicle/driver receipts carry trip_id IS NULL and are
# referenced by vehicle_events / driver_events, which are reference-side audit rows.
_RECEIPTS_DELETE = "DELETE FROM blockchain_receipts WHERE trip_id IS NOT NULL"

_REFERENCE_TABLES = [
    "organizations", "precincts", "users", "drivers", "vehicles",
    "trip_templates", "sla_configs", "vehicle_events", "driver_events",
]


async def _counts(db: AsyncSession, tables: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for table in tables:
        result = await db.execute(text(f"SELECT count(*) FROM {table}"))  # noqa: S608 — fixed literal list
        out[table] = int(result.scalar_one())
    return out


async def reset() -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with async_session() as db:
            before = await _counts(db, _REFERENCE_TABLES)

            for table in _DELETE_ORDER:
                result = await db.execute(text(f"DELETE FROM {table}"))  # noqa: S608
                print(f"  {table:<24} {result.rowcount or 0} deleted")
            result = await db.execute(text(_RECEIPTS_DELETE))
            print(f"  {'blockchain_receipts':<24} {result.rowcount or 0} deleted (trip-scoped only)")

            result = await db.execute(text("DELETE FROM trips"))
            print(f"  {'trips':<24} {result.rowcount or 0} deleted")

            after = await _counts(db, _REFERENCE_TABLES)
            drift = {t: (before[t], after[t]) for t in _REFERENCE_TABLES if before[t] != after[t]}
            if drift:
                # Roll back rather than report: a reset that ate reference data is
                # not a reset, and the dump is the only way back.
                await db.rollback()
                raise SystemExit(f"ABORTED — reference tables changed: {drift}")

            await db.commit()
            print("Lifecycle reset complete; reference data unchanged.")
    finally:
        await engine.dispose()


def _assert_target(project_ref: str) -> None:
    """Refuse to run unless DATABASE_URL's host names the expected Supabase project.

    Compares against the host only, and never echoes the URL or any part of it —
    a connection string carries the database password.
    """
    host = urlsplit(settings.DATABASE_URL).hostname or ""
    if project_ref not in host:
        raise SystemExit(
            f"ABORTED — DATABASE_URL does not point at project '{project_ref}'. "
            "Run scripts/check_supabase_wiring.py to see (masked) where it actually points. "
            "Nothing was deleted."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Delete all lifecycle data. Irreversible.")
    parser.add_argument(
        "--project-ref",
        required=True,
        help="Supabase project ref that DATABASE_URL must name, e.g. spjugofbopoyrmmpucjr. "
             "Typing it is the point: it is what stops this running against the fallback project.",
    )
    parser.add_argument("--yes", action="store_true", help="Required. There is no undo.")
    args = parser.parse_args()
    if not args.yes:
        raise SystemExit("Refusing to run without --yes.")
    _assert_target(args.project_ref)
    asyncio.run(reset())


if __name__ == "__main__":
    main()
```

**1.5c — `scripts/seed_demo.py`, rewritten for real Supabase Auth** (parent §5.5 step 5).

```python
"""Seed reference data into a clean database, on real Supabase Auth.

Reference data only — two organizations, one dispatcher, two drivers, two vehicles,
three precincts. Trips and their phase ledgers come from scripts/seed_trips.py.

Why this is a rewrite and not an edit: migration 0002 added
users.id -> auth.users(id) and drivers.id -> auth.users(id), so the previous
script's hardcoded _DEMO_USER_ID and uuid4() driver ids cannot satisfy the FKs on a
fresh project. It has only ever worked because the team shares one long-lived dev
DB. The IDs must come FROM Supabase Auth, which is also exactly what POST /drivers
does in production — so the seeder ends up aligned with real behaviour rather than
working around it.

Not idempotent for auth: the admin helpers raise DuplicateResourceError on re-run
rather than returning the existing id. Rows that already exist are skipped; an auth
account that exists without its public row aborts with an actionable message.

Usage:
    cd backend
    DISPATCHER_SEED_PASSWORD='...' PYTHONPATH=. .venv/bin/python scripts/seed_demo.py
"""

import asyncio
import getpass
import os
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.exceptions import DuplicateResourceError
from app.db.models.enums import DispatcherRole, IdvsStatus, OrganizationType, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
from app.integrations.supabase_admin import create_dispatcher_auth_user, create_driver_auth_user

# Same env var scripts/seed_dispatcher.py already uses — no new config key.
_PASSWORD_ENV_VAR = "DISPATCHER_SEED_PASSWORD"

# Organizations carry no auth FK, so their ids stay fixed: the frontend .env files
# reference the client org id directly. Values match the previous script so nothing
# downstream has to be re-pointed.
_OPERATOR_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
_CLIENT_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")

_DISPATCHER_EMAIL = "demo-dispatcher@freightproof.co.za"
_DISPATCHER_NAME = "Demo Dispatcher"

# (full_name, id_number, phone, license_number)
_DRIVERS = [
    ("Sipho Dlamini", "8001015009087", "+27821234567", "DRV-001"),
    ("Thabo Mokoena", "7505105008083", "+27829876543", "DRV-002"),
]

# (registration, vehicle_type, pulsit_device_id)
_VEHICLES = [
    ("CA 123-456", VehicleType.HORSE, "PLT-HORSE-001"),
    ("CA 789-012", VehicleType.TRAILER, "PLT-TRAILER-001"),
]

# (name, lat, lng). Three, not two: the cross-dock demo trip needs a middle stop.
_PRECINCTS = [
    ("Cape Town Depot (Epping)", Decimal("-33.9249"), Decimal("18.4241")),
    ("Bloemfontein Depot (Hamilton)", Decimal("-29.0852"), Decimal("26.1596")),
    ("Johannesburg Depot (Linbro)", Decimal("-26.2041"), Decimal("28.0473")),
]


def _resolve_password() -> str:
    password = os.environ.get(_PASSWORD_ENV_VAR) or getpass.getpass("Demo dispatcher password: ")
    if not password:
        raise SystemExit(f"A password is required. Set ${_PASSWORD_ENV_VAR} or enter it at the prompt.")
    return password


async def seed(password: str) -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with async_session() as db:
            # ── Organizations ───────────────────────────────────────────────
            for org_id, name, org_type, email, pp_account in [
                (_OPERATOR_ORG_ID, "FreightProof Demo Operator", OrganizationType.OPERATOR,
                 "ops@demo.freightproof.co.za", None),
                (_CLIENT_ORG_ID, "FreightProof Demo Client", OrganizationType.PRINCIPAL,
                 "client@demo.freightproof.co.za", "MOCK01"),
            ]:
                existing = await db.execute(select(Organization).where(Organization.id == org_id))
                if existing.scalar_one_or_none() is None:
                    db.add(Organization(id=org_id, name=name, org_type=org_type,
                                        contact_email=email, pp_account_number=pp_account))
            await db.flush()

            # ── Dispatcher: Supabase Auth first, then the public row ────────
            existing_user = await db.execute(select(User).where(User.email == _DISPATCHER_EMAIL))
            if existing_user.scalar_one_or_none() is None:
                try:
                    auth_id = await create_dispatcher_auth_user(
                        email=_DISPATCHER_EMAIL, password=password,
                        full_name=_DISPATCHER_NAME, role=DispatcherRole.ADMIN_DISPATCHER,
                    )
                except DuplicateResourceError:
                    raise SystemExit(
                        f"{_DISPATCHER_EMAIL} exists in Supabase Auth but has no public users row. "
                        "Delete it in the Supabase dashboard (Authentication -> Users) and re-run."
                    )
                # users.id MUST equal the auth UUID or auth.uid() never resolves
                # to this row and every RLS policy keyed on it silently returns
                # nothing (migration 0002).
                db.add(User(id=auth_id, organization_id=_OPERATOR_ORG_ID,
                            email=_DISPATCHER_EMAIL, full_name=_DISPATCHER_NAME, is_active=True))
                await db.flush()
                print(f"  dispatcher   {_DISPATCHER_EMAIL} (id={auth_id})")

            # ── Drivers: phone accounts, same UUID rule ─────────────────────
            for full_name, id_number, phone, license_no in _DRIVERS:
                existing_driver = await db.execute(
                    select(Driver).where(Driver.license_number == license_no)
                )
                if existing_driver.scalar_one_or_none() is not None:
                    continue
                try:
                    auth_id = await create_driver_auth_user(phone=phone, full_name=full_name)
                except DuplicateResourceError:
                    raise SystemExit(
                        f"{phone} exists in Supabase Auth but has no drivers row. "
                        "Delete it in the Supabase dashboard and re-run."
                    )
                db.add(Driver(id=auth_id, organization_id=_OPERATOR_ORG_ID, full_name=full_name,
                              id_number=id_number, phone_number=phone,
                              license_number=license_no, idvs_status=IdvsStatus.PENDING))
                print(f"  driver       {full_name} (id={auth_id})")
            await db.flush()

            # ── Vehicles and precincts: no auth FK, plain upserts ───────────
            for registration, vehicle_type, device_id in _VEHICLES:
                existing_vehicle = await db.execute(
                    select(Vehicle).where(Vehicle.pulsit_device_id == device_id)
                )
                if existing_vehicle.scalar_one_or_none() is None:
                    db.add(Vehicle(organization_id=_OPERATOR_ORG_ID, registration=registration,
                                   vehicle_type=vehicle_type, pulsit_device_id=device_id))

            for name, lat, lng in _PRECINCTS:
                existing_precinct = await db.execute(select(Precinct).where(Precinct.name == name))
                if existing_precinct.scalar_one_or_none() is None:
                    # is_shared=True: the client's depots must stay visible to the
                    # operator dispatcher under per-org precinct scoping.
                    db.add(Precinct(name=name, principal_organization_id=_CLIENT_ORG_ID,
                                    latitude=lat, longitude=lng,
                                    geofence_radius_metres=200, is_shared=True))

            await db.commit()
            print("Reference seed complete.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed(_resolve_password()))
```

**1.5d — `scripts/seed_trips.py`**: the two canonical trips, in the new phase shape.

```python
"""Seed one single-leg (7-phase) and one cross-dock (11-phase) trip.

The 11-row trip is the point: it is the shape the old
UNIQUE(trip_id, handshake_type) constraint made unrepresentable, and it is what a
reviewer is walked through at the demo. Consignments A (stop 1->3), B (1->2) and
C (2->3) make stop 2 both a drop-off and a pick-up.

Deliberately writes rows directly rather than calling create_trip(): P0 anchoring is
fail-closed, so create_trip() would put a Hedera testnet round-trip in the middle of
a seed. Seeded trips therefore have journey_lock_hash = NULL and an unanchored P0 —
real anchoring is exercised by POST /trips, not by this script.

Run scripts/dev_reset_lifecycle.py first if the database already has trips.

Usage:
    cd backend
    PYTHONPATH=. .venv/bin/python scripts/seed_trips.py
"""

import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.models.enums import (
    AnchorStatus, IdvsStatus, PhaseStatus, TripStatus, TripType, VehicleType,
)
from app.db.models.organisations import Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.phase_plan import ANCHORED_PHASES, PlanStop, build_phase_plan

_CPT = "Cape Town Depot (Epping)"
_BFN = "Bloemfontein Depot (Hamilton)"
_JHB = "Johannesburg Depot (Linbro)"


async def _reference(db: AsyncSession):
    """Fetch the seeded reference rows, failing loudly rather than half-seeding."""
    user = (await db.execute(select(User).order_by(User.created_at))).scalars().first()
    driver = (await db.execute(select(Driver).order_by(Driver.created_at))).scalars().first()
    horse = (await db.execute(
        select(Vehicle).where(Vehicle.vehicle_type == VehicleType.HORSE)
    )).scalars().first()
    trailer = (await db.execute(
        select(Vehicle).where(Vehicle.vehicle_type == VehicleType.TRAILER)
    )).scalars().first()
    precincts = {
        p.name: p for p in (await db.execute(select(Precinct))).scalars().all()
    }
    missing = [n for n in (_CPT, _BFN, _JHB) if n not in precincts]
    if user is None or driver is None or horse is None or trailer is None or missing:
        raise SystemExit(
            "Reference data incomplete — run scripts/seed_demo.py first. "
            f"missing precincts={missing}"
        )
    return user, driver, horse, trailer, precincts


async def _seed_trip(
    db: AsyncSession, *, reference, trip_reference: str, order_number: str,
    precinct_names: list[str], consignment_legs: list[tuple[str, int, int]],
) -> Trip:
    """Create one trip: stops, trailer link, consignments, and the full phase plan.

    `consignment_legs` is [(pp_reference, pickup_stop_seq, delivery_stop_seq), ...].
    A stop's routing role is derived from these, exactly as Stage 2.1 will derive it
    from the real consignment rows — the generator never sees a stop "type".
    """
    user, driver, horse, trailer, precincts = reference

    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=trip_reference,
        order_number=order_number,
        operator_organization_id=user.organization_id,
        driver_id=driver.id,
        horse_id=horse.id,
        status=TripStatus.CREATED,
        trip_type=TripType.LOADED.value,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db.add(trip)
    await db.flush()

    stops = [
        TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precincts[name].id, sequence=i + 1)
        for i, name in enumerate(precinct_names)
    ]
    db.add_all(stops)
    db.add(TripTrailer(trip_id=trip.id, trailer_id=trailer.id,
                       pulsit_device_id_snapshot=trailer.pulsit_device_id))
    await db.flush()

    trip.origin_precinct_id = stops[0].precinct_id
    trip.destination_precinct_id = stops[-1].precinct_id
    by_sequence = {s.sequence: s for s in stops}

    picks_up: set[int] = set()
    drops_off: set[int] = set()
    for pp_reference, pickup_seq, delivery_seq in consignment_legs:
        db.add(Consignment(
            id=uuid.uuid4(), trip_id=trip.id,
            parcel_perfect_reference=pp_reference,
            client_organization_id=None,
            origin_precinct_id=by_sequence[pickup_seq].precinct_id,
            destination_precinct_id=by_sequence[delivery_seq].precinct_id,
            pickup_stop_id=by_sequence[pickup_seq].id,
            delivery_stop_id=by_sequence[delivery_seq].id,
            parcel_count_expected=12,
        ))
        picks_up.add(pickup_seq)
        drops_off.add(delivery_seq)
    await db.flush()

    plan = build_phase_plan([
        PlanStop(sequence=s.sequence, picks_up=s.sequence in picks_up,
                 drops_off=s.sequence in drops_off)
        for s in stops
    ])
    for planned in plan:
        db.add(PhaseEvent(
            id=uuid.uuid4(),
            trip_id=trip.id,
            trip_stop_id=None if planned.stop_sequence is None
            else by_sequence[planned.stop_sequence].id,
            phase_type=planned.phase_type,
            sequence_number=planned.sequence_number,
            status=PhaseStatus.PENDING,
            anchor_status=(AnchorStatus.PENDING if planned.phase_type in ANCHORED_PHASES
                           else AnchorStatus.NOT_REQUIRED),
        ))

    # Cache seeded from the ledger, never independently: the current phase is the
    # lowest-sequence row that is not completed, which on a fresh plan is row 0.
    trip.current_phase = plan[0].phase_type.value
    trip.current_stop = plan[0].stop_sequence
    await db.flush()

    print(f"  {trip_reference:<22} {len(plan):>2} phases  ({len(stops)} stops)")
    return trip


async def seed() -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with async_session() as db:
            reference = await _reference(db)

            await _seed_trip(
                db, reference=reference,
                trip_reference="FP-DEMO-SINGLE-0001", order_number="ORD-DEMO-SINGLE-0001",
                precinct_names=[_CPT, _JHB],
                consignment_legs=[("MOCKWB0001", 1, 2)],
            )
            await _seed_trip(
                db, reference=reference,
                trip_reference="FP-DEMO-XDOCK-0001", order_number="ORD-DEMO-XDOCK-0001",
                precinct_names=[_CPT, _BFN, _JHB],
                consignment_legs=[
                    ("MOCKWB0002", 1, 3),   # A: straight through
                    ("MOCKWB0003", 1, 2),   # B: dropped at the hub
                    ("MOCKWB0004", 2, 3),   # C: collected at the hub
                ],
            )
            await db.commit()
            print("Trip seed complete.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
```

**1.5e — convert the 11 stub-auth integration files** (Stage 0 decision DE1).

**Fence: this converts an auth convention. It is not a bug hunt.** Fix nothing else. The expected
outcome is stated below and includes tests that stay red.

Files: `test_blockchain_verify`, `test_create_trip_multistop`, `test_drivers`, `test_drivers_anchor`,
`test_precincts`, `test_trips`, `test_trips_anchor`, `test_vehicles`, `test_vehicles_anchor`,
`test_vehicles_cosmetic_diff`, `test_vehicles_validation` — all under `backend/tests/integration/`.

Per file, mechanically:

1. Delete `from app.auth.dependencies import _DEMO_ORG_ID` (and `_DEMO_USER_ID` where present).
2. In the seed fixture, give the Organization a fresh `uuid.uuid4()` id and **add a `User` row** in
   the same org — return both from the fixture. Stage 0 finding F2 items 1–4 are exactly this
   missing `User` (`vehicle_events_changed_by_user_id_fkey`), so they resolve here for free.
3. Replace the inline `AsyncClient(transport=ASGITransport(app=app), …)` construction with the
   shared `client` fixture from `tests/conftest.py` — it is what monkeypatches `_get_jwks`, so an
   inline client cannot verify a signed token.
4. Replace `headers={"Authorization": "Bearer demo"}` with
   `headers=auth_header(make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id)))`,
   importing `from tests.conftest import auth_header, make_token`.

Reference target shape: `tests/integration/test_handshakes.py:1-70`, which already does exactly
this. Reference source shape: `tests/integration/test_precincts.py:1-80`.

**Expected outcome, stated so nobody chases the rest:** ~58 tests change auth convention;
F2 items 1–4 go green as a side effect. **Still red afterwards and out of scope:** F2 items 5–11
(lazy-load `MissingGreenlet`, duplicate-resource 409s, the `license_number` hash assertion in
`test_drivers_anchor`, the 422/404 shape mismatches) and all of F3 (unmocked Hedera in
`test_create_trip_multistop.py` and `test_artifacts.py`). Record the new pass/fail numbers in the
Findings ledger; do not fix them.

> 🔴 **Carried, unchanged: CI cannot go green until F3 is fixed** — no Hedera secrets are configured
> in the workflow and those tests fail on missing config regardless of auth. It stays scheduled
> (DE2). Raise it as a Stage 2 or Stage 3 item; do not silently absorb it here.

---

## Tests to write

| Test | Proves | Where |
|---|---|---|
| `test_single_leg_plan_has_seven_rows_in_order` | The 7-row reference plan matches `makePhasePlan()`'s verified output exactly, type and stop per row | `tests/unit/test_phase_plan.py` (new) |
| `test_cross_dock_plan_has_eleven_rows_in_order` | The 11-row plan — `loading` twice, `unloading` twice, stop 2 both drops off and collects. **The multi-stop thesis in one assertion.** | `tests/unit/test_phase_plan.py` |
| `test_only_trip_creation_has_no_stop` | D3 holds for both plans: exactly one NULL-stop row, and it is `trip_creation` | `tests/unit/test_phase_plan.py` |
| `test_in_transit_anchors_to_departure_stop` | Every `in_transit` row carries the stop it leaves, not the one it reaches — the property the partial unique index depends on | `tests/unit/test_phase_plan.py` |
| `test_sequence_number_is_row_index` | `sequence_number` is the plan index, not an enum index, and is unbounded above 5 | `tests/unit/test_phase_plan.py` |
| `test_empty_leg_plan_still_closes_custody` | A 2-stop run with no pick-up or drop-off still emits `unloading` + `confirmation` — no hole in the ledger | `tests/unit/test_phase_plan.py` |
| `test_phase_event_has_trip_stop_anchor_status_idempotency_key` | The three new columns exist, `trip_stop_id` nullable, `anchor_status` non-nullable | `tests/unit/test_phase_model_schema.py` (new, mirroring `test_model_schema_v6.py`'s `_column_names` style) |
| `test_phase_event_uniqueness_is_per_stop` | `uq_phase_events_trip_stop_type` is on `__table_args__` and the old `(trip_id, phase_type)` constraint is gone | `tests/unit/test_phase_model_schema.py` |
| `test_trip_has_current_phase_and_current_stop` | D6 columns exist and are nullable | `tests/unit/test_phase_model_schema.py` |
| `test_exception_and_gps_snapshot_point_at_phase_events` | Both inbound FKs re-pointed — the rename left no orphan reference | `tests/unit/test_phase_model_schema.py` |

Both new files are `tests/unit/` and DB-free, so the `.claude/hooks/test-summary.sh` Stop hook keeps
covering them.

The single-leg and cross-dock expected plans, to assert against verbatim (from
`frontend/shared/lib/mocks/phase-trips.ts`, executed and verified in Stage 0):

```
SINGLE LEG (7 rows)                CROSS DOCK (11 rows)
seq 0  trip_creation  stop=None    seq 0  trip_creation  stop=None
seq 1  activation     stop=1       seq 1  activation     stop=1
seq 2  loading        stop=1       seq 2  loading        stop=1
seq 3  departure      stop=1       seq 3  departure      stop=1
seq 4  in_transit     stop=1       seq 4  in_transit     stop=1
seq 5  unloading      stop=2       seq 5  unloading      stop=2
seq 6  confirmation   stop=2       seq 6  loading        stop=2
                                   seq 7  departure      stop=2
                                   seq 8  in_transit     stop=2
                                   seq 9  unloading      stop=3
                                   seq 10 confirmation   stop=3
```

Cross-dock inputs: stop 1 `picks_up=True, drops_off=False`; stop 2 `picks_up=True, drops_off=True`;
stop 3 `picks_up=False, drops_off=True`.

---

## Out of scope

| Excluded | Why |
|---|---|
| `advance_h1..h5` logic, gates, transitions | Stage 2.2. This stage renames identifiers only (S2). |
| `compute_h2_canonical_payload` / `compute_h5_canonical_payload` | Stage 2.7, behind a byte-identity fence. A changed payload makes `/verify` report tampering on a healthy trip (S3). |
| Moving the seal from P2 to P3 | Stage 2.6 — the highest-risk edit in the refactor, and it is test-first there. |
| Fail-open anchors | Stage 2.5. `anchor_status` is landed here **as its prerequisite**, not used here. |
| Plan generation inside `create_trip` | Stage 2.1. 1.5a lands the pure function it will call (S6). |
| `PhaseEventRead`, `TripDetailResponse.phases`, the `/phases` endpoints | Stage 3.1/3.2 (S4). |
| Dispatcher and driver-pwa | Stages 4 and 5. The `phase_type` wire-key drift is known and accepted (S4). |
| `app/auth/dependencies.py`, `_DEMO_ORG_ID`, the DEMO_MODE stub | Not this stage's scope; 1.5e moves tests off the stub without removing it. |
| `app/core/config.py`, `.env.example` | No new keys. `DISPATCHER_SEED_PASSWORD` already exists as a script-time env var. |
| F2 items 5–11 and all of F3 (unmocked Hedera) | Stage 0's DE2 — recorded and scheduled, not fixed. |
| `backend/test_db.py`, `driver-pwa/tsconfig.tsbuildinfo`, dispatcher CI `test` step | Stage 0 finding F4. Tidy-up branch, not this one. |
| Deleting `frontend/shared/lib/{types/handshake.ts,constants/handshake-meta.ts,mocks/trips.ts}` | 14 live consumers. They die with their last consumer in Stages 4 and 5. |
| `TripStatus` legacy-value deletion, `TripStatus` uses in `trip_service.py:85-92` and `tasks/parcel_perfect.py:31-37` | Stage 2.2, with `advance_h*` (S1). |

---

## Verification

Run in order, from a clean tree. Every command states its expected output — a command whose output
you did not read has not been run.

**1 — Test database up** (nothing DB-backed runs without it):
```bash
docker compose -f infrastructure/docker/docker-compose.test.yml up -d
docker compose -f infrastructure/docker/docker-compose.test.yml ps
```
Expect `freightproof-test-db` · `Up` · `(healthy)`.

**2 — The package imports and the linters pass:**
```bash
cd backend && .venv/bin/ruff check . && .venv/bin/mypy .
```
Expect `All checks passed!` and `Success: no issues found in 154 source files` — 152 at Stage 0 plus
`phase_plan.py` and the two new scripts, minus/plus the `handshakes.py`→`phases.py` rename.
**A drop below 152 means a file was deleted without its replacement being added.**

**3 — Unit suite, the Stop hook's gate:**
```bash
cd backend && .venv/bin/python -m pytest tests/unit -q
```
Expect **≥ 178 passed, 0 failed** (178 baseline − 3 deleted sequence-bound tests + the new
`test_phase_plan.py` and `test_phase_model_schema.py`). **Any failure here fails the stage** — these
are the state-machine and payload tests Stage 0 exists to keep alive, and Stage 1 changes no
behaviour they can observe.

**4 — Whole suite, skip floor held:**
```bash
cd backend && .venv/bin/python -m pytest -q
```
Expect **0 skipped** (the floor is 0 — parent §9). Expect passed **> 250** and failed **< 70**:
1.5e converts ~58 tests and resolves F2 items 1–4. Record the exact numbers in the Findings ledger.
```bash
cd backend && .venv/bin/python -m pytest -q -rs 2>&1 | grep -c "TEST_DATABASE_URL not set"
```
Expect `0`.

**5 — Nothing still speaks the old vocabulary in backend Python:**
```bash
cd backend && grep -rn "HandshakeEvent\|HandshakeType\|HandshakeStatus\|handshake_events\|HANDSHAKE_EVENT" app/ tests/ scripts/ migrations/versions/2026_07_28_ciaran_phase_model.py
```
Expect hits **only** in `migrations/versions/2026_07_28_ciaran_phase_model.py` (it must name the old
objects — that is its job). Any hit under `app/` or `tests/` is an incomplete rename.
`migrations/versions/0001_initial_schema.py` and `0003_tom_rls_policies.py` legitimately still
contain the old names and are excluded from this grep by construction — **never edit them.**

**6 — 🔴 The migration, forward and back, against the refactor Supabase project.**
The test DB cannot run this (no `auth` schema). Confirm the target first — this is the one command
that touches a real database:
```bash
cd backend && PYTHONPATH=. .venv/bin/python scripts/check_supabase_wiring.py
```
Expect every check pass and ref `spjugofbopoyrmmpucjr` for both `DATABASE_URL` and `SUPABASE_URL`.
**If it says `smaurrwbawosufedubeq`, stop — that is the fallback demo database (parent §5.4).**

```bash
cd backend && .venv/bin/alembic upgrade head && .venv/bin/alembic current
```
Expect `2026_07_28_ciaran_phase (head)`.

```bash
cd backend && .venv/bin/alembic downgrade -1 && .venv/bin/alembic current
```
Expect `tim_add_exception_gps`. *(A one-way migration is not a migration. This must be run before
any trips are seeded — see the downgrade's own comment.)*

```bash
cd backend && .venv/bin/alembic upgrade head && .venv/bin/alembic current
```
Expect `2026_07_28_ciaran_phase (head)` again.

**7 — 🔴 The RLS gate. This is the only check that exists for the silent failure.**
Run against the refactor project (Supabase SQL editor, or `psql` with the pooler URL):
```sql
SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='phase_events' ORDER BY 1;
SELECT relrowsecurity FROM pg_class WHERE relname='phase_events';
SELECT count(*) FROM pg_policies WHERE schemaname='public';
SELECT policyname FROM pg_policies WHERE tablename='handshake_events';
SELECT qual::text LIKE '%phase_events%' AS repointed
  FROM pg_policies
 WHERE tablename='trailer_gps_snapshots' AND policyname='trailer_gps_snapshots_dispatcher_select';
```
Expect, in order: **3 rows** — `phase_events_client_viewer_select`, `phase_events_dispatcher_select`,
`phase_events_driver_select` · `relrowsecurity` = **`t`** · total **45** (unchanged from Stage 0's
baseline) · **0 rows** for `handshake_events` · `repointed` = **`t`**.

Any deviation is a POPIA-posture defect, not a naming nit: FastAPI runs as `service_role` and
bypasses RLS, so a phase ledger carrying driver GPS and seal data would sit readable via PostgREST
with nothing anywhere reporting a problem.

**8 — Seed a clean database end to end:**
```bash
cd backend
PYTHONPATH=. .venv/bin/python scripts/dev_reset_lifecycle.py --project-ref spjugofbopoyrmmpucjr --yes
DISPATCHER_SEED_PASSWORD='<choose one>' PYTHONPATH=. .venv/bin/python scripts/seed_demo.py
PYTHONPATH=. .venv/bin/python scripts/seed_trips.py
```
`--project-ref` is required and is checked against `DATABASE_URL`'s host before any row is touched
(no dump stands behind this — see Prerequisites). A mismatch exits with
`ABORTED — DATABASE_URL does not point at project …` and deletes nothing.

Expect `Lifecycle reset complete; reference data unchanged.`, then dispatcher/driver ids printed,
then:
```
  FP-DEMO-SINGLE-0001     7 phases  (2 stops)
  FP-DEMO-XDOCK-0001     11 phases  (3 stops)
```

**9 — The ledger is right in the database:**
```sql
SELECT t.trip_reference, pe.sequence_number, pe.phase_type, ts.sequence AS stop, pe.anchor_status
  FROM phase_events pe
  JOIN trips t ON t.id = pe.trip_id
  LEFT JOIN trip_stops ts ON ts.id = pe.trip_stop_id
 WHERE t.trip_reference = 'FP-DEMO-XDOCK-0001'
 ORDER BY pe.sequence_number;
```
Expect exactly the 11-row table from *Tests to write*, with `anchor_status = pending` on
`trip_creation`, both `departure` rows and `confirmation`, and `not_required` on the rest.
```sql
SELECT count(*) FROM phase_events WHERE trip_stop_id IS NULL;   -- expect 2 (one P0 per trip)
SELECT current_phase, current_stop FROM trips ORDER BY trip_reference;  -- expect trip_creation / NULL
```

**10 — Reference data survived, and the API serves the new shape:**
```sql
SELECT count(*) FROM organizations;  -- 2
SELECT count(*) FROM users;          -- 1
SELECT count(*) FROM drivers;        -- 2
SELECT count(*) FROM vehicles;       -- 2
SELECT count(*) FROM precincts;      -- 3
```
Then, with the backend running (`cd backend && .venv/bin/uvicorn app.main:app --reload`) and a real
dispatcher token, `GET /api/v1/trips` returns both seeded trips.

> ⚠️ If the API 500s or the browser reports "access control checks", check for a stale Docker
> container shadowing local uvicorn on :8000 over IPv6 before blaming this stage's code — that
> failure mode has cost a debugging session on this project before.

**11 — Frontend gates unchanged** (this stage touches no frontend file; run them to prove it):
```bash
cd frontend/dispatcher && npx tsc --noEmit && npm run lint
```
Expect clean. driver-pwa is untouched and its known type-check failures are Tim's, per Stage 0.2.

---

## Done when

**A multi-stop trip with 11 `phase_events` rows exists in the refactor database, `phase_events`
carries 3 RLS policies with `relrowsecurity` true, and the migration has been proved both ways on a
trip-free database.**

Checklist:

- [ ] `PhaseType`, `PhaseStatus`, `AnchorStatus` exist; `TripStatus` has `ACTIVE`; `SubjectType.PHASE_EVENT`
- [ ] `PhaseEvent` model with `trip_stop_id`, `anchor_status`, `idempotency_key` and D3 uniqueness
- [ ] `Trip.current_phase` / `Trip.current_stop` present and documented as caches
- [ ] `alembic upgrade head` → `downgrade -1` → `upgrade head` all green
- [ ] `pg_policies` on `phase_events` = 3 · `relrowsecurity` = t · public total = 45 · `handshake_events` = 0
- [ ] `validate_sequence_number` and its three tests gone
- [ ] `build_phase_plan()` reproduces both reference plans, asserted in `tests/unit/`
- [ ] Clean-database bootstrap works: reset → `seed_demo.py` → `seed_trips.py`
- [ ] Unit suite ≥ 178 passed, 0 failed · whole suite 0 skipped, failures below 70 and recorded

> **Suggested commits** (Ciaran runs git; this plan never does):
> - `refactor(db): phase vocabulary — PhaseType/PhaseStatus/AnchorStatus, coarse TripStatus`
> - `feat(db): phase-event ledger with per-stop anchoring, anchor state and idempotency key`
> - `feat(db): phase model migration with RLS policy rename`
> - `feat(orchestration): phase-plan generator ported from the frozen contract`
> - `feat(db): real-auth reference seeder, lifecycle reset and phase-shaped trip seeder`
> - `test(backend): convert stub-auth integration tests to real signed JWTs`

---

## Findings ledger

*Filled in during execution. Stage 0's ledger is the precedent — the numbers recorded here are what
Stage 2 plans against.*

### 1.x — Suite numbers after Stage 1

| Metric | Before (Stage 0 exit) | After |
|---|---|---|
| Whole suite passed | 250 | **319** |
| Whole suite failed | 70 | **8** |
| Whole suite skipped | 0 | **0** |
| `tests/unit` passed | 178 | **185** |

Arithmetic reconciles: 320 baseline tests + 10 new (`test_phase_plan.py` 6, `test_phase_model_schema.py` 4)
− 3 deleted sequence-bound tests = 327 collected. Unit: 178 − 3 + 10 = 185.
`ruff check .` → *All checks passed!* · `mypy .` → *Success: no issues found in **159** source files*
(plan predicted ~154; the floor that matters is 152 and we are above it).
Frontend dispatcher `tsc --noEmit` + `eslint` → clean, confirming no frontend file was touched.

**All 8 remaining failures are the families the plan scoped out** (F2 items 5–11, F3), none newly caused:

| Test | Cause | Bucket |
|---|---|---|
| `test_blockchain_verify::test_verify_returns_no_receipt_for_unknown_subject` | `assert_subject_visible` 404s before the `no_receipt` branch | F2 response-shape |
| `test_drivers::test_create_driver_returns_201_with_pending_status` | 409, real Supabase auth user already exists | F2 duplicate-resource |
| `test_drivers::test_create_driver_appears_in_subsequent_list` | same | F2 duplicate-resource |
| `test_drivers_anchor::test_create_driver_does_not_anchor_pii` | `license_number` hash assertion | named expected-red |
| `test_handshakes_anchor::test_h2_complete_hedera_timeout_returns_504…` | `MissingGreenlet` lazy-load | F2 item 5 |
| `test_trips::test_create_trip_response_shape` | unmocked Hedera returns a real receipt | **F3 / DE2** |
| `test_vehicles_cosmetic_diff::test_mixed_patch_anchors_only_critical_field` | see NEW-4 below | pre-existing |
| `test_vehicles_validation::test_update_vehicle_invalid_vin…` | `MissingGreenlet` lazy-load | F2 item 5 |

### 1.3 — RLS after-numbers

| Query | Expected | Observed |
|---|---|---|
| `pg_policies` on `phase_events` | 3 | **3** — `client_viewer_select`, `dispatcher_select`, `driver_select`, all correctly renamed |
| `relrowsecurity` on `phase_events` | `t` | **`t`** |
| `pg_policies` total, schema `public` | 45 | **45** (unchanged from Stage 0 baseline) |
| `pg_policies` on `handshake_events` | 0 | **0** (table no longer exists) |
| `trailer_gps_snapshots_dispatcher_select` body repointed | `t` | **`t`** |

Schema also confirmed in-DB: `anchor_status` NOT NULL, `trip_stop_id`/`idempotency_key` nullable,
`trips.current_phase`/`current_stop` nullable, and `uq_phase_events_trip_stop_type` present with
`uq_handshake_events_trip_type` gone. Migration proved `upgrade → downgrade -1 → upgrade`, all green,
against a trip-free database.

Seeded ledger matches the reference plans **exactly** — 7 rows single-leg, 11 rows cross-dock, `loading`
and `unloading` twice each on the cross-dock, `in_transit` anchored to its departure stop, 2 NULL-stop
rows total (one P0 per trip), `anchor_status = pending` on exactly `trip_creation` / both `departure`
rows / `confirmation`. Reference data survived the reset: 2 orgs, 1 user, 2 drivers, 2 vehicles,
3 precincts.

### 1.5e — What the auth conversion did and did not fix

11 files converted to real signed JWTs. **Went green:** F2 items 1–4 (the missing `User` row →
`vehicle_events_changed_by_user_id_fkey`), plus the bulk of the drivers/vehicles/precincts/trips
suites. Whole-suite failures fell 70 → 8. **Deliberately left red:** the eight in the table above.

**Deviation, accepted:** tokens in the six fleet files use `role="admin_dispatcher"`, not the
`"dispatcher"` the plan's recipe literally specified. `POST`/`PATCH` on `/drivers` and `/vehicles` are
gated by `require_admin_dispatcher`, and the old DEMO_MODE stub user was always `ADMIN_DISPATCHER` —
so plain `"dispatcher"` would have introduced **new** 403s that did not exist before conversion. That
is a regression, not a bug fix, and the fence forbade it. `admin_dispatcher` satisfies both role sets
and preserves prior pass/fail behaviour exactly.

### Defects found in this plan's own literal code (fixed during execution)

Each was caught by actually running a gate, not by reading. Recorded because the parent plan's later
stages reuse these files.

- **NEW-1 — `downgrade()` ordering bug in the migration. Would have made the migration one-way.**
  The plan recreated `trailer_gps_snapshots_dispatcher_select` — whose body names `handshake_events`
  and `handshake_event_id` — at the *top* of `downgrade()`, before the table and column are renamed
  back at the bottom. `alembic downgrade -1` failed with
  `UndefinedTableError: relation "handshake_events" does not exist`. **Fixed:** the `DROP POLICY` stays
  first (it also frees the column rename from a policy dependency), the `CREATE POLICY` moved to the
  very end, after `rename_table`. Postgres DDL is transactional, so the failed attempt rolled back
  cleanly and left the database at head — no damage. Verified `upgrade → downgrade → upgrade` green.
- **NEW-2 — `_assert_target()` could never pass, so the safety guard was useless.** It matched
  `--project-ref` against `urlsplit(DATABASE_URL).hostname` only. Supabase **pooler** URLs put the
  project ref in the *username* (`postgres.<ref>`); the host is regional and shared by every project in
  it (`aws-0-eu-west-1.pooler.supabase.com`). The guard aborted on a correctly-configured database.
  This matters more than a normal bug: this guard is explicitly the *only* safety net standing in for
  the `pg_dump` that was deliberately skipped, and a guard that always refuses is one the next person
  in a hurry deletes. **Fixed:** matches host **or** username; still never echoes the URL. Verified in
  both directions — refuses a wrong ref, accepts the real one.
- **NEW-3 — mypy failure in `dev_reset_lifecycle.py`.** `AsyncSession.execute()` is typed as returning
  `Result`, which has no `rowcount`; only `CursorResult` does. **Fixed** with a small typed `_deleted()`
  helper rather than by loosening the type.
- **NEW-4 — `test_vehicles_cosmetic_diff` fails on a pre-existing test-data bug, not on anything here.**
  Its hardcoded VIN `"GH698HF7X090099"` is **15** characters; `VinNumberStr` requires exactly 17, so the
  PATCH body 422s. The VIN validator landed after that test was written. Untouched — out of scope, and
  fixing it is a one-line test-data change for whoever owns the fleet suite.
- **NEW-5 — the ripple table omitted `tests/integration/test_handshakes*.py`.** Those files already used
  real auth so no agent was scoped to them, but they consume the renamed vocabulary as *literal strings*:
  the URL `/handshakes/origin_gate_in` (now `activation` — the path param is typed `PhaseType`, so the
  old value 422s), the wire key `handshake_type` (now `phase_type`, the accepted S4 drift), and the
  `subject_type` filter `"handshake_event"` (now `"phase_event"`). **Fixed** under S2, which authorises
  identifier rewrites anywhere in `backend/tests/`. Five tests went green.
- **NEW-6 — Verification step 5 contradicts decision S4 and cannot be satisfied as written.** It expects
  the old-vocabulary grep to hit *only* the migration file, but S4 explicitly preserves
  `HandshakeEventRead`/`HandshakeEventCreate`/`HandshakeEventBase` and `TripDetailResponse.handshakes`
  until Stage 3.2. **S4 wins** — the grep's expectation is what is wrong. Corrected expectation:
  `HandshakeType|HandshakeStatus|handshake_events|HANDSHAKE_EVENT` must be **absent** from `app/` and
  `tests/` (verified: zero hits), while `HandshakeEvent*` class names legitimately remain until 3.2.
  Also left deliberately: `ResourceNotFoundError("HandshakeEvent", …)` is a user-facing error label, not
  an identifier — changing it is a behaviour change a test could assert on.
- **NEW-7 — process risk for Stages 2–4, not a code defect.** Parallel agents running `pytest`
  concurrently against the single shared `TEST_DATABASE_URL` raced each other's `create_all`/`drop_all`
  DDL, producing transient `DeadlockDetectedError` and one spurious
  `relation "organizations" does not exist`. None reproduced when run serially. If later stages
  parallelise test execution, give each worker its own schema or serialise the runs — otherwise this
  surfaces as flaky failures that look like real regressions.

### Carried into Stage 2

- F3 / DE2 — unmocked Hedera in `test_create_trip_multistop.py` and `test_artifacts.py`.
  **CI cannot go green until this is done.**
- `TripStatus` LEGACY values and `advance_h*` deletion (S1).
- `trip_service.py:85-92` and `tasks/parcel_perfect.py:31-37` active-status lists.
- 🔴 **Canonical payload re-pointing (S3) — Stage 2.7.** `compute_h2_canonical_payload` /
  `compute_h5_canonical_payload` still emit the keys `handshake_event_id` and
  `handshake_type: "loading" | "unloading"`, and `verification_service` still rebuilds them. Both
  survive Stage 1 byte-for-byte, proved by the five untouched tests in
  `tests/unit/test_handshake_anchor_payload.py`.
  **What Stage 2.7 is free to do, and why:** the refactor DB is new and holds **no
  `blockchain_receipts` rows anchored over the old payload shape** (confirmed by Ciaran
  2026-07-28 — the old project keeps its own data and is never migrated). So 2.7 has **no
  backward-compatibility obligation**: it may rename the keys outright rather than building a
  dual-read verification path. Do not assume otherwise and over-engineer it.
  **What still holds:** builder and rebuilder must change in the same commit. A payload renamed in
  one and not the other makes `/verify` return `db_mismatch` on a healthy trip, which the dispatcher
  renders as *tamper detected* — no error, no failing test, and it looks like the product working.
- **Immutability guards on `trips` and `phase_events`.** `0003_tom_rls_policies.py:487-502` gives
  six evidence tables `no_update_*` / `no_delete_*` policies; `trips` and `handshake_events` are not
  among them. Ciaran confirmed 2026-07-28 that trips are immutable evidence with no deletion path,
  so the RLS posture arguably understates the rule. Not changed in Stage 1 because it would move
  `phase_events` from 3 policies to 5 and invalidate the only gate that makes the rename verifiable.
  Needs its own change and a note to the other three devs.
- 🔴 **`pg_dump` the old project before promotion, not before Stage 1.** Deliberately skipped here
  (Prerequisites, 2026-07-28) because Stage 1 never touches `smaurrwbawosufedubeq`. It becomes
  mandatory at parent §5.6's promotion step, where UI-created reference data the seeder does not
  recreate would otherwise be unrecoverable. Whoever runs promotion owns it.
