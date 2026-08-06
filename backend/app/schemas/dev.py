"""Pydantic v2 models for the dev trigger panel.

Response models mirror the orchestration result dataclasses rather than exposing
ORM rows, so the panel's contract is explicit and does not drift with the schema.
"""

import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.enums import ExceptionType
from app.integrations.scan_feed import ScanDirection

# A staged scan cannot exceed this many barcodes. Purely a guard against a typo in
# the panel turning into thousands of rows; no real consignment approaches it.
MAX_STAGED_BARCODES = 500


class DevTripStop(BaseModel):
    """One stop on a trip, with the consignments picked up and dropped there."""

    model_config = ConfigDict(from_attributes=True)

    trip_stop_id: uuid.UUID
    sequence: int
    precinct_name: str
    pickup_consignment_references: list[str]
    delivery_consignment_references: list[str]


class DevTripSummary(BaseModel):
    """Everything the panel needs to populate its pickers for one trip."""

    trip_id: uuid.UUID
    trip_reference: str
    status: str
    current_phase: Optional[str]
    stops: list[DevTripStop]


class ScanTriggerRequest(BaseModel):
    """Stage a warehouse scan, then ingest it through the real reconciliation path.

    Exactly one of `barcodes` or `parcel_count` must be supplied:
      - `parcel_count`: scan the first N expected barcodes (N < expected = partial).
      - `barcodes`: scan this literal list, which may include barcodes that are not
        on the manifest at all.
    """

    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection
    parcel_count: Optional[int] = Field(default=None, ge=0)
    barcodes: Optional[list[str]] = Field(default=None, max_length=MAX_STAGED_BARCODES)

    @field_validator("barcodes")
    @classmethod
    def reject_blank_barcodes(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        if v is not None and any(not b.strip() for b in v):
            raise ValueError("Barcodes must not be blank")
        return v


class ConsignmentScanResultRead(BaseModel):
    """Reconciliation outcome for one consignment, as returned to the panel."""

    consignment_id: uuid.UUID
    parcel_perfect_reference: str
    expected_count: int
    observed_count: int
    matched_barcodes: list[str]
    missing_barcodes: list[str]
    unexpected_barcodes: list[str]
    exception_ids: list[uuid.UUID]


class ScanTriggerResponse(BaseModel):
    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection
    consignments: list[ConsignmentScanResultRead]


class CloseScanSessionRequest(BaseModel):
    """Simulate the warehouse operator finishing at one stop.

    Scoped to a stop rather than a trip: a cross-dock trip has several stops, and
    closing them all at once would make the per-stop gate untestable.
    """

    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection


class CloseScanSessionResponse(BaseModel):
    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection
    # One per consignment at this stop — a stop may serve several waybills.
    sessions_closed: int


class PpTriggerRequest(BaseModel):
    """Stage a change to a mock waybill, as if someone edited it in the PP portal.

    Every field is optional; supplied fields are staged and the rest are untouched.
    `parcel_count` reproduces the verified mid-trip edit (spec §B2c) that grew a
    waybill's tracks[] from 2 to 27 barcodes.
    """

    trip_id: uuid.UUID
    parcel_perfect_reference: str
    manifest: Optional[int] = Field(default=None, ge=0)
    poddate: Optional[str] = Field(default=None, max_length=32)
    failtype: Optional[str] = Field(default=None, max_length=255)
    parcel_count: Optional[int] = Field(default=None, ge=0, le=MAX_STAGED_BARCODES)


class PpTriggerResponse(BaseModel):
    """What the consignment looks like after the real PP sync ran."""

    consignment_id: uuid.UUID
    parcel_perfect_reference: str
    parcel_count_expected: Optional[int]
    pp_manifest_number: Optional[int]
    poddate: str
    failtype: Optional[str]
    warning: Optional[str]


class ExceptionTriggerRequest(BaseModel):
    """Raise an exception through the real exception service."""

    trip_id: uuid.UUID
    exception_type: ExceptionType
    description: str = Field(min_length=1, max_length=1000)


class ExceptionTriggerResponse(BaseModel):
    exception_id: uuid.UUID
    trip_id: uuid.UUID
    exception_type: ExceptionType
    severity: str
    description: str


class FlushMockStateResponse(BaseModel):
    """Result of clearing staged mock state. Evidence in Postgres is untouched."""

    keys_deleted: int
