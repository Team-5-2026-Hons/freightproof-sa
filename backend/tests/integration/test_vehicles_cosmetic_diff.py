"""Integration tests: PATCH /api/v1/vehicles/{id} records a real before/after
diff for cosmetic (non-critical) fields, and keeps cosmetic-only edits unanchored.

Uses DEMO_MODE auth (Bearer demo) consistent with the rest of the integration suite.
HederaService is patched so no real network calls are made.
"""

from unittest.mock import patch

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import _DEMO_ORG_ID, _DEMO_USER_ID
from app.blockchain.hedera import HederaReceipt
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import OrganizationType, SubjectType, VehicleType
from app.db.models.events import VehicleEvent
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> None:
    async def _get_db():
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_vehicle(db_session: AsyncSession) -> Vehicle:
    org = Organization(
        id=_DEMO_ORG_ID,
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add(org)
    await db_session.flush()

    user = User(
        id=_DEMO_USER_ID,
        organization_id=_DEMO_ORG_ID,
        email="demo-dispatcher@freightproof.co.za",
        full_name="Demo Dispatcher",
        is_active=True,
    )
    db_session.add(user)

    vehicle = Vehicle(
        organization_id=_DEMO_ORG_ID,
        registration="CA 111-222",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-COSMETIC-001",
        make="Volvo",
        year=2018,
    )
    db_session.add(vehicle)
    await db_session.flush()
    return vehicle


async def test_cosmetic_only_patch_records_from_to_diff_and_skips_anchor(
    db_session: AsyncSession, seed_vehicle: Vehicle,
) -> None:
    """Changing only `make` must produce a real {from, to} diff and no BlockchainReceipt."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.patch(
            f"/api/v1/vehicles/{seed_vehicle.id}",
            json={"make": "Scania"},
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 200

    event = (
        await db_session.execute(
            select(VehicleEvent).where(VehicleEvent.vehicle_id == seed_vehicle.id)
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
    db_session: AsyncSession, seed_vehicle: Vehicle,
) -> None:
    """Changing a critical field (vin_number) and a cosmetic field (make) together:
    changed_fields carries both, but the anchored payload carries only the critical one.
    """
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=99,
        consensus_timestamp=None,
        transaction_id="0.0.12345@1715865603.0",
    )

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = fake_receipt

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.patch(
                f"/api/v1/vehicles/{seed_vehicle.id}",
                json={"vin_number": "GH698HF7X090099", "make": "Scania"},
                headers={"Authorization": "Bearer demo"},
            )
    assert resp.status_code == 200

    event = (
        await db_session.execute(
            select(VehicleEvent).where(VehicleEvent.vehicle_id == seed_vehicle.id)
        )
    ).scalar_one()
    assert event.changed_fields == {
        "vin_number": {"from": None, "to": "GH698HF7X090099"},
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
