"""Evidence artifact creation — uploads to Storage, records the DB row."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.evidence import EvidenceArtifact
from app.db.models.enums import ArtifactType
from app.db.models.trips import Trip
from app.schemas.evidence import EvidenceArtifactRead
from app.storage.supabase_storage import upload_evidence_file

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
    captured_by_driver_id isn't the trip's assigned driver (caller maps to 403)."""
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.")

    trip_result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = trip_result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != captured_by_driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    upload = await upload_evidence_file(trip_id=str(trip_id), file_bytes=file_bytes, mime_type=mime_type)

    artifact = EvidenceArtifact(
        id=uuid.uuid4(),
        trip_id=trip_id,
        artifact_type=artifact_type,
        s3_key=upload.s3_key,
        s3_bucket=upload.s3_bucket,
        file_hash=upload.file_hash,
        mime_type=mime_type,
        captured_by_driver_id=captured_by_driver_id,
        captured_lat=captured_lat,
        captured_lng=captured_lng,
        captured_at=captured_at,
    )
    db.add(artifact)
    await db.flush()
    await db.refresh(artifact)
    return EvidenceArtifactRead.model_validate(artifact)
