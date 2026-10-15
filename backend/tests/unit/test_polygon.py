"""Unit tests for core/polygon.py — the plane geometry behind outline geofences."""

import pytest

from app.core import polygon as geo

# ~97 m (east-west) × ~111 m (north-south) box around a Durban depot pin.
_BOX = [(-29.7937, 30.9815), (-29.7937, 30.9825), (-29.7947, 30.9825), (-29.7947, 30.9815)]
_CENTRE = (-29.7942, 30.9820)

# An L-shaped yard: the corner average lands in the missing square, outside the outline.
_L_SHAPE = [
    (-29.7900, 30.9800), (-29.7900, 30.9840), (-29.7910, 30.9840),
    (-29.7910, 30.9810), (-29.7940, 30.9810), (-29.7940, 30.9800),
]


def test_contains_point_inside_and_outside():
    assert geo.contains(_BOX, _CENTRE) is True
    assert geo.contains(_BOX, (-29.7942, 30.9840)) is False


def test_contains_respects_a_concave_notch():
    # Inside the L's bounding box but in its missing square.
    assert geo.contains(_L_SHAPE, (-29.7930, 30.9830)) is False
    assert geo.contains(_L_SHAPE, (-29.7905, 30.9830)) is True


def test_distance_to_boundary_from_outside():
    # 0.001° of longitude east of the box's east edge at -29.79° ≈ 96.6 m.
    distance = geo.distance_to_boundary_metres(_BOX, (-29.7942, 30.9835))

    assert distance == pytest.approx(96.6, abs=1.0)


def test_distance_to_boundary_from_inside_is_to_the_nearest_edge():
    distance = geo.distance_to_boundary_metres(_BOX, _CENTRE)

    assert distance == pytest.approx(48.3, abs=1.0)


def test_area_matches_width_times_height():
    assert geo.area_square_metres(_BOX) == pytest.approx(96.6 * 111.2, rel=0.01)


def test_area_ignores_corner_order():
    assert geo.area_square_metres(list(reversed(_BOX))) == pytest.approx(geo.area_square_metres(_BOX))


def test_is_simple_accepts_box_and_concave_outline():
    assert geo.is_simple(_BOX) is True
    assert geo.is_simple(_L_SHAPE) is True


def test_is_simple_rejects_a_figure_of_eight():
    bowtie = [_BOX[0], _BOX[2], _BOX[1], _BOX[3]]

    assert geo.is_simple(bowtie) is False


def test_is_simple_rejects_repeated_corners_and_too_few():
    assert geo.is_simple([_BOX[0], _BOX[1], _BOX[1], _BOX[2]]) is False
    assert geo.is_simple(_BOX[:2]) is False


def test_interior_point_is_inside_convex_and_concave():
    assert geo.contains(_BOX, geo.interior_point(_BOX))
    assert geo.contains(_L_SHAPE, geo.interior_point(_L_SHAPE))
