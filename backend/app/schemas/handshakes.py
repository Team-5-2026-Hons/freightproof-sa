"""Pydantic v2 schemas for HandshakeEvent and TrailerGpsSnapshot."""

import re
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.enums import PhaseStatus, PhaseType


class HandshakeEventBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    phase_type: PhaseType
    sequence_number: int


class HandshakeEventCreate(HandshakeEventBase):
    # No sequence bound. `0 <= v <= 5` encoded "H0–H5" as a schema rule; a
    # three-stop cross-dock legitimately reaches sequence 10, and the length of a
    # plan is a property of the trip's stops, not of any enum.
    pass


class HandshakeEventUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: Optional[PhaseStatus] = None
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
    status: PhaseStatus
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

    phase_event_id: UUID
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
    # The driver app's offline-queue entry id, echoed back on replay (task 2.4).
    # Stored on the PhaseEvent row unconditionally; a resubmitted completion
    # with the same key returns the current state instead of erroring or
    # duplicating — drivers lose signal, replay is normal, not exceptional.
    idempotency_key: str = Field(..., min_length=1)


class H2CompleteRequest(BaseModel):
    # D7/T5: the seal (waybill photo, seal number, seal photo) is applied at
    # departure now, not loading — see H3CompleteRequest. Loading only ever
    # captures the driver's own visual parcel count.
    driver_visual_count: int
    idempotency_key: str = Field(..., min_length=1)


class H3CompleteRequest(BaseModel):
    # D7/T5: the seal is applied HERE, at departure — the driver photographs
    # the waybill and seal as they physically close the trailer at exit.
    waybill_photo_artifact_id: UUID
    seal_number: str
    seal_photo_artifact_id: UUID
    guard_verified_seal: bool
    # Seal number the driver re-entered at the exit gate. Optional for backward
    # compatibility; when present the server compares it against THIS SAME
    # request's committed seal_number (authoritative), superseding the
    # client-computed guard_verified_seal. Free-form (no XX-#### pattern): a
    # mistyped confirmation is itself evidence of a mismatch and must be
    # recordable, not rejected with a 422.
    seal_number_confirmed: str | None = None
    idempotency_key: str = Field(..., min_length=1)

    @field_validator("seal_number")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class H4CompleteRequest(BaseModel):
    seal_number_at_destination: str
    idempotency_key: str = Field(..., min_length=1)

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
    idempotency_key: str = Field(..., min_length=1)
