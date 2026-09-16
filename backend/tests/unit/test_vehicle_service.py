"""Unit tests for orchestration/vehicle_service.py.

Characterization tests of the vehicle create/update anchoring behaviour. All are
DB-free: the AsyncSession and the Hedera anchor call are mocked at the boundaries
only. The diff/hash/payload logic runs as real code so SEC-5 (the Pulsit GPS
device id is anchored only as a SHA-256 hash, never in plaintext) is genuinely
exercised — mirroring integration test
test_create_vehicle_payload_json_hashes_pulsit_device_id at the unit level.

Mock boundaries:
- db (AsyncSession): _mock_db() below.
- anchor_subject: patched at app.orchestration.vehicle_service.anchor_subject.
"""

import hashlib
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.models.enums import BlockchainReceiptType, SubjectType, VehicleEventType, VehicleType
from app.db.models.events import VehicleEvent
from app.db.models.vehicles import UQ_VEHICLES_ORG_PULSIT, UQ_VEHICLES_ORG_REGISTRATION, Vehicle
from app.orchestration.vehicle_service import create_vehicle, update_vehicle
from app.schemas.vehicles import VehicleCreateBody, VehicleUpdateBody

# Postgres error code for unique_violation — the service maps only this to DuplicateResourceError.
_UNIQUE_VIOLATION_SQLSTATE = "23505"


class _FakeUniqueViolation(Exception):
    """Stand-in for asyncpg's UniqueViolationError.

    Carries both the sqlstate and the constraint name. Which constraint fired decides
    which field the 409 names — the whole point of the mapping — so a fake that omits
    it cannot exercise the behaviour that matters.
    """

    sqlstate = _UNIQUE_VIOLATION_SQLSTATE

    def __init__(self, constraint_name: str = UQ_VEHICLES_ORG_REGISTRATION) -> None:
        super().__init__(constraint_name)
        self.constraint_name = constraint_name


# ── Test doubles ───────────────────────────────────────────────────────────────

def _mock_db(scalar_result: object | None = None) -> MagicMock:
    """AsyncSession double for vehicle_service.

    - execute(...).scalar_one_or_none() → `scalar_result` (the row update_vehicle fetches).
    - flush() simulates Postgres applying server_default columns on INSERT
      (created_at / updated_at / is_active), so the closing VehicleRead.model_validate(...)
      and the `event.created_at.isoformat()` payload field see real values, not None.
      These columns use server_default=func.now()/"true", which is NOT applied to a
      freshly instantiated ORM object — only on a real flush.
    """
    added: list[Any] = []

    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar_result

    async def _flush() -> None:
        now = datetime.now(timezone.utc)
        for obj in added:
            cols = obj.__table__.columns
            # Vehicle.id uses a Python-side default=uuid.uuid4 applied by the ORM on
            # flush; with a mocked session that never runs, so simulate it here.
            if "id" in cols and getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()
            if "created_at" in cols and getattr(obj, "created_at", None) is None:
                obj.created_at = now
            if "updated_at" in cols and getattr(obj, "updated_at", None) is None:
                obj.updated_at = now
            if "is_active" in cols and getattr(obj, "is_active", None) is None:
                obj.is_active = True

    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock(side_effect=added.append)
    db.flush = AsyncMock(side_effect=_flush)
    db.refresh = AsyncMock()
    return db


def _anchor_stub() -> AsyncMock:
    """anchor_subject double returning a receipt whose .id the service assigns."""
    return AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4()))


def _make_vehicle(
    *,
    registration: str = "CA 123 456",
    pulsit_device_id: str = "PLT-EXIST-001",
    is_active: bool = True,
) -> Vehicle:
    """Fully-populated Vehicle mimicking a row already loaded from the DB."""
    now = datetime.now(timezone.utc)
    vehicle = Vehicle(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        registration=registration,
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id=pulsit_device_id,
        make="Volvo",
        model="FH16",
        year=2020,
        vin_number="1HGCM82633A004352",
        licence_disc_expiry=None,
        gross_vehicle_mass_kg=None,
        length_m=None,
        is_active=is_active,
    )
    vehicle.created_at = now
    vehicle.updated_at = now
    return vehicle


