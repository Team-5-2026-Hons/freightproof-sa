"""Pure, versioned wire contract for one driver-vs-truck proximity assessment
(Task 4 of the trip-location-timeline story).

`ActionLocationAssessment` is the ONE shape shared by preview (computed on demand
for a dispatcher), persistence (Task 6 writes it down), and display (both
frontends render it) — defined once here so those three call sites can never
quietly drift into three different ideas of what "an assessment" contains.

This module is deliberately pure: no DB, no HTTP, no `app.db.models` import. It
only describes the shape and its own internal consistency (aware datetimes,
finite in-range coordinates, non-negative distances/accuracy). It says nothing
about how the numbers inside it were computed — that is `orchestration.
proximity_service.evaluate_proximity` for the driver/truck separation half, and
`orchestration.geofence_service.evaluate_geofence` for the precinct-membership
half. Task 5 assembles both into an instance of this model; this file never
calls either.

No client-supplied assessment is authoritative: every field here is either
sourced from a value the server itself measured (phone/tracker fixes captured
under corroboration_service.py's timing rules) or from the server's own policy
constants at evaluation time. A dispatcher or driver client may render this
shape but must never be trusted to submit one back as fact.

Geometry-at-evaluation-time: `precinct_lat/lng/radius_metres/tolerance_metres`
capture the precinct boundary AS IT STOOD when this assessment was produced, not
a live reference to the precinct row. A precinct's geofence can be edited later;
a historical assessment that recorded no geometry (predates this contract, or
was evaluated with no resolvable stop) simply carries the current boundary as a
reference only — it is not evidence of what boundary applied at the time.
"""

import math
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

# Bumped whenever a field is added, removed, renamed, or a threshold's meaning
# changes in a way that would make an older stored assessment misleading if read
# under the new rules. Task 6 persists this string verbatim; a reader comparing
# `policy_version` across two assessments can tell whether they were evaluated
# under the same policy at all before comparing their numbers.
ACTION_LOCATION_POLICY_VERSION = "2026-09-15.1"

# The driver/truck separation verdict. 'within_limit' and 'separated' are both
# POSITIVE claims — every quality gate passed and a real distance was measured
# either at-or-under, or over, the policy threshold. 'unverified' means the
# quality gates did not all pass (see ProximityReason) — it may still carry a
# real `separation_metres` for display, but that number must never be read as a
# pass/fail verdict on its own. See orchestration/proximity_service.py.
ProximityVerdict = Literal["within_limit", "separated", "unverified"]

# Why a proximity check could not produce a positive verdict. Deliberately
# distinct from GeofenceVerdictReason (geofence_service.py) — these two modules
# answer independent questions (truck-vs-precinct vs. driver-vs-truck) and must
# never share a reason vocabulary that implies one explains the other.
ProximityReason = Literal[
    "missing_phone",
    "missing_tracker",
    "missing_time",
    "missing_accuracy",
    "poor_accuracy",
    "stale_fix",
    "time_skew",
    "future_fix",
]

_LATITUDE_FIELDS = ("driver_lat", "tracker_lat", "precinct_lat")
_LONGITUDE_FIELDS = ("driver_lng", "tracker_lng", "precinct_lng")


