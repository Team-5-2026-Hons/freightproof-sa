"""Stage every tracker on a trip for one named demo scenario (Pulsit mock only).

A rig moves as one: horse and trailers are staged together unless the scenario is
exactly the case where they part. Positions are computed from THIS trip's own stops
(dev_truck_service geometry), never fixed coordinates.

Writes Pulsit mock state and nothing else. Any exception the room then sees is written
by road_check_service reading those positions, called separately by the endpoint.

Layering: orchestration → integrations (MockPulsitClient), db, schemas. Never api/.
"""

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import PhaseType
from app.db.models.organisations import Precinct
from app.db.models.trips import Trip, TripStop
from app.integrations.pulsit import MockPulsitClient
from app.orchestration import dev_truck_service
from app.orchestration.phases.queries import current_phase_event
from app.orchestration.road_check_service import RigRole, RigVehicle, load_rig, road_stage_for_current
from app.schemas.dev import SCENARIO_AT_STOP, SCENARIO_THREE_KM, DevTruckScenario, RigScenario

# 5 km: unmistakably apart on the dispatcher's map, and ten times the default 500 m
# separation threshold, so the scenario still trips the rule if the threshold is tuned.
UNCOUPLED_TRAILER_MIN_OFFSET_METRES = 5_000.0
_COORDINATE_SCALE = Decimal("0.0000001")  # Numeric(10,7), same as precinct columns


class ScenarioNotApplicableError(Exception):
    """The scenario does not fit where the trip is, e.g. en_route while still loading."""


def midpoint(a: tuple[Decimal, Decimal], b: tuple[Decimal, Decimal]) -> tuple[Decimal, Decimal]:
    # A straight average: for a leg of tens of kilometres it lands well clear of both
    # fences, which is all "driving normally" needs. It is not meant to be on a road.
    return (
        ((a[0] + b[0]) / 2).quantize(_COORDINATE_SCALE),
        ((a[1] + b[1]) / 2).quantize(_COORDINATE_SCALE),
    )


def uncoupled_offset_metres(max_separation_metres: float) -> float:
    return max(UNCOUPLED_TRAILER_MIN_OFFSET_METRES, 2 * max_separation_metres)


async def _stage_rig(client: MockPulsitClient, rig: list[RigVehicle], position: tuple[Decimal, Decimal]) -> None:
    for vehicle in rig:
        await client.stage_position(vehicle.device_id, lat=position[0], lng=position[1])


async def _stop_target(
    db: AsyncSession, *, trip: Trip, trip_stop_id: uuid.UUID, scenario: DevTruckScenario,
) -> tuple[str, tuple[Decimal, Decimal]]:
    stop, precinct = await dev_truck_service.resolve_target_stop(db, trip_id=trip.id, trip_stop_id=trip_stop_id)
    target = dev_truck_service.build_scenario_target(
        trip_stop_id=stop.id, precinct=precinct, scenario=scenario,
        tolerance_metres=settings.GPS_TOLERANCE_METRES,
    )
    if target.latitude is None or target.longitude is None:
        raise ScenarioNotApplicableError(f"{precinct.name} has no usable coordinates.")
    return precinct.name, (target.latitude, target.longitude)


async def _current_leg(db: AsyncSession, *, trip: Trip) -> tuple[Precinct, Precinct]:
    current = await current_phase_event(db, trip.id)
    if current is None or current.phase_type != PhaseType.IN_TRANSIT or current.trip_stop_id is None:
        raise ScenarioNotApplicableError("The trip is not on the road.")
    rows = (await db.execute(
        select(TripStop, Precinct)
        .join(Precinct, Precinct.id == TripStop.precinct_id)
        .where(TripStop.trip_id == trip.id)
        .order_by(TripStop.sequence)
    )).all()
    index = next(i for i, (stop, _p) in enumerate(rows) if stop.id == current.trip_stop_id)
    if index + 1 >= len(rows):
        raise ScenarioNotApplicableError("The current leg has no next stop.")
    return rows[index][1], rows[index + 1][1]


async def stage_rig_scenario(
    db: AsyncSession,
    *,
    client: MockPulsitClient,
    trip: Trip,
    scenario: RigScenario,
    trip_stop_id: uuid.UUID | None,
    vehicle_id: uuid.UUID | None,
) -> str:
    """Stage the scenario and return a one-line label for the activity log.

    Raises ResourceNotFoundError (unknown stop or vehicle on this trip),
    ScenarioNotApplicableError (wrong stage), TargetGeometryUnavailableError (bad precinct).
    """
    rig = await load_rig(db, trip=trip)

    if scenario == "silent":
        target = next((v for v in rig if v.vehicle_id == vehicle_id), None)
        if target is None:
            raise ResourceNotFoundError("Vehicle", str(vehicle_id))
        await client.stage_no_fix(target.device_id)
        return f"Tracker on {target.role.value} {target.registration} went silent"

    if scenario in ("at_stop", "away_from_stop"):
        if trip_stop_id is None:
            # RigScenarioRequest's validator already refuses this; the check keeps the
            # service safe for any other caller rather than trusting an assert.
            raise ScenarioNotApplicableError(f"{scenario} needs a stop.")
        offset: DevTruckScenario = SCENARIO_AT_STOP if scenario == "at_stop" else SCENARIO_THREE_KM
        name, position = await _stop_target(db, trip=trip, trip_stop_id=trip_stop_id, scenario=offset)
        await _stage_rig(client, rig, position)
        return f"Truck at {name}" if scenario == "at_stop" else f"Truck 3 km from {name}"

    if scenario == "left_before_departure":
        current = await current_phase_event(db, trip.id)
        if current is None or current.phase_type == PhaseType.IN_TRANSIT or current.trip_stop_id is None:
            raise ScenarioNotApplicableError("The truck can only leave early while it is at a stop.")
        stage = await road_stage_for_current(db, current=current)
        if stage.pending_departure_id is None:
            raise ScenarioNotApplicableError("This stop has no departure ahead to leave early.")
        name, position = await _stop_target(
            db, trip=trip, trip_stop_id=current.trip_stop_id, scenario=SCENARIO_THREE_KM,
        )
        await _stage_rig(client, rig, position)
        return f"Truck left {name} before departure"

    origin, destination = await _current_leg(db, trip=trip)
    middle = midpoint((origin.latitude, origin.longitude), (destination.latitude, destination.longitude))

    if scenario == "en_route":
        await _stage_rig(client, rig, middle)
        return f"Truck driving from {origin.name} to {destination.name}"

    # trailer_uncoupled
    trailer = next((v for v in rig if v.vehicle_id == vehicle_id and v.role is RigRole.TRAILER), None)
    if trailer is None:
        raise ResourceNotFoundError("Trailer", str(vehicle_id))
    await _stage_rig(client, [v for v in rig if v.vehicle_id != trailer.vehicle_id], middle)
    left_at = dev_truck_service.destination_point(
        middle[0], middle[1],
        distance_metres=uncoupled_offset_metres(settings.TRAILER_HORSE_MAX_SEPARATION_METRES),
    )
    await client.stage_position(trailer.device_id, lat=left_at[0], lng=left_at[1])
    return f"Trailer {trailer.registration} uncoupled on the road"
