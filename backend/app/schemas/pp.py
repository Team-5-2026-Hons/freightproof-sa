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
    # Populated by a FreightProof-side check (not PP) — set when this waybill is
    # already linked to another trip. See consignment_service.get_assigned_trip_reference.
    already_assigned_to_trip: Optional[str] = None


class PPCapabilities(BaseModel):
    manifest_lookup: bool
