"""Unit tests for orchestration/driver_service.py.

Characterization tests of the driver create/update anchoring behaviour. All are
DB-free: the AsyncSession, the Supabase auth-user provisioning, and the Hedera
anchor call are mocked at the boundaries only. The diff/hash/payload logic runs
as real code so the POPIA guarantees (no PII on chain) are genuinely exercised.

Naming note: this file tests orchestration/driver_service.py — NOT core/exceptions
(which is test_exceptions.py).

Mock boundaries:
- db (AsyncSession): _mock_db() below.
- create_driver_auth_user: patched at app.orchestration.driver_service.create_driver_auth_user
  (the name driver_service actually resolves).
- anchor_subject: patched at app.orchestration.driver_service.anchor_subject.
"""

import hashlib
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.models.enums import BlockchainReceiptType, DriverEventType, IdvsStatus, SubjectType
from app.db.models.events import DriverEvent
from app.db.models.people import Driver
from app.orchestration.driver_service import create_driver, update_driver
from app.schemas.people import DriverCreateBody, DriverUpdateBody

# Postgres error code for unique_violation — the service maps only this to DuplicateResourceError.
_UNIQUE_VIOLATION_SQLSTATE = "23505"

# A valid 13-digit SA ID (passes DriverCreateBody.validate_id_number).
_VALID_ID_NUMBER = "9001015009081"


class _FakeUniqueViolation(Exception):
    """Stand-in for asyncpg's UniqueViolationError — carries the sqlstate the
    service reads to decide DuplicateResourceError vs. re-raise."""

    sqlstate = _UNIQUE_VIOLATION_SQLSTATE


# ── Test doubles ───────────────────────────────────────────────────────────────

