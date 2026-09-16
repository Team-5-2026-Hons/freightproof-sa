"""Pydantic v2 schemas for Checkpoint and TripException."""

from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.models.enums import (
    DispatcherReviewOutcome,
    ExceptionContactMethod,
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    TripStatus,
    VehicleType,
)
from app.schemas.evidence import EvidenceArtifactWithUrl
from app.schemas.text import CheckpointTypeStr, FreeText, RequiredFreeText


class CheckpointBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    checkpoint_type: str
    driver_phone_lat: Optional[float] = None
    driver_phone_lng: Optional[float] = None
    driver_captured_at: Optional[datetime] = None  # mirrors PhaseEventRead.driver_captured_at
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

    Unlike CheckpointBase (a read shape), this is client input and carries the full
    constraint set: bounded strings and GPS ranges, so an out-of-range value is a 422.
    """

    checkpoint_type: CheckpointTypeStr
    driver_phone_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    driver_phone_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    horse_gps_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    horse_gps_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    # Mirrors _PhaseCompleteBase.driver_captured_at: lets record_checkpoint_corroboration
    # tell a live check from a stale offline replay. Optional for replay compatibility.
    driver_captured_at: Optional[datetime] = None
    selfie_artifact_id: Optional[UUID] = None
    cargo_photo_artifact_id: Optional[UUID] = None
    note: Optional[FreeText] = None
    is_deviation: bool = False

    @field_validator("driver_captured_at")
    @classmethod
    def validate_driver_captured_at_is_timezone_aware(cls, v: Optional[datetime]) -> Optional[datetime]:
        # A naive value would silently be treated as UTC in corroboration_service.
        if v is not None and v.tzinfo is None:
            raise ValueError("driver_captured_at must be timezone-aware")
        return v

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
    """Reject a half-supplied GPS fix — a lone axis is not a plottable coordinate.

    field_prefix names the pair in the error, since a checkpoint carries two independent
    fixes (driver phone, horse tracker).
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
    # RequiredFreeText, not str: lands on an unbounded TEXT column, and an exception
    # description is read back as evidence, so it needs the tamper-resistant cleaning too.
    description: RequiredFreeText
    supporting_artifact_id: Optional[UUID] = None
    # Phase the driver was on, resolved client-side (driver-pwa lib/phase/derive.ts) since
    # exceptions queue offline and flush later — deriving at request time would misattribute
    # the phase. Optional: older clients omit it and the service derives a placement instead.
    phase_event_id: Optional[UUID] = None
    # Captured by useLocation() on the panic page. Optional: not every exception type
    # captures GPS, and a capture failure must not block the alert from sending.
    gps_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    # Request-only idempotency key, not echoed back. The offline queue reuses its own entry
    # UUID on every retry, so a resend returns the original exception instead of duplicating it.
    client_report_id: Optional[UUID] = None
    # Driver's "Truck or Trailer?" answer on a breakdown; the server resolves the exact
    # vehicle itself (exception_service.pick_breakdown_vehicle). Optional for older clients.
    vehicle_type: Optional[VehicleType] = None
    # Sent only when the trip has 2+ trailers and the driver picked one by registration plate.
    trailer_id: Optional[UUID] = None

    @model_validator(mode="after")
    def validate_gps_pair(self) -> "DriverExceptionCreateBody":
        _validate_gps_pair(self.gps_lat, self.gps_lng)
        return self


class TripExceptionReviewRequest(BaseModel):
    """The dispatcher's review action; reviewer and timestamp stay server-owned, never
    client input.

    `contact_method` is required but nullable — an explicit `null` records "reviewed
    without contacting anyone" rather than a caller having forgotten the field.
    """

    model_config = ConfigDict(from_attributes=True)

    review_note: RequiredFreeText
    review_outcome: DispatcherReviewOutcome
    contact_method: Optional[ExceptionContactMethod]


class TripExceptionListItem(BaseModel):
    """Compact row for the review queue and history list.

    Built explicitly from a (TripException, Trip, phase_type, stop_sequence) tuple in the
    service layer, not via model_validate on the bare ORM object — see
    exception_service._to_list_item.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    exception_type: ExceptionType
    source: ExceptionSource
    severity: ExceptionSeverity
    review_status: ExceptionReviewStatus
    description: str
    created_at: datetime

    trip_id: UUID
    trip_reference: str
    trip_status: TripStatus

    # None for a trip-level exception with no phase context. Mirrors Trip.current_phase /
    # Trip.current_stop in schemas/trips.py.
    phase_label: Optional[str] = None
    stop_label: Optional[int] = None


class TripExceptionDetail(TripExceptionListItem):
    """Full record for the permalink detail screen: the compact row plus GPS, complete
    review evidence, the trip's closed time, and the one linked artifact if any."""

    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None

    review_outcome: Optional[ExceptionReviewOutcome] = None
    reviewed_by_user_id: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None
    review_note: Optional[str] = None
    contact_method: Optional[ExceptionContactMethod] = None

    trip_closed_at: Optional[datetime] = None

    # All three None when no vehicle was recorded. Registration/type are looked up from
    # the vehicle row, not stored on the exception.
    vehicle_id: Optional[UUID] = None
    vehicle_registration: Optional[str] = None
    vehicle_type: Optional[VehicleType] = None

    supporting_artifact_id: Optional[UUID] = None
    # None means no photo attached; present with signed_url=None means real evidence but
    # Storage declined to sign a URL right now. The UI must distinguish the two.
    supporting_artifact: Optional["EvidenceArtifactWithUrl"] = None


class TripExceptionRead(TripExceptionBase):
    id: UUID
    review_status: ExceptionReviewStatus
    review_outcome: Optional[ExceptionReviewOutcome] = None
    reviewed_by_user_id: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None
    review_note: Optional[str] = None
    contact_method: Optional[ExceptionContactMethod] = None
    merkle_batch_id: Optional[UUID] = None
    vehicle_id: Optional[UUID] = None  # None for non-mechanical and unattributed breakdowns
    # Denormalised off the Trip so the dispatcher queue doesn't need a second fetch to
    # resolve it. Optional: unset when built outside the org-scoping join.
    trip_reference: Optional[str] = None
    created_at: datetime
    updated_at: datetime
