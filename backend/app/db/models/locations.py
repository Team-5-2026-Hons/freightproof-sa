"""SQLAlchemy model for the driver's per-trip location trail.

Distinct from every other GPS column in the schema, which is pinned to a single
piece of evidence: Checkpoint.driver_phone_lat is where a checkpoint was logged,
PhaseEvent.driver_phone_lat is where a handshake was completed, TripException.gps_lat
is where a panic was raised. This table is the continuous trail BETWEEN those points —
one row per driver interaction with the PWA while a trip is open.

POPIA, and this table is the sharpest case of it in the schema: a movement trail of a
named person is materially more sensitive than a fix attached to an evidence event, and
it exists to answer "where was this trip" in a dispute, nothing else. Consequences that
are load-bearing, not advisory:

  * Rows stay in Postgres in af-south-1. Nothing here is ever hashed, batched, or
    anchored to Hedera — no canonical-payload builder may read this table.
  * The trail is scoped to a trip. It is written only while a trip is open and is
    readable only through that trip's own authorisation path.
  * Recorded server-side against the authenticated driver, never a client-supplied
    driver id.
"""

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
    # The driver the fix belongs to, resolved from the bearer token server-side. Stored
    # explicitly rather than left implicit via the trip: a trip can be reassigned
    # (DriverSubstitution), and a trail row must keep saying whose phone produced it.
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False
    )
    # Numeric(10, 7) matches Checkpoint.driver_phone_lat / TripException.gps_lat exactly —
    # ~1cm resolution, and one precision for every coordinate in the schema.
    lat: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    # Metres of horizontal uncertainty as reported by the device. Nullable because a
    # fix is still worth keeping when the platform declines to estimate it, and it is
    # what lets a dispute distinguish a 5m fix from a 2km cell-tower guess.
    accuracy_m: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2), nullable=True)
    # What the driver was doing. Free-form short label from the client (a route, or an
    # action like 'phase-submit'), deliberately not an enum: the PWA's screens change
    # far more often than this table should, and an unknown label is still a legible
    # trail entry, whereas a failed enum lookup would drop the row entirely.
    context: Mapped[str] = mapped_column(String(80), nullable=False)
    # When the DEVICE took the fix, which is not when the server received it: the offline
    # queue can replay a ping hours later, and a trail ordered by arrival time would draw
    # the route in the wrong order. created_at keeps the receipt time for audit.
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        # Every read of this table is "the trail for one trip, in the order it was
        # walked" — the composite index serves that directly.
        Index("ix_trip_location_pings_trip_recorded", "trip_id", "recorded_at"),
    )
