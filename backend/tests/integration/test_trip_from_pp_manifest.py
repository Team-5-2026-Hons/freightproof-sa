"""Create a loaded trip from a PP manifest (FP-281, spec §10.2, §15)."""

from httpx import AsyncClient
from collections.abc import AsyncIterator
from tests.conftest import FakeMockStateStore
from tests.integration._pp_manifest_world import ManifestWorld
from pytest import MonkeyPatch
from httpx import Response

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.crypto.hashing import compute_snapshot_sha256
from app.db.models.enums import ParcelStatus, PhaseType, SubjectType, VerifyStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Parcel, Trip
from app.db.session import get_db
from app.integrations.parcel_perfect import (
    MANIFEST_HAPPY_PATH, MANIFEST_NO_WAYBILLS, MANIFEST_OPEN_NO_TIMES, MockParcelPerfectClient,
)
from app.main import app
from app.orchestration.consignment_service import fetch_and_sync_consignment
from app.orchestration.trip_service import cancel_trip
from app.orchestration.verification_service import verify_subject
from tests.conftest import auth_header
from tests.integration._pp_manifest_world import (
    MOCK_CLIENT_NAME, build_manifest_world, create_body, install_pp_mock, preview,
)

_CREATE = "/api/v1/trips/from-pp-manifest"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def pp_mock(monkeypatch: MonkeyPatch) -> FakeMockStateStore:
    return install_pp_mock(monkeypatch)


async def _verify(db_session: AsyncSession, trip_id: uuid.UUID) -> VerifyStatus:
    mirror = MagicMock()
    mirror.verify_hash.return_value = True
    db_session.expire_all()  # read back from Postgres (Review Focus 1)
    outcome = await verify_subject(
        db_session, subject_type=SubjectType.TRIP, subject_id=trip_id, hedera_service=mirror,
    )
    return outcome.status


async def _trip_count(db_session: AsyncSession, world: ManifestWorld) -> int:
    return (await db_session.execute(
        select(func.count(Trip.id)).where(Trip.operator_organization_id == world.operator.id)
    )).scalar_one()


async def _create(client: AsyncClient, world: ManifestWorld, number: int, **overrides: object) -> Response:
    body = create_body(world, await preview(client, world, number), **overrides)
    return await client.post(_CREATE, json=body, headers=world.headers())


