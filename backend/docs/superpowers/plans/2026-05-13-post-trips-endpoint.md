# POST /trips Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `POST /api/v1/trips` so a dispatcher can create a new trip by linking a driver, horse, trailer(s), and order number — creating a Trip row, TripTrailer rows, and the H0 HandshakeEvent in one atomic DB transaction.

**Architecture:** The endpoint is thin — it validates input, calls `create_trip()` in `app/orchestration/trip_service.py`, and returns `TripDetailResponse`. All DB writes happen inside `create_trip()`. A stub auth dependency in `app/auth/dependencies.py` returns a hardcoded dispatcher in `DEMO_MODE=True`; real JWT auth slots in without touching the endpoint. Journey lock hash lives in `app/crypto/hashing.py`.

**Tech Stack:** FastAPI 0.115, SQLAlchemy 2.0 async (`AsyncSession`), Pydantic v2, pytest + pytest-asyncio (`asyncio_mode = auto`), PostgreSQL (asyncpg).

**Branch:** `feature/post-trips-endpoint` (already created off `dev`)

---

## File Map

| Action | File | What lives here |
|---|---|---|
| Modify | `backend/app/schemas/trips.py` | Add `TripCreateRequest`, `TripDetailResponse` |
| Create | `backend/app/auth/dependencies.py` | Stub `get_current_dispatcher()` dependency |
| Create | `backend/app/core/exceptions.py` | Domain exception classes (`TripConflictError`, `ResourceNotFoundError`) |
| Create | `backend/app/crypto/hashing.py` | `compute_journey_lock_hash()` |
| Create | `backend/app/orchestration/trip_service.py` | `create_trip()` orchestration function |
| Create | `backend/app/api/v1/endpoints/trips.py` | FastAPI router with `POST /trips` |
| Modify | `backend/app/main.py` | Register trips router |
| Modify | `backend/app/core/config.py` | Add `TEST_DATABASE_URL` |
| Modify | `backend/tests/conftest.py` | Async DB fixtures for integration tests |
| Create | `backend/tests/unit/test_hashing.py` | Unit tests for journey lock hash |
| Create | `backend/tests/integration/test_trips.py` | Integration tests for `POST /trips` |

---

## Task 1: Add `TripCreateRequest` and `TripDetailResponse` schemas

**Files:**
- Modify: `backend/app/schemas/trips.py`

The existing `TripCreate`/`TripRead` are DB-level schemas used by Alembic tests — leave them untouched. The new schemas serve the API surface.

`TripCreateRequest` = what the dispatcher POSTs (no auto-generated fields, no JWT-derived fields).  
`TripDetailResponse` = the full trip response (per API contract §4.2).

- [ ] **Step 1: Add the two new classes to the bottom of `schemas/trips.py`**

