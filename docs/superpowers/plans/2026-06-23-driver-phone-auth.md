# Driver Phone Auth (Supabase OTP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project override:** This repo's CLAUDE.md forbids Claude from running `git commit`. Every "Commit" step below means **stage the listed files with `git add` and stop** — the human runs the actual `git commit`. Do not run `git commit` under any circumstances while executing this plan.

**Goal:** Replace the mocked driver-pwa login with real Supabase phone-OTP auth, backed by a new `get_current_driver` FastAPI dependency and `GET /api/v1/drivers/me` endpoint, while guaranteeing unregistered phone numbers cannot sign in.

**Architecture:** Mirrors the dispatcher's existing email/password Supabase pattern exactly: backend verifies Supabase JWTs against JWKS and loads the matching DB row; frontend's `AuthContext` owns all Supabase calls and demo-mode branching, pages just call context methods. `shouldCreateUser: false` on `signInWithOtp` blocks any phone number that wasn't already provisioned by a dispatcher via `POST /api/v1/drivers`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, `python-jose` (JWT/JWKS, already in use), pytest + pytest-asyncio; Next.js 15 App Router, `@supabase/supabase-js`, Vitest + React Testing Library.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/auth/dependencies.py` | **Modify.** Add `_require_driver_role`, `_DEMO_DRIVER`, `get_current_driver` — parallel to the existing dispatcher equivalents in the same file. |
| `backend/tests/unit/test_auth_dependencies.py` | **Modify.** Add unit tests for the three new pieces above. |
| `backend/app/api/v1/endpoints/drivers.py` | **Modify.** Add `GET /drivers/me`, registered before the `/{driver_id}` route. |
| `backend/tests/integration/test_drivers_me.py` | **Create.** Integration tests for the new endpoint, mirroring `test_auth_router.py`'s structure. |
| `frontend/driver-pwa/lib/api/client.ts` | **Create.** Typed fetch wrapper (Supabase bearer token → backend), copied from the dispatcher's equivalent. |
| `frontend/driver-pwa/lib/context/AuthContext.tsx` | **Modify.** Replace the mock with real Supabase phone-OTP calls, keeping demo mode behind `IS_DEMO_MODE` inside this one file. |
| `frontend/driver-pwa/lib/context/__tests__/AuthContext.test.tsx` | **Create.** Demo-mode behavior tests (mock driver, sign-in/sign-out). |
| `frontend/driver-pwa/lib/context/__tests__/AuthContext.real.test.tsx` | **Create.** Real-mode behavior tests (mocked Supabase client + API client). |
| `frontend/driver-pwa/app/login/page.tsx` | **Modify.** Remove inline demo/real branching; call `auth.requestOtp` only. |
| `frontend/driver-pwa/app/otp/page.tsx` | **Modify.** Remove inline demo/real branching; call `auth.signIn` only. |

---

## Task 1: Backend — `_require_driver_role` unit tests + implementation

**Files:**
- Modify: `backend/app/auth/dependencies.py`
- Test: `backend/tests/unit/test_auth_dependencies.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/unit/test_auth_dependencies.py`, right after the `_require_dispatcher_role` test block (after `test_require_dispatcher_role_raises_403_when_role_missing`, before the `require_admin_dispatcher` section):

```python
# ── _require_driver_role ───────────────────────────────────────────────────────


def test_require_driver_role_passes_for_driver() -> None:
    payload = {"app_metadata": {"role": "driver"}}
    _require_driver_role(payload)  # does not raise


def test_require_driver_role_raises_403_for_dispatcher() -> None:
    payload = {"app_metadata": {"role": "dispatcher"}}

    with pytest.raises(HTTPException) as exc_info:
        _require_driver_role(payload)

    assert exc_info.value.status_code == 403


def test_require_driver_role_raises_403_when_metadata_missing() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _require_driver_role({})

    assert exc_info.value.status_code == 403


def test_require_driver_role_raises_403_when_role_missing() -> None:
    payload: dict[str, object] = {"app_metadata": {}}

    with pytest.raises(HTTPException) as exc_info:
        _require_driver_role(payload)

    assert exc_info.value.status_code == 403
```

