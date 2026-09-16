"""Unit tests for app.orchestration.proximity_service — pure logic, no DB, no HTTP.

Coordinates are generated from ONE base point (Riverhorse Valley, Durban — the same
precinct fixture used by tests/unit/test_geofence_service.py) via `_offset_east`, a
spherical destination-point helper verified against `haversine_metres` below, rather
than hardcoded as unexplained lat/lng pairs. `evaluated_at` is always passed in
explicitly (an injected clock) — nothing here ever calls datetime.now().

Also includes side-by-side yard-membership tests (evaluate_geofence +
evaluate_proximity, run on the same fixes) demonstrating that precinct membership
and driver/truck separation are independent facts — no assembled
ActionLocationAssessment yet, that is Task 5's job.
"""

import math
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.core.geo import EARTH_RADIUS_METRES, haversine_metres
from app.db.models.organisations import Precinct
from app.orchestration.geofence_service import TrackerFix, evaluate_geofence
from app.orchestration.proximity_service import FUTURE_FIX_SLACK_SECONDS, evaluate_proximity

# ── Shared fixtures ──────────────────────────────────────────────────────────────

# Riverhorse Valley, Durban — the same base point test_geofence_service.py uses.
BASE_LAT = -29.7942000
BASE_LNG = 30.9820000

EVALUATED_AT = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)

# Policy defaults under test — deliberately distinct values so a test failure that
# swaps two thresholds (e.g. age vs. skew) is visible rather than accidentally
# passing because two thresholds happened to share a number.
MAX_SEPARATION_METRES = 100.0
MAX_AGE_SECONDS = 60
MAX_SKEW_SECONDS = 30
MAX_PHONE_ACCURACY_METRES = 50.0


def _offset_east(lat: float, lng: float, *, metres: float) -> tuple[float, float]:
    """A point `metres` due east of (lat, lng), via the spherical destination-point
    formula. Longitude-only movement holds latitude fixed, so this reduces to
    advancing longitude by metres / (EARTH_RADIUS_METRES * cos(lat)) radians.

    Using the same EARTH_RADIUS_METRES as haversine_metres (see the assertion in
    test_offset_east_helper_matches_haversine below) keeps the generated fixture
    numerically consistent with the function under test, rather than introducing a
    second, potentially divergent notion of "metres" on a sphere.
    """
    lat_rad = math.radians(lat)
    d_lng_rad = metres / (EARTH_RADIUS_METRES * math.cos(lat_rad))
    return lat, lng + math.degrees(d_lng_rad)


def test_offset_east_helper_matches_haversine():
    # Arrange / Act
    lat, lng = _offset_east(BASE_LAT, BASE_LNG, metres=250.0)
    distance = haversine_metres(BASE_LAT, BASE_LNG, lat, lng)

    # Assert: within a metre of the requested offset — floating-point trig only,
    # no external fixture to drift out of sync with the function under test.
    assert distance == pytest.approx(250.0, abs=1.0)


# ── Coincident / within-limit / exact-boundary / above-limit ────────────────────


def test_coincident_fixes_are_within_limit_with_zero_separation():
    # Arrange
    driver_time = EVALUATED_AT - timedelta(seconds=5)
    tracker_time = EVALUATED_AT - timedelta(seconds=5)

    # Act
    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=driver_time, tracker_captured_at=tracker_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    # Assert
    assert verdict == "within_limit"
    assert separation == pytest.approx(0.0, abs=1e-6)
    assert reasons == []


def test_separation_exactly_at_limit_is_within_limit():
    # Arrange: driver and tracker exactly MAX_SEPARATION_METRES apart.
    tracker_lat, tracker_lng = _offset_east(BASE_LAT, BASE_LNG, metres=MAX_SEPARATION_METRES)
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    # Act
    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=tracker_lat, tracker_lng=tracker_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    # Assert: exactly at the limit is within limit (matches evaluate_geofence's own
    # inclusive boundary semantics).
    assert verdict == "within_limit"
    assert separation == pytest.approx(MAX_SEPARATION_METRES, abs=0.5)
    assert reasons == []


def test_separation_just_below_limit_is_within_limit():
    # Arrange
    tracker_lat, tracker_lng = _offset_east(
        BASE_LAT, BASE_LNG, metres=MAX_SEPARATION_METRES - 10.0
    )
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    # Act
    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=tracker_lat, tracker_lng=tracker_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    # Assert
    assert verdict == "within_limit"
    assert reasons == []


