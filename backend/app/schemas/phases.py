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

    # Non-null while this phase is waiting on an external system — today only the
    # warehouse scan feed. Derived per request (orchestration/phase_gate.py), never
    # stored: it is a property of the outside world, not of this row.
    blocked_on: Optional[str] = None

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
    # D7/T5: the seal is applied at departure, not here.
    #
    # driver_visual_count is Optional and IGNORED by advance_loading as of the
    # scan-driven redesign. It is kept on the schema rather than removed for one
    # reason: a loading queued offline under the old schema replays from
    # localStorage with the field present, and removing it would 422 that entry
    # forever — the queue would never drain. The driver app stops sending it in
    # Stage C; this field is deleted only once no client can still be holding one.
    phase_type: Literal[PhaseType.LOADING]
    driver_visual_count: Optional[int] = None


class DepartureCompleteRequest(_PhaseCompleteBase):
    # D7/T5: the seal is applied HERE — the driver photographs the waybill and
    # seal as they physically close the trailer at exit.
    phase_type: Literal[PhaseType.DEPARTURE]
    waybill_photo_artifact_id: UUID
    seal_number: str
    seal_photo_artifact_id: UUID
    # Tri-state, and the None is the point. Guards have no accounts and never will
    # (domain rules), so the driver app no longer asks a gate guard to re-type a seal
    # number the driver just photographed — a re-typed number proves nothing the
    # photograph does not. None therefore means "no independent confirmation was
    # collected", which is the ordinary case and NOT an anomaly. Only an explicit
    # False is a guard who was asked and refused/failed to verify. Optional with a
    # None default rather than removed outright because older app builds and replayed
    # offline-queue entries still send the boolean, and a required field would 422
    # evidence that is otherwise perfectly valid.
    guard_verified_seal: Optional[bool] = None
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
    # Photo of the seal as found at destination, BEFORE it is broken — the
    # tamper-evidence bookend to departure's seal_photo_artifact_id. Required, not
    # optional: the seal is the single piece of physical evidence this phase exists
    # to capture, and once the truck is open it cannot be re-photographed. An
    # unloading recorded without it is an assertion, not evidence.
    #
    # Reuses PhaseEvent.gate_photo_artifact_id, which existed unused on the model
    # before this — no migration needed.
    #
    # Contract note for driver-pwa: its unloading flow must upload this artifact and
    # send the id, or completion 422s. As of Stage 5 the app already CAPTURES a seal
    # photo at unloading (SealBreakInspection's sealBrokenPhotoDataUrl, mandatory
    # before the step can be confirmed) but drops it — lib/api/phases.ts sends only
    # seal_number_at_destination. Wiring it through is the same upload-then-send
    # pattern confirmation already uses for the POD photo.
    #
    # UNRESOLVED, needs a decision before the flows are wired together: this field is
    # specified as the seal AS FOUND, intact, before the warehouse breaks it. The
    # driver app's step photographs the seal AFTER breaking. Those are two different
    # photographs with different evidential value, and only one of them proves the
    # seal was intact on arrival.
    gate_photo_artifact_id: UUID

    @field_validator("seal_number_at_destination")
    @classmethod
    def validate_seal_number(cls, v: str) -> str:
        return _validate_seal_format(v)


class ConfirmationCompleteRequest(_PhaseCompleteBase):
    # BQ2 resolved 2026-06-29: proof of delivery is a photo AND an on-device
    # signature — both required, not either/or.
    #
    # pp_scan_in_count is GONE from the wire. The driver app used to send its own
    # driver_visual_count in this field, which made the reconciliation compare a
    # number against itself. The server now derives it from Parcel.pp_scan_in_at.
    # The KEY of the same name in the anchored canonical payload is unchanged and
    # must stay — verification_service rebuilds from it, so renaming it would break
    # hash verification on every historical trip.
    #
    # Checked before removing (task 8, §"CHECK THIS BEFORE PROCEEDING"): no schema
    # in this codebase sets extra="forbid" (BaseModel/_PhaseCompleteBase both use
    # Pydantic v2's default extra="ignore"), so an offline-queued confirmation still
    # carrying pp_scan_in_count from before this change is silently accepted and the
    # field just does nothing — it does not poison the driver app's offline queue
    # with a 422. Safe to remove outright, unlike LoadingCompleteRequest's
    # driver_visual_count, which had to stay as a schema field (Optional, ignored)
    # for the same offline-replay reason.
    phase_type: Literal[PhaseType.CONFIRMATION]
    pod_photo_artifact_id: UUID
    pod_signature_artifact_id: UUID
    # Pallet grain. Recorded and anchored as evidence; never compared against a
    # parcel count (design §5).
    driver_visual_count: int


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
