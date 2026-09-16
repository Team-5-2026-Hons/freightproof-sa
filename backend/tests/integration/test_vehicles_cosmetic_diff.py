"""Integration tests: PATCH /api/v1/vehicles/{id} records a real before/after
diff for cosmetic (non-critical) fields, and keeps cosmetic-only edits unanchored.

Uses signed JWTs (see tests/conftest.py) consistent with the rest of the
integration suite. HederaService is patched so no real network calls are made.
"""

import uuid
from collections.abc import AsyncGenerator
from unittest.mock import patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaReceipt
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import OrganizationType, SubjectType, VehicleType
from app.db.models.events import VehicleEvent
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token

# A structurally valid VIN: exactly 17 alphanumerics, per _VIN_PATTERN in
# app/schemas/vehicles.py. Named rather than inlined because the test below asserts on it
# twice — as the value sent and as the value recorded in the diff — and the two drifting
# apart would be a confusing failure. The previous literal was 15 characters, which the
# schema had started rejecting with a 422 before this test ever reached the anchoring
# behaviour it exists to check.
_VALID_VIN = "GH698HF7X09009901"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncGenerator[None, None]:
    async def _get_db():
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_vehicle(db_session: AsyncSession):
    org = Organization(
        id=uuid.uuid4(),
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add(org)
    await db_session.flush()

    user = User(
        id=uuid.uuid4(),
        organization_id=org.id,
        email="demo-dispatcher@freightproof.co.za",
        full_name="Demo Dispatcher",
        is_active=True,
    )
    db_session.add(user)

    vehicle = Vehicle(
        organization_id=org.id,
        registration="CA 111-222",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-COSMETIC-001",
        make="Volvo",
        year=2018,
    )
    db_session.add(vehicle)
    await db_session.flush()
    return org, user, vehicle


async def test_cosmetic_only_patch_records_from_to_diff_and_skips_anchor(
    client: AsyncClient, db_session: AsyncSession, seed_vehicle,
) -> None:
    """Changing only `make` must produce a real {from, to} diff and no BlockchainReceipt."""
    org, user, vehicle = seed_vehicle
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))

    resp = await client.patch(
        f"/api/v1/vehicles/{vehicle.id}",
        json={"make": "Scania"},
        headers=headers,
    )
    assert resp.status_code == 200

    event = (
        await db_session.execute(
            select(VehicleEvent).where(VehicleEvent.vehicle_id == vehicle.id)
        )
    ).scalar_one()
    assert event.event_type == "cosmetic_update"
    assert event.changed_fields == {"make": {"from": "Volvo", "to": "Scania"}}
    assert event.blockchain_receipt_id is None

    receipts = (
        await db_session.execute(
            select(BlockchainReceipt).where(
                BlockchainReceipt.subject_type == SubjectType.VEHICLE_EVENT,
                BlockchainReceipt.subject_id == event.id,
            )
        )
    ).scalars().all()
    assert receipts == []


async def test_mixed_patch_anchors_only_critical_field(
    client: AsyncClient, db_session: AsyncSession, seed_vehicle,
) -> None:
    """Changing a critical field (vin_number) and a cosmetic field (make) together:
    changed_fields carries both, but the anchored payload carries only the critical one.
    """
    org, user, vehicle = seed_vehicle
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=99,
        consensus_timestamp=None,
        transaction_id="0.0.12345@1715865603.0",
    )

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = fake_receipt

        resp = await client.patch(
            f"/api/v1/vehicles/{vehicle.id}",
            json={"vin_number": _VALID_VIN, "make": "Scania"},
            headers=headers,
        )
    assert resp.status_code == 200

    event = (
        await db_session.execute(
            select(VehicleEvent).where(VehicleEvent.vehicle_id == vehicle.id)
        )
    ).scalar_one()
    assert event.changed_fields == {
        "vin_number": {"from": None, "to": _VALID_VIN},
        "make": {"from": "Volvo", "to": "Scania"},
    }
    assert event.blockchain_receipt_id is not None

    receipt = (
        await db_session.execute(
            select(BlockchainReceipt).where(BlockchainReceipt.id == event.blockchain_receipt_id)
        )
    ).scalar_one()
    fields = receipt.payload_json["fields"]
    assert "vin_number" in fields
    assert "make" not in fields
