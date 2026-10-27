"""Pydantic v2 wire contract for driver substitution (FP-83), API contract v1.

Source of truth: docs/contracts/driver-substitution-v1.md. The TypeScript mirror is
frontend/shared/lib/types/driver-substitution.ts; tests/unit/test_driver_substitution_schemas.py
parses that file and fails if either side drifts. This module is CONTRACT ONLY (C0): no model,
endpoint or service uses it yet, and nothing here reads the database.

Request bodies forbid unknown fields. The contract is explicit that actor IDs come from the
token, never the body, so a smuggled ``driver_id``/``user_id`` is a 422 rather than ignored.
"""

import math
from datetime import datetime
from enum import Enum
from typing import Annotated, Literal, Optional, Union
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.db.models.enums import AnchorStatus, IdvsStatus, PhaseType, TripStatus, VehicleType
from app.schemas.action_location import ActionLocationAssessment
from app.schemas.evidence import EvidenceArtifactWithUrl
from app.schemas.locations import LocationPingBatch
from app.schemas.phases import PhaseCompleteRequest, _validate_seal_format
from app.schemas.text import _require_content, clean_text
from app.schemas.transit import DriverCheckpointCreateBody, DriverExceptionCreateBody, TripExceptionRead
from app.schemas.trips import TripStopRead

EXCHANGE_LABEL_MAX_LENGTH = 255
SUBSTITUTION_TEXT_MAX_LENGTH = 1000
PLANNED_V1 = "planned_v1"
IMMEDIATE_V2 = "immediate_v2"
RequestFormat = Literal["planned_v1", "immediate_v2"]
ConfirmationPolicy = Literal["two_driver_v1", "incoming_acceptance_v2"]
LocationUnavailableReason = Literal["permission_denied", "timeout", "position_unavailable", "unknown"]

SubstitutionText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=SUBSTITUTION_TEXT_MAX_LENGTH),
    AfterValidator(clean_text),
    AfterValidator(_require_content),
]
ExchangeLabel = Annotated[
    str,
    StringConstraints(min_length=1, max_length=EXCHANGE_LABEL_MAX_LENGTH),
    AfterValidator(clean_text),
    AfterValidator(_require_content),
]
ExchangeInstructions = Annotated[
    str, StringConstraints(max_length=SUBSTITUTION_TEXT_MAX_LENGTH), AfterValidator(clean_text)
]



