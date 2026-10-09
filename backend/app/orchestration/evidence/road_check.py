"""On-road tracker check — records road incidents the stop-phase checks cannot see.

Stop phases read the trackers only when the driver completes a phase at a precinct, so
between stops nothing looked: a trailer uncoupled on the N1 stayed invisible until
arrival. This module reads the horse and every trailer once, on demand, and records
SYSTEM exceptions for three findings.

Two halves. evaluate_road_readings is pure: no I/O, exhaustively unit-tested.
check_trip_on_road loads state, calls it, and writes each finding at most once.

Recording, not responding: nothing here advances a phase, holds a trip or contacts
anyone. NULL never raises a verdict: a missing reading is its own finding
(TRACKER_SILENT) or nothing, never a pass or a fail of another rule.

Called by the dev tracker endpoint today. A scheduler would call check_trip_on_road
unchanged once live Pulsit credentials exist.
"""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.geo import format_distance, haversine_metres
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    PhaseType,
    TripStatus,
)
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.integrations.pulsit import PulsitFixStatus, get_pulsit_client
from app.orchestration.review_policy import initial_review_status
from app.orchestration.evidence.geofence import TrackerFix, evaluate_geofence
from app.orchestration.phases.queries import current_phase_event

logger = logging.getLogger(__name__)


class RigRole(str, Enum):
    HORSE = "horse"
    TRAILER = "trailer"


@dataclass(frozen=True)
class RigReading:
    """One tracker read for one vehicle on the trip."""

    vehicle_id: uuid.UUID
    registration: str
    role: RigRole
    status: PulsitFixStatus
    lat: Decimal | None
    lng: Decimal | None


@dataclass(frozen=True)
class RoadStage:
    """Where the trip is, reduced to what the three rules need.

    on_road: the current phase is an in-transit leg (current_phase_event_id is that leg).
    pending_departure_id / stop_precinct: set only when the truck is at a stop whose
    departure is still ahead — the one situation in which leaving the fence is a finding.
    """

    current_phase_event_id: uuid.UUID
    trip_stop_id: uuid.UUID | None
    on_road: bool
    pending_departure_id: uuid.UUID | None
    stop_precinct: Precinct | None


@dataclass(frozen=True)
class RoadFinding:
    exception_type: ExceptionType
    severity: ExceptionSeverity
    phase_event_id: uuid.UUID
    trip_stop_id: uuid.UUID | None
    vehicle_id: uuid.UUID
    description: str
    lat: Decimal | None
    lng: Decimal | None


def _position(reading: RigReading) -> tuple[Decimal, Decimal] | None:
    # Explicit None checks rather than a property, so mypy can narrow the Decimals.
    if reading.status is not PulsitFixStatus.OK or reading.lat is None or reading.lng is None:
        return None
    return reading.lat, reading.lng


