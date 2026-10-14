"""Artifact ownership guard shared by the phases that accept evidence uploads (loading,
departure, arrival, confirmation).
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.evidence import EvidenceArtifact


async def _assert_artifacts_belong_to_trip(
    db: AsyncSession, *, trip_id: uuid.UUID, artifact_ids: tuple[uuid.UUID | None, ...],
) -> dict[uuid.UUID, str]:
    """Every artifact a phase cites as its evidence must belong to THIS trip.

    Without this, a caller could attach any artifact UUID in the system to a phase:
    another trip's seal photo standing in as this trip's, or a POD from an entirely
    different delivery. The FK alone does not prevent that — it only proves the row
    exists somewhere. On a platform whose whole claim is "this photo is what happened
    on this trip", an unowned artifact is a forged evidence chain, and it would still
    hash into the journey record as if genuine.

    Raises ResourceNotFoundError (404 at the endpoint) rather than a 4xx that
    distinguishes "wrong trip" from "no such artifact": from this trip's perspective
    both are the same fact — the artifact is not available here — and saying which
    would confirm the existence of another trip's evidence to a caller who cannot
    otherwise see it.

    None entries are skipped so optional artifact fields can pass through unchanged.
    Returns the owned artifacts' stored SHA-256 digests so an anchoring caller does
    not need a second database round trip after this ownership check.
    """
    present = {aid for aid in artifact_ids if aid is not None}
    if not present:
        return {}

    result = await db.execute(
        select(EvidenceArtifact.id, EvidenceArtifact.file_hash).where(
            EvidenceArtifact.id.in_(present),
            EvidenceArtifact.trip_id == trip_id,
        )
    )
    owned = {artifact_id: file_hash for artifact_id, file_hash in result.all()}

    missing = present - owned.keys()
    if missing:
        # Sorted so the message is deterministic across runs — this ends up in an
        # API error body and in test assertions.
        raise ResourceNotFoundError(
            "EvidenceArtifact", ", ".join(sorted(str(m) for m in missing)),
        )
    return owned
