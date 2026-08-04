"""Integration tests for POST /api/v1/trips.

These tests use a real PostgreSQL test database (TEST_DATABASE_URL) and a
rolled-back transaction per test. Auth uses a real signed JWT (see
tests/conftest.py) via the shared `client` fixture.
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.blockchain.hedera import HederaSubmitError
from app.core.exceptions import HederaTimeoutError
from app.main import app
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
from app.db.models.trips import Consignment, Parcel, Trip, TripStop, TripTrailer
from app.db.models.phases import PhaseEvent
from app.db.models.enums import (
    AnchorStatus, PhaseStatus, PhaseType, IdvsStatus,
    OrganizationType, TripStatus, VehicleType,
)
from app.db.session import get_db

from tests.conftest import auth_header, make_token


# Override get_db so the endpoint uses the same rolled-back session as seed_data
@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


# ─── Seed fixtures ──────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seed_data(db_session: AsyncSession):
    """Insert the minimal rows required by POST /trips and yield their IDs."""

    operator_org = Organization(
        id=uuid.uuid4(),
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    client_org = Organization(
        id=uuid.uuid4(),
        name="Demo Client",
        org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([operator_org, client_org])
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
        full_name="Test Driver",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-001",
        idvs_status=IdvsStatus.PENDING,
    )
    horse = Vehicle(
        id=uuid.uuid4(),
        organization_id=operator_org.id,
        registration="CA 123-456",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-HORSE-001",
    )
    trailer = Vehicle(
        id=uuid.uuid4(),
        organization_id=operator_org.id,
        registration="CA 789-012",
        vehicle_type=VehicleType.TRAILER,
        pulsit_device_id="PLT-TRAILER-001",
    )
    db_session.add_all([driver, horse, trailer])
    await db_session.flush()

    yield {
        "org": operator_org,
        "user": user,
        "client_org_id": client_org.id,
        "origin_id": origin.id,
        "destination_id": destination.id,
        "driver_id": driver.id,
        "horse_id": horse.id,
        "trailer_id": trailer.id,
        "trailer_pulsit_id": trailer.pulsit_device_id,
    }


# ─── Helpers ────────────────────────────────────────────────────────────────

def _make_payload(seed: dict) -> dict:
    return {
        "order_number": "ORD-TEST-001",
        "driver_id": str(seed["driver_id"]),
        "horse_id": str(seed["horse_id"]),
        "trailer_ids": [str(seed["trailer_id"])],
        "origin_precinct_id": str(seed["origin_id"]),
        "destination_precinct_id": str(seed["destination_id"]),
        "consignments": [{"pp_reference": "MOCKWAY001", "unit_count_expected": 2}],
    }


def _auth_headers(seed: dict) -> dict:
    return auth_header(
        make_token(sub=str(seed["user"].id), role="dispatcher", org_id=str(seed["org"].id))
    )


# ─── Tests ──────────────────────────────────────────────────────────────────

async def test_create_trip_returns_201(client: AsyncClient, seed_data, db_session):
    resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 201


async def test_create_trip_response_shape(client: AsyncClient, seed_data, db_session):
    resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    body = resp.json()
    assert body["status"] == "created"
    assert body["order_number"] == "ORD-TEST-001"
    assert body["trip_reference"].startswith("FP-")
    assert len(body["journey_lock_hash"]) == 64
    assert body["idvs_check_status"] == "pending"
    # POST /trips now returns the trip's whole committed phase plan (Stage 3.4),
    # not just the single trip_creation row — this fixture's single-leg
    # (2-stop) trip yields 7 rows (length is data, but this fixture's own).
    assert len(body["phases"]) == 7
    assert body["phases"][0]["phase_type"] == "trip_creation"
    # h0 completes inline in create_trip once its anchor succeeds (Stage 2
    # final-review fix) — it's never "pending" in a real response.
    assert body["phases"][0]["status"] == "completed"
    assert body["phases"][0]["sequence_number"] == 0
    assert len(body["trailers"]) == 1
    assert body["exceptions"] == []
    assert body["blockchain_receipts"] == []
    assert "created_at" in body
    assert "updated_at" in body


async def test_create_trip_writes_trip_to_db(client: AsyncClient, seed_data, db_session):
    resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 201
    trip_id = uuid.UUID(resp.json()["id"])

    trip_row = (await db_session.execute(select(Trip).where(Trip.id == trip_id))).scalar_one()
    assert trip_row.status == TripStatus.CREATED
    assert trip_row.journey_lock_hash is not None
    assert len(trip_row.journey_lock_hash) == 64


async def test_create_trip_writes_trailer_snapshot_to_db(client: AsyncClient, seed_data, db_session):
    resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    trip_id = uuid.UUID(resp.json()["id"])

    trailer_rows = (
        await db_session.execute(select(TripTrailer).where(TripTrailer.trip_id == trip_id))
    ).scalars().all()
    assert len(trailer_rows) == 1
    assert trailer_rows[0].pulsit_device_id_snapshot == seed_data["trailer_pulsit_id"]


async def test_create_trip_writes_h0_handshake_to_db(client: AsyncClient, seed_data, db_session):
    """create_trip now writes the full committed phase plan (Stage 2.1), not just
    H0 — filter to trip_creation specifically; row-count coverage of the full plan
    lives in test_create_trip_writes_full_pending_plan / test_create_trip_multistop.py.

    h0 is asserted COMPLETED (not PENDING): create_trip completes it inline once
    its Hedera anchor succeeds, since reaching that point means trip creation
    itself IS h0's completion event — see trip_service.create_trip. Leaving h0
    PENDING would permanently block every later phase, since _gate_and_load
    (phase_service.py) requires every lower-sequence_number row resolved and h0
    is sequence 0, the lowest possible."""
    resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    trip_id = uuid.UUID(resp.json()["id"])

    h0_row = (
        await db_session.execute(
            select(PhaseEvent).where(
                PhaseEvent.trip_id == trip_id, PhaseEvent.phase_type == PhaseType.TRIP_CREATION
            )
        )
    ).scalar_one()
    assert h0_row.phase_type == PhaseType.TRIP_CREATION
    assert h0_row.sequence_number == 0
    assert h0_row.status == PhaseStatus.COMPLETED
    assert h0_row.completed_at is not None
    assert h0_row.blockchain_receipt_id is not None
    assert h0_row.event_hash is not None
    assert h0_row.anchor_status == AnchorStatus.ANCHORED


async def test_create_trip_409_on_duplicate_order_number(client: AsyncClient, seed_data, db_session):
    payload = _make_payload(seed_data)
    first = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data)
    )
    assert first.status_code == 201
    second = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data)
    )
    assert second.status_code == 409
    assert "ORD-TEST-001" in second.json()["detail"]


async def test_create_trip_404_unknown_driver(client: AsyncClient, seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["driver_id"] = str(uuid.uuid4())
    resp = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data)
    )
    assert resp.status_code == 404
    assert "Driver" in resp.json()["detail"]


async def test_create_trip_zero_trailers(client: AsyncClient, seed_data, db_session):
    """A trip with no trailers is valid — rigid trucks and integrated bodies run
    without trailers (empty trailer list is a valid canonical value, see
    crypto/hashing.py). This supersedes the old 422-on-empty-trailers expectation,
    which predates that decision."""
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-NOTRAILER-001"
    payload["trailer_ids"] = []
    resp = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data)
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["trailers"] == []
    assert body["journey_lock_hash"] is not None
    assert len(body["journey_lock_hash"]) == 64

    trip_id = uuid.UUID(body["id"])
    trailer_rows = (
        await db_session.execute(select(TripTrailer).where(TripTrailer.trip_id == trip_id))
    ).scalars().all()
    assert trailer_rows == []


async def test_create_trip_422_same_origin_and_destination(client: AsyncClient, seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["destination_precinct_id"] = payload["origin_precinct_id"]
    resp = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data)
    )
    assert resp.status_code == 422


async def test_create_trip_403_without_demo_mode(client: AsyncClient, seed_data, db_session, monkeypatch):
    # FastAPI's HTTPBearer returns 403 (not 401) when the Authorization header
    # is completely absent. 401 is reserved for an invalid/expired token.
    monkeypatch.setattr("app.core.config.settings.DEMO_MODE", False)
    resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
    )
    assert resp.status_code == 403


async def _post_trip_with_hedera_failure(
    client: AsyncClient, payload: dict, headers: dict, side_effect: Exception
):
    """POST /trips with HederaService patched so submit_hash raises side_effect.

    Patch target follows test_trips_anchor.py — anchor_service instantiates
    HederaService itself, so the class is patched where anchor_service imports it.
    """
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        instance = MagicMock()
        instance.submit_hash.side_effect = side_effect
        MockService.return_value = instance

        return await client.post("/api/v1/trips", json=payload, headers=headers)


async def _assert_no_trip_persisted(db_session: AsyncSession, order_number: str) -> None:
    """Assert fail-closed H0: nothing survives a failed anchoring attempt.

    The autouse get_db override yields the test session without the
    rollback-on-exception that production get_db performs, so the flushed-but-
    unanchored Trip row is still pending here. Mirror production's rollback
    first — if trip_service had committed mid-way (breaking atomicity), the
    row would survive this rollback and the assertion would catch it.
    """
    await db_session.rollback()
    row = (
        await db_session.execute(select(Trip).where(Trip.order_number == order_number))
    ).scalar_one_or_none()
    assert row is None


async def test_create_trip_hedera_timeout_returns_504_and_no_trip(client: AsyncClient, seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-HEDERA-TIMEOUT-001"

    resp = await _post_trip_with_hedera_failure(
        client, payload, _auth_headers(seed_data),
        HederaTimeoutError("Hedera anchoring did not respond in time"),
    )

    assert resp.status_code == 504
    assert "retry" in resp.json()["detail"].lower()
    await _assert_no_trip_persisted(db_session, "ORD-HEDERA-TIMEOUT-001")


async def test_create_trip_hedera_service_error_returns_502_and_no_trip(client: AsyncClient, seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-HEDERA-DOWN-001"

    # HederaSubmitError subclasses HederaServiceError — the realistic failure
    # shape for the endpoint's generic HederaServiceError → 502 handler.
    resp = await _post_trip_with_hedera_failure(
        client, payload, _auth_headers(seed_data),
        HederaSubmitError("Failed to submit hash to Hedera HCS."),
    )

    assert resp.status_code == 502
    assert "retry" in resp.json()["detail"].lower()
    await _assert_no_trip_persisted(db_session, "ORD-HEDERA-DOWN-001")


async def test_list_trips_empty_returns_200(client: AsyncClient, seed_data, db_session):
    resp = await client.get(
        "/api/v1/trips",
        headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_trips_returns_created_trip(client: AsyncClient, seed_data, db_session):
    await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    resp = await client.get(
        "/api/v1/trips",
        headers=_auth_headers(seed_data),
    )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 1
    assert body[0]["order_number"] == "ORD-TEST-001"
    assert body[0]["status"] == "created"
    assert body[0]["open_exception_count"] == 0
    assert "driver" in body[0]
    assert "horse" in body[0]
    assert "trailers" in body[0]


async def test_list_trips_status_filter(client: AsyncClient, seed_data, db_session):
    await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    resp_created = await client.get(
        "/api/v1/trips?status=created",
        headers=_auth_headers(seed_data),
    )
    # TripStatus.IN_TRANSIT (a LEGACY per-handshake value) was deleted in Stage
    # 2.2/T6 — CLOSED is the coarse-model equivalent of "a status this
    # freshly-created trip cannot have yet".
    resp_closed = await client.get(
        "/api/v1/trips?status=closed",
        headers=_auth_headers(seed_data),
    )
    assert len(resp_created.json()) == 1
    assert resp_closed.json() == []


async def test_get_trip_detail_returns_200(client: AsyncClient, seed_data, db_session):
    create_resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    trip_id = create_resp.json()["id"]
    resp = await client.get(
        f"/api/v1/trips/{trip_id}",
        headers=_auth_headers(seed_data),
    )
    body = resp.json()
    assert resp.status_code == 200
    assert body["id"] == trip_id
    # create_trip now writes the full 7-row committed phase plan for this
    # single-leg (2-stop) trip (Stage 2.1), and get_trip_detail returns every
    # PhaseEvent row — not just H0 — ordered by sequence_number.
    assert len(body["phases"]) == 7
    assert body["phases"][0]["phase_type"] == "trip_creation"


async def test_get_trip_detail_phases_carry_phase_event_id(
    client: AsyncClient, seed_data, db_session,
):
    """PhaseEventRead's own identity field must serialise as `phase_event_id`,
    matching the shared frontend contract (frontend/shared/lib/types/phase.ts) —
    NOT `id`, the DB column name. The dispatcher keys manifest-panel selection
    and "in progress" rendering on this exact key (lib/phase/derive.ts,
    app/(app)/trips/[id]/page.tsx); a silent drift back to `id` reintroduces
    that bug without any TypeScript error, since the unchecked `as Promise<T>`
    cast in lib/api/client.ts would just make phase_event_id undefined at
    runtime. Also asserts the value is a REAL row id, not merely present."""
    create_resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    trip_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/v1/trips/{trip_id}",
        headers=_auth_headers(seed_data),
    )
    body = resp.json()
    assert resp.status_code == 200

    phase = body["phases"][0]
    assert "phase_event_id" in phase
    assert "id" not in phase

    row = (
        await db_session.execute(
            select(PhaseEvent).where(
                PhaseEvent.trip_id == uuid.UUID(trip_id),
                PhaseEvent.sequence_number == phase["sequence_number"],
            )
        )
    ).scalar_one()
    assert uuid.UUID(phase["phase_event_id"]) == row.id


def _assert_derived_phase_fields_populated(phases: list[dict]) -> None:
    """stop_sequence and step_recipe are PhaseEventRead.from_event()'s two
    derived fields (a TripStop join and a static lookup respectively) —
    model_validate() alone leaves both silently empty/None, which is exactly
    why from_event() exists instead. Not asserting an exact step_recipe list:
    tests/unit/test_phase_meta_contract.py already owns the recipe contents,
    this only proves the field is populated rather than silently empty."""
    trip_creation = next(p for p in phases if p["phase_type"] == "trip_creation")
    assert trip_creation["stop_sequence"] is None
    assert trip_creation["step_recipe"] == []

    activation = next(p for p in phases if p["phase_type"] == "activation")
    assert activation["stop_sequence"] is not None
    assert len(activation["step_recipe"]) > 0


async def test_create_trip_response_populates_derived_phase_fields(
    client: AsyncClient, seed_data, db_session,
):
    """Guards trip_service.create_trip's own from_event() call site (POST
    /trips) — one of PhaseEventRead.from_event()'s three separate call sites,
    each of which builds its own stop map by hand. Nothing else in the suite
    reads stop_sequence/step_recipe off body["phases"] — existing tests only
    check phase_type/status/sequence_number/event_hash — so a regression to
    plain model_validate() here would silently null every stop_sequence and
    stay green everywhere else (the same failure shape as Stage 2's NEW-10)."""
    resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 201
    body = resp.json()

    _assert_derived_phase_fields_populated(body["phases"])


async def test_get_trip_detail_phases_agree_with_creation_response(
    client: AsyncClient, seed_data, db_session,
):
    """Guards resource_service.get_trip_detail's from_event() call site (GET
    /trips/{id}) the same way the test above guards create_trip's — and, since
    both endpoints serve the same trip here, additionally proves POST and GET
    describe the SAME plan (the actual dispatcher-contract consistency task 3.4
    fixed, not merely that each path independently populates something)."""
    create_resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    assert create_resp.status_code == 201
    post_body = create_resp.json()
    trip_id = post_body["id"]

    get_resp = await client.get(
        f"/api/v1/trips/{trip_id}",
        headers=_auth_headers(seed_data),
    )
    assert get_resp.status_code == 200
    get_body = get_resp.json()

    _assert_derived_phase_fields_populated(get_body["phases"])

    # Same trip, same plan: POST's and GET's stop_sequence-by-phase must agree,
    # keyed by (phase_type, sequence_number) since that pair is unique within
    # one trip's plan and doesn't depend on row ordering matching exactly.
    post_stop_sequences = {
        (p["phase_type"], p["sequence_number"]): p["stop_sequence"] for p in post_body["phases"]
    }
    get_stop_sequences = {
        (p["phase_type"], p["sequence_number"]): p["stop_sequence"] for p in get_body["phases"]
    }
    assert post_stop_sequences == get_stop_sequences


async def test_get_trip_detail_not_found_returns_404(client: AsyncClient, seed_data, db_session):
    resp = await client.get(
        f"/api/v1/trips/{uuid.uuid4()}",
        headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 404


# ─── Consignment loop / empty legs (trip-creation-redesign Task 6) ─────────────

async def test_create_trip_persists_consignments_and_parcels(client: AsyncClient, seed_data, db_session):
    """POST with two consignments persists a Consignment row per waybill (with the
    dispatcher-entered unit_count_expected) and a Parcel row per PP track."""
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-CONSIGN-001"
    payload["consignments"] = [
        {"pp_reference": "MOCKWAY001", "unit_count_expected": 2},
        {"pp_reference": "WAY001", "unit_count_expected": 4},
    ]
    resp = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body["consignments"]) == 2

    trip_id = uuid.UUID(body["id"])
    consignment_rows = (
        await db_session.execute(select(Consignment).where(Consignment.trip_id == trip_id))
    ).scalars().all()
    assert len(consignment_rows) == 2

    by_ref = {c.parcel_perfect_reference: c for c in consignment_rows}
    assert by_ref["MOCKWAY001"].unit_count_expected == 2
    assert by_ref["WAY001"].unit_count_expected == 4

    parcel_rows = (
        await db_session.execute(
            select(Parcel).where(Parcel.consignment_id.in_([c.id for c in consignment_rows]))
        )
    ).scalars().all()
    barcodes = {p.barcode for p in parcel_rows}
    expected_barcodes = {"MOCKWAY0010001", "MOCKWAY0010002"} | {
        f"WAY001{n:04d}" for n in range(1, 6)
    }
    assert barcodes == expected_barcodes


async def test_create_trip_unknown_waybill_rolls_back_everything(client: AsyncClient, seed_data, db_session):
    """A PP waybill that doesn't resolve must roll back the whole trip — atomicity,
    not a partially-created trip with no manifest."""
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-ROLLBACK-001"
    payload["consignments"] = [{"pp_reference": "NOPE999", "unit_count_expected": 1}]
    resp = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 422

    trip_rows = (
        await db_session.execute(select(Trip).where(Trip.order_number == "ORD-ROLLBACK-001"))
    ).scalars().all()
    assert trip_rows == []
    stop_rows = (await db_session.execute(select(TripStop))).scalars().all()
    assert stop_rows == []
    consignment_rows = (await db_session.execute(select(Consignment))).scalars().all()
    assert consignment_rows == []
    handshake_rows = (await db_session.execute(select(PhaseEvent))).scalars().all()
    assert handshake_rows == []


async def test_create_trip_409_on_waybill_already_assigned_to_another_trip(
    client: AsyncClient, seed_data, db_session,
):
    """A PP waybill already on trip A cannot be pulled onto trip B.

    Without this rejection, create_trip's post-sync step restamps the existing
    Consignment row's pickup/delivery stops onto the SECOND trip's route - quietly
    corrupting the first (already-anchored) trip's phase-plan basis. The second
    trip must get a 409 that names the owning trip, and trip B's rollback must be
    total: no Trip/TripStop/PhaseEvent rows left behind by the rejected attempt.
    """
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-REUSE-A"
    first = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data),
    )
    assert first.status_code == 201
    first_trip_reference = first.json()["trip_reference"]

    payload["order_number"] = "ORD-REUSE-B"
    second = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data),
    )

    assert second.status_code == 409
    assert first_trip_reference in second.json()["detail"]
    assert "MOCKWAY001" in second.json()["detail"]

    trip_b_rows = (
        await db_session.execute(select(Trip).where(Trip.order_number == "ORD-REUSE-B"))
    ).scalars().all()
    assert trip_b_rows == []