```python
# --- append to backend/app/schemas/trips.py ---

from app.schemas.handshakes import HandshakeEventRead
from app.schemas.transit import TripExceptionRead
from app.schemas.blockchain import BlockchainReceiptRead


class TripCreateRequest(BaseModel):
    """Dispatcher-facing trip creation payload — excludes auto-generated and JWT-derived fields."""
    model_config = ConfigDict(from_attributes=True)

    order_number: str
    client_organization_id: UUID
    driver_id: UUID
    horse_id: UUID
    trailer_ids: list[UUID]
    origin_precinct_id: UUID
    destination_precinct_id: UUID
    template_id: Optional[UUID] = None
    planned_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_request(self) -> "TripCreateRequest":
        if not self.trailer_ids:
            raise ValueError("At least one trailer is required")
        if self.origin_precinct_id == self.destination_precinct_id:
            raise ValueError("origin and destination precincts must differ")
        if self.planned_departure_at and self.planned_arrival_at:
            if self.planned_arrival_at <= self.planned_departure_at:
                raise ValueError("planned_arrival_at must be after planned_departure_at")
        return self


class TripDetailResponse(BaseModel):
    """Full trip record returned by POST /trips and GET /trips/{id}. No manifest."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_reference: str
    order_number: str
    status: TripStatus
    journey_lock_hash: Optional[str]
    idvs_check_status: IdvsStatus
    driver: DriverRead
    horse: VehicleRead
    trailers: list[VehicleRead]
    origin_precinct_id: UUID
    destination_precinct_id: UUID
    pulsit_trip_reference_id: Optional[str]
    planned_departure_at: Optional[datetime]
    actual_departure_at: Optional[datetime]
    planned_arrival_at: Optional[datetime]
    actual_arrival_at: Optional[datetime]
    closed_at: Optional[datetime]
    handshakes: list[HandshakeEventRead]
    exceptions: list[TripExceptionRead]
    blockchain_receipts: list[BlockchainReceiptRead]
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 2: Verify the imports at the top of `schemas/trips.py` already include everything needed**

The file already imports: `datetime`, `Decimal`, `UUID`, `Optional`, `Any`, `BaseModel`, `ConfigDict`, `model_validator`, `IdvsStatus`, `ParcelStatus`, `TripStatus`, `DriverRead`, `VehicleRead`.

The three new imports (`HandshakeEventRead`, `TripExceptionRead`, `BlockchainReceiptRead`) must be added at the top of the file. Add them to the existing import block — after the existing schema imports.

- [ ] **Step 3: Run a quick import check**

```bash
cd backend && python -c "from app.schemas.trips import TripCreateRequest, TripDetailResponse; print('OK')"
```

Expected: `OK` (no import errors).

---

## Task 2: Create domain exception classes

**Files:**
- Create: `backend/app/core/exceptions.py`

These are Python exceptions — not HTTP exceptions. The endpoint converts them. This keeps business logic clean of HTTP concerns.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_exceptions.py
from app.core.exceptions import TripConflictError, ResourceNotFoundError


def test_trip_conflict_error_carries_order_number():
    err = TripConflictError(order_number="ORD-001")
    assert "ORD-001" in str(err)


def test_resource_not_found_error_carries_resource_and_id():
    err = ResourceNotFoundError(resource="Driver", resource_id="abc-123")
    assert "Driver" in str(err)
    assert "abc-123" in str(err)
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/unit/test_exceptions.py -v
```

