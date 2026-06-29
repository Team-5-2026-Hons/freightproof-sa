"""Pydantic v2 schemas for TripTemplate, Consignment, Parcel, Trip, TripTrailer."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.db.models.enums import IdvsStatus, ParcelStatus, TripStatus
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.handshakes import HandshakeEventRead
from app.schemas.people import DriverRead
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
    client_organization_id: UUID
    origin_precinct_id: Optional[UUID] = None
    destination_precinct_id: Optional[UUID] = None
    declared_value: Optional[Decimal] = None
    parcel_count_expected: Optional[int] = None
    slot_time_origin: Optional[datetime] = None
    slot_time_destination: Optional[datetime] = None
    pp_raw_json: Optional[Any] = None


class ConsignmentCreate(ConsignmentBase):
    pass


class ConsignmentUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trip_id: Optional[UUID] = None
    parcel_count_expected: Optional[int] = None
    slot_time_origin: Optional[datetime] = None
    slot_time_destination: Optional[datetime] = None
    pp_raw_json: Optional[Any] = None


class ConsignmentRead(ConsignmentBase):
    id: UUID
    created_at: datetime
    updated_at: datetime


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


class TripCreate(TripBase):
    @model_validator(mode="after")
    def validate_arrival_after_departure(self) -> "TripCreate":
        if self.planned_departure_at and self.planned_arrival_at:
            if self.planned_arrival_at <= self.planned_departure_at:
                raise ValueError("planned_arrival_at must be after planned_departure_at")
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


class TripCreateRequest(BaseModel):
    """Dispatcher-facing trip creation payload — excludes auto-generated and JWT-derived fields."""

    order_number: str = Field(..., min_length=1)
    client_organization_id: UUID
    driver_id: UUID
    horse_id: UUID
    trailer_ids: list[UUID] = Field(default_factory=list, min_length=1)
    origin_precinct_id: UUID
    destination_precinct_id: UUID
    template_id: Optional[UUID] = None
    planned_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_request(self) -> "TripCreateRequest":
        if self.origin_precinct_id == self.destination_precinct_id:
            raise ValueError("origin and destination precincts must differ")
        if self.planned_departure_at and self.planned_arrival_at:
            if self.planned_arrival_at <= self.planned_departure_at:
                raise ValueError("planned_arrival_at must be after planned_departure_at")
        if len(self.trailer_ids) != len(set(self.trailer_ids)):
            raise ValueError("trailer_ids must not contain duplicates")
        return self


class DeliveryStopManifest(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    delivery_stop: str
    parcel_count: int
    parcels: list[ParcelRead]


class ManifestResponse(BaseModel):
    """Full per-parcel manifest — dispatcher only. Never sent to the driver PWA."""
    model_config = ConfigDict(from_attributes=True)

    trip_id: UUID
    consignment_id: UUID
    parcel_perfect_reference: str
    total_parcel_count: int
    origin_scan_complete: bool
    stops: list[DeliveryStopManifest]
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
    journey_lock_hash: Optional[str] = None
    idvs_check_status: IdvsStatus
    driver: DriverRead
    horse: VehicleRead
    trailers: list[VehicleRead]
    origin_precinct_id: UUID
    destination_precinct_id: UUID
    pulsit_trip_reference_id: Optional[str] = None
    planned_departure_at: Optional[datetime] = None
    actual_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    actual_arrival_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    handshakes: list[HandshakeEventRead]
    exceptions: list[TripExceptionRead]
    blockchain_receipts: list[BlockchainReceiptRead]
    created_at: datetime
    updated_at: datetime
