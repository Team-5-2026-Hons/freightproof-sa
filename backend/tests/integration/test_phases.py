"""Integration tests for the three phase-plan endpoints:

  GET  /trips/{trip_id}/phases
  GET  /trips/{trip_id}/phases/next
  POST /trips/{trip_id}/phases/{phase_event_id}/complete

Replaces tests/integration/test_handshakes.py, whose five /h{n}/complete routes
and GET /{handshake_type} route were deleted along with app/schemas/handshakes.py
and app/api/v1/endpoints/handshakes.py. Reuses seed_trip,
override_get_db, auth_header, and make_token exactly as test_handshakes.py did —
these are not reinvented here.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError

from app.blockchain.hedera import HederaReceipt
from app.db.models.enums import (
    ArtifactType, EvidenceRole, IdvsStatus, OrganizationType, ParcelStatus, PhaseStatus,
    PhaseType, TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import MockScanFeed, ScanDirection
from app.main import app
from app.orchestration.consignments.scans import ingest_scans
from app.orchestration.phases.override import override_phase
from app.orchestration.trips.administration import cancel_trip

from tests.conftest import FakeMockStateStore, auth_header, make_token


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
        id=uuid.uuid4(), trip_reference="FP-TEST-H", order_number="ORD-H",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=datetime.now(UTC),
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

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
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.ARRIVAL, trip_stop_id=stop1.id, sequence_number=5, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop1.id, sequence_number=6, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id, sequence_number=7, status=PhaseStatus.PENDING),
    ])
    await db_session.flush()

    return trip, driver


@pytest_asyncio.fixture
async def seed_trip_with_consignment(db_session, seed_trip):
    """seed_trip plus a Consignment picked up at stop0 (sequence 0).

    phases/blocking.py only gates a (phase_type, stop) pair that has a Consignment row
    — "no Consignment" is the ungated case, not the blocked one (see its module
    docstring). No scan session is closed here, so the mock feed's default
    (nothing staged) reads as an OPEN session and loading stays blocked.
    """
    trip, driver = seed_trip
    stop0 = (await db_session.execute(
        select(TripStop).where(TripStop.trip_id == trip.id, TripStop.sequence == 0)
    )).scalar_one()
    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id,
        parcel_perfect_reference=f"PP-{uuid.uuid4().hex[:8]}",
        pickup_stop_id=stop0.id,
    )
    db_session.add(consignment)
    await db_session.flush()
    return trip, driver


async def _make_artifact(db_session, trip_id) -> str:
    """Insert a real EvidenceArtifact row — phase_events FK-references this table.
    Same helper as tests/integration/test_phase_anchoring.py's, reused rather
    than reinvented."""
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


async def _phase_id(client: AsyncClient, trip_id, token, phase_type: str) -> str:
    """Resolve a row's id from a real GET /phases call — never a hardcoded id
    or an assumed sequence-to-id mapping."""
    resp = await client.get(f"/api/v1/trips/{trip_id}/phases", headers=auth_header(token))
    row = next(p for p in resp.json() if p["phase_type"] == phase_type)
    return row["phase_event_id"]


async def test_activation_complete_returns_200(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"


async def test_activation_complete_wrong_state_returns_409(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    trip.status = TripStatus.EXCEPTION_HOLD
    await db_session.flush()
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 409


async def test_activation_before_the_scheduled_day_returns_409(client: AsyncClient, db_session, seed_trip):
    """A driver cannot start a trip days before it is due.

    The trip is otherwise perfectly startable — right driver, right phase, nothing
    unresolved before it — so a 409 here can only be the date gate.
    """
    trip, driver = seed_trip
    trip.planned_departure_at = datetime.now(UTC) + timedelta(days=8)
    await db_session.flush()
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 409
    assert "scheduled for" in resp.json()["detail"]

    await db_session.refresh(trip)
    assert trip.status == TripStatus.CREATED


async def test_activation_with_no_schedule_at_all_returns_409(client: AsyncClient, db_session, seed_trip):
    """An unscheduled trip is treated as not-yet-due, not as always-allowed.

    Letting these through would mean the rule silently does nothing on exactly the
    records least under control — a dispatcher data gap, not a green light.
    """
    trip, driver = seed_trip
    trip.planned_departure_at = None
    await db_session.execute(
        update(TripStop).where(TripStop.trip_id == trip.id).values(slot_time=None)
    )
    await db_session.flush()
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 409
    assert "no scheduled departure date" in resp.json()["detail"]


async def test_activation_falls_back_to_the_first_stop_slot_when_the_trip_has_no_planned_departure(
    client: AsyncClient, db_session, seed_trip,
):
    """planned_departure_at is nullable; a multi-stop trip can carry its timing on stops."""
    trip, driver = seed_trip
    trip.planned_departure_at = None
    await db_session.execute(
        update(TripStop).where(TripStop.trip_id == trip.id).values(slot_time=datetime.now(UTC))
    )
    await db_session.flush()
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 200


async def test_activation_after_the_scheduled_day_is_allowed(client: AsyncClient, db_session, seed_trip):
    """Running late is not blocked. A delayed trip still needs its evidence captured;
    refusing it would only push the driver to work around the system entirely."""
    trip, driver = seed_trip
    trip.planned_departure_at = datetime.now(UTC) - timedelta(days=3)
    await db_session.flush()
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 200


async def test_later_phases_are_not_date_gated(client: AsyncClient, db_session, seed_trip):
    """The gate is on STARTING a trip, not on every phase.

    A trip that legitimately runs past midnight must not have its remaining phases
    rejected the next day — which is exactly what would happen if this check lived in
    _gate_and_load instead of advance_activation.
    """
    trip, driver = seed_trip
    trip.planned_departure_at = datetime.now(UTC) - timedelta(days=1)
    await db_session.flush()
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    trip.planned_departure_at = datetime.now(UTC) + timedelta(days=30)
    await db_session.flush()
    loading_id = await _phase_id(client, trip.id, token, "loading")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={
            "phase_type": "loading",
            "driver_visual_count": 5,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 200


async def test_activation_complete_unknown_driver_token_returns_401(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    owner_token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, owner_token, "activation")

    other_driver_id = uuid.uuid4()
    token = make_token(sub=str(other_driver_id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 401


async def test_list_phases_returns_the_plan(client: AsyncClient, db_session, seed_trip):
    """Replaces test_get_handshake_detail_returns_event: covers the same
    property (a completed row's status reads back correctly) through the
    replacement route, since GET /{handshake_type} no longer exists."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")

    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    resp = await client.get(f"/api/v1/trips/{trip.id}/phases", headers=auth_header(token))
    assert resp.status_code == 200
    activation = next(p for p in resp.json() if p["phase_type"] == "activation")
    assert activation["status"] == "completed"


async def test_list_phases_unknown_trip_returns_404(client: AsyncClient, seed_trip):
    """Replaces test_get_handshake_detail_unknown_trip_returns_404."""
    driver = seed_trip[1]
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.get(f"/api/v1/trips/{uuid.uuid4()}/phases", headers=auth_header(token))
    assert resp.status_code == 404


async def test_list_phases_other_driver_returns_404(client: AsyncClient, db_session, seed_trip):
    """Replaces test_get_handshake_detail_other_driver_returns_404: a driver must
    not be able to read another driver's phase data (GPS, seal, counts) by
    guessing/observing a trip_id that isn't their own — see security review finding."""
    trip, driver = seed_trip
    owner_token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, owner_token, "activation")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(owner_token),
    )

    other_org = Organization(id=uuid.uuid4(), name="Other Org", org_type=OrganizationType.OPERATOR)
    db_session.add(other_org)
    await db_session.flush()
    other_driver = Driver(
        id=uuid.uuid4(), organization_id=other_org.id, full_name="Other",
        id_number="8001015009088", phone_number="+27820000000", license_number="DRV-X",
    )
    db_session.add(other_driver)
    await db_session.flush()

    other_token = make_token(sub=str(other_driver.id), role="driver")
    resp = await client.get(f"/api/v1/trips/{trip.id}/phases", headers=auth_header(other_token))
    assert resp.status_code == 404


