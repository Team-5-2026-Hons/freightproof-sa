# Backend ↔ Frontend Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not verify after individual steps — run all checks at the end. Do not commit anything.

**Goal:** Wire the dispatcher frontend to the real FastAPI backend so trips, vehicles, drivers, and precincts are fetched from the database, and the trip creation form submits to `POST /api/v1/trips`.

**Architecture:** Add four GET endpoints to the backend (drivers, vehicles, precincts, trips list + detail) backed by a new read-only service module. In the frontend, create a minimal native-fetch API client and replace every mock hook with a real API call. Auth is excluded — the backend runs in `DEMO_MODE=True` for local dev, which bypasses JWT verification entirely. The API client is designed with a no-op token getter so the auth teammate can plug in the real Supabase session token later without touching the hooks.

**Tech Stack:** Python 3.13, FastAPI 0.115, SQLAlchemy 2.0, Pydantic v2, pytest + pytest-asyncio (backend); Next.js 15 App Router, TypeScript 5.5, native `fetch` (frontend). No new packages required on either side.

**Excluded:** AuthContext changes, Supabase client setup, JWT token injection, login page — owned by a teammate.

---

## Shared files touched

| File | Why |
|---|---|
| `backend/app/main.py` | Register 3 new routers — **coordinate with team before merging** |
| `backend/app/schemas/trips.py` | Add `TripListItemResponse` schema |

---

## File Map

**Create:**
- `backend/app/orchestration/resource_service.py`
- `backend/app/api/v1/endpoints/drivers.py`
- `backend/app/api/v1/endpoints/vehicles.py`
- `backend/app/api/v1/endpoints/precincts.py`
- `backend/tests/integration/test_drivers.py`
- `backend/tests/integration/test_vehicles.py`
- `backend/tests/integration/test_precincts.py`
- `frontend/dispatcher/.env.local`
- `frontend/dispatcher/lib/api/client.ts`
- `backend/scripts/seed_demo.py`

**Modify:**
- `backend/app/schemas/trips.py` — add `TripListItemResponse`
- `backend/app/api/v1/endpoints/trips.py` — add `GET /trips` and `GET /trips/{id}`
- `backend/tests/integration/test_trips.py` — add GET tests
- `backend/app/main.py` — register new routers [SHARED FILE]
- `frontend/dispatcher/lib/hooks/useDrivers.ts`
- `frontend/dispatcher/lib/hooks/useVehicles.ts`
- `frontend/dispatcher/lib/hooks/usePrecincts.ts`
- `frontend/dispatcher/lib/hooks/useTrips.ts`
- `frontend/dispatcher/app/(app)/trips/new/page.tsx`

---

## Task 1: Add `TripListItemResponse` schema

**File:** `backend/app/schemas/trips.py`

Lightweight list shape returned by `GET /api/v1/trips`. Mirrors the frontend `TripSummary` interface. Excludes `handshakes`, `exceptions`, `blockchain_receipts`. Adds `open_exception_count` computed by the service layer.

- [ ] Add the following class to `backend/app/schemas/trips.py` after the `TripRead` class (around line 165):

```python
class TripListItemResponse(BaseModel):
    """Lightweight trip shape returned by GET /api/v1/trips.

    Excludes handshakes and receipts. open_exception_count is computed
    by resource_service.list_trips() via a grouped COUNT query.
    """
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_reference: str
    order_number: str
    status: TripStatus
    driver: DriverRead
    horse: VehicleRead
    trailers: list[VehicleRead]
    origin_precinct_id: UUID
    destination_precinct_id: UUID
    planned_departure_at: Optional[datetime] = None
    actual_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    actual_arrival_at: Optional[datetime] = None
    open_exception_count: int
    created_at: datetime
    updated_at: datetime
```

---

## Task 2: Create `resource_service.py`

**File:** `backend/app/orchestration/resource_service.py`

All read-only list and detail query functions. No writes. Layering rule: imports only `db/`, `schemas/`, `core/exceptions`. Tested indirectly via endpoint integration tests.

- [ ] Create `backend/app/orchestration/resource_service.py`:

