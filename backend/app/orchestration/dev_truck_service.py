"""FP-197 (Task 3) — trip-stop-relative move-truck mode: stop resolution and scenario maths.

Split out of api/v1/endpoints/dev_pulsit.py so the endpoint stays a thin HTTP shim and
the two things a reviewer would actually want to audit independently — "does this pick
the right stop" and "is the offset maths right" — can be unit-tested with no DB, no
Redis, and no HTTP client at all (see tests/unit/test_dev_truck_service.py).

Layering: this is an orchestration module, so it may import schemas (trip_service.py
and others already do) and db/models, but never api/ — dev_pulsit.py calls in, not the
reverse.

Deliberately narrow: this module answers "where should the tracker land for this
scenario", nothing more. It does not stage the position (dev_pulsit.py calls
MockPulsitClient itself, so the "this endpoint writes Pulsit mock state and nothing
else" claim in dev_pulsit.py's own docstring stays checkable by reading one file), and
it does not evaluate a geofence verdict (orchestration/geofence_service.py owns that,
unchanged by this task — see MoveTruckResponse's EXPECTED vs TARGET docstring for why
the two are computed against different precincts).
"""

import math
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.core.geo import EARTH_RADIUS_METRES
from app.db.models.organisations import Precinct
from app.db.models.trips import TripStop
from app.schemas.dev import (
    SCENARIO_AT_STOP,
    SCENARIO_FIFTY_KM,
    SCENARIO_INSIDE_TOLERANCE,
    SCENARIO_NO_SIGNAL,
    SCENARIO_OUTSIDE_TOLERANCE,
    SCENARIO_THREE_KM,
    DevTruckScenario,
)

# The bearing every scenario offset travels along from the stop's own centre: due
# east. Documented and FIXED rather than derived per-trip (contrast with
# demo_waypoints.py's DEMO_ROUTE_BEARING_DEGREES, which points along one specific
# seeded corridor): a geofence verdict is a pure distance check with no directionality,
# so any fixed bearing produces the identical pass/fail outcome, and fixing one lets a
# reviewer regenerate any offset by hand and lets
# tests/unit/test_dev_truck_service.py assert an exact destination point rather than
# merely a distance.
SCENARIO_OFFSET_BEARING_DEGREES = 90.0

# Fixed absolute distances in metres, independent of any one precinct's own radius —
# see task-3-brief.md's "Core scenario rule". 3 km and 50 km read the same past a
# 50 m-radius yard precinct as past a 500 m-radius cross-dock hub, which is the
# property that makes them useful headline numbers rather than "big enough to fail
# somewhere for this particular precinct".
THREE_KM_METRES = 3_000.0
FIFTY_KM_METRES = 50_000.0

# How far past (or short of) the tolerance-widened radius the two boundary scenarios
# land. Ten metres is comfortably past Numeric(10,7) rounding and float error in the
# destination-point maths, and comfortably inside "the marginal case" — the same
# margin the legacy WAYPOINT_INSIDE_TOLERANCE/WAYPOINT_OUTSIDE_TOLERANCE pair uses
# (demo_waypoints.py).
TOLERANCE_BOUNDARY_MARGIN_METRES = 10.0

# Coordinates round to Numeric(10,7) the moment they reach the DB
# (Precinct.latitude/longitude). Rounding a computed offset to the same scale here
# means a staged position is exactly what a real precinct row could hold — not a
# value a later read would silently truncate further.
_COORDINATE_DECIMAL_PLACES = Decimal("0.0000001")

# Presentation labels for MoveTruckResponse.waypoint_label in scenario mode, so the
# panel's "what did I just press" readout reads like a sentence rather than a snake_
# case enum value. Mirrors DemoWaypoint.label for the legacy mode, but deliberately
# spelled DIFFERENTLY from every legacy waypoint label (demo_waypoints.py): the panel
# renders both button grids on screen together, and two differently-behaved buttons
# sharing the exact same visible text (e.g. two "No signal" buttons) would be
# ambiguous for an operator and for a screen reader alike — see
# frontend/dispatcher/lib/types/dev.ts's copy of this map for the same reasoning.
# Not itself part of the wire contract — dev_pulsit.py composes the final label with
# the target precinct's name when one was resolved.
SCENARIO_LABELS: dict[str, str] = {
    SCENARIO_AT_STOP: "At the stop",
    SCENARIO_INSIDE_TOLERANCE: "Just inside tolerance",
    SCENARIO_OUTSIDE_TOLERANCE: "Just outside tolerance",
    SCENARIO_THREE_KM: "3 km from the stop",
    SCENARIO_FIFTY_KM: "50 km from the stop",
    SCENARIO_NO_SIGNAL: "Go dark (no signal)",
}