Update the import line near the top of the file:

```python
from app.auth.dependencies import (
    _decode_token,
    _require_dispatcher_role,
    _require_driver_role,
    require_admin_dispatcher,
)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_auth_dependencies.py -v -k require_driver_role`
Expected: FAIL with `ImportError: cannot import name '_require_driver_role'`

- [ ] **Step 3: Implement `_require_driver_role` in `dependencies.py`**

In `backend/app/auth/dependencies.py`, add a constant next to `_DISPATCHER_ROLES` (line 39):

```python
_DISPATCHER_ROLES = {DispatcherRole.DISPATCHER, DispatcherRole.ADMIN_DISPATCHER}
_DRIVER_ROLE = "driver"
```

Add the function directly after `_require_dispatcher_role` (after line 156, before `async def get_current_dispatcher`):

```python
def _require_driver_role(payload: dict) -> None:
    """Raise HTTP 403 unless the JWT's app_metadata.role is "driver".

    Mirrors _require_dispatcher_role — role lives in app_metadata (set by
    service_role at account creation), never in user-editable user_metadata.
    """
    if (payload.get("app_metadata") or {}).get("role") != _DRIVER_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Driver role required.",
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_auth_dependencies.py -v -k require_driver_role`
Expected: 4 passed

- [ ] **Step 5: Stage files (do not commit)**

```bash
git add backend/app/auth/dependencies.py backend/tests/unit/test_auth_dependencies.py
```

---

## Task 2: Backend — `get_current_driver` dependency

**Files:**
- Modify: `backend/app/auth/dependencies.py`
- Test: `backend/tests/unit/test_auth_dependencies.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/unit/test_auth_dependencies.py`, after the `_require_driver_role` block from Task 1:

```python
# ── get_current_driver ──────────────────────────────────────────────────────────


def _make_driver_row(*, is_active: bool = True) -> object:
    """Return a stand-in for a Driver ORM row — only the attributes get_current_driver reads."""
    from datetime import date

    class _FakeDriver:
        id = uuid.uuid4()
        organization_id = uuid.uuid4()
        full_name = "Test Driver"
        id_number = "8001015009087"
        phone_number = "+27821234567"
        license_number = "DRV-001"
        license_expiry: date | None = None
        idvs_status = "pending"
        idvs_last_verified_at = None
        is_active = is_active
        created_at = _NOW
        updated_at = _NOW

    return _FakeDriver()


@pytest.mark.asyncio
async def test_get_current_driver_returns_driver_read_for_valid_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock, MagicMock

    from fastapi.security import HTTPAuthorizationCredentials

    from app.auth.dependencies import get_current_driver
    from app.core.config import settings

    monkeypatch.setattr(settings, "DEMO_MODE", False)
    driver_row = _make_driver_row()
    token = make_token(sub=str(driver_row.id), role="driver")
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    db = AsyncMock()
    db_result = MagicMock()
    db_result.scalar_one_or_none.return_value = driver_row
    db.execute.return_value = db_result

    result = await get_current_driver(credentials=credentials, db=db)

    assert result.id == driver_row.id
    assert result.phone_number == "+27821234567"


@pytest.mark.asyncio
async def test_get_current_driver_not_found_raises_401(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock, MagicMock

    from fastapi.security import HTTPAuthorizationCredentials

    from app.auth.dependencies import get_current_driver
    from app.core.config import settings

    monkeypatch.setattr(settings, "DEMO_MODE", False)
    token = make_token(role="driver")
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    db = AsyncMock()
    db_result = MagicMock()
    db_result.scalar_one_or_none.return_value = None
    db.execute.return_value = db_result

    with pytest.raises(HTTPException) as exc_info:
        await get_current_driver(credentials=credentials, db=db)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_driver_inactive_raises_401(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock, MagicMock

    from fastapi.security import HTTPAuthorizationCredentials

    from app.auth.dependencies import get_current_driver
    from app.core.config import settings

    monkeypatch.setattr(settings, "DEMO_MODE", False)
    driver_row = _make_driver_row(is_active=False)
    token = make_token(sub=str(driver_row.id), role="driver")
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    db = AsyncMock()
    db_result = MagicMock()
    db_result.scalar_one_or_none.return_value = driver_row
    db.execute.return_value = db_result

    with pytest.raises(HTTPException) as exc_info:
        await get_current_driver(credentials=credentials, db=db)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_driver_dispatcher_token_raises_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock

    from fastapi.security import HTTPAuthorizationCredentials

    from app.auth.dependencies import get_current_driver
    from app.core.config import settings

    monkeypatch.setattr(settings, "DEMO_MODE", False)
    token = make_token(role="dispatcher")
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    with pytest.raises(HTTPException) as exc_info:
        await get_current_driver(credentials=credentials, db=AsyncMock())

    assert exc_info.value.status_code == 403
```

