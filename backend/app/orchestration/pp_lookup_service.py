"""Compatibility facade: this module now lives in app.orchestration.consignments.waybill_lookup.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the consignments.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.consignments.waybill_lookup import (
    get_capabilities,
    get_waybill_summary,
)

__all__ = [
    "get_capabilities",
    "get_waybill_summary",
]
