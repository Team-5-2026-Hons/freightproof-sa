"""Integration tests for POST /trips/{id}/checkpoints (driver checkpoint logging)."""

import asyncio
import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import (
    ExceptionType, IdvsStatus, OrganizationType, PhaseStatus, PhaseType, TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint, TripException
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.integrations.pulsit import PulsitFix, PulsitFixSource, PulsitFixStatus
from app.main import app
from app.orchestration import checkpoint_service
from app.schemas.transit import DriverCheckpointCreateBody

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
        id=uuid.uuid4(), trip_reference="FP-TEST-CKPT", order_number="ORD-CKPT",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    return trip, driver


async def test_driver_logs_checkpoint(client: AsyncClient, seed_trip):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/checkpoints",
        json={
            "checkpoint_type": "manual",
            "driver_phone_lat": "0.001", "driver_phone_lng": "0.001",
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 201
    assert resp.json()["checkpoint_type"] == "manual"


async def test_driver_cannot_log_checkpoint_on_someone_elses_trip(client: AsyncClient, db_session, seed_trip):
    trip, _driver = seed_trip
    org = Organization(id=uuid.uuid4(), name="Other Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    other_driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Other",
        id_number="8001015009088", phone_number="+27820000000", license_number="DRV-X",
    )
    db_session.add(other_driver)
    await db_session.flush()

    token = make_token(sub=str(other_driver.id), role="driver")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/checkpoints",
        json={"checkpoint_type": "manual"},
        headers=auth_header(token),
    )
    assert resp.status_code == 403


async def test_checkpoint_replay_preserves_validated_phase_context(client: AsyncClient, db_session, seed_trip):
    """A retry returns the same evidence rather than today's phase assignment."""
    trip, driver = seed_trip
    phase = PhaseEvent(
        trip_id=trip.id, phase_type=PhaseType.IN_TRANSIT,
        sequence_number=4, status=PhaseStatus.PENDING,
    )
    db_session.add(phase)
    await db_session.flush()
    token = make_token(sub=str(driver.id), role="driver")
    report_id = str(uuid.uuid4())
    payload = {
        "checkpoint_type": "manual", "client_report_id": report_id,
        "phase_event_id": str(phase.id),
        "driver_phone_lat": -26.0942, "driver_phone_lng": 28.1342,
        "driver_captured_at": "2026-09-15T10:00:00Z", "driver_accuracy_metres": 5,
    }

    first = await client.post(
        f"/api/v1/trips/{trip.id}/checkpoints", json=payload, headers=auth_header(token),
    )
    assert first.status_code == 201
    phase.status = PhaseStatus.COMPLETED
    await db_session.flush()
    replay = await client.post(
        f"/api/v1/trips/{trip.id}/checkpoints", json=payload, headers=auth_header(token),
    )

    assert replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]
    assert replay.json()["phase_event_id"] == str(phase.id)
    rows = (await db_session.execute(select(Checkpoint).where(Checkpoint.trip_id == trip.id))).scalars().all()
    assert len(rows) == 1
    assert rows[0].phase_event_id == phase.id


async def test_checkpoint_client_report_ids_and_foreign_evidence_are_scoped(
    client: AsyncClient, db_session, seed_trip,
):
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    first = await client.post(
        f"/api/v1/trips/{trip.id}/checkpoints",
        json={"checkpoint_type": "manual", "client_report_id": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    second = await client.post(
        f"/api/v1/trips/{trip.id}/checkpoints",
        json={"checkpoint_type": "manual", "client_report_id": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]

    other_trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-FOREIGN-CKPT", order_number="ORD-FOREIGN-CKPT",
        operator_organization_id=trip.operator_organization_id,
        client_organization_id=trip.client_organization_id, driver_id=trip.driver_id,
        horse_id=trip.horse_id, origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id, status=TripStatus.ACTIVE,
        idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=trip.created_by_user_id,
    )
    db_session.add(other_trip)
    await db_session.flush()
    foreign_artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=other_trip.id, artifact_type="photo",
        s3_key=f"foreign/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg", captured_at=datetime.now(UTC),
    )
    db_session.add(foreign_artifact)
    await db_session.flush()
    rejected = await client.post(
        f"/api/v1/trips/{trip.id}/checkpoints",
        json={"checkpoint_type": "manual", "selfie_artifact_id": str(foreign_artifact.id)},
        headers=auth_header(token),
    )
    assert rejected.status_code == 404


async def _seed_committed_checkpoint_race_world(session: AsyncSession) -> dict[str, uuid.UUID]:
    """Create parent rows that independent racing sessions can both observe."""
    suffix = uuid.uuid4().hex[:8]
    org = Organization(id=uuid.uuid4(), name=f"Checkpoint race {suffix}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name=f"Client race {suffix}", org_type=OrganizationType.PRINCIPAL)
    session.add_all([org, client_org])
    await session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"race-{suffix}@test.co.za", full_name="Race dispatcher")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Race driver",
        id_number="8001015009087", phone_number="+27821234567", license_number=f"RACE-{suffix}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"RC{suffix[:6].upper()}", pulsit_device_id=f"PUL-{suffix}",
    )
    origin = Precinct(id=uuid.uuid4(), name="Race origin", principal_organization_id=client_org.id, latitude="0", longitude="0")
    destination = Precinct(id=uuid.uuid4(), name="Race destination", principal_organization_id=client_org.id, latitude="1", longitude="1")
    session.add_all([user, driver, horse, origin, destination])
    await session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-CKPT-RACE-{suffix}", order_number=f"ORD-CKPT-{suffix}",
        operator_organization_id=org.id, client_organization_id=client_org.id, driver_id=driver.id,
        horse_id=horse.id, origin_precinct_id=origin.id, destination_precinct_id=destination.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=user.id,
    )
    session.add(trip)
    await session.commit()
    return {"org_id": org.id, "client_org_id": client_org.id, "user_id": user.id, "driver_id": driver.id,
            "horse_id": horse.id, "origin_id": origin.id, "destination_id": destination.id, "trip_id": trip.id}


