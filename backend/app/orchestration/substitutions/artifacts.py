"""Photos uploaded through the driver-handover and late-evidence routes (FP-83 C4).

The ordinary artifact route is for the current driver only, so a pending incoming driver
(who holds nothing yet) and a former driver (who held an earlier period) need their own,
narrower door. Both reuse the existing size, MIME, hashing and Storage pipeline; only the
authorisation and the recorded purpose differ:

- A handover upload is allowed to either driver named on a PENDING request, for their own role
  on it, and is bound to that request and role (DriverSubstitutionUpload). The confirmation may
  later cite only that driver's own uploads for that role, so one driver's photo can never
  satisfy the other's independent capture, and an identical file already uploaded by the other
  driver is refused rather than counted twice.
- A late upload is allowed to a driver for a custody period they actually held and no longer
  hold, and is bound to that period. A phone timestamp never grants that authority; the
  completed handover chain does.

Neither touches a phase, so neither can complete one. Uploads are never deleted: an unused one
(a request cancelled before confirmation) stays retained and appears in no confirmation.

Same lock discipline as the ordinary route: authorise unlocked (refuse strangers before any
bytes move), upload to Storage with no lock held, then re-authorise under the trip lock and
check for an exact replay before inserting, because the Storage round trip is far too long to
hold the trip, crew and request locked across.
"""

import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError, SubstitutionInvalidError, SubstitutionVersionChangedError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.db.models.driver_substitutions import (
    DriverSubstitutionConfirmation, DriverSubstitutionRequest, DriverSubstitutionUpload,
)
from app.db.models.enums import ArtifactType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.trips import Trip
from app.orchestration.evidence.artifacts import MAX_FILE_SIZE_BYTES
from app.orchestration.substitutions.access import (
    custody_holders, get_current_custody, lock_trip, participant_driver_ids,
)
from app.orchestration.substitutions.guards import (
    lock_crew_and_request,
    require_live,
    require_pending_at,
)
from app.orchestration.substitutions.operations import (
    OperationKey,
    body_digest,
    find_replay,
    record_operation,
)
from app.schemas.driver_substitutions import SubstitutionRole, IMMEDIATE_V2
from app.schemas.evidence import EvidenceArtifactRead
from app.schemas.people import DriverRead
from app.storage.mime_allowlist import resolve_mime_type
from app.storage.supabase_storage import UploadResult, upload_evidence_file

logger = logging.getLogger(__name__)

ACTION_HANDOVER_UPLOAD = "handover_upload"
ACTION_LATE_UPLOAD = "late_upload"
PURPOSE_HANDOVER = "handover"
PURPOSE_LATE = "late_evidence"


@dataclass(frozen=True)
class ValidatedArtifactUpload:
    """One multipart upload as the route received it, with its idempotency key. `mime_type` is the
    client's claim and is re-derived from the bytes; the capturer comes from the token, never here."""

    client_request_id: uuid.UUID
    file_bytes: bytes
    mime_type: str
    artifact_type: ArtifactType
    captured_at: datetime
    captured_lat: Decimal | None = None
    captured_lng: Decimal | None = None


@dataclass(frozen=True)
class HandoverUploadClaim:
    """Which pending handover the photo is for, and the side the uploader says they are on."""

    request_id: uuid.UUID
    role: SubstitutionRole


@dataclass(frozen=True)
class _Placed:
    """Bytes already in Storage, with the MIME type derived from them."""

    stored: UploadResult
    verified_mime: str


class _UploadBody(BaseModel):
    """What identifies an upload for the idempotency digest: the bytes' hash, not the bytes."""

    purpose: str
    role: str | None
    custody_sequence: int | None
    file_hash: str
    artifact_type: str
    captured_at: datetime
    captured_lat: Decimal | None
    captured_lng: Decimal | None


