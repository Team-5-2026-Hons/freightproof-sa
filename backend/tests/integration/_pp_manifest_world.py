"""Builders shared by the FP-281 manifest tests (test_pp_manifest_*.py, test_trip_*).

Not a test module: no test_ prefix, so pytest never collects it — same convention as
_fleet_seed.py. Builders, not fixtures, so a module can ask for a world with a
different client account or different linked hubs without fixture parametrisation.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.integrations import parcel_perfect as pp_module
from app.integrations.parcel_perfect import mock as pp_mock_module
from tests.conftest import FakeMockStateStore

from app.db.models.enums import (
    DispatcherRole, IdvsStatus, OrganizationType, TripStatus, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.schemas.people import UserRead
from tests.conftest import auth_header, make_token

# The PP mock's demo client (integrations/parcel_perfect.py _DEMO_PP_ACCOUNT and
# _DEMO_PP_CUSTOMER). A world built with this account links every mock manifest.
MOCK_CLIENT_ACCOUNT = "MOCK01"
MOCK_CLIENT_NAME = "CGY Logistics"

# The mock's demo hub codes for these two depots (parcel_perfect.DEMO_HUB_CODES).
_HUB_CAPE_TOWN = "CPT"
_HUB_JOHANNESBURG = "JNB"


@dataclass(frozen=True)
class ManifestWorld:
    """One operator, one PP client, and everything a manifest trip needs."""

    operator: Organization
    client: Organization
    user: User
    driver: Driver
    horse: Vehicle
    trailer: Vehicle
    cape_town: Precinct      # hub CPT when linked
    johannesburg: Precinct   # hub JNB when linked
    durban: Precinct         # never linked: the pick for an unlinked hub (manifest 69 → DUR)

    def headers(self) -> dict[str, str]:
        return auth_header(
            make_token(sub=str(self.user.id), role="dispatcher", org_id=str(self.operator.id))
        )

    def driver_headers(self) -> dict[str, str]:
        return auth_header(make_token(sub=str(self.driver.id), role="driver"))

    def dispatcher(self) -> UserRead:
        now = datetime.now(UTC)
        return UserRead(
            id=self.user.id, email=self.user.email, full_name=self.user.full_name,
            organization_id=self.operator.id, role=DispatcherRole.DISPATCHER,
            created_at=now, updated_at=now,
        )


async def build_manifest_world(
    db: AsyncSession,
    *,
    client_account: str = MOCK_CLIENT_ACCOUNT,
    linked_hubs: tuple[str, ...] = (_HUB_CAPE_TOWN, _HUB_JOHANNESBURG),
    shared: bool = True,
) -> ManifestWorld:
    """Insert (flush, not commit) a world. Pass a different client_account to leave
    the mock's MOCK01 manifests unlinked; drop a hub from linked_hubs to unlink it;
    pass shared=False to make the client's precincts private to the client, i.e.
    invisible to the operator's dispatcher (SEC-PRECINCT-1)."""
    suffix = uuid.uuid4().hex[:8]
    operator = Organization(id=uuid.uuid4(), name=f"Operator {suffix}", org_type=OrganizationType.OPERATOR)
    client = Organization(
        id=uuid.uuid4(), name=MOCK_CLIENT_NAME, org_type=OrganizationType.PRINCIPAL,
        pp_account_number=client_account,
    )
    db.add_all([operator, client])
    await db.flush()

    def precinct(name: str, hub: str | None) -> Precinct:
        return Precinct(
            id=uuid.uuid4(), name=f"{name} {suffix}", principal_organization_id=client.id,
            latitude="0", longitude="0", is_shared=shared,
            pp_hub_code=hub if hub in linked_hubs else None,
        )

    cape_town = precinct("Cape Town Depot", _HUB_CAPE_TOWN)
    johannesburg = precinct("Johannesburg Depot", _HUB_JOHANNESBURG)
    durban = precinct("Durban Depot", None)
    user = User(
        id=uuid.uuid4(), organization_id=operator.id, email=f"dispatcher-{suffix}@test.co.za",
        full_name="Test Dispatcher", is_active=True,
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=operator.id, full_name="Test Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number=f"DRV-{suffix}",
        idvs_status=IdvsStatus.PENDING,
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=operator.id, vehicle_type=VehicleType.HORSE,
        registration=f"H{suffix.upper()}", pulsit_device_id=f"PUL-H-{suffix}",
    )
    trailer = Vehicle(
        id=uuid.uuid4(), organization_id=operator.id, vehicle_type=VehicleType.TRAILER,
        registration=f"T{suffix.upper()}", pulsit_device_id=f"PUL-T-{suffix}",
    )
    db.add_all([cape_town, johannesburg, durban, user, driver, horse, trailer])
    await db.flush()
    return ManifestWorld(
        operator=operator, client=client, user=user, driver=driver, horse=horse,
        trailer=trailer, cape_town=cape_town, johannesburg=johannesburg, durban=durban,
    )


async def insert_trip(
    db: AsyncSession,
    world: ManifestWorld,
    *,
    number: int | None,
    status: TripStatus = TripStatus.CREATED,
    origin_hub: str = _HUB_CAPE_TOWN,
    closed_at: datetime | None = None,
) -> Trip:
    """A trip row written directly, for read-side and constraint tests that are not
    about how trips are created. number=None writes a trip with no manifest key."""
    keyed = number is not None
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-TEST-{uuid.uuid4().hex[:8].upper()}",
        operator_organization_id=world.operator.id,
        client_organization_id=world.client.id if keyed else None,
        driver_id=world.driver.id, horse_id=world.horse.id,
        origin_precinct_id=world.cape_town.id, destination_precinct_id=world.johannesburg.id,
        status=status, idvs_check_status=IdvsStatus.PENDING, created_by_user_id=world.user.id,
        pp_manifest_issuer_account=world.client.pp_account_number if keyed else None,
        pp_manifest_origin_hub=origin_hub if keyed else None,
        pp_manifest_number=number, closed_at=closed_at,
    )
    db.add(trip)
    await db.flush()
    return trip


def install_pp_mock(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    """PP mock with an in-memory override store and a pinned "today", so a preview and
    the create that follows read an identical manifest and nothing touches Redis."""
    store = FakeMockStateStore()
    monkeypatch.setattr(pp_mock_module, "get_mock_state_store", lambda: store)
    monkeypatch.setattr(settings, "PP_USE_MOCK", True)
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", True)
    today = datetime.now(pp_module.pp_timezone()).date()
    monkeypatch.setattr(pp_mock_module, "_operations_today", lambda: today)
    return store


async def preview(client: AsyncClient, world: ManifestWorld, number: int) -> dict:
    resp = await client.get(
        "/api/v1/trips/pp-manifest-preview", params={"manifest_number": number},
        headers=world.headers(),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def create_body(world: ManifestWorld, preview_json: dict, **overrides: object) -> dict:
    """A POST /trips/from-pp-manifest body for what the dispatcher just previewed."""
    body: dict[str, object] = {
        "manifest_number": preview_json["pp_manifest"]["number"],
        "expected_snapshot_sha256": preview_json["snapshot_sha256"],
        "driver_id": str(world.driver.id),
        "horse_id": str(world.horse.id),
        "trailer_ids": [str(world.trailer.id)],
    }
    body.update(overrides)
    return body
