"""Unit tests for app.orchestration.geofence_service — pure logic, no DB, no HTTP.

Precinct rows are constructed in memory (never persisted) following the pattern in
tests/unit/test_verification_service.py. Coordinates are real South African depot
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
from app.orchestration.geofence_service import (
    DEFAULT_GEOFENCE_RADIUS_METRES,
    GeofenceVerdictReason,
    TrackerFix,
    evaluate_geofence,
)
from app.schemas.organisations import _RADIUS_DEFAULT_METRES

# Riverhorse Valley, Durban — a real precinct location already used as a fixture
# elsewhere in this suite (tests/unit/test_verification_service.py).
DURBAN_PRECINCT_LAT = Decimal("-29.7942000")
DURBAN_PRECINCT_LNG = Decimal("30.9820000")

# ~101 m from the precinct centre — well inside a 200 m radius.
DURBAN_NEARBY_LAT = -29.7950
DURBAN_NEARBY_LNG = 30.9825

# Johannesburg CBD — many hundreds of km from the Durban precinct, i.e. cleanly
# beyond any radius + tolerance this test file uses.
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
    # Arrange
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=200)

    # Act
    verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    # Assert
    assert verdict.confirmed is True
    assert verdict.in_tolerance_band is False
    assert verdict.reason == GeofenceVerdictReason.MEASURED


def test_fix_cleanly_outside_radius_and_tolerance_is_not_confirmed():
    # Arrange
    fix = TrackerFix(lat=JOHANNESBURG_LAT, lng=JOHANNESBURG_LNG)
    precinct = _make_precinct(geofence_radius_metres=200)

    # Act
    verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    # Assert
    assert verdict.confirmed is False
    assert verdict.in_tolerance_band is False
    assert verdict.reason == GeofenceVerdictReason.MEASURED


def test_fix_inside_tolerance_band_is_confirmed_and_flagged_marginal():
    # Arrange: a precinct with a deliberately tiny radius so the real ~101 m nearby
    # fix lands between radius (10 m) and radius + tolerance (10 + 200 = 210 m).
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=10)

    # Act
    verdict = evaluate_geofence(fix, precinct, tolerance_metres=200)

    # Assert
    assert verdict.confirmed is True
    assert verdict.in_tolerance_band is True
    assert verdict.radius_metres == 10
    assert verdict.distance_metres is not None
    assert 10 < verdict.distance_metres <= 210


# ── Exact-boundary comparison semantics ────────────────────────────────────────
#
# Real lat/lng pairs cannot be made to land on an exact integer-metre boundary, and
# asserting on a float that merely approximates 200.0 would test nothing. These three
# tests patch haversine_metres directly to pin the >, <=, comparison semantics in
# evaluate_geofence itself — the maths behind the distance is covered by
# tests/unit/test_geo.py and by the real-coordinate tests above.


def test_distance_exactly_at_radius_is_confirmed_and_not_in_tolerance_band():
    # Arrange: radius=200, tolerance=50, distance patched to exactly 200.0.
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=200)

    # Act
    with patch("app.orchestration.geofence_service.haversine_metres", return_value=200.0):
        verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    # Assert
    assert verdict.confirmed is True
    assert verdict.in_tolerance_band is False
    assert verdict.distance_metres == 200.0


def test_distance_exactly_at_radius_plus_tolerance_is_confirmed_and_in_band():
    # Arrange: radius=200, tolerance=50, distance patched to exactly 250.0.
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=200)

    # Act
    with patch("app.orchestration.geofence_service.haversine_metres", return_value=250.0):
        verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    # Assert
    assert verdict.confirmed is True
    assert verdict.in_tolerance_band is True
    assert verdict.distance_metres == 250.0


def test_distance_one_metre_beyond_tolerance_is_not_confirmed():
    # Arrange: radius=200, tolerance=50, distance patched to 251.0 — one metre past
    # the widened boundary.
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=200)

    # Act
    with patch("app.orchestration.geofence_service.haversine_metres", return_value=251.0):
        verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    # Assert
    assert verdict.confirmed is False
    assert verdict.in_tolerance_band is False


# ── Missing-data handling ───────────────────────────────────────────────────────


def test_none_fix_returns_no_fix_reason():
    # Arrange
    precinct = _make_precinct()

    # Act
    verdict = evaluate_geofence(None, precinct)

    # Assert
    assert verdict.confirmed is False
    assert verdict.distance_metres is None
    assert verdict.in_tolerance_band is False
    assert verdict.reason == GeofenceVerdictReason.NO_FIX


def test_none_precinct_returns_no_precinct_coordinates_reason():
    # Arrange
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)

    # Act
    verdict = evaluate_geofence(fix, None)

    # Assert
    assert verdict.confirmed is False
    assert verdict.distance_metres is None
    assert verdict.reason == GeofenceVerdictReason.NO_PRECINCT_COORDINATES


def test_precinct_with_none_latitude_returns_no_precinct_coordinates_reason():
    # Arrange
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(latitude=None)

    # Act
    verdict = evaluate_geofence(fix, precinct)

    # Assert
    assert verdict.reason == GeofenceVerdictReason.NO_PRECINCT_COORDINATES
    assert verdict.confirmed is False


def test_precinct_with_none_longitude_returns_no_precinct_coordinates_reason():
    # Arrange
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(longitude=None)

    # Act
    verdict = evaluate_geofence(fix, precinct)

    # Assert
    assert verdict.reason == GeofenceVerdictReason.NO_PRECINCT_COORDINATES
    assert verdict.confirmed is False


def test_none_radius_falls_back_to_default_and_verdict_reports_it():
    # Arrange
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=None)

    # Act
    verdict = evaluate_geofence(fix, precinct)

    # Assert
    assert verdict.radius_metres == DEFAULT_GEOFENCE_RADIUS_METRES


# ── Tolerance reporting ─────────────────────────────────────────────────────────


def test_verdict_reports_explicitly_passed_tolerance():
    # Arrange
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct()
    explicit_tolerance = 75

    # Act
    verdict = evaluate_geofence(fix, precinct, tolerance_metres=explicit_tolerance)

    # Assert
    assert verdict.tolerance_metres == explicit_tolerance


def test_default_tolerance_comes_from_settings_when_omitted():
    # Arrange
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct()

    # Act
    verdict = evaluate_geofence(fix, precinct)

    # Assert
    assert verdict.tolerance_metres == settings.GPS_TOLERANCE_METRES


# ── Decimal vs float coordinates ────────────────────────────────────────────────


def test_decimal_precinct_coordinates_match_float_fix_coordinates():
    # Arrange: precinct coordinates as they arrive off the model (Decimal), fix
    # coordinates as they arrive from a tracker API (float).
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct(
        latitude=DURBAN_PRECINCT_LAT, longitude=DURBAN_PRECINCT_LNG, geofence_radius_metres=200,
    )

    # Act
    verdict = evaluate_geofence(fix, precinct, tolerance_metres=50)

    # Assert: no exception, and a real distance was computed.
    assert verdict.reason == GeofenceVerdictReason.MEASURED
    assert isinstance(verdict.distance_metres, float)


# ── Drift guard ──────────────────────────────────────────────────────────────────


def test_default_radius_constant_matches_schema_default():
    # Assert: the two authoritative sources this module's fallback mirrors must
    # never silently diverge.
    assert DEFAULT_GEOFENCE_RADIUS_METRES == 200
    assert DEFAULT_GEOFENCE_RADIUS_METRES == _RADIUS_DEFAULT_METRES


# ── Immutability ───────────────────────────────────────────────────────────────


def test_geofence_verdict_is_immutable():
    # Arrange
    fix = TrackerFix(lat=DURBAN_NEARBY_LAT, lng=DURBAN_NEARBY_LNG)
    precinct = _make_precinct()
    verdict = evaluate_geofence(fix, precinct)

    # Act / Assert
    with pytest.raises(dataclasses.FrozenInstanceError):
        verdict.confirmed = False  # type: ignore[misc]