def _checked(upload: ValidatedArtifactUpload) -> tuple[str, str]:
    """(verified MIME, SHA-256) or ValueError, before any query: the ordinary route's rules."""
    if len(upload.file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.")
    return resolve_mime_type(upload.file_bytes, upload.mime_type), hashlib.sha256(upload.file_bytes).hexdigest()


def _digest_body(
    upload: ValidatedArtifactUpload, *, purpose: str, file_hash: str,
    role: SubstitutionRole | None = None, custody_sequence: int | None = None,
) -> _UploadBody:
    return _UploadBody(
        purpose=purpose, role=None if role is None else role.value, custody_sequence=custody_sequence,
        file_hash=file_hash, artifact_type=upload.artifact_type.value, captured_at=upload.captured_at,
        captured_lat=upload.captured_lat, captured_lng=upload.captured_lng,
    )


async def _store(
    db: AsyncSession, *, trip: Trip, driver_id: uuid.UUID, upload: ValidatedArtifactUpload, placed: _Placed,
) -> EvidenceArtifact:
    """Insert the artifact row for bytes already in Storage. Deliberately unattributed: a
    handover or late photo is not a phase capture (the purpose lives on the upload row)."""
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip.id, artifact_type=upload.artifact_type,
        s3_key=placed.stored.s3_key, s3_bucket=placed.stored.s3_bucket,
        file_hash=placed.stored.file_hash, mime_type=placed.verified_mime, captured_by_driver_id=driver_id,
        captured_lat=upload.captured_lat, captured_lng=upload.captured_lng, captured_at=upload.captured_at,
        # Received = stored and recorded, on the server's clock (as the ordinary route stamps it).
        created_at=datetime.now(UTC),
    )
    db.add(artifact)
    await db.flush()
    await db.refresh(artifact)
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=RealtimeKind.EVIDENCE_UPLOADED))
    return artifact


# ── handover uploads ─────────────────────────────────────────────────────────


async def _named_role(
    db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID, driver_id: uuid.UUID, role: SubstitutionRole,
) -> None:
    """404 unless the driver is named on this request; 422 when the claimed role is not theirs."""
    named = (await db.execute(
        select(DriverSubstitutionRequest.outgoing_driver_id, DriverSubstitutionRequest.incoming_driver_id)
        .where(DriverSubstitutionRequest.id == request_id, DriverSubstitutionRequest.trip_id == trip_id)
    )).one_or_none()
    if named is None or driver_id not in (named.outgoing_driver_id, named.incoming_driver_id):
        raise ResourceNotFoundError("DriverSubstitutionRequest", str(request_id))
    actual = SubstitutionRole.OUTGOING if driver_id == named.outgoing_driver_id else SubstitutionRole.INCOMING
    if role is not actual:
        raise SubstitutionInvalidError(f"You are the {actual.value} driver on this handover.")


async def _require_open_role(db: AsyncSession, *, request: DriverSubstitutionRequest, role: SubstitutionRole) -> None:
    """Still pending, and this role's capture not yet saved (its photos could no longer be cited)."""
    if request.request_format == IMMEDIATE_V2 and role is SubstitutionRole.OUTGOING:
        raise SubstitutionInvalidError("Outgoing driver is notified only; no declaration is requested.")
    # An upload carries no version (contract), so only the state is checked here.
    require_pending_at(request, request.version)
    saved = (await db.execute(select(DriverSubstitutionConfirmation.id).where(
        DriverSubstitutionConfirmation.request_id == request.id, DriverSubstitutionConfirmation.role == role.value,
    ))).first()
    if saved is not None:
        raise SubstitutionVersionChangedError(request_id=request.id, current_version=request.version)


async def _refuse_counterpart_copy(
    db: AsyncSession, *, request_id: uuid.UUID, driver_id: uuid.UUID, file_hash: str,
) -> None:
    """An identical file the other driver already uploaded for this handover is their photo,
    not a second independent capture."""
    copied = (await db.execute(
        select(DriverSubstitutionUpload.id)
        .join(EvidenceArtifact, EvidenceArtifact.id == DriverSubstitutionUpload.artifact_id)
        .where(
            DriverSubstitutionUpload.request_id == request_id, DriverSubstitutionUpload.driver_id != driver_id,
            EvidenceArtifact.file_hash == file_hash,
        ).limit(1)
    )).first()
    if copied is not None:
        raise SubstitutionInvalidError("This exact photo was uploaded by the other driver; take your own photo.")