Expected: `ImportError` (file doesn't exist yet).

- [ ] **Step 3: Create `backend/app/core/exceptions.py`**

```python
"""Domain exceptions raised by the orchestration layer.

Endpoints catch these and map them to the appropriate HTTP status codes.
Do not import FastAPI here — this module must remain framework-agnostic.
"""


class TripConflictError(Exception):
    """Raised when a trip with the given order_number is already active."""

    def __init__(self, order_number: str) -> None:
        super().__init__(
            f"An active trip already exists for order_number='{order_number}'. "
            "Cancel or close the existing trip before creating a new one."
        )
        self.order_number = order_number


class ResourceNotFoundError(Exception):
    """Raised when a required DB record does not exist or is not accessible."""

    def __init__(self, resource: str, resource_id: str) -> None:
        super().__init__(f"{resource} with id='{resource_id}' not found or inactive.")
        self.resource = resource
        self.resource_id = resource_id
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd backend && pytest tests/unit/test_exceptions.py -v
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/exceptions.py backend/tests/unit/test_exceptions.py
git commit -m "feat(api): add domain exception classes for orchestration layer"
```

---

## Task 3: Create journey lock hash function

**Files:**
- Create: `backend/app/crypto/hashing.py`
- Create: `backend/tests/unit/test_hashing.py`

The journey lock hash is SHA-256 of the canonical string of fixed trip parameters. It proves the trip was created with these exact values — any later discrepancy without an exception event signals tampering.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_hashing.py
import uuid
from app.crypto.hashing import compute_journey_lock_hash


def test_hash_is_64_hex_chars():
    trip_id = uuid.uuid4()
    driver_id = uuid.uuid4()
    horse_id = uuid.uuid4()
    trailer_ids = [uuid.uuid4(), uuid.uuid4()]
    origin_id = uuid.uuid4()
    dest_id = uuid.uuid4()
    result = compute_journey_lock_hash(
        trip_id=trip_id,
        order_number="ORD-001",
        driver_id=driver_id,
        horse_id=horse_id,
        trailer_ids=trailer_ids,
        origin_precinct_id=origin_id,
        destination_precinct_id=dest_id,
    )
    assert isinstance(result, str)
    assert len(result) == 64
    assert all(c in "0123456789abcdef" for c in result)


def test_hash_is_deterministic():
    trip_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    driver_id = uuid.UUID("22222222-2222-2222-2222-222222222222")
    horse_id = uuid.UUID("33333333-3333-3333-3333-333333333333")
    trailer_ids = [
        uuid.UUID("44444444-4444-4444-4444-444444444444"),
        uuid.UUID("55555555-5555-5555-5555-555555555555"),
    ]
    origin_id = uuid.UUID("66666666-6666-6666-6666-666666666666")
    dest_id = uuid.UUID("77777777-7777-7777-7777-777777777777")
    kwargs = dict(
        trip_id=trip_id,
        order_number="ORD-002",
        driver_id=driver_id,
        horse_id=horse_id,
        trailer_ids=trailer_ids,
        origin_precinct_id=origin_id,
        destination_precinct_id=dest_id,
    )
    assert compute_journey_lock_hash(**kwargs) == compute_journey_lock_hash(**kwargs)


def test_trailer_order_does_not_affect_hash():
    """Trailer list is sorted before hashing so insertion order is irrelevant."""
    t1 = uuid.UUID("44444444-4444-4444-4444-444444444444")
    t2 = uuid.UUID("55555555-5555-5555-5555-555555555555")
    base = dict(
        trip_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        order_number="ORD-003",
        driver_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        horse_id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        origin_precinct_id=uuid.UUID("66666666-6666-6666-6666-666666666666"),
        destination_precinct_id=uuid.UUID("77777777-7777-7777-7777-777777777777"),
    )
    h1 = compute_journey_lock_hash(**base, trailer_ids=[t1, t2])
    h2 = compute_journey_lock_hash(**base, trailer_ids=[t2, t1])
    assert h1 == h2


def test_different_inputs_produce_different_hash():
    base = dict(
        trip_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        order_number="ORD-004",
        driver_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        horse_id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        trailer_ids=[uuid.UUID("44444444-4444-4444-4444-444444444444")],
        origin_precinct_id=uuid.UUID("66666666-6666-6666-6666-666666666666"),
        destination_precinct_id=uuid.UUID("77777777-7777-7777-7777-777777777777"),
    )
    h1 = compute_journey_lock_hash(**base)
    h2 = compute_journey_lock_hash(**{**base, "order_number": "ORD-999"})
    assert h1 != h2
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/unit/test_hashing.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Create `backend/app/crypto/hashing.py`**

```python
"""SHA-256 hashing utilities for FreightProof evidence integrity.

compute_journey_lock_hash() is the canonical hash of a trip's immutable
parameters at creation time. It is stored on the Trip row and anchored to
Hedera HCS. Any post-creation mismatch between the DB value and the Hedera
record indicates tampering.
"""

import hashlib
import uuid


def compute_journey_lock_hash(
    *,
    trip_id: uuid.UUID,
    order_number: str,
    driver_id: uuid.UUID,
    horse_id: uuid.UUID,
    trailer_ids: list[uuid.UUID],
    origin_precinct_id: uuid.UUID,
    destination_precinct_id: uuid.UUID,
) -> str:
    """Return a 64-char lowercase hex SHA-256 digest of the trip's fixed parameters.

    Trailers are sorted before hashing so that insertion order does not affect
    the result — only the set of trailers matters.
    """
    sorted_trailers = ",".join(sorted(str(t) for t in trailer_ids))
    canonical = (
        f"trip_id={trip_id}"
        f"|order_number={order_number}"
        f"|driver_id={driver_id}"
        f"|horse_id={horse_id}"
        f"|trailers={sorted_trailers}"
        f"|origin={origin_precinct_id}"
        f"|destination={destination_precinct_id}"
    )
    return hashlib.sha256(canonical.encode()).hexdigest()
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd backend && pytest tests/unit/test_hashing.py -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/crypto/hashing.py backend/tests/unit/test_hashing.py
git commit -m "feat(crypto): add compute_journey_lock_hash for trip integrity"
```

---

## Task 4: Create auth stub dependency

**Files:**
- Create: `backend/app/auth/dependencies.py`

This stub returns a fixed `UserRead` when `DEMO_MODE=True` (already in `config.py`). When `DEMO_MODE=False` it raises 401. Real JWT auth replaces only the body of `get_current_dispatcher()` — the endpoint import never changes.

- [ ] **Step 1: Create `backend/app/auth/dependencies.py`**

```python
"""FastAPI auth dependencies.

get_current_dispatcher() is the Depends() used by all dispatcher endpoints.
In DEMO_MODE=True it returns a fixed stub user so endpoints can be tested
without a real JWT implementation. When DEMO_MODE=False it raises 401.

Replace the body of _resolve_dispatcher_from_token() once the JWT module lands.
"""

import uuid
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.schemas.people import UserRead

_bearer_scheme = HTTPBearer(auto_error=False)

# Fixed stub identity used in DEMO_MODE — must match the org created by DB seeds.
_DEMO_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
_DEMO_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
_DEMO_NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)

_DEMO_USER = UserRead(
    id=_DEMO_USER_ID,
    organization_id=_DEMO_ORG_ID,
    email="demo-dispatcher@freightproof.co.za",
    full_name="Demo Dispatcher",
    is_active=True,
    created_at=_DEMO_NOW,
    updated_at=_DEMO_NOW,
)


async def get_current_dispatcher(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> UserRead:
    """Return the authenticated dispatcher for the current request.

    Raises HTTP 401 if authentication fails.
    """
    if settings.DEMO_MODE:
        return _DEMO_USER

    # TODO: decode and verify the JWT, look up the User row in the DB.
    # Replace this block when the auth module is implemented.
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication not yet implemented. Set DEMO_MODE=True for local dev.",
        headers={"WWW-Authenticate": "Bearer"},
    )
```

- [ ] **Step 2: Verify import**

```bash
cd backend && python -c "from app.auth.dependencies import get_current_dispatcher; print('OK')"
```

Expected: `OK`.

---

## Task 5: Create trip orchestration service

**Files:**
- Create: `backend/app/orchestration/trip_service.py`

`create_trip()` performs all DB writes in a single logical unit. It validates all referenced FK records exist before touching the DB. If any record is missing, it raises `ResourceNotFoundError` (→ 404). If the order_number is already active, it raises `TripConflictError` (→ 409).

- [ ] **Step 1: Create `backend/app/orchestration/trip_service.py`**

```python
"""Trip orchestration — create_trip() is the single entry point for trip creation.

Layering: this module imports from db/, crypto/, and schemas/ only.
It must never import from api/ or auth/.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError, TripConflictError
from app.crypto.hashing import compute_journey_lock_hash
from app.db.models.enums import HandshakeStatus, HandshakeType, IdvsStatus, TripStatus
from app.db.models.handshakes import HandshakeEvent
from app.db.models.people import Driver
from app.db.models.trips import Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.handshakes import HandshakeEventRead
from app.schemas.people import DriverRead, UserRead
from app.schemas.transit import TripExceptionRead
from app.schemas.trips import TripCreateRequest, TripDetailResponse
from app.schemas.vehicles import VehicleRead


def _generate_trip_reference() -> str:
    """Return a unique trip reference in the format FP-YYYYMMDD-XXXXXXXX."""
    date_str = datetime.now(UTC).strftime("%Y%m%d")
    short_id = uuid.uuid4().hex[:8].upper()
    return f"FP-{date_str}-{short_id}"


async def _fetch_driver(db: AsyncSession, driver_id: uuid.UUID) -> Driver:
    result = await db.execute(
        select(Driver).where(Driver.id == driver_id, Driver.is_active.is_(True))
    )
    driver = result.scalar_one_or_none()
    if driver is None:
        raise ResourceNotFoundError("Driver", str(driver_id))
    return driver


async def _fetch_vehicle(
    db: AsyncSession, vehicle_id: uuid.UUID, expected_type: str
) -> Vehicle:
    result = await db.execute(
        select(Vehicle).where(
            Vehicle.id == vehicle_id,
            Vehicle.is_active.is_(True),
            Vehicle.vehicle_type == expected_type,
        )
    )
    vehicle = result.scalar_one_or_none()
    if vehicle is None:
        raise ResourceNotFoundError(expected_type.capitalize(), str(vehicle_id))
    return vehicle


async def _check_order_number_conflict(
    db: AsyncSession,
    order_number: str,
    operator_org_id: uuid.UUID,
) -> None:
    """Raise TripConflictError if an active trip already has this order_number."""
    active_statuses = [
        TripStatus.CREATED,
        TripStatus.ORIGIN_GATE_IN,
        TripStatus.LOADING,
        TripStatus.ORIGIN_GATE_OUT,
        TripStatus.IN_TRANSIT,
        TripStatus.DEST_GATE_IN,
        TripStatus.UNLOADING,
        TripStatus.EXCEPTION_HOLD,
    ]
    conflict_exists = await db.execute(
        select(
            exists().where(
                Trip.order_number == order_number,
                Trip.operator_organization_id == operator_org_id,
                Trip.status.in_(active_statuses),
            )
        )
    )
    if conflict_exists.scalar():
        raise TripConflictError(order_number)


async def create_trip(
    db: AsyncSession,
    payload: TripCreateRequest,
    current_user: UserRead,
) -> TripDetailResponse:
    """Create a Trip, TripTrailer rows, and the H0 HandshakeEvent atomically.

    Raises:
        ResourceNotFoundError: if driver, horse, or any trailer is not found/inactive.
        TripConflictError: if an active trip already exists for the given order_number.
    """
    # 1. Validate all referenced records exist before any writes.
    driver = await _fetch_driver(db, payload.driver_id)
    horse = await _fetch_vehicle(db, payload.horse_id, "horse")
    trailers: list[Vehicle] = []
    for trailer_id in payload.trailer_ids:
        trailers.append(await _fetch_vehicle(db, trailer_id, "trailer"))

    # 2. Guard against duplicate active order_number within this operator org.
    await _check_order_number_conflict(
        db, payload.order_number, current_user.organization_id
    )

    # 3. Create the Trip row.
    trip_id = uuid.uuid4()
    trip = Trip(
        id=trip_id,
        trip_reference=_generate_trip_reference(),
        order_number=payload.order_number,
        operator_organization_id=current_user.organization_id,
        client_organization_id=payload.client_organization_id,
        driver_id=payload.driver_id,
        horse_id=payload.horse_id,
        origin_precinct_id=payload.origin_precinct_id,
        destination_precinct_id=payload.destination_precinct_id,
        template_id=payload.template_id,
        planned_departure_at=payload.planned_departure_at,
        planned_arrival_at=payload.planned_arrival_at,
        status=TripStatus.CREATED,
        idvs_check_status=IdvsStatus.PENDING,
        created_by_user_id=current_user.id,
    )
    db.add(trip)

    # 4. Create TripTrailer rows — snapshot the Pulsit device ID at creation time
    #    so retroactive vehicle reassignment cannot alter the evidence chain.
    for vehicle in trailers:
        db.add(
            TripTrailer(
                trip_id=trip_id,
                trailer_id=vehicle.id,
                pulsit_device_id_snapshot=vehicle.pulsit_device_id,
            )
        )

    # 5. Create the H0 HandshakeEvent (Trip Creation handshake).
    h0 = HandshakeEvent(
        trip_id=trip_id,
        handshake_type=HandshakeType.TRIP_CREATION,
        sequence_number=0,
        status=HandshakeStatus.PENDING,
    )
    db.add(h0)

    # Flush so trip_id and h0.id are populated by the DB before the hash step.
    await db.flush()

    # 6. Compute journey lock hash over the immutable trip parameters.
    lock_hash = compute_journey_lock_hash(
        trip_id=trip_id,
        order_number=payload.order_number,
        driver_id=payload.driver_id,
        horse_id=payload.horse_id,
        trailer_ids=payload.trailer_ids,
        origin_precinct_id=payload.origin_precinct_id,
        destination_precinct_id=payload.destination_precinct_id,
    )
    trip.journey_lock_hash = lock_hash

    await db.commit()
    await db.refresh(trip)
    await db.refresh(h0)

    # NOTE: Hedera HCS anchor task would be queued here via Celery once that
    # module is implemented. Skipped in this PR — see tasks/ module.

    # 7. Assemble and return the response (no ORM relationships — fetch separately).
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
        handshakes=[HandshakeEventRead.model_validate(h0)],
        exceptions=[],
        blockchain_receipts=[],
    )
```

- [ ] **Step 2: Verify import**

```bash
cd backend && python -c "from app.orchestration.trip_service import create_trip; print('OK')"
```

Expected: `OK`.

---

## Task 6: Create the trips endpoint

**Files:**
- Create: `backend/app/api/v1/endpoints/trips.py`

Thin endpoint: validate → call service → return. All exceptions caught and mapped to HTTP status codes here.

- [ ] **Step 1: Create `backend/app/api/v1/endpoints/trips.py`**

```python
"""FastAPI router for trip lifecycle endpoints.

POST /trips  — create a new trip (Handshake 0).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import ResourceNotFoundError, TripConflictError
from app.db.session import get_db
from app.orchestration.trip_service import create_trip
from app.schemas.people import UserRead
from app.schemas.trips import TripCreateRequest, TripDetailResponse

router = APIRouter(prefix="/trips", tags=["trips"])


@router.post(
    "",
    response_model=TripDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new trip (Handshake 0)",
)
async def create_trip_endpoint(
    payload: TripCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripDetailResponse:
    """Create a trip by linking driver, horse, trailer(s), and order number.

    Returns the full TripDetailResponse including the H0 HandshakeEvent.
    """
    try:
        return await create_trip(db=db, payload=payload, current_user=current_user)
    except TripConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
```

- [ ] **Step 2: Verify import**

```bash
cd backend && python -c "from app.api.v1.endpoints.trips import router; print('OK')"
```

Expected: `OK`.

---

## Task 7: Register the router in `main.py`

**Files:**
- Modify: `backend/app/main.py`

Shared file — coordinate with team. Add the trips router under `/api/v1`.

- [ ] **Step 1: Add the router import and registration to `backend/app/main.py`**

Add after the existing imports:
```python
from app.api.v1.endpoints.trips import router as trips_router
```

Add after the middleware block:
```python
app.include_router(trips_router, prefix="/api/v1")
```

The complete updated `main.py`:

```python
# FreightProof SA — FastAPI application entry point
# This is the root of the backend. All routers will be registered here
# as the API is built out. CORS is configured here for frontend access.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.endpoints.trips import router as trips_router

app = FastAPI(
    title="FreightProof SA",
    description="Cargo theft and disputed delivery evidence platform",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trips_router, prefix="/api/v1")


@app.get("/health", tags=["system"])
async def health_check():
    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        "version": "0.1.0",
    }
```

- [ ] **Step 2: Verify FastAPI sees the route**

```bash
cd backend && python -c "
from app.main import app
routes = [r.path for r in app.routes]
assert '/api/v1/trips' in routes, f'Route missing. Found: {routes}'
print('Route registered OK')
"
```

Expected: `Route registered OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/v1/endpoints/trips.py backend/app/auth/dependencies.py \
        backend/app/core/exceptions.py backend/app/orchestration/trip_service.py \
        backend/app/main.py backend/app/schemas/trips.py
git commit -m "feat(api): add POST /api/v1/trips endpoint with H0 handshake creation"
```

---

## Task 8: Add `TEST_DATABASE_URL` to config

**Files:**
- Modify: `backend/app/core/config.py`
- Note: `.env.example` should also be updated (not committed here).

Integration tests need their own database so they don't pollute dev data.

- [ ] **Step 1: Add `TEST_DATABASE_URL` to `Settings` in `core/config.py`**

Add this field inside the `Settings` class, after `DATABASE_URL`:

```python
# Separate async PostgreSQL URL for integration tests.
# Must point at a throwaway database — tests create and drop tables.
TEST_DATABASE_URL: str = ""
```

- [ ] **Step 2: Add the key to `.env.example`**

In `.env.example`, add (key name only, no value):

```
TEST_DATABASE_URL=
```

- [ ] **Step 3: Create a test database in your local Postgres**

Run this once in your terminal (not in code):

```bash
createdb freightproof_test
# Then in your backend/.env add:
# TEST_DATABASE_URL=postgresql+asyncpg://postgres:password@localhost/freightproof_test
```

---

## Task 9: Set up integration test conftest

**Files:**
- Modify: `backend/tests/conftest.py`

The conftest creates all DB tables once per session. Each test gets a session wrapped in a connection-level transaction that is rolled back after the test — so every test starts with a clean DB.

- [ ] **Step 1: Replace `backend/tests/conftest.py` with the full fixture setup**

```python
"""pytest fixtures shared across all tests.

Integration test strategy: each test runs inside a connection-level transaction
that is rolled back after the test. This gives every test a clean DB state
without truncating tables between tests.

Requires TEST_DATABASE_URL in backend/.env pointing at a throwaway PostgreSQL DB.
"""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.db.models import Base


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """Create the test engine and schema once per session."""
    if not settings.TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL not set — skipping integration tests")

    engine = create_async_engine(settings.TEST_DATABASE_URL, pool_pre_ping=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine):
    """Yield a rolled-back AsyncSession for each test — leaves DB clean."""
    async with test_engine.connect() as conn:
        transaction = await conn.begin()
        session = AsyncSession(
            bind=conn,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()
```

- [ ] **Step 2: Add `asyncio_mode = auto` to pytest config if not present**

Check `backend/pyproject.toml` or `backend/pytest.ini`. If no pytest config exists, create `backend/pytest.ini`:

```ini
[pytest]
asyncio_mode = auto
```

- [ ] **Step 3: Verify conftest loads cleanly**

```bash
cd backend && pytest --collect-only 2>&1 | head -20
```

Expected: no import errors. If `TEST_DATABASE_URL` is not set, integration tests will be skipped — that's fine for now.

---

## Task 10: Write integration tests for `POST /trips`

**Files:**
- Create: `backend/tests/integration/test_trips.py`

These tests hit the real endpoint via `httpx.AsyncClient` and assert both the HTTP response and the DB state.

Before running these you need:
1. `TEST_DATABASE_URL` set in `backend/.env`
2. `DEMO_MODE=True` in `backend/.env`
3. Seed data inserted by the fixture (organizations, driver, vehicles, precincts).

- [ ] **Step 1: Write the test file**

```python
"""Integration tests for POST /api/v1/trips.

These tests use a real PostgreSQL test database (TEST_DATABASE_URL) and a
rolled-back transaction per test. DEMO_MODE=True is required — the stub auth
dependency returns a fixed user whose organization_id is _DEMO_ORG_ID.
"""

import uuid
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.main import app
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver
from app.db.models.vehicles import Vehicle
from app.db.models.trips import Trip, TripTrailer
from app.db.models.handshakes import HandshakeEvent
from app.db.models.enums import (
    HandshakeStatus, HandshakeType, IdvsStatus,
    OrganizationType, TripStatus, VehicleType,
)
from app.auth.dependencies import _DEMO_ORG_ID, _DEMO_USER_ID

# ─── Seed fixtures ──────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seed_data(db_session: AsyncSession):
    """Insert the minimal rows required by POST /trips and yield their IDs."""

    operator_org = Organization(
        id=_DEMO_ORG_ID,
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    client_org = Organization(
        id=uuid.uuid4(),
        name="Demo Client",
        org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([operator_org, client_org])
    await db_session.flush()

    origin = Precinct(
        id=uuid.uuid4(),
        name="Cape Town Depot",
        principal_organization_id=client_org.id,
        latitude="33.9249",
        longitude="18.4241",
    )
    destination = Precinct(
        id=uuid.uuid4(),
        name="Johannesburg Depot",
        principal_organization_id=client_org.id,
        latitude="26.2041",
        longitude="28.0473",
    )
    db_session.add_all([origin, destination])
    await db_session.flush()

    driver = Driver(
        id=uuid.uuid4(),
        organization_id=_DEMO_ORG_ID,
        full_name="Test Driver",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-001",
        idvs_status=IdvsStatus.PENDING,
    )
    horse = Vehicle(
        id=uuid.uuid4(),
        organization_id=_DEMO_ORG_ID,
        registration="CA 123-456",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-HORSE-001",
    )
    trailer = Vehicle(
        id=uuid.uuid4(),
        organization_id=_DEMO_ORG_ID,
        registration="CA 789-012",
        vehicle_type=VehicleType.TRAILER,
        pulsit_device_id="PLT-TRAILER-001",
    )
    db_session.add_all([driver, horse, trailer])
    await db_session.flush()

    yield {
        "client_org_id": client_org.id,
        "origin_id": origin.id,
        "destination_id": destination.id,
        "driver_id": driver.id,
        "horse_id": horse.id,
        "trailer_id": trailer.id,
        "trailer_pulsit_id": trailer.pulsit_device_id,
    }


# ─── Helpers ────────────────────────────────────────────────────────────────

def _make_payload(seed) -> dict:
    return {
        "order_number": "ORD-TEST-001",
        "client_organization_id": str(seed["client_org_id"]),
        "driver_id": str(seed["driver_id"]),
        "horse_id": str(seed["horse_id"]),
        "trailer_ids": [str(seed["trailer_id"])],
        "origin_precinct_id": str(seed["origin_id"]),
        "destination_precinct_id": str(seed["destination_id"]),
    }


# ─── Tests ──────────────────────────────────────────────────────────────────

async def test_create_trip_returns_201(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 201


async def test_create_trip_response_shape(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
    body = resp.json()
    assert body["status"] == "created"
    assert body["order_number"] == "ORD-TEST-001"
    assert body["trip_reference"].startswith("FP-")
    assert len(body["trip_reference"]) == len("FP-20260513-XXXXXXXX")
    assert body["journey_lock_hash"] is not None
    assert len(body["journey_lock_hash"]) == 64
    assert body["idvs_check_status"] == "pending"
    assert len(body["handshakes"]) == 1
    assert body["handshakes"][0]["handshake_type"] == "trip_creation"
    assert body["handshakes"][0]["status"] == "pending"
    assert body["trailers"] != []
    assert body["exceptions"] == []
    assert body["blockchain_receipts"] == []


async def test_create_trip_writes_to_db(seed_data, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
            headers={"Authorization": "Bearer demo"},
        )
    trip_id = uuid.UUID(resp.json()["id"])

    trip_row = (await db_session.execute(select(Trip).where(Trip.id == trip_id))).scalar_one()
    assert trip_row.status == TripStatus.CREATED
    assert trip_row.journey_lock_hash is not None

    trailer_rows = (
        await db_session.execute(select(TripTrailer).where(TripTrailer.trip_id == trip_id))
    ).scalars().all()
    assert len(trailer_rows) == 1
    assert trailer_rows[0].pulsit_device_id_snapshot == seed_data["trailer_pulsit_id"]

    h0_row = (
        await db_session.execute(
            select(HandshakeEvent).where(HandshakeEvent.trip_id == trip_id)
        )
    ).scalar_one()
    assert h0_row.handshake_type == HandshakeType.TRIP_CREATION
    assert h0_row.sequence_number == 0
    assert h0_row.status == HandshakeStatus.PENDING


async def test_create_trip_409_on_duplicate_order_number(seed_data, db_session):
    payload = _make_payload(seed_data)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
        assert first.status_code == 201

        second = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
    assert second.status_code == 409
    assert "ORD-TEST-001" in second.json()["detail"]


async def test_create_trip_404_unknown_driver(seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["driver_id"] = str(uuid.uuid4())  # nonexistent
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
    assert resp.status_code == 404
    assert "Driver" in resp.json()["detail"]


async def test_create_trip_422_no_trailers(seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["trailer_ids"] = []
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
    assert resp.status_code == 422


async def test_create_trip_422_same_origin_and_destination(seed_data, db_session):
    payload = _make_payload(seed_data)
    payload["destination_precinct_id"] = payload["origin_precinct_id"]
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips", json=payload, headers={"Authorization": "Bearer demo"}
        )
    assert resp.status_code == 422


async def test_create_trip_401_without_demo_mode(seed_data, db_session, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.DEMO_MODE", False)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/trips",
            json=_make_payload(seed_data),
        )
    assert resp.status_code == 401
```

- [ ] **Step 2: Run the integration tests**

```bash
cd backend && pytest tests/integration/test_trips.py -v
```

Expected: all 7 tests pass (requires `TEST_DATABASE_URL` and `DEMO_MODE=True` in `.env`).

- [ ] **Step 3: Run the full test suite**

```bash
cd backend && pytest -v
```

Expected: all tests pass. No regressions in existing unit tests.

- [ ] **Step 4: Final commit**

```bash
git add backend/tests/conftest.py backend/tests/integration/test_trips.py \
        backend/app/core/config.py
git commit -m "test(api): add integration tests for POST /api/v1/trips"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** API contract §3.2 POST /trips — request body, 201/422/409 responses covered. `TripDetailResponse` matches §4.2. H0 HandshakeEvent created on trip creation (§5 `create_trip` side effects). Journey lock hash computed (§5). IDVS stub (PENDING status, no external call). Celery anchor queued via comment/TODO (out of scope for this PR, Celery module doesn't exist).
- [x] **No placeholders:** All code blocks are complete and runnable.
- [x] **Type consistency:** `TripCreateRequest` defined in Task 1, imported in Tasks 5+6. `TripDetailResponse` defined in Task 1, returned in Tasks 5+6. `ResourceNotFoundError`/`TripConflictError` defined in Task 2, raised in Task 5, caught in Task 6. `compute_journey_lock_hash` defined in Task 3, called in Task 5.
- [x] **Shared files flagged:** `main.py` and `core/config.py` modified — coordinate with team.

---

## New `.env` keys required

| Key | Purpose |
|---|---|
| `TEST_DATABASE_URL` | Async PostgreSQL URL for integration test DB (e.g. `postgresql+asyncpg://postgres:pass@localhost/freightproof_test`). Leave empty to skip integration tests. |
| `DEMO_MODE` | Set to `True` for local dev to bypass JWT auth. Already exists in config; ensure it's set in `.env`. |
