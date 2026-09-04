"""Integration tests for FP-143 — Pulsit corroboration written at every handshake.

These assert the ACTUAL DATABASE STATE after a phase completes, not that a function
was called. The story is about four things that were always null; a mock-call
assertion would pass just as happily while continuing to write nothing.

What each block proves:

  * every column populated on a normal handshake, at every phase
  * a Pulsit failure leaves the handshake successful and corroboration unavailable
  * a geofence-failing position writes FALSE, and a missing fix writes NULL — the
    distinction the whole story turns on
  * one trailer_gps_snapshots row per trailer; none for a trailer with no tracker
  * a trip with no trailers still corroborates
  * a handshake replayed from the driver app's offline queue does not duplicate rows
  * captured_at is the TRACKER's reading time, never the server's clock

FIXTURE PROVENANCE: as in tests/unit/test_pulsit_mock.py, no position here was
recorded from Pulsit — no specification and no credentials exist. Coordinates are
our own precinct seed values. These prove the corroboration wiring against the
shape FP-87 assumed; they cannot prove the assumption.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from unittest.mock import patch

from sqlalchemy import select, update

from app.core.config import settings
from app.db.models.enums import (
    IdvsStatus, OrganizationType, PhaseStatus, PhaseType, TripStatus, VehicleType,
)
from app.blockchain.hedera import HederaReceipt
from app.db.models.enums import ArtifactType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot
from app.db.models.transit import Checkpoint
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.integrations import pulsit as pulsit_module
from app.integrations.pulsit import (
    MockPulsitClient, PulsitFix, PulsitFixSource, PulsitFixStatus,
)
from app.main import app
from app.orchestration import corroboration_service

from tests.conftest import FakeMockStateStore, auth_header, make_token

# The origin precinct sits exactly here, so a horse staged at the same point is
# unambiguously inside the 200 m default geofence and a verdict of True cannot be
# an accident of tolerance arithmetic.
_ORIGIN_LAT = Decimal("-33.9249")
_ORIGIN_LNG = Decimal("18.4241")

# Johannesburg — ~1270 km from the origin precinct. Far enough that no radius or
# tolerance value anyone might later configure could reclassify it as "confirmed".
_FAR_AWAY_LAT = Decimal("-26.2041")
_FAR_AWAY_LNG = Decimal("28.0473")

# Device ids for this module's own fleet. Deliberately NOT the seeded demo ids from
# MOCK_DEVICE_POSITIONS: every position these tests rely on is staged explicitly, so
# a change to the demo fixture library can never silently alter an expectation here.
_HORSE_DEVICE = "TEST-HORSE-CORROB"
_TRAILER_A_DEVICE = "TEST-TRAILER-A"
_TRAILER_B_DEVICE = "TEST-TRAILER-B"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def pulsit_store(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    """Run the real MockPulsitClient over a dict, exactly as the dev panel would.

    The real client rather than a stub: the point of these tests is the seam between
    orchestration and FP-87, and a stub would test the seam against itself.
    """
    fake = FakeMockStateStore()
    monkeypatch.setattr(pulsit_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", True)
    return fake


async def _stage(device_id: str, lat: Decimal, lng: Decimal, *, fixed_at: datetime | None = None) -> None:
    """Put a tracker at a position, through the same entry point FP-197's dev trigger uses."""
    await MockPulsitClient().stage_position(device_id, lat, lng, fixed_at=fixed_at)


@pytest_asyncio.fixture
async def corroboration_trip(db_session):
    """A single-leg trip whose origin precinct has real coordinates.

    Distinct from test_phases.py's seed_trip, which places both precincts at
    (0, 0)/(1, 1) — usable for sequencing tests, useless for a geofence verdict,
    because "confirmed" there would be indistinguishable from a default.
    """
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="c@test.co.za", full_name="C")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-C",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"H{uuid.uuid4().hex[:6].upper()}", pulsit_device_id=_HORSE_DEVICE,
    )
    origin = Precinct(
        id=uuid.uuid4(), name="Origin depot", principal_organization_id=client_org.id,
        latitude=_ORIGIN_LAT, longitude=_ORIGIN_LNG,
    )
    dest = Precinct(
        id=uuid.uuid4(), name="Destination depot", principal_organization_id=client_org.id,
        latitude=_FAR_AWAY_LAT, longitude=_FAR_AWAY_LNG,
    )
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:8]}", order_number="ORD-C",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=datetime.now(UTC),
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop0 = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=origin.id, sequence=0)
    stop1 = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=dest.id, sequence=1)
    db_session.add_all([stop0, stop1])
    await db_session.flush()

    # Mirrors what create_trip produces: P0 already COMPLETED, every driver-facing
    # row PENDING. Same shape as test_phases.py's seed_trip, kept in step with it.
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

    return trip, driver, org, stop0