```python
"""Read-only service functions for list/detail endpoints.

Layering: imports db/, schemas/, core/exceptions only.
Never import from api/ or auth/.
"""

import uuid
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import TripStatus
from app.db.models.handshakes import HandshakeEvent
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.schemas.handshakes import HandshakeEventRead
from app.schemas.organisations import PrecinctRead
from app.schemas.people import DriverRead
from app.schemas.transit import TripExceptionRead
from app.schemas.trips import TripDetailResponse, TripListItemResponse
from app.schemas.vehicles import VehicleRead


async def list_drivers(
    db: AsyncSession,
    organization_id: uuid.UUID,
) -> list[DriverRead]:
    result = await db.execute(
        select(Driver)
        .where(Driver.organization_id == organization_id, Driver.is_active.is_(True))
        .order_by(Driver.full_name)
    )
    return [DriverRead.model_validate(d) for d in result.scalars().all()]


async def list_vehicles(
    db: AsyncSession,
    organization_id: uuid.UUID,
) -> list[VehicleRead]:
    result = await db.execute(
        select(Vehicle)
        .where(Vehicle.organization_id == organization_id, Vehicle.is_active.is_(True))
        .order_by(Vehicle.registration)
    )
    return [VehicleRead.model_validate(v) for v in result.scalars().all()]


async def list_precincts(db: AsyncSession) -> list[PrecinctRead]:
    result = await db.execute(select(Precinct).order_by(Precinct.name))
    return [PrecinctRead.model_validate(p) for p in result.scalars().all()]


async def list_trips(
    db: AsyncSession,
    operator_organization_id: uuid.UUID,
    status_filter: list[TripStatus] | None = None,
) -> list[TripListItemResponse]:
    q = select(Trip).where(Trip.operator_organization_id == operator_organization_id)
    if status_filter:
        q = q.where(Trip.status.in_(status_filter))
    q = q.order_by(Trip.created_at.desc())

    trips_result = await db.execute(q)
    trips = trips_result.scalars().all()
    if not trips:
        return []

    trip_ids = [t.id for t in trips]

    # Batch-fetch to avoid N+1 queries on list views.
    driver_ids = list({t.driver_id for t in trips})
    drivers_result = await db.execute(select(Driver).where(Driver.id.in_(driver_ids)))
    drivers_by_id: dict[uuid.UUID, Driver] = {d.id: d for d in drivers_result.scalars().all()}

    horse_ids = list({t.horse_id for t in trips})
    horses_result = await db.execute(select(Vehicle).where(Vehicle.id.in_(horse_ids)))
    horses_by_id: dict[uuid.UUID, Vehicle] = {v.id: v for v in horses_result.scalars().all()}

    tt_result = await db.execute(
        select(TripTrailer).where(TripTrailer.trip_id.in_(trip_ids))
    )
    trip_trailers = tt_result.scalars().all()

    trailer_vehicle_ids = list({tt.trailer_id for tt in trip_trailers})
    trailers_result = await db.execute(
        select(Vehicle).where(Vehicle.id.in_(trailer_vehicle_ids))
    )
    trailers_by_id: dict[uuid.UUID, Vehicle] = {
        v.id: v for v in trailers_result.scalars().all()
    }

    trailers_by_trip: dict[uuid.UUID, list[Vehicle]] = defaultdict(list)
    for tt in trip_trailers:
        if tt.trailer_id in trailers_by_id:
            trailers_by_trip[tt.trip_id].append(trailers_by_id[tt.trailer_id])

    exc_result = await db.execute(
        select(TripException.trip_id, func.count(TripException.id))
        .where(
            TripException.trip_id.in_(trip_ids),
            TripException.resolved.is_(False),
        )
        .group_by(TripException.trip_id)
    )
    exc_counts: dict[uuid.UUID, int] = {row[0]: row[1] for row in exc_result.all()}

    return [
        TripListItemResponse(
            id=t.id,
            trip_reference=t.trip_reference,
            order_number=t.order_number,
            status=t.status,
            driver=DriverRead.model_validate(drivers_by_id[t.driver_id]),
            horse=VehicleRead.model_validate(horses_by_id[t.horse_id]),
            trailers=[VehicleRead.model_validate(v) for v in trailers_by_trip.get(t.id, [])],
            origin_precinct_id=t.origin_precinct_id,
            destination_precinct_id=t.destination_precinct_id,
            planned_departure_at=t.planned_departure_at,
            actual_departure_at=t.actual_departure_at,
            planned_arrival_at=t.planned_arrival_at,
            actual_arrival_at=t.actual_arrival_at,
            open_exception_count=exc_counts.get(t.id, 0),
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in trips
    ]


async def get_trip_detail(
    db: AsyncSession,
    trip_id: uuid.UUID,
    operator_organization_id: uuid.UUID,
) -> TripDetailResponse:
    """Raises ResourceNotFoundError if trip not found or belongs to a different org."""
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None or trip.operator_organization_id != operator_organization_id:
        raise ResourceNotFoundError("Trip", str(trip_id))

    driver_result = await db.execute(select(Driver).where(Driver.id == trip.driver_id))
    driver = driver_result.scalar_one()

    horse_result = await db.execute(select(Vehicle).where(Vehicle.id == trip.horse_id))
    horse = horse_result.scalar_one()

    tt_result = await db.execute(
        select(TripTrailer).where(TripTrailer.trip_id == trip_id)
    )
    trip_trailers = tt_result.scalars().all()
    trailer_ids = [tt.trailer_id for tt in trip_trailers]
    trailers_result = await db.execute(select(Vehicle).where(Vehicle.id.in_(trailer_ids)))
    trailers_by_id = {v.id: v for v in trailers_result.scalars().all()}
    trailers = [trailers_by_id[tid] for tid in trailer_ids if tid in trailers_by_id]

    hs_result = await db.execute(
        select(HandshakeEvent)
        .where(HandshakeEvent.trip_id == trip_id)
        .order_by(HandshakeEvent.sequence_number)
    )
    handshakes = hs_result.scalars().all()

    exc_result = await db.execute(
        select(TripException).where(TripException.trip_id == trip_id)
    )
    exceptions = exc_result.scalars().all()

    return TripDetailResponse(
        id=trip.id,
        trip_reference=trip.trip_reference,
        order_number=trip.order_number,
        status=trip.status,
        journey_lock_hash=trip.journey_lock_hash,
        idvs_check_status=trip.idvs_check_status,
        driver=DriverRead.model_validate(driver),
        horse=VehicleRead.model_validate(horse),
        trailers=[VehicleRead.model_validate(v) for v in trailers],
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        pulsit_trip_reference_id=trip.pulsit_trip_reference_id,
        planned_departure_at=trip.planned_departure_at,
        actual_departure_at=trip.actual_departure_at,
        planned_arrival_at=trip.planned_arrival_at,
        actual_arrival_at=trip.actual_arrival_at,
        closed_at=trip.closed_at,
        handshakes=[HandshakeEventRead.model_validate(h) for h in handshakes],
        exceptions=[TripExceptionRead.model_validate(e) for e in exceptions],
        blockchain_receipts=[],
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )
```

