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
    # Resolved from the PP accnum at sync time; may be unknown (NULL in DB) when
    # no org matches — a creation warning, not an error, so reads must accept it.
    client_organization_id: Optional[UUID] = None
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
    # Live scan progress from Parcel rows, recomputed per request. Distinct from the
    # phase rows' parcel_count_origin / parcel_count_destination, which are stamped
    # once at phase close and never revised — those are the evidence, this is progress.
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


def validate_declared_schedule(
    planned_departure_at: Optional[datetime],
    planned_arrival_at: Optional[datetime],
) -> None:
    """Reject a declared schedule that could not have happened.

    Shared by both creation schemas rather than written twice: two copies of a rule
    are two rules, and they drift. Silent when either end is missing — a trip with no
    declared arrival has no duration to be implausible about, and planned_arrival_at
    is legitimately optional.

    Raises ValueError, which Pydantic surfaces as a 422 through the API.
    """
    if not (planned_departure_at and planned_arrival_at):
        return
    if planned_arrival_at <= planned_departure_at:
        raise ValueError("planned_arrival_at must be after planned_departure_at")

    declared = planned_arrival_at - planned_departure_at
    if declared < MINIMUM_TRIP_DURATION:
        minimum_minutes = int(MINIMUM_TRIP_DURATION.total_seconds() // 60)
        declared_minutes = declared.total_seconds() / 60
        # Name the minimum and what was given: "too short" on its own leaves the
        # dispatcher guessing at what would be accepted.
        raise ValueError(
            f"planned trip duration must be at least {minimum_minutes} minutes "
            f"(declared {declared_minutes:g})"
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
    """Lightweight trip shape returned by GET /api/v1/trips.

    Excludes handshakes and receipts. open_exception_count is computed
    by resource_service.list_trips() via a grouped COUNT query.
    """
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
    open_exception_count: int
    # The list view carries no phase plan, so it cannot derive position at all —
    # these four are the only thing that lets a row read "Unloading · stop 2 · 6/11".
    # phase_total is the plan's OWN length: 7 on a single-leg trip, 11 on a
    # cross-dock one. Nothing may assume either number.
    current_phase: Optional[str] = None
    current_stop: Optional[int] = None
    phase_total: int
    phase_completed: int
    created_at: datetime
    updated_at: datetime


class DriverTripListItemResponse(BaseModel):
    """One row of GET /api/v1/trips/me — the authenticated driver's own trip list.

    Deliberately NOT TripListItemResponse: that shape is built for the dispatcher
    board and carries driver/horse/trailers on every row, which a driver reading
    their own list already knows. It also omits precinct NAMES, which is why the
    PWA had to resolve precinct ids against mock fixtures and fell back to
    printing eight characters of a UUID on the card. Names are resolved
    server-side here so the trip card can render a real origin -> destination.

    status is the coarse TripStatus and is the ONLY thing the PWA groups its
    Active/Upcoming/Past tabs by: CREATED is an assignment the driver has not
    activated yet (Upcoming), ACTIVE/EXCEPTION_HOLD is underway (Active), and
    CLOSED/CANCELLED is history (Past). Nothing here sequences a trip — the phase
    ledger does that (see TripStatus's own docstring).
    """
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_reference: str
    order_number: str
    status: TripStatus
    trip_type: TripType
    # Optional to match the Trip model, where both precinct FKs are nullable.
    origin_precinct_id: Optional[UUID] = None
    destination_precinct_id: Optional[UUID] = None
    # Null when the trip carries no precinct id, or when the referenced precinct row
    # is gone; the PWA falls back to the id rather than rendering an empty arrow.
    origin_precinct_name: Optional[str] = None
    destination_precinct_name: Optional[str] = None
    planned_departure_at: Optional[datetime] = None
    actual_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    actual_arrival_at: Optional[datetime] = None
    open_exception_count: int
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
    # Bounded to the String(255) column it lands in — TripStopCreate is client input on
    # the trip-creation path, so an unbounded value here is a 500 from Postgres.
    notes: Optional[ShortNoteStr] = None


class TripStopCreate(TripStopBase):
    pass


class TripStopRead(TripStopBase):
    id: UUID
    trip_id: UUID
    created_at: datetime
    updated_at: datetime


class TripConsignmentInput(BaseModel):
    """One waybill on the trip. pp_reference is the PP waybill number (string[24]
    in the v28 spec); unit_count_expected is the dispatcher-entered consolidated
    unit (pallet) count — PP has no pallet grain, so this cannot be derived."""

    pp_reference: str = Field(..., min_length=1, max_length=24)
    unit_count_expected: int = Field(..., ge=1)


class TripCreateRequest(BaseModel):
    """Dispatcher-facing trip creation payload — excludes auto-generated and JWT-derived fields."""

    order_number: OrderNumberStr
    driver_id: UUID
    horse_id: UUID
    trailer_ids: list[UUID] = Field(default_factory=list)
    # Required only when `stops` is omitted (single-leg back-compat path, FP-112 A.3).
    origin_precinct_id: Optional[UUID] = None
    destination_precinct_id: Optional[UUID] = None
    # Explicit multi-stop route. When omitted, create_trip() synthesises two stops
    # from origin_precinct_id/destination_precinct_id (FP-112 A.3).
    stops: Optional[list[TripStopCreate]] = Field(default=None, min_length=2)
    template_id: Optional[UUID] = None
    planned_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    trip_type: TripType = TripType.LOADED
    # PP waybill references + dispatcher-entered unit counts. Client org is now
    # derived per-consignment from the PP accnum, not carried on the trip itself.
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
        # A trip must carry a resolvable schedule at creation, mirroring
        # phase_service._scheduled_departure's own two-source resolution exactly
        # (trip-level planned_departure_at, else the earliest-sequence stop with a
        # slot_time): _reject_if_not_due treats "no schedule at all" as PERMANENTLY
        # not-due (see its docstring), not merely not-yet-due. Since stops omitted
        # here means create_trip synthesises two stops with no slot_time of their
        # own (FP-112 A.3), planned_departure_at is the only possible source on
        # that path, so it is strictly required there. Without this check, a trip
        # could be created that no schedule can ever satisfy — a permanent,
        # silent 409 at every future activation attempt.
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
        validate_declared_schedule(self.planned_departure_at, self.planned_arrival_at)
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
    """POST /trips/{trip_id}/cancel body (task 6.1, D6). note is required — a
    dispatcher abandoning a trip mid-plan without stating why is the single most
    audit-sensitive gap this action could leave, so a blank note is a 422 here
    rather than an empty string landing on the TripException record.

    RequiredFreeText rather than a bare min_length: it also rejects a note made only of
    invisible characters, which would satisfy min_length while leaving exactly the
    unexplained gap this field exists to prevent."""

    note: RequiredFreeText


class OverridePhaseRequest(BaseModel):
    """POST /trips/{trip_id}/phases/{phase_event_id}/override body (task 6.1, D6).
    Same required-note rationale as CancelTripRequest — a dispatcher bypassing
    driver-attested evidence must state why."""

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
