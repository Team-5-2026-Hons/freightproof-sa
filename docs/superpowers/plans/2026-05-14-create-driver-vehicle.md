# Create Driver & Vehicle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement POST endpoints for drivers and vehicles on the backend, and wire up the existing "Add Driver" / "Add Vehicle" buttons on the dispatcher frontend to inline modals, so a dispatcher can create a driver and vehicle and then create a trip.

**Architecture:** Two backend service functions (`create_driver`, `create_vehicle`) are added to the existing `resource_service.py`. Each gets a matching POST endpoint in the existing router files and integration tests following the identical pattern used by the existing GET tests. On the frontend, `useDrivers` and `useVehicles` are updated to expose a `refetch` function, and each fleet page gains a controlled modal form that calls `api.post(...)` and calls `refetch()` on success.

**Tech Stack:** FastAPI 0.115+, SQLAlchemy 2.0 async, Pydantic v2, pytest + pytest-asyncio (`asyncio_mode=auto`), Next.js 15 App Router, TypeScript 5.5+, Tailwind v3.4+, React 19+.

---

## File map

| File | Change |
|------|--------|
| `backend/app/schemas/people.py` | Add `DriverCreateBody` schema |
| `backend/app/schemas/vehicles.py` | Add `VehicleCreateBody` schema |
| `backend/app/orchestration/resource_service.py` | Add `create_driver()` and `create_vehicle()` service functions |
| `backend/app/api/v1/endpoints/drivers.py` | Add `POST ""` endpoint |
| `backend/app/api/v1/endpoints/vehicles.py` | Add `POST ""` endpoint |
| `backend/tests/integration/test_drivers.py` | Add 3 POST tests |
| `backend/tests/integration/test_vehicles.py` | Add 3 POST tests |
| `frontend/dispatcher/lib/hooks/useDrivers.ts` | Expose `refetch` in return value |
| `frontend/dispatcher/lib/hooks/useVehicles.ts` | Expose `refetch` in return value |
| `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx` | Wire modal to "Add Driver" button |
| `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx` | Wire modal to "Add Vehicle" button |

---

## Task 1: Add `DriverCreateBody` schema and `create_driver` service function

**Files:**
- Modify: `backend/app/schemas/people.py`
- Modify: `backend/app/orchestration/resource_service.py`

### Why a separate `DriverCreateBody`?

`DriverCreate` (in `schemas/people.py`) extends `DriverBase` which requires `organization_id`. The dispatcher should never supply their own `organization_id` — it must be injected from their JWT. A separate `DriverCreateBody` contains only the four user-supplied fields; the endpoint merges it with the org_id from auth.

- [ ] **Step 1: Add `DriverCreateBody` to `backend/app/schemas/people.py`**

Open `backend/app/schemas/people.py`. After the `DriverCreate` class (line 58), add:

```python
class DriverCreateBody(BaseModel):
    """Fields the dispatcher submits when registering a new driver.

    organization_id is injected from the dispatcher's JWT — not accepted from the client.
    id_number validation mirrors DriverCreate to keep rules in one place.
    """
    model_config = ConfigDict(from_attributes=True)

    full_name: str
    id_number: str
    phone_number: str
    license_number: str

    @field_validator("id_number")
    @classmethod
    def validate_id_number(cls, v: str) -> str:
        if not v.isdigit() or len(v) != 13:
            raise ValueError("id_number must be exactly 13 digits (SA ID format)")
        return v
```

- [ ] **Step 2: Add `create_driver` to `backend/app/orchestration/resource_service.py`**

The file already imports `DriverRead` from `app.schemas.people` and `Driver` from `app.db.models.people`. Make two changes:

**2a. Update the import from `app.db.models.enums`** (line 11) to include `IdvsStatus`:

```python
from app.db.models.enums import IdvsStatus, TripStatus
```

**2b. Update the import from `app.schemas.people`** (line 22) to include `DriverCreateBody`:

```python
from app.schemas.people import DriverCreateBody, DriverRead
```

**2c. Add `create_driver` after `list_drivers` (after line 38)**:

```python
async def create_driver(
    db: AsyncSession,
    organization_id: uuid.UUID,
    data: DriverCreateBody,
) -> DriverRead:
    driver = Driver(
        organization_id=organization_id,
        full_name=data.full_name,
        id_number=data.id_number,
        phone_number=data.phone_number,
        license_number=data.license_number,
        idvs_status=IdvsStatus.PENDING,
    )
    db.add(driver)
    await db.flush()
    await db.refresh(driver)
    return DriverRead.model_validate(driver)
```

---

## Task 2: Add POST /api/v1/drivers endpoint with integration tests (TDD)

**Files:**
- Modify: `backend/tests/integration/test_drivers.py`
- Modify: `backend/app/api/v1/endpoints/drivers.py`

- [ ] **Step 1: Write failing tests in `backend/tests/integration/test_drivers.py`**

Append these three tests at the end of the file (after the existing tests at line 99):

```python
async def test_create_driver_returns_201_with_pending_status(seed_org):
    payload = {
        "full_name": "Thabo Nkosi",
        "id_number": "9001015009081",
        "phone_number": "+27829999999",
        "license_number": "DRV-002",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/drivers",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["full_name"] == "Thabo Nkosi"
    assert body["id_number"] == "9001015009081"
    assert body["idvs_status"] == "pending"
    assert "id" in body
    assert "created_at" in body


async def test_create_driver_invalid_id_number_returns_422(seed_org):
    payload = {
        "full_name": "Bad Driver",
        "id_number": "123",
        "phone_number": "+27821234567",
        "license_number": "DRV-BAD",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/drivers",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_create_driver_appears_in_subsequent_list(seed_org):
    payload = {
        "full_name": "Lerato Mokoena",
        "id_number": "8501015009085",
        "phone_number": "+27831111111",
        "license_number": "DRV-003",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        create_resp = await client.post(
            "/api/v1/drivers",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )
        assert create_resp.status_code == 201

        list_resp = await client.get(
            "/api/v1/drivers",
            headers={"Authorization": "Bearer demo"},
        )

    names = [d["full_name"] for d in list_resp.json()]
    assert "Lerato Mokoena" in names
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && pytest tests/integration/test_drivers.py -v -k "create"
```

Expected: 3 failures — `405 Method Not Allowed` because the POST route does not exist yet.

- [ ] **Step 3: Add POST endpoint to `backend/app/api/v1/endpoints/drivers.py`**

Replace the full file content with:

```python
"""FastAPI router for driver endpoints.

GET  /drivers — list active drivers for the dispatcher's organisation.
POST /drivers — register a new driver under the dispatcher's organisation.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.resource_service import create_driver, list_drivers
from app.schemas.people import DriverCreateBody, DriverRead, UserRead

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


@router.post(
    "",
    response_model=DriverRead,
    status_code=201,
    summary="Register a new driver under the dispatcher's organisation",
)
async def create_driver_endpoint(
    body: DriverCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> DriverRead:
    return await create_driver(
        db=db,
        organization_id=current_user.organization_id,
        data=body,
    )
```

- [ ] **Step 4: Run the three new tests to confirm they pass**

```bash
cd backend && pytest tests/integration/test_drivers.py -v -k "create"
```

Expected: all 3 PASS.

- [ ] **Step 5: Run the full driver test suite to confirm no regressions**

```bash
cd backend && pytest tests/integration/test_drivers.py -v
```

Expected: all 6 tests PASS.

---

## Task 3: Add `VehicleCreateBody` schema and `create_vehicle` service function

**Files:**
- Modify: `backend/app/schemas/vehicles.py`
- Modify: `backend/app/orchestration/resource_service.py`

- [ ] **Step 1: Add `VehicleCreateBody` to `backend/app/schemas/vehicles.py`**

Open `backend/app/schemas/vehicles.py`. After `VehicleCreate` (line 23), add:

```python
class VehicleCreateBody(BaseModel):
    """Fields the dispatcher submits when registering a new vehicle.

    organization_id is injected from the dispatcher's JWT — not accepted from the client.
    """
    model_config = ConfigDict(from_attributes=True)

    registration: str
    vehicle_type: VehicleType
    pulsit_device_id: str
```

- [ ] **Step 2: Update `resource_service.py` to import `VehicleCreateBody`**

Update the import from `app.schemas.vehicles` (line 26) to:

```python
from app.schemas.vehicles import VehicleCreateBody, VehicleRead
```