---

## Task 3: Drivers endpoint + tests

**Files:**
- Create: `backend/app/api/v1/endpoints/drivers.py`
- Create: `backend/tests/integration/test_drivers.py`

- [ ] Create `backend/app/api/v1/endpoints/drivers.py`:

```python
"""FastAPI router for driver list endpoint.

GET /drivers — list active drivers for the dispatcher's operator org.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.resource_service import list_drivers
from app.schemas.people import DriverRead, UserRead

router = APIRouter(prefix="/drivers", tags=["drivers"])


@router.get(
    "",
    response_model=list[DriverRead],
    summary="List active drivers for the dispatcher's organisation",
)
async def list_drivers_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[DriverRead]:
    return await list_drivers(db=db, organization_id=current_user.organization_id)
```

- [ ] Create `backend/tests/integration/test_drivers.py`:

```python
"""Integration tests for GET /api/v1/drivers."""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.db.models.organisations import Organization
from app.db.models.people import Driver
from app.db.models.enums import IdvsStatus, OrganizationType
from app.auth.dependencies import _DEMO_ORG_ID
from app.db.session import get_db


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_org(db_session: AsyncSession):
    org = Organization(
        id=_DEMO_ORG_ID,
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add(org)
    await db_session.flush()


@pytest_asyncio.fixture
async def seed_driver(db_session: AsyncSession, seed_org):
    driver = Driver(
        organization_id=_DEMO_ORG_ID,
        full_name="Sipho Dlamini",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-001",
        idvs_status=IdvsStatus.PENDING,
    )
    db_session.add(driver)
    await db_session.flush()
    return driver


async def test_list_drivers_empty_returns_200(seed_org):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/drivers",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_drivers_returns_active_drivers(seed_driver):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/drivers",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 1
    assert body[0]["full_name"] == "Sipho Dlamini"
    assert body[0]["organization_id"] == str(_DEMO_ORG_ID)
    assert body[0]["idvs_status"] == "pending"


async def test_list_drivers_excludes_inactive(db_session, seed_org):
    inactive = Driver(
        organization_id=_DEMO_ORG_ID,
        full_name="Inactive Driver",
        id_number="9001015009089",
        phone_number="+27829999999",
        license_number="DRV-999",
        idvs_status=IdvsStatus.PENDING,
        is_active=False,
    )
    db_session.add(inactive)
    await db_session.flush()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/drivers",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.json() == []
```

