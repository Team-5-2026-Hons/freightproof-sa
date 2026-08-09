"""Integration test: POST /api/v1/trips anchors to Hedera and returns a receipt.

Uses a real signed JWT via the shared `client` fixture (see tests/conftest.py).
HederaService is patched so no real network calls are made.
"""

import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaReceipt
from app.db.models.enums import IdvsStatus, OrganizationType, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
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
async def seed_org(db_session: AsyncSession) -> dict:
    """Insert the operator org and a dispatcher user in that org."""
    operator_org = Organization(
        id=uuid.uuid4(),
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add(operator_org)
    await db_session.flush()

    user = User(
        id=uuid.uuid4(),
        organization_id=operator_org.id,
        email="demo-dispatcher@freightproof.co.za",
        full_name="Demo Dispatcher",
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()

    return {"org": operator_org, "user": user}


@pytest_asyncio.fixture
async def seed_trip_data(db_session: AsyncSession, seed_org: dict) -> dict:
    """Insert the minimal rows required by POST /trips and yield their IDs."""
    operator_org = seed_org["org"]
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
        organization_id=operator_org.id,
        full_name="Anchor Test Driver",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-ANC-001",
        idvs_status=IdvsStatus.PENDING,
    )
    horse = Vehicle(
        id=uuid.uuid4(),
        organization_id=operator_org.id,
        registration="WC ANC-001",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-ANC-HORSE",
    )
    trailer = Vehicle(
        id=uuid.uuid4(),
        organization_id=operator_org.id,
        registration="WC ANC-002",
        vehicle_type=VehicleType.TRAILER,
        pulsit_device_id="PLT-ANC-TRAILER",
    )
    db_session.add_all([driver, horse, trailer])
    await db_session.flush()

    return {
        "org": operator_org,
        "user": seed_org["user"],
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
        "driver_id": str(seed["driver_id"]),
        "horse_id": str(seed["horse_id"]),
        "trailer_ids": [str(seed["trailer_id"])],
        "origin_precinct_id": str(seed["origin_id"]),
        "destination_precinct_id": str(seed["destination_id"]),
        # Required: a trip with no schedule (neither this nor a stop slot_time)
        # can never pass phase_service._reject_if_not_due (see TripCreateRequest
        # .validate_request).
        "planned_departure_at": datetime.now(UTC).isoformat(),
        "consignments": [{"pp_reference": "MOCKWAY001", "unit_count_expected": 2}],
    }


def _auth_headers(seed: dict) -> dict:
    return auth_header(
        make_token(sub=str(seed["user"].id), role="dispatcher", org_id=str(seed["org"].id))
    )


# ── Test ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_trip_writes_blockchain_receipt(
    client: AsyncClient, db_session: AsyncSession, seed_trip_data: dict
) -> None:
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

        resp = await client.post(
            "/api/v1/trips",
            json=_make_trip_payload(seed_trip_data),
            headers=_auth_headers(seed_trip_data),
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
