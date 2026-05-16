# Hedera On-Chain Recording — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anchor trip / vehicle / driver creation to Hedera HCS synchronously, surface anchor state in the dispatcher UI, and provide live verification against the Hedera mirror node.

**Architecture:** Reuse existing `HederaService` ([backend/app/blockchain/hedera.py](backend/app/blockchain/hedera.py)). Add a thin orchestration-layer `anchor_service` that canonicalizes a payload, computes SHA-256, submits to HCS, and persists a `BlockchainReceipt` row. Extend `blockchain_receipts` with `subject_type`/`subject_id` so vehicles, drivers, and event rows share one table. New `vehicle_events` and `driver_events` tables capture mutations as append-only diffs. Frontend gets `BlockchainBadge`, `VerifyButton`, and `EventTimeline` shared components plus new detail pages for vehicles and drivers.

**Tech Stack:** Python 3.13 / FastAPI 0.115+ / SQLAlchemy 2.0 async / Alembic / Pydantic v2 / Next.js 15 App Router / TypeScript 5.5+ / Tailwind / Hedera SDK + REST mirror node.

**Spec:** [docs/superpowers/specs/2026-05-16-hedera-on-chain-recording-design.md](docs/superpowers/specs/2026-05-16-hedera-on-chain-recording-design.md)

**Branch:** `Ciaran`. Uncommitted changes in working tree are expected; this plan composes with them.

**User preference:** No per-task tests/runs/commits. A single final verification section runs all tests and the manual demo rehearsal. The developer commits manually.

---

## Phase 1 — Enums and constants

### Task 1: Extend `BlockchainReceiptType` enum

**Files:**
- Modify: `backend/app/db/models/enums.py`

- [ ] Add the following values to `BlockchainReceiptType` (existing values stay):

```python
class BlockchainReceiptType(str, enum.Enum):
    JOURNEY_LOCK        = "journey_lock"
    PICKUP              = "pickup"
    DELIVERY            = "delivery"
    CHECKPOINT_BATCH    = "checkpoint_batch"
    EXCEPTION_BATCH     = "exception_batch"
    DRIVER_SUBSTITUTION = "driver_substitution"
    # NEW:
    VEHICLE_CREATED     = "vehicle_created"
    VEHICLE_UPDATED     = "vehicle_updated"
    DRIVER_CREATED      = "driver_created"
    DRIVER_UPDATED      = "driver_updated"
```

- [ ] Add `SubjectType` enum in the same file:

```python
class SubjectType(str, enum.Enum):
    TRIP            = "trip"
    VEHICLE         = "vehicle"
    DRIVER          = "driver"
    VEHICLE_EVENT   = "vehicle_event"
    DRIVER_EVENT    = "driver_event"


class VehicleEventType(str, enum.Enum):
    CREATED                = "created"
    LICENSE_PLATE_CHANGED  = "license_plate_changed"
    LICENSE_DISC_RENEWED   = "license_disc_renewed"
    DEACTIVATED            = "deactivated"
    COSMETIC_UPDATE        = "cosmetic_update"


class DriverEventType(str, enum.Enum):
    CREATED          = "created"
    LICENSE_RENEWED  = "license_renewed"
    DEACTIVATED      = "deactivated"
    COSMETIC_UPDATE  = "cosmetic_update"


class VerifyStatus(str, enum.Enum):
    VERIFIED          = "verified"
    DB_MISMATCH       = "db_mismatch"
    HEDERA_MISMATCH   = "hedera_mismatch"
    NO_RECEIPT        = "no_receipt"
```

### Task 2: Critical-fields constants and diff helper

**Files:**
- Create: `backend/app/blockchain/critical_fields.py`
- Test: `backend/tests/unit/test_critical_fields.py`

- [ ] Implementation:

```python
"""Critical-fields lists for vehicle/driver mutations.

A field is 'critical' if a change to it should be anchored to Hedera.
Non-critical changes (cosmetic) are still recorded in the event log but skip
the Hedera anchor to save fees and reduce on-chain noise.
"""
from __future__ import annotations
from typing import Mapping, Any

VEHICLE_CRITICAL_FIELDS: frozenset[str] = frozenset({
    "registration",
    "licence_disc_expiry",
    "vehicle_type",
    "vin_number",
    "pulsit_device_id",
    "is_active",
})

DRIVER_CRITICAL_FIELDS: frozenset[str] = frozenset({
    "license_number",
    "license_expiry",
    "is_active",
})


def diff_critical_fields(
    old: Mapping[str, Any],
    new: Mapping[str, Any],
    critical: frozenset[str],
) -> dict[str, dict[str, Any]] | None:
    """Return {field: {"from": old, "to": new}} for changed critical fields, or None."""
    diff: dict[str, dict[str, Any]] = {}
    for field in critical:
        old_value = old.get(field)
        new_value = new.get(field)
        if old_value != new_value:
            diff[field] = {"from": old_value, "to": new_value}
    return diff or None
```

- [ ] Tests:

```python
import pytest
from app.blockchain.critical_fields import (
    diff_critical_fields, VEHICLE_CRITICAL_FIELDS, DRIVER_CRITICAL_FIELDS,
)


def test_diff_returns_none_when_no_critical_change():
    old = {"registration": "ABC123", "make": "Volvo"}
    new = {"registration": "ABC123", "make": "Scania"}
    assert diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS) is None


def test_diff_returns_diff_when_critical_changed():
    old = {"registration": "ABC123", "make": "Volvo"}
    new = {"registration": "XYZ789", "make": "Volvo"}
    result = diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS)
    assert result == {"registration": {"from": "ABC123", "to": "XYZ789"}}


def test_diff_multiple_critical_fields():
    old = {"license_number": "L1", "license_expiry": "2026-01-01", "is_active": True}
    new = {"license_number": "L2", "license_expiry": "2031-01-01", "is_active": True}
    result = diff_critical_fields(old, new, DRIVER_CRITICAL_FIELDS)
    assert result == {
        "license_number": {"from": "L1", "to": "L2"},
        "license_expiry": {"from": "2026-01-01", "to": "2031-01-01"},
    }


def test_diff_handles_missing_keys_as_none():
    old = {}
    new = {"registration": "ABC123"}
    result = diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS)
    assert result == {"registration": {"from": None, "to": "ABC123"}}
```

---

## Phase 2 — Migrations

### Task 3: Migration — extend `blockchain_receipts`

**Files:**
- Create: `backend/migrations/versions/2026_05_17_ciaran_extend_blockchain_receipts_for_subjects.py`

- [ ] Migration body. `down_revision` should match the latest existing migration head — discover with `cd backend && alembic heads`. Replace `<HEAD>` with that value:

```python
"""extend blockchain_receipts for arbitrary subjects

Revision ID: ciaran_extend_blockchain_receipts
Revises: <HEAD>
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "ciaran_extend_blockchain_receipts"
down_revision = "<HEAD>"  # set to current alembic head
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add columns nullable first, backfill, then enforce NOT NULL on subject_id.
    op.add_column(
        "blockchain_receipts",
        sa.Column("subject_type", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "blockchain_receipts",
        sa.Column("subject_id", UUID(as_uuid=True), nullable=True),
    )

    # Backfill: all existing receipts are trip-scoped.
    op.execute("""
        UPDATE blockchain_receipts
        SET subject_type = 'trip', subject_id = trip_id
        WHERE subject_type IS NULL
    """)

    # Now make NOT NULL.
    op.alter_column("blockchain_receipts", "subject_type", nullable=False)
    op.alter_column("blockchain_receipts", "subject_id", nullable=False)

    # trip_id becomes nullable so non-trip receipts can omit it.
    op.alter_column("blockchain_receipts", "trip_id", nullable=True)

    # Composite index for the common query "all receipts for entity X".
    op.create_index(
        "ix_blockchain_receipts_subject",
        "blockchain_receipts",
        ["subject_type", "subject_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_blockchain_receipts_subject", table_name="blockchain_receipts")
    op.alter_column("blockchain_receipts", "trip_id", nullable=False)
    op.drop_column("blockchain_receipts", "subject_id")
    op.drop_column("blockchain_receipts", "subject_type")
```

### Task 4: Migration — add `license_expiry` to `drivers`

**Files:**
- Create: `backend/migrations/versions/2026_05_17_ciaran_add_driver_license_expiry.py`

- [ ] Driver model currently has no `license_expiry`. Add it so license-renewal events can be anchored:

```python
"""add license_expiry to drivers

Revision ID: ciaran_driver_license_expiry
Revises: ciaran_extend_blockchain_receipts
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa

revision = "ciaran_driver_license_expiry"
down_revision = "ciaran_extend_blockchain_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("drivers", sa.Column("license_expiry", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("drivers", "license_expiry")
```

### Task 5: Migration — `vehicle_events` and `driver_events` tables

**Files:**
- Create: `backend/migrations/versions/2026_05_17_ciaran_add_vehicle_driver_events.py`

- [ ] Migration body:

```python
"""add vehicle_events and driver_events tables

Revision ID: ciaran_add_event_tables
Revises: ciaran_driver_license_expiry
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "ciaran_add_event_tables"
down_revision = "ciaran_driver_license_expiry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vehicle_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("changed_fields", JSONB, nullable=False),
        sa.Column("changed_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "blockchain_receipt_id",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "blockchain_receipts.id",
                use_alter=True,
                name="fk_vehicle_events_blockchain_receipt",
            ),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_vehicle_events_vehicle_id", "vehicle_events", ["vehicle_id"])

    op.create_table(
        "driver_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("driver_id", UUID(as_uuid=True), sa.ForeignKey("drivers.id"), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("changed_fields", JSONB, nullable=False),
        sa.Column("changed_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "blockchain_receipt_id",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "blockchain_receipts.id",
                use_alter=True,
                name="fk_driver_events_blockchain_receipt",
            ),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_driver_events_driver_id", "driver_events", ["driver_id"])


def downgrade() -> None:
    op.drop_index("ix_driver_events_driver_id", table_name="driver_events")
    op.drop_table("driver_events")
    op.drop_index("ix_vehicle_events_vehicle_id", table_name="vehicle_events")
    op.drop_table("vehicle_events")
```

---

## Phase 3 — Models

### Task 6: Update `BlockchainReceipt` model

**Files:**
- Modify: `backend/app/db/models/blockchain.py`

- [ ] Update the `BlockchainReceipt` class. `trip_id` becomes nullable; `subject_type` and `subject_id` are new and required:

