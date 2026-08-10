"""Pydantic v2 schemas for VehicleEvent and DriverEvent read shapes."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class VehicleEventRead(BaseModel):
    id: UUID
    vehicle_id: UUID
    event_type: str
    changed_fields: dict[str, Any]
    changed_by_user_id: UUID
    blockchain_receipt_id: UUID | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DriverEventRead(BaseModel):
    id: UUID
    driver_id: UUID
    event_type: str
    changed_fields: dict[str, Any]
    changed_by_user_id: UUID
    blockchain_receipt_id: UUID | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