- [ ] **Step 3: Add `create_vehicle` after `list_vehicles` (after line 50) in `resource_service.py`**

```python
async def create_vehicle(
    db: AsyncSession,
    organization_id: uuid.UUID,
    data: VehicleCreateBody,
) -> VehicleRead:
    vehicle = Vehicle(
        organization_id=organization_id,
        registration=data.registration,
        vehicle_type=data.vehicle_type,
        pulsit_device_id=data.pulsit_device_id,
    )
    db.add(vehicle)
    await db.flush()
    await db.refresh(vehicle)
    return VehicleRead.model_validate(vehicle)
```

---

## Task 4: Add POST /api/v1/vehicles endpoint with integration tests (TDD)

**Files:**
- Modify: `backend/tests/integration/test_vehicles.py`
- Modify: `backend/app/api/v1/endpoints/vehicles.py`

- [ ] **Step 1: Write failing tests in `backend/tests/integration/test_vehicles.py`**

Append these three tests at the end of the file (after line 98):

```python
async def test_create_vehicle_returns_201(seed_org):
    payload = {
        "registration": "CA 555-NEW",
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-HORSE-NEW",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["registration"] == "CA 555-NEW"
    assert body["vehicle_type"] == "horse"
    assert body["pulsit_device_id"] == "PLT-HORSE-NEW"
    assert "id" in body


async def test_create_vehicle_invalid_type_returns_422(seed_org):
    payload = {
        "registration": "CA 999-BAD",
        "vehicle_type": "submarine",
        "pulsit_device_id": "PLT-SUB",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_create_vehicle_appears_in_subsequent_list(seed_org):
    payload = {
        "registration": "WC 555-TEST",
        "vehicle_type": "trailer",
        "pulsit_device_id": "PLT-TRAILER-NEW",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        create_resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )
        assert create_resp.status_code == 201

        list_resp = await client.get(
            "/api/v1/vehicles",
            headers={"Authorization": "Bearer demo"},
        )

    regs = [v["registration"] for v in list_resp.json()]
    assert "WC 555-TEST" in regs
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && pytest tests/integration/test_vehicles.py -v -k "create"
```

Expected: 3 failures — `405 Method Not Allowed`.

- [ ] **Step 3: Add POST endpoint to `backend/app/api/v1/endpoints/vehicles.py`**

Replace the full file content with:

```python
"""FastAPI router for vehicle endpoints.

GET  /vehicles — list active vehicles (horses + trailers) for the dispatcher's org.
POST /vehicles — register a new vehicle under the dispatcher's organisation.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.session import get_db
from app.orchestration.resource_service import create_vehicle, list_vehicles
from app.schemas.people import UserRead
from app.schemas.vehicles import VehicleCreateBody, VehicleRead

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


@router.post(
    "",
    response_model=VehicleRead,
    status_code=201,
    summary="Register a new vehicle under the dispatcher's organisation",
)
async def create_vehicle_endpoint(
    body: VehicleCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> VehicleRead:
    return await create_vehicle(
        db=db,
        organization_id=current_user.organization_id,
        data=body,
    )
```

- [ ] **Step 4: Run the three new tests to confirm they pass**

```bash
cd backend && pytest tests/integration/test_vehicles.py -v -k "create"
```

Expected: all 3 PASS.

- [ ] **Step 5: Run the full vehicle test suite to confirm no regressions**

```bash
cd backend && pytest tests/integration/test_vehicles.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 6: Run the full backend test suite**

```bash
cd backend && pytest
```

Expected: all tests PASS.

---

## Task 5: Update `useDrivers` hook to expose `refetch` and wire "Add Driver" modal

**Files:**
- Modify: `frontend/dispatcher/lib/hooks/useDrivers.ts`
- Modify: `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`

- [ ] **Step 1: Replace `frontend/dispatcher/lib/hooks/useDrivers.ts`**

```typescript
'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import type { Driver } from '@shared/lib/types/driver'

