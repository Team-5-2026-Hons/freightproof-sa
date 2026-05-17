"""SHA-256 hashing utilities for FreightProof evidence integrity.

compute_journey_lock_hash() is the canonical hash of a trip's immutable
parameters at creation time. It is stored on the Trip row and anchored to
Hedera HCS. Any post-creation mismatch between the DB value and the Hedera
record indicates tampering.

compute_trip_canonical_payload() exposes the same dict for the verification
flow, so verify_subject() can recompute the hash without duplicating logic.
"""

import hashlib
import json
import uuid
from datetime import datetime


def compute_journey_lock_hash(
    *,
    trip_id: uuid.UUID,
    order_number: str,
    driver_id: uuid.UUID,
    horse_id: uuid.UUID,
    trailer_ids: list[uuid.UUID],
    origin_precinct_id: uuid.UUID,
    destination_precinct_id: uuid.UUID,
    created_by_user_id: uuid.UUID,
    created_at: datetime,
) -> str:
    """Return a 64-char lowercase hex SHA-256 digest of the trip's fixed parameters.

    The canonical string is a compact JSON object with keys in alphabetical order.
    Trailers are sorted by their UUID string representation (lowercase RFC 4122 hex,
    locale-independent) so insertion order does not affect the hash.

    Now includes created_by_user_id and created_at so the on-chain hash for a
    BlockchainReceipt is identical to the journey_lock_hash — single source of truth.
    """
    if not trailer_ids:
        raise ValueError("trailer_ids must not be empty")

    payload = compute_trip_canonical_payload(
        trip_id=trip_id,
        order_number=order_number,
        driver_id=driver_id,
        horse_id=horse_id,
        trailer_ids=trailer_ids,
        origin_precinct_id=origin_precinct_id,
        destination_precinct_id=destination_precinct_id,
        created_by_user_id=created_by_user_id,
        created_at=created_at,
    )
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def compute_trip_canonical_payload(
    *,
    trip_id: uuid.UUID,
    order_number: str,
    driver_id: uuid.UUID,
    horse_id: uuid.UUID,
    trailer_ids: list[uuid.UUID],
    origin_precinct_id: uuid.UUID,
    destination_precinct_id: uuid.UUID,
    created_by_user_id: uuid.UUID,
    created_at: datetime,
) -> dict:
    """Return the canonical payload dict used for both the lock hash and on-chain anchor."""
    return {
        "trip_id": str(trip_id),
        "order_number": order_number,
        "driver_id": str(driver_id),
        "horse_id": str(horse_id),
        "trailers": sorted(str(t) for t in trailer_ids),
        "origin_precinct_id": str(origin_precinct_id),
        "destination_precinct_id": str(destination_precinct_id),
        "created_by_user_id": str(created_by_user_id),
        "created_at": created_at.isoformat(),
    }
