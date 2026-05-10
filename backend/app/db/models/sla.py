"""SQLAlchemy model for SLA configuration between operator and client."""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base


class SlaConfig(Base):
    """SLA thresholds for a given operator-client-route combination.

    Rows with null origin/destination precincts apply to all routes
    between that operator-client pair.
    """

    __tablename__ = "sla_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operator_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    client_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    origin_precinct_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    destination_precinct_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("precincts.id"), nullable=True
    )
    max_pickup_overrun_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_delivery_overrun_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 15 minutes matches the Pulsit stationary alert threshold in the domain.
    max_checkpoint_interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default="15")
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
