"""Pydantic v2 schemas for PhaseEvent and the per-phase completion requests.

Replaces schemas/handshakes.py, whose HandshakeEventRead predates the phase
ledger and is missing three real columns (trip_stop_id, anchor_status,
idempotency_key). Serves the frozen contract's PhaseDescriptor — which is why
stop_sequence and step_recipe appear here as derived fields rather than as
columns.
"""

import math
import re
from datetime import datetime
from typing import Annotated, Any, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.phase_meta import STEP_SLUGS
from app.db.models.enums import AnchorStatus, PhaseStatus, PhaseType, SealCondition, SealNumberSource
from app.schemas.action_location import ActionLocationAssessment

_SEAL_PATTERN = re.compile(r"^[A-Z]{2}-\d{4}$")

_IDEMPOTENCY_KEY_MAX_LENGTH = 100
_SEAL_NUMBER_MAX_LENGTH = 100


def _validate_seal_format(v: str) -> str:
    normalized = v.strip().upper()
    if not _SEAL_PATTERN.match(normalized):
        raise ValueError("seal number must be in format XX-#### (e.g. AB-1234)")
    return normalized


class PhaseEventRead(BaseModel):
    """One entry in a trip's committed phase plan, as served to the UI.

    NOT built with model_validate() — stop_sequence needs a TripStop join and
    step_recipe is derived, so use from_event() and pass the map. Building this
    from the ORM object alone would silently produce stop_sequence=None on every
    row, which the dispatcher renders as "no stop" rather than as an error.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(..., serialization_alias="phase_event_id")
    trip_id: UUID
    phase_type: PhaseType
    sequence_number: int
    status: PhaseStatus
    anchor_status: AnchorStatus

    trip_stop_id: Optional[UUID] = None
    stop_sequence: Optional[int] = None

    step_recipe: tuple[str, ...] = ()

    blocked_on: Optional[str] = None

    idempotency_key: Optional[str] = None

    dispatcher_override_user_id: Optional[UUID] = None
    dispatcher_override_note: Optional[str] = None
    driver_phone_lat: Optional[float] = None
    driver_phone_lng: Optional[float] = None
    driver_captured_at: Optional[datetime] = None
    horse_gps_lat: Optional[float] = None
    horse_gps_lng: Optional[float] = None
    pulsit_geofence_confirmed: Optional[bool] = None
    action_location_assessment: Optional[ActionLocationAssessment] = None
    location_warning_acknowledged_at: Optional[datetime] = None
    location_warning_reason: Optional[str] = None
    seal_number: Optional[str] = None
    seal_condition: Optional[SealCondition] = None
    seal_number_source: Optional[SealNumberSource] = None
    seal_photo_artifact_id: Optional[UUID] = None
    waybill_photo_artifact_id: Optional[UUID] = None
    gate_photo_artifact_id: Optional[UUID] = None
    pod_photo_artifact_id: Optional[UUID] = None
    pod_signature_artifact_id: Optional[UUID] = None
    linehaul_photo_artifact_id: Optional[UUID] = None
    linehaul_pdf_artifact_id: Optional[UUID] = None
    parcel_count_origin: Optional[int] = None
    parcel_count_destination: Optional[int] = None
    driver_visual_count: Optional[int] = None
    event_hash: Optional[str] = None
    blockchain_receipt_id: Optional[UUID] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_event(
        cls,
        event: Any,
        *,
        stop_sequence_by_id: dict[UUID, int],
        blocked_on_by_stop: dict[tuple[Any, UUID], Optional[str]] | None = None,
    ) -> "PhaseEventRead":
        """`event` is a db.models.phases.PhaseEvent. Typed as Any to keep this
        module free of a db-model import — schemas describe the wire, not the
        tables, and app/schemas/ importing app/db/models/ would invert that.

        blocked_on_by_stop defaults to None so a caller that genuinely has no gate
        state (tests, fixtures) still builds a valid row. Every production caller
        passes it — a missing map silently yields blocked_on=None on every phase,
        the same trap stop_sequence_by_id documents above.
        """
        read = cls.model_validate(event)
        read.stop_sequence = (
            stop_sequence_by_id.get(event.trip_stop_id)
            if event.trip_stop_id is not None
            else None
        )
        read.step_recipe = STEP_SLUGS[PhaseType(event.phase_type)]
        if blocked_on_by_stop is not None and event.trip_stop_id is not None:
            read.blocked_on = blocked_on_by_stop.get(
                (PhaseType(event.phase_type), event.trip_stop_id)
            )
        return read


class _PhaseCompleteBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idempotency_key: str = Field(..., min_length=1, max_length=_IDEMPOTENCY_KEY_MAX_LENGTH)
    custody_sequence: Optional[int] = Field(default=None, ge=0)
    driver_phone_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    driver_phone_lng: Optional[float] = Field(default=None, ge=-180, le=180)

    driver_captured_at: Optional[datetime] = None

    driver_accuracy_metres: Optional[float] = Field(default=None, ge=0)

    location_warning_acknowledged_at: Optional[datetime] = None
    location_warning_reason: Optional[str] = Field(default=None, max_length=1_000)

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

    @field_validator("location_warning_acknowledged_at")
    @classmethod
    def validate_location_warning_acknowledged_at_is_timezone_aware(
        cls, v: Optional[datetime],
    ) -> Optional[datetime]:
        if v is not None and v.tzinfo is None:
            raise ValueError("location_warning_acknowledged_at must be timezone-aware")
        return v

    @field_validator("location_warning_reason")
    @classmethod
    def validate_location_warning_reason_is_nonblank(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        normalized = v.strip()
        if not normalized:
            raise ValueError("location_warning_reason must not be blank")
        return normalized

    @model_validator(mode="after")
    def validate_driver_position_pair(self) -> "_PhaseCompleteBase":
        if (self.driver_phone_lat is None) != (self.driver_phone_lng is None):
            raise ValueError("driver_phone_lat and driver_phone_lng must both be provided or both omitted")
        return self


class ActivationCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.ACTIVATION]
    driver_phone_lat: float = Field(..., ge=-90, le=90)
    driver_phone_lng: float = Field(..., ge=-180, le=180)


class LoadingCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.LOADING]
    driver_visual_count: Optional[int] = None
    linehaul_photo_artifact_id: Optional[UUID] = None
    linehaul_pdf_artifact_id: Optional[UUID] = None

    @model_validator(mode="after")
    def validate_distinct_linehaul_artifacts(self) -> "LoadingCompleteRequest":
        if self.linehaul_pdf_artifact_id is not None and self.linehaul_photo_artifact_id is None:
            raise ValueError(
                "the linehaul PDF is built from the scan image, so it cannot be submitted without it"
            )
        if (
            self.linehaul_pdf_artifact_id is not None
            and self.linehaul_pdf_artifact_id == self.linehaul_photo_artifact_id
        ):
            raise ValueError("the linehaul scan image and its PDF must be different artifacts")
        return self


class DepartureCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.DEPARTURE]
    waybill_photo_artifact_id: Optional[UUID] = None
    seal_number: str
    seal_photo_artifact_id: UUID
    guard_verified_seal: Optional[bool] = None
    seal_number_confirmed: Optional[str] = Field(default=None, max_length=_SEAL_NUMBER_MAX_LENGTH)
    seal_number_source: Optional[SealNumberSource] = None

    @field_validator("seal_number")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)

    @model_validator(mode="after")
    def validate_distinct_evidence_roles(self) -> "DepartureCompleteRequest":
        if self.waybill_photo_artifact_id == self.seal_photo_artifact_id:
            raise ValueError("waybill and seal evidence must use different artifacts")
        return self


class InTransitCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.IN_TRANSIT]


class ArrivalCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.ARRIVAL]
    seal_condition: SealCondition
    seal_number_at_arrival: Optional[str] = None
    seal_photo_artifact_id: UUID
    seal_number_source: Optional[SealNumberSource] = None

    @field_validator("seal_number_at_arrival")
    @classmethod
    def validate_seal_number(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _validate_seal_format(v)

    @model_validator(mode="after")
    def validate_seal_number_present(self) -> "ArrivalCompleteRequest":
        if self.seal_condition == SealCondition.MISSING:
            if self.seal_number_at_arrival is not None:
                raise ValueError("seal_number_at_arrival must be omitted when the seal is missing")
        elif self.seal_number_at_arrival is None:
            raise ValueError("seal_number_at_arrival is required unless the seal is missing")
        return self


class UnloadingCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.UNLOADING]


class ConfirmationCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.CONFIRMATION]
    pod_photo_artifact_id: UUID
    pod_signature_artifact_id: UUID
    driver_visual_count: Optional[int] = None

    @model_validator(mode="after")
    def validate_distinct_evidence_roles(self) -> "ConfirmationCompleteRequest":
        if self.pod_photo_artifact_id == self.pod_signature_artifact_id:
            raise ValueError("POD photo and signature must use different artifacts")
        return self


PhaseCompleteRequest = Annotated[
    Union[
        ActivationCompleteRequest,
        LoadingCompleteRequest,
        DepartureCompleteRequest,
        InTransitCompleteRequest,
        ArrivalCompleteRequest,
        UnloadingCompleteRequest,
        ConfirmationCompleteRequest,
    ],
    Field(discriminator="phase_type"),
]
