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
    compute_trip_canonical_payload_v2,
    StopCommitment,
    TRIP_PAYLOAD_VERSION_V2,
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


# ── Journey lock payload v2: commits to the ordered stops ───────────────────────

def _stops() -> list[StopCommitment]:
    base = datetime(2026, 3, 1, 8, 0, tzinfo=UTC)
    return [
        StopCommitment(sequence=0, precinct_id=uuid.uuid4(), slot_time=base),
        StopCommitment(sequence=1, precinct_id=uuid.uuid4(), slot_time=None),
        StopCommitment(sequence=2, precinct_id=uuid.uuid4(), slot_time=base + timedelta(hours=9)),
    ]


def test_v2_payload_is_the_v1_payload_plus_version_and_stops() -> None:
    args = _args()
    stops = _stops()

    v1 = compute_trip_canonical_payload(**args)
    v2 = compute_trip_canonical_payload_v2(**args, stops=stops)

    assert {k: v2[k] for k in v1} == v1
    assert set(v2) == set(v1) | {"payload_version", "stops"}
    assert v2["payload_version"] == TRIP_PAYLOAD_VERSION_V2 == 2


def test_v2_hash_differs_from_v1_for_the_same_trip() -> None:
    args = _args()

    v1_hash = compute_journey_lock_hash(compute_trip_canonical_payload(**args))
    v2_hash = compute_journey_lock_hash(compute_trip_canonical_payload_v2(**args, stops=_stops()))

    assert v1_hash != v2_hash


def test_v2_stop_input_order_does_not_affect_the_hash() -> None:
    args = _args()
    stops = _stops()

    forward = compute_trip_canonical_payload_v2(**args, stops=stops)
    shuffled = compute_trip_canonical_payload_v2(**args, stops=[stops[2], stops[0], stops[1]])

    assert forward == shuffled
    assert [s["sequence"] for s in forward["stops"]] == [0, 1, 2]


def test_v2_changing_any_stop_field_changes_the_hash() -> None:
    args = _args()
    stops = _stops()
    base = compute_journey_lock_hash(compute_trip_canonical_payload_v2(**args, stops=stops))

    other_precinct = [stops[0], stops[1]._replace(precinct_id=uuid.uuid4()), stops[2]]
    other_slot = [stops[0], stops[1]._replace(slot_time=datetime(2026, 3, 2, tzinfo=UTC)), stops[2]]
    dropped_stop = stops[:2]

    for changed in (other_precinct, other_slot, dropped_stop):
        assert compute_journey_lock_hash(compute_trip_canonical_payload_v2(**args, stops=changed)) != base


def test_v2_slot_time_none_is_null_and_aware_times_are_normalised_to_utc() -> None:
    sast = timezone(timedelta(hours=2))
    instant = datetime(2026, 3, 1, 8, 0, tzinfo=UTC)
    precinct = uuid.uuid4()
    args = _args()

    payload = compute_trip_canonical_payload_v2(**args, stops=[
        StopCommitment(0, precinct, None),
        StopCommitment(1, precinct, instant.astimezone(sast)),
        StopCommitment(2, precinct, instant.replace(tzinfo=None)),
    ])

    assert [s["slot_time"] for s in payload["stops"]] == [
        None, "2026-03-01T08:00:00+00:00", "2026-03-01T08:00:00+00:00",
    ]
