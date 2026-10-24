"""Unit tests for JWKS TTL cache and key-rotation refresh."""
import time
import pytest
from fastapi import HTTPException

import app.auth.dependencies as deps


def test_jwks_cache_serves_from_cache_within_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    fetch_count = 0

    def mock_fetch() -> dict:
        nonlocal fetch_count
        fetch_count += 1
        return {"keys": [{"kid": "key1"}]}

    monkeypatch.setattr(deps, "_fetch_jwks", mock_fetch)
    monkeypatch.setattr(deps, "_jwks_cache", None)
    monkeypatch.setattr(deps, "_jwks_fetched_at", 0.0)

    deps._get_jwks()
    deps._get_jwks()
    assert fetch_count == 1, "Cache should serve second call without fetching"


def test_jwks_cache_refetches_after_ttl_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    fetch_count = 0

    def mock_fetch() -> dict:
        nonlocal fetch_count
        fetch_count += 1
        return {"keys": [{"kid": f"key{fetch_count}"}]}

    monkeypatch.setattr(deps, "_fetch_jwks", mock_fetch)
    monkeypatch.setattr(deps, "_jwks_cache", None)
    monkeypatch.setattr(deps, "_jwks_fetched_at", 0.0)

    deps._get_jwks()
    assert fetch_count == 1
    monkeypatch.setattr(deps, "_jwks_fetched_at", time.monotonic() - deps._JWKS_TTL_SECONDS - 1)
    deps._get_jwks()
    assert fetch_count == 2, "Cache should re-fetch after TTL"


def test_get_signing_key_refreshes_on_unknown_kid(monkeypatch: pytest.MonkeyPatch) -> None:
    fetch_count = 0

    def mock_fetch() -> dict:
        nonlocal fetch_count
        fetch_count += 1
        return {"keys": [{"kid": "new-key", "kty": "EC"}]}

    monkeypatch.setattr(deps, "_fetch_jwks", mock_fetch)
    monkeypatch.setattr(deps, "_jwks_cache", {"keys": [{"kid": "old-key"}]})
    monkeypatch.setattr(deps, "_jwks_fetched_at", time.monotonic() - deps._JWKS_MIN_REFRESH_SECONDS - 1)

    key = deps._get_signing_key("new-key")
    assert key["kid"] == "new-key"
    assert fetch_count == 1, "Should refresh once on unknown kid"


def test_get_signing_key_unknown_kids_refresh_once_per_cooldown(monkeypatch: pytest.MonkeyPatch) -> None:
    fetch_count = 0

    def mock_fetch() -> dict:
        nonlocal fetch_count
        fetch_count += 1
        return {"keys": [{"kid": "real-key"}]}

    monkeypatch.setattr(deps, "_fetch_jwks", mock_fetch)
    monkeypatch.setattr(deps, "_jwks_cache", {"keys": [{"kid": "real-key"}]})
    monkeypatch.setattr(deps, "_jwks_fetched_at", time.monotonic() - deps._JWKS_MIN_REFRESH_SECONDS - 1)

    for forged_kid in ("forged-1", "forged-2", "forged-3"):
        with pytest.raises(HTTPException) as exc_info:
            deps._get_signing_key(forged_kid)
        assert exc_info.value.status_code == 401

    assert fetch_count == 1, "Forged kids inside the cooldown must not each trigger a fetch"


def test_get_signing_key_skips_refresh_when_cache_is_fresh(monkeypatch: pytest.MonkeyPatch) -> None:
    fetch_count = 0

    def mock_fetch() -> dict:
        nonlocal fetch_count
        fetch_count += 1
        return {"keys": []}

    monkeypatch.setattr(deps, "_fetch_jwks", mock_fetch)
    monkeypatch.setattr(deps, "_jwks_cache", {"keys": [{"kid": "real-key"}]})
    monkeypatch.setattr(deps, "_jwks_fetched_at", time.monotonic())

    with pytest.raises(HTTPException):
        deps._get_signing_key("unknown-kid")

    assert fetch_count == 0
