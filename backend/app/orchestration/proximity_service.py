"""Compatibility facade: this module now lives in app.orchestration.evidence.proximity.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the evidence.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.evidence.proximity import FUTURE_FIX_SLACK_SECONDS, evaluate_proximity

__all__ = [
    "FUTURE_FIX_SLACK_SECONDS",
    "evaluate_proximity",
]
