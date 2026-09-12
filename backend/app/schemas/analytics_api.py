"""Response models for the FP-156 dispatcher analytics endpoints.

Each model subclasses a frozen FP-153 result model from app/schemas/analytics.py and adds
only the display names the screen needs. Subclassing, rather than wrapping, has two
effects:
  - every computed rate is inherited, so it is still derived from the counts shipped
    beside it and can never disagree with them;
  - the JSON stays flat, so each table column is one top-level key.

The fields and rates of app/schemas/analytics.py are never changed here — they are
FP-153's contract.

A name is None when no row is found for its id, for example a driver record belonging to
another organisation. The metrics row is still returned: dropping it would silently
change the totals a dispatcher is reading.
"""

from app.db.models.enums import VehicleType
from app.schemas.analytics import (
    DriverMetrics,
    FacilityMetrics,
    LaneMetrics,
    VehicleMetrics,
    VehicleStreak,
)


class DriverMetricsResponse(DriverMetrics):
    """One driver's closed-trip trends, with the driver's display name."""

    driver_name: str | None


class VehicleMetricsResponse(VehicleMetrics):
    """One vehicle's closed-trip numbers, horse or trailer, with its registration and type."""

    registration: str | None
    # Horses and trailers come back in one list, so each row says which it is. None when
    # the vehicle row isn't found, the same as registration.
    vehicle_type: VehicleType | None


class VehicleStreakResponse(VehicleStreak):
    """Whole-history streaks plus the live count of trips since the last incident.

    Carries the count so the screen needs one request for the whole table, not one per
    row. No registration: the screen shows streaks beside the monthly vehicle rows,
    joined by vehicle_id, and those rows already carry it.
    """

    trips_since_last_incident: int


class LaneMetricsResponse(LaneMetrics):
    """One origin -> destination lane, with both precinct names."""

    origin_precinct_name: str | None
    destination_precinct_name: str | None


class FacilityMetricsResponse(FacilityMetrics):
    """Pulsit corroboration at one precinct, with the precinct's name."""

    precinct_name: str | None
