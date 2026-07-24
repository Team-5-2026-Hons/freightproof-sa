"""Pydantic v2 schemas for the dispatcher-facing Parcel Perfect lookup endpoints."""
from typing import Optional

from pydantic import BaseModel


class PPWaybillSummary(BaseModel):
    """Wizard-time validation summary. Never the raw PP payload."""

    waybill: str
    account_number: str
    customer_name: str
    parcel_count: int
    weight_kg: Optional[float] = None
    declared_value: Optional[float] = None
    dest_town: str
    dest_person: str
    manifest_number: Optional[int] = None
    is_delivered: bool
    has_delivery_failure: bool


class PPCapabilities(BaseModel):
    manifest_lookup: bool
