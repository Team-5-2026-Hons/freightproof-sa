"""Compatibility facade: the fleet analytics coordinator now lives in app.orchestration.analytics.fleet.

New code imports from the module that owns the name; tests must patch the module that looks a
name up, never this one (check B8).
"""

from app.orchestration.analytics.fleet import (
    check_period,
    get_activity,
    get_evidence,
    get_incidents,
    get_on_time,
    get_patterns,
    get_problems,
    get_review,
    get_routes,
    get_tiles,
    resolve_period_start,
)

__all__ = [
    "check_period",
    "get_activity",
    "get_evidence",
    "get_incidents",
    "get_on_time",
    "get_patterns",
    "get_problems",
    "get_review",
    "get_routes",
    "get_tiles",
    "resolve_period_start",
]
