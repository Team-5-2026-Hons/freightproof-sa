"""B3 — Canonical payloads and their SHA-256 hashes must not change.

Golden vectors: fixed inputs -> exact canonical payload -> exact hash. These bytes are what
was written to Hedera. If any builder's output changes by even one character, every receipt
already anchored with the old shape stops verifying, and an honest record looks like
tampering. Treat a failure here as "you are about to break verification of existing
receipts", not as "update the expected value".

Hardcoded UUIDs and digests are correct here and ONLY here. CLAUDE.md bans hardcoded IDs
in ordinary tests because they hide coupling; a golden vector is the opposite: its entire
value is that the input never varies. uuid4() or now() would make the expected hash
unwritable. These constants must therefore never be derived or regenerated at runtime.
There is deliberately no UPDATE_SNAPSHOTS switch for this file: changing a vector is an
edit a reviewer sees in the diff, together with an explanation of how old receipts stay valid.

Builders are imported through the compatibility facade (app.orchestration.phase_service),
which is an import, not a patch, so it stays legal after the phases/ package exists (audit
section 5.5).
"""

import uuid
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import pytest

from app.blockchain.anchor_service import compute_payload_hash
from app.crypto.hashing import (
    PPManifestKey, StopCommitment, compute_journey_lock_hash, compute_trip_canonical_payload,
    compute_trip_canonical_payload_v2,
)
from app.db.models.enums import PhaseType
from app.orchestration.phase_service import (
    compute_activation_canonical_payload_v2,
    compute_arrival_canonical_payload_v2,
    compute_confirmation_canonical_payload_v1,
    compute_confirmation_canonical_payload_v2,
    compute_departure_canonical_payload_v1,
    compute_departure_canonical_payload_v2,
    compute_in_transit_canonical_payload_v2,
    compute_loading_canonical_payload_v2,
    compute_override_canonical_payload_v2,
    compute_unloading_canonical_payload_v2,
)

PHASE_EVENT_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
TRIP_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
USER_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")
DRIVER_ID = uuid.UUID("44444444-4444-4444-8444-444444444444")
HORSE_ID = uuid.UUID("55555555-5555-4555-8555-555555555555")
TRAILER_A_ID = uuid.UUID("66666666-6666-4666-8666-666666666666")
TRAILER_B_ID = uuid.UUID("77777777-7777-4777-8777-777777777777")
ORIGIN_PRECINCT_ID = uuid.UUID("88888888-8888-4888-8888-888888888888")
DESTINATION_PRECINCT_ID = uuid.UUID("99999999-9999-4999-8999-999999999999")

# Stand-ins for file digests; the builders treat them as opaque strings.
DIGEST_A = "a" * 64
DIGEST_B = "b" * 64
DIGEST_C = "c" * 64

_BASE_V2: dict[str, Any] = {
    "payload_version": 2,
    "phase_event_id": str(PHASE_EVENT_ID),
    "trip_id": str(TRIP_ID),
}


def _v2(phase_type: str, **extra: Any) -> dict[str, Any]:
    return {**_BASE_V2, "phase_type": phase_type, **extra}


