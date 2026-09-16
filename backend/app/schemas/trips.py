"""Pydantic v2 schemas for TripTemplate, Consignment, Parcel, Trip, TripTrailer."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.constants import MINIMUM_TRIP_DURATION
from app.db.models.enums import IdvsStatus, ParcelStatus, TripStatus, TripType
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.phases import PhaseEventRead
from app.schemas.people import DriverRead
from app.schemas.text import OrderNumberStr, RequiredFreeText, ShortNoteStr
from app.schemas.transit import TripExceptionRead
from app.schemas.vehicles import VehicleRead


class TripTemplateBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    operator_organization_id: UUID
    client_organization_id: UUID
    name: str
    default_origin_precinct_id: Optional[UUID] = None
    default_destination_precinct_id: Optional[UUID] = None
    is_active: bool = True


class TripTemplateCreate(TripTemplateBase):
    pass


class TripTemplateUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: Optional[str] = None
    default_origin_precinct_id: Optional[UUID] = None
    default_destination_precinct_id: Optional[UUID] = None
    is_active: Optional[bool] = None


class TripTemplateRead(TripTemplateBase):
    id: UUID
    created_at: datetime


class ConsignmentBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: Optional[UUID] = None
    parcel_perfect_reference: str
    client_organization_id: Optional[UUID] = None  # resolved from the PP accnum; may be NULL
    origin_precinct_id: Optional[UUID] = None
    destination_precinct_id: Optional[UUID] = None
    declared_value: Optional[Decimal] = None
    parcel_count_expected: Optional[int] = None
    slot_time_origin: Optional[datetime] = None
    slot_time_destination: Optional[datetime] = None
    pp_raw_json: Optional[Any] = None
    pickup_stop_id: Optional[UUID] = None
    delivery_stop_id: Optional[UUID] = None
    load_priority: Optional[int] = None
    unit_count_expected: Optional[int] = None
    pp_manifest_number: Optional[int] = None


class ConsignmentCreate(ConsignmentBase):
    pass


class ConsignmentUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: Optional[UUID] = None
    parcel_count_expected: Optional[int] = None
    slot_time_origin: Optional[datetime] = None
    slot_time_destination: Optional[datetime] = None
    pp_raw_json: Optional[Any] = None
    pickup_stop_id: Optional[UUID] = None
    delivery_stop_id: Optional[UUID] = None
    load_priority: Optional[int] = None
    unit_count_expected: Optional[int] = None
    pp_manifest_number: Optional[int] = None


class ConsignmentRead(ConsignmentBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    # Live scan progress, recomputed per request. Distinct from the phase rows'
    # parcel_count_origin/_destination, which are stamped once and never revised.
    scanned_out_count: int = 0
    scanned_in_count: int = 0


class ParcelBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    consignment_id: UUID
    barcode: str
    description: Optional[str] = None
    delivery_stop: Optional[str] = None
    status: ParcelStatus = ParcelStatus.PENDING


class ParcelCreate(ParcelBase):
    pass


class ParcelUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: Optional[ParcelStatus] = None
    pp_scan_out_at: Optional[datetime] = None
    pp_scan_in_at: Optional[datetime] = None


class ParcelRead(ParcelBase):
    id: UUID
    pp_scan_out_at: Optional[datetime] = None
    pp_scan_in_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class TripBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_reference: str
    order_number: str
    operator_organization_id: UUID
    client_organization_id: UUID
    driver_id: UUID
    horse_id: UUID
    origin_precinct_id: UUID
    destination_precinct_id: UUID
    created_by_user_id: UUID
    pulsit_trip_reference_id: Optional[str] = None
    template_id: Optional[UUID] = None
    planned_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None


def stop_slot_times(stops: Optional[list["TripStopCreate"]]) -> list[datetime]:
    """Every scheduled slot_time on the route, in sequence order (not list order, which
    a reversed payload would misread as a negative duration)."""
    if not stops:
        return []
    return [
        stop.slot_time
        for stop in sorted(stops, key=lambda s: s.sequence)
        if stop.slot_time is not None
    ]


def validate_declared_schedule(
    planned_departure_at: Optional[datetime],
    planned_arrival_at: Optional[datetime],
    *,
    schedule_source: str = "planned_departure_at/planned_arrival_at",
) -> None:
    """Reject a declared schedule that could not have happened.

    Shared by both creation schemas so the rule can't drift between two copies. Silent
    when either end is missing — planned_arrival_at is legitimately optional.
    schedule_source names where the two times came from (trip-level fields, or stop
    slot_times on a multi-stop route), since an error naming fields never sent helps no one.
    """
    if not (planned_departure_at and planned_arrival_at):
        return
    if planned_arrival_at <= planned_departure_at:
        raise ValueError(
            f"declared arrival must be after declared departure ({schedule_source})"
        )

    declared = planned_arrival_at - planned_departure_at
    if declared < MINIMUM_TRIP_DURATION:
        minimum_minutes = int(MINIMUM_TRIP_DURATION.total_seconds() // 60)
        declared_minutes = declared.total_seconds() / 60
        raise ValueError(
            f"planned trip duration must be at least {minimum_minutes} minutes "
            f"(declared {declared_minutes:g}, from {schedule_source})"
        )


class TripCreate(TripBase):
    @model_validator(mode="after")
    def validate_arrival_after_departure(self) -> "TripCreate":
        validate_declared_schedule(self.planned_departure_at, self.planned_arrival_at)
        return self


class TripUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: Optional[TripStatus] = None
    pulsit_trip_reference_id: Optional[str] = None
    journey_lock_hash: Optional[str] = None
    idvs_check_status: Optional[IdvsStatus] = None
    idvs_checked_at: Optional[datetime] = None
    actual_departure_at: Optional[datetime] = None
    actual_arrival_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None


class TripRead(TripBase):
    id: UUID
    status: TripStatus
    journey_lock_hash: Optional[str] = None
    idvs_check_status: IdvsStatus
    idvs_checked_at: Optional[datetime] = None
    actual_departure_at: Optional[datetime] = None
    actual_arrival_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    driver: Optional[DriverRead] = None
    horse: Optional[VehicleRead] = None


class TripListItemResponse(BaseModel):
    """Lightweight trip shape returned by GET /api/v1/trips. Excludes handshakes and
    receipts; needs_review_count counts only review_status == NEEDS_REVIEW."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_reference: str
    order_number: str
    status: TripStatus
    trip_type: TripType
    driver: DriverRead
    horse: VehicleRead
    trailers: list[VehicleRead]
    origin_precinct_id: UUID
    destination_precinct_id: UUID
    planned_departure_at: Optional[datetime] = None
    actual_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    actual_arrival_at: Optional[datetime] = None
    needs_review_count: int
    # Lets a row read "Unloading · stop 2 · 6/11" without the list view holding a phase
    # plan. phase_total is the plan's own length (7 on single-leg, 11 on cross-dock).
    current_phase: Optional[str] = None
    current_stop: Optional[int] = None
    phase_total: int
    phase_completed: int
    created_at: datetime
    updated_at: datetime


