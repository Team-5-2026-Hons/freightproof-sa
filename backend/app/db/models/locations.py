"""SQLAlchemy model for the driver's per-trip location trail — the continuous path
between evidence-pinned GPS fixes (Checkpoint, PhaseEvent, TripException). POPIA:
never hashed or anchored to Hedera, scoped and readable only within an open trip,
and recorded server-side against the authenticated driver only."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base


class TripLocationPing(Base):
    """One driver-phone position fix, recorded while the driver used the app."""

    __tablename__ = "trip_location_pings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False
    )
    # Resolved server-side from the bearer token, stored explicitly since a trip can
    # be reassigned (DriverSubstitution).
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    # Numeric(10, 7) matches Checkpoint/TripException GPS columns — ~1cm resolution,
    # one precision schema-wide.
    lat: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    # Device-reported uncertainty in metres; nullable since a fix is still worth
    # keeping when the platform declines to estimate it.
    accuracy_m: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2), nullable=True)
    # Free-form client label (route, or action like 'phase-submit'), not an enum, so
    # an unrecognised label doesn't drop the row.
    context: Mapped[str] = mapped_column(String(80), nullable=False)
    # Device fix time, not server receipt time — the offline queue can replay a ping
    # hours later; created_at holds the receipt time.
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        # Every read is "the trail for one trip, in walked order".
        Index("ix_trip_location_pings_trip_recorded", "trip_id", "recorded_at"),
    )