def evaluate_road_readings(
    *,
    stage: RoadStage,
    readings: Sequence[RigReading],
    max_separation_metres: float,
) -> list[RoadFinding]:
    """Every finding these readings support at this stage. Pure; never raises."""
    findings: list[RoadFinding] = []

    for reading in readings:
        # NO_FIX only: a known tracker that went dark. UNKNOWN_DEVICE means it was never
        # configured or staged — raising on it would flag every untouched trailer.
        if reading.status is PulsitFixStatus.NO_FIX:
            findings.append(RoadFinding(
                exception_type=ExceptionType.TRACKER_SILENT,
                severity=ExceptionSeverity.WARNING,
                phase_event_id=stage.current_phase_event_id,
                trip_stop_id=stage.trip_stop_id,
                vehicle_id=reading.vehicle_id,
                description=f"The tracker on {reading.role.value} {reading.registration} returned no position.",
                lat=None, lng=None,
            ))

    horse = next((r for r in readings if r.role is RigRole.HORSE), None)
    horse_position = _position(horse) if horse is not None else None
    if horse is None or horse_position is None:
        # Both remaining rules measure against the horse. Without its fix there is
        # nothing to compare, and "could not check" must not read as a verdict.
        return findings

    if stage.on_road:
        for trailer in readings:
            trailer_position = _position(trailer)
            if trailer.role is not RigRole.TRAILER or trailer_position is None:
                continue
            separation = haversine_metres(*trailer_position, *horse_position)
            if separation > max_separation_metres:
                findings.append(RoadFinding(
                    exception_type=ExceptionType.TRAILER_SEPARATED_IN_TRANSIT,
                    severity=ExceptionSeverity.CRITICAL,
                    phase_event_id=stage.current_phase_event_id,
                    trip_stop_id=stage.trip_stop_id,
                    vehicle_id=trailer.vehicle_id,
                    # Registrations identify vehicles, not people, so they may be named.
                    description=(
                        f"On the road, trailer {trailer.registration} is "
                        f"{format_distance(separation)} from horse {horse.registration}. "
                        f"The trailer may have been uncoupled."
                    ),
                    lat=trailer_position[0], lng=trailer_position[1],
                ))
    elif stage.pending_departure_id is not None and stage.stop_precinct is not None:
        verdict = evaluate_geofence(
            TrackerFix(lat=horse_position[0], lng=horse_position[1]), stage.stop_precinct,
        )
        # distance_metres is None when nothing was measured; only a measured "outside" counts.
        if not verdict.confirmed and verdict.distance_metres is not None:
            findings.append(RoadFinding(
                exception_type=ExceptionType.MOVED_BEFORE_DEPARTURE,
                severity=ExceptionSeverity.CRITICAL,
                phase_event_id=stage.pending_departure_id,
                trip_stop_id=stage.trip_stop_id,
                vehicle_id=horse.vehicle_id,
                description=(
                    f"Horse {horse.registration} is {format_distance(verdict.distance_metres)} "
                    f"from {stage.stop_precinct.name}, but departure has not been recorded. "
                    f"The truck moved without a recorded seal."
                ),
                lat=horse_position[0], lng=horse_position[1],
            ))

    return findings


# ---------------------------------------------------------------------------
# Writer: load the rig, read the trackers, record each finding once
# ---------------------------------------------------------------------------

# A finished trip has no road left to watch.
_SKIPPED_STATUSES = frozenset({TripStatus.CLOSED, TripStatus.CANCELLED})


@dataclass(frozen=True)
class RigVehicle:
    vehicle_id: uuid.UUID
    registration: str
    role: RigRole
    device_id: str


@dataclass(frozen=True)
class RoadCheckResult:
    readings: list[RigReading]
    recorded: list[RoadFinding]
    already_recorded: list[RoadFinding]
    skipped_reason: str | None


async def load_rig(db: AsyncSession, *, trip: Trip) -> list[RigVehicle]:
    """The horse, then each trailer by registration.

    Trailer device ids come from TripTrailer.pulsit_device_id_snapshot, as in
    evidence.corroboration: the tracker that was on the trailer when the trip was
    committed, not whatever the vehicle row says now.
    """
    horse = (await db.execute(select(Vehicle).where(Vehicle.id == trip.horse_id))).scalar_one()
    trailer_rows = (await db.execute(
        select(Vehicle, TripTrailer.pulsit_device_id_snapshot)
        .join(TripTrailer, TripTrailer.trailer_id == Vehicle.id)
        .where(TripTrailer.trip_id == trip.id)
        .order_by(Vehicle.registration)
    )).all()
    return [
        RigVehicle(horse.id, horse.registration, RigRole.HORSE, horse.pulsit_device_id),
        *(RigVehicle(v.id, v.registration, RigRole.TRAILER, device) for v, device in trailer_rows),
    ]


