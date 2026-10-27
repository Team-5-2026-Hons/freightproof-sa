"""Unit tests for app.orchestration.evidence.geofence — pure logic, no DB, no HTTP.

Precinct rows are constructed in memory (never persisted) following the pattern in
tests/integration/test_verification_service.py. Coordinates are real South African depot
locations (this is a South African system): a Durban precinct is the fixed centre,
compared against nearby Durban-area points for the in/near/out cases.
"""

import dataclasses
import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest

from app.core.config import settings
from app.db.models.organisations import Precinct
from app.orchestration.evidence.geofence import (
    DEFAULT_GEOFENCE_RADIUS_METRES,
    GeofenceVerdictReason,
    TrackerFix,
    evaluate_geofence,
)
from app.schemas.organisations import _RADIUS_DEFAULT_METRES

DURBAN_PRECINCT_LAT = Decimal("-29.7942000")
DURBAN_PRECINCT_LNG = Decimal("30.9820000")

DURBAN_NEARBY_LAT = -29.7950
DURBAN_NEARBY_LNG = 30.9825

JOHANNESBURG_LAT = -26.2041
JOHANNESBURG_LNG = 28.0473


def _make_precinct(
    *,
    latitude: Decimal | None = DURBAN_PRECINCT_LAT,
    longitude: Decimal | None = DURBAN_PRECINCT_LNG,
    geofence_radius_metres: int | None = 200,
) -> Precinct:
    """A Precinct built without a DB session — mirrors the construction pattern in
    test_verification_service.py's seed helpers, minus the flush."""
    return Precinct(
        id=uuid.uuid4(),
        name="Test Precinct",
        principal_organization_id=uuid.uuid4(),
        latitude=latitude,
        longitude=longitude,
        geofence_radius_metres=geofence_radius_metres,
        is_shared=False,
    )


def test_fix_cleanly_inside_radius_is_confirmed_outside_tolerance_band():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=200)

    verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    assert verdict.confirmed is True
    assert verdict.in_tolerance_band is False
    assert verdict.reason == GeofenceVerdictReason.MEASURED


def test_fix_cleanly_outside_radius_and_tolerance_is_not_confirmed():
    fix = TrackerFix(lat=JOHANNESBURG_LAT, lng=JOHANNESBURG_LNG)
    precinct = _make_precinct(geofence_radius_metres=200)

    verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    assert verdict.confirmed is False
    assert verdict.in_tolerance_band is False
    assert verdict.reason == GeofenceVerdictReason.MEASURED


def test_fix_inside_tolerance_band_is_confirmed_and_flagged_marginal():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=10)

    verdict = evaluate_geofence(fix, precinct, tolerance_metres=200)

    assert verdict.confirmed is True
    assert verdict.in_tolerance_band is True
    assert verdict.radius_metres == 10
    assert verdict.distance_metres is not None
    assert 10 < verdict.distance_metres <= 210



def test_distance_exactly_at_radius_is_confirmed_and_not_in_tolerance_band():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=200)

    with patch("app.orchestration.evidence.geofence.haversine_metres", return_value=200.0):
        verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    assert verdict.confirmed is True
    assert verdict.in_tolerance_band is False
    assert verdict.distance_metres == 200.0


def test_distance_exactly_at_radius_plus_tolerance_is_confirmed_and_in_band():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=200)

    with patch("app.orchestration.evidence.geofence.haversine_metres", return_value=250.0):
        verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    assert verdict.confirmed is True
    assert verdict.in_tolerance_band is True
    assert verdict.distance_metres == 250.0


def test_distance_one_metre_beyond_tolerance_is_not_confirmed():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=200)

    with patch("app.orchestration.evidence.geofence.haversine_metres", return_value=251.0):
        verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    assert verdict.confirmed is False
    assert verdict.in_tolerance_band is False



def test_none_fix_returns_no_fix_reason():
    precinct = _make_precinct()

    verdict = evaluate_geofence(None, precinct)

    assert verdict.confirmed is False
    assert verdict.distance_metres is None
    assert verdict.in_tolerance_band is False
    assert verdict.reason == GeofenceVerdictReason.NO_FIX


def test_none_precinct_returns_no_precinct_coordinates_reason():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)

    verdict = evaluate_geofence(fix, None)

    assert verdict.confirmed is False
    assert verdict.distance_metres is None
    assert verdict.reason == GeofenceVerdictReason.NO_PRECINCT_COORDINATES


def test_precinct_with_none_latitude_returns_no_precinct_coordinates_reason():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(latitude=None)

    verdict = evaluate_geofence(fix, precinct)

    assert verdict.reason == GeofenceVerdictReason.NO_PRECINCT_COORDINATES
    assert verdict.confirmed is False


def test_precinct_with_none_longitude_returns_no_precinct_coordinates_reason():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(longitude=None)

    verdict = evaluate_geofence(fix, precinct)

    assert verdict.reason == GeofenceVerdictReason.NO_PRECINCT_COORDINATES
    assert verdict.confirmed is False


def test_none_radius_falls_back_to_default_and_verdict_reports_it():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=None)

    verdict = evaluate_geofence(fix, precinct)

    assert verdict.radius_metres == DEFAULT_GEOFENCE_RADIUS_METRES



def test_verdict_reports_explicitly_passed_tolerance():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct()
    explicit_tolerance = 75

    verdict = evaluate_geofence(fix, precinct, tolerance_metres=explicit_tolerance)

    assert verdict.tolerance_metres == explicit_tolerance


def test_default_tolerance_comes_from_settings_when_omitted():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct()

    verdict = evaluate_geofence(fix, precinct)

    assert verdict.tolerance_metres == settings.GPS_TOLERANCE_METRES



def test_decimal_precinct_coordinates_match_float_fix_coordinates():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(
        latitude=DURBAN_PRECINCT_LAT, longitude=DURBAN_PRECINCT_LNG, geofence_radius_metres=200,
    )

    verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    assert verdict.reason == GeofenceVerdictReason.MEASURED
    assert isinstance(verdict.distance_metres, float)



def test_default_radius_constant_matches_schema_default():
    assert DEFAULT_GEOFENCE_RADIUS_METRES == 200
    assert DEFAULT_GEOFENCE_RADIUS_METRES == _RADIUS_DEFAULT_METRES



def test_geofence_verdict_is_immutable():
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct()
    verdict = evaluate_geofence(fix, precinct)

    with pytest.raises(dataclasses.FrozenInstanceError):
        verdict.confirmed = False  # type: ignore[misc]