def _first_of_type(db: MagicMock, model: type) -> Any:
    """Return the first object of `model` passed to db.add (e.g. the VehicleEvent)."""
    for call in db.add.call_args_list:
        obj = call.args[0]
        if isinstance(obj, model):
            return obj
    raise AssertionError(f"No {model.__name__} was added to the session")


# ── G2.1: create_vehicle anchors once; SEC-5 device id is hashed, not plaintext ──

async def test_create_vehicle_anchors_once_and_hashes_pulsit_device_id() -> None:
    secret_device_id = "SECRET-TRACKER-001"
    db = _mock_db()
    anchor = _anchor_stub()
    data = VehicleCreateBody(
        registration="CA 999 XYZ",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id=secret_device_id,
    )

    with patch("app.orchestration.vehicle_service.anchor_subject", new=anchor):
        await create_vehicle(db, uuid.uuid4(), data, uuid.uuid4())

    anchor.assert_called_once()
    kwargs = anchor.call_args.kwargs
    assert kwargs["subject_type"] is SubjectType.VEHICLE_EVENT
    assert kwargs["receipt_type"] is BlockchainReceiptType.VEHICLE_CREATED

    payload = kwargs["canonical_payload"]
    # SEC-5: the raw GPS device id must never reach the chain — only its SHA-256.
    assert secret_device_id not in str(payload)
    fields = payload["fields"]
    assert "pulsit_device_id" not in fields
    assert fields["pulsit_device_id_sha256"] == hashlib.sha256(
        secret_device_id.encode("utf-8")
    ).hexdigest()


# ── G2.2: cosmetic update records an event but does NOT anchor ───────────────────

async def test_update_vehicle_cosmetic_does_not_anchor_but_records_event() -> None:
    vehicle = _make_vehicle()
    db = _mock_db(scalar_result=vehicle)
    anchor = _anchor_stub()
    data = VehicleUpdateBody(make="Scania")

    with patch("app.orchestration.vehicle_service.anchor_subject", new=anchor):
        await update_vehicle(db, vehicle.id, vehicle.organization_id, data, uuid.uuid4())

    anchor.assert_not_called()
    assert vehicle.make == "Scania"
    event = _first_of_type(db, VehicleEvent)
    assert event.event_type == VehicleEventType.COSMETIC_UPDATE.value
    # Cosmetic change is still logged in the DB event (full diff), just never anchored.
    assert event.changed_fields == {"make": {"from": "Volvo", "to": "Scania"}}


# ── G2.3: critical update anchors, payload carries ONLY the critical diff ────────

async def test_update_vehicle_critical_anchors_only_the_diff() -> None:
    old_reg = "CA 123 456"
    new_reg = "CA 999 999"
    vehicle = _make_vehicle(registration=old_reg)
    db = _mock_db(scalar_result=vehicle)
    anchor = _anchor_stub()
    data = VehicleUpdateBody(registration=new_reg)

    with patch("app.orchestration.vehicle_service.anchor_subject", new=anchor):
        await update_vehicle(db, vehicle.id, vehicle.organization_id, data, uuid.uuid4())

    anchor.assert_called_once()
    kwargs = anchor.call_args.kwargs
    assert kwargs["subject_type"] is SubjectType.VEHICLE_EVENT
    assert kwargs["receipt_type"] is BlockchainReceiptType.VEHICLE_UPDATED

    payload = kwargs["canonical_payload"]
    assert payload["fields"] == {"registration": {"from": old_reg, "to": new_reg}}
    event = _first_of_type(db, VehicleEvent)
    assert event.event_type == VehicleEventType.LICENSE_PLATE_CHANGED.value


# ── G2.4: SEC-5 also holds on the update path (device id change is hashed) ───────

