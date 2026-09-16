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

# Coarse per-IP net applied before authentication runs.
GLOBAL_PER_IP = RateLimit(max_requests=300, window_seconds=_ONE_MINUTE, name="global_ip")

# Hedera submission per trip creation (real spend, synchronous anchor call).
TRIP_CREATE = RateLimit(max_requests=10, window_seconds=_ONE_MINUTE, name="trip_create")

# Parcel Perfect lookups burn a partner API quota.
PP_LOOKUP = RateLimit(max_requests=30, window_seconds=_ONE_MINUTE, name="pp_lookup")

# Storage writes; each accepted upload costs up to MAX_FILE_SIZE_BYTES.
ARTIFACT_UPLOAD = RateLimit(max_requests=30, window_seconds=_ONE_MINUTE, name="artifact_upload")

# Sized for the driver PWA's offline-queue flush burst, not a steady trickle.
EVIDENCE_WRITE = RateLimit(max_requests=120, window_seconds=_ONE_MINUTE, name="evidence_write")

BLOCKCHAIN_VERIFY = RateLimit(max_requests=30, window_seconds=_ONE_MINUTE, name="blockchain_verify")

FLEET_MUTATION = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="fleet_mutation")

# Blast-radius cap: coordinates/radius decide the FP-68 geofence verdict on every handshake.
PRECINCT_MUTATION = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="precinct_mutation")

# Rotating-QR issuance (FP-237); sized to absorb a reconnect storm without a wedged client minting tokens in a loop.
HANDOVER_ISSUE = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="handover_issue")

# Counted per IP: a receiver holds no token, and this is write-capable and unauthenticated.
HANDOVER_PUBLIC = RateLimit(max_requests=20, window_seconds=_ONE_MINUTE, name="handover_public")

# The only public route that can spend money.
IDVS_VERIFY = RateLimit(max_requests=5, window_seconds=_ONE_MINUTE, name="idvs_verify")

# Higher than IDVS_VERIFY: Didit retries failed webhook deliveries up to 5x with backoff.
IDVS_WEBHOOK = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="idvs_webhook")
