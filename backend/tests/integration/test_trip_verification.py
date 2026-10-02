"""Verification of the journey lock against live rows (FP-281, spec §9).

Hedera submission is stubbed by tests/integration/conftest.py; the mirror node is
stubbed here — these tests are about the DB side of verification."""

from httpx import AsyncClient
from collections.abc import AsyncIterator
from tests.integration._pp_manifest_world import ManifestWorld

import uuid
from datetime import UTC, datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import SubjectType, VerifyStatus
from app.db.models.trips import Trip
from app.db.session import get_db
from app.main import app
from app.orchestration.verification_service import verify_subject
from tests.integration._pp_manifest_world import build_manifest_world


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


def _verified_mirror() -> MagicMock:
    service = MagicMock()
    service.verify_hash.return_value = True
    return service


def _empty_leg(world: ManifestWorld, *, planned_departure_at: str) -> dict:
    return {
        "driver_id": str(world.driver.id),
        "horse_id": str(world.horse.id),
        "trailer_ids": [],
        "origin_precinct_id": str(world.cape_town.id),
        "destination_precinct_id": str(world.johannesburg.id),
        "trip_type": "empty_leg",
        "planned_departure_at": planned_departure_at,
    }


async def _create(client: AsyncClient, world: ManifestWorld, departure: str) -> uuid.UUID:
    resp = await client.post(
        "/api/v1/trips", json=_empty_leg(world, planned_departure_at=departure),
        headers=world.headers(),
    )
    assert resp.status_code == 201, resp.text
    return uuid.UUID(resp.json()["id"])


async def _verify(db_session: AsyncSession, trip_id: uuid.UUID) -> VerifyStatus:
    # Read back from Postgres, not the identity map — that is what verification meets.
    db_session.expire_all()
    outcome = await verify_subject(
        db_session, subject_type=SubjectType.TRIP, subject_id=trip_id,
        hedera_service=_verified_mirror(),
    )
    return outcome.status


async def test_new_trip_verifies(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip_id = await _create(client, world, datetime.now(UTC).isoformat())

    status = await _verify(db_session, trip_id)

    assert status == VerifyStatus.VERIFIED


async def test_trip_with_offset_departure_verifies(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    sast = timezone(timedelta(hours=2))
    trip_id = await _create(client, world, datetime.now(sast).isoformat())

    status = await _verify(db_session, trip_id)

    assert status == VerifyStatus.VERIFIED


async def test_edited_planned_departure_fails_verification(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip_id = await _create(client, world, datetime.now(UTC).isoformat())
    trip = (await db_session.execute(select(Trip).where(Trip.id == trip_id))).scalar_one()
    assert trip.planned_departure_at is not None
    trip.planned_departure_at = trip.planned_departure_at + timedelta(hours=1)
    await db_session.flush()

    status = await _verify(db_session, trip_id)

    assert status == VerifyStatus.DB_MISMATCH
