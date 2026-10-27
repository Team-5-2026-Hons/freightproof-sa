"""Request-rate budgets, one table so the whole API budget can be reviewed in one place.
Windows are all 60s, so every number below reads as "per minute".
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class RateLimit:
    """One budget: `max_requests` allowed per `window_seconds`, counted per identity."""

    max_requests: int
    window_seconds: int
    name: str


_ONE_MINUTE = 60

GLOBAL_PER_IP = RateLimit(max_requests=300, window_seconds=_ONE_MINUTE, name="global_ip")

TRIP_CREATE = RateLimit(max_requests=10, window_seconds=_ONE_MINUTE, name="trip_create")

PP_LOOKUP = RateLimit(max_requests=30, window_seconds=_ONE_MINUTE, name="pp_lookup")

ARTIFACT_UPLOAD = RateLimit(max_requests=30, window_seconds=_ONE_MINUTE, name="artifact_upload")

EVIDENCE_WRITE = RateLimit(max_requests=120, window_seconds=_ONE_MINUTE, name="evidence_write")

BLOCKCHAIN_VERIFY = RateLimit(max_requests=30, window_seconds=_ONE_MINUTE, name="blockchain_verify")

FLEET_MUTATION = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="fleet_mutation")

PUSH_TOKEN_REGISTER = RateLimit(max_requests=10, window_seconds=_ONE_MINUTE, name="push_token_register")

PRECINCT_MUTATION = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="precinct_mutation")

COST_PROFILE_MUTATION = RateLimit(max_requests=30, window_seconds=_ONE_MINUTE, name="cost_profile_mutation")

HANDOVER_ISSUE = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="handover_issue")

HANDOVER_PUBLIC = RateLimit(max_requests=20, window_seconds=_ONE_MINUTE, name="handover_public")

IDVS_VERIFY = RateLimit(max_requests=5, window_seconds=_ONE_MINUTE, name="idvs_verify")

IDVS_WEBHOOK = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="idvs_webhook")

AUDIT_PACK_BUILD = RateLimit(max_requests=20, window_seconds=_ONE_MINUTE, name="audit_pack_build")

AUDIT_PACK_PUBLIC = RateLimit(max_requests=120, window_seconds=_ONE_MINUTE, name="audit_pack_public")

AUDIT_PACK_PASSWORD_VERIFY = RateLimit(max_requests=10, window_seconds=_ONE_MINUTE, name="audit_pack_password_verify")

ANALYTICS_CHAT = RateLimit(max_requests=10, window_seconds=_ONE_MINUTE, name="analytics_chat")

ASSISTANT_CHAT = RateLimit(max_requests=10, window_seconds=_ONE_MINUTE, name="assistant_chat")
