"""Pydantic v2 schemas for Vehicle (horse and trailer)."""

from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.db.models.enums import VehicleType


class VehicleBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    organization_id: UUID
    registration: str
    vehicle_type: VehicleType
    pulsit_device_id: str
    is_active: bool = True


class VehicleCreate(VehicleBase):
    pass


class VehicleCreateBody(BaseModel):
    """Fields the dispatcher submits when registering a new vehicle.

    organization_id is injected from the dispatcher's JWT — not accepted from the client.
    """
    model_config = ConfigDict(from_attributes=True)

    registration: str
    vehicle_type: VehicleType
    pulsit_device_id: str


class VehicleUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    registration: Optional[str] = None
    pulsit_device_id: Optional[str] = None
    is_active: Optional[bool] = None


class VehicleRead(VehicleBase):
    id: UUID
    created_at: datetime
