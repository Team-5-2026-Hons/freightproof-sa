"""Pydantic v2 schemas for User and Driver."""

from datetime import date, datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.enums import DispatcherRole, IdvsStatus
from app.schemas.text import LicenseStr, NameStr, PhoneStr

# Mirrors drivers.id_number — String(13), and always exactly 13 digits for an SA ID.
_ID_NUMBER_LENGTH = 13


class UserBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    organization_id: UUID
    email: str
    full_name: str
    is_active: bool = True


class UserCreate(UserBase):
    id: UUID  # must equal the UUID Supabase Auth assigned when the account was created


class UserUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None


class UserRead(UserBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    # Role is populated from the JWT at request time, not persisted in the DB.
    role: DispatcherRole = DispatcherRole.DISPATCHER


class DriverBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    organization_id: UUID
    full_name: str
    id_number: str
    phone_number: str
    license_number: str
    is_active: bool = True


class DriverCreate(DriverBase):
    @field_validator("id_number")
    @classmethod
    def validate_id_number(cls, v: str) -> str:
        if not v.isdigit() or len(v) != 13:
            raise ValueError("id_number must be exactly 13 digits (SA ID format)")
        return v


class DriverCreateBody(BaseModel):
    """Fields the dispatcher submits when registering a new driver.

    organization_id is injected from the dispatcher's JWT — not accepted from the client.
    Constrained types (not bare `str`) because this is client input; read shapes above
    stay unconstrained so they can echo rows that predate these rules.
    """
    model_config = ConfigDict(from_attributes=True)

    full_name: NameStr
    id_number: str
    phone_number: PhoneStr
    license_number: LicenseStr
    license_expiry: Optional[date] = None

    @field_validator("id_number")
    @classmethod
    def validate_id_number(cls, v: str) -> str:
        if not v.isdigit() or len(v) != _ID_NUMBER_LENGTH:
            raise ValueError(f"id_number must be exactly {_ID_NUMBER_LENGTH} digits (SA ID format)")
        return v


class DriverUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    license_number: Optional[str] = None
    is_active: Optional[bool] = None
    idvs_status: Optional[IdvsStatus] = None


class DriverUpdateBody(BaseModel):
    """Fields the dispatcher may change via PATCH /drivers/{id}; only supplied fields
    apply. POPIA: license_number is accepted here but only its SHA-256 hash goes to Hedera.

    Omissible is not the same as nullable, same convention as PrecinctUpdateBody
    (schemas/organisations.py). test_patch_schema_nullability_matches_the_model pins
    this against the SQLAlchemy model.
    """
    model_config = ConfigDict(from_attributes=True)

    full_name: NameStr = Field(default=None)  # type: ignore[assignment]
    phone_number: PhoneStr = Field(default=None)  # type: ignore[assignment]
    license_number: LicenseStr = Field(default=None)  # type: ignore[assignment]
    license_expiry: Optional[date] = None
    is_active: bool = Field(default=None)  # type: ignore[assignment]


class DriverRead(DriverBase):
    id: UUID
    idvs_status: IdvsStatus
    idvs_last_verified_at: Optional[datetime] = None
    license_expiry: Optional[date] = None
    created_at: datetime
    updated_at: datetime


# Imported here, not at module top, to keep the schema dependency graph acyclic.
from app.schemas.blockchain import BlockchainReceiptRead  # noqa: E402
from app.schemas.events import DriverEventRead  # noqa: E402


class DriverDetailResponse(DriverRead):
    """Extended driver shape returned by GET /drivers/{id}: event log, receipts, and
    the IDs of trips assigned to this driver."""

    events: list[DriverEventRead] = []
    receipts: list[BlockchainReceiptRead] = []
    trip_ids: list[UUID] = []