# (builder output, expected canonical payload, expected SHA-256)
_PHASE_VECTORS: dict[str, tuple[dict[str, Any], dict[str, Any], str]] = {
    "activation_v2": (
        compute_activation_canonical_payload_v2(phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID),
        _v2("activation"),
        "1a57d8c7032b43767e421d99483a6a70917ee073761a98400c818d9876bc218f",
    ),
    "loading_v2": (
        compute_loading_canonical_payload_v2(
            phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID,
            parcel_count_origin=42, linehaul_photo_sha256=DIGEST_A,
        ),
        _v2("loading", parcel_count_origin=42, linehaul_photo_sha256=DIGEST_A),
        "95c639664b4ae951611a62605b5db4c5d6c11e175d1ab6e5980e41421166b800",
    ),
    "departure_v1": (
        compute_departure_canonical_payload_v1(
            phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID, seal_number="AB-1234",
        ),
        {
            "phase_event_id": str(PHASE_EVENT_ID), "trip_id": str(TRIP_ID),
            "phase_type": "departure", "seal_number": "AB-1234",
        },
        "c355d6946be8954eb1d0d01bbd46f2b0ef5791d8cdddcaeec3cc1f2a889a91ae",
    ),
    "departure_v2": (
        compute_departure_canonical_payload_v2(
            phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID, seal_number="AB-1234",
            seal_photo_sha256=DIGEST_A, waybill_photo_sha256=DIGEST_B,
        ),
        _v2("departure", seal_number="AB-1234", seal_photo_sha256=DIGEST_A, waybill_photo_sha256=DIGEST_B),
        "2744c10084201114c05950d51f87e081339e0ccc2b1c5c7837b8c1e39d48844f",
    ),
    "in_transit_v2": (
        compute_in_transit_canonical_payload_v2(phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID),
        _v2("in_transit"),
        "118a7b2613324cb1ee6d0d3ecd7b33af39fb48237b6e2c9da8d5730f4c4e9cc7",
    ),
    "arrival_v2": (
        compute_arrival_canonical_payload_v2(
            phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID, seal_number="AB-1234",
            seal_condition="intact", seal_photo_sha256=DIGEST_A,
        ),
        _v2("arrival", seal_number="AB-1234", seal_condition="intact", seal_photo_sha256=DIGEST_A),
        "fd486e4ed00de73e95a9b0b3019a27f6134f0b1c0fe7d876728c487655a6812c",
    ),
    "unloading_v2": (
        compute_unloading_canonical_payload_v2(phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID),
        _v2("unloading"),
        "964058f4728c2f9bae06100fde068d52c9d3cdd284bea96831560ebf7a68093d",
    ),
    "confirmation_v1": (
        compute_confirmation_canonical_payload_v1(
            phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID, pp_scan_in_count=42, driver_visual_count=40,
        ),
        {
            "phase_event_id": str(PHASE_EVENT_ID), "trip_id": str(TRIP_ID),
            "phase_type": "confirmation", "pp_scan_in_count": 42, "driver_visual_count": 40,
        },
        "ac37b94c93af64e07facfae4e40d3dcbba31143429cfda530d72f5f139661cc4",
    ),
    "confirmation_v2": (
        compute_confirmation_canonical_payload_v2(
            phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID, pp_scan_in_count=42, driver_visual_count=40,
            pod_photo_sha256=DIGEST_A, pod_signature_sha256=DIGEST_B,
        ),
        _v2(
            "confirmation", pp_scan_in_count=42, driver_visual_count=40,
            pod_photo_sha256=DIGEST_A, pod_signature_sha256=DIGEST_B,
        ),
        "379107d06989da8305c82e5c4df0c89c84950b9cb4c73d508e64dc9cbf057a14",
    ),
    "override_v2": (
        compute_override_canonical_payload_v2(
            phase_event_id=PHASE_EVENT_ID, trip_id=TRIP_ID, phase_type=PhaseType.DEPARTURE,
            override_user_id=USER_ID, override_note="Seal cut at customs inspection",
        ),
        _v2(
            "departure", phase_status="overridden",
            overridden_by_sha256="3b793ec77d5d67588e92d0822ca5474d24b92cfe5ded67bd2496b039ca4a3a65",
            override_note_sha256="bdc48b8eb28cb1974ea30df36aa1253ced1cfc0ff7f9291b4c1a08ea052f3901",
        ),
        "db39bd83c7c0f1dba78150a201f836c356585eb237efacfe45d6cfd884504638",
    ),
}


@pytest.mark.parametrize("vector", sorted(_PHASE_VECTORS))
def test_phase_payload_builder_output_is_byte_for_byte_the_golden_payload(vector: str) -> None:
    built, expected_payload, _expected_hash = _PHASE_VECTORS[vector]

    assert built == expected_payload


@pytest.mark.parametrize("vector", sorted(_PHASE_VECTORS))
def test_phase_payload_hash_is_the_golden_sha256(vector: str) -> None:
    built, _expected_payload, expected_hash = _PHASE_VECTORS[vector]

    assert compute_payload_hash(built) == expected_hash


def test_there_is_one_golden_vector_for_each_of_the_ten_payload_builders() -> None:
    assert len(_PHASE_VECTORS) == 10


def _trip_payload() -> dict[str, Any]:
    return compute_trip_canonical_payload(
        trip_id=TRIP_ID, driver_id=DRIVER_ID, horse_id=HORSE_ID,
        # Deliberately out of order: the payload sorts trailers, so insertion order must not matter.
        trailer_ids=[TRAILER_B_ID, TRAILER_A_ID],
        origin_precinct_id=ORIGIN_PRECINCT_ID, destination_precinct_id=DESTINATION_PRECINCT_ID,
        created_by_user_id=USER_ID,
        created_at=datetime(2026, 1, 15, 8, 30, 0, tzinfo=UTC),
        trip_type="linehaul",
        pp_manifest=PPManifestKey(issuer_account="ACC1", origin_hub="CPT", number=1234),
        pp_manifest_snapshot_sha256=DIGEST_C,
        # +02:00 and naive inputs: both must normalise to UTC, the form Postgres returns on verify.
        planned_departure_at=datetime(2026, 1, 15, 10, 0, 0, tzinfo=timezone(timedelta(hours=2))),
        planned_arrival_at=datetime(2026, 1, 16, 6, 0, 0),
    )


