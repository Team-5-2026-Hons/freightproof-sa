"""FP-116: the demo waypoints are where they claim to be.

THE POINT OF THIS FILE: a transposed digit in a coordinate is invisible by inspection
and catastrophic on stage — the truck lands in the wrong ocean, or worse, lands close
enough that the geofence verdict is right by accident and the demo proves nothing.
Every waypoint is measured here with the same `haversine_metres` the real geofence
verdict uses, and every intended verdict is re-derived through the real
`evaluate_geofence`. A wrong digit fails CI instead of the presentation.
"""

from decimal import Decimal

import pytest

from app.core.demo_waypoints import (
    DEMO_ANCHOR_LATITUDE,
    DEMO_ANCHOR_LONGITUDE,
    DEMO_WAYPOINTS,
    DEMO_WAYPOINTS_BY_ID,
    RESET_WAYPOINT_ID,
    WAYPOINT_FIFTY_KM,
    WAYPOINT_INSIDE_TOLERANCE,
    WAYPOINT_NO_SIGNAL,
    WAYPOINT_OUTSIDE_TOLERANCE,
    WAYPOINT_PRECINCT,
    WAYPOINT_THREE_KM,
    WAYPOINT_DISTANCE_TOLERANCE_METRES,
    get_waypoint,
)
from app.core.geo import haversine_metres
from app.orchestration.geofence_service import (
    DEFAULT_GEOFENCE_RADIUS_METRES,
    GeofenceVerdictReason,
    TrackerFix,
    evaluate_geofence,
)

# The seeded demo geofence: 200 m radius (scripts/seed_demo.py) and the 50 m default
# tolerance (settings.GPS_TOLERANCE_METRES). Stated explicitly rather than read from
# config so this file asserts the values the waypoints were DESIGNED against — if
# someone widens the tolerance, these tests should fail and make them re-check the
# marginal waypoints rather than silently agreeing with the new number.
_SEEDED_RADIUS_METRES = 200
_SEEDED_TOLERANCE_METRES = 50


class _FakePrecinct:
    """Minimal stand-in for a Precinct row — evaluate_geofence reads three attributes.

    A fake rather than a real model instance: this is a unit test, and constructing an
    ORM object would drag a DB session into arithmetic that touches neither.
    """

    def __init__(self, lat: Decimal, lng: Decimal, radius: int) -> None:
        self.latitude = lat
        self.longitude = lng
        self.geofence_radius_metres = radius


def _anchor_precinct() -> _FakePrecinct:
    return _FakePrecinct(DEMO_ANCHOR_LATITUDE, DEMO_ANCHOR_LONGITUDE, _SEEDED_RADIUS_METRES)


def _measured_distance(waypoint) -> float:
    return haversine_metres(
        waypoint.latitude, waypoint.longitude, DEMO_ANCHOR_LATITUDE, DEMO_ANCHOR_LONGITUDE
    )


def test_every_positioned_waypoint_is_at_its_intended_distance() -> None:
    positioned = [w for w in DEMO_WAYPOINTS if not w.is_no_signal]

    measured = {w.waypoint_id: _measured_distance(w) for w in positioned}

    for waypoint in positioned:
        assert waypoint.intended_distance_metres is not None
        assert measured[waypoint.waypoint_id] == pytest.approx(
            waypoint.intended_distance_metres, abs=WAYPOINT_DISTANCE_TOLERANCE_METRES
        ), (
            f"{waypoint.waypoint_id} claims {waypoint.intended_distance_metres} m but "
            f"measures {measured[waypoint.waypoint_id]:.2f} m from the anchor"
        )


def test_waypoint_verdicts_match_what_the_real_geofence_decides() -> None:
    """The declared expected_confirmed is not a comment — it is re-derived here."""
    precinct = _anchor_precinct()
    positioned = [w for w in DEMO_WAYPOINTS if not w.is_no_signal]

    verdicts = {
        w.waypoint_id: evaluate_geofence(
            TrackerFix(lat=w.latitude, lng=w.longitude),
            precinct,
            tolerance_metres=_SEEDED_TOLERANCE_METRES,
        )
        for w in positioned
    }

    for waypoint in positioned:
        assert verdicts[waypoint.waypoint_id].confirmed is waypoint.expected_confirmed, (
            f"{waypoint.waypoint_id} declares expected_confirmed="
            f"{waypoint.expected_confirmed} but the geofence says "
            f"{verdicts[waypoint.waypoint_id].confirmed}"
        )


