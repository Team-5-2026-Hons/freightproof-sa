# Admin-Only Fleet Mutations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict POST and PATCH on drivers/vehicles endpoints to `admin_dispatcher` role, and hide the corresponding buttons in the dispatcher UI for non-admins.

**Architecture:** Swap `get_current_dispatcher` → `require_admin_dispatcher` on four mutating FastAPI routes (GET routes unchanged). In the frontend, introduce an `AdminOnly` wrapper component that renders `null` for non-admins, mirroring `ForensicOnly`, and wrap the Add/Edit buttons in it.

**Tech Stack:** FastAPI (`require_admin_dispatcher` dependency already exists in `auth/dependencies.py`), Python pytest + httpx, Next.js 15 App Router, TypeScript 5.5+, `useAuth` hook.

---

## File Map

| Action   | File                                                                         | Why                                                 |
|----------|------------------------------------------------------------------------------|-----------------------------------------------------|
| Create   | `backend/tests/integration/test_fleet_mutations_gating.py`                  | 7 new tests for dependency gate                     |
| Modify   | `backend/app/api/v1/endpoints/drivers.py`                                   | Swap dep on POST + PATCH to `require_admin_dispatcher` |
| Modify   | `backend/app/api/v1/endpoints/vehicles.py`                                  | Swap dep on POST + PATCH to `require_admin_dispatcher` |
| Modify   | `backend/app/auth/dependencies.py`                                           | Promote `_DEMO_USER` to `ADMIN_DISPATCHER` so existing mutation tests keep passing |
| Create   | `frontend/dispatcher/components/auth/AdminOnly.tsx`                         | New role gate wrapper component                     |
| Modify   | `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`                      | Wrap Add Driver button                              |
| Modify   | `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`                     | Wrap Add Vehicle button                             |
| Modify   | `frontend/dispatcher/app/(app)/fleet/drivers/[id]/page.tsx`                 | Wrap Edit button                                    |
| Modify   | `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`                | Wrap Edit button                                    |

---

## ⚠️ Shared-file note

`backend/app/auth/dependencies.py` is a shared file (Task 3 below). The change is a one-value tweak to `_DEMO_USER.role` — no signature or logic change. Flag this to the team; no PR reviewers need be blocked but they should be aware.

---

## Task 1: Write failing integration tests

**Files:**
- Create: `backend/tests/integration/test_fleet_mutations_gating.py`

These tests use `app.dependency_overrides[get_current_dispatcher]` directly, so they work without DEMO_MODE or a DB for the 403 cases. The 201/200 success cases mock the service layer.

- [ ] **Step 1.1: Create the test file**