class TargetGeometryUnavailableError(Exception):
    """Raised when the resolved target precinct has no usable geometry to offset from.

    Precinct.latitude/longitude/geofence_radius_metres are all NOT NULL in the schema
    (db/models/organisations.py), so this should be unreachable against a real row —
    it exists for the same reason evaluate_geofence's own None-guards exist (see
    geofence_service.py's DEFAULT_GEOFENCE_RADIUS_METRES docstring): a defensive guard
    against a partially-built or detached ORM object in a test or a not-yet-flushed
    unit of work, not an expected runtime state.

    Framework-agnostic on purpose, mirroring core/exceptions.py's own rule ("do not
    import FastAPI here") even though this exception does not live in that module —
    dev_pulsit.py maps it to 409, not this one.
    """


@dataclass(frozen=True)
class ScenarioTarget:
    """Where FP-197's scenario mode wants the horse tracker fixed, and why.

    `latitude`/`longitude`/`distance_metres` are None only for `no_signal` — modelled
    as an absent coordinate rather than a sentinel like 0.0, exactly as
    DemoWaypoint.is_no_signal already does for the legacy mode (demo_waypoints.py).
    """

    trip_stop_id: uuid.UUID
    precinct_name: str
    latitude: Optional[Decimal]
    longitude: Optional[Decimal]
    distance_metres: Optional[float]


async def resolve_target_stop(
    db: AsyncSession, *, trip_id: uuid.UUID, trip_stop_id: uuid.UUID,
) -> tuple[TripStop, Precinct]:
    """Load one trip stop and its precinct, scoped to the given trip.

    Scoped to `trip_id` (not just `trip_stop_id`): a syntactically valid stop id that
    belongs to a DIFFERENT trip — another trip in the same organisation, or a foreign
    organisation's trip entirely — is indistinguishable here from an id that does not
    exist at all. Both come back as a plain ResourceNotFoundError (the endpoint maps
    this to 404), never a signal that would confirm the id is real. The caller
    (dev_pulsit._load_trip_context) has already confirmed `trip_id` itself belongs to
    the requesting organisation, so this only needs the trip_id join to close the loop.

    Deliberately does not de-duplicate on precinct_id: a repeated-precinct multi-stop
    trip (e.g. a cross-dock that returns to its own origin) has two distinct
    TripStop rows sharing one Precinct, and this must resolve exactly the stop asked
    for, not "a stop at that precinct" — see the repeated-precinct integration test.
    """
    row = (await db.execute(
        select(TripStop, Precinct)
        .join(Precinct, Precinct.id == TripStop.precinct_id)
        .where(TripStop.id == trip_stop_id, TripStop.trip_id == trip_id)
    )).one_or_none()
    if row is None:
        raise ResourceNotFoundError("TripStop", str(trip_stop_id))
    return row


def scenario_distance_metres(
    scenario: DevTruckScenario, *, radius_metres: int, tolerance_metres: int,
) -> float:
    """The Core scenario rule from task-3-brief.md, as one pure, tested function.

    `no_signal` has no distance at all — it stages an absent fix, not a coordinate —
    so it is deliberately not a key here. A caller reaching this function with
    `no_signal` has a bug in its own branching (build_scenario_target below never
    calls this for that scenario), so this raises rather than silently returning 0.0,
    which would be indistinguishable from `at_stop`.
    """
    if scenario == SCENARIO_AT_STOP:
        return 0.0
    if scenario == SCENARIO_INSIDE_TOLERANCE:
        # Clamped at zero per the brief: a precinct with an unusually small radius and
        # tolerance could otherwise drive "radius + tolerance - 10" negative, which is
        # not a distance a destination-point offset can be computed from.
        return max(0.0, radius_metres + tolerance_metres - TOLERANCE_BOUNDARY_MARGIN_METRES)
    if scenario == SCENARIO_OUTSIDE_TOLERANCE:
        return radius_metres + tolerance_metres + TOLERANCE_BOUNDARY_MARGIN_METRES
    if scenario == SCENARIO_THREE_KM:
        return THREE_KM_METRES
    if scenario == SCENARIO_FIFTY_KM:
        return FIFTY_KM_METRES
    raise ValueError(
        f"{scenario!r} has no distance to compute — {SCENARIO_NO_SIGNAL!r} stages an "
        "absent fix, not an offset coordinate; callers must branch on it before "
        "reaching this function."
    )


