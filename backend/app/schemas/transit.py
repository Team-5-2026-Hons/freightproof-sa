"""Pydantic v2 schemas for Checkpoint and TripException."""

from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.db.models.enums import (
    ExceptionResolutionMethod,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
)
from app.schemas.text import CheckpointTypeStr, FreeText, RequiredFreeText


class CheckpointBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    checkpoint_type: str
    driver_phone_lat: Optional[float] = None
    driver_phone_lng: Optional[float] = None
    horse_gps_lat: Optional[float] = None
    horse_gps_lng: Optional[float] = None
    selfie_artifact_id: Optional[UUID] = None
    cargo_photo_artifact_id: Optional[UUID] = None
    note: Optional[str] = None
    is_deviation: bool = False


class CheckpointCreate(CheckpointBase):
    pass


class DriverCheckpointCreateBody(BaseModel):
    """Slim checkpoint-creation body for the driver endpoint — trip_id comes from the URL path.

    Unlike CheckpointBase above (a read shape, which must echo whatever is already
    stored), this is client input and carries the full constraint set: bounded strings,
    and GPS ranges matching the ones TripExceptionBase already enforces. Both coordinate
    pairs are a driver-supplied position on an evidence record, so an out-of-range value
    is a 422, not a row that can never be plotted.
    """

    checkpoint_type: CheckpointTypeStr
    driver_phone_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    driver_phone_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    horse_gps_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    horse_gps_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    selfie_artifact_id: Optional[UUID] = None
    cargo_photo_artifact_id: Optional[UUID] = None
    note: Optional[FreeText] = None
    is_deviation: bool = False

    @model_validator(mode="after")
    def validate_gps_pairs(self) -> "DriverCheckpointCreateBody":
        # Same atomic-fix rule the exception bodies apply, applied to both pairs: half a
        # coordinate is not a position.
        _validate_gps_pair(self.driver_phone_lat, self.driver_phone_lng, field_prefix="driver_phone")
        _validate_gps_pair(self.horse_gps_lat, self.horse_gps_lng, field_prefix="horse_gps")
        return self


class CheckpointUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    merkle_batch_id: Optional[UUID] = None
    note: Optional[FreeText] = None


class CheckpointRead(CheckpointBase):
    id: UUID
    merkle_batch_id: Optional[UUID] = None
    created_at: datetime


def _validate_gps_pair(
    lat: Optional[float], lng: Optional[float], *, field_prefix: str = "gps",
) -> None:
    """A GPS fix is one atomic reading — accepting only one axis would silently persist
    a nonsense coordinate (e.g. a latitude with no matching longitude) that can never be
    plotted or defended as evidence. Shared by TripExceptionBase (dispatcher-facing
    Create/Read) and the driver's slim create bodies so every one of them rejects a
    partial fix identically.

    field_prefix names the pair in the error, because a checkpoint carries two
    independent fixes (the driver's phone and the horse's tracker) and "gps_lat" would
    not tell the caller which of them they half-supplied.
    """
    if (lat is None) != (lng is None):
        raise ValueError(
            f"{field_prefix}_lat and {field_prefix}_lng must both be provided or both omitted"
        )


class TripExceptionBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    exception_type: ExceptionType
    source: ExceptionSource
    severity: ExceptionSeverity
    description: str
    phase_event_id: Optional[UUID] = None
    checkpoint_id: Optional[UUID] = None
    consignment_id: Optional[UUID] = None
    trip_stop_id: Optional[UUID] = None
    supporting_artifact_id: Optional[UUID] = None
    # Driver-phone GPS fix at the moment the exception was raised. Mirrors
    # Checkpoint.driver_phone_lat/_lng's Numeric(10,7) precision (db/models/transit.py).
    # POPIA: personal location data — stays in Postgres, never anchored to Hedera.
    gps_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_lng: Optional[float] = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_gps_pair(self) -> "TripExceptionBase":
        _validate_gps_pair(self.gps_lat, self.gps_lng)
        return self


class TripExceptionCreate(TripExceptionBase):
    pass


class DriverExceptionCreateBody(BaseModel):
    """Slim exception-creation body for the driver endpoint — trip_id comes from the URL path."""

    exception_type: ExceptionType
    # RequiredFreeText, not str: this lands on a TEXT column with no width of its own, so
    # without a ceiling one authenticated driver can write as much as they like. It is
    # also the field most worth cleaning — an exception description is read back as
    # evidence, and characters that make it render differently from what is stored are
    # exactly the tampering this platform exists to make impossible.
    description: RequiredFreeText
    supporting_artifact_id: Optional[UUID] = None
    # The phase the driver was ON when this happened, resolved client-side from the
    # trip's plan at the moment of the event (driver-pwa lib/phase/derive.ts
    # contextPhaseEventId). Client-supplied rather than server-derived because the app
    # queues exceptions offline and flushes them hours later — deriving at request time
    # would tag a panic raised in transit with whatever phase the trip had reached by
    # the time signal returned. Optional: older installed clients omit it, and the
    # service derives a server-side placement in that case rather than storing NULL.
    phase_event_id: Optional[UUID] = None
    # Captured client-side by useLocation() on the panic page — see
    # frontend/driver-pwa/app/(app)/trip/panic/PanicPageClient.tsx. Optional because
    # not every driver-raised exception type captures GPS (only panic today), and a
    # capture failure must not block the alert itself from sending.
    gps_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_lng: Optional[float] = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_gps_pair(self) -> "DriverExceptionCreateBody":
        _validate_gps_pair(self.gps_lat, self.gps_lng)
        return self


class TripExceptionUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    resolved: Optional[bool] = None
    resolved_by_user_id: Optional[UUID] = None
    resolved_at: Optional[datetime] = None
    resolver_note: Optional[FreeText] = None
    merkle_batch_id: Optional[UUID] = None


class TripExceptionResolveRequest(BaseModel):
    """Everything a dispatcher may set when resolving. Deliberately only two fields.

    NOT TripExceptionUpdate above, which exposes `resolved`, `resolved_by_user_id`,
    `resolved_at` and `merkle_batch_id` on the wire. Reusing it would let a caller name
    someone else as the resolver, at a time of their choosing, and mark the row resolved
    without saying anything about how — on the one record whose whole purpose is to show
    who established what. The server takes the resolver from the token and the timestamp
    from its own clock (orchestration.exception_service.resolve_exception).

    Both fields are mandatory. A resolution with no note is the informal handling this
    ticket exists to capture, recorded as though it were evidence.
    """

    model_config = ConfigDict(from_attributes=True)

    # RequiredFreeText, not str: lands on a TEXT column with no width of its own, and
    # is read back as evidence — same reasoning as DriverExceptionCreateBody.description.
    resolver_note: RequiredFreeText
    resolution_method: ExceptionResolutionMethod


class TripExceptionRead(TripExceptionBase):
    id: UUID
    resolved: bool
    resolved_by_user_id: Optional[UUID] = None
    resolved_at: Optional[datetime] = None
    resolver_note: Optional[str] = None
    resolution_method: Optional[ExceptionResolutionMethod] = None
    merkle_batch_id: Optional[UUID] = None
    # Denormalised off the Trip the exception belongs to. The dispatcher's queue spans
    # every trip in the organisation and each row has to say WHICH trip, so without this
    # both exception screens would have to fetch the trip list purely to resolve
    # references. The service's org-scoping join already has the row in hand, so
    # carrying it costs nothing. Optional because a row built outside that join
    # (TripExceptionRead.model_validate on a bare ORM object) has no trip loaded.
    trip_reference: Optional[str] = None
    created_at: datetime
    updated_at: datetime
