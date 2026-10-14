"""SQLAlchemy model for evidence artifacts stored in S3."""

import uuid
from typing import Optional
from decimal import Decimal
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import ArtifactType, EvidenceRole


class EvidenceArtifact(Base):
    """Photo or document uploaded during a phase or checkpoint. trip_id uses
    use_alter=True: evidence_artifacts is created before trips in the migration,
    so the FK is added via ALTER TABLE after trips exists."""

    __tablename__ = "evidence_artifacts"
    __table_args__ = (
        # A role without a phase (or the reverse) would be an attribution nobody can check;
        # the pair is set together or not at all.
        CheckConstraint(
            "(phase_event_id IS NULL) = (evidence_role IS NULL)",
            name="ck_evidence_artifacts_attribution_pair",
        ),
        # Identical-content deduplication: the same bytes for the same phase and role are one
        # artifact, so a fallback re-upload or queue replay cannot add a second row. Partial
        # because unattributed rows (older apps, checkpoint and exception photos) predate the
        # rule and may legitimately share a hash.
        Index(
            "uq_evidence_artifacts_phase_role_hash",
            "phase_event_id", "evidence_role", "file_hash",
            unique=True,
            postgresql_where=text("phase_event_id IS NOT NULL"),
        ),
    )

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
    captured_by_driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=True
    )
    captured_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    captured_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    captured_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Which phase and evidence role the capture was taken for; both NULL when unattributed.
    # use_alter: phase_events already points at evidence_artifacts, so this FK closes a cycle
    # and is added after both tables exist. No ON DELETE: evidence is never cascaded away.
    phase_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("phase_events.id", use_alter=True, name="fk_evidence_artifacts_phase_event_id"),
        nullable=True,
    )
    evidence_role: Mapped[Optional[EvidenceRole]] = mapped_column(String(30), nullable=True)
