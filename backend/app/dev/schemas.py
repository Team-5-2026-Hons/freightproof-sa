"""Pydantic v2 models for the dev trigger panel.

Response models mirror the orchestration result dataclasses rather than exposing
ORM rows, so the panel's contract is explicit and does not drift with the schema.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Final, Literal, Optional

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.models.enums import ExceptionType, PhaseStatus
from app.integrations.scan_feed import ScanDirection

MAX_STAGED_BARCODES = 500

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
    loading_phase_status: Optional[str] = None
    confirmation_phase_status: Optional[str] = None
    preceding_departure_status: Optional[str] = None
    arrival_phase_status: Optional[str] = None
    unloading_phase_status: Optional[str] = None


class DevVehicle(BaseModel):
    """One vehicle on the trip, so the panel can offer a per-trailer scenario."""

    vehicle_id: uuid.UUID
    registration: str
    role: Literal["horse", "trailer"]


class DevTripSummary(BaseModel):
    """Everything the panel needs to populate its pickers for one trip."""

    trip_id: uuid.UUID
    trip_reference: str
    status: str
    current_phase: Optional[str]
    stops: list[DevTripStop]
    driver_full_name: Optional[str] = None
    created_at: datetime
    current_stop_sequence: Optional[int] = None
    vehicles: list[DevVehicle] = []


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
    sessions_closed: int


class PpTriggerRequest(BaseModel):
    """Stage a change to a mock waybill, as if someone edited it in the PP portal.

    Every field is optional; supplied fields are staged and the rest are untouched.
    `parcel_count` reproduces the verified mid-trip edit that grew a
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
    latitude: Optional[Decimal]
    longitude: Optional[Decimal]
    intended_distance_metres: Optional[int]
    expected_confirmed: Optional[bool]


SCENARIO_AT_STOP: Final = "at_stop"
SCENARIO_INSIDE_TOLERANCE: Final = "inside_tolerance"
SCENARIO_OUTSIDE_TOLERANCE: Final = "outside_tolerance"
SCENARIO_THREE_KM: Final = "three_km"
SCENARIO_FIFTY_KM: Final = "fifty_km"
SCENARIO_NO_SIGNAL: Final = "no_signal"

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

    EXPECTED vs TARGET, and why both exist (FP-197): `precinct_id`/
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

    device_id: str
    vehicle_registration: str

    precinct_id: uuid.UUID
    precinct_name: str

    latitude: Optional[Decimal]
    longitude: Optional[Decimal]
    has_position: bool

    distance_metres: Optional[float]
    geofence_radius_metres: Optional[int]
    gps_tolerance_metres: int
    geofence_confirmed: Optional[bool]
    in_tolerance_band: bool
    verdict_reason: str

    target_trip_stop_id: Optional[uuid.UUID] = None
    target_precinct_name: Optional[str] = None
    target_distance_metres: Optional[float] = None
    scenario: Optional[DevTruckScenario] = None

    expected_trip_stop_id: Optional[uuid.UUID] = None
    expected_precinct_name: Optional[str] = None


RigScenario = Literal[
    "at_stop", "away_from_stop", "en_route", "left_before_departure", "trailer_uncoupled", "silent",
]
_NEEDS_STOP: frozenset[str] = frozenset({"at_stop", "away_from_stop"})
_NEEDS_VEHICLE: frozenset[str] = frozenset({"trailer_uncoupled", "silent"})


class RigScenarioRequest(BaseModel):
    """Stage every tracker on a trip for one named scenario, then run the road check."""

    model_config = ConfigDict(extra="forbid")

    trip_id: uuid.UUID
    scenario: RigScenario
    trip_stop_id: Optional[uuid.UUID] = None
    vehicle_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def _required_context(self) -> "RigScenarioRequest":
        if self.scenario in _NEEDS_STOP and self.trip_stop_id is None:
            raise ValueError(f"trip_stop_id is required for {self.scenario}")
        if self.scenario in _NEEDS_VEHICLE and self.vehicle_id is None:
            raise ValueError(f"vehicle_id is required for {self.scenario}")
        return self


class RoadCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trip_id: uuid.UUID


class RigReadingRead(BaseModel):
    vehicle_id: uuid.UUID
    registration: str
    role: Literal["horse", "trailer"]
    status: str
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None


class RoadFindingRead(BaseModel):
    exception_type: ExceptionType
    severity: str
    vehicle_id: uuid.UUID
    description: str
    newly_recorded: bool


class RoadCheckResponse(BaseModel):
    trip_id: uuid.UUID
    readings: list[RigReadingRead]
    findings: list[RoadFindingRead]
    skipped_reason: Optional[str] = None


class RigScenarioResponse(RoadCheckResponse):
    scenario: RigScenario
    label: str


class PpManifestTriggerRequest(BaseModel):
    """Stage a change to a mock PP manifest header, as if the client edited it in PP.

    Supplied fields are staged; the rest are untouched. Waybills move between manifests
    through POST /dev/pp/waybill (each waybill's own `manifest` field)."""

    manifest_number: int = Field(..., gt=0)
    closed: Optional[bool] = None
    planned_departure_at: Optional[AwareDatetime] = None
    expected_arrival_at: Optional[AwareDatetime] = None


class PpManifestTriggerResponse(BaseModel):
    """The manifest's new snapshot hash — a preview made before this call is now stale."""

    manifest_number: int
    snapshot_sha256: str


PHONE_AT_ORIGIN = "at_origin"
PHONE_AT_DESTINATION = "at_destination"
PHONE_AT_STOP = "at_stop"
PHONE_RELEASE = "release"

DevPhonePlacement = Literal["at_origin", "at_destination", "at_stop", "release"]

PHONE_PLACEMENT_LABELS: dict[str, str] = {
    PHONE_AT_ORIGIN: "Phone at origin",
    PHONE_AT_DESTINATION: "Phone at destination",
    PHONE_AT_STOP: "Phone at this stop",
    PHONE_RELEASE: "Use the phone's real location",
}


class MovePhoneRequest(BaseModel):
    """Place one trip's DRIVER PHONE position, or hand it back to the real device.

    Deliberately independent of move-truck (Tim, 22 Oct 2026): the two are separate
    controls on the panel, so a demo can put the phone at a precinct while the tracker
    sits elsewhere — which is also what makes a genuine phone/tracker divergence
    (FP-145 GPS_MISMATCH) still stageable.

    `at_stop` is the cross-dock case and is the only placement that needs
    `trip_stop_id`; origin and destination resolve to the trip's first and last stop.
    `release` drops any staged position, after which the handset's own fix is recorded
    again — which is also the state of every trip that was never staged.
    """

    trip_id: uuid.UUID
    placement: DevPhonePlacement
    trip_stop_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def _stop_required_for_at_stop(self) -> "MovePhoneRequest":
        if self.placement == PHONE_AT_STOP and self.trip_stop_id is None:
            raise ValueError("placement 'at_stop' requires trip_stop_id.")
        return self


class MovePhoneResponse(BaseModel):
    """Where this trip's phone will now report from, and what it is measured against.

    `staged` is false only for `release`. The coordinates are the precinct centre the
    phone was placed at — the same geometry move-truck's `at_stop` scenario uses, so a
    phone and a truck placed at the same stop agree exactly rather than approximately.
    """

    trip_id: uuid.UUID
    placement: DevPhonePlacement
    placement_label: str
    staged: bool
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None
    trip_stop_id: Optional[uuid.UUID] = None
    precinct_name: Optional[str] = None
    recorded_as: str = "simulated"
