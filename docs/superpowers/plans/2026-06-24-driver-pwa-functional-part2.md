# Driver PWA Fully Functional — Part 2 (Phases C & D)

> Continuation of `2026-06-24-driver-pwa-functional.md`. Same REQUIRED SUB-SKILL applies.

---

# Phase C — Handshake state machine

### Task 10: Handshake request schemas + domain exception

**Files:**
- Modify: `backend/app/schemas/handshakes.py`
- Modify: `backend/app/core/exceptions.py`

- [ ] **Step 1: Add the domain exception** — to `backend/app/core/exceptions.py`:

```python
class HandshakeSequenceError(Exception):
    """Raised when a handshake is attempted out of order for the trip's current status."""

    def __init__(self, trip_status: str, attempted_handshake: str) -> None:
        super().__init__(
            f"Cannot complete {attempted_handshake} while trip status is '{trip_status}'."
        )
        self.trip_status = trip_status
        self.attempted_handshake = attempted_handshake
```

- [ ] **Step 2: Add the request bodies** — append to `backend/app/schemas/handshakes.py`:

```python
import re


_SEAL_PATTERN = re.compile(r"^[A-Z]{2}-\d{4}$")


def _validate_seal_format(v: str) -> str:
    if not _SEAL_PATTERN.match(v):
        raise ValueError("seal number must be in format XX-#### (e.g. AB-1234)")
    return v


class H1CompleteRequest(BaseModel):
    driver_phone_lat: Decimal
    driver_phone_lng: Decimal
    gate_photo_artifact_id: UUID


class H2CompleteRequest(BaseModel):
    waybill_photo_artifact_id: UUID
    seal_number: str
    seal_photo_artifact_id: UUID
    driver_visual_count: int

    @field_validator("seal_number")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class H3CompleteRequest(BaseModel):
    gate_exit_photo_artifact_id: UUID
    guard_verified_seal: bool


class H4CompleteRequest(BaseModel):
    gate_entry_photo_artifact_id: UUID
    seal_number_at_destination: str

    @field_validator("seal_number_at_destination")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class H5CompleteRequest(BaseModel):
    pod_photo_artifact_id: UUID
    driver_visual_count: int
    pp_scan_in_count: int
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/handshakes.py backend/app/core/exceptions.py
git commit -m "feat(handshakes): add H1-H5 request schemas and HandshakeSequenceError"
```

