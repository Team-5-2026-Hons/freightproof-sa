"""The assistant's share of the one monthly AI budget (spec D7): the shared global counter, its own
per-organisation counter, and failing closed when Redis can't be read."""

import uuid
from datetime import UTC, datetime

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.config import settings
from app.orchestration.analytics_chat import budget
from app.orchestration.assistant import spend

# 10:00 SAST, 21 Oct 2026.
_NOW = datetime(2026, 10, 21, 8, 0, tzinfo=UTC)


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


def _patched(monkeypatch: pytest.MonkeyPatch, fake: _FakeRedis) -> _FakeRedis:
    # Both modules look the client up themselves: spend.py for its own counter, budget.py for the check.
    monkeypatch.setattr(spend, "get_redis", lambda: fake)
    monkeypatch.setattr(budget, "get_redis", lambda: fake)
    monkeypatch.setattr(settings, "AI_CHAT_MONTHLY_BUDGET_USD", 20.0)
    return fake


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    return _patched(monkeypatch, _FakeRedis())


@pytest.fixture
def down_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    return _patched(monkeypatch, _FakeRedis(fail=True))


async def test_record_adds_to_the_shared_counter_and_its_own_not_the_analytics_one(fake_redis: _FakeRedis) -> None:
    org = uuid.uuid4()

    await spend.record(org, 12_000, now=_NOW)

    assert fake_redis.values[budget.global_key(_NOW)] == 12_000
    assert fake_redis.values[spend.assistant_key(org, _NOW)] == 12_000
    assert budget.org_key(org, _NOW) not in fake_redis.values
    assert fake_redis.ttls[spend.assistant_key(org, _NOW)] == budget.SPEND_KEY_TTL_SECONDS


async def test_analytics_spend_counts_against_the_assistant(fake_redis: _FakeRedis) -> None:
    await budget.record(uuid.uuid4(), 20_000_000, now=_NOW)

    with pytest.raises(budget.BudgetSpentError):
        await spend.ensure_available(now=_NOW)


async def test_ensure_available_under_the_budget_passes(fake_redis: _FakeRedis) -> None:
    fake_redis.values[budget.global_key(_NOW)] = 19_999_999

    await spend.ensure_available(now=_NOW)


async def test_ensure_available_fails_closed_when_redis_is_down(down_redis: _FakeRedis) -> None:
    with pytest.raises(budget.BudgetSpentError):
        await spend.ensure_available(now=_NOW)


async def test_record_with_redis_down_logs_and_does_not_raise(
    down_redis: _FakeRedis, caplog: pytest.LogCaptureFixture,
) -> None:
    await spend.record(uuid.uuid4(), 1_000, now=_NOW)

    assert "Assistant spend NOT recorded" in caplog.text


async def test_status_reports_own_spend_and_both_chats(fake_redis: _FakeRedis) -> None:
    org = uuid.uuid4()
    await spend.record(org, 400_000, now=_NOW)
    await budget.record(org, 2_700_000, now=_NOW)

    status = await spend.status(org, now=_NOW)

    assert status is not None
    assert (status.spent_usd, status.all_chats_spent_usd, status.budget_usd, status.available) == (0.4, 3.1, 20.0, True)


async def test_status_with_redis_down_is_none(down_redis: _FakeRedis) -> None:
    assert await spend.status(uuid.uuid4(), now=_NOW) is None


def test_assistant_key_uses_the_sast_month() -> None:
    late = datetime(2026, 10, 31, 23, 30, tzinfo=UTC)

    assert spend.assistant_key(uuid.UUID(int=1), late).endswith(":2026-11")