class SubstitutionState(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class SubstitutionRole(str, Enum):
    OUTGOING = "outgoing"
    INCOMING = "incoming"


class SubstitutionSealCondition(str, Enum):
    """Deliberately NOT the phase ``SealCondition``: not_applicable is a substitution-only
    answer (an empty leg has no seal) and must never become a legal phase seal value."""

    INTACT = "intact"
    DAMAGED = "damaged"
    MISSING = "missing"
    NOT_APPLICABLE = "not_applicable"


class SubstitutionAction(str, Enum):
    CONFIRM_OUTGOING = "confirm_outgoing"
    CONFIRM_INCOMING = "confirm_incoming"
    CANCEL = "cancel"
    REPLACE = "replace"
    COMPLETE_ATTESTED = "complete_attested"
    ATTEST_IDENTITY = "attest_identity"


class SubstitutionCompletionMode(str, Enum):
    NORMAL = "normal"
    DISPATCHER_ATTESTED = "dispatcher_attested"


class SubstitutionCompletionTrigger(str, Enum):
    DRIVER_CONFIRMATION = "driver_confirmation"
    DISPATCHER_ACTION = "dispatcher_action"


class SubstitutionCompletionBlocker(str, Enum):
    """Declaration order IS the contract's fixed precedence when several checks fail."""

    INCOMING_DRIVER_INACTIVE = "incoming_driver_inactive"
    LICENCE_INVALID = "licence_invalid"
    DRIVER_UNAVAILABLE = "driver_unavailable"
    IDENTITY_NOT_VERIFIED = "identity_not_verified"


class SubstitutionNoticeKind(str, Enum):
    ARRANGED = "arranged"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class DriverParticipation(str, Enum):
    CURRENT = "current"
    FORMER = "former"


class LateEvidenceStatus(str, Enum):
    AWAITING_REVIEW = "awaiting_review"
    ACKNOWLEDGED = "acknowledged"


class LateEvidenceKind(str, Enum):
    PHASE = "phase"
    CHECKPOINT = "checkpoint"
    LOCATION = "location"
    EXCEPTION = "exception"


class CustodyIntegrityStatus(str, Enum):
    VERIFIED = "verified"
    PENDING = "pending"
    FAILED = "failed"


class SubstitutionErrorCode(str, Enum):
    TRIP_HANDED_OVER = "TRIP_HANDED_OVER"
    CUSTODY_CONTEXT_CHANGED = "CUSTODY_CONTEXT_CHANGED"
    CUSTODY_CONTEXT_REQUIRED = "CUSTODY_CONTEXT_REQUIRED"
    SUBSTITUTION_VERSION_CHANGED = "SUBSTITUTION_VERSION_CHANGED"
    SUBSTITUTION_NOT_PENDING = "SUBSTITUTION_NOT_PENDING"
    DRIVER_UNAVAILABLE = "DRIVER_UNAVAILABLE"
    INCOMING_DRIVER_INACTIVE = "INCOMING_DRIVER_INACTIVE"
    LICENCE_INVALID = "LICENCE_INVALID"
    IDENTITY_ATTESTATION_FORBIDDEN = "IDENTITY_ATTESTATION_FORBIDDEN"
    IDENTITY_NOT_VERIFIED = "IDENTITY_NOT_VERIFIED"
    IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED"
    EVIDENCE_ALREADY_RECORDED = "EVIDENCE_ALREADY_RECORDED"
    SUBSTITUTIONS_DISABLED = "SUBSTITUTIONS_DISABLED"


SUBSTITUTION_ERROR_STATUS: dict[SubstitutionErrorCode, int] = {
    **{code: 409 for code in SubstitutionErrorCode},
    SubstitutionErrorCode.IDENTITY_ATTESTATION_FORBIDDEN: 403,
    SubstitutionErrorCode.SUBSTITUTIONS_DISABLED: 503,
}



def _require_timezone(value: Optional[datetime], field: str) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        raise ValueError(f"{field} must be timezone-aware")
    return value


def _request_config() -> ConfigDict:
    return ConfigDict(extra="forbid")



class DriverContact(BaseModel):
    """What the other party may see of a driver: no identity number, licence number or
    verification vendor data."""

    id: UUID
    full_name: str
    phone_number: str


class ExchangePoint(BaseModel):
    label: ExchangeLabel
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    instructions: ExchangeInstructions = ""


class VehicleRef(BaseModel):
    id: UUID
    registration: str
    vehicle_type: VehicleType


class SealCheck(BaseModel):
    """One vehicle's seal declaration at a handover (contract "Types" and seal rules)."""

    model_config = _request_config()

    vehicle_id: UUID
    condition: SubstitutionSealCondition
    seal_number: Optional[str] = None
    photo_artifact_ids: list[UUID] = Field(default_factory=list)
    not_applicable_reason: Optional[SubstitutionText] = None

    @field_validator("seal_number")
    @classmethod
    def _normalise_seal_number(cls, value: Optional[str]) -> Optional[str]:
        return None if value is None else _validate_seal_format(value)

    @model_validator(mode="after")
    def _apply_condition_rules(self) -> "SealCheck":
        condition = self.condition
        if condition is SubstitutionSealCondition.NOT_APPLICABLE:
            if self.not_applicable_reason is None:
                raise ValueError("not_applicable_reason is required when the seal is not applicable")
            if self.seal_number is not None:
                raise ValueError("seal_number must be null when the seal is not applicable")
            return self

        if self.not_applicable_reason is not None:
            raise ValueError("not_applicable_reason must be null unless the condition is not_applicable")
        if not self.photo_artifact_ids:
            raise ValueError(f"at least one photo is required when the seal is {condition.value}")
        if condition is SubstitutionSealCondition.MISSING:
            if self.seal_number is not None:
                raise ValueError("seal_number must be null when the seal is missing")
        elif self.seal_number is None:
            raise ValueError(f"seal_number is required when the seal is {condition.value}")
        return self


class IdentitySnapshot(BaseModel):
    """The incoming driver's fleet verification status as observed. An admin attestation is a
    separate fact and never rewrites this status."""

    driver_id: UUID
    status: IdvsStatus
    last_verified_at: Optional[datetime] = None
    observed_at: datetime


class ConfirmationSummary(BaseModel):
    """A submitted capture, without its evidence. An upload alone is never a confirmation."""

    id: UUID
    role: SubstitutionRole
    driver_id: UUID
    captured_at: datetime
    received_at: datetime


class SubstitutionConfirmationDetail(ConfirmationSummary):
    """Summary plus the permitted declaration, for the context read and participation history."""

    confirmed_vehicle_ids: list[UUID]
    seal_checks: list[SealCheck]
    discrepancy_note: Optional[str] = None
    latitude: float | None = None
    longitude: float | None = None
    accuracy_metres: float | None = None
    location_observed_at: datetime | None = None
    location_unavailable_reason: LocationUnavailableReason | None = None
    action_location_assessment: ActionLocationAssessment | None = None
    location_observation_committed: bool = False


class SubstitutionCompletionRead(BaseModel):
    """Who caused completion; exactly one actor, matching the trigger."""

    trigger: SubstitutionCompletionTrigger
    completed_by_driver_id: Optional[UUID] = None
    completed_by_user_id: Optional[UUID] = None
    completed_by_name: Optional[str] = None

    @model_validator(mode="after")
    def _exactly_one_actor_matching_the_trigger(self) -> "SubstitutionCompletionRead":
        by_driver = self.completed_by_driver_id is not None
        by_user = self.completed_by_user_id is not None
        if by_driver == by_user:
            raise ValueError("exactly one of completed_by_driver_id and completed_by_user_id is required")
        driver_triggered = self.trigger is SubstitutionCompletionTrigger.DRIVER_CONFIRMATION
        if driver_triggered != by_driver:
            raise ValueError("the completing actor must match the completion trigger")
        return self


class SubstitutionRequestRead(BaseModel):
    """An explicit response schema, not a raw ORM dump (contract "Types")."""

    id: UUID
    trip_id: UUID
    trip_reference: str
    version: int = Field(..., ge=1)
    state: SubstitutionState
    outgoing: DriverContact
    incoming: DriverContact
    vehicles: list[VehicleRef]
    exchange: ExchangePoint | None
    expected_at: datetime | None
    is_planned: bool | None
    request_format: RequestFormat = "planned_v1"
    confirmation_policy: ConfirmationPolicy = "two_driver_v1"
    required_confirmation_roles: list[SubstitutionRole] = Field(default_factory=lambda: [SubstitutionRole.OUTGOING, SubstitutionRole.INCOMING])
    reservation_start_at: datetime | None = None
    reason: str
    created_at: datetime
    confirmations: list[ConfirmationSummary]
    identity: IdentitySnapshot
    missing_confirmations: list[SubstitutionRole]
    completed_substitution_id: Optional[UUID] = None
    effective_at: Optional[datetime] = None
    completion_mode: Optional[SubstitutionCompletionMode] = None
    completion_blocked_by: Optional[SubstitutionCompletionBlocker] = None
    replacement_request_id: Optional[UUID] = None
    completion: Optional[SubstitutionCompletionRead] = None
    permitted_actions: list[SubstitutionAction]

    @model_validator(mode="after")
    def _state_dependent_fields(self) -> "SubstitutionRequestRead":
        facts = (self.completed_substitution_id, self.effective_at, self.completion_mode, self.completion)
        if self.state is SubstitutionState.COMPLETED:
            if any(fact is None for fact in facts):
                raise ValueError("a completed request carries its completion facts")
        elif any(fact is not None for fact in facts):
            raise ValueError("only a completed request carries completion facts")
        if self.completion_blocked_by is not None and self.state is not SubstitutionState.PENDING:
            raise ValueError("completion_blocked_by is only valid on a pending request")
        if self.replacement_request_id is not None and self.state is not SubstitutionState.CANCELLED:
            raise ValueError("replacement_request_id is only valid on a cancelled request")
        return self


class DriverSubstitutionContextRead(SubstitutionRequestRead):
    """The ongoing-collection context for a pending incoming/outgoing driver. Stops and
    findings reuse the existing driver-safe shapes rather than inventing parcel data."""

    confirmations: list[SubstitutionConfirmationDetail]  # type: ignore[assignment]  # narrows the summary
    remaining_stops: list[TripStopRead]
    current_phase: Optional[PhaseType] = None
    findings: list[TripExceptionRead]
    artifacts: list[EvidenceArtifactWithUrl]


class CustodyIntegrityRead(BaseModel):
    """Dispatcher-only result of verifying the full custody chain."""

    status: CustodyIntegrityStatus
    amendment_count: int = Field(..., ge=0)
    pending_anchor_count: int = Field(..., ge=0)
    findings: list[str]


class DriverAccess(BaseModel):
    participation: DriverParticipation
    custody_sequence: int = Field(..., ge=0)
    can_advance: bool
    can_submit_late_evidence: bool


class SubstitutionNoticeRead(BaseModel):
    """Details require an authorised fetch; the notice itself carries references only."""

    id: UUID
    request_id: UUID
    trip_id: UUID
    kind: SubstitutionNoticeKind
    created_at: datetime
    read_at: Optional[datetime] = None


class SubstitutionCorrectionRead(BaseModel):
    """An appended clarification — never an edit and never a new custody assignment."""

    id: UUID
    substitution_id: UUID
    recorded_by_user_id: UUID
    recorded_at: datetime
    reason: str
    correction_note: str
    anchor_status: AnchorStatus
    receipt_id: Optional[UUID] = None
    recorded_by_name: Optional[str] = None


class CustodyPeriodRead(BaseModel):
    custody_sequence: int = Field(..., ge=0)
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    completion_mode: Optional[SubstitutionCompletionMode] = None


class SubstitutionPhaseContext(BaseModel):
    phase_event_id: UUID
    phase_type: PhaseType


class IdentityAttestationRead(BaseModel):
    attested_by_user_id: UUID
    reason: str
    attested_at: datetime
    attested_by_name: Optional[str] = None


class CompletedSubstitutionSummary(BaseModel):
    substitution_id: UUID
    request_id: UUID | None
    sequence_number: int
    outgoing: DriverContact
    incoming: DriverContact
    effective_at: datetime
    completion_mode: SubstitutionCompletionMode | None
    anchor_status: AnchorStatus | None
    receipt_id: UUID | None
    phase_context: SubstitutionPhaseContext | None
    request_format: RequestFormat | None
    required_confirmation_roles: list[SubstitutionRole] | None
    confirmation_policy: ConfirmationPolicy | None


class CompletedSubstitutionDetail(CompletedSubstitutionSummary):
    reason: str | None
    confirmations: list[SubstitutionConfirmationDetail]
    artifacts: list[EvidenceArtifactWithUrl]
    corrections: list[SubstitutionCorrectionRead]
    arranged_by_user_id: UUID | None
    arranged_by_name: str | None = None
    completion: SubstitutionCompletionRead | None
    identity_attestation: IdentityAttestationRead | None
    declared_exchange_at: datetime | None
    missing_confirmation_reason: str | None
    outgoing_notices: list[SubstitutionNoticeRead] = Field(default_factory=list)
    custody_integrity: CustodyIntegrityRead


class ParticipationActionRef(BaseModel):
    """An opaque reference to one of this driver's own immutable actions."""

    kind: LateEvidenceKind
    id: UUID
    custody_sequence: int = Field(..., ge=0)
    recorded_at: datetime


class DriverParticipationHistoryRead(BaseModel):
    """What a known former (or current) participant may see of their own periods. No later
    live tracker trail, other drivers' identity details, cargo manifest or exception stream."""

    trip_id: UUID
    trip_reference: str
    trip_status: TripStatus
    custody_periods: list[CustodyPeriodRead]
    action_references: list[ParticipationActionRef]
    artifacts: list[EvidenceArtifactWithUrl]
    declarations: list[SubstitutionConfirmationDetail]



class LatePhaseEvidence(BaseModel):
    model_config = _request_config()

    kind: Literal[LateEvidenceKind.PHASE]
    payload: PhaseCompleteRequest


class LateCheckpointEvidence(BaseModel):
    model_config = _request_config()

    kind: Literal[LateEvidenceKind.CHECKPOINT]
    payload: DriverCheckpointCreateBody


class LateLocationEvidence(BaseModel):
    model_config = _request_config()

    kind: Literal[LateEvidenceKind.LOCATION]
    payload: LocationPingBatch


class LateExceptionEvidence(BaseModel):
    model_config = _request_config()

    kind: Literal[LateEvidenceKind.EXCEPTION]
    payload: DriverExceptionCreateBody


LateEvidencePayload = Annotated[
    Union[LatePhaseEvidence, LateCheckpointEvidence, LateLocationEvidence, LateExceptionEvidence],
    Field(discriminator="kind"),
]


class LateEvidenceRead(BaseModel):
    id: UUID
    trip_id: UUID
    driver_id: UUID
    custody_sequence: int = Field(..., ge=0)
    captured_at: datetime
    received_at: datetime
    status: LateEvidenceStatus
    artifact_ids: list[UUID]
    reviewed_by_user_id: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None
    review_note: Optional[str] = None


class LateEvidenceDetailRead(LateEvidenceRead):
    """Dispatcher view: the retained typed evidence, its commitment and scoped artifact URLs,
    so acknowledgement follows an actual review."""

    evidence: LateEvidencePayload
    payload_sha256: str
    artifacts: list[EvidenceArtifactWithUrl]



class _ArrangementFields(BaseModel):
    model_config = _request_config()

    incoming_driver_id: UUID
    exchange: ExchangePoint
    expected_at: datetime
    is_planned: bool
    reason: SubstitutionText

    @field_validator("expected_at")
    @classmethod
    def _expected_at_has_offset(cls, value: datetime) -> datetime:
        return _require_timezone(value, "expected_at")  # type: ignore[return-value]


class ArrangeSubstitutionRequest(_ArrangementFields):
    client_request_id: UUID


class ArrangeImmediateSubstitutionRequest(BaseModel):
    model_config = _request_config()

    client_request_id: UUID
    request_format: Literal["immediate_v2"]
    incoming_driver_id: UUID
    reason: SubstitutionText


class ReplaceImmediateSubstitutionRequest(ArrangeImmediateSubstitutionRequest):
    expected_version: int = Field(..., ge=1)
    replacement_reason: SubstitutionText


class CancelSubstitutionRequest(BaseModel):
    model_config = _request_config()

    client_request_id: UUID
    expected_version: int = Field(..., ge=1)
    reason: SubstitutionText


class ReplaceSubstitutionRequest(_ArrangementFields):
    """Cancels the old request and creates a fresh one atomically: the complete new
    arrangement, with its own ``reason``, plus why it replaces the old one."""

    client_request_id: UUID
    expected_version: int = Field(..., ge=1)
    replacement_reason: SubstitutionText


class ConfirmSubstitutionRequest(BaseModel):
    model_config = _request_config()

    client_request_id: UUID
    expected_version: int = Field(..., ge=1)
    captured_at: datetime
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    accuracy_metres: Optional[float] = Field(default=None, ge=0)
    confirmed_vehicle_ids: list[UUID] = Field(..., min_length=1)
    seal_checks: list[SealCheck]
    discrepancy_note: Optional[SubstitutionText] = None

    @field_validator("captured_at")
    @classmethod
    def _captured_at_has_offset(cls, value: datetime) -> datetime:
        return _require_timezone(value, "captured_at")  # type: ignore[return-value]

    @field_validator("accuracy_metres")
    @classmethod
    def _accuracy_is_finite(cls, value: Optional[float]) -> Optional[float]:
        if value is not None and not math.isfinite(value):
            raise ValueError("accuracy_metres must be a finite number")
        return value

    @model_validator(mode="after")
    def _capture_is_atomic_and_unambiguous(self) -> "ConfirmSubstitutionRequest":
        present = [self.latitude is not None, self.longitude is not None, self.accuracy_metres is not None]
        if any(present) and not all(present):
            raise ValueError("latitude, longitude and accuracy_metres must be provided together or all null")
        if len(set(self.confirmed_vehicle_ids)) != len(self.confirmed_vehicle_ids):
            raise ValueError("confirmed_vehicle_ids contains a duplicate vehicle")
        checked = [check.vehicle_id for check in self.seal_checks]
        if len(set(checked)) != len(checked):
            raise ValueError("seal_checks contains a duplicate vehicle: one check per vehicle")
        return self


class ConfirmSubstitutionObservationRequest(ConfirmSubstitutionRequest):
    capture_format: Literal["observation_v2"]
    location_observed_at: datetime | None
    location_unavailable_reason: LocationUnavailableReason | None

    @field_validator("location_observed_at")
    @classmethod
    def _observed_at_has_offset(cls, value: datetime | None) -> datetime | None:
        return _require_timezone(value, "location_observed_at")

    @model_validator(mode="after")
    def _observation_is_consistent(self) -> "ConfirmSubstitutionObservationRequest":
        if self.latitude is not None:
            if self.location_observed_at is None or self.location_unavailable_reason is not None:
                raise ValueError("A location needs its observed time and no unavailable reason")
        elif self.location_observed_at is not None:
            raise ValueError("An unavailable location cannot have an observation time")
        return self


class CompleteSubstitutionRequest(BaseModel):
    model_config = _request_config()

    client_request_id: UUID
    expected_version: int = Field(..., ge=1)
    missing_confirmation_reason: Optional[SubstitutionText] = None
    identity_unavailable_reason: Optional[SubstitutionText] = None
    declared_exchange_at: Optional[datetime] = None

    @field_validator("declared_exchange_at")
    @classmethod
    def _declared_exchange_at_has_offset(cls, value: Optional[datetime]) -> Optional[datetime]:
        return _require_timezone(value, "declared_exchange_at")


class CorrectSubstitutionRequest(BaseModel):
    model_config = _request_config()

    client_request_id: UUID
    reason: SubstitutionText
    correction_note: SubstitutionText


class LateEvidenceRequest(BaseModel):
    model_config = _request_config()

    client_request_id: UUID
    custody_sequence: int = Field(..., ge=0)
    captured_at: datetime
    original_idempotency_key: Optional[str] = Field(default=None, min_length=1, max_length=100)
    evidence: LateEvidencePayload
    artifact_ids: list[UUID]

    @field_validator("captured_at")
    @classmethod
    def _captured_at_has_offset(cls, value: datetime) -> datetime:
        return _require_timezone(value, "captured_at")  # type: ignore[return-value]


class AcknowledgeLateEvidenceRequest(BaseModel):
    model_config = _request_config()

    client_request_id: UUID
    note: SubstitutionText



class SubstitutionErrorDetail(BaseModel):
    """FastAPI's ``detail`` object for a domain conflict. Existing clients must also parse the
    legacy string ``detail``."""

    code: SubstitutionErrorCode
    message: str
    request_id: Optional[UUID] = None
    current_version: Optional[int] = None
    evidence_id: Optional[UUID] = None


class SubstitutionErrorResponse(BaseModel):
    detail: SubstitutionErrorDetail


def _resolve_trip_read_references() -> None:
    from app.schemas import trips

    namespace = {
        "CustodyIntegrityRead": CustodyIntegrityRead, "DriverAccess": DriverAccess,
        "DriverParticipation": DriverParticipation, "SubstitutionRequestRead": SubstitutionRequestRead,
        "CompletedSubstitutionSummary": CompletedSubstitutionSummary,
    }
    trips.TripDetailResponse.model_rebuild(_types_namespace=namespace)
    trips.DriverTripListItemResponse.model_rebuild(_types_namespace=namespace)


_resolve_trip_read_references()
