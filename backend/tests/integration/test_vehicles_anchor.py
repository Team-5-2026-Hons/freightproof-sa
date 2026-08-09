"""Integration test: POST /api/v1/vehicles anchors to Hedera and creates a VehicleEvent.

Uses signed JWTs (see tests/conftest.py) consistent with the rest of the
integration suite. HederaService is patched so no real network calls are made.
"""

import uuid
from collections.abc import AsyncGenerator
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaReceipt
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import User
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


# ── Test ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_vehicle_writes_event_and_anchor(
    client: AsyncClient, db_session: AsyncSession, seed_org
) -> None:
    """POST /vehicles → VehicleEvent created + BlockchainReceipt on detail endpoint."""
    org, user = seed_org
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))
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

        resp = await client.post(
            "/api/v1/vehicles",
            json=vehicle_payload,
            headers=headers,
        )
        assert resp.status_code == 201
        vehicle = resp.json()

        detail_resp = await client.get(
            f"/api/v1/vehicles/{vehicle['id']}",
            headers=headers,
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


@pytest.mark.asyncio
async def test_create_trailer_persists_length_and_gvm(
    client: AsyncClient, db_session: AsyncSession, seed_org
) -> None:
    """length_m and gross_vehicle_mass_kg must survive creation on the Vehicle row
    and appear in the CREATED event's changed_fields snapshot — both were previously
    silently dropped (length_m was missing from the Vehicle() constructor; both were
    missing from the snapshot dict used for the audit-trail event).
    """
    org, user = seed_org
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))
    trailer_payload = {
        "registration": "WC TRL-LEN-001",
        "vehicle_type": "trailer",
        "pulsit_device_id": "PLT-TRL-LEN-001",
        "gross_vehicle_mass_kg": 34000,
        "length_m": 12,
    }
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=45,
        consensus_timestamp=None,
        transaction_id="0.0.12345@1715865604.0",
    )

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = fake_receipt

        resp = await client.post(
            "/api/v1/vehicles",
            json=trailer_payload,
            headers=headers,
        )
        assert resp.status_code == 201
        vehicle = resp.json()

        detail_resp = await client.get(
            f"/api/v1/vehicles/{vehicle['id']}",
            headers=headers,
        )

    assert detail_resp.status_code == 200
    body = detail_resp.json()

    assert vehicle["length_m"] == 12
    assert vehicle["gross_vehicle_mass_kg"] == 34000

    created_event = body["events"][0]
    assert created_event["event_type"] == "created"
    assert created_event["changed_fields"]["length_m"] == 12
    assert created_event["changed_fields"]["gross_vehicle_mass_kg"] == 34000


@pytest.mark.asyncio
async def test_create_vehicle_payload_json_hashes_pulsit_device_id(
    client: AsyncClient, db_session: AsyncSession, seed_org,
) -> None:
    """SEC-5: GPS device ID must be hashed in payload_json, never stored in plaintext."""
    from sqlalchemy import select
    from app.db.models.blockchain import BlockchainReceipt
    from app.db.models.enums import SubjectType

    org, user = seed_org
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))
    secret_id = "SECRET-TRACKER-001"
    vehicle_payload = {
        "registration": "CA 999 XYZ",
        "vehicle_type": "horse",
        "pulsit_device_id": secret_id,
    }
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=44,
        consensus_timestamp=None,
        transaction_id="0.0.12345@1715865602.0",
    )

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = fake_receipt
        resp = await client.post(
            "/api/v1/vehicles",
            json=vehicle_payload,
            headers=headers,
        )
        assert resp.status_code == 201

    receipt = (
        await db_session.execute(
            select(BlockchainReceipt).where(
                BlockchainReceipt.subject_type == SubjectType.VEHICLE_EVENT
            )
        )
    ).scalars().first()
    assert receipt is not None
    fields = receipt.payload_json.get("fields", {})
    assert "pulsit_device_id" not in fields, "plaintext pulsit_device_id must not be in payload_json"
    assert "pulsit_device_id_sha256" in fields, "hash of pulsit_device_id must be present"
    assert fields["pulsit_device_id_sha256"] != secret_id