async def _delete_committed_checkpoint_race_world(session: AsyncSession, ids: dict[str, uuid.UUID]) -> None:
    await session.execute(delete(TripException).where(TripException.trip_id == ids["trip_id"]))
    await session.execute(delete(Checkpoint).where(Checkpoint.trip_id == ids["trip_id"]))
    await session.execute(delete(Trip).where(Trip.id == ids["trip_id"]))
    await session.execute(delete(Precinct).where(Precinct.id.in_([ids["origin_id"], ids["destination_id"]])))
    await session.execute(delete(Vehicle).where(Vehicle.id == ids["horse_id"]))
    await session.execute(delete(Driver).where(Driver.id == ids["driver_id"]))
    await session.execute(delete(User).where(User.id == ids["user_id"]))
    await session.execute(delete(Organization).where(Organization.id.in_([ids["org_id"], ids["client_org_id"]])))
    await session.commit()


async def test_concurrent_checkpoint_replay_keeps_one_checkpoint_and_one_separation_finding(
    test_engine, monkeypatch,
):
    """Two sessions cross the real replay lookup together and recover the unique race.

    The barrier sits immediately after the actual first existence SELECT: both sessions
    have observed no checkpoint, so the loser must recover the database uniqueness race
    rather than merely taking the ordinary sequential replay branch.
    """
    async with AsyncSession(test_engine, expire_on_commit=False) as seed_session:
        ids = await _seed_committed_checkpoint_race_world(seed_session)

    barrier = asyncio.Barrier(2)
    lookup_calls = 0
    original_lookup = checkpoint_service._find_by_client_report_id

    async def synchronized_lookup(*args, **kwargs):
        nonlocal lookup_calls
        existing = await original_lookup(*args, **kwargs)
        if lookup_calls < 2:
            lookup_calls += 1
            await barrier.wait()
        return existing

    captured_at = datetime.now(UTC)
    horse_fix = PulsitFix(
        device_id="race-device", status=PulsitFixStatus.OK, source=PulsitFixSource.MOCK,
        lat=Decimal("0"), lng=Decimal("0"), fixed_at=captured_at,
    )

    async def fixed_corroboration(*_args, **_kwargs):
        return horse_fix

    monkeypatch.setattr(checkpoint_service, "_find_by_client_report_id", synchronized_lookup)
    monkeypatch.setattr(checkpoint_service, "record_checkpoint_corroboration", fixed_corroboration)
    payload = DriverCheckpointCreateBody(
        checkpoint_type="manual", client_report_id=uuid.uuid4(),
        driver_phone_lat=10, driver_phone_lng=10, driver_captured_at=captured_at,
        driver_accuracy_metres=5,
    )

    async def attempt() -> uuid.UUID:
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            result = await checkpoint_service.log_checkpoint(
                session, trip_id=ids["trip_id"], driver_id=ids["driver_id"], payload=payload,
            )
            await session.commit()
            return result.id

    try:
        first_id, second_id = await asyncio.gather(attempt(), attempt())
        assert first_id == second_id
        async with AsyncSession(test_engine, expire_on_commit=False) as verify_session:
            checkpoints = (await verify_session.execute(
                select(Checkpoint).where(Checkpoint.trip_id == ids["trip_id"]),
            )).scalars().all()
            findings = (await verify_session.execute(
                select(TripException).where(
                    TripException.trip_id == ids["trip_id"],
                    TripException.exception_type == ExceptionType.DRIVER_VEHICLE_SEPARATION,
                ),
            )).scalars().all()
        assert len(checkpoints) == 1
        assert len(findings) == 1
        assert findings[0].checkpoint_id == checkpoints[0].id
    finally:
        async with AsyncSession(test_engine, expire_on_commit=False) as cleanup_session:
            await _delete_committed_checkpoint_race_world(cleanup_session, ids)