---

## Task 4: Vehicles endpoint + tests

**Files:**
- Create: `backend/app/api/v1/endpoints/vehicles.py`
- Create: `backend/tests/integration/test_vehicles.py`

- [ ] Create `backend/app/api/v1/endpoints/vehicles.py`:

```python
"""FastAPI router for vehicle list endpoint.

GET /vehicles — returns all active vehicles (horses + trailers) for
the dispatcher's operator org. The frontend splits by vehicle_type.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.resource_service import list_vehicles
from app.schemas.people import UserRead
from app.schemas.vehicles import VehicleRead

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get(
    "",
    response_model=list[VehicleRead],
    summary="List active vehicles (horses and trailers) for the dispatcher's organisation",
)
async def list_vehicles_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[VehicleRead]:
    return await list_vehicles(db=db, organization_id=current_user.organization_id)
```

- [ ] Create `backend/tests/integration/test_vehicles.py`:

```python
"""Integration tests for GET /api/v1/vehicles."""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.db.models.organisations import Organization
from app.db.models.vehicles import Vehicle
from app.db.models.enums import OrganizationType, VehicleType
from app.auth.dependencies import _DEMO_ORG_ID
from app.db.session import get_db


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_org(db_session: AsyncSession):
    org = Organization(
        id=_DEMO_ORG_ID,
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add(org)
    await db_session.flush()


@pytest_asyncio.fixture
async def seed_vehicles(db_session: AsyncSession, seed_org):
    horse = Vehicle(
        organization_id=_DEMO_ORG_ID,
        registration="CA 123-456",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-HORSE-001",
    )
    trailer = Vehicle(
        organization_id=_DEMO_ORG_ID,
        registration="CA 789-012",
        vehicle_type=VehicleType.TRAILER,
        pulsit_device_id="PLT-TRAILER-001",
    )
    db_session.add_all([horse, trailer])
    await db_session.flush()


async def test_list_vehicles_empty_returns_200(seed_org):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/vehicles",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_vehicles_returns_horses_and_trailers(seed_vehicles):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/vehicles",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 2
    types = {v["vehicle_type"] for v in body}
    assert types == {"horse", "trailer"}


async def test_list_vehicles_excludes_inactive(db_session, seed_org):
    inactive = Vehicle(
        organization_id=_DEMO_ORG_ID,
        registration="CA 000-000",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-INACTIVE",
        is_active=False,
    )
    db_session.add(inactive)
    await db_session.flush()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/vehicles",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.json() == []
```

---

## Task 5: Precincts endpoint + tests

**Files:**
- Create: `backend/app/api/v1/endpoints/precincts.py`
- Create: `backend/tests/integration/test_precincts.py`

Note: returns all precincts (no org filter) for iteration 1.

- [ ] Create `backend/app/api/v1/endpoints/precincts.py`:

```python
"""FastAPI router for precinct list endpoint.

GET /precincts — all precincts (origin/destination gates).
Iteration 1: not yet scoped to the operator's client orgs.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.resource_service import list_precincts
from app.schemas.organisations import PrecinctRead
from app.schemas.people import UserRead

router = APIRouter(prefix="/precincts", tags=["precincts"])


@router.get(
    "",
    response_model=list[PrecinctRead],
    summary="List all physical depots and warehouses (precincts)",
)
async def list_precincts_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[PrecinctRead]:
    return await list_precincts(db=db)
```

- [ ] Create `backend/tests/integration/test_precincts.py`:

