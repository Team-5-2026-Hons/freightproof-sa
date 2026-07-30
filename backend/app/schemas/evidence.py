"""Pydantic v2 schemas for EvidenceArtifact."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.db.models.enums import ArtifactType


class EvidenceArtifactBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    artifact_type: ArtifactType
    s3_key: str
    s3_bucket: str
    file_hash: str
    mime_type: str
    captured_at: datetime
    captured_by_driver_id: Optional[UUID] = None
    captured_by_user_id: Optional[UUID] = None
    captured_lat: Optional[Decimal] = None
    captured_lng: Optional[Decimal] = None


class EvidenceArtifactCreate(EvidenceArtifactBase):
    pass


class EvidenceArtifactUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # Artifacts are immutable after creation; only metadata fields may be patched.
    captured_lat: Optional[Decimal] = None
    captured_lng: Optional[Decimal] = None


class EvidenceArtifactRead(EvidenceArtifactBase):
    id: UUID
    created_at: datetime


class EvidenceArtifactWithUrl(EvidenceArtifactRead):
    """Dispatcher read shape: metadata plus a short-lived signed URL.

    A subclass rather than a field on EvidenceArtifactRead, because that schema is the
    driver PWA's POST response and the driver has no business receiving read URLs.

    signed_url is None when Storage declined to sign — the artifact is still evidence and
    its hash still stands, so the row is returned with the image unavailable.
    """

    signed_url: Optional[str] = None
