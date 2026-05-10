"""SQLAlchemy model for vehicles (horses and trailers unified)."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import VehicleType


class Vehicle(Base):
    """Horse (cab) or trailer — distinguished by vehicle_type.

    A single Pulsit device is registered per vehicle. The unique constraint on
    (organization_id, pulsit_device_id) prevents the same tracker being
    assigned to two vehicles in the same fleet.
    """

    __tablename__ = "vehicles"
    __table_args__ = (
        UniqueConstraint("organization_id", "pulsit_device_id", name="uq_vehicles_org_pulsit"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    registration: Mapped[str] = mapped_column(String(50), nullable=False)
    vehicle_type: Mapped[VehicleType] = mapped_column(String(20), nullable=False)
    pulsit_device_id: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
