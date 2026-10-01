"""Seed reference data into a clean database, on real Supabase Auth and real Hedera.

Reference data only - two organizations, one admin dispatcher, four drivers, seven
vehicles (three horses, four trailers), three precincts. Trips are created through the
dispatcher UI, or by scripts/seed_trips.py for shapes the wizard cannot build yet.

Drivers, vehicles and precincts are created through the same orchestration functions
the dispatcher UI calls (driver_service.create_driver and friends), not as raw rows.
That matters on an evidence platform: each of those functions writes the record's
creation event and anchors it to Hedera, so a seeded horse has the same history and
receipt as one a dispatcher registered by hand. Raw inserts would leave fleet records
with no event trail and no receipt, which reads in the UI as "never anchored".
Organizations and the dispatcher have no such create path, so they stay direct.

Identifiers (licence numbers, registrations, Pulsit device ids, precinct names) are
deliberately unchanged from the earlier version: scripts/seed_trips.py looks rows up by
them, and the precinct addresses match the depot addresses the Parcel Perfect mock
fixtures state (app/integrations/parcel_perfect.py, "Demo depot geography"), so a
waybill's route never contradicts the trip's own stops.

Requires working Hedera settings: anchoring is fail-closed, so a missing key would
otherwise surface only after Supabase Auth accounts had already been created.

Safe to re-run: every record is committed on its own and skipped if it already
exists. Not idempotent for Supabase Auth alone - an auth account whose public row was
never written (e.g. Hedera failed mid-run) aborts with instructions to delete it.

Optional: SEED_DRIVER_PHONE (E.164, e.g. +27821112222) replaces the first driver's
fictional number with one you control, so that driver can log in by real SMS OTP.
Otherwise log in with Supabase test phone numbers (Authentication -> Sign In /
Providers -> Phone) mapped to the numbers below.

Usage:
    cd backend
    DISPATCHER_SEED_PASSWORD='...' PYTHONPATH=. .venv/bin/python scripts/seed_demo.py
"""

import asyncio
import getpass
import os
import re
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.exceptions import DuplicateResourceError
from app.db.models.enums import DispatcherRole, OrganizationType, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.vehicles import Vehicle
from app.integrations.supabase_admin import create_dispatcher_auth_user
from app.orchestration.driver_service import create_driver
from app.orchestration.precinct_service import create_precinct
from app.orchestration.vehicle_service import create_vehicle
from app.schemas.organisations import PrecinctCreateBody
from app.schemas.people import DriverCreateBody
from app.schemas.vehicles import VehicleCreateBody

# Same env var scripts/seed_dispatcher.py already uses — no new config key.
_PASSWORD_ENV_VAR = "DISPATCHER_SEED_PASSWORD"
_DRIVER_PHONE_ENV_VAR = "SEED_DRIVER_PHONE"
_E164_PATTERN = re.compile(r"^\+\d{10,15}$")

# Organizations carry no auth FK, so their ids stay fixed: the frontend .env files
# reference the client org id directly. Values match the previous script so nothing
# downstream has to be re-pointed.
_OPERATOR_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
_CLIENT_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")

_DISPATCHER_EMAIL = "demo-dispatcher@freightproof.co.za"
_DISPATCHER_NAME = "Demo Dispatcher"

# Relative, not fixed, dates: a hardcoded expiry would quietly turn every seeded
# licence into an "expired" warning a few months after the seed was written.
_TODAY = date.today()


@dataclass(frozen=True)
class _SeedDriver:
    full_name: str
    id_number: str
    phone: str
    license_number: str
    license_valid_days: int


@dataclass(frozen=True)
class _SeedVehicle:
    registration: str
    vehicle_type: VehicleType
    pulsit_device_id: str
    make: str
    model: str
    year: int
    vin_number: str  # fictional, 17 alphanumerics as the schema requires
    licence_disc_valid_days: int
    gross_vehicle_mass_kg: int
    length_m: int


@dataclass(frozen=True)
class _SeedPrecinct:
    name: str
    address: str
    latitude: Decimal
    longitude: Decimal
    pp_hub_code: str


# Four, not two: scripts/seed_trips.py gives each demo trip its own driver, so the
# dispatcher's trip list distinguishes trips by who is driving rather than showing
# the same name four times. Also gives the creation wizard a real dropdown.
_DRIVERS = [
    _SeedDriver("Sipho Dlamini", "8001015009087", "+27821234567", "DRV-001", 730),
    _SeedDriver("Thabo Mokoena", "7505105008083", "+27829876543", "DRV-002", 540),
    _SeedDriver("Nomsa Khumalo", "8809124807081", "+27834567890", "DRV-003", 900),
    _SeedDriver("Riaan van Wyk", "7902285015086", "+27825550118", "DRV-004", 365),
]

