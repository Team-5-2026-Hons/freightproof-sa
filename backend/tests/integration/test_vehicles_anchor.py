"""Integration test: POST /api/v1/vehicles anchors to Hedera and creates a VehicleEvent.

Uses DEMO_MODE auth (Bearer demo) consistent with the rest of the integration suite.
HederaService is patched so no real network calls are made.
"""

from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import _DEMO_ORG_ID, _DEMO_USER_ID
from app.blockchain.hedera import HederaReceipt
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.session import get_db
from app.main import app


# ── DB override ───────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> None:
    """Wire every endpoint in this module to the rolled-back test session."""
    async def _get_db():
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


# ── Seed fixtures ─────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seed_org(db_session: AsyncSession) -> None:
    """Insert the operator org and demo user required by DEMO_MODE auth."""
    operator_org = Organization(
        id=_DEMO_ORG_ID,
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add(operator_org)
    await db_session.flush()

    demo_user = User(
        id=_DEMO_USER_ID,
        organization_id=_DEMO_ORG_ID,
        email="demo-dispatcher@freightproof.co.za",
        full_name="Demo Dispatcher",
        is_active=True,
    )
    db_session.add(demo_user)
    await db_session.flush()


# ── Test ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_vehicle_writes_event_and_anchor(db_session: AsyncSession, seed_org) -> None:
    """POST /vehicles → VehicleEvent created + BlockchainReceipt on detail endpoint."""
    vehicle_payload = {
        "registration": "WC VEH-ANC-001",
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-VEH-ANC-001",
    }
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=43,
        consensus_timestamp=None,
        transaction_id="0.0.12345@1715865601.0",
    )

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = fake_receipt

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/vehicles",
                json=vehicle_payload,
                headers={"Authorization": "Bearer demo"},
            )
            assert resp.status_code == 201
            vehicle = resp.json()

            detail_resp = await client.get(
                f"/api/v1/vehicles/{vehicle['id']}",
                headers={"Authorization": "Bearer demo"},
            )

    assert detail_resp.status_code == 200
    body = detail_resp.json()

    # A VehicleEvent of type "created" must exist on the detail record.
    assert len(body["events"]) == 1
    assert body["events"][0]["event_type"] == "created"

    # The VehicleEvent must have a corresponding BlockchainReceipt anchored
    # against the vehicle_event subject type (not the vehicle itself).
    assert len(body["receipts"]) == 1
    assert body["receipts"][0]["subject_type"] == "vehicle_event"