```python
"""Integration tests: admin-only fleet mutation gating.

Verifies:
  - POST /drivers and PATCH /drivers/{id} return 403 for non-admin.
  - POST /vehicles and PATCH /vehicles/{id} return 403 for non-admin.
  - POST /drivers → 201 for admin_dispatcher (service mocked — regression gate only).
  - PATCH /vehicles/{id} → 200 for admin_dispatcher (service mocked).
  - GET /drivers → 200 for non-admin (view stays open).

Service functions are patched so no DB is required for forbidden/success cases.
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import get_current_dispatcher
from app.db.models.enums import DispatcherRole, IdvsStatus, VehicleType
from app.main import app
from app.schemas.people import DriverRead, UserRead
from app.schemas.vehicles import VehicleRead

_NOW = datetime(2026, 1, 1, tzinfo=UTC)
_ORG_ID = uuid.UUID("00000000-0000-0000-0004-000000000001")
_USER_ID = uuid.UUID("00000000-0000-0000-0004-000000000002")
_DRIVER_ID = uuid.UUID("00000000-0000-0000-0004-000000000003")
_VEHICLE_ID = uuid.UUID("00000000-0000-0000-0004-000000000004")


def _make_user(role: DispatcherRole) -> UserRead:
    return UserRead(
        id=_USER_ID,
        organization_id=_ORG_ID,
        email="test@fp.co.za",
        full_name="Test User",
        is_active=True,
        created_at=_NOW,
        updated_at=_NOW,
        role=role,
    )


_DISPATCHER_USER = _make_user(DispatcherRole.DISPATCHER)
_ADMIN_USER = _make_user(DispatcherRole.ADMIN_DISPATCHER)


def _fake_driver_read() -> DriverRead:
    return DriverRead.model_construct(
        id=_DRIVER_ID,
        organization_id=_ORG_ID,
        full_name="Sipho Dlamini",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-001",
        license_expiry=None,
        is_active=True,
        idvs_status=IdvsStatus.PENDING,
        idvs_last_verified_at=None,
        created_at=_NOW,
        updated_at=_NOW,
    )


def _fake_vehicle_read() -> VehicleRead:
    return VehicleRead.model_construct(
        id=_VEHICLE_ID,
        organization_id=_ORG_ID,
        registration="CA 123-456",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-HORSE-001",
        is_active=True,
        make=None,
        model=None,
        year=None,
        vin_number=None,
        licence_disc_expiry=None,
        gross_vehicle_mass_kg=None,
        length_m=None,
        created_at=_NOW,
    )


@pytest.fixture(autouse=True)
def clear_dep_overrides():
    yield
    app.dependency_overrides.clear()


# ── POST /drivers — non-admin forbidden ──────────────────────────────────────


@pytest.mark.asyncio
async def test_create_driver_non_admin_forbidden() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/drivers",
            json={"full_name": "X", "id_number": "8001015009087",
                  "phone_number": "+27821234567", "license_number": "DRV-X"},
            headers={"Authorization": "Bearer dummy"},
        )
    assert resp.status_code == 403
    assert "Admin dispatcher role required" in resp.json()["detail"]


# ── PATCH /drivers/{id} — non-admin forbidden ────────────────────────────────


@pytest.mark.asyncio
async def test_update_driver_non_admin_forbidden() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.patch(
            f"/api/v1/drivers/{_DRIVER_ID}",
            json={"full_name": "Updated"},
            headers={"Authorization": "Bearer dummy"},
        )
    assert resp.status_code == 403
    assert "Admin dispatcher role required" in resp.json()["detail"]


# ── POST /vehicles — non-admin forbidden ─────────────────────────────────────


@pytest.mark.asyncio
async def test_create_vehicle_non_admin_forbidden() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json={"registration": "CA 000-NEW", "vehicle_type": "horse",
                  "pulsit_device_id": "PLT-X"},
            headers={"Authorization": "Bearer dummy"},
        )
    assert resp.status_code == 403
    assert "Admin dispatcher role required" in resp.json()["detail"]


# ── PATCH /vehicles/{id} — non-admin forbidden ───────────────────────────────


@pytest.mark.asyncio
async def test_update_vehicle_non_admin_forbidden() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.patch(
            f"/api/v1/vehicles/{_VEHICLE_ID}",
            json={"make": "Updated"},
            headers={"Authorization": "Bearer dummy"},
        )
    assert resp.status_code == 403
    assert "Admin dispatcher role required" in resp.json()["detail"]


# ── POST /drivers — admin succeeds (regression: gate didn't break happy path) ─


@pytest.mark.asyncio
async def test_create_driver_admin_succeeds() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER
    with patch(
        "app.api.v1.endpoints.drivers.create_driver",
        new_callable=AsyncMock,
        return_value=_fake_driver_read(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.post(
                "/api/v1/drivers",
                json={"full_name": "Sipho Dlamini", "id_number": "8001015009087",
                      "phone_number": "+27821234567", "license_number": "DRV-001"},
                headers={"Authorization": "Bearer dummy"},
            )
    assert resp.status_code == 201
    assert resp.json()["full_name"] == "Sipho Dlamini"


# ── PATCH /vehicles/{id} — admin succeeds (regression: gate didn't break happy path) ─


@pytest.mark.asyncio
async def test_update_vehicle_admin_succeeds() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER
    with patch(
        "app.api.v1.endpoints.vehicles.update_vehicle",
        new_callable=AsyncMock,
        return_value=_fake_vehicle_read(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.patch(
                f"/api/v1/vehicles/{_VEHICLE_ID}",
                json={"make": "Volvo"},
                headers={"Authorization": "Bearer dummy"},
            )
    assert resp.status_code == 200
    assert resp.json()["registration"] == "CA 123-456"


# ── GET /drivers — non-admin allowed (view stays open) ───────────────────────


@pytest.mark.asyncio
async def test_list_drivers_non_admin_allowed() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    with patch(
        "app.api.v1.endpoints.drivers.list_drivers",
        new_callable=AsyncMock,
        return_value=[],
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.get(
                "/api/v1/drivers",
                headers={"Authorization": "Bearer dummy"},
            )
    assert resp.status_code == 200
    assert resp.json() == []
```