Add `make_token` is already imported at the top of the file via `from tests.conftest import TEST_KID, make_token, make_jwks` — no new import needed for that helper.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_auth_dependencies.py -v -k get_current_driver`
Expected: FAIL with `ImportError: cannot import name 'get_current_driver'`

- [ ] **Step 3: Implement `get_current_driver` in `dependencies.py`**

Update the imports at the top of `backend/app/auth/dependencies.py`:

```python
from app.db.models.enums import DispatcherRole, IdvsStatus
from app.db.models.people import Driver, User
from app.db.session import get_db
from app.schemas.people import DriverRead, UserRead
```

Add a demo driver stub right after the existing `_DEMO_USER` block (after line 55):

```python
_DEMO_DRIVER_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")

_DEMO_DRIVER = DriverRead(
    id=_DEMO_DRIVER_ID,
    organization_id=_DEMO_ORG_ID,
    full_name="Demo Driver",
    id_number="8001015009087",
    phone_number="+27800000000",
    license_number="DEMO-001",
    license_expiry=None,
    idvs_status=IdvsStatus.VERIFIED,
    idvs_last_verified_at=_DEMO_NOW,
    is_active=True,
    created_at=_DEMO_NOW,
    updated_at=_DEMO_NOW,
)
```

Add the dependency function after `require_admin_dispatcher` (after line 220, before the `DEMO_MODE` production guard at the bottom of the file):

```python
async def get_current_driver(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: AsyncSession = Depends(get_db),
) -> DriverRead:
    """Return the authenticated driver for the current request, or raise 401/403.

    Used as a FastAPI dependency:
        async def my_endpoint(driver: DriverRead = Depends(get_current_driver)):
    """
    if settings.DEMO_MODE:
        return _DEMO_DRIVER

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing authentication credentials.",
        )

    payload = _decode_token(credentials.credentials)
    _require_driver_role(payload)

    try:
        driver_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token subject is missing or not a valid UUID.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(Driver).where(Driver.id == driver_id))
    driver = result.scalar_one_or_none()

    if driver is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Driver account not found.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not driver.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Driver account is inactive.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return DriverRead.model_validate(driver)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_auth_dependencies.py -v -k get_current_driver`
Expected: 4 passed

Run the full unit suite to confirm nothing else broke: `cd backend && pytest tests/unit/test_auth_dependencies.py -v`
Expected: all passed

- [ ] **Step 5: Stage files (do not commit)**

```bash
git add backend/app/auth/dependencies.py backend/tests/unit/test_auth_dependencies.py
```

---

## Task 3: Backend — `GET /api/v1/drivers/me` endpoint

**Files:**
- Modify: `backend/app/api/v1/endpoints/drivers.py`
- Test: `backend/tests/integration/test_drivers_me.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/integration/test_drivers_me.py`:

```python
"""Integration tests for GET /api/v1/drivers/me.

Mirrors tests/integration/test_auth_router.py's structure: the DB dependency
is overridden with a mocked session so these tests run without a live
Postgres connection, while still exercising the full FastAPI request path.
"""

