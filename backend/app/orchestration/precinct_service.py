"""Compatibility facade: this module now lives in app.orchestration.fleet.precincts.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the fleet.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.fleet.precincts import (
    create_precinct,
    get_precinct_detail,
    list_precincts,
    update_precinct,
)

__all__ = [
    "create_precinct",
    "get_precinct_detail",
    "list_precincts",
    "update_precinct",
]
