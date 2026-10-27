"""FP-197: the trip-stop-relative scenario maths, tested with no DB at all.

Mirrors test_demo_waypoints.py's own discipline for the legacy mode: every offset is
verified against the same `haversine_metres` the real geofence verdict uses, so a
wrong sign or a wrong Earth radius here fails CI instead of a demo. `resolve_target_stop`
is deliberately NOT covered here — it is one database query, and
tests/integration/test_dev_pulsit.py exercises it end to end (foreign trip, stop
membership, repeated-precinct multi-stop, non-Cape-Town coordinates) exactly the way
test_dev_pulsit.py already does for the legacy mode's DB-touching parts.
"""

from decimal import Decimal

import pytest

from app.core import polygon as geo_polygon
from app.core.geo import haversine_metres
from app.dev.services.truck import (
    FIFTY_KM_METRES,
    SCENARIO_LABELS,
    THREE_KM_METRES,
    TOLERANCE_BOUNDARY_MARGIN_METRES,
    TargetGeometryUnavailableError,
    build_scenario_target,
    destination_point,
    scenario_distance_metres,
)
from app.orchestration.evidence.geofence import TrackerFix, evaluate_geofence
from app.dev.schemas import (
    SCENARIO_AT_STOP,
    SCENARIO_FIFTY_KM,
    SCENARIO_INSIDE_TOLERANCE,
    SCENARIO_NO_SIGNAL,
    SCENARIO_OUTSIDE_TOLERANCE,
    SCENARIO_THREE_KM,
)

_ORIGIN_LAT = Decimal("-32.2968")
_ORIGIN_LNG = Decimal("22.5750")

_RADIUS_METRES = 150
_TOLERANCE_METRES = 40

_DISTANCE_ASSERTION_TOLERANCE_METRES = 0.5


class _FakePrecinct:
    """Minimal stand-in for a Precinct row — build_scenario_target reads three
    attributes and an id/name. A fake rather than a real model instance: this is a
    unit test, and constructing an ORM object would drag a DB session into arithmetic
    that touches neither.
    """

    def __init__(
        self,
        *,
        lat: "Decimal | None" = _ORIGIN_LAT,
        lng: "Decimal | None" = _ORIGIN_LNG,
        radius: "int | None" = _RADIUS_METRES,
        name: str = "Karoo Crossing Depot",
    ) -> None:
        self.id = "fake-precinct-id"
        self.name = name
        self.latitude = lat
        self.longitude = lng
        self.geofence_radius_metres = radius
        self.geofence_polygon: "list[list[float]] | None" = None



def test_at_stop_is_zero_distance() -> None:
    assert scenario_distance_metres(
        SCENARIO_AT_STOP, radius_metres=_RADIUS_METRES, tolerance_metres=_TOLERANCE_METRES,
    ) == 0.0


def test_inside_tolerance_is_radius_plus_tolerance_minus_margin() -> None:
    distance = scenario_distance_metres(
        SCENARIO_INSIDE_TOLERANCE, radius_metres=_RADIUS_METRES, tolerance_metres=_TOLERANCE_METRES,
    )

    assert distance == _RADIUS_METRES + _TOLERANCE_METRES - TOLERANCE_BOUNDARY_MARGIN_METRES


def test_inside_tolerance_clamps_at_zero_rather_than_going_negative() -> None:
    """A precinct whose radius+tolerance is smaller than the 10 m margin must not
    produce a negative distance — clamped at zero per the brief."""
    distance = scenario_distance_metres(
        SCENARIO_INSIDE_TOLERANCE, radius_metres=0, tolerance_metres=5,
    )

    assert distance == 0.0


def test_outside_tolerance_is_radius_plus_tolerance_plus_margin() -> None:
    distance = scenario_distance_metres(
        SCENARIO_OUTSIDE_TOLERANCE, radius_metres=_RADIUS_METRES, tolerance_metres=_TOLERANCE_METRES,
    )

    assert distance == _RADIUS_METRES + _TOLERANCE_METRES + TOLERANCE_BOUNDARY_MARGIN_METRES


def test_three_km_is_the_fixed_constant_independent_of_radius() -> None:
    distance = scenario_distance_metres(
        SCENARIO_THREE_KM, radius_metres=999_999, tolerance_metres=999_999,
    )

    assert distance == THREE_KM_METRES == 3_000.0


def test_fifty_km_is_the_fixed_constant_independent_of_radius() -> None:
    distance = scenario_distance_metres(
        SCENARIO_FIFTY_KM, radius_metres=1, tolerance_metres=1,
    )

    assert distance == FIFTY_KM_METRES == 50_000.0


