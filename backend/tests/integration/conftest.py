"""Shared fixtures for tests/integration/.

`seed` lives here (not in test_trip_admin.py) so cross-file reuse doesn't
require importing it by name into another module — every test function in
this directory already declares `seed` as a parameter, and importing a
same-named fixture into a module ruff reads as redefining an unused import
(F811) at every one of those parameters. conftest.py fixtures are discovered
by pytest automatically, so no import is needed at all.
"""

import uuid

import pytest_asyncio

from app.db.models.enums import OrganizationType, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle


@pytest_asyncio.fixture
async def seed(db_session):
    """Org + dispatcher user + driver + horse + two precincts — the shared
    scaffolding every test in this directory builds its own trip(s) on top of."""
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    dispatcher = User(
        id=uuid.uuid4(), organization_id=org.id,
        email="dispatcher@test.co.za", full_name="Dispatcher",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([dispatcher, driver, horse, origin, dest])
    await db_session.flush()

    return {
        "org": org, "client_org": client_org, "dispatcher": dispatcher,
        "driver": driver, "horse": horse, "origin": origin, "dest": dest,
    }
