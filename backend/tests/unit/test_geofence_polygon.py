"""evaluate_geofence against a property outline: inside counts, outside counts only
within the GPS tolerance band measured from the nearest edge."""

import uuid
from decimal import Decimal

from app.db.models.organisations import Precinct
from app.orchestration.evidence.geofence import (
    GeofenceShape, GeofenceVerdictReason, TrackerFix, evaluate_geofence,
)

_TOLERANCE = 50
_BOX = [[-29.7937, 30.9815], [-29.7937, 30.9825], [-29.7947, 30.9825], [-29.7947, 30.9815]]


def _outline_precinct(radius: int = 5000) -> Precinct:
    # A huge radius on purpose: if the circle were consulted, every fix below would pass.
    return Precinct(
        id=uuid.uuid4(), name="Outline Depot", principal_organization_id=uuid.uuid4(),
        latitude=Decimal("-29.7942"), longitude=Decimal("30.9820"),
        geofence_radius_metres=radius, geofence_polygon=_BOX, is_shared=False,
    )


def test_fix_inside_outline_is_confirmed_at_zero_distance():
    verdict = evaluate_geofence(TrackerFix(lat=-29.7942, lng=30.9820), _outline_precinct(), tolerance_metres=_TOLERANCE)

    assert verdict.confirmed is True
    assert verdict.distance_metres == 0.0
    assert verdict.in_tolerance_band is False
    assert verdict.shape is GeofenceShape.POLYGON
    assert verdict.radius_metres is None
    assert verdict.reason is GeofenceVerdictReason.MEASURED


def test_fix_just_outside_outline_is_in_the_tolerance_band():
    # ~29 m east of the east edge (0.0003° lng at -29.79°).
    verdict = evaluate_geofence(TrackerFix(lat=-29.7942, lng=30.9828), _outline_precinct(), tolerance_metres=_TOLERANCE)

    assert verdict.confirmed is True
    assert verdict.in_tolerance_band is True
    assert 25 < (verdict.distance_metres or 0) < 35


def test_fix_beyond_tolerance_is_not_confirmed_even_inside_the_old_radius():
    # ~97 m east of the edge — well inside the 5 km radius that is no longer the fence.
    verdict = evaluate_geofence(TrackerFix(lat=-29.7942, lng=30.9835), _outline_precinct(), tolerance_metres=_TOLERANCE)

    assert verdict.confirmed is False
    assert verdict.in_tolerance_band is False
    assert (verdict.distance_metres or 0) > _TOLERANCE


def test_precinct_without_outline_still_uses_the_circle():
    precinct = _outline_precinct(radius=200)
    precinct.geofence_polygon = None

    verdict = evaluate_geofence(TrackerFix(lat=-29.7942, lng=30.9835), precinct, tolerance_metres=_TOLERANCE)

    assert verdict.shape is GeofenceShape.CIRCLE
    assert verdict.radius_metres == 200
    assert verdict.confirmed is True


def test_missing_fix_is_not_measured_for_an_outline_either():
    verdict = evaluate_geofence(None, _outline_precinct(), tolerance_metres=_TOLERANCE)

    assert verdict.reason is GeofenceVerdictReason.NO_FIX
    assert verdict.confirmed is False