- [ ] **Step 1.2: Run the tests — confirm they fail for the right reason**

```bash
cd backend && pytest tests/integration/test_fleet_mutations_gating.py -v
```

Expected: the 4 forbidden tests fail with **AssertionError: assert 201/200 == 403** (endpoints currently allow any dispatcher). The 3 other tests should pass.

---

## Task 2: Swap backend dependencies on mutating routes

**Files:**
- Modify: `backend/app/api/v1/endpoints/drivers.py`
- Modify: `backend/app/api/v1/endpoints/vehicles.py`

- [ ] **Step 2.1: Update `drivers.py` — add import, swap POST and PATCH deps**

In `backend/app/api/v1/endpoints/drivers.py`, change line 8 from:
```python
from app.auth.dependencies import get_current_dispatcher
```
to:
```python
from app.auth.dependencies import get_current_dispatcher, require_admin_dispatcher
```

Then change the `create_driver_endpoint` signature (line 33–34) from:
```python
    current_user: UserRead = Depends(get_current_dispatcher),
) -> DriverRead:
```
to:
```python
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> DriverRead:
```

And the `update_driver_endpoint` signature (line 53–54) from:
```python
    current_user: UserRead = Depends(get_current_dispatcher),
) -> DriverRead:
```
to:
```python
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> DriverRead:
```

After editing, the POST and PATCH handlers in `drivers.py` should read:

```python
@router.post("", response_model=DriverRead, status_code=201)
async def create_driver_endpoint(
    body: DriverCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> DriverRead:
    ...

@router.patch("/{driver_id}", response_model=DriverRead)
async def update_driver_endpoint(
    driver_id: UUID,
    body: DriverUpdateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> DriverRead:
    ...
```

The GET routes (`list_drivers_endpoint`, `get_driver_detail_endpoint`) stay on `get_current_dispatcher` — do not touch them.

- [ ] **Step 2.2: Update `vehicles.py` — add import, swap POST and PATCH deps**

In `backend/app/api/v1/endpoints/vehicles.py`, change line 8 from:
```python
from app.auth.dependencies import get_current_dispatcher
```
to:
```python
from app.auth.dependencies import get_current_dispatcher, require_admin_dispatcher
```

Then change `create_vehicle_endpoint` signature (line 33–34) from:
```python
    current_user: UserRead = Depends(get_current_dispatcher),
) -> VehicleRead:
```
to:
```python
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> VehicleRead:
```

And `update_vehicle_endpoint` signature (line 55–56) from:
```python
    current_user: UserRead = Depends(get_current_dispatcher),
) -> VehicleRead:
```
to:
```python
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> VehicleRead:
```

After editing, the POST and PATCH handlers in `vehicles.py` should read:

```python
@router.post("", response_model=VehicleRead, status_code=201)
async def create_vehicle_endpoint(
    body: VehicleCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> VehicleRead:
    ...

@router.patch("/{vehicle_id}", response_model=VehicleRead)
async def update_vehicle_endpoint(
    vehicle_id: UUID,
    body: VehicleUpdateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> VehicleRead:
    ...
```

The GET routes stay on `get_current_dispatcher` — do not touch them.

- [ ] **Step 2.3: Run the new gating tests — expect all 7 to pass now**

```bash
cd backend && pytest tests/integration/test_fleet_mutations_gating.py -v
```

Expected: all 7 tests **PASS**.

---

## Task 3: Fix `_DEMO_USER` role so existing mutation tests keep passing

**Files:**
- Modify: `backend/app/auth/dependencies.py`

