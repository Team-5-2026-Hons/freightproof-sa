# Driver PWA Fully Functional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `driver-pwa` from mock-data placeholder to a real, backend-wired app covering OTP auth, all 5 driver handshakes, the Manifest→Linehaul rename, evidence capture, exception/checkpoint reporting, and an offline queue — with Hedera anchoring explicitly deferred (hash computation lands, the on-chain anchor call does not).

**Architecture:** Backend gets a self-issued driver JWT (drivers aren't Supabase Auth users, so this is a separate HS256 scheme alongside the existing ES256 dispatcher tokens), a handshake state machine (`advance_h1`…`advance_h5`) per the existing `api_contract_dispatcher_driver.md` spec, and a role-aware manifest endpoint that returns a stripped `LinehaulResponse` to drivers and the full `ManifestResponse` to dispatchers. Frontend gets a typed `lib/api/` layer that swaps in for `lib/mocks/` behind the same hooks (per the contract's §9 transition table — hooks don't change shape), real capture hooks (camera, seal scan), and the actual per-step handshake screens replacing the current placeholder.

**Tech Stack:** FastAPI 0.115+, SQLAlchemy 2.0 async, Alembic, Pydantic v2, pytest-asyncio, jose (JWT), Next.js 15 App Router, Capacitor 6 (Camera, Geolocation already present).

---

## Phase boundary note

This plan covers everything except Hedera anchoring, confirmed with the user. H2/H5 `advance_h2`/`advance_h5` compute and store `event_hash` but do **not** call `anchor_subject()` — that call is a one-line follow-up once Hedera work starts, marked with a comment, not a TODO placeholder.

## Shared-file impact (flag per CLAUDE.md)

| File | Change | Coordinate with |
|---|---|---|
| `backend/app/main.py` | register `auth` (extended), `artifacts`, `handshakes`, `exceptions`, `checkpoints` routers | all devs |
| `backend/app/core/config.py` | add `DRIVER_JWT_SECRET`, `DRIVER_OTP_TTL_SECONDS`, `TWILIO_USE_MOCK` | all devs (everyone's `.env`) |
| `backend/app/schemas/trips.py`, `transit.py`, `handshakes.py` | extend with new response/request models | DB schema owner |
| `backend/.env.example` | new keys | all devs |
| Alembic migration | new `driver_otp_codes` table | check `git fetch origin` / `dev` for conflicting migrations before autogenerating — **do not resolve a chain conflict yourself, flag it** |

---

## File Structure

**Backend (new files):**
```
backend/app/integrations/twilio.py
backend/app/auth/driver_jwt.py
backend/app/auth/otp_service.py
backend/app/db/models/otp.py
backend/app/schemas/otp.py
backend/app/storage/supabase_storage.py
backend/app/orchestration/artifact_service.py
backend/app/orchestration/handshake_service.py
backend/app/orchestration/exception_service.py
backend/app/orchestration/checkpoint_service.py
backend/app/orchestration/manifest_service.py
backend/app/api/v1/endpoints/artifacts.py
backend/app/api/v1/endpoints/handshakes.py
backend/app/api/v1/endpoints/exceptions.py
backend/app/api/v1/endpoints/checkpoints.py
backend/app/api/v1/endpoints/manifest.py
backend/migrations/versions/2026_06_24_tim_add_driver_otp_codes.py
```

**Backend (modified):** `core/config.py`, `auth/dependencies.py`, `auth/router.py`, `schemas/handshakes.py`, `schemas/trips.py`, `db/models/__init__.py`, `main.py`, `.env.example`

**Frontend shared (modified/new):**
```
frontend/shared/lib/types/manifest.ts        (add Linehaul, keep Manifest for dispatcher)
frontend/shared/lib/constants/handshake-meta.ts (H2 step rename)
frontend/shared/lib/mocks/manifests.ts        (add mockLinehauls)
```

**Frontend driver-pwa (new):**
```
lib/api/client.ts
lib/api/auth.ts
lib/api/trips.ts
lib/api/manifest.ts
lib/api/artifacts.ts
lib/api/exceptions.ts
lib/api/checkpoints.ts
lib/hooks/useCamera.ts
lib/hooks/useSeal.ts
lib/offline/queue.ts
components/handshake/HandshakeStepShell.tsx
components/handshake/h1/*.tsx … h5/*.tsx
```

**Frontend driver-pwa (modified):** `lib/context/AuthContext.tsx`, `lib/context/TripContext.tsx`, `app/trips/[id]/handshake/[step]/page.tsx`, `app/sw.ts`, `package.json`

---

# Phase A — Driver Auth (backend)

### Task 1: OTP storage migration + config keys

**Files:**
- Create: `backend/migrations/versions/2026_06_24_tim_add_driver_otp_codes.py`
- Create: `backend/app/db/models/otp.py`
- Modify: `backend/app/db/models/__init__.py`
- Modify: `backend/app/core/config.py:81` (after `PP_POLL_INTERVAL_SECONDS`)
- Modify: `backend/.env.example`

- [ ] **Step 1: Check for migration conflicts first**

Run: `cd backend && git fetch origin && git log origin/dev --oneline -5 -- migrations/versions/`
Expected: confirm no unmerged migration ahead of `ciaran_add_vehicle_length_m` (the current head). If there is one, stop and flag it — do not resolve the chain yourself.

- [ ] **Step 2: Add the model**

```python
# backend/app/db/models/otp.py
"""SQLAlchemy model for driver phone-OTP codes — short-lived, not a long-term auth table."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base


class DriverOtpCode(Base):
    """One row per OTP request. code_hash, never the raw code, is stored."""

    __tablename__ = "driver_otp_codes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

Add to `backend/app/db/models/__init__.py` after the `events` import:
```python
from app.db.models.otp import DriverOtpCode  # noqa: E402,F401
```

- [ ] **Step 3: Write the migration**

```python
# backend/migrations/versions/2026_06_24_tim_add_driver_otp_codes.py
"""add driver_otp_codes table

Revision ID: tim_driver_otp_codes
Revises: ciaran_add_vehicle_length_m
Create Date: 2026-06-24
"""
from alembic import op
import sqlalchemy as sa

revision = "tim_driver_otp_codes"
down_revision = "ciaran_add_vehicle_length_m"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "driver_otp_codes",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("phone_number", sa.String(20), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_driver_otp_codes_phone_number", "driver_otp_codes", ["phone_number"])


def downgrade() -> None:
    op.drop_index("ix_driver_otp_codes_phone_number", table_name="driver_otp_codes")
    op.drop_table("driver_otp_codes")
```

- [ ] **Step 4: Run the migration against the dev DB**

Run: `cd backend && alembic upgrade head`
Expected: `Running upgrade ciaran_add_vehicle_length_m -> tim_driver_otp_codes`

- [ ] **Step 5: Add config keys**

In `backend/app/core/config.py`, after `PP_POLL_INTERVAL_SECONDS: int = 60`:
```python
    TWILIO_USE_MOCK: bool = True

    # -------------------------------------------------------------------------
    # Driver auth
    # DRIVER_JWT_SECRET signs driver-issued tokens (HS256) — separate from the
    # Supabase ES256 dispatcher tokens, since drivers have no Supabase Auth account.
    # -------------------------------------------------------------------------
    DRIVER_JWT_SECRET: str
    DRIVER_OTP_TTL_SECONDS: int = 300
    DRIVER_JWT_TTL_SECONDS: int = 43200  # 12h — a driver's shift
```

Add to `backend/.env.example`:
```
TWILIO_USE_MOCK=true
DRIVER_JWT_SECRET=
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/db/models/otp.py backend/app/db/models/__init__.py \
        backend/migrations/versions/2026_06_24_tim_add_driver_otp_codes.py \
        backend/app/core/config.py backend/.env.example
git commit -m "feat(auth): add driver_otp_codes table and driver JWT config"
```

---

### Task 2: Twilio integration (SMS OTP)

**Files:**
- Create: `backend/app/integrations/twilio.py`
- Test: `backend/tests/unit/test_twilio.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_twilio.py
import pytest
from app.integrations.twilio import send_otp_sms


@pytest.mark.asyncio
async def test_send_otp_sms_mock_mode_returns_true(monkeypatch):
    monkeypatch.setattr("app.integrations.twilio.settings.TWILIO_USE_MOCK", True)
    result = await send_otp_sms(phone_number="+27821234567", code="123456")
    assert result is True


@pytest.mark.asyncio
async def test_send_otp_sms_calls_twilio_client_when_not_mocked(monkeypatch):
    sent = {}

    class FakeMessages:
        def create(self, *, body, from_, to):
            sent["body"], sent["to"] = body, to
            return object()

    class FakeClient:
        def __init__(self, *_args, **_kwargs):
            self.messages = FakeMessages()

    monkeypatch.setattr("app.integrations.twilio.settings.TWILIO_USE_MOCK", False)
    monkeypatch.setattr("app.integrations.twilio.Client", FakeClient)

    result = await send_otp_sms(phone_number="+27821234567", code="123456")
    assert result is True
    assert "123456" in sent["body"]
    assert sent["to"] == "+27821234567"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_twilio.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.integrations.twilio'`

- [ ] **Step 3: Add the `twilio` dependency and implement**

Run: `cd backend && echo "twilio>=9.0.0" >> requirements.txt && pip install twilio`

```python
# backend/app/integrations/twilio.py
"""Twilio SMS integration — sends driver OTP codes.

TWILIO_USE_MOCK=true (default) logs the code instead of sending a real SMS,
so dev/demo environments work without a funded Twilio account.
"""

import logging

from twilio.rest import Client

from app.core.config import settings

logger = logging.getLogger(__name__)


async def send_otp_sms(*, phone_number: str, code: str) -> bool:
    """Send an OTP SMS to phone_number. Returns True on success, False on failure."""
    message = f"Your FreightProof verification code is {code}. It expires in 5 minutes."

    if settings.TWILIO_USE_MOCK:
        logger.info("MOCK SMS to %s: %s", phone_number, message)
        return True

    client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    try:
        client.messages.create(body=message, from_=settings.TWILIO_FROM_NUMBER, to=phone_number)
        return True
    except Exception:
        logger.exception("Twilio SMS send failed for %s", phone_number)
        return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_twilio.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/integrations/twilio.py backend/tests/unit/test_twilio.py backend/requirements.txt
git commit -m "feat(integrations): add Twilio OTP SMS integration with mock mode"
```

---

### Task 3: Driver JWT module

**Files:**
- Create: `backend/app/auth/driver_jwt.py`
- Test: `backend/tests/unit/test_driver_jwt.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_driver_jwt.py
import uuid
import pytest
from jose import JWTError

from app.auth.driver_jwt import create_driver_token, decode_driver_token


def test_create_and_decode_round_trips_driver_id():
    driver_id = uuid.uuid4()
    token = create_driver_token(driver_id)
    decoded_id = decode_driver_token(token)
    assert decoded_id == driver_id


def test_decode_rejects_garbage_token():
    with pytest.raises(JWTError):
        decode_driver_token("not.a.jwt")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_driver_jwt.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.auth.driver_jwt'`

- [ ] **Step 3: Implement**

```python
# backend/app/auth/driver_jwt.py
"""Self-issued HS256 JWTs for drivers.

Drivers authenticate via phone OTP, not Supabase Auth, so they have no
Supabase-issued ES256 token. This module issues and verifies our own token
instead. Keep this separate from auth/dependencies.py's Supabase verification
— different algorithm, different secret, different claim shape.
"""

import uuid
from datetime import UTC, datetime, timedelta

from jose import jwt

from app.core.config import settings

_ALGORITHM = "HS256"


def create_driver_token(driver_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(driver_id),
        "role": "driver",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.DRIVER_JWT_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, settings.DRIVER_JWT_SECRET, algorithm=_ALGORITHM)


def decode_driver_token(token: str) -> uuid.UUID:
    """Raises jose.JWTError (incl. ExpiredSignatureError) on any invalid token."""
    payload = jwt.decode(token, settings.DRIVER_JWT_SECRET, algorithms=[_ALGORITHM])
    return uuid.UUID(payload["sub"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_driver_jwt.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth/driver_jwt.py backend/tests/unit/test_driver_jwt.py
git commit -m "feat(auth): add self-issued HS256 JWT for driver sessions"
```

---

### Task 4: OTP service (request/verify)

**Files:**
- Create: `backend/app/schemas/otp.py`
- Create: `backend/app/auth/otp_service.py`
- Test: `backend/tests/unit/test_otp_service.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_otp_service.py
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.auth.otp_service import request_otp, verify_otp
from app.core.exceptions import ResourceNotFoundError
from app.db.models.otp import DriverOtpCode
from app.db.models.organisations import Organization
from app.db.models.people import Driver
from app.db.models.enums import OrganizationType


@pytest_asyncio.fixture
async def driver(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    d = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Test Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number="DRV-001", is_active=True,
    )
    db_session.add(d)
    await db_session.flush()
    return d


@pytest.mark.asyncio
async def test_request_otp_creates_row_and_sends_sms(db_session, driver, monkeypatch):
    sent = {}
    async def fake_send(*, phone_number, code):
        sent["phone_number"], sent["code"] = phone_number, code
        return True
    monkeypatch.setattr("app.auth.otp_service.send_otp_sms", fake_send)

    await request_otp(db_session, phone_number=driver.phone_number)

    result = await db_session.execute(
        select(DriverOtpCode).where(DriverOtpCode.phone_number == driver.phone_number)
    )
    row = result.scalar_one()
    assert row.attempts == 0
    assert sent["phone_number"] == driver.phone_number
    assert len(sent["code"]) == 6


@pytest.mark.asyncio
async def test_request_otp_unknown_phone_raises_not_found(db_session, monkeypatch):
    monkeypatch.setattr("app.auth.otp_service.send_otp_sms", lambda **_: True)
    with pytest.raises(ResourceNotFoundError):
        await request_otp(db_session, phone_number="+27800000000")


@pytest.mark.asyncio
async def test_verify_otp_correct_code_returns_driver(db_session, driver, monkeypatch):
    monkeypatch.setattr("app.auth.otp_service.send_otp_sms", lambda **_: True)
    code = await request_otp(db_session, phone_number=driver.phone_number, _return_code_for_test=True)

    result_driver = await verify_otp(db_session, phone_number=driver.phone_number, code=code)
    assert result_driver.id == driver.id


@pytest.mark.asyncio
async def test_verify_otp_wrong_code_raises_value_error(db_session, driver, monkeypatch):
    monkeypatch.setattr("app.auth.otp_service.send_otp_sms", lambda **_: True)
    await request_otp(db_session, phone_number=driver.phone_number)

    with pytest.raises(ValueError, match="Invalid or expired"):
        await verify_otp(db_session, phone_number=driver.phone_number, code="000000")


@pytest.mark.asyncio
async def test_verify_otp_expired_code_raises_value_error(db_session, driver, monkeypatch):
    monkeypatch.setattr("app.auth.otp_service.send_otp_sms", lambda **_: True)
    code = await request_otp(db_session, phone_number=driver.phone_number, _return_code_for_test=True)

    result = await db_session.execute(
        select(DriverOtpCode).where(DriverOtpCode.phone_number == driver.phone_number)
    )
    row = result.scalar_one()
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.flush()

    with pytest.raises(ValueError, match="Invalid or expired"):
        await verify_otp(db_session, phone_number=driver.phone_number, code=code)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_otp_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.auth.otp_service'`

- [ ] **Step 3: Implement the schema and service**

```python
# backend/app/schemas/otp.py
from pydantic import BaseModel, Field


class OtpRequestBody(BaseModel):
    phone_number: str = Field(..., min_length=10)


class OtpVerifyBody(BaseModel):
    phone_number: str = Field(..., min_length=10)
    code: str = Field(..., min_length=6, max_length=6)
```

```python
# backend/app/auth/otp_service.py
"""Driver OTP request/verify — the only auth path for drivers (no password)."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.otp import DriverOtpCode
from app.db.models.people import Driver
from app.integrations.twilio import send_otp_sms

_MAX_ATTEMPTS = 5


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


async def request_otp(
    db: AsyncSession,
    *,
    phone_number: str,
    _return_code_for_test: bool = False,
) -> str | None:
    """Generate a 6-digit code, store its hash, and SMS it to the driver.

    Raises ResourceNotFoundError if no active driver has this phone number.
    _return_code_for_test exists only so tests can verify the round trip
    without scraping logs — never read by production code paths.
    """
    result = await db.execute(
        select(Driver).where(Driver.phone_number == phone_number, Driver.is_active.is_(True))
    )
    if result.scalar_one_or_none() is None:
        raise ResourceNotFoundError("Driver", phone_number)

    code = f"{secrets.randbelow(1_000_000):06d}"
    otp_row = DriverOtpCode(
        phone_number=phone_number,
        code_hash=_hash_code(code),
        attempts=0,
        expires_at=datetime.now(UTC) + timedelta(seconds=settings.DRIVER_OTP_TTL_SECONDS),
    )
    db.add(otp_row)
    await db.flush()

    await send_otp_sms(phone_number=phone_number, code=code)
    return code if _return_code_for_test else None


async def verify_otp(db: AsyncSession, *, phone_number: str, code: str) -> Driver:
    """Verify the most recent unexpired OTP for phone_number. Returns the Driver row.

    Raises ValueError("Invalid or expired ...") on any failure — caller maps to HTTP 401.
    """
    result = await db.execute(
        select(DriverOtpCode)
        .where(DriverOtpCode.phone_number == phone_number)
        .order_by(DriverOtpCode.created_at.desc())
        .limit(1)
    )
    otp_row = result.scalar_one_or_none()

    if otp_row is None or otp_row.attempts >= _MAX_ATTEMPTS or otp_row.expires_at < datetime.now(UTC):
        raise ValueError("Invalid or expired verification code.")

    if otp_row.code_hash != _hash_code(code):
        otp_row.attempts += 1
        await db.flush()
        raise ValueError("Invalid or expired verification code.")

    driver_result = await db.execute(
        select(Driver).where(Driver.phone_number == phone_number, Driver.is_active.is_(True))
    )
    driver = driver_result.scalar_one_or_none()
    if driver is None:
        raise ResourceNotFoundError("Driver", phone_number)

    return driver
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_otp_service.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/otp.py backend/app/auth/otp_service.py backend/tests/unit/test_otp_service.py
git commit -m "feat(auth): add driver OTP request/verify service"
```

---

### Task 5: `get_current_driver` dependency

**Files:**
- Modify: `backend/app/auth/dependencies.py`
- Test: `backend/tests/unit/test_get_current_driver.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_get_current_driver.py
import uuid
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth.dependencies import get_current_driver
from app.auth.driver_jwt import create_driver_token
from app.db.models.organisations import Organization
from app.db.models.people import Driver
from app.db.models.enums import OrganizationType


@pytest.mark.asyncio
async def test_get_current_driver_valid_token_returns_driver(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    d = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Test Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number="DRV-001", is_active=True,
    )
    db_session.add(d)
    await db_session.flush()

    token = create_driver_token(d.id)
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    result = await get_current_driver(creds, db_session)
    assert result.id == d.id


@pytest.mark.asyncio
async def test_get_current_driver_missing_token_raises_403():
    with pytest.raises(HTTPException) as exc_info:
        await get_current_driver(None, None)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_get_current_driver_inactive_driver_raises_401(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    d = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Inactive Driver",
        id_number="8001015009087", phone_number="+27821234568",
        license_number="DRV-002", is_active=False,
    )
    db_session.add(d)
    await db_session.flush()

    token = create_driver_token(d.id)
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    with pytest.raises(HTTPException) as exc_info:
        await get_current_driver(creds, db_session)
    assert exc_info.value.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_get_current_driver.py -v`
Expected: FAIL — `ImportError: cannot import name 'get_current_driver'`

- [ ] **Step 3: Implement** — add to `backend/app/auth/dependencies.py`, near `get_current_dispatcher`:

```python
from jose import JWTError
from app.auth.driver_jwt import decode_driver_token
from app.db.models.people import Driver
from app.schemas.people import DriverRead

_DEMO_DRIVER_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")


async def get_current_driver(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: AsyncSession = Depends(get_db),
) -> DriverRead:
    """Return the authenticated driver for the current request, or raise 401/403.

    Used as a FastAPI dependency:
        async def my_endpoint(driver: DriverRead = Depends(get_current_driver)):
    """
    if settings.DEMO_MODE:
        result = await db.execute(select(Driver).where(Driver.id == _DEMO_DRIVER_ID))
        demo_driver = result.scalar_one_or_none()
        if demo_driver is not None:
            return DriverRead.model_validate(demo_driver)

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing authentication credentials.",
        )

    try:
        driver_id = decode_driver_token(credentials.credentials)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(Driver).where(Driver.id == driver_id))
    driver = result.scalar_one_or_none()

    if driver is None or not driver.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Driver account not found or inactive.",
        )

    return DriverRead.model_validate(driver)


async def require_assigned_driver(trip_driver_id: uuid.UUID, driver: DriverRead) -> None:
    """Raise HTTP 403 unless `driver` is the driver assigned to this trip.

    Call from handshake endpoints after loading the trip — never trust the
    driver_id implied by the JWT alone, since any active driver could
    otherwise advance someone else's trip.
    """
    if driver.id != trip_driver_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned driver on this trip.",
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_get_current_driver.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth/dependencies.py backend/tests/unit/test_get_current_driver.py
git commit -m "feat(auth): add get_current_driver and require_assigned_driver dependencies"
```

---

### Task 6: Driver auth endpoints

**Files:**
- Modify: `backend/app/auth/router.py`
- Modify: `backend/app/main.py` (no change needed — `auth_router` already registered)
- Test: `backend/tests/integration/test_driver_auth.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/integration/test_driver_auth.py
import uuid
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.db.models.organisations import Organization
from app.db.models.people import Driver
from app.db.models.enums import OrganizationType
from app.db.session import get_db


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def driver(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    d = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Test Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number="DRV-001", is_active=True,
    )
    db_session.add(d)
    await db_session.flush()
    return d


async def test_otp_request_then_verify_returns_token(driver, monkeypatch):
    captured = {}
    async def fake_send(*, phone_number, code):
        captured["code"] = code
        return True
    monkeypatch.setattr("app.auth.otp_service.send_otp_sms", fake_send)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/auth/driver/otp/request", json={"phone_number": driver.phone_number})
        assert resp.status_code == 200

        resp = await client.post(
            "/api/v1/auth/driver/otp/verify",
            json={"phone_number": driver.phone_number, "code": captured["code"]},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert body["driver"]["id"] == str(driver.id)


async def test_otp_verify_wrong_code_returns_401(driver, monkeypatch):
    monkeypatch.setattr("app.auth.otp_service.send_otp_sms", lambda **_: True)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/v1/auth/driver/otp/request", json={"phone_number": driver.phone_number})
        resp = await client.post(
            "/api/v1/auth/driver/otp/verify",
            json={"phone_number": driver.phone_number, "code": "000000"},
        )
        assert resp.status_code == 401


async def test_otp_request_unknown_phone_returns_404():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/auth/driver/otp/request", json={"phone_number": "+27800000000"})
        assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_driver_auth.py -v`
Expected: FAIL — 404 Not Found (routes don't exist yet)

- [ ] **Step 3: Implement** — add to `backend/app/auth/router.py`:

```python
from fastapi import HTTPException, status as http_status

from app.auth.driver_jwt import create_driver_token
from app.auth.otp_service import request_otp, verify_otp
from app.core.exceptions import ResourceNotFoundError
from app.db.session import get_db
from app.schemas.otp import OtpRequestBody, OtpVerifyBody
from app.schemas.people import DriverRead
from sqlalchemy.ext.asyncio import AsyncSession


@router.post("/driver/otp/request", status_code=http_status.HTTP_200_OK)
async def driver_otp_request(payload: OtpRequestBody, db: AsyncSession = Depends(get_db)) -> dict:
    try:
        await request_otp(db, phone_number=payload.phone_number)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"status": "sent"}


@router.post("/driver/otp/verify")
async def driver_otp_verify(payload: OtpVerifyBody, db: AsyncSession = Depends(get_db)) -> dict:
    try:
        driver = await verify_otp(db, phone_number=payload.phone_number, code=payload.code)
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return {
        "access_token": create_driver_token(driver.id),
        "driver": DriverRead.model_validate(driver).model_dump(mode="json"),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_driver_auth.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth/router.py backend/tests/integration/test_driver_auth.py
git commit -m "feat(auth): add driver OTP request/verify endpoints"
```

---

# Phase B — Trip lookup + evidence artifacts (prerequisites for handshakes)

### Task 7: `GET /trips/me/active` (driver)

**Files:**
- Modify: `backend/app/orchestration/trip_service.py`
- Modify: `backend/app/api/v1/endpoints/trips.py`
- Test: `backend/tests/integration/test_trips_driver_active.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_trips_driver_active.py
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


async def test_active_trip_returns_null_when_no_active_trip(db_session):
    fake_driver = DriverRead(
        id=uuid.uuid4(), organization_id=uuid.uuid4(), full_name="X",
        id_number="8001015009087", phone_number="+27821234567",
        license_number="DRV-1", is_active=True,
    )
    app.dependency_overrides[get_current_driver] = lambda: fake_driver

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/trips/me/active")
        assert resp.status_code == 200
        assert resp.json() is None

    app.dependency_overrides.pop(get_current_driver, None)
```

(Full happy-path test with a seeded active trip is added in Task 11 once `advance_h1` exists to produce a non-`created` trip — `seed_data`-style fixtures are reused from `test_trips.py`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/integration/test_trips_driver_active.py -v`
Expected: FAIL — 404 Not Found

- [ ] **Step 3: Implement** — add to `backend/app/orchestration/trip_service.py`:

```python
from app.schemas.trips import TripDetailResponse  # already imported
# ... reuse the same assembly logic as get_trip_detail, scoped by driver_id instead of org

async def get_active_trip_for_driver(db: AsyncSession, driver_id: uuid.UUID) -> TripDetailResponse | None:
    """Return the driver's one active trip, or None. 'Active' excludes closed/cancelled."""
    inactive = {TripStatus.CLOSED, TripStatus.CANCELLED}
    result = await db.execute(
        select(Trip).where(Trip.driver_id == driver_id, Trip.status.notin_(inactive))
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        return None
    from app.orchestration.resource_service import get_trip_detail
    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)
```

Add to `backend/app/api/v1/endpoints/trips.py`:

```python
from app.auth.dependencies import get_current_driver
from app.orchestration.trip_service import get_active_trip_for_driver
from app.schemas.people import DriverRead


@router.get("/me/active", response_model=TripDetailResponse | None, summary="Driver's current active trip")
async def get_my_active_trip_endpoint(
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse | None:
    return await get_active_trip_for_driver(db, driver_id=current_driver.id)
```

Place this route **above** `@router.get("/{trip_id}")` in the file so FastAPI matches `/me/active` before treating `me` as a `{trip_id}` path param.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/integration/test_trips_driver_active.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestration/trip_service.py backend/app/api/v1/endpoints/trips.py \
        backend/tests/integration/test_trips_driver_active.py
git commit -m "feat(trips): add GET /trips/me/active for driver PWA home screen"
```

---

### Task 8: Supabase Storage upload module

**Files:**
- Create: `backend/app/storage/supabase_storage.py`
- Test: `backend/tests/unit/test_supabase_storage.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_supabase_storage.py
import pytest
from app.storage.supabase_storage import upload_evidence_file


@pytest.mark.asyncio
async def test_upload_evidence_file_returns_key_bucket_and_hash(monkeypatch):
    class FakeStorageBucket:
        def upload(self, path, file_bytes, file_options=None):
            return {"path": path}

    class FakeStorage:
        def from_(self, bucket):
            assert bucket == "evidence-artifacts"
            return FakeStorageBucket()

    class FakeSupabaseClient:
        storage = FakeStorage()

    monkeypatch.setattr("app.storage.supabase_storage._get_client", lambda: FakeSupabaseClient())

    result = await upload_evidence_file(
        trip_id="11111111-1111-1111-1111-111111111111",
        file_bytes=b"hello world",
        mime_type="image/jpeg",
    )
    assert result.s3_bucket == "evidence-artifacts"
    assert result.s3_key.startswith("11111111-1111-1111-1111-111111111111/")
    assert len(result.file_hash) == 64
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_supabase_storage.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement**

```python
# backend/app/storage/supabase_storage.py
"""Supabase Storage I/O for evidence artifacts (photos, documents).

Bucket name is fixed, not configurable — one bucket per environment, never
shared with other Supabase projects. POPIA: only the file and its hash are
stored here; no PII fields beyond what's in the photo itself.
"""

import hashlib
import uuid
from dataclasses import dataclass

from supabase import Client, create_client

from app.core.config import settings

_BUCKET = "evidence-artifacts"


@dataclass
class UploadResult:
    s3_bucket: str
    s3_key: str
    file_hash: str


def _get_client() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


async def upload_evidence_file(*, trip_id: str, file_bytes: bytes, mime_type: str) -> UploadResult:
    """Upload one file under `{trip_id}/{uuid}` and return its storage location + SHA-256 hash."""
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    key = f"{trip_id}/{uuid.uuid4()}"

    client = _get_client()
    client.storage.from_(_BUCKET).upload(key, file_bytes, file_options={"content-type": mime_type})

    return UploadResult(s3_bucket=_BUCKET, s3_key=key, file_hash=file_hash)
```

Add `supabase` to `backend/requirements.txt` if not already present (the existing `app/integrations/supabase_admin.py` already depends on it — check first with `grep supabase backend/requirements.txt`; only add if missing).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_supabase_storage.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/storage/supabase_storage.py backend/tests/unit/test_supabase_storage.py
git commit -m "feat(storage): add Supabase Storage upload for evidence artifacts"
```

---

### Task 9: Artifacts upload endpoint

**Files:**
- Create: `backend/app/orchestration/artifact_service.py`
- Create: `backend/app/api/v1/endpoints/artifacts.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/integration/test_artifacts.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_artifacts.py
import io
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


@pytest_asyncio.fixture(autouse=True)
def override_driver():
    fake = DriverRead(
        id=uuid.uuid4(), organization_id=uuid.uuid4(), full_name="X",
        id_number="8001015009087", phone_number="+27821234567",
        license_number="DRV-1", is_active=True,
    )
    app.dependency_overrides[get_current_driver] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_current_driver, None)


async def test_upload_artifact_returns_201_with_id(monkeypatch, override_driver):
    from app.storage.supabase_storage import UploadResult
    async def fake_upload(*, trip_id, file_bytes, mime_type):
        return UploadResult(s3_bucket="evidence-artifacts", s3_key=f"{trip_id}/x", file_hash="a" * 64)
    monkeypatch.setattr("app.orchestration.artifact_service.upload_evidence_file", fake_upload)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/artifacts",
            data={
                "trip_id": str(uuid.uuid4()),
                "artifact_type": "photo",
                "captured_at": "2026-06-24T08:00:00Z",
            },
            files={"file": ("gate.jpg", io.BytesIO(b"fakejpegbytes"), "image/jpeg")},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert "id" in body
    assert body["file_hash"] == "a" * 64


async def test_upload_artifact_over_10mb_returns_422(override_driver):
    transport = ASGITransport(app=app)
    big = io.BytesIO(b"0" * (10 * 1024 * 1024 + 1))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/artifacts",
            data={
                "trip_id": str(uuid.uuid4()),
                "artifact_type": "photo",
                "captured_at": "2026-06-24T08:00:00Z",
            },
            files={"file": ("big.jpg", big, "image/jpeg")},
        )
    assert resp.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/integration/test_artifacts.py -v`
Expected: FAIL — 404 Not Found

- [ ] **Step 3: Implement**

```python
# backend/app/orchestration/artifact_service.py
"""Evidence artifact creation — uploads to Storage, records the DB row."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.evidence import EvidenceArtifact
from app.db.models.enums import ArtifactType
from app.schemas.evidence import EvidenceArtifactRead
from app.storage.supabase_storage import upload_evidence_file

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024


async def create_artifact(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    file_bytes: bytes,
    mime_type: str,
    artifact_type: ArtifactType,
    captured_at: datetime,
    captured_by_driver_id: uuid.UUID | None = None,
    captured_lat: Decimal | None = None,
    captured_lng: Decimal | None = None,
) -> EvidenceArtifactRead:
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.")

    upload = await upload_evidence_file(trip_id=str(trip_id), file_bytes=file_bytes, mime_type=mime_type)

    artifact = EvidenceArtifact(
        id=uuid.uuid4(),
        trip_id=trip_id,
        artifact_type=artifact_type,
        s3_key=upload.s3_key,
        s3_bucket=upload.s3_bucket,
        file_hash=upload.file_hash,
        mime_type=mime_type,
        captured_by_driver_id=captured_by_driver_id,
        captured_lat=captured_lat,
        captured_lng=captured_lng,
        captured_at=captured_at,
    )
    db.add(artifact)
    await db.flush()
    await db.refresh(artifact)
    return EvidenceArtifactRead.model_validate(artifact)
```

```python
# backend/app/api/v1/endpoints/artifacts.py
"""Evidence artifact upload — called by driver PWA before submitting a handshake step."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.db.models.enums import ArtifactType
from app.db.session import get_db
from app.orchestration.artifact_service import MAX_FILE_SIZE_BYTES, create_artifact
from app.schemas.evidence import EvidenceArtifactRead
from app.schemas.people import DriverRead

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.post("", response_model=EvidenceArtifactRead, status_code=http_status.HTTP_201_CREATED)
async def upload_artifact_endpoint(
    trip_id: Annotated[UUID, Form()],
    artifact_type: Annotated[ArtifactType, Form()],
    captured_at: Annotated[datetime, Form()],
    file: Annotated[UploadFile, File()],
    captured_lat: Annotated[Decimal | None, Form()] = None,
    captured_lng: Annotated[Decimal | None, Form()] = None,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> EvidenceArtifactRead:
    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.",
        )

    try:
        return await create_artifact(
            db,
            trip_id=trip_id,
            file_bytes=file_bytes,
            mime_type=file.content_type or "application/octet-stream",
            artifact_type=artifact_type,
            captured_at=captured_at,
            captured_by_driver_id=current_driver.id,
            captured_lat=captured_lat,
            captured_lng=captured_lng,
        )
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
```

Register in `backend/app/main.py`:
```python
from app.api.v1.endpoints.artifacts import router as artifacts_router
# ...
app.include_router(artifacts_router, prefix="/api/v1")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/integration/test_artifacts.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestration/artifact_service.py backend/app/api/v1/endpoints/artifacts.py \
        backend/app/main.py backend/tests/integration/test_artifacts.py
git commit -m "feat(artifacts): add POST /api/v1/artifacts evidence upload endpoint"
```

---

I'm splitting the remaining phases (C: handshake state machine, D: exceptions/checkpoints, E: Linehaul rename, F: frontend API wiring, G: capture hooks, H: handshake UI, I: offline queue) into a continuation file so this one stays reviewable. Continuing now.
