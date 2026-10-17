"""Unit tests for the Cost tab's leg distances (app/orchestration/analytics/lane_distance.py).

No network and no Redis: ORS (compute_truck_route) and the Redis client are replaced where
lane_distance looks them up, so these tests never call the real routing service.
"""

import uuid
from collections.abc import Sequence
from decimal import Decimal
from typing import Any

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.analytics.cost_model import route_km
from app.integrations.routing import PlannedRoute, RouteLeg, RoutePoint, RoutingError, RoutingNotConfiguredError
from app.orchestration.analytics import lane_distance
from app.orchestration.analytics.lane_distance import (
    CACHE_TTL_SECONDS,
    ROUTE_LOOKUPS_PER_REQUEST,
    LegEnds,
    leg_distances,
)

_FACTOR = Decimal("1.15")
_ROAD_METRES = 568_000.0


class _FakeRedis:
    def __init__(self, *, fail: bool = False) -> None:
        self.store: dict[str, bytes] = {}
        self.ttls: dict[str, int] = {}
        self.fail = fail

    async def mget(self, keys: Sequence[str]) -> list[bytes | None]:
        if self.fail:
            raise RedisConnectionError("redis down")
        return [self.store.get(key) for key in keys]

    async def set(self, key: str, value: str, ex: int) -> None:
        if self.fail:
            raise RedisConnectionError("redis down")
        self.store[key] = value.encode()
        self.ttls[key] = ex


class _FakeOrs:
    """Answers every route with _ROAD_METRES, or raises `error` if given."""

    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[list[RoutePoint]] = []
        self.error = error

    async def __call__(self, points: Sequence[RoutePoint]) -> PlannedRoute:
        self.calls.append(list(points))
        if self.error is not None:
            raise self.error
        return PlannedRoute(legs=(RouteLeg(distance_metres=_ROAD_METRES, duration_seconds=1.0, coordinates=()),))


@pytest.fixture
def redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis()
    monkeypatch.setattr(lane_distance, "get_redis", lambda: fake)
    return fake


@pytest.fixture
def ors(monkeypatch: pytest.MonkeyPatch) -> _FakeOrs:
    fake = _FakeOrs()
    monkeypatch.setattr(lane_distance, "compute_truck_route", fake)
    monkeypatch.setattr(lane_distance.settings, "ORS_API_KEY", "test-key")
    return fake


def _leg(lat_from: str = "-26.2041", lat_to: str = "-29.8587") -> LegEnds:
    return LegEnds(
        from_id=uuid.uuid4(), from_lat=Decimal(lat_from), from_lng=Decimal("28.0473"),
        to_id=uuid.uuid4(), to_lat=Decimal(lat_to), to_lng=Decimal("31.0218"),
    )


def _straight(leg: LegEnds) -> Decimal:
    return route_km([(leg.from_lat, leg.from_lng), (leg.to_lat, leg.to_lng)], _FACTOR)


async def test_cache_miss_routes_by_road_and_caches(redis: _FakeRedis, ors: _FakeOrs) -> None:
    leg = _leg()

    result = await leg_distances([leg], road_factor=_FACTOR)

    assert result[leg.key].routed is True
    assert result[leg.key].km == Decimal("568")
    assert len(ors.calls) == 1
    assert ors.calls[0] == [RoutePoint(-26.2041, 28.0473), RoutePoint(-29.8587, 31.0218)]
    assert redis.store[leg.cache_key] == repr(_ROAD_METRES).encode()
    assert redis.ttls[leg.cache_key] == CACHE_TTL_SECONDS


async def test_cache_hit_does_not_call_ors(redis: _FakeRedis, ors: _FakeOrs) -> None:
    leg = _leg()
    redis.store[leg.cache_key] = b"570000.0"

    result = await leg_distances([leg], road_factor=_FACTOR)

    assert result[leg.key].km == Decimal("570")
    assert result[leg.key].routed is True
    assert ors.calls == []


