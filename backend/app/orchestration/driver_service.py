"""Compatibility facade: this module now lives in app.orchestration.fleet.drivers.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the fleet.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.fleet.drivers import (
    create_driver,
    get_driver_detail,
    list_drivers,
    update_driver,
)

__all__ = [
    "create_driver",
    "get_driver_detail",
    "list_drivers",
    "update_driver",
]
