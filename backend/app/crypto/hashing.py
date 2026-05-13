"""SHA-256 hashing utilities for FreightProof evidence integrity.

compute_journey_lock_hash() is the canonical hash of a trip's immutable
parameters at creation time. It is stored on the Trip row and anchored to
Hedera HCS. Any post-creation mismatch between the DB value and the Hedera
record indicates tampering.
"""

import hashlib
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

    Trailers are sorted before hashing so that insertion order does not affect
    the result — only the set of trailers matters.
    """
    sorted_trailers = ",".join(sorted(str(t) for t in trailer_ids))
    canonical = (
        f"trip_id={trip_id}"
        f"|order_number={order_number}"
        f"|driver_id={driver_id}"
        f"|horse_id={horse_id}"
        f"|trailers={sorted_trailers}"
        f"|origin={origin_precinct_id}"
        f"|destination={destination_precinct_id}"
    )
    return hashlib.sha256(canonical.encode()).hexdigest()
