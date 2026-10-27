"""Unit tests for app.orchestration.evidence.proximity — pure logic, no DB, no HTTP.

Coordinates are generated from ONE base point (Riverhorse Valley, Durban — the same
precinct fixture used by tests/unit/test_evidence_geofence.py) via `_offset_east`, a
spherical destination-point helper verified against `haversine_metres` below, rather
than hardcoded as unexplained lat/lng pairs. `evaluated_at` is always passed in
explicitly (an injected clock) — nothing here ever calls datetime.now().

Also includes side-by-side yard-membership tests (evaluate_geofence +
evaluate_proximity, run on the same fixes) demonstrating that precinct membership
and driver/truck separation are independent facts — no assembled
ActionLocationAssessment here yet.
"""

import math
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.core.geo import EARTH_RADIUS_METRES, haversine_metres
from app.db.models.organisations import Precinct
from app.orchestration.evidence.geofence import TrackerFix, evaluate_geofence
from app.orchestration.evidence.proximity import FUTURE_FIX_SLACK_SECONDS, evaluate_proximity

BASE_LAT = -29.7942000
BASE_LNG = 30.9820000

EVALUATED_AT = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)

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
    lat, lng = _offset_east(BASE_LAT, BASE_LNG, metres=250.0)
    distance = haversine_metres(BASE_LAT, BASE_LNG, lat, lng)

    assert distance == pytest.approx(250.0, abs=1.0)



def test_coincident_fixes_are_within_limit_with_zero_separation():
    driver_time = EVALUATED_AT - timedelta(seconds=5)
    tracker_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=BASE_LAT, tracker_lng=BASE_LNG,
        driver_captured_at=driver_time, tracker_captured_at=tracker_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "within_limit"
    assert separation == pytest.approx(0.0, abs=1e-6)
    assert reasons == []


def test_separation_exactly_at_limit_is_within_limit():
    tracker_lat, tracker_lng = _offset_east(BASE_LAT, BASE_LNG, metres=MAX_SEPARATION_METRES)
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=tracker_lat, tracker_lng=tracker_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "within_limit"
    assert separation == pytest.approx(MAX_SEPARATION_METRES, abs=0.5)
    assert reasons == []


def test_separation_just_below_limit_is_within_limit():
    tracker_lat, tracker_lng = _offset_east(
        BASE_LAT, BASE_LNG, metres=MAX_SEPARATION_METRES - 10.0
    )
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, _separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=tracker_lat, tracker_lng=tracker_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "within_limit"
    assert reasons == []


def test_separation_just_above_limit_is_separated():
    tracker_lat, tracker_lng = _offset_east(
        BASE_LAT, BASE_LNG, metres=MAX_SEPARATION_METRES + 10.0
    )
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=tracker_lat, tracker_lng=tracker_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "separated"
    assert separation is not None and separation > MAX_SEPARATION_METRES
    assert reasons == []


def test_separation_well_above_limit_is_separated():
    tracker_lat, tracker_lng = _offset_east(BASE_LAT, BASE_LNG, metres=5_000.0)
    fix_time = EVALUATED_AT - timedelta(seconds=5)

    verdict, separation, reasons = evaluate_proximity(
        driver_lat=BASE_LAT, driver_lng=BASE_LNG,
        tracker_lat=tracker_lat, tracker_lng=tracker_lng,
        driver_captured_at=fix_time, tracker_captured_at=fix_time,
        driver_accuracy_metres=10.0, evaluated_at=EVALUATED_AT,
        max_separation_metres=MAX_SEPARATION_METRES, max_age_seconds=MAX_AGE_SECONDS,
        max_skew_seconds=MAX_SKEW_SECONDS, max_phone_accuracy_metres=MAX_PHONE_ACCURACY_METRES,
    )

    assert verdict == "separated"
    assert separation == pytest.approx(5_000.0, abs=1.0)
    assert reasons == []



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
    assert reasons == ["missing_phone", "missing_tracker", "missing_time", "missing_accuracy"]



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
    assert separation == pytest.approx(0.0, abs=1e-6)
    assert reasons == ["stale_fix"]


def test_tracker_fix_older_than_limit_is_stale():
    stale_time = EVALUATED_AT - timedelta(seconds=MAX_AGE_SECONDS + 1)
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



def test_driver_fix_slightly_in_the_future_within_slack_is_not_future_fix():
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



def test_multiple_failures_are_reported_in_fixed_order():
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
