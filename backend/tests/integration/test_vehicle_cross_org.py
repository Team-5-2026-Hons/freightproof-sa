"""SEC-1: vehicle/driver detail must not return trip IDs from other organisations."""
import uuid
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle


async def _seed(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    """Return (horse_id, driver_id, org_a_id, trip_b_id)."""
    org_a = Organization(id=uuid.uuid4(), name="Org A", org_type=OrganizationType.OPERATOR)
    org_b = Organization(id=uuid.uuid4(), name="Org B", org_type=OrganizationType.OPERATOR)
    db.add_all([org_a, org_b])
    await db.flush()

    # Trip.created_by_user_id is a NOT NULL FK to users — seed one creator.
    creator = User(
        id=uuid.uuid4(), organization_id=org_a.id,
        email="creator-a@example.com", full_name="Creator A", is_active=True,
    )
    db.add(creator)

    # Precinct uses principal_organization_id (not organization_id) and requires lat/long.
    pre_a = Precinct(
        id=uuid.uuid4(), principal_organization_id=org_a.id, name="Gate A",
        address="1 Rd", latitude=Decimal("-33.9249"), longitude=Decimal("18.4241"),
    )
    pre_b = Precinct(
        id=uuid.uuid4(), principal_organization_id=org_b.id, name="Gate B",
        address="2 Rd", latitude=Decimal("-26.2041"), longitude=Decimal("28.0473"),
    )
    db.add_all([pre_a, pre_b])

    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org_a.id,
        registration="CA 123 GP", vehicle_type=VehicleType.HORSE,
        pulsit_device_id="DEV-001",
    )
    db.add(horse)

    driver = Driver(
        id=uuid.uuid4(), organization_id=org_a.id,
        full_name="Driver A", id_number="1234567890123",
        phone_number="+27821000001", license_number="LIC001",
    )
    db.add(driver)
    await db.flush()

    trip_a = Trip(
        id=uuid.uuid4(), operator_organization_id=org_a.id,
        client_organization_id=org_a.id,
        trip_reference="TRP-A-001", order_number="ORD-A",
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=pre_a.id, destination_precinct_id=pre_a.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.PENDING,
        created_by_user_id=creator.id,
    )
    trip_b = Trip(
        id=uuid.uuid4(), operator_organization_id=org_b.id,
        client_organization_id=org_b.id,
        trip_reference="TRP-B-001", order_number="ORD-B",
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=pre_b.id, destination_precinct_id=pre_b.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.PENDING,
        created_by_user_id=creator.id,
    )
    db.add_all([trip_a, trip_b])
    await db.flush()
    return horse.id, driver.id, org_a.id, trip_b.id


@pytest.mark.asyncio
async def test_vehicle_detail_excludes_other_org_trips(db_session: AsyncSession) -> None:
    from app.orchestration.vehicle_service import get_vehicle_detail
    horse_id, _, org_a_id, trip_b_id = await _seed(db_session)
    detail = await get_vehicle_detail(db_session, vehicle_id=horse_id, organization_id=org_a_id)
    assert trip_b_id not in detail.trip_ids, "Cross-org trip leaked into vehicle detail"


@pytest.mark.asyncio
async def test_driver_detail_excludes_other_org_trips(db_session: AsyncSession) -> None:
    from app.orchestration.driver_service import get_driver_detail
    _, driver_id, org_a_id, trip_b_id = await _seed(db_session)
    detail = await get_driver_detail(db_session, driver_id=driver_id, organization_id=org_a_id)
    assert trip_b_id not in detail.trip_ids, "Cross-org trip leaked into driver detail"
