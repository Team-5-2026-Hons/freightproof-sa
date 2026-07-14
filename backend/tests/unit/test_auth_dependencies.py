"""Unit tests for auth/dependencies.py — pure logic, no DB, no HTTP.

Tests cover _decode_token and _require_dispatcher_role directly so that
every rejection path is verified independently of the database layer.

_decode_token now uses ES256 + JWKS. The _get_jwks function is monkeypatched
to return a test EC public key, avoiding any network calls to Supabase.
"""

import base64
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Protocol

import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1, generate_private_key
from fastapi import HTTPException
from jose import jwt as jose_jwt

from app.auth.dependencies import (
    _decode_token,
    _require_dispatcher_role,
    _require_driver_role,
    require_admin_dispatcher,
)
from app.db.models.enums import DispatcherRole
from app.schemas.people import UserRead
from tests.conftest import TEST_KID, make_token, make_jwks

_NOW = datetime(2026, 1, 1, tzinfo=UTC)


def _make_user(role: DispatcherRole) -> UserRead:
    return UserRead(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        email="test@fp.co.za",
        full_name="Test User",
        is_active=True,
        created_at=_NOW,
        updated_at=_NOW,
        role=role,
    )


@pytest.fixture(autouse=True)
def patch_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch _get_jwks for every test in this module — no Supabase network calls."""
    monkeypatch.setattr("app.auth.dependencies._get_jwks", make_jwks)


# ── _decode_token ──────────────────────────────────────────────────────────────


def test_decode_token_valid_returns_payload() -> None:
    user_id = str(uuid.uuid4())
    token = make_token(sub=user_id)

    payload = _decode_token(token)

    assert payload["sub"] == user_id
    assert payload["aud"] == "authenticated"


def test_decode_token_expired_raises_401() -> None:
    token = make_token(expires_in=-1)

    with pytest.raises(HTTPException) as exc_info:
        _decode_token(token)

    assert exc_info.value.status_code == 401
    assert "expired" in exc_info.value.detail.lower()


def test_decode_token_wrong_key_raises_401(monkeypatch: pytest.MonkeyPatch) -> None:
    # Token signed with the test key, but JWKS patched to a different key — signature mismatch.
    different_key = generate_private_key(SECP256R1(), default_backend())
    pub_numbers = different_key.public_key().public_numbers()

    def _b64url(n: int) -> str:
        return base64.urlsafe_b64encode(n.to_bytes(32, "big")).rstrip(b"=").decode()

    wrong_jwks = {
        "keys": [
            {
                "kty": "EC",
                "crv": "P-256",
                "x": _b64url(pub_numbers.x),
                "y": _b64url(pub_numbers.y),
                "kid": TEST_KID,
                "alg": "ES256",
                "use": "sig",
            }
        ]
    }
    monkeypatch.setattr("app.auth.dependencies._get_jwks", lambda: wrong_jwks)

    token = make_token()

    with pytest.raises(HTTPException) as exc_info:
        _decode_token(token)

    assert exc_info.value.status_code == 401


def test_decode_token_malformed_raises_401() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _decode_token("this.is.notavalidjwt")

    assert exc_info.value.status_code == 401


def test_decode_token_unknown_kid_raises_401(monkeypatch: pytest.MonkeyPatch) -> None:
    # JWKS contains no key with the kid that the token carries.
    # Patch both _get_jwks (TTL path) and _fetch_jwks (forced-refresh path in _get_signing_key).
    monkeypatch.setattr("app.auth.dependencies._get_jwks", lambda: {"keys": []})
    monkeypatch.setattr("app.auth.dependencies._fetch_jwks", lambda: {"keys": []})

    token = make_token()

    with pytest.raises(HTTPException) as exc_info:
        _decode_token(token)

    assert exc_info.value.status_code == 401


def test_decode_token_wrong_audience_raises_401() -> None:
    # Token signed with the correct key but carrying the wrong audience claim.
    key = generate_private_key(SECP256R1(), default_backend())
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    payload: dict[str, object] = {
        "aud": "service_role",
        "sub": str(uuid.uuid4()),
        "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
        "app_metadata": {"role": "dispatcher"},
    }
    token = jose_jwt.encode(payload, private_pem, algorithm="ES256", headers={"kid": TEST_KID})

    with pytest.raises(HTTPException) as exc_info:
        _decode_token(token)

    assert exc_info.value.status_code == 401


# ── _require_dispatcher_role ──────────────────────────────────────────────────


def test_require_dispatcher_role_passes_for_dispatcher() -> None:
    payload = {"app_metadata": {"role": "dispatcher"}}
    role = _require_dispatcher_role(payload)
    assert role == DispatcherRole.DISPATCHER


def test_require_dispatcher_role_passes_for_admin_dispatcher() -> None:
    payload = {"app_metadata": {"role": "admin_dispatcher"}}
    role = _require_dispatcher_role(payload)
    assert role == DispatcherRole.ADMIN_DISPATCHER


def test_require_dispatcher_role_raises_403_for_driver() -> None:
    payload = {"app_metadata": {"role": "driver"}}

    with pytest.raises(HTTPException) as exc_info:
        _require_dispatcher_role(payload)

    assert exc_info.value.status_code == 403


def test_require_dispatcher_role_raises_403_for_client_viewer() -> None:
    payload = {"app_metadata": {"role": "client_viewer"}}

    with pytest.raises(HTTPException) as exc_info:
        _require_dispatcher_role(payload)

    assert exc_info.value.status_code == 403


def test_require_dispatcher_role_raises_403_when_metadata_missing() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _require_dispatcher_role({})

    assert exc_info.value.status_code == 403


def test_require_dispatcher_role_raises_403_when_role_missing() -> None:
    payload: dict[str, object] = {"app_metadata": {}}

    with pytest.raises(HTTPException) as exc_info:
        _require_dispatcher_role(payload)

    assert exc_info.value.status_code == 403


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


# ── require_admin_dispatcher ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_require_admin_dispatcher_passes_for_admin() -> None:
    user = _make_user(DispatcherRole.ADMIN_DISPATCHER)
    result = await require_admin_dispatcher(current_user=user)
    assert result is user


@pytest.mark.asyncio
async def test_require_admin_dispatcher_raises_403_for_dispatcher() -> None:
    user = _make_user(DispatcherRole.DISPATCHER)

    with pytest.raises(HTTPException) as exc_info:
        await require_admin_dispatcher(current_user=user)

    assert exc_info.value.status_code == 403


# ── get_current_driver ──────────────────────────────────────────────────────────


class _DriverRowLike(Protocol):
    """Attribute shape get_current_driver reads off a Driver ORM row."""

    id: uuid.UUID
    organization_id: uuid.UUID
    full_name: str
    id_number: str
    phone_number: str
    license_number: str
    license_expiry: date | None
    idvs_status: str
    idvs_last_verified_at: datetime | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


def _make_driver_row(*, is_active: bool = True) -> _DriverRowLike:
    """Return a stand-in for a Driver ORM row — only the attributes get_current_driver reads."""
    active = is_active  # avoid self-shadowing the class attribute of the same name below

    class _FakeDriver:
        id = uuid.uuid4()
        organization_id = uuid.uuid4()
        full_name = "Test Driver"
        id_number = "8001015009087"
        phone_number = "+27821234567"
        license_number = "DRV-001"
        license_expiry: date | None = None
        idvs_status = "pending"
        idvs_last_verified_at: datetime | None = None
        is_active = active
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