```python
from app.db.models.enums import BlockchainReceiptType, MerkleBatchType, SubjectType


class BlockchainReceipt(Base):
    __tablename__ = "blockchain_receipts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # trip_id is kept for backward compatibility with existing trip-scoped queries.
    # New non-trip receipts leave it NULL and use subject_type/subject_id.
    trip_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trips.id", use_alter=True, name="fk_blockchain_receipts_trip_id"),
        nullable=True,
    )
    subject_type: Mapped[SubjectType] = mapped_column(String(30), nullable=False)
    subject_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    receipt_type: Mapped[BlockchainReceiptType] = mapped_column(String(30), nullable=False)
    data_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hedera_topic_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    hedera_tx_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    hedera_sequence_number: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    hedera_consensus_timestamp: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    payload_json: Mapped[Any] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

### Task 7: Add `license_expiry` to `Driver` model

**Files:**
- Modify: `backend/app/db/models/people.py`

- [ ] Add the field after `license_number`:

```python
from datetime import date  # add to imports
from sqlalchemy import Date  # add to imports

# Inside class Driver:
license_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
```

### Task 8: Create `VehicleEvent` and `DriverEvent` models

**Files:**
- Create: `backend/app/db/models/events.py`
- Modify: `backend/app/db/models/__init__.py`

- [ ] Model file:

```python
"""Append-only event-log models for vehicles and drivers.

Each row records a change to the underlying entity. event_type='created' captures
the initial snapshot. Critical-field changes get a Hedera anchor via
blockchain_receipt_id; cosmetic changes are recorded but unanchored.
"""
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base


class VehicleEvent(Base):
    __tablename__ = "vehicle_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    changed_fields: Mapped[Any] = mapped_column(JSONB, nullable=False)
    changed_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "blockchain_receipts.id",
            use_alter=True,
            name="fk_vehicle_events_blockchain_receipt",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DriverEvent(Base):
    __tablename__ = "driver_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    changed_fields: Mapped[Any] = mapped_column(JSONB, nullable=False)
    changed_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "blockchain_receipts.id",
            use_alter=True,
            name="fk_driver_events_blockchain_receipt",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

- [ ] Register models in `backend/app/db/models/__init__.py` — add this import next to the others:

```python
from app.db.models.events import DriverEvent, VehicleEvent  # noqa: E402,F401
```

---

## Phase 4 — Hashing extension

### Task 9: Extend `compute_journey_lock_hash`

**Files:**
- Modify: `backend/app/crypto/hashing.py`
- Modify: `backend/tests/unit/test_hashing.py` (or create if absent)

- [ ] New signature and canonical payload include `created_by_user_id` and `created_at`:

```python
import hashlib
import json
import uuid
from datetime import datetime


def compute_journey_lock_hash(
    *,
    trip_id: uuid.UUID,
    order_number: str,
    driver_id: uuid.UUID,
    horse_id: uuid.UUID,
    trailer_ids: list[uuid.UUID],
    origin_precinct_id: uuid.UUID,
    destination_precinct_id: uuid.UUID,
    created_by_user_id: uuid.UUID,
    created_at: datetime,
) -> str:
    """SHA-256 hex over canonical trip params at creation.

    Now includes who created it and when. The output is BOTH the trip.journey_lock_hash
    AND the on-chain hash for the trip's BlockchainReceipt — single source of truth.
    """
    if not trailer_ids:
        raise ValueError("trailer_ids must not be empty")

    payload = {
        "trip_id": str(trip_id),
        "order_number": order_number,
        "driver_id": str(driver_id),
        "horse_id": str(horse_id),
        "trailers": sorted(str(t) for t in trailer_ids),
        "origin_precinct_id": str(origin_precinct_id),
        "destination_precinct_id": str(destination_precinct_id),
        "created_by_user_id": str(created_by_user_id),
        "created_at": created_at.isoformat(),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def compute_trip_canonical_payload(
    *,
    trip_id: uuid.UUID,
    order_number: str,
    driver_id: uuid.UUID,
    horse_id: uuid.UUID,
    trailer_ids: list[uuid.UUID],
    origin_precinct_id: uuid.UUID,
    destination_precinct_id: uuid.UUID,
    created_by_user_id: uuid.UUID,
    created_at: datetime,
) -> dict:
    """Same canonical payload — exposed for verification flow."""
    return {
        "trip_id": str(trip_id),
        "order_number": order_number,
        "driver_id": str(driver_id),
        "horse_id": str(horse_id),
        "trailers": sorted(str(t) for t in trailer_ids),
        "origin_precinct_id": str(origin_precinct_id),
        "destination_precinct_id": str(destination_precinct_id),
        "created_by_user_id": str(created_by_user_id),
        "created_at": created_at.isoformat(),
    }
```

- [ ] Tests:

```python
import uuid
from datetime import UTC, datetime
from app.crypto.hashing import compute_journey_lock_hash, compute_trip_canonical_payload


def _fixed_args():
    return dict(
        trip_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        order_number="ORD-001",
        driver_id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
        horse_id=uuid.UUID("00000000-0000-0000-0000-000000000003"),
        trailer_ids=[uuid.UUID("00000000-0000-0000-0000-000000000004")],
        origin_precinct_id=uuid.UUID("00000000-0000-0000-0000-000000000005"),
        destination_precinct_id=uuid.UUID("00000000-0000-0000-0000-000000000006"),
        created_by_user_id=uuid.UUID("00000000-0000-0000-0000-000000000007"),
        created_at=datetime(2026, 5, 16, 12, 0, 0, tzinfo=UTC),
    )


def test_hash_is_deterministic():
    h1 = compute_journey_lock_hash(**_fixed_args())
    h2 = compute_journey_lock_hash(**_fixed_args())
    assert h1 == h2
    assert len(h1) == 64
    assert all(c in "0123456789abcdef" for c in h1)


def test_hash_changes_when_user_changes():
    args = _fixed_args()
    h1 = compute_journey_lock_hash(**args)
    args["created_by_user_id"] = uuid.UUID("00000000-0000-0000-0000-000000000099")
    h2 = compute_journey_lock_hash(**args)
    assert h1 != h2


def test_hash_changes_when_created_at_changes():
    args = _fixed_args()
    h1 = compute_journey_lock_hash(**args)
    args["created_at"] = datetime(2026, 5, 17, 12, 0, 0, tzinfo=UTC)
    h2 = compute_journey_lock_hash(**args)
    assert h1 != h2


def test_trailer_order_does_not_affect_hash():
    args = _fixed_args()
    args["trailer_ids"] = [
        uuid.UUID("00000000-0000-0000-0000-00000000000a"),
        uuid.UUID("00000000-0000-0000-0000-00000000000b"),
    ]
    h1 = compute_journey_lock_hash(**args)
    args["trailer_ids"] = list(reversed(args["trailer_ids"]))
    h2 = compute_journey_lock_hash(**args)
    assert h1 == h2


def test_canonical_payload_matches_hash():
    import hashlib
    import json
    args = _fixed_args()
    payload = compute_trip_canonical_payload(**args)
    expected = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    assert compute_journey_lock_hash(**args) == expected
```

---

## Phase 5 — Anchor service

### Task 10: Create `anchor_service.py`

**Files:**
- Create: `backend/app/blockchain/anchor_service.py`
- Test: `backend/tests/unit/test_anchor_service.py`

- [ ] Implementation:

```python
"""Orchestration-layer wrapper around HederaService + BlockchainReceipt persistence.

This is the single function called sync today and async via Celery later.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaService
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import BlockchainReceiptType, SubjectType


def canonicalize_payload(payload: dict[str, Any]) -> str:
    """JSON with sorted keys and no whitespace — reproducible from any language."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def compute_payload_hash(payload: dict[str, Any]) -> str:
    """SHA-256 hex over the canonical JSON encoding of payload."""
    canonical = canonicalize_payload(payload)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def anchor_subject(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    canonical_payload: dict[str, Any],
    receipt_type: BlockchainReceiptType,
    trip_id: uuid.UUID | None = None,
    hedera_service: HederaService | None = None,
) -> BlockchainReceipt:
    """Hash the payload, submit to HCS, persist a BlockchainReceipt, return it.

    Blocks ~4-6s on the Hedera SDK call. The caller is responsible for whether this
    runs inside an HTTP request handler (demo path) or a Celery task (production path).

    Raises any HederaServiceError uncaught — the caller transaction should roll back.
    """
    data_hash = compute_payload_hash(canonical_payload)

    service = hedera_service or HederaService()
    hedera_receipt = service.submit_hash(data_hash)

    receipt = BlockchainReceipt(
        id=uuid.uuid4(),
        trip_id=trip_id,
        subject_type=subject_type,
        subject_id=subject_id,
        receipt_type=receipt_type,
        data_hash=data_hash,
        hedera_topic_id=hedera_receipt.topic_id,
        hedera_tx_id=hedera_receipt.transaction_id,
        hedera_sequence_number=hedera_receipt.sequence_number,
        hedera_consensus_timestamp=None,  # Not parsed; mirror node has authoritative value.
        payload_json=canonical_payload,
    )
    db.add(receipt)
    await db.flush()
    return receipt
```

- [ ] Tests use a stubbed `HederaService` — no real network calls:

```python
import uuid
from unittest.mock import MagicMock

import pytest

from app.blockchain.anchor_service import (
    anchor_subject, canonicalize_payload, compute_payload_hash,
)
from app.blockchain.hedera import HederaReceipt
from app.db.models.enums import BlockchainReceiptType, SubjectType


def test_canonicalize_is_deterministic_and_sorted():
    out1 = canonicalize_payload({"b": 2, "a": 1, "c": [3, 1, 2]})
    out2 = canonicalize_payload({"c": [3, 1, 2], "a": 1, "b": 2})
    assert out1 == out2
    assert out1 == '{"a":1,"b":2,"c":[3,1,2]}'


def test_hash_matches_manual_sha256():
    import hashlib, json
    payload = {"x": 1}
    expected = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    assert compute_payload_hash(payload) == expected


@pytest.mark.asyncio
async def test_anchor_subject_persists_receipt(db_session):
    stub_service = MagicMock()
    stub_service.submit_hash.return_value = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=41,
        consensus_timestamp="1715865600.000000000",
        transaction_id="0.0.12345@1715865600.000000000",
    )

    subject_id = uuid.uuid4()
    payload = {"hello": "world"}

    receipt = await anchor_subject(
        db_session,
        subject_type=SubjectType.VEHICLE_EVENT,
        subject_id=subject_id,
        canonical_payload=payload,
        receipt_type=BlockchainReceiptType.VEHICLE_CREATED,
        hedera_service=stub_service,
    )

    assert receipt.subject_id == subject_id
    assert receipt.subject_type == SubjectType.VEHICLE_EVENT
    assert receipt.hedera_sequence_number == 41
    assert receipt.hedera_topic_id == "0.0.12345"
    assert receipt.data_hash == compute_payload_hash(payload)
    stub_service.submit_hash.assert_called_once_with(receipt.data_hash)
```

