"""Append-only event-log models for vehicles, drivers and precincts.

Each row records a change to the underlying entity. event_type='created' captures
the initial snapshot. Critical-field changes get a Hedera anchor via
blockchain_receipt_id; cosmetic changes are recorded but unanchored.
"""
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base


class VehicleEvent(Base):
    __tablename__ = "vehicle_events"

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
    """Append-only log of changes to a precinct.

    Same shape as VehicleEvent by design — a precinct is reference data that FP-68's
    geofence verdict depends on, so a change to its coordinates or radius is an
    evidentiary event, not a settings tweak.

    Unlike vehicle events there is nothing to hash before anchoring: a precinct holds
    a business address and a business coordinate, no personal data. See
    precinct_service.create_precinct for why the canonical payload is in the clear.
    """

    __tablename__ = "precinct_events"

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
