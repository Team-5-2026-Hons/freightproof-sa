"""Read-time parcel/consignment evidence projections (FP-149), never a second ledger."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, field_validator

from app.core.pagination import decode_cursor
from app.db.models.enums import AnchorStatus, ParcelStatus, PhaseStatus, PhaseType, TripStatus
from app.schemas.text import REFERENCE_MAX_LENGTH, clean_text

def _visible_identifier(value: str) -> str:
    # Cleaning an identifier into another valid barcode would search the wrong parcel.
    if not value.isprintable() or clean_text(value) != value:
        raise ValueError("Identifiers must contain visible characters only")
    return value


Identifier = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=REFERENCE_MAX_LENGTH),
    AfterValidator(_visible_identifier),
]
LOOKUP_PAGE_SIZE = 20
TRACE_PAGE_SIZE = 5
MAX_TRACE_PAGE_SIZE = 10


class ParcelLookupQuery(BaseModel):
    barcode: Identifier
    after: Identifier | None = None


class ParcelTraceQuery(BaseModel):
    barcode: Identifier
    waybill_reference: Identifier
    cursor: str | None = Field(default=None, max_length=512)
    limit: int = Field(default=TRACE_PAGE_SIZE, ge=1, le=MAX_TRACE_PAGE_SIZE)

    @field_validator("cursor")
    @classmethod
    def validate_cursor(cls, value: str | None) -> str | None:
        if value is not None:
            decode_cursor(value)
        return value


class ParcelMatch(BaseModel):
    waybill_reference: str
    journey_count: int


class ParcelLookupResponse(BaseModel):
    barcode: str
    items: list[ParcelMatch]
    next_after: str | None = None


class ParcelScanObservation(BaseModel):
    parcel_id: UUID
    status: ParcelStatus
    scan_out_at: datetime | None
    scan_in_at: datetime | None
    # Legacy scan columns do not record their producer or whether it was simulated.
    source: Literal["parcel_record_source_unknown"] = "parcel_record_source_unknown"


class ParcelTracePhase(BaseModel):
    id: UUID
    sequence_number: int
    phase_type: PhaseType
    status: PhaseStatus
    completed_at: datetime | None
    driver_captured_at: datetime | None
    precinct_id: UUID | None
    precinct_name: str | None
    relevance: Literal["consignment", "trip_context", "unknown"]
    anchor_status: AnchorStatus
    seal_number: str | None
    seal_condition: str | None
    location_verdict: Literal["confirmed", "mismatch", "unwitnessed", "not_recorded"]
    override_note: str | None


class ParcelProgress(BaseModel):
    position: Literal["before_pickup", "within_journey", "after_delivery", "cancelled", "unknown"]
    phase_event_id: UUID | None = None
    phase_type: PhaseType | None = None
    phase_status: PhaseStatus | None = None
    has_overrides: bool = False


class ParcelRecordedLocation(BaseModel):
    phase_event_id: UUID
    precinct_name: str | None
    source: Literal["horse_tracker", "driver_phone"]
    captured_at: datetime | None
    phase_completed_at: datetime | None
    precinct_confirmed: bool | None


class ParcelSealWindow(BaseModel):
    departure_phase_id: UUID
    inspection_phase_id: UUID | None
    phase_ids: list[UUID]
    origin_name: str | None
    destination_name: str | None
    departure_seal: str | None
    arrival_seal: str | None
    status: Literal["matched", "mismatch", "pending", "unverified"]


class ParcelTraceException(BaseModel):
    id: UUID
    phase_event_id: UUID | None
    exception_type: str
    severity: str
    description: str
    recorded_at: datetime
    scope: Literal["consignment", "trip_context"]
    review_status: str


class ParcelJourney(BaseModel):
    trip_id: UUID
    trip_reference: str
    trip_status: TripStatus
    created_at: datetime
    vehicle_registration: str | None
    membership_source: Literal["current_assignment", "creation_manifest"]
    origin_name: str | None
    destination_name: str | None
    progress: ParcelProgress
    last_recorded_location: ParcelRecordedLocation | None
    scans: list[ParcelScanObservation]
    phases: list[ParcelTracePhase]
    seal_windows: list[ParcelSealWindow]
    exceptions: list[ParcelTraceException]
    gaps: list[str]


class ParcelTraceResponse(BaseModel):
    barcode: str
    waybill_reference: str
    journeys: list[ParcelJourney]
    next_cursor: str | None
    coverage_note: str