async def create_substitution_artifact(
    db: AsyncSession, *, trip_id: uuid.UUID, driver: DriverRead, claim: HandoverUploadClaim,
    upload: ValidatedArtifactUpload,
) -> EvidenceArtifactRead:
    """Store a photo for the driver's own side of a pending handover, ahead of their confirmation."""
    request_id, role, client_request_id = claim.request_id, claim.role, upload.client_request_id
    verified_mime, file_hash = _checked(upload)
    await _named_role(db, trip_id=trip_id, request_id=request_id, driver_id=driver.id, role=role)
    key = OperationKey(
        action=ACTION_HANDOVER_UPLOAD, client_request_id=client_request_id, actor_driver_id=driver.id,
        digest=body_digest(trip_id, request_id, body=_digest_body(
            upload, purpose=PURPOSE_HANDOVER, file_hash=file_hash, role=role,
        )),
    )
    # Unlocked peek: an exact retry costs no Storage upload. Re-checked under the lock below.
    early = await find_replay(db, key, result_type=EvidenceArtifactRead)
    if early is not None:
        return early

    stored = await upload_evidence_file(trip_id=str(trip_id), file_bytes=upload.file_bytes, mime_type=verified_mime)

    trip = await lock_trip(db, trip_id=trip_id)
    request = await lock_crew_and_request(db, trip=trip, request_id=request_id)
    replay = await find_replay(db, key, result_type=EvidenceArtifactRead)
    if replay is not None:
        logger.warning("Storage object %s orphaned: concurrent replay of upload %s", stored.s3_key, client_request_id)
        return replay
    require_live(trip, action="upload handover evidence")
    await _require_open_role(db, request=request, role=role)
    await _refuse_counterpart_copy(db, request_id=request.id, driver_id=driver.id, file_hash=file_hash)

    artifact = await _store(db, trip=trip, driver_id=driver.id, upload=upload, placed=_Placed(stored, verified_mime))
    db.add(DriverSubstitutionUpload(
        artifact_id=artifact.id, trip_id=trip.id, driver_id=driver.id, purpose=PURPOSE_HANDOVER,
        request_id=request.id, role=role.value,
    ))
    result = EvidenceArtifactRead.model_validate(artifact)
    record_operation(db, key, request_id=request.id, result=result)
    await db.flush()
    return result


# ── late uploads ─────────────────────────────────────────────────────────────


async def require_former_period(db: AsyncSession, *, trip: Trip, driver_id: uuid.UUID, custody_sequence: int) -> None:
    """The caller held `custody_sequence` and it is no longer current. A current period is the
    live routes' business; a period someone else held, or none, is not the caller's evidence.
    The caller has already established the driver participated (404 otherwise)."""
    holders = await custody_holders(db, trip=trip)
    if holders.get(custody_sequence) != driver_id:
        raise SubstitutionInvalidError("You did not hold this trip in that custody period.")
    if custody_sequence == (await get_current_custody(db, trip=trip)).sequence:
        raise SubstitutionInvalidError("That custody period is still current; submit through the live route.")


async def require_participant(db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID) -> None:
    if driver_id not in await participant_driver_ids(db, trip_id=trip_id):
        raise ResourceNotFoundError("Trip", str(trip_id))


async def create_late_evidence_artifact(
    db: AsyncSession, *, trip_id: uuid.UUID, driver: DriverRead, custody_sequence: int,
    upload: ValidatedArtifactUpload,
) -> EvidenceArtifactRead:
    """Retain a photo a driver captured in an earlier custody period of theirs, for review."""
    client_request_id = upload.client_request_id
    verified_mime, file_hash = _checked(upload)
    await require_participant(db, trip_id=trip_id, driver_id=driver.id)
    key = OperationKey(
        action=ACTION_LATE_UPLOAD, client_request_id=client_request_id, actor_driver_id=driver.id,
        digest=body_digest(trip_id, body=_digest_body(
            upload, purpose=PURPOSE_LATE, file_hash=file_hash, custody_sequence=custody_sequence,
        )),
    )
    early = await find_replay(db, key, result_type=EvidenceArtifactRead)
    if early is not None:
        return early

    stored = await upload_evidence_file(trip_id=str(trip_id), file_bytes=upload.file_bytes, mime_type=verified_mime)

    trip = await lock_trip(db, trip_id=trip_id)
    replay = await find_replay(db, key, result_type=EvidenceArtifactRead)
    if replay is not None:
        logger.warning("Storage object %s orphaned: concurrent replay of upload %s", stored.s3_key, client_request_id)
        return replay
    await require_former_period(db, trip=trip, driver_id=driver.id, custody_sequence=custody_sequence)

    artifact = await _store(db, trip=trip, driver_id=driver.id, upload=upload, placed=_Placed(stored, verified_mime))
    db.add(DriverSubstitutionUpload(
        artifact_id=artifact.id, trip_id=trip.id, driver_id=driver.id, purpose=PURPOSE_LATE,
        custody_sequence=custody_sequence,
    ))
    result = EvidenceArtifactRead.model_validate(artifact)
    record_operation(db, key, request_id=None, result=result)
    await db.flush()
    return result
