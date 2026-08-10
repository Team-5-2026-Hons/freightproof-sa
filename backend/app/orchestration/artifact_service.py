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