`db_session` fixture is the existing async DB fixture in `backend/tests/conftest.py` — verify its name there and adjust if it differs.

---

## Phase 6 — Verification service

### Task 11: Create `verification_service.py`

**Files:**
- Create: `backend/app/orchestration/verification_service.py`
- Test: `backend/tests/unit/test_verification_service.py`

- [ ] Implementation:

```python
"""Verify a subject's current DB state against its anchored Hedera record.

Returns one of: verified, db_mismatch, hedera_mismatch, no_receipt.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaService
from app.crypto.hashing import compute_trip_canonical_payload
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import SubjectType, VerifyStatus
from app.db.models.trips import Trip, TripTrailer


@dataclass(frozen=True)
class VerifyOutcome:
    status: VerifyStatus
    receipt: BlockchainReceipt | None = None
    expected_hash: str | None = None  # the hash we have on file
    current_hash: str | None = None   # the hash we just recomputed


async def _latest_receipt(
    db: AsyncSession, subject_type: SubjectType, subject_id: uuid.UUID
) -> BlockchainReceipt | None:
    result = await db.execute(
        select(BlockchainReceipt)
        .where(
            BlockchainReceipt.subject_type == subject_type,
            BlockchainReceipt.subject_id == subject_id,
        )
        .order_by(desc(BlockchainReceipt.created_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _reconstruct_trip_payload(
    db: AsyncSession, trip_id: uuid.UUID
) -> dict[str, Any] | None:
    trip = (
        await db.execute(select(Trip).where(Trip.id == trip_id))
    ).scalar_one_or_none()
    if trip is None:
        return None
    trailer_rows = (
        await db.execute(
            select(TripTrailer.trailer_id).where(TripTrailer.trip_id == trip_id)
        )
    ).scalars().all()
    return compute_trip_canonical_payload(
        trip_id=trip.id,
        order_number=trip.order_number,
        driver_id=trip.driver_id,
        horse_id=trip.horse_id,
        trailer_ids=list(trailer_rows),
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        created_by_user_id=trip.created_by_user_id,
        created_at=trip.created_at,
    )


def _hash_payload(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


async def verify_subject(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    hedera_service: HederaService | None = None,
) -> VerifyOutcome:
    receipt = await _latest_receipt(db, subject_type, subject_id)
    if receipt is None:
        return VerifyOutcome(status=VerifyStatus.NO_RECEIPT)

    # Reconstruct or read the payload.
    if subject_type == SubjectType.TRIP:
        rebuilt = await _reconstruct_trip_payload(db, subject_id)
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
    elif subject_type in (SubjectType.VEHICLE_EVENT, SubjectType.DRIVER_EVENT):
        # Events are immutable; re-hash the stored payload_json.
        current_hash = _hash_payload(receipt.payload_json)
    else:
        # vehicle/driver subject types not currently verifiable directly;
        # the dispatcher verifies their events instead.
        return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)

    if current_hash != receipt.data_hash:
        return VerifyOutcome(
            status=VerifyStatus.DB_MISMATCH,
            receipt=receipt,
            expected_hash=receipt.data_hash,
            current_hash=current_hash,
        )

    # Now check Hedera.
    service = hedera_service or HederaService()
    try:
        match = service.verify_hash(
            receipt.hedera_topic_id,
            receipt.hedera_sequence_number,
            receipt.data_hash,
        )
    except Exception:
        # Network error / mirror node unreachable — treat as hedera_mismatch for the UI.
        return VerifyOutcome(status=VerifyStatus.HEDERA_MISMATCH, receipt=receipt)
    if not match:
        return VerifyOutcome(status=VerifyStatus.HEDERA_MISMATCH, receipt=receipt)

    return VerifyOutcome(status=VerifyStatus.VERIFIED, receipt=receipt)
```

- [ ] Tests with stubbed Hedera + fixture data:

```python
import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import BlockchainReceiptType, SubjectType, VerifyStatus
from app.orchestration.verification_service import verify_subject


@pytest.mark.asyncio
async def test_verify_returns_no_receipt_when_none_exists(db_session):
    out = await verify_subject(
        db_session, subject_type=SubjectType.TRIP, subject_id=uuid.uuid4()
    )
    assert out.status == VerifyStatus.NO_RECEIPT


@pytest.mark.asyncio
async def test_verify_db_mismatch_when_trip_modified(db_session, seeded_trip):
    """Insert a receipt, then modify the trip's order_number, then verify → db_mismatch."""
    # Arrange: receipt exists for original trip state.
    # Act: change trip.order_number.
    seeded_trip.order_number = "TAMPERED"
    await db_session.flush()
    stub = MagicMock()
    # Act
    out = await verify_subject(
        db_session,
        subject_type=SubjectType.TRIP,
        subject_id=seeded_trip.id,
        hedera_service=stub,
    )
    # Assert
    assert out.status == VerifyStatus.DB_MISMATCH
    assert out.expected_hash != out.current_hash


@pytest.mark.asyncio
async def test_verify_hedera_mismatch_when_mirror_returns_false(db_session, seeded_trip_with_receipt):
    stub = MagicMock()
    stub.verify_hash.return_value = False
    out = await verify_subject(
        db_session,
        subject_type=SubjectType.TRIP,
        subject_id=seeded_trip_with_receipt.id,
        hedera_service=stub,
    )
    assert out.status == VerifyStatus.HEDERA_MISMATCH


@pytest.mark.asyncio
async def test_verify_verified_when_db_and_hedera_match(db_session, seeded_trip_with_receipt):
    stub = MagicMock()
    stub.verify_hash.return_value = True
    out = await verify_subject(
        db_session,
        subject_type=SubjectType.TRIP,
        subject_id=seeded_trip_with_receipt.id,
        hedera_service=stub,
    )
    assert out.status == VerifyStatus.VERIFIED
```

`seeded_trip` and `seeded_trip_with_receipt` fixtures need to be added to `conftest.py`. They should create a Trip with valid foreign keys (org, user, driver, vehicles, precincts) and, for the second fixture, also a `BlockchainReceipt` whose `data_hash` matches `compute_journey_lock_hash(...)` of the trip's current state.

---

## Phase 7 — Service-layer integration

### Task 12: Modify `trip_service.create_trip` to anchor

**Files:**
- Modify: `backend/app/orchestration/trip_service.py`

- [ ] Replace the stub at lines 175-176 (`NOTE: Hedera HCS anchor task would be queued here`) with an actual anchor call. Also update the existing `compute_journey_lock_hash` call to pass the new args:

```python
# Existing imports — add:
from app.blockchain.anchor_service import anchor_subject
from app.crypto.hashing import compute_journey_lock_hash, compute_trip_canonical_payload
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, HandshakeStatus, HandshakeType,
    IdvsStatus, SubjectType, TripStatus, VehicleType,
)
from app.schemas.blockchain import BlockchainReceiptRead


# In create_trip(), replace the journey-lock-hash block + the NOTE stub:

# 6. Compute canonical payload (single source of truth for hash + on-chain payload).
canonical = compute_trip_canonical_payload(
    trip_id=trip_id,
    order_number=payload.order_number,
    driver_id=payload.driver_id,
    horse_id=payload.horse_id,
    trailer_ids=payload.trailer_ids,
    origin_precinct_id=payload.origin_precinct_id,
    destination_precinct_id=payload.destination_precinct_id,
    created_by_user_id=current_user.id,
    created_at=trip.created_at,
)
lock_hash = compute_journey_lock_hash(
    trip_id=trip_id,
    order_number=payload.order_number,
    driver_id=payload.driver_id,
    horse_id=payload.horse_id,
    trailer_ids=payload.trailer_ids,
    origin_precinct_id=payload.origin_precinct_id,
    destination_precinct_id=payload.destination_precinct_id,
    created_by_user_id=current_user.id,
    created_at=trip.created_at,
)
trip.journey_lock_hash = lock_hash

# 7. Anchor synchronously to Hedera HCS (blocks ~4-6s).
receipt = await anchor_subject(
    db,
    subject_type=SubjectType.TRIP,
    subject_id=trip_id,
    canonical_payload=canonical,
    receipt_type=BlockchainReceiptType.JOURNEY_LOCK,
    trip_id=trip_id,
)

await db.commit()
await db.refresh(trip)
await db.refresh(h0)
await db.refresh(receipt)

# 8. Assemble response, now including the receipt.
return TripDetailResponse(
    ...,  # all existing fields
    blockchain_receipts=[BlockchainReceiptRead.model_validate(receipt)],
    ...,
)
```

- [ ] Note: if `HederaService.submit_hash()` raises, the `await db.commit()` is never reached and the transaction rolls back automatically when the session is closed. The HTTP layer translates the error to 500.

### Task 13: Modify `resource_service.create_vehicle` to anchor

**Files:**
- Modify: `backend/app/orchestration/resource_service.py`

- [ ] Update `create_vehicle` signature to accept `current_user`, write a `VehicleEvent`, and anchor it:

