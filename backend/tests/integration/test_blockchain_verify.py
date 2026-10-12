"""Integration tests: POST /api/v1/blockchain/verify covers all four VerifyStatus paths.

Covers:
  no_receipt  — a subject the caller CAN see that has never been anchored
  404         — a subject the caller cannot see, whether or not it exists at all
  verified    — anchored trip whose DB hash matches and whose Hedera hash confirms

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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.blockchain.hedera import HederaReceipt
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, IdvsStatus, OrganizationType, SubjectType, TripStatus,
    VehicleEventType, VehicleType, VerifyStatus,
)
from app.db.models.events import VehicleEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app
from app.orchestration.fleet.vehicles import create_vehicle, update_vehicle
from app.orchestration.verification_service import verify_subject
from app.schemas.vehicles import VehicleCreateBody, VehicleUpdateBody

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
        name="Verify Client",
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
        full_name="Verify Test Driver",
        id_number="8001015009087",
        phone_number="+27821111111",
        license_number="DRV-VFY-001",
        idvs_status=IdvsStatus.PENDING,
    )
    horse = Vehicle(
        id=uuid.uuid4(),
        organization_id=operator_org.id,
        registration="WC VFY-001",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-VFY-HORSE",
    )
    trailer = Vehicle(
        id=uuid.uuid4(),
        organization_id=operator_org.id,
        registration="WC VFY-002",
        vehicle_type=VehicleType.TRAILER,
        pulsit_device_id="PLT-VFY-TRAILER",
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
        "order_number": "ORD-VFY-001",
        "driver_id": str(seed["driver_id"]),
        "horse_id": str(seed["horse_id"]),
        "trailer_ids": [str(seed["trailer_id"])],
        "origin_precinct_id": str(seed["origin_id"]),
        "destination_precinct_id": str(seed["destination_id"]),
        # Required: a trip with no schedule (neither this nor a stop slot_time)
        # can never pass phases.scheduling._reject_if_not_due (see TripCreateRequest
        # .validate_request).
        "planned_departure_at": datetime.now(UTC).isoformat(),
        "consignments": [{"pp_reference": "MOCKWAY001", "unit_count_expected": 2}],
    }


def _auth_headers(seed: dict) -> dict:
    return auth_header(
        make_token(sub=str(seed["user"].id), role="dispatcher", org_id=str(seed["org"].id))
    )


# ── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_verify_returns_no_receipt_for_a_visible_unanchored_subject(
    client: AsyncClient, db_session: AsyncSession, seed_trip_data: dict
) -> None:
    """A trip the caller can see, that has never been anchored → 200 no_receipt.

    Inserted straight into the DB rather than created over HTTP, because POST /trips
    anchors as part of creation — and "never anchored" is the entire premise here.

    This test used to pass a random UUID and expect 200. It could not have worked: a
    subject that does not exist is refused at the visibility gate long before any receipt
    lookup, and deliberately so. The state it was reaching for is this one — visible,
    but with nothing on chain yet — which is the ordinary condition of a trip between
    creation and its first anchor, and what VerifyButton renders as "no receipt".
    """
    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-{uuid.uuid4().hex[:6]}",
        order_number="ORD-VFY-UNANCHORED",
        operator_organization_id=seed_trip_data["org"].id,
        driver_id=seed_trip_data["driver_id"],
        horse_id=seed_trip_data["horse_id"],
        status=TripStatus.ACTIVE,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=seed_trip_data["user"].id,
    )
    db_session.add(trip)
    await db_session.flush()

    resp = await client.post(
        "/api/v1/blockchain/verify",
        json={"subject_type": "trip", "subject_id": str(trip.id)},
        headers=_auth_headers(seed_trip_data),
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "no_receipt"


@pytest.mark.asyncio
async def test_verify_answers_identically_for_another_orgs_trip_and_for_nothing_at_all(
    client: AsyncClient, db_session: AsyncSession, seed_trip_data: dict
) -> None:
    """Both are 404, and they are the SAME 404 — that indistinguishability is the point.

    app/blockchain/subject_visibility.py exists so a dispatcher cannot learn anything
    about another operator's trips. If a non-existent id answered differently from a real
    id belonging to someone else, the endpoint would be an existence oracle: feed it UUIDs
    and the responses would sort the real ones from the invented ones. Asserting the two
    responses match is therefore the security property itself, not a detail of it.
    """
    other_org = Organization(
        id=uuid.uuid4(), name="Rival Operator", org_type=OrganizationType.OPERATOR,
    )
    db_session.add(other_org)
    await db_session.flush()
    someone_elses = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-{uuid.uuid4().hex[:6]}",
        order_number="ORD-VFY-RIVAL",
        operator_organization_id=other_org.id,
        driver_id=seed_trip_data["driver_id"],
        horse_id=seed_trip_data["horse_id"],
        status=TripStatus.ACTIVE,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=seed_trip_data["user"].id,
    )
    db_session.add(someone_elses)
    await db_session.flush()

    async def _verify(subject_id: uuid.UUID):
        return await client.post(
            "/api/v1/blockchain/verify",
            json={"subject_type": "trip", "subject_id": str(subject_id)},
            headers=_auth_headers(seed_trip_data),
        )

    real_but_hidden = await _verify(someone_elses.id)
    pure_fiction = await _verify(uuid.uuid4())

    assert real_but_hidden.status_code == 404
    assert pure_fiction.status_code == 404
    assert real_but_hidden.json() == pure_fiction.json()


@pytest.mark.asyncio
async def test_verify_returns_verified_for_anchored_trip(
    client: AsyncClient, db_session: AsyncSession, seed_trip_data: dict
) -> None:
    """Create a trip (anchored), then verify → verified.

    Two separate patches are required:
      1. app.blockchain.anchor_service.HederaService — used during POST /trips to submit the hash.
      2. app.orchestration.verification_service.HederaService — used during POST /verify
         to confirm the hash on the mirror node.
    """
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=50,
        consensus_timestamp=None,
        transaction_id="0.0.12345@1715865610.0",
    )

    # Step 1: create the trip with an anchored blockchain receipt.
    with patch("app.blockchain.anchor_service.HederaService") as MockCreate:
        MockCreate.return_value.submit_hash.return_value = fake_receipt

        create_resp = await client.post(
            "/api/v1/trips",
            json=_make_trip_payload(seed_trip_data),
            headers=_auth_headers(seed_trip_data),
        )

    assert create_resp.status_code == 201
    trip_id = create_resp.json()["id"]

    # Step 2: verify the trip — patch the verification-layer HederaService so
    # verify_hash returns True (simulating a matching mirror-node response).
    with patch("app.orchestration.verification_service.HederaService") as MockVerify:
        MockVerify.return_value.verify_hash.return_value = True

        verify_resp = await client.post(
            "/api/v1/blockchain/verify",
            json={"subject_type": "trip", "subject_id": trip_id},
            headers=_auth_headers(seed_trip_data),
        )

    assert verify_resp.status_code == 200
    assert verify_resp.json()["status"] == "verified"


# ── Vehicle event verification (device ID is hashed in the anchored payload) ──────────
#
# These run the REAL create_vehicle / update_vehicle so the receipt holds exactly what
# production anchors, then verify the event through verify_subject. fleet.vehicles hashes
# pulsit_device_id before anchoring while VehicleEvent.changed_fields keeps the plaintext,
# so the verifier must apply the same canonicalisation or every such event reads as tampered.

_FAKE_HEDERA_RECEIPT = HederaReceipt(
    topic_id="0.0.12345", sequence_number=50, consensus_timestamp=None,
    transaction_id="0.0.12345@1715865610.0",
)


def _hedera_match_stub() -> MagicMock:
    stub = MagicMock()
    stub.verify_hash.return_value = True
    return stub


async def _verify_vehicle_event(db: AsyncSession, event_id: uuid.UUID) -> VerifyStatus:
    outcome = await verify_subject(
        db, subject_type=SubjectType.VEHICLE_EVENT, subject_id=event_id,
        hedera_service=_hedera_match_stub(),
    )
    return outcome.status


async def _created_vehicle_event(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, *, device_id: str,
) -> tuple[uuid.UUID, VehicleEvent]:
    # model_construct: the schema (rightly) refuses an empty device ID, but the falsy branch
    # of the canonicalisation still has to be pinned.
    body = VehicleCreateBody.model_construct(
        registration=f"CA {uuid.uuid4().hex[:6]}", vehicle_type=VehicleType.HORSE,
        pulsit_device_id=device_id, make="Volvo", model=None, year=2018, vin_number=None,
        licence_disc_expiry=None, gross_vehicle_mass_kg=None, length_m=None,
    )
    with patch("app.blockchain.anchor_service.HederaService") as mock_hedera:
        mock_hedera.return_value.submit_hash.return_value = _FAKE_HEDERA_RECEIPT
        created = await create_vehicle(db, org_id, body, user_id)
    event = (
        await db.execute(select(VehicleEvent).where(VehicleEvent.vehicle_id == created.id))
    ).scalar_one()
    return created.id, event


async def _update_event(
    db: AsyncSession, vehicle_id: uuid.UUID, org_id: uuid.UUID, user_id: uuid.UUID,
    **patch_fields: object,
) -> VehicleEvent:
    with patch("app.blockchain.anchor_service.HederaService") as mock_hedera:
        mock_hedera.return_value.submit_hash.return_value = _FAKE_HEDERA_RECEIPT
        await update_vehicle(
            db, vehicle_id, org_id, VehicleUpdateBody.model_validate(patch_fields), user_id,
        )
    return (
        await db.execute(
            select(VehicleEvent)
            # created_at is the transaction's now(), identical for every row in a test, so
            # the update event is told apart by type rather than by recency.
            .where(
                VehicleEvent.vehicle_id == vehicle_id,
                VehicleEvent.event_type != VehicleEventType.CREATED.value,
            )
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_verify_vehicle_created_event_with_device_id_is_verified(
    db_session: AsyncSession, seed_org: dict
) -> None:
    _, event = await _created_vehicle_event(
        db_session, seed_org["org"].id, seed_org["user"].id, device_id="PLT-VFY-CREATE",
    )

    status = await _verify_vehicle_event(db_session, event.id)

    assert status == VerifyStatus.VERIFIED


@pytest.mark.asyncio
async def test_verify_vehicle_created_event_with_empty_device_id_is_verified(
    db_session: AsyncSession, seed_org: dict
) -> None:
    _, event = await _created_vehicle_event(
        db_session, seed_org["org"].id, seed_org["user"].id, device_id="",
    )

    status = await _verify_vehicle_event(db_session, event.id)

    assert status == VerifyStatus.VERIFIED


@pytest.mark.asyncio
async def test_verify_vehicle_update_changing_device_id_is_verified(
    db_session: AsyncSession, seed_org: dict
) -> None:
    vehicle_id, _ = await _created_vehicle_event(
        db_session, seed_org["org"].id, seed_org["user"].id, device_id="PLT-VFY-OLD",
    )

    event = await _update_event(
        db_session, vehicle_id, seed_org["org"].id, seed_org["user"].id,
        pulsit_device_id="PLT-VFY-NEW",
    )

    assert event.blockchain_receipt_id is not None
    assert await _verify_vehicle_event(db_session, event.id) == VerifyStatus.VERIFIED


@pytest.mark.asyncio
async def test_verify_vehicle_update_without_device_id_is_verified(
    db_session: AsyncSession, seed_org: dict
) -> None:
    vehicle_id, _ = await _created_vehicle_event(
        db_session, seed_org["org"].id, seed_org["user"].id, device_id="PLT-VFY-PLATE",
    )

    event = await _update_event(
        db_session, vehicle_id, seed_org["org"].id, seed_org["user"].id,
        registration="CA 999-001",
    )

    assert event.blockchain_receipt_id is not None
    assert await _verify_vehicle_event(db_session, event.id) == VerifyStatus.VERIFIED


@pytest.mark.asyncio
async def test_verify_vehicle_update_mixing_critical_and_cosmetic_fields_is_verified(
    db_session: AsyncSession, seed_org: dict
) -> None:
    """changed_fields logs the critical AND cosmetic diff; the anchor carries only the
    critical part. The verifier must reduce to the same subset or it reports tampering."""
    vehicle_id, _ = await _created_vehicle_event(
        db_session, seed_org["org"].id, seed_org["user"].id, device_id="PLT-VFY-MIX",
    )

    event = await _update_event(
        db_session, vehicle_id, seed_org["org"].id, seed_org["user"].id,
        registration="CA 999-002", make="Scania",
    )

    assert "make" in event.changed_fields
    assert await _verify_vehicle_event(db_session, event.id) == VerifyStatus.VERIFIED


@pytest.mark.asyncio
async def test_verify_vehicle_event_still_detects_a_tampered_row(
    db_session: AsyncSession, seed_org: dict
) -> None:
    vehicle_id, _ = await _created_vehicle_event(
        db_session, seed_org["org"].id, seed_org["user"].id, device_id="PLT-VFY-TAMPER-A",
    )
    event = await _update_event(
        db_session, vehicle_id, seed_org["org"].id, seed_org["user"].id,
        pulsit_device_id="PLT-VFY-TAMPER-B",
    )

    event.changed_fields = {"pulsit_device_id": {"from": "PLT-VFY-TAMPER-A", "to": "PLT-FORGED"}}
    await db_session.flush()

    assert await _verify_vehicle_event(db_session, event.id) == VerifyStatus.DB_MISMATCH


async def _legacy_plaintext_receipt(
    db: AsyncSession, seed: dict, *, event_type: VehicleEventType, changed_fields: dict,
) -> uuid.UUID:
    """A vehicle event plus a receipt anchored the way it was before b2348ff (June 2026):
    the device ID sits in payload_json in plaintext, and the receipt hashes that payload."""
    vehicle = Vehicle(
        organization_id=seed["org"].id, registration=f"CA {uuid.uuid4().hex[:6]}",
        vehicle_type=VehicleType.HORSE, pulsit_device_id=f"PLT-{uuid.uuid4().hex[:8]}",
    )
    db.add(vehicle)
    await db.flush()
    event = VehicleEvent(
        id=uuid.uuid4(), vehicle_id=vehicle.id, event_type=event_type.value,
        changed_fields=changed_fields, changed_by_user_id=seed["user"].id,
    )
    db.add(event)
    await db.flush()
    payload = {
        "vehicle_event_id": str(event.id),
        "vehicle_id": str(vehicle.id),
        "event_type": event.event_type,
        "fields": changed_fields,
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }
    receipt = BlockchainReceipt(
        id=uuid.uuid4(), subject_type=SubjectType.VEHICLE_EVENT, subject_id=event.id,
        receipt_type=BlockchainReceiptType.VEHICLE_UPDATED, payload_json=payload,
        data_hash=compute_payload_hash(payload),
        hedera_topic_id="0.0.12345", hedera_sequence_number=50,
    )
    db.add(receipt)
    await db.flush()
    return event.id


@pytest.mark.asyncio
async def test_verify_vehicle_event_anchored_with_plaintext_device_id_is_verified(
    db_session: AsyncSession, seed_org: dict
) -> None:
    """Receipts from before the device ID was hashed hold it in plaintext and must keep
    verifying — the shape of the anchored payload, not the date, selects the rule."""
    created = await _legacy_plaintext_receipt(
        db_session, seed_org, event_type=VehicleEventType.CREATED,
        changed_fields={"registration": "CA 123-456", "pulsit_device_id": "PLT-LEGACY-1"},
    )
    updated = await _legacy_plaintext_receipt(
        db_session, seed_org, event_type=VehicleEventType.VEHICLE_UPDATED,
        changed_fields={"pulsit_device_id": {"from": "PLT-LEGACY-1", "to": "PLT-LEGACY-2"}},
    )

    assert await _verify_vehicle_event(db_session, created) == VerifyStatus.VERIFIED
    assert await _verify_vehicle_event(db_session, updated) == VerifyStatus.VERIFIED


@pytest.mark.asyncio
async def test_verify_legacy_vehicle_event_detects_a_tampered_row(
    db_session: AsyncSession, seed_org: dict
) -> None:
    event_id = await _legacy_plaintext_receipt(
        db_session, seed_org, event_type=VehicleEventType.VEHICLE_UPDATED,
        changed_fields={"pulsit_device_id": {"from": "PLT-LEGACY-1", "to": "PLT-LEGACY-2"}},
    )
    event = (
        await db_session.execute(select(VehicleEvent).where(VehicleEvent.id == event_id))
    ).scalar_one()
    event.changed_fields = {"pulsit_device_id": {"from": "PLT-LEGACY-1", "to": "PLT-FORGED"}}
    await db_session.flush()

    assert await _verify_vehicle_event(db_session, event_id) == VerifyStatus.DB_MISMATCH