def test_no_signal_has_no_distance_and_raises() -> None:
    """no_signal stages an absent fix, not a coordinate — reaching this function with
    it is a caller bug, not a case with an answer."""
    with pytest.raises(ValueError, match="no_signal"):
        scenario_distance_metres(
            SCENARIO_NO_SIGNAL, radius_metres=_RADIUS_METRES, tolerance_metres=_TOLERANCE_METRES,
        )


def test_unknown_scenario_raises() -> None:
    with pytest.raises(ValueError):
        scenario_distance_metres(
            "not-a-real-scenario", radius_metres=_RADIUS_METRES, tolerance_metres=_TOLERANCE_METRES,  # type: ignore[arg-type]
        )



def test_zero_distance_returns_the_exact_same_coordinate() -> None:
    """at_stop must land bit-for-bit on the stop's own coordinate, not a value a few
    ULPs away from the destination-point formula's own rounding."""
    lat, lng = destination_point(_ORIGIN_LAT, _ORIGIN_LNG, distance_metres=0.0)

    assert lat == _ORIGIN_LAT
    assert lng == _ORIGIN_LNG


@pytest.mark.parametrize(
    "distance_metres", [1.0, 190.0, 3_000.0, 50_000.0],
)
def test_destination_point_lands_the_requested_distance_away(distance_metres: float) -> None:
    """The forward problem (destination point) verified against the inverse
    (haversine): feed the result back through the SAME function the real geofence
    verdict uses, and recover the requested distance to within 0.5 m."""
    lat, lng = destination_point(_ORIGIN_LAT, _ORIGIN_LNG, distance_metres=distance_metres)

    measured = haversine_metres(_ORIGIN_LAT, _ORIGIN_LNG, lat, lng)

    assert measured == pytest.approx(distance_metres, abs=_DISTANCE_ASSERTION_TOLERANCE_METRES)


def test_destination_point_moves_east_along_the_documented_bearing() -> None:
    """SCENARIO_OFFSET_BEARING_DEGREES is due east (90 degrees): longitude increases,
    latitude changes only through the sphere's curvature, never past the origin."""
    lat, lng = destination_point(_ORIGIN_LAT, _ORIGIN_LNG, distance_metres=3_000.0)

    assert lng > _ORIGIN_LNG



def test_build_scenario_target_at_stop_matches_the_precinct_centre() -> None:
    target = build_scenario_target(
        trip_stop_id="fake-stop-id",  # type: ignore[arg-type]
        precinct=_FakePrecinct(),  # type: ignore[arg-type]
        scenario=SCENARIO_AT_STOP,
        tolerance_metres=_TOLERANCE_METRES,
    )

    assert target.latitude == _ORIGIN_LAT
    assert target.longitude == _ORIGIN_LNG
    assert target.distance_metres == 0.0
    assert target.precinct_name == "Karoo Crossing Depot"


@pytest.mark.parametrize(
    "scenario",
    [SCENARIO_INSIDE_TOLERANCE, SCENARIO_OUTSIDE_TOLERANCE, SCENARIO_THREE_KM, SCENARIO_FIFTY_KM],
)
def test_build_scenario_target_lands_the_intended_distance_from_the_precinct(scenario: str) -> None:
    target = build_scenario_target(
        trip_stop_id="fake-stop-id",  # type: ignore[arg-type]
        precinct=_FakePrecinct(),  # type: ignore[arg-type]
        scenario=scenario,  # type: ignore[arg-type]
        tolerance_metres=_TOLERANCE_METRES,
    )

    assert target.distance_metres is not None
    assert target.latitude is not None and target.longitude is not None
    measured = haversine_metres(_ORIGIN_LAT, _ORIGIN_LNG, target.latitude, target.longitude)
    assert measured == pytest.approx(target.distance_metres, abs=_DISTANCE_ASSERTION_TOLERANCE_METRES)


def test_build_scenario_target_no_signal_has_no_coordinate() -> None:
    """Modelled as an absent fix, not a coordinate — mirrors DemoWaypoint's own
    no-signal waypoint (demo_waypoints.py)."""
    target = build_scenario_target(
        trip_stop_id="fake-stop-id",  # type: ignore[arg-type]
        precinct=_FakePrecinct(),  # type: ignore[arg-type]
        scenario=SCENARIO_NO_SIGNAL,
        tolerance_metres=_TOLERANCE_METRES,
    )

    assert target.latitude is None
    assert target.longitude is None
    assert target.distance_metres is None
    assert target.precinct_name == "Karoo Crossing Depot"


