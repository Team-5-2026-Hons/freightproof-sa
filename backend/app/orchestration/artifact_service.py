"""Compatibility facade: this module now lives in app.orchestration.evidence.artifacts.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the evidence.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.evidence.artifacts import (
    MAX_FILE_SIZE_BYTES,
    create_artifact,
    create_receiver_artifact,
    get_trip_scoped_artifact,
    list_artifacts_for_trip,
)

__all__ = [
    "MAX_FILE_SIZE_BYTES",
    "create_artifact",
    "create_receiver_artifact",
    "get_trip_scoped_artifact",
    "list_artifacts_for_trip",
]
