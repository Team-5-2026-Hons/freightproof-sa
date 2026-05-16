"""One-off seed script for local DEMO_MODE development.

Usage:
    cd backend
    DEMO_MODE=true python scripts/seed_demo.py
"""

import asyncio
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
from app.db.models.enums import IdvsStatus, OrganizationType, VehicleType
from app.auth.dependencies import _DEMO_ORG_ID, _DEMO_USER_ID

# Fixed client org — precincts belong to this org and it is used as
# client_organization_id in the frontend trip creation form (DEMO_CLIENT_ORG_ID).
_DEMO_CLIENT_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")


async def seed():
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        async def upsert(model, check_col, check_val, **kwargs):
            existing = await db.execute(select(model).where(check_col == check_val))
            if not existing.scalar_one_or_none():
                db.add(model(**kwargs))

        await upsert(Organization, Organization.id, _DEMO_ORG_ID,
                     id=_DEMO_ORG_ID, name="FreightProof Demo Operator",
                     org_type=OrganizationType.OPERATOR,
                     contact_email="ops@demo.freightproof.co.za")

        await upsert(Organization, Organization.id, _DEMO_CLIENT_ORG_ID,
                     id=_DEMO_CLIENT_ORG_ID, name="FreightProof Demo Client",
                     org_type=OrganizationType.PRINCIPAL,
                     contact_email="client@demo.freightproof.co.za")

        await db.flush()

        await upsert(User, User.id, _DEMO_USER_ID,
                     id=_DEMO_USER_ID, organization_id=_DEMO_ORG_ID,
                     email="demo-dispatcher@freightproof.co.za",
                     full_name="Demo Dispatcher", is_active=True)

        await db.flush()

        for full_name, id_number, phone, license_no in [
            ("Sipho Dlamini", "8001015009087", "+27821234567", "DRV-001"),
            ("Thabo Mokoena", "7505105008083", "+27829876543", "DRV-002"),
        ]:
            await upsert(Driver, Driver.license_number, license_no,
                         organization_id=_DEMO_ORG_ID, full_name=full_name,
                         id_number=id_number, phone_number=phone,
                         license_number=license_no, idvs_status=IdvsStatus.PENDING)

        await upsert(Vehicle, Vehicle.pulsit_device_id, "PLT-HORSE-001",
                     organization_id=_DEMO_ORG_ID, registration="CA 123-456",
                     vehicle_type=VehicleType.HORSE, pulsit_device_id="PLT-HORSE-001")

        await upsert(Vehicle, Vehicle.pulsit_device_id, "PLT-TRAILER-001",
                     organization_id=_DEMO_ORG_ID, registration="CA 789-012",
                     vehicle_type=VehicleType.TRAILER, pulsit_device_id="PLT-TRAILER-001")

        await db.flush()

        for name, lat, lng in [
            ("Cape Town Depot (Epping)",    Decimal("-33.9249"), Decimal("18.4241")),
            ("Johannesburg Depot (Linbro)", Decimal("-26.2041"), Decimal("28.0473")),
        ]:
            await upsert(Precinct, Precinct.name, name,
                         name=name, principal_organization_id=_DEMO_CLIENT_ORG_ID,
                         latitude=lat, longitude=lng, geofence_radius_metres=200)

        await db.commit()
        print("Demo seed complete")


if __name__ == "__main__":
    asyncio.run(seed())
