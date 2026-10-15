"""Which photos belong to an exception report."""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.evidence import EvidenceArtifact
from app.db.models.evidence_anchors import ExceptionArtifact
from app.db.models.transit import TripException


def resolve_photo_ids(
    single_id: uuid.UUID | None, many_ids: Sequence[uuid.UUID] | None,
) -> list[uuid.UUID]:
    """The report's photos in order. The list wins when given (the schema has already
    rejected a contradicting singular field); the singular field alone is a one-photo list."""
    if many_ids is not None:
        return list(many_ids)
    return [] if single_id is None else [single_id]


async def validate_trip_artifacts(
    db: AsyncSession, *, trip_id: uuid.UUID, artifact_ids: Sequence[uuid.UUID],
) -> None:
    """Every artifact must exist and belong to this trip, checked before any write.

    The FK alone only proves an artifact exists somewhere, not that it is this trip's own.
    Missing and foreign ids are indistinguishable on purpose (both 404).
    """
    if not artifact_ids:
        return
    found = set((await db.execute(
        select(EvidenceArtifact.id).where(
            EvidenceArtifact.id.in_(artifact_ids), EvidenceArtifact.trip_id == trip_id,
        )
    )).scalars().all())
    for artifact_id in artifact_ids:
        if artifact_id not in found:
            raise ResourceNotFoundError("EvidenceArtifact", str(artifact_id))


async def attach_exception_artifacts(
    db: AsyncSession, *, exception_id: uuid.UUID, artifact_ids: Sequence[uuid.UUID],
) -> None:
    """Freeze the report's photo membership, in submitted order. Never edited afterwards:
    the report's receipt commits to exactly this set."""
    db.add_all(
        ExceptionArtifact(exception_id=exception_id, artifact_id=artifact_id, position=position)
        for position, artifact_id in enumerate(artifact_ids)
    )
    await db.flush()


class ForeignEvidenceArtifactError(ValueError):
    """A photo linked to an exception belongs to a different trip than the exception."""


async def load_exception_artifacts(
    db: AsyncSession, *, exception: TripException, strict: bool = True,
) -> list[EvidenceArtifact]:
    """The report's photos in position order, every one owned by the exception's trip.

    Ownership is rechecked on every load, not only at creation: the membership row alone
    would let a photo re-pointed at another trip keep verifying and have its bytes read.
    strict=True raises ForeignEvidenceArtifactError (anchoring and verification must reject);
    strict=False drops foreign photos (display paths must not 500 or show them).

    A legacy row (written before memberships existed) has none, so its single
    supporting_artifact_id is read as a one-photo report. That keeps old rows readable; it
    does not create an anchor event for them.
    """
    members = (await db.execute(
        select(EvidenceArtifact)
        .join(ExceptionArtifact, ExceptionArtifact.artifact_id == EvidenceArtifact.id)
        .where(ExceptionArtifact.exception_id == exception.id)
        .order_by(ExceptionArtifact.position)
    )).scalars().all()
    photos = list(members)
    if not photos and exception.supporting_artifact_id is not None:
        legacy = await db.get(EvidenceArtifact, exception.supporting_artifact_id)
        photos = [] if legacy is None else [legacy]
    owned = [a for a in photos if a.trip_id == exception.trip_id]
    if strict and len(owned) != len(photos):
        raise ForeignEvidenceArtifactError("exception photo belongs to another trip")
    return owned
