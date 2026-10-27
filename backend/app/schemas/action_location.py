"""Pure, versioned wire contract for one driver-vs-truck proximity assessment.

`ActionLocationAssessment` is the ONE shape shared by preview (computed on demand
for a dispatcher), persistence (written to storage), and display (both
frontends render it) — defined once here so those three call sites can never
quietly drift into three different ideas of what "an assessment" contains.

This module is deliberately pure: no DB, no HTTP, no `app.db.models` import. It
only describes the shape and its own internal consistency (aware datetimes,
finite in-range coordinates, non-negative distances/accuracy). It says nothing
about how the numbers inside it were computed — that is `orchestration.
proximity_service.evaluate_proximity` for the driver/truck separation half, and
`orchestration.geofence_service.evaluate_geofence` for the precinct-membership
half. Both are assembled into an instance of this model; this file never
calls either.

No client-supplied assessment is authoritative: every field here is either
sourced from a value the server itself measured (phone/tracker fixes captured
under corroboration_service.py's timing rules) or from the server's own policy
constants at evaluation time. A dispatcher or driver client may render this
shape but must never be trusted to submit one back as fact.

Geometry-at-evaluation-time: `precinct_lat/lng/radius_metres/geofence_polygon/tolerance_metres`
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

ACTION_LOCATION_POLICY_VERSION = "2026-10-14.1"

ProximityVerdict = Literal["within_limit", "separated", "unverified"]

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
    precinct-membership facts evaluated alongside it.

    `frozen=True`: an assessment is a record of what was observed at
    `evaluated_at` — mutating it after construction would let a caller silently
    rewrite history. `extra="forbid"`: a field this contract does not know about
    is a sign the wire format has drifted between backend and frontend, and
    should fail loudly rather than pass through unnoticed.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal[1] = 1
    policy_version: str
    evaluated_at: datetime

    driver_lat: float | None
    driver_lng: float | None
    driver_captured_at: datetime | None
    driver_accuracy_metres: float | None

    tracker_lat: float | None
    tracker_lng: float | None
    tracker_captured_at: datetime | None

    separation_metres: float | None
    proximity: ProximityVerdict
    reasons: list[ProximityReason]

    max_separation_metres: float
    max_age_seconds: int
    max_skew_seconds: int
    max_phone_accuracy_metres: float

    expected_trip_stop_id: UUID | None
    precinct_id: UUID | None
    precinct_lat: float | None
    precinct_lng: float | None
    precinct_radius_metres: float | None
    precinct_geofence_polygon: list[tuple[float, float]] | None = None
    precinct_tolerance_metres: float | None
    driver_in_precinct: bool | None
    truck_in_precinct: bool | None

    @field_validator("evaluated_at", "driver_captured_at", "tracker_captured_at")
    @classmethod
    def _require_timezone_aware(cls, value: datetime | None) -> datetime | None:
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
