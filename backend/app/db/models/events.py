"""Append-only event-log models for vehicles, drivers and precincts.

Each row records a change to the underlying entity. event_type='created' captures
the initial snapshot. Critical-field changes get a Hedera anchor via
blockchain_receipt_id; cosmetic changes are recorded but unanchored.
"""
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base


class VehicleEvent(Base):
    __tablename__ = "vehicle_events"
    # Declared so autogenerate stops proposing to drop an index that already exists.
    __table_args__ = (
        Index("ix_vehicle_events_vehicle_id", "vehicle_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    changed_fields: Mapped[Any] = mapped_column(JSONB, nullable=False)
    changed_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "blockchain_receipts.id",
            use_alter=True,
            name="fk_vehicle_events_blockchain_receipt",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DriverEvent(Base):
    __tablename__ = "driver_events"
    # Declared so autogenerate stops proposing to drop an index that already exists.
    __table_args__ = (
        Index("ix_driver_events_driver_id", "driver_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    changed_fields: Mapped[Any] = mapped_column(JSONB, nullable=False)
    changed_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "blockchain_receipts.id",
            use_alter=True,
            name="fk_driver_events_blockchain_receipt",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PrecinctEvent(Base):
    """Append-only log of changes to a precinct — same shape as VehicleEvent, since a
    precinct is reference data FP-68's geofence verdict depends on. Nothing to hash
    before anchoring: it holds no personal data (see precinct_service.create_precinct)."""

    __tablename__ = "precinct_events"
    # Declared so autogenerate stops proposing to drop an index that already exists.
    __table_args__ = (
        Index("ix_precinct_events_precinct_id", "precinct_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    precinct_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    changed_fields: Mapped[Any] = mapped_column(JSONB, nullable=False)
    changed_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    blockchain_receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "blockchain_receipts.id",
            use_alter=True,
            name="fk_precinct_events_blockchain_receipt",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
