"""Compatibility facade: this module now lives in app.orchestration.consignments.scans.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the consignments.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.consignments.scans import (
    ConsignmentScanResult,
    ScanIngestResult,
    ScannedCounts,
    ingest_scans,
    load_consignments_at_stop,
    scanned_counts_for_consignment,
    scanned_counts_for_trip,
)

__all__ = [
    "ConsignmentScanResult",
    "ScanIngestResult",
    "ScannedCounts",
    "ingest_scans",
    "load_consignments_at_stop",
    "scanned_counts_for_consignment",
    "scanned_counts_for_trip",
]
