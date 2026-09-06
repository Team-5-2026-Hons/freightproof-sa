"""FP-146 — two dispatchers resolving the same exception in the same instant.

Separate module, and separate from the shared `db_session` fixture, deliberately. That
fixture binds every session to ONE outer connection with
``join_transaction_mode="create_savepoint"`` and rolls back at the end, so two sessions
drawn from it share a transaction and can never contend for a row lock — a race test
written against it would pass no matter what the service does. The existing conflict test
in tests/unit/test_exception_service.py is sequential for the same reason: it proves the
409 branch is reachable, and nothing at all about simultaneity.

Proving the FIRST resolution survives needs two independent connections and real commits,
so this module opens, commits and cleans up its own rows.
"""

import asyncio
import uuid

import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ExceptionAlreadyResolvedError
from app.db.models.enums import (
    ExceptionResolutionMethod,
    ExceptionSeverity,
    ExceptionSource,
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
from app.orchestration.exception_service import resolve_exception

_FIRST_NOTE = "Phoned the depot; the seal was cut during a lawful SARS inspection."
_SECOND_NOTE = "Spoke to the driver in person; he says the inspection was at Beitbridge."


async def _seed(session: AsyncSession) -> dict:
    """One operator org, one active trip, one unresolved exception, two dispatchers.

    Committed rather than flushed: the two racing sessions below are on their own
    connections and cannot see uncommitted work from this one.

    Unique columns (User.email, Trip.trip_reference) carry a per-run suffix. These rows
    outlive the statement that wrote them, so a teardown that failed once would otherwise
    poison every later run of this module.
    """
    tag = uuid.uuid4().hex[:8]

    org = Organization(id=uuid.uuid4(), name=f"Op-{tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(
        id=uuid.uuid4(), name=f"Cl-{tag}", org_type=OrganizationType.PRINCIPAL,
    )
    session.add_all([org, client_org])
    await session.flush()

    first = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"first-{tag}@test.co.za", full_name="First Dispatcher",
    )
    second = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"second-{tag}@test.co.za", full_name="Second Dispatcher",
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
    session.add_all([first, second, driver, horse, origin, dest])
    await session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-RACE-{tag}", order_number=f"ORD-{tag}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=first.id,
    )
    session.add(trip)
    await session.flush()

    exc = TripException(
        id=uuid.uuid4(), trip_id=trip.id,
        exception_type=ExceptionType.SEAL_MISMATCH,
        source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.CRITICAL,
        description="Seal at destination does not match departure.",
    )
    session.add(exc)
    await session.commit()

    return {
        "org_id": org.id, "client_org_id": client_org.id,
        "first_id": first.id, "second_id": second.id,
        "driver_id": driver.id, "horse_id": horse.id,
        "origin_id": origin.id, "dest_id": dest.id,
        "trip_id": trip.id, "exception_id": exc.id,
    }


async def _teardown(session: AsyncSession, ids: dict) -> None:
    """Delete this module's committed rows, children before parents."""
    await session.execute(delete(TripException).where(TripException.id == ids["exception_id"]))
    await session.execute(delete(Trip).where(Trip.id == ids["trip_id"]))
    await session.execute(delete(Precinct).where(Precinct.id.in_([ids["origin_id"], ids["dest_id"]])))
    await session.execute(delete(Vehicle).where(Vehicle.id == ids["horse_id"]))
    await session.execute(delete(Driver).where(Driver.id == ids["driver_id"]))
    await session.execute(delete(User).where(User.id.in_([ids["first_id"], ids["second_id"]])))
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


async def test_simultaneous_resolves_record_exactly_one_dispatcher(test_engine, seeded):
    """Two dispatchers hit Resolve at the same moment. One must win and one must be told
    they lost — the outcome the sequential conflict test asserts, held under a real race.

    Without a lock both sessions read ``resolved=False`` before either writes, so both
    take the un-resolved branch and both return 200. The second UPDATE then blocks on the
    first's row lock, waits for the commit, and overwrites the resolver, note, method and
    timestamp of the dispatcher who actually got there first. Two people are told their
    account is the record; only one of them is, and it is not the first.
    """
    async def attempt(user_id: uuid.UUID, note: str, method: ExceptionResolutionMethod):
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            try:
                await resolve_exception(
                    session,
                    exception_id=seeded["exception_id"],
                    user_id=user_id,
                    organization_id=seeded["org_id"],
                    resolver_note=note,
                    resolution_method=method,
                )
            except ExceptionAlreadyResolvedError:
                await session.rollback()
                return None
            await session.commit()
            return user_id

    outcomes = await asyncio.gather(
        attempt(seeded["first_id"], _FIRST_NOTE, ExceptionResolutionMethod.PHONED),
        attempt(seeded["second_id"], _SECOND_NOTE, ExceptionResolutionMethod.IN_PERSON),
    )

    told_they_won = [user_id for user_id in outcomes if user_id is not None]
    assert len(told_they_won) == 1, (
        "both dispatchers were told their resolution was recorded; only one row exists"
    )

    # And the row belongs to the one who was told so. Asserted separately because a lock
    # that serialised the writes but still let the loser overwrite would satisfy the
    # count above while destroying the evidence it is meant to protect.
    async with AsyncSession(test_engine, expire_on_commit=False) as session:
        stored = await session.get(TripException, seeded["exception_id"])
    winner = told_they_won[0]
    assert stored.resolved is True
    assert stored.resolved_by_user_id == winner
    assert stored.resolver_note == (_FIRST_NOTE if winner == seeded["first_id"] else _SECOND_NOTE)
