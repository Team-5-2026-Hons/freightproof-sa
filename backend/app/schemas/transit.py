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
    # Task 0A: mirrors PhaseEventRead.driver_captured_at — the instant the driver's
    # phone submitted, independent of the server's created_at clock. See
    # DriverCheckpointCreateBody.driver_captured_at for the full rationale.
    driver_captured_at: Optional[datetime] = None
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
    # Task 0A: the instant the driver's own phone submitted this checkpoint. Mirrors
    # schemas/phases.py's _PhaseCompleteBase.driver_captured_at exactly — a checkpoint
    # is offline-queued the same way a phase handshake is, and record_checkpoint_
    # corroboration needs this to tell a live check from a stale replay. Optional for
    # the same replay-compatibility reason; new builds always send it
    # (frontend/driver-pwa/lib/api/checkpoints.ts).
    driver_captured_at: Optional[datetime] = None
    selfie_artifact_id: Optional[UUID] = None
    cargo_photo_artifact_id: Optional[UUID] = None
    note: Optional[FreeText] = None
    is_deviation: bool = False

    @field_validator("driver_captured_at")
    @classmethod
    def validate_driver_captured_at_is_timezone_aware(cls, v: Optional[datetime]) -> Optional[datetime]:
        # A naive value would silently compare as if it were UTC in corroboration_service.
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
    # Request-only idempotency key — not echoed back on TripExceptionRead. The driver
    # app's offline queue reuses its own entry UUID as this value on every retry of the
    # same queued submission (frontend/driver-pwa lib/hooks/useOfflineQueue.ts), so a
    # resend caused by a lost response, or by a retry after the photo uploaded but this
    # POST itself failed, returns the ORIGINAL exception rather than inserting a second
    # one for the same real-world report. Optional: an older installed/queued client
    # omits it and gets no idempotency protection, exactly like phase_event_id above.
    client_report_id: Optional[UUID] = None
    # The driver's answer to "Truck or Trailer?" on a vehicle breakdown: horse ("Truck")
    # or trailer. The server works out the exact vehicle from the trip itself
    # (exception_service.pick_breakdown_vehicle), so the driver never has to identify a
    # vehicle by id. Optional: older installed apps, and reports already sitting in a
    # phone's offline queue, send neither field, and those breakdowns are stored with no
    # vehicle rather than rejected.
    vehicle_type: Optional[VehicleType] = None
    # Sent only when the trip has two or more trailers and the driver picked one by its
    # registration plate. With a single trailer, "Trailer" already says which one.
    trailer_id: Optional[UUID] = None

    @model_validator(mode="after")
    def validate_gps_pair(self) -> "DriverExceptionCreateBody":
        _validate_gps_pair(self.gps_lat, self.gps_lng)
        return self


class TripExceptionReviewRequest(BaseModel):
    """The dispatcher's review action.

    The narrow request keeps the reviewer and timestamp server-owned rather than
    accepting either as client input.

    `contact_method` is required but nullable, with no default — a caller MUST decide
    whether contact happened at all (unlike `review_outcome`, which has no "not
    applicable" option), and an explicit `null` records "reviewed without contacting
    anyone" (e.g. the evidence alone settled it) rather than a caller having forgotten
    the field.
    """

    model_config = ConfigDict(from_attributes=True)

    review_note: RequiredFreeText
    review_outcome: DispatcherReviewOutcome
    contact_method: Optional[ExceptionContactMethod]


class TripExceptionListItem(BaseModel):
    """Compact row for the review queue and history list.

    Built explicitly from a (TripException, Trip, phase_type, stop_sequence) tuple in
    the service layer, not via model_validate on the bare ORM object — the trip
    reference/status and the phase/stop labels all come from the same org-scoping join,
    not from TripException's own columns. See exception_service._to_list_item.
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

    # PhaseEvent.phase_type / TripStop.sequence for the phase this exception is scoped
    # to — None for a trip-level exception with no phase context. Mirrors the existing
    # Trip.current_phase (str) / Trip.current_stop (int) pairing in schemas/trips.py.
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

    # The vehicle a breakdown was recorded against, so the dispatcher can see which one
    # it was. All three are None when no vehicle was recorded: every non-mechanical
    # exception, and breakdowns from before the driver was asked "truck or trailer".
    # Registration and type are looked up from the vehicle row, not stored on the
    # exception.
    vehicle_id: Optional[UUID] = None
    vehicle_registration: Optional[str] = None
    vehicle_type: Optional[VehicleType] = None

    # Kept even when signing fails or the artifact cannot be verified as belonging to
    # this trip — see `supporting_artifact`.
    supporting_artifact_id: Optional[UUID] = None
    # None means no photo was ever attached (or the id could not be verified as this
    # trip's own — Task 0B's ownership invariant). Present with signed_url=None means
    # the opposite: real evidence, but Storage declined to sign a URL right now. The UI
    # must be able to tell "no photo" apart from "recorded, image unavailable".
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
    # The vehicle a mechanical exception was recorded against — see
    # TripException.vehicle_id. None for every other type and for unattributed breakdowns.
    vehicle_id: Optional[UUID] = None
    # Denormalised off the Trip the exception belongs to. The dispatcher's queue spans
    # every trip in the organisation and each row has to say WHICH trip, so without this
    # both exception screens would have to fetch the trip list purely to resolve
    # references. The service's org-scoping join already has the row in hand, so
    # carrying it costs nothing. Optional because a row built outside that join
    # (TripExceptionRead.model_validate on a bare ORM object) has no trip loaded.
    trip_reference: Optional[str] = None
    created_at: datetime
    updated_at: datetime
