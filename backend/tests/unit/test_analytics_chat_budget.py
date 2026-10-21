"""The Analytics chat's monthly spend cap: counted per SAST month, fails closed on Redis errors.

Redis is replaced the way test_lane_distance.py does it: get_redis patched where budget.py
looks it up.
"""

import uuid
from datetime import UTC, datetime

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.orchestration.analytics_chat import budget
from app.orchestration.analytics_chat.budget import (
    SPEND_KEY_TTL_SECONDS,
    BudgetSpentError,
    ensure_available,
    global_key,
    org_key,
    record,
    status,
)

# 10:00 SAST, 19 Oct 2026.
_NOW = datetime(2026, 10, 19, 8, 0, tzinfo=UTC)


class _FakePipeline:
    def __init__(self, store: "_FakeRedis") -> None:
        self._store = store
        self._ops: list[tuple[str, str, int]] = []

    def incrby(self, key: str, amount: int) -> None:
        self._ops.append(("incrby", key, amount))

    def expire(self, key: str, seconds: int) -> None:
        self._ops.append(("expire", key, seconds))

    async def execute(self) -> None:
        if self._store.fail:
            raise RedisConnectionError("down")
        for op, key, value in self._ops:
            if op == "incrby":
                self._store.values[key] = self._store.values.get(key, 0) + value
            else:
                self._store.ttls[key] = value


class _FakeRedis:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.values: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    async def get(self, key: str) -> bytes | None:
        if self.fail:
            raise RedisConnectionError("down")
        value = self.values.get(key)
        return None if value is None else str(value).encode()

    async def mget(self, keys: list[str]) -> list[bytes | None]:
        return [await self.get(key) for key in keys]

    def pipeline(self, transaction: bool = True) -> _FakePipeline:
        return _FakePipeline(self)


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis()
    monkeypatch.setattr(budget, "get_redis", lambda: fake)
    return fake


@pytest.fixture
def down_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis(fail=True)
    monkeypatch.setattr(budget, "get_redis", lambda: fake)
    return fake


async def test_record_adds_to_the_global_and_org_counters(fake_redis: _FakeRedis) -> None:
    org = uuid.uuid4()

    await record(org, 23_500, now=_NOW)
    await record(org, 500, now=_NOW)

    assert fake_redis.values[global_key(_NOW)] == 24_000
    assert fake_redis.values[org_key(org, _NOW)] == 24_000
    assert fake_redis.ttls[global_key(_NOW)] == SPEND_KEY_TTL_SECONDS


async def test_two_orgs_share_the_global_counter_only(fake_redis: _FakeRedis) -> None:
    first, second = uuid.uuid4(), uuid.uuid4()

    await record(first, 1_000, now=_NOW)
    await record(second, 2_000, now=_NOW)

    assert fake_redis.values[global_key(_NOW)] == 3_000
    assert fake_redis.values[org_key(first, _NOW)] == 1_000
    assert fake_redis.values[org_key(second, _NOW)] == 2_000


async def test_ensure_available_under_the_budget_passes(fake_redis: _FakeRedis) -> None:
    fake_redis.values[global_key(_NOW)] = 19_999_999

    await ensure_available(budget_usd=20.0, now=_NOW)


async def test_ensure_available_at_the_budget_raises(fake_redis: _FakeRedis) -> None:
    fake_redis.values[global_key(_NOW)] = 20_000_000

    with pytest.raises(BudgetSpentError, match="used up"):
        await ensure_available(budget_usd=20.0, now=_NOW)


async def test_ensure_available_with_redis_down_fails_closed(down_redis: _FakeRedis) -> None:
    with pytest.raises(BudgetSpentError, match="can't be checked"):
        await ensure_available(budget_usd=20.0, now=_NOW)


async def test_record_with_redis_down_logs_and_does_not_raise(
    down_redis: _FakeRedis, caplog: pytest.LogCaptureFixture,
) -> None:
    await record(uuid.uuid4(), 1_000, now=_NOW)

    assert "NOT recorded" in caplog.text


def test_month_keys_use_south_african_time() -> None:
    # 23:30 UTC on 31 Oct is 01:30 SAST on 1 Nov: November's counter.
    late = datetime(2026, 10, 31, 23, 30, tzinfo=UTC)

    assert global_key(late).endswith(":2026-11")
    assert global_key(_NOW).endswith(":2026-10")


async def test_status_reports_this_orgs_spend_and_availability(fake_redis: _FakeRedis) -> None:
    org = uuid.uuid4()
    await record(org, 1_200_000, now=_NOW)
    await record(uuid.uuid4(), 18_800_000, now=_NOW)

    spend = await status(org, budget_usd=20.0, now=_NOW)

    assert spend is not None
    assert (spend.spent_usd, spend.budget_usd, spend.available) == (1.2, 20.0, False)


async def test_status_with_redis_down_is_none(down_redis: _FakeRedis) -> None:
    assert await status(uuid.uuid4(), budget_usd=20.0, now=_NOW) is None
