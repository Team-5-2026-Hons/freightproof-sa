"""Integration test: POST /api/v1/drivers anchors to Hedera (POPIA-safe payload).

Critical POPIA constraint: personal data (full_name, id_number, phone_number,
license_number) must never appear in the anchored payload_json. Only the
SHA-256 hash of the license_number is permitted on-chain.

Uses DEMO_MODE auth (Bearer demo) consistent with the rest of the integration suite.
HederaService and create_driver_auth_user are patched so no real network calls are made.
"""

import hashlib
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

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
async def test_create_driver_does_not_anchor_pii(db_session: AsyncSession, seed_org) -> None:
    """Critical POPIA test: no PII appears in the anchored payload_json."""
    driver_payload = {
        "full_name": "Thabo Anchor Nkosi",
        "id_number": "9001015009081",
        "phone_number": "+27820000001",
        "license_number": "DRV-ANC-DRV",
    }
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=44,
        consensus_timestamp=None,
        transaction_id="0.0.12345@1715865602.0",
    )
    # create_driver calls create_driver_auth_user (Supabase Admin API) before
    # inserting the Driver row. Patch it to return a stable UUID so no real
    # HTTP request is made and the FK constraint is satisfied.
    fake_driver_id = uuid.uuid4()

    with (
        patch(
            "app.orchestration.resource_service.create_driver_auth_user",
            new_callable=AsyncMock,
            return_value=fake_driver_id,
        ),
        patch("app.blockchain.anchor_service.HederaService") as MockService,
    ):
        MockService.return_value.submit_hash.return_value = fake_receipt

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/drivers",
                json=driver_payload,
                headers={"Authorization": "Bearer demo"},
            )
            assert resp.status_code == 201
            driver = resp.json()

            detail_resp = await client.get(
                f"/api/v1/drivers/{driver['id']}",
                headers={"Authorization": "Bearer demo"},
            )

    assert detail_resp.status_code == 200
    body = detail_resp.json()

    # Serialise every receipt field to a single string for a broad PII scan.
    receipts_str = str(body["receipts"])

    # PII must NOT appear anywhere in the anchored receipt payload.
    assert driver_payload["full_name"] not in receipts_str, (
        "full_name found in blockchain receipt — POPIA violation"
    )
    assert driver_payload["id_number"] not in receipts_str, (
        "id_number found in blockchain receipt — POPIA violation"
    )
    assert driver_payload["phone_number"] not in receipts_str, (
        "phone_number found in blockchain receipt — POPIA violation"
    )
    assert driver_payload["license_number"] not in receipts_str, (
        "license_number found in blockchain receipt — POPIA violation"
    )

    # The SHA-256 hash of the license_number IS permitted and must be present —
    # this confirms that the anchor did record a meaningful, verifiable field.
    expected_hash = hashlib.sha256(
        driver_payload["license_number"].encode()
    ).hexdigest()
    assert expected_hash in receipts_str, (
        "license_number SHA-256 hash not found in blockchain receipt"
    )