export function useDrivers(): { drivers: Driver[]; refetch: () => void } {
  const [drivers, setDrivers] = useState<Driver[]>([])

  const refetch = useCallback(() => {
    api.get<Driver[]>('/api/v1/drivers')
      .then(setDrivers)
      .catch(console.error)
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { drivers, refetch }
}
```

- [ ] **Step 2: Replace `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { TopBar } from '@/components/ui/TopBar'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Modal } from '@/components/ui/Modal'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { TimestampWithIcon } from '@/components/domain/TimestampWithIcon'
import { api } from '@/lib/api/client'
import type { Column } from '@/components/ui/DataTable'
import type { Driver } from '@shared/lib/types/driver'

const columns: Column<Driver>[] = [
  {
    key: 'full_name',
    label: 'Name',
    sortable: true,
    render: (val) => <span className="font-bold text-surface-on">{String(val)}</span>,
  },
  {
    key: 'id_number',
    label: 'ID Number',
    render: (val) => (
      <span className="font-mono text-xs tracking-wider text-surface-on-variant">
        {/* Mask for POPIA compliance — show only last 4 digits */}
        ···· {String(val).slice(-4)}
      </span>
    ),
  },
  {
    key: 'phone_number',
    label: 'Phone',
    render: (val) => <span className="text-sm text-surface-on">{String(val)}</span>,
  },
  {
    key: 'idvs_status',
    label: 'Verification',
    sortable: true,
    render: (val, row) => (
      <div className="flex flex-col gap-1">
        <Chip
          type={val === 'verified' ? 'complete' : val === 'failed' ? 'critical' : 'pending'}
          label={String(val)}
        />
        {val === 'verified' && row.idvs_last_verified_at && (
          <TimestampWithIcon
            timestamp={String(row.idvs_last_verified_at)}
            className="text-xs text-surface-on-variant"
          />
        )}
      </div>
    ),
  },
  {
    key: 'is_active',
    label: 'Status',
    sortable: true,
    render: (val) => (
      <Chip type={val ? 'complete' : 'pending'} label={val ? 'Active' : 'Inactive'} />
    ),
  },
]

interface DriverFormState {
  full_name: string
  id_number: string
  phone_number: string
  license_number: string
}

const EMPTY_FORM: DriverFormState = {
  full_name: '',
  id_number: '',
  phone_number: '',
  license_number: '',
}

export default function FleetDriversPage() {
  const { drivers, refetch } = useDrivers()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<DriverFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleChange(field: keyof DriverFormState, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleClose(): void {
    setModalOpen(false)
    setForm(EMPTY_FORM)
    setError(null)
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/api/v1/drivers', form)
      handleClose()
      refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create driver')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Fleet — Drivers">
        <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
          Add Driver
        </Button>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-6">
        <DataTable<Driver>
          columns={columns}
          rows={drivers}
          empty={{ title: 'No drivers', body: 'No drivers registered yet.' }}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={handleClose}
        title="Add Driver"
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="sm" loading={submitting} onClick={handleSubmit}>
              Save Driver
            </Button>
          </>
        }
      >
        {error && (
          <p className="mb-4 text-sm text-red-500">{error}</p>
        )}
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Full Name</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.full_name}
              onChange={(e) => handleChange('full_name', e.target.value)}
              placeholder="e.g. Sipho Dlamini"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">SA ID Number (13 digits)</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary font-mono tracking-widest"
              value={form.id_number}
              onChange={(e) => handleChange('id_number', e.target.value)}
              placeholder="8001015009087"
              maxLength={13}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Phone Number</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.phone_number}
              onChange={(e) => handleChange('phone_number', e.target.value)}
              placeholder="+27821234567"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Licence Number</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.license_number}
              onChange={(e) => handleChange('license_number', e.target.value)}
              placeholder="DRV-001"
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
```

---

## Task 6: Update `useVehicles` hook to expose `refetch` and wire "Add Vehicle" modal

**Files:**
- Modify: `frontend/dispatcher/lib/hooks/useVehicles.ts`
- Modify: `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`

- [ ] **Step 1: Replace `frontend/dispatcher/lib/hooks/useVehicles.ts`**

```typescript
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api/client'
import type { Vehicle } from '@shared/lib/types/vehicle'

