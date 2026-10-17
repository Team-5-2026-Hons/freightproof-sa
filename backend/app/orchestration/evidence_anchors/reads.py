"""Photo and anchor-state reads that decorate exception responses.

Every loader here is batched over a set of exceptions (one query per concern, never one per
row) so a trip with many exceptions costs the same number of queries as a trip with one.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.blockchain import BlockchainReceipt
from app.db.models.evidence import EvidenceArtifact
from app.db.models.evidence_anchors import EvidenceAnchorEvent, ExceptionArtifact
from app.db.models.transit import TripException
from app.schemas.transit import (
    EvidenceAnchorSummary, ExceptionArtifactSummary, TripExceptionRead,
)


async def load_photos_by_exception(
    db: AsyncSession, exceptions: Sequence[TripException],
) -> dict[uuid.UUID, list[EvidenceArtifact]]:
    """Each exception's photos in position order, for display.

    Two queries for the whole set: the membership join, then (only for rows with no
    membership but a legacy supporting_artifact_id) one lookup of those legacy photos.
    A photo owned by a different trip than its exception is dropped, never shown: this is a
    display path and must not 500 or leak. Anchoring and verification use the strict loader
    in artifacts.py instead.
    """
    if not exceptions:
        return {}
    trip_of = {e.id: e.trip_id for e in exceptions}
    photos: dict[uuid.UUID, list[EvidenceArtifact]] = {e.id: [] for e in exceptions}
    rows = (await db.execute(
        select(ExceptionArtifact.exception_id, EvidenceArtifact)
        .join(EvidenceArtifact, EvidenceArtifact.id == ExceptionArtifact.artifact_id)
        .where(ExceptionArtifact.exception_id.in_(trip_of))
        .order_by(ExceptionArtifact.exception_id, ExceptionArtifact.position)
    )).tuples().all()
    has_members: set[uuid.UUID] = set()
    for exception_id, artifact in rows:
        has_members.add(exception_id)
        if artifact.trip_id == trip_of[exception_id]:
            photos[exception_id].append(artifact)

    legacy_ids = {
        e.supporting_artifact_id for e in exceptions
        if e.id not in has_members and e.supporting_artifact_id is not None
    }
    if legacy_ids:
        legacy = {a.id: a for a in (await db.execute(
            select(EvidenceArtifact).where(EvidenceArtifact.id.in_(legacy_ids))
        )).scalars().all()}
        for e in exceptions:
            legacy_id = e.supporting_artifact_id
            if e.id in has_members or legacy_id is None:
                continue
            legacy_photo = legacy.get(legacy_id)
            if legacy_photo is not None and legacy_photo.trip_id == e.trip_id:
                photos[e.id].append(legacy_photo)
    return photos


async def load_anchor_events_by_exception(
    db: AsyncSession, exception_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, list[EvidenceAnchorSummary]]:
    """Every anchor event per exception, oldest first so the raise precedes its review.

    One query. An exception with no events (every historical row) maps to an empty list:
    nothing is owed for it, so it must never read as "pending".
    """
    events: dict[uuid.UUID, list[EvidenceAnchorSummary]] = {eid: [] for eid in exception_ids}
    if not exception_ids:
        return events
    rows = (await db.execute(
        select(EvidenceAnchorEvent)
        .where(EvidenceAnchorEvent.exception_id.in_(list(events)))
        .order_by(EvidenceAnchorEvent.occurred_at, EvidenceAnchorEvent.id)
    )).scalars().all()
    for e in rows:
        events[e.exception_id].append(EvidenceAnchorSummary.model_validate({
            "event_id": e.id, "receipt_type": e.receipt_type, "anchor_status": e.anchor_status,
            "receipt_id": e.receipt_id, "occurred_at": e.occurred_at,
        }))
    return events


async def attach_hedera_refs(
    db: AsyncSession, events: Sequence[EvidenceAnchorSummary],
) -> list[EvidenceAnchorSummary]:
    """Add each anchored event's Hedera topic id and sequence number, in one query.

    Opt-in and separate from the loader above: those two values point into a receipt, and
    receipts are admin-only everywhere else (/blockchain/receipts, trip detail's
    blockchain_receipts). Only a caller that has checked the role should call this; every
    other path keeps them None. Pending and failed events have no receipt and stay None.
    """
    receipt_ids = [e.receipt_id for e in events if e.receipt_id is not None]
    if not receipt_ids:
        return list(events)
    refs = {
        receipt_id: (topic_id, sequence_number)
        for receipt_id, topic_id, sequence_number in (await db.execute(
            select(
                BlockchainReceipt.id, BlockchainReceipt.hedera_topic_id,
                BlockchainReceipt.hedera_sequence_number,
            ).where(BlockchainReceipt.id.in_(receipt_ids))
        )).all()
    }
    return [
        e.model_copy(update={
            "hedera_topic_id": refs[e.receipt_id][0], "hedera_sequence_number": refs[e.receipt_id][1],
        }) if e.receipt_id in refs else e
        for e in events
    ]


def photo_summaries(photos: Sequence[EvidenceArtifact]) -> list[ExceptionArtifactSummary]:
    return [
        ExceptionArtifactSummary.model_validate({
            "id": a.id, "position": position, "artifact_type": a.artifact_type,
            "mime_type": a.mime_type, "file_hash": a.file_hash, "captured_at": a.captured_at,
        })
        for position, a in enumerate(photos)
    ]


async def decorate_exception_reads(
    db: AsyncSession, exceptions: Sequence[TripException], reads: Sequence[TripExceptionRead],
) -> list[TripExceptionRead]:
    """Attach photos and anchor events to reads built from `exceptions` (same order), in a
    constant number of queries."""
    photos = await load_photos_by_exception(db, exceptions)
    events = await load_anchor_events_by_exception(db, [e.id for e in exceptions])
    return [
        read.model_copy(update={
            "supporting_artifacts": photo_summaries(photos[exc.id]),
            "anchor_events": events[exc.id],
        })
        for exc, read in zip(exceptions, reads, strict=True)
    ]


async def build_exception_read(db: AsyncSession, exception: TripException) -> TripExceptionRead:
    """The exception as returned to a caller: the row, its photos in order, and every anchor
    event its actions have produced."""
    [read] = await decorate_exception_reads(db, [exception], [TripExceptionRead.model_validate(exception)])
    return read
