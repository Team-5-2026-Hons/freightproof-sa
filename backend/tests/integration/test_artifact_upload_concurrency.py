"""Attributed uploads under real concurrency.

Separate module and separate from the shared `db_session` fixture, for the reason
test_handover_token_concurrency.py gives: that fixture binds every session to one outer
connection, so two sessions drawn from it share a transaction and can never race. Here each
call gets its own connection against committed rows, so the partial unique index on
(phase_event_id, evidence_role, file_hash) and the timestamps are exercised for real.
Storage is faked in every test; nothing leaves the process.
"""

import asyncio
import hashlib
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import RealtimeKind
from app.db.models.enums import (
    ArtifactType, EvidenceRole, IdvsStatus, OrganizationType, PhaseStatus, PhaseType,
    TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.evidence.artifacts import create_artifact
from app.orchestration.evidence.attribution import EvidenceAttribution
from app.storage.supabase_storage import UploadResult

_OUTBOX_KEY = "realtime_outbox"
_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01" + b"\x00" * 32


async def _seed(session: AsyncSession) -> dict:
    """Committed operator org, driver, running trip and a loading phase."""
    tag = uuid.uuid4().hex[:8]
    org = Organization(id=uuid.uuid4(), name=f"Op-{tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name=f"Cl-{tag}", org_type=OrganizationType.PRINCIPAL)
    session.add_all([org, client_org])
    await session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"u-{tag}@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver", id_number="8001015009087",
        phone_number="+27821234567", license_number=f"DRV-{tag}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"UC{tag.upper()[:6]}", pulsit_device_id=f"PUL-{tag}",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    session.add_all([user, driver, horse, origin, dest])
    await session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-UC-{tag}", order_number=f"ORD-{tag}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=user.id,
    )
    session.add(trip)
    await session.flush()
    phase = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, phase_type=PhaseType.LOADING,
        sequence_number=1, status=PhaseStatus.PENDING,
    )
    session.add(phase)
    await session.commit()
    return {
        "org_id": org.id, "client_org_id": client_org.id, "user_id": user.id,
        "driver_id": driver.id, "horse_id": horse.id,
        "origin_id": origin.id, "dest_id": dest.id, "trip_id": trip.id, "phase_id": phase.id,
    }


async def _teardown(session: AsyncSession, ids: dict) -> None:
    await session.execute(delete(EvidenceArtifact).where(EvidenceArtifact.trip_id == ids["trip_id"]))
    await session.execute(delete(PhaseEvent).where(PhaseEvent.id == ids["phase_id"]))
    await session.execute(delete(Trip).where(Trip.id == ids["trip_id"]))
    await session.execute(delete(Precinct).where(Precinct.id.in_([ids["origin_id"], ids["dest_id"]])))
    await session.execute(delete(Vehicle).where(Vehicle.id == ids["horse_id"]))
    await session.execute(delete(Driver).where(Driver.id == ids["driver_id"]))
    await session.execute(delete(User).where(User.id == ids["user_id"]))
    await session.execute(delete(Organization).where(Organization.id.in_([ids["org_id"], ids["client_org_id"]])))
    await session.commit()


@pytest_asyncio.fixture
async def seeded(test_engine):
    async with AsyncSession(test_engine, expire_on_commit=False) as session:
        ids = await _seed(session)
    try:
        yield ids
    finally:
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            await _teardown(session, ids)


def _install_storage(
    monkeypatch: pytest.MonkeyPatch, *, during_upload: Callable[[], Awaitable[None]] | None = None,
) -> None:
    async def fake_upload(*, trip_id, file_bytes, mime_type):
        if during_upload is not None:
            await during_upload()
        return UploadResult(
            s3_bucket="evidence-artifacts", s3_key=f"{trip_id}/{uuid.uuid4()}",
            file_hash=hashlib.sha256(file_bytes).hexdigest(),
        )

    monkeypatch.setattr("app.orchestration.evidence.artifacts.upload_evidence_file", fake_upload)