async def test_list_phases_returns_the_whole_plan_in_order(client: AsyncClient, db_session, seed_trip):
    """Length is data: assert the plan matches the fixture's own rows, never a
    hard-coded 7 as a general rule. Assert sequence_number is ascending and the
    phase_type sequence matches what seed_trip actually seeded."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    expected_rows = (await db_session.execute(
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip.id)
        .order_by(PhaseEvent.sequence_number)
    )).scalars().all()

    resp = await client.get(f"/api/v1/trips/{trip.id}/phases", headers=auth_header(token))
    assert resp.status_code == 200
    body = resp.json()

    assert len(body) == len(expected_rows)
    assert [p["sequence_number"] for p in body] == sorted(p["sequence_number"] for p in body)
    assert [p["phase_type"] for p in body] == [PhaseType(row.phase_type).value for row in expected_rows]


async def test_list_phases_includes_stop_sequence_and_step_recipe(client: AsyncClient, db_session, seed_trip):
    """The two derived PhaseEventRead fields — the ones model_validate() alone
    would silently leave empty. trip_creation must have stop_sequence None and an
    empty step_recipe; activation must have stop_sequence 0 and a non-empty one."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.get(f"/api/v1/trips/{trip.id}/phases", headers=auth_header(token))
    assert resp.status_code == 200
    body = resp.json()

    trip_creation = next(p for p in body if p["phase_type"] == "trip_creation")
    assert trip_creation["stop_sequence"] is None
    assert trip_creation["step_recipe"] == []

    activation = next(p for p in body if p["phase_type"] == "activation")
    assert activation["stop_sequence"] == 0
    assert len(activation["step_recipe"]) > 0


async def test_next_phase_tracks_the_ledger_and_returns_null_when_closed(client: AsyncClient, db_session, seed_trip):
    """After each completion GET /phases/next returns the lowest unresolved row;
    after the final confirmation it returns null."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.get(f"/api/v1/trips/{trip.id}/phases/next", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["phase_type"] == "activation"

    activation_id = await _phase_id(client, trip.id, token, "activation")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    resp = await client.get(f"/api/v1/trips/{trip.id}/phases/next", headers=auth_header(token))
    assert resp.json()["phase_type"] == "loading"

    loading_id = await _phase_id(client, trip.id, token, "loading")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={"phase_type": "loading", "driver_visual_count": 42, "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )

    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_id(client, trip.id, token, "departure")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json={
                "phase_type": "departure",
                "waybill_photo_artifact_id": waybill_id, "seal_number": "AB-1234",
                "seal_photo_artifact_id": seal_photo_id, "guard_verified_seal": True,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )

    resp = await client.get(f"/api/v1/trips/{trip.id}/phases/next", headers=auth_header(token))
    assert resp.json()["phase_type"] == "in_transit"

    await _complete_in_transit(client, trip, token)
    await _complete_arrival(client, db_session, trip, token)

    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={"phase_type": "unloading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )

    pod_photo_id = await _make_artifact(db_session, trip.id)
    pod_signature_id = await _make_artifact(db_session, trip.id)
    confirmation_id = await _phase_id(client, trip.id, token, "confirmation")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        confirm_resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{confirmation_id}/complete",
            json={
                "phase_type": "confirmation",
                "pod_photo_artifact_id": pod_photo_id, "pod_signature_artifact_id": pod_signature_id,
                "driver_visual_count": 42,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )
    assert confirm_resp.json()["status"] == "closed"

    resp = await client.get(f"/api/v1/trips/{trip.id}/phases/next", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json() is None


async def test_complete_with_wrong_phase_type_in_body_returns_409(client: AsyncClient, db_session, seed_trip):
    """Addressing the activation row with a loading payload is a client bug and
    must be a distinguishable 409, not a 500 or a silent no-op."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={"phase_type": "loading", "driver_visual_count": 42, "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 409


