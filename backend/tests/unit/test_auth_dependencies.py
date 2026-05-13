"""Unit tests for auth/dependencies.py — pure logic, no DB, no HTTP.

Tests cover _decode_token and _require_dispatcher_role directly so that
every rejection path is verified independently of the database layer.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.auth.dependencies import _decode_token, _require_dispatcher_role
from app.core.config import settings
from tests.conftest import TEST_JWT_SECRET, make_token


@pytest.fixture(autouse=True)
def patch_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", TEST_JWT_SECRET)


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


def test_decode_token_wrong_secret_raises_401(monkeypatch: pytest.MonkeyPatch) -> None:
    # Token signed with one secret, settings using another.
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", "a-completely-different-secret-value-here")
    token = make_token()

    with pytest.raises(HTTPException) as exc_info:
        _decode_token(token)

    assert exc_info.value.status_code == 401


def test_decode_token_malformed_raises_401() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _decode_token("this.is.notavalidjwt")

    assert exc_info.value.status_code == 401


def test_decode_token_wrong_audience_raises_401() -> None:
    # Manually craft a token with a different audience.
    from datetime import datetime, timedelta, timezone
    from jose import jwt as jose_jwt

    payload = {
        "aud": "service_role",
        "sub": str(uuid.uuid4()),
        "exp": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()),
        "app_metadata": {"role": "dispatcher"},
    }
    token = jose_jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")

    with pytest.raises(HTTPException) as exc_info:
        _decode_token(token)

    assert exc_info.value.status_code == 401


# ── _require_dispatcher_role ──────────────────────────────────────────────────


def test_require_dispatcher_role_passes_for_dispatcher() -> None:
    payload = {"app_metadata": {"role": "dispatcher"}}
    # Should not raise.
    _require_dispatcher_role(payload)


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
    payload = {"app_metadata": {}}

    with pytest.raises(HTTPException) as exc_info:
        _require_dispatcher_role(payload)

    assert exc_info.value.status_code == 403
