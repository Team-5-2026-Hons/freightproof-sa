"""Pydantic v2 models for the dev trigger panel.

Response models mirror the orchestration result dataclasses rather than exposing
ORM rows, so the panel's contract is explicit and does not drift with the schema.
"""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.enums import ExceptionType, PhaseStatus
from app.integrations.scan_feed import ScanDirection

# A staged scan cannot exceed this many barcodes. Purely a guard against a typo in
# the panel turning into thousands of rows; no real consignment approaches it.
MAX_STAGED_BARCODES = 500

# Mirrors phase_service._is_resolved's definition of "already decided" — stated
# again here (not imported) because that predicate is private to phase_service,
# which this slice is explicitly scoped to leave untouched. A phase in one of
# these statuses is not going to change its mind about a scan; the panel uses
# this to know when triggering a scan for that phase no longer makes sense.
CLOSED_PHASE_STATUSES: frozenset[str] = frozenset({
    PhaseStatus.COMPLETED.value, PhaseStatus.EXCEPTION.value, PhaseStatus.OVERRIDDEN.value,
})


class DevConsignment(BaseModel):
    """One waybill at a stop, with the real parcel barcodes under it."""

    model_config = ConfigDict(from_attributes=True)

    consignment_id: uuid.UUID
    parcel_perfect_reference: str
    barcodes: list[str]


class DevTripStop(BaseModel):
    """One stop on a trip, with the consignments picked up and dropped there."""

    model_config = ConfigDict(from_attributes=True)

    trip_stop_id: uuid.UUID
    sequence: int
    precinct_name: str
    pickup_consignments: list[DevConsignment]
    delivery_consignments: list[DevConsignment]
    # Status of the phase event gating each scan direction AT THIS STOP, so the panel
    # can refuse a scan that no longer makes sense. None = no such phase event.
    # See CLOSED_PHASE_STATUSES for which values mean "already decided".
    loading_phase_status: Optional[str] = None
    confirmation_phase_status: Optional[str] = None
    # Status of the DEPARTURE phase for the leg that ends at this stop — the truck
    # physically leaving the origin is the precondition for any destination scan.
    # None when no departure precedes this stop (i.e. it is the origin).
    preceding_departure_status: Optional[str] = None


class DevTripSummary(BaseModel):
    """Everything the panel needs to populate its pickers for one trip."""

    trip_id: uuid.UUID
    trip_reference: str
    status: str
    current_phase: Optional[str]
    stops: list[DevTripStop]
    # Trip.driver_id/Driver.full_name are both non-nullable, but this stays Optional
    # so a join miss degrades to a blank label in the panel rather than a 500 mid-demo.
    driver_full_name: Optional[str] = None
    created_at: datetime


class ScanTriggerRequest(BaseModel):
    """Stage a warehouse scan, then ingest it through the real reconciliation path.

    Precedence, most specific first:
      - `barcodes_by_reference`: scan exactly the listed barcodes for each named
        waybill (parcel_perfect_reference -> barcodes). A waybill absent from the
        map stages an EMPTY scan for it, not a full one — that is how a demo
        expresses "this waybill was never scanned". MockScanFeed.stage_scans
        REPLACES prior staging rather than appending (see its docstring), so a
        caller wanting "everything plus one stranger barcode" must send the full
        list for that waybill; there is no additive mode. Per-waybill selection is
        what lets the panel build that list correctly across several waybills at
        one stop in a single trigger.
      - `barcodes`: scan this literal list for every consignment at the stop,
        which may include barcodes that are not on the manifest at all.
      - `parcel_count`: scan the first N expected barcodes (N < expected = partial).
      - none of the above: scan everything expected.
    """

    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection
    parcel_count: Optional[int] = Field(default=None, ge=0)
    barcodes: Optional[list[str]] = Field(default=None, max_length=MAX_STAGED_BARCODES)
    barcodes_by_reference: Optional[dict[str, list[str]]] = Field(default=None)

    @field_validator("barcodes", "barcodes_by_reference")
    @classmethod
    def reject_blank_barcodes(
        cls, v: Optional[list[str]] | Optional[dict[str, list[str]]],
    ) -> Optional[list[str]] | Optional[dict[str, list[str]]]:
        if v is None:
            return v
        barcode_lists = v.values() if isinstance(v, dict) else [v]
        if any(not barcode.strip() for barcodes in barcode_lists for barcode in barcodes):
            raise ValueError("Barcodes must not be blank")
        return v

    @field_validator("barcodes_by_reference")
    @classmethod
    def reject_oversized_map(
        cls, v: Optional[dict[str, list[str]]],
    ) -> Optional[dict[str, list[str]]]:
        # max_length on the `barcodes` field only guards that flat list — this map
        # has no single field-level cap, so the total across all its lists is
        # enforced here instead.
        if v is not None and sum(len(barcodes) for barcodes in v.values()) > MAX_STAGED_BARCODES:
            raise ValueError(f"Total staged barcodes must not exceed {MAX_STAGED_BARCODES}")
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
