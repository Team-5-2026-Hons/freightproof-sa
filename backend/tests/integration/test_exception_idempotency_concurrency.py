"""Task 0B — two replays of the same queued exception landing at the same instant.

Separate module, and separate from the shared `db_session` fixture, for the identical
reason tests/integration/test_exception_resolve_concurrency.py is: that fixture binds
every session to ONE outer connection with join_transaction_mode="create_savepoint"
and rolls back at the end, so two sessions drawn from it share a transaction and can
never race for the same partial-unique-index insert — a test written against it would
pass no matter what raise_exception does.

The sequential replay case (tests/unit/test_exception_service.py's
test_raise_exception_replays_the_same_client_report_id) proves the pre-check branch
works; it proves nothing about two attempts genuinely landing together. This module
opens two independent connections, lets both attempt the same insert, and proves the
savepoint recovery path in exception_service.raise_exception actually returns the
winner to the loser instead of surfacing an IntegrityError (or, worse, poisoning the
loser's transaction so nothing after it can run).
"""

import asyncio
import uuid

import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import (
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    TripStatus,
    VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.exception_service import raise_exception


async def _seed(session: AsyncSession) -> dict:
    """One operator org, one active trip, its driver — no exception yet.

    Committed rather than flushed: the two racing sessions below are on their own
    connections and cannot see uncommitted work from this one.
    """
    tag = uuid.uuid4().hex[:8]

    org = Organization(id=uuid.uuid4(), name=f"Op-{tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(
        id=uuid.uuid4(), name=f"Cl-{tag}", org_type=OrganizationType.PRINCIPAL,
    )
    session.add_all([org, client_org])
    await session.flush()

    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"disp-{tag}@test.co.za", full_name="Dispatcher",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number=f"DRV-{tag}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"RC{tag.upper()[:6]}", pulsit_device_id=f"PUL-{tag}",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="O", principal_organization_id=client_org.id,
        latitude="0", longitude="0",
    )
    dest = Precinct(
        id=uuid.uuid4(), name="D", principal_organization_id=client_org.id,
        latitude="1", longitude="1",
    )
    session.add_all([user, driver, horse, origin, dest])
    await session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-IDEM-{tag}", order_number=f"ORD-{tag}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    session.add(trip)
    await session.commit()

    return {
        "org_id": org.id, "client_org_id": client_org.id, "user_id": user.id,
        "driver_id": driver.id, "horse_id": horse.id,
        "origin_id": origin.id, "dest_id": dest.id, "trip_id": trip.id,
    }


async def _teardown(session: AsyncSession, ids: dict) -> None:
    """Delete this module's committed rows, children before parents."""
    await session.execute(delete(TripException).where(TripException.trip_id == ids["trip_id"]))
    await session.execute(delete(Trip).where(Trip.id == ids["trip_id"]))
    await session.execute(delete(Precinct).where(Precinct.id.in_([ids["origin_id"], ids["dest_id"]])))
    await session.execute(delete(Vehicle).where(Vehicle.id == ids["horse_id"]))
    await session.execute(delete(Driver).where(Driver.id == ids["driver_id"]))
    await session.execute(delete(User).where(User.id == ids["user_id"]))
    await session.execute(
        delete(Organization).where(Organization.id.in_([ids["org_id"], ids["client_org_id"]]))
    )
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


async def test_simultaneous_replays_of_the_same_report_produce_exactly_one_exception(
    test_engine, seeded,
):
    """Two attempts (the driver app's own retry racing an earlier one still in flight,
    or two mounted queue instances both flushing) reuse the SAME client_report_id at
    the same instant. Exactly one TripException must exist afterwards, and BOTH calls
    must return successfully with that row's id — neither may surface an
    IntegrityError, and neither session may be left unusable by the conflict.
    """
    report_id = uuid.uuid4()

    async def attempt():
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            result = await raise_exception(
                session,
                trip_id=seeded["trip_id"], driver_id=seeded["driver_id"],
                exception_type=ExceptionType.CARGO_DAMAGE,
                description="Pallet crushed in transit.",
                supporting_artifact_id=None,
                client_report_id=report_id,
            )
            # Proves the session is still perfectly usable after a lost savepoint race
            # — a poisoned outer transaction would fail this commit.
            await session.commit()
            return result.id

    first_id, second_id = await asyncio.gather(attempt(), attempt())

    assert first_id == second_id

    async with AsyncSession(test_engine, expire_on_commit=False) as session:
        rows = (await session.execute(
            delete(TripException).where(TripException.trip_id == seeded["trip_id"]).returning(TripException.id)
        )).scalars().all()
        await session.commit()

    assert len(rows) == 1
    assert rows[0] == first_id
