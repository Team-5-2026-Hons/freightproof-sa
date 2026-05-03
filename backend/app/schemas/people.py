"""Pydantic v2 schemas for User and Driver."""

from datetime import datetime
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
    hashed_password: str


class UserUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None
    hashed_password: Optional[str] = None


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


class DriverUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    license_number: Optional[str] = None
    is_active: Optional[bool] = None
    idvs_status: Optional[IdvsStatus] = None


class DriverRead(DriverBase):
    id: UUID
    idvs_status: IdvsStatus
    idvs_last_verified_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
