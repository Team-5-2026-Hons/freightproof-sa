"""Cancel and recreate (FP-281, spec §10.5): a waybill may leave a CANCELLED trip, and
only while none of its parcels carries a scan stamp."""

from typing import Any, NoReturn

import asyncio
import copy
from collections.abc import AsyncIterator
from dataclasses import dataclass
import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.exceptions import ConsignmentAlreadyAssignedError, ConsignmentScannedOnCancelledTripError
from app.db.models.enums import ParcelStatus, TripStatus
from app.db.models.trips import Consignment, Parcel, Trip, TripStop, TripTrailer
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
from app.integrations.parcel_perfect import MOCK_WAYBILLS, PPTrack, PPWaybillResponse
from app.orchestration import consignment_service, scan_service
from app.orchestration.trip_service import ManifestCargo, NewTrip, persist_trip
from app.orchestration.pp_manifest import manifest_key, manifest_snapshot, manifest_snapshot_sha256
from app.integrations.parcel_perfect import MANIFEST_HAPPY_PATH, PPManifestResponse, MockParcelPerfectClient
from app.db.models.enums import TripType
from app.schemas.trips import TripStopCreate
from app.integrations.scan_feed import ScanDirection, ScanEvent
from app.orchestration.consignment_service import sync_consignment_from_waybill
from tests.integration._pp_manifest_world import ManifestWorld, build_manifest_world, insert_trip

_WAYBILL = "MFTWB8101"


def _waybill() -> PPWaybillResponse:
    return copy.deepcopy(MOCK_WAYBILLS[_WAYBILL])


async def _held_by(db_session: AsyncSession, trip: Trip, *, scanned: bool) -> Consignment:
    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=_WAYBILL, parcel_count_expected=1,
    )
    db_session.add(consignment)
    await db_session.flush()
    db_session.add(Parcel(
        id=uuid.uuid4(), consignment_id=consignment.id, barcode=f"{_WAYBILL}0001",
        status=ParcelStatus.SCANNED_OUT if scanned else ParcelStatus.PENDING,
        pp_scan_out_at=datetime.now(UTC) if scanned else None,
    ))
    await db_session.flush()
    return consignment


@pytest.fixture(autouse=True)
def no_pp(monkeypatch: pytest.MonkeyPatch) -> None:
    def _refuse() -> NoReturn:
        raise AssertionError("sync_consignment_from_waybill must not call Parcel Perfect")
    monkeypatch.setattr(consignment_service, "get_pp_client", _refuse)


