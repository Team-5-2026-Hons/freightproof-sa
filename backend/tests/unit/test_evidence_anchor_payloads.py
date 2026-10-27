"""Unit tests for the FP-290 evidence-anchor canonical payloads (payload version 1).

The golden hashes were derived independently from plan §3.3 (hashlib + json.dumps over the
specified dict), not by calling the code under test, so they pin the contract: a change to a
key, a timestamp format or the hashing of text changes a hash here and fails loudly.
"""

import dataclasses
import json
import uuid
from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.blockchain.anchor_service import compute_payload_hash
from app.orchestration.evidence_anchors import canonical as c

TRIP = uuid.UUID("11111111-1111-4111-8111-111111111111")
EXC = uuid.UUID("22222222-2222-4222-8222-222222222222")
EVT = uuid.UUID("33333333-3333-4333-8333-333333333333")
USER = uuid.UUID("44444444-4444-4444-8444-444444444444")
PHASE = uuid.UUID("55555555-5555-4555-8555-555555555555")
ART_1 = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
ART_2 = uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
HASH_1, HASH_2 = "1" * 64, "2" * 64
DESCRIPTION = "Zinc-seal gebreek – Südafrika 🚚"
CAUSE = f"Cancelled by user {USER}: Kliënt het gekanselleer"
RAISED_AT = datetime(2026, 10, 14, 8, 30, tzinfo=UTC)
REVIEWED_AT = datetime(2026, 10, 14, 9, 0, tzinfo=UTC)
CLOSED_AT = datetime(2026, 10, 14, 10, 0, tzinfo=UTC)

GOLDEN_DESCRIPTION_SHA = "a11aeada230ca6b9cf8092b585429ad87c85bf59feaa1d067bff9e95156ebe88"
GOLDEN_CONTEXT_SHA = "f08e2030fcddf37b24a156d12e0feceeab8c7ad7bafeafd47a5a4fbe7ad69520"
GOLDEN_ACTOR_SHA = "2ba27fcc27c285ab6c4cacc6f144833ff69bd7b162d0fe79bc481f1de9cb3418"
GOLDEN_RECORD_SHA = "301539d76bbd4d02883712d17ee31039b1bc418749d0b9769bcdcf5229e7934d"
GOLDEN_RAISED_HASH = "19a1daa24315684b932d7c6f6156ed9b0d5d69df278f3f3501329597a3bb9a1e"
GOLDEN_REVIEWED_HASH = "fcb45ec787f726ca9c52bd2b81e9a106afd16d8f9f8215c453bc86c575615cc8"
GOLDEN_CANCELLED_HASH = "945edb34037590838c17452c204573c561aab4a4243e4f04a592b6c2b21c2eb9"

COMMON_KEYS = {"payload_version", "event_type", "event_id", "trip_id", "exception_id", "occurred_at"}
RAISED_KEYS = COMMON_KEYS | {
    "exception_type", "source", "severity", "description_sha256", "context_sha256", "photos",
}
REVIEWED_KEYS = COMMON_KEYS | {
    "exception_record_sha256", "reviewed_by_sha256", "review_outcome", "contact_method",
    "review_note_sha256", "authored_statement_sha256",
}
CANCELLED_KEYS = COMMON_KEYS | {"status", "cancelled_by_sha256", "cause_record_sha256"}


def _record(**overrides: object) -> c.ExceptionRecord:
    fields: dict[str, object] = {
        "trip_id": TRIP, "exception_id": EXC, "created_at": RAISED_AT,
        "exception_type": "seal_broken_in_transit", "source": "driver", "severity": "critical",
        "description": DESCRIPTION, "phase_event_id": PHASE, "checkpoint_id": None,
        "consignment_id": None, "trip_stop_id": None, "vehicle_id": None,
        "photos": (c.PhotoCommitment(ART_1, HASH_1), c.PhotoCommitment(ART_2, HASH_2)),
    }
    fields.update(overrides)
    return c.ExceptionRecord(**fields)  # type: ignore[arg-type]


def _review(**overrides: object) -> c.ReviewRecord:
    fields: dict[str, object] = {
        "reviewed_by_user_id": USER, "reviewed_at": REVIEWED_AT, "outcome": "evidence_verified",
        "contact_method": "phone", "review_note": "Rang die bestuurder",
        "authored_description": None,
    }
    fields.update(overrides)
    return c.ReviewRecord(**fields)  # type: ignore[arg-type]


