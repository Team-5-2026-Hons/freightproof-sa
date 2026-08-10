"""Integration test: POST /api/v1/drivers anchors to Hedera (POPIA-safe payload).

Critical POPIA constraint: personal data (full_name, id_number, phone_number,
license_number) must never appear in the anchored payload_json. Only the
SHA-256 hash of the license_number is permitted on-chain.

Uses signed JWTs (see tests/conftest.py) consistent with the rest of the
integration suite. HederaService and create_driver_auth_user are patched so
no real network calls are made.
"""

import hashlib
import uuid
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaReceipt
from app.core.exceptions import HederaServiceError, HederaTimeoutError
from app.db.models.enums import IdvsStatus, OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import Driver, User
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token


# ── DB override ───────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncGenerator[None, None]:
    """Wire every endpoint in this module to the rolled-back test session."""
    async def _get_db():
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


# ── Seed fixtures ─────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seed_org(db_session: AsyncSession):
    """Insert the operator org and dispatcher user required by auth."""
    operator_org = Organization(
        id=uuid.uuid4(),
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add(operator_org)
    await db_session.flush()

    dispatcher_user = User(
        id=uuid.uuid4(),
        organization_id=operator_org.id,
        email="demo-dispatcher@freightproof.co.za",
        full_name="Demo Dispatcher",
        is_active=True,
    )
    db_session.add(dispatcher_user)
    await db_session.flush()
    return operator_org, dispatcher_user


@pytest_asyncio.fixture
async def seed_driver(db_session: AsyncSession, seed_org) -> Driver:
    """Insert a driver directly (bypassing the anchored create-endpoint) for PATCH tests."""
    org, _user = seed_org
    driver = Driver(
        organization_id=org.id,
        full_name="Existing Driver",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-EXIST-001",
        idvs_status=IdvsStatus.PENDING,
    )
    db_session.add(driver)
    await db_session.flush()
    return driver


# ── Test ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_driver_does_not_anchor_pii(
    client: AsyncClient, db_session: AsyncSession, seed_org
) -> None:
    """Critical POPIA test: no PII appears in the anchored payload_json."""
    org, user = seed_org
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))
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
            "app.orchestration.driver_service.create_driver_auth_user",
            new_callable=AsyncMock,
            return_value=fake_driver_id,
        ),
        patch("app.blockchain.anchor_service.HederaService") as MockService,
    ):
        MockService.return_value.submit_hash.return_value = fake_receipt

        resp = await client.post(
            "/api/v1/drivers",
            json=driver_payload,
            headers=headers,
        )
        assert resp.status_code == 201
        driver = resp.json()

        detail_resp = await client.get(
            f"/api/v1/drivers/{driver['id']}",
            headers=headers,
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


# ── C1: Hedera failures map to 504/502, not a bare 500 ─────────────────────────
#
# create_driver/update_driver call anchor_subject() -> HederaService.submit_hash()
# synchronously inside the request. A stalled or rejecting Hedera call must not
# surface as an opaque 500 — the driver-pwa/dispatcher need to know whether a
# retry might help (504) or the anchor itself was rejected (502).

@pytest.mark.asyncio
async def test_create_driver_hedera_timeout_returns_504(
    client: AsyncClient, db_session: AsyncSession, seed_org
) -> None:
    org, user = seed_org
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))
    driver_payload = {
        "full_name": "Timeout Driver",
        "id_number": "9001015009082",
        "phone_number": "+27820000002",
        "license_number": "DRV-TIMEOUT-001",
    }
    fake_driver_id = uuid.uuid4()

    with (
        patch(
            "app.orchestration.driver_service.create_driver_auth_user",
            new_callable=AsyncMock,
            return_value=fake_driver_id,
        ),
        patch("app.blockchain.anchor_service.HederaService") as MockService,
    ):
        MockService.return_value.submit_hash.side_effect = HederaTimeoutError(
            "mirror node timed out"
        )

        resp = await client.post(
            "/api/v1/drivers",
            json=driver_payload,
            headers=headers,
        )

    assert resp.status_code == 504


@pytest.mark.asyncio
async def test_create_driver_hedera_service_error_returns_502(
    client: AsyncClient, db_session: AsyncSession, seed_org
) -> None:
    org, user = seed_org
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))
    driver_payload = {
        "full_name": "Service Error Driver",
        "id_number": "9001015009083",
        "phone_number": "+27820000003",
        "license_number": "DRV-SVCERR-001",
    }
    fake_driver_id = uuid.uuid4()

    with (
        patch(
            "app.orchestration.driver_service.create_driver_auth_user",
            new_callable=AsyncMock,
            return_value=fake_driver_id,
        ),
        patch("app.blockchain.anchor_service.HederaService") as MockService,
    ):
        MockService.return_value.submit_hash.side_effect = HederaServiceError("submit failed")

        resp = await client.post(
            "/api/v1/drivers",
            json=driver_payload,
            headers=headers,
        )

    assert resp.status_code == 502


@pytest.mark.asyncio
async def test_update_driver_hedera_timeout_returns_504(
    client: AsyncClient, db_session: AsyncSession, seed_org, seed_driver: Driver
) -> None:
    """is_active is a critical field — toggling it forces update_driver to anchor."""
    org, user = seed_org
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.side_effect = HederaTimeoutError(
            "mirror node timed out"
        )

        resp = await client.patch(
            f"/api/v1/drivers/{seed_driver.id}",
            json={"is_active": False},
            headers=headers,
        )

    assert resp.status_code == 504


@pytest.mark.asyncio
async def test_update_driver_hedera_service_error_returns_502(
    client: AsyncClient, db_session: AsyncSession, seed_org, seed_driver: Driver
) -> None:
    org, user = seed_org
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.side_effect = HederaServiceError("submit failed")

        resp = await client.patch(
            f"/api/v1/drivers/{seed_driver.id}",
            json={"is_active": False},
            headers=headers,
        )

    assert resp.status_code == 502
