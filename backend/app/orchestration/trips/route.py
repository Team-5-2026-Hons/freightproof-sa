"""The planned truck route for one of a driver's own trips — backs
GET /trips/me/{trip_id}/route.

Cached in Redis, not stored in Postgres: the route is a display aid for the
driver's map and ETA, not evidence. Nothing here is hashed or anchored, and a
trip's stops cannot change after creation, so a cached route cannot go stale.

Every failure (no key, provider down, Redis down, fewer than two stops)
resolves to None, so the PWA falls back to the trip's planned arrival time
rather than showing an error on the driving screen.
"""

import logging
import uuid
from datetime import UTC, datetime

from pydantic import ValidationError
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.core.rate_limit import get_redis
from app.db.models.organisations import Precinct
from app.db.models.trips import Trip, TripStop
from app.integrations.routing import (
    PlannedRoute, RoutePoint, RoutingError, RoutingNotConfiguredError, compute_truck_route,
)
from app.schemas.trip_routes import TripRouteLegResponse, TripRouteResponse

logger = logging.getLogger(__name__)

# Versioned so a change to TripRouteResponse's shape can't serve old JSON that no longer validates.
_CACHE_KEY_PREFIX = "trip_route:v1"


def _cache_key(trip_id: uuid.UUID) -> str:
    return f"{_CACHE_KEY_PREFIX}:{trip_id}"


async def _read_cached(trip_id: uuid.UUID) -> TripRouteResponse | None:
    try:
        raw = await get_redis().get(_cache_key(trip_id))
    except RedisError as exc:
        # Fails open, like the rate limiter on the same client: a cold cache only costs one ORS call.
        logger.warning("Trip route cache read failed for %s: %r", trip_id, exc)
        return None
    if raw is None:
        return None
    try:
        return TripRouteResponse.model_validate_json(raw)
    except ValidationError as exc:
        logger.warning("Discarding unreadable cached route for %s: %r", trip_id, exc)
        return None


async def _write_cached(route: TripRouteResponse) -> None:
    try:
        await get_redis().set(
            _cache_key(route.trip_id),
            route.model_dump_json(),
            ex=settings.TRIP_ROUTE_CACHE_TTL_SECONDS,
        )
    except RedisError as exc:
        logger.warning("Trip route cache write failed for %s: %r", route.trip_id, exc)


def _to_response(trip_id: uuid.UUID, sequences: list[int], route: PlannedRoute) -> TripRouteResponse:
    return TripRouteResponse(
        trip_id=trip_id,
        distance_metres=route.distance_metres,
        duration_seconds=route.duration_seconds,
        legs=[
            TripRouteLegResponse(
                from_stop_sequence=sequences[index],
                to_stop_sequence=sequences[index + 1],
                distance_metres=leg.distance_metres,
                duration_seconds=leg.duration_seconds,
                coordinates=list(leg.coordinates),
            )
            for index, leg in enumerate(route.legs)
        ],
        computed_at=datetime.now(UTC),
    )


async def get_trip_route_for_driver(
    db: AsyncSession, *, driver_id: uuid.UUID, trip_id: uuid.UUID
) -> TripRouteResponse | None:
    """The planned route through the trip's stops, or None when one can't be had.

    Raises ResourceNotFoundError for a missing trip OR another driver's trip —
    indistinguishable on purpose, same rule as get_own_trip_detail_for_driver.
    """
    trip_exists = (
        await db.execute(select(Trip.id).where(Trip.id == trip_id, Trip.driver_id == driver_id))
    ).scalar_one_or_none()
    if trip_exists is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    cached = await _read_cached(trip_id)
    if cached is not None:
        return cached

    stops = (
        await db.execute(
            select(TripStop.sequence, Precinct.latitude, Precinct.longitude)
            .join(Precinct, Precinct.id == TripStop.precinct_id)
            .where(TripStop.trip_id == trip_id)
            .order_by(TripStop.sequence)
        )
    ).all()
    if len(stops) < 2:
        logger.info("Trip %s has %d stop(s); no route to plan.", trip_id, len(stops))
        return None

    points = [RoutePoint(lat=float(stop.latitude), lng=float(stop.longitude)) for stop in stops]
    try:
        planned = await compute_truck_route(points)
    except RoutingNotConfiguredError:
        logger.info("ORS_API_KEY not set; trip %s gets no planned route.", trip_id)
        return None
    except RoutingError as exc:
        # Not cached: the next screen open retries, so a provider blip isn't sticky.
        logger.warning("Could not plan a route for trip %s: %s", trip_id, exc)
        return None

    response = _to_response(trip_id, [stop.sequence for stop in stops], planned)
    await _write_cached(response)
    return response