import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import get_current_driver
from app.db.models.people import Driver
from app.db.session import get_db
from app.main import app
from tests.conftest import auth_header, make_token, make_jwks

_ORG_ID = uuid.uuid4()
_DRIVER_ID = uuid.uuid4()


def _make_driver(*, is_active: bool = True) -> Driver:
    """Return a Driver ORM instance that does not touch the database."""
    driver = MagicMock(spec=Driver)
    driver.id = _DRIVER_ID
    driver.organization_id = _ORG_ID
    driver.full_name = "Sipho Dlamini"
    driver.id_number = "8001015009087"
    driver.phone_number = "+27821234567"
    driver.license_number = "DRV-001"
    driver.license_expiry = None
    driver.idvs_status = "pending"
    driver.idvs_last_verified_at = None
    driver.is_active = is_active
    driver.created_at = "2026-06-23T00:00:00+00:00"
    driver.updated_at = "2026-06-23T00:00:00+00:00"
    return driver


async def _mock_db() -> AsyncGenerator:
    session = AsyncMock()
    yield session


@pytest_asyncio.fixture
async def client_with_db(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient, None]:
    """Client with JWKS patched and DB dependency overridden."""
    _settings = __import__("app.core.config", fromlist=["settings"]).settings
    monkeypatch.setattr(_settings, "DEMO_MODE", False)
    monkeypatch.setattr("app.auth.dependencies._get_jwks", make_jwks)

    app.dependency_overrides[get_db] = _mock_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),  # type: ignore[arg-type]
            base_url="http://test",
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── Happy path ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_my_driver_profile_returns_driver(
    client_with_db: AsyncClient,
) -> None:
    active_driver = _make_driver()
    app.dependency_overrides[get_current_driver] = lambda: active_driver

    try:
        token = make_token(sub=str(_DRIVER_ID), role="driver")

        response = await client_with_db.get(
            "/api/v1/drivers/me",
            headers=auth_header(token),
        )

        assert response.status_code == 200
        body = response.json()
        assert body["full_name"] == "Sipho Dlamini"
        assert body["phone_number"] == "+27821234567"
    finally:
        app.dependency_overrides.pop(get_current_driver, None)