# One horse and one trailer per demo trip. Distinct pulsit_device_ids matter beyond
# cosmetics: TripTrailer snapshots the device id at creation, so trips sharing one
# trailer would all carry an identical snapshot and the evidence chain would never
# demonstrate that the snapshot is per-trip. Horses are 6x4 truck-tractors; trailers
# are tri-axle tautliners, the usual linehaul combination on these corridors.
_VEHICLES = [
    _SeedVehicle("CA 123-456", VehicleType.HORSE, "PLT-HORSE-001",
                 "Mercedes-Benz", "Actros 2645LS", 2021, "WDB9634031L000001", 240, 27000, 7),
    _SeedVehicle("CJ 456-789", VehicleType.HORSE, "PLT-HORSE-002",
                 "Volvo", "FH 440 6x4", 2020, "YV2RT40A0LA000002", 180, 26500, 7),
    _SeedVehicle("CY 234-901", VehicleType.HORSE, "PLT-HORSE-003",
                 "Scania", "R 460 A6x4", 2022, "YS2R6X40005000003", 300, 27000, 7),
    _SeedVehicle("CA 789-012", VehicleType.TRAILER, "PLT-TRAILER-001",
                 "Henred Fruehauf", "Tri-axle tautliner", 2019, "AHMTA3000KT000004", 210, 34000, 13),
    _SeedVehicle("CJ 012-345", VehicleType.TRAILER, "PLT-TRAILER-002",
                 "Afrit", "Tri-axle tautliner", 2020, "AFRTA3000LT000005", 150, 34000, 13),
    _SeedVehicle("CY 567-234", VehicleType.TRAILER, "PLT-TRAILER-003",
                 "SA Truck Bodies", "Tri-axle tautliner", 2021, "SATBA3000MT000006", 270, 34000, 13),
    _SeedVehicle("CF 890-123", VehicleType.TRAILER, "PLT-TRAILER-004",
                 "Henred Fruehauf", "Tri-axle tautliner", 2018, "AHMTA3000JT000007", 120, 34000, 13),
]

# Three, not two: the cross-dock demo trip needs a middle stop.
#
# The coordinates are the city-centre points the demo geography was built on, NOT the
# depot streets in `address`. They must stay equal to the mock tracker's parked
# position (integrations/pulsit.py MOCK_DEVICE_POSITIONS) and the truck simulator's
# anchor (core/demo_waypoints.py DEMO_ANCHOR_*). Moving a precinct alone would put
# every mock truck ~9 km outside its own 200 m geofence and raise GPS_MISMATCH on
# every phase. Relocating to the real streets (OSM: Epping -33.9346318, 18.5250024;
# Reid St -29.1066487, 26.2094468; Linbro -26.0699276, 28.1146035) is one coordinated
# change across all three files and their tests.
_PRECINCTS = [
    _SeedPrecinct("Cape Town Depot (Epping)", "12 Gunners Circle, Epping Industria, Cape Town",
                  Decimal("-33.9249"), Decimal("18.4241"), "CPT"),
    _SeedPrecinct("Bloemfontein Depot (Hamilton)", "8 Reid Street, Hamilton, Bloemfontein",
                  Decimal("-29.0852"), Decimal("26.1596"), "BFN"),
    _SeedPrecinct("Johannesburg Depot (Linbro)", "1 Depot Street, Linbro Park, Johannesburg",
                  Decimal("-26.2041"), Decimal("28.0473"), "JNB"),
]


def _resolve_password() -> str:
    password = os.environ.get(_PASSWORD_ENV_VAR) or getpass.getpass("Demo dispatcher password: ")
    if not password:
        raise SystemExit(f"A password is required. Set ${_PASSWORD_ENV_VAR} or enter it at the prompt.")
    return password


def _resolve_drivers() -> list[_SeedDriver]:
    override = os.environ.get(_DRIVER_PHONE_ENV_VAR, "").strip()
    if not override:
        return _DRIVERS
    if not _E164_PATTERN.match(override):
        raise SystemExit(f"${_DRIVER_PHONE_ENV_VAR} must be E.164, e.g. +27821112222.")
    first = _DRIVERS[0]
    return [_SeedDriver(first.full_name, first.id_number, override, first.license_number,
                        first.license_valid_days), *_DRIVERS[1:]]


def _require_hedera() -> None:
    # Checked before anything is written: a failure after the first Supabase Auth
    # account exists leaves that account orphaned and forces a manual clean-up.
    missing = [
        name for name, value in (
            ("HEDERA_ACCOUNT_ID", settings.HEDERA_ACCOUNT_ID),
            ("HEDERA_PRIVATE_KEY", settings.HEDERA_PRIVATE_KEY),
            ("HEDERA_TOPIC_ID", settings.HEDERA_TOPIC_ID),
        ) if not value
    ]
    if missing:
        raise SystemExit(f"Hedera is not configured ({', '.join(missing)}); fleet records cannot be anchored.")


