"""Seed the incident-management demo into a LOCAL database: one finished shortage investigation
and one live trip to walk the hijacking flow on by hand.

What it creates, in the DEMO_MODE organisation (a local backend run with DEMO_MODE=true sees it):
  * a CLOSED trip whose one consignment had 8 parcels scanned out and only 5 scanned in, with the
    system's short-count exception — and an incident built on it through the real orchestration
    code: reported by the receiver by phone, the 3 parcels named, one found on the depot floor,
    one confirmed missing, one never established, closed as a partial recovery. The demo ending:
    "Three parcels were missing; here is the evidence, who investigated, what they established,
    and what remains unresolved";
  * an ACTIVE trip with a 6-parcel load and no incident, for reporting a hijacking live in the UI
    (stop the trip, record SAPS details, issue the pack, download the fact sheet).

It builds its own schema with create_all — a throwaway local database, never the shared one.
It refuses to run unless DATABASE_URL points at localhost. No Storage uploads, no Hedera
messages. Safe to run more than once (each run adds two new trips; reference rows are reused).

Usage:
    cd backend
    DATABASE_URL=postgresql+asyncpg://$USER@localhost:5433/freightproof_incident_local \\
      PYTHONPATH=. .venv/bin/python scripts/seed_incident_demo.py
"""

import asyncio
import sys
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.models import Base
from app.db.models.enums import (
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    IncidentConfidence,
    IncidentOutcome,
    IncidentReportChannel,
    IncidentReporterRole,
    IncidentStatus,
    IncidentType,
    IncidentUpdateKind,
    OrganizationType,
    ParcelFinding,
    TripStatus,
    VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.orchestration.incidents.creation import report_incident
from app.orchestration.incidents.updates import append_update, close_incident
from app.schemas.incidents import (
    IncidentCloseRequest,
    IncidentCreate,
    NoteUpdate,
    ParcelFindingUpdate,
    StatusUpdate,
)

_DEMO_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
_DEMO_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
_LOCAL_HOSTS = ("localhost", "127.0.0.1")

JHB = (Decimal("-26.2041000"), Decimal("28.0473000"))
DBN = (Decimal("-29.8587000"), Decimal("31.0218000"))

SHORT_LOAD = 8
SHORT_SCANNED_IN = 5
LIVE_LOAD = 6


async def _get_or_add(db: AsyncSession, model: type[Any], row_id: uuid.UUID, **fields: Any) -> Any:
    row = (await db.execute(select(model).where(model.id == row_id))).scalar_one_or_none()
    if row is None:
        row = model(id=row_id, **fields)
        db.add(row)
        await db.flush()
    return row


async def _scaffold(db: AsyncSession, suffix: str) -> dict[str, Any]:
    operator = await _get_or_add(db, Organization, _DEMO_ORG_ID, name="Load Factor (demo)", org_type=OrganizationType.OPERATOR)
    dispatcher = await _get_or_add(db, User, _DEMO_USER_ID, organization_id=operator.id,
                                   email="demo-dispatcher@freightproof.co.za", full_name="Demo Dispatcher")
    client = Organization(id=uuid.uuid4(), name="FedEx", org_type=OrganizationType.PRINCIPAL)
    db.add(client)
    await db.flush()
    driver = Driver(id=uuid.uuid4(), organization_id=operator.id, full_name="Sipho Dlamini", id_number="8001015009087",
                    phone_number="+27821234567", license_number=f"DRV-{suffix}", license_expiry=date(datetime.now(UTC).year + 1, 1, 31))
    horse = Vehicle(id=uuid.uuid4(), organization_id=operator.id, vehicle_type=VehicleType.HORSE, registration=f"FP{suffix}GP",
                    pulsit_device_id=f"PUL-H-{suffix}", make="Volvo", model="FH", year=2021)
    origin = Precinct(id=uuid.uuid4(), name="FedEx JHB Hub", principal_organization_id=client.id, latitude=JHB[0], longitude=JHB[1])
    dest = Precinct(id=uuid.uuid4(), name="FedEx DBN Hub", principal_organization_id=client.id, latitude=DBN[0], longitude=DBN[1])
    db.add_all([driver, horse, origin, dest])
    await db.flush()
    return {"operator": operator, "dispatcher": dispatcher, "client": client, "driver": driver, "horse": horse,
            "origin": origin, "dest": dest}


async def _trip(db: AsyncSession, base: dict[str, Any], *, reference: str, status: TripStatus, start: datetime) -> Trip:
    trip = Trip(
        id=uuid.uuid4(), trip_reference=reference, order_number=f"ORD-{reference}",
        operator_organization_id=base["operator"].id, client_organization_id=base["client"].id,
        driver_id=base["driver"].id, horse_id=base["horse"].id, origin_precinct_id=base["origin"].id,
        destination_precinct_id=base["dest"].id, status=status, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=base["dispatcher"].id, created_at=start, planned_departure_at=start + timedelta(hours=1),
        actual_departure_at=start + timedelta(hours=1),
        closed_at=start + timedelta(hours=8) if status == TripStatus.CLOSED else None,
    )
    db.add(trip)
    await db.flush()
    db.add_all([
        TripStop(trip_id=trip.id, precinct_id=base["origin"].id, sequence=0),
        TripStop(trip_id=trip.id, precinct_id=base["dest"].id, sequence=1),
    ])
    await db.flush()
    return trip


async def _load(db: AsyncSession, trip: Trip, *, count: int, scanned_in: int, start: datetime) -> list[Parcel]:
    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=f"WAY-{trip.trip_reference}",
        client_organization_id=trip.client_organization_id, declared_value=Decimal("86000.00"), parcel_count_expected=count,
    )
    db.add(consignment)
    await db.flush()
    parcels = [
        Parcel(id=uuid.uuid4(), consignment_id=consignment.id, barcode=f"{trip.trip_reference}-P{i + 1:02d}",
               pp_scan_out_at=start + timedelta(minutes=40),
               pp_scan_in_at=start + timedelta(hours=7, minutes=30) if i < scanned_in else None)
        for i in range(count)
    ]
    db.add_all(parcels)
    await db.flush()
    return parcels


