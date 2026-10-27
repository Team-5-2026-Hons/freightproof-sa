"""Road distance of each leg on the Cost tab (FP-294, spec D5 and §7.6).

A leg is one stop to the next. Its distance is the truck road route from OpenRouteService
(integrations/routing.py, HGV profile), looked up once per (from precinct, to precinct)
and cached in Redis, since the road between two fixed depots doesn't change between page
loads. When a route can't be looked up (no ORS_API_KEY, the provider failing, or this
request's lookup budget spent) the leg falls back to the straight line × road factor, and
says so, so the screen can tell a measured distance from an estimated one.

Fallbacks are never cached: the leg is retried on a later load, once a key exists or ORS
has recovered. Redis failures fail open, as orchestration/trips/route.py's cache does.

POPIA: only precinct coordinates (business locations) are sent to ORS, never a truck's or
a driver's position, the rule integrations/routing.py states.

Layering: orchestration -> analytics, integrations, core.
"""

import asyncio
import logging
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from redis.exceptions import RedisError

from app.analytics.cost_model import METRES_PER_KM, LegDistance, route_km
from app.core.config import settings
from app.core.rate_limit import get_redis
from app.integrations.routing import RoutePoint, RoutingError, RoutingNotConfiguredError, compute_truck_route

logger = logging.getLogger(__name__)

_CACHE_KEY_PREFIX = "lane_km:v1"

CACHE_TTL_SECONDS = 30 * 24 * 60 * 60

ROUTE_LOOKUPS_PER_REQUEST = 10

ROUTE_LOOKUP_CONCURRENCY = 3


@dataclass(frozen=True)
class LegEnds:
    """One leg's two precincts, with their coordinates, in travel order."""

    from_id: uuid.UUID
    from_lat: Decimal
    from_lng: Decimal
    to_id: uuid.UUID
    to_lat: Decimal
    to_lng: Decimal

    @property
    def key(self) -> tuple[uuid.UUID, uuid.UUID]:
        return (self.from_id, self.to_id)

    @property
    def cache_key(self) -> str:
        return (
            f"{_CACHE_KEY_PREFIX}:{self.from_id}:{self.to_id}:"
            f"{self.from_lat},{self.from_lng}:{self.to_lat},{self.to_lng}"
        )


def _estimated(leg: LegEnds, road_factor: Decimal) -> LegDistance:
    km = route_km([(leg.from_lat, leg.from_lng), (leg.to_lat, leg.to_lng)], road_factor)
    return LegDistance(km=km, routed=False)


async def _cached_metres(legs: list[LegEnds]) -> list[str | None]:
    """One round trip for every leg. A Redis failure reads as all misses."""
    try:
        raw = await get_redis().mget([leg.cache_key for leg in legs])
    except RedisError as exc:
        logger.warning("Lane distance cache read failed: %r", exc)
        return [None] * len(legs)
    return [None if value is None else (value.decode() if isinstance(value, bytes) else str(value)) for value in raw]


def _parse_metres(cached: str | None) -> Decimal | None:
    """A cached distance, or None for a miss. An unreadable or negative value is treated as
    a miss and looked up again, rather than crashing the page or costing a negative trip."""
    if cached is None:
        return None
    try:
        metres = Decimal(cached)
    except InvalidOperation:
        logger.warning("Discarding unreadable cached lane distance %r", cached)
        return None
    return metres if metres.is_finite() and metres >= 0 else None


async def _remember(leg: LegEnds, metres: float) -> None:
    try:
        await get_redis().set(leg.cache_key, repr(metres), ex=CACHE_TTL_SECONDS)
    except RedisError as exc:
        logger.warning("Lane distance cache write failed for %s: %r", leg.key, exc)


async def _route(leg: LegEnds, road_factor: Decimal, gate: asyncio.Semaphore) -> LegDistance:
    """The leg's truck road distance from ORS, or the fallback if ORS can't give one."""
    points = [RoutePoint(float(leg.from_lat), float(leg.from_lng)), RoutePoint(float(leg.to_lat), float(leg.to_lng))]
    async with gate:
        try:
            route = await compute_truck_route(points)
        except RoutingNotConfiguredError:
            return _estimated(leg, road_factor)
        except RoutingError as exc:
            logger.warning("Road distance lookup failed for %s; using the straight-line estimate: %r", leg.key, exc)
            return _estimated(leg, road_factor)
    await _remember(leg, route.distance_metres)
    return LegDistance(km=Decimal(repr(route.distance_metres)) / METRES_PER_KM, routed=True)


async def leg_distances(
    legs: Collection[LegEnds], *, road_factor: Decimal,
) -> dict[tuple[uuid.UUID, uuid.UUID], LegDistance]:
    """The distance of every leg, keyed (from precinct, to precinct)."""
    distances: dict[tuple[uuid.UUID, uuid.UUID], LegDistance] = {}
    to_look_up: list[LegEnds] = []
    for leg in legs:
        if leg.from_id == leg.to_id:
            distances[leg.key] = LegDistance(km=Decimal(0), routed=True)
        else:
            to_look_up.append(leg)
    if not to_look_up:
        return distances

    to_look_up.sort(key=lambda leg: leg.cache_key)
    misses: list[LegEnds] = []
    for leg, cached in zip(to_look_up, await _cached_metres(to_look_up)):
        metres = _parse_metres(cached)
        if metres is None:
            misses.append(leg)
        else:
            distances[leg.key] = LegDistance(km=metres / METRES_PER_KM, routed=True)

    if not settings.ORS_API_KEY:
        if misses:
            logger.info("ORS_API_KEY is not set; %d legs use the straight-line estimate.", len(misses))
        routed: list[LegDistance] = []
        budget: list[LegEnds] = []
    else:
        budget = misses[:ROUTE_LOOKUPS_PER_REQUEST]
        gate = asyncio.Semaphore(ROUTE_LOOKUP_CONCURRENCY)
        routed = list(await asyncio.gather(*(_route(leg, road_factor, gate) for leg in budget)))
    for leg, distance in zip(budget, routed):
        distances[leg.key] = distance
    for leg in misses[len(budget):]:
        distances[leg.key] = _estimated(leg, road_factor)
    return distances