async def test_phase_complete_maps_db_error_to_500(client: AsyncClient, db_session, seed_trip):
    """A DB fault that escapes complete_phase must map to a clean
    500 (matching trips.py's create_trip_endpoint's exact SQLAlchemyError->500
    shape) rather than an unhandled exception reaching main.py's new global
    handler. Patched at the orchestration boundary the endpoint calls through —
    the one seam that stays stable regardless of which SQLAlchemy call inside
    complete_phase happens to fail. `patch` auto-detects `complete_phase` is
    `async def` and substitutes an AsyncMock, so `side_effect` fires on await.
    """
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")

    with patch(
        "app.api.v1.endpoints.phases.complete_phase",
        side_effect=SQLAlchemyError("connection lost"),
    ):
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
            json={
                "phase_type": "activation",
                "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )

    assert resp.status_code == 500
    assert resp.json()["detail"] == "An unexpected error occurred. Please try again."


async def test_complete_missing_required_field_returns_422(client: AsyncClient, db_session, seed_trip):
    """The discriminated union's whole justification: a departure payload
    without seal_number is a real Pydantic 422, not a hand-rolled service error."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    departure_id = await _phase_id(client, trip.id, token, "departure")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
        json={
            "phase_type": "departure",
            "waybill_photo_artifact_id": str(uuid.uuid4()),
            "seal_photo_artifact_id": str(uuid.uuid4()),
            "guard_verified_seal": True,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 422


async def test_departure_completes_without_a_waybill_photo(client: AsyncClient, db_session, seed_trip):
    """The payload the driver app actually sends since 2026-08-10.

    departure's "3-waybill" step is gone: it photographed the linehaul document that
    loading's "1-linehaul" step already captures, so the driver was asked for one sheet
    twice. waybill_photo_artifact_id is Optional now, and this is the test that says so —
    while it was required, every departure the current app submits would 422 at the door
    and no trip could reach in_transit at all.
    """
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    activation_id = await _phase_id(client, trip.id, token, "activation")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    loading_id = await _phase_id(client, trip.id, token, "loading")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={"phase_type": "loading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )

    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_id(client, trip.id, token, "departure")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json={
                "phase_type": "departure",
                "seal_number": "AB-1234",
                "seal_photo_artifact_id": seal_photo_id,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )

    assert resp.status_code == 200

    departure_row = (await db_session.execute(
        select(PhaseEvent).where(PhaseEvent.id == uuid.UUID(departure_id))
    )).scalar_one()
    assert departure_row.status == PhaseStatus.COMPLETED
    assert departure_row.waybill_photo_artifact_id is None
    assert departure_row.seal_number == "AB-1234"
    assert str(departure_row.seal_photo_artifact_id) == seal_photo_id

    resp = await client.get(f"/api/v1/trips/{trip.id}/phases/next", headers=auth_header(token))
    assert resp.json()["phase_type"] == "in_transit"


async def test_departure_still_accepts_a_waybill_photo_from_a_queued_offline_entry(
    client: AsyncClient, db_session, seed_trip,
):
    """Optional, not deleted — and the difference matters to a queue that has not drained.

    A departure captured offline BEFORE the step was removed replays from the driver
    app's localStorage with the waybill photo still on it. Rejecting the field would
    strand that entry forever; ignoring it would bin a photograph the driver really
    took. It is accepted and stored.
    """
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    activation_id = await _phase_id(client, trip.id, token, "activation")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    loading_id = await _phase_id(client, trip.id, token, "loading")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={"phase_type": "loading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )

    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_id(client, trip.id, token, "departure")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json={
                "phase_type": "departure",
                "waybill_photo_artifact_id": waybill_id,
                "seal_number": "AB-1234",
                "seal_photo_artifact_id": seal_photo_id,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )

    assert resp.status_code == 200

    departure_row = (await db_session.execute(
        select(PhaseEvent).where(PhaseEvent.id == uuid.UUID(departure_id))
    )).scalar_one()
    assert str(departure_row.waybill_photo_artifact_id) == waybill_id


async def test_replayed_complete_returns_200_and_does_not_duplicate(client: AsyncClient, db_session, seed_trip):
    """Idempotency over HTTP, not just at the service layer. Same idempotency_key
    twice: both 200, and the replay writes no second row anywhere on the trip.

    A lookup keyed by the addressed row's own primary key would prove nothing —
    len([activation_row]) == 1 is true by construction even if the replay had
    inserted a whole extra plan. The real risk a replay poses is a SECOND row
    appearing on the trip, so this counts PhaseEvent rows trip-wide, before and
    after, instead. It also pins completed_at across both calls: a replay that
    re-executed the wrapper body (rather than short-circuiting) would stamp a
    fresh completed_at the second time around."""
    trip, driver = seed_trip
    trip_id = trip.id
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip_id, token, "activation")
    key = str(uuid.uuid4())
    payload = {
        "phase_type": "activation",
        "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
        "idempotency_key": key,
    }

    count_before = (await db_session.execute(
        select(func.count()).select_from(PhaseEvent).where(PhaseEvent.trip_id == trip_id)
    )).scalar_one()

    first = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{activation_id}/complete", json=payload, headers=auth_header(token),
    )
    assert first.status_code == 200

    db_session.expire_all()
    activation_row = (await db_session.execute(
        select(PhaseEvent).where(PhaseEvent.id == uuid.UUID(activation_id))
    )).scalar_one()
    completed_at_after_first = activation_row.completed_at

    second = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{activation_id}/complete", json=payload, headers=auth_header(token),
    )
    assert second.status_code == 200

    db_session.expire_all()
    count_after = (await db_session.execute(
        select(func.count()).select_from(PhaseEvent).where(PhaseEvent.trip_id == trip_id)
    )).scalar_one()
    activation_row = (await db_session.execute(
        select(PhaseEvent).where(PhaseEvent.id == uuid.UUID(activation_id))
    )).scalar_one()

    assert count_after == count_before
    assert activation_row.idempotency_key == key
    assert activation_row.completed_at == completed_at_after_first


async def test_complete_addressing_in_transit_row_records_arrival(
    client: AsyncClient, db_session, seed_trip,
):
    """The inverse of what this test asserted before 2026-08-09.

    It used to demand a 422, justified like this: "in_transit is completed by the
    authorized _auto_complete_in_transit stopgap (phase_service.py), and making it
    driver-addressable would harden that stopgap into contract." That function was
    deleted in 9be7a78 and exists nowhere under app/ — the fence outlived its reason.
    Arrival is now an explicit driver attestation, so the union resolves `in_transit`
    and the row completes.
    """
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_in_transit(client, db_session, trip, token)
    in_transit_id = await _phase_id(client, trip.id, token, "in_transit")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{in_transit_id}/complete",
        json={
            "phase_type": "in_transit",
            "driver_phone_lat": -29.8587, "driver_phone_lng": 31.0218,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    row = (await db_session.execute(
        select(PhaseEvent).where(PhaseEvent.id == uuid.UUID(in_transit_id))
    )).scalar_one()
    assert PhaseStatus(row.status) == PhaseStatus.COMPLETED
    assert row.completed_at is not None


async def test_complete_addressing_trip_creation_row_returns_422(
    client: AsyncClient, db_session, seed_trip,
):
    """trip_creation stays out of the union — it is written by create_trip before a
    driver exists. Pydantic's discriminator rejects it (union_tag_invalid -> 422), which
    is a different failure from the 409 a same-union-but-wrong-member mismatch produces."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    trip_creation_id = await _phase_id(client, trip.id, token, "trip_creation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{trip_creation_id}/complete",
        json={"phase_type": "trip_creation", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )

    assert resp.status_code == 422


async def test_arrival_is_not_gated_on_the_destination_warehouse_scan(
    client: AsyncClient, db_session, seed_trip,
):
    """IN_TRANSIT is absent from phases.blocking.GATED_PHASES and must stay absent. The
    destination warehouse has scanned nothing when the driver pulls up at the boom, so
    gating arrival on a scan that only happens AFTER arrival would deadlock the leg.
    UNLOADING carries that gate instead.

    Hits GET /phases directly (a plain list of rows, each with its own blocked_on),
    not trip-detail: no test in this file fetches trip detail, and GET /trips/{id} is
    dispatcher-only (get_current_dispatcher) — a driver token would 403 there. The
    phases list is what _phase_id and every blocked_on test above already use."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_in_transit(client, db_session, trip, token)

    resp = await client.get(f"/api/v1/trips/{trip.id}/phases", headers=auth_header(token))
    assert resp.status_code == 200, resp.text
    in_transit = next(p for p in resp.json() if p["phase_type"] == "in_transit")

    assert in_transit["blocked_on"] is None


async def test_complete_with_wrong_phase_type_on_another_drivers_trip_returns_404(
    client: AsyncClient, db_session, seed_trip,
):
    """Ownership is checked BEFORE the phase-type cross-check. A non-owner must
    get 404 — the same answer as for a trip that does not exist — never a 409
    whose message would reveal the addressed row's real phase_type."""
    trip, driver = seed_trip
    owner_token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, owner_token, "activation")

    other_org = Organization(id=uuid.uuid4(), name="Other Org 2", org_type=OrganizationType.OPERATOR)
    db_session.add(other_org)
    await db_session.flush()
    other_driver = Driver(
        id=uuid.uuid4(), organization_id=other_org.id, full_name="Other2",
        id_number="8001015009099", phone_number="+27820000099", license_number="DRV-Y",
    )
    db_session.add(other_driver)
    await db_session.flush()
    other_token = make_token(sub=str(other_driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={"phase_type": "loading", "driver_visual_count": 42, "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(other_token),
    )

    assert resp.status_code == 404
    assert "activation" not in resp.text


async def test_full_single_leg_walk_over_http_closes_the_trip(client: AsyncClient, db_session, seed_trip):
    """The stage's literal exit bar: POST /phases/{id}/complete for each real
    driver-addressable phase, resolving every id from a real GET /phases
    response, asserting 200 each time and status == "closed" at the end.
    in_transit is walked like every other row: the driver attests his arrival, and
    without that submission the unloading below is a 409."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    activation_id = await _phase_id(client, trip.id, token, "activation")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200

    loading_id = await _phase_id(client, trip.id, token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={"phase_type": "loading", "driver_visual_count": 42, "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 200

    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_id(client, trip.id, token, "departure")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json={
                "phase_type": "departure",
                "waybill_photo_artifact_id": waybill_id, "seal_number": "AB-1234",
                "seal_photo_artifact_id": seal_photo_id, "guard_verified_seal": True,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )
    assert resp.status_code == 200

    await _complete_in_transit(client, trip, token)
    await _complete_arrival(client, db_session, trip, token)

    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={"phase_type": "unloading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 200

    pod_photo_id = await _make_artifact(db_session, trip.id)
    pod_signature_id = await _make_artifact(db_session, trip.id)
    confirmation_id = await _phase_id(client, trip.id, token, "confirmation")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{confirmation_id}/complete",
            json={
                "phase_type": "confirmation",
                "pod_photo_artifact_id": pod_photo_id, "pod_signature_artifact_id": pod_signature_id,
                "driver_visual_count": 42,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "closed"


@pytest_asyncio.fixture
async def empty_leg_seed_data(db_session):
    """Minimal rows for POST /trips with trip_type=empty_leg. Same shape as
    test_create_trip_multistop.py's seed_data, kept local to this file rather
    than shared — this task's scope is phase_service.py plus its own tests."""
    operator_org = Organization(id=uuid.uuid4(), name="EL Operator", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="EL Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([operator_org, client_org])
    await db_session.flush()

    user = User(
        id=uuid.uuid4(), organization_id=operator_org.id,
        email="el-dispatcher@test.co.za", full_name="EL Dispatcher", is_active=True,
    )
    origin = Precinct(id=uuid.uuid4(), name="EL Origin", is_shared=True, principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="EL Dest", is_shared=True, principal_organization_id=client_org.id, latitude="1", longitude="1")
    driver = Driver(
        id=uuid.uuid4(), organization_id=operator_org.id, full_name="EL Driver",
        id_number="8001015009133", phone_number="+27821234533", license_number="DRV-EL2",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=operator_org.id, registration="ELH123GP",
        vehicle_type=VehicleType.HORSE, pulsit_device_id="PLT-EL-HORSE",
    )
    db_session.add_all([user, origin, dest, driver, horse])
    await db_session.flush()

    return {
        "org": operator_org, "user": user,
        "origin_id": origin.id, "dest_id": dest.id,
        "driver_id": driver.id, "horse_id": horse.id,
    }


async def test_empty_leg_trip_walks_to_closed(
    client: AsyncClient, db_session, empty_leg_seed_data,
):
    """Full walk: a real POST /trips(trip_type=empty_leg, no consignments) ->
    activation -> departure -> in_transit arrival -> unloading ->
    confirmation. Before the fix, the final confirmation call 404'd
    (ResourceNotFoundError("PhaseEvent", "loading") raised inside
    advance_confirmation's call to _find_loading_for_leg). After the fix it
    returns 200 and the trip closes."""
    seed = empty_leg_seed_data
    dispatcher_token = make_token(
        sub=str(seed["user"].id), role="dispatcher", org_id=str(seed["org"].id),
    )

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        create_resp = await client.post(
            "/api/v1/trips",
            json={
                "order_number": "ORD-EMPTY-LEG-001",
                "driver_id": str(seed["driver_id"]),
                "horse_id": str(seed["horse_id"]),
                "origin_precinct_id": str(seed["origin_id"]),
                "destination_precinct_id": str(seed["dest_id"]),
                "planned_departure_at": datetime.now(UTC).isoformat(),
                "planned_arrival_at": (datetime.now(UTC) + timedelta(hours=10)).isoformat(),
                "trip_type": "empty_leg",
                "consignments": [],
            },
            headers=auth_header(dispatcher_token),
        )
    assert create_resp.status_code == 201
    trip_id = create_resp.json()["id"]

    driver_token = make_token(sub=str(seed["driver_id"]), role="driver")

    phases_resp = await client.get(
        f"/api/v1/trips/{trip_id}/phases", headers=auth_header(driver_token),
    )
    assert phases_resp.status_code == 200
    phase_types = [p["phase_type"] for p in phases_resp.json()]
    assert phase_types == [
        "trip_creation", "activation", "departure", "in_transit", "arrival", "unloading", "confirmation",
    ]

    activation_id = await _phase_id(client, trip_id, driver_token, "activation")
    resp = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(driver_token),
    )
    assert resp.status_code == 200

    waybill_id = await _make_artifact(db_session, trip_id)
    seal_photo_id = await _make_artifact(db_session, trip_id)
    departure_id = await _phase_id(client, trip_id, driver_token, "departure")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip_id}/phases/{departure_id}/complete",
            json={
                "phase_type": "departure",
                "waybill_photo_artifact_id": waybill_id, "seal_number": "AB-1234",
                "seal_photo_artifact_id": seal_photo_id, "guard_verified_seal": True,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(driver_token),
        )
    assert resp.status_code == 200

    in_transit_id = await _phase_id(client, trip_id, driver_token, "in_transit")
    resp = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{in_transit_id}/complete",
        json={
            "phase_type": "in_transit",
            "driver_phone_lat": -29.8587, "driver_phone_lng": 31.0218,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(driver_token),
    )
    assert resp.status_code == 200, resp.text

    seal_photo_id = await _make_artifact(db_session, trip_id)
    arrival_id = await _phase_id(client, trip_id, driver_token, "arrival")
    resp = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{arrival_id}/complete",
        json={
            "phase_type": "arrival", "seal_condition": "intact",
            "seal_number_at_arrival": "AB-1234",
            "seal_photo_artifact_id": seal_photo_id, "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(driver_token),
    )
    assert resp.status_code == 200, resp.text

    unloading_id = await _phase_id(client, trip_id, driver_token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{unloading_id}/complete",
        json={"phase_type": "unloading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(driver_token),
    )
    assert resp.status_code == 200

    pod_photo_id = await _make_artifact(db_session, trip_id)
    pod_signature_id = await _make_artifact(db_session, trip_id)
    confirmation_id = await _phase_id(client, trip_id, driver_token, "confirmation")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip_id}/phases/{confirmation_id}/complete",
            json={
                "phase_type": "confirmation",
                "pod_photo_artifact_id": pod_photo_id, "pod_signature_artifact_id": pod_signature_id,
                "driver_visual_count": 0,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(driver_token),
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "closed"


async def test_phase_list_reports_blocked_on_for_loading(
    client: AsyncClient, db_session, seed_trip_with_consignment,
):
    """Loading at stop0 has a Consignment picked up there and no scan session has
    been closed (the mock feed's default), so the phase reads as blocked."""
    trip, driver = seed_trip_with_consignment
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.get(f"/api/v1/trips/{trip.id}/phases", headers=auth_header(token))

    assert resp.status_code == 200
    loading = next(p for p in resp.json() if p["phase_type"] == "loading")
    assert loading["blocked_on"] == "warehouse_scan"


async def test_phase_list_reports_null_blocked_on_for_departure(
    client: AsyncClient, db_session, seed_trip_with_consignment,
):
    """departure is absent from phases.blocking's GATED_PHASES map entirely — never
    blocked regardless of consignment or scan-session state."""
    trip, driver = seed_trip_with_consignment
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.get(f"/api/v1/trips/{trip.id}/phases", headers=auth_header(token))

    departure = next(p for p in resp.json() if p["phase_type"] == "departure")
    assert departure["blocked_on"] is None


async def test_phase_list_query_count_is_independent_of_phase_count(
    client: AsyncClient, db_session, seed_trip_with_consignment, test_engine,
):
    """Guards against blocked_on being derived per event. seed_trip's 7-row plan
    (of which loading and confirmation are gated) must issue exactly one
    consignments query for the whole request, not one per phase row — proving
    blocked_on_by_stop is hoisted out of the from_event comprehension in
    api/v1/endpoints/phases.py.

    Uses tests/conftest.py's session-scoped `test_engine` fixture rather than the
    plan's guessed `db_engine`/`xdock_trip_api` — those fixtures don't exist here.
    db_session (used by the endpoint via the get_db override) is a Session bound
    to a Connection checked out of test_engine, so a before_cursor_execute
    listener on test_engine.sync_engine sees every statement the endpoint issues.
    """
    trip, driver = seed_trip_with_consignment
    token = make_token(sub=str(driver.id), role="driver")

    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    from sqlalchemy import event as sa_event
    sa_event.listen(test_engine.sync_engine, "before_cursor_execute", record)
    try:
        resp = await client.get(f"/api/v1/trips/{trip.id}/phases", headers=auth_header(token))
    finally:
        sa_event.remove(test_engine.sync_engine, "before_cursor_execute", record)

    assert resp.status_code == 200
    consignment_queries = [s for s in statements if "consignments" in s.lower()]
    assert len(consignment_queries) == 1


@pytest_asyncio.fixture
async def completed_activation_trip(client: AsyncClient, db_session, seed_trip):
    """seed_trip with activation already completed under a known idempotency_key.

    Activation is never gated by phases.blocking (only loading/confirmation are), so this
    fixture is deliberately independent of any scan-session state — it exists purely
    to give the replay-ordering test a phase that is genuinely already resolved.
    """
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = await _phase_id(client, trip.id, token, "activation")
    key = str(uuid.uuid4())

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": key,
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200

    return {
        "trip_id": str(trip.id),
        "activation_event_id": activation_id,
        "idempotency_key": key,
        "token": token,
    }


async def test_completing_a_blocked_loading_returns_409(
    client: AsyncClient, db_session, seed_trip_with_consignment,
):
    """A hand-crafted POST must not slip past the same gate the read side reports:
    seed_trip_with_consignment leaves the mock scan session open at stop0, so
    loading is genuinely blocked (see seed_trip_with_consignment's own docstring)."""
    trip, driver = seed_trip_with_consignment
    token = make_token(sub=str(driver.id), role="driver")

    activation_id = await _phase_id(client, trip.id, token, "activation")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    loading_id = await _phase_id(client, trip.id, token, "loading")

    response = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        headers=auth_header(token),
        json={
            "phase_type": "loading",
            "driver_visual_count": 3,
            "idempotency_key": str(uuid.uuid4()),
        },
    )

    assert response.status_code == 409
    assert "warehouse" in response.json()["detail"].lower()


async def test_an_idempotent_replay_of_a_completed_phase_does_not_409(
    client: AsyncClient, db_session, completed_activation_trip,
):
    """Ordering guard: the blocked check must run AFTER _gate_and_load's replay
    short-circuit. If it runs first, a resent offline-queue entry for an
    already-successful completion 409s instead of returning current state, and the
    driver app's queue never drains."""
    token = completed_activation_trip["token"]
    key = completed_activation_trip["idempotency_key"]

    response = await client.post(
        f"/api/v1/trips/{completed_activation_trip['trip_id']}/phases/"
        f"{completed_activation_trip['activation_event_id']}/complete",
        headers=auth_header(token),
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": key,
        },
    )

    assert response.status_code == 200



