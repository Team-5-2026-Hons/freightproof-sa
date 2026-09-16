"""Pydantic v2 schemas for Vehicle (horse and trailer)."""

from datetime import date, datetime
from typing import Annotated, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.db.models.enums import VehicleType

# Mirrors DB column widths (app/db/models/vehicles.py) so over-length input is a 422, not a 500.
_REGISTRATION_MAX_LENGTH = 50
_PULSIT_DEVICE_ID_MAX_LENGTH = 100
_MAKE_MODEL_MAX_LENGTH = 100

# VIN is always exactly 17 chars. Per explicit product decision, any alphanumeric
# 17-char string is accepted — no ISO 3779 I/O/Q exclusion is enforced.
_VIN_PATTERN = r"^[A-Za-z0-9]{17}$"

_MIN_YEAR = 1900

RegistrationStr = Annotated[
    str, StringConstraints(min_length=1, max_length=_REGISTRATION_MAX_LENGTH)
]
PulsitDeviceIdStr = Annotated[
    str, StringConstraints(min_length=1, max_length=_PULSIT_DEVICE_ID_MAX_LENGTH)
]
VinNumberStr = Annotated[str, StringConstraints(pattern=_VIN_PATTERN)]
MakeModelStr = Annotated[str, StringConstraints(max_length=_MAKE_MODEL_MAX_LENGTH)]


def _validate_year(value: Optional[int]) -> Optional[int]:
    """Year must be plausible; ceiling computed at validation time, not a static constant,
    so the schema doesn't need a yearly update."""
    if value is None:
        return value
    max_year = datetime.now().year + 1
    if not (_MIN_YEAR <= value <= max_year):
        raise ValueError(f"year must be between {_MIN_YEAR} and {max_year}")
    return value


class VehicleBase(BaseModel):
    # Shared by the read schemas; deliberately unconstrained types so legacy rows
    # (e.g. a sub-17-char VIN) don't get rejected on read.
    model_config = ConfigDict(from_attributes=True)

    organization_id: UUID
    registration: str
    vehicle_type: VehicleType
    pulsit_device_id: str
    is_active: bool = True
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    vin_number: Optional[str] = None
    licence_disc_expiry: Optional[date] = None
    gross_vehicle_mass_kg: Optional[int] = None
    length_m: Optional[int] = None


class VehicleCreate(VehicleBase):
    pass


class VehicleCreateBody(BaseModel):
    """Fields the dispatcher submits when registering a new vehicle.

    organization_id is injected from the dispatcher's JWT — not accepted from the client.
    """
    model_config = ConfigDict(from_attributes=True)

    registration: RegistrationStr
    vehicle_type: VehicleType
    pulsit_device_id: PulsitDeviceIdStr
    make: Optional[MakeModelStr] = None
    model: Optional[MakeModelStr] = None
    year: Optional[int] = None
    vin_number: Optional[VinNumberStr] = None
    licence_disc_expiry: Optional[date] = None
    gross_vehicle_mass_kg: Optional[int] = Field(default=None, gt=0)
    length_m: Optional[int] = None

    @field_validator("year")
    @classmethod
    def _check_year(cls, value: Optional[int]) -> Optional[int]:
        return _validate_year(value)


class VehicleUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    registration: Optional[str] = None
    pulsit_device_id: Optional[str] = None
    is_active: Optional[bool] = None


class VehicleUpdateBody(BaseModel):
    """Fields the dispatcher may change via PATCH /vehicles/{id}; only supplied fields
    apply. vehicle_type is excluded: changing horse<->trailer would silently break trip logic.

    Omissible is not the same as nullable, same convention as PrecinctUpdateBody
    (schemas/organisations.py): `Optional[X]` accepts an explicit null, a bare
    `X = Field(default=None)` is omissible but NOT NULL and must not be nulled.
    test_patch_schema_nullability_matches_the_model pins this against the SQLAlchemy model.
    """
    model_config = ConfigDict(from_attributes=True)

    registration: RegistrationStr = Field(default=None)  # type: ignore[assignment]
    pulsit_device_id: PulsitDeviceIdStr = Field(default=None)  # type: ignore[assignment]
    vin_number: Optional[VinNumberStr] = None
    licence_disc_expiry: Optional[date] = None
    make: Optional[MakeModelStr] = None
    model: Optional[MakeModelStr] = None
    year: Optional[int] = None
    gross_vehicle_mass_kg: Optional[int] = Field(default=None, gt=0)
    length_m: Optional[int] = None
    is_active: bool = Field(default=None)  # type: ignore[assignment]

    @field_validator("year")
    @classmethod
    def _check_year(cls, value: Optional[int]) -> Optional[int]:
        return _validate_year(value)


class VehicleRead(VehicleBase):
    id: UUID
    created_at: datetime


# Imported here, not at module top, to keep the schema dependency graph acyclic.
from app.schemas.blockchain import BlockchainReceiptRead  # noqa: E402
from app.schemas.events import VehicleEventRead  # noqa: E402


class VehicleDetailResponse(VehicleRead):
    """Extended vehicle shape returned by GET /vehicles/{id}: event log, receipts, and
    the IDs of trips that used this vehicle (as horse or trailer)."""

    events: list[VehicleEventRead] = []
    receipts: list[BlockchainReceiptRead] = []
    trip_ids: list[UUID] = []