# ── Rejection paths ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_my_driver_profile_no_token_returns_403(client_with_db: AsyncClient) -> None:
    response = await client_with_db.get("/api/v1/drivers/me")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_my_driver_profile_expired_token_returns_401(client_with_db: AsyncClient) -> None:
    token = make_token(role="driver", expires_in=-1)

    response = await client_with_db.get(
        "/api/v1/drivers/me",
        headers=auth_header(token),
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_my_driver_profile_dispatcher_token_returns_403(
    client_with_db: AsyncClient,
) -> None:
    token = make_token(role="dispatcher")

    response = await client_with_db.get(
        "/api/v1/drivers/me",
        headers=auth_header(token),
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_my_driver_profile_invalid_token_returns_401(
    client_with_db: AsyncClient,
) -> None:
    response = await client_with_db.get(
        "/api/v1/drivers/me",
        headers=auth_header("not.a.real.token"),
    )

    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_drivers_me.py -v`
Expected: FAIL with 404 (route doesn't exist yet) on the happy-path test

- [ ] **Step 3: Implement the endpoint**

In `backend/app/api/v1/endpoints/drivers.py`, update the imports (line 8):

```python
from app.auth.dependencies import get_current_dispatcher, get_current_driver
```

Add the new route directly after `list_drivers_endpoint` and before `create_driver_endpoint` (after line 27), so it's registered ahead of `/{driver_id}`:

```python
@router.get("/me", response_model=DriverRead)
async def get_my_driver_profile(
    current_driver: DriverRead = Depends(get_current_driver),
) -> DriverRead:
    """Return the authenticated driver's own profile.

    The driver-pwa frontend calls this after Supabase verifyOtp() succeeds to
    confirm the session and load the driver record for the app shell.
    """
    return current_driver
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_drivers_me.py -v`
Expected: 5 passed

Run the full backend suite to confirm no regressions: `cd backend && pytest`
Expected: all passed (DB-backed tests requiring `TEST_DATABASE_URL` will skip if it's unset, same as before this change)

- [ ] **Step 5: Stage files (do not commit)**

```bash
git add backend/app/api/v1/endpoints/drivers.py backend/tests/integration/test_drivers_me.py
```

---

## Task 4: Frontend — typed API client for driver-pwa

**Files:**
- Create: `frontend/driver-pwa/lib/api/client.ts`

No test for this task — it's a thin wrapper exercised indirectly by Task 6's `AuthContext` tests.

- [ ] **Step 1: Create the file**

```ts
/**
 * Typed fetch wrapper for the FreightProof FastAPI backend.
 */

import { supabase } from '@/lib/supabase'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

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
  const url = `${BASE_URL}${path}`

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? null

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  }

  const res = await fetch(url, { ...init, headers })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    const raw = (body as { detail?: unknown }).detail
    const message = Array.isArray(raw)
      ? (raw[0] as { msg?: string })?.msg ?? res.statusText
      : (raw as string | undefined) ?? res.statusText
    throw new ApiError(res.status, message)
  }

  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
}
```

- [ ] **Step 2: Stage files (do not commit)**

```bash
git add frontend/driver-pwa/lib/api/client.ts
```

---

## Task 5: Frontend — real-mode `AuthContext` tests (written first, failing)

**Files:**
- Test: `frontend/driver-pwa/lib/context/__tests__/AuthContext.real.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/driver-pwa/lib/context/__tests__/AuthContext.real.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider } from '@/lib/context/AuthContext'
import { useAuth } from '@/lib/hooks/useAuth'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockSignInWithOtp = vi.fn()
const mockVerifyOtp = vi.fn()
const mockGetSession = vi.fn()
const mockOnAuthStateChange = vi.fn()
const mockSignOut = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  },
}))

const mockApiGet = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

describe('AuthContext (real Supabase mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  })

  it('requestOtp calls signInWithOtp with shouldCreateUser false', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await act(async () => {
      await result.current.requestOtp('+27821234567')
    })

    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      phone: '+27821234567',
      options: { channel: 'sms', shouldCreateUser: false },
    })
  })

  it('requestOtp throws when Supabase rejects an unregistered phone', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: new Error('Signups not allowed for otp') })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await expect(
      act(async () => {
        await result.current.requestOtp('+27800000000')
      }),
    ).rejects.toThrow('Signups not allowed for otp')
  })

  it('signIn verifies the OTP and loads the driver profile', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null })
    mockApiGet.mockResolvedValue({ id: 'driver-1', full_name: 'Test Driver' })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await act(async () => {
      await result.current.signIn({ phone_number: '+27821234567', otp: '123456' })
    })

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      phone: '+27821234567',
      token: '123456',
      type: 'sms',
    })
    expect(mockApiGet).toHaveBeenCalledWith('/api/v1/drivers/me')
    expect(result.current.user).toEqual({ id: 'driver-1', full_name: 'Test Driver' })
  })

  it('signIn throws and does not set a user when verifyOtp fails', async () => {
    mockVerifyOtp.mockResolvedValue({ error: new Error('Token has expired or is invalid') })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await expect(
      act(async () => {
        await result.current.signIn({ phone_number: '+27821234567', otp: '000000' })
      }),
    ).rejects.toThrow('Token has expired or is invalid')

    expect(result.current.user).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/context/__tests__/AuthContext.real.test.tsx`
Expected: FAIL — `mockSignInWithOtp` never called (current `AuthContext` is the all-mock implementation and ignores `IS_DEMO_MODE: false`)

- [ ] **Step 3: Stage the test file (do not commit)**

```bash
git add frontend/driver-pwa/lib/context/__tests__/AuthContext.real.test.tsx
```

---

## Task 6: Frontend — real `AuthContext` implementation + demo-mode regression test

**Files:**
- Modify: `frontend/driver-pwa/lib/context/AuthContext.tsx`
- Test: `frontend/driver-pwa/lib/context/__tests__/AuthContext.test.tsx`

- [ ] **Step 1: Write the demo-mode regression test**

Create `frontend/driver-pwa/lib/context/__tests__/AuthContext.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider } from '@/lib/context/AuthContext'
import { useAuth } from '@/lib/hooks/useAuth'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: true }))

