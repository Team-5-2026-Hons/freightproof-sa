"""Compatibility facade: this module now lives in app.orchestration.handover.capability.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the handover.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.handover.capability import (
    HandoverRedemptionResult,
    RotationResult,
    build_scan_url,
    expire_sibling_tokens,
    extend_token_for_verification,
    find_open_token,
    hash_presented_token,
    issue_capability_token,
    load_handover_confirmation,
    mark_token_opened,
    record_handover_confirmation,
    redeem_capability_token,
    rotate_capability_token,
    session_secret_matches,
)

__all__ = [
    "HandoverRedemptionResult",
    "RotationResult",
    "build_scan_url",
    "expire_sibling_tokens",
    "extend_token_for_verification",
    "find_open_token",
    "hash_presented_token",
    "issue_capability_token",
    "load_handover_confirmation",
    "mark_token_opened",
    "record_handover_confirmation",
    "redeem_capability_token",
    "rotate_capability_token",
    "session_secret_matches",
]