async def _upload(test_engine, ids: dict, photo: bytes) -> tuple[uuid.UUID, list]:
    """One upload on its own connection; returns the artifact id and the events it queued."""
    async with AsyncSession(test_engine, expire_on_commit=False) as session:
        result = await create_artifact(
            session, trip_id=ids["trip_id"], file_bytes=photo, mime_type="image/jpeg",
            artifact_type=ArtifactType.PHOTO, captured_at=datetime.now(UTC),
            captured_by_driver_id=ids["driver_id"],
            attribution=EvidenceAttribution(phase_event_id=ids["phase_id"], role=EvidenceRole.LINEHAUL_PHOTO),
        )
        queued = [
            event for _org, event in session.info.get(_OUTBOX_KEY, [])
            if event.kind == RealtimeKind.EVIDENCE_UPLOADED
        ]
        await session.commit()
        return result.id, queued


async def _rows(test_engine, ids: dict) -> list[EvidenceArtifact]:
    async with AsyncSession(test_engine, expire_on_commit=False) as session:
        result = await session.execute(select(EvidenceArtifact).where(EvidenceArtifact.trip_id == ids["trip_id"]))
        return list(result.scalars().all())


def _both_reach_storage_first(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hold each caller inside Storage until both are there, so neither can see the other's
    row at its duplicate lookup and both reach the INSERT."""
    barrier = asyncio.Barrier(2)

    async def meet() -> None:
        await barrier.wait()

    _install_storage(monkeypatch, during_upload=meet)


async def test_two_simultaneous_identical_uploads_store_one_row(test_engine, seeded, monkeypatch):
    _both_reach_storage_first(monkeypatch)

    (first_id, first_events), (second_id, second_events) = await asyncio.gather(
        _upload(test_engine, seeded, _JPEG), _upload(test_engine, seeded, _JPEG),
    )

    assert first_id == second_id
    assert len(await _rows(test_engine, seeded)) == 1
    assert len(first_events) + len(second_events) == 1


async def test_simultaneous_retake_and_original_store_two_rows(test_engine, seeded, monkeypatch):
    _both_reach_storage_first(monkeypatch)

    (first_id, first_events), (second_id, second_events) = await asyncio.gather(
        _upload(test_engine, seeded, _JPEG), _upload(test_engine, seeded, _JPEG + b"\x01"),
    )

    assert first_id != second_id
    assert len(await _rows(test_engine, seeded)) == 2
    assert len(first_events) + len(second_events) == 2


async def test_upload_paused_across_cancellation_is_recorded_after_it(test_engine, seeded, monkeypatch):
    """Cancellation commits while the file is still in Storage. The artifact must read as
    received AFTER the cancellation, which a transaction-start default would get wrong."""
    cancelled_at: list[datetime] = []

    async def cancel_trip_on_another_connection() -> None:
        async with AsyncSession(test_engine) as other:
            moment = datetime.now(UTC)
            await other.execute(
                update(Trip).where(Trip.id == seeded["trip_id"])
                .values(status=TripStatus.CANCELLED, closed_at=moment)
            )
            await other.commit()
            cancelled_at.append(moment)

    _install_storage(monkeypatch, during_upload=cancel_trip_on_another_connection)

    await _upload(test_engine, seeded, _JPEG)

    [row] = await _rows(test_engine, seeded)
    assert row.created_at > cancelled_at[0]


async def test_upload_paused_across_override_is_recorded_after_it(test_engine, seeded, monkeypatch):
    overridden_at: list[datetime] = []

    async def override_phase_on_another_connection() -> None:
        async with AsyncSession(test_engine) as other:
            moment = datetime.now(UTC)
            await other.execute(
                update(PhaseEvent).where(PhaseEvent.id == seeded["phase_id"])
                .values(status=PhaseStatus.OVERRIDDEN, completed_at=moment)
            )
            await other.commit()
            overridden_at.append(moment)

    _install_storage(monkeypatch, during_upload=override_phase_on_another_connection)

    await _upload(test_engine, seeded, _JPEG)

    [row] = await _rows(test_engine, seeded)
    assert row.created_at > overridden_at[0]
