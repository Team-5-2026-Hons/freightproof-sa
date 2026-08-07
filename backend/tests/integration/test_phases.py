"""Integration tests for the three phase-plan endpoints (parent plan §3.2, task 3.3):

  GET  /trips/{trip_id}/phases
  GET  /trips/{trip_id}/phases/next
  POST /trips/{trip_id}/phases/{phase_event_id}/complete

Replaces tests/integration/test_handshakes.py, whose five /h{n}/complete routes
and GET /{handshake_type} route were deleted along with app/schemas/handshakes.py
and app/api/v1/endpoints/handshakes.py (task 3.2/3.3). Reuses seed_trip,
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
    ArtifactType, IdvsStatus, OrganizationType, ParcelStatus, PhaseStatus, PhaseType, TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import MockScanFeed, ScanDirection
from app.main import app
from app.orchestration import scan_service

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
        # Activation is gated on the trip being due (phase_service._reject_if_not_due) and
        # an unscheduled trip is deliberately unstartable, so this fixture books itself for
        # today — which is what it always meant: a trip a driver is about to run.
        planned_departure_at=datetime.now(UTC),
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    # Hand-built single-leg phase plan, mirroring what create_trip actually
    # produces: the plan generator (task 2.1) writes every row `pending` at
    # trip creation, but create_trip then completes TRIP_CREATION (h0) inline
    # once its Hedera anchor succeeds (see trip_service.create_trip) — so h0
    # is seeded COMPLETED here and every driver-facing row stays PENDING
    # before any endpoint call (the deleted _get_handshake_event no longer
    # creates them on demand). IN_TRANSIT (P4) is included: advance_departure
    # auto-completes it as a stopgap until real checkpoint-Merkle-batch wiring
    # lands — see _auto_complete_in_transit's docstring in phase_service.py.
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


@pytest_asyncio.fixture
async def seed_trip_with_consignment(db_session, seed_trip):
    """seed_trip plus a Consignment picked up at stop0 (sequence 0).

    phase_gate.py only gates a (phase_type, stop) pair that has a Consignment row
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
    Same helper as tests/integration/test_handshakes_anchor.py's, reused rather
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


# ── Ported from test_handshakes.py: activation completion over the new route ──

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
    # The date has to reach the driver — a bare "conflict" tells them nothing about
    # when to come back, and the PWA surfaces this detail verbatim.
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
    # Activation already done yesterday; the plan now sits at loading.
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

    # Now push the schedule far into the future. Loading must still be completable:
    # the trip is already underway, and the date gate has no say over it.
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
    # An unauthenticated-as-non-owner probe must 401 before any DB lookup of
    # the trip's phases is even possible for this token, so the activation id
    # is resolved using the real owner's token first, then addressed with an
    # unknown driver's token.
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
    assert resp.status_code == 401  # other_driver doesn't exist as a Driver row -> get_current_driver 401s first


# ── Ported from test_handshakes.py's GET /{handshake_type} trio, now GET /phases ──

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


