"""Truck driving time and distance between two depots, from the route planner, cached (spec §5.1 row 7).

The road between two fixed depots doesn't change between questions, so each (from, to) pair is
looked up once with OpenRouteService's truck profile (`integrations.routing.compute_truck_route`)
and kept in Redis for TRIP_ROUTE_CACHE_TTL_SECONDS, like `analytics.lane_distance` does for the
Cost tab. A failure is never cached, so the next question tries again once ORS is back.

Redis failures fail open (look it up again), as the other route caches do. A routing failure comes
back as a plain reason the dispatcher can be told, never an exception.

POPIA: only depot coordinates (business locations) are sent to ORS, never a truck's or driver's position.
"""

import logging
import uuid
from dataclasses import dataclass

from redis.exceptions import RedisError

from app.core.config import settings
from app.core.rate_limit import get_redis
from app.integrations.routing import RoutePoint, RoutingError, RoutingNotConfiguredError, compute_truck_route

logger = logging.getLogger(__name__)

KEY_PREFIX = "assistant_route:v1"
SECONDS_PER_MINUTE = 60
NOT_SET_UP = "The route planner isn't set up on this server, so there's no driving time."
NO_ANSWER = "The route planner didn't answer just now, so there's no driving time."


@dataclass(frozen=True)
class Depot:
    id: uuid.UUID
    lat: float
    lng: float


@dataclass(frozen=True)
class Driving:
    minutes: int
    metres: int


def _key(origin: Depot, destination: Depot) -> str:
    return f"{KEY_PREFIX}:{origin.id}:{destination.id}"


def _parse(raw: object) -> Driving | None:
    """"minutes:metres" as stored; anything unreadable is a miss and is looked up again."""
    text = raw.decode() if isinstance(raw, bytes) else raw
    if not isinstance(text, str):
        return None
    minutes, _, metres = text.partition(":")
    if not (minutes.isdigit() and metres.isdigit()):
        logger.warning("Discarding unreadable cached assistant route %r", text)
        return None
    return Driving(minutes=int(minutes), metres=int(metres))


async def _cached(key: str) -> Driving | None:
    try:
        return _parse(await get_redis().get(key))
    except RedisError as exc:
        logger.warning("Assistant route cache read failed: %r", exc)
        return None


async def _remember(key: str, driving: Driving) -> None:
    try:
        await get_redis().set(key, f"{driving.minutes}:{driving.metres}", ex=settings.TRIP_ROUTE_CACHE_TTL_SECONDS)
    except RedisError as exc:
        logger.warning("Assistant route cache write failed: %r", exc)


async def driving_between(origin: Depot, destination: Depot) -> Driving | str:
    """The truck driving time and distance, or the reason there is none."""
    key = _key(origin, destination)
    cached = await _cached(key)
    if cached is not None:
        return cached
    try:
        route = await compute_truck_route([RoutePoint(origin.lat, origin.lng), RoutePoint(destination.lat, destination.lng)])
    except RoutingNotConfiguredError:
        return NOT_SET_UP
    except RoutingError as exc:
        logger.warning("Assistant route lookup failed for %s → %s: %r", origin.id, destination.id, exc)
        return NO_ANSWER
    driving = Driving(minutes=round(route.duration_seconds / SECONDS_PER_MINUTE), metres=round(route.distance_metres))
    await _remember(key, driving)
    return driving
