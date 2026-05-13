"""SHA-256 hashing utilities for FreightProof evidence integrity.

compute_journey_lock_hash() is the canonical hash of a trip's immutable
parameters at creation time. It is stored on the Trip row and anchored to
Hedera HCS. Any post-creation mismatch between the DB value and the Hedera
record indicates tampering.
"""

import hashlib
import json
import uuid


def compute_journey_lock_hash(
    *,
    trip_id: uuid.UUID,
    order_number: str,
    driver_id: uuid.UUID,
    horse_id: uuid.UUID,
    trailer_ids: list[uuid.UUID],
    origin_precinct_id: uuid.UUID,
    destination_precinct_id: uuid.UUID,
) -> str:
    """Return a 64-char lowercase hex SHA-256 digest of the trip's fixed parameters.

    The canonical string is a compact JSON object with keys in alphabetical order.
    Trailers are sorted by their UUID string representation (lowercase RFC 4122 hex,
    locale-independent) so insertion order does not affect the hash.

    Canonical format example:
        {"destination_precinct_id":"<uuid>","driver_id":"<uuid>","horse_id":"<uuid>",
         "order_number":"<str>","origin_precinct_id":"<uuid>","trailers":["<uuid>",...],
         "trip_id":"<uuid>"}

    The JSON is encoded as UTF-8 before hashing. This format is reproducible from
    any language with a standard JSON library using sort_keys=True and no whitespace.
    """
    if not trailer_ids:
        raise ValueError("trailer_ids must not be empty")

    payload = {
        "trip_id": str(trip_id),
        "order_number": order_number,
        "driver_id": str(driver_id),
        "horse_id": str(horse_id),
        "trailers": sorted(str(t) for t in trailer_ids),
        "origin_precinct_id": str(origin_precinct_id),
        "destination_precinct_id": str(destination_precinct_id),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