export function useVehicles(): {
  horses: Vehicle[]
  trailers: Vehicle[]
  all: Vehicle[]
  refetch: () => void
} {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  const refetch = useCallback(() => {
    api.get<Vehicle[]>('/api/v1/vehicles')
      .then(setVehicles)
      .catch(console.error)
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return useMemo(
    () => ({
      horses: vehicles.filter((v) => v.vehicle_type === 'horse'),
      trailers: vehicles.filter((v) => v.vehicle_type === 'trailer'),
      all: vehicles,
      refetch,
    }),
    [vehicles, refetch],
  )
}
```

- [ ] **Step 2: Replace `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { TopBar } from '@/components/ui/TopBar'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Modal } from '@/components/ui/Modal'
import { useVehicles } from '@/lib/hooks/useVehicles'
import { api } from '@/lib/api/client'
import type { Column } from '@/components/ui/DataTable'
import type { Vehicle } from '@shared/lib/types/vehicle'

const columns: Column<Vehicle>[] = [
  {
    key: 'registration',
    label: 'Registration',
    sortable: true,
    render: (val) => (
      <span className="font-bold font-mono tracking-[0.05em] text-surface-on">{String(val)}</span>
    ),
  },
  {
    key: 'vehicle_type',
    label: 'Type',
    sortable: true,
    render: (val) => (
      <span className="capitalize text-surface-on-variant">{String(val)}</span>
    ),
  },
  {
    key: 'pulsit_device_id',
    label: 'Pulsit Device',
    render: (val) => (
      <span className="font-mono text-xs tracking-wider text-surface-on-variant">{String(val ?? '—')}</span>
    ),
  },
  {
    key: 'is_active',
    label: 'Status',
    sortable: true,
    render: (val) => (
      <Chip type={val ? 'complete' : 'pending'} label={val ? 'Active' : 'Inactive'} />
    ),
  },
]

interface VehicleFormState {
  registration: string
  vehicle_type: 'horse' | 'trailer'
  pulsit_device_id: string
}

const EMPTY_FORM: VehicleFormState = {
  registration: '',
  vehicle_type: 'horse',
  pulsit_device_id: '',
}

export default function FleetVehiclesPage() {
  const { all: vehicles, refetch } = useVehicles()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<VehicleFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleChange<K extends keyof VehicleFormState>(field: K, value: VehicleFormState[K]): void {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleClose(): void {
    setModalOpen(false)
    setForm(EMPTY_FORM)
    setError(null)
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/api/v1/vehicles', form)
      handleClose()
      refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create vehicle')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Fleet — Vehicles">
        <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
          Add Vehicle
        </Button>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-6">
        <DataTable<Vehicle>
          columns={columns}
          rows={vehicles}
          empty={{ title: 'No vehicles', body: 'No vehicles registered yet.' }}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={handleClose}
        title="Add Vehicle"
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="sm" loading={submitting} onClick={handleSubmit}>
              Save Vehicle
            </Button>
          </>
        }
      >
        {error && (
          <p className="mb-4 text-sm text-red-500">{error}</p>
        )}
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Registration</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary font-mono tracking-widest uppercase"
              value={form.registration}
              onChange={(e) => handleChange('registration', e.target.value)}
              placeholder="CA 123-456"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Type</span>
            <select
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.vehicle_type}
              onChange={(e) => handleChange('vehicle_type', e.target.value as 'horse' | 'trailer')}
            >
              <option value="horse">Horse (truck)</option>
              <option value="trailer">Trailer</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Pulsit Device ID</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              value={form.pulsit_device_id}
              onChange={(e) => handleChange('pulsit_device_id', e.target.value)}
              placeholder="PLT-HORSE-001"
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
```

---

## Auth note

The `getToken()` function in `frontend/dispatcher/lib/api/client.ts` currently returns `null` (a known placeholder from item 8 of the work list). This means the frontend will send POST requests without an `Authorization` header, and the backend will reject them with 401.

**For end-to-end testing of the modals**, you have two options:

**Option A (recommended — no code change):** Use the backend directly via curl or the test suite. The modals and endpoints are correct once this plan is implemented; the auth wiring is a separate task.

**Option B (quick local hack — do not commit):** Temporarily hardcode the demo token in `getToken()`:

```typescript
function getToken(): string | null {
  return 'demo'  // REMOVE BEFORE COMMIT — local testing only
}
```

This makes `Authorization: Bearer demo` flow through, which the backend's demo auth mode accepts. Revert this before committing.

---

## Final verification

- [ ] Run `cd backend && pytest` — all tests pass
- [ ] Run `cd frontend/dispatcher && npx tsc --noEmit` — no TypeScript errors
