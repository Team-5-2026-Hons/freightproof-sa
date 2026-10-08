"""Compatibility facade: this module now lives in app.orchestration.fleet.vehicles.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the fleet.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.fleet.vehicles import (
    create_vehicle,
    get_vehicle_detail,
    list_vehicles,
    update_vehicle,
)

__all__ = [
    "create_vehicle",
    "get_vehicle_detail",
    "list_vehicles",
    "update_vehicle",
]
