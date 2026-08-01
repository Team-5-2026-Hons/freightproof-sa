"""Integration tests: departure/confirmation phase completion anchors to
Hedera HCS. D7/T5 (task 2.6) moved the anchor whole from loading to
departure — see DepartureCompleteRequest/advance_departure in
app/schemas/phases.py and app/orchestration/phase_service.py.

Mirrors tests/integration/test_trips_anchor.py's approach (patch HederaService
at the app.blockchain.anchor_service import boundary) applied to the
driver-JWT-authenticated phase endpoints exercised in
tests/integration/test_phases.py — this file reuses that module's seeding
fixtures rather than DEMO_MODE auth, since these phases require a real Driver row.

Filename kept as test_handshakes_anchor.py (not renamed to test_phases_anchor.py)
because it tests anchoring POLICY (fail-open, receipt types, dispatcher-visible
receipts), not routing — the routing surface itself is covered by
tests/integration/test_phases.py.
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest_asyncio
from httpx import AsyncClient

from app.blockchain.hedera import HederaReceipt
from app.core.exceptions import HederaTimeoutError
from app.db.models.enums import (
    ArtifactType, IdvsStatus, OrganizationType, PhaseStatus, PhaseType, TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_trip(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-HA", order_number="ORD-HA",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    # Hand-built single-leg phase plan, mirroring what create_trip's plan
    # generator (task 2.1) writes at trip creation — every PhaseEvent row a
    # driver will ever complete already exists, `pending`, before any endpoint
    # call. IN_TRANSIT (P4) is included: advance_departure auto-completes it
    # as a stopgap until real checkpoint-Merkle-batch wiring lands — see
    # _auto_complete_in_transit's docstring in phase_service.py.
    stop0 = TripStop(trip_id=trip.id, precinct_id=origin.id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=dest.id, sequence=1)
    db_session.add_all([stop0, stop1])
    await db_session.flush()
    db_session.add_all([
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION, sequence_number=0, status=PhaseStatus.COMPLETED),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.ACTIVATION, trip_stop_id=stop0.id, sequence_number=1, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.LOADING, trip_stop_id=stop0.id, sequence_number=2, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.DEPARTURE, trip_stop_id=stop0.id, sequence_number=3, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.IN_TRANSIT, trip_stop_id=stop0.id, sequence_number=4, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop1.id, sequence_number=5, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id, sequence_number=6, status=PhaseStatus.PENDING),
    ])
    await db_session.flush()

    return trip, driver


async def _make_artifact(db_session, trip_id) -> str:
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg",
        captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    return str(artifact.id)


def _fake_hedera_receipt() -> HederaReceipt:
    return HederaReceipt(
        topic_id="0.0.12345", sequence_number=7,
        consensus_timestamp=None, transaction_id="0.0.12345@1715865600.0",
    )


async def _phase_event_id(client: AsyncClient, trip_id, token, phase_type: str) -> str:
    """Resolve a row's id from a real GET /phases call — never a hardcoded id
    or a sequence-to-id mapping."""
    resp = await client.get(f"/api/v1/trips/{trip_id}/phases", headers=auth_header(token))
    row = next(p for p in resp.json() if p["phase_type"] == phase_type)
    return row["phase_event_id"]


async def _complete_h1(client: AsyncClient, db_session, trip, token) -> None:
    phase_event_id = await _phase_event_id(client, trip.id, token, "activation")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200


def _h2_payload() -> dict:
    # D7/T5 (task 2.6): loading no longer carries the seal — only the driver's
    # own visual count.
    return {"phase_type": "loading", "driver_visual_count": 42, "idempotency_key": str(uuid.uuid4())}


def _h3_payload(waybill_id: str, seal_photo_id: str, **overrides: object) -> dict:
    # D7/T5: the seal (waybill photo, seal number, seal photo) is applied at
    # departure now, not loading.
    payload = {
        "phase_type": "departure",
        "waybill_photo_artifact_id": waybill_id,
        "seal_number": "AB-1234",
        "seal_photo_artifact_id": seal_photo_id,
        "guard_verified_seal": True,
        "idempotency_key": str(uuid.uuid4()),
    }
    payload.update(overrides)
    return payload


async def _complete_h2(client: AsyncClient, db_session, trip, token) -> None:
    phase_event_id = await _phase_event_id(client, trip.id, token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
        json=_h2_payload(),
        headers=auth_header(token),
    )
    assert resp.status_code == 200


async def test_h3_complete_anchors_and_returns_event_hash(client: AsyncClient, db_session, seed_trip):
    """POST departure/complete → 200, with event_hash + blockchain_receipt_id set
    on the DEPARTURE row in the response — the fields the driver-pwa's
    "anchored" badge reads. D7/T5 (task 2.6): the anchor moved whole from
    loading to departure, so this is now where it's produced; the loading
    row in the same response must stay unanchored (regression guard
    that the anchor really moved, not just got duplicated)."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_h1(client, db_session, trip, token)
    await _complete_h2(client, db_session, trip, token)
    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_event_id(client, trip.id, token, "departure")

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()

        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json=_h3_payload(waybill_id, seal_photo_id),
            headers=auth_header(token),
        )

    assert resp.status_code == 200
    body = resp.json()
    departure = next(h for h in body["phases"] if h["phase_type"] == "departure")
    assert departure["event_hash"] is not None
    assert departure["blockchain_receipt_id"] is not None

    h2 = next(h for h in body["phases"] if h["phase_type"] == "loading")
    assert h2["event_hash"] is None
    assert h2["blockchain_receipt_id"] is None


