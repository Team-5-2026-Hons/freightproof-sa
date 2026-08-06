"""Unit tests for scan reconciliation.

Uses the db_session fixture (skips without TEST_DATABASE_URL), matching
test_consignment_service.py — the service's whole job is comparing DB rows
against feed events, so a DB-free test would assert nothing meaningful.
"""

import uuid
from typing import Any

import pytest

from app.db.models.enums import (
    ExceptionSource, ExceptionType, IdvsStatus, OrganizationType, ParcelStatus,
    TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import MockScanFeed, ScanDirection
from app.orchestration import scan_service
from sqlalchemy import select


class FakeStore:
    """Dict-backed MockStateStore — same fake as test_scan_feed.py."""

    def __init__(self) -> None:
        self.data: dict[str, dict[str, Any]] = {}

    async def get_json(self, key: str) -> dict[str, Any] | None:
        return self.data.get(key)

    async def set_json(self, key: str, value: dict[str, Any]) -> None:
        self.data[key] = value

    async def flush(self) -> int:
        count = len(self.data)
        self.data.clear()
        return count


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    fake = FakeStore()
    monkeypatch.setattr(scan_feed_module, "get_mock_state_store", lambda: fake)
    return fake


@pytest.fixture
async def seeded(db_session):
    """A one-stop trip with one 3-parcel consignment picked up at that stop."""
    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
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
    precinct = Precinct(
        id=uuid.uuid4(), name="Origin", principal_organization_id=org.id,
        latitude="0", longitude="0",
    )
    db_session.add_all([user, driver, horse, precinct])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY001",
        parcel_count_expected=3, pickup_stop_id=stop.id, delivery_stop_id=stop.id,
    )
    db_session.add(consignment)
    await db_session.flush()

    barcodes = ["WAY0010001", "WAY0010002", "WAY0010003"]
    for barcode in barcodes:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id,
            barcode=barcode, status=ParcelStatus.PENDING,
        ))
    await db_session.flush()

    return {"trip": trip, "stop": stop, "consignment": consignment, "barcodes": barcodes}


async def test_full_scan_out_stamps_every_parcel(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"],
    )

    result = await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    parcels = (await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
    )).scalars().all()
    assert all(p.pp_scan_out_at is not None for p in parcels)
    assert all(p.status == ParcelStatus.SCANNED_OUT for p in parcels)
    assert result.consignments[0].missing_barcodes == []
    assert result.consignments[0].unexpected_barcodes == []


async def test_full_scan_out_raises_no_exception(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"],
    )

    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    exceptions = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalars().all()
    assert exceptions == []


async def test_scan_in_stamps_the_in_column_not_the_out_column(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.IN, barcodes=seeded["barcodes"],
    )

    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.IN,
    )

    parcels = (await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
    )).scalars().all()
    assert all(p.pp_scan_in_at is not None for p in parcels)
    assert all(p.pp_scan_out_at is None for p in parcels)
    assert all(p.status == ParcelStatus.SCANNED_IN for p in parcels)


async def test_nothing_staged_leaves_parcels_untouched(db_session, store, seeded):
    result = await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    parcels = (await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
    )).scalars().all()
    assert all(p.pp_scan_out_at is None for p in parcels)
    assert result.consignments[0].observed_count == 0


async def test_partial_scan_raises_a_scoped_exception(db_session, store, seeded):
    """The discrepancy path — 2 of 3 parcels scanned."""
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"][:2],
    )

    result = await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    exception = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalar_one()
    assert exception.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH
    assert exception.consignment_id == seeded["consignment"].id
    assert exception.trip_stop_id == seeded["stop"].id
    assert exception.source == ExceptionSource.SYSTEM
    assert result.consignments[0].missing_barcodes == [seeded["barcodes"][2]]


async def test_partial_scan_stamps_only_the_scanned_parcels(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"][:2],
    )

    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    parcels = {
        p.barcode: p for p in (await db_session.execute(
            select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
        )).scalars().all()
    }
    assert parcels[seeded["barcodes"][0]].pp_scan_out_at is not None
    assert parcels[seeded["barcodes"][2]].pp_scan_out_at is None
    assert parcels[seeded["barcodes"][2]].status == ParcelStatus.PENDING


async def test_unexpected_barcode_raises_an_exception_naming_it(db_session, store, seeded):
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=[*seeded["barcodes"], "STRANGER-99"],
    )

    result = await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    exception = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalar_one()
    assert "STRANGER-99" in exception.description
    assert result.consignments[0].unexpected_barcodes == ["STRANGER-99"]


async def test_unexpected_barcode_creates_no_parcel_row(db_session, store, seeded):
    """A barcode not on the manifest is not this consignment's parcel — we record
    that we saw it, we do not adopt it."""
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=[*seeded["barcodes"], "STRANGER-99"],
    )

    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    parcels = (await db_session.execute(
        select(Parcel).where(Parcel.consignment_id == seeded["consignment"].id)
    )).scalars().all()
    assert len(parcels) == 3
    assert "STRANGER-99" not in {p.barcode for p in parcels}


async def test_repeated_ingest_does_not_duplicate_the_exception(db_session, store, seeded):
    """A real feed is polled repeatedly; an unchanged feed must not manufacture rows."""
    await MockScanFeed().stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"][:2],
    )

    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )
    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    exceptions = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seeded["trip"].id)
    )).scalars().all()
    assert len(exceptions) == 1


async def test_repeated_ingest_keeps_the_first_scan_timestamp(db_session, store, seeded):
    """The first scan is the evidence — a replay must not rewrite when it happened."""
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"],
    )
    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )
    first = (await db_session.execute(
        select(Parcel).where(Parcel.barcode == seeded["barcodes"][0])
    )).scalar_one().pp_scan_out_at

    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"],
    )
    await scan_service.ingest_scans(
        db_session, trip_id=seeded["trip"].id, trip_stop_id=seeded["stop"].id,
        direction=ScanDirection.OUT,
    )

    second = (await db_session.execute(
        select(Parcel).where(Parcel.barcode == seeded["barcodes"][0])
    )).scalar_one().pp_scan_out_at
    assert first == second


async def test_unknown_trip_raises_not_found(db_session, store, seeded):
    from app.core.exceptions import ResourceNotFoundError

    with pytest.raises(ResourceNotFoundError):
        await scan_service.ingest_scans(
            db_session, trip_id=uuid.uuid4(), trip_stop_id=seeded["stop"].id,
            direction=ScanDirection.OUT,
        )


async def test_stop_belonging_to_another_trip_raises_not_found(db_session, store, seeded):
    from app.core.exceptions import ResourceNotFoundError

    with pytest.raises(ResourceNotFoundError):
        await scan_service.ingest_scans(
            db_session, trip_id=seeded["trip"].id, trip_stop_id=uuid.uuid4(),
            direction=ScanDirection.OUT,
        )