def _cancellation() -> c.CancellationRecord:
    return c.CancellationRecord(
        trip_id=TRIP, exception_id=EXC, cancelled_by_user_id=USER, closed_at=CLOSED_AT,
        cause_description=CAUSE,
    )


def test_text_hash_is_utf8_sha256_of_the_exact_string() -> None:
    assert c.text_sha256(DESCRIPTION) == GOLDEN_DESCRIPTION_SHA


def test_actor_digest_is_hash_of_typed_user_object() -> None:
    assert c.actor_sha256(USER) == GOLDEN_ACTOR_SHA
    assert c.actor_sha256(USER) == compute_payload_hash({"actor_type": "user", "user_id": str(USER)})


def test_exception_record_hash_matches_golden() -> None:
    assert c.exception_record_sha256(_record()) == GOLDEN_RECORD_SHA


def test_raised_payload_matches_golden_hash() -> None:
    payload = c.exception_raised_payload(event_id=EVT, record=_record())

    assert compute_payload_hash(payload) == GOLDEN_RAISED_HASH
    assert payload["context_sha256"] == GOLDEN_CONTEXT_SHA


def test_reviewed_payload_matches_golden_hash() -> None:
    payload = c.exception_reviewed_payload(event_id=EVT, record=_record(), review=_review())

    assert compute_payload_hash(payload) == GOLDEN_REVIEWED_HASH


def test_cancelled_payload_matches_golden_hash() -> None:
    payload = c.trip_cancelled_payload(event_id=EVT, cancellation=_cancellation())

    assert compute_payload_hash(payload) == GOLDEN_CANCELLED_HASH


def test_payloads_carry_exactly_the_allowlisted_keys() -> None:
    raised = c.exception_raised_payload(event_id=EVT, record=_record())
    reviewed = c.exception_reviewed_payload(event_id=EVT, record=_record(), review=_review())
    cancelled = c.trip_cancelled_payload(event_id=EVT, cancellation=_cancellation())

    assert set(raised) == RAISED_KEYS
    assert set(reviewed) == REVIEWED_KEYS
    assert set(cancelled) == CANCELLED_KEYS
    assert [p["event_type"] for p in (raised, reviewed, cancelled)] == [
        "exception_raised", "exception_reviewed", "trip_cancelled",
    ]
    assert all(type(p["payload_version"]) is int and p["payload_version"] == 1
               for p in (raised, reviewed, cancelled))


def test_photo_entries_carry_only_artifact_id_and_sha256() -> None:
    payload = c.exception_raised_payload(event_id=EVT, record=_record())

    assert all(set(photo) == {"artifact_id", "sha256"} for photo in payload["photos"])


def test_no_photos_is_an_explicit_empty_list() -> None:
    payload = c.exception_raised_payload(event_id=EVT, record=_record(photos=()))

    assert payload["photos"] == []


def test_photo_order_does_not_change_the_hash() -> None:
    forward = _record(photos=(c.PhotoCommitment(ART_1, HASH_1), c.PhotoCommitment(ART_2, HASH_2)))
    reverse = _record(photos=(c.PhotoCommitment(ART_2, HASH_2), c.PhotoCommitment(ART_1, HASH_1)))

    assert c.exception_record_sha256(forward) == c.exception_record_sha256(reverse)
    assert [p["artifact_id"] for p in c.exception_raised_payload(event_id=EVT, record=reverse)["photos"]] \
        == [str(ART_1), str(ART_2)]


def test_changing_a_photo_hash_changes_the_record_hash() -> None:
    changed = _record(photos=(c.PhotoCommitment(ART_1, HASH_1), c.PhotoCommitment(ART_2, "3" * 64)))

    assert c.exception_record_sha256(changed) != GOLDEN_RECORD_SHA


def test_non_utc_timestamps_normalise_to_the_same_utc_instant() -> None:
    sast = timezone(timedelta(hours=2))
    local = RAISED_AT.astimezone(sast)

    payload = c.exception_raised_payload(event_id=EVT, record=_record(created_at=local))

    assert payload["occurred_at"] == "2026-10-14T08:30:00.000000+00:00"
    assert compute_payload_hash(payload) == GOLDEN_RAISED_HASH


