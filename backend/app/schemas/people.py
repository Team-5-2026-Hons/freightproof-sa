"""Pydantic v2 schemas for User and Driver."""

from datetime import date, datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator

from app.db.models.enums import IdvsStatus


class UserBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    organization_id: UUID
    email: str
    full_name: str
    is_active: bool = True


class UserCreate(UserBase):
    # id must be supplied by the caller — it must equal the UUID Supabase Auth
    # assigned when the account was created in the Supabase dashboard.
    id: UUID


class UserUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None


class UserRead(UserBase):
    id: UUID
    created_at: datetime
    updated_at: datetime


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
    id_number validation mirrors DriverCreate to keep rules in one place.
    """
    model_config = ConfigDict(from_attributes=True)

    full_name: str
    id_number: str
    phone_number: str
    license_number: str
    license_expiry: Optional[date] = None

    @field_validator("id_number")
    @classmethod
    def validate_id_number(cls, v: str) -> str:
        if not v.isdigit() or len(v) != 13:
            raise ValueError("id_number must be exactly 13 digits (SA ID format)")
        return v


class DriverUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    license_number: Optional[str] = None
    is_active: Optional[bool] = None
    idvs_status: Optional[IdvsStatus] = None


class DriverUpdateBody(BaseModel):
    """Fields the dispatcher may change via PATCH /drivers/{id}.

    All fields are optional — only supplied fields are applied.
    POPIA: license_number is accepted here but only its SHA-256 hash goes to Hedera.
    """
    model_config = ConfigDict(from_attributes=True)

    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    license_number: Optional[str] = None
    license_expiry: Optional[date] = None
    is_active: Optional[bool] = None


class DriverRead(DriverBase):
    id: UUID
    idvs_status: IdvsStatus
    idvs_last_verified_at: Optional[datetime] = None
    license_expiry: Optional[date] = None
    created_at: datetime
    updated_at: datetime


# Imported here (not at the top of the module) to avoid a circular import:
# people.py → blockchain.py → enums.py is fine, but resource_service.py
# imports both DriverRead and BlockchainReceiptRead from their respective
# schema modules, so the dependency graph stays acyclic.
from app.schemas.blockchain import BlockchainReceiptRead  # noqa: E402
from app.schemas.events import DriverEventRead  # noqa: E402


class DriverDetailResponse(DriverRead):
    """Extended driver shape returned by GET /drivers/{id}.

    Includes the full event log, linked blockchain receipts, and the IDs of
    trips assigned to this driver.
    """

    events: list[DriverEventRead] = []
    receipts: list[BlockchainReceiptRead] = []
    trip_ids: list[UUID] = []
