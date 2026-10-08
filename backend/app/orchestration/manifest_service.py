"""Compatibility facade: this module now lives in app.orchestration.consignments.manifest_reads.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the consignments.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.consignments.manifest_reads import (
    get_linehaul_for_driver,
    get_manifest_for_dispatcher,
    load_creation_snapshot,
)

__all__ = [
    "get_linehaul_for_driver",
    "get_manifest_for_dispatcher",
    "load_creation_snapshot",
]
