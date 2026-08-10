"""Unit tests for the location-trail service (orchestration/location_service.py)."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.locations import TripLocationPing
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.location_service import record_location_pings
from app.schemas.locations import LocationPingCreate


async def _seed(db_session, *, status: TripStatus = TripStatus.ACTIVE) -> tuple[Trip, Driver]:
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4()}@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number=f"DRV-{uuid.uuid4().hex[:6]}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"AB{uuid.uuid4().hex[:5].upper()}", pulsit_device_id=f"PUL-{uuid.uuid4().hex[:6]}",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-SVC-{uuid.uuid4().hex[:6]}", order_number=f"ORD-{uuid.uuid4().hex[:6]}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=status, idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    return trip, driver


def _ping(**overrides) -> LocationPingCreate:
    return LocationPingCreate(
        **{
            "lat": -26.0942, "lng": 28.1342, "accuracy_m": 8.5,
            "context": "/trips", "recorded_at": datetime.now(UTC),
            **overrides,
        }
    )


@pytest.mark.asyncio
async def test_records_every_ping_in_the_batch(db_session) -> None:
    trip, driver = await _seed(db_session)

    recorded = await record_location_pings(
        db_session, trip_id=trip.id, driver_id=driver.id,
        pings=[_ping(context="/"), _ping(context="/trips"), _ping(context="phase-submit")],
    )

    assert recorded == 3
    stored = (await db_session.execute(
        select(TripLocationPing).where(TripLocationPing.trip_id == trip.id)
    )).scalars().all()
    assert len(stored) == 3


@pytest.mark.asyncio
async def test_keeps_a_missing_accuracy_as_null(db_session) -> None:
    """Not every platform estimates accuracy. A fix without one is still worth keeping —
    it must not be coerced to 0, which would claim a centimetre-perfect reading."""
    trip, driver = await _seed(db_session)

    await record_location_pings(
        db_session, trip_id=trip.id, driver_id=driver.id, pings=[_ping(accuracy_m=None)],
    )

    stored = (await db_session.execute(
        select(TripLocationPing).where(TripLocationPing.trip_id == trip.id)
    )).scalars().one()
    assert stored.accuracy_m is None


@pytest.mark.asyncio
async def test_drops_pings_for_a_closed_trip_without_failing(db_session) -> None:
    """The offline queue can surface a fix captured before the trip closed. Rejecting it
    would make the PWA retry a write that can never succeed, so it is dropped instead."""
    trip, driver = await _seed(db_session, status=TripStatus.CLOSED)

    recorded = await record_location_pings(
        db_session, trip_id=trip.id, driver_id=driver.id, pings=[_ping()],
    )

    assert recorded == 0
    stored = (await db_session.execute(
        select(TripLocationPing).where(TripLocationPing.trip_id == trip.id)
    )).scalars().all()
    assert stored == []


@pytest.mark.asyncio
async def test_rejects_another_drivers_trip(db_session) -> None:
    trip, _ = await _seed(db_session)
    _, other_driver = await _seed(db_session)

    with pytest.raises(PermissionError):
        await record_location_pings(
            db_session, trip_id=trip.id, driver_id=other_driver.id, pings=[_ping()],
        )


@pytest.mark.asyncio
async def test_raises_for_an_unknown_trip(db_session) -> None:
    _, driver = await _seed(db_session)

    with pytest.raises(ResourceNotFoundError):
        await record_location_pings(
            db_session, trip_id=uuid.uuid4(), driver_id=driver.id, pings=[_ping()],
        )
