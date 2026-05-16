"""Unit tests for auth/dependencies.py — pure logic, no DB, no HTTP.

Tests cover _decode_token and _require_dispatcher_role directly so that
every rejection path is verified independently of the database layer.

_decode_token now uses ES256 + JWKS. The _get_jwks function is monkeypatched
to return a test EC public key, avoiding any network calls to Supabase.
"""

import base64
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1, generate_private_key
from fastapi import HTTPException
from jose import jwt as jose_jwt

from app.auth.dependencies import _decode_token, _require_dispatcher_role
from tests.conftest import TEST_KID, make_token, make_jwks


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
    monkeypatch.setattr("app.auth.dependencies._get_jwks", lambda: {"keys": []})

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
    payload: dict[str, object] = {"app_metadata": {}}

    with pytest.raises(HTTPException) as exc_info:
        _require_dispatcher_role(payload)

    assert exc_info.value.status_code == 403