def test_trip_journey_lock_payload_is_byte_for_byte_the_golden_payload() -> None:
    expected = {
        "trip_id": str(TRIP_ID),
        "driver_id": str(DRIVER_ID),
        "horse_id": str(HORSE_ID),
        "trailers": [str(TRAILER_A_ID), str(TRAILER_B_ID)],
        "origin_precinct_id": str(ORIGIN_PRECINCT_ID),
        "destination_precinct_id": str(DESTINATION_PRECINCT_ID),
        "created_by_user_id": str(USER_ID),
        "created_at": "2026-01-15T08:30:00+00:00",
        "trip_type": "linehaul",
        "pp_manifest": {"issuer_account": "ACC1", "origin_hub": "CPT", "number": 1234},
        "pp_manifest_snapshot_sha256": DIGEST_C,
        "planned_departure_at": "2026-01-15T08:00:00+00:00",
        "planned_arrival_at": "2026-01-16T06:00:00+00:00",
    }

    assert _trip_payload() == expected


def test_trip_journey_lock_hash_is_the_golden_sha256() -> None:
    payload = _trip_payload()

    assert compute_journey_lock_hash(payload) == "a3b87bb27053cf4437ec035929dbdfdec6d95bc2ebe1cf2ab2aca4f431e97e7a"


# ── Journey lock v2 (commits to the ordered stops). The v1 vector above stays as it is:
# receipts anchored before v2 must keep verifying. Payload and hash below were written once,
# the hash computed from the hand-written payload with hashlib rather than from the builder.

MIDDLE_PRECINCT_ID = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")


def _trip_payload_v2() -> dict[str, Any]:
    return compute_trip_canonical_payload_v2(
        trip_id=TRIP_ID, driver_id=DRIVER_ID, horse_id=HORSE_ID,
        trailer_ids=[TRAILER_B_ID, TRAILER_A_ID],
        origin_precinct_id=ORIGIN_PRECINCT_ID, destination_precinct_id=DESTINATION_PRECINCT_ID,
        created_by_user_id=USER_ID,
        created_at=datetime(2026, 1, 15, 8, 30, 0, tzinfo=UTC),
        trip_type="linehaul",
        pp_manifest=PPManifestKey(issuer_account="ACC1", origin_hub="CPT", number=1234),
        pp_manifest_snapshot_sha256=DIGEST_C,
        planned_departure_at=datetime(2026, 1, 15, 10, 0, 0, tzinfo=timezone(timedelta(hours=2))),
        planned_arrival_at=datetime(2026, 1, 16, 6, 0, 0),
        # Deliberately out of order, one stop without a slot and one with a +02:00 slot.
        stops=[
            StopCommitment(2, DESTINATION_PRECINCT_ID, datetime(2026, 1, 16, 6, 0, 0)),
            StopCommitment(0, ORIGIN_PRECINCT_ID, datetime(2026, 1, 15, 10, 0, 0, tzinfo=timezone(timedelta(hours=2)))),
            StopCommitment(1, MIDDLE_PRECINCT_ID, None),
        ],
    )


def test_trip_journey_lock_v2_payload_is_byte_for_byte_the_golden_payload() -> None:
    expected = {
        "trip_id": str(TRIP_ID),
        "driver_id": str(DRIVER_ID),
        "horse_id": str(HORSE_ID),
        "trailers": [str(TRAILER_A_ID), str(TRAILER_B_ID)],
        "origin_precinct_id": str(ORIGIN_PRECINCT_ID),
        "destination_precinct_id": str(DESTINATION_PRECINCT_ID),
        "created_by_user_id": str(USER_ID),
        "created_at": "2026-01-15T08:30:00+00:00",
        "trip_type": "linehaul",
        "pp_manifest": {"issuer_account": "ACC1", "origin_hub": "CPT", "number": 1234},
        "pp_manifest_snapshot_sha256": DIGEST_C,
        "planned_departure_at": "2026-01-15T08:00:00+00:00",
        "planned_arrival_at": "2026-01-16T06:00:00+00:00",
        "payload_version": 2,
        "stops": [
            {"sequence": 0, "precinct_id": str(ORIGIN_PRECINCT_ID), "slot_time": "2026-01-15T08:00:00+00:00"},
            {"sequence": 1, "precinct_id": str(MIDDLE_PRECINCT_ID), "slot_time": None},
            {"sequence": 2, "precinct_id": str(DESTINATION_PRECINCT_ID), "slot_time": "2026-01-16T06:00:00+00:00"},
        ],
    }

    assert _trip_payload_v2() == expected


def test_trip_journey_lock_v2_hash_is_the_golden_sha256() -> None:
    payload = _trip_payload_v2()

    assert compute_journey_lock_hash(payload) == "cefc8ffa1a5ceb8b5e23b99488cae35a1876880a3e86edaa281918e13761632c"
