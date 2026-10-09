"""Compatibility facade: this module now lives in app.orchestration.consignments.sync.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the consignments.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.consignments.sync import (
    ConsignmentSyncResult,
    fetch_and_sync_consignment,
    get_assigned_trip_reference,
    scanned_consignment_ids,
    serialise_waybill,
    sync_consignment_from_waybill,
)

__all__ = [
    "ConsignmentSyncResult",
    "fetch_and_sync_consignment",
    "get_assigned_trip_reference",
    "scanned_consignment_ids",
    "serialise_waybill",
    "sync_consignment_from_waybill",
]
