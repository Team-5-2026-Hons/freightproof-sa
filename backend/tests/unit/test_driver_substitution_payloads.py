"""FP-83 C5: the pure custody commitments (substitutions.canonical)."""

import dataclasses
import hashlib
import json
import uuid
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.blockchain.anchor_service import compute_payload_hash
from app.orchestration.substitutions import canonical

T0 = datetime(2026, 10, 19, 8, 0, tzinfo=UTC)
REASON = "Driver Thandi Mokoena reached her shift limit"
NOTE = "Strap on trailer 2 frayed, photographed"


def capture(role: str, *, photos: tuple[canonical.PhotoCommitment, ...] = ()) -> canonical.CaptureCommitment:
    return canonical.CaptureCommitment(
        role=role, confirmation_id=uuid.uuid4(), driver_id=uuid.uuid4(), captured_at=T0, received_at=T0,
        location_sha256=canonical.location_hash(Decimal("-32.35"), Decimal("22.58"), Decimal("8")),
        vehicles_sha256=canonical.vehicles_hash([uuid.uuid4()]),
        seal_checks_sha256=canonical.seal_checks_hash([{"condition": "intact", "seal_number": "AB-1234"}]),
        note_sha256=canonical.text_hash_or_none(NOTE), photos=photos,
    )


def record(**overrides: object) -> canonical.CompletedSubstitutionRecord:
    base = canonical.CompletedSubstitutionRecord(
        substitution_id=uuid.uuid4(), trip_id=uuid.uuid4(), request_id=uuid.uuid4(), sequence_number=1,
        previous_substitution_id=None, previous_event_hash=None, outgoing_driver_id=uuid.uuid4(),
        incoming_driver_id=uuid.uuid4(), arranged_by_user_id=uuid.uuid4(), is_planned=True,
        reason_sha256=canonical.sha256_text(REASON),
        exchange_sha256=canonical.exchange_hash(label="Beaufort West depot", latitude=-32.35, longitude=22.58, instructions="Gate 2"),
        expected_at=T0, effective_at=T0 + timedelta(minutes=5), declared_exchange_at=None, completion_mode="normal",
        completed_by_driver_id=uuid.uuid4(), completed_by_user_id=None, missing_confirmation_reason_sha256=None,
        identity=canonical.IdentityCommitment("verified", T0, T0, None, None, None),
        licence_expiry=date(2027, 1, 1), eligibility_observed_at=T0,
        captures=(capture("outgoing"), capture("incoming")),
    )
    return dataclasses.replace(base, **overrides)  # type: ignore[arg-type]


def test_the_payload_is_deterministic_and_hashes_canonically():
    r = record()

    first, second = canonical.compute_substitution_payload(record=r), canonical.compute_substitution_payload(record=r)

    assert first == second
    assert compute_payload_hash(first) == canonical.canonical_hash(first)
    assert first["payload_version"] == 1 and first["event_type"] == "driver_substitution"


def test_free_text_and_positions_never_appear_in_the_payload():
    payload = json.dumps(canonical.compute_substitution_payload(record=record()))

    for secret in (REASON, NOTE, "Beaufort West", "Gate 2", "-32.35", "22.58", "Thandi"):
        assert secret not in payload


def test_both_roles_are_always_present_and_a_missing_capture_is_explicit():
    payload = canonical.compute_substitution_payload(record=record(captures=(capture("outgoing"),)))

    assert set(payload["captures"]) == {"outgoing", "incoming"}
    assert payload["captures"]["incoming"] is None


@pytest.mark.parametrize("field,value", [
    ("sequence_number", 2), ("previous_event_hash", "f" * 64), ("completion_mode", "dispatcher_attested"),
    ("effective_at", T0 + timedelta(minutes=6)), ("licence_expiry", date(2027, 1, 2)),
])
def test_every_committed_fact_changes_the_hash(field: str, value: object):
    r = record()

    changed = canonical.compute_substitution_payload(record=dataclasses.replace(r, **{field: value}))  # type: ignore[arg-type]

    assert compute_payload_hash(changed) != compute_payload_hash(canonical.compute_substitution_payload(record=r))


def test_a_photos_bytes_hash_is_committed():
    photo = canonical.PhotoCommitment(uuid.uuid4(), uuid.uuid4(), 0, "a" * 64)
    r = record(captures=(capture("outgoing", photos=(photo,)), capture("incoming")))
    edited = dataclasses.replace(r, captures=(
        dataclasses.replace(r.captures[0], photos=(dataclasses.replace(photo, file_sha256="b" * 64),)), r.captures[1],
    ))

    assert compute_payload_hash(canonical.compute_substitution_payload(record=r)) != compute_payload_hash(
        canonical.compute_substitution_payload(record=edited)
    )


def test_stored_and_in_memory_decimals_and_offsets_hash_alike():
    # The database hands back Decimal('-32.3500000') and a UTC offset; the request may carry a
    # float and +02:00. Both must commit to the same values.
    assert canonical.location_hash(-32.35, 22.58, 8.0) == canonical.location_hash(
        Decimal("-32.3500000"), Decimal("22.5800000"), Decimal("8.00"),
    )
    sast = timezone(timedelta(hours=2))
    assert canonical.compute_substitution_payload(record=record(expected_at=T0.astimezone(sast)))["expected_at"] == \
        canonical.compute_substitution_payload(record=record(expected_at=T0))["expected_at"]


def test_an_absent_location_is_kept_absent():
    assert canonical.location_hash(None, None, None) is None


def test_unknown_payload_versions_are_refused():
    payload = canonical.compute_substitution_payload(record=record())

    with pytest.raises(canonical.UnsupportedPayload):
        canonical.validate_substitution_payload({**payload, "payload_version": 2})
    with pytest.raises(canonical.UnsupportedPayload):
        canonical.validate_substitution_payload({**payload, "event_type": "driver_substitution_corrected"})


def test_the_correction_commitment_is_the_c3_v1_format_unchanged():
    correction = canonical.CorrectionRecord(
        correction_id=uuid.uuid4(), substitution_id=uuid.uuid4(), trip_id=uuid.uuid4(),
        recorded_by_user_id=uuid.uuid4(), recorded_at=T0, reason="Wrong depot name", correction_note="It was Gate 3",
    )

    payload = canonical.compute_correction_payload(record=correction)

    # Exactly what substitutions.service wrote before C5, so existing hashes still verify.
    assert payload == {
        "payload_version": 1, "event_type": "driver_substitution_corrected",
        "correction_id": str(correction.correction_id), "substitution_id": str(correction.substitution_id),
        "trip_id": str(correction.trip_id), "recorded_by_user_id": str(correction.recorded_by_user_id),
        "recorded_at": T0.isoformat(),
        "reason_sha256": hashlib.sha256(b"Wrong depot name").hexdigest(),
        "note_sha256": hashlib.sha256(b"It was Gate 3").hexdigest(),
    }
