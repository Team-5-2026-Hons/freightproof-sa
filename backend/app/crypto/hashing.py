"""SHA-256 hashing utilities for FreightProof evidence integrity.

compute_journey_lock_hash() is the canonical hash of a trip's immutable
parameters at creation, stored on the Trip row and anchored to Hedera HCS —
a post-creation mismatch indicates tampering.

compute_trip_canonical_payload() exposes the same dict so verify_subject()
can recompute the hash without duplicating logic.
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
    trip_type: str | None = None,
) -> str:
    """Return a 64-char lowercase hex SHA-256 digest of the trip's fixed parameters.

    Canonical string is compact JSON with alphabetically sorted keys.
    Trailers are sorted by UUID string so insertion order doesn't affect the
    hash; an empty list is valid (rigid trucks run without trailers).

    Includes created_by_user_id and created_at so the on-chain hash matches
    journey_lock_hash exactly.

    trip_type is optional and versioned: old anchored trips never had it, so
    verification must omit it when reconstructing their hash (see
    verification_service._reconstruct_trip_payload).
    """
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
        trip_type=trip_type,
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
    trip_type: str | None = None,
) -> dict:
    """Return the canonical payload dict used for both the lock hash and on-chain anchor.

    trip_type is omitted entirely when None (not set to null) so
    pre-existing anchored trips still hash identically at verification time.
    """
    payload = {
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
    if trip_type is not None:
        payload["trip_type"] = trip_type
    return payload