async def test_create_persists_a_manifest_trip(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    previewed = await preview(client, world, MANIFEST_HAPPY_PATH)

    resp = await client.post(_CREATE, json=create_body(world, previewed), headers=world.headers())

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["pp_manifest"]["display"] == f"{MOCK_CLIENT_NAME} · CPT {MANIFEST_HAPPY_PATH}"
    assert body["trip_type"] == "loaded"
    assert body["planned_departure_at"] == previewed["planned_departure_at"]
    trip = (await db_session.execute(select(Trip).where(Trip.id == uuid.UUID(body["id"])))).scalar_one()
    assert trip.pp_manifest_number == MANIFEST_HAPPY_PATH
    assert trip.client_organization_id == world.client.id
    refs = (await db_session.execute(
        select(Consignment.parcel_perfect_reference).where(Consignment.trip_id == trip.id)
    )).scalars().all()
    assert sorted(refs) == ["MFTWB8101", "MFTWB8102", "MFTWB8103"]
    h0 = (await db_session.execute(select(PhaseEvent).where(
        PhaseEvent.trip_id == trip.id, PhaseEvent.phase_type == PhaseType.TRIP_CREATION,
    ))).scalar_one()
    assert h0.parcel_manifest_snapshot is not None
    assert compute_snapshot_sha256(h0.parcel_manifest_snapshot) == previewed["snapshot_sha256"]


async def test_created_trip_verifies_and_an_edited_snapshot_does_not(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    resp = await _create(client, world, MANIFEST_HAPPY_PATH)
    trip_id = uuid.UUID(resp.json()["id"])
    assert await _verify(db_session, trip_id) == VerifyStatus.VERIFIED

    h0 = (await db_session.execute(select(PhaseEvent).where(
        PhaseEvent.trip_id == trip_id, PhaseEvent.phase_type == PhaseType.TRIP_CREATION,
    ))).scalar_one()
    assert h0.parcel_manifest_snapshot is not None
    edited = dict(h0.parcel_manifest_snapshot)
    edited["waybills"] = edited["waybills"][1:]  # quietly drop a waybill
    h0.parcel_manifest_snapshot = edited
    await db_session.flush()

    assert await _verify(db_session, trip_id) == VerifyStatus.DB_MISMATCH


async def test_an_edited_locked_field_fails_verification(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip_id = uuid.UUID((await _create(client, world, MANIFEST_HAPPY_PATH)).json()["id"])
    trip = (await db_session.execute(select(Trip).where(Trip.id == trip_id))).scalar_one()
    trip.pp_manifest_origin_hub = "JNB"
    await db_session.flush()

    assert await _verify(db_session, trip_id) == VerifyStatus.DB_MISMATCH


async def test_pp_poll_after_creation_keeps_verification(client: AsyncClient, db_session: AsyncSession) -> None:
    """§10.6: the poll may add parcels; the H0 snapshot and the lock do not move."""
    world = await build_manifest_world(db_session)
    trip_id = uuid.UUID((await _create(client, world, MANIFEST_HAPPY_PATH)).json()["id"])
    await MockParcelPerfectClient().stage_waybill_override("MFTWB8101", parcel_count=9)

    await fetch_and_sync_consignment(db_session, "MFTWB8101", trip_id=trip_id)

    assert await _verify(db_session, trip_id) == VerifyStatus.VERIFIED


async def test_create_requires_a_valid_token(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    body = create_body(world, await preview(client, world, MANIFEST_HAPPY_PATH))

    resp = await client.post(_CREATE, json=body, headers=auth_header("not-a-jwt"))

    assert resp.status_code == 401


async def test_unknown_manifest_is_404(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    body = create_body(world, await preview(client, world, MANIFEST_HAPPY_PATH), manifest_number=99999)

    resp = await client.post(_CREATE, json=body, headers=world.headers())

    assert resp.status_code == 404


async def test_overlong_manifest_number_is_422(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    body = create_body(world, await preview(client, world, MANIFEST_HAPPY_PATH), manifest_number=2_147_483_648)

    resp = await client.post(_CREATE, json=body, headers=world.headers())

    assert resp.status_code == 422
    assert await _trip_count(db_session, world) == 0


async def test_live_pp_is_501(client: AsyncClient, db_session: AsyncSession, monkeypatch: MonkeyPatch) -> None:
    world = await build_manifest_world(db_session)
    body = create_body(world, await preview(client, world, MANIFEST_HAPPY_PATH))
    monkeypatch.setattr(settings, "PP_USE_MOCK", False)

    resp = await client.post(_CREATE, json=body, headers=world.headers())

    assert resp.status_code == 501


async def test_naive_datetime_is_rejected(client: AsyncClient, db_session: AsyncSession) -> None:
    """Review Focus 2: a zone-less time must not silently shift the lock."""
    world = await build_manifest_world(db_session)

    resp = await _create(client, world, MANIFEST_HAPPY_PATH, planned_departure_at="2026-10-01T20:00:00")

    assert resp.status_code == 422
    assert await _trip_count(db_session, world) == 0


@pytest.mark.parametrize(("number", "code"), [
    (70, "WAYBILL_CLIENT_MISMATCH"),
    (MANIFEST_NO_WAYBILLS, "NO_WAYBILLS"),
    (69, "PRECINCT_REQUIRED"),               # DUR unlinked and no precinct chosen
    (MANIFEST_OPEN_NO_TIMES, "NO_PLANNED_DEPARTURE"),
])
async def test_unusable_manifest_is_422(client: AsyncClient, db_session: AsyncSession, number: int, code: str) -> None:
    world = await build_manifest_world(db_session)

    resp = await _create(client, world, number)

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == code
    assert await _trip_count(db_session, world) == 0


async def test_unlinked_client_is_422(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session, client_account="OTHER1")

    resp = await _create(client, world, MANIFEST_HAPPY_PATH)

    assert resp.json()["detail"]["code"] == "CLIENT_NOT_LINKED"


async def test_invalid_schedule_is_422(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    departure = datetime.now(UTC)

    resp = await _create(
        client, world, MANIFEST_HAPPY_PATH,
        planned_departure_at=departure.isoformat(),
        planned_arrival_at=(departure - timedelta(hours=1)).isoformat(),
    )

    assert resp.json()["detail"]["code"] == "SCHEDULE_INVALID"


async def test_unlinked_destination_with_a_chosen_precinct_is_created(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)

    resp = await _create(client, world, 69, destination_precinct_id=str(world.durban.id))

    assert resp.status_code == 201, resp.text
    assert resp.json()["destination_precinct_id"] == str(world.durban.id)


async def test_a_private_client_precinct_cannot_be_chosen(client: AsyncClient, db_session: AsyncSession) -> None:
    """SEC-PRECINCT-1 on the write side: the dispatcher's pick must be one they can see."""
    world = await build_manifest_world(db_session, shared=False)

    resp = await _create(
        client, world, MANIFEST_HAPPY_PATH,
        origin_precinct_id=str(world.cape_town.id),
        destination_precinct_id=str(world.johannesburg.id),
    )

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "PRECINCT_NOT_AVAILABLE"
    assert await _trip_count(db_session, world) == 0


async def test_missing_times_entered_by_the_dispatcher_are_created(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    departure = datetime.now(UTC) + timedelta(hours=2)

    resp = await _create(
        client, world, MANIFEST_OPEN_NO_TIMES,
        planned_departure_at=departure.isoformat(),
        planned_arrival_at=(departure + timedelta(hours=10)).isoformat(),
    )

    assert resp.status_code == 201, resp.text


async def test_second_create_for_one_manifest_is_409(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    first = await _create(client, world, MANIFEST_HAPPY_PATH)

    second = await _create(client, world, MANIFEST_HAPPY_PATH)

    assert second.status_code == 409, second.text
    assert second.json()["detail"]["code"] == "MANIFEST_ALREADY_ON_TRIP"
    assert second.json()["detail"]["trip_reference"] == first.json()["trip_reference"]


async def test_manifest_changed_since_preview_is_409_with_a_fresh_preview(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    previewed = await preview(client, world, MANIFEST_HAPPY_PATH)
    await MockParcelPerfectClient().stage_manifest_override(
        MANIFEST_HAPPY_PATH, planned_departure_at=datetime.now(UTC) + timedelta(hours=5),
    )

    resp = await client.post(_CREATE, json=create_body(world, previewed), headers=world.headers())

    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "MANIFEST_CHANGED"
    assert detail["preview"]["snapshot_sha256"] != previewed["snapshot_sha256"]
    assert await _trip_count(db_session, world) == 0


async def test_cancel_and_recreate_before_scanning(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    first_id = uuid.UUID((await _create(client, world, MANIFEST_HAPPY_PATH)).json()["id"])
    await cancel_trip(
        db_session, trip_id=first_id, operator_organization_id=world.operator.id,
        user_id=world.user.id, note="Horse broke down at the depot",
    )

    second = await _create(client, world, MANIFEST_HAPPY_PATH)

    assert second.status_code == 201, second.text
    second_id = uuid.UUID(second.json()["id"])
    holders = (await db_session.execute(
        select(Consignment.trip_id).where(Consignment.parcel_perfect_reference.like("MFTWB81%"))
    )).scalars().all()
    assert set(holders) == {second_id}
    assert await _verify(db_session, first_id) == VerifyStatus.VERIFIED


async def test_cancel_after_scanning_refuses_recreation(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    first_id = uuid.UUID((await _create(client, world, MANIFEST_HAPPY_PATH)).json()["id"])
    parcel = (await db_session.execute(
        select(Parcel).join(Consignment, Consignment.id == Parcel.consignment_id)
        .where(Consignment.trip_id == first_id).limit(1)
    )).scalar_one()
    parcel.pp_scan_out_at = datetime.now(UTC)
    parcel.status = ParcelStatus.SCANNED_OUT
    await cancel_trip(
        db_session, trip_id=first_id, operator_organization_id=world.operator.id,
        user_id=world.user.id, note="Loaded, then the horse broke down",
    )
    await db_session.flush()
    previewed = await preview(client, world, MANIFEST_HAPPY_PATH)
    assert previewed["can_create"] is False

    resp = await client.post(_CREATE, json=create_body(world, previewed), headers=world.headers())

    assert resp.status_code == 409, resp.text
    assert "scanned" in resp.json()["detail"]
