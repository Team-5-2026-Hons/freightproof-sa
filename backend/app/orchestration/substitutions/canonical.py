"""The versioned commitments a completed handover and its corrections are anchored by (FP-83 C5).

Pure: no database, no clock. The same builders serve freezing (at completion) and verification
(rebuilding from live rows), so the two cannot drift apart. Hashing is anchor_service's
canonical JSON (sorted keys, compact separators).

What a substitution commitment contains, and why:

- Opaque ids (trip, request, drivers, dispatchers, confirmations, artifacts) and the chain
  position: sequence number, previous link id and the previous link's own event hash, so
  deleting or editing an earlier amendment breaks every later one.
- Every driver capture (or its explicit absence): capture and receipt times, which vehicles,
  a hash of the seal readings, a hash of the location, the note's hash and each photo's
  stored-bytes hash.
- The completion facts: mode, the one triggering actor, the identity status as observed and
  any admin attestation (kept separate, never relabelled), and the licence eligibility observed.
- Free text (reasons, notes, the exchange label and instructions) and positions appear only as
  SHA-256 hashes. Only the payload's own hash ever reaches Hedera (POPIA); the payload itself
  stays in PostgreSQL, and hashing its text keeps even the stored commitment free of PII.

The correction commitment is the C3 local v1 (substitutions.service) adopted unchanged, so the
hashes already written with existing corrections remain valid.
"""

import hashlib
import json
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

SUBSTITUTION_PAYLOAD_VERSION = 1
SUBSTITUTION_EVENT_TYPE = "driver_substitution"
CORRECTION_PAYLOAD_VERSION = 1
CORRECTION_EVENT_TYPE = "driver_substitution_corrected"

_COORDINATE_PLACES = Decimal("0.0000001")
_ACCURACY_PLACES = Decimal("0.01")


class UnsupportedPayload(ValueError):
    """A stored payload of a version or kind this module does not know how to rebuild."""


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canonical_hash(value: object) -> str:
    return sha256_text(json.dumps(value, sort_keys=True, separators=(",", ":")))


def _iso(moment: datetime | None) -> str | None:
    if moment is None:
        return None
    if moment.tzinfo is None:
        raise ValueError("custody timestamps must be timezone-aware")
    return moment.astimezone(UTC).isoformat(timespec="microseconds")


def _id(value: uuid.UUID | None) -> str | None:
    return None if value is None else str(value)


def _text_hash(value: str | None) -> str | None:
    return None if value is None else sha256_text(value)


def _decimal(value: Decimal | float | None, places: Decimal) -> str | None:
    return None if value is None else str(Decimal(str(value)).quantize(places))


def location_hash(
    latitude: Decimal | float | None, longitude: Decimal | float | None, accuracy: Decimal | float | None = None,
) -> str | None:
    """A position's commitment, or None when none was captured (absence is kept, not hashed)."""
    if latitude is None or longitude is None:
        return None
    return canonical_hash([
        _decimal(latitude, _COORDINATE_PLACES), _decimal(longitude, _COORDINATE_PLACES),
        _decimal(accuracy, _ACCURACY_PLACES),
    ])


@dataclass(frozen=True)
class PhotoCommitment:
    artifact_id: uuid.UUID
    vehicle_id: uuid.UUID
    position: int
    file_sha256: str


@dataclass(frozen=True)
class CaptureCommitment:
    role: str
    confirmation_id: uuid.UUID
    driver_id: uuid.UUID
    captured_at: datetime
    received_at: datetime
    location_sha256: str | None
    vehicles_sha256: str
    seal_checks_sha256: str
    note_sha256: str | None
    photos: tuple[PhotoCommitment, ...]
    location_observed_at: datetime | None = None
    location_unavailable_reason: str | None = None


@dataclass(frozen=True)
class IdentityCommitment:
    status: str | None
    last_verified_at: datetime | None
    observed_at: datetime | None
    attested_by_user_id: uuid.UUID | None
    attestation_reason_sha256: str | None
    attested_at: datetime | None


