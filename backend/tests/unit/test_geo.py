"""Unit tests for app.core.geo — pure math, no DB, no HTTP.

Coordinates are real South African locations (this is a South African system),
chosen to exercise the geofence-relevant near-field case, the equator, and the
antimeridian, alongside a textbook-scale reference distance.
"""

import math
from decimal import Decimal

import pytest

from app.core.geo import EARTH_RADIUS_METRES, format_distance, haversine_metres

CAPE_TOWN = (-33.9249, 18.4241)

JOHANNESBURG = (-26.2041, 28.0473)

DURBAN = (-29.8587, 31.0218)

CAPE_TOWN_NEARBY = (-33.9280, 18.4260)

CAPE_TOWN_ANTIPODE = (33.9249, -161.5759)


def test_known_distance_cape_town_to_johannesburg_matches_reference():
    lat1, lng1 = CAPE_TOWN
    lat2, lng2 = JOHANNESBURG
    expected_metres = 1_261_570
    tolerance_metres = 2_000

    distance = haversine_metres(lat1, lng1, lat2, lng2)

    assert distance == pytest.approx(expected_metres, abs=tolerance_metres)


def test_identical_points_return_zero_distance():
    lat, lng = CAPE_TOWN

    distance = haversine_metres(lat, lng, lat, lng)

    assert distance == 0.0


def test_distance_is_symmetric():
    lat1, lng1 = CAPE_TOWN
    lat2, lng2 = JOHANNESBURG

    forward = haversine_metres(lat1, lng1, lat2, lng2)
    backward = haversine_metres(lat2, lng2, lat1, lng1)

    assert forward == pytest.approx(backward)


def test_equator_crossing_two_degrees_latitude():
    expected_metres = 222_400
    tolerance_metres = 500

    distance = haversine_metres(1.0, 30.0, -1.0, 30.0)

    assert distance == pytest.approx(expected_metres, abs=tolerance_metres)


def test_antimeridian_crossing_stays_small():
    expected_metres = 22_240
    tolerance_metres = 500

    distance = haversine_metres(0.0, 179.9, 0.0, -179.9)

    assert distance == pytest.approx(expected_metres, abs=tolerance_metres)


def test_durban_to_johannesburg_matches_known_scale():
    lat1, lng1 = DURBAN
    lat2, lng2 = JOHANNESBURG
    expected_metres = 500_000
    tolerance_metres = 5_000

    distance = haversine_metres(lat1, lng1, lat2, lng2)

    assert distance == pytest.approx(expected_metres, abs=tolerance_metres)


def test_intra_city_pair_in_hundreds_of_metres_range():
    lat1, lng1 = CAPE_TOWN
    lat2, lng2 = CAPE_TOWN_NEARBY
    expected_metres = 386.7
    tolerance_metres = 5

    distance = haversine_metres(lat1, lng1, lat2, lng2)

    assert distance == pytest.approx(expected_metres, abs=tolerance_metres)


def test_decimal_input_matches_float_equivalent():
    lat1, lng1 = CAPE_TOWN
    lat2, lng2 = JOHANNESBURG

    float_distance = haversine_metres(lat1, lng1, lat2, lng2)
    decimal_distance = haversine_metres(
        Decimal("-33.9249"), Decimal("18.4241"), Decimal("-26.2041"), Decimal("28.0473")
    )

    assert decimal_distance == pytest.approx(float_distance)


def test_out_of_range_latitude_raises_value_error():
    invalid_lat = 90.0001

    with pytest.raises(ValueError):
        haversine_metres(invalid_lat, 18.4241, -26.2041, 28.0473)


def test_out_of_range_longitude_raises_value_error():
    invalid_lng = -180.0001

    with pytest.raises(ValueError):
        haversine_metres(-33.9249, invalid_lng, -26.2041, 28.0473)


def test_nan_coordinate_raises_value_error():
    nan_lat = math.nan

    with pytest.raises(ValueError):
        haversine_metres(nan_lat, 18.4241, -26.2041, 28.0473)


def test_boundary_coordinates_are_accepted_not_rejected():
    lat1, lng1 = 90.0, 180.0
    lat2, lng2 = -90.0, -180.0

    distance = haversine_metres(lat1, lng1, lat2, lng2)

    assert distance == pytest.approx(math.pi * EARTH_RADIUS_METRES, rel=1e-9)


def test_near_antipodal_pair_returns_finite_distance_not_domain_error():
    lat1, lng1 = CAPE_TOWN
    lat2, lng2 = CAPE_TOWN_ANTIPODE
    expected_metres = math.pi * EARTH_RADIUS_METRES

    distance = haversine_metres(lat1, lng1, lat2, lng2)

    assert math.isfinite(distance)
    assert distance == pytest.approx(expected_metres, rel=1e-3)


@pytest.mark.parametrize(
    ("metres", "expected"),
    [
        (0, "0 m"),
        (299.6, "300 m"),
        (999.4, "999 m"),
        (999.6, "1000 m"),
        (1000, "1.0 km"),
        (1549, "1.5 km"),
        (25_000, "25.0 km"),
    ],
)
def test_format_distance_switches_units_at_one_kilometre(metres: float, expected: str) -> None:
    result = format_distance(metres)

    assert result == expected


def test_format_distance_accepts_an_int_input() -> None:
    result = format_distance(300)

    assert result == "300 m"
