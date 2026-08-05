"""Pydantic v2 schemas for PhaseEvent and TrailerGpsSnapshot.

Replaces schemas/handshakes.py, whose HandshakeEventRead predates the phase
ledger and is missing three real columns (trip_stop_id, anchor_status,
idempotency_key). Serves the frozen contract's PhaseDescriptor — parent plan
§3.1 — which is why stop_sequence and step_recipe appear here as derived fields
rather than as columns.
"""

import re
from datetime import datetime
from typing import Annotated, Any, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.phase_meta import STEP_SLUGS
from app.db.models.enums import AnchorStatus, PhaseStatus, PhaseType

_SEAL_PATTERN = re.compile(r"^[A-Z]{2}-\d{4}$")


def _validate_seal_format(v: str) -> str:
    if not _SEAL_PATTERN.match(v):
        raise ValueError("seal number must be in format XX-#### (e.g. AB-1234)")
    return v


class PhaseEventRead(BaseModel):
    """One entry in a trip's committed phase plan, as served to the UI.

    NOT built with model_validate() — stop_sequence needs a TripStop join and
    step_recipe is derived, so use from_event() and pass the map. Building this
    from the ORM object alone would silently produce stop_sequence=None on every
    row, which the dispatcher renders as "no stop" rather than as an error.
    """

    model_config = ConfigDict(from_attributes=True)

    # Wire name is `phase_event_id`, matching the shared frontend contract
    # (frontend/shared/lib/types/phase.ts) — this is the phase's own identity,
    # not a foreign key pointing at one (contrast
    # TrailerGpsSnapshotBase.phase_event_id below, which IS an FK and is
    # unaffected by this alias). serialization_alias only changes the OUTBOUND
    # key: model_validate(event)/from_attributes still binds the ORM's `id`
    # attribute by field name, and FastAPI serialises response models with
    # by_alias=True by default, so `id` never reaches the JSON body.
    id: UUID = Field(..., serialization_alias="phase_event_id")
    trip_id: UUID
    phase_type: PhaseType
    sequence_number: int
    status: PhaseStatus
    anchor_status: AnchorStatus

    # Null ONLY for trip_creation (parent D3). in_transit anchors to the stop it
    # DEPARTS FROM, so in_transit at stop 1 means "the leg leaving stop 1".
    trip_stop_id: Optional[UUID] = None
    stop_sequence: Optional[int] = None

    # Capture-component slugs for this phase type (decision S2). Empty for
    # system-observed phases.
    step_recipe: tuple[str, ...] = ()

    # The driver app's offline-queue entry id, echoed so a client can reconcile
    # its own queue against what the server actually recorded.
    idempotency_key: Optional[str] = None

    dispatcher_override_user_id: Optional[UUID] = None
    dispatcher_override_note: Optional[str] = None
    driver_phone_lat: Optional[float] = None
    driver_phone_lng: Optional[float] = None
    horse_gps_lat: Optional[float] = None
    horse_gps_lng: Optional[float] = None
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

    @classmethod
    def from_event(
        cls, event: Any, *, stop_sequence_by_id: dict[UUID, int],
    ) -> "PhaseEventRead":
        """`event` is a db.models.phases.PhaseEvent. Typed as Any to keep this
        module free of a db-model import — schemas describe the wire, not the
        tables, and app/schemas/ importing app/db/models/ would invert that."""
        read = cls.model_validate(event)
        read.stop_sequence = (
            stop_sequence_by_id.get(event.trip_stop_id)
            if event.trip_stop_id is not None
            else None
        )
        read.step_recipe = STEP_SLUGS[PhaseType(event.phase_type)]
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
    # The driver app's offline-queue entry id. Stored on the row unconditionally;
    # a resubmitted completion with the same key returns current state instead of
    # erroring or duplicating — drivers lose signal, replay is normal.
    idempotency_key: str = Field(..., min_length=1)
    # Where the driver's phone was when this phase was completed. Every phase carries
    # it now, not just activation: the PWA captures the fix silently at submit time
    # (there is no longer a "Capture GPS Location" step for the driver to tap), and
    # phase_events has had the columns for every row all along.
    #
    # Optional on purpose — a phase must never fail to record because a fix timed out
    # under a loading-bay roof. ActivationCompleteRequest overrides these as REQUIRED,
    # because the origin-gate position is the one the activation gates are judged on.
    #
    # POPIA: personal location data. Stored in Postgres, never anchored — the canonical
    # payload builders in orchestration/phase_service.py are explicit whitelists, so a
    # field added here cannot reach a hash by accident.
    driver_phone_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    driver_phone_lng: Optional[float] = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_driver_position_pair(self) -> "_PhaseCompleteBase":
        # Both-or-neither, matching DriverExceptionCreateBody: a lone axis is not a
        # position, and storing one would put an unusable half-fix in the evidence.
        if (self.driver_phone_lat is None) != (self.driver_phone_lng is None):
            raise ValueError("driver_phone_lat and driver_phone_lng must both be provided or both omitted")
        return self


class ActivationCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.ACTIVATION]
    # Required here, unlike every other phase: activation is the origin-gate arrival
    # position, and the whole point of the phase is recording where the trip started.
    driver_phone_lat: float = Field(..., ge=-90, le=90)
    driver_phone_lng: float = Field(..., ge=-180, le=180)


class LoadingCompleteRequest(_PhaseCompleteBase):
    # D7/T5: the seal is applied at departure, not here. Loading only ever
    # captures the driver's own visual parcel count.
    phase_type: Literal[PhaseType.LOADING]
    driver_visual_count: int


class DepartureCompleteRequest(_PhaseCompleteBase):
    # D7/T5: the seal is applied HERE — the driver photographs the waybill and
    # seal as they physically close the trailer at exit.
    phase_type: Literal[PhaseType.DEPARTURE]
    waybill_photo_artifact_id: UUID
    seal_number: str
    seal_photo_artifact_id: UUID
    guard_verified_seal: bool
    # Seal number the exit guard re-entered. When present the server compares it
    # against THIS SAME request's seal_number, superseding the client-computed
    # guard_verified_seal. Free-form on purpose: a mistyped confirmation is
    # itself evidence of a mismatch and must be recordable, not 422'd away.
    seal_number_confirmed: Optional[str] = None

    @field_validator("seal_number")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class UnloadingCompleteRequest(_PhaseCompleteBase):
    phase_type: Literal[PhaseType.UNLOADING]
    seal_number_at_destination: str

    @field_validator("seal_number_at_destination")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class ConfirmationCompleteRequest(_PhaseCompleteBase):
    # BQ2 resolved 2026-06-29: proof of delivery is a photo AND an on-device
    # signature — both required, not either/or.
    phase_type: Literal[PhaseType.CONFIRMATION]
    pod_photo_artifact_id: UUID
    pod_signature_artifact_id: UUID
    driver_visual_count: int
    pp_scan_in_count: int


# Decision S5. One endpoint, five real shapes: Pydantic picks the member from
# `phase_type` and validates it properly, so a missing seal_number is still a
# 422 and not a hand-rolled service-layer error. trip_creation and in_transit are
# deliberately absent — neither is completed by a driver action, and addressing
# one gets a 409 from complete_phase()'s dispatch table.
PhaseCompleteRequest = Annotated[
    Union[
        ActivationCompleteRequest,
        LoadingCompleteRequest,
        DepartureCompleteRequest,
        UnloadingCompleteRequest,
        ConfirmationCompleteRequest,
    ],
    Field(discriminator="phase_type"),
]
