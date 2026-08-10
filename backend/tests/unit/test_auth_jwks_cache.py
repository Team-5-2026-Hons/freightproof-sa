"""Unit tests for JWKS TTL cache and key-rotation refresh."""
import time
import pytest
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
    monkeypatch.setattr(deps, "_jwks_fetched_at", time.monotonic())

    key = deps._get_signing_key("new-key")
    assert key["kid"] == "new-key"
    assert fetch_count == 1, "Should refresh once on unknown kid"
