"""SQLAlchemy model for vehicles (horses and trailers unified)."""

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
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
    make: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    vin_number: Mapped[Optional[str]] = mapped_column(String(17), nullable=True, unique=True)
    licence_disc_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    gross_vehicle_mass_kg: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
