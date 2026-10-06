"""Journey lock v2 (FP-281, spec §9): one fixed key set, UTC-normalised times."""

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from app.crypto.hashing import (
    PPManifestKey,
    canonical_json,
    compute_journey_lock_hash,
    compute_snapshot_sha256,
    compute_trip_canonical_payload,
)

_EXPECTED_KEYS = {
    "trip_id", "driver_id", "horse_id", "trailers", "origin_precinct_id",
    "destination_precinct_id", "created_by_user_id", "created_at", "trip_type",
    "pp_manifest", "pp_manifest_snapshot_sha256", "planned_departure_at", "planned_arrival_at",
}


def _args(**overrides: Any) -> dict[str, Any]:
    created = datetime.now(UTC)
    args: dict[str, Any] = dict(
        trip_id=uuid.uuid4(), driver_id=uuid.uuid4(), horse_id=uuid.uuid4(),
        trailer_ids=[uuid.uuid4(), uuid.uuid4()], origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(), created_by_user_id=uuid.uuid4(),
        created_at=created, trip_type="loaded",
        pp_manifest=PPManifestKey("MOCK01", "CPT", 81),
        pp_manifest_snapshot_sha256="a" * 64,
        planned_departure_at=created + timedelta(hours=2),
        planned_arrival_at=created + timedelta(hours=12),
    )
    args.update(overrides)
    return args


def test_payload_has_the_fixed_key_set_even_for_an_empty_leg() -> None:
    payload = compute_trip_canonical_payload(**_args(
        trip_type="empty_leg", pp_manifest=None, pp_manifest_snapshot_sha256=None,
        planned_arrival_at=None,
    ))

    assert set(payload) == _EXPECTED_KEYS
    assert payload["pp_manifest"] is None
    assert payload["pp_manifest_snapshot_sha256"] is None
    assert payload["planned_arrival_at"] is None


def test_order_number_is_not_in_the_lock() -> None:
    payload = compute_trip_canonical_payload(**_args())

    assert "order_number" not in payload


def test_manifest_key_is_a_named_object() -> None:
    payload = compute_trip_canonical_payload(**_args())

    assert payload["pp_manifest"] == {"issuer_account": "MOCK01", "origin_hub": "CPT", "number": 81}


def test_hash_is_deterministic() -> None:
    args = _args()

    first = compute_journey_lock_hash(compute_trip_canonical_payload(**args))
    second = compute_journey_lock_hash(compute_trip_canonical_payload(**args))

    assert first == second
    assert len(first) == 64


def test_hash_matches_canonical_json_of_payload() -> None:
    payload = compute_trip_canonical_payload(**_args())

    expected = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    assert compute_journey_lock_hash(payload) == expected


def test_trailer_order_does_not_affect_hash() -> None:
    trailers = [uuid.uuid4(), uuid.uuid4()]
    args = _args(trailer_ids=trailers)

    forward = compute_journey_lock_hash(compute_trip_canonical_payload(**args))
    reverse = compute_journey_lock_hash(
        compute_trip_canonical_payload(**{**args, "trailer_ids": list(reversed(trailers))})
    )

    assert forward == reverse


def test_offset_and_utc_forms_of_one_instant_hash_the_same() -> None:
    """A request carrying +02:00 must hash like the UTC value Postgres returns (§9)."""
    sast = timezone(timedelta(hours=2))
    instant_utc = datetime.now(UTC).replace(microsecond=0)
    args = _args(planned_departure_at=instant_utc)

    utc_hash = compute_journey_lock_hash(compute_trip_canonical_payload(**args))
    sast_hash = compute_journey_lock_hash(compute_trip_canonical_payload(
        **{**args, "planned_departure_at": instant_utc.astimezone(sast)}
    ))

    assert utc_hash == sast_hash


def test_naive_datetime_is_read_as_utc() -> None:
    """asyncpg writes a naive value to timestamptz as UTC; the lock must agree."""
    aware = datetime.now(UTC).replace(microsecond=0)
    args = _args(planned_departure_at=aware)

    aware_hash = compute_journey_lock_hash(compute_trip_canonical_payload(**args))
    naive_hash = compute_journey_lock_hash(compute_trip_canonical_payload(
        **{**args, "planned_departure_at": aware.replace(tzinfo=None)}
    ))

    assert aware_hash == naive_hash


def test_each_new_key_changes_the_hash() -> None:
    args = _args()
    base = compute_journey_lock_hash(compute_trip_canonical_payload(**args))

    variants: list[dict[str, Any]] = [
        {"pp_manifest": PPManifestKey("MOCK01", "CPT", 82)},
        {"pp_manifest_snapshot_sha256": "b" * 64},
        {"planned_departure_at": args["planned_departure_at"] + timedelta(minutes=1)},
        {"planned_arrival_at": None},
    ]

    for change in variants:
        assert compute_journey_lock_hash(compute_trip_canonical_payload(**{**args, **change})) != base


def test_snapshot_hash_ignores_key_order() -> None:
    forward = {"header": {"a": 1, "b": [1, 2]}, "waybills": []}
    reordered = {"waybills": [], "header": {"b": [1, 2], "a": 1}}

    assert compute_snapshot_sha256(forward) == compute_snapshot_sha256(reordered)
    assert canonical_json(forward) == canonical_json(reordered)