@dataclass(frozen=True)
class CompletedSubstitutionRecord:
    """The persisted completed facts, as read from the rows (see substitutions.anchors)."""

    substitution_id: uuid.UUID
    trip_id: uuid.UUID
    request_id: uuid.UUID
    sequence_number: int
    previous_substitution_id: uuid.UUID | None
    previous_event_hash: str | None
    outgoing_driver_id: uuid.UUID
    incoming_driver_id: uuid.UUID
    arranged_by_user_id: uuid.UUID
    is_planned: bool | None
    reason_sha256: str
    exchange_sha256: str | None
    expected_at: datetime | None
    effective_at: datetime
    declared_exchange_at: datetime | None
    completion_mode: str | None
    completed_by_driver_id: uuid.UUID | None
    completed_by_user_id: uuid.UUID | None
    missing_confirmation_reason_sha256: str | None
    identity: IdentityCommitment
    licence_expiry: date | None
    eligibility_observed_at: datetime | None
    captures: tuple[CaptureCommitment, ...]
    request_format: str = "planned_v1"
    reservation_start_at: datetime | None = None


def _capture_payload(capture: CaptureCommitment) -> dict[str, Any]:
    return {
        "role": capture.role, "confirmation_id": str(capture.confirmation_id), "driver_id": str(capture.driver_id),
        "captured_at": _iso(capture.captured_at), "received_at": _iso(capture.received_at),
        "location_sha256": capture.location_sha256, "vehicles_sha256": capture.vehicles_sha256,
        "seal_checks_sha256": capture.seal_checks_sha256, "note_sha256": capture.note_sha256,
        "photos": [
            {"artifact_id": str(p.artifact_id), "vehicle_id": str(p.vehicle_id), "position": p.position,
             "file_sha256": p.file_sha256}
            for p in sorted(capture.photos, key=lambda photo: photo.position)
        ],
    }


def compute_substitution_payload(*, record: CompletedSubstitutionRecord, payload_version: int = 1) -> dict[str, Any]:
    """The anchored payload for one completed handover (payload_version 1)."""
    identity = record.identity
    if payload_version not in (1, 2):
        raise UnsupportedPayload("Unknown driver substitution payload version")
    by_role = {capture.role: capture for capture in record.captures}
    payload: dict[str, Any] = {
        "payload_version": payload_version,
        "event_type": SUBSTITUTION_EVENT_TYPE,
        "substitution_id": str(record.substitution_id),
        "trip_id": str(record.trip_id),
        "request_id": str(record.request_id),
        "sequence_number": record.sequence_number,
        "previous_substitution_id": _id(record.previous_substitution_id),
        "previous_event_hash": record.previous_event_hash,
        "outgoing_driver_id": str(record.outgoing_driver_id),
        "incoming_driver_id": str(record.incoming_driver_id),
        "arranged_by_user_id": str(record.arranged_by_user_id),
        "is_planned": record.is_planned,
        "reason_sha256": record.reason_sha256,
        "exchange_sha256": record.exchange_sha256,
        "expected_at": _iso(record.expected_at),
        "effective_at": _iso(record.effective_at),
        "declared_exchange_at": _iso(record.declared_exchange_at),
        "completion_mode": record.completion_mode,
        "completed_by_driver_id": _id(record.completed_by_driver_id),
        "completed_by_user_id": _id(record.completed_by_user_id),
        "missing_confirmation_reason_sha256": record.missing_confirmation_reason_sha256,
        "identity": {
            "status": identity.status, "last_verified_at": _iso(identity.last_verified_at),
            "observed_at": _iso(identity.observed_at), "attested_by_user_id": _id(identity.attested_by_user_id),
            "attestation_reason_sha256": identity.attestation_reason_sha256,
            "attested_at": _iso(identity.attested_at),
        },
        "licence": {
            "expiry": None if record.licence_expiry is None else record.licence_expiry.isoformat(),
            "observed_at": _iso(record.eligibility_observed_at),
        },
        "captures": {
            role: (None if role not in by_role else _capture_payload(by_role[role]))
            for role in ("outgoing", "incoming")
        },
    }
    if payload_version == 2:
        if record.request_format != "immediate_v2" or record.reservation_start_at is None:
            raise UnsupportedPayload("Immediate commitment needs its persisted request format and start")
        if "outgoing" in by_role or "incoming" not in by_role:
            raise UnsupportedPayload("Immediate commitment requires actual incoming acceptance only")
        for key in ("is_planned", "exchange_sha256", "expected_at"):
            del payload[key]
        payload.update(request_format=record.request_format, reservation_start_at=_iso(record.reservation_start_at),
                       confirmation_policy="incoming_acceptance_v2", required_confirmation_roles=["incoming"])
        for role, capture in by_role.items():
            payload["captures"][role].update(location_observed_at=_iso(capture.location_observed_at),
                                             location_unavailable_reason=capture.location_unavailable_reason)
    elif record.request_format != "planned_v1":
        raise UnsupportedPayload("Legacy commitment requires its original request format")
    return payload


