"""Plane geometry for polygon geofences: inside-or-out, distance to the edge, area, validity.

Deliberately pure (no DB, no config, no other `app/` imports), like core/geo.py.

Coordinates are (lat, lng) pairs; a polygon is an OPEN ring (first corner is not repeated
at the end). Everything is projected onto a flat plane in metres around a local origin
(equirectangular: x = east metres, y = north metres). A precinct is at most a few
kilometres across, where that flattening is off by well under a metre — far inside GPS
noise — and it keeps every formula here short enough to check by hand.

Python twin of `frontend/dispatcher/lib/map/polygon.ts`; the two must agree, or the map
could show a fix inside a fence the backend judged outside.
"""

import math
from collections.abc import Callable, Sequence

from app.core.geo import EARTH_RADIUS_METRES

LatLng = tuple[float, float]
_Point = tuple[float, float]

MIN_POLYGON_VERTICES = 3

_METRES_PER_DEGREE = math.pi * EARTH_RADIUS_METRES / 180


def _projector(origin_lat: float, origin_lng: float) -> Callable[[LatLng], _Point]:
    """A function mapping (lat, lng) to (x, y) metres from the origin."""
    metres_per_degree_lng = _METRES_PER_DEGREE * math.cos(math.radians(origin_lat))

    def project(point: LatLng) -> _Point:
        return (
            (point[1] - origin_lng) * metres_per_degree_lng,
            (point[0] - origin_lat) * _METRES_PER_DEGREE,
        )

    return project


def _project_ring(polygon: Sequence[LatLng], origin: LatLng) -> list[_Point]:
    project = _projector(origin[0], origin[1])
    return [project(p) for p in polygon]


def _edges(ring: Sequence[_Point]) -> list[tuple[_Point, _Point]]:
    return [(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))]


def _segment_distance(p: _Point, a: _Point, b: _Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_sq = dx * dx + dy * dy
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length_sq))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def contains(polygon: Sequence[LatLng], point: LatLng) -> bool:
    """Ray casting: count how many edges a ray going east from the point crosses.

    Odd = inside. A point exactly on an edge may land either way, which is why every
    caller pairs this with distance_to_boundary_metres and a tolerance band.
    """
    ring = _project_ring(polygon, point)
    x, y = 0.0, 0.0
    inside = False
    for (x1, y1), (x2, y2) in _edges(ring):
        if (y1 > y) != (y2 > y):
            crossing_x = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if crossing_x > x:
                inside = not inside
    return inside


def distance_to_boundary_metres(polygon: Sequence[LatLng], point: LatLng) -> float:
    """Shortest distance from the point to any edge, inside or outside."""
    ring = _project_ring(polygon, point)
    return min(_segment_distance((0.0, 0.0), a, b) for a, b in _edges(ring))


def area_square_metres(polygon: Sequence[LatLng]) -> float:
    """Shoelace formula on the projected ring. Absolute, and projected around the corner
    average rather than any one corner, so neither direction nor starting corner matters."""
    origin = (sum(p[0] for p in polygon) / len(polygon), sum(p[1] for p in polygon) / len(polygon))
    ring = _project_ring(polygon, origin)
    twice_area = sum(a[0] * b[1] - b[0] * a[1] for a, b in _edges(ring))
    return abs(twice_area) / 2


def _orientation(a: _Point, b: _Point, c: _Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _segments_cross(a: _Point, b: _Point, c: _Point, d: _Point) -> bool:
    """Proper or touching intersection of segments ab and cd."""
    o1, o2 = _orientation(a, b, c), _orientation(a, b, d)
    o3, o4 = _orientation(c, d, a), _orientation(c, d, b)
    if (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0) and o1 != 0 and o2 != 0 and o3 != 0 and o4 != 0:
        return True

    def on_segment(p: _Point, q: _Point, r: _Point) -> bool:
        return min(p[0], r[0]) <= q[0] <= max(p[0], r[0]) and min(p[1], r[1]) <= q[1] <= max(p[1], r[1])

    return (
        (o1 == 0 and on_segment(a, c, b))
        or (o2 == 0 and on_segment(a, d, b))
        or (o3 == 0 and on_segment(c, a, d))
        or (o4 == 0 and on_segment(c, b, d))
    )


def is_simple(polygon: Sequence[LatLng]) -> bool:
    """No repeated corners and no two non-neighbouring edges touching.

    A figure-of-eight outline has no meaningful "inside": ray casting would call the
    middle of the eight outside. O(n²), fine for the few hundred corners allowed.
    """
    if len(polygon) < MIN_POLYGON_VERTICES or len(set(polygon)) != len(polygon):
        return False
    edges = _edges(_project_ring(polygon, polygon[0]))
    n = len(edges)
    for i in range(n):
        for j in range(i + 1, n):
            if j == i + 1 or (i == 0 and j == n - 1):
                continue
            if _segments_cross(*edges[i], *edges[j]):
                return False
    return True


def interior_point(polygon: Sequence[LatLng]) -> LatLng:
    """A point guaranteed inside the polygon (for placing a test truck "inside").

    The corner average is inside any convex outline. For a concave one (an L-shaped
    yard) it may not be, so fall back to the midpoint of the first inside stretch of a
    horizontal line through it.
    """
    avg: LatLng = (
        sum(p[0] for p in polygon) / len(polygon),
        sum(p[1] for p in polygon) / len(polygon),
    )
    if contains(polygon, avg):
        return avg

    project = _projector(avg[0], avg[1])
    ring = [project(p) for p in polygon]
    crossings = sorted(
        x1 + (0.0 - y1) * (x2 - x1) / (y2 - y1)
        for (x1, y1), (x2, y2) in _edges(ring)
        if (y1 > 0.0) != (y2 > 0.0)
    )
    mid_x = (crossings[0] + crossings[1]) / 2
    metres_per_degree_lng = _METRES_PER_DEGREE * math.cos(math.radians(avg[0]))
    return (avg[0], avg[1] + mid_x / metres_per_degree_lng)
