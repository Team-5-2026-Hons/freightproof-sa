"""Pydantic v2 schemas for PhaseEvent and TrailerGpsSnapshot.

stop_sequence and step_recipe are derived fields, not columns, to match the
frozen PhaseDescriptor contract (parent plan §3.1).
"""

import re
from datetime import datetime
from typing import Annotated, Any, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.phase_meta import STEP_SLUGS
from app.db.models.enums import AnchorStatus, PhaseStatus, PhaseType

_SEAL_PATTERN = re.compile(r"^[A-Z]{2}-\d{4}$")

# Mirror DB column widths (app/db/models/phases.py) so over-length input is a 422, not a 500.
_IDEMPOTENCY_KEY_MAX_LENGTH = 100
_SEAL_NUMBER_MAX_LENGTH = 100


def _validate_seal_format(v: str) -> str:
    # Normalize before matching so retyped case/whitespace isn't rejected as a bad seal.
    normalized = v.strip().upper()
    if not _SEAL_PATTERN.match(normalized):
        raise ValueError("seal number must be in format XX-#### (e.g. AB-1234)")
    return normalized


class PhaseEventRead(BaseModel):
    """One entry in a trip's committed phase plan, as served to the UI.

    Build via from_event(), not model_validate() — stop_sequence needs a TripStop
    join and step_recipe is derived, neither of which model_validate() can fill in.
    """

    model_config = ConfigDict(from_attributes=True)

    # Wire name is `phase_event_id` (frontend/shared/lib/types/phase.ts contract);
    # TrailerGpsSnapshotBase.phase_event_id below is a separate FK, unaffected by this alias.
    id: UUID = Field(..., serialization_alias="phase_event_id")
    trip_id: UUID
    phase_type: PhaseType
    sequence_number: int
    status: PhaseStatus
    anchor_status: AnchorStatus

    # Null only for trip_creation. in_transit anchors to the stop it departs from.
    trip_stop_id: Optional[UUID] = None
    stop_sequence: Optional[int] = None

    step_recipe: tuple[str, ...] = ()  # capture-component slugs; empty for system-observed phases

    # Non-null while waiting on an external system (today: warehouse scan feed).
    # Derived per request (orchestration/phase_gate.py), never stored.
    blocked_on: Optional[str] = None

    idempotency_key: Optional[str] = None  # driver app's offline-queue entry id, echoed back

    dispatcher_override_user_id: Optional[UUID] = None
    dispatcher_override_note: Optional[str] = None
    driver_phone_lat: Optional[float] = None
    driver_phone_lng: Optional[float] = None
    driver_captured_at: Optional[datetime] = None  # nullable for rows completed pre-Task 0A
    horse_gps_lat: Optional[float] = None
    horse_gps_lng: Optional[float] = None
    pulsit_geofence_confirmed: Optional[bool] = None
    seal_number: Optional[str] = None
    seal_photo_artifact_id: Optional[UUID] = None
    waybill_photo_artifact_id: Optional[UUID] = None
    gate_photo_artifact_id: Optional[UUID] = None
    pod_photo_artifact_id: Optional[UUID] = None
    pod_signature_artifact_id: Optional[UUID] = None
    linehaul_photo_artifact_id: Optional[UUID] = None
    parcel_manifest_snapshot: Optional[Any] = None
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
        """Build a PhaseEventRead from a db.models.phases.PhaseEvent.

        `event` is typed Any to keep schemas free of a db-model import. Every
        production caller must pass blocked_on_by_stop, or blocked_on is silently None.
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


class TrailerGpsSnapshotBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    phase_event_id: UUID
    trailer_id: UUID
    pulsit_device_id: str
    lat: float
    lng: float
    captured_at: datetime


class TrailerGpsSnapshotCreate(TrailerGpsSnapshotBase):
    pass


class TrailerGpsSnapshotRead(TrailerGpsSnapshotBase):
    id: UUID
    created_at: datetime


class _PhaseCompleteBase(BaseModel):
    # Resubmitting with the same key returns current state instead of erroring — drivers
    # lose signal, replay is normal. max_length mirrors phase_events.idempotency_key.
    idempotency_key: str = Field(..., min_length=1, max_length=_IDEMPOTENCY_KEY_MAX_LENGTH)
    # Optional: a phase must not fail to record because a fix timed out under a loading-bay
    # roof. ActivationCompleteRequest overrides these as required.
    # POPIA: personal location data, stored in Postgres, never anchored (payload builders
    # in orchestration/phase_service.py are explicit whitelists).
    driver_phone_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    driver_phone_lng: Optional[float] = Field(default=None, ge=-180, le=180)

    # Task 0A: instant the driver's phone submitted, captured client-side at swipe time,
    # independent of when the request reaches the server. Lets corroboration_service tell a
    # live handshake from an offline replay. Optional so pre-0A queued entries still replay.
    driver_captured_at: Optional[datetime] = None

    @field_validator("driver_captured_at")
    @classmethod
    def validate_driver_captured_at_is_timezone_aware(cls, v: Optional[datetime]) -> Optional[datetime]:
        # A naive value would silently be treated as UTC downstream, so reject rather than assume.
        if v is not None and v.tzinfo is None:
            raise ValueError("driver_captured_at must be timezone-aware")
        return v

    @model_validator(mode="after")
    def validate_driver_position_pair(self) -> "_PhaseCompleteBase":
        # Both-or-neither: a lone axis is not a position.
        if (self.driver_phone_lat is None) != (self.driver_phone_lng is None):
            raise ValueError("driver_phone_lat and driver_phone_lng must both be provided or both omitted")
        return self


class ActivationCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.ACTIVATION]
    # Required here, unlike every other phase: this is the origin-gate arrival position.
    driver_phone_lat: float = Field(..., ge=-90, le=90)
    driver_phone_lng: float = Field(..., ge=-180, le=180)


class LoadingCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.LOADING]  # D7/T5: the seal is applied at departure, not here
    # Ignored by advance_loading (scan-driven redesign); kept only so offline-queued
    # completions from older clients still replay instead of 422ing forever.
    driver_visual_count: Optional[int] = None
    # Optional: a paperless warehouse has no sheet to hand the driver.
    linehaul_photo_artifact_id: Optional[UUID] = None


class DepartureCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.DEPARTURE]  # D7/T5: seal is applied here, at exit
    # No longer sent by the driver app (superseded by loading's linehaul_photo_artifact_id);
    # kept so offline-queued completions from older clients still replay.
    waybill_photo_artifact_id: Optional[UUID] = None
    seal_number: str
    seal_photo_artifact_id: UUID
    # Tri-state: None means no independent guard confirmation was collected (the ordinary
    # case, guards have no accounts). Only explicit False means a guard refused/failed to verify.
    guard_verified_seal: Optional[bool] = None
    # Seal number the exit guard re-entered; compared against this request's seal_number.
    # Free-form and unpatterned on purpose — a mistyped confirmation is itself evidence.
    seal_number_confirmed: Optional[str] = Field(default=None, max_length=_SEAL_NUMBER_MAX_LENGTH)

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
    # An attestation ("I have arrived"), not an evidence capture — deliberately no photo
    # or artifact, so it stays outside STEP_SLUGS and ANCHORED_PHASES.
    phase_type: Literal[PhaseType.IN_TRANSIT]


class UnloadingCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.UNLOADING]
    seal_number_at_destination: str
    # Seal as found at destination, before it's broken — tamper-evidence bookend to
    # departure's seal_photo_artifact_id. Required: it can't be re-photographed once open.
    # Reuses PhaseEvent.gate_photo_artifact_id (previously unused).
    # TODO: driver-pwa currently drops this photo and sends only seal_number_at_destination;
    # its captured photo is also of the seal AFTER breaking, not before — needs reconciling.
    gate_photo_artifact_id: UUID

    @field_validator("seal_number_at_destination")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class ConfirmationCompleteRequest(_PhaseCompleteBase):
    # Proof of delivery requires both a photo and an on-device signature, not either/or.
    # pp_scan_in_count deliberately removed from the wire (server derives it from
    # Parcel.pp_scan_in_at); the same key in the anchored canonical payload is unchanged
    # and must stay, or hash verification breaks on every historical trip.
    phase_type: Literal[PhaseType.CONFIRMATION]
    pod_photo_artifact_id: UUID
    pod_signature_artifact_id: UUID
    # Captured blind (driver never shown an expected figure) and never reconciled against
    # depot scan counts — the two independent scans already settle that. Optional; a
    # skipped count still anchors as None, keeping verification_service's rebuild reproducible.
    driver_visual_count: Optional[int] = None

    @model_validator(mode="after")
    def validate_distinct_evidence_roles(self) -> "ConfirmationCompleteRequest":
        if self.pod_photo_artifact_id == self.pod_signature_artifact_id:
            raise ValueError("POD photo and signature must use different artifacts")
        return self


# Discriminated union: Pydantic picks the member from `phase_type` and validates it
# properly, so a missing seal_number is still a 422, not a hand-rolled service error.
# trip_creation is deliberately absent — it's written by create_trip before any driver
# is involved, and addressing it gets a 409 from complete_phase()'s dispatch table.
PhaseCompleteRequest = Annotated[
    Union[
        ActivationCompleteRequest,
        LoadingCompleteRequest,
        DepartureCompleteRequest,
        InTransitCompleteRequest,
        UnloadingCompleteRequest,
        ConfirmationCompleteRequest,
    ],
    Field(discriminator="phase_type"),
]
