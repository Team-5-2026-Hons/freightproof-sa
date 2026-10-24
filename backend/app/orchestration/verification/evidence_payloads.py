"""Rebuild an evidence anchor event's payload from live rows and re-hash the photo bytes."""
from __future__ import annotations

import dataclasses
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.enums import BlockchainReceiptType, TripStatus
from app.db.models.evidence import EvidenceArtifact
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.orchestration.evidence_anchors import canonical
from app.orchestration.evidence_anchors.artifacts import (
    ForeignEvidenceArtifactError, load_exception_artifacts,
)
from app.orchestration.evidence_anchors.recording import (
    build_cancellation_record, build_exception_record, build_review_record,
)
from app.orchestration.verification.errors import (
    _EvidenceMissing, _UnsupportedPhasePayloadVersion,
)
from app.storage.supabase_storage import hash_stored_evidence_file


@dataclass(frozen=True)
class EvidenceArtifactCommitment:
    """One photo the payload commits to, whose stored bytes must still hash to the same value."""
    artifact: EvidenceArtifact


@dataclass(frozen=True)
class EvidencePayloadState:
    payload: dict[str, Any]
    artifacts: tuple[EvidenceArtifactCommitment, ...] = ()
    # What a review payload is built from, kept so the photo hashes inside the record it
    # commits to by reference can be swapped for live ones.
    record: canonical.ExceptionRecord | None = None
    review: canonical.ReviewRecord | None = None


async def reconstruct_evidence_event(
    db: AsyncSession, *, event_id: uuid.UUID, anchored_payload: object,
) -> EvidencePayloadState:
    """Rebuild the payload from the live source rows — never from the event's stored
    payload_json, which is the thing being checked.

    Raises _UnsupportedPhasePayloadVersion for a payload that is not a known version/kind
    and _EvidenceMissing when the committed state is gone or no longer belongs together.
    """
    event = await db.get(EvidenceAnchorEvent, event_id)
    if event is None:
        raise _EvidenceMissing("anchored evidence event is missing")
    try:
        # An unknown persisted kind is a ValueError here; it must surface as an unsupported
        # contract (verify -> error), never as an unhandled crash.
        kind = BlockchainReceiptType(event.receipt_type)
        canonical.validate_payload_version(anchored_payload, kind.value)
    except (ValueError, canonical.UnsupportedEvidencePayloadError) as error:
        raise _UnsupportedPhasePayloadVersion(str(error)) from error

    if event.receipt_type == BlockchainReceiptType.EXCEPTION_RAISED:
        return await _rebuild_raised(db, event)
    if event.receipt_type == BlockchainReceiptType.EXCEPTION_REVIEWED:
        return await _rebuild_reviewed(db, event)
    if event.receipt_type == BlockchainReceiptType.TRIP_CANCELLED:
        return await _rebuild_cancelled(db, event)
    raise _UnsupportedPhasePayloadVersion(f"unsupported evidence event kind: {event.receipt_type!r}")


async def _load_exception_and_photos(
    db: AsyncSession, event: EvidenceAnchorEvent,
) -> tuple[TripException, list[EvidenceArtifact]]:
    exception = await db.get(TripException, event.exception_id)
    # event.trip_id is checked against the exception's own trip: an event pointed at some
    # other trip's exception must not verify as that exception's record.
    if exception is None or exception.trip_id != event.trip_id:
        raise _EvidenceMissing("anchored exception is missing or belongs to another trip")
    try:
        return exception, await load_exception_artifacts(db, exception=exception)
    except ForeignEvidenceArtifactError as error:
        raise _EvidenceMissing(str(error)) from error


def _require_reviewed(exception: TripException) -> None:
    if (
        exception.reviewed_by_user_id is None or exception.reviewed_at is None
        or exception.review_outcome is None
    ):
        raise _EvidenceMissing("anchored review is missing from the exception")


async def _rebuild_reviewed(db: AsyncSession, event: EvidenceAnchorEvent) -> EvidencePayloadState:
    exception, artifacts = await _load_exception_and_photos(db, event)
    _require_reviewed(exception)
    record, review = build_exception_record(exception, artifacts), build_review_record(exception)
    payload = canonical.exception_reviewed_payload(event_id=event.id, record=record, review=review)
    return EvidencePayloadState(
        payload=payload, artifacts=tuple(EvidenceArtifactCommitment(a) for a in artifacts),
        record=record, review=review,
    )


async def _rebuild_cancelled(db: AsyncSession, event: EvidenceAnchorEvent) -> EvidencePayloadState:
    exception = await db.get(TripException, event.exception_id)
    trip = await db.get(Trip, event.trip_id)
    if (
        exception is None or trip is None or exception.trip_id != trip.id
        or TripStatus(trip.status) != TripStatus.CANCELLED or trip.closed_at is None
    ):
        raise _EvidenceMissing("anchored cancellation is missing or the trip is not cancelled")
    _require_reviewed(exception)
    payload = canonical.trip_cancelled_payload(
        event_id=event.id, cancellation=build_cancellation_record(exception, trip),
    )
    # A cancellation commits no photo bytes: the cause is the note's text, as a hash.
    return EvidencePayloadState(payload=payload)


async def _rebuild_raised(db: AsyncSession, event: EvidenceAnchorEvent) -> EvidencePayloadState:
    exception, artifacts = await _load_exception_and_photos(db, event)
    record = build_exception_record(exception, artifacts)
    return EvidencePayloadState(
        payload=canonical.exception_raised_payload(event_id=event.id, record=record),
        artifacts=tuple(EvidenceArtifactCommitment(a) for a in artifacts),
    )


async def payload_with_live_artifact_hashes(state: EvidencePayloadState) -> dict[str, Any]:
    """The payload with every photo hash replaced by the hash of the bytes in Storage now.

    Raises EvidenceObjectIntegrityError (bytes gone or unreadable as the stored object) and
    EvidenceStorageUnavailableError (could not look) — verify_subject maps them to a mismatch
    and an error respectively, so an outage is never reported as tampering.
    """
    live = {
        c.artifact.id: await hash_stored_evidence_file(
            s3_bucket=c.artifact.s3_bucket, s3_key=c.artifact.s3_key,
        )
        for c in state.artifacts
    }
    if state.record is not None and state.review is not None:
        # A review commits to the record by hash, so the live photo hashes go into the record
        # and the whole review payload is rebuilt from it.
        record = dataclasses.replace(state.record, photos=tuple(
            canonical.PhotoCommitment(photo.artifact_id, live[photo.artifact_id])
            for photo in state.record.photos
        ))
        return canonical.exception_reviewed_payload(
            event_id=uuid.UUID(state.payload["event_id"]), record=record, review=state.review,
        )
    photos = [{**photo, "sha256": live[uuid.UUID(photo["artifact_id"])]} for photo in state.payload["photos"]]
    return {**state.payload, "photos": photos}


def hash_payload(payload: dict[str, Any]) -> str:
    return compute_payload_hash(payload)