class TripHistoryDriverResponse(BaseModel):
    """Only the driver display value needed by a trip-history row."""

    model_config = ConfigDict(from_attributes=True)

    full_name: str


class TripHistoryVehicleResponse(BaseModel):
    """Only the horse display value needed by a trip-history row."""

    model_config = ConfigDict(from_attributes=True)

    registration: str


class TripHistoryListItemResponse(BaseModel):
    """Terminal-trip fields consumed by ChecklistRow, with no sensitive detail."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_reference: str
    order_number: str
    status: TripStatus
    driver: TripHistoryDriverResponse
    horse: TripHistoryVehicleResponse
    origin_precinct_id: Optional[UUID] = None
    destination_precinct_id: Optional[UUID] = None
    needs_review_count: int
    current_phase: Optional[str] = None
    current_stop: Optional[int] = None
    phase_total: int
    phase_completed: int
    closed_at: datetime
    created_at: datetime


class DriverTripListItemResponse(BaseModel):
    """One row of GET /api/v1/trips/me — the authenticated driver's own trip list.

    Deliberately not TripListItemResponse: that carries driver/horse/trailers a driver
    already knows, and omits precinct names, which are resolved server-side here.
    status is the coarse TripStatus the PWA groups its Active/Upcoming/Past tabs by;
    the phase ledger, not this field, sequences the trip.
    """
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_reference: str
    order_number: str
    status: TripStatus
    trip_type: TripType
    origin_precinct_id: Optional[UUID] = None
    destination_precinct_id: Optional[UUID] = None
    # Null when there's no precinct id or the row is gone; PWA falls back to the id.
    origin_precinct_name: Optional[str] = None
    destination_precinct_name: Optional[str] = None
    planned_departure_at: Optional[datetime] = None
    actual_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    actual_arrival_at: Optional[datetime] = None
    needs_review_count: int  # display parity with the dispatcher board; no review workflow here
    created_at: datetime
    updated_at: datetime


class TripTrailerBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    trailer_id: UUID
    pulsit_device_id_snapshot: str


class TripTrailerCreate(TripTrailerBase):
    pass


class TripTrailerRead(TripTrailerBase):
    pass


class DriverSubstitutionBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    original_driver_id: UUID
    substituting_driver_id: UUID
    exchange_location: str
    approving_dispatcher_user_id: UUID
    is_planned: bool
    substitution_at: datetime
    exception_id: Optional[UUID] = None
    blockchain_receipt_id: Optional[UUID] = None


class DriverSubstitutionCreate(DriverSubstitutionBase):
    pass


class DriverSubstitutionRead(DriverSubstitutionBase):
    id: UUID
    created_at: datetime


class TripStopBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    precinct_id: UUID
    sequence: int = Field(..., ge=0)
    slot_time: Optional[datetime] = None
    notes: Optional[ShortNoteStr] = None  # bounded to the String(255) column, client input


class TripStopCreate(TripStopBase):
    pass


class TripStopRead(TripStopBase):
    id: UUID
    trip_id: UUID
    created_at: datetime
    updated_at: datetime


class TripConsignmentInput(BaseModel):
    """One waybill on the trip. pp_reference is the PP waybill number (string[24], v28
    spec); unit_count_expected is dispatcher-entered — PP has no pallet grain."""

    pp_reference: str = Field(..., min_length=1, max_length=24)
    unit_count_expected: int = Field(..., ge=1)


class TripCreateRequest(BaseModel):
    """Dispatcher-facing trip creation payload — excludes auto-generated and JWT-derived fields."""

    order_number: OrderNumberStr
    driver_id: UUID
    horse_id: UUID
    trailer_ids: list[UUID] = Field(default_factory=list)
    origin_precinct_id: Optional[UUID] = None  # required only when `stops` is omitted (FP-112 A.3)
    destination_precinct_id: Optional[UUID] = None
    # When omitted, create_trip() synthesises two stops from origin/destination_precinct_id.
    stops: Optional[list[TripStopCreate]] = Field(default=None, min_length=2)
    template_id: Optional[UUID] = None
    planned_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    trip_type: TripType = TripType.LOADED
    # Client org is derived per-consignment from the PP accnum, not carried on the trip.
    consignments: list[TripConsignmentInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_request(self) -> "TripCreateRequest":
        if self.stops is None:
            if self.origin_precinct_id is None or self.destination_precinct_id is None:
                raise ValueError(
                    "origin_precinct_id and destination_precinct_id are required when stops is omitted"
                )
            if self.origin_precinct_id == self.destination_precinct_id:
                raise ValueError("origin and destination precincts must differ")
        else:
            sequences = [stop.sequence for stop in self.stops]
            if len(sequences) != len(set(sequences)):
                raise ValueError("stop sequence numbers must be unique")
        # A trip must carry a resolvable schedule at creation: _reject_if_not_due treats
        # "no schedule at all" as PERMANENTLY not-due, not merely not-yet-due. Without
        # this, a trip could be created that no schedule can ever satisfy.
        has_stop_schedule = self.stops is not None and any(
            stop.slot_time is not None for stop in self.stops
        )
        if self.planned_departure_at is None and not has_stop_schedule:
            raise ValueError(
                "planned_departure_at is required when no stop carries a "
                "slot_time — a trip with neither can never be activated "
                "(provide planned_departure_at, or set slot_time on at least "
                "one of the provided stops)"
            )
        # Falls back to stop bounds so the explicit-stops path can't bypass the
        # duration rule entirely; each half falls back independently.
        slots = stop_slot_times(self.stops)
        effective_departure = self.planned_departure_at or (slots[0] if slots else None)
        # Strictly after departure, so one timed stop reads as a moment, not a
        # zero-length span.
        later = [
            slot for slot in slots
            if effective_departure is None or slot > effective_departure
        ]
        effective_arrival = self.planned_arrival_at or (later[-1] if later else None)
        using_stops = (
            effective_departure is not self.planned_departure_at
            or effective_arrival is not self.planned_arrival_at
        )
        validate_declared_schedule(
            effective_departure,
            effective_arrival,
            schedule_source="stop slot_time" if using_stops else
            "planned_departure_at/planned_arrival_at",
        )
        if len(self.trailer_ids) != len(set(self.trailer_ids)):
            raise ValueError("trailer_ids must not contain duplicates")
        if self.trip_type == TripType.LOADED and not self.consignments:
            raise ValueError("a loaded trip requires at least one consignment (PP waybill)")
        if self.trip_type == TripType.EMPTY_LEG and self.consignments:
            raise ValueError("an empty leg cannot carry consignments")
        refs = [c.pp_reference for c in self.consignments]
        if len(refs) != len(set(refs)):
            raise ValueError("duplicate pp_reference values in consignments")
        return self


class CancelTripRequest(BaseModel):
    """POST /trips/{trip_id}/cancel body. note is required — a dispatcher abandoning a
    trip mid-plan without stating why is the single most audit-sensitive gap this action
    could leave. RequiredFreeText, not a bare min_length, also rejects invisible-char-only notes."""

    note: RequiredFreeText


class OverridePhaseRequest(BaseModel):
    """POST /trips/{trip_id}/phases/{phase_event_id}/override body. Same required-note
    rationale as CancelTripRequest — a dispatcher bypassing driver-attested evidence must state why."""

    note: RequiredFreeText


class DeliveryStopManifest(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    delivery_stop: str
    parcel_count: int
    parcels: list[ParcelRead]


class ConsignmentManifest(BaseModel):
    """One consignment's slice of the manifest — multi-client trips return one per client
    booking (FP-112). Grouping by consignment is what lets evidence be cut per client."""
    model_config = ConfigDict(from_attributes=True)

    consignment_id: UUID
    parcel_perfect_reference: str
    # Nullable: resolved from the PP accnum at sync time — an unmapped accnum
    # leaves this NULL on the consignment (creation warning, not an error).
    client_organization_id: Optional[UUID] = None
    # Consolidated-unit grain (pallets) — dispatcher-entered, distinct from parcel grain.
    unit_count_expected: Optional[int] = None
    total_parcel_count: int
    origin_scan_complete: bool
    stops: list[DeliveryStopManifest]


class ManifestResponse(BaseModel):
    """Full per-parcel manifest — dispatcher only. Never sent to the driver PWA."""
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    total_parcel_count: int
    origin_scan_complete: bool
    consignments: list[ConsignmentManifest]
    pulled_at: datetime


class LinehaulResponse(BaseModel):
    """Driver-facing single document — vehicle, driver, consolidated unit count.

    Deliberately excludes per-parcel data and per-stop breakdown — the driver
    must never see contents or per-parcel detail, only a consolidated unit
    count (theft-risk rule, 2026-06-24 coordination note).
    """
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    vehicle_registration: str
    vehicle_type: str
    driver_full_name: str
    consolidated_unit_count: int
    origin_scan_complete: bool
    pulled_at: datetime


class TripDetailResponse(BaseModel):
    """Full trip record returned by POST /trips and GET /trips/{id}. No manifest."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_reference: str
    order_number: str
    status: TripStatus
    trip_type: TripType
    journey_lock_hash: Optional[str] = None
    idvs_check_status: IdvsStatus
    driver: DriverRead
    horse: VehicleRead
    trailers: list[VehicleRead]
    origin_precinct_id: UUID
    destination_precinct_id: UUID
    stops: list[TripStopRead]
    consignments: list[ConsignmentRead] = []
    pulsit_trip_reference_id: Optional[str] = None
    planned_departure_at: Optional[datetime] = None
    actual_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    actual_arrival_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    # Denormalised position cache (parent D6). READ PATH ONLY — the ledger in
    # `phases` below is the truth, and the dispatcher's trip-detail view derives
    # the active phase from it. These exist so list views need not recompute.
    current_phase: Optional[str] = None
    current_stop: Optional[int] = None
    phases: list[PhaseEventRead]
    exceptions: list[TripExceptionRead]
    blockchain_receipts: list[BlockchainReceiptRead]
    # Creation-transient: populated by POST /trips (e.g. PP sync degraded-mode
    # warnings). Always [] on GET — never persisted.
    warnings: list[str] = []
    created_at: datetime
    updated_at: datetime
