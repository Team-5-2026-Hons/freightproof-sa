"""Pins the exact payload (and so the Hedera hash) fleet.vehicles anchors for a vehicle event.

Golden vectors, same rule as tests/baseline/test_b3_canonical_hashes.py: these bytes are what
was written to Hedera, so a change here means receipts already anchored stop verifying.
Never "update the expected value" without explaining how old receipts stay valid.

The real create_vehicle / update_vehicle run against the test DB; only the variable parts of
the anchored payload (event id, vehicle id, actor, timestamp) are replaced with constants
before hashing, because the DB generates them. Everything else is as production anchors it.
"""

import uuid
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import OrganizationType, VehicleType
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.models.vehicles import Vehicle
from app.orchestration.fleet.vehicles import create_vehicle, update_vehicle
from app.schemas.vehicles import VehicleCreateBody, VehicleUpdateBody

EVENT_ID = "11111111-1111-4111-8111-111111111111"
VEHICLE_ID = "22222222-2222-4222-8222-222222222222"
USER_ID = "33333333-3333-4333-8333-333333333333"
TIMESTAMP = "2026-01-01T00:00:00+00:00"

CREATE_HASH = "984ac1a00cc661c54d3af8b5b62bbdf2f348e6fc50e7fa5bd0bbff5630f798d5"
CREATE_EMPTY_HASH = "dc8d8abef0ac75e38c23804e94f5944283968cbe533dda0b9a5a9d043394364d"
UPDATE_DEVICE_HASH = "d6fedcccd654e3540baabcef88c501b7cadfe2ecd1a5f6edad298605bd0ec0dd"
UPDATE_MIXED_HASH = "f9ebfebdd57e97de5605881320a38a9b807569d20e7d96005591f12272c20fe9"


async def _seed(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    org = Organization(id=uuid.uuid4(), name="Pin Operator", org_type=OrganizationType.OPERATOR)
    db.add(org)
    await db.flush()
    user = User(
        id=uuid.uuid4(), organization_id=org.id, email=f"pin-{uuid.uuid4()}@test.co.za",
        full_name="Pin User", is_active=True,
    )
    db.add(user)
    await db.flush()
    return org.id, user.id


def _capturing_anchor(captured: list[dict[str, Any]]):
    async def _anchor(db, *, subject_type, subject_id, canonical_payload, receipt_type, **_kw):
        captured.append(dict(canonical_payload))
        receipt = BlockchainReceipt(
            id=uuid.uuid4(), subject_type=subject_type, subject_id=subject_id,
            receipt_type=receipt_type, payload_json=canonical_payload,
            data_hash=compute_payload_hash(canonical_payload),
            hedera_topic_id="0.0.999999", hedera_sequence_number=1,
        )
        db.add(receipt)
        await db.flush()
        return receipt
    return _anchor


def _pinned(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        **payload, "vehicle_event_id": EVENT_ID, "vehicle_id": VEHICLE_ID,
        "changed_by_user_id": USER_ID, "timestamp": TIMESTAMP,
    }


async def _anchored_by_create(db: AsyncSession, monkeypatch, device_id: str) -> dict[str, Any]:
    org_id, user_id = await _seed(db)
    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(
        "app.orchestration.fleet.vehicles.anchor_subject", _capturing_anchor(captured),
    )
    body = VehicleCreateBody.model_construct(
        registration="CA 100-100", vehicle_type=VehicleType.HORSE, pulsit_device_id=device_id,
        make="Volvo", model=None, year=2018, vin_number=None, licence_disc_expiry=None,
        gross_vehicle_mass_kg=None, length_m=None,
    )
    await create_vehicle(db, org_id, body, user_id)
    return _pinned(captured[0])


async def _anchored_by_update(
    db: AsyncSession, monkeypatch, patch_fields: dict[str, Any],
) -> dict[str, Any]:
    org_id, user_id = await _seed(db)
    vehicle = Vehicle(
        organization_id=org_id, registration="CA 100-100", vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-PIN-OLD", make="Volvo", year=2018,
    )
    db.add(vehicle)
    await db.flush()
    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(
        "app.orchestration.fleet.vehicles.anchor_subject", _capturing_anchor(captured),
    )
    await update_vehicle(
        db, vehicle.id, org_id, VehicleUpdateBody.model_validate(patch_fields), user_id,
    )
    return _pinned(captured[0])


@pytest.mark.asyncio
async def test_create_vehicle_anchor_payload_hash_is_pinned(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = await _anchored_by_create(db_session, monkeypatch, "PLT-PIN-001")

    assert compute_payload_hash(payload) == CREATE_HASH


@pytest.mark.asyncio
async def test_create_vehicle_with_empty_device_id_anchor_payload_hash_is_pinned(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = await _anchored_by_create(db_session, monkeypatch, "")

    assert compute_payload_hash(payload) == CREATE_EMPTY_HASH


@pytest.mark.asyncio
async def test_update_vehicle_device_id_anchor_payload_hash_is_pinned(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = await _anchored_by_update(
        db_session, monkeypatch, {"pulsit_device_id": "PLT-PIN-NEW"},
    )

    assert compute_payload_hash(payload) == UPDATE_DEVICE_HASH


@pytest.mark.asyncio
async def test_update_vehicle_critical_plus_cosmetic_anchor_payload_hash_is_pinned(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The cosmetic `make` change is logged but must not appear in the anchored payload."""
    payload = await _anchored_by_update(
        db_session, monkeypatch, {"registration": "CA 100-200", "make": "Scania"},
    )

    assert compute_payload_hash(payload) == UPDATE_MIXED_HASH
