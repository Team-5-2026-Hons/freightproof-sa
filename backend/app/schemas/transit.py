"""Pydantic v2 schemas for Checkpoint and TripException."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


def _validate_gps_pair(lat: Optional[Decimal], lng: Optional[Decimal]) -> None:
    """A GPS fix is one atomic reading — accepting only one axis would silently persist
    a nonsense coordinate (e.g. a latitude with no matching longitude) that can never be
    plotted or defended as evidence. Shared by TripExceptionBase (dispatcher-facing
    Create/Read) and the driver's slim create body so both reject a partial fix
    identically."""
    if (lat is None) != (lng is None):
        raise ValueError("gps_lat and gps_lng must both be provided or both omitted")


class TripExceptionBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    exception_type: ExceptionType
    source: ExceptionSource
    severity: ExceptionSeverity
    description: str
    handshake_event_id: Optional[UUID] = None
    checkpoint_id: Optional[UUID] = None
    consignment_id: Optional[UUID] = None
    trip_stop_id: Optional[UUID] = None
    supporting_artifact_id: Optional[UUID] = None
    # Driver-phone GPS fix at the moment the exception was raised. Mirrors
    # Checkpoint.driver_phone_lat/_lng's Numeric(10,7) precision (db/models/transit.py).
    # POPIA: personal location data — stays in Postgres, never anchored to Hedera.
    gps_lat: Optional[Decimal] = Field(default=None, ge=Decimal("-90"), le=Decimal("90"))
    gps_lng: Optional[Decimal] = Field(default=None, ge=Decimal("-180"), le=Decimal("180"))

    @model_validator(mode="after")
    def validate_gps_pair(self) -> "TripExceptionBase":
        _validate_gps_pair(self.gps_lat, self.gps_lng)
        return self


class TripExceptionCreate(TripExceptionBase):
    pass


class DriverExceptionCreateBody(BaseModel):
    """Slim exception-creation body for the driver endpoint — trip_id comes from the URL path."""

    exception_type: ExceptionType
    description: str
    supporting_artifact_id: Optional[UUID] = None
    # Captured client-side by useLocation() on the panic page — see
    # frontend/driver-pwa/app/(app)/trip/panic/PanicPageClient.tsx. Optional because
    # not every driver-raised exception type captures GPS (only panic today), and a
    # capture failure must not block the alert itself from sending.
    gps_lat: Optional[Decimal] = Field(default=None, ge=Decimal("-90"), le=Decimal("90"))
    gps_lng: Optional[Decimal] = Field(default=None, ge=Decimal("-180"), le=Decimal("180"))

    @model_validator(mode="after")
    def validate_gps_pair(self) -> "DriverExceptionCreateBody":
        _validate_gps_pair(self.gps_lat, self.gps_lng)
        return self


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
