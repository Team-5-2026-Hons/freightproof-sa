"""Pydantic v2 schemas for Checkpoint and TripException."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType


class CheckpointBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    checkpoint_type: str
    driver_phone_lat: Optional[Decimal] = None
    driver_phone_lng: Optional[Decimal] = None
    horse_gps_lat: Optional[Decimal] = None
    horse_gps_lng: Optional[Decimal] = None
    selfie_artifact_id: Optional[UUID] = None
    cargo_photo_artifact_id: Optional[UUID] = None
    note: Optional[str] = None
    is_deviation: bool = False


class CheckpointCreate(CheckpointBase):
    pass


class DriverCheckpointCreateBody(BaseModel):
    """Slim checkpoint-creation body for the driver endpoint — trip_id comes from the URL path."""

    checkpoint_type: str
    driver_phone_lat: Optional[Decimal] = None
    driver_phone_lng: Optional[Decimal] = None
    horse_gps_lat: Optional[Decimal] = None
    horse_gps_lng: Optional[Decimal] = None
    selfie_artifact_id: Optional[UUID] = None
    cargo_photo_artifact_id: Optional[UUID] = None
    note: Optional[str] = None
    is_deviation: bool = False


class CheckpointUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    merkle_batch_id: Optional[UUID] = None
    note: Optional[str] = None


class CheckpointRead(CheckpointBase):
    id: UUID
    merkle_batch_id: Optional[UUID] = None
    created_at: datetime


class TripExceptionBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    exception_type: ExceptionType
    source: ExceptionSource
    severity: ExceptionSeverity
    description: str
    handshake_event_id: Optional[UUID] = None
    checkpoint_id: Optional[UUID] = None
    supporting_artifact_id: Optional[UUID] = None


class TripExceptionCreate(TripExceptionBase):
    pass


class DriverExceptionCreateBody(BaseModel):
    """Slim exception-creation body for the driver endpoint — trip_id comes from the URL path."""

    exception_type: ExceptionType
    description: str
    supporting_artifact_id: Optional[UUID] = None


class TripExceptionUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    resolved: Optional[bool] = None
    resolved_by_user_id: Optional[UUID] = None
    resolved_at: Optional[datetime] = None
    resolver_note: Optional[str] = None
    merkle_batch_id: Optional[UUID] = None


class TripExceptionRead(TripExceptionBase):
    id: UUID
    resolved: bool
    resolved_by_user_id: Optional[UUID] = None
    resolved_at: Optional[datetime] = None
    resolver_note: Optional[str] = None
    merkle_batch_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