class DriverLocationCapture(BaseModel):
    """The raw phone reading a driver submits for a non-persistent comparison.

    This intentionally contains no verdict: preview and completion each evaluate
    the raw capture afresh, so a previous preview can never authorize completion.
    """

    model_config = ConfigDict(extra="forbid")

    driver_phone_lat: float | None
    driver_phone_lng: float | None
    driver_captured_at: datetime
    driver_accuracy_metres: float | None

    @field_validator("driver_captured_at")
    @classmethod
    def _require_aware_capture_time(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("driver_captured_at must be timezone-aware")
        return value

    @field_validator("driver_phone_lat")
    @classmethod
    def _validate_phone_latitude(cls, value: float | None) -> float | None:
        if value is not None and (not math.isfinite(value) or not (-90.0 <= value <= 90.0)):
            raise ValueError("driver_phone_lat must be a finite latitude within [-90, 90]")
        return value

    @field_validator("driver_phone_lng")
    @classmethod
    def _validate_phone_longitude(cls, value: float | None) -> float | None:
        if value is not None and (not math.isfinite(value) or not (-180.0 <= value <= 180.0)):
            raise ValueError("driver_phone_lng must be a finite longitude within [-180, 180]")
        return value

    @field_validator("driver_accuracy_metres")
    @classmethod
    def _validate_capture_accuracy(cls, value: float | None) -> float | None:
        if value is not None and (not math.isfinite(value) or value < 0):
            raise ValueError("driver_accuracy_metres must be finite and >= 0")
        return value

    @model_validator(mode="after")
    def _require_coordinate_pair(self) -> "DriverLocationCapture":
        if (self.driver_phone_lat is None) != (self.driver_phone_lng is None):
            raise ValueError("driver_phone_lat and driver_phone_lng must both be present or both be null")
        return self


class ActionLocationAssessment(BaseModel):
    """One evaluated snapshot: a driver/truck proximity verdict plus the
    precinct-membership facts evaluated alongside it (assembled by Task 5).

    `frozen=True`: an assessment is a record of what was observed at
    `evaluated_at` — mutating it after construction would let a caller silently
    rewrite history. `extra="forbid"`: a field this contract does not know about
    is a sign the wire format has drifted between backend and frontend, and
    should fail loudly rather than pass through unnoticed.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    # Schema shape version. Distinct from `policy_version`: this changes only if
    # the FIELD SET itself changes; policy_version changes when the numbers a
    # reader would use to interpret those same fields change.
    schema_version: Literal[1] = 1
    policy_version: str
    evaluated_at: datetime

    # The driver's own phone fix, and how accurate the phone claims it is.
    driver_lat: float | None
    driver_lng: float | None
    driver_captured_at: datetime | None
    driver_accuracy_metres: float | None

    # The vehicle's independent Pulsit tracker fix.
    tracker_lat: float | None
    tracker_lng: float | None
    tracker_captured_at: datetime | None

    # The proximity verdict itself (see evaluate_proximity).
    separation_metres: float | None
    proximity: ProximityVerdict
    reasons: list[ProximityReason]

    # The exact policy thresholds this assessment was evaluated against —
    # snapshotted onto the record itself so a later change to settings.py can
    # never silently reinterpret a stored assessment under different numbers.
    max_separation_metres: float
    max_age_seconds: int
    max_skew_seconds: int
    max_phone_accuracy_metres: float

    # Which stop this assessment was checked against, and the precinct-membership
    # facts for that stop at evaluation time (see module docstring on
    # geometry-at-evaluation-time). All None when the phase has no stop to check
    # against (mirrors corroboration_service._load_precinct_for_phase) or when a
    # historical record predates this contract.
    expected_trip_stop_id: UUID | None
    precinct_id: UUID | None
    precinct_lat: float | None
    precinct_lng: float | None
    precinct_radius_metres: float | None
    precinct_tolerance_metres: float | None
    driver_in_precinct: bool | None
    truck_in_precinct: bool | None

    @field_validator("evaluated_at", "driver_captured_at", "tracker_captured_at")
    @classmethod
    def _require_timezone_aware(cls, value: datetime | None) -> datetime | None:
        # A naive value would silently compare as if it were UTC everywhere this
        # assessment's timestamps are later diffed (skew, age) — see
        # proximity_service.evaluate_proximity and corroboration_service's own
        # identical rule for driver_captured_at.
        if value is not None and value.tzinfo is None:
            raise ValueError("datetime fields must be timezone-aware")
        return value

    @field_validator(*_LATITUDE_FIELDS)
    @classmethod
    def _validate_latitude(cls, value: float | None) -> float | None:
        if value is None:
            return value
        if not math.isfinite(value):
            raise ValueError("latitude must be a finite number")
        if not (-90.0 <= value <= 90.0):
            raise ValueError("latitude must be within [-90, 90]")
        return value

    @field_validator(*_LONGITUDE_FIELDS)
    @classmethod
    def _validate_longitude(cls, value: float | None) -> float | None:
        if value is None:
            return value
        if not math.isfinite(value):
            raise ValueError("longitude must be a finite number")
        if not (-180.0 <= value <= 180.0):
            raise ValueError("longitude must be within [-180, 180]")
        return value

    @field_validator("driver_accuracy_metres")
    @classmethod
    def _validate_accuracy(cls, value: float | None) -> float | None:
        if value is None:
            return value
        if not math.isfinite(value):
            raise ValueError("driver_accuracy_metres must be a finite number")
        if value < 0:
            raise ValueError("driver_accuracy_metres must be >= 0")
        return value

    @field_validator("separation_metres")
    @classmethod
    def _validate_separation(cls, value: float | None) -> float | None:
        if value is None:
            return value
        if value < 0:
            raise ValueError("separation_metres must be >= 0")
        return value


__all__ = [
    "ACTION_LOCATION_POLICY_VERSION",
    "ActionLocationAssessment",
    "DriverLocationCapture",
    "ProximityReason",
    "ProximityVerdict",
]