async def _seed_organizations(db: AsyncSession) -> None:
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
    await db.commit()


async def _seed_dispatcher(db: AsyncSession, password: str) -> uuid.UUID:
    existing = (await db.execute(select(User).where(User.email == _DISPATCHER_EMAIL))).scalar_one_or_none()
    if existing is not None:
        return existing.id
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
    # users.id MUST equal the auth UUID or auth.uid() never resolves to this row and
    # every RLS policy keyed on it silently returns nothing (migration 0002).
    db.add(User(id=auth_id, organization_id=_OPERATOR_ORG_ID,
                email=_DISPATCHER_EMAIL, full_name=_DISPATCHER_NAME, is_active=True))
    await db.commit()
    print(f"  dispatcher   {_DISPATCHER_EMAIL}")
    return auth_id


async def _seed_drivers(db: AsyncSession, dispatcher_id: uuid.UUID, drivers: list[_SeedDriver]) -> None:
    for spec in drivers:
        existing = await db.execute(select(Driver).where(Driver.license_number == spec.license_number))
        if existing.scalar_one_or_none() is not None:
            continue
        body = DriverCreateBody(
            full_name=spec.full_name, id_number=spec.id_number, phone_number=spec.phone,
            license_number=spec.license_number,
            license_expiry=_TODAY + timedelta(days=spec.license_valid_days),
        )
        try:
            await create_driver(db, _OPERATOR_ORG_ID, body, dispatcher_id)
        except DuplicateResourceError:
            await db.rollback()
            raise SystemExit(
                f"{spec.full_name}'s phone exists in Supabase Auth but has no drivers row "
                "(an earlier run stopped part-way). Delete that user in the Supabase dashboard "
                "(Authentication -> Users) and re-run."
            )
        await db.commit()
        print(f"  driver       {spec.full_name} ({spec.license_number}) — anchored")


async def _seed_vehicles(db: AsyncSession, dispatcher_id: uuid.UUID) -> None:
    for spec in _VEHICLES:
        existing = await db.execute(select(Vehicle).where(Vehicle.pulsit_device_id == spec.pulsit_device_id))
        if existing.scalar_one_or_none() is not None:
            continue
        body = VehicleCreateBody(
            registration=spec.registration, vehicle_type=spec.vehicle_type,
            pulsit_device_id=spec.pulsit_device_id, make=spec.make, model=spec.model,
            year=spec.year, vin_number=spec.vin_number,
            licence_disc_expiry=_TODAY + timedelta(days=spec.licence_disc_valid_days),
            gross_vehicle_mass_kg=spec.gross_vehicle_mass_kg, length_m=spec.length_m,
        )
        await create_vehicle(db, _OPERATOR_ORG_ID, body, dispatcher_id)
        await db.commit()
        print(f"  vehicle      {spec.registration} ({spec.vehicle_type.value}) — anchored")


async def _seed_precincts(db: AsyncSession, dispatcher_id: uuid.UUID) -> None:
    for spec in _PRECINCTS:
        query = select(Precinct).where(
            Precinct.name == spec.name, Precinct.principal_organization_id == _CLIENT_ORG_ID,
        )
        precinct = (await db.execute(query)).scalar_one_or_none()
        if precinct is None:
            # Owned by the client (the principal whose depots these are). is_shared=True:
            # the client's depots must stay visible to the operator dispatcher under
            # per-org precinct scoping.
            body = PrecinctCreateBody(
                name=spec.name, address=spec.address,
                latitude=float(spec.latitude), longitude=float(spec.longitude), is_shared=True,
            )
            await create_precinct(db, _CLIENT_ORG_ID, body, dispatcher_id)
            await db.commit()
            print(f"  precinct     {spec.name} — anchored")
            precinct = (await db.execute(query)).scalar_one()
        if precinct.pp_hub_code != spec.pp_hub_code:
            # Reference data for the PP mock, not evidence: set directly, not through
            # create_precinct, so precinct anchoring is unchanged (FP-281 §7.2). Also
            # runs on a database seeded before hub codes existed.
            precinct.pp_hub_code = spec.pp_hub_code
            await db.commit()
            print(f"  precinct     {spec.name} — hub {spec.pp_hub_code}")


async def seed(password: str) -> None:
    _require_hedera()
    drivers = _resolve_drivers()
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with async_session() as db:
            await _seed_organizations(db)
            dispatcher_id = await _seed_dispatcher(db, password)
            await _seed_drivers(db, dispatcher_id, drivers)
            await _seed_vehicles(db, dispatcher_id)
            await _seed_precincts(db, dispatcher_id)
            print("Reference seed complete.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed(_resolve_password()))
