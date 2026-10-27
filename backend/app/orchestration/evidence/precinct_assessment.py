"""The precinct half of an ActionLocationAssessment: which fence a phase is judged
against, and whether the driver's phone and the truck's tracker were inside it.

Split out of evidence.location_assessment.build_phase_assessment so that function stays under the
structure ratchet's size limit (scripts/check_structure.py); behaviour is unchanged.

Layering: orchestration → evidence.geofence → db. Imported only by action_location.
"""

import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.enums import PhaseType
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.trips import TripStop
from app.orchestration.evidence.geofence import (
    DEFAULT_GEOFENCE_RADIUS_METRES, GeofenceVerdictReason, TrackerFix, evaluate_geofence,
)


@dataclass(frozen=True)
class PhasePrecinctAssessment:
    """Field names match ActionLocationAssessment's precinct fields exactly, so the
    caller can spread this into it. Every field is None when no check was possible."""

    precinct_id: Optional[uuid.UUID] = None
    precinct_lat: Optional[float] = None
    precinct_lng: Optional[float] = None
    precinct_radius_metres: Optional[float] = None
    precinct_geofence_polygon: Optional[list[tuple[float, float]]] = None
    precinct_tolerance_metres: Optional[float] = None
    driver_in_precinct: Optional[bool] = None
    truck_in_precinct: Optional[bool] = None


async def _load_precinct_for_stop(db: AsyncSession, *, trip_stop_id: uuid.UUID) -> Optional[Precinct]:
    """The precinct a stop resolves to. Mirrors evidence.corroboration._load_precinct_
    for_phase's join exactly — deliberately not imported from there (that helper takes
    a PhaseEvent and this module also serves checkpoints, which have no trip_stop_id),
    so this owns the smaller, phase-agnostic query it actually needs.
    """
    result = await db.execute(
        select(Precinct).join(TripStop, TripStop.precinct_id == Precinct.id).where(TripStop.id == trip_stop_id)
    )
    return result.scalar_one_or_none()


def tracker_fix(lat: Optional[float], lng: Optional[float]) -> Optional[TrackerFix]:
    """A TrackerFix when both coordinates exist, else None (evaluate_geofence reads None as NO_FIX)."""
    if lat is None or lng is None:
        return None
    return TrackerFix(lat=lat, lng=lng)


async def build_phase_precinct_assessment(
    db: AsyncSession,
    *,
    event: PhaseEvent,
    driver_fix: Optional[TrackerFix],
    truck_fix: Optional[TrackerFix],
) -> PhasePrecinctAssessment:
    """Precinct membership for a phase handshake.

    Only evaluated for a phase anchored to a stop, and never for IN_TRANSIT — exactly
    `evidence.corroboration._PHASES_WITHOUT_A_GEOFENCE_VERDICT`'s own reasoning:
    IN_TRANSIT's trip_stop_id names the stop the leg DEPARTED FROM, so checking an
    arrival attestation's position against it would judge "have you arrived" against
    "where you started".
    """
    if PhaseType(event.phase_type) is PhaseType.IN_TRANSIT or event.trip_stop_id is None:
        return PhasePrecinctAssessment()

    precinct = await _load_precinct_for_stop(db, trip_stop_id=event.trip_stop_id)
    if precinct is None or precinct.latitude is None or precinct.longitude is None:
        return PhasePrecinctAssessment()

    polygon: Optional[list[tuple[float, float]]] = None
    radius: Optional[float] = None
    if precinct.geofence_polygon:
        polygon = [(float(corner[0]), float(corner[1])) for corner in precinct.geofence_polygon]
    else:
        radius = float(
            DEFAULT_GEOFENCE_RADIUS_METRES
            if precinct.geofence_radius_metres is None
            else precinct.geofence_radius_metres
        )

    driver_verdict = evaluate_geofence(driver_fix, precinct)
    truck_verdict = evaluate_geofence(truck_fix, precinct)
    return PhasePrecinctAssessment(
        precinct_id=precinct.id,
        precinct_lat=float(precinct.latitude),
        precinct_lng=float(precinct.longitude),
        precinct_radius_metres=radius,
        precinct_geofence_polygon=polygon,
        precinct_tolerance_metres=float(settings.GPS_TOLERANCE_METRES),
        driver_in_precinct=(
            driver_verdict.confirmed if driver_verdict.reason is GeofenceVerdictReason.MEASURED else None
        ),
        truck_in_precinct=(
            truck_verdict.confirmed if truck_verdict.reason is GeofenceVerdictReason.MEASURED else None
        ),
    )