def test_the_marginal_waypoint_is_actually_in_the_tolerance_band() -> None:
    """230 m must be OUTSIDE the fence and INSIDE the band — that is the whole point.

    If this waypoint drifted inside the 200 m radius it would still confirm, the demo
    would still look right, and it would have stopped demonstrating that the tolerance
    band exists. A passing verdict is not enough; it has to pass for the right reason.
    """
    waypoint = DEMO_WAYPOINTS_BY_ID[WAYPOINT_INSIDE_TOLERANCE]

    verdict = evaluate_geofence(
        TrackerFix(lat=waypoint.latitude, lng=waypoint.longitude),
        _anchor_precinct(),
        tolerance_metres=_SEEDED_TOLERANCE_METRES,
    )

    assert verdict.confirmed is True
    assert verdict.in_tolerance_band is True
    assert _SEEDED_RADIUS_METRES < verdict.distance_metres <= (
        _SEEDED_RADIUS_METRES + _SEEDED_TOLERANCE_METRES
    )


def test_the_first_failing_waypoint_clears_the_band_rather_than_grazing_it() -> None:
    """260 m must fail, and fail by enough that float noise cannot flip it."""
    waypoint = DEMO_WAYPOINTS_BY_ID[WAYPOINT_OUTSIDE_TOLERANCE]

    verdict = evaluate_geofence(
        TrackerFix(lat=waypoint.latitude, lng=waypoint.longitude),
        _anchor_precinct(),
        tolerance_metres=_SEEDED_TOLERANCE_METRES,
    )

    assert verdict.confirmed is False
    assert verdict.in_tolerance_band is False
    assert verdict.distance_metres > _SEEDED_RADIUS_METRES + _SEEDED_TOLERANCE_METRES


def test_no_signal_waypoint_carries_no_coordinates_at_all() -> None:
    """It is the tracker going dark, not a place. A 0.0 here would be a real location."""
    waypoint = DEMO_WAYPOINTS_BY_ID[WAYPOINT_NO_SIGNAL]

    assert waypoint.is_no_signal is True
    assert waypoint.latitude is None
    assert waypoint.longitude is None
    assert waypoint.intended_distance_metres is None
    assert waypoint.expected_confirmed is None


def test_no_signal_produces_no_fix_rather_than_a_failed_verdict() -> None:
    """A dark tracker must not read as evidence against the driver."""
    verdict = evaluate_geofence(None, _anchor_precinct(), tolerance_metres=_SEEDED_TOLERANCE_METRES)

    assert verdict.reason is GeofenceVerdictReason.NO_FIX
    assert verdict.distance_metres is None


def test_waypoints_are_ordered_and_uniquely_identified() -> None:
    ids = [w.waypoint_id for w in DEMO_WAYPOINTS]
    sequences = [w.sequence for w in DEMO_WAYPOINTS]

    assert ids == [
        WAYPOINT_PRECINCT, WAYPOINT_INSIDE_TOLERANCE, WAYPOINT_OUTSIDE_TOLERANCE,
        WAYPOINT_THREE_KM, WAYPOINT_FIFTY_KM, WAYPOINT_NO_SIGNAL,
    ]
    assert len(set(ids)) == len(ids)
    assert sequences == sorted(sequences)
    assert sequences == list(range(1, len(DEMO_WAYPOINTS) + 1))


def test_distances_increase_along_the_route() -> None:
    """The presenter steps down the list; the truck must get further away, not jump."""
    distances = [
        w.intended_distance_metres for w in DEMO_WAYPOINTS if w.intended_distance_metres is not None
    ]

    assert distances == sorted(distances)


def test_reset_returns_to_the_precinct_waypoint() -> None:
    assert RESET_WAYPOINT_ID == WAYPOINT_PRECINCT
    assert DEMO_WAYPOINTS_BY_ID[RESET_WAYPOINT_ID].intended_distance_metres == 0


def test_precinct_waypoint_sits_exactly_on_the_anchor() -> None:
    waypoint = DEMO_WAYPOINTS_BY_ID[WAYPOINT_PRECINCT]

    assert waypoint.latitude == DEMO_ANCHOR_LATITUDE
    assert waypoint.longitude == DEMO_ANCHOR_LONGITUDE
    assert _measured_distance(waypoint) == pytest.approx(0.0, abs=0.01)


def test_headline_waypoints_are_the_advertised_round_numbers() -> None:
    """3 km and 50 km are quoted out loud on stage — they must be those numbers."""
    assert DEMO_WAYPOINTS_BY_ID[WAYPOINT_THREE_KM].intended_distance_metres == 3_000
    assert DEMO_WAYPOINTS_BY_ID[WAYPOINT_FIFTY_KM].intended_distance_metres == 50_000


def test_get_waypoint_resolves_known_ids_and_rejects_unknown_ones() -> None:
    assert get_waypoint(WAYPOINT_THREE_KM) is DEMO_WAYPOINTS_BY_ID[WAYPOINT_THREE_KM]
    assert get_waypoint("nowhere") is None


def test_anchor_matches_the_default_radius_the_geofence_service_assumes() -> None:
    """Guards the seeded 200 m against a silent change in the service's fallback."""
    assert DEFAULT_GEOFENCE_RADIUS_METRES == _SEEDED_RADIUS_METRES