async def test_create_trip_unmapped_accnum_returns_warning(client: AsyncClient, seed_data, db_session):
    """WAY004's accnum (UNMAP9) has no matching Organization — the consignment is
    still saved (client_organization_id NULL) with a non-fatal warning surfaced."""
    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-WARN-001"
    payload["consignments"] = [{"pp_reference": "WAY004", "unit_count_expected": 3}]
    resp = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body["warnings"]) >= 1
    assert any("UNMAP9" in w for w in body["warnings"])

    trip_id = uuid.UUID(body["id"])
    consignment_row = (
        await db_session.execute(select(Consignment).where(Consignment.trip_id == trip_id))
    ).scalar_one()
    assert consignment_row.client_organization_id is None


async def test_create_empty_leg_no_consignments_no_pp_call(client: AsyncClient, seed_data, db_session, monkeypatch):
    """An empty-leg trip (no consignments) must never touch Parcel Perfect."""
    def _raise(*args, **kwargs):
        raise AssertionError("PP client must not be called for an empty-leg trip")

    monkeypatch.setattr("app.orchestration.consignment_service.get_pp_client", _raise)

    payload = _make_payload(seed_data)
    payload["order_number"] = "ORD-EMPTY-001"
    payload["trip_type"] = "empty_leg"
    payload["consignments"] = []

    resp = await client.post(
        "/api/v1/trips", json=payload, headers=_auth_headers(seed_data),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["trip_type"] == "empty_leg"

    trip_id = uuid.UUID(body["id"])
    consignment_rows = (
        await db_session.execute(select(Consignment).where(Consignment.trip_id == trip_id))
    ).scalars().all()
    assert consignment_rows == []


async def test_create_trip_response_carries_seeded_position_cache(client: AsyncClient, seed_data, db_session):
    """U4: create_trip completes h0 inline but never seeded trip.current_phase,
    so a freshly created trip reported no current phase at all until its first
    advance. The cache must be derived the moment the plan exists."""
    resp = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "created"
    assert body["current_phase"] == "activation"
    # Stop sequences are 0-indexed (origin=0, destination=1) — activation
    # happens at the origin stop, sequence 0.
    assert body["current_stop"] == 0


async def test_trip_list_item_carries_plan_counts(client: AsyncClient, seed_data, db_session):
    """U3: TripListItemResponse has no phase plan, so the dashboard cannot show
    plan-driven progress without these. phase_total is the plan's own length —
    never 6, never 7 as a constant."""
    create = await client.post(
        "/api/v1/trips",
        json=_make_payload(seed_data),
        headers=_auth_headers(seed_data),
    )
    created = create.json()

    resp = await client.get("/api/v1/trips", headers=_auth_headers(seed_data))

    assert resp.status_code == 200
    row = next(t for t in resp.json() if t["id"] == created["id"])
    assert row["phase_total"] == len(created["phases"])
    assert row["phase_completed"] == 1          # trip_creation only
    assert row["current_phase"] == "activation"
    # Stop sequences are 0-indexed (origin=0, destination=1) — activation
    # happens at the origin stop, sequence 0.
    assert row["current_stop"] == 0
