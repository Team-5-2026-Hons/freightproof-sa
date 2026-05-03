"""Pydantic v2 schemas for HandshakeEvent and TrailerGpsSnapshot."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, field_validator

from app.db.models.enums import HandshakeStatus, HandshakeType


class HandshakeEventBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    handshake_type: HandshakeType
    sequence_number: int


class HandshakeEventCreate(HandshakeEventBase):
    @field_validator("sequence_number")
    @classmethod
    def validate_sequence_number(cls, v: int) -> int:
        if v < 0 or v > 5:
            raise ValueError("sequence_number must be between 0 and 5 (H0–H5)")
        return v


class HandshakeEventUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: Optional[HandshakeStatus] = None
    dispatcher_override_user_id: Optional[UUID] = None
    dispatcher_override_note: Optional[str] = None
    driver_phone_lat: Optional[Decimal] = None
    driver_phone_lng: Optional[Decimal] = None
    horse_gps_lat: Optional[Decimal] = None
    horse_gps_lng: Optional[Decimal] = None
    pulsit_geofence_confirmed: Optional[bool] = None
    seal_number: Optional[str] = None
    seal_photo_artifact_id: Optional[UUID] = None
    waybill_photo_artifact_id: Optional[UUID] = None
    gate_photo_artifact_id: Optional[UUID] = None
    pod_photo_artifact_id: Optional[UUID] = None
    parcel_manifest_snapshot: Optional[Any] = None
    parcel_count_origin: Optional[int] = None
    parcel_count_destination: Optional[int] = None
    driver_visual_count: Optional[int] = None
    event_hash: Optional[str] = None
    blockchain_receipt_id: Optional[UUID] = None
    completed_at: Optional[datetime] = None


class HandshakeEventRead(HandshakeEventBase):
    id: UUID
    status: HandshakeStatus
    dispatcher_override_user_id: Optional[UUID] = None
    dispatcher_override_note: Optional[str] = None
    driver_phone_lat: Optional[Decimal] = None
    driver_phone_lng: Optional[Decimal] = None
    horse_gps_lat: Optional[Decimal] = None
    horse_gps_lng: Optional[Decimal] = None
    pulsit_geofence_confirmed: Optional[bool] = None
    seal_number: Optional[str] = None
    seal_photo_artifact_id: Optional[UUID] = None
    waybill_photo_artifact_id: Optional[UUID] = None
    gate_photo_artifact_id: Optional[UUID] = None
    pod_photo_artifact_id: Optional[UUID] = None
    parcel_manifest_snapshot: Optional[Any] = None
    parcel_count_origin: Optional[int] = None
    parcel_count_destination: Optional[int] = None
    driver_visual_count: Optional[int] = None
    event_hash: Optional[str] = None
    blockchain_receipt_id: Optional[UUID] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class TrailerGpsSnapshotBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    handshake_event_id: UUID
    trailer_id: UUID
    pulsit_device_id: str
    lat: Decimal
    lng: Decimal
    captured_at: datetime


class TrailerGpsSnapshotCreate(TrailerGpsSnapshotBase):
    pass


class TrailerGpsSnapshotRead(TrailerGpsSnapshotBase):
    id: UUID
    created_at: datetime
