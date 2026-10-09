"""Compatibility facade: this module now lives in app.orchestration.handover.receiver_verification.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the handover.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.handover.receiver_verification import (
    PROVIDER_DIDIT,
    WEBHOOK_MAX_CLOCK_SKEW_SECONDS,
    Verdict,
    attach_confirmation,
    consume_quota_slot,
    hash_consent_text,
    identity_matches,
    ingest_webhook_decision,
    load_verification_for_token,
    raise_verification_exception,
    record_consent,
    resolve_verdict,
    resolve_verification,
    start_verification,
    sweep_abandoned_verifications,
    verify_webhook_signature,
    webhook_timestamp_is_fresh,
)

__all__ = [
    "PROVIDER_DIDIT",
    "WEBHOOK_MAX_CLOCK_SKEW_SECONDS",
    "Verdict",
    "attach_confirmation",
    "consume_quota_slot",
    "hash_consent_text",
    "identity_matches",
    "ingest_webhook_decision",
    "load_verification_for_token",
    "raise_verification_exception",
    "record_consent",
    "resolve_verdict",
    "resolve_verification",
    "start_verification",
    "sweep_abandoned_verifications",
    "verify_webhook_signature",
    "webhook_timestamp_is_fresh",
]
