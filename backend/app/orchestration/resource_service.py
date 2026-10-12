"""Compatibility facade: trip list, history and detail reads now live in app.orchestration.trips.

`get_trip_detail` is in trips.detail; `list_trips` and `list_trip_history` are in trips.listing.
New code imports from the module that owns the name; tests must patch the module that looks a
name up, never this one (check B8).
"""

from app.orchestration.trips.detail import get_trip_detail
from app.orchestration.trips.listing import list_trip_history, list_trips

__all__ = [
    "get_trip_detail",
    "list_trip_history",
    "list_trips",
]