async def test_h3_complete_hedera_failure_still_returns_200_fail_open(
    client: AsyncClient, db_session, seed_trip,
):
    """D7 (task 2.5's fail-open policy, wired into advance_departure for the
    first time in task 2.6): unlike the old H2 fail-closed anchor, a Hedera
    failure during departure completion must NOT block the phase from
    completing or the trip from advancing — the seal event already happened.
    No 504/502 here; the endpoint doesn't even catch
    HederaTimeoutError/HederaServiceError for departure, because
    advance_departure -> _anchor_or_fail_open never lets one escape.
    """
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_h1(client, db_session, trip, token)
    await _complete_h2(client, db_session, trip, token)
    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_event_id(client, trip.id, token, "departure")

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.side_effect = HederaTimeoutError("Simulated Hedera timeout")

        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json=_h3_payload(waybill_id, seal_photo_id),
            headers=auth_header(token),
        )

    assert resp.status_code == 200
    body = resp.json()
    departure = next(h for h in body["phases"] if h["phase_type"] == "departure")
    assert departure["status"] == "completed"
    assert departure["blockchain_receipt_id"] is None  # retry owed, not raised
    # Read the trip's advancement straight off the response body rather than
    # re-querying via db_session — expire_all() followed by a synchronous
    # attribute read on an already-loaded ORM instance (trip.id) is a known
    # sharp edge in this test suite's async session (see the identical hazard
    # in test_vehicles_validation.py::test_update_vehicle_invalid_vin_leaves_db_state_unchanged).
    assert body["status"] == "active"  # departure still advanced the trip, even on a failed anchor


async def test_trip_detail_lists_h3_handshake_receipt_for_dispatcher(
    client: AsyncClient, db_session, seed_trip,
):
    """The driver→dispatcher anchoring link: after departure anchors, GET
    /trips/{id} (the dispatcher portal's data source) must list the
    PHASE_EVENT receipt in blockchain_receipts. resource_service.get_trip_detail
    used to filter subject_type == TRIP only, silently hiding every
    driver-anchored receipt from the dispatcher's per-trip evidence view."""
    trip, driver = seed_trip
    driver_token = make_token(sub=str(driver.id), role="driver")
    await _complete_h1(client, db_session, trip, driver_token)
    await _complete_h2(client, db_session, trip, driver_token)
    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_event_id(client, trip.id, driver_token, "departure")

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        h3_resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json=_h3_payload(waybill_id, seal_photo_id),
            headers=auth_header(driver_token),
        )
    assert h3_resp.status_code == 200
    departure = next(h for h in h3_resp.json()["phases"] if h["phase_type"] == "departure")

    # Receipts are role-gated (FP-115): only admin_dispatcher sees the full list,
    # so the read side authenticates as an admin in the trip's operator org.
    admin = User(
        id=uuid.uuid4(), organization_id=trip.operator_organization_id,
        email="admin@test.co.za", full_name="Admin",
    )
    db_session.add(admin)
    await db_session.flush()
    admin_token = make_token(
        sub=str(admin.id), role="admin_dispatcher",
        org_id=str(trip.operator_organization_id),
    )

    detail_resp = await client.get(f"/api/v1/trips/{trip.id}", headers=auth_header(admin_token))

    assert detail_resp.status_code == 200
    receipts = detail_resp.json()["blockchain_receipts"]
    handshake_receipts = [r for r in receipts if r["subject_type"] == "phase_event"]
    assert len(handshake_receipts) == 1
    assert handshake_receipts[0]["subject_id"] == departure["phase_event_id"]
    assert handshake_receipts[0]["id"] == departure["blockchain_receipt_id"]
