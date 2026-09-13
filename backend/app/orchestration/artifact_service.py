"""Evidence artifact creation — uploads to Storage, records the DB row."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.evidence import EvidenceArtifact
from app.db.models.enums import ArtifactType
from app.db.models.trips import Trip
from app.schemas.evidence import EvidenceArtifactRead, EvidenceArtifactWithUrl
from app.storage.mime_allowlist import resolve_mime_type
from app.storage.supabase_storage import create_signed_url, upload_evidence_file

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024


async def create_artifact(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    file_bytes: bytes,
    mime_type: str,
    artifact_type: ArtifactType,
    captured_at: datetime,
    captured_by_driver_id: uuid.UUID,
    captured_lat: Decimal | None = None,
    captured_lng: Decimal | None = None,
) -> EvidenceArtifactRead:
    """Raises ResourceNotFoundError if the trip doesn't exist, PermissionError if
    captured_by_driver_id isn't the trip's assigned driver (caller maps to 403).

    `mime_type` arrives as the CLIENT'S claim about the file. It is not trusted and not
    stored — resolve_mime_type re-derives the type from the bytes and that is what lands
    on the record and on the Storage object. See app/storage/mime_allowlist.py.
    """
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.")

    # Before the trip lookup: an unsupported file is rejected without spending a query.
    verified_mime_type = resolve_mime_type(file_bytes, mime_type)

    trip_result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = trip_result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != captured_by_driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    return await _persist_artifact(
        db,
        trip_id=trip_id,
        file_bytes=file_bytes,
        verified_mime_type=verified_mime_type,
        artifact_type=artifact_type,
        captured_at=captured_at,
        captured_by_driver_id=captured_by_driver_id,
        captured_lat=captured_lat,
        captured_lng=captured_lng,
    )


async def _persist_artifact(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    file_bytes: bytes,
    verified_mime_type: str,
    artifact_type: ArtifactType,
    captured_at: datetime,
    captured_by_driver_id: uuid.UUID | None,
    captured_lat: Decimal | None,
    captured_lng: Decimal | None,
) -> EvidenceArtifactRead:
    """Upload the bytes and write the row.

    Assumes the caller has already decided the upload is authorised. That decision
    differs per caller — the assigned driver for create_artifact, a redeemed capability
    token for create_receiver_artifact — and deliberately does not live here, so neither
    check can be skipped by routing around this function.
    """
    upload = await upload_evidence_file(
        trip_id=str(trip_id), file_bytes=file_bytes, mime_type=verified_mime_type,
    )

    artifact = EvidenceArtifact(
        id=uuid.uuid4(),
        trip_id=trip_id,
        artifact_type=artifact_type,
        s3_key=upload.s3_key,
        s3_bucket=upload.s3_bucket,
        file_hash=upload.file_hash,
        mime_type=verified_mime_type,
        captured_by_driver_id=captured_by_driver_id,
        captured_lat=captured_lat,
        captured_lng=captured_lng,
        captured_at=captured_at,
    )
    db.add(artifact)
    await db.flush()
    await db.refresh(artifact)
    return EvidenceArtifactRead.model_validate(artifact)


async def create_receiver_artifact(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    file_bytes: bytes,
    mime_type: str,
    artifact_type: ArtifactType,
    captured_at: datetime,
    captured_lat: Decimal | None = None,
    captured_lng: Decimal | None = None,
) -> EvidenceArtifactRead:
    """Store an artifact produced by a receiver holding a redeemed capability token.

    Deliberately NOT create_artifact with a nullable driver id. That function's
    `trip.driver_id != captured_by_driver_id` check is its reason to exist, and making it
    skippable would put an `if caller_is_trusted` branch inside the one place that decides
    whether an upload belongs to its trip. The authorisation here is a different thing
    entirely — a single-use capability token the caller has already redeemed — and it
    belongs to the caller, not to this function.

    Both attribution columns are left NULL, which is the honest record: nobody with an
    account on this system captured this. The evidence that it came from the receiver is
    the HandoverConfirmation row referencing it, not a column here pointing at a driver
    who was standing on the other side of the transaction.
    """
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.")

    # Before the trip lookup: an unsupported file is rejected without spending a query.
    verified_mime_type = resolve_mime_type(file_bytes, mime_type)

    trip = (await db.execute(select(Trip).where(Trip.id == trip_id))).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    return await _persist_artifact(
        db,
        trip_id=trip_id,
        file_bytes=file_bytes,
        verified_mime_type=verified_mime_type,
        artifact_type=artifact_type,
        captured_at=captured_at,
        captured_by_driver_id=None,
        captured_lat=captured_lat,
        captured_lng=captured_lng,
    )


async def list_artifacts_for_trip(
    db: AsyncSession, trip_id: uuid.UUID, *, operator_organization_id: uuid.UUID,
) -> list[EvidenceArtifactWithUrl]:
    """Every artifact on one trip, each with a freshly minted signed URL.

    Tenancy is enforced in the trip lookup, mirroring get_manifest_for_dispatcher: a trip
    belonging to another operator is indistinguishable from one that does not exist.
    """
    trip_result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == operator_organization_id)
    )
    if trip_result.scalar_one_or_none() is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    artifacts_result = await db.execute(
        select(EvidenceArtifact)
        .where(EvidenceArtifact.trip_id == trip_id)
        .order_by(EvidenceArtifact.captured_at)
    )

    out: list[EvidenceArtifactWithUrl] = []
    for artifact in artifacts_result.scalars().all():
        signed_url = await create_signed_url(
            s3_bucket=artifact.s3_bucket,
            s3_key=artifact.s3_key,
            ttl_seconds=settings.EVIDENCE_SIGNED_URL_TTL_SECONDS,
        )
        # model_copy rather than a model_validate(update=...) kwarg: model_validate has no
        # such parameter in Pydantic v2, and signed_url is not an ORM attribute to read.
        out.append(
            EvidenceArtifactWithUrl.model_validate(artifact).model_copy(
                update={"signed_url": signed_url}
            )
        )
    return out


async def get_trip_scoped_artifact(
    db: AsyncSession, *, artifact_id: uuid.UUID, trip_id: uuid.UUID,
) -> EvidenceArtifactWithUrl | None:
    """Resolve and sign exactly one artifact, scoped to the trip it must belong to.

    An artifact id that exists but belongs to a different trip is indistinguishable
    from one that does not exist at all (Task 0B's ownership invariant) — callers must
    never trust a stored artifact id without this check, even one this same codebase
    wrote. Returns None only when no such artifact is scoped to this trip; a found
    artifact is always returned, with signed_url left None if Storage declines to sign
    it (the artifact is still evidence even when its image can't be fetched right now).
    """
    result = await db.execute(
        select(EvidenceArtifact).where(
            EvidenceArtifact.id == artifact_id, EvidenceArtifact.trip_id == trip_id,
        )
    )
    artifact = result.scalar_one_or_none()
    if artifact is None:
        return None

    signed_url = await create_signed_url(
        s3_bucket=artifact.s3_bucket, s3_key=artifact.s3_key,
        ttl_seconds=settings.EVIDENCE_SIGNED_URL_TTL_SECONDS,
    )
    return EvidenceArtifactWithUrl.model_validate(artifact).model_copy(
        update={"signed_url": signed_url}
    )
