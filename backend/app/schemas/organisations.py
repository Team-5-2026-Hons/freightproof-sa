"""Pydantic v2 schemas for Organization and Precinct."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.db.models.enums import OrganizationType


class OrganizationBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    org_type: OrganizationType
    contact_email: Optional[str] = None


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: Optional[str] = None
    org_type: Optional[OrganizationType] = None
    contact_email: Optional[str] = None


class OrganizationRead(OrganizationBase):
    id: UUID
    created_at: datetime


class PrecinctBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    principal_organization_id: UUID
    address: Optional[str] = None
    latitude: Decimal
    longitude: Decimal
    geofence_radius_metres: int = 200


class PrecinctCreate(PrecinctBase):
    pass


class PrecinctUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None
    geofence_radius_metres: Optional[int] = None


class PrecinctRead(PrecinctBase):
    id: UUID
    created_at: datetime
