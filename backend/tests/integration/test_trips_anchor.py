"""Integration test: POST /api/v1/trips anchors to Hedera and returns a receipt.

Uses DEMO_MODE auth (Bearer demo) consistent with the rest of the integration suite.
HederaService is patched so no real network calls are made.
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import _DEMO_ORG_ID, _DEMO_USER_ID
from app.blockchain.hedera import HederaReceipt
from app.db.models.enums import IdvsStatus, OrganizationType, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
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


@pytest_asyncio.fixture
async def seed_trip_data(db_session: AsyncSession, seed_org) -> dict:
    """Insert the minimal rows required by POST /trips and yield their IDs."""
    client_org = Organization(
        id=uuid.uuid4(),
        name="Demo Client",
        org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add(client_org)
    await db_session.flush()

    origin = Precinct(
        id=uuid.uuid4(),
        name="Cape Town Depot",
        principal_organization_id=client_org.id,
        latitude="33.9249",
        longitude="18.4241",
    )
    destination = Precinct(
        id=uuid.uuid4(),
        name="Johannesburg Depot",
        principal_organization_id=client_org.id,
        latitude="26.2041",
        longitude="28.0473",
    )
    db_session.add_all([origin, destination])
    await db_session.flush()

    driver = Driver(
        id=uuid.uuid4(),
        organization_id=_DEMO_ORG_ID,
        full_name="Anchor Test Driver",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-ANC-001",
        idvs_status=IdvsStatus.PENDING,
    )
    horse = Vehicle(
        id=uuid.uuid4(),
        organization_id=_DEMO_ORG_ID,
        registration="WC ANC-001",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-ANC-HORSE",
    )
    trailer = Vehicle(
        id=uuid.uuid4(),
        organization_id=_DEMO_ORG_ID,
        registration="WC ANC-002",
        vehicle_type=VehicleType.TRAILER,
        pulsit_device_id="PLT-ANC-TRAILER",
    )
    db_session.add_all([driver, horse, trailer])
    await db_session.flush()

    return {
        "client_org_id": client_org.id,
        "origin_id": origin.id,
        "destination_id": destination.id,
        "driver_id": driver.id,
        "horse_id": horse.id,
        "trailer_id": trailer.id,
    }


def _make_trip_payload(seed: dict) -> dict:
    """Build a valid POST /trips request body from seeded IDs."""
    return {
        "order_number": "ORD-ANC-001",
        "client_organization_id": str(seed["client_org_id"]),
        "driver_id": str(seed["driver_id"]),
        "horse_id": str(seed["horse_id"]),
        "trailer_ids": [str(seed["trailer_id"])],
        "origin_precinct_id": str(seed["origin_id"]),
        "destination_precinct_id": str(seed["destination_id"]),
    }


# ── Test ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_trip_writes_blockchain_receipt(db_session: AsyncSession, seed_trip_data: dict) -> None:
    """POST /trips → BlockchainReceipt in response with subject_type=trip + matching hash."""
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=42,
        consensus_timestamp=None,
        transaction_id="0.0.12345@1715865600.0",
    )

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        instance = MagicMock()
        instance.submit_hash.return_value = fake_receipt
        MockService.return_value = instance

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/trips",
                json=_make_trip_payload(seed_trip_data),
                headers={"Authorization": "Bearer demo"},
            )

    assert resp.status_code == 201
    body = resp.json()

    # A receipt must have been persisted and returned in the response body.
    assert len(body["blockchain_receipts"]) == 1
    receipt = body["blockchain_receipts"][0]

    # The receipt must be typed as a trip-level anchor.
    assert receipt["subject_type"] == "trip"
    assert receipt["receipt_type"] == "journey_lock"

    # The Hedera sequence number from the fake receipt must pass through.
    assert receipt["hedera_sequence_number"] == 42

    # The anchored hash must match the journey_lock_hash in the response —
    # the blockchain and the DB must record identical values.
    assert receipt["data_hash"] == body["journey_lock_hash"]
