"""Unit tests for the rate limiter (app/core/rate_limit.py).

Redis is faked rather than run: the behaviour under test is the counting decision and the
failure policy, neither of which needs a real server. The fake implements only the three
commands the limiter uses, which is also a check that it uses no others.
"""

import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core import rate_limit as rate_limit_module
from app.core.limits import RateLimit
from app.core.rate_limit import _client_identity, _count_and_check, _window_key, rate_limit

_LIMIT = RateLimit(max_requests=3, window_seconds=60, name="test_bucket")


class _FakePipeline:
    def __init__(self, store: dict, expiries: dict) -> None:
        self._store = store
        self._expiries = expiries
        self._queued: list = []

    def incr(self, key: str) -> None:
        self._queued.append(("incr", key))

    def ttl(self, key: str) -> None:
        self._queued.append(("ttl", key))

    async def execute(self) -> list:
        results = []
        for command, key in self._queued:
            if command == "incr":
                self._store[key] = self._store.get(key, 0) + 1
                results.append(self._store[key])
            else:
                results.append(self._expiries.get(key, -1))
        self._queued = []
        return results


class _FakeRedis:
    """Only INCR, TTL and EXPIRE — the limiter's whole vocabulary."""

    def __init__(self) -> None:
        self.store: dict[str, int] = {}
        self.expiries: dict[str, int] = {}

    def pipeline(self) -> _FakePipeline:
        return _FakePipeline(self.store, self.expiries)

    async def expire(self, key: str, seconds: int) -> None:
        self.expiries[key] = seconds


class _BrokenRedis:
    """Stands in for a Redis that is down."""

    def pipeline(self) -> "_BrokenRedis":
        return self

    def incr(self, key: str) -> None:
        pass

    def ttl(self, key: str) -> None:
        pass

    async def execute(self) -> list:
        raise RedisConnectionError("redis is unreachable")


@pytest.fixture
def fake_redis(monkeypatch) -> _FakeRedis:
    client = _FakeRedis()
    monkeypatch.setattr(rate_limit_module, "_get_redis", lambda: client)
    return client


def _request(*, ip: str = "203.0.113.10", headers: dict | None = None) -> SimpleNamespace:
    """Enough of a Starlette Request for the limiter — it reads only these three things."""
    return SimpleNamespace(
        headers=headers or {},
        client=SimpleNamespace(host=ip),
        url=SimpleNamespace(path="/api/v1/trips"),
    )


# ── Counting ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_requests_within_the_budget_are_allowed(fake_redis) -> None:
    for _ in range(_LIMIT.max_requests):
        assert await _count_and_check(_LIMIT, "ip:1.2.3.4") is True


@pytest.mark.asyncio
async def test_the_request_past_the_budget_is_refused(fake_redis) -> None:
    for _ in range(_LIMIT.max_requests):
        await _count_and_check(_LIMIT, "ip:1.2.3.4")

    assert await _count_and_check(_LIMIT, "ip:1.2.3.4") is False


@pytest.mark.asyncio
async def test_identities_are_counted_separately(fake_redis) -> None:
    """One caller exhausting their budget must not lock everyone else out."""
    for _ in range(_LIMIT.max_requests + 1):
        await _count_and_check(_LIMIT, "ip:1.2.3.4")

    assert await _count_and_check(_LIMIT, "ip:5.6.7.8") is True


@pytest.mark.asyncio
async def test_the_expiry_is_set_once_per_window_not_per_request(fake_redis) -> None:
    """Re-setting the TTL on every request would push the window forward indefinitely and
    the counter would never roll over — which is exactly the case the limit exists for."""
    await _count_and_check(_LIMIT, "ip:1.2.3.4")
    key = _window_key(_LIMIT, "ip:1.2.3.4")
    assert fake_redis.expiries[key] == _LIMIT.window_seconds

    fake_redis.expiries[key] = 42  # a TTL already ticking down
    await _count_and_check(_LIMIT, "ip:1.2.3.4")

    assert fake_redis.expiries[key] == 42