def test_separation_just_above_limit_is_separated():
    # Arrange
    tracker_lat, tracker_lng = _offset_east(
        BASE_LAT, BASE_LNG, metres=MAX_SEPARATION_METRES + 10.0
    )
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    # Act
    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=tracker_lat, tracker_lng=tracker_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    # Assert
    assert verdict == "separated"
    assert separation is not None and separation > MAX_SEPARATION_METRES
    assert reasons == []


def test_separation_well_above_limit_is_separated():
    # Arrange
    tracker_lat, tracker_lng = _offset_east(BASE_LAT, BASE_LNG, metres=5_000.0)
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    # Act
    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=tracker_lat, tracker_lng=tracker_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    # Assert
    assert verdict == "separated"
    assert separation == pytest.approx(5_000.0, abs=1.0)
    assert reasons == []


# ── The three named assertions from the brief, verbatim in spirit ───────────────


def test_brief_assertions_exact_limit_above_limit_and_stale_tracker():
    fix_time = EVALUATED_AT - timedelta(seconds=5)
    at_limit_lat, at_limit_lng = _offset_east(BASE_LAT, BASE_LNG, metres=MAX_SEPARATION_METRES)
    above_limit_lat, above_limit_lng = _offset_east(
        BASE_LAT, BASE_LNG, metres=MAX_SEPARATION_METRES + 10.0
    )
    stale_tracker_time = EVALUATED_AT - timedelta(seconds=MAX_AGE_SECONDS + 1)

    verdict_at_exact_limit, _, _ = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=at_limit_lat, tracker_lng=at_limit_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )
    verdict_above_limit, _, _ = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=above_limit_lat, tracker_lng=above_limit_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )
    # Distance is coincident (zero) so a naive implementation could be tempted to
    # fall back to "close enough" — but a stale tracker fix must still force
    # 'unverified', never 'within_limit' through a zero-distance shortcut.
    verdict_with_stale_tracker, _, _ = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=fix_time, tracker_captured_at=stale_tracker_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict_at_exact_limit == "within_limit"
    assert verdict_above_limit == "separated"
    assert verdict_with_stale_tracker == "unverified"


# ── Missing coordinates ──────────────────────────────────────────────────────────


def test_missing_driver_lat_only_is_missing_phone():
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=None, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert separation is None
    assert reasons == ["missing_phone"]


def test_missing_both_driver_coordinates_is_missing_phone():
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=None, driver_lng=None,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert separation is None
    assert reasons == ["missing_phone"]


def test_missing_tracker_coordinates_is_missing_tracker():
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=None, tracker_lng=None,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert separation is None
    assert reasons == ["missing_tracker"]


