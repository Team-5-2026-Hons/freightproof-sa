"""Artifact ownership guard shared by the phases that accept evidence uploads (loading,
departure, arrival, confirmation).
"""

import uuid
from collections.abc import Mapping

from sqlalchemy import Row, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import EvidenceAttributionError, ResourceNotFoundError
from app.db.models.enums import EvidenceRole
from app.db.models.evidence import EvidenceArtifact
from app.orchestration.evidence.attribution import cited_attribution_error


async def _assert_artifacts_belong_to_trip(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID,
    cited: Mapping[EvidenceRole, uuid.UUID | None],
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

    Ownership is necessary but not sufficient: an artifact captured for another phase or
    role is rejected too (EvidenceAttributionError, 422), and so is a driver's own upload
    cited as the receiver's confirmation. An artifact with no attribution passes (older
    apps, queued entries, receiver images stored before attribution existed).

    `cited` maps each evidence role to the artifact id the request put in that field;
    None entries are skipped so optional artifact fields can pass through unchanged.
    Returns the owned artifacts' stored SHA-256 digests so an anchoring caller does
    not need a second database round trip after this ownership check.
    """
    present = {aid for aid in cited.values() if aid is not None}
    if not present:
        return {}

    result = await db.execute(
        select(
            EvidenceArtifact.id, EvidenceArtifact.file_hash, EvidenceArtifact.phase_event_id,
            EvidenceArtifact.evidence_role, EvidenceArtifact.captured_by_driver_id,
        ).where(
            EvidenceArtifact.id.in_(present),
            EvidenceArtifact.trip_id == trip_id,
        )
    )
    owned = {row.id: row for row in result.all()}

    missing = present - owned.keys()
    if missing:
        # Sorted so the message is deterministic across runs — this ends up in an
        # API error body and in test assertions.
        raise ResourceNotFoundError(
            "EvidenceArtifact", ", ".join(sorted(str(m) for m in missing)),
        )

    for role, artifact_id in cited.items():
        if artifact_id is not None:
            _assert_attribution_fits(owned[artifact_id], role=role, phase_event_id=phase_event_id)
    return {artifact_id: row.file_hash for artifact_id, row in owned.items()}


def _assert_attribution_fits(
    artifact: Row[tuple[uuid.UUID, str, uuid.UUID | None, EvidenceRole | None, uuid.UUID | None]],
    *, role: EvidenceRole, phase_event_id: uuid.UUID,
) -> None:
    error = cited_attribution_error(
        cited_role=role, phase_event_id=phase_event_id,
        artifact_phase_event_id=artifact.phase_event_id,
        artifact_role=EvidenceRole(artifact.evidence_role) if artifact.evidence_role else None,
    )
    if error is not None:
        raise EvidenceAttributionError(error)
    # Only the receiver route can produce the confirmation, and it never sets a driver id,
    # so a driver-made artifact in this field is never the receiver's own.
    if role is EvidenceRole.POD_SIGNATURE and artifact.captured_by_driver_id is not None:
        raise EvidenceAttributionError(
            "A driver's own upload cannot be submitted as the receiver confirmation."
        )