def test_the_window_key_changes_as_time_passes() -> None:
    now = int(time.time())
    early = _window_key(_LIMIT, "ip:1.2.3.4")
    assert str(now // _LIMIT.window_seconds) in early
    # Different bucket, different key — counters cannot collide across limits.
    other = RateLimit(max_requests=3, window_seconds=60, name="other_bucket")
    assert _window_key(other, "ip:1.2.3.4") != early


# ── Failure policy ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_redis_outage_allows_the_request(monkeypatch) -> None:
    """Documented, deliberate fail-open. Rate limiting is an availability control, and on
    an evidence platform a Redis blip must not stop a driver recording what happened.
    Nothing about authentication or tenancy depends on this module."""
    monkeypatch.setattr(rate_limit_module, "_get_redis", lambda: _BrokenRedis())

    assert await _count_and_check(_LIMIT, "ip:1.2.3.4") is True


# ── Identity resolution ──────────────────────────────────────────────────────


def test_the_forwarded_header_is_ignored_without_a_trusted_proxy(monkeypatch) -> None:
    """The header is caller-supplied. Honouring it unconditionally would let anyone mint a
    fresh identity — and therefore a fresh budget — on every single request."""
    monkeypatch.setattr(rate_limit_module.settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", False)

    identity = _client_identity(
        _request(ip="203.0.113.10", headers={"x-forwarded-for": "1.1.1.1"})
    )

    assert identity == "203.0.113.10"


def test_the_forwarded_header_is_used_behind_a_trusted_proxy(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit_module.settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", True)

    identity = _client_identity(
        _request(ip="10.0.0.1", headers={"x-forwarded-for": "1.1.1.1, 10.0.0.1"})
    )

    assert identity == "1.1.1.1"


# ── The dependency ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_dependency_raises_429_once_the_budget_is_gone(fake_redis, monkeypatch) -> None:
    monkeypatch.setattr(rate_limit_module.settings, "RATE_LIMIT_ENABLED", True)
    dependency = rate_limit(_LIMIT)
    request = _request(headers={"authorization": "Bearer token-abc"})

    for _ in range(_LIMIT.max_requests):
        await dependency(request)

    with pytest.raises(HTTPException) as exc_info:
        await dependency(request)

    assert exc_info.value.status_code == 429
    assert exc_info.value.headers["Retry-After"] == str(_LIMIT.window_seconds)


@pytest.mark.asyncio
async def test_two_tokens_get_two_budgets(fake_redis, monkeypatch) -> None:
    """Counting per account is the control that actually holds — an attacker with a valid
    token defeats an IP limit by moving IP, but cannot change who the token names."""
    monkeypatch.setattr(rate_limit_module.settings, "RATE_LIMIT_ENABLED", True)
    dependency = rate_limit(_LIMIT)

    for _ in range(_LIMIT.max_requests + 1):
        try:
            await dependency(_request(headers={"authorization": "Bearer token-abc"}))
        except HTTPException:
            pass

    await dependency(_request(headers={"authorization": "Bearer token-xyz"}))


@pytest.mark.asyncio
async def test_an_unauthenticated_caller_is_counted_by_ip(fake_redis, monkeypatch) -> None:
    """A flood with no token at all still costs a JWKS check and a DB round-trip per
    request, so it has to be counted."""
    monkeypatch.setattr(rate_limit_module.settings, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit_module.settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", False)
    dependency = rate_limit(_LIMIT)

    for _ in range(_LIMIT.max_requests):
        await dependency(_request(ip="203.0.113.99"))

    with pytest.raises(HTTPException):
        await dependency(_request(ip="203.0.113.99"))


@pytest.mark.asyncio
async def test_the_limiter_is_a_no_op_when_disabled(fake_redis, monkeypatch) -> None:
    monkeypatch.setattr(rate_limit_module.settings, "RATE_LIMIT_ENABLED", False)
    dependency = rate_limit(_LIMIT)
    request = _request(headers={"authorization": "Bearer token-abc"})

    for _ in range(_LIMIT.max_requests * 5):
        await dependency(request)

    assert fake_redis.store == {}