**Why this is needed:** Many existing integration tests (`test_drivers.py`, `test_vehicles.py`, `test_vehicles_anchor.py`, `test_vehicles_cosmetic_diff.py`, `test_vehicles_validation.py`, `test_drivers_anchor.py`) call mutation endpoints with `Authorization: Bearer demo`. DEMO_MODE returns `_DEMO_USER`, which currently has `role=DispatcherRole.DISPATCHER`. After Task 2, those calls will 403. The fix: promote the demo stub to `ADMIN_DISPATCHER`.

**⚠️ Shared file — flag to team.** Change is a single line value change, no logic change.

- [ ] **Step 3.1: Change `_DEMO_USER.role` in `auth/dependencies.py`**

In `backend/app/auth/dependencies.py`, around line 54, change:
```python
    role=DispatcherRole.DISPATCHER,
```
to:
```python
    role=DispatcherRole.ADMIN_DISPATCHER,
```

The full `_DEMO_USER` block should look like:
```python
_DEMO_USER = UserRead(
    id=_DEMO_USER_ID,
    organization_id=_DEMO_ORG_ID,
    email="demo-dispatcher@freightproof.co.za",
    full_name="Demo Dispatcher",
    is_active=True,
    created_at=_DEMO_NOW,
    updated_at=_DEMO_NOW,
    role=DispatcherRole.ADMIN_DISPATCHER,
)
```

- [ ] **Step 3.2: Run the full backend test suite**

```bash
cd backend && pytest -x -q
```

Expected: **all tests pass**. If any test asserts that DEMO_MODE returns a non-admin role, investigate — that test was checking the wrong thing (role assignment belongs in `test_auth_dependencies.py`, not in fleet tests).

---

## Task 4: Create the `AdminOnly` frontend component

**Files:**
- Create: `frontend/dispatcher/components/auth/AdminOnly.tsx`

- [ ] **Step 4.1: Create the file**

```tsx
'use client'

import type { ReactNode } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'

interface AdminOnlyProps {
  children: ReactNode
}

/**
 * Renders children only when the current user has the admin_dispatcher role.
 * Single gate for admin-only affordances — call sites stay dumb.
 */
export function AdminOnly({ children }: AdminOnlyProps) {
  const { user } = useAuth()
  if (user?.role !== 'admin_dispatcher') return null
  return <>{children}</>
}
```

- [ ] **Step 4.2: Verify the file type-checks in isolation**

```bash
cd frontend/dispatcher && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero new errors (pre-existing errors, if any, are unchanged).

---

## Task 5: Wrap Add Driver button in `fleet/drivers/page.tsx`

**Files:**
- Modify: `frontend/dispatcher/app/(app)/fleet/drivers/page.tsx`

The Add Driver button is inside `<TopBar title="Drivers">` at line 230. It must only render for admins.

- [ ] **Step 5.1: Add the `AdminOnly` import**

At the top of `fleet/drivers/page.tsx`, after the existing imports (e.g. after `import { SA_ID_LENGTH ...`), add:
```tsx
import { AdminOnly } from '@/components/auth/AdminOnly'
```

- [ ] **Step 5.2: Wrap the button**

Find (around line 229–232):
```tsx
      <TopBar title="Drivers">
        <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
          Add Driver
        </Button>
      </TopBar>
```

Replace with:
```tsx
      <TopBar title="Drivers">
        <AdminOnly>
          <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
            Add Driver
          </Button>
        </AdminOnly>
      </TopBar>
```

---

## Task 6: Wrap Add Vehicle button in `fleet/vehicles/page.tsx`

**Files:**
- Modify: `frontend/dispatcher/app/(app)/fleet/vehicles/page.tsx`

The Add Vehicle button is inside `<TopBar title="Vehicles">` at line 203.

- [ ] **Step 6.1: Add the `AdminOnly` import**

After existing imports (e.g. after `import { VIN_LENGTH ...`), add:
```tsx
import { AdminOnly } from '@/components/auth/AdminOnly'
```

- [ ] **Step 6.2: Wrap the button**

Find (around line 202–205):
```tsx
      <TopBar title="Vehicles">
        <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
          Add Vehicle
        </Button>
      </TopBar>
```

Replace with:
```tsx
      <TopBar title="Vehicles">
        <AdminOnly>
          <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
            Add Vehicle
          </Button>
        </AdminOnly>
      </TopBar>
```

---

## Task 7: Wrap Edit button in `fleet/drivers/[id]/page.tsx`

**Files:**
- Modify: `frontend/dispatcher/app/(app)/fleet/drivers/[id]/page.tsx`

The Edit button is inside the "Driver Info" section header, visible when `!isEditing` (line 198–200).

- [ ] **Step 7.1: Add the `AdminOnly` import**

After existing imports (e.g. after the `@shared/lib/validation/driver` import block), add:
```tsx
import { AdminOnly } from '@/components/auth/AdminOnly'
```

- [ ] **Step 7.2: Wrap the Edit button**

Find (around line 197–202):
```tsx
          {!isEditing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                Edit
              </Button>
            )}
```

Replace with:
```tsx
          <AdminOnly>
            {!isEditing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                Edit
              </Button>
            )}
          </AdminOnly>
