"""Compatibility facade: this module now lives in app.orchestration.evidence.location.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the evidence.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.evidence.location import record_location_pings

__all__ = [
    "record_location_pings",
]
