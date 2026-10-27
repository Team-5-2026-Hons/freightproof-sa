"""Incidents: the investigation a dispatcher runs over one or more exceptions.

An exception is an observation (seal broken, count short, tracker silent); an incident groups
the observations that belong to one event, names the affected cargo, and records every
follow-up on an append-only ledger (incident_updates). Incident.status / confidence /
assigned_to_user_id / outcome / closed_at / closure_reason are caches of that ledger — the
same rule current_phase follows — rewritten only by orchestration.incidents under a row lock.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import (
    IncidentConfidence,
    IncidentExternalAction,
    IncidentOutcome,
    IncidentReportChannel,
    IncidentReporterRole,
    IncidentStatus,
    IncidentType,
    IncidentUpdateKind,
    ParcelFinding,
)


class Incident(Base):
    __tablename__ = "incidents"
    __table_args__ = (
        UniqueConstraint("trip_id", "incident_number", name="uq_incidents_trip_number"),
        Index("ix_incidents_status", "status"),
        CheckConstraint(
            "(status = 'closed') = (outcome IS NOT NULL AND closed_at IS NOT NULL AND closure_reason IS NOT NULL)",
            name="ck_incidents_closed_cache",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    incident_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    incident_type: Mapped[IncidentType] = mapped_column(String(30), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    reported_by_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    reporter_role: Mapped[IncidentReporterRole] = mapped_column(String(30), nullable=False)
    report_channel: Mapped[IncidentReportChannel] = mapped_column(String(20), nullable=False)
    reported_occurred_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    recorded_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    trip_stopped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    status: Mapped[IncidentStatus] = mapped_column(String(20), nullable=False)
    confidence: Mapped[IncidentConfidence] = mapped_column(String(20), nullable=False)
    assigned_to_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    outcome: Mapped[Optional[IncidentOutcome]] = mapped_column(String(30), nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    closure_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class IncidentUpdate(Base):
    """One append-only ledger entry. No code path updates or deletes a row."""

    __tablename__ = "incident_updates"
    __table_args__ = (
        UniqueConstraint("incident_id", "sequence", name="uq_incident_updates_sequence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("incidents.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[IncidentUpdateKind] = mapped_column(String(30), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    from_value: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    to_value: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    parcel_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("parcels.id"), nullable=True)
    exception_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exceptions.id"), nullable=True
    )
    phase_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=True
    )
    artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=True
    )
    external_action: Mapped[Optional[IncidentExternalAction]] = mapped_column(String(40), nullable=True)
    action_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    recorded_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class IncidentException(Base):
    """An exception grouped under an incident. Unique per exception: one observation belongs
    to one investigation, or two incidents would each claim the same broken seal."""

    __tablename__ = "incident_exceptions"
    __table_args__ = (
        UniqueConstraint("exception_id", name="uq_incident_exceptions_exception"),
        Index("ix_incident_exceptions_incident_id", "incident_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("incidents.id"), nullable=False)
    exception_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("exceptions.id"), nullable=False)
    linked_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class IncidentParcel(Base):
    """A parcel named as affected. latest_finding caches the last PARCEL_FINDING entry for it;
    null means nothing has been established yet."""

    __tablename__ = "incident_parcels"
    __table_args__ = (
        UniqueConstraint("incident_id", "parcel_id", name="uq_incident_parcels_incident_parcel"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("incidents.id"), nullable=False)
    parcel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("parcels.id"), nullable=False)
    added_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    latest_finding: Mapped[Optional[ParcelFinding]] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
