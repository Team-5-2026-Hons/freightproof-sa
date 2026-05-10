"""SQLAlchemy model for evidence artifacts stored in S3."""

import uuid
from decimal import Decimal
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import ArtifactType


class EvidenceArtifact(Base):
    """Photo or document uploaded during a handshake or checkpoint.

    trip_id uses use_alter=True: evidence_artifacts is created before trips in
    the migration to allow handshake_events to reference both tables. The FK
    is added via ALTER TABLE after trips exists.
    """

    __tablename__ = "evidence_artifacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trips.id", use_alter=True, name="fk_evidence_artifacts_trip_id"),
        nullable=False,
    )
    artifact_type: Mapped[ArtifactType] = mapped_column(String(20), nullable=False)
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False)
    s3_bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    captured_by_driver_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=True
    )
    captured_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    captured_lat: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    captured_lng: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
