"""Compatibility facade: this module now lives at app.orchestration.phases.blocking."""

from app.orchestration.phases.blocking import (
    BLOCKED_ON_SCAN,
    GATED_PHASES,
    blocked_on_by_stop,
    blocked_on_for,
)

__all__ = [
    "BLOCKED_ON_SCAN",
    "GATED_PHASES",
    "blocked_on_by_stop",
    "blocked_on_for",
]
