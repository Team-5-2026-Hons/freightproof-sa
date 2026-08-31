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

# Constraint names are read by orchestration when translating a unique violation into
# a message naming the field that actually clashed, so they live beside the definitions
# rather than as literals at the point that catches them.
UQ_VEHICLES_ORG_PULSIT = "uq_vehicles_org_pulsit"
UQ_VEHICLES_ORG_REGISTRATION = "uq_vehicles_org_registration"

# Which user-facing field each constraint is about. A dispatcher can only fix the
# thing they typed, so the 409 has to name it correctly.
VEHICLE_UNIQUE_FIELDS: dict[str, str] = {
    UQ_VEHICLES_ORG_PULSIT: "pulsit_device_id",
    UQ_VEHICLES_ORG_REGISTRATION: "registration",
    # vin_number carries unique=True on the column, and the deployed database and the
    # model metadata disagree about what that index is called: dev has
    # ix_vehicles_vin_number (created by an earlier migration) while
    # Base.metadata.create_all produces vehicles_vin_number_key. Both are listed
    # deliberately — mapping only one would pass every test and return a 500 in
    # production. That divergence is the model/DB drift flagged separately; this map
    # tolerates it rather than pretending it is resolved.
    "vehicles_vin_number_key": "vin_number",
    "ix_vehicles_vin_number": "vin_number",
}


class Vehicle(Base):
    """Horse (cab) or trailer — distinguished by vehicle_type.

    A single Pulsit device is registered per vehicle. The unique constraint on
    (organization_id, pulsit_device_id) prevents the same tracker being
    assigned to two vehicles in the same fleet.
    """

    __tablename__ = "vehicles"
    __table_args__ = (
        UniqueConstraint("organization_id", "pulsit_device_id", name=UQ_VEHICLES_ORG_PULSIT),
        # One registration per fleet. create_vehicle has always caught a unique
        # violation and reported it as a duplicate registration, but no constraint on
        # registration existed — so duplicates were accepted outright, and the message
        # was in fact describing a clash on pulsit_device_id.
        UniqueConstraint("organization_id", "registration", name=UQ_VEHICLES_ORG_REGISTRATION),
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
    length_m: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