def test_missing_both_coordinate_pairs_reports_both_reasons_in_order():
    verdict, separation, reasons = evaluate_proximity(
        driver_lat=None, driver_lng=None,
        tracker_lat=None, tracker_lng=None,
        driver_captured_at=None, tracker_captured_at=None,
        driver_accuracy_metres=None, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert separation is None
    # Deterministic order: missing_phone, missing_tracker, missing_time,
    # missing_accuracy — matching _REASON_ORDER in the module under test.
    assert reasons == ["missing_phone", "missing_tracker", "missing_time", "missing_accuracy"]


# ── Missing time ──────────────────────────────────────────────────────────────


def test_missing_driver_captured_at_is_missing_time():
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=None, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    # Both coordinate pairs are present, so the factual distance is still computed.
    assert separation == pytest.approx(0.0, abs=1e-6)
    assert reasons == ["missing_time"]


def test_missing_tracker_captured_at_is_missing_time():
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=fix_time, tracker_captured_at=None,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert reasons == ["missing_time"]


# ── Accuracy ──────────────────────────────────────────────────────────────────


def test_missing_accuracy_is_missing_accuracy():
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=None, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert reasons == ["missing_accuracy"]


def test_accuracy_exactly_at_limit_is_not_poor_accuracy():
    # Exactly at the limit is acceptable — same inclusive-boundary stance as the
    # separation limit itself.
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=MAX_PHONE_ACCURACY_METRES, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "within_limit"
    assert reasons == []


def test_poor_accuracy_just_above_limit_is_flagged():
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=MAX_PHONE_ACCURACY_METRES + 0.1, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert reasons == ["poor_accuracy"]


# ── Staleness ─────────────────────────────────────────────────────────────────


def test_fix_age_exactly_at_limit_is_not_stale():
    fix_time = EVALUATED_AT - timedelta(seconds=MAX_AGE_SECONDS)

    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "within_limit"
    assert reasons == []


def test_driver_fix_older_than_limit_is_stale():
    stale_time = EVALUATED_AT - timedelta(seconds=MAX_AGE_SECONDS + 1)
    # Held within MAX_SKEW_SECONDS of stale_time (exactly at the skew limit, which
    # this module's own boundary rule treats as passing) so this test isolates
    # staleness alone, without also tripping time_skew between the two fixes.
    fresh_time = stale_time + timedelta(seconds=MAX_SKEW_SECONDS)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=stale_time, tracker_captured_at=fresh_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    # Distance is still computed — both coordinate pairs are present.
    assert separation == pytest.approx(0.0, abs=1e-6)
    assert reasons == ["stale_fix"]


def test_tracker_fix_older_than_limit_is_stale():
    stale_time = EVALUATED_AT - timedelta(seconds=MAX_AGE_SECONDS + 1)
    # Held within MAX_SKEW_SECONDS of stale_time so this test isolates staleness
    # alone — see the identical rationale in test_driver_fix_older_than_limit_is_stale.
    fresh_time = stale_time + timedelta(seconds=MAX_SKEW_SECONDS)

    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=fresh_time, tracker_captured_at=stale_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert reasons == ["stale_fix"]


# ── Skew ──────────────────────────────────────────────────────────────────────


def test_skew_exactly_at_limit_is_not_time_skew():
    driver_time = EVALUATED_AT - timedelta(seconds=5)
    tracker_time = driver_time - timedelta(seconds=MAX_SKEW_SECONDS)

    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=driver_time, tracker_captured_at=tracker_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "within_limit"
    assert reasons == []


def test_excessive_skew_between_fixes_is_flagged():
    driver_time = EVALUATED_AT - timedelta(seconds=5)
    tracker_time = driver_time - timedelta(seconds=MAX_SKEW_SECONDS + 1)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=driver_time, tracker_captured_at=tracker_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert separation == pytest.approx(0.0, abs=1e-6)
    assert reasons == ["time_skew"]


# ── Future timestamps ─────────────────────────────────────────────────────────


def test_driver_fix_slightly_in_the_future_within_slack_is_not_future_fix():
    # Within FUTURE_FIX_SLACK_SECONDS of evaluated_at — ordinary clock jitter
    # between the phone and the server, not treated as fabricated.
    slightly_future = EVALUATED_AT + timedelta(seconds=FUTURE_FIX_SLACK_SECONDS - 1)
    tracker_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=slightly_future, tracker_captured_at=tracker_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert "future_fix" not in reasons


def test_driver_fix_from_the_future_beyond_slack_is_flagged():
    future_time = EVALUATED_AT + timedelta(seconds=FUTURE_FIX_SLACK_SECONDS + 1)
    tracker_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=future_time, tracker_captured_at=tracker_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert separation == pytest.approx(0.0, abs=1e-6)
    assert "future_fix" in reasons


def test_tracker_fix_from_the_future_beyond_slack_is_flagged():
    driver_time = EVALUATED_AT - timedelta(seconds=5)
    future_time = EVALUATED_AT + timedelta(seconds=FUTURE_FIX_SLACK_SECONDS + 1)

    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=driver_time, tracker_captured_at=future_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "unverified"
    assert "future_fix" in reasons


def test_future_fix_does_not_also_report_stale_fix():
    # A future timestamp yields a negative age; it must be classified as
    # 'future_fix' only, never accidentally also matching the (positive-age) stale
    # check for the same source.
    future_time = EVALUATED_AT + timedelta(seconds=FUTURE_FIX_SLACK_SECONDS + 1)
    tracker_time = EVALUATED_AT - timedelta(seconds=5)

    _verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=future_time, tracker_captured_at=tracker_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert reasons == ["future_fix"]


# ── Multiple simultaneous failures stay in deterministic order ──────────────────


def test_multiple_failures_are_reported_in_fixed_order():
    # poor_accuracy + stale_fix + time_skew all trip at once; the module's
    # _REASON_ORDER must always render them in the same sequence.
    stale_driver_time = EVALUATED_AT - timedelta(seconds=MAX_AGE_SECONDS + 1)
    very_stale_tracker_time = stale_driver_time - timedelta(seconds=MAX_SKEW_SECONDS + 1)

    _verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=stale_driver_time, tracker_captured_at=very_stale_tracker_time,
        driver_accuracy_metres=MAX_PHONE_ACCURACY_METRES + 5.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert reasons == ["poor_accuracy", "stale_fix", "time_skew"]


# ── Yard-membership vs. driver/truck separation: independent facts ──────────────
#
# These tests run evaluate_geofence and evaluate_proximity side by side on the same
# fixture, with NO assembled ActionLocationAssessment (Task 5's job) — demonstrating
# that "is the truck in its precinct?" and "how far apart are the driver and the
# truck?" are two separate questions that can independently pass or fail.


def _make_precinct(*, radius_metres: int = 200) -> Precinct:
    return Precinct(
        id=uuid.uuid4(),
        name="Test Precinct",
        principal_organization_id=uuid.uuid4(),
        latitude=Decimal(str(BASE_LAT)),
        longitude=Decimal(str(BASE_LNG)),
        geofence_radius_metres=radius_metres,
        is_shared=False,
    )


def test_both_inside_precinct_but_far_apart_from_each_other():
    # Truck and driver are both within a large precinct radius, but far enough
    # apart from EACH OTHER to fail the separation check.
    precinct = _make_precinct(radius_metres=1_000)
    driver_lat, driver_lng = _offset_east(BASE_LAT, BASE_LNG, metres=50.0)
    truck_lat, truck_lng = _offset_east(BASE_LAT, BASE_LNG, metres=900.0)
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    geofence_verdict = evaluate_geofence(TrackerFix(lat=truck_lat, lng=truck_lng), precinct)
    proximity_verdict, separation, reasons = evaluate_proximity(
        driver_lat=driver_lat, driver_lng=driver_lng,
        tracker_lat=truck_lat, tracker_lng=truck_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert geofence_verdict.confirmed is True
    assert proximity_verdict == "separated"
    assert separation is not None and separation > MAX_SEPARATION_METRES
    assert reasons == []


def test_both_outside_precinct_but_together():
    # Truck and driver are together (well within separation limit) but both
    # clearly outside the precinct's geofence.
    precinct = _make_precinct(radius_metres=50)
    driver_lat, driver_lng = _offset_east(BASE_LAT, BASE_LNG, metres=2_000.0)
    truck_lat, truck_lng = _offset_east(BASE_LAT, BASE_LNG, metres=2_010.0)
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    geofence_verdict = evaluate_geofence(
        TrackerFix(lat=truck_lat, lng=truck_lng), precinct, tolerance_metres=0
    )
    proximity_verdict, separation, reasons = evaluate_proximity(
        driver_lat=driver_lat, driver_lng=driver_lng,
        tracker_lat=truck_lat, tracker_lng=truck_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert geofence_verdict.confirmed is False
    assert proximity_verdict == "within_limit"
    assert separation is not None and separation <= MAX_SEPARATION_METRES
    assert reasons == []


def test_truck_inside_precinct_driver_outside_separation_limit():
    # The truck is correctly at the precinct; the driver's phone is elsewhere
    # (e.g. left in an office) — precinct membership passes while separation fails.
    precinct = _make_precinct(radius_metres=200)
    truck_lat, truck_lng = BASE_LAT, BASE_LNG
    driver_lat, driver_lng = _offset_east(BASE_LAT, BASE_LNG, metres=500.0)
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    geofence_verdict = evaluate_geofence(TrackerFix(lat=truck_lat, lng=truck_lng), precinct)
    proximity_verdict, separation, reasons = evaluate_proximity(
        driver_lat=driver_lat, driver_lng=driver_lng,
        tracker_lat=truck_lat, tracker_lng=truck_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert geofence_verdict.confirmed is True
    assert proximity_verdict == "separated"
    assert separation is not None and separation > MAX_SEPARATION_METRES
    assert reasons == []


def test_phone_inside_precinct_truck_outside():
    # The driver's phone reads as being at the precinct; the truck's tracker is
    # far away (e.g. someone completed the handshake from a phone that never left
    # the office while the truck is still on the road) — the inverse asymmetry
    # from the previous test.
    precinct = _make_precinct(radius_metres=200)
    driver_lat, driver_lng = BASE_LAT, BASE_LNG
    truck_lat, truck_lng = _offset_east(BASE_LAT, BASE_LNG, metres=3_000.0)
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    geofence_verdict = evaluate_geofence(TrackerFix(lat=truck_lat, lng=truck_lng), precinct)
    proximity_verdict, separation, reasons = evaluate_proximity(
        driver_lat=driver_lat, driver_lng=driver_lng,
        tracker_lat=truck_lat, tracker_lng=truck_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert geofence_verdict.confirmed is False
    assert proximity_verdict == "separated"
    assert separation is not None and separation > MAX_SEPARATION_METRES
    assert reasons == []