def destination_point(
    latitude: Decimal, longitude: Decimal, *, distance_metres: float,
) -> tuple[Decimal, Decimal]:
    """The spherical destination-point formula: where you land after travelling
    `distance_metres` from (latitude, longitude) along SCENARIO_OFFSET_BEARING_DEGREES.

    Standard great-circle "destination point given distance and bearing" — the
    forward problem to core/geo.py's haversine_metres (the inverse: distance between
    two points). Verified the other way round in
    tests/unit/test_dev_truck_service.py, by feeding the result back through
    haversine_metres and asserting it recovers the requested distance to within 0.5 m.

    Returns Decimal rounded to 7 decimal places — Numeric(10,7) is the scale
    Precinct.latitude/longitude round to the moment they reach the DB, and staging a
    value the schema itself could not hold more precisely would be false precision.
    """
    if distance_metres == 0.0:
        # Skip the trigonometry entirely rather than let asin/atan2 of a zero angular
        # distance round to a value a few ULPs away: "at the stop" must mean
        # bit-for-bit the stop's own coordinate, which the destination-point formula
        # does not otherwise guarantee at distance=0.
        return latitude, longitude

    lat_rad = math.radians(float(latitude))
    lng_rad = math.radians(float(longitude))
    bearing_rad = math.radians(SCENARIO_OFFSET_BEARING_DEGREES)
    angular_distance = distance_metres / EARTH_RADIUS_METRES

    dest_lat_rad = math.asin(
        math.sin(lat_rad) * math.cos(angular_distance)
        + math.cos(lat_rad) * math.sin(angular_distance) * math.cos(bearing_rad)
    )
    dest_lng_rad = lng_rad + math.atan2(
        math.sin(bearing_rad) * math.sin(angular_distance) * math.cos(lat_rad),
        math.cos(angular_distance) - math.sin(lat_rad) * math.sin(dest_lat_rad),
    )

    dest_lat = Decimal(str(math.degrees(dest_lat_rad))).quantize(_COORDINATE_DECIMAL_PLACES)
    dest_lng = Decimal(str(math.degrees(dest_lng_rad))).quantize(_COORDINATE_DECIMAL_PLACES)
    return dest_lat, dest_lng


def build_scenario_target(
    *,
    trip_stop_id: uuid.UUID,
    precinct: Precinct,
    scenario: DevTruckScenario,
    tolerance_metres: int,
) -> ScenarioTarget:
    """Turn a resolved (stop, precinct) pair and a scenario id into a staged target.

    Geometry is validated only for scenarios that need it: `no_signal` stages no
    coordinate at all, so a precinct missing its lat/lng/radius is not actually a
    problem for that one scenario — checking it anyway would 409 a request that was
    always going to stage "no fix" regardless.

    Raises:
        TargetGeometryUnavailableError: the precinct has no usable coordinates or
            radius to offset from, for a scenario that needs one.
    """
    if scenario == SCENARIO_NO_SIGNAL:
        return ScenarioTarget(
            trip_stop_id=trip_stop_id, precinct_name=precinct.name,
            latitude=None, longitude=None, distance_metres=None,
        )

    if precinct.latitude is None or precinct.longitude is None or precinct.geofence_radius_metres is None:
        raise TargetGeometryUnavailableError(
            f"Precinct {precinct.id} has no usable geometry to simulate a position from."
        )

    distance = scenario_distance_metres(
        scenario, radius_metres=precinct.geofence_radius_metres, tolerance_metres=tolerance_metres,
    )
    latitude, longitude = destination_point(
        precinct.latitude, precinct.longitude, distance_metres=distance,
    )
    return ScenarioTarget(
        trip_stop_id=trip_stop_id, precinct_name=precinct.name,
        latitude=latitude, longitude=longitude, distance_metres=distance,
    )
