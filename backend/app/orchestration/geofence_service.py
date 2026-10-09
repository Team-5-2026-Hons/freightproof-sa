"""Compatibility facade: this module now lives in app.orchestration.evidence.geofence.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the evidence.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.evidence.geofence import (
    DEFAULT_GEOFENCE_RADIUS_METRES,
    GeofenceVerdict,
    GeofenceVerdictReason,
    TrackerFix,
    evaluate_geofence,
)

__all__ = [
    "DEFAULT_GEOFENCE_RADIUS_METRES",
    "GeofenceVerdict",
    "GeofenceVerdictReason",
    "TrackerFix",
    "evaluate_geofence",
]