async def test_sync_from_a_waybill_makes_no_pp_call(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip = await insert_trip(db_session, world, number=None)

    result = await sync_consignment_from_waybill(db_session, _waybill(), trip_id=trip.id)

    assert result.consignment.trip_id == trip.id
    assert result.consignment.client_organization_id == world.client.id


async def test_waybill_moves_off_a_cancelled_unscanned_trip(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    cancelled = await insert_trip(db_session, world, number=None, status=TripStatus.CANCELLED)
    consignment = await _held_by(db_session, cancelled, scanned=False)
    replacement = await insert_trip(db_session, world, number=None)

    result = await sync_consignment_from_waybill(
        db_session, _waybill(), trip_id=replacement.id,
        origin_precinct_id=world.cape_town.id, destination_precinct_id=world.johannesburg.id,
    )

    assert result.consignment.id == consignment.id
    assert result.consignment.trip_id == replacement.id
    assert result.consignment.origin_precinct_id == world.cape_town.id


async def test_scanned_waybill_stays_on_its_cancelled_trip(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    cancelled = await insert_trip(db_session, world, number=None, status=TripStatus.CANCELLED)
    await _held_by(db_session, cancelled, scanned=True)
    replacement = await insert_trip(db_session, world, number=None)

    with pytest.raises(ConsignmentScannedOnCancelledTripError) as exc:
        await sync_consignment_from_waybill(db_session, _waybill(), trip_id=replacement.id)

    assert "scanned" in str(exc.value)
    assert cancelled.trip_reference in str(exc.value)


@pytest.mark.parametrize("status", [TripStatus.CREATED, TripStatus.ACTIVE, TripStatus.CLOSED])
async def test_waybill_on_a_trip_that_is_not_cancelled_is_refused(db_session: AsyncSession, status: TripStatus) -> None:
    world = await build_manifest_world(db_session)
    holder = await insert_trip(db_session, world, number=None, status=status)
    await _held_by(db_session, holder, scanned=False)
    replacement = await insert_trip(db_session, world, number=None)

    with pytest.raises(ConsignmentAlreadyAssignedError) as exc:
        await sync_consignment_from_waybill(db_session, _waybill(), trip_id=replacement.id)

    assert type(exc.value) is ConsignmentAlreadyAssignedError


# These tests catch missing shared row locks, stale identity-map ownership, and
# recreation retaining a cancelled load's expected parcel set or unit count.
@pytest.mark.parametrize("new_units", [None, 2])
async def test_recreation_rebuilds_parcels_and_expected_counts(db_session: AsyncSession, new_units: int | None) -> None:
    world = await build_manifest_world(db_session)
    old = await insert_trip(db_session, world, number=None, status=TripStatus.CANCELLED)
    held = await _held_by(db_session, old, scanned=False)
    held.unit_count_expected = 17
    db_session.add(Parcel(id=uuid.uuid4(), consignment_id=held.id, barcode="OLD-REMOVED", status=ParcelStatus.PENDING))
    await db_session.flush()
    replacement = await insert_trip(db_session, world, number=None)
    fresh = _waybill()
    fresh.tracks = [PPTrack(trackno="NEW-ONLY", parcelno=1, item=1)]
    fresh.details.pieces = 1

    result = await sync_consignment_from_waybill(db_session, fresh, trip_id=replacement.id, unit_count_expected=new_units)
    await db_session.flush()

    parcels = (await db_session.execute(select(Parcel).where(Parcel.consignment_id == held.id))).scalars().all()
    assert [p.barcode for p in parcels] == ["NEW-ONLY"]
    assert all(p.pp_scan_out_at is None and p.pp_scan_in_at is None for p in parcels)
    assert result.consignment.parcel_count_expected == 1
    assert result.consignment.unit_count_expected == new_units


@dataclass(frozen=True)
class ScanRaceWorld:
    sessions: async_sessionmaker[AsyncSession]
    old_id: uuid.UUID
    replacement_id: uuid.UUID
    stop_id: uuid.UUID
    consignment_id: uuid.UUID
    barcode: str
    world: ManifestWorld


@pytest_asyncio.fixture
async def scan_race_world(test_engine: AsyncEngine) -> AsyncIterator[ScanRaceWorld]:
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sessions() as db:
        world = await build_manifest_world(db)
        old = await insert_trip(db, world, number=None, status=TripStatus.CANCELLED)
        replacement = await insert_trip(db, world, number=None)
        stop = TripStop(id=uuid.uuid4(), trip_id=old.id, precinct_id=world.cape_town.id, sequence=0)
        db.add(stop)
        await db.flush()
        held = await _held_by(db, old, scanned=False)
        held.pickup_stop_id = held.delivery_stop_id = stop.id
        await db.commit()
        race = ScanRaceWorld(sessions, old.id, replacement.id, stop.id, held.id, f"{_WAYBILL}0001", world)
    try:
        yield race
    finally:
        async with sessions() as db:
            trip_ids = (await db.execute(select(Trip.id).where(Trip.operator_organization_id == world.operator.id))).scalars().all()
            consignment_ids = (await db.execute(select(Consignment.id).where(Consignment.trip_id.in_(trip_ids)))).scalars().all()
            await db.execute(delete(TripException).where(TripException.trip_id.in_(trip_ids)))
            await db.execute(delete(Parcel).where(Parcel.consignment_id.in_(consignment_ids)))
            await db.execute(delete(Consignment).where(Consignment.id.in_(consignment_ids)))
            await db.execute(delete(PhaseEvent).where(PhaseEvent.trip_id.in_(trip_ids)))
            await db.execute(delete(BlockchainReceipt).where(BlockchainReceipt.trip_id.in_(trip_ids)))
            await db.execute(delete(TripTrailer).where(TripTrailer.trip_id.in_(trip_ids)))
            await db.execute(delete(TripStop).where(TripStop.trip_id.in_(trip_ids)))
            await db.execute(delete(Trip).where(Trip.id.in_(trip_ids)))
            await db.execute(delete(Vehicle).where(Vehicle.organization_id == world.operator.id))
            await db.execute(delete(Driver).where(Driver.organization_id == world.operator.id))
            await db.execute(delete(User).where(User.organization_id == world.operator.id))
            await db.execute(delete(Precinct).where(Precinct.principal_organization_id == world.client.id))
            await db.execute(delete(Organization).where(Organization.id.in_([world.operator.id, world.client.id])))
            await db.commit()


class RaceScanFeed:
    def __init__(self, race: ScanRaceWorld, polled: asyncio.Event, release: asyncio.Event) -> None:
        self.race = race
        self.polled = polled
        self.release = release

    async def poll_scans(self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection) -> list[ScanEvent]:
        assert consignment_reference == _WAYBILL
        assert stop_reference == str(self.race.stop_id)
        self.polled.set()
        await self.release.wait()
        return [ScanEvent(self.race.barcode, direction, datetime.now(UTC), consignment_reference, stop_reference)]


async def _wait_for_lock(sessions: async_sessionmaker[AsyncSession], waiter: int, holder: int) -> None:
    # Observe the real DB wait, not an arbitrary delay that could pass without a lock.
    async with sessions() as observer:
        async with asyncio.timeout(3):
            while True:
                blocking = (await observer.execute(text("SELECT pg_blocking_pids(:pid)"), {"pid": waiter})).scalar_one()
                if holder in blocking:
                    return
                await asyncio.sleep(0.01)


@pytest.mark.parametrize("direction", [ScanDirection.OUT, ScanDirection.IN])
async def test_committed_scan_wins_against_recreation(scan_race_world: ScanRaceWorld, monkeypatch: pytest.MonkeyPatch, direction: ScanDirection) -> None:
    race = scan_race_world
    polled, release = asyncio.Event(), asyncio.Event()
    monkeypatch.setattr(scan_service, "get_scan_feed", lambda: RaceScanFeed(race, polled, release))
    async with race.sessions() as scanner, race.sessions() as mover:
        scanner_pid = (await scanner.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        mover_pid = (await mover.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        # Ownership is cached before the other session stamps: locking reads must refresh it.
        cached = await mover.get(Consignment, race.consignment_id)
        assert cached is not None
        assert cached.trip_id == race.old_id
        async def scan() -> None:
            await scan_service.ingest_scans(scanner, trip_id=race.old_id, trip_stop_id=race.stop_id, direction=direction)
            await scanner.commit()
        scan_task = asyncio.create_task(scan())
        move_task = None
        try:
            async with asyncio.timeout(5):
                await polled.wait()
                move_task = asyncio.create_task(sync_consignment_from_waybill(mover, _waybill(), trip_id=race.replacement_id))
                await _wait_for_lock(race.sessions, mover_pid, scanner_pid)
                release.set()
                await scan_task
                with pytest.raises(ConsignmentScannedOnCancelledTripError):
                    await move_task
        finally:
            release.set()
            for task in [scan_task, move_task]:
                if task is not None and not task.done():
                    task.cancel()
            await asyncio.gather(*(t for t in [scan_task, move_task] if t is not None), return_exceptions=True)
            await mover.rollback()
    async with race.sessions() as reader:
        held = await reader.get(Consignment, race.consignment_id)
        assert held is not None
        parcel = (await reader.execute(select(Parcel).where(Parcel.consignment_id == race.consignment_id))).scalar_one()
        assert held.trip_id == race.old_id
        assert (parcel.pp_scan_out_at if direction is ScanDirection.OUT else parcel.pp_scan_in_at) is not None


@pytest.mark.parametrize("direction", [ScanDirection.OUT, ScanDirection.IN])
async def test_committed_recreation_excludes_old_trip_scan(scan_race_world: ScanRaceWorld, monkeypatch: pytest.MonkeyPatch, direction: ScanDirection) -> None:
    race = scan_race_world
    polled, release = asyncio.Event(), asyncio.Event()
    release.set()
    monkeypatch.setattr(scan_service, "get_scan_feed", lambda: RaceScanFeed(race, polled, release))
    async with race.sessions() as scanner, race.sessions() as mover:
        scanner_pid = (await scanner.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        mover_pid = (await mover.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        cached = await scanner.get(Consignment, race.consignment_id)
        assert cached is not None
        assert cached.trip_id == race.old_id
        await sync_consignment_from_waybill(mover, _waybill(), trip_id=race.replacement_id)
        await mover.flush()
        scan_task = asyncio.create_task(scan_service.ingest_scans(scanner, trip_id=race.old_id, trip_stop_id=race.stop_id, direction=direction))
        try:
            async with asyncio.timeout(5):
                await _wait_for_lock(race.sessions, scanner_pid, mover_pid)
                await mover.commit()
                result = await scan_task
                await scanner.commit()
            assert result.consignments == []
            assert not polled.is_set()
        finally:
            if not scan_task.done():
                scan_task.cancel()
            await asyncio.gather(scan_task, return_exceptions=True)
            await mover.rollback()
    async with race.sessions() as reader:
        held = await reader.get(Consignment, race.consignment_id)
        assert held is not None
        parcels = (await reader.execute(select(Parcel).where(Parcel.consignment_id == race.consignment_id))).scalars().all()
        assert held.trip_id == race.replacement_id
        assert len(parcels) == 6
        assert all(p.pp_scan_out_at is None and p.pp_scan_in_at is None for p in parcels)


@pytest.mark.parametrize("reverse_cargo", [False, True])
@pytest.mark.parametrize("direction", [ScanDirection.OUT, ScanDirection.IN])
async def test_multi_waybill_recreation_and_scan_share_one_lock_order(
    scan_race_world: ScanRaceWorld, monkeypatch: pytest.MonkeyPatch,
    reverse_cargo: bool, direction: ScanDirection,
) -> None:
    race = scan_race_world
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", False)
    # UUID order B/A deliberately opposes waybill order A/B. Derive from the
    # fixture UUID so the inversion is guaranteed without a timing assumption.
    second_id = uuid.UUID(int=race.consignment_id.int // 2)
    second_ref = "MFTWB8102"
    async with race.sessions() as setup:
        setup.add(Consignment(
            id=second_id, trip_id=race.old_id, parcel_perfect_reference=second_ref,
            pickup_stop_id=race.stop_id, delivery_stop_id=race.stop_id,
        ))
        await setup.commit()
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)
    waybills = [copy.deepcopy(MOCK_WAYBILLS[ref]) for ref in (_WAYBILL, second_ref)]
    if reverse_cargo:
        waybills.reverse()
    manifest = PPManifestResponse(manifest.header, waybills)
    world = race.world
    new_trip = NewTrip(
        driver_id=world.driver.id, horse_id=world.horse.id, trailer_ids=[],
        stops=[TripStopCreate(precinct_id=world.cape_town.id, sequence=0),
               TripStopCreate(precinct_id=world.johannesburg.id, sequence=1)],
        trip_type=TripType.LOADED, planned_departure_at=datetime.now(UTC), planned_arrival_at=None,
        manifest=ManifestCargo(
            key=manifest_key(manifest), client_organization_id=world.client.id,
            client_name=world.client.name, waybills=waybills,
            snapshot=manifest_snapshot(manifest), snapshot_sha256=manifest_snapshot_sha256(manifest),
        ),
    )
    first_moved, release = asyncio.Event(), asyncio.Event()
    real_sync = consignment_service.sync_consignment_from_waybill

    async def pause_after_first(
        db: AsyncSession, waybill: PPWaybillResponse, **kwargs: Any,
    ) -> consignment_service.ConsignmentSyncResult:
        result = await real_sync(db, waybill, **kwargs)
        if not first_moved.is_set():
            assert waybill.details.waybill == _WAYBILL
            first_moved.set()
            await release.wait()
        return result

    class NoOldTripFeed:
        async def poll_scans(self, **kwargs: object) -> list[ScanEvent]:
            raise AssertionError("the committed replacement owns both waybills")

    monkeypatch.setattr(consignment_service, "sync_consignment_from_waybill", pause_after_first)
    monkeypatch.setattr(scan_service, "get_scan_feed", NoOldTripFeed)
    async with race.sessions() as scanner, race.sessions() as mover:
        scanner_pid = (await scanner.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        mover_pid = (await mover.execute(text("SELECT pg_backend_pid()"))).scalar_one()

        async def recreate() -> uuid.UUID:
            created = await persist_trip(mover, new_trip, world.dispatcher())
            await mover.commit()
            return created.id

        move_task = asyncio.create_task(recreate())
        scan_task = None
        try:
            async with asyncio.timeout(5):
                # Propagate a failed mover instead of waiting forever for its event.
                event_task = asyncio.create_task(first_moved.wait())
                done, _ = await asyncio.wait([move_task, event_task], return_when=asyncio.FIRST_COMPLETED)
                if move_task in done:
                    event_task.cancel()
                    await asyncio.gather(event_task, return_exceptions=True)
                    await move_task
                scan_task = asyncio.create_task(scan_service.ingest_scans(
                    scanner, trip_id=race.old_id, trip_stop_id=race.stop_id, direction=direction,
                ))
                await _wait_for_lock(race.sessions, scanner_pid, mover_pid)
                release.set()
                replacement_id = await move_task
                result = await scan_task
                await scanner.commit()
            assert result.consignments == []
        finally:
            release.set()
            tasks = [t for t in (move_task, scan_task) if t is not None]
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await mover.rollback()
    async with race.sessions() as reader:
        rows = (await reader.execute(select(Consignment).where(
            Consignment.id.in_([race.consignment_id, second_id]),
        ))).scalars().all()
        assert len(rows) == 2 and all(row.trip_id == replacement_id for row in rows)
        parcels = (await reader.execute(select(Parcel).where(
            Parcel.consignment_id.in_([race.consignment_id, second_id]),
        ))).scalars().all()
        assert all(p.pp_scan_out_at is None and p.pp_scan_in_at is None for p in parcels)
