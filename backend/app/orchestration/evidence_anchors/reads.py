"""Photo and anchor-state reads that decorate an exception response."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.db.models.transit import TripException
from app.orchestration.evidence_anchors.artifacts import load_exception_artifacts
from app.schemas.transit import (
    EvidenceAnchorSummary, ExceptionArtifactSummary, TripExceptionRead,
)


async def build_exception_read(db: AsyncSession, exception: TripException) -> TripExceptionRead:
    """The exception as returned to a caller: the row, its photos in order, and every anchor
    event its actions have produced (oldest first, so raise precedes review)."""
    artifacts = await load_exception_artifacts(db, exception=exception, strict=False)
    events = (await db.execute(
        select(EvidenceAnchorEvent)
        .where(EvidenceAnchorEvent.exception_id == exception.id)
        .order_by(EvidenceAnchorEvent.occurred_at, EvidenceAnchorEvent.id)
    )).scalars().all()
    return TripExceptionRead.model_validate(exception).model_copy(update={
        "supporting_artifacts": [
            ExceptionArtifactSummary.model_validate({
                "id": a.id, "position": position, "artifact_type": a.artifact_type,
                "mime_type": a.mime_type, "file_hash": a.file_hash, "captured_at": a.captured_at,
            })
            for position, a in enumerate(artifacts)
        ],
        "anchor_events": [
            EvidenceAnchorSummary.model_validate({
                "event_id": e.id, "receipt_type": e.receipt_type, "anchor_status": e.anchor_status,
                "receipt_id": e.receipt_id, "occurred_at": e.occurred_at,
            })
            for e in events
        ],
    })