```python
from app.blockchain.anchor_service import anchor_subject
from app.db.models.enums import (
    BlockchainReceiptType, IdvsStatus, SubjectType, TripStatus, VehicleEventType,
)
from app.db.models.events import VehicleEvent


async def create_vehicle(
    db: AsyncSession,
    organization_id: uuid.UUID,
    data: VehicleCreateBody,
    current_user_id: uuid.UUID,
) -> VehicleRead:
    vehicle = Vehicle(
        organization_id=organization_id,
        registration=data.registration,
        vehicle_type=data.vehicle_type,
        pulsit_device_id=data.pulsit_device_id,
        make=data.make,
        model=data.model,
        year=data.year,
        vin_number=data.vin_number,
        licence_disc_expiry=data.licence_disc_expiry,
        gross_vehicle_mass_kg=data.gross_vehicle_mass_kg,
    )
    db.add(vehicle)
    try:
        await db.flush()
    except IntegrityError as exc:
        if "UniqueViolationError" not in str(exc):
            raise
        raise DuplicateResourceError("Vehicle", "registration", data.registration) from exc

    # Write the 'created' event with a full snapshot of critical + presentational fields.
    snapshot = {
        "registration": vehicle.registration,
        "vehicle_type": vehicle.vehicle_type.value if hasattr(vehicle.vehicle_type, "value") else vehicle.vehicle_type,
        "pulsit_device_id": vehicle.pulsit_device_id,
        "make": vehicle.make,
        "model": vehicle.model,
        "year": vehicle.year,
        "vin_number": vehicle.vin_number,
        "licence_disc_expiry": vehicle.licence_disc_expiry.isoformat() if vehicle.licence_disc_expiry else None,
        "is_active": vehicle.is_active,
    }
    vehicle_event = VehicleEvent(
        id=uuid.uuid4(),
        vehicle_id=vehicle.id,
        event_type=VehicleEventType.CREATED.value,
        changed_fields=snapshot,
        changed_by_user_id=current_user_id,
    )
    db.add(vehicle_event)
    await db.flush()

    canonical = {
        "vehicle_event_id": str(vehicle_event.id),
        "vehicle_id": str(vehicle.id),
        "event_type": VehicleEventType.CREATED.value,
        "fields": snapshot,
        "changed_by_user_id": str(current_user_id),
        "timestamp": vehicle_event.created_at.isoformat(),
    }
    receipt = await anchor_subject(
        db,
        subject_type=SubjectType.VEHICLE_EVENT,
        subject_id=vehicle_event.id,
        canonical_payload=canonical,
        receipt_type=BlockchainReceiptType.VEHICLE_CREATED,
    )
    vehicle_event.blockchain_receipt_id = receipt.id

    await db.refresh(vehicle)
    return VehicleRead.model_validate(vehicle)
```

### Task 14: Modify `resource_service.create_driver` to anchor (POPIA-safe)

**Files:**
- Modify: `backend/app/orchestration/resource_service.py`
- Modify: `backend/app/schemas/people.py` (add `license_expiry` to `DriverCreateBody` and `DriverRead`)

- [ ] First, extend the schemas. In `backend/app/schemas/people.py`, add to `DriverCreateBody`:

```python
from datetime import date

class DriverCreateBody(BaseModel):
    # ...existing fields...
    license_expiry: date | None = None  # NEW

class DriverRead(BaseModel):
    # ...existing fields...
    license_expiry: date | None = None  # NEW
    model_config = ConfigDict(from_attributes=True)
```

- [ ] Then update `create_driver`:

```python
import hashlib

from app.blockchain.anchor_service import anchor_subject
from app.db.models.enums import (
    BlockchainReceiptType, DriverEventType, IdvsStatus, SubjectType,
)
from app.db.models.events import DriverEvent


async def create_driver(
    db: AsyncSession,
    organization_id: uuid.UUID,
    data: DriverCreateBody,
    current_user_id: uuid.UUID,
) -> DriverRead:
    driver_id = await create_driver_auth_user(
        phone=data.phone_number,
        full_name=data.full_name,
    )
    driver = Driver(
        id=driver_id,
        organization_id=organization_id,
        full_name=data.full_name,
        id_number=data.id_number,
        phone_number=data.phone_number,
        license_number=data.license_number,
        license_expiry=data.license_expiry,
        idvs_status=IdvsStatus.PENDING,
    )
    db.add(driver)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise DuplicateResourceError("Driver", "id_number", data.id_number) from exc

    # POPIA: license_number is hashed before going on chain. Plaintext stays in DB only.
    license_number_sha256 = hashlib.sha256(
        driver.license_number.encode("utf-8")
    ).hexdigest()

    snapshot = {
        "license_number_sha256": license_number_sha256,
        "license_expiry": driver.license_expiry.isoformat() if driver.license_expiry else None,
        "is_active": driver.is_active,
    }
    driver_event = DriverEvent(
        id=uuid.uuid4(),
        driver_id=driver.id,
        event_type=DriverEventType.CREATED.value,
        changed_fields=snapshot,
        changed_by_user_id=current_user_id,
    )
    db.add(driver_event)
    await db.flush()

    canonical = {
        "driver_event_id": str(driver_event.id),
        "driver_id": str(driver.id),
        "event_type": DriverEventType.CREATED.value,
        "fields": snapshot,  # contains only hashed license number + expiry + is_active
        "changed_by_user_id": str(current_user_id),
        "timestamp": driver_event.created_at.isoformat(),
    }
    receipt = await anchor_subject(
        db,
        subject_type=SubjectType.DRIVER_EVENT,
        subject_id=driver_event.id,
        canonical_payload=canonical,
        receipt_type=BlockchainReceiptType.DRIVER_CREATED,
    )
    driver_event.blockchain_receipt_id = receipt.id

    await db.refresh(driver)
    return DriverRead.model_validate(driver)
```

**Critical:** the canonical payload contains NO `full_name`, `id_number`, `phone_number`, or plaintext `license_number`. The integration test in Task 22 asserts this explicitly.

### Task 15: Add `get_vehicle_detail` and `get_driver_detail` to `resource_service`

**Files:**
- Modify: `backend/app/orchestration/resource_service.py`

- [ ] New functions returning vehicle/driver + their events + receipts + related trips:

```python
from sqlalchemy import or_

from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import SubjectType
from app.db.models.events import DriverEvent, VehicleEvent
from app.schemas.events import DriverEventRead, VehicleEventRead
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.vehicles import VehicleDetailResponse
from app.schemas.people import DriverDetailResponse


async def get_vehicle_detail(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> VehicleDetailResponse:
    vehicle = (
        await db.execute(
            select(Vehicle).where(
                Vehicle.id == vehicle_id, Vehicle.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if vehicle is None:
        raise ResourceNotFoundError("Vehicle", str(vehicle_id))

    events = (
        await db.execute(
            select(VehicleEvent)
            .where(VehicleEvent.vehicle_id == vehicle_id)
            .order_by(VehicleEvent.created_at.desc())
        )
    ).scalars().all()

    event_ids = [e.id for e in events]
    receipts = (
        await db.execute(
            select(BlockchainReceipt).where(
                or_(
                    # Receipts directly on the vehicle (e.g., future vehicle-level anchors).
                    (BlockchainReceipt.subject_type == SubjectType.VEHICLE)
                    & (BlockchainReceipt.subject_id == vehicle_id),
                    # Receipts on any of this vehicle's events.
                    (BlockchainReceipt.subject_type == SubjectType.VEHICLE_EVENT)
                    & (BlockchainReceipt.subject_id.in_(event_ids)),
                )
            )
        )
    ).scalars().all() if event_ids else []

    trips = (
        await db.execute(
            select(Trip).where(
                or_(Trip.horse_id == vehicle_id, Trip.id.in_(
                    select(TripTrailer.trip_id).where(TripTrailer.trailer_id == vehicle_id)
                ))
            ).order_by(Trip.created_at.desc())
        )
    ).scalars().all()

    return VehicleDetailResponse(
        **VehicleRead.model_validate(vehicle).model_dump(),
        events=[VehicleEventRead.model_validate(e) for e in events],
        receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
        trip_ids=[t.id for t in trips],
    )


async def get_driver_detail(
    db: AsyncSession,
    driver_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> DriverDetailResponse:
    driver = (
        await db.execute(
            select(Driver).where(
                Driver.id == driver_id, Driver.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if driver is None:
        raise ResourceNotFoundError("Driver", str(driver_id))

    events = (
        await db.execute(
            select(DriverEvent)
            .where(DriverEvent.driver_id == driver_id)
            .order_by(DriverEvent.created_at.desc())
        )
    ).scalars().all()

    event_ids = [e.id for e in events]
    receipts = (
        await db.execute(
            select(BlockchainReceipt).where(
                (BlockchainReceipt.subject_type == SubjectType.DRIVER_EVENT)
                & (BlockchainReceipt.subject_id.in_(event_ids))
            )
        )
    ).scalars().all() if event_ids else []

    trips = (
        await db.execute(
            select(Trip).where(Trip.driver_id == driver_id).order_by(Trip.created_at.desc())
        )
    ).scalars().all()

    return DriverDetailResponse(
        **DriverRead.model_validate(driver).model_dump(),
        events=[DriverEventRead.model_validate(e) for e in events],
        receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
        trip_ids=[t.id for t in trips],
    )
```

---

## Phase 8 — Pydantic schemas

### Task 16: Extend `schemas/blockchain.py`

**Files:**
- Modify: `backend/app/schemas/blockchain.py`

- [ ] Add the verify request/result and the receipt read schema:

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.db.models.enums import BlockchainReceiptType, SubjectType, VerifyStatus


class BlockchainReceiptRead(BaseModel):
    id: UUID
    subject_type: SubjectType
    subject_id: UUID
    receipt_type: BlockchainReceiptType
    data_hash: str
    hedera_topic_id: str | None = None
    hedera_sequence_number: int | None = None
    hedera_consensus_timestamp: datetime | None = None
    hedera_tx_id: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VerifyRequest(BaseModel):
    subject_type: SubjectType
    subject_id: UUID


class VerifyResponse(BaseModel):
    status: VerifyStatus
    receipt: BlockchainReceiptRead | None = None
    expected_hash: str | None = None
    current_hash: str | None = None
```

### Task 17: Create `schemas/events.py`

**Files:**
- Create: `backend/app/schemas/events.py`

```python
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class VehicleEventRead(BaseModel):
    id: UUID
    vehicle_id: UUID
    event_type: str
    changed_fields: dict[str, Any]
    changed_by_user_id: UUID
    blockchain_receipt_id: UUID | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DriverEventRead(BaseModel):
    id: UUID
    driver_id: UUID
    event_type: str
    changed_fields: dict[str, Any]
    changed_by_user_id: UUID
    blockchain_receipt_id: UUID | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
```

### Task 18: Extend `schemas/trips.py`, `schemas/vehicles.py`, `schemas/people.py`

**Files:**
- Modify: `backend/app/schemas/trips.py`
- Modify: `backend/app/schemas/vehicles.py`
- Modify: `backend/app/schemas/people.py`

- [ ] In `trips.py`: `TripDetailResponse.blockchain_receipts` is already typed (currently `[]` in code). Change its type to `list[BlockchainReceiptRead]`:

```python
from app.schemas.blockchain import BlockchainReceiptRead

