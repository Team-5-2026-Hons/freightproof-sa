"""Great-circle distance for comparing a captured GPS fix against a precinct geofence.

Deliberately pure: no DB, no config, no other `app/` imports. This module is a leaf
so it can be unit-tested in total isolation and reused anywhere a plain lat/lng
distance is needed (geofence checks, tracker-vs-phone separation, etc.).

This is the Python twin of `frontend/dispatcher/lib/phase/geo.ts`. The two must stay
numerically aligned: if the backend's pass/fail verdict and the dispatcher's rendered
distance used different Earth radii, they could disagree on screen for the same fix.
"""

import math
from decimal import Decimal

# Mean Earth radius in metres (IUGG value), matching frontend/dispatcher/lib/phase/geo.ts
# exactly. Do not change independently of that file — see module docstring.
EARTH_RADIUS_METRES = 6_371_008.8

_MIN_LATITUDE = -90.0
_MAX_LATITUDE = 90.0
_MIN_LONGITUDE = -180.0
_MAX_LONGITUDE = 180.0


def _to_validated_float(value: float | Decimal, *, name: str, low: float, high: float) -> float:
    """Coerce a coordinate to float and enforce it is a finite value within [low, high].

    A silently wrong distance reads as plausible on screen (e.g. "12 m inside the
    fence" when the truth is far outside), so bad input is rejected loudly here
    rather than allowed to produce a number that merely looks reasonable.
    """
    coerced = float(value)

    if math.isnan(coerced) or math.isinf(coerced):
        raise ValueError(f"{name} must be a finite number, got {value!r}")

    if not (low <= coerced <= high):
        raise ValueError(f"{name} must be within [{low}, {high}], got {coerced}")

    return coerced


def haversine_metres(
    lat1: float | Decimal,
    lng1: float | Decimal,
    lat2: float | Decimal,
    lng2: float | Decimal,
) -> float:
    """Great-circle distance in metres between two lat/lng points.

    Accepts float or Decimal for each coordinate: precinct coordinates come off the
    model as Decimal (Numeric(10,7)), while tracker fixes arrive as plain floats.
    Everything is coerced to float before any trigonometry, since `math.sin`/`math.cos`
    coerce to float internally anyway — returning a Decimal here would be false
    precision dressed up as accuracy.

    Bounds are inclusive: latitude in [-90, 90], longitude in [-180, 180]. +/-180
    longitude is a legitimate input (the antimeridian), not an error.
    """
    lat1_f = _to_validated_float(lat1, name="lat1", low=_MIN_LATITUDE, high=_MAX_LATITUDE)
    lng1_f = _to_validated_float(lng1, name="lng1", low=_MIN_LONGITUDE, high=_MAX_LONGITUDE)
    lat2_f = _to_validated_float(lat2, name="lat2", low=_MIN_LATITUDE, high=_MAX_LATITUDE)
    lng2_f = _to_validated_float(lng2, name="lng2", low=_MIN_LONGITUDE, high=_MAX_LONGITUDE)

    d_lat = math.radians(lat2_f - lat1_f)
    d_lng = math.radians(lng2_f - lng1_f)
    lat1_rad = math.radians(lat1_f)
    lat2_rad = math.radians(lat2_f)

    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(d_lng / 2) ** 2
    )

    # h never exceeds 1 mathematically, but for near-antipodal points
    # floating-point rounding can push sqrt(h) to 1 + ~1e-16, which is outside
    # math.asin's [-1, 1] domain and would raise ValueError on a perfectly
    # legitimate pair of coordinates. Clamp rather than let a rounding error
    # crash a distance calculation.
    root_h = min(1.0, math.sqrt(h))

    return 2 * EARTH_RADIUS_METRES * math.asin(root_h)