# ── New coverage: the plan-shaped behaviours GET /phases and GET /phases/next add ──

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

    # Drive the rest of the plan to closure so next_phase's null branch is
    # exercised, not merely one step of it.
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

    gate_photo_id = await _make_artifact(db_session, trip.id)
    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={
            "phase_type": "unloading", "seal_number_at_destination": "AB-1234",
            "gate_photo_artifact_id": gate_photo_id, "idempotency_key": str(uuid.uuid4()),
        },
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
                "driver_visual_count": 42, "pp_scan_in_count": 42,
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
    """Task 6.4 step 1: a DB fault that escapes complete_phase must map to a clean
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
            # seal_number deliberately omitted
            "seal_photo_artifact_id": str(uuid.uuid4()),
            "guard_verified_seal": True,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 422


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
    # Captured as plain values BEFORE any expire_all() below: expiring the
    # session invalidates trip's loaded attributes, and a later `trip.id`
    # access would trigger a lazy load outside a greenlet context
    # (sqlalchemy.exc.MissingGreenlet) — the same known sharp edge noted in
    # test_handshakes_anchor.py and hit by
    # test_update_vehicle_invalid_vin_leaves_db_state_unchanged.
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

    # Fresh read, not stale identity-map state: the endpoint ran in a
    # different session-bound request context than db_session's own identity
    # map, so a plain attribute read here without expiring first could pass
    # without ever touching the database.
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

    assert count_after == count_before  # the replay wrote no second row anywhere on the trip
    assert activation_row.idempotency_key == key
    assert activation_row.completed_at == completed_at_after_first  # not re-stamped by the replay


# ── (a): in_transit and trip_creation are deliberately not driver-addressable ──

async def test_complete_addressing_in_transit_row_returns_422(client: AsyncClient, db_session, seed_trip):
    """in_transit and trip_creation are deliberately absent from the
    PhaseCompleteRequest discriminated union (decision S5) — neither is
    completed by a driver action. Addressing in_transit with any of the five
    real payload shapes fails Pydantic's discriminator match (union_tag_invalid),
    which FastAPI renders as 422, not the 409 a same-union-but-wrong-member
    mismatch (like activation-addressed-with-loading) produces. This is NOT a
    bug to "fix" by adding an in_transit member to the union: in_transit is
    completed by the authorized _auto_complete_in_transit stopgap
    (phase_service.py), and making it driver-addressable would harden that
    stopgap into contract."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    in_transit_id = await _phase_id(client, trip.id, token, "in_transit")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{in_transit_id}/complete",
        json={"phase_type": "in_transit", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 422


# ── (b): ownership checked before the phase-type cross-check ──────────────

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


# ── (c): the full single-leg walk over live HTTP, closing the trip ────────

async def test_full_single_leg_walk_over_http_closes_the_trip(client: AsyncClient, db_session, seed_trip):
    """The stage's literal exit bar: POST /phases/{id}/complete for each real
    driver-addressable phase, resolving every id from a real GET /phases
    response, asserting 200 each time and status == "closed" at the end.
    in_transit is skipped deliberately — advance_departure auto-completes it
    (the NEW-8 stopgap) — see test_complete_addressing_in_transit_row_returns_422
    above for why it must stay that way."""
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

    # seal_number must match ^[A-Z]{2}-\d{4}$; unloading's destination seal
    # must match departure's or a CRITICAL seal_mismatch exception is raised
    # (the trip still proceeds to confirmation and closes regardless).
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

    gate_photo_id = await _make_artifact(db_session, trip.id)
    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={
            "phase_type": "unloading", "seal_number_at_destination": "AB-1234",
            "gate_photo_artifact_id": gate_photo_id, "idempotency_key": str(uuid.uuid4()),
        },
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
                "driver_visual_count": 42, "pp_scan_in_count": 42,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(token),
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "closed"


# ── F1 (task 6.2a): an EMPTY_LEG trip must reach `closed` ──────────────────
#
# The plan generator emits no LOADING row at all for an empty leg (nothing is
# picked up), and advance_confirmation used to call _find_loading_for_leg,
# which RAISED ResourceNotFoundError("PhaseEvent", "loading") instead of
# returning None — 404ing every empty-leg confirmation, permanently. Created
# via a real POST /trips (not a hand-built PhaseEvent fixture, matching the
# idiom in tests/integration/test_create_trip_multistop.py) so
# build_phase_plan's real no-loading-row shape for an empty leg is exercised,
# not merely asserted against in a unit test.

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
    origin = Precinct(id=uuid.uuid4(), name="EL Origin", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="EL Dest", principal_organization_id=client_org.id, latitude="1", longitude="1")
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
    activation -> departure -> [in_transit auto-completes] -> unloading ->
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
    # The load-bearing shape this test exists to prove: no `loading` row at
    # all on an empty leg (build_phase_plan never emits one when nothing is
    # picked up).
    assert phase_types == [
        "trip_creation", "activation", "departure", "in_transit", "unloading", "confirmation",
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

    gate_photo_id = await _make_artifact(db_session, trip_id)
    unloading_id = await _phase_id(client, trip_id, driver_token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{unloading_id}/complete",
        json={
            "phase_type": "unloading", "seal_number_at_destination": "AB-1234",
            "gate_photo_artifact_id": gate_photo_id, "idempotency_key": str(uuid.uuid4()),
        },
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
                "driver_visual_count": 0, "pp_scan_in_count": 0,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(driver_token),
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "closed"


# ── Task 5: blocked_on served on the phase read schema ─────────────────────

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
    """departure is absent from phase_gate's _GATED_PHASES map entirely — never
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


# ── Task 6: the gate enforced on completion, not just read ─────────────────

@pytest_asyncio.fixture
async def completed_activation_trip(client: AsyncClient, db_session, seed_trip):
    """seed_trip with activation already completed under a known idempotency_key.

    Activation is never gated by phase_gate (only loading/confirmation are), so this
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
        # The SAME token as the original completion, not a fresh make_token() call:
        # sessions.py's one-device-per-driver rule only lets a NEWER session_id take
        # over, and two make_token() calls close together can tie on issued_at,
        # 401ing the replay for a reason that has nothing to do with this test.
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

    # Loading is sequence-gated on activation being resolved first (_gate_and_load's
    # lower-sequence check) — completing that here isolates the 409 below to the
    # scan gate, not a stale earlier phase.
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


# ── Task 8: a closed phase row is never rewritten by a later scan ──────────


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
    at origin (closed) but deliberately NOT YET scanned in at destination —
    unloading itself is never gated on scans (only loading/confirmation are,
    per phase_gate.py's _GATED_PHASES), so it closes with no IN-direction scan
    activity at all. That absence is what lets the test that consumes this
    fixture stage a "late" scan-in strictly after unloading is already closed.
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
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop1.id, sequence_number=5, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id, sequence_number=6, status=PhaseStatus.PENDING),
    ])
    await db_session.flush()

    token = make_token(sub=str(driver.id), role="driver")

    # Scan-out at origin, staged/ingested/closed BEFORE loading — mirrors the real
    # dispatcher flow and is what clears loading's own gate.
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=pp_reference, stop_reference=str(stop0.id),
        direction=ScanDirection.OUT, barcodes=barcodes,
    )
    await scan_service.ingest_scans(
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

    gate_photo_id = await _make_artifact(db_session, trip.id)
    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={
            "phase_type": "unloading", "seal_number_at_destination": "AB-1234",
            "gate_photo_artifact_id": gate_photo_id, "idempotency_key": str(uuid.uuid4()),
        },
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
    """Design §2.1: a phase's anchored payload may only contain data that existed when
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

    # A late scan-in lands well after unloading closed — the realistic ordering.
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference=completed_unloading_trip["pp_reference"],
        stop_reference=str(completed_unloading_trip["delivery_stop_id"]),
        direction=ScanDirection.IN,
        barcodes=completed_unloading_trip["barcodes"],
    )
    await scan_service.ingest_scans(
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


# ── Task 13: the paper linehaul sheet photographed at loading ──────────────

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

    # A second, otherwise-unrelated trip sharing the same org/driver/vehicle/precinct
    # rows as `trip` — enough to satisfy every FK on Trip without a second full fixture.
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