describe('AuthContext (demo mode)', () => {
  it('signIn sets the mock driver and signOut clears it', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await act(async () => {
      await result.current.signIn({ phone_number: '+27821234567', otp: '123456' })
    })
    expect(result.current.user).not.toBeNull()

    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.user).toBeNull()
  })

  it('requestOtp resolves without throwing', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await expect(
      act(async () => {
        await result.current.requestOtp('+27821234567')
      }),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run both AuthContext test files to confirm the demo test passes and the real-mode test from Task 5 still fails**

Run: `cd frontend/driver-pwa && npx vitest run lib/context/__tests__/AuthContext.test.tsx lib/context/__tests__/AuthContext.real.test.tsx`
Expected: `AuthContext.test.tsx` 2 passed (current mock implementation already satisfies these); `AuthContext.real.test.tsx` 4 failed

- [ ] **Step 3: Replace the mock implementation**

Replace the full contents of `frontend/driver-pwa/lib/context/AuthContext.tsx`:

```tsx
"use client"

import { createContext, useState, useEffect, useCallback } from 'react'
import type { AuthState, DriverUser } from '@/lib/types/user'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api/client'
import { IS_DEMO_MODE } from '@/lib/constants/env'

// Demo mode (default) drives auth from a mock OTP flow with a fixture driver.
// Real mode exchanges a Supabase phone OTP for a session, then fetches the
// driver's own profile from the backend — the Driver row whose id equals the
// Supabase auth user's UUID.
const MOCK_DRIVER: DriverUser = mockDrivers[0]

export const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DriverUser | null>(null)
  const [isLoading, setIsLoading] = useState(!IS_DEMO_MODE)

  const fetchProfile = useCallback(async (): Promise<DriverUser | null> => {
    try {
      return await api.get<DriverUser>('/api/v1/drivers/me')
    } catch {
      return null
    }
  }, [])

  // On app load, check whether a Supabase session already exists (e.g. page refresh).
  useEffect(() => {
    if (IS_DEMO_MODE) return

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setUser(await fetchProfile())
      }
      setIsLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        setUser(await fetchProfile())
      } else {
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const requestOtp = useCallback(async (phone_number: string) => {
    setIsLoading(true)

    if (IS_DEMO_MODE) {
      await new Promise(resolve => setTimeout(resolve, 600))
      setIsLoading(false)
      return
    }

    // shouldCreateUser: false blocks unregistered phone numbers — a driver
    // auth account only exists if a dispatcher provisioned it via /drivers.
    const { error } = await supabase.auth.signInWithOtp({
      phone: phone_number,
      options: { channel: 'sms', shouldCreateUser: false },
    })
    setIsLoading(false)
    if (error) throw error
  }, [])

  const signIn = useCallback(async (credentials: { phone_number: string; otp: string }) => {
    setIsLoading(true)

    if (IS_DEMO_MODE) {
      await new Promise(resolve => setTimeout(resolve, 600))
      setUser(MOCK_DRIVER)
      setIsLoading(false)
      return
    }

    const { error } = await supabase.auth.verifyOtp({
      phone: credentials.phone_number,
      token: credentials.otp,
      type: 'sms',
    })
    if (error) {
      setIsLoading(false)
      throw error
    }

    setUser(await fetchProfile())
    setIsLoading(false)
  }, [fetchProfile])

  const signOut = useCallback(async () => {
    if (!IS_DEMO_MODE) {
      await supabase.auth.signOut()
    }
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, requestOtp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
```

- [ ] **Step 4: Run both AuthContext test files to verify everything passes**

Run: `cd frontend/driver-pwa && npx vitest run lib/context/__tests__/AuthContext.test.tsx lib/context/__tests__/AuthContext.real.test.tsx`
Expected: 6 passed (2 demo + 4 real)

- [ ] **Step 5: Run the full driver-pwa test suite to confirm no regressions**

Run: `cd frontend/driver-pwa && npm test`
Expected: all passed (includes the pre-existing `handshake-progress.test.ts`)

- [ ] **Step 6: Stage files (do not commit)**

```bash
git add frontend/driver-pwa/lib/context/AuthContext.tsx frontend/driver-pwa/lib/context/__tests__/AuthContext.test.tsx frontend/driver-pwa/lib/context/__tests__/AuthContext.real.test.tsx
```

---

## Task 7: Frontend — simplify `login/page.tsx` and `otp/page.tsx`

**Files:**
- Modify: `frontend/driver-pwa/app/login/page.tsx`
- Modify: `frontend/driver-pwa/app/otp/page.tsx`

No new automated tests — these pages are thin and already covered indirectly by `AuthContext`'s tests; behavior is verified manually in Task 8.

- [ ] **Step 1: Replace `frontend/driver-pwa/app/login/page.tsx`**

```tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

// Supabase's error message when shouldCreateUser: false blocks an unregistered
// phone number — matched case-insensitively to surface a driver-friendly message.
const UNREGISTERED_PHONE_ERROR_FRAGMENT = 'signups not allowed'

export default function LoginPage() {
  const router = useRouter()
  const auth = useContext(AuthContext)
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      await auth?.requestOtp(phone)
      router.push(`/otp?phone=${encodeURIComponent(phone)}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send OTP.'
      setError(
        message.toLowerCase().includes(UNREGISTERED_PHONE_ERROR_FRAGMENT)
          ? 'Phone number not registered — contact your dispatcher.'
          : message,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold mb-8 text-surface-on">FreightProof Driver</h1>
      <form onSubmit={handleSendOtp} className="w-full max-w-sm flex flex-col gap-4">
        <Input
          label="Phone number"
          type="tel"
          placeholder="+27 82 000 0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        {error && <p className="text-sm text-error">{error}</p>}
        <Button type="submit" loading={loading} disabled={loading || !phone}>
          {loading ? 'Sending…' : 'Send OTP'}
        </Button>
      </form>
    </main>
  )
}
```

- [ ] **Step 2: Replace `frontend/driver-pwa/app/otp/page.tsx`**

```tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { Suspense, useContext, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ROUTES } from '@/lib/constants/routes'

// useSearchParams() opts a page out of static rendering unless wrapped in
// Suspense — required for the static export (output: 'export') build.
export default function OtpPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-surface-on-variant">Loading…</p>
        </main>
      }
    >
      <OtpForm />
    </Suspense>
  )
}

