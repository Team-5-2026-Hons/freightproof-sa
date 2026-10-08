"""Compatibility facade: this module now lives in app.orchestration.evidence.road_check.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the evidence.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.evidence.road_check import (
    RigReading,
    RigRole,
    RigVehicle,
    RoadCheckResult,
    RoadFinding,
    RoadStage,
    check_trip_on_road,
    evaluate_road_readings,
    load_rig,
    road_stage_for_current,
)

__all__ = [
    "RigReading",
    "RigRole",
    "RigVehicle",
    "RoadCheckResult",
    "RoadFinding",
    "RoadStage",
    "check_trip_on_road",
    "evaluate_road_readings",
    "load_rig",
    "road_stage_for_current",
]