@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    fake = FakeMockStateStore()
    monkeypatch.setattr(scan_feed_module, "get_mock_state_store", lambda: fake)
    return fake


@pytest_asyncio.fixture
async def completed_unloading_trip(
    client: AsyncClient, db_session, store,
) -> dict[str, Any]:
    """A trip driven via real HTTP calls to a COMPLETED unloading row at the
    destination stop, with a Consignment whose parcels are scanned OUT in full
    at origin (closed) but deliberately NOT YET scanned IN at destination —
    unloading now gates on the destination stop's IN-direction scan SESSION being
    closed (phases/blocking.py's GATED_PHASES), but a closed session is a separate
    fact from actual scanned barcodes: the warehouse operator can close an empty
    session (nothing scanned yet) purely to satisfy the gate, and that is what
    happens below. No barcode DATA exists at destination until the test itself
    stages a "late" scan-in strictly after unloading is already closed.
    """
    org = Organization(id=uuid.uuid4(), name="ImmutableOrg", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="ImmutableClient", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4().hex[:8]}@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="ImmutableDriver",
        id_number=uuid.uuid4().hex[:13], phone_number=f"+2782{uuid.uuid4().hex[:7]}",
        license_number=f"DRV-{uuid.uuid4().hex[:8]}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"IM{uuid.uuid4().hex[:6].upper()}", pulsit_device_id=f"PUL-{uuid.uuid4().hex[:8]}",
    )
    origin = Precinct(id=uuid.uuid4(), name="Imm-O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="Imm-D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-IMM-{uuid.uuid4().hex[:6]}", order_number="ORD-IMM",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=datetime.now(UTC),
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop0 = TripStop(trip_id=trip.id, precinct_id=origin.id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=dest.id, sequence=1)
    db_session.add_all([stop0, stop1])
    await db_session.flush()

    pp_reference = f"WAY-IMM-{uuid.uuid4().hex[:8]}"
    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=pp_reference,
        parcel_count_expected=2, pickup_stop_id=stop0.id, delivery_stop_id=stop1.id,
    )
    db_session.add(consignment)
    await db_session.flush()

    barcodes = [f"IMM{uuid.uuid4().hex[:8]}" for _ in range(2)]
    for barcode in barcodes:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id, barcode=barcode, status=ParcelStatus.PENDING,
        ))
    await db_session.flush()

    db_session.add_all([
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION, sequence_number=0, status=PhaseStatus.COMPLETED),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.ACTIVATION, trip_stop_id=stop0.id, sequence_number=1, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.LOADING, trip_stop_id=stop0.id, sequence_number=2, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.DEPARTURE, trip_stop_id=stop0.id, sequence_number=3, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.IN_TRANSIT, trip_stop_id=stop0.id, sequence_number=4, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.ARRIVAL, trip_stop_id=stop1.id, sequence_number=5, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop1.id, sequence_number=6, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id, sequence_number=7, status=PhaseStatus.PENDING),
    ])
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")

    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=pp_reference, stop_reference=str(stop0.id),
        direction=ScanDirection.OUT, barcodes=barcodes,
    )
    await ingest_scans(
        db_session, trip_id=trip.id, trip_stop_id=stop0.id, direction=ScanDirection.OUT,
    )
    await feed.close_session(
        consignment_reference=pp_reference, stop_reference=str(stop0.id), direction=ScanDirection.OUT,
    )
    await db_session.commit()

    activation_id = await _phase_id(client, trip.id, token, "activation")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200

    loading_id = await _phase_id(client, trip.id, token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={"phase_type": "loading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 200

    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_id(client, trip.id, token, "departure")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json={
                "phase_type": "departure",
                "waybill_photo_artifact_id": waybill_id, "seal_number": "AB-1234",
                "seal_photo_artifact_id": seal_photo_id, "guard_verified_seal": True,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )
    assert resp.status_code == 200

    await _complete_in_transit(client, trip, token)
    await _complete_arrival(client, db_session, trip, token)

    await feed.close_session(
        consignment_reference=pp_reference, stop_reference=str(stop1.id), direction=ScanDirection.IN,
    )

    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={"phase_type": "unloading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"

    return {
        "trip_id": trip.id,
        "unloading_event_id": uuid.UUID(unloading_id),
        "delivery_stop_id": stop1.id,
        "pp_reference": pp_reference,
        "barcodes": barcodes,
    }


async def test_a_closed_phase_row_is_never_written_again(
    db_session, store, completed_unloading_trip,
):
    """A phase's anchored payload may only contain data that existed when
    it closed. Scan data arriving after close belongs on a LATER row, never back-written
    onto this one — an anchored row whose fields change no longer hashes to its Hedera
    tx, which is precisely the tampering signal this product exists to detect."""
    event = await db_session.get(PhaseEvent, completed_unloading_trip["unloading_event_id"])
    before = {
        "parcel_count_destination": event.parcel_count_destination,
        "parcel_count_origin": event.parcel_count_origin,
        "event_hash": event.event_hash,
        "completed_at": event.completed_at,
    }

    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=completed_unloading_trip["pp_reference"],
        stop_reference=str(completed_unloading_trip["delivery_stop_id"]),
        direction=ScanDirection.IN,
        barcodes=completed_unloading_trip["barcodes"],
    )
    await ingest_scans(
        db_session,
        trip_id=completed_unloading_trip["trip_id"],
        trip_stop_id=completed_unloading_trip["delivery_stop_id"],
        direction=ScanDirection.IN,
    )
    await db_session.commit()

    await db_session.refresh(event)
    assert {
        "parcel_count_destination": event.parcel_count_destination,
        "parcel_count_origin": event.parcel_count_origin,
        "event_hash": event.event_hash,
        "completed_at": event.completed_at,
    } == before


async def _complete_activation(client: AsyncClient, trip_id, token) -> None:
    """Advances a fresh seed_trip past activation so `loading` is reachable."""
    activation_id = await _phase_id(client, trip_id, token, "activation")
    resp = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200


async def _walk_to_in_transit(client: AsyncClient, db_session, trip, token: str) -> None:
    """activation -> loading -> departure, all as the driver, leaving the trip sitting on
    a PENDING in_transit row. The shortest legal path to the arrival phase."""
    activation_id = await _phase_id(client, trip.id, token, "activation")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": 0.0001, "driver_phone_lng": 0.0001,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    loading_id = await _phase_id(client, trip.id, token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={"phase_type": "loading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_id(client, trip.id, token, "departure")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json={
                "phase_type": "departure",
                "waybill_photo_artifact_id": waybill_id, "seal_number": "AB-1234",
                "seal_photo_artifact_id": seal_photo_id,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )
    assert resp.status_code == 200, resp.text


async def _complete_in_transit(client: AsyncClient, trip, token: str) -> None:
    """The arrival attestation. Every walk that reaches unloading needs this: in_transit
    sits at a lower sequence than unloading and only the driver can resolve it."""
    in_transit_id = await _phase_id(client, trip.id, token, "in_transit")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{in_transit_id}/complete",
        json={
            "phase_type": "in_transit",
            "driver_phone_lat": -29.8587, "driver_phone_lng": 31.0218,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text


async def _complete_arrival(
    client: AsyncClient, db_session, trip, token: str, *, seal_number_at_arrival: str = "AB-1234",
) -> None:
    """The seal inspection at the destination gate. Every walk that reaches unloading
    needs this too: ARRIVAL sits at a lower sequence than UNLOADING and must be
    resolved before the driver can open the trailer."""
    seal_photo_id = await _make_artifact(db_session, trip.id)
    arrival_id = await _phase_id(client, trip.id, token, "arrival")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{arrival_id}/complete",
        json={
            "phase_type": "arrival", "seal_condition": "intact",
            "seal_number_at_arrival": seal_number_at_arrival,
            "seal_photo_artifact_id": seal_photo_id,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text


async def test_loading_complete_with_linehaul_photo_persists_it(
    client: AsyncClient, db_session, seed_trip,
):
    """A driver who photographs the warehouse's paper linehaul sheet has that
    artifact recorded on the PhaseEvent row — the third-party evidence of what
    the warehouse claimed was loaded (PhaseEvent.linehaul_photo_artifact_id)."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)

    linehaul_photo_id = await _make_artifact(db_session, trip.id)
    loading_id = await _phase_id(client, trip.id, token, "loading")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={
            "phase_type": "loading",
            "linehaul_photo_artifact_id": linehaul_photo_id,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 200
    loading_row = next(p for p in resp.json()["phases"] if p["phase_type"] == "loading")
    assert loading_row["linehaul_photo_artifact_id"] == linehaul_photo_id

    event = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    assert str(event.linehaul_photo_artifact_id) == linehaul_photo_id


async def test_loading_complete_without_linehaul_photo_still_succeeds(
    client: AsyncClient, db_session, seed_trip,
):
    """Optional, not required (schema docstring): a warehouse that has already
    gone paperless hands the driver nothing to photograph, and completion must
    not be blocked over a document that never existed."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)

    loading_id = await _phase_id(client, trip.id, token, "loading")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={"phase_type": "loading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )

    assert resp.status_code == 200
    loading_row = next(p for p in resp.json()["phases"] if p["phase_type"] == "loading")
    assert loading_row["linehaul_photo_artifact_id"] is None

    event = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    assert event.linehaul_photo_artifact_id is None


async def test_loading_complete_with_another_trips_linehaul_photo_returns_404(
    client: AsyncClient, db_session, seed_trip,
):
    """_assert_artifacts_belong_to_trip must reject an artifact that exists but
    belongs to a different trip — matching the ownership check every other
    artifact FK on this endpoint already gets (docstring on that helper)."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)

    other_trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-OTHER-{uuid.uuid4().hex[:8]}", order_number="ORD-OTHER",
        operator_organization_id=trip.operator_organization_id,
        client_organization_id=trip.client_organization_id,
        driver_id=trip.driver_id, horse_id=trip.horse_id,
        origin_precinct_id=trip.origin_precinct_id, destination_precinct_id=trip.destination_precinct_id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=trip.created_by_user_id,
    )
    db_session.add(other_trip)
    await db_session.flush()
    foreign_artifact_id = await _make_artifact(db_session, other_trip.id)

    loading_id = await _phase_id(client, trip.id, token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={
            "phase_type": "loading",
            "linehaul_photo_artifact_id": foreign_artifact_id,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 404

    event = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    assert event.linehaul_photo_artifact_id is None


async def _make_attributed_artifact(
    db_session, trip_id, phase_event_id, role: EvidenceRole, *, driver_id=None,
) -> str:
    """An artifact as the upload route would store it. A fresh hash each time: the partial
    unique index on (phase, role, hash) would otherwise reject a second photo."""
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash=uuid.uuid4().hex * 2, mime_type="image/jpeg", captured_at=datetime.now(UTC),
        captured_by_driver_id=driver_id, phase_event_id=uuid.UUID(str(phase_event_id)), evidence_role=role,
    )
    db_session.add(artifact)
    await db_session.flush()
    return str(artifact.id)


async def _make_driver_artifact(db_session, trip_id, driver_id) -> str:
    """Unattributed, but with a driver id: what a pre-attribution app's upload looks like."""
    artifact_id = await _make_artifact(db_session, trip_id)
    artifact = await db_session.get(EvidenceArtifact, uuid.UUID(artifact_id))
    artifact.captured_by_driver_id = driver_id
    await db_session.flush()
    return artifact_id


async def _complete_loading(client: AsyncClient, trip, token: str, **fields: Any):
    loading_id = await _phase_id(client, trip.id, token, "loading")
    return await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={"phase_type": "loading", "idempotency_key": str(uuid.uuid4()), **fields},
        headers=auth_header(token),
    )


async def _walk_to_confirmation(client: AsyncClient, db_session, trip, token: str) -> None:
    """Every driver phase up to, and not including, confirmation."""
    await _walk_to_in_transit(client, db_session, trip, token)
    await _complete_in_transit(client, trip, token)
    await _complete_arrival(client, db_session, trip, token)
    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={"phase_type": "unloading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text


async def _complete_confirmation(client: AsyncClient, trip, token: str, **artifact_ids: str):
    confirmation_id = await _phase_id(client, trip.id, token, "confirmation")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        return await client.post(
            f"/api/v1/trips/{trip.id}/phases/{confirmation_id}/complete",
            json={
                "phase_type": "confirmation", "driver_visual_count": 42,
                "idempotency_key": str(uuid.uuid4()), **artifact_ids,
            },
            headers=auth_header(token),
        )


async def test_completion_citing_artifact_attributed_to_another_phase_returns_422(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    departure_id = await _phase_id(client, trip.id, token, "departure")
    elsewhere = await _make_attributed_artifact(
        db_session, trip.id, departure_id, EvidenceRole.LINEHAUL_PHOTO, driver_id=driver.id,
    )
    loading = await db_session.get(PhaseEvent, uuid.UUID(await _phase_id(client, trip.id, token, "loading")))
    anchor_before = loading.anchor_status

    resp = await _complete_loading(client, trip, token, linehaul_photo_artifact_id=elsewhere)

    assert resp.status_code == 422
    await db_session.refresh(loading)
    assert loading.status == PhaseStatus.PENDING
    assert loading.linehaul_photo_artifact_id is None
    assert loading.anchor_status == anchor_before


async def test_completion_citing_wrong_role_returns_422(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    assert (await _complete_loading(client, trip, token)).status_code == 200
    departure_id = await _phase_id(client, trip.id, token, "departure")
    linehaul_role = await _make_attributed_artifact(
        db_session, trip.id, departure_id, EvidenceRole.LINEHAUL_PHOTO, driver_id=driver.id,
    )

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
        json={
            "phase_type": "departure", "seal_number": "AB-1234",
            "seal_photo_artifact_id": linehaul_role, "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 422
    departure = await db_session.get(PhaseEvent, uuid.UUID(departure_id))
    assert departure.status == PhaseStatus.PENDING
    assert departure.seal_photo_artifact_id is None


async def test_completion_accepts_unattributed_artifact(client: AsyncClient, db_session, seed_trip):
    """Older apps and queued entries upload without attribution and must still complete."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    unattributed = await _make_driver_artifact(db_session, trip.id, driver.id)

    resp = await _complete_loading(client, trip, token, linehaul_photo_artifact_id=unattributed)

    assert resp.status_code == 200
    loading = await db_session.get(PhaseEvent, uuid.UUID(await _phase_id(client, trip.id, token, "loading")))
    assert str(loading.linehaul_photo_artifact_id) == unattributed


async def test_completion_after_retake_records_the_cited_photo(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    first = await _make_attributed_artifact(
        db_session, trip.id, loading_id, EvidenceRole.LINEHAUL_PHOTO, driver_id=driver.id,
    )
    second = await _make_attributed_artifact(
        db_session, trip.id, loading_id, EvidenceRole.LINEHAUL_PHOTO, driver_id=driver.id,
    )

    resp = await _complete_loading(client, trip, token, linehaul_photo_artifact_id=second)

    assert resp.status_code == 200
    loading = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    assert str(loading.linehaul_photo_artifact_id) == second
    superseded = await db_session.get(EvidenceArtifact, uuid.UUID(first))
    assert superseded is not None
    assert (str(superseded.phase_event_id), superseded.evidence_role) == (loading_id, "linehaul_photo")


async def test_confirmation_rejects_unattributed_driver_upload_as_receiver_confirmation(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_confirmation(client, db_session, trip, token)
    pod_photo = await _make_artifact(db_session, trip.id)
    drivers_own = await _make_driver_artifact(db_session, trip.id, driver.id)

    resp = await _complete_confirmation(
        client, trip, token, pod_photo_artifact_id=pod_photo, pod_signature_artifact_id=drivers_own,
    )

    assert resp.status_code == 422
    confirmation = await db_session.get(PhaseEvent, uuid.UUID(await _phase_id(client, trip.id, token, "confirmation")))
    assert confirmation.status == PhaseStatus.PENDING
    assert confirmation.pod_signature_artifact_id is None


async def test_confirmation_rejects_driver_pod_photo_as_receiver_confirmation(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_confirmation(client, db_session, trip, token)
    confirmation_id = await _phase_id(client, trip.id, token, "confirmation")
    pod_photo = await _make_attributed_artifact(
        db_session, trip.id, confirmation_id, EvidenceRole.POD_PHOTO, driver_id=driver.id,
    )
    another_pod_photo = await _make_attributed_artifact(
        db_session, trip.id, confirmation_id, EvidenceRole.POD_PHOTO, driver_id=driver.id,
    )

    resp = await _complete_confirmation(
        client, trip, token, pod_photo_artifact_id=pod_photo, pod_signature_artifact_id=another_pod_photo,
    )

    assert resp.status_code == 422
    confirmation = await db_session.get(PhaseEvent, uuid.UUID(confirmation_id))
    assert confirmation.status == PhaseStatus.PENDING


async def test_confirmation_accepts_unattributed_artifact_without_driver_id(
    client: AsyncClient, db_session, seed_trip,
):
    """Receiver images stored before attribution existed, and fixtures, carry neither."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_confirmation(client, db_session, trip, token)
    pod_photo = await _make_artifact(db_session, trip.id)
    receiver_image = await _make_artifact(db_session, trip.id)

    resp = await _complete_confirmation(
        client, trip, token, pod_photo_artifact_id=pod_photo, pod_signature_artifact_id=receiver_image,
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "closed"


async def test_completion_request_for_overridden_phase_returns_409_and_leaves_row_unchanged(
    client: AsyncClient, db_session, seed_trip,
):
    """Was D26 (an overridden phase replayed as 200 so the offline queue drained). Reversed:
    override_phase only closes a PENDING/IN_PROGRESS row, so no driver completion of an
    OVERRIDDEN row ever landed — a submission against it is new evidence, and a 200 told the
    driver it was recorded while it was discarded. COMPLETED/EXCEPTION still replay as 200."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    await override_phase(
        db_session, trip_id=trip.id, phase_event_id=uuid.UUID(loading_id),
        operator_organization_id=trip.operator_organization_id, user_id=trip.created_by_user_id,
        note="Driver phone lost",
    )
    contradictory = await _make_attributed_artifact(
        db_session, trip.id, await _phase_id(client, trip.id, token, "departure"),
        EvidenceRole.SEAL_PHOTO, driver_id=driver.id,
    )
    loading = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    await db_session.refresh(loading)
    anchor_before = loading.anchor_status

    resp = await _complete_loading(client, trip, token, linehaul_photo_artifact_id=contradictory)

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "PHASE_OVERRIDDEN"
    await db_session.refresh(loading)
    assert loading.status == PhaseStatus.OVERRIDDEN
    assert loading.linehaul_photo_artifact_id is None
    assert loading.anchor_status == anchor_before


async def test_complete_phase_after_override_returns_409_phase_overridden(
    client: AsyncClient, db_session, seed_trip,
):
    """A driver's queued capture arriving after the dispatcher closed the step must be refused
    with a coded 409 so the app keeps the evidence, and must write nothing."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    activation_id = uuid.UUID(await _phase_id(client, trip.id, token, "activation"))
    await override_phase(
        db_session, trip_id=trip.id, phase_event_id=activation_id,
        operator_organization_id=trip.operator_organization_id, user_id=trip.created_by_user_id,
        note="Driver phone lost",
    )
    exceptions_before = (await db_session.execute(
        select(func.count()).select_from(TripException).where(TripException.trip_id == trip.id)
    )).scalar_one()

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "PHASE_OVERRIDDEN"
    assert "kept on this phone" in resp.json()["detail"]["message"]
    activation = await db_session.get(PhaseEvent, activation_id)
    await db_session.refresh(activation)
    assert activation.status == PhaseStatus.OVERRIDDEN
    assert activation.performed_by_driver_id is None
    exceptions_after = (await db_session.execute(
        select(func.count()).select_from(TripException).where(TripException.trip_id == trip.id)
    )).scalar_one()
    assert exceptions_after == exceptions_before
    artifacts = (await db_session.execute(
        select(func.count()).select_from(EvidenceArtifact).where(EvidenceArtifact.trip_id == trip.id)
    )).scalar_one()
    assert artifacts == 0


async def test_completion_request_for_completed_phase_with_new_key_returns_recorded_state(
    client: AsyncClient, db_session, seed_trip,
):
    """The offline queue mints a new idempotency key per queued entry, so the status check,
    not key equality, is what stops a second completion."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    recorded = await _make_attributed_artifact(
        db_session, trip.id, loading_id, EvidenceRole.LINEHAUL_PHOTO, driver_id=driver.id,
    )
    other = await _make_attributed_artifact(
        db_session, trip.id, loading_id, EvidenceRole.LINEHAUL_PHOTO, driver_id=driver.id,
    )
    assert (await _complete_loading(client, trip, token, linehaul_photo_artifact_id=recorded)).status_code == 200
    loading = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    await db_session.refresh(loading)
    anchor_before = loading.anchor_status

    resp = await _complete_loading(client, trip, token, linehaul_photo_artifact_id=other)

    assert resp.status_code == 200
    await db_session.refresh(loading)
    assert str(loading.linehaul_photo_artifact_id) == recorded
    assert loading.anchor_status == anchor_before


async def test_completion_of_pending_phase_on_cancelled_trip_returns_409(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    trip.status = TripStatus.CANCELLED
    trip.closed_at = datetime.now(UTC)
    await db_session.flush()

    resp = await _complete_loading(client, trip, token)

    assert resp.status_code == 409


async def _complete_departure_with(client: AsyncClient, db_session, trip, token: str, **fields: Any):
    """activation and loading, then departure carrying the given extra fields."""
    await _complete_activation(client, trip.id, token)
    assert (await _complete_loading(client, trip, token)).status_code == 200
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_id(client, trip.id, token, "departure")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
        json={
            "phase_type": "departure", "seal_number": "AB-1234",
            "seal_photo_artifact_id": seal_photo_id,
            "idempotency_key": str(uuid.uuid4()), **fields,
        },
        headers=auth_header(token),
    )
    return departure_id, resp


async def _complete_arrival_with(client: AsyncClient, db_session, trip, token: str, **fields: Any):
    """Walk to arrival, then complete it with the given fields."""
    await _walk_to_in_transit(client, db_session, trip, token)
    await _complete_in_transit(client, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    arrival_id = await _phase_id(client, trip.id, token, "arrival")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{arrival_id}/complete",
        json={
            "phase_type": "arrival", "seal_photo_artifact_id": seal_photo_id,
            "idempotency_key": str(uuid.uuid4()), **fields,
        },
        headers=auth_header(token),
    )
    return arrival_id, resp


async def test_departure_complete_records_how_the_seal_number_was_entered(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    departure_id, resp = await _complete_departure_with(
        client, db_session, trip, token, seal_number_source="ocr_corrected",
    )

    assert resp.status_code == 200, resp.text
    row = next(p for p in resp.json()["phases"] if p["phase_type"] == "departure")
    assert row["seal_number_source"] == "ocr_corrected"
    event = await db_session.get(PhaseEvent, uuid.UUID(departure_id))
    assert event.seal_number_source == "ocr_corrected"


async def test_departure_complete_without_seal_number_source_stores_null(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    departure_id, resp = await _complete_departure_with(client, db_session, trip, token)

    assert resp.status_code == 200, resp.text
    event = await db_session.get(PhaseEvent, uuid.UUID(departure_id))
    assert event.seal_number_source is None


async def test_departure_complete_rejects_an_unknown_seal_number_source(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    _departure_id, resp = await _complete_departure_with(
        client, db_session, trip, token, seal_number_source="scanned",
    )

    assert resp.status_code == 422


async def test_arrival_complete_records_how_the_seal_number_was_entered(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    arrival_id, resp = await _complete_arrival_with(
        client, db_session, trip, token, seal_condition="intact",
        seal_number_at_arrival="AB-1234", seal_number_source="ocr_confirmed",
    )

    assert resp.status_code == 200, resp.text
    event = await db_session.get(PhaseEvent, uuid.UUID(arrival_id))
    assert event.seal_number_source == "ocr_confirmed"


async def test_arrival_with_a_missing_seal_stores_no_seal_number_source(
    client: AsyncClient, db_session, seed_trip,
):
    """A missing seal has no number, so there is no way it was entered to record."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    arrival_id, resp = await _complete_arrival_with(
        client, db_session, trip, token, seal_condition="missing", seal_number_source="typed",
    )

    assert resp.status_code == 200, resp.text
    event = await db_session.get(PhaseEvent, uuid.UUID(arrival_id))
    assert event.seal_number_source is None


async def _make_linehaul_pdf(db_session, trip_id, phase_event_id, *, mime_type="application/pdf") -> str:
    """An attributed PDF artifact as the upload route would store it."""
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.DOCUMENT,
        s3_key=f"{trip_id}/{uuid.uuid4()}.pdf", s3_bucket="evidence-artifacts",
        file_hash=uuid.uuid4().hex * 2, mime_type=mime_type, captured_at=datetime.now(UTC),
        phase_event_id=uuid.UUID(str(phase_event_id)), evidence_role=EvidenceRole.LINEHAUL_PDF,
    )
    db_session.add(artifact)
    await db_session.flush()
    return str(artifact.id)


async def test_loading_complete_with_linehaul_pdf_persists_it(client: AsyncClient, db_session, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    photo_id = await _make_attributed_artifact(db_session, trip.id, loading_id, EvidenceRole.LINEHAUL_PHOTO)
    pdf_id = await _make_linehaul_pdf(db_session, trip.id, loading_id)

    resp = await _complete_loading(
        client, trip, token, linehaul_photo_artifact_id=photo_id, linehaul_pdf_artifact_id=pdf_id,
    )

    assert resp.status_code == 200, resp.text
    row = next(p for p in resp.json()["phases"] if p["phase_type"] == "loading")
    assert row["linehaul_pdf_artifact_id"] == pdf_id
    event = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    assert str(event.linehaul_pdf_artifact_id) == pdf_id


async def test_loading_complete_rejects_an_image_cited_as_the_linehaul_pdf(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    photo_id = await _make_attributed_artifact(db_session, trip.id, loading_id, EvidenceRole.LINEHAUL_PHOTO)
    not_a_pdf = await _make_linehaul_pdf(db_session, trip.id, loading_id, mime_type="image/jpeg")

    resp = await _complete_loading(
        client, trip, token, linehaul_photo_artifact_id=photo_id, linehaul_pdf_artifact_id=not_a_pdf,
    )

    assert resp.status_code == 422


async def test_loading_complete_rejects_the_same_artifact_as_photo_and_pdf(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    pdf_id = await _make_linehaul_pdf(db_session, trip.id, loading_id)

    resp = await _complete_loading(
        client, trip, token, linehaul_photo_artifact_id=pdf_id, linehaul_pdf_artifact_id=pdf_id,
    )

    assert resp.status_code == 422


async def test_loading_complete_rejects_another_trips_linehaul_pdf(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    photo_id = await _make_attributed_artifact(db_session, trip.id, loading_id, EvidenceRole.LINEHAUL_PHOTO)

    resp = await _complete_loading(
        client, trip, token, linehaul_photo_artifact_id=photo_id, linehaul_pdf_artifact_id=str(uuid.uuid4()),
    )

    assert resp.status_code == 404


async def test_loading_complete_rejects_a_linehaul_pdf_without_its_scan(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    pdf_id = await _make_linehaul_pdf(db_session, trip.id, loading_id)

    resp = await _complete_loading(client, trip, token, linehaul_pdf_artifact_id=pdf_id)

    assert resp.status_code == 422
    event = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    assert event.linehaul_pdf_artifact_id is None


_ARRIVAL_SEAL_MISMATCH = "ZZ-9999"


async def _arrival_resolved_as_exception(client: AsyncClient, db_session, trip, token: str) -> tuple[str, str, dict]:
    """Arrival whose seal number disagrees with the departure seal: SEAL_MISMATCH, row EXCEPTION.

    Returns the arrival id, the idempotency key, and the exact request body so a replay can
    resend byte-for-byte what the driver app would have queued.
    """
    key = str(uuid.uuid4())
    arrival_id, resp = await _complete_arrival_with(
        client, db_session, trip, token, seal_condition="intact",
        seal_number_at_arrival=_ARRIVAL_SEAL_MISMATCH, idempotency_key=key,
    )
    assert resp.status_code == 200, resp.text
    arrival = await db_session.get(PhaseEvent, uuid.UUID(arrival_id))
    assert arrival.status == PhaseStatus.EXCEPTION
    body = {
        "phase_type": "arrival", "seal_condition": "intact",
        "seal_number_at_arrival": _ARRIVAL_SEAL_MISMATCH,
        "seal_photo_artifact_id": str(arrival.seal_photo_artifact_id), "idempotency_key": key,
    }
    return arrival_id, key, body


async def _arrival_seal_exception_count(db_session, trip_id, arrival_id: str) -> int:
    return (await db_session.execute(
        select(func.count()).select_from(TripException).where(
            TripException.trip_id == trip_id, TripException.phase_event_id == uuid.UUID(arrival_id),
        )
    )).scalar_one()


async def test_own_replay_of_an_exception_completion_returns_200_and_files_no_second_exception(
    client: AsyncClient, db_session, seed_trip,
):
    """_is_resolved treats EXCEPTION like COMPLETED, so a resent offline-queue entry is answered
    from the stored row instead of re-running the wrapper and filing the finding again."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    arrival_id, _key, body = await _arrival_resolved_as_exception(client, db_session, trip, token)
    exceptions_before = await _arrival_seal_exception_count(db_session, trip.id, arrival_id)

    replay = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{arrival_id}/complete", json=body, headers=auth_header(token),
    )

    assert exceptions_before == 1
    assert replay.status_code == 200, replay.text
    assert await _arrival_seal_exception_count(db_session, trip.id, arrival_id) == 1
    arrival = await db_session.get(PhaseEvent, uuid.UUID(arrival_id))
    await db_session.refresh(arrival)
    assert arrival.status == PhaseStatus.EXCEPTION


async def test_own_replay_of_an_exception_completion_after_the_trip_was_cancelled_is_not_a_409(
    client: AsyncClient, db_session, seed_trip,
):
    """The replay short-circuit runs BEFORE the trip-status check, for EXCEPTION as for COMPLETED
    (test_phases_service pins the COMPLETED half): a queued entry for a decided phase must drain
    even though the trip has since reached a terminal status."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    arrival_id, _key, body = await _arrival_resolved_as_exception(client, db_session, trip, token)
    await cancel_trip(
        db_session, trip_id=trip.id, operator_organization_id=trip.operator_organization_id,
        user_id=trip.created_by_user_id, note="abandoned",
    )
    await db_session.refresh(trip)
    assert TripStatus(trip.status) == TripStatus.CANCELLED

    replay = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{arrival_id}/complete", json=body, headers=auth_header(token),
    )

    assert replay.status_code == 200, replay.text
    assert await _arrival_seal_exception_count(db_session, trip.id, arrival_id) == 1
