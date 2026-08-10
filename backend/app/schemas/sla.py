"""Pydantic v2 schemas for SlaConfig."""

from datetime import date, datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict


class SlaConfigBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    operator_organization_id: UUID
    client_organization_id: UUID
    effective_from: date
    origin_precinct_id: Optional[UUID] = None
    destination_precinct_id: Optional[UUID] = None
    max_pickup_overrun_minutes: Optional[int] = None
    max_delivery_overrun_minutes: Optional[int] = None
    max_checkpoint_interval_minutes: int = 15
    effective_to: Optional[date] = None


class SlaConfigCreate(SlaConfigBase):
    pass


class SlaConfigUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    max_pickup_overrun_minutes: Optional[int] = None
    max_delivery_overrun_minutes: Optional[int] = None
    max_checkpoint_interval_minutes: Optional[int] = None
    effective_to: Optional[date] = None


class SlaConfigRead(SlaConfigBase):
    id: UUID
    created_at: datetime
