"""Compatibility facade: this module now lives in app.orchestration.evidence.corroboration.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the evidence.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.evidence.corroboration import (
    _PHASES_WITHOUT_A_GEOFENCE_VERDICT,
    _geofence_verdict_to_column,
    _snapshot_for_trailer,
    _within_corroboration_skew,
    record_checkpoint_corroboration,
    record_phase_corroboration,
)

__all__ = [
    "_PHASES_WITHOUT_A_GEOFENCE_VERDICT",
    "_geofence_verdict_to_column",
    "_snapshot_for_trailer",
    "_within_corroboration_skew",
    "record_checkpoint_corroboration",
    "record_phase_corroboration",
]
