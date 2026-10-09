"""Compatibility facade: this module now lives in app.orchestration.consignments.manifest_import.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the consignments.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.consignments.manifest_import import (
    create_trip_from_pp_manifest,
    preview_pp_manifest,
)

__all__ = [
    "create_trip_from_pp_manifest",
    "preview_pp_manifest",
]