def exchange_hash(*, label: str, latitude: Decimal | float, longitude: Decimal | float, instructions: str | None) -> str:
    return canonical_hash([
        sha256_text(label), location_hash(latitude, longitude), _text_hash(instructions),
    ])


def seal_checks_hash(seal_checks: object) -> str:
    """The stored SealCheck snapshot (JSON) as declared: numbers, conditions, photo ids, reasons."""
    return canonical_hash(seal_checks)


def vehicles_hash(vehicle_ids: Iterable[object]) -> str:
    return canonical_hash(sorted(str(vehicle_id) for vehicle_id in vehicle_ids))


def text_hash_or_none(value: str | None) -> str | None:
    return _text_hash(value)


def validate_substitution_payload(payload: object) -> dict[str, Any]:
    """The stored payload, if it is a version and kind this module rebuilds."""
    if (
        not isinstance(payload, dict)
        or payload.get("payload_version") not in (1, 2)
        or payload.get("event_type") != SUBSTITUTION_EVENT_TYPE
    ):
        raise UnsupportedPayload("not a known driver substitution payload")
    if payload["payload_version"] == 2:
        captures = payload.get("captures")
        if (payload.get("request_format") != "immediate_v2"
                or payload.get("confirmation_policy") != "incoming_acceptance_v2"
                or payload.get("required_confirmation_roles") != ["incoming"]
                or payload.get("reservation_start_at") is None
                or any(key in payload for key in ("expected_at", "exchange_sha256", "is_planned"))
                or not isinstance(captures, dict) or captures.get("outgoing") is not None
                or not isinstance(captures.get("incoming"), dict)):
            raise UnsupportedPayload("inconsistent immediate driver substitution payload")
    return payload



@dataclass(frozen=True)
class CorrectionRecord:
    correction_id: uuid.UUID
    substitution_id: uuid.UUID
    trip_id: uuid.UUID
    recorded_by_user_id: uuid.UUID
    recorded_at: datetime
    reason: str
    correction_note: str


def compute_correction_payload(*, record: CorrectionRecord) -> dict[str, Any]:
    """The C3 v1 correction commitment, byte-for-byte: `recorded_at.isoformat()` (not _iso) and
    the reason/note hashed, exactly as substitutions.service first wrote it."""
    return {
        "payload_version": CORRECTION_PAYLOAD_VERSION, "event_type": CORRECTION_EVENT_TYPE,
        "correction_id": str(record.correction_id), "substitution_id": str(record.substitution_id),
        "trip_id": str(record.trip_id), "recorded_by_user_id": str(record.recorded_by_user_id),
        "recorded_at": record.recorded_at.isoformat(),
        "reason_sha256": sha256_text(record.reason), "note_sha256": sha256_text(record.correction_note),
    }


def validate_correction_payload(payload: object) -> dict[str, Any]:
    if (
        not isinstance(payload, dict)
        or payload.get("payload_version") != CORRECTION_PAYLOAD_VERSION
        or payload.get("event_type") != CORRECTION_EVENT_TYPE
    ):
        raise UnsupportedPayload("not a known driver substitution correction payload")
    return payload