```python
"""Integration tests for GET /api/v1/precincts."""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.db.models.organisations import Organization, Precinct
from app.db.models.enums import OrganizationType
from app.auth.dependencies import _DEMO_ORG_ID
from app.db.session import get_db


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_orgs(db_session: AsyncSession):
    operator_org = Organization(
        id=_DEMO_ORG_ID,
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    client_org = Organization(
        name="Demo Client",
        org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([operator_org, client_org])
    await db_session.flush()
    return {"client_org": client_org}


@pytest_asyncio.fixture
async def seed_precincts(db_session: AsyncSession, seed_orgs):
    client_org = seed_orgs["client_org"]
    origin = Precinct(
        name="Cape Town Depot",
        principal_organization_id=client_org.id,
        latitude="33.9249",
        longitude="18.4241",
    )
    destination = Precinct(
        name="Johannesburg Depot",
        principal_organization_id=client_org.id,
        latitude="26.2041",
        longitude="28.0473",
    )
    db_session.add_all([origin, destination])
    await db_session.flush()


async def test_list_precincts_empty_returns_200(seed_orgs):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/precincts",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_precincts_returns_all(seed_precincts):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/precincts",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 2
    names = {p["name"] for p in body}
    assert names == {"Cape Town Depot", "Johannesburg Depot"}
```

---

## Task 6: Add GET /trips and GET /trips/{id}

**Files:**
- Modify: `backend/app/api/v1/endpoints/trips.py`
- Modify: `backend/tests/integration/test_trips.py`

- [ ] Add to the import block at the top of `backend/app/api/v1/endpoints/trips.py`:

```python
from typing import Annotated
from uuid import UUID

from fastapi import Query

from app.db.models.enums import TripStatus
from app.orchestration.resource_service import get_trip_detail, list_trips
from app.schemas.trips import TripListItemResponse
```

- [ ] Append these two route handlers to `backend/app/api/v1/endpoints/trips.py` after the existing POST handler:

```python
@router.get(
    "",
    response_model=list[TripListItemResponse],
    summary="List trips for the dispatcher's organisation",
)
async def list_trips_endpoint(
    status: Annotated[list[TripStatus] | None, Query()] = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[TripListItemResponse]:
    return await list_trips(
        db=db,
        operator_organization_id=current_user.organization_id,
        status_filter=status,
    )


@router.get(
    "/{trip_id}",
    response_model=TripDetailResponse,
    summary="Get full trip detail by ID",
)
async def get_trip_detail_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripDetailResponse:
    try:
        return await get_trip_detail(
            db=db,
            trip_id=trip_id,
            operator_organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
```

- [ ] Append these tests to the bottom of `backend/tests/integration/test_trips.py` (reuses the existing `seed_data`, `override_get_db`, and `_make_payload` already defined in that file):

```python
async def test_list_trips_empty_returns_200(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/trips",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_trips_returns_created_trip(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
        resp = await client.get(
            "/api/v1/trips",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 1
    assert body[0]["order_number"] == "ORD-TEST-001"
    assert body[0]["status"] == "created"
    assert body[0]["open_exception_count"] == 0
    assert "driver" in body[0]
    assert "horse" in body[0]
    assert "trailers" in body[0]


async def test_list_trips_status_filter(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
        resp_created = await client.get(
            "/api/v1/trips?status=created",
            headers={"Authorization": "Bearer demo"},
        )
        resp_in_transit = await client.get(
            "/api/v1/trips?status=in_transit",
            headers={"Authorization": "Bearer demo"},
        )
    assert len(resp_created.json()) == 1
    assert resp_in_transit.json() == []


async def test_get_trip_detail_returns_200(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        create_resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
        trip_id = create_resp.json()["id"]
        resp = await client.get(
            f"/api/v1/trips/{trip_id}",
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert resp.status_code == 200
    assert body["id"] == trip_id
    assert len(body["handshakes"]) == 1
    assert body["handshakes"][0]["handshake_type"] == "trip_creation"


async def test_get_trip_detail_not_found_returns_404(seed_data, db_session):
    import uuid
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            f"/api/v1/trips/{uuid.uuid4()}",
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 404
```

---

## Task 7: Register new routers in `main.py` [SHARED FILE]

**File:** `backend/app/main.py`

⚠️ Shared file — flag this to the team before merging.

- [ ] Add to the import block in `backend/app/main.py`:

```python
from app.api.v1.endpoints.drivers import router as drivers_router
from app.api.v1.endpoints.vehicles import router as vehicles_router
from app.api.v1.endpoints.precincts import router as precincts_router
```

- [ ] Add after the existing `app.include_router(auth_router, prefix="/api/v1")` line:

```python
app.include_router(drivers_router, prefix="/api/v1")
app.include_router(vehicles_router, prefix="/api/v1")
app.include_router(precincts_router, prefix="/api/v1")
```

---

## Task 8: Demo seed script

**File:** `backend/scripts/seed_demo.py`