async def road_stage_for_current(db: AsyncSession, *, current: PhaseEvent) -> RoadStage:
    """Use the same pending-departure rule for checks and dev scenario staging."""
    if current.phase_type == PhaseType.IN_TRANSIT:
        return RoadStage(current.id, current.trip_stop_id, True, None, None)
    if current.trip_stop_id is None:
        # trip_creation: no stop, so no fence to have left.
        return RoadStage(current.id, None, False, None, None)
    next_departure = (await db.execute(
        select(PhaseEvent)
        .where(
            PhaseEvent.trip_id == current.trip_id,
            PhaseEvent.phase_type == PhaseType.DEPARTURE,
            PhaseEvent.sequence_number >= current.sequence_number,
        )
        .order_by(PhaseEvent.sequence_number)
        .limit(1)
    )).scalar_one_or_none()
    # Only a departure from THIS stop makes leaving the fence a finding. At the final
    # stop there is no departure ahead; the truck may leave once confirmation is done.
    if next_departure is None or next_departure.trip_stop_id != current.trip_stop_id:
        return RoadStage(current.id, current.trip_stop_id, False, None, None)
    precinct = (await db.execute(
        select(Precinct).join(TripStop, TripStop.precinct_id == Precinct.id)
        .where(TripStop.id == current.trip_stop_id)
    )).scalar_one()
    return RoadStage(current.id, current.trip_stop_id, False, next_departure.id, precinct)


async def _already_recorded(db: AsyncSession, *, trip_id: uuid.UUID, finding: RoadFinding) -> bool:
    existing = (await db.execute(
        select(TripException.id).where(
            TripException.trip_id == trip_id,
            TripException.phase_event_id == finding.phase_event_id,
            TripException.exception_type == finding.exception_type,
            TripException.vehicle_id == finding.vehicle_id,
        ).limit(1)
    )).first()
    return existing is not None


async def check_trip_on_road(db: AsyncSession, *, trip: Trip) -> RoadCheckResult:
    """Read every tracker on the trip once and record what the readings support.

    Once per (phase, type, vehicle): the check can be run as often as the presenter
    likes, and a real scheduler could run it every few minutes, without flooding the
    dispatcher with the same finding. Two checks racing on one trip could both write;
    acceptable for an on-demand dev trigger, and a scheduler would need a lock.
    """
    if TripStatus(trip.status) in _SKIPPED_STATUSES:
        return RoadCheckResult([], [], [], f"Trip is {TripStatus(trip.status).value}.")
    current = await current_phase_event(db, trip.id)
    if current is None:
        return RoadCheckResult([], [], [], "Trip has no phase plan.")

    rig = await load_rig(db, trip=trip)
    client = get_pulsit_client(organization_id=trip.operator_organization_id)
    fixes = await client.get_positions([v.device_id for v in rig])
    readings = [
        RigReading(v.vehicle_id, v.registration, v.role, fix.status, fix.lat, fix.lng)
        for v, fix in zip(rig, fixes, strict=True)
    ]

    stage = await road_stage_for_current(db, current=current)
    findings = evaluate_road_readings(
        stage=stage, readings=readings,
        max_separation_metres=settings.TRAILER_HORSE_MAX_SEPARATION_METRES,
    )

    recorded: list[RoadFinding] = []
    already: list[RoadFinding] = []
    for finding in findings:
        if await _already_recorded(db, trip_id=trip.id, finding=finding):
            already.append(finding)
            continue
        db.add(TripException(
            trip_id=trip.id,
            phase_event_id=finding.phase_event_id,
            trip_stop_id=finding.trip_stop_id,
            exception_type=finding.exception_type,
            source=ExceptionSource.SYSTEM,
            severity=finding.severity,
            review_status=initial_review_status(finding.severity),
            description=finding.description,
            gps_lat=finding.lat,
            gps_lng=finding.lng,
            vehicle_id=finding.vehicle_id,
        ))
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED, severity=event_severity(finding.severity)),
        )
        logger.info(
            "Road check recorded %s for trip_id=%s vehicle_id=%s",
            finding.exception_type.value, trip.id, finding.vehicle_id,
        )
        recorded.append(finding)
    await db.flush()
    return RoadCheckResult(readings, recorded, already, None)