class TripDetailResponse(BaseModel):
    # ... existing fields ...
    blockchain_receipts: list[BlockchainReceiptRead] = []
```

- [ ] In `vehicles.py`: add `VehicleDetailResponse`:

```python
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.events import VehicleEventRead


class VehicleDetailResponse(VehicleRead):
    events: list[VehicleEventRead] = []
    receipts: list[BlockchainReceiptRead] = []
    trip_ids: list[UUID] = []
```

- [ ] In `people.py`: add `DriverDetailResponse`:

```python
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.events import DriverEventRead


class DriverDetailResponse(DriverRead):
    events: list[DriverEventRead] = []
    receipts: list[BlockchainReceiptRead] = []
    trip_ids: list[UUID] = []
```

---

## Phase 9 — API endpoints

### Task 19: Modify `vehicles.py` endpoint

**Files:**
- Modify: `backend/app/api/v1/endpoints/vehicles.py`

- [ ] Pass `current_user.id` to `create_vehicle`. Add `GET /{vehicle_id}` endpoint. Add 409 handling for `DuplicateResourceError` (currently missing — drivers has it; this aligns the two):

```python
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.resource_service import (
    create_vehicle, get_vehicle_detail, list_vehicles,
)
from app.schemas.people import UserRead
from app.schemas.vehicles import VehicleCreateBody, VehicleDetailResponse, VehicleRead

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("", response_model=list[VehicleRead])
async def list_vehicles_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[VehicleRead]:
    return await list_vehicles(db=db, organization_id=current_user.organization_id)


