"""Fixed waypoints for the FP-116 "move the truck" demo control.

Deliberately pure: no DB, no config, no other `app/` imports beyond nothing at all.
A leaf module like `core/geo.py`, so the coordinates can be unit-tested in total
isolation and a wrong digit is caught by CI rather than discovered on stage.

WHY FIXED COORDINATES AND NOT AN OFFSET COMPUTED AT REQUEST TIME: the whole point of
this control is that the presenter knows exactly where the truck will land before
pressing the button. A coordinate derived at runtime from whichever precinct the trip
happens to be at cannot be asserted in a test, so nothing would catch a bearing sign
error until the room was watching. These are constants, and
tests/unit/test_demo_waypoints.py measures every one of them with the same
`haversine_metres` the geofence verdict uses.

THE ROUTE: all offsets run along the initial great-circle bearing from the Cape Town
depot to the Bloemfontein depot — 55.803°, which is the corridor the seeded cross-dock
trip actually travels (scripts/seed_demo.py:_PRECINCTS). So "the truck moved 3 km" moves
it 3 km up its own route rather than 3 km into the Atlantic, and FP-145 renders a
separation that reads as a truck leaving rather than a coordinate typo.

THE ANCHOR: the Cape Town depot, because that is where every seeded tracker is parked
(integrations/pulsit.py:MOCK_DEVICE_POSITIONS) and it is the origin precinct of the
seeded trips. The distances below are therefore true distances from the ORIGIN. The
endpoint reports the live measured distance from whichever precinct the trip is
actually at, which is the honest number and will differ at a later stop — see
api/v1/endpoints/dev_pulsit.py.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

# The anchor these offsets were generated from — "Cape Town Depot (Epping)" in
# scripts/seed_demo.py:_PRECINCTS. Restated here rather than imported because this
# module must not depend on a seeding script, and because a test asserting distances
# needs the anchor as data.
DEMO_ANCHOR_LATITUDE = Decimal("-33.9249")
DEMO_ANCHOR_LONGITUDE = Decimal("18.4241")

# Initial great-circle bearing from the Cape Town depot to the Bloemfontein depot, in
# degrees. Recorded for provenance: it is how the coordinates below were generated, and
# it is what a reviewer needs to regenerate them.
DEMO_ROUTE_BEARING_DEGREES = 55.803

# How close a measured distance must land to its intended distance for the waypoint to
# be considered correctly typed. One metre over kilometres of offset — tight enough that
# a transposed digit fails, loose enough to absorb the rounding to seven decimal places
# that Numeric(10,7) imposes on every coordinate in this system.
WAYPOINT_DISTANCE_TOLERANCE_METRES = 1.0


@dataclass(frozen=True)
class DemoWaypoint:
    """One stop the presenter can move the truck to.

    Frozen, because a waypoint is a fixture: nothing may edit one in place and have
    the change leak into the next press of the button.

    `latitude`/`longitude` are None for exactly one waypoint — NO_SIGNAL — which is not
    a position at all but the tracker going dark. Modelled as an absent coordinate
    rather than a sentinel like 0.0, for the same reason PulsitFix does it: 0,0 is a
    real place in the Gulf of Guinea.
    """

    waypoint_id: str
    label: str
    # Presentation order. The presenter steps down this list; it is not an index into
    # anything and gaps would be harmless, but there are none.
    sequence: int
    # What the room should understand is being demonstrated. Rendered under the button.
    description: str
    latitude: Optional[Decimal]
    longitude: Optional[Decimal]
    # Distance from DEMO_ANCHOR_* this waypoint was generated at. None for NO_SIGNAL.
    # Asserted against a real haversine measurement in the unit tests.
    intended_distance_metres: Optional[int]
    # What the geofence verdict SHOULD be at this waypoint, against the seeded 200 m
    # radius and the 50 m default tolerance. None for NO_SIGNAL, where there is no fix
    # to judge and the verdict is deliberately left null rather than false.
    expected_confirmed: Optional[bool]

    @property
    def is_no_signal(self) -> bool:
        """Whether this waypoint takes the tracker dark instead of moving it."""
        return self.latitude is None or self.longitude is None


# Waypoint identifiers. Named constants rather than bare strings at the call sites, so
# a typo is an AttributeError at import rather than a 404 in front of an audience.
WAYPOINT_PRECINCT = "precinct"
WAYPOINT_INSIDE_TOLERANCE = "inside_tolerance"
WAYPOINT_OUTSIDE_TOLERANCE = "outside_tolerance"
WAYPOINT_THREE_KM = "three_km"
WAYPOINT_FIFTY_KM = "fifty_km"
WAYPOINT_NO_SIGNAL = "no_signal"

# The ordered route. Distances are measured from DEMO_ANCHOR_* and verified in
# tests/unit/test_demo_waypoints.py — do not edit a coordinate without running it.
DEMO_WAYPOINTS: tuple[DemoWaypoint, ...] = (
    DemoWaypoint(
        waypoint_id=WAYPOINT_PRECINCT,
        label="At the precinct",
        sequence=1,
        description="Parked at the depot. Inside the fence — the handshake confirms.",
        latitude=DEMO_ANCHOR_LATITUDE,
        longitude=DEMO_ANCHOR_LONGITUDE,
        intended_distance_metres=0,
        expected_confirmed=True,
    ),
    DemoWaypoint(
        waypoint_id=WAYPOINT_INSIDE_TOLERANCE,
        label="230 m — just inside tolerance",
        sequence=2,
        # The marginal case. Outside the 200 m radius but inside radius + 50 m
        # tolerance, so it still confirms — which is what proves the tolerance band is
        # real rather than decorative.
        description="Outside the 200 m fence but inside the 50 m tolerance. Still confirms.",
        latitude=Decimal("-33.9237374"),
        longitude=Decimal("18.4261618"),
        intended_distance_metres=230,
        expected_confirmed=True,
    ),
    DemoWaypoint(
        waypoint_id=WAYPOINT_OUTSIDE_TOLERANCE,
        label="260 m — just outside tolerance",
        sequence=3,
        description="Ten metres past the tolerance band. The first waypoint that fails.",
        latitude=Decimal("-33.9235858"),
        longitude=Decimal("18.4264307"),
        intended_distance_metres=260,
        expected_confirmed=False,
    ),
    DemoWaypoint(
        waypoint_id=WAYPOINT_THREE_KM,
        label="3 km away",
        sequence=4,
        description="The headline. Truck is 3 km up the N1 while the driver stands at the gate.",
        latitude=Decimal("-33.9097335"),
        longitude=Decimal("18.4509884"),
        intended_distance_metres=3000,
        expected_confirmed=False,
    ),
    DemoWaypoint(
        waypoint_id=WAYPOINT_FIFTY_KM,
        label="50 km away",
        sequence=5,
        description="Unambiguous. No reading of the data makes this the same place.",
        latitude=Decimal("-33.6713655"),
        longitude=Decimal("18.8709933"),
        intended_distance_metres=50000,
        expected_confirmed=False,
    ),
    DemoWaypoint(
        waypoint_id=WAYPOINT_NO_SIGNAL,
        label="No signal",
        sequence=6,
        # Not a position. The tracker stays known but reports nothing, so the verdict
        # is null and NO exception is raised — an unreachable tracker must never
        # accuse a driver.
        description="Tracker goes dark. Verdict stays null and no exception is raised.",
        latitude=None,
        longitude=None,
        intended_distance_metres=None,
        expected_confirmed=None,
    ),
)

# Id -> waypoint, built once at import. The endpoint resolves a requested id through
# this, so an unknown id is a clean 404 rather than a scan of the tuple per request.
DEMO_WAYPOINTS_BY_ID: dict[str, DemoWaypoint] = {w.waypoint_id: w for w in DEMO_WAYPOINTS}

# The waypoint "reset" returns to. Named separately from WAYPOINT_PRECINCT so the
# panel's reset button and the first waypoint can never drift apart.
RESET_WAYPOINT_ID = WAYPOINT_PRECINCT


def get_waypoint(waypoint_id: str) -> Optional[DemoWaypoint]:
    """Resolve a waypoint id, or None if it is not one of ours."""
    return DEMO_WAYPOINTS_BY_ID.get(waypoint_id)
