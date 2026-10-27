"""Which phase and evidence role a capture was taken for, and the rules that guard it.

Lowest tier of evidence/: artifacts.py applies it on upload, and phase completion applies
cited_attribution_error to what a driver submits. Phase state is deliberately never checked
here — a queued completion replays its uploads after the phase may have closed.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import EvidenceAttributionError, ResourceNotFoundError
from app.core.phase_meta import DRIVER_UPLOAD_ROLES, EVIDENCE_ROLES
from app.db.models.enums import EvidenceRole, PhaseType
from app.db.models.phases import PhaseEvent


@dataclass(frozen=True)
class EvidenceAttribution:
    phase_event_id: uuid.UUID
    role: EvidenceRole


async def validate_driver_attribution(
    db: AsyncSession, *, trip_id: uuid.UUID, attribution: EvidenceAttribution,
) -> None:
    """Structural checks for a driver's attributed upload.

    A phase on another trip is reported as not found, exactly like a foreign trip, so the
    response never confirms that an id exists elsewhere.
    """
    phase_type = (
        await db.execute(
            select(PhaseEvent.phase_type).where(
                PhaseEvent.id == attribution.phase_event_id, PhaseEvent.trip_id == trip_id,
            )
        )
    ).scalar_one_or_none()
    if phase_type is None:
        raise ResourceNotFoundError("PhaseEvent", str(attribution.phase_event_id))

    role = attribution.role
    if role not in DRIVER_UPLOAD_ROLES:
        raise EvidenceAttributionError(f"A driver upload cannot be attributed as '{role.value}'.")
    if role not in EVIDENCE_ROLES[PhaseType(phase_type)]:
        raise EvidenceAttributionError(
            f"'{role.value}' is not evidence for a {PhaseType(phase_type).value} phase."
        )


def cited_attribution_error(
    *,
    cited_role: EvidenceRole,
    phase_event_id: uuid.UUID,
    artifact_phase_event_id: uuid.UUID | None,
    artifact_role: EvidenceRole | None,
) -> str | None:
    """Why a cited artifact contradicts the field it is cited in, or None when it does not.

    An unattributed artifact is accepted: older apps, queued entries and receiver images
    stored before attribution existed carry none.
    """
    if artifact_phase_event_id is None and artifact_role is None:
        return None
    if artifact_phase_event_id != phase_event_id:
        return f"The {cited_role.value} was captured for a different phase."
    if artifact_role != cited_role:
        label = artifact_role.value if artifact_role is not None else "unattributed"
        return f"The artifact was captured as '{label}', not '{cited_role.value}'."
    return None
