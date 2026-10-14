"""Issued audit packs and every access to them.

A pack row is evidence of what was handed to whom: it is never deleted or rewritten.
Revoking stops the share link; the manifest, PDF and Hedera seal stay, because "what
did we give the insurer on 14 September" must stay answerable.
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import AnchorStatus, AuditPackAccessEventType


class AuditPack(Base):
    __tablename__ = "audit_packs"
    __table_args__ = (
        # AP1, AP2… per trip; the unique pair makes two concurrent issues collide in the
        # database instead of both becoming "AP2".
        UniqueConstraint("trip_id", "pack_version", name="uq_audit_packs_trip_version"),
        Index("uq_audit_packs_token_hash", "token_hash", unique=True),
        Index("ix_audit_packs_trip_id", "trip_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    # Set for a single-consignment pack; NULL means the whole trip.
    consignment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("consignments.id"), nullable=True
    )
    # Issuing operator — every dispatcher read is scoped by it.
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    pack_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    purpose: Mapped[str] = mapped_column(String(30), nullable=False)
    external_reference: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    recipient_name: Mapped[str] = mapped_column(String(200), nullable=False)
    recipient_organization: Mapped[str] = mapped_column(String(200), nullable=False)
    recipient_email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    include_location_trail: Mapped[bool] = mapped_column(Boolean, nullable=False)
    include_full_driver_id: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # The frozen snapshot every rendering is produced from. Holds personal data, so it
    # stays here in af-south-1; only manifest_sha256 (inside the seal) reaches Hedera.
    manifest_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    manifest_json: Mapped[Any] = mapped_column(JSONB, nullable=False)
    manifest_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    pdf_storage_bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    pdf_storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    pdf_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    pdf_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    # Fail-open like phase anchors: a Hedera outage must not stop an operator sending
    # evidence to an insurer, but a failed seal is shown as failed, never as sealed.
    anchor_status: Mapped[AnchorStatus] = mapped_column(String(20), nullable=False)
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("blockchain_receipts.id"), nullable=True
    )
    # SHA-256 of the share-link token; the raw token is returned once and never stored.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Set in Python, not by server default: it is part of the anchored seal payload, so
    # the value hashed must be exactly the value stored.
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    issued_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    revoked_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AuditPackAccessEvent(Base):
    """Append-only log of every use of a pack's share link."""

    __tablename__ = "audit_pack_access_events"
    __table_args__ = (
        Index("ix_audit_pack_access_events_pack_created", "audit_pack_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    audit_pack_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("audit_packs.id"), nullable=False
    )
    event_type: Mapped[AuditPackAccessEventType] = mapped_column(String(30), nullable=False)
    client_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(400), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class IncidentDeclaration(Base):
    """Police-report and notification facts an operator declares after an incident —
    the claim-form fields FreightProof cannot capture itself (SAPS station, CAS number,
    who was told when). Append-only: a correction is a new row, never an edit."""

    __tablename__ = "incident_declarations"
    __table_args__ = (
        Index("ix_incident_declarations_trip_created", "trip_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    exception_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exceptions.id"), nullable=True
    )
    saps_station: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    saps_cas_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    saps_officer: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    reported_to_saps_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    tracking_company_notified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    insurer_notified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    client_notified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    insurer_claim_reference: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    declared_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
