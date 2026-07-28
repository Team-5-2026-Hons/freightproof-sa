"""Seed reference data into a clean database, on real Supabase Auth.

Reference data only — two organizations, one dispatcher, two drivers, two vehicles,
three precincts. Trips and their phase ledgers come from scripts/seed_trips.py.

Why this is a rewrite and not an edit: migration 0002 added
users.id -> auth.users(id) and drivers.id -> auth.users(id), so the previous
script's hardcoded _DEMO_USER_ID and uuid4() driver ids cannot satisfy the FKs on a
fresh project. It has only ever worked because the team shares one long-lived dev
DB. The IDs must come FROM Supabase Auth, which is also exactly what POST /drivers
does in production — so the seeder ends up aligned with real behaviour rather than
working around it.

Not idempotent for auth: the admin helpers raise DuplicateResourceError on re-run
rather than returning the existing id. Rows that already exist are skipped; an auth
account that exists without its public row aborts with an actionable message.

Usage:
    cd backend
    DISPATCHER_SEED_PASSWORD='...' PYTHONPATH=. .venv/bin/python scripts/seed_demo.py
"""

import asyncio
import getpass
import os
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.exceptions import DuplicateResourceError
from app.db.models.enums import DispatcherRole, IdvsStatus, OrganizationType, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
from app.integrations.supabase_admin import create_dispatcher_auth_user, create_driver_auth_user

# Same env var scripts/seed_dispatcher.py already uses — no new config key.
_PASSWORD_ENV_VAR = "DISPATCHER_SEED_PASSWORD"

# Organizations carry no auth FK, so their ids stay fixed: the frontend .env files
# reference the client org id directly. Values match the previous script so nothing
# downstream has to be re-pointed.
_OPERATOR_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
_CLIENT_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")

_DISPATCHER_EMAIL = "demo-dispatcher@freightproof.co.za"
_DISPATCHER_NAME = "Demo Dispatcher"

# (full_name, id_number, phone, license_number)
_DRIVERS = [
    ("Sipho Dlamini", "8001015009087", "+27821234567", "DRV-001"),
    ("Thabo Mokoena", "7505105008083", "+27829876543", "DRV-002"),
]

# (registration, vehicle_type, pulsit_device_id)
_VEHICLES = [
    ("CA 123-456", VehicleType.HORSE, "PLT-HORSE-001"),
    ("CA 789-012", VehicleType.TRAILER, "PLT-TRAILER-001"),
]

# (name, lat, lng). Three, not two: the cross-dock demo trip needs a middle stop.
_PRECINCTS = [
    ("Cape Town Depot (Epping)", Decimal("-33.9249"), Decimal("18.4241")),
    ("Bloemfontein Depot (Hamilton)", Decimal("-29.0852"), Decimal("26.1596")),
    ("Johannesburg Depot (Linbro)", Decimal("-26.2041"), Decimal("28.0473")),
]


def _resolve_password() -> str:
    password = os.environ.get(_PASSWORD_ENV_VAR) or getpass.getpass("Demo dispatcher password: ")
    if not password:
        raise SystemExit(f"A password is required. Set ${_PASSWORD_ENV_VAR} or enter it at the prompt.")
    return password


async def seed(password: str) -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with async_session() as db:
            # ── Organizations ───────────────────────────────────────────────
            for org_id, name, org_type, email, pp_account in [
                (_OPERATOR_ORG_ID, "FreightProof Demo Operator", OrganizationType.OPERATOR,
                 "ops@demo.freightproof.co.za", None),
                (_CLIENT_ORG_ID, "FreightProof Demo Client", OrganizationType.PRINCIPAL,
                 "client@demo.freightproof.co.za", "MOCK01"),
            ]:
                existing = await db.execute(select(Organization).where(Organization.id == org_id))
                if existing.scalar_one_or_none() is None:
                    db.add(Organization(id=org_id, name=name, org_type=org_type,
                                        contact_email=email, pp_account_number=pp_account))
            await db.flush()

            # ── Dispatcher: Supabase Auth first, then the public row ────────
            existing_user = await db.execute(select(User).where(User.email == _DISPATCHER_EMAIL))
            if existing_user.scalar_one_or_none() is None:
                try:
                    auth_id = await create_dispatcher_auth_user(
                        email=_DISPATCHER_EMAIL, password=password,
                        full_name=_DISPATCHER_NAME, role=DispatcherRole.ADMIN_DISPATCHER,
                    )
                except DuplicateResourceError:
                    raise SystemExit(
                        f"{_DISPATCHER_EMAIL} exists in Supabase Auth but has no public users row. "
                        "Delete it in the Supabase dashboard (Authentication -> Users) and re-run."
                    )
                # users.id MUST equal the auth UUID or auth.uid() never resolves
                # to this row and every RLS policy keyed on it silently returns
                # nothing (migration 0002).
                db.add(User(id=auth_id, organization_id=_OPERATOR_ORG_ID,
                            email=_DISPATCHER_EMAIL, full_name=_DISPATCHER_NAME, is_active=True))
                await db.flush()
                print(f"  dispatcher   {_DISPATCHER_EMAIL} (id={auth_id})")

            # ── Drivers: phone accounts, same UUID rule ─────────────────────
            for full_name, id_number, phone, license_no in _DRIVERS:
                existing_driver = await db.execute(
                    select(Driver).where(Driver.license_number == license_no)
                )
                if existing_driver.scalar_one_or_none() is not None:
                    continue
                try:
                    auth_id = await create_driver_auth_user(phone=phone, full_name=full_name)
                except DuplicateResourceError:
                    raise SystemExit(
                        f"{phone} exists in Supabase Auth but has no drivers row. "
                        "Delete it in the Supabase dashboard and re-run."
                    )
                db.add(Driver(id=auth_id, organization_id=_OPERATOR_ORG_ID, full_name=full_name,
                              id_number=id_number, phone_number=phone,
                              license_number=license_no, idvs_status=IdvsStatus.PENDING))
                print(f"  driver       {full_name} (id={auth_id})")
            await db.flush()

            # ── Vehicles and precincts: no auth FK, plain upserts ───────────
            for registration, vehicle_type, device_id in _VEHICLES:
                existing_vehicle = await db.execute(
                    select(Vehicle).where(Vehicle.pulsit_device_id == device_id)
                )
                if existing_vehicle.scalar_one_or_none() is None:
                    db.add(Vehicle(organization_id=_OPERATOR_ORG_ID, registration=registration,
                                   vehicle_type=vehicle_type, pulsit_device_id=device_id))

            for name, lat, lng in _PRECINCTS:
                existing_precinct = await db.execute(select(Precinct).where(Precinct.name == name))
                if existing_precinct.scalar_one_or_none() is None:
                    # is_shared=True: the client's depots must stay visible to the
                    # operator dispatcher under per-org precinct scoping.
                    db.add(Precinct(name=name, principal_organization_id=_CLIENT_ORG_ID,
                                    latitude=lat, longitude=lng,
                                    geofence_radius_metres=200, is_shared=True))

            await db.commit()
            print("Reference seed complete.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed(_resolve_password()))