async def _attach_trailer(db_session, *, trip: Trip, org: Organization, device_id: str) -> Vehicle:
    """Add one trailer to the trip, snapshotting its device id as create_trip does."""
    trailer = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.TRAILER,
        registration=f"T{uuid.uuid4().hex[:6].upper()}", pulsit_device_id=device_id,
    )
    db_session.add(trailer)
    await db_session.flush()
    db_session.add(TripTrailer(
        trip_id=trip.id, trailer_id=trailer.id, pulsit_device_id_snapshot=device_id,
    ))
    await db_session.flush()
    return trailer


async def _phase_id(client: AsyncClient, trip_id: uuid.UUID, token: str, phase_type: str) -> str:
    """Resolve a row's id from a real GET, never a hardcoded id or assumed ordering."""
    resp = await client.get(f"/api/v1/trips/{trip_id}/phases", headers=auth_header(token))
    return next(p for p in resp.json() if p["phase_type"] == phase_type)["phase_event_id"]


async def _complete_activation(
    client: AsyncClient, trip: Trip, driver: Driver, *,
    idempotency_key: str | None = None, token: str | None = None,
) -> Any:
    # A caller replaying a submission MUST pass the same token: make_token mints a
    # fresh session_id each call, and the one-device-per-driver rule would reject the
    # second request as a different device before it ever reached the replay guard.
    token = token or make_token(sub=str(driver.id), role="driver")
    phase_event_id = await _phase_id(client, trip.id, token, "activation")
    return await client.post(
        f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
        headers=auth_header(token),
        json={
            "phase_type": "activation",
            "driver_phone_lat": float(_ORIGIN_LAT),
            "driver_phone_lng": float(_ORIGIN_LNG),
            "idempotency_key": idempotency_key or f"idem-{uuid.uuid4()}",
        },
    )


async def _load_event(db_session, trip: Trip, phase_type: PhaseType) -> PhaseEvent:
    result = await db_session.execute(
        select(PhaseEvent).where(
            PhaseEvent.trip_id == trip.id, PhaseEvent.phase_type == phase_type,
        )
    )
    return result.scalar_one()


async def _load_snapshots(db_session, event: PhaseEvent) -> list[TrailerGpsSnapshot]:
    result = await db_session.execute(
        select(TrailerGpsSnapshot)
        .where(TrailerGpsSnapshot.phase_event_id == event.id)
        .order_by(TrailerGpsSnapshot.trailer_id)
    )
    return list(result.scalars().all())


async def _make_artifact(db_session, trip_id: uuid.UUID) -> str:
    """A real EvidenceArtifact row — phase_events FK-references this table.

    Same helper as test_phases.py's and test_phase_anchoring.py's, reused rather
    than reinvented.
    """
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg", captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    return str(artifact.id)


def _fake_hedera_receipt() -> HederaReceipt:
    return HederaReceipt(
        topic_id="0.0.12345", sequence_number=7,
        consensus_timestamp=None, transaction_id="0.0.12345@1715865600.0",
    )


async def _resolve_phases_before(db_session, trip: Trip, sequence_number: int) -> None:
    """Scaffolding: satisfy the sequence gate without walking each phase's evidence rules.

    OVERRIDDEN, because _is_resolved treats it as decided — the same state a
    dispatcher override leaves behind. Used only by tests whose subject is the
    corroboration of ONE phase; the full-walk test below drives every phase through
    its real endpoint instead, so nothing here lets a wiring bug hide.
    """
    await db_session.execute(
        update(PhaseEvent)
        .where(PhaseEvent.trip_id == trip.id, PhaseEvent.sequence_number < sequence_number)
        .values(status=PhaseStatus.OVERRIDDEN)
    )
    await db_session.flush()


# ── The normal handshake: all four writes land ──────────────────────────────────