Integration tests create and roll back their own DB fixtures. For running the frontend against a live backend, the dev DB needs real rows. Run once after `alembic upgrade head`. Safe to re-run — skips rows that already exist.

- [ ] Create `backend/scripts/seed_demo.py`:

```python
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
```

---

## Task 9: Frontend environment config

**File:** `frontend/dispatcher/.env.local`

`.env.local` is git-ignored by Next.js by default — do not commit it.

- [ ] Create `frontend/dispatcher/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Task 10: Frontend API client

**File:** `frontend/dispatcher/lib/api/client.ts`

Single fetch wrapper used by all hooks. `getToken()` is a no-op placeholder — the auth teammate replaces just that function body, and every hook gets auth for free.

- [ ] Create `frontend/dispatcher/lib/api/client.ts`:

```typescript
/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 *
 * Auth hookup: replace getToken() with the real Supabase session token once
 * the auth teammate merges their work. All hooks inherit auth automatically.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// Auth placeholder — teammate replaces this body with Supabase session lookup.
function getToken(): string | null {
  return null
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new ApiError(res.status, (body as { detail?: string }).detail ?? res.statusText)
  }

  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
}
```

---

## Task 11: Replace `useDrivers`

**File:** `frontend/dispatcher/lib/hooks/useDrivers.ts`

Return type stays `Driver[]` — no callers need to change.

- [ ] Replace the entire file:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import type { Driver } from '@shared/lib/types/driver'

export function useDrivers(): Driver[] {
  const [drivers, setDrivers] = useState<Driver[]>([])

  useEffect(() => {
    api.get<Driver[]>('/api/v1/drivers')
      .then(setDrivers)
      .catch(console.error)
  }, [])

  return drivers
}
```

---

## Task 12: Replace `useVehicles`

**File:** `frontend/dispatcher/lib/hooks/useVehicles.ts`

Return type stays `{ horses: Vehicle[]; trailers: Vehicle[]; all: Vehicle[] }`. Backend returns a flat list; hook splits by `vehicle_type`.

- [ ] Replace the entire file:

```typescript
'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api/client'
import type { Vehicle } from '@shared/lib/types/vehicle'

export function useVehicles(): { horses: Vehicle[]; trailers: Vehicle[]; all: Vehicle[] } {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  useEffect(() => {
    api.get<Vehicle[]>('/api/v1/vehicles')
      .then(setVehicles)
      .catch(console.error)
  }, [])

  return useMemo(() => ({
    horses: vehicles.filter(v => v.vehicle_type === 'horse'),
    trailers: vehicles.filter(v => v.vehicle_type === 'trailer'),
    all: vehicles,
  }), [vehicles])
}
```

---

## Task 13: Replace `usePrecincts`

**File:** `frontend/dispatcher/lib/hooks/usePrecincts.ts`

Return type stays `Precinct[]`.

- [ ] Replace the entire file:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import type { Precinct } from '@shared/lib/types/precinct'

export function usePrecincts(): Precinct[] {
  const [precincts, setPrecincts] = useState<Precinct[]>([])

  useEffect(() => {
    api.get<Precinct[]>('/api/v1/precincts')
      .then(setPrecincts)
      .catch(console.error)
  }, [])

  return precincts
}
```

---

## Task 14: Replace `useTrips`

**File:** `frontend/dispatcher/lib/hooks/useTrips.ts`

Return type stays `TripSummary[]`. All trips fetched once; filtering done client-side. `TripListItemResponse` from the backend maps directly to `TripSummary` — field names are identical.

- [ ] Replace the entire file:

```typescript
'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api/client'
import type { TripStatus, TripSummary } from '@shared/lib/types/trip'

export interface TripsFilter {
  status?: TripStatus[]
  driverId?: string
  hasExceptions?: boolean
}

