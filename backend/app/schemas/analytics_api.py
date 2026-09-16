"""Dispatcher analytics response models (FP-156); subclass the frozen FP-153 result
models from analytics.py and add display names.

A name is None when no matching row is found; the metrics row is still returned,
since dropping it would silently change the totals a dispatcher is reading.
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
    vehicle_type: VehicleType | None  # horses and trailers share this list


class VehicleStreakResponse(VehicleStreak):
    """Whole-history streaks plus the live count of trips since the last incident."""

    trips_since_last_incident: int


class LaneMetricsResponse(LaneMetrics):
    """One origin -> destination lane, with both precinct names."""

    origin_precinct_name: str | None
    destination_precinct_name: str | None


class FacilityMetricsResponse(FacilityMetrics):
    """Pulsit corroboration at one precinct, with the precinct's name."""

    precinct_name: str | None
