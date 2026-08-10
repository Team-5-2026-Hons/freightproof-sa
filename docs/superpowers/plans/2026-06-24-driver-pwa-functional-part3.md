# Driver PWA Fully Functional — Part 3 (Phase E & start of Phase F)

> Continuation of `2026-06-24-driver-pwa-functional-part2.md`. Same REQUIRED SUB-SKILL applies.

---

# Phase E — Manifest → Linehaul rename

Per Ciaran's coordination note: the driver must never see per-parcel data or a parcel count — only a consolidated unit count, vehicle reg/type, driver details, and seal number(s). Dispatchers still need the full per-parcel manifest for ops, so this is a **role-aware split**, not a wholesale rename: `ManifestResponse` (full, dispatcher) stays; a new `LinehaulResponse` (stripped, driver) is added.

### Task 19: Backend — `LinehaulResponse` + role-aware manifest service

**Files:**
- Modify: `backend/app/schemas/trips.py`
- Create: `backend/app/orchestration/manifest_service.py`
- Create: `backend/app/api/v1/endpoints/manifest.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/integration/test_manifest.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/integration/test_manifest.py
import uuid
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.auth.dependencies import get_current_driver, get_current_dispatcher
from app.db.session import get_db
from app.schemas.people import DriverRead, UserRead
from app.db.models.enums import DispatcherRole


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_trip_with_consignment(db_session):
    from app.db.models.organisations import Organization, Precinct
    from app.db.models.people import Driver, User
    from app.db.models.vehicles import Vehicle
    from app.db.models.trips import Trip, Consignment, Parcel
    from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType, ParcelStatus

    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration_number="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-5", order_number="ORD-5",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.LOADING, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="PP-1",
        client_organization_id=client_org.id, parcel_count_expected=3,
    )
    db_session.add(consignment)
    await db_session.flush()
    for i in range(3):
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id, barcode=f"BC-{i}",
            delivery_stop="Stop A", status=ParcelStatus.SCANNED_OUT,
        ))
    await db_session.flush()
    return trip, driver, user


async def test_driver_gets_linehaul_without_parcel_detail(seed_trip_with_consignment):
    trip, driver, _user = seed_trip_with_consignment
    app.dependency_overrides[get_current_driver] = lambda: DriverRead.model_validate(driver)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/v1/trips/{trip.id}/manifest")

    assert resp.status_code == 200
    body = resp.json()
    assert body["consolidated_unit_count"] == 3
    assert "stops" not in body
    assert "parcels" not in body
    assert body["vehicle_registration"] == "ABC123GP"
    app.dependency_overrides.pop(get_current_driver, None)


async def test_dispatcher_gets_full_manifest_with_parcels(seed_trip_with_consignment):
    trip, _driver, user = seed_trip_with_consignment
    app.dependency_overrides[get_current_dispatcher] = lambda: UserRead.model_validate(user).model_copy(
        update={"role": DispatcherRole.DISPATCHER}
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            f"/api/v1/trips/{trip.id}/manifest", headers={"X-Test-As-Dispatcher": "1"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["total_parcel_count"] == 3
    assert len(body["stops"][0]["parcels"]) == 3
    app.dependency_overrides.pop(get_current_dispatcher, None)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_manifest.py -v`
Expected: FAIL — 404 Not Found

