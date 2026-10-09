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
from app.crypto.hashing import compute_journey_lock_hash, compute_trip_canonical_payload
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.trips import Trip, TripStop, TripTrailer
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


def _three_stop_empty_leg(world: ManifestWorld, departure: str) -> dict:
    payload = _empty_leg(world, planned_departure_at=departure)
    del payload["origin_precinct_id"], payload["destination_precinct_id"]
    payload["stops"] = [
        {"precinct_id": str(world.cape_town.id), "sequence": 0},
        {"precinct_id": str(world.durban.id), "sequence": 1},
        {"precinct_id": str(world.johannesburg.id), "sequence": 2},
    ]
    return payload


async def _create_multi_stop(client: AsyncClient, world: ManifestWorld) -> uuid.UUID:
    resp = await client.post(
        "/api/v1/trips", json=_three_stop_empty_leg(world, datetime.now(UTC).isoformat()),
        headers=world.headers(),
    )
    assert resp.status_code == 201, resp.text
    return uuid.UUID(resp.json()["id"])


async def test_multi_stop_trip_verifies(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip_id = await _create_multi_stop(client, world)

    status = await _verify(db_session, trip_id)

    assert status == VerifyStatus.VERIFIED


async def test_changed_intermediate_stop_precinct_fails_verification(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    world = await build_manifest_world(db_session)
    trip_id = await _create_multi_stop(client, world)
    middle = (await db_session.execute(
        select(TripStop).where(TripStop.trip_id == trip_id, TripStop.sequence == 1)
    )).scalar_one()
    middle.precinct_id = world.johannesburg.id
    await db_session.flush()

    status = await _verify(db_session, trip_id)

    assert status == VerifyStatus.DB_MISMATCH


async def _anchored_receipt(db_session: AsyncSession, trip_id: uuid.UUID) -> BlockchainReceipt:
    return (await db_session.execute(
        select(BlockchainReceipt).where(
            BlockchainReceipt.subject_id == trip_id, BlockchainReceipt.subject_type == SubjectType.TRIP,
        )
    )).scalar_one()


async def test_receipt_without_payload_version_cannot_verify_a_v2_trip(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """Reading the version from the stored payload must not let it be edited down to v1."""
    world = await build_manifest_world(db_session)
    trip_id = await _create_multi_stop(client, world)
    receipt = await _anchored_receipt(db_session, trip_id)
    receipt.payload_json = {k: v for k, v in receipt.payload_json.items() if k != "payload_version"}
    await db_session.flush()

    status = await _verify(db_session, trip_id)

    assert status == VerifyStatus.DB_MISMATCH


async def test_unsupported_payload_version_is_an_error_not_a_match(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    world = await build_manifest_world(db_session)
    trip_id = await _create_multi_stop(client, world)
    receipt = await _anchored_receipt(db_session, trip_id)
    receipt.payload_json = {**receipt.payload_json, "payload_version": 3}
    await db_session.flush()

    status = await _verify(db_session, trip_id)

    assert status == VerifyStatus.ERROR


async def test_v1_receipt_still_verifies(client: AsyncClient, db_session: AsyncSession) -> None:
    """A trip anchored before stops were committed: a v1 receipt over the same live rows."""
    world = await build_manifest_world(db_session)
    trip_id = await _create_multi_stop(client, world)
    trip = (await db_session.execute(select(Trip).where(Trip.id == trip_id))).scalar_one()
    assert trip.origin_precinct_id is not None and trip.destination_precinct_id is not None
    trailers = (await db_session.execute(
        select(TripTrailer.trailer_id).where(TripTrailer.trip_id == trip_id)
    )).scalars().all()
    v1_payload = compute_trip_canonical_payload(
        trip_id=trip.id, driver_id=trip.driver_id, horse_id=trip.horse_id, trailer_ids=list(trailers),
        origin_precinct_id=trip.origin_precinct_id, destination_precinct_id=trip.destination_precinct_id,
        created_by_user_id=trip.created_by_user_id, created_at=trip.created_at, trip_type=trip.trip_type,
        pp_manifest=None, pp_manifest_snapshot_sha256=None,
        planned_departure_at=trip.planned_departure_at, planned_arrival_at=trip.planned_arrival_at,
    )
    receipt = await _anchored_receipt(db_session, trip_id)
    receipt.payload_json = v1_payload
    receipt.data_hash = compute_journey_lock_hash(v1_payload)
    await db_session.flush()

    status = await _verify(db_session, trip_id)

    assert status == VerifyStatus.VERIFIED
