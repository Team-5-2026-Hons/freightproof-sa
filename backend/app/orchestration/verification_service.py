"""Compatibility facade: verification now lives in app.orchestration.verification.

`VerifyOutcome`, `verify_subject` and `verify_visible_subject` are in verification.service;
`reconstruct_pending_phase_payload` and `_hash_payload` are in verification.phase_payloads;
`_reconstruct_precinct_event_payload` is in verification.fleet_events. New code imports from the
module that owns the name; tests must patch the module that looks a name up, never this one
(check B8).
"""

from app.orchestration.verification.fleet_events import _reconstruct_precinct_event_payload
from app.orchestration.verification.phase_payloads import (
    _hash_payload,
    reconstruct_pending_phase_payload,
)
from app.orchestration.verification.service import (
    VerifyOutcome,
    verify_subject,
    verify_visible_subject,
)

__all__ = [
    "VerifyOutcome",
    "_hash_payload",
    "_reconstruct_precinct_event_payload",
    "reconstruct_pending_phase_payload",
    "verify_subject",
    "verify_visible_subject",
]
