"""Consignment and parcel wire schemas shared by trip and manifest responses."""

from datetime import datetime
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.db.models.enums import ParcelStatus


class ConsignmentBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: Optional[UUID] = None
    parcel_perfect_reference: str
    client_organization_id: Optional[UUID] = None
    origin_precinct_id: Optional[UUID] = None
    destination_precinct_id: Optional[UUID] = None
    declared_value: Optional[Decimal] = None
    parcel_count_expected: Optional[int] = None
    slot_time_origin: Optional[datetime] = None
    slot_time_destination: Optional[datetime] = None
    pp_raw_json: Optional[Any] = None
    pickup_stop_id: Optional[UUID] = None
    delivery_stop_id: Optional[UUID] = None
    load_priority: Optional[int] = None
    unit_count_expected: Optional[int] = None
    pp_manifest_number: Optional[int] = None


class ConsignmentRead(ConsignmentBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    scanned_out_count: int = 0
    scanned_in_count: int = 0


class ParcelBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    consignment_id: UUID
    barcode: str
    description: Optional[str] = None
    delivery_stop: Optional[str] = None
    status: ParcelStatus = ParcelStatus.PENDING


class ParcelRead(ParcelBase):
    id: UUID
    pp_scan_out_at: Optional[datetime] = None
    pp_scan_in_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

