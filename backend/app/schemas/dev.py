"""Pydantic v2 models for the dev trigger panel.

Response models mirror the orchestration result dataclasses rather than exposing
ORM rows, so the panel's contract is explicit and does not drift with the schema.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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


# ---------------------------------------------------------------------------
# FP-116 "move the truck" — dev-only Pulsit mock position control
# ---------------------------------------------------------------------------


class WaypointRead(BaseModel):
    """One waypoint the presenter can move the truck to.

    Served by the panel rather than hardcoded in TypeScript, so the ordered route and
    its distances have exactly one definition (core/demo_waypoints.py) and a coordinate
    corrected in Python cannot leave a stale copy on screen.
    """

    waypoint_id: str
    label: str
    sequence: int
    description: str
    # None only for the "no signal" waypoint, which is the tracker going dark rather
    # than a place — never defaulted to 0.0, which is a real coordinate.
    latitude: Optional[Decimal]
    longitude: Optional[Decimal]
    intended_distance_metres: Optional[int]
    expected_confirmed: Optional[bool]


# ---------------------------------------------------------------------------
# FP-197 (Task 3) — trip-stop-relative scenario mode, alongside the legacy
# fixed-waypoint mode above.
#
# WHY A SECOND MODE: the legacy waypoints are fixed Cape Town coordinates, generated
# once from the seeded demo depot (see demo_waypoints.py's module docstring). A trip
# whose real stops sit somewhere else entirely can still have its tracker "moved to
# the precinct" and land nowhere near where the geofence check is actually looking —
# "move the truck" and "evaluate geofence" silently talking about different places.
# Scenario mode fixes that by computing every offset FROM the trip's own chosen stop,
# so the two always agree on where "the precinct" is.
#
# Named constants rather than bare literal strings at call sites, mirroring
# demo_waypoints.py's WAYPOINT_* precedent for the legacy mode.
# ---------------------------------------------------------------------------

SCENARIO_AT_STOP = "at_stop"
SCENARIO_INSIDE_TOLERANCE = "inside_tolerance"
SCENARIO_OUTSIDE_TOLERANCE = "outside_tolerance"
SCENARIO_THREE_KM = "three_km"
SCENARIO_FIFTY_KM = "fifty_km"
SCENARIO_NO_SIGNAL = "no_signal"

# The one place this six-way enum is spelled out. `orchestration/dev_truck_service.py`
# imports the constants above from here (schemas -> orchestration is the wrong
# direction for the reverse import — orchestration already depends on schemas
# elsewhere in this codebase, e.g. trip_service.py, so this keeps that same direction).
DevTruckScenario = Literal[
    "at_stop", "inside_tolerance", "outside_tolerance", "three_km", "fifty_km", "no_signal",
]


class MoveTruckRequest(BaseModel):
    """Move one trip's horse tracker. Writes Pulsit mock state only.

    Exactly one input mode is accepted:
      - `waypoint_id` (legacy): one of the fixed Cape Town demo locations in
        demo_waypoints.py. Ignores the trip's real stops entirely.
      - `scenario` + `trip_stop_id`: stage a position computed relative to one of
        THIS trip's actual stops. `trip_stop_id` is required for every scenario
        except `no_signal` (the tracker going dark is not a coordinate, so there is
        nothing to offset from a stop; naming a stop for it is optional context).

    Both set, or neither set, is a 422 (`_validate_exactly_one_mode` below) — a
    request that could mean two things is treated the same as one that means
    nothing. Arbitrary coordinates are never accepted from the browser in either
    mode: a waypoint id and a scenario id are both closed, server-defined vocabularies.
    """

    trip_id: uuid.UUID
    waypoint_id: Optional[str] = None
    scenario: Optional[DevTruckScenario] = None
    trip_stop_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def _validate_exactly_one_mode(self) -> "MoveTruckRequest":
        has_waypoint = self.waypoint_id is not None
        has_scenario = self.scenario is not None

        if has_waypoint == has_scenario:
            # Both True (both supplied) or both False (neither supplied) — either
            # way there is no single unambiguous mode to act on.
            raise ValueError(
                "Provide exactly one of waypoint_id (a fixed demo location) or "
                "scenario (a trip-stop-relative mode) — not both, and not neither."
            )

        if has_waypoint and self.trip_stop_id is not None:
            raise ValueError(
                "trip_stop_id is only meaningful with scenario mode — waypoint_id "
                "already names a fixed location that has no trip stop behind it."
            )

        if has_scenario and self.scenario != SCENARIO_NO_SIGNAL and self.trip_stop_id is None:
            raise ValueError(
                f"scenario={self.scenario!r} requires trip_stop_id — only "
                f"{SCENARIO_NO_SIGNAL!r} may omit it, since going dark stages an "
                "absent fix rather than a coordinate offset from a stop."
            )

        return self


class MoveTruckResponse(BaseModel):
    """Where the truck now is, and what the geofence makes of it.

    Carries the measured distance and the real verdict so the panel displays actual
    state rather than restating what it just asked for. The verdict is computed by the
    same `orchestration.geofence_service.evaluate_geofence` a handshake uses — read
    only, nothing here is persisted.

    EXPECTED vs TARGET, and why both exist (FP-197 Task 3): `precinct_id`/
    `precinct_name` and the distance/verdict fields below all describe the EXPECTED
    phase stop — the trip's current stop per the phase-event ledger, exactly as
    before this change. `target_*` fields describe where scenario mode actually
    staged the tracker, which is a DIFFERENT stop unless the operator picked the
    trip's current one. Never render both distances as "from the precinct" — say
    which one is which (see DevTriggerPanel.tsx).
    """

    trip_id: uuid.UUID
    waypoint_id: str
    waypoint_label: str

    # Which tracker actually moved, echoed back so the panel can prove it addressed the
    # trip's own horse rather than a device id someone typed.
    device_id: str
    vehicle_registration: str

    # The EXPECTED precinct — the trip's current phase stop, exactly as this field has
    # always meant. Named in the response because it is not always the origin, and a
    # distance without its reference point is not a fact.
    precinct_id: uuid.UUID
    precinct_name: str

    latitude: Optional[Decimal]
    longitude: Optional[Decimal]
    has_position: bool

    # None when there is no fix to measure. Distinct from 0.0, which means the tracker
    # is sitting exactly on the precinct centre. Measured against the EXPECTED
    # precinct above, not the scenario-mode target below.
    distance_metres: Optional[float]
    geofence_radius_metres: Optional[int]
    gps_tolerance_metres: int
    # None on the no-signal waypoint/scenario: no fix means no verdict, deliberately
    # not `false`. A tracker that cannot be reached has not accused anyone.
    geofence_confirmed: Optional[bool]
    in_tolerance_band: bool
    verdict_reason: str

    # ---- FP-197 Task 3 additions, all nullable: null in legacy waypoint mode, and
    # null for target_* when scenario=no_signal names no stop. ----

    # The stop scenario mode actually staged the tracker relative to. Distinct from
    # `expected_trip_stop_id` below whenever the operator deliberately picks a stop
    # other than the trip's current one (the whole point of this mode).
    target_trip_stop_id: Optional[uuid.UUID] = None
    target_precinct_name: Optional[str] = None
    # The distance scenario mode computed and offset from `target_trip_stop_id`'s
    # precinct centre — the number the scenario buttons promise, independent of
    # whatever `distance_metres` above says about the EXPECTED stop.
    target_distance_metres: Optional[float] = None
    # Which scenario produced this response, or null in legacy waypoint mode.
    scenario: Optional[DevTruckScenario] = None

    # The stop `precinct_id`/`precinct_name`/`distance_metres` above actually describe
    # — always populated (both modes), since the EXPECTED stop is resolved every
    # request regardless of which mode moved the tracker. Restates precinct_name under
    # an unambiguous name so the panel is never forced to reuse a legacy field whose
    # name alone does not say "expected" when a target is also on screen.
    expected_trip_stop_id: Optional[uuid.UUID] = None
    expected_precinct_name: Optional[str] = None
