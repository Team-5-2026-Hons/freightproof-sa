"""Compatibility facade: the dispatcher analytics coordinator now lives in app.orchestration.analytics.metrics.

New code imports from the module that owns the name; tests must patch the module that looks a
name up, never this one (check B8).
"""

from app.orchestration.analytics.metrics import (
    VehicleLabel,
    attach_driver_names,
    attach_facility_names,
    attach_lane_names,
    attach_vehicle_registrations,
    check_month_range,
    list_driver_analytics,
    list_facility_analytics,
    list_lane_analytics,
    list_vehicle_analytics,
    list_vehicle_streaks,
)

__all__ = [
    "VehicleLabel",
    "attach_driver_names",
    "attach_facility_names",
    "attach_lane_names",
    "attach_vehicle_registrations",
    "check_month_range",
    "list_driver_analytics",
    "list_facility_analytics",
    "list_lane_analytics",
    "list_vehicle_analytics",
    "list_vehicle_streaks",
]
