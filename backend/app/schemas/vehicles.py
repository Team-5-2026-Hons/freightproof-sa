"""Pydantic v2 schemas for Vehicle (horse and trailer)."""

from datetime import date, datetime
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
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    vin_number: Optional[str] = None
    licence_disc_expiry: Optional[date] = None
    gross_vehicle_mass_kg: Optional[int] = None


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
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    vin_number: Optional[str] = None
    licence_disc_expiry: Optional[date] = None
    gross_vehicle_mass_kg: Optional[int] = None


class VehicleUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    registration: Optional[str] = None
    pulsit_device_id: Optional[str] = None
    is_active: Optional[bool] = None


class VehicleRead(VehicleBase):
    id: UUID
    created_at: datetime


# Imported here (not at the top of the module) to avoid a circular import:
# vehicles.py → blockchain.py → enums.py is fine, but resource_service.py
# imports both VehicleRead and BlockchainReceiptRead from their respective
# schema modules, so the dependency graph stays acyclic.
from app.schemas.blockchain import BlockchainReceiptRead  # noqa: E402
from app.schemas.events import VehicleEventRead  # noqa: E402


class VehicleDetailResponse(VehicleRead):
    """Extended vehicle shape returned by GET /vehicles/{id}.

    Includes the full event log, linked blockchain receipts, and the IDs of
    trips that used this vehicle (as horse or trailer).
    """

    events: list[VehicleEventRead] = []
    receipts: list[BlockchainReceiptRead] = []
    trip_ids: list[UUID] = []
