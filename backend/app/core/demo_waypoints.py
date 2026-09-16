"""Fixed waypoints for the FP-116 "move the truck" demo control.

Deliberately pure, a leaf module like `core/geo.py`, so coordinates are
unit-tested in isolation and a wrong digit is caught by CI, not on stage.

Fixed rather than computed at request time so the presenter knows exactly
where the truck lands before pressing the button, and so
tests/unit/test_demo_waypoints.py can assert each one with the same
`haversine_metres` the geofence verdict uses.

Route: offsets run along the great-circle bearing (55.803°) from the Cape
Town depot toward Bloemfontein — the seeded cross-dock trip's actual
corridor (scripts/seed_demo.py:_PRECINCTS) — so "moved 3km" reads as a
truck leaving, not a coordinate typo.

Anchor: the Cape Town depot, where every seeded tracker is parked
(integrations/pulsit.py:MOCK_DEVICE_POSITIONS). Distances below are true
distances from that origin; the endpoint itself reports the live measured
distance from wherever the trip actually is (api/v1/endpoints/dev_pulsit.py).
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

# Anchor these offsets were generated from — "Cape Town Depot (Epping)" in
# scripts/seed_demo.py:_PRECINCTS. Restated, not imported, so this module
# doesn't depend on a seeding script.
DEMO_ANCHOR_LATITUDE = Decimal("-33.9249")
DEMO_ANCHOR_LONGITUDE = Decimal("18.4241")

# Bearing (degrees) used to generate the coordinates below; needed to regenerate them.
DEMO_ROUTE_BEARING_DEGREES = 55.803

# Tolerance for a measured distance to count as correctly typed — tight
# enough to catch a transposed digit, loose enough to absorb Numeric(10,7) rounding.
WAYPOINT_DISTANCE_TOLERANCE_METRES = 1.0


@dataclass(frozen=True)
class DemoWaypoint:
    """One stop the presenter can move the truck to.

    Frozen: a fixture, not editable in place.

    `latitude`/`longitude` are None for exactly one waypoint (NO_SIGNAL) —
    the tracker going dark, modelled as an absent coordinate rather than
    0.0 (a real place in the Gulf of Guinea).
    """

    waypoint_id: str
    label: str
    sequence: int
    # Rendered under the button.
    description: str
    latitude: Optional[Decimal]
    longitude: Optional[Decimal]
    # Distance from DEMO_ANCHOR_*, asserted in unit tests. None for NO_SIGNAL.
    intended_distance_metres: Optional[int]
    # Expected geofence verdict at this waypoint (200m radius + 50m
    # tolerance). None for NO_SIGNAL, where there's no fix to judge.
    expected_confirmed: Optional[bool]

    @property
    def is_no_signal(self) -> bool:
        """Whether this waypoint takes the tracker dark instead of moving it."""
        return self.latitude is None or self.longitude is None


# Named so a typo is an AttributeError at import, not a 404 in front of an audience.
WAYPOINT_PRECINCT = "precinct"
WAYPOINT_INSIDE_TOLERANCE = "inside_tolerance"
WAYPOINT_OUTSIDE_TOLERANCE = "outside_tolerance"
WAYPOINT_THREE_KM = "three_km"
WAYPOINT_FIFTY_KM = "fifty_km"
WAYPOINT_NO_SIGNAL = "no_signal"

# Distances measured from DEMO_ANCHOR_* and verified in
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
        # Marginal case: proves the tolerance band is real, not decorative.
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
        # Tracker stays known but reports nothing — an unreachable tracker
        # must never accuse a driver.
        description="Tracker goes dark. Verdict stays null and no exception is raised.",
        latitude=None,
        longitude=None,
        intended_distance_metres=None,
        expected_confirmed=None,
    ),
)

# Id -> waypoint, built once at import, so an unknown id is a clean 404.
DEMO_WAYPOINTS_BY_ID: dict[str, DemoWaypoint] = {w.waypoint_id: w for w in DEMO_WAYPOINTS}

# The waypoint "reset" returns to.
RESET_WAYPOINT_ID = WAYPOINT_PRECINCT


def get_waypoint(waypoint_id: str) -> Optional[DemoWaypoint]:
    """Resolve a waypoint id, or None if it is not one of ours."""
    return DEMO_WAYPOINTS_BY_ID.get(waypoint_id)
