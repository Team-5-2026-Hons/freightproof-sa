"""Compatibility facade: trip orchestration now lives in app.orchestration.trips.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the trips.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.trips.administration import _CANCELLED_BY_PREFIX, cancel_trip
from app.orchestration.trips.creation import (
    ManifestCargo,
    NewTrip,
    _build_phase_events,
    _fetch_driver,
    _fetch_vehicle,
    _generate_trip_reference,
    _manifest_conflict,
    _sync_cargo_entry,
    create_trip,
    find_live_trip_for_manifest,
    persist_trip,
)
from app.orchestration.trips.queries import (
    _driver_view,
    get_active_trip_for_driver,
    get_own_trip_detail_for_driver,
    list_trips_for_driver,
)

__all__ = [
    "ManifestCargo",
    "NewTrip",
    "_CANCELLED_BY_PREFIX",
    "_build_phase_events",
    "_driver_view",
    "_fetch_driver",
    "_fetch_vehicle",
    "_generate_trip_reference",
    "_manifest_conflict",
    "_sync_cargo_entry",
    "cancel_trip",
    "create_trip",
    "find_live_trip_for_manifest",
    "get_active_trip_for_driver",
    "get_own_trip_detail_for_driver",
    "list_trips_for_driver",
    "persist_trip",
]