async def test_update_vehicle_pulsit_change_anchors_only_hashed() -> None:
    old_device = "PLT-EXIST-001"
    new_device = "SECRET-NEW-TRACKER"
    vehicle = _make_vehicle(pulsit_device_id=old_device)
    db = _mock_db(scalar_result=vehicle)
    anchor = _anchor_stub()
    data = VehicleUpdateBody(pulsit_device_id=new_device)

    with patch("app.orchestration.vehicle_service.anchor_subject", new=anchor):
        await update_vehicle(db, vehicle.id, vehicle.organization_id, data, uuid.uuid4())

    anchor.assert_called_once()
    payload = anchor.call_args.kwargs["canonical_payload"]
    # Neither the old nor new raw device id may appear on-chain.
    assert old_device not in str(payload)
    assert new_device not in str(payload)
    fields = payload["fields"]
    assert "pulsit_device_id" not in fields
    assert fields["pulsit_device_id_sha256"] == {
        "from": hashlib.sha256(old_device.encode("utf-8")).hexdigest(),
        "to": hashlib.sha256(new_device.encode("utf-8")).hexdigest(),
    }


# ── G2.5: unknown id raises ResourceNotFoundError ───────────────────────────────

async def test_update_vehicle_unknown_id_raises_not_found() -> None:
    db = _mock_db(scalar_result=None)
    anchor = _anchor_stub()

    with patch("app.orchestration.vehicle_service.anchor_subject", new=anchor):
        with pytest.raises(ResourceNotFoundError):
            await update_vehicle(
                db, uuid.uuid4(), uuid.uuid4(), VehicleUpdateBody(make="X"), uuid.uuid4()
            )

    anchor.assert_not_called()


# ── G2.6: unique violation on create raises DuplicateResourceError ──────────────

async def test_create_vehicle_duplicate_raises_duplicate_resource() -> None:
    db = _mock_db()
    db.flush = AsyncMock(side_effect=IntegrityError("INSERT", {}, _FakeUniqueViolation()))
    anchor = _anchor_stub()
    data = VehicleCreateBody(
        registration="CA DUP 001",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-DUP-001",
    )

    with patch("app.orchestration.vehicle_service.anchor_subject", new=anchor):
        with pytest.raises(DuplicateResourceError):
            await create_vehicle(db, uuid.uuid4(), data, uuid.uuid4())

    anchor.assert_not_called()


# ── G2.7: the 409 names the field that actually clashed ────────────────────────

async def test_create_vehicle_duplicate_pulsit_names_the_device_field() -> None:
    """A double-assigned tracker must not be reported as a duplicate registration.

    (organization_id, pulsit_device_id) was the only vehicle constraint that existed
    for a long time, and every violation of it was reported against `registration` —
    a field that, in this exact scenario, is unique and correct.
    """
    db = _mock_db()
    db.flush = AsyncMock(
        side_effect=IntegrityError("INSERT", {}, _FakeUniqueViolation(UQ_VEHICLES_ORG_PULSIT))
    )
    anchor = _anchor_stub()
    data = VehicleCreateBody(
        registration="CA UNIQUE 001",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-SHARED-001",
    )

    with patch("app.orchestration.vehicle_service.anchor_subject", new=anchor):
        with pytest.raises(DuplicateResourceError) as caught:
            await create_vehicle(db, uuid.uuid4(), data, uuid.uuid4())

    assert caught.value.field == "pulsit_device_id"
    assert caught.value.value == "PLT-SHARED-001"
    anchor.assert_not_called()


async def test_create_vehicle_unknown_constraint_is_not_relabelled() -> None:
    """An unmapped constraint re-raises rather than guessing at a field.

    A 500 that gets investigated is better than a confident 409 pointing somewhere
    the dispatcher cannot fix.
    """
    db = _mock_db()
    db.flush = AsyncMock(
        side_effect=IntegrityError("INSERT", {}, _FakeUniqueViolation("uq_something_else"))
    )
    anchor = _anchor_stub()
    data = VehicleCreateBody(
        registration="CA OTHER 001",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-OTHER-001",
    )

    with patch("app.orchestration.vehicle_service.anchor_subject", new=anchor):
        with pytest.raises(IntegrityError):
            await create_vehicle(db, uuid.uuid4(), data, uuid.uuid4())

    anchor.assert_not_called()
