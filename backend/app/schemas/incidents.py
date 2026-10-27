"""Wire contract for incidents: reporting one, appending follow-up, closing and reopening,
and reading them back.

An update is a discriminated union on `kind`, so each kind states exactly what it must carry
(a finding must say why, a confidence change must say what corroborated it) and a malformed
entry is a 422 before it reaches the ledger.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.db.models.enums import (
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionType,
    IncidentConfidence,
    IncidentExternalAction,
    IncidentOutcome,
    IncidentReportChannel,
    IncidentReporterRole,
    IncidentStatus,
    IncidentType,
    IncidentUpdateKind,
    ParcelFinding,
    TripStatus,
)
from app.schemas.audit_pack import CoverageGap, IncidentDeclarationRecord, Observation, PositionFix
from app.schemas.text import FreeText, RequiredFreeText, clean_text

REPORTER_NAME_MAX_LENGTH = 200
MAX_PARCELS_PER_REQUEST = 500
MAX_EXCEPTIONS_PER_REQUEST = 50

_ReporterName = Annotated[
    str, StringConstraints(min_length=1, max_length=REPORTER_NAME_MAX_LENGTH), AfterValidator(clean_text)
]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _unique(ids: list[UUID]) -> list[UUID]:
    """Order-preserving de-duplication: a double-clicked row is one parcel, not two."""
    return list(dict.fromkeys(ids))


class IncidentCreate(_Request):
    """POST /trips/{trip_id}/incidents. Every fact a report rests on is explicit — the
    dispatcher UI fills hijacking defaults (stop the trip, all parcels), the API assumes none."""

    incident_type: IncidentType
    summary: RequiredFreeText
    reported_by_name: _ReporterName | None = None
    reporter_role: IncidentReporterRole
    report_channel: IncidentReportChannel
    reported_occurred_at: AwareDatetime | None = None
    received_at: AwareDatetime | None = None
    confidence: IncidentConfidence
    assigned_to_user_id: UUID | None = None
    exception_ids: Annotated[list[UUID], AfterValidator(_unique)] = Field(
        default_factory=list, max_length=MAX_EXCEPTIONS_PER_REQUEST,
    )
    parcel_ids: Annotated[list[UUID], AfterValidator(_unique)] = Field(
        default_factory=list, max_length=MAX_PARCELS_PER_REQUEST,
    )
    all_parcels: bool = False
    stop_trip: bool = False

    @model_validator(mode="after")
    def _consistent(self) -> "IncidentCreate":
        if self.all_parcels and self.parcel_ids:
            raise ValueError("Send either all_parcels or parcel_ids, not both.")
        if self.report_channel == IncidentReportChannel.IN_APP and not self.exception_ids:
            raise ValueError("An in-app report is opened from an exception: name at least one exception_id.")
        if (
            self.reported_occurred_at is not None and self.received_at is not None
            and self.reported_occurred_at > self.received_at
        ):
            raise ValueError("reported_occurred_at cannot be after received_at.")
        return self


class NoteUpdate(_Request):
    kind: Literal[IncidentUpdateKind.NOTE]
    note: RequiredFreeText
    exception_id: UUID | None = None
    phase_event_id: UUID | None = None
    parcel_id: UUID | None = None


class StatusUpdate(_Request):
    kind: Literal[IncidentUpdateKind.STATUS_CHANGED]
    status: IncidentStatus
    note: FreeText | None = None


class AssignUpdate(_Request):
    kind: Literal[IncidentUpdateKind.ASSIGNED]
    assigned_to_user_id: UUID | None
    note: FreeText | None = None


class ConfidenceUpdate(_Request):
    kind: Literal[IncidentUpdateKind.CONFIDENCE_CHANGED]
    confidence: IncidentConfidence
    note: RequiredFreeText


class LinkExceptionUpdate(_Request):
    kind: Literal[IncidentUpdateKind.EXCEPTION_LINKED]
    exception_id: UUID
    note: FreeText | None = None


class AddParcelsUpdate(_Request):
    kind: Literal[IncidentUpdateKind.PARCEL_ADDED]
    parcel_ids: Annotated[list[UUID], AfterValidator(_unique)] = Field(min_length=1, max_length=MAX_PARCELS_PER_REQUEST)
    note: FreeText | None = None


class ParcelFindingUpdate(_Request):
    kind: Literal[IncidentUpdateKind.PARCEL_FINDING]
    parcel_id: UUID
    finding: ParcelFinding
    note: RequiredFreeText


class ExternalActionUpdate(_Request):
    kind: Literal[IncidentUpdateKind.EXTERNAL_ACTION]
    action: IncidentExternalAction
    action_at: AwareDatetime | None = None
    note: FreeText | None = None

    @model_validator(mode="after")
    def _other_needs_note(self) -> "ExternalActionUpdate":
        if self.action == IncidentExternalAction.OTHER and not self.note:
            raise ValueError("Describe an 'other' action in the note.")
        return self


IncidentUpdateCreate = Annotated[
    NoteUpdate | StatusUpdate | AssignUpdate | ConfidenceUpdate | LinkExceptionUpdate
    | AddParcelsUpdate | ParcelFindingUpdate | ExternalActionUpdate,
    Field(discriminator="kind"),
]


class IncidentCloseRequest(_Request):
    outcome: IncidentOutcome
    reason: RequiredFreeText


class IncidentReopenRequest(_Request):
    reason: RequiredFreeText


class IncidentListFilters(BaseModel):
    """Optional narrowing for GET /incidents and GET /trips/{trip_id}/incidents."""

    trip_id: UUID | None = None
    status: IncidentStatus | None = None
    incident_type: IncidentType | None = None
    assigned_to: UUID | None = None


class IncidentUpdateRead(BaseModel):
    update_id: UUID
    sequence: int
    kind: IncidentUpdateKind
    note: str | None
    from_value: str | None
    to_value: str | None
    parcel_id: UUID | None
    exception_id: UUID | None
    phase_event_id: UUID | None
    artifact_id: UUID | None
    external_action: IncidentExternalAction | None
    action_at: datetime | None
    recorded_by_user_id: UUID
    recorded_by_name: str | None
    recorded_at: datetime


ParcelScanState = Literal["scanned_in", "no_scan_in_recorded", "no_scan_recorded"]


class IncidentParcelRead(BaseModel):
    parcel_id: UUID
    barcode: str
    description: str | None
    consignment_id: UUID
    consignment_reference: str | None
    delivery_stop: str | None
    scanned_out_at: datetime | None
    scanned_in_at: datetime | None
    scan_state: ParcelScanState
    latest_finding: ParcelFinding | None
    added_at: datetime


class IncidentExceptionRead(BaseModel):
    exception_id: UUID
    exception_type: ExceptionType
    severity: ExceptionSeverity
    description: str
    review_status: ExceptionReviewStatus
    raised_at: datetime
    linked_at: datetime


class IncidentRead(BaseModel):
    """One incident in a list: enough to triage without opening it."""

    incident_id: UUID
    reference: str
    trip_id: UUID
    trip_reference: str
    trip_status: TripStatus
    incident_type: IncidentType
    summary: str
    status: IncidentStatus
    confidence: IncidentConfidence
    outcome: IncidentOutcome | None
    assigned_to_user_id: UUID | None
    assigned_to_name: str | None
    reported_occurred_at: datetime | None
    received_at: datetime
    trip_stopped_at: datetime | None
    closed_at: datetime | None
    created_at: datetime
    exception_ids: list[UUID]
    exceptions_total: int
    exceptions_reviewed: int
    parcels_total: int
    parcels_unresolved: int


ResponseStepKey = Literal[
    "trip_stopped", "tracking_company_alerted", "saps_reported", "insurer_notified",
    "client_notified", "driver_welfare_check", "audit_pack_issued",
]
ResponseStepState = Literal["done", "in_progress", "todo", "not_applicable"]


class ResponseStep(BaseModel):
    """One step of the hijacking response guide, derived from what was recorded."""

    key: ResponseStepKey
    state: ResponseStepState
    done_at: datetime | None = None
    detail: str | None = None


class IncidentDetail(IncidentRead):
    reported_by_name: str | None
    reporter_role: IncidentReporterRole
    report_channel: IncidentReportChannel
    recorded_by_user_id: UUID
    recorded_by_name: str | None
    closure_reason: str | None
    exceptions: list[IncidentExceptionRead]
    parcels: list[IncidentParcelRead]
    updates: list[IncidentUpdateRead]
    declarations: list[IncidentDeclarationRecord]
    document_upload_enabled: bool
    response_guide: list[ResponseStep] | None = None
    warnings: list[str] = Field(default_factory=list)


class IncidentDocumentLink(BaseModel):
    artifact_id: UUID
    signed_url: str | None


class SealReading(BaseModel):
    phase_event_id: UUID
    phase_type: str
    precinct_name: str | None
    seal_number: str | None
    seal_condition: str | None
    completed_at: datetime | None
    photo_ids: list[UUID]


class CountReading(BaseModel):
    phase_event_id: UUID
    phase_type: str
    precinct_name: str | None
    parcel_count_origin: int | None
    parcel_count_destination: int | None
    driver_visual_count: int | None


class ConsignmentScanSummary(BaseModel):
    consignment_id: UUID
    reference: str
    parcel_count_expected: int | None
    parcels_on_record: int
    scanned_out: int
    scanned_in: int
    no_scan_in_recorded: int


class TripExceptionLink(BaseModel):
    exception_id: UUID
    exception_type: str
    severity: str
    description: str
    raised_at: datetime
    review_status: str
    incident_id: UUID | None


class IncidentEvidence(BaseModel):
    incident_id: UUID
    seals: list[SealReading]
    counts: list[CountReading]
    consignments: list[ConsignmentScanSummary]
    trip_exceptions: list[TripExceptionLink]
    last_known_position: PositionFix | None
    position_reference_time: datetime
    coverage_gaps: list[CoverageGap]
    observations: list[Observation]
