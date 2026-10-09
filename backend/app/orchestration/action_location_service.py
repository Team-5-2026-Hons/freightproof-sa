"""Compatibility facade: this module now lives in app.orchestration.evidence.action_location.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the evidence.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.evidence.action_location import (
    PhaseLocationPreviewConflictError,
    _find_existing_separation,
    build_capture_assessment,
    build_checkpoint_assessment,
    build_phase_assessment,
    preview_phase_location,
    record_driver_location_finding,
    record_separation_finding,
)

__all__ = [
    "PhaseLocationPreviewConflictError",
    "_find_existing_separation",
    "build_capture_assessment",
    "build_checkpoint_assessment",
    "build_phase_assessment",
    "preview_phase_location",
    "record_driver_location_finding",
    "record_separation_finding",
]
