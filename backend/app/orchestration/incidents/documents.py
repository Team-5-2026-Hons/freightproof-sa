"""Dispatcher-attached documents on an incident (a SAPS case slip, a client's letter), behind
INCIDENT_DOCUMENTS_ENABLED.

The file is an ordinary EvidenceArtifact on the trip — same bucket, same MIME sniffing, same
SHA-256 — with captured_by_user_id set and no driver, the honest record that a dispatcher, not
the driver, supplied it. The incident cites it with a DOCUMENT_ATTACHED ledger entry. Trip
artifact listing is dispatcher-only, so nothing here reaches the driver's phone.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import IncidentDocumentsDisabledError, IncidentInvalidError, ResourceNotFoundError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.db.models.enums import ArtifactType, IncidentUpdateKind
from app.db.models.evidence import EvidenceArtifact
from app.db.models.incidents import Incident, IncidentUpdate
from app.db.models.trips import Trip
from app.orchestration.evidence.artifacts import MAX_FILE_SIZE_BYTES, sign_artifact_url
from app.orchestration.incidents.ledger import Entry, append, lock_incident, notify
from app.orchestration.incidents.state import ensure_open
from app.storage.mime_allowlist import resolve_mime_type
from app.storage.supabase_storage import upload_evidence_file

_PDF = "application/pdf"
# incident_updates.to_value is String(50); the name is a label for people, the hash is the identity.
_FILE_NAME_MAX = 50


@dataclass(frozen=True)
class DocumentUpload:
    file_bytes: bytes
    declared_mime: str | None
    file_name: str | None
    # Required: what the document is and why it is on the incident.
    note: str


def require_enabled() -> None:
    if not settings.INCIDENT_DOCUMENTS_ENABLED:
        raise IncidentDocumentsDisabledError()


def _label(file_name: str | None) -> str | None:
    if not file_name:
        return None
    name = file_name.rsplit("/", 1)[-1].strip()
    return name[:_FILE_NAME_MAX] or None


async def attach_document(
    db: AsyncSession, *, incident_id: uuid.UUID, organization_id: uuid.UUID, user_id: uuid.UUID,
    document: DocumentUpload,
) -> uuid.UUID:
    """Store the file and cite it on the ledger.

    Raises IncidentDocumentsDisabledError (503) first of all, then ResourceNotFoundError (404),
    IncidentClosedError (409) and IncidentInvalidError (422: too large, empty, not an allowed type).
    Returns the new artifact's id.
    """
    require_enabled()
    file_bytes = document.file_bytes
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise IncidentInvalidError(f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.")
    try:
        mime_type = resolve_mime_type(file_bytes, document.declared_mime)
    except ValueError as exc:
        raise IncidentInvalidError(str(exc)) from exc

    ledger = await lock_incident(db, incident_id=incident_id, organization_id=organization_id)
    ensure_open(ledger.state, incident_id=incident_id)
    stored = await upload_evidence_file(trip_id=str(ledger.trip.id), file_bytes=file_bytes, mime_type=mime_type)
    now = datetime.now(UTC)
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=ledger.trip.id,
        artifact_type=ArtifactType.DOCUMENT if mime_type == _PDF else ArtifactType.PHOTO,
        s3_key=stored.s3_key, s3_bucket=stored.s3_bucket, file_hash=stored.file_hash, mime_type=mime_type,
        captured_by_driver_id=None, captured_by_user_id=user_id, captured_at=now, created_at=now,
    )
    db.add(artifact)
    await db.flush()
    append(db, ledger, Entry(
        kind=IncidentUpdateKind.DOCUMENT_ATTACHED, user_id=user_id, at=now, note=document.note,
        to_value=_label(document.file_name), artifact_id=artifact.id,
    ))
    await db.flush()
    notify(db, ledger)
    enqueue_event(db, ledger.trip.operator_organization_id, TripEvent(id=ledger.trip.id, kind=RealtimeKind.EVIDENCE_UPLOADED))
    return artifact.id


async def document_url(
    db: AsyncSession, *, incident_id: uuid.UUID, organization_id: uuid.UUID, artifact_id: uuid.UUID,
) -> str | None:
    """A short-lived link to a document this incident's ledger cites. An artifact the incident
    does not cite is indistinguishable from one that does not exist. Reading stays allowed with
    the flag off: switching uploads off must not hide what was already attached."""
    artifact = (await db.execute(
        select(EvidenceArtifact)
        .join(IncidentUpdate, IncidentUpdate.artifact_id == EvidenceArtifact.id)
        .join(Incident, Incident.id == IncidentUpdate.incident_id)
        .join(Trip, Trip.id == Incident.trip_id)
        .where(
            IncidentUpdate.incident_id == incident_id, EvidenceArtifact.id == artifact_id,
            Trip.operator_organization_id == organization_id,
        )
    )).scalar_one_or_none()
    if artifact is None:
        raise ResourceNotFoundError("Document", str(artifact_id))
    return await sign_artifact_url(artifact)