@router.post("", response_model=VehicleRead, status_code=201)
async def create_vehicle_endpoint(
    body: VehicleCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> VehicleRead:
    try:
        return await create_vehicle(
            db=db,
            organization_id=current_user.organization_id,
            data=body,
            current_user_id=current_user.id,
        )
    except DuplicateResourceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.get("/{vehicle_id}", response_model=VehicleDetailResponse)
async def get_vehicle_detail_endpoint(
    vehicle_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> VehicleDetailResponse:
    try:
        return await get_vehicle_detail(
            db=db,
            vehicle_id=vehicle_id,
            organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
```

### Task 20: Modify `drivers.py` endpoint

**Files:**
- Modify: `backend/app/api/v1/endpoints/drivers.py`

- [ ] Pass `current_user.id` to `create_driver`. Add `GET /{driver_id}`:

```python
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.resource_service import (
    create_driver, get_driver_detail, list_drivers,
)
from app.schemas.people import (
    DriverCreateBody, DriverDetailResponse, DriverRead, UserRead,
)

router = APIRouter(prefix="/drivers", tags=["drivers"])


@router.get("", response_model=list[DriverRead])
async def list_drivers_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[DriverRead]:
    return await list_drivers(db=db, organization_id=current_user.organization_id)


@router.post("", response_model=DriverRead, status_code=201)
async def create_driver_endpoint(
    body: DriverCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> DriverRead:
    try:
        return await create_driver(
            db=db,
            organization_id=current_user.organization_id,
            data=body,
            current_user_id=current_user.id,
        )
    except DuplicateResourceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.get("/{driver_id}", response_model=DriverDetailResponse)
async def get_driver_detail_endpoint(
    driver_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> DriverDetailResponse:
    try:
        return await get_driver_detail(
            db=db,
            driver_id=driver_id,
            organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
```

### Task 21: Create `blockchain.py` endpoint

**Files:**
- Create: `backend/app/api/v1/endpoints/blockchain.py`
- Modify: `backend/app/main.py`

- [ ] Endpoint file:

```python
"""FastAPI router for blockchain receipt + verification endpoints."""
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import SubjectType
from app.db.session import get_db
from app.orchestration.verification_service import verify_subject
from app.schemas.blockchain import (
    BlockchainReceiptRead, VerifyRequest, VerifyResponse,
)
from app.schemas.people import UserRead

router = APIRouter(prefix="/blockchain", tags=["blockchain"])


@router.get("/receipts", response_model=list[BlockchainReceiptRead])
async def list_receipts(
    subject_type: SubjectType = Query(...),
    subject_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    _: UserRead = Depends(get_current_dispatcher),
) -> list[BlockchainReceiptRead]:
    result = await db.execute(
        select(BlockchainReceipt)
        .where(
            BlockchainReceipt.subject_type == subject_type,
            BlockchainReceipt.subject_id == subject_id,
        )
        .order_by(BlockchainReceipt.created_at.desc())
    )
    return [BlockchainReceiptRead.model_validate(r) for r in result.scalars().all()]


@router.post("/verify", response_model=VerifyResponse)
async def verify_endpoint(
    payload: VerifyRequest,
    db: AsyncSession = Depends(get_db),
    _: UserRead = Depends(get_current_dispatcher),
) -> VerifyResponse:
    outcome = await verify_subject(
        db,
        subject_type=payload.subject_type,
        subject_id=payload.subject_id,
    )
    return VerifyResponse(
        status=outcome.status,
        receipt=BlockchainReceiptRead.model_validate(outcome.receipt) if outcome.receipt else None,
        expected_hash=outcome.expected_hash,
        current_hash=outcome.current_hash,
    )
```

- [ ] Register in `backend/app/main.py` alongside existing routers:

```python
from app.api.v1.endpoints import blockchain as blockchain_router
# ...
app.include_router(blockchain_router.router, prefix="/api/v1")
```

### Task 22: Integration tests for trip / vehicle / driver anchoring

**Files:**
- Create: `backend/tests/integration/test_trips_anchor.py`
- Create: `backend/tests/integration/test_vehicles_anchor.py`
- Create: `backend/tests/integration/test_drivers_anchor.py`
- Create: `backend/tests/integration/test_blockchain_verify.py`

These tests use the existing httpx + ASGITransport pattern from the project's other integration tests. They patch `HederaService` so no real network calls happen.

- [ ] `test_trips_anchor.py`:

```python
import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.blockchain.hedera import HederaReceipt
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import BlockchainReceiptType, SubjectType


@pytest.mark.asyncio
async def test_create_trip_writes_blockchain_receipt(
    async_client, db_session, auth_headers, seeded_trip_inputs,
):
    """POST /trips → BlockchainReceipt row exists with subject_type=trip + matching hash."""
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345", sequence_number=42,
        consensus_timestamp=None, transaction_id="0.0.12345@1715865600.0",
    )
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        instance = MagicMock()
        instance.submit_hash.return_value = fake_receipt
        MockService.return_value = instance

        resp = await async_client.post(
            "/api/v1/trips",
            json=seeded_trip_inputs,
            headers=auth_headers,
        )

    assert resp.status_code == 201
    body = resp.json()
    assert len(body["blockchain_receipts"]) == 1
    receipt = body["blockchain_receipts"][0]
    assert receipt["subject_type"] == "trip"
    assert receipt["hedera_sequence_number"] == 42
    assert receipt["receipt_type"] == "journey_lock"
    # Hash on response equals journey_lock_hash.
    assert receipt["data_hash"] == body["journey_lock_hash"]
```

- [ ] `test_vehicles_anchor.py`:

```python
@pytest.mark.asyncio
async def test_create_vehicle_writes_event_and_anchor(
    async_client, db_session, auth_headers, vehicle_payload,
):
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345", sequence_number=43,
        consensus_timestamp=None, transaction_id="0.0.12345@1715865601.0",
    )
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = fake_receipt
        resp = await async_client.post(
            "/api/v1/vehicles", json=vehicle_payload, headers=auth_headers,
        )
    assert resp.status_code == 201
    vehicle = resp.json()

    # Fetch detail.
    detail = await async_client.get(
        f"/api/v1/vehicles/{vehicle['id']}", headers=auth_headers,
    )
    body = detail.json()
    assert len(body["events"]) == 1
    assert body["events"][0]["event_type"] == "created"
    assert len(body["receipts"]) == 1
    assert body["receipts"][0]["subject_type"] == "vehicle_event"
```

- [ ] `test_drivers_anchor.py`:

```python
@pytest.mark.asyncio
async def test_create_driver_does_not_anchor_pii(
    async_client, db_session, auth_headers, driver_payload,
):
    """Critical POPIA test: no PII in the anchored payload_json."""
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345", sequence_number=44,
        consensus_timestamp=None, transaction_id="0.0.12345@1715865602.0",
    )
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = fake_receipt
        resp = await async_client.post(
            "/api/v1/drivers", json=driver_payload, headers=auth_headers,
        )
    assert resp.status_code == 201
    driver = resp.json()

    detail = await async_client.get(
        f"/api/v1/drivers/{driver['id']}", headers=auth_headers,
    )
    body = detail.json()
    payload_str = str(body)
    # PII inputs (real names/numbers from the fixture) must NOT appear in anchored content.
    assert driver_payload["full_name"] not in str(body["receipts"])
    assert driver_payload["id_number"] not in str(body["receipts"])
    assert driver_payload["phone_number"] not in str(body["receipts"])
    assert driver_payload["license_number"] not in str(body["receipts"])
    # The license-number hash IS present.
    import hashlib
    expected_hash = hashlib.sha256(driver_payload["license_number"].encode()).hexdigest()
    receipts_str = str(body["receipts"])
    assert expected_hash in receipts_str
```

- [ ] `test_blockchain_verify.py`: covers all four `VerifyStatus` paths via the `/api/v1/blockchain/verify` endpoint. Use `db_session.execute("UPDATE trips SET order_number='HACKED' WHERE id=...")` to simulate tampering for the `db_mismatch` case.

---

## Phase 10 — Frontend shared types and components

### Task 23: Shared types

**Files:**
- Create: `frontend/shared/types/blockchain.ts`

```ts
export type SubjectType =
  | 'trip' | 'vehicle' | 'driver' | 'vehicle_event' | 'driver_event';

export type BlockchainReceiptType =
  | 'journey_lock' | 'pickup' | 'delivery' | 'checkpoint_batch'
  | 'exception_batch' | 'driver_substitution'
  | 'vehicle_created' | 'vehicle_updated'
  | 'driver_created' | 'driver_updated';

export type BlockchainReceipt = {
  id: string;
  subject_type: SubjectType;
  subject_id: string;
  receipt_type: BlockchainReceiptType;
  data_hash: string;
  hedera_topic_id: string | null;
  hedera_sequence_number: number | null;
  hedera_consensus_timestamp: string | null;
  hedera_tx_id: string | null;
  created_at: string;
};

export type VerifyStatus =
  | 'verified' | 'db_mismatch' | 'hedera_mismatch' | 'no_receipt';

export type VerifyResult = {
  status: VerifyStatus;
  receipt: BlockchainReceipt | null;
  expected_hash: string | null;
  current_hash: string | null;
};

export type VehicleEventType =
  | 'created' | 'license_plate_changed' | 'license_disc_renewed'
  | 'deactivated' | 'cosmetic_update';

export type DriverEventType =
  | 'created' | 'license_renewed' | 'deactivated' | 'cosmetic_update';

export type VehicleEvent = {
  id: string;
  vehicle_id: string;
  event_type: VehicleEventType;
  changed_fields: Record<string, unknown>;
  changed_by_user_id: string;
  blockchain_receipt_id: string | null;
  created_at: string;
};

export type DriverEvent = {
  id: string;
  driver_id: string;
  event_type: DriverEventType;
  changed_fields: Record<string, unknown>;
  changed_by_user_id: string;
  blockchain_receipt_id: string | null;
  created_at: string;
};
```

### Task 24: `BlockchainBadge` component

**Files:**
- Create: `frontend/shared/components/blockchain/BlockchainBadge.tsx`

```tsx
"use client";

import type { BlockchainReceipt } from "@shared/types/blockchain";

type BadgeState = 'anchored' | 'pending' | 'failed' | 'unanchored';

type Props = {
  receipt: BlockchainReceipt | null;
  state?: BadgeState;
  className?: string;
};

const HASHSCAN_BASE =
  process.env.NEXT_PUBLIC_HEDERA_HASHSCAN_BASE ?? "https://hashscan.io/testnet";

export function BlockchainBadge({ receipt, state, className = "" }: Props) {
  const resolvedState: BadgeState = state ?? (receipt ? 'anchored' : 'unanchored');

  if (resolvedState === 'anchored' && receipt && receipt.hedera_topic_id) {
    const hashscanUrl =
      `${HASHSCAN_BASE}/topic/${receipt.hedera_topic_id}/${receipt.hedera_sequence_number}`;
    const ts = receipt.hedera_consensus_timestamp ?? receipt.created_at;
    return (
      <a
        href={hashscanUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/15 ${className}`}
      >
        <span>🔒</span>
        <span>Hedera</span>
        <span className="opacity-70">·</span>
        <span>Seq #{receipt.hedera_sequence_number}</span>
        <span className="opacity-70">·</span>
        <span>{new Date(ts).toUTCString()}</span>
        <span className="opacity-70">↗</span>
      </a>
    );
  }
  if (resolvedState === 'pending') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 ${className}`}>
        <span>⏳</span><span>Anchoring…</span>
      </span>
    );
  }
  if (resolvedState === 'failed') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300 ${className}`}>
        <span>⚠</span><span>Anchor failed</span>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-white/50 ${className}`}>
      <span>Not anchored</span>
    </span>
  );
}
```

### Task 25: `VerifyButton` component

**Files:**
- Create: `frontend/shared/components/blockchain/VerifyButton.tsx`

```tsx
"use client";

import { useState } from "react";
import type { SubjectType, VerifyResult } from "@shared/types/blockchain";

type Props = {
  subjectType: SubjectType;
  subjectId: string;
  apiBase?: string;  // override for tests; defaults to NEXT_PUBLIC_API_BASE_URL
  authHeader?: string;  // bearer token from useSession in caller
  onResult?: (r: VerifyResult) => void;
  className?: string;
};

type UIState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'result'; result: VerifyResult };

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function VerifyButton({
  subjectType, subjectId, apiBase = API_BASE, authHeader, onResult, className = "",
}: Props) {
  const [ui, setUi] = useState<UIState>({ kind: 'idle' });

  async function verify() {
    setUi({ kind: 'verifying' });
    const resp = await fetch(`${apiBase}/api/v1/blockchain/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body: JSON.stringify({ subject_type: subjectType, subject_id: subjectId }),
    });
    const result = (await resp.json()) as VerifyResult;
    setUi({ kind: 'result', result });
    onResult?.(result);
    setTimeout(() => setUi({ kind: 'idle' }), 7000);
  }

  if (ui.kind === 'verifying') {
    return (
      <button disabled className={`rounded-md bg-white/5 px-3 py-1.5 text-xs text-white/70 ${className}`}>
        Verifying against Hedera…
      </button>
    );
  }
  if (ui.kind === 'result') {
    const r = ui.result;
    if (r.status === 'verified') {
      return (
        <span className={`inline-flex items-center gap-2 rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 ${className}`}>
          ✓ Verified — DB matches Hedera anchor
        </span>
      );
    }
    if (r.status === 'db_mismatch') {
      return (
        <div className={`rounded-md bg-red-500/15 p-3 text-xs text-red-200 ${className}`}>
          <div className="font-semibold">⚠ MISMATCH — DB has been modified since anchoring</div>
          <div className="mt-1 opacity-80 font-mono">
            <div>Expected: {r.expected_hash}</div>
            <div>Current:  {r.current_hash}</div>
          </div>
        </div>
      );
    }
    if (r.status === 'hedera_mismatch') {
      return (
        <span className={`inline-flex items-center gap-2 rounded-md bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300 ${className}`}>
          ⚠ Hedera record mismatch — escalate
        </span>
      );
    }
    return (
      <span className={`inline-flex items-center gap-2 rounded-md bg-white/5 px-3 py-1.5 text-xs text-white/60 ${className}`}>
        No anchor on file — cannot verify
      </span>
    );
  }
  return (
    <button
      onClick={verify}
      className={`rounded-md bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/15 ${className}`}
    >
      Verify Now
    </button>
  );
}
```

### Task 26: `EventTimeline` component

**Files:**
- Create: `frontend/shared/components/blockchain/EventTimeline.tsx`

```tsx
"use client";

import type {
  BlockchainReceipt, DriverEvent, VehicleEvent,
} from "@shared/types/blockchain";
import { BlockchainBadge } from "./BlockchainBadge";

type Event = VehicleEvent | DriverEvent;

type Props = {
  events: Event[];
  receipts: BlockchainReceipt[];
  className?: string;
};

function describeEvent(e: Event): string {
  const t = e.event_type;
  if (t === 'created') return 'Created';
  if (t === 'license_plate_changed') return 'License plate changed';
  if (t === 'license_disc_renewed') return 'Licence disc renewed';
  if (t === 'license_renewed') return 'Driver licence renewed';
  if (t === 'deactivated') return 'Deactivated';
  if (t === 'cosmetic_update') return 'Cosmetic update';
  return t;
}

export function EventTimeline({ events, receipts, className = "" }: Props) {
  const receiptByEvent = new Map<string, BlockchainReceipt>();
  for (const r of receipts) {
    if (r.subject_type === 'vehicle_event' || r.subject_type === 'driver_event') {
      receiptByEvent.set(r.subject_id, r);
    }
  }
  return (
    <ol className={`space-y-2 ${className}`}>
      {events.map((e) => {
        const receipt = receiptByEvent.get(e.id) ?? null;
        return (
          <li key={e.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-white">{describeEvent(e)}</div>
                <div className="text-xs text-white/50">
                  {new Date(e.created_at).toUTCString()}
                </div>
              </div>
              <BlockchainBadge receipt={receipt} />
            </div>
            <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2 text-[11px] text-white/70">
              {JSON.stringify(e.changed_fields, null, 2)}
            </pre>
          </li>
        );
      })}
      {events.length === 0 && (
        <li className="text-sm text-white/40">No events recorded yet.</li>
      )}
    </ol>
  );
}
```

---

## Phase 11 — Frontend hooks

### Task 27: `useBlockchainReceipts` hook

**Files:**
- Create: `frontend/dispatcher/lib/hooks/useBlockchainReceipts.ts`

```ts
import { useAsyncData } from "./useAsyncData";
import { typedFetch } from "@/lib/api";  // existing fetch wrapper; adjust path if different
import type { BlockchainReceipt, SubjectType } from "@shared/types/blockchain";

export function useBlockchainReceipts(subjectType: SubjectType, subjectId: string | null) {
  return useAsyncData<BlockchainReceipt[]>(
    subjectId ? ["blockchain-receipts", subjectType, subjectId] : null,
    async () => {
      if (!subjectId) return [];
      return typedFetch<BlockchainReceipt[]>(
        `/api/v1/blockchain/receipts?subject_type=${subjectType}&subject_id=${subjectId}`
      );
    },
  );
}
```

(If `useAsyncData` has a different signature in the existing codebase, adapt — the uncommitted [useAsyncData.ts](frontend/dispatcher/lib/hooks/useAsyncData.ts) is the source of truth.)

### Task 28: `useVerify` hook

**Files:**
- Create: `frontend/dispatcher/lib/hooks/useVerify.ts`

```ts
import { useState, useCallback } from "react";
import { typedFetch } from "@/lib/api";
import type { SubjectType, VerifyResult } from "@shared/types/blockchain";

export function useVerify() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const verify = useCallback(async (subjectType: SubjectType, subjectId: string) => {
    setLoading(true);
    setResult(null);
    try {
      const r = await typedFetch<VerifyResult>("/api/v1/blockchain/verify", {
        method: "POST",
        body: JSON.stringify({ subject_type: subjectType, subject_id: subjectId }),
      });
      setResult(r);
      return r;
    } finally {
      setLoading(false);
    }
  }, []);

  return { verify, loading, result };
}
```

### Task 29: `useVehicleDetail` and `useDriverDetail` hooks

**Files:**
- Create: `frontend/dispatcher/lib/hooks/useVehicleDetail.ts`
- Create: `frontend/dispatcher/lib/hooks/useDriverDetail.ts`

```ts
// useVehicleDetail.ts
import { useAsyncData } from "./useAsyncData";
import { typedFetch } from "@/lib/api";
import type { BlockchainReceipt, VehicleEvent } from "@shared/types/blockchain";

export type VehicleDetail = {
  id: string;
  registration: string;
  vehicle_type: 'horse' | 'trailer';
  pulsit_device_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vin_number: string | null;
  licence_disc_expiry: string | null;
  is_active: boolean;
  events: VehicleEvent[];
  receipts: BlockchainReceipt[];
  trip_ids: string[];
};

export function useVehicleDetail(vehicleId: string | null) {
  return useAsyncData<VehicleDetail | null>(
    vehicleId ? ["vehicle-detail", vehicleId] : null,
    async () => {
      if (!vehicleId) return null;
      return typedFetch<VehicleDetail>(`/api/v1/vehicles/${vehicleId}`);
    },
  );
}
```

```ts
// useDriverDetail.ts — mirror pattern with DriverEvent / driver fields
import { useAsyncData } from "./useAsyncData";
import { typedFetch } from "@/lib/api";
import type { BlockchainReceipt, DriverEvent } from "@shared/types/blockchain";

export type DriverDetail = {
  id: string;
  full_name: string;
  id_number: string;
  phone_number: string;
  license_number: string;
  license_expiry: string | null;
  idvs_status: 'pending' | 'verified' | 'failed';
  is_active: boolean;
  events: DriverEvent[];
  receipts: BlockchainReceipt[];
  trip_ids: string[];
};

export function useDriverDetail(driverId: string | null) {
  return useAsyncData<DriverDetail | null>(
    driverId ? ["driver-detail", driverId] : null,
    async () => {
      if (!driverId) return null;
      return typedFetch<DriverDetail>(`/api/v1/drivers/${driverId}`);
    },
  );
}
```

### Task 30: Extend `useTripDetail`

**Files:**
- Modify: `frontend/dispatcher/lib/hooks/useTripDetail.ts`

- [ ] Add `blockchain_receipts: BlockchainReceipt[]` to the returned `TripDetail` type. No additional fetch needed — the existing `/api/v1/trips/{id}` response already includes it after Task 12.

---

## Phase 12 — Frontend pages (modify existing)

### Task 31: Modify `trips/[id]/page.tsx`

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`

- [ ] Near the trip-reference header, render the badge for the first receipt and a `<VerifyButton>` next to the trip-actions area. Add a "Blockchain Receipts" section listing every receipt:

```tsx
import { BlockchainBadge } from "@shared/components/blockchain/BlockchainBadge";
import { VerifyButton } from "@shared/components/blockchain/VerifyButton";

// In the JSX (inside the existing trip header / actions row):
<div className="flex items-center gap-3">
  <h1 className="text-xl font-semibold text-white">{trip.trip_reference}</h1>
  <BlockchainBadge receipt={trip.blockchain_receipts[0] ?? null} />
</div>

<div className="flex items-center gap-2">
  {/* existing actions */}
  <VerifyButton subjectType="trip" subjectId={trip.id} authHeader={authHeader} />
</div>

{/* New section near the bottom of the page: */}
<section className="mt-6">
  <h2 className="mb-2 text-sm font-semibold text-white/80">Blockchain Receipts</h2>
  <ul className="space-y-2">
    {trip.blockchain_receipts.map((r) => (
      <li key={r.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-mono text-white/70">{r.receipt_type}</span>
          <BlockchainBadge receipt={r} />
        </div>
        <div className="mt-1 break-all font-mono text-white/40">hash: {r.data_hash}</div>
      </li>
    ))}
  </ul>
</section>
```

### Task 32: Modify `trips/new/page.tsx`

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/new/page.tsx`

- [ ] In the submit handler, when the POST is in flight, display a transient "Anchoring to Hedera (≈4s)…" status. Reuse the existing loading state if present; otherwise add one:

```tsx
const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'anchoring'>('idle');

// In submit handler:
setSubmitState('anchoring');  // sync anchor IS the submission for our backend
const trip = await typedFetch<TripDetail>("/api/v1/trips", {
  method: "POST",
  body: JSON.stringify(payload),
});
router.push(`/trips/${trip.id}`);
```

Show a status banner during `submitState === 'anchoring'`:
```tsx
{submitState === 'anchoring' && (
  <div className="mt-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
    ⏳ Anchoring trip to Hedera testnet (approx. 4–6 seconds)…
  </div>
)}
```

### Task 33: Modify `fleet/vehicles/page.tsx`

**Files:**
- Modify: `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`

- [ ] Make each table row clickable → navigate to detail page. (Anchor-state indicator is deferred — the list endpoint doesn't return receipts. The detail page is where the badge lives.)

```tsx
import { useRouter } from "next/navigation";

const router = useRouter();

// In the row:
<tr
  onClick={() => router.push(`/fleet/vehicles/${vehicle.id}`)}
  className="cursor-pointer hover:bg-white/[0.03]"
>
  {/* existing cells */}
</tr>
```

### Task 34: Modify `fleet/drivers/page.tsx`

**Files:**
- Modify: `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`

- [ ] Same pattern — clickable rows → `/fleet/drivers/{id}`.

---

## Phase 13 — Frontend pages (new)

### Task 35: `fleet/vehicles/[id]/page.tsx`

**Files:**
- Create: `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`

```tsx
"use client";

import { useParams } from "next/navigation";
import { BlockchainBadge } from "@shared/components/blockchain/BlockchainBadge";
import { EventTimeline } from "@shared/components/blockchain/EventTimeline";
import { VerifyButton } from "@shared/components/blockchain/VerifyButton";
import { useVehicleDetail } from "@/lib/hooks/useVehicleDetail";

export default function VehicleDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: vehicle, error, loading } = useVehicleDetail(params.id);

  if (loading) return <div className="p-6 text-white/60">Loading vehicle…</div>;
  if (error || !vehicle) return <div className="p-6 text-red-300">Could not load vehicle.</div>;

  const latestReceipt = vehicle.receipts[0] ?? null;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{vehicle.registration}</h1>
          <p className="text-sm text-white/60">
            {vehicle.vehicle_type === 'horse' ? 'Horse' : 'Trailer'}
            {vehicle.make && ` · ${vehicle.make}`}
            {vehicle.model && ` ${vehicle.model}`}
            {vehicle.year && ` · ${vehicle.year}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BlockchainBadge receipt={latestReceipt} />
          {/* event-level verify is designed in; only trip-level wired for the demo */}
        </div>
      </header>

      <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-white/50">Pulsit device</dt><dd className="text-white">{vehicle.pulsit_device_id}</dd>
          <dt className="text-white/50">VIN</dt><dd className="text-white">{vehicle.vin_number ?? '—'}</dd>
          <dt className="text-white/50">Licence disc expiry</dt>
          <dd className="text-white">{vehicle.licence_disc_expiry ?? '—'}</dd>
          <dt className="text-white/50">Active</dt><dd className="text-white">{vehicle.is_active ? 'Yes' : 'No'}</dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white/80">Immutable history</h2>
        <EventTimeline events={vehicle.events} receipts={vehicle.receipts} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white/80">Trips using this vehicle</h2>
        {vehicle.trip_ids.length === 0 ? (
          <div className="text-sm text-white/40">No trips yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {vehicle.trip_ids.map((tid) => (
              <li key={tid}>
                <a href={`/trips/${tid}`} className="text-emerald-300 hover:underline">
                  {tid}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

### Task 36: `fleet/drivers/[id]/page.tsx`

**Files:**
- Create: `frontend/dispatcher/app/(app)/fleet/drivers/[id]/page.tsx`

- [ ] Same shape as the vehicle detail page, with driver-specific fields shown (full_name, phone_number, id_number, license_number, license_expiry, idvs_status). The PII fields are visible to the authenticated dispatcher — they live in DB only, never on chain.

```tsx
"use client";

import { useParams } from "next/navigation";
import { BlockchainBadge } from "@shared/components/blockchain/BlockchainBadge";
import { EventTimeline } from "@shared/components/blockchain/EventTimeline";
import { useDriverDetail } from "@/lib/hooks/useDriverDetail";

export default function DriverDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: driver, error, loading } = useDriverDetail(params.id);

  if (loading) return <div className="p-6 text-white/60">Loading driver…</div>;
  if (error || !driver) return <div className="p-6 text-red-300">Could not load driver.</div>;

  const latestReceipt = driver.receipts[0] ?? null;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{driver.full_name}</h1>
          <p className="text-sm text-white/60">{driver.phone_number}</p>
        </div>
        <BlockchainBadge receipt={latestReceipt} />
      </header>

      <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-white/50">ID number</dt><dd className="text-white">{driver.id_number}</dd>
          <dt className="text-white/50">Licence number</dt><dd className="text-white">{driver.license_number}</dd>
          <dt className="text-white/50">Licence expiry</dt><dd className="text-white">{driver.license_expiry ?? '—'}</dd>
          <dt className="text-white/50">IDVS</dt><dd className="text-white">{driver.idvs_status}</dd>
          <dt className="text-white/50">Active</dt><dd className="text-white">{driver.is_active ? 'Yes' : 'No'}</dd>
        </dl>
        <p className="mt-3 text-xs text-white/40">
          Driver personal info is stored in the database only and is never written to Hedera (POPIA).
          The on-chain record contains only the driver UUID, a SHA-256 hash of the licence number,
          and the licence expiry date.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white/80">Immutable history</h2>
        <EventTimeline events={driver.events} receipts={driver.receipts} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white/80">Trips for this driver</h2>
        {driver.trip_ids.length === 0 ? (
          <div className="text-sm text-white/40">No trips yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {driver.trip_ids.map((tid) => (
              <li key={tid}>
                <a href={`/trips/${tid}`} className="text-emerald-300 hover:underline">
                  {tid}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

---

## Phase 14 — Configuration

### Task 37: Verify backend `.env` and `core/config.py`

**Files:**
- Verify / modify: `backend/app/core/config.py`
- Verify / modify: `backend/.env.example`

- [ ] Confirm these settings exist in `app.core.config.Settings` (the existing `HederaService` at [hedera.py:140-151](backend/app/blockchain/hedera.py#L140-L151) already reads them):

```
HEDERA_NETWORK         (e.g. "testnet")
HEDERA_ACCOUNT_ID      (operator account, e.g. "0.0.12345")
HEDERA_PRIVATE_KEY     (operator private key — secret)
HEDERA_TOPIC_ID        (the HCS topic, e.g. "0.0.67890")
```

If any are missing from `core/config.py`, add them (typed as `str`). Mirror to `.env.example` with placeholder values (no real keys).

### Task 38: Add frontend HashScan env var

**Files:**
- Modify: `frontend/dispatcher/.env.local.example` (create if absent)

- [ ] Add:

```
NEXT_PUBLIC_HEDERA_HASHSCAN_BASE=https://hashscan.io/testnet
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

---

## Phase 15 — STRETCH (C): Vehicle / Driver mutation flows

If B is complete before Tuesday and there's time, work these. Otherwise stop after Task 38.

### Task 39 (stretch): `update_vehicle` service + PATCH endpoint

**Files:**
- Modify: `backend/app/orchestration/resource_service.py`
- Modify: `backend/app/api/v1/endpoints/vehicles.py`
- Modify: `backend/app/schemas/vehicles.py` (add `VehicleUpdateBody`)

- [ ] Service:

```python
from app.blockchain.critical_fields import VEHICLE_CRITICAL_FIELDS, diff_critical_fields
from app.db.models.enums import VehicleEventType


async def update_vehicle(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    organization_id: uuid.UUID,
    data: VehicleUpdateBody,
    current_user_id: uuid.UUID,
) -> VehicleRead:
    vehicle = (
        await db.execute(
            select(Vehicle).where(
                Vehicle.id == vehicle_id, Vehicle.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if vehicle is None:
        raise ResourceNotFoundError("Vehicle", str(vehicle_id))

    old = {
        "registration": vehicle.registration,
        "licence_disc_expiry": vehicle.licence_disc_expiry.isoformat() if vehicle.licence_disc_expiry else None,
        "vehicle_type": vehicle.vehicle_type.value if hasattr(vehicle.vehicle_type, "value") else vehicle.vehicle_type,
        "vin_number": vehicle.vin_number,
        "pulsit_device_id": vehicle.pulsit_device_id,
        "is_active": vehicle.is_active,
    }
    patched = data.model_dump(exclude_unset=True)
    for field, value in patched.items():
        setattr(vehicle, field, value)
    await db.flush()
    new = {
        "registration": vehicle.registration,
        "licence_disc_expiry": vehicle.licence_disc_expiry.isoformat() if vehicle.licence_disc_expiry else None,
        "vehicle_type": vehicle.vehicle_type.value if hasattr(vehicle.vehicle_type, "value") else vehicle.vehicle_type,
        "vin_number": vehicle.vin_number,
        "pulsit_device_id": vehicle.pulsit_device_id,
        "is_active": vehicle.is_active,
    }

    diff = diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS)
    event_type = VehicleEventType.COSMETIC_UPDATE
    if diff is not None:
        # Map specific diffs to specific event types.
        if "registration" in diff:
            event_type = VehicleEventType.LICENSE_PLATE_CHANGED
        elif "licence_disc_expiry" in diff:
            event_type = VehicleEventType.LICENSE_DISC_RENEWED
        elif "is_active" in diff and not new["is_active"]:
            event_type = VehicleEventType.DEACTIVATED

    event = VehicleEvent(
        id=uuid.uuid4(),
        vehicle_id=vehicle.id,
        event_type=event_type.value,
        changed_fields=diff or {"_no_critical_change": True, "_patch": patched},
        changed_by_user_id=current_user_id,
    )
    db.add(event)
    await db.flush()

    if diff is not None:
        canonical = {
            "vehicle_event_id": str(event.id),
            "vehicle_id": str(vehicle.id),
            "event_type": event_type.value,
            "fields": diff,
            "changed_by_user_id": str(current_user_id),
            "timestamp": event.created_at.isoformat(),
        }
        receipt = await anchor_subject(
            db,
            subject_type=SubjectType.VEHICLE_EVENT,
            subject_id=event.id,
            canonical_payload=canonical,
            receipt_type=BlockchainReceiptType.VEHICLE_UPDATED,
        )
        event.blockchain_receipt_id = receipt.id

    await db.refresh(vehicle)
    return VehicleRead.model_validate(vehicle)
```

- [ ] Endpoint: `PATCH /api/v1/vehicles/{vehicle_id}` calling `update_vehicle`.

### Task 40 (stretch): `update_driver` service + PATCH endpoint

**Files:**
- Modify: `backend/app/orchestration/resource_service.py`
- Modify: `backend/app/api/v1/endpoints/drivers.py`
- Modify: `backend/app/schemas/people.py` (add `DriverUpdateBody`)

- [ ] Same pattern as `update_vehicle`. POPIA-critical: the diff sent on chain is computed from the *hashed* license_number, not the plaintext. Use the same `license_number_sha256` approach from Task 14.

### Task 41 (stretch): Edit forms in dispatcher UI

**Files:**
- Modify: `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`
- Modify: `frontend/dispatcher/app/(app)/fleet/drivers/[id]/page.tsx`

- [ ] Add an "Edit" button to each detail page that toggles into an inline form. On submit, call `PATCH`, refresh the detail data, and the new event appears in the timeline with its badge.

---

## Final verification (run once at the end)

This is the only place that tests run, the only place mistakes get caught. Do it carefully.

### V1. Apply migrations

```bash
cd backend && alembic upgrade head
```

Expected: three new migrations apply cleanly (`extend_blockchain_receipts`, `driver_license_expiry`, `add_event_tables`). No errors. `\d blockchain_receipts` in psql shows `subject_type` and `subject_id`. `\dt` shows `vehicle_events` and `driver_events`.

### V2. Run the full backend test suite

```bash
cd backend && pytest -v
```

Expected: all tests pass. New tests added in this plan: `test_critical_fields.py`, `test_anchor_service.py`, `test_verification_service.py`, `test_hashing.py` (updated), `test_trips_anchor.py`, `test_vehicles_anchor.py`, `test_drivers_anchor.py`, `test_blockchain_verify.py`. Existing tests still pass (the `compute_journey_lock_hash` signature changed — verify all callers updated).

If any test fails, fix the underlying issue before continuing. Do not paper over with `xfail`.

### V3. Type-check the frontend

```bash
cd frontend/dispatcher && npm run lint && npm run typecheck
```

Expected: no TypeScript errors. New types from `@shared/types/blockchain` resolve. New components and pages have explicit prop types and no `any`.

### V4. Build the frontend

```bash
cd frontend/dispatcher && npm run build
```

Expected: clean build.

### V5. Live integration smoke test (against Hedera testnet)

1. Ensure `.env` has valid `HEDERA_*` values for the team's testnet operator account
2. Start backend: `cd backend && uvicorn app.main:app --reload`
3. Start frontend: `cd frontend/dispatcher && npm run dev`
4. Log in as a dispatcher
5. **Create a vehicle** → check Network tab: response has nothing in `events` (we list endpoint isn't extended in this plan; navigate to the new detail page to confirm). Open `/fleet/vehicles/{id}` → confirm `EventTimeline` shows the `created` event with a badge.
6. **Create a driver** → open `/fleet/drivers/{id}` → confirm `created` event + badge.
7. **Create a trip** → ~4-6s wait → trip detail page loads → `BlockchainBadge` shows sequence + topic + HashScan link. Click HashScan — should open the topic message externally.
8. **Click Verify Now** → ~1s → ✓ Verified.
9. **Tamper demo** (the showpiece):
   ```bash
   psql "$DATABASE_URL" -c "UPDATE trips SET order_number='ORDER-HACKED' WHERE trip_reference='<your trip ref>';"
   ```
   Refresh the dispatcher page. Click Verify Now → **⚠ MISMATCH DETECTED** in red, with `expected_hash` and `current_hash` shown.

### V6. Coordination check

Files in the shared-files list ([CLAUDE.md "Shared files — coordinate before changing"](CLAUDE.md)) that this plan modifies:

- `backend/app/main.py` (router registration)
- `backend/app/db/models/__init__.py` (event-model imports)
- `backend/app/core/config.py` (Hedera env vars — verify, may already be present)

Notify the team in the project channel before pushing.

### V7. Manual demo rehearsal

Walk through the demo script in spec §13 once end-to-end. Time it. If the Hedera testnet round-trip exceeds ~8s, consider switching to async (out of scope here) or warming up the SDK by submitting a no-op first.

---

## Files at a glance

### Backend — new
- `backend/app/blockchain/anchor_service.py`
- `backend/app/blockchain/critical_fields.py`
- `backend/app/orchestration/verification_service.py`
- `backend/app/api/v1/endpoints/blockchain.py`
- `backend/app/db/models/events.py`
- `backend/app/schemas/events.py`
- `backend/migrations/versions/2026_05_17_ciaran_extend_blockchain_receipts_for_subjects.py`
- `backend/migrations/versions/2026_05_17_ciaran_add_driver_license_expiry.py`
- `backend/migrations/versions/2026_05_17_ciaran_add_vehicle_driver_events.py`
- `backend/tests/unit/test_critical_fields.py`
- `backend/tests/unit/test_anchor_service.py`
- `backend/tests/unit/test_verification_service.py`
- `backend/tests/integration/test_trips_anchor.py`
- `backend/tests/integration/test_vehicles_anchor.py`
- `backend/tests/integration/test_drivers_anchor.py`
- `backend/tests/integration/test_blockchain_verify.py`

### Backend — modified
- `backend/app/db/models/enums.py`
- `backend/app/db/models/blockchain.py`
- `backend/app/db/models/people.py`
- `backend/app/db/models/__init__.py`
- `backend/app/crypto/hashing.py`
- `backend/app/orchestration/trip_service.py`
- `backend/app/orchestration/resource_service.py`
- `backend/app/api/v1/endpoints/vehicles.py`
- `backend/app/api/v1/endpoints/drivers.py`
- `backend/app/main.py`
- `backend/app/schemas/blockchain.py`
- `backend/app/schemas/people.py`
- `backend/app/schemas/vehicles.py`
- `backend/app/schemas/trips.py`
- `backend/.env.example` (verify Hedera keys)
- `backend/app/core/config.py` (verify Hedera fields)
- `backend/tests/unit/test_hashing.py`

### Frontend — new
- `frontend/shared/types/blockchain.ts`
- `frontend/shared/components/blockchain/BlockchainBadge.tsx`
- `frontend/shared/components/blockchain/VerifyButton.tsx`
- `frontend/shared/components/blockchain/EventTimeline.tsx`
- `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`
- `frontend/dispatcher/app/(app)/fleet/drivers/[id]/page.tsx`
- `frontend/dispatcher/lib/hooks/useBlockchainReceipts.ts`
- `frontend/dispatcher/lib/hooks/useVerify.ts`
- `frontend/dispatcher/lib/hooks/useVehicleDetail.ts`
- `frontend/dispatcher/lib/hooks/useDriverDetail.ts`

### Frontend — modified
- `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`
- `frontend/dispatcher/app/(app)/trips/new/page.tsx`
- `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`
- `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`
- `frontend/dispatcher/lib/hooks/useTripDetail.ts`
- `frontend/dispatcher/.env.local.example`