function OtpForm() {
  const router = useRouter()
  const auth = useContext(AuthContext)
  const params = useSearchParams()
  // Phone passed as query param from login page; empty string is safe — signIn will fail gracefully.
  const phone = params.get('phone') ?? ''
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      await auth?.signIn({ phone_number: phone, otp: token })
      // replace() so the user cannot navigate back to the OTP screen after login.
      router.replace(ROUTES.trips)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify OTP.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold mb-2 text-surface-on">Enter OTP</h1>
      <p className="text-sm text-surface-on-variant mb-8">Sent to {phone}</p>
      <form onSubmit={handleVerify} className="w-full max-w-sm flex flex-col gap-4">
        <Input
          label="6-digit code"
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={token}
          // Strip non-digit characters to prevent invalid OTP submission.
          onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
          required
        />
        {error && <p className="text-sm text-error">{error}</p>}
        <Button type="submit" loading={loading} disabled={loading || token.length < 6}>
          {loading ? 'Verifying…' : 'Verify'}
        </Button>
      </form>
    </main>
  )
}
```

- [ ] **Step 3: Run the full driver-pwa test and type-check suite**

Run: `cd frontend/driver-pwa && npm test && npx tsc --noEmit`
Expected: all tests passed, zero type errors

- [ ] **Step 4: Stage files (do not commit)**

```bash
git add frontend/driver-pwa/app/login/page.tsx frontend/driver-pwa/app/otp/page.tsx
```

---

## Task 8: Manual end-to-end verification

**Files:** none (manual verification only — no code in this task)

- [ ] **Step 1: Verify the unregistered-phone rejection**

With a real Supabase project configured (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` set, `NEXT_PUBLIC_DEMO_MODE=false`), run `cd frontend/driver-pwa && npm run dev`, open `/login`, and submit a phone number that has never been passed to `POST /api/v1/drivers`. Confirm the page shows "Phone number not registered — contact your dispatcher." and does not navigate to `/otp`.

