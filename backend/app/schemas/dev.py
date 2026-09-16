"""Pydantic v2 models for the dev trigger panel.

Response models mirror the orchestration result dataclasses rather than exposing
ORM rows, so the panel's contract is explicit and does not drift with the schema.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.enums import ExceptionType, PhaseStatus
from app.integrations.scan_feed import ScanDirection

# Guard against a typo in the panel turning into thousands of rows.
MAX_STAGED_BARCODES = 500

# Mirrors phase_service._is_resolved's "already decided" (restated, not imported, since
# that predicate is private). A phase in one of these statuses won't change its mind.
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
    # Status of the phase gating each scan direction at this stop; None = no such phase
    # event. See CLOSED_PHASE_STATUSES for "already decided".
    loading_phase_status: Optional[str] = None
    confirmation_phase_status: Optional[str] = None
    # Status of the DEPARTURE phase for the leg ending here; None if this is the origin.
    preceding_departure_status: Optional[str] = None


class DevTripSummary(BaseModel):
    """Everything the panel needs to populate its pickers for one trip."""

    trip_id: uuid.UUID
    trip_reference: str
    status: str
    current_phase: Optional[str]
    stops: list[DevTripStop]
    driver_full_name: Optional[str] = None  # Optional so a join miss blanks, not 500s
    created_at: datetime


class ScanTriggerRequest(BaseModel):
    """Stage a warehouse scan, then ingest it through the real reconciliation path.

    Precedence, most specific first:
      - `barcodes_by_reference`: exact barcodes per named waybill. A waybill absent from
        the map stages an EMPTY scan for it ("never scanned"), not a full one.
      - `barcodes`: this literal list for every consignment at the stop, which may
        include barcodes not on the manifest.
      - `parcel_count`: first N expected barcodes (N < expected = partial).
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
        # max_length on `barcodes` only guards that flat list; this map's total is enforced here.
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
    """Simulate the warehouse operator finishing at one stop (not the whole trip, so the
    per-stop gate stays testable on a cross-dock trip)."""

    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection


class CloseScanSessionResponse(BaseModel):
    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection
    sessions_closed: int  # one per consignment at this stop


class PpTriggerRequest(BaseModel):
    """Stage a change to a mock waybill, as if someone edited it in the PP portal.

    Every field is optional; supplied fields are staged, the rest untouched.
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


# FP-116 "move the truck" — dev-only Pulsit mock position control


class WaypointRead(BaseModel):
    """One waypoint the presenter can move the truck to; single source of truth is
    core/demo_waypoints.py, not a TypeScript copy."""

    waypoint_id: str
    label: str
    sequence: int
    description: str
    latitude: Optional[Decimal]  # None only for the "no signal" waypoint, never 0.0
    longitude: Optional[Decimal]
    intended_distance_metres: Optional[int]
    expected_confirmed: Optional[bool]


class MoveTruckRequest(BaseModel):
    """Move one trip's horse tracker to a waypoint. Writes Pulsit mock state only."""

    trip_id: uuid.UUID
    waypoint_id: str


class MoveTruckResponse(BaseModel):
    """Where the truck now is, and what the geofence makes of it.

    Verdict computed by the same `evaluate_geofence` a handshake uses — read only,
    nothing here is persisted.
    """

    trip_id: uuid.UUID
    waypoint_id: str
    waypoint_label: str

    device_id: str  # tracker that actually moved, echoed back to prove it's this trip's horse
    vehicle_registration: str

    precinct_id: uuid.UUID  # what the distance below is measured FROM (not always the origin)
    precinct_name: str

    latitude: Optional[Decimal]
    longitude: Optional[Decimal]
    has_position: bool

    distance_metres: Optional[float]  # None when no fix; distinct from 0.0 (on centre)
    geofence_radius_metres: Optional[int]
    gps_tolerance_metres: int
    geofence_confirmed: Optional[bool]  # None on no-signal, deliberately not False
    in_tolerance_band: bool
    verdict_reason: str