async def test_a_normal_handshake_populates_every_corroboration_column(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    trip, driver, org, _stop = corroboration_trip
    trailer = await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.horse_gps_lat == _ORIGIN_LAT
    assert event.horse_gps_lng == _ORIGIN_LNG
    assert event.pulsit_geofence_confirmed is True
    snapshots = await _load_snapshots(db_session, event)
    assert len(snapshots) == 1
    assert snapshots[0].trailer_id == trailer.id
    assert snapshots[0].pulsit_device_id == _TRAILER_A_DEVICE
    assert snapshots[0].lat == _ORIGIN_LAT


async def test_corroboration_is_written_at_every_phase_not_only_the_first(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """The story's core requirement: this fires at ALL phases, not just pickup.

    Drives the entire plan through its real endpoints — no scaffolding — because a
    wiring bug that reached only activation would pass every single-phase test in
    this file. Each row is then asserted independently.
    """
    trip, driver, org, _stop = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    token = make_token(sub=str(driver.id), role="driver")
    seal_photo_id = await _make_artifact(db_session, trip.id)
    gate_photo_id = await _make_artifact(db_session, trip.id)
    pod_photo_id = await _make_artifact(db_session, trip.id)
    pod_signature_id = await _make_artifact(db_session, trip.id)

    bodies: list[dict[str, Any]] = [
        {"phase_type": "activation",
         "driver_phone_lat": float(_ORIGIN_LAT), "driver_phone_lng": float(_ORIGIN_LNG)},
        {"phase_type": "loading"},
        {"phase_type": "departure",
         "seal_number": "AB-1234", "seal_photo_artifact_id": seal_photo_id},
        {"phase_type": "in_transit"},
        {"phase_type": "unloading",
         "seal_number_at_destination": "AB-1234", "gate_photo_artifact_id": gate_photo_id},
        {"phase_type": "confirmation",
         "pod_photo_artifact_id": pod_photo_id, "pod_signature_artifact_id": pod_signature_id},
    ]
    # departure and confirmation anchor to Hedera; patched so the walk exercises the
    # corroboration wiring rather than the network.
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        for body in bodies:
            phase_event_id = await _phase_id(client, trip.id, token, body["phase_type"])
            resp = await client.post(
                f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
                headers=auth_header(token),
                json={**body, "idempotency_key": f"idem-{uuid.uuid4()}"},
            )
            assert resp.status_code == 200, (body["phase_type"], resp.text)

    for phase_type in (
        PhaseType.ACTIVATION, PhaseType.LOADING, PhaseType.DEPARTURE,
        PhaseType.IN_TRANSIT, PhaseType.UNLOADING, PhaseType.CONFIRMATION,
    ):
        event = await _load_event(db_session, trip, phase_type)
        assert event.horse_gps_lat == _ORIGIN_LAT, phase_type
        assert event.horse_gps_lng == _ORIGIN_LNG, phase_type
        assert len(await _load_snapshots(db_session, event)) == 1, phase_type

    # The verdict tracks the stop each phase actually belongs to: the origin phases
    # confirm against the origin precinct, and the destination phases correctly report
    # a mismatch, because the horse never left the origin in this walk. That asymmetry
    # is the proof the precinct is resolved per row rather than once per trip.
    for phase_type in (PhaseType.ACTIVATION, PhaseType.LOADING, PhaseType.DEPARTURE):
        assert (await _load_event(db_session, trip, phase_type)).pulsit_geofence_confirmed is True
    for phase_type in (PhaseType.UNLOADING, PhaseType.CONFIRMATION):
        assert (await _load_event(db_session, trip, phase_type)).pulsit_geofence_confirmed is False
    # in_transit alone carries no verdict — see its own test below.
    assert (await _load_event(db_session, trip, PhaseType.IN_TRANSIT)).pulsit_geofence_confirmed is None


# ── The three-state contract: FALSE is an accusation, NULL is an admission ──────


async def test_a_geofence_failing_position_writes_false_not_null(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """"We checked and the truck was not there" must be recordable as FALSE.

    If this ever regresses to NULL, a real mismatch becomes indistinguishable from
    a tracker outage and FP-145 can never raise GPS_MISMATCH from stored state.
    """
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is False
    # The position is still recorded — a truck in the wrong place is evidence, and
    # discarding the coordinate would leave the false verdict unexplainable.
    assert event.horse_gps_lat == _FAR_AWAY_LAT


async def test_a_dark_tracker_writes_null_not_false(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """A tracker that reports nothing must NEVER read as "the truck was not there".

    evaluate_geofence returns confirmed=False when it has no fix to measure; this
    is the test that fails if that raw boolean is ever persisted.
    """
    trip, driver, _org, _stop = corroboration_trip
    await MockPulsitClient().stage_no_fix(_HORSE_DEVICE)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is None
    assert event.horse_gps_lat is None


async def test_an_unknown_device_writes_null(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """Nothing staged and not in the demo fixture library — Pulsit does not know it.

    A fleet-record bug, not a claim about where the vehicle was.
    """
    trip, driver, _org, _stop = corroboration_trip

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.pulsit_geofence_confirmed is None
    assert event.horse_gps_lat is None


async def test_in_transit_records_position_but_no_geofence_verdict(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """in_transit's stop is the one it DEPARTED from, so it has no fence to be inside.

    Judging an arrival against the origin would stamp a fabricated mismatch on every
    healthy trip in the fleet. The position is still evidence and is still stored.
    """
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)
    token = make_token(sub=str(driver.id), role="driver")
    in_transit = await _load_event(db_session, trip, PhaseType.IN_TRANSIT)
    await _resolve_phases_before(db_session, trip, in_transit.sequence_number)
    phase_event_id = await _phase_id(client, trip.id, token, "in_transit")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
        headers=auth_header(token),
        json={"phase_type": "in_transit", "idempotency_key": f"idem-{uuid.uuid4()}"},
    )

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.IN_TRANSIT)
    assert event.horse_gps_lat == _FAR_AWAY_LAT
    assert event.pulsit_geofence_confirmed is None


# ── A failed Pulsit call must never fail the handshake ──────────────────────────


async def test_a_pulsit_outage_leaves_the_handshake_successful(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
    monkeypatch: pytest.MonkeyPatch,
):
    """The driver is standing at a gate. The tracker API being down is not their problem.

    Injected as a raising client rather than a returned-UNAVAILABLE fix, because the
    fail-open guard has to survive an exception escaping FP-87 entirely — not just
    the failure mode FP-87 currently models.
    """
    trip, driver, org, _stop = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)

    class _ExplodingPulsitClient:
        async def get_positions(self, device_ids: Any) -> Any:
            raise RuntimeError("Pulsit is unreachable")

        async def get_position(self, device_id: str) -> Any:
            raise RuntimeError("Pulsit is unreachable")

    monkeypatch.setattr(
        corroboration_service, "get_pulsit_client", lambda: _ExplodingPulsitClient(),
    )

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.status == PhaseStatus.COMPLETED
    assert event.completed_at is not None
    # Corroboration recorded as unavailable — null means "we could not check".
    assert event.horse_gps_lat is None
    assert event.pulsit_geofence_confirmed is None
    assert await _load_snapshots(db_session, event) == []


async def test_an_unavailable_fix_does_not_erase_a_position_from_an_earlier_attempt(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """A None must never overwrite corroboration a previous delivery captured.

    Mirrors _record_driver_position's rule for the driver's own fix.
    """
    trip, driver, _org, _stop = corroboration_trip
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    event.horse_gps_lat = _ORIGIN_LAT
    event.horse_gps_lng = _ORIGIN_LNG
    await db_session.flush()
    await MockPulsitClient().stage_no_fix(_HORSE_DEVICE)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    refreshed = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert refreshed.horse_gps_lat == _ORIGIN_LAT


# ── Trailers: one row each, and the awkward fleet shapes ────────────────────────


async def test_multiple_trailers_each_get_their_own_snapshot_row(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """One row per trailer, not one per trip."""
    trip, driver, org, _stop = corroboration_trip
    trailer_a = await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    trailer_b = await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_B_DEVICE)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _stage(_TRAILER_B_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    snapshots = await _load_snapshots(db_session, event)
    assert len(snapshots) == 2
    by_trailer = {s.trailer_id: s for s in snapshots}
    # Each trailer's OWN position, not the horse's copied twice — a positional
    # zip bug against FP-87's ordered batch response would show up exactly here.
    assert by_trailer[trailer_a.id].lat == _ORIGIN_LAT
    assert by_trailer[trailer_b.id].lat == _FAR_AWAY_LAT


async def test_a_trip_with_no_trailers_still_corroborates_the_horse(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """A rigid or an unhitched horse — no trailers is a normal trip, not an error."""
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert event.horse_gps_lat == _ORIGIN_LAT
    assert event.pulsit_geofence_confirmed is True
    assert await _load_snapshots(db_session, event) == []


async def test_a_trailer_with_no_tracker_gets_no_row_and_does_not_block_the_others(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """An absent row is the honest record of a trailer that reported nothing.

    lat/lng/captured_at are all NOT NULL, so there is no way to write a row saying
    "this trailer was somewhere unknown" — and inventing coordinates to fill it
    would be worse than the silence.
    """
    trip, driver, org, _stop = corroboration_trip
    dark = await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    reporting = await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_B_DEVICE)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await MockPulsitClient().stage_no_fix(_TRAILER_A_DEVICE)
    await _stage(_TRAILER_B_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    snapshots = await _load_snapshots(db_session, event)
    assert [s.trailer_id for s in snapshots] == [reporting.id]
    assert dark.id not in {s.trailer_id for s in snapshots}


# ── Offline queue delivery and the timestamp decision ───────────────────────────


async def test_a_replayed_offline_handshake_does_not_duplicate_snapshot_rows(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """The driver app resends queued entries on reconnect; the queue must drain.

    trailer_gps_snapshots has no unique constraint on (phase_event_id, trailer_id),
    so nothing at the schema level would stop a second row. What stops it is
    _gate_and_load's idempotent-replay short-circuit returning before the wrapper
    body runs at all — this asserts that guard actually covers the new writes.
    """
    trip, driver, org, _stop = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    replayed_key = f"idem-{uuid.uuid4()}"

    token = make_token(sub=str(driver.id), role="driver")

    first = await _complete_activation(
        client, trip, driver, idempotency_key=replayed_key, token=token,
    )
    second = await _complete_activation(
        client, trip, driver, idempotency_key=replayed_key, token=token,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    assert len(await _load_snapshots(db_session, event)) == 1


async def test_a_snapshot_records_the_trackers_reading_time_not_the_servers_clock(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """captured_at is PulsitFix.fixed_at, never now() — the offline-timing decision.

    A handshake queued at 14:00 and flushed at 17:00 is corroborated at 17:00, and
    the server cannot detect that (no client capture timestamp is on the wire).
    Storing the tracker's OWN reading time is what keeps the separation visible to
    anyone reading the evidence later, instead of laundering it into a fresh-looking
    row. A regression to now() makes stale corroboration indistinguishable from live.
    """
    trip, driver, org, _stop = corroboration_trip
    await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    three_hours_ago = datetime.now(UTC) - timedelta(hours=3)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG, fixed_at=three_hours_ago)

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    snapshot = (await _load_snapshots(db_session, event))[0]
    assert snapshot.captured_at == three_hours_ago
    # Narrowed rather than asserted inline: completed_at is Optional on the model,
    # and the comparison is the point of the test — a mypy error here would be
    # silenced by a cast that could hide a genuinely unset timestamp.
    assert event.completed_at is not None
    assert snapshot.captured_at < event.completed_at


async def test_a_positioned_fix_with_no_reading_time_is_dropped_rather_than_invented(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
    monkeypatch: pytest.MonkeyPatch,
):
    """captured_at is NOT NULL, and a fabricated timestamp on evidence is worse than none.

    Reaches past the mock client deliberately: PulsitFix's own contract says a
    positioned fix always carries fixed_at, and this module refuses to depend on
    another story's invariant to decide whether to invent evidence.
    """
    trip, driver, org, _stop = corroboration_trip
    trailer = await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)

    class _TimelessPulsitClient:
        async def get_positions(self, device_ids: Any) -> list[PulsitFix]:
            return [
                PulsitFix(
                    device_id=device_id, status=PulsitFixStatus.OK,
                    source=PulsitFixSource.MOCK, lat=_ORIGIN_LAT, lng=_ORIGIN_LNG,
                    fixed_at=None,
                )
                for device_id in device_ids
            ]

        async def get_position(self, device_id: str) -> PulsitFix:
            return (await self.get_positions([device_id]))[0]

    monkeypatch.setattr(
        corroboration_service, "get_pulsit_client", lambda: _TimelessPulsitClient(),
    )

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    # The horse position still lands — phase_events has no timestamp column for it,
    # so there is nothing to invent there. Only the snapshot row is refused.
    assert event.horse_gps_lat == _ORIGIN_LAT
    assert await _load_snapshots(db_session, event) == []
    assert trailer.id is not None


# ── The trailer device id is the snapshot, not the live vehicle row ─────────────


async def test_a_snapshot_uses_the_trip_frozen_device_id_not_the_current_vehicle_row(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """Reassigning a tracker after departure must not rewrite what a phase recorded.

    TripTrailer.pulsit_device_id_snapshot exists for exactly this; reading the live
    Vehicle row instead would silently defeat it.
    """
    trip, driver, org, _stop = corroboration_trip
    trailer = await _attach_trailer(db_session, trip=trip, org=org, device_id=_TRAILER_A_DEVICE)
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    await _stage(_TRAILER_A_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)
    # The fleet office re-registers this trailer's tracker after the trip was built.
    trailer.pulsit_device_id = "TEST-TRAILER-REASSIGNED"
    await db_session.flush()

    resp = await _complete_activation(client, trip, driver)

    assert resp.status_code == 200
    event = await _load_event(db_session, trip, PhaseType.ACTIVATION)
    snapshot = (await _load_snapshots(db_session, event))[0]
    assert snapshot.pulsit_device_id == _TRAILER_A_DEVICE


# ── Checkpoints: the driver payload no longer supplies the horse position ───────
#
# SCOPE NOTE FOR REVIEW: FP-143 as written covers phase handshakes only. These three
# tests cover an explicit extension of the same treatment to checkpoint_service.py,
# decided 2026-09-04. Flagged here rather than buried, because it changes an existing
# endpoint's behaviour: Checkpoint.horse_gps_lat/lng used to be whatever the driver's
# app put in the request body, which made the column a second copy of the driver's own
# claim rather than an independent source.


async def _log_checkpoint(
    client: AsyncClient, trip: Trip, driver: Driver, **extra: Any
) -> Any:
    token = make_token(sub=str(driver.id), role="driver")
    return await client.post(
        f"/api/v1/trips/{trip.id}/checkpoints",
        headers=auth_header(token),
        json={"checkpoint_type": "manual", **extra},
    )


async def _load_checkpoint(db_session, trip: Trip) -> Checkpoint:
    result = await db_session.execute(
        select(Checkpoint).where(Checkpoint.trip_id == trip.id)
    )
    return result.scalar_one()


async def test_a_checkpoint_takes_its_horse_position_from_pulsit(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _FAR_AWAY_LAT, _FAR_AWAY_LNG)

    resp = await _log_checkpoint(client, trip, driver)

    assert resp.status_code == 201, resp.text
    checkpoint = await _load_checkpoint(db_session, trip)
    assert checkpoint.horse_gps_lat == _FAR_AWAY_LAT
    assert checkpoint.horse_gps_lng == _FAR_AWAY_LNG


async def test_a_checkpoint_ignores_a_horse_position_supplied_by_the_driver(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
):
    """The whole point of the change: the phone may not assert where the truck is.

    The fields are still ACCEPTED — a queued offline entry from an older app build
    replays with them populated, and a 422 would strand it in the driver's queue
    forever — but the tracker reading supersedes them entirely.
    """
    trip, driver, _org, _stop = corroboration_trip
    await _stage(_HORSE_DEVICE, _ORIGIN_LAT, _ORIGIN_LNG)

    resp = await _log_checkpoint(
        client, trip, driver,
        horse_gps_lat=float(_FAR_AWAY_LAT), horse_gps_lng=float(_FAR_AWAY_LNG),
    )

    assert resp.status_code == 201, resp.text
    checkpoint = await _load_checkpoint(db_session, trip)
    assert checkpoint.horse_gps_lat == _ORIGIN_LAT
    assert checkpoint.horse_gps_lng != _FAR_AWAY_LAT


async def test_a_pulsit_outage_leaves_the_checkpoint_successful(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
    monkeypatch: pytest.MonkeyPatch,
):
    """Same fail-open contract as a handshake — a roadside checkpoint must still log."""
    trip, driver, _org, _stop = corroboration_trip

    class _ExplodingPulsitClient:
        async def get_positions(self, device_ids: Any) -> Any:
            raise RuntimeError("Pulsit is unreachable")

        async def get_position(self, device_id: str) -> Any:
            raise RuntimeError("Pulsit is unreachable")

    monkeypatch.setattr(
        corroboration_service, "get_pulsit_client", lambda: _ExplodingPulsitClient(),
    )

    resp = await _log_checkpoint(client, trip, driver)

    assert resp.status_code == 201, resp.text
    checkpoint = await _load_checkpoint(db_session, trip)
    assert checkpoint.horse_gps_lat is None
    assert checkpoint.horse_gps_lng is None