def _mock_db(scalar_result: object | None = None) -> MagicMock:
    """AsyncSession double for driver_service.

    - execute(...).scalar_one_or_none() → `scalar_result` (the row update_driver fetches).
    - flush() simulates Postgres applying server_default columns on INSERT
      (created_at / updated_at / is_active), so the closing DriverRead.model_validate(...)
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
            # uuid PKs use a Python-side default=uuid.uuid4 applied by the ORM on
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


def _make_driver(
    *,
    license_number: str = "DRV-EXIST-001",
    license_expiry: date | None = None,
    is_active: bool = True,
) -> Driver:
    """Fully-populated Driver mimicking a row already loaded from the DB."""
    now = datetime.now(timezone.utc)
    driver = Driver(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        full_name="Existing Driver",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number=license_number,
        license_expiry=license_expiry,
        idvs_status=IdvsStatus.PENDING,
        is_active=is_active,
    )
    driver.created_at = now
    driver.updated_at = now
    return driver


def _first_of_type(db: MagicMock, model: type) -> Any:
    """Return the first object of `model` passed to db.add (e.g. the DriverEvent)."""
    for call in db.add.call_args_list:
        obj = call.args[0]
        if isinstance(obj, model):
            return obj
    raise AssertionError(f"No {model.__name__} was added to the session")


# ── G1.1: create_driver anchors once with a PII-free payload ─────────────────────

async def test_create_driver_anchors_once_without_pii() -> None:
    db = _mock_db()
    anchor = _anchor_stub()
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    driver_uuid = uuid.uuid4()
    data = DriverCreateBody(
        full_name="Thabo Nkosi",
        id_number=_VALID_ID_NUMBER,
        phone_number="+27820000001",
        license_number="DRV-ANC-001",
        license_expiry=date(2030, 1, 1),
    )

    with (
        patch(
            "app.orchestration.driver_service.create_driver_auth_user",
            new=AsyncMock(return_value=driver_uuid),
        ),
        patch("app.orchestration.driver_service.anchor_subject", new=anchor),
    ):
        await create_driver(db, org_id, data, user_id)

    anchor.assert_called_once()
    kwargs = anchor.call_args.kwargs
    assert kwargs["subject_type"] is SubjectType.DRIVER_EVENT
    assert kwargs["receipt_type"] is BlockchainReceiptType.DRIVER_CREATED

    payload = kwargs["canonical_payload"]
    payload_str = str(payload)
    # POPIA: no raw personal data may reach the chain.
    assert data.full_name not in payload_str
    assert data.id_number not in payload_str
    assert data.phone_number not in payload_str
    assert data.license_number not in payload_str
    # Only the SHA-256 of the licence number is permitted, and it must be present.
    expected_hash = hashlib.sha256(data.license_number.encode("utf-8")).hexdigest()
    fields = payload["fields"]
    assert "license_number" not in fields
    assert fields["license_number_sha256"] == expected_hash


# ── G1.2: cosmetic update records an event but does NOT anchor ───────────────────

async def test_update_driver_cosmetic_does_not_anchor_but_records_event() -> None:
    driver = _make_driver()
    db = _mock_db(scalar_result=driver)
    anchor = _anchor_stub()
    data = DriverUpdateBody(full_name="Renamed Driver")

    with patch("app.orchestration.driver_service.anchor_subject", new=anchor):
        await update_driver(db, driver.id, driver.organization_id, data, uuid.uuid4())

    anchor.assert_not_called()
    assert driver.full_name == "Renamed Driver"
    event = _first_of_type(db, DriverEvent)
    assert event.event_type == DriverEventType.COSMETIC_UPDATE.value
    # No critical change → the fallback diff is persisted (real service behaviour).
    assert event.changed_fields == {
        "_no_critical_change": True,
        "_patch": {"full_name": "Renamed Driver"},
    }


# ── G1.3: critical update anchors, payload carries ONLY the critical diff ────────

async def test_update_driver_critical_anchors_only_the_diff() -> None:
    old_license = "DRV-OLD-001"
    new_license = "DRV-NEW-002"
    driver = _make_driver(license_number=old_license)
    db = _mock_db(scalar_result=driver)
    anchor = _anchor_stub()
    data = DriverUpdateBody(license_number=new_license)

    with patch("app.orchestration.driver_service.anchor_subject", new=anchor):
        await update_driver(db, driver.id, driver.organization_id, data, uuid.uuid4())

    anchor.assert_called_once()
    kwargs = anchor.call_args.kwargs
    assert kwargs["subject_type"] is SubjectType.DRIVER_EVENT
    assert kwargs["receipt_type"] is BlockchainReceiptType.DRIVER_UPDATED

    payload = kwargs["canonical_payload"]
    # Plaintext licence numbers must never appear — only the hashed diff.
    assert old_license not in str(payload)
    assert new_license not in str(payload)
    assert payload["fields"] == {
        "license_number_sha256": {
            "from": hashlib.sha256(old_license.encode("utf-8")).hexdigest(),
            "to": hashlib.sha256(new_license.encode("utf-8")).hexdigest(),
        }
    }
    event = _first_of_type(db, DriverEvent)
    assert event.event_type == DriverEventType.LICENSE_RENEWED.value


# ── G1.4: unknown id raises ResourceNotFoundError ───────────────────────────────

async def test_update_driver_unknown_id_raises_not_found() -> None:
    db = _mock_db(scalar_result=None)
    anchor = _anchor_stub()

    with patch("app.orchestration.driver_service.anchor_subject", new=anchor):
        with pytest.raises(ResourceNotFoundError):
            await update_driver(
                db, uuid.uuid4(), uuid.uuid4(), DriverUpdateBody(full_name="X"), uuid.uuid4()
            )

    anchor.assert_not_called()


# ── G1.5: unique violation on create raises DuplicateResourceError ──────────────

async def test_create_driver_duplicate_raises_duplicate_resource() -> None:
    db = _mock_db()
    db.flush = AsyncMock(side_effect=IntegrityError("INSERT", {}, _FakeUniqueViolation()))
    anchor = _anchor_stub()
    data = DriverCreateBody(
        full_name="Dup Driver",
        id_number=_VALID_ID_NUMBER,
        phone_number="+27820000002",
        license_number="DRV-DUP-001",
    )

    with (
        patch(
            "app.orchestration.driver_service.create_driver_auth_user",
            new=AsyncMock(return_value=uuid.uuid4()),
        ),
        patch("app.orchestration.driver_service.anchor_subject", new=anchor),
    ):
        with pytest.raises(DuplicateResourceError):
            await create_driver(db, uuid.uuid4(), data, uuid.uuid4())

    anchor.assert_not_called()
