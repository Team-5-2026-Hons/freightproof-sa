"""Great-circle distance for comparing a captured GPS fix against a precinct geofence.

Deliberately pure: no DB, no config, no other `app/` imports — a leaf module,
unit-testable in isolation.

Python twin of `frontend/dispatcher/lib/phase/geo.ts`; must stay numerically
aligned or the two could disagree on screen for the same fix.
"""

import math
from decimal import Decimal

# Mean Earth radius in metres (IUGG value); do not change independently of
# frontend/dispatcher/lib/phase/geo.ts.
EARTH_RADIUS_METRES = 6_371_008.8

_MIN_LATITUDE = -90.0
_MAX_LATITUDE = 90.0
_MIN_LONGITUDE = -180.0
_MAX_LONGITUDE = 180.0


def _to_validated_float(value: float | Decimal, *, name: str, low: float, high: float) -> float:
    """Coerce a coordinate to float and enforce it is a finite value within [low, high].

    Rejected loudly rather than silently producing a plausible-looking wrong
    distance (e.g. "12m inside the fence" when the truth is far outside).
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

    Accepts float or Decimal (precinct coords are Decimal, tracker fixes are
    float); everything coerces to float before trigonometry, since returning
    a Decimal result would be false precision.

    Bounds are inclusive: latitude in [-90, 90], longitude in [-180, 180].
    +/-180 longitude is legitimate (the antimeridian), not an error.
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

    # For near-antipodal points, rounding can push sqrt(h) just past 1.0,
    # outside math.asin's domain — clamp rather than crash on valid input.
    root_h = min(1.0, math.sqrt(h))

    return 2 * EARTH_RADIUS_METRES * math.asin(root_h)
