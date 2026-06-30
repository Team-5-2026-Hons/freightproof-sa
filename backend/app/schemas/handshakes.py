"""Pydantic v2 schemas for HandshakeEvent and TrailerGpsSnapshot."""

import re
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
    pod_signature_artifact_id: Optional[UUID] = None
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
    pod_signature_artifact_id: Optional[UUID] = None
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


_SEAL_PATTERN = re.compile(r"^[A-Z]{2}-\d{4}$")


def _validate_seal_format(v: str) -> str:
    if not _SEAL_PATTERN.match(v):
        raise ValueError("seal number must be in format XX-#### (e.g. AB-1234)")
    return v


class H1CompleteRequest(BaseModel):
    driver_phone_lat: Decimal
    driver_phone_lng: Decimal
    gate_photo_artifact_id: UUID


class H2CompleteRequest(BaseModel):
    waybill_photo_artifact_id: UUID
    seal_number: str
    seal_photo_artifact_id: UUID
    driver_visual_count: int

    @field_validator("seal_number")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class H3CompleteRequest(BaseModel):
    gate_exit_photo_artifact_id: UUID
    guard_verified_seal: bool


class H4CompleteRequest(BaseModel):
    gate_entry_photo_artifact_id: UUID
    seal_number_at_destination: str

    @field_validator("seal_number_at_destination")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class H5CompleteRequest(BaseModel):
    # BQ2 resolved 2026-06-29: proof of delivery is a photo AND an on-device
    # signature — both required, not either/or.
    pod_photo_artifact_id: UUID
    pod_signature_artifact_id: UUID
    driver_visual_count: int
    pp_scan_in_count: int
