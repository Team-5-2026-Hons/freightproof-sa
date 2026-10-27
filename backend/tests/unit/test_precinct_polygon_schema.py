"""Validation rules for a precinct's property outline (schemas/organisations.py)."""

import pytest
from pydantic import ValidationError

from app.schemas.organisations import PrecinctCreateBody, PrecinctUpdateBody

_PIN = {"latitude": -29.7942, "longitude": 30.9820}
_BOX = [[-29.7937, 30.9815], [-29.7937, 30.9825], [-29.7947, 30.9825], [-29.7947, 30.9815]]


def _body(**overrides: object) -> dict[str, object]:
    return {"name": "Outline Depot", **_PIN, "geofence_polygon": _BOX, **overrides}


def test_valid_outline_is_accepted_as_lat_lng_lists():
    body = PrecinctCreateBody.model_validate(_body())

    assert body.geofence_polygon == _BOX
    assert all(isinstance(corner, list) for corner in body.geofence_polygon or [])


def test_closed_ring_is_opened():
    body = PrecinctCreateBody.model_validate(_body(geofence_polygon=[*_BOX, _BOX[0]]))

    assert body.geofence_polygon == _BOX


def test_corners_are_rounded_to_column_precision():
    noisy = [[lat + 1e-10, lng] for lat, lng in _BOX]

    body = PrecinctCreateBody.model_validate(_body(geofence_polygon=noisy))

    assert body.geofence_polygon == _BOX


def test_outline_is_optional():
    assert PrecinctCreateBody.model_validate(_body(geofence_polygon=None)).geofence_polygon is None


@pytest.mark.parametrize(
    ("polygon", "message"),
    [
        (_BOX[:2], "at least 3"),
        ([_BOX[0], _BOX[2], _BOX[1], _BOX[3]], "crosses itself"),
        ([[-29.79420, 30.98200], [-29.79420, 30.98210], [-29.79429, 30.98210], [-29.79429, 30.98200]], "too small"),
        ([[-29.70, 30.90], [-29.70, 31.10], [-29.90, 31.10], [-29.90, 30.90]], "too large"),
        ([[-29.7937, 30.9815], [-29.7937, 200.0], [-29.7947, 30.9825]], "less than or equal to 180"),
    ],
)
def test_invalid_outlines_are_rejected(polygon: list[list[float]], message: str):
    with pytest.raises(ValidationError, match=message):
        PrecinctCreateBody.model_validate(_body(geofence_polygon=polygon))


def test_pin_far_outside_the_outline_is_rejected():
    with pytest.raises(ValidationError, match="outside the outline"):
        PrecinctCreateBody.model_validate(_body(latitude=-29.80, longitude=30.99))


def test_pin_just_outside_the_outline_is_accepted():
    body = PrecinctCreateBody.model_validate(_body(longitude=30.9828))

    assert body.geofence_polygon is not None


def test_patch_accepts_explicit_null_to_remove_the_outline():
    body = PrecinctUpdateBody.model_validate({"geofence_polygon": None})

    assert body.model_dump(exclude_unset=True) == {"geofence_polygon": None}
