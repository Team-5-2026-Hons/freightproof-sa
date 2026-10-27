"""WI-27 item 3: pins the v4 phase actor envelope's exact keys and its golden hash.

Characterisation, written before WI-21/WI-22 touch the anchor dispatch path that stamps this
envelope. Every driver-performed phase anchors a payload of exactly this shape, and
verification rebuilds it from live rows: a key added, renamed or reordered here changes every
hash already on Hedera. The literals below are therefore deliberate and must not be
"refreshed" to make a failing test pass.
"""

import uuid

from app.blockchain.anchor_service import compute_payload_hash
from app.orchestration.phases.payloads import (
    PHASE_PAYLOAD_VERSION_V4,
    compute_activation_canonical_payload_v2,
    compute_phase_actor_envelope_v4,
    driver_actor_sha256,
)

_PHASE_EVENT_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")
_TRIP_ID = uuid.UUID("00000000-0000-4000-8000-000000000002")
_DRIVER_ID = uuid.UUID("00000000-0000-4000-8000-000000000003")
_CUSTODY_SEQUENCE = 2

_GOLDEN_ACTOR_SHA256 = "b250c5e1f670411b2c1767819d669777950416b768a60e9d6b975da6188467bc"
_GOLDEN_ENVELOPE_HASH = "443472077fbbb5841c915bf9f5ce75b31783b988318261a73fdfce227d005ae3"

_ENVELOPE_KEYS = {"payload_version", "phase_event_id", "evidence", "actor_sha256", "custody_sequence"}


def _envelope() -> dict[str, object]:
    evidence = compute_activation_canonical_payload_v2(phase_event_id=_PHASE_EVENT_ID, trip_id=_TRIP_ID)
    return compute_phase_actor_envelope_v4(
        phase_event_id=_PHASE_EVENT_ID, evidence=evidence, driver_id=_DRIVER_ID,
        custody_sequence=_CUSTODY_SEQUENCE,
    )


def test_envelope_has_exactly_the_five_documented_keys() -> None:
    envelope = _envelope()

    assert set(envelope) == _ENVELOPE_KEYS
    assert envelope["payload_version"] == PHASE_PAYLOAD_VERSION_V4 == 4


def test_envelope_embeds_the_evidence_payload_verbatim() -> None:
    evidence = compute_activation_canonical_payload_v2(phase_event_id=_PHASE_EVENT_ID, trip_id=_TRIP_ID)

    envelope = _envelope()

    assert envelope["evidence"] == evidence
    assert envelope["evidence"]["payload_version"] == 2
    assert envelope["phase_event_id"] == str(_PHASE_EVENT_ID)
    assert envelope["custody_sequence"] == _CUSTODY_SEQUENCE


def test_driver_actor_commitment_is_a_pinned_opaque_hash_not_the_driver_id() -> None:
    commitment = driver_actor_sha256(_DRIVER_ID)

    assert commitment == _GOLDEN_ACTOR_SHA256
    assert str(_DRIVER_ID) not in commitment


def test_envelope_hash_matches_the_golden_value() -> None:
    envelope = _envelope()

    assert envelope["actor_sha256"] == _GOLDEN_ACTOR_SHA256
    assert compute_payload_hash(envelope) == _GOLDEN_ENVELOPE_HASH


def test_envelope_hash_changes_with_the_custody_period() -> None:
    first = _envelope()
    evidence = compute_activation_canonical_payload_v2(phase_event_id=_PHASE_EVENT_ID, trip_id=_TRIP_ID)

    later_period = compute_phase_actor_envelope_v4(
        phase_event_id=_PHASE_EVENT_ID, evidence=evidence, driver_id=_DRIVER_ID,
        custody_sequence=_CUSTODY_SEQUENCE + 1,
    )

    assert compute_payload_hash(later_period) != compute_payload_hash(first)