export function useTrips(filter?: TripsFilter): TripSummary[] {
  const [trips, setTrips] = useState<TripSummary[]>([])

  useEffect(() => {
    api.get<TripSummary[]>('/api/v1/trips')
      .then(setTrips)
      .catch(console.error)
  }, [])

  const statusKey = filter?.status?.join(',') ?? ''
  const driverId = filter?.driverId ?? ''
  const hasExceptions = filter?.hasExceptions

  return useMemo(() => {
    return trips.filter(t => {
      if (filter?.status?.length && !filter.status.includes(t.status)) return false
      if (filter?.driverId && t.driver.id !== filter.driverId) return false
      if (hasExceptions !== undefined) {
        const hasOpen = t.open_exception_count > 0
        if (hasExceptions !== hasOpen) return false
      }
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, statusKey, driverId, hasExceptions])
}
```

---

## Task 15: Wire the trip creation form submit

**File:** `frontend/dispatcher/app/(app)/trips/new/page.tsx`

Three changes: add the API call to `handleSubmit`, fix the trailer validation to match the backend requirement (at least one), update the trailer label.

`commodity`, `weightKg`, `unitCount`, and `handling` from Step 1 are **not sent to the backend** — they belong on a `Consignment` (future sprint). `client_organization_id` is hardcoded to the demo client org ID that matches `seed_demo.py`.

- [ ] Add these imports at the top of the file (after the existing import block):

```typescript
import { api, ApiError } from '@/lib/api/client'
import type { TripDetailResponse } from '@shared/lib/types/trip'
```

- [ ] Add this constant below the imports, before the component function:

```typescript
// Matches the client org ID inserted by backend/scripts/seed_demo.py.
// Replace with a real org selector once GET /api/v1/organizations is built.
const DEMO_CLIENT_ORG_ID = '00000000-0000-0000-0000-000000000003'
```

- [ ] Replace the `handleSubmit` function entirely:

```typescript
const handleSubmit = async () => {
  setLoading(true)
  try {
    await api.post<TripDetailResponse>('/api/v1/trips', {
      order_number: orderNumber,
      client_organization_id: DEMO_CLIENT_ORG_ID,
      driver_id: driverId,
      horse_id: horseId,
      trailer_ids: trailerIds,
      origin_precinct_id: originId,
      destination_precinct_id: destId,
      planned_departure_at: plannedDeparture
        ? new Date(plannedDeparture).toISOString()
        : null,
      planned_arrival_at: expectedArrival
        ? new Date(expectedArrival).toISOString()
        : null,
    })
    notify({ kind: 'success', title: COPY.toast.tripCreated })
    router.push(ROUTES.home)
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      notify({ kind: 'error', title: 'Order number already active for this operator' })
    } else if (err instanceof ApiError && err.status === 404) {
      notify({ kind: 'error', title: 'Driver or vehicle not found — check fleet data' })
    } else {
      notify({ kind: 'error', title: 'Failed to create trip. Please try again.' })
    }
  } finally {
    setLoading(false)
  }
}
```

- [ ] Update `stepValid` — change index `2` to require at least one trailer:

```typescript
// Before:
!!(driverId && horseId),

// After:
!!(driverId && horseId && trailerIds.length > 0),
```

- [ ] Change the trailer label from `Trailers (optional)` to:

```typescript
<Lbl>Trailers * (at least one required)</Lbl>
```

---

## Final verification

Run all of these once all 15 tasks are complete.

**Backend tests:**
```bash
cd backend && pytest tests/integration/ -v
```
Expected: all pass.

**TypeScript check:**
```bash
cd frontend/dispatcher && npx tsc --noEmit
```
Expected: no errors.

**Seed the dev DB and smoke-test the full flow:**
```bash
# Terminal 1 — backend
cd backend && DEMO_MODE=true uvicorn app.main:app --reload

# Terminal 2 — seed once
cd backend && DEMO_MODE=true python scripts/seed_demo.py

# Terminal 3 — frontend
cd frontend/dispatcher && npm run dev
```

Open `http://localhost:3000/trips/new` and verify:
1. Step 2 driver dropdown shows "Sipho Dlamini" and "Thabo Mokoena"
2. Step 2 horse/trailer shows "CA 123-456" / "CA 789-012"
3. Step 3 origin/destination show the two seeded depots
4. Completing and submitting creates a trip (toast fires, redirect to dashboard)
5. Dashboard lists the new trip

Check `http://localhost:8000/docs` — all 5 new endpoints appear in Swagger.

---

## What's deliberately out of scope

| Feature | Why deferred |
|---|---|
| Auth (AuthContext, Supabase JWT) | Teammate owns this — `getToken()` in `client.ts` is the only hookup point needed |
| `GET /api/v1/organizations` | Needed for client org selector in the form; hardcoded demo ID for now |
| Frontend trip detail page (`useTrip` hook) | Detail page not yet wired |
| Exception / SLA endpoints | Separate sprint |
| Loading spinners / error banners in UI | Hooks log errors to console; UX polish deferred |
