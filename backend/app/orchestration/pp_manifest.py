"""Compatibility facade: this module now lives in app.orchestration.consignments.manifest_snapshot.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the consignments.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.consignments.manifest_snapshot import (
    manifest_key,
    manifest_snapshot,
    manifest_snapshot_sha256,
    snapshot_read,
    waybills_from_other_clients,
)

__all__ = [
    "manifest_key",
    "manifest_snapshot",
    "manifest_snapshot_sha256",
    "snapshot_read",
    "waybills_from_other_clients",
]