async def _shortage(db: AsyncSession, base: dict[str, Any], suffix: str) -> Trip:
    start = datetime.now(UTC).replace(microsecond=0) - timedelta(days=1)
    trip = await _trip(db, base, reference=f"FP-SHORT-{suffix}", status=TripStatus.CLOSED, start=start)
    parcels = await _load(db, trip, count=SHORT_LOAD, scanned_in=SHORT_SCANNED_IN, start=start)
    short_count = TripException(
        id=uuid.uuid4(), trip_id=trip.id, exception_type=ExceptionType.PARCEL_COUNT_MISMATCH, source=ExceptionSource.SYSTEM,
        severity=ExceptionSeverity.WARNING, review_status=ExceptionReviewStatus.NEEDS_REVIEW,
        description=f"{SHORT_LOAD} parcels scanned out at origin, {SHORT_SCANNED_IN} scanned in at delivery.",
    )
    db.add(short_count)
    await db.flush()

    org, user = base["operator"].id, base["dispatcher"].id
    missing = parcels[SHORT_SCANNED_IN:]
    incident = await report_incident(db, trip_id=trip.id, organization_id=org, user_id=user, request=IncidentCreate(
        incident_type=IncidentType.PARCEL_SHORTAGE, summary="Receiver counted three parcels short on the delivery.",
        reported_by_name="N. Naidoo (DBN receiving)", reporter_role=IncidentReporterRole.RECEIVER,
        report_channel=IncidentReportChannel.PHONE, confidence=IncidentConfidence.REPORTED,
        reported_occurred_at=start + timedelta(hours=7, minutes=35), received_at=start + timedelta(hours=8),
        exception_ids=[short_count.id], parcel_ids=[p.id for p in missing],
    ))
    steps: list[Any] = [
        StatusUpdate(kind=IncidentUpdateKind.STATUS_CHANGED, status=IncidentStatus.INVESTIGATING),
        NoteUpdate(kind=IncidentUpdateKind.NOTE, note="Asked JHB depot to search the loading bay and re-check the scan log."),
        ParcelFindingUpdate(kind=IncidentUpdateKind.PARCEL_FINDING, parcel_id=missing[0].id, finding=ParcelFinding.LOCATED,
                            note="Found on the JHB loading bay floor; never loaded. Depot photo on file."),
        ParcelFindingUpdate(kind=IncidentUpdateKind.PARCEL_FINDING, parcel_id=missing[1].id, finding=ParcelFinding.CONFIRMED_MISSING,
                            note="Scanned out at JHB; not at the depot, not at DBN after a full search by both sites."),
    ]
    for step in steps:
        await append_update(db, incident_id=incident.id, organization_id=org, user_id=user, request=step)
    await close_incident(db, incident_id=incident.id, organization_id=org, user_id=user, request=IncidentCloseRequest(
        outcome=IncidentOutcome.PARTIAL_RECOVERY,
        reason="One parcel was never loaded and has been found; one is confirmed missing; the third was not traced.",
    ))
    return trip


async def _live(db: AsyncSession, base: dict[str, Any], suffix: str) -> Trip:
    start = datetime.now(UTC).replace(microsecond=0) - timedelta(hours=3)
    trip = await _trip(db, base, reference=f"FP-LIVE-{suffix}", status=TripStatus.ACTIVE, start=start)
    await _load(db, trip, count=LIVE_LOAD, scanned_in=0, start=start)
    return trip


async def main() -> None:
    if make_url(settings.DATABASE_URL).host not in _LOCAL_HOSTS:
        sys.exit("Refusing to run: DATABASE_URL is not a localhost database. This script seeds a LOCAL "
                 "database only — see the usage line in its docstring.")
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        suffix = uuid.uuid4().hex[:6].upper()
        base = await _scaffold(db, suffix)
        shortage = await _shortage(db, base, suffix)
        live = await _live(db, base, suffix)
        await db.commit()
    await engine.dispose()
    print(f"\nShortage demo (closed, investigated): {shortage.trip_reference}")
    print(f"  http://localhost:3000/trips/{shortage.id}   → Info tab → Incidents → INC1")
    print(f"Hijacking walk (live, no incident yet):  {live.trip_reference}")
    print(f"  http://localhost:3000/trips/{live.id}   → Info tab → Report incident → Hijacking")


if __name__ == "__main__":
    asyncio.run(main())