- [ ] **Step 2: Verify a provisioned phone number can sign in**

Using the dispatcher app (or a direct `POST /api/v1/drivers` call with a dispatcher JWT) provision a driver with a real, SMS-reachable phone number. From `/login`, submit that phone number, confirm an SMS OTP arrives, enter it on `/otp`, and confirm the app lands on `/trips` with the driver's real name/license visible (via `ProfilePanel`/`HomeContent`, both of which read `useAuth().user` unchanged).

- [ ] **Step 3: Verify session persistence**

Refresh the browser while signed in. Confirm the app does not bounce back to `/login` (the `getSession()` + `/drivers/me` fetch in `AuthContext`'s mount effect should re-hydrate `user` before the `(app)/layout.tsx` guard redirects).

- [ ] **Step 4: Verify demo mode still works untouched**

With `NEXT_PUBLIC_DEMO_MODE` unset (or `true`), repeat the login flow with any phone number and any 6-digit code. Confirm it still signs in instantly with the mock driver, matching pre-existing behavior — confirming this feature didn't regress the demo path other developers may rely on.

---

## Self-Review

**Spec coverage:**
- `get_current_driver` dependency, `app_metadata.role == "driver"` gate, `is_active` check, `DEMO_MODE` stub → Tasks 1–2.
- `GET /api/v1/drivers/me` registered before `/{driver_id}` → Task 3.
- `shouldCreateUser: false` enforcement → Task 6 (`AuthContext.requestOtp`).
- Typed API client → Task 4.
- `AuthContext` real-mode rewrite, demo mode preserved in one place → Tasks 5–6.
- Login/OTP page simplification, friendly "not registered" message → Task 7.
- Backend unit + integration tests mirroring existing patterns → Tasks 1–3.
- Manual end-to-end verification of the registered/unregistered split and session persistence → Task 8.
- No changes needed to `ProfilePanel`, `HomeContent`, `trips/page.tsx`, `(app)/layout.tsx`, or `lib/types/user.ts` — confirmed unchanged, consistent with the spec's "Out of scope" section.

**Placeholder scan:** none found — every step has complete code or an exact command with expected output.

**Type consistency:** `AuthState.requestOtp(phone_number: string)`, `AuthState.signIn({ phone_number, otp })`, `DriverUser = Driver` — used identically across Tasks 5–7; `DriverRead` schema fields (`id`, `organization_id`, `full_name`, `id_number`, `phone_number`, `license_number`, `license_expiry`, `idvs_status`, `idvs_last_verified_at`, `is_active`, `created_at`, `updated_at`) match between Task 2's `_DEMO_DRIVER`/`get_current_driver` and Task 3's `_make_driver` test fixture.
