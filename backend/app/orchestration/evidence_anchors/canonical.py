"""Canonical payloads (version 1) for exception evidence anchors.

Pure functions over typed value records, never ORM objects: a payload can only contain what
a record declares, so personal data cannot reach Hedera by someone adding a column. No
coordinates, raw text, names, contact details, file paths, URLs or bytes ever appear here —
free text and actors enter as SHA-256 digests, and GPS has no field at all, so a
GPS-only edit cannot change a receipt.

Text is hashed as UTF-8 exactly as stored (no trimming or normalisation), and None is not
the empty string. Timestamps are UTC ISO-8601 with microseconds.
"""

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.enums import BlockchainReceiptType

EVIDENCE_PAYLOAD_VERSION = 1

EXCEPTION_RAISED = BlockchainReceiptType.EXCEPTION_RAISED.value
EXCEPTION_REVIEWED = BlockchainReceiptType.EXCEPTION_REVIEWED.value
TRIP_CANCELLED = BlockchainReceiptType.TRIP_CANCELLED.value
EVIDENCE_EVENT_TYPES = frozenset({EXCEPTION_RAISED, EXCEPTION_REVIEWED, TRIP_CANCELLED})

_CANCELLED_STATUS = "cancelled"


class UnsupportedEvidencePayloadError(ValueError):
    """A stored payload is not a version-1 evidence payload of the expected kind."""


@dataclass(frozen=True)
class PhotoCommitment:
    artifact_id: uuid.UUID
    sha256: str


@dataclass(frozen=True)
class ExceptionRecord:
    """What the raise receipt commits to, and what a review receipt hashes by reference."""
    trip_id: uuid.UUID
    exception_id: uuid.UUID
    created_at: datetime
    exception_type: str
    source: str
    severity: str
    description: str
    phase_event_id: uuid.UUID | None
    checkpoint_id: uuid.UUID | None
    consignment_id: uuid.UUID | None
    trip_stop_id: uuid.UUID | None
    vehicle_id: uuid.UUID | None
    photos: tuple[PhotoCommitment, ...]


@dataclass(frozen=True)
class ReviewRecord:
    reviewed_by_user_id: uuid.UUID
    reviewed_at: datetime
    outcome: str
    contact_method: str | None
    review_note: str | None
    # The description of a dispatcher-authored note (override, cancellation); None for an
    # ordinary review of someone else's report.
    authored_description: str | None


@dataclass(frozen=True)
class CancellationRecord:
    trip_id: uuid.UUID
    exception_id: uuid.UUID
    cancelled_by_user_id: uuid.UUID
    closed_at: datetime
    # The exact persisted cancellation-note description, prefix included.
    cause_description: str


def text_sha256(text: str | None) -> str | None:
    if text is None:
        return None
    return compute_text_hash(text)


def compute_text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def actor_sha256(user_id: uuid.UUID) -> str:
    return compute_payload_hash({"actor_type": "user", "user_id": str(user_id)})


def _utc_iso(moment: datetime) -> str:
    if moment.tzinfo is None:
        raise ValueError("evidence timestamps must be timezone-aware")
    return moment.astimezone(UTC).isoformat(timespec="microseconds")


def _id_or_none(value: uuid.UUID | None) -> str | None:
    return None if value is None else str(value)


def _context_sha256(record: ExceptionRecord) -> str:
    return compute_payload_hash({
        "phase_event_id": _id_or_none(record.phase_event_id),
        "checkpoint_id": _id_or_none(record.checkpoint_id),
        "consignment_id": _id_or_none(record.consignment_id),
        "trip_stop_id": _id_or_none(record.trip_stop_id),
        "vehicle_id": _id_or_none(record.vehicle_id),
    })


def exception_record_payload(record: ExceptionRecord) -> dict[str, Any]:
    """The shared exception-record builder: defined once, used by the raise payload and
    hashed by reference into every review payload."""
    photos = sorted(record.photos, key=lambda photo: str(photo.artifact_id))
    return {
        "payload_version": EVIDENCE_PAYLOAD_VERSION,
        "trip_id": str(record.trip_id),
        "exception_id": str(record.exception_id),
        "occurred_at": _utc_iso(record.created_at),
        "exception_type": record.exception_type,
        "source": record.source,
        "severity": record.severity,
        "description_sha256": compute_text_hash(record.description),
        "context_sha256": _context_sha256(record),
        "photos": [
            {"artifact_id": str(photo.artifact_id), "sha256": photo.sha256} for photo in photos
        ],
    }


def exception_record_sha256(record: ExceptionRecord) -> str:
    return compute_payload_hash(exception_record_payload(record))


def exception_raised_payload(*, event_id: uuid.UUID, record: ExceptionRecord) -> dict[str, Any]:
    return {**exception_record_payload(record), "event_type": EXCEPTION_RAISED, "event_id": str(event_id)}


def exception_reviewed_payload(
    *, event_id: uuid.UUID, record: ExceptionRecord, review: ReviewRecord,
) -> dict[str, Any]:
    return {
        "payload_version": EVIDENCE_PAYLOAD_VERSION,
        "event_type": EXCEPTION_REVIEWED,
        "event_id": str(event_id),
        "trip_id": str(record.trip_id),
        "exception_id": str(record.exception_id),
        "occurred_at": _utc_iso(review.reviewed_at),
        "exception_record_sha256": exception_record_sha256(record),
        "reviewed_by_sha256": actor_sha256(review.reviewed_by_user_id),
        "review_outcome": review.outcome,
        "contact_method": review.contact_method,
        "review_note_sha256": text_sha256(review.review_note),
        "authored_statement_sha256": text_sha256(review.authored_description),
    }


def trip_cancelled_payload(*, event_id: uuid.UUID, cancellation: CancellationRecord) -> dict[str, Any]:
    return {
        "payload_version": EVIDENCE_PAYLOAD_VERSION,
        "event_type": TRIP_CANCELLED,
        "event_id": str(event_id),
        "trip_id": str(cancellation.trip_id),
        "exception_id": str(cancellation.exception_id),
        "occurred_at": _utc_iso(cancellation.closed_at),
        "status": _CANCELLED_STATUS,
        "cancelled_by_sha256": actor_sha256(cancellation.cancelled_by_user_id),
        "cause_record_sha256": compute_text_hash(cancellation.cause_description),
    }


def validate_payload_version(payload: object, receipt_type: str) -> None:
    """Reject anything that is not a version-1 payload of the kind the receipt type names.

    The version must be the int 1 exactly: a bool, string or float that merely equals 1
    would let a re-typed payload pass for the contract it imitates.
    """
    if not isinstance(payload, dict):
        raise UnsupportedEvidencePayloadError("evidence payload must be a JSON object")
    version = payload.get("payload_version")
    if type(version) is not int or version != EVIDENCE_PAYLOAD_VERSION:
        raise UnsupportedEvidencePayloadError(f"unsupported evidence payload version: {version!r}")
    event_type = payload.get("event_type")
    # type() first: an array/object kind is unhashable and would crash the set lookup.
    if type(event_type) is not str or event_type not in EVIDENCE_EVENT_TYPES or event_type != receipt_type:
        raise UnsupportedEvidencePayloadError(
            f"evidence event kind {event_type!r} does not match receipt type {receipt_type!r}"
        )