def test_build_scenario_target_no_signal_tolerates_missing_geometry() -> None:
    """no_signal stages no coordinate at all, so a precinct with no usable geometry is
    not actually a problem for this one scenario — 409-ing it would refuse a request
    that was always going to stage "no fix" regardless."""
    broken_precinct = _FakePrecinct(lat=None, lng=None, radius=None)

    target = build_scenario_target(
        trip_stop_id="fake-stop-id",  # type: ignore[arg-type]
        precinct=broken_precinct,  # type: ignore[arg-type]
        scenario=SCENARIO_NO_SIGNAL,
        tolerance_metres=_TOLERANCE_METRES,
    )

    assert target.latitude is None and target.longitude is None


@pytest.mark.parametrize("missing_field", ["latitude", "longitude", "geofence_radius_metres"])
@pytest.mark.parametrize("scenario", [SCENARIO_AT_STOP, SCENARIO_THREE_KM])
def test_build_scenario_target_raises_on_missing_geometry_for_scenarios_that_need_it(
    missing_field: str, scenario: str,
) -> None:
    precinct = _FakePrecinct()
    setattr(precinct, missing_field, None)

    with pytest.raises(TargetGeometryUnavailableError):
        build_scenario_target(
            trip_stop_id="fake-stop-id",  # type: ignore[arg-type]
            precinct=precinct,  # type: ignore[arg-type]
            scenario=scenario,  # type: ignore[arg-type]
            tolerance_metres=_TOLERANCE_METRES,
        )


def test_scenario_labels_cover_every_scenario() -> None:
    """A scenario with no label would leave the panel's waypoint_label blank —
    every value MoveTruckRequest.scenario accepts must have one."""
    for scenario in (
        SCENARIO_AT_STOP, SCENARIO_INSIDE_TOLERANCE, SCENARIO_OUTSIDE_TOLERANCE,
        SCENARIO_THREE_KM, SCENARIO_FIFTY_KM, SCENARIO_NO_SIGNAL,
    ):
        assert scenario in SCENARIO_LABELS
        assert SCENARIO_LABELS[scenario] != ""


_KAROO_BOX = [[-32.2963, 22.5745], [-32.2963, 22.5755], [-32.2973, 22.5755], [-32.2973, 22.5745]]


def _outline_precinct() -> _FakePrecinct:
    precinct = _FakePrecinct()
    precinct.geofence_polygon = _KAROO_BOX
    return precinct


@pytest.mark.parametrize(
    ("scenario", "confirmed", "in_band"),
    [
        (SCENARIO_AT_STOP, True, False),
        (SCENARIO_INSIDE_TOLERANCE, True, True),
        (SCENARIO_OUTSIDE_TOLERANCE, False, False),
        (SCENARIO_THREE_KM, False, False),
    ],
)
def test_outline_scenarios_get_the_verdict_their_label_promises(scenario: str, confirmed: bool, in_band: bool) -> None:
    target = build_scenario_target(
        trip_stop_id="fake-stop-id",  # type: ignore[arg-type]
        precinct=_outline_precinct(),  # type: ignore[arg-type]
        scenario=scenario,  # type: ignore[arg-type]
        tolerance_metres=_TOLERANCE_METRES,
    )

    assert target.latitude is not None and target.longitude is not None
    verdict = evaluate_geofence(
        TrackerFix(lat=target.latitude, lng=target.longitude),
        _outline_precinct(),  # type: ignore[arg-type]
        tolerance_metres=_TOLERANCE_METRES,
    )
    assert verdict.confirmed is confirmed
    assert verdict.in_tolerance_band is in_band


def test_outline_inside_tolerance_lands_the_intended_distance_outside_the_edge() -> None:
    target = build_scenario_target(
        trip_stop_id="fake-stop-id",  # type: ignore[arg-type]
        precinct=_outline_precinct(),  # type: ignore[arg-type]
        scenario=SCENARIO_INSIDE_TOLERANCE,
        tolerance_metres=_TOLERANCE_METRES,
    )

    assert target.latitude is not None and target.longitude is not None
    ring = [(c[0], c[1]) for c in _KAROO_BOX]
    outside_by = geo_polygon.distance_to_boundary_metres(ring, (float(target.latitude), float(target.longitude)))
    assert outside_by == pytest.approx(_TOLERANCE_METRES - TOLERANCE_BOUNDARY_MARGIN_METRES, abs=_DISTANCE_ASSERTION_TOLERANCE_METRES)
