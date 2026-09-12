"""FP-236 — two simultaneous scans of the same capability token.

Separate module and separate from the shared `db_session` fixture, for the same
reason test_exception_idempotency_concurrency.py is: that fixture binds every session
to one outer connection via join_transaction_mode="create_savepoint" and rolls back
at the end, so two sessions drawn from it share a transaction and can never actually
race for the same row — a test written against it would pass no matter what
redeem_capability_token does. This module opens two independent connections against
the same committed token and proves the conditional UPDATE in handover_service is the
real gate: exactly one of the two concurrent attempts must succeed.
"""

import asyncio
import uuid

import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import IdvsStatus, OrganizationType, PhaseType, TripStatus, VehicleType
from app.db.models.handover import HandoverCapabilityToken, HandoverTokenAttempt
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.orchestration.handover_service import issue_capability_token, redeem_capability_token


async def _seed(session: AsyncSession) -> dict:
    """One operator org, one active trip with a confirmation phase event, and one
    already-issued (but not yet redeemed) capability token. Committed, not flushed:
    the two racing sessions below are on their own connections and cannot see
    uncommitted work from this one.
    """
    tag = uuid.uuid4().hex[:8]

    org = Organization(id=uuid.uuid4(), name=f"Op-{tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name=f"Cl-{tag}", org_type=OrganizationType.PRINCIPAL)
    session.add_all([org, client_org])
    await session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"disp-{tag}@test.co.za", full_name="Dispatcher")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number=f"DRV-{tag}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"RC{tag.upper()[:6]}", pulsit_device_id=f"PUL-{tag}",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    session.add_all([user, driver, horse, origin, dest])
    await session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-HOV-{tag}", order_number=f"ORD-{tag}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    session.add(trip)
    await session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=dest.id, sequence=0)
    session.add(stop)
    await session.flush()

    phase_event = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id,
        phase_type=PhaseType.CONFIRMATION, sequence_number=6,
    )
    session.add(phase_event)
    await session.flush()

    raw_token, token = await issue_capability_token(
        session, phase_event_id=phase_event.id, trip_id=trip.id, trip_stop_id=stop.id,
    )
    await session.commit()

    return {
        "org_id": org.id, "client_org_id": client_org.id, "user_id": user.id,
        "driver_id": driver.id, "horse_id": horse.id,
        "origin_id": origin.id, "dest_id": dest.id, "trip_id": trip.id,
        "stop_id": stop.id, "phase_event_id": phase_event.id,
        "token_id": token.id, "raw_token": raw_token,
    }


async def _teardown(session: AsyncSession, ids: dict) -> None:
    await session.execute(delete(HandoverTokenAttempt).where(HandoverTokenAttempt.token_id == ids["token_id"]))
    await session.execute(delete(HandoverCapabilityToken).where(HandoverCapabilityToken.id == ids["token_id"]))
    await session.execute(delete(PhaseEvent).where(PhaseEvent.id == ids["phase_event_id"]))
    await session.execute(delete(TripStop).where(TripStop.id == ids["stop_id"]))
    await session.execute(delete(Trip).where(Trip.id == ids["trip_id"]))
    await session.execute(delete(Precinct).where(Precinct.id.in_([ids["origin_id"], ids["dest_id"]])))
    await session.execute(delete(Vehicle).where(Vehicle.id == ids["horse_id"]))
    await session.execute(delete(Driver).where(Driver.id == ids["driver_id"]))
    await session.execute(delete(User).where(User.id == ids["user_id"]))
    await session.execute(delete(Organization).where(Organization.id.in_([ids["org_id"], ids["client_org_id"]])))
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


async def test_two_simultaneous_redemptions_of_the_same_token_produce_exactly_one_success(
    test_engine, seeded,
):
    """Two independent connections present the same raw token for the same trip/stop
    at the same instant — the receiver's phone and a second, malicious or duplicate
    scan racing it. Exactly one may succeed; the other must be rejected as
    ALREADY_REDEEMED (or, if it loses a tighter race, EXPIRED never applies here
    since the token has minutes left) — and neither call may raise.
    """

    async def attempt():
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            result = await redeem_capability_token(
                session, trip_id=seeded["trip_id"], trip_stop_id=seeded["stop_id"], raw_token=seeded["raw_token"],
            )
            await session.commit()
            return result.success

    first_success, second_success = await asyncio.gather(attempt(), attempt())

    assert sorted([first_success, second_success]) == [False, True]

    async with AsyncSession(test_engine, expire_on_commit=False) as session:
        token = await session.get(HandoverCapabilityToken, seeded["token_id"])
        assert token is not None
        assert token.redeemed_at is not None

        attempts = (
            await session.execute(
                delete(HandoverTokenAttempt)
                .where(HandoverTokenAttempt.token_id == seeded["token_id"])
                .returning(HandoverTokenAttempt.rejection_reason)
            )
        ).scalars().all()
        await session.commit()

    assert len(attempts) == 2
    assert attempts.count(None) == 1  # exactly one success logged
