"""persist_trip writes a manifest trip through the same evidence path as POST /trips."""

from sqlalchemy.ext.asyncio import AsyncSession
from tests.integration._pp_manifest_world import ManifestWorld
from typing import NoReturn

from datetime import datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.exceptions import PPManifestAlreadyOnTripError
from app.crypto.hashing import compute_snapshot_sha256
from app.db.models.enums import PhaseType, SubjectType, TripType, VerifyStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Parcel, Trip
from app.integrations import parcel_perfect as pp_module
from app.integrations.parcel_perfect import MANIFEST_HAPPY_PATH, MockParcelPerfectClient
from app.orchestration import consignment_service
from app.orchestration.pp_manifest import manifest_key, manifest_snapshot
from app.orchestration.trip_service import ManifestCargo, NewTrip, persist_trip
from app.orchestration.verification_service import verify_subject
from app.schemas.trips import TripStopCreate
from tests.integration._pp_manifest_world import (
    MOCK_CLIENT_NAME, build_manifest_world, insert_trip,
)


@pytest.fixture(autouse=True)
def pp_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", False)
    monkeypatch.setattr(settings, "PP_USE_MOCK", True)
    pinned = datetime.now(pp_module.pp_timezone()).date()
    monkeypatch.setattr(pp_module, "_operations_today", lambda: pinned)

    def _no_second_pull() -> NoReturn:
        raise AssertionError("a manifest trip must sync from the manifest's waybills")
    monkeypatch.setattr(consignment_service, "get_pp_client", _no_second_pull)


async def _new_trip(world: ManifestWorld) -> NewTrip:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)
    snapshot = manifest_snapshot(manifest)
    return NewTrip(
        driver_id=world.driver.id, horse_id=world.horse.id, trailer_ids=[world.trailer.id],
        stops=[
            TripStopCreate(precinct_id=world.cape_town.id, sequence=0),
            TripStopCreate(precinct_id=world.johannesburg.id, sequence=1),
        ],
        trip_type=TripType.LOADED,
        planned_departure_at=manifest.header.planned_departure_at,
        planned_arrival_at=manifest.header.expected_arrival_at,
        manifest=ManifestCargo(
            key=manifest_key(manifest), client_organization_id=world.client.id,
            client_name=world.client.name, waybills=manifest.waybills,
            snapshot=snapshot, snapshot_sha256=compute_snapshot_sha256(snapshot),
        ),
    )


async def test_persist_trip_writes_a_manifest_trip(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    new_trip = await _new_trip(world)

    detail = await persist_trip(db_session, new_trip, world.dispatcher())

    trip = (await db_session.execute(select(Trip).where(Trip.id == detail.id))).scalar_one()
    assert (trip.pp_manifest_issuer_account, trip.pp_manifest_origin_hub, trip.pp_manifest_number) == (
        "MOCK01", "CPT", MANIFEST_HAPPY_PATH,
    )
    assert trip.client_organization_id == world.client.id
    assert trip.order_number is None
    consignments = (await db_session.execute(
        select(Consignment).where(Consignment.trip_id == trip.id)
    )).scalars().all()
    assert sorted(c.parcel_perfect_reference for c in consignments) == ["MFTWB8101", "MFTWB8102", "MFTWB8103"]
    assert all(c.pickup_stop_id is not None and c.delivery_stop_id is not None for c in consignments)
    parcels = (await db_session.execute(
        select(func.count(Parcel.id)).where(Parcel.consignment_id.in_([c.id for c in consignments]))
    )).scalar_one()
    assert parcels == 20
    h0 = (await db_session.execute(select(PhaseEvent).where(
        PhaseEvent.trip_id == trip.id, PhaseEvent.phase_type == PhaseType.TRIP_CREATION,
    ))).scalar_one()
    assert new_trip.manifest is not None
    assert h0.parcel_manifest_snapshot == new_trip.manifest.snapshot
    assert detail.pp_manifest is not None
    assert detail.pp_manifest.display == f"{MOCK_CLIENT_NAME} · CPT {MANIFEST_HAPPY_PATH}"


async def test_persisted_manifest_trip_verifies(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    detail = await persist_trip(db_session, await _new_trip(world), world.dispatcher())
    mirror = MagicMock()
    mirror.verify_hash.return_value = True
    db_session.expire_all()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.TRIP, subject_id=detail.id, hedera_service=mirror,
    )

    assert outcome.status == VerifyStatus.VERIFIED


async def test_losing_the_manifest_index_becomes_a_manifest_conflict(db_session: AsyncSession) -> None:
    """No pre-check inside persist_trip: the index decides, and the violation is translated."""
    world = await build_manifest_world(db_session)
    await insert_trip(db_session, world, number=MANIFEST_HAPPY_PATH)

    with pytest.raises(PPManifestAlreadyOnTripError):
        await persist_trip(db_session, await _new_trip(world), world.dispatcher())