def test_naive_timestamp_is_rejected() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        c.exception_raised_payload(event_id=EVT, record=_record(created_at=datetime(2026, 10, 14, 8, 30)))


def test_null_and_empty_review_note_hash_differently() -> None:
    null_note = c.exception_reviewed_payload(
        event_id=EVT, record=_record(), review=_review(review_note=None))
    empty_note = c.exception_reviewed_payload(
        event_id=EVT, record=_record(), review=_review(review_note=""))

    assert null_note["review_note_sha256"] is None
    assert empty_note["review_note_sha256"] == c.text_sha256("")
    assert compute_payload_hash(null_note) != compute_payload_hash(empty_note)


def test_text_is_not_trimmed_or_normalised() -> None:
    assert c.text_sha256(" a ") != c.text_sha256("a")
    assert c.text_sha256("é") != c.text_sha256("é")


def test_authored_statement_is_hashed_only_for_dispatcher_authored_rows() -> None:
    authored = c.exception_reviewed_payload(
        event_id=EVT, record=_record(), review=_review(authored_description="Phase overridden"))
    ordinary = c.exception_reviewed_payload(event_id=EVT, record=_record(), review=_review())

    assert authored["authored_statement_sha256"] == c.text_sha256("Phase overridden")
    assert ordinary["authored_statement_sha256"] is None


def test_record_types_have_no_gps_or_location_fields() -> None:
    """GPS is structurally unreachable: the value records the builders read carry none."""
    banned = ("gps", "lat", "lng", "location", "coordinate", "assessment", "s3_", "url", "path")
    for record_type in (c.ExceptionRecord, c.ReviewRecord, c.CancellationRecord, c.PhotoCommitment):
        for field in dataclasses.fields(record_type):
            assert not any(word in field.name for word in banned), (record_type, field.name)


def test_payload_contains_no_raw_text_or_identity_values() -> None:
    raised = c.exception_raised_payload(event_id=EVT, record=_record())
    reviewed = c.exception_reviewed_payload(
        event_id=EVT, record=_record(), review=_review(authored_description="Phase overridden"))
    cancelled = c.trip_cancelled_payload(event_id=EVT, cancellation=_cancellation())

    blob = json.dumps([raised, reviewed, cancelled])

    for secret in (DESCRIPTION, "Südafrika", "Rang die bestuurder", "Phase overridden", "Kliënt", str(USER)):
        assert secret not in blob


@pytest.mark.parametrize("version", [None, True, "1", 1.0, 2, 0, -1])
def test_bad_payload_versions_are_rejected(version: object) -> None:
    payload = c.exception_raised_payload(event_id=EVT, record=_record())
    payload["payload_version"] = version

    with pytest.raises(c.UnsupportedEvidencePayloadError):
        c.validate_payload_version(payload, "exception_raised")


def test_missing_payload_version_is_rejected() -> None:
    payload = c.exception_raised_payload(event_id=EVT, record=_record())
    del payload["payload_version"]

    with pytest.raises(c.UnsupportedEvidencePayloadError):
        c.validate_payload_version(payload, "exception_raised")


def test_non_object_payload_is_rejected() -> None:
    with pytest.raises(c.UnsupportedEvidencePayloadError):
        c.validate_payload_version(["not", "an", "object"], "exception_raised")


def test_event_kind_must_match_the_receipt_type() -> None:
    payload = c.exception_raised_payload(event_id=EVT, record=_record())

    with pytest.raises(c.UnsupportedEvidencePayloadError):
        c.validate_payload_version(payload, "exception_reviewed")


def test_valid_payload_passes_version_check() -> None:
    payload = c.exception_raised_payload(event_id=EVT, record=_record())

    c.validate_payload_version(payload, "exception_raised")


@pytest.mark.parametrize("event_type", [["exception_raised"], {"k": "v"}, 5, None, True])
def test_non_string_event_kind_is_rejected_not_a_crash(event_type: object) -> None:
    payload = c.exception_raised_payload(event_id=EVT, record=_record())
    payload["event_type"] = event_type

    with pytest.raises(c.UnsupportedEvidencePayloadError):
        c.validate_payload_version(payload, "exception_raised")
