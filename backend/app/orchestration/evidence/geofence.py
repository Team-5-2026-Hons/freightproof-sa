"""Geofence corroboration verdict for FP-68: does a Pulsit tracker fix agree with a
precinct's location, within the operational GPS tolerance?

Deliberately pure: no DB, no HTTP, no writes. The caller (FP-143) fetches the fix
and precinct and persists the verdict; this module only turns (fix, precinct) into one.
"""

import logging
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING, Optional

from app.core.config import settings
from app.core.geo import haversine_metres

if TYPE_CHECKING:
    # Avoids a hard runtime dependency on db/models from a module that otherwise
    # touches no DB, while still typing `precinct` precisely.
    from app.db.models.organisations import Precinct

logger = logging.getLogger(__name__)

# Mirrors Precinct.geofence_radius_metres' server_default and schemas/organisations.py's
# _RADIUS_DEFAULT_METRES. The column is NOT NULL, so this is only a defensive guard for
# a partially-built or detached Precinct in a test, not an expected runtime state.
DEFAULT_GEOFENCE_RADIUS_METRES = 200


class GeofenceVerdictReason(str, Enum):
    """Why the verdict came out the way it did. Not persisted, so it stays local
    rather than living in the shared db/models/enums.py."""

    MEASURED = "measured"  # distance was actually computed
    NO_FIX = "no_fix"  # no tracker fix to compare (fix or its lat/lng were None)
    NO_PRECINCT_COORDINATES = "no_precinct_coordinates"  # precinct had no usable coordinates


@dataclass(frozen=True)
class TrackerFix:
    """A single Pulsit tracker position, reduced to only what this module needs (lat/lng)."""

    lat: float | Decimal
    lng: float | Decimal


@dataclass(frozen=True)
class GeofenceVerdict:
    """The outcome of comparing one fix against one precinct's geofence.

    `radius_metres`/`tolerance_metres` report the values actually applied (after any
    None-fallback) so a reader can reconstruct the arithmetic.
    """

    confirmed: bool
    distance_metres: Optional[float]  # None = not computed; never confused with 0.0
    radius_metres: Optional[int]
    tolerance_metres: int
    in_tolerance_band: bool
    reason: GeofenceVerdictReason


def evaluate_geofence(
    fix: Optional[TrackerFix],
    precinct: "Optional[Precinct]",
    *,
    tolerance_metres: Optional[int] = None,
) -> GeofenceVerdict:
    """Compare a tracker fix against a precinct's geofence and return a verdict.

    Plain `def`: pure arithmetic, no I/O to yield on. `tolerance_metres=None` reads
    `settings.GPS_TOLERANCE_METRES` so tests can vary it per-call. Never raises;
    missing inputs are logged and resolve to an honest verdict instead.
    """
    effective_tolerance = (
        settings.GPS_TOLERANCE_METRES if tolerance_metres is None else tolerance_metres
    )

    if fix is None or fix.lat is None or fix.lng is None:
        logger.warning("Geofence check skipped: no tracker fix available to compare.")
        return GeofenceVerdict(
            confirmed=False,
            distance_metres=None,
            radius_metres=None,
            tolerance_metres=effective_tolerance,
            in_tolerance_band=False,
            reason=GeofenceVerdictReason.NO_FIX,
        )

    if precinct is None or precinct.latitude is None or precinct.longitude is None:
        logger.warning("Geofence check skipped: precinct has no usable coordinates.")
        return GeofenceVerdict(
            confirmed=False,
            distance_metres=None,
            radius_metres=None,
            tolerance_metres=effective_tolerance,
            in_tolerance_band=False,
            reason=GeofenceVerdictReason.NO_PRECINCT_COORDINATES,
        )

    radius = (
        DEFAULT_GEOFENCE_RADIUS_METRES
        if precinct.geofence_radius_metres is None
        else precinct.geofence_radius_metres
    )

    distance = haversine_metres(fix.lat, fix.lng, precinct.latitude, precinct.longitude)

    # `confirmed` uses the tolerance-widened radius; `in_tolerance_band` separately
    # flags the marginal case (inside the widened band, outside the radius proper).
    confirmed = distance <= radius + effective_tolerance
    in_tolerance_band = radius < distance <= radius + effective_tolerance

    return GeofenceVerdict(
        confirmed=confirmed,
        distance_metres=distance,
        radius_metres=radius,
        tolerance_metres=effective_tolerance,
        in_tolerance_band=in_tolerance_band,
        reason=GeofenceVerdictReason.MEASURED,
    )