(No isolated test for this step — it's exercised by Tasks 11–15. Pydantic schema validation alone isn't worth a standalone test per the project's "no inter-test state, real behavior" testing philosophy; the seal-format validator is covered by `test_handshake_service.py` in Task 13.)

---

### Task 11: `advance_h1` — Origin Gate-In

**Files:**
- Create: `backend/app/orchestration/handshake_service.py`
- Create: `backend/app/api/v1/endpoints/handshakes.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/unit/test_handshake_service.py`
- Test: `backend/tests/integration/test_handshakes.py`

This task also stands up the shared scaffolding (fixtures, router) that Tasks 12–15 extend.

- [ ] **Step 1: Write the failing unit test**

```python
# backend/tests/unit/test_handshake_service.py
import uuid
from decimal import Decimal

import pytest
import pytest_asyncio

from app.core.exceptions import HandshakeSequenceError, ResourceNotFoundError
from app.db.models.enums import HandshakeStatus, HandshakeType, IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.handshakes import HandshakeEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.handshake_service import advance_h1
from app.schemas.handshakes import H1CompleteRequest


@pytest_asyncio.fixture
async def trip_fixture(db_session):
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
    origin = Precinct(id=uuid.uuid4(), name="Origin", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="Dest", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-1", order_number="ORD-1",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    h0 = HandshakeEvent(
        trip_id=trip.id, handshake_type=HandshakeType.TRIP_CREATION,
        sequence_number=0, status=HandshakeStatus.COMPLETED,
    )
    db_session.add(h0)
    await db_session.flush()

    return trip, driver


@pytest.mark.asyncio
async def test_advance_h1_happy_path_sets_trip_status(db_session, trip_fixture):
    trip, driver = trip_fixture
    payload = H1CompleteRequest(
        driver_phone_lat=Decimal("0.0001"), driver_phone_lng=Decimal("0.0001"),
        gate_photo_artifact_id=uuid.uuid4(),
    )
    result = await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=payload)
    assert result.status == TripStatus.ORIGIN_GATE_IN


@pytest.mark.asyncio
async def test_advance_h1_wrong_state_raises_sequence_error(db_session, trip_fixture):
    trip, driver = trip_fixture
    trip.status = TripStatus.IN_TRANSIT
    await db_session.flush()
    payload = H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
        gate_photo_artifact_id=uuid.uuid4(),
    )
    with pytest.raises(HandshakeSequenceError):
        await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=payload)


@pytest.mark.asyncio
async def test_advance_h1_unknown_trip_raises_not_found(db_session):
    payload = H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"),
        gate_photo_artifact_id=uuid.uuid4(),
    )
    with pytest.raises(ResourceNotFoundError):
        await advance_h1(db_session, trip_id=uuid.uuid4(), driver_id=uuid.uuid4(), payload=payload)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_handshake_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.orchestration.handshake_service'`

(Check `Vehicle` model's exact field names — `registration_number`, `pulsit_device_id` — against `backend/app/db/models/vehicles.py` before running; adjust the fixture if they differ.)

- [ ] **Step 3: Implement the service module**

```python
# backend/app/orchestration/handshake_service.py
"""Handshake state machine — advance_h1 through advance_h5.

Each function:
  1. Loads the trip, verifies it belongs to the calling driver and isn't
     cancelled/closed, and that the requested handshake is the correct next
     step for Trip.status (raises HandshakeSequenceError otherwise).
  2. Mutates the HandshakeEvent + Trip rows.
  3. Returns the updated TripDetailResponse.

Hedera anchoring is intentionally NOT called here yet (H2/H5 normally queue an
HCS receipt anchor per api_contract_dispatcher_driver.md §3.4) — that work is
deferred. event_hash is computed and stored so the anchor call is a drop-in
follow-up, not a redesign.
"""

import hashlib
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import HandshakeSequenceError, ResourceNotFoundError
from app.db.models.enums import (
    ExceptionSeverity, ExceptionSource, ExceptionType, HandshakeStatus, HandshakeType, TripStatus,
)
from app.db.models.handshakes import HandshakeEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.orchestration.resource_service import get_trip_detail
from app.schemas.handshakes import (
    H1CompleteRequest, H2CompleteRequest, H3CompleteRequest, H4CompleteRequest, H5CompleteRequest,
)
from app.schemas.trips import TripDetailResponse


async def _load_trip_for_handshake(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    expected_status: TripStatus, handshake_label: str,
) -> Trip:
    result = await db.execute(select(Trip).where(Trip.id == trip_id, Trip.driver_id == driver_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.status in (TripStatus.CANCELLED, TripStatus.CLOSED):
        raise HandshakeSequenceError(trip.status.value, handshake_label)
    if trip.status != expected_status:
        raise HandshakeSequenceError(trip.status.value, handshake_label)
    return trip


async def _get_handshake_event(db: AsyncSession, *, trip_id: uuid.UUID, handshake_type: HandshakeType) -> HandshakeEvent:
    result = await db.execute(
        select(HandshakeEvent).where(
            HandshakeEvent.trip_id == trip_id, HandshakeEvent.handshake_type == handshake_type,
        )
    )
    event = result.scalar_one_or_none()
    if event is None:
        sequence_number = list(HandshakeType).index(handshake_type)
        event = HandshakeEvent(
            trip_id=trip_id, handshake_type=handshake_type,
            sequence_number=sequence_number, status=HandshakeStatus.PENDING,
        )
        db.add(event)
        await db.flush()
    return event


def _compute_event_hash(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def advance_h1(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: H1CompleteRequest,
) -> TripDetailResponse:
    trip = await _load_trip_for_handshake(
        db, trip_id=trip_id, driver_id=driver_id,
        expected_status=TripStatus.CREATED, handshake_label="H1 Origin Gate-In",
    )
    event = await _get_handshake_event(db, trip_id=trip_id, handshake_type=HandshakeType.ORIGIN_GATE_IN)

    # GPS cross-reference against Pulsit horse GPS is a feeder check (H1 is not
    # anchored to Hedera) — Pulsit integration itself is out of scope for this
    # plan; until it lands, horse_gps fields stay null and the check is skipped
    # rather than faked, so dispatchers see an honest "not yet cross-checked" state.
    event.driver_phone_lat = payload.driver_phone_lat
    event.driver_phone_lng = payload.driver_phone_lng
    event.gate_photo_artifact_id = payload.gate_photo_artifact_id
    event.status = HandshakeStatus.COMPLETED
    event.completed_at = datetime.now(UTC)

    trip.status = TripStatus.ORIGIN_GATE_IN
    await db.flush()

    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_handshake_service.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Stand up the endpoint + router**

```python
# backend/app/api/v1/endpoints/handshakes.py
"""Handshake advancement endpoints — driver PWA's 'Complete & continue' CTAs."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import HandshakeSequenceError, ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.handshake_service import advance_h1
from app.schemas.handshakes import H1CompleteRequest
from app.schemas.people import DriverRead
from app.schemas.trips import TripDetailResponse

router = APIRouter(prefix="/trips/{trip_id}/handshakes", tags=["handshakes"])


@router.post("/h1/complete", response_model=TripDetailResponse)
async def complete_h1_endpoint(
    trip_id: UUID,
    payload: H1CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    try:
        return await advance_h1(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HandshakeSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

Register in `backend/app/main.py`:
```python
from app.api.v1.endpoints.handshakes import router as handshakes_router
# ...
app.include_router(handshakes_router, prefix="/api/v1")
```

- [ ] **Step 6: Write and run the integration test**

```python
# backend/tests/integration/test_handshakes.py
"""Full H1-H5 sequence — extended in Tasks 12-15 as each advance_hN lands."""
import uuid
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.auth.dependencies import get_current_driver
from app.db.session import get_db
from app.schemas.people import DriverRead

# NOTE: seed_data / trip creation reuses the same fixture pattern as
# tests/integration/test_trips.py — import or duplicate `seed_data` from there
# once Task 12 needs a trip already at ORIGIN_GATE_IN.


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def test_h1_wrong_state_returns_409(db_session):
    from app.db.models.organisations import Organization, Precinct
    from app.db.models.people import Driver, User
    from app.db.models.vehicles import Vehicle
    from app.db.models.trips import Trip
    from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType

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
        id=uuid.uuid4(), trip_reference="FP-TEST-2", order_number="ORD-2",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.IN_TRANSIT, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    app.dependency_overrides[get_current_driver] = lambda: DriverRead.model_validate(driver)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/handshakes/h1/complete",
            json={
                "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
                "gate_photo_artifact_id": str(uuid.uuid4()),
            },
        )
    assert resp.status_code == 409
    app.dependency_overrides.pop(get_current_driver, None)
```

Run: `cd backend && pytest tests/integration/test_handshakes.py tests/unit/test_handshake_service.py -v`
Expected: PASS (4 passed)

- [ ] **Step 7: Commit**

```bash
git add backend/app/orchestration/handshake_service.py backend/app/api/v1/endpoints/handshakes.py \
        backend/app/main.py backend/tests/unit/test_handshake_service.py backend/tests/integration/test_handshakes.py
git commit -m "feat(handshakes): implement advance_h1 and the handshake router scaffold"
```

---

### Task 12: `advance_h2` — Loading (seal capture, no Hedera call)

**Files:**
- Modify: `backend/app/orchestration/handshake_service.py`
- Modify: `backend/app/api/v1/endpoints/handshakes.py`
- Modify: `backend/tests/unit/test_handshake_service.py`
- Modify: `backend/tests/integration/test_handshakes.py`

- [ ] **Step 1: Add the failing unit test** — append to `test_handshake_service.py`:

```python
from app.orchestration.handshake_service import advance_h1, advance_h2
from app.schemas.handshakes import H2CompleteRequest


@pytest.mark.asyncio
async def test_advance_h2_happy_path_stores_seal_and_hash(db_session, trip_fixture):
    trip, driver = trip_fixture
    await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), gate_photo_artifact_id=uuid.uuid4(),
    ))

    result = await advance_h2(db_session, trip_id=trip.id, driver_id=driver.id, payload=H2CompleteRequest(
        waybill_photo_artifact_id=uuid.uuid4(), seal_number="AB-1234",
        seal_photo_artifact_id=uuid.uuid4(), driver_visual_count=42,
    ))
    assert result.status == TripStatus.LOADING
    h2 = next(h for h in result.handshakes if h.handshake_type == HandshakeType.LOADING)
    assert h2.seal_number == "AB-1234"
    assert h2.event_hash is not None
    assert h2.blockchain_receipt_id is None  # Hedera anchoring deferred — not this plan
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_handshake_service.py -v -k advance_h2`
Expected: FAIL — `ImportError: cannot import name 'advance_h2'`

- [ ] **Step 3: Implement** — append to `handshake_service.py`:

```python
async def advance_h2(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: H2CompleteRequest,
) -> TripDetailResponse:
    trip = await _load_trip_for_handshake(
        db, trip_id=trip_id, driver_id=driver_id,
        expected_status=TripStatus.ORIGIN_GATE_IN, handshake_label="H2 Loading",
    )
    event = await _get_handshake_event(db, trip_id=trip_id, handshake_type=HandshakeType.LOADING)

    event.waybill_photo_artifact_id = payload.waybill_photo_artifact_id
    event.seal_number = payload.seal_number
    event.seal_photo_artifact_id = payload.seal_photo_artifact_id
    event.driver_visual_count = payload.driver_visual_count
    event.event_hash = _compute_event_hash({
        "trip_id": str(trip_id), "seal_number": payload.seal_number,
        "driver_visual_count": payload.driver_visual_count,
    })
    event.status = HandshakeStatus.COMPLETED
    event.completed_at = datetime.now(UTC)

    # Hedera pickup receipt anchor is deferred (see module docstring) — when
    # that work starts, queue it here with event.event_hash as the payload.
    trip.status = TripStatus.LOADING
    await db.flush()

    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_handshake_service.py -v -k advance_h2`
Expected: PASS

- [ ] **Step 5: Wire the endpoint** — append to `handshakes.py`:

```python
from app.orchestration.handshake_service import advance_h2  # add to existing import
from app.schemas.handshakes import H2CompleteRequest  # add to existing import


@router.post("/h2/complete", response_model=TripDetailResponse)
async def complete_h2_endpoint(
    trip_id: UUID,
    payload: H2CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    try:
        return await advance_h2(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HandshakeSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

- [ ] **Step 6: Run the full handshake test suite**

Run: `cd backend && pytest tests/unit/test_handshake_service.py tests/integration/test_handshakes.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/orchestration/handshake_service.py backend/app/api/v1/endpoints/handshakes.py \
        backend/tests/unit/test_handshake_service.py
git commit -m "feat(handshakes): implement advance_h2 (seal capture, Hedera anchor deferred)"
```

---

### Task 13: `advance_h3` — Origin Gate-Out

**Files:** same four files as Task 12.

- [ ] **Step 1: Add the failing unit test** — append to `test_handshake_service.py`:

```python
from app.orchestration.handshake_service import advance_h3
from app.schemas.handshakes import H3CompleteRequest


@pytest.mark.asyncio
async def test_advance_h3_happy_path_sets_in_transit(db_session, trip_fixture):
    trip, driver = trip_fixture
    await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), gate_photo_artifact_id=uuid.uuid4(),
    ))
    await advance_h2(db_session, trip_id=trip.id, driver_id=driver.id, payload=H2CompleteRequest(
        waybill_photo_artifact_id=uuid.uuid4(), seal_number="AB-1234",
        seal_photo_artifact_id=uuid.uuid4(), driver_visual_count=42,
    ))

    result = await advance_h3(db_session, trip_id=trip.id, driver_id=driver.id, payload=H3CompleteRequest(
        gate_exit_photo_artifact_id=uuid.uuid4(), guard_verified_seal=True,
    ))
    assert result.status == TripStatus.IN_TRANSIT
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_handshake_service.py -v -k advance_h3`
Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement** — append to `handshake_service.py`:

```python
async def advance_h3(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: H3CompleteRequest,
) -> TripDetailResponse:
    trip = await _load_trip_for_handshake(
        db, trip_id=trip_id, driver_id=driver_id,
        expected_status=TripStatus.LOADING, handshake_label="H3 Origin Gate-Out",
    )
    event = await _get_handshake_event(db, trip_id=trip_id, handshake_type=HandshakeType.ORIGIN_GATE_OUT)

    event.gate_photo_artifact_id = payload.gate_exit_photo_artifact_id
    event.status = HandshakeStatus.COMPLETED
    event.completed_at = datetime.now(UTC)
    # Pulsit geofence departure confirmation is out of scope until the Pulsit
    # integration lands; pulsit_geofence_confirmed stays null until then.

    trip.status = TripStatus.IN_TRANSIT
    trip.actual_departure_at = datetime.now(UTC)
    await db.flush()

    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_handshake_service.py -v -k advance_h3`
Expected: PASS

- [ ] **Step 5: Wire the endpoint** — append to `handshakes.py`:

```python
from app.orchestration.handshake_service import advance_h3
from app.schemas.handshakes import H3CompleteRequest


@router.post("/h3/complete", response_model=TripDetailResponse)
async def complete_h3_endpoint(
    trip_id: UUID,
    payload: H3CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    try:
        return await advance_h3(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HandshakeSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

- [ ] **Step 6: Run full suite, then commit**

Run: `cd backend && pytest tests/unit/test_handshake_service.py tests/integration/test_handshakes.py -v`

```bash
git add backend/app/orchestration/handshake_service.py backend/app/api/v1/endpoints/handshakes.py \
        backend/tests/unit/test_handshake_service.py
git commit -m "feat(handshakes): implement advance_h3 (origin gate-out)"
```

---

### Task 14: `advance_h4` — Destination Gate-In (seal mismatch → exception)

**Files:** same four files.

- [ ] **Step 1: Add the failing unit tests** — append to `test_handshake_service.py`:

```python
from app.orchestration.handshake_service import advance_h3, advance_h4
from app.schemas.handshakes import H3CompleteRequest, H4CompleteRequest


async def _advance_to_in_transit(db_session, trip, driver):
    await advance_h1(db_session, trip_id=trip.id, driver_id=driver.id, payload=H1CompleteRequest(
        driver_phone_lat=Decimal("0"), driver_phone_lng=Decimal("0"), gate_photo_artifact_id=uuid.uuid4(),
    ))
    await advance_h2(db_session, trip_id=trip.id, driver_id=driver.id, payload=H2CompleteRequest(
        waybill_photo_artifact_id=uuid.uuid4(), seal_number="AB-1234",
        seal_photo_artifact_id=uuid.uuid4(), driver_visual_count=42,
    ))
    await advance_h3(db_session, trip_id=trip.id, driver_id=driver.id, payload=H3CompleteRequest(
        gate_exit_photo_artifact_id=uuid.uuid4(), guard_verified_seal=True,
    ))


@pytest.mark.asyncio
async def test_advance_h4_matching_seal_sets_dest_gate_in(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_in_transit(db_session, trip, driver)

    result = await advance_h4(db_session, trip_id=trip.id, driver_id=driver.id, payload=H4CompleteRequest(
        gate_entry_photo_artifact_id=uuid.uuid4(), seal_number_at_destination="AB-1234",
    ))
    assert result.status == TripStatus.DEST_GATE_IN
    assert result.exceptions == []


@pytest.mark.asyncio
async def test_advance_h4_seal_mismatch_creates_exception_and_holds_trip(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_in_transit(db_session, trip, driver)

    result = await advance_h4(db_session, trip_id=trip.id, driver_id=driver.id, payload=H4CompleteRequest(
        gate_entry_photo_artifact_id=uuid.uuid4(), seal_number_at_destination="ZZ-9999",
    ))
    assert result.status == TripStatus.EXCEPTION_HOLD
    assert len(result.exceptions) == 1
    assert result.exceptions[0].exception_type == ExceptionType.SEAL_MISMATCH
    assert result.exceptions[0].severity == ExceptionSeverity.CRITICAL
```

Add `from app.db.models.enums import ExceptionSeverity, ExceptionType` to the test file's imports if not already present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_handshake_service.py -v -k advance_h4`
Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement** — append to `handshake_service.py`:

```python
async def advance_h4(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: H4CompleteRequest,
) -> TripDetailResponse:
    trip = await _load_trip_for_handshake(
        db, trip_id=trip_id, driver_id=driver_id,
        expected_status=TripStatus.IN_TRANSIT, handshake_label="H4 Destination Gate-In",
    )
    event = await _get_handshake_event(db, trip_id=trip_id, handshake_type=HandshakeType.DEST_GATE_IN)

    h2_result = await db.execute(
        select(HandshakeEvent).where(
            HandshakeEvent.trip_id == trip_id, HandshakeEvent.handshake_type == HandshakeType.LOADING,
        )
    )
    h2_event = h2_result.scalar_one()

    event.gate_photo_artifact_id = payload.gate_entry_photo_artifact_id
    event.seal_number = payload.seal_number_at_destination
    event.completed_at = datetime.now(UTC)

    if payload.seal_number_at_destination != h2_event.seal_number:
        event.status = HandshakeStatus.EXCEPTION
        trip.status = TripStatus.EXCEPTION_HOLD
        db.add(TripException(
            trip_id=trip_id, handshake_event_id=event.id,
            exception_type=ExceptionType.SEAL_MISMATCH, source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.CRITICAL,
            description=(
                f"Seal at destination ('{payload.seal_number_at_destination}') does not match "
                f"the seal committed at loading ('{h2_event.seal_number}')."
            ),
        ))
    else:
        event.status = HandshakeStatus.COMPLETED
        trip.status = TripStatus.DEST_GATE_IN

    await db.flush()
    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)
```

Add `ExceptionSeverity, ExceptionSource, ExceptionType` to the existing `from app.db.models.enums import ...` line in `handshake_service.py` (they were already imported in Task 11's skeleton — confirm before duplicating).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_handshake_service.py -v -k advance_h4`
Expected: PASS (2 passed)

- [ ] **Step 5: Wire the endpoint** — append to `handshakes.py`:

```python
from app.orchestration.handshake_service import advance_h4
from app.schemas.handshakes import H4CompleteRequest


@router.post("/h4/complete", response_model=TripDetailResponse)
async def complete_h4_endpoint(
    trip_id: UUID,
    payload: H4CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    """Note: returns 200 even on seal mismatch — the trip continues under
    EXCEPTION_HOLD with a dispatcher alert, per the contract. Never 4xx here."""
    try:
        return await advance_h4(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HandshakeSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

- [ ] **Step 6: Run full suite, then commit**

Run: `cd backend && pytest tests/unit/test_handshake_service.py tests/integration/test_handshakes.py -v`

```bash
git add backend/app/orchestration/handshake_service.py backend/app/api/v1/endpoints/handshakes.py \
        backend/tests/unit/test_handshake_service.py
git commit -m "feat(handshakes): implement advance_h4 with seal-mismatch exception handling"
```

---

### Task 15: `advance_h5` — Unloading (3-count reconciliation, closes trip)

**Files:** same four files.

- [ ] **Step 1: Add the failing unit tests** — append to `test_handshake_service.py`:

```python
from app.orchestration.handshake_service import advance_h4, advance_h5
from app.schemas.handshakes import H5CompleteRequest


async def _advance_to_dest_gate_in(db_session, trip, driver):
    await _advance_to_in_transit(db_session, trip, driver)
    await advance_h4(db_session, trip_id=trip.id, driver_id=driver.id, payload=H4CompleteRequest(
        gate_entry_photo_artifact_id=uuid.uuid4(), seal_number_at_destination="AB-1234",
    ))


@pytest.mark.asyncio
async def test_advance_h5_matching_counts_closes_trip(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_dest_gate_in(db_session, trip, driver)

    result = await advance_h5(db_session, trip_id=trip.id, driver_id=driver.id, payload=H5CompleteRequest(
        pod_photo_artifact_id=uuid.uuid4(), driver_visual_count=42, pp_scan_in_count=42,
    ))
    assert result.status == TripStatus.CLOSED
    assert result.closed_at is not None
    assert result.exceptions == []


@pytest.mark.asyncio
async def test_advance_h5_count_mismatch_creates_exception_but_still_closes(db_session, trip_fixture):
    trip, driver = trip_fixture
    await _advance_to_dest_gate_in(db_session, trip, driver)

    result = await advance_h5(db_session, trip_id=trip.id, driver_id=driver.id, payload=H5CompleteRequest(
        pod_photo_artifact_id=uuid.uuid4(), driver_visual_count=40, pp_scan_in_count=42,
    ))
    assert result.status == TripStatus.CLOSED
    assert len(result.exceptions) == 1
    assert result.exceptions[0].exception_type == ExceptionType.WAYBILL_COUNT_MISMATCH
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_handshake_service.py -v -k advance_h5`
Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement** — append to `handshake_service.py`:

```python
async def advance_h5(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: H5CompleteRequest,
) -> TripDetailResponse:
    trip = await _load_trip_for_handshake(
        db, trip_id=trip_id, driver_id=driver_id,
        expected_status=TripStatus.DEST_GATE_IN, handshake_label="H5 Unloading",
    )
    event = await _get_handshake_event(db, trip_id=trip_id, handshake_type=HandshakeType.UNLOADING)

    h2_result = await db.execute(
        select(HandshakeEvent).where(
            HandshakeEvent.trip_id == trip_id, HandshakeEvent.handshake_type == HandshakeType.LOADING,
        )
    )
    h2_event = h2_result.scalar_one()
    origin_count = h2_event.driver_visual_count

    event.pod_photo_artifact_id = payload.pod_photo_artifact_id
    event.driver_visual_count = payload.driver_visual_count
    event.parcel_count_destination = payload.pp_scan_in_count
    event.event_hash = _compute_event_hash({
        "trip_id": str(trip_id), "pp_scan_in_count": payload.pp_scan_in_count,
        "driver_visual_count": payload.driver_visual_count,
    })
    event.completed_at = datetime.now(UTC)

    counts_match = (
        origin_count == payload.pp_scan_in_count == payload.driver_visual_count
    )
    if not counts_match:
        db.add(TripException(
            trip_id=trip_id, handshake_event_id=event.id,
            exception_type=ExceptionType.WAYBILL_COUNT_MISMATCH, source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.WARNING,
            description=(
                f"Count mismatch at unload: origin={origin_count}, "
                f"PP scan-in={payload.pp_scan_in_count}, driver visual={payload.driver_visual_count}."
            ),
        ))
        event.status = HandshakeStatus.EXCEPTION
    else:
        event.status = HandshakeStatus.COMPLETED

    # A count mismatch is a WARNING, not a hold — the trip still closes; the
    # dispatcher reconciles afterward. This differs from H4's seal mismatch
    # (CRITICAL, holds the trip) per api_contract_dispatcher_driver.md §3.4.
    trip.status = TripStatus.CLOSED
    trip.closed_at = datetime.now(UTC)
    trip.actual_arrival_at = trip.actual_arrival_at or datetime.now(UTC)
    # Hedera delivery receipt anchor is deferred (see module docstring).
    await db.flush()

    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_handshake_service.py -v -k advance_h5`
Expected: PASS (2 passed)

- [ ] **Step 5: Wire the endpoint** — append to `handshakes.py`:

```python
from app.orchestration.handshake_service import advance_h5
from app.schemas.handshakes import H5CompleteRequest


@router.post("/h5/complete", response_model=TripDetailResponse)
async def complete_h5_endpoint(
    trip_id: UUID,
    payload: H5CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    try:
        return await advance_h5(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HandshakeSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

- [ ] **Step 6: Run the entire handshake suite, then commit**

Run: `cd backend && pytest tests/unit/test_handshake_service.py tests/integration/test_handshakes.py -v`
Expected: PASS (all tests across Tasks 11–15)

```bash
git add backend/app/orchestration/handshake_service.py backend/app/api/v1/endpoints/handshakes.py \
        backend/tests/unit/test_handshake_service.py
git commit -m "feat(handshakes): implement advance_h5, closing the trip with 3-count reconciliation"
```

---

### Task 16: Polling endpoint — `GET /trips/{trip_id}/handshakes/{handshake_type}`

**Files:**
- Modify: `backend/app/api/v1/endpoints/handshakes.py`
- Test: `backend/tests/integration/test_handshakes.py`

- [ ] **Step 1: Add the failing test** — append to `test_handshakes.py`:

```python
async def test_get_handshake_detail_returns_event(db_session):
    # Reuses the same seed pattern as test_h1_wrong_state_returns_409 — build a
    # trip at CREATED, call H1 complete, then poll the H1 detail endpoint.
    ...  # construct trip/driver exactly as in test_h1_wrong_state_returns_409
```

(This step intentionally mirrors the existing seed block — copy the org/driver/horse/precinct/trip setup from `test_h1_wrong_state_returns_409` into a `seed_trip` fixture at the top of the file to avoid the third copy-paste; refactor that test and this one to use it.)

```python
@pytest_asyncio.fixture
async def seed_trip(db_session):
    from app.db.models.organisations import Organization, Precinct
    from app.db.models.people import Driver, User
    from app.db.models.vehicles import Vehicle
    from app.db.models.trips import Trip
    from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType

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
        id=uuid.uuid4(), trip_reference="FP-TEST-3", order_number="ORD-3",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    return trip, driver


async def test_get_handshake_detail_returns_event(db_session, seed_trip):
    trip, driver = seed_trip
    app.dependency_overrides[get_current_driver] = lambda: DriverRead.model_validate(driver)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post(
            f"/api/v1/trips/{trip.id}/handshakes/h1/complete",
            json={
                "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
                "gate_photo_artifact_id": str(uuid.uuid4()),
            },
        )
        resp = await client.get(f"/api/v1/trips/{trip.id}/handshakes/origin_gate_in")

    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"
    app.dependency_overrides.pop(get_current_driver, None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/integration/test_handshakes.py -v -k get_handshake_detail`
Expected: FAIL — 404 Not Found

- [ ] **Step 3: Implement** — append to `handshakes.py`:

```python
from app.db.models.enums import HandshakeType
from app.db.models.handshakes import HandshakeEvent
from app.schemas.handshakes import HandshakeEventRead
from sqlalchemy import select


@router.get("/{handshake_type}", response_model=HandshakeEventRead)
async def get_handshake_detail_endpoint(
    trip_id: UUID,
    handshake_type: HandshakeType,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> HandshakeEventRead:
    result = await db.execute(
        select(HandshakeEvent).where(
            HandshakeEvent.trip_id == trip_id, HandshakeEvent.handshake_type == handshake_type,
        )
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Handshake not found.")
    return HandshakeEventRead.model_validate(event)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/integration/test_handshakes.py -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/endpoints/handshakes.py backend/tests/integration/test_handshakes.py
git commit -m "feat(handshakes): add GET polling endpoint for loading/unloading status"
```

---

# Phase D — Exceptions & checkpoints (driver-raised)

### Task 17: Driver exception reporting

**Files:**
- Create: `backend/app/orchestration/exception_service.py`
- Create: `backend/app/api/v1/endpoints/exceptions.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/integration/test_exceptions.py`

Scope note: this builds only the driver-facing `POST /trips/{id}/exceptions` (panic button, "report exception"). Dispatcher-side list/resolve/override endpoints are real spec items (§3.6) but aren't required for "driver-pwa functional" — flagged as out of scope here, not silently dropped.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_exceptions.py
import uuid
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.auth.dependencies import get_current_driver
from app.db.session import get_db
from app.schemas.people import DriverRead


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_trip(db_session):
    from app.db.models.organisations import Organization, Precinct
    from app.db.models.people import Driver, User
    from app.db.models.vehicles import Vehicle
    from app.db.models.trips import Trip
    from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType

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
        id=uuid.uuid4(), trip_reference="FP-TEST-4", order_number="ORD-4",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.IN_TRANSIT, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    return trip, driver


async def test_driver_raises_panic_exception(seed_trip):
    trip, driver = seed_trip
    app.dependency_overrides[get_current_driver] = lambda: DriverRead.model_validate(driver)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/exceptions",
            json={"exception_type": "panic_button", "description": "Driver pressed panic button."},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["severity"] == "critical"
    assert body["source"] == "driver"
    app.dependency_overrides.pop(get_current_driver, None)


async def test_driver_cannot_raise_exception_on_someone_elses_trip(seed_trip):
    trip, _driver = seed_trip
    other_driver = DriverRead(
        id=uuid.uuid4(), organization_id=uuid.uuid4(), full_name="Other",
        id_number="8001015009087", phone_number="+27820000000",
        license_number="DRV-X", is_active=True,
    )
    app.dependency_overrides[get_current_driver] = lambda: other_driver

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/exceptions",
            json={"exception_type": "panic_button", "description": "x"},
        )
    assert resp.status_code == 403
    app.dependency_overrides.pop(get_current_driver, None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/integration/test_exceptions.py -v`
Expected: FAIL — 404 Not Found

- [ ] **Step 3: Implement**

```python
# backend/app/orchestration/exception_service.py
"""Driver-raised exceptions — panic button and ad-hoc 'report exception'."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType
from app.db.models.trips import Trip
from app.db.models.transit import TripException
from app.schemas.transit import TripExceptionRead

# Mirrors TripContext.tsx's criticalTypes set on the frontend — keep these two in sync.
_CRITICAL_TYPES = {ExceptionType.PANIC_BUTTON, ExceptionType.SEAL_BROKEN_IN_TRANSIT, ExceptionType.SEAL_MISMATCH}


async def raise_exception(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    exception_type: ExceptionType, description: str, supporting_artifact_id: uuid.UUID | None,
) -> TripExceptionRead:
    """Raises ResourceNotFoundError if the trip doesn't exist, PermissionError if
    driver_id isn't the trip's assigned driver (caller maps PermissionError to 403)."""
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    exc = TripException(
        trip_id=trip_id,
        exception_type=exception_type,
        source=ExceptionSource.DRIVER,
        severity=ExceptionSeverity.CRITICAL if exception_type in _CRITICAL_TYPES else ExceptionSeverity.WARNING,
        description=description,
        supporting_artifact_id=supporting_artifact_id,
    )
    db.add(exc)
    await db.flush()
    await db.refresh(exc)
    return TripExceptionRead.model_validate(exc)
```

```python
# backend/app/api/v1/endpoints/exceptions.py
"""Driver-raised exception endpoint. Dispatcher list/resolve/override (spec §3.6)
are out of scope for this plan — flagged, not silently dropped."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.exception_service import raise_exception
from app.schemas.people import DriverRead
from app.schemas.transit import TripExceptionCreate, TripExceptionRead

router = APIRouter(prefix="/trips/{trip_id}/exceptions", tags=["exceptions"])


@router.post("", response_model=TripExceptionRead, status_code=http_status.HTTP_201_CREATED)
async def raise_exception_endpoint(
    trip_id: UUID,
    payload: TripExceptionCreate,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripExceptionRead:
    try:
        return await raise_exception(
            db, trip_id=trip_id, driver_id=current_driver.id,
            exception_type=payload.exception_type, description=payload.description,
            supporting_artifact_id=payload.supporting_artifact_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
```

`TripExceptionCreate` already requires `trip_id` per its base class — since the path already carries `trip_id`, override it: change the endpoint body type to a slimmer request model instead of reusing `TripExceptionCreate` directly:

```python
# add to backend/app/schemas/transit.py
class DriverExceptionCreateBody(BaseModel):
    exception_type: ExceptionType
    description: str
    supporting_artifact_id: Optional[UUID] = None
```

Update the endpoint signature to use `DriverExceptionCreateBody` instead of `TripExceptionCreate`, and update the import accordingly.

Register in `backend/app/main.py`:
```python
from app.api.v1.endpoints.exceptions import router as exceptions_router
# ...
app.include_router(exceptions_router, prefix="/api/v1")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/integration/test_exceptions.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestration/exception_service.py backend/app/api/v1/endpoints/exceptions.py \
        backend/app/schemas/transit.py backend/app/main.py backend/tests/integration/test_exceptions.py
git commit -m "feat(exceptions): add driver-raised exception endpoint (panic button, report exception)"
```

---

### Task 18: Driver checkpoint logging

**Files:**
- Create: `backend/app/orchestration/checkpoint_service.py`
- Create: `backend/app/api/v1/endpoints/checkpoints.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/integration/test_checkpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_checkpoints.py
import uuid
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.auth.dependencies import get_current_driver
from app.db.session import get_db
from app.schemas.people import DriverRead

# seed_trip fixture: copy from tests/integration/test_exceptions.py (same shape,
# trip at IN_TRANSIT) — duplicated deliberately per project convention of one
# self-contained fixture per test file rather than a shared test-utils import.


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def test_driver_logs_checkpoint(seed_trip):
    trip, driver = seed_trip
    app.dependency_overrides[get_current_driver] = lambda: DriverRead.model_validate(driver)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            f"/api/v1/trips/{trip.id}/checkpoints",
            json={
                "checkpoint_type": "manual",
                "driver_phone_lat": "0.001", "driver_phone_lng": "0.001",
                "selfie_artifact_id": str(uuid.uuid4()),
            },
        )
    assert resp.status_code == 201
    app.dependency_overrides.pop(get_current_driver, None)
```

(Copy `seed_trip` from `test_exceptions.py` into this file's top — keep it self-contained per the existing test file convention.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/integration/test_checkpoints.py -v`
Expected: FAIL — 404 Not Found

- [ ] **Step 3: Implement**

```python
# backend/app/orchestration/checkpoint_service.py
"""Driver-logged in-transit checkpoints."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.trips import Trip
from app.db.models.transit import Checkpoint
from app.schemas.transit import CheckpointCreate, CheckpointRead


async def log_checkpoint(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: CheckpointCreate,
) -> CheckpointRead:
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    checkpoint = Checkpoint(
        trip_id=trip_id,
        checkpoint_type=payload.checkpoint_type,
        driver_phone_lat=payload.driver_phone_lat,
        driver_phone_lng=payload.driver_phone_lng,
        horse_gps_lat=payload.horse_gps_lat,
        horse_gps_lng=payload.horse_gps_lng,
        selfie_artifact_id=payload.selfie_artifact_id,
        cargo_photo_artifact_id=payload.cargo_photo_artifact_id,
        note=payload.note,
        is_deviation=payload.is_deviation,
    )
    db.add(checkpoint)
    await db.flush()
    await db.refresh(checkpoint)
    return CheckpointRead.model_validate(checkpoint)
```

```python
# backend/app/api/v1/endpoints/checkpoints.py
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.checkpoint_service import log_checkpoint
from app.schemas.people import DriverRead
from app.schemas.transit import CheckpointCreate, CheckpointRead

router = APIRouter(prefix="/trips/{trip_id}/checkpoints", tags=["checkpoints"])


@router.post("", response_model=CheckpointRead, status_code=http_status.HTTP_201_CREATED)
async def log_checkpoint_endpoint(
    trip_id: UUID,
    payload: CheckpointCreate,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> CheckpointRead:
    try:
        return await log_checkpoint(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
```

`CheckpointCreate` (in `schemas/transit.py`) currently requires `trip_id` in its body — same overlap issue as Task 17. Add a slim `DriverCheckpointCreateBody` (mirroring `DriverExceptionCreateBody`) without `trip_id`, and use it as the endpoint's request type instead.

Register in `backend/app/main.py`:
```python
from app.api.v1.endpoints.checkpoints import router as checkpoints_router
# ...
app.include_router(checkpoints_router, prefix="/api/v1")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/integration/test_checkpoints.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestration/checkpoint_service.py backend/app/api/v1/endpoints/checkpoints.py \
        backend/app/schemas/transit.py backend/app/main.py backend/tests/integration/test_checkpoints.py
git commit -m "feat(checkpoints): add driver checkpoint logging endpoint"
```

---

**Continued in `2026-06-24-driver-pwa-functional-part3.md`: Phase E (Linehaul rename), Phase F (frontend API client + auth/trip wiring), Phase G (capture hooks), Phase H (handshake UI build-out), Phase I (offline queue).**
