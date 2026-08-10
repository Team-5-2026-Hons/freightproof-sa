"""Request-rate budgets, in one table.

Every limit the API enforces is declared here rather than inline at the call site, so the
whole budget can be read — and argued with — in one place. A limit buried in a decorator
above an endpoint is a limit nobody reviews.

The numbers are deliberately generous against normal use and tight against abuse. Two
things drive them:

  * Money. POST /trips submits to Hedera and POST /artifacts writes to Supabase Storage.
    Each call spends something real, so these are the doors an authenticated-but-hostile
    account would push on to run up a bill. They get the tightest budgets.
  * The driver's offline queue. The PWA batches work while out of signal and flushes it
    all at once when signal returns, so an evidence-write budget that assumes a steady
    trickle would throttle a legitimately reconnecting driver. EVIDENCE_WRITE is sized
    for a burst, and the location endpoint already batches up to 200 fixes per request
    (schemas/locations.py MAX_PINGS_PER_REQUEST), so one flush is a handful of calls.

Windows are all 60s. A single window length keeps the mental model simple: every number
below reads as "per minute".
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class RateLimit:
    """One budget: `max_requests` allowed per `window_seconds`, counted per identity."""

    max_requests: int
    window_seconds: int
    # Names the bucket in Redis and in the 429 log line. Must be unique across this module —
    # two limits sharing a name would silently share one counter.
    name: str


_ONE_MINUTE = 60

# Coarse per-IP net applied to EVERY request by the middleware, before authentication has
# run. It exists to blunt a flood from a single source (including unauthenticated hammering
# of the 401 path, which still costs a JWKS check and a DB round-trip); it is not the real
# per-user control. Sized well above what a busy dispatcher board with an open SSE stream
# and several tabs will generate.
GLOBAL_PER_IP = RateLimit(max_requests=300, window_seconds=_ONE_MINUTE, name="global_ip")

# Applied per authenticated subject on the endpoints that spend money or partner quota.
# These are the real controls — an attacker with a valid token defeats the IP limit simply
# by moving IP, but cannot escape a budget keyed on the account itself.

# Hedera submission per trip creation: real testnet/mainnet spend, and a synchronous
# anchor call. Ten a minute is far beyond a dispatcher creating trips by hand.
TRIP_CREATE = RateLimit(max_requests=10, window_seconds=_ONE_MINUTE, name="trip_create")

# Parcel Perfect lookups burn a partner API quota we do not own. The wizard fires one per
# waybill the dispatcher types, so this has to allow a multi-waybill trip being entered
# quickly, and no more.
PP_LOOKUP = RateLimit(max_requests=30, window_seconds=_ONE_MINUTE, name="pp_lookup")

# Storage writes. Each accepted upload is up to MAX_FILE_SIZE_BYTES on our bill, so this is
# the budget that stops one handset filling the bucket.
ARTIFACT_UPLOAD = RateLimit(max_requests=30, window_seconds=_ONE_MINUTE, name="artifact_upload")

# Driver evidence writes (locations, checkpoints, exceptions). Sized for an offline-queue
# flush rather than a steady trickle — see the module docstring.
EVIDENCE_WRITE = RateLimit(max_requests=120, window_seconds=_ONE_MINUTE, name="evidence_write")

# Blockchain verification re-reads a Hedera mirror node. Cheap for us, not free for them.
BLOCKCHAIN_VERIFY = RateLimit(max_requests=30, window_seconds=_ONE_MINUTE, name="blockchain_verify")

# Dispatcher fleet mutations (driver/vehicle create and update). Each one writes an event
# row and may anchor, so it is not a free write even though it is not a Hedera submit.
FLEET_MUTATION = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="fleet_mutation")
