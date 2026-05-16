import hashlib
import json
import uuid
from datetime import UTC, datetime

import pytest

from app.crypto.hashing import compute_journey_lock_hash, compute_trip_canonical_payload


def _fixed_args() -> dict:
    return dict(
        trip_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        order_number="ORD-001",
        driver_id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
        horse_id=uuid.UUID("00000000-0000-0000-0000-000000000003"),
        trailer_ids=[uuid.UUID("00000000-0000-0000-0000-000000000004")],
        origin_precinct_id=uuid.UUID("00000000-0000-0000-0000-000000000005"),
        destination_precinct_id=uuid.UUID("00000000-0000-0000-0000-000000000006"),
        created_by_user_id=uuid.UUID("00000000-0000-0000-0000-000000000007"),
        created_at=datetime(2026, 5, 16, 12, 0, 0, tzinfo=UTC),
    )


def test_hash_is_deterministic():
    h1 = compute_journey_lock_hash(**_fixed_args())
    h2 = compute_journey_lock_hash(**_fixed_args())
    assert h1 == h2
    assert len(h1) == 64
    assert all(c in "0123456789abcdef" for c in h1)


def test_hash_changes_when_user_changes():
    args = _fixed_args()
    h1 = compute_journey_lock_hash(**args)
    args["created_by_user_id"] = uuid.UUID("00000000-0000-0000-0000-000000000099")
    h2 = compute_journey_lock_hash(**args)
    assert h1 != h2


def test_hash_changes_when_created_at_changes():
    args = _fixed_args()
    h1 = compute_journey_lock_hash(**args)
    args["created_at"] = datetime(2026, 5, 17, 12, 0, 0, tzinfo=UTC)
    h2 = compute_journey_lock_hash(**args)
    assert h1 != h2


def test_trailer_order_does_not_affect_hash():
    args = _fixed_args()
    args["trailer_ids"] = [
        uuid.UUID("00000000-0000-0000-0000-00000000000a"),
        uuid.UUID("00000000-0000-0000-0000-00000000000b"),
    ]
    h1 = compute_journey_lock_hash(**args)
    args["trailer_ids"] = list(reversed(args["trailer_ids"]))
    h2 = compute_journey_lock_hash(**args)
    assert h1 == h2


def test_canonical_payload_matches_hash():
    args = _fixed_args()
    payload = compute_trip_canonical_payload(**args)
    expected = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    assert compute_journey_lock_hash(**args) == expected


def test_raises_on_empty_trailers():
    args = _fixed_args()
    args["trailer_ids"] = []
    with pytest.raises(ValueError, match="trailer_ids must not be empty"):
        compute_journey_lock_hash(**args)
