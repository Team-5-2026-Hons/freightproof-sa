"""Unit tests for app.core.geo — pure math, no DB, no HTTP.

Coordinates are real South African locations (this is a South African system),
chosen to exercise the geofence-relevant near-field case, the equator, and the
antimeridian, alongside a textbook-scale reference distance.
"""

import math
from decimal import Decimal

import pytest

from app.core.geo import EARTH_RADIUS_METRES, haversine_metres

# Cape Town city centre.
CAPE_TOWN = (-33.9249, 18.4241)

# Johannesburg city centre.
JOHANNESBURG = (-26.2041, 28.0473)

# Durban city centre.
DURBAN = (-29.8587, 31.0218)

# A second Cape Town CBD point ~387 m from CAPE_TOWN, in the hundreds-of-metres
# range that a 200 m geofence radius actually depends on.
CAPE_TOWN_NEARBY = (-33.9280, 18.4260)

# Approximate antipode of CAPE_TOWN (lat negated, lng shifted by 180 degrees).
CAPE_TOWN_ANTIPODE = (33.9249, -161.5759)


def test_known_distance_cape_town_to_johannesburg_matches_reference():
    # Arrange: great-circle distance for these exact coordinates with
    # R = EARTH_RADIUS_METRES is ~1,261,570 m (~1261.6 km), consistent with the
    # commonly published ~1,260 km CPT-JHB great-circle figure.
    lat1, lng1 = CAPE_TOWN
    lat2, lng2 = JOHANNESBURG
    expected_metres = 1_261_570
    tolerance_metres = 2_000

    # Act
    distance = haversine_metres(lat1, lng1, lat2, lng2)

    # Assert
    assert distance == pytest.approx(expected_metres, abs=tolerance_metres)


def test_identical_points_return_zero_distance():
    # Arrange
    lat, lng = CAPE_TOWN

    # Act
    distance = haversine_metres(lat, lng, lat, lng)

    # Assert
    assert distance == 0.0


def test_distance_is_symmetric():
    # Arrange
    lat1, lng1 = CAPE_TOWN
    lat2, lng2 = JOHANNESBURG

    # Act
    forward = haversine_metres(lat1, lng1, lat2, lng2)
    backward = haversine_metres(lat2, lng2, lat1, lng1)

    # Assert
    assert forward == pytest.approx(backward)


def test_equator_crossing_two_degrees_latitude():
    # Arrange: 2 degrees of latitude straddling the equator, held at fixed
    # longitude, is ~222,400 m (one degree of latitude is ~111.2 km).
    expected_metres = 222_400
    tolerance_metres = 500

    # Act
    distance = haversine_metres(1.0, 30.0, -1.0, 30.0)

    # Assert
    assert distance == pytest.approx(expected_metres, abs=tolerance_metres)


def test_antimeridian_crossing_stays_small():
    # Arrange: these two points are only 0.2 degrees of longitude apart at the
    # equator (179.9 -> -179.9 wraps around, it does not span the globe), which
    # is ~22,240 m. A naive implementation that subtracts raw longitudes without
    # wrapping (179.9 - (-179.9) = 359.8 degrees) would instead compute a distance
    # of roughly half the Earth's circumference (~40,000 km) — this test exists
    # to catch exactly that failure mode.
    expected_metres = 22_240
    tolerance_metres = 500

    # Act
    distance = haversine_metres(0.0, 179.9, 0.0, -179.9)

    # Assert
    assert distance == pytest.approx(expected_metres, abs=tolerance_metres)


def test_durban_to_johannesburg_matches_known_scale():
    # Arrange: Durban to Johannesburg great-circle distance is ~500 km.
    lat1, lng1 = DURBAN
    lat2, lng2 = JOHANNESBURG
    expected_metres = 500_000
    tolerance_metres = 5_000

    # Act
    distance = haversine_metres(lat1, lng1, lat2, lng2)

    # Assert
    assert distance == pytest.approx(expected_metres, abs=tolerance_metres)


def test_intra_city_pair_in_hundreds_of_metres_range():
    # Arrange: near-field behaviour is what a 200 m geofence radius actually
    # depends on, so this pair is deliberately close rather than continental.
    lat1, lng1 = CAPE_TOWN
    lat2, lng2 = CAPE_TOWN_NEARBY
    expected_metres = 386.7
    tolerance_metres = 5

    # Act
    distance = haversine_metres(lat1, lng1, lat2, lng2)

    # Assert
    assert distance == pytest.approx(expected_metres, abs=tolerance_metres)


def test_decimal_input_matches_float_equivalent():
    # Arrange: precinct coordinates arrive as Decimal (Numeric(10,7)) off the model.
    lat1, lng1 = CAPE_TOWN
    lat2, lng2 = JOHANNESBURG

    # Act
    float_distance = haversine_metres(lat1, lng1, lat2, lng2)
    decimal_distance = haversine_metres(
        Decimal("-33.9249"), Decimal("18.4241"), Decimal("-26.2041"), Decimal("28.0473")
    )

    # Assert
    assert decimal_distance == pytest.approx(float_distance)


def test_out_of_range_latitude_raises_value_error():
    # Arrange
    invalid_lat = 90.0001

    # Act / Assert
    with pytest.raises(ValueError):
        haversine_metres(invalid_lat, 18.4241, -26.2041, 28.0473)


def test_out_of_range_longitude_raises_value_error():
    # Arrange
    invalid_lng = -180.0001

    # Act / Assert
    with pytest.raises(ValueError):
        haversine_metres(-33.9249, invalid_lng, -26.2041, 28.0473)


def test_nan_coordinate_raises_value_error():
    # Arrange
    nan_lat = math.nan

    # Act / Assert
    with pytest.raises(ValueError):
        haversine_metres(nan_lat, 18.4241, -26.2041, 28.0473)


def test_boundary_coordinates_are_accepted_not_rejected():
    # Arrange: +/-90 latitude and +/-180 longitude are legitimate (poles and the
    # antimeridian), so bounds must be inclusive rather than strict.
    lat1, lng1 = 90.0, 180.0
    lat2, lng2 = -90.0, -180.0

    # Act
    distance = haversine_metres(lat1, lng1, lat2, lng2)

    # Assert: pole-to-pole distance is half the Earth's circumference.
    assert distance == pytest.approx(math.pi * EARTH_RADIUS_METRES, rel=1e-9)


def test_near_antipodal_pair_returns_finite_distance_not_domain_error():
    # Arrange: near-antipodal points push the haversine intermediate value h to
    # ~1.0, where floating-point rounding can nudge sqrt(h) fractionally above 1
    # and make math.asin raise "math domain error" on an otherwise legitimate
    # pair of coordinates. This must return a distance, not crash.
    lat1, lng1 = CAPE_TOWN
    lat2, lng2 = CAPE_TOWN_ANTIPODE
    expected_metres = math.pi * EARTH_RADIUS_METRES

    # Act
    distance = haversine_metres(lat1, lng1, lat2, lng2)

    # Assert
    assert math.isfinite(distance)
    assert distance == pytest.approx(expected_metres, rel=1e-3)
