"""OpenRouteService truck routing — the planned road route between a trip's stops.

OBSERVED LIVE ON 2026-10-14 against POST /v2/directions/driving-hgv/geojson
(engine 9.10.0): the response is a GeoJSON FeatureCollection whose first
feature carries the whole route as a LineString of [lng, lat] pairs, plus
properties.segments (one {distance, duration} per leg, metres/seconds) and
properties.way_points (each stop's index into that coordinate list). A stop
further than the snap radius from a routable road is a 404 with error code
2010, not a partial route. segments are only present while instructions are
on (the default).

Why the HGV profile: it respects truck weight/height limits and truck-restricted
roads, so the duration is a truck's, not a car's.

Layering: integrations -> config only. Raw vendor JSON never leaves this
module; callers get PlannedRoute.

POPIA: callers pass precinct coordinates (business locations). Never pass a
driver or truck position here — that would send personal data off-system.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# --- Vendor contract (see module docstring) ---------------------------------
_ORS_DIRECTIONS_PATH = "/v2/directions/driving-hgv/geojson"
_ORS_FIELD_FEATURES = "features"
_ORS_FIELD_PROPERTIES = "properties"
_ORS_FIELD_GEOMETRY = "geometry"
_ORS_FIELD_COORDINATES = "coordinates"
_ORS_FIELD_SEGMENTS = "segments"
_ORS_FIELD_WAY_POINTS = "way_points"
_ORS_FIELD_DISTANCE = "distance"
_ORS_FIELD_DURATION = "duration"
# -----------------------------------------------------------------------------

_MIN_ROUTE_POINTS = 2


class RoutingError(Exception):
    """The routing provider could not be reached or answered unusably."""


class RoutingNotConfiguredError(RoutingError):
    """No ORS_API_KEY — an expected state on a fresh dev machine, not an outage."""


@dataclass(frozen=True)
class RoutePoint:
    lat: float
    lng: float


@dataclass(frozen=True)
class RouteLeg:
    """One stop-to-stop stretch. Coordinates are (lat, lng), our order, not the vendor's."""

    distance_metres: float
    duration_seconds: float
    coordinates: tuple[tuple[float, float], ...]


@dataclass(frozen=True)
class PlannedRoute:
    legs: tuple[RouteLeg, ...]

    @property
    def distance_metres(self) -> float:
        return sum(leg.distance_metres for leg in self.legs)

    @property
    def duration_seconds(self) -> float:
        return sum(leg.duration_seconds for leg in self.legs)


async def compute_truck_route(points: Sequence[RoutePoint]) -> PlannedRoute:
    """Route a truck through `points` in order. One leg per consecutive pair.

    Raises RoutingNotConfiguredError with no key, RoutingError on any transport,
    HTTP or shape failure. Never returns a partial route.
    """
    if len(points) < _MIN_ROUTE_POINTS:
        raise RoutingError(f"A route needs at least {_MIN_ROUTE_POINTS} points, got {len(points)}.")
    if not settings.ORS_API_KEY:
        raise RoutingNotConfiguredError("ORS_API_KEY is not set.")

    body = {
        # ORS takes [lng, lat]; everything else in this codebase is lat-first.
        _ORS_FIELD_COORDINATES: [[p.lng, p.lat] for p in points],
        "radiuses": [settings.ORS_SNAP_RADIUS_METRES] * len(points),
        # "instructions" is left at its default (on) even though the turn-by-turn steps are
        # ignored: turning it off also drops properties.segments, the per-leg distance and
        # duration this module needs (observed live 2026-10-14).
    }
    url = settings.ORS_API_URL.rstrip("/") + _ORS_DIRECTIONS_PATH

    try:
        async with httpx.AsyncClient(timeout=settings.ORS_TIMEOUT_SECONDS) as http:
            response = await http.post(url, json=body, headers={"Authorization": settings.ORS_API_KEY})
    except httpx.HTTPError as exc:
        raise RoutingError(f"Routing provider unreachable: {exc!r}") from exc

    if response.status_code != httpx.codes.OK:
        # The body names the failing stop on a 404 (code 2010) — worth keeping in the log.
        raise RoutingError(f"Routing provider returned HTTP {response.status_code}: {response.text[:300]}")

    try:
        payload = response.json()
    except ValueError as exc:
        raise RoutingError("Routing provider returned a non-JSON body.") from exc

    return _parse_route(payload, expected_legs=len(points) - 1)


def _parse_route(payload: Any, *, expected_legs: int) -> PlannedRoute:
    """Turn the vendor's FeatureCollection into a PlannedRoute, or raise RoutingError.

    Split by way_points rather than trusting segment count alone: way_points are what
    tie a slice of the line to a specific pair of stops.
    """
    try:
        feature = payload[_ORS_FIELD_FEATURES][0]
        properties = feature[_ORS_FIELD_PROPERTIES]
        raw_coordinates = feature[_ORS_FIELD_GEOMETRY][_ORS_FIELD_COORDINATES]
        segments = properties[_ORS_FIELD_SEGMENTS]
        way_points = properties[_ORS_FIELD_WAY_POINTS]

        if len(segments) != expected_legs or len(way_points) != expected_legs + 1:
            raise RoutingError(
                f"Expected {expected_legs} legs, got {len(segments)} segments "
                f"and {len(way_points)} way points."
            )

        coordinates = [(float(lat), float(lng)) for lng, lat, *_ in raw_coordinates]
        legs: list[RouteLeg] = []
        for index, segment in enumerate(segments):
            start, end = int(way_points[index]), int(way_points[index + 1])
            if not 0 <= start <= end < len(coordinates):
                raise RoutingError(f"Way point indices {start}..{end} fall outside the line.")
            legs.append(
                RouteLeg(
                    distance_metres=float(segment[_ORS_FIELD_DISTANCE]),
                    duration_seconds=float(segment[_ORS_FIELD_DURATION]),
                    # Inclusive end: each leg shares its boundary point with the next.
                    coordinates=tuple(coordinates[start : end + 1]),
                )
            )
    except RoutingError:
        raise
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise RoutingError(f"Routing provider response had an unexpected shape: {exc!r}") from exc

    return PlannedRoute(legs=tuple(legs))
