"""Committed synthetic fixtures in a private per-run schema on the disposable database."""

import importlib.util
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import event, select, text, update
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import ConnectionPoolEntry, NullPool

from app.analytics.fleet.constants import OPERATIONS_TIME_ZONE_NAME
from app.db.models import Base
from app.db.models.driver_substitutions import DriverSubstitutionNotice, DriverSubstitutionRequest
from app.db.models.enums import OrganizationType, PhaseStatus, PhaseType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.schemas.people import DriverRead, UserRead
from scripts.db_timeout_load.config import database_target
from scripts.db_timeout_load.metrics import RequestSpec

SCHEMA_PREFIX = "fp299_"
VIEW_MIGRATIONS = (
    "2026_09_12_tom_analytics_read_models.py", "2026_09_12_tom_trailer_vehicle_analytics.py",
    "2026_09_13_tom_live_analytics_views.py", "2026_10_19_tim_substitution_driver_analytics.py",
    "2026_10_23_ciaran_driver_analytics_arrival.py",
)
SINGLE_LEG = (
    (PhaseType.TRIP_CREATION, None), (PhaseType.ACTIVATION, 0), (PhaseType.LOADING, 0),
    (PhaseType.DEPARTURE, 0), (PhaseType.IN_TRANSIT, 0), (PhaseType.UNLOADING, 1),
    (PhaseType.CONFIRMATION, 1),
)
DEPARTURE_INDEX = next(index for index, (phase, _) in enumerate(SINGLE_LEG) if phase == PhaseType.DEPARTURE)
TRIP_COUNT = 3
LEDGER_STARTED_HOURS_AGO = 3
PHASE_SPACING_MINUTES = 20
DEPARTED_HOURS_AGO = 2
CLOSED_HOURS_AGO = 1
CONTROL_CONNECT_ARGS = {"timeout": 10, "command_timeout": 30}


def use_schema(engine: AsyncEngine, schema: str) -> None:
    if not schema.startswith(SCHEMA_PREFIX) or not schema.removeprefix(SCHEMA_PREFIX).isalnum():
        raise ValueError("Invalid load-test schema")

    def configure(connection: DBAPIConnection, record: ConnectionPoolEntry) -> None:
        cursor = connection.cursor()
        try:
            cursor.execute(f'SET search_path TO "{schema}"')
            connection.commit()
        finally:
            cursor.close()

    event.listen(engine.sync_engine, "connect", configure)


async def create_views(db: AsyncSession) -> None:
    directory = Path(__file__).resolve().parents[2] / "migrations" / "versions"
    for filename in VIEW_MIGRATIONS:
        spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), directory / filename)
        if spec is None or spec.loader is None:
            raise RuntimeError("Cannot load analytics view fixture")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for statement in module.UPGRADE_STATEMENTS:
            await db.execute(text(statement))


@dataclass(frozen=True)
class World:
    control: AsyncEngine
    schema: str
    user: UserRead
    driver: DriverRead
    trip_id: UUID
    request_id: UUID
    notice_id: UUID
    month: str

    def reads(self) -> list[RequestSpec]:
        return [
            RequestSpec("trip_list", "/api/v1/trips", expected=[{"id": str(self.trip_id)}]),
            RequestSpec("trip_detail", f"/api/v1/trips/{self.trip_id}", expected={"id": str(self.trip_id)}),
            RequestSpec("custody_list", f"/api/v1/trips/{self.trip_id}/driver-substitutions",
                        expected=[{"id": str(self.request_id)}]),
            RequestSpec("driver_analytics", f"/api/v1/analytics/drivers?start_month={self.month}&end_month={self.month}",
                        expected=[{"driver_id": str(self.driver.id)}]),
        ]

    async def reset_notice(self) -> RequestSpec:
        async with self.control.begin() as db:
            await db.execute(update(DriverSubstitutionNotice).where(
                DriverSubstitutionNotice.id == self.notice_id,
            ).values(read_at=None))
        return RequestSpec("notice_read", f"/api/v1/trips/me/substitution-notices/{self.notice_id}/read",
                           method="POST", expected={"id": str(self.notice_id)})

    async def notice_persisted(self) -> bool:
        async with self.control.connect() as db:
            value = await db.scalar(select(DriverSubstitutionNotice.read_at).where(
                DriverSubstitutionNotice.id == self.notice_id,
            ))
        return value is not None


def analytics_month(departed_at: datetime) -> str:
    """First day of the month the analytics views put this departure in."""
    local = departed_at.astimezone(ZoneInfo(OPERATIONS_TIME_ZONE_NAME))
    return local.date().replace(day=1).isoformat()