async def test_no_api_key_uses_estimate_and_caches_nothing(
    redis: _FakeRedis, monkeypatch: pytest.MonkeyPatch,
) -> None:
    ors = _FakeOrs()
    monkeypatch.setattr(lane_distance, "compute_truck_route", ors)
    monkeypatch.setattr(lane_distance.settings, "ORS_API_KEY", "")
    leg = _leg()

    result = await leg_distances([leg], road_factor=_FACTOR)

    assert result[leg.key].routed is False
    assert result[leg.key].km == _straight(leg)
    assert ors.calls == []
    assert redis.store == {}


@pytest.mark.parametrize("error", [RoutingError("ORS 503"), RoutingNotConfiguredError("no key")])
async def test_routing_failure_uses_estimate_and_caches_nothing(
    redis: _FakeRedis, ors: _FakeOrs, error: Exception,
) -> None:
    ors.error = error
    leg = _leg()

    result = await leg_distances([leg], road_factor=_FACTOR)

    assert result[leg.key].routed is False
    assert result[leg.key].km == _straight(leg)
    assert redis.store == {}


async def test_redis_down_still_routes(monkeypatch: pytest.MonkeyPatch, ors: _FakeOrs) -> None:
    monkeypatch.setattr(lane_distance, "get_redis", lambda: _FakeRedis(fail=True))
    leg = _leg()

    result = await leg_distances([leg], road_factor=_FACTOR)

    assert result[leg.key].routed is True
    assert len(ors.calls) == 1


async def test_only_budgeted_lookups_call_ors(redis: _FakeRedis, ors: _FakeOrs) -> None:
    legs = [_leg() for _ in range(ROUTE_LOOKUPS_PER_REQUEST + 3)]

    result = await leg_distances(legs, road_factor=_FACTOR)

    assert len(ors.calls) == ROUTE_LOOKUPS_PER_REQUEST
    assert sum(1 for d in result.values() if d.routed) == ROUTE_LOOKUPS_PER_REQUEST
    assert sum(1 for d in result.values() if not d.routed) == 3


async def test_moved_precinct_gets_a_new_cache_key() -> None:
    leg = _leg()
    moved = LegEnds(leg.from_id, Decimal("-26.3000"), leg.from_lng, leg.to_id, leg.to_lat, leg.to_lng)

    assert moved.cache_key != leg.cache_key


async def test_each_direction_is_cached_separately(redis: _FakeRedis, ors: _FakeOrs) -> None:
    leg = _leg()
    back = LegEnds(leg.to_id, leg.to_lat, leg.to_lng, leg.from_id, leg.from_lat, leg.from_lng)

    result = await leg_distances([leg, back], road_factor=_FACTOR)

    assert set(result) == {leg.key, back.key}
    assert len(ors.calls) == 2
    assert len(redis.store) == 2


async def test_same_precinct_twice_is_zero_without_lookup(redis: _FakeRedis, ors: _FakeOrs) -> None:
    precinct = uuid.uuid4()
    leg = LegEnds(precinct, Decimal(1), Decimal(1), precinct, Decimal(1), Decimal(1))

    result = await leg_distances([leg], road_factor=_FACTOR)

    assert result[leg.key].km == Decimal(0)
    assert ors.calls == []


@pytest.mark.parametrize("cached", [b"not-a-number", b"-5", b"NaN"])
async def test_unreadable_cached_value_is_looked_up_again(redis: _FakeRedis, ors: _FakeOrs, cached: bytes) -> None:
    leg = _leg()
    redis.store[leg.cache_key] = cached

    result = await leg_distances([leg], road_factor=_FACTOR)

    assert result[leg.key].km == Decimal("568")
    assert len(ors.calls) == 1


async def test_no_legs_needs_no_redis_or_ors(monkeypatch: pytest.MonkeyPatch) -> None:
    def _no_redis() -> Any:
        raise AssertionError("Redis should not be touched")

    monkeypatch.setattr(lane_distance, "get_redis", _no_redis)

    assert await leg_distances([], road_factor=_FACTOR) == {}
