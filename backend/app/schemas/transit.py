"""Pydantic v2 schemas for Checkpoint and TripException."""

import math
from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.models.enums import (
    AnchorStatus,
    ArtifactType,
    BlockchainReceiptType,
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
from app.core.constants import MAX_BATCH_REVIEW_SIZE, MAX_EXCEPTION_PHOTOS
from app.schemas.action_location import ActionLocationAssessment
from app.schemas.evidence import EvidenceArtifactWithUrl
from app.schemas.text import CheckpointTypeStr, FreeText, RequiredFreeText


class CheckpointBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    checkpoint_type: str
    driver_phone_lat: Optional[float] = None
    driver_phone_lng: Optional[float] = None
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

    model_config = ConfigDict(extra="forbid")

    checkpoint_type: CheckpointTypeStr
    custody_sequence: Optional[int] = Field(default=None, ge=0)
    driver_phone_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    driver_phone_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    horse_gps_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    horse_gps_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    driver_captured_at: Optional[datetime] = None
    driver_accuracy_metres: Optional[float] = Field(default=None, ge=0)
    client_report_id: Optional[UUID] = None
    phase_event_id: Optional[UUID] = None
    selfie_artifact_id: Optional[UUID] = None
    cargo_photo_artifact_id: Optional[UUID] = None
    note: Optional[FreeText] = None
    is_deviation: bool = False

    @field_validator("driver_captured_at")
    @classmethod
    def validate_driver_captured_at_is_timezone_aware(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v is not None and v.tzinfo is None:
            raise ValueError("driver_captured_at must be timezone-aware")
        return v

    @field_validator("driver_accuracy_metres")
    @classmethod
    def validate_driver_accuracy_metres_is_finite(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not math.isfinite(v):
            raise ValueError("driver_accuracy_metres must be a finite number")
        return v

    @model_validator(mode="after")
    def validate_gps_pairs(self) -> "DriverCheckpointCreateBody":
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
    action_location_assessment: Optional[ActionLocationAssessment] = None
    phase_event_id: Optional[UUID] = None
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

    model_config = ConfigDict(extra="forbid")

    exception_type: ExceptionType
    custody_sequence: Optional[int] = Field(default=None, ge=0)
    description: RequiredFreeText
    supporting_artifact_id: Optional[UUID] = None
    supporting_artifact_ids: Optional[list[UUID]] = Field(default=None, max_length=MAX_EXCEPTION_PHOTOS)
    phase_event_id: Optional[UUID] = None
    gps_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    driver_accuracy_metres: Optional[float] = Field(default=None, ge=0)
    driver_captured_at: Optional[datetime] = None
    client_report_id: Optional[UUID] = None
    vehicle_type: Optional[VehicleType] = None
    trailer_id: Optional[UUID] = None

    @field_validator("driver_accuracy_metres")
    @classmethod
    def validate_driver_accuracy_metres_is_finite(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not math.isfinite(v):
            raise ValueError("driver_accuracy_metres must be a finite number")
        return v

    @field_validator("driver_captured_at")
    @classmethod
    def validate_driver_captured_at_is_timezone_aware(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v is not None and v.tzinfo is None:
            raise ValueError("driver_captured_at must be timezone-aware")
        return v

    @model_validator(mode="after")
    def validate_gps_pair(self) -> "DriverExceptionCreateBody":
        _validate_gps_pair(self.gps_lat, self.gps_lng)
        return self

    @model_validator(mode="after")
    def validate_photo_fields(self) -> "DriverExceptionCreateBody":
        """The list is the truth; the legacy field may only agree with it, never contradict it.

        Both given: the legacy field must equal the list's first photo (the one the row keeps
        in supporting_artifact_id). An empty list alongside a photo is a contradiction, not
        "no photos", because one of the two fields is wrong and we cannot tell which.
        """
        ids = self.supporting_artifact_ids
        if ids is not None and len(set(ids)) != len(ids):
            raise ValueError("supporting_artifact_ids must not contain duplicates")
        if ids is not None and self.supporting_artifact_id is not None and (
            not ids or ids[0] != self.supporting_artifact_id
        ):
            raise ValueError("supporting_artifact_id must equal the first of supporting_artifact_ids")
        return self

    @property
    def photo_ids(self) -> list[UUID]:
        """Every photo of this report, in order."""
        if self.supporting_artifact_ids is not None:
            return list(self.supporting_artifact_ids)
        return [] if self.supporting_artifact_id is None else [self.supporting_artifact_id]


class TripExceptionReviewRequest(BaseModel):
    """The dispatcher's review action.

    The narrow request keeps the reviewer and timestamp server-owned rather than
    accepting either as client input.

    `contact_method` is required but nullable, with no default — a caller MUST decide
    whether contact happened at all (unlike `review_outcome`, which has no "not
    applicable" option), and an explicit `null` records "reviewed without contacting
    anyone" (e.g. the evidence alone settled it) rather than a caller having forgotten
    the field.

    `take_over` lets a dispatcher take over a colleague's claim and review in one step
    (FP-280 soft claim); false by default, so a stale page never overrides a claim it
    didn't show.
    """

    model_config = ConfigDict(from_attributes=True)

    review_note: RequiredFreeText
    review_outcome: DispatcherReviewOutcome
    contact_method: Optional[ExceptionContactMethod]
    take_over: bool = False


class TripExceptionBatchReviewRequest(BaseModel):
    """Review several non-critical exceptions on ONE trip with one note and outcome.

    Explicit ids, never "every warning on the trip": the dispatcher confirms exactly the
    rows they saw, so a warning raised after the page loaded is never swept into a
    review nobody looked at. One review is still written per row.
    """

    trip_id: UUID
    exception_ids: list[UUID] = Field(min_length=1, max_length=MAX_BATCH_REVIEW_SIZE)
    review_note: RequiredFreeText
    review_outcome: DispatcherReviewOutcome
    contact_method: Optional[ExceptionContactMethod]

    @field_validator("exception_ids")
    @classmethod
    def _ids_are_unique(cls, ids: list[UUID]) -> list[UUID]:
        if len(set(ids)) != len(ids):
            raise ValueError("exception_ids must not repeat")
        return ids


class ExceptionClaimRequest(BaseModel):
    """Claim an exception. take_over must be explicit: replacing a colleague's claim is a
    deliberate act, so the default can only ever claim something nobody holds."""

    take_over: bool = False


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
    origin_name: Optional[str] = None
    destination_name: Optional[str] = None
    driver_name: Optional[str] = None
    horse_registration: Optional[str] = None
    trailer_registrations: list[str] = Field(default_factory=list)

    phase_label: Optional[str] = None
    stop_label: Optional[int] = None
    phase_event_id: Optional[UUID] = None
    action_location_assessment: Optional[ActionLocationAssessment] = None

    claimed_by_user_id: Optional[UUID] = None
    claimed_at: Optional[datetime] = None
    claimed_by_name: Optional[str] = None
    reviewed_by_name: Optional[str] = None


class ExceptionArtifactSummary(BaseModel):
    """One photo of an exception report. Deliberately has no storage key or bucket: bytes
    are reached only through the authorised artifact endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    position: int
    artifact_type: ArtifactType
    mime_type: str
    file_hash: str
    captured_at: datetime


class ExceptionPhotoWithUrl(ExceptionArtifactSummary):
    """A photo as the dispatcher's detail screen needs it: metadata plus a short-lived signed
    URL. signed_url is None when Storage declined to sign; the photo is still recorded."""

    signed_url: Optional[str] = None


class EvidenceAnchorSummary(BaseModel):
    """Where one anchorable action on an exception stands. `pending` and `failed` are debts
    the retry sweep owes; only `anchored` carries a receipt."""

    model_config = ConfigDict(from_attributes=True)

    event_id: UUID
    receipt_type: BlockchainReceiptType
    anchor_status: AnchorStatus
    receipt_id: Optional[UUID] = None
    hedera_topic_id: Optional[str] = None
    hedera_sequence_number: Optional[int] = None
    occurred_at: datetime


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

    vehicle_id: Optional[UUID] = None
    vehicle_registration: Optional[str] = None
    vehicle_type: Optional[VehicleType] = None

    supporting_artifact_id: Optional[UUID] = None
    supporting_artifact: Optional["EvidenceArtifactWithUrl"] = None
    supporting_artifacts: list[ExceptionPhotoWithUrl] = Field(default_factory=list)
    anchor_events: list[EvidenceAnchorSummary] = Field(default_factory=list)


class TripExceptionRead(TripExceptionBase):
    id: UUID
    review_status: ExceptionReviewStatus
    review_outcome: Optional[ExceptionReviewOutcome] = None
    reviewed_by_user_id: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None
    review_note: Optional[str] = None
    contact_method: Optional[ExceptionContactMethod] = None
    claimed_by_user_id: Optional[UUID] = None
    claimed_at: Optional[datetime] = None
    claimed_by_name: Optional[str] = None
    reviewed_by_name: Optional[str] = None
    merkle_batch_id: Optional[UUID] = None
    action_location_assessment: Optional[ActionLocationAssessment] = None
    vehicle_id: Optional[UUID] = None
    supporting_artifacts: list[ExceptionArtifactSummary] = []
    anchor_events: list[EvidenceAnchorSummary] = []
    trip_reference: Optional[str] = None
    created_at: datetime
    updated_at: datetime