async def seed_ledger(db: AsyncSession, trips: list[Trip], precincts: list[Precinct], now: datetime) -> None:
    started = now - timedelta(hours=LEDGER_STARTED_HOURS_AGO)
    for trip in trips:
        stops = [TripStop(id=uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=index + 1)
                 for index, precinct in enumerate(precincts)]
        db.add_all(stops)
        await db.flush()
        for index, (phase, stop) in enumerate(SINGLE_LEG):
            completed = trip.status == TripStatus.CLOSED or index <= DEPARTURE_INDEX
            db.add(PhaseEvent(
                id=uuid4(), trip_id=trip.id, trip_stop_id=stops[stop].id if stop is not None else None,
                phase_type=phase, sequence_number=index,
                status=PhaseStatus.COMPLETED if completed else PhaseStatus.PENDING,
                completed_at=started + timedelta(minutes=index * PHASE_SPACING_MINUTES) if completed else None,
                performed_by_driver_id=trip.driver_id if completed else None, custody_sequence=0,
            ))


async def seed(control: AsyncEngine, schema: str) -> World:
    now = datetime.now(UTC)
    departed_at = now - timedelta(hours=DEPARTED_HOURS_AGO)
    async with async_sessionmaker(control, expire_on_commit=False)() as db:
        org = Organization(id=uuid4(), name="FP299 synthetic operator", org_type=OrganizationType.OPERATOR)
        db.add(org)
        await db.flush()
        user = User(id=uuid4(), organization_id=org.id, email="fp299@example.test", full_name="Load dispatcher")
        drivers = [Driver(id=uuid4(), organization_id=org.id, full_name=f"Synthetic driver {n}",
                          id_number=str(n).zfill(13), phone_number=f"+1000000000{n}", license_number=f"FP299-{n}")
                   for n in (1, 2)]
        horse = Vehicle(id=uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
                        registration="FP299-TEST", pulsit_device_id="FP299-synthetic")
        precincts = [Precinct(id=uuid4(), name=f"Synthetic depot {n}", principal_organization_id=org.id,
                              latitude=0, longitude=n) for n in (1, 2)]
        db.add_all([user, *drivers, horse, *precincts])
        await db.flush()
        trips = [Trip(id=uuid4(), trip_reference=f"FP299-{uuid4().hex[:12]}", operator_organization_id=org.id,
                      driver_id=drivers[0].id, horse_id=horse.id, created_by_user_id=user.id,
                      origin_precinct_id=precincts[0].id, destination_precinct_id=precincts[1].id,
                      status=TripStatus.ACTIVE if n == 0 else TripStatus.CLOSED,
                      current_phase=PhaseType.DEPARTURE if n == 0 else PhaseType.CONFIRMATION,
                      current_stop=1 if n == 0 else 2,
                      actual_departure_at=departed_at,
                      closed_at=None if n == 0 else now - timedelta(hours=CLOSED_HOURS_AGO))
                 for n in range(TRIP_COUNT)]
        db.add_all(trips)
        await db.flush()
        await seed_ledger(db, trips, precincts, now)
        request = DriverSubstitutionRequest(
            id=uuid4(), trip_id=trips[0].id, outgoing_driver_id=drivers[0].id, incoming_driver_id=drivers[1].id,
            request_format="immediate_v2", reservation_start_at=now, reason="Synthetic load fixture",
            arranged_by_user_id=user.id,
        )
        db.add(request)
        await db.flush()
        notice = DriverSubstitutionNotice(id=uuid4(), recipient_driver_id=drivers[0].id,
                                          request_id=request.id, kind="arranged")
        db.add(notice)
        await create_views(db)
        await db.commit()
        return World(control, schema, UserRead.model_validate(user), DriverRead.model_validate(drivers[0]),
                     trips[0].id, request.id, notice.id, analytics_month(departed_at))


@asynccontextmanager
async def isolated_world(database: str) -> AsyncIterator[World]:
    database_target(database)
    schema = f"{SCHEMA_PREFIX}{uuid4().hex}"
    admin = create_async_engine(database, poolclass=NullPool, connect_args=CONTROL_CONNECT_ARGS)
    control = create_async_engine(database, poolclass=NullPool, connect_args=CONTROL_CONNECT_ARGS)
    use_schema(control, schema)
    created = False
    try:
        async with admin.begin() as db:
            await db.execute(text(f'CREATE SCHEMA "{schema}"'))
            created = True
        async with control.begin() as db:
            await db.run_sync(Base.metadata.create_all)
        yield await seed(control, schema)
    finally:
        await control.dispose()
        try:
            if created:
                async with admin.begin() as db:
                    await db.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        finally:
            await admin.dispose()