- [ ] **Step 3: Add `LinehaulResponse` to `backend/app/schemas/trips.py`** (next to the existing manifest-shaped schemas — `ManifestResponse`/`DeliveryStopManifest` referenced in the contract doc; if they don't exist in this file yet, add them too, matching contract §4.3):

```python
class DeliveryStopManifest(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    delivery_stop: str
    parcel_count: int
    parcels: list[ParcelRead]


class ManifestResponse(BaseModel):
    """Full per-parcel manifest — dispatcher only. Never sent to the driver PWA."""
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    consignment_id: UUID
    parcel_perfect_reference: str
    total_parcel_count: int
    origin_scan_complete: bool
    stops: list[DeliveryStopManifest]
    pulled_at: datetime


class LinehaulResponse(BaseModel):
    """Driver-facing single document — vehicle, driver, consolidated unit count.

    Deliberately excludes per-parcel data and per-stop breakdown — Bruce's
    theft-risk rule (2026-06-24 design note): the driver must never see
    contents or per-parcel detail, only a consolidated unit count.
    """
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    vehicle_registration: str
    vehicle_type: str
    driver_full_name: str
    consolidated_unit_count: int
    origin_scan_complete: bool
    pulled_at: datetime
```

- [ ] **Step 4: Implement the role-aware service**

```python
# backend/app/orchestration/manifest_service.py
"""Manifest/Linehaul retrieval — role-aware: dispatchers see per-parcel detail,
drivers see only the consolidated Linehaul document (theft-risk rule, see
docs/design-notes/2026-06-24-multi-stop-handshakes.md and the 24 Jun coordination note).
"""

import uuid
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.people import Driver
from app.db.models.trips import Consignment, Parcel, Trip
from app.db.models.vehicles import Vehicle
from app.schemas.trips import DeliveryStopManifest, LinehaulResponse, ManifestResponse
from app.schemas.trips import ParcelRead


async def _load_consignment_and_parcels(db: AsyncSession, trip_id: uuid.UUID):
    consignment_result = await db.execute(select(Consignment).where(Consignment.trip_id == trip_id))
    consignment = consignment_result.scalar_one_or_none()
    if consignment is None:
        raise ResourceNotFoundError("Manifest", str(trip_id))

    parcels_result = await db.execute(select(Parcel).where(Parcel.consignment_id == consignment.id))
    parcels = parcels_result.scalars().all()
    return consignment, parcels


async def get_manifest_for_dispatcher(db: AsyncSession, trip_id: uuid.UUID) -> ManifestResponse:
    consignment, parcels = await _load_consignment_and_parcels(db, trip_id)

    by_stop: dict[str, list[Parcel]] = defaultdict(list)
    for p in parcels:
        by_stop[p.delivery_stop or "Unassigned"].append(p)

    return ManifestResponse(
        trip_id=trip_id,
        consignment_id=consignment.id,
        parcel_perfect_reference=consignment.parcel_perfect_reference,
        total_parcel_count=len(parcels),
        origin_scan_complete=all(p.pp_scan_out_at is not None for p in parcels) if parcels else False,
        stops=[
            DeliveryStopManifest(
                delivery_stop=stop, parcel_count=len(stop_parcels),
                parcels=[ParcelRead.model_validate(p) for p in stop_parcels],
            )
            for stop, stop_parcels in by_stop.items()
        ],
        pulled_at=consignment.updated_at,
    )


async def get_linehaul_for_driver(db: AsyncSession, trip_id: uuid.UUID) -> LinehaulResponse:
    consignment, parcels = await _load_consignment_and_parcels(db, trip_id)

    trip_result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = trip_result.scalar_one()
    horse_result = await db.execute(select(Vehicle).where(Vehicle.id == trip.horse_id))
    horse = horse_result.scalar_one()
    driver_result = await db.execute(select(Driver).where(Driver.id == trip.driver_id))
    driver = driver_result.scalar_one()

    return LinehaulResponse(
        trip_id=trip_id,
        vehicle_registration=horse.registration_number,
        vehicle_type=horse.vehicle_type.value,
        driver_full_name=driver.full_name,
        consolidated_unit_count=len(parcels),
        origin_scan_complete=all(p.pp_scan_out_at is not None for p in parcels) if parcels else False,
        pulled_at=consignment.updated_at,
    )
```

- [ ] **Step 5: Implement the role-aware endpoint**

```python
# backend/app/api/v1/endpoints/manifest.py
"""GET /trips/{trip_id}/manifest — role-aware. See manifest_service docstring."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi import status as http_status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import _bearer, get_current_dispatcher, get_current_driver
from app.core.exceptions import ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.manifest_service import get_linehaul_for_driver, get_manifest_for_dispatcher
from app.schemas.trips import LinehaulResponse, ManifestResponse

router = APIRouter(prefix="/trips/{trip_id}/manifest", tags=["trips"])


@router.get("", response_model=ManifestResponse | LinehaulResponse)
async def get_manifest_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(_bearer)] = None,
) -> ManifestResponse | LinehaulResponse:
    """Auth is 'Dispatcher JWT OR Driver JWT' per the contract — tried explicitly
    in that order rather than via two stacked Depends(), since FastAPI dependencies
    can't express "either of these two auth schemes" declaratively."""
    try:
        dispatcher = await get_current_dispatcher(credentials, db)
        return await get_manifest_for_dispatcher(db, trip_id)
    except HTTPException:
        pass

    try:
        driver = await get_current_driver(credentials, db)
    except HTTPException:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Authentication required.")

    try:
        return await get_linehaul_for_driver(db, trip_id)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
```

Register in `backend/app/main.py`:
```python
from app.api.v1.endpoints.manifest import router as manifest_router
# ...
app.include_router(manifest_router, prefix="/api/v1")
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_manifest.py -v`
Expected: PASS (2 passed)

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/trips.py backend/app/orchestration/manifest_service.py \
        backend/app/api/v1/endpoints/manifest.py backend/app/main.py backend/tests/integration/test_manifest.py
git commit -m "feat(manifest): add role-aware GET /trips/{id}/manifest — Linehaul for drivers, full manifest for dispatchers"
```

---

### Task 20: Frontend shared — Linehaul type + H2 step rename

**Files:**
- Modify: `frontend/shared/lib/types/manifest.ts`
- Modify: `frontend/shared/lib/constants/handshake-meta.ts`
- Modify: `frontend/shared/lib/mocks/manifests.ts`

- [ ] **Step 1: Add the `Linehaul` type** — append to `frontend/shared/lib/types/manifest.ts`:

```typescript
// Linehaul: the driver-facing single document — vehicle, driver, consolidated
// unit count. Never includes per-parcel data (theft-risk rule, 2026-06-24
// coordination note). Mirrors backend LinehaulResponse.
// Fetched via the same GET /trips/{id}/manifest endpoint as Manifest — the
// backend shapes the response by caller role (dispatcher vs driver).
export interface Linehaul {
  trip_id: string
  vehicle_registration: string
  vehicle_type: string
  driver_full_name: string
  consolidated_unit_count: number
  origin_scan_complete: boolean
  pulled_at: string
}
```

(`Manifest`/`DeliveryStop`/`Parcel` stay as-is — the dispatcher still needs them. Only the driver-pwa side switches to `Linehaul`.)

- [ ] **Step 2: Rename the H2 step** — in `frontend/shared/lib/constants/handshake-meta.ts`:

```typescript
// STEP_SLUGS[2]: change '2-manifest' → '2-linehaul'
2: ['1-arrive-bay', '2-linehaul', '3-waybill', '4-seal', '5-review'],

// STEP_NAMES[2]: change 'Confirm Manifest' → 'Confirm Linehaul'
2: ['Arrive at Bay', 'Confirm Linehaul', 'Photograph Waybill', 'Capture Seal', 'Review & Submit'],
```

- [ ] **Step 3: Add Linehaul mocks** — append to `frontend/shared/lib/mocks/manifests.ts`:

```typescript
import type { Linehaul } from '@shared/lib/types/manifest'

export const mockLinehaul0041: Linehaul = {
  trip_id: TRIP_0041_ID,
  vehicle_registration: 'JHB-441-GP',
  vehicle_type: 'horse',
  driver_full_name: 'Sipho Ndlovu',
  consolidated_unit_count: mockManifest0041.total_parcel_count,
  origin_scan_complete: mockManifest0041.origin_scan_complete,
  pulled_at: mockManifest0041.pulled_at,
}

export const mockLinehaul0042: Linehaul = {
  trip_id: TRIP_0042_ID,
  vehicle_registration: 'JHB-442-GP',
  vehicle_type: 'horse',
  driver_full_name: 'Thabo Mokoena',
  consolidated_unit_count: mockManifest0042.total_parcel_count,
  origin_scan_complete: mockManifest0042.origin_scan_complete,
  pulled_at: mockManifest0042.pulled_at,
}

export const mockLinehaul0040: Linehaul = {
  trip_id: TRIP_0040_ID,
  vehicle_registration: 'JHB-440-GP',
  vehicle_type: 'horse',
  driver_full_name: 'Lindiwe Zulu',
  consolidated_unit_count: mockManifest0040.total_parcel_count,
  origin_scan_complete: mockManifest0040.origin_scan_complete,
  pulled_at: mockManifest0040.pulled_at,
}

export const mockLinehauls: Linehaul[] = [mockLinehaul0040, mockLinehaul0041, mockLinehaul0042]
```

- [ ] **Step 4: Type-check both frontends** (manifest types are shared — dispatcher imports `Manifest`, driver-pwa will import `Linehaul`)

Run: `cd frontend/dispatcher && npm run type-check && cd ../driver-pwa && npm run type-check`
Expected: both pass — `Manifest` type is untouched, only additive changes were made.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/lib/types/manifest.ts frontend/shared/lib/constants/handshake-meta.ts \
        frontend/shared/lib/mocks/manifests.ts
git commit -m "feat(linehaul): add driver-facing Linehaul type, rename H2 step 2 manifest->linehaul"
```

---

**Continued in `2026-06-24-driver-pwa-functional-part4.md`: Phase F (frontend API client + auth/trip wiring), Phase G (capture hooks), Phase H (handshake UI build-out), Phase I (offline queue).**