```

---

## Task 8: Wrap Edit button in `fleet/vehicles/[id]/page.tsx`

**Files:**
- Modify: `frontend/dispatcher/app/(app)/fleet/vehicles/[id]/page.tsx`

The Edit button is in the "Vehicle Info" section header, visible when `!isEditing` (line 204–207).

- [ ] **Step 8.1: Add the `AdminOnly` import**

After existing imports (e.g. after the `@shared/lib/validation/vehicle` import block), add:
```tsx
import { AdminOnly } from '@/components/auth/AdminOnly'
```

- [ ] **Step 8.2: Wrap the Edit button**

Find (around line 203–208):
```tsx
            {!isEditing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                Edit
              </Button>
            )}
```

Replace with:
```tsx
            <AdminOnly>
              {!isEditing && (
                <Button variant="secondary" size="sm" onClick={startEdit}>
                  Edit
                </Button>
              )}
            </AdminOnly>
```

---

## Task 9: Final verification

- [ ] **Step 9.1: TypeScript check (dispatcher)**

```bash
cd frontend/dispatcher && npx tsc --noEmit
```

Expected: zero new errors.

- [ ] **Step 9.2: Full backend test suite**

```bash
cd backend && pytest -q
```

Expected: all tests pass (zero failures, zero errors).

- [ ] **Step 9.3: Manual smoke note**

The spec requires manual verification (no component test runner in `dispatcher/`):
- Sign in as `dispatcher` role → Add Driver button absent, Add Vehicle button absent, Edit button absent on detail pages.
- Sign in as `admin_dispatcher` role → all buttons visible and functional.

Document that you tested this manually (or note that a real browser session is unavailable in CI and the TypeScript check + backend tests constitute the automated gate).

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| Swap `get_current_dispatcher` → `require_admin_dispatcher` on POST /drivers, PATCH /drivers/{id} | Task 2 |
| Swap on POST /vehicles, PATCH /vehicles/{id} | Task 2 |
| GET routes unchanged | Task 2 (explicitly not touched) |
| Non-admin gets 403 | Tasks 1 + 2 |
| Admin unchanged (201/200) | Tasks 1 + 2 |
| `AdminOnly` component mirroring `ForensicOnly` | Task 4 |
| Add Driver button wrapped | Task 5 |
| Add Vehicle button wrapped | Task 6 |
| Edit button on driver detail wrapped | Task 7 |
| Edit button on vehicle detail wrapped | Task 8 |
| `test_list_drivers_non_admin_allowed` → 200 | Task 1 |
| TypeScript stays green | Task 9 |
| Existing tests not broken | Task 3 |

**Placeholder scan:** No TBDs, no "similar to" references, all code blocks complete.

**Type consistency:** `AdminOnly` uses `ReactNode` + `useAuth`, consistent in all 4 call sites. `require_admin_dispatcher` yields `UserRead` — handler bodies unchanged. `_DISPATCHER_USER` / `_ADMIN_USER` used consistently across all 7 tests.
