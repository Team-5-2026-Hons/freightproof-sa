"""How much of an exception does the audit pack's evidence anchor actually back?

Pure functions over already-loaded rows: no queries, no Hedera. A pack may only say
"anchored" when the receipt is intact AND today's rows still hash to what it committed.

Rules (FP-290):
  * An event is *intact* when it is anchored, its receipt is linked and loaded, the receipt's
    hash is the event's frozen hash, and both stored payloads still hash to it.
  * The report's tier is decided by its RAISE event alone. A review or cancellation receipt
    anchors that action only; it never promotes the report or its photos.
  * A photo is anchored only when the intact raise event commits that artifact with that hash.
  * GPS is never in a payload, so it is never promoted (the manifest says so explicitly).
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import Enum
from typing import Any

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import AnchorStatus, BlockchainReceiptType, SubjectType, TripStatus
from app.db.models.evidence import EvidenceArtifact
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.orchestration.evidence_anchors import canonical
from app.orchestration.evidence_anchors.recording import (
    build_cancellation_record, build_exception_record, build_review_record,
)
from app.schemas.audit_pack import AnchorAction, ExceptionAnchorRecord, ExceptionPhoto, EvidenceTier

_ACTION: Mapping[str, AnchorAction] = {
    BlockchainReceiptType.EXCEPTION_RAISED.value: "raised",
    BlockchainReceiptType.EXCEPTION_REVIEWED.value: "reviewed",
    BlockchainReceiptType.TRIP_CANCELLED.value: "cancelled",
}


def _text(value: Any) -> str:
    return value.value if isinstance(value, Enum) else str(value)


@dataclass(frozen=True)
class ExceptionAnchors:
    """Everything the manifest says about one exception's anchoring."""

    tier: EvidenceTier
    anchors: list[ExceptionAnchorRecord]
    photos: list[ExceptionPhoto]


def _is_intact(event: EvidenceAnchorEvent, receipts: Mapping[uuid.UUID, BlockchainReceipt]) -> bool:
    if _text(event.anchor_status) != AnchorStatus.ANCHORED.value or event.receipt_id is None:
        return False
    receipt = receipts.get(event.receipt_id)
    return (
        receipt is not None
        and _text(receipt.subject_type) == SubjectType.EVIDENCE_EVENT.value
        and receipt.subject_id == event.id
        and receipt.trip_id == event.trip_id
        and _text(receipt.receipt_type) == _text(event.receipt_type)
        and receipt.data_hash == event.event_hash
        and compute_payload_hash(receipt.payload_json) == receipt.data_hash
        and compute_payload_hash(event.payload_json) == event.event_hash
    )


def _rebuilt_payload(
    event: EvidenceAnchorEvent, exception: TripException, trip: Trip, photos: Sequence[EvidenceArtifact],
) -> dict[str, Any] | None:
    """What the event's payload would be if built from today's rows; None when the source
    rows can no longer support that kind of event (e.g. a review that was removed)."""
    kind = _text(event.receipt_type)
    record = build_exception_record(exception, list(photos))
    if kind == BlockchainReceiptType.EXCEPTION_RAISED.value:
        return canonical.exception_raised_payload(event_id=event.id, record=record)
    reviewed = (
        exception.reviewed_by_user_id is not None and exception.reviewed_at is not None
        and exception.review_outcome is not None
    )
    if not reviewed:
        return None
    if kind == BlockchainReceiptType.EXCEPTION_REVIEWED.value:
        return canonical.exception_reviewed_payload(
            event_id=event.id, record=record, review=build_review_record(exception),
        )
    if (
        kind == BlockchainReceiptType.TRIP_CANCELLED.value
        and trip.closed_at is not None and _text(trip.status) == TripStatus.CANCELLED.value
    ):
        return canonical.trip_cancelled_payload(
            event_id=event.id, cancellation=build_cancellation_record(exception, trip),
        )
    return None


def assess_exception_anchors(
    exception: TripException, trip: Trip, photos: Sequence[EvidenceArtifact],
    events: Sequence[EvidenceAnchorEvent], receipts: Mapping[uuid.UUID, BlockchainReceipt],
) -> ExceptionAnchors:
    """Score one exception's events against its live rows. `receipts` is keyed by id and
    holds only receipts already scoped to this pack."""
    anchors: list[ExceptionAnchorRecord] = []
    raise_event: EvidenceAnchorEvent | None = None
    raise_tier: EvidenceTier = "recorded"
    for event in sorted(events, key=lambda e: (e.occurred_at, str(e.id))):
        kind = _text(event.receipt_type)
        intact = _is_intact(event, receipts)
        rebuilt = _rebuilt_payload(event, exception, trip, photos) if intact else None
        tier: EvidenceTier = (
            "anchored" if rebuilt is not None and compute_payload_hash(rebuilt) == event.event_hash else "recorded"
        )
        if kind == BlockchainReceiptType.EXCEPTION_RAISED.value:
            raise_event, raise_tier = event, tier
        anchors.append(ExceptionAnchorRecord(
            event_id=event.id, action=_ACTION[kind], receipt_type=kind,
            anchor_status=_text(event.anchor_status), receipt_id=event.receipt_id,
            occurred_at=event.occurred_at, tier=tier,
        ))

    committed: dict[str, str] = {}
    if raise_event is not None and _is_intact(raise_event, receipts):
        committed = {p["artifact_id"]: p["sha256"] for p in raise_event.payload_json.get("photos", [])}
    photo_records = []
    for position, a in enumerate(photos):
        committed_exactly = raise_event is not None and committed.get(str(a.id)) == a.file_hash
        photo_records.append(ExceptionPhoto(
            artifact_id=a.id, position=position, sha256=a.file_hash, mime_type=a.mime_type,
            captured_at=a.captured_at, tier="anchored" if committed_exactly else "recorded",
            anchor_event_id=raise_event.id if committed_exactly and raise_event is not None else None,
            anchor_receipt_id=raise_event.receipt_id if committed_exactly and raise_event is not None else None,
        ))
    return ExceptionAnchors(tier=raise_tier, anchors=anchors, photos=photo_records)
