"""Unit tests for app.orchestration.evidence.corroboration — pure logic, no DB, no HTTP.

Covers the module-level helpers that turn a Pulsit fix into what gets written:

    _geofence_verdict_to_column   the three-state (True / False / None) contract for
                                   phase_events.pulsit_geofence_confirmed
    _snapshot_for_trailer         builds (or refuses to build) a TrailerGpsSnapshot row
    _within_corroboration_skew   the timing gate — is a fix close enough to the
                                   driver's own capture instant to trust at all?

record_phase_corroboration/record_checkpoint_corroboration are not exercised here —
they need a DB session and the Pulsit client, which belongs in the integration suite
(tests/integration/test_phase_corroboration.py).

Precinct rows are stood in with a lightweight dataclass rather than a real ORM row:
evaluate_geofence (the function _geofence_verdict_to_column delegates to) types its
precinct parameter as Precinct only under TYPE_CHECKING and reads just latitude,
longitude and geofence_radius_metres at runtime — so nothing here needs a DB session
to exercise that path. `cast()` tells mypy the stand-in satisfies the real
Optional[Precinct] parameter without pulling in Any.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Optional, cast
from unittest.mock import patch

from app.core.config import settings
from app.db.models.enums import PhaseType
from app.db.models.organisations import Precinct
from app.db.models.phases import TrailerGpsSnapshot
from app.integrations.pulsit import PulsitFix, PulsitFixSource, PulsitFixStatus
from app.orchestration.evidence.corroboration import (
    _PHASES_WITHOUT_A_GEOFENCE_VERDICT,
    _geofence_verdict_to_column,
    _snapshot_for_trailer,
    _within_corroboration_skew,
)
from app.orchestration.evidence.geofence import DEFAULT_GEOFENCE_RADIUS_METRES

_PRECINCT_LAT = Decimal("-29.7942000")
_PRECINCT_LNG = Decimal("30.9820000")

_NEARBY_LAT = Decimal("-29.7950")
_NEARBY_LNG = Decimal("30.9825")

_FAR_LAT = Decimal("-26.2041")
_FAR_LNG = Decimal("28.0473")

_PINNED_NOW = datetime(2026, 9, 4, 17, 0, 0, tzinfo=UTC)


@dataclass
class _PrecinctStub:
    """Minimal stand-in for a Precinct row — see module docstring for why."""

    latitude: Optional[Decimal]
    longitude: Optional[Decimal]
    geofence_radius_metres: Optional[int]
    geofence_polygon: Optional[list[list[float]]] = None


def _make_precinct(
    *,
    latitude: Optional[Decimal] = _PRECINCT_LAT,
    longitude: Optional[Decimal] = _PRECINCT_LNG,
    geofence_radius_metres: Optional[int] = DEFAULT_GEOFENCE_RADIUS_METRES,
) -> Precinct:
    """Build a Precinct-typed stand-in without an ORM row or DB session."""
    stub = _PrecinctStub(
        latitude=latitude, longitude=longitude, geofence_radius_metres=geofence_radius_metres,
    )
    return cast(Precinct, stub)


def _make_fix(
    *,
    status: PulsitFixStatus = PulsitFixStatus.OK,
    lat: Optional[Decimal] = None,
    lng: Optional[Decimal] = None,
    fixed_at: Optional[datetime] = None,
    device_id: Optional[str] = None,
) -> PulsitFix:
    """Build a PulsitFix directly, bypassing both Pulsit clients.

    Lets a test construct exactly the (status, position, timestamp) combination it
    needs — including a shape neither client would ever itself produce, such as
    status=OK with fixed_at=None (test 13 below).
    """
    return PulsitFix(
        device_id=device_id or f"PLT-TEST-{uuid.uuid4().hex[:6]}",
        status=status,
        source=PulsitFixSource.MOCK,
        lat=lat,
        lng=lng,
        fixed_at=fixed_at,
    )



def test_fix_inside_radius_returns_true():
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    precinct = _make_precinct()

    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-inside-radius")

    assert confirmed is True


def test_fix_far_outside_radius_returns_false_not_none():
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_FAR_LAT, lng=_FAR_LNG)
    precinct = _make_precinct()

    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-far-outside-radius")

    assert confirmed is False
    assert confirmed is not None


def test_no_fix_status_returns_none_not_false():
    fix = _make_fix(status=PulsitFixStatus.NO_FIX)
    precinct = _make_precinct()

    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-no-fix")

    assert confirmed is None


def test_none_fix_returns_none():
    precinct = _make_precinct()

    confirmed = _geofence_verdict_to_column(None, precinct, context="test-none-fix")

    assert confirmed is None


def test_unavailable_status_returns_none():
    fix = _make_fix(status=PulsitFixStatus.UNAVAILABLE)
    precinct = _make_precinct()

    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-unavailable")

    assert confirmed is None


def test_unknown_device_status_returns_none():
    fix = _make_fix(status=PulsitFixStatus.UNKNOWN_DEVICE)
    precinct = _make_precinct()

    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-unknown-device")

    assert confirmed is None


def test_none_precinct_returns_none():
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)

    confirmed = _geofence_verdict_to_column(fix, None, context="test-none-precinct")

    assert confirmed is None


def test_precinct_without_coordinates_returns_none():
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    precinct = _make_precinct(latitude=None)

    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-no-precinct-coords")

    assert confirmed is None


def test_fix_inside_tolerance_band_returns_true():
    radius = DEFAULT_GEOFENCE_RADIUS_METRES
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=radius)

    with patch(
        "app.orchestration.evidence.geofence.haversine_metres",
        return_value=float(radius) + 1.0,
    ):
        confirmed = _geofence_verdict_to_column(fix, precinct, context="test-tolerance-band")

    assert confirmed is True



def test_positioned_fix_produces_snapshot_with_tracker_timestamp():
    tracker_time = _PINNED_NOW - timedelta(hours=3)
    fix = _make_fix(
        status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG,
        fixed_at=tracker_time, device_id="PLT-TRAILER-TEST",
    )
    phase_event_id = uuid.uuid4()
    trailer_id = uuid.uuid4()

    snapshot = _snapshot_for_trailer(
        phase_event_id=phase_event_id, trailer_id=trailer_id, fix=fix
    )

    assert isinstance(snapshot, TrailerGpsSnapshot)
    assert snapshot.phase_event_id == phase_event_id
    assert snapshot.trailer_id == trailer_id
    assert snapshot.pulsit_device_id == "PLT-TRAILER-TEST"
    assert snapshot.lat == _NEARBY_LAT
    assert snapshot.lng == _NEARBY_LNG
    assert snapshot.captured_at == tracker_time


def test_no_fix_status_returns_no_snapshot():
    fix = _make_fix(status=PulsitFixStatus.NO_FIX)

    snapshot = _snapshot_for_trailer(
        phase_event_id=uuid.uuid4(), trailer_id=uuid.uuid4(), fix=fix
    )

    assert snapshot is None


def test_unknown_device_status_returns_no_snapshot():
    fix = _make_fix(status=PulsitFixStatus.UNKNOWN_DEVICE)

    snapshot = _snapshot_for_trailer(
        phase_event_id=uuid.uuid4(), trailer_id=uuid.uuid4(), fix=fix
    )

    assert snapshot is None


def test_positioned_fix_without_fixed_at_returns_none():
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG, fixed_at=None)

    snapshot = _snapshot_for_trailer(
        phase_event_id=uuid.uuid4(), trailer_id=uuid.uuid4(), fix=fix
    )

    assert snapshot is None


def test_snapshot_lat_lng_remain_decimal():
    precise_lat = Decimal("-29.7941234")
    precise_lng = Decimal("30.9829876")
    fix = _make_fix(
        status=PulsitFixStatus.OK, lat=precise_lat, lng=precise_lng,
        fixed_at=_PINNED_NOW - timedelta(hours=1),
    )

    snapshot = _snapshot_for_trailer(
        phase_event_id=uuid.uuid4(), trailer_id=uuid.uuid4(), fix=fix
    )

    assert snapshot is not None
    assert isinstance(snapshot.lat, Decimal)
    assert isinstance(snapshot.lng, Decimal)
    assert snapshot.lat == precise_lat
    assert snapshot.lng == precise_lng



def test_a_fix_taken_at_the_same_instant_is_within_skew():
    driver_captured_at = _PINNED_NOW

    result = _within_corroboration_skew(fixed_at=_PINNED_NOW, driver_captured_at=driver_captured_at)

    assert result is True


def test_a_fix_just_inside_the_configured_skew_is_within_skew():
    driver_captured_at = _PINNED_NOW
    fixed_at = _PINNED_NOW + timedelta(seconds=settings.PULSIT_CORROBORATION_MAX_SKEW_SECONDS - 1)

    result = _within_corroboration_skew(fixed_at=fixed_at, driver_captured_at=driver_captured_at)

    assert result is True


def test_a_fix_just_outside_the_configured_skew_is_not_within_skew():
    driver_captured_at = _PINNED_NOW
    fixed_at = _PINNED_NOW + timedelta(seconds=settings.PULSIT_CORROBORATION_MAX_SKEW_SECONDS + 1)

    result = _within_corroboration_skew(fixed_at=fixed_at, driver_captured_at=driver_captured_at)

    assert result is False


def test_the_skew_is_symmetric_a_fix_taken_before_the_capture_can_also_miss():
    driver_captured_at = _PINNED_NOW
    fixed_at = _PINNED_NOW - timedelta(hours=3)

    result = _within_corroboration_skew(fixed_at=fixed_at, driver_captured_at=driver_captured_at)

    assert result is False


def test_a_missing_driver_captured_at_is_never_treated_as_safe():
    fix_taken_right_now = _PINNED_NOW

    result = _within_corroboration_skew(fixed_at=fix_taken_right_now, driver_captured_at=None)

    assert result is False


def test_a_missing_fixed_at_is_never_treated_as_safe():
    driver_captured_at = _PINNED_NOW

    result = _within_corroboration_skew(fixed_at=None, driver_captured_at=driver_captured_at)

    assert result is False


def test_both_absent_is_never_treated_as_safe():
    result = _within_corroboration_skew(fixed_at=None, driver_captured_at=None)

    assert result is False



def test_trailer_fix_inside_radius_returns_true():
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    precinct = _make_precinct()

    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-trailer-inside")

    assert confirmed is True


def test_trailer_fix_outside_radius_returns_false_not_none():
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_FAR_LAT, lng=_FAR_LNG)
    precinct = _make_precinct()

    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-trailer-outside")

    assert confirmed is False
    assert confirmed is not None


def test_trailer_fix_outside_the_skew_window_is_not_judged_but_position_still_stored():
    driver_captured_at = _PINNED_NOW
    stale_fixed_at = _PINNED_NOW - timedelta(
        seconds=settings.PULSIT_CORROBORATION_MAX_SKEW_SECONDS + 1
    )
    fix = _make_fix(
        status=PulsitFixStatus.OK, lat=_FAR_LAT, lng=_FAR_LNG,
        fixed_at=stale_fixed_at, device_id="PLT-TRAILER-STALE",
    )
    precinct = _make_precinct()
    phase_event_id = uuid.uuid4()
    trailer_id = uuid.uuid4()

    is_timely = _within_corroboration_skew(
        fixed_at=fix.fixed_at, driver_captured_at=driver_captured_at,
    )
    snapshot = _snapshot_for_trailer(
        phase_event_id=phase_event_id, trailer_id=trailer_id, fix=fix
    )
    geofence_confirmed = (
        _geofence_verdict_to_column(fix, precinct, context="test-trailer-stale") if is_timely
        else None
    )

    assert is_timely is False
    assert geofence_confirmed is None
    assert snapshot is not None
    assert snapshot.lat == _FAR_LAT
    assert snapshot.lng == _FAR_LNG


def test_trailer_precinct_without_coordinates_returns_none():
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    precinct = _make_precinct(latitude=None)

    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-trailer-no-precinct")

    assert confirmed is None


def test_in_transit_is_the_one_phase_a_trailer_never_gets_a_verdict_for():
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_FAR_LAT, lng=_FAR_LNG)
    precinct = _make_precinct()

    judges_geofence = PhaseType.IN_TRANSIT not in _PHASES_WITHOUT_A_GEOFENCE_VERDICT
    geofence_confirmed = (
        _geofence_verdict_to_column(fix, precinct, context="test-trailer-in-transit")
        if judges_geofence else None
    )

    assert judges_geofence is False
    assert geofence_confirmed is None


def test_arrival_is_judged_like_every_other_stop_phase():
    assert PhaseType.ARRIVAL not in _PHASES_WITHOUT_A_GEOFENCE_VERDICT


def test_horse_and_trailer_verdicts_are_independent_on_the_same_call():
    precinct = _make_precinct()
    horse_fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    trailer_fix = _make_fix(status=PulsitFixStatus.OK, lat=_FAR_LAT, lng=_FAR_LNG)

    horse_confirmed = _geofence_verdict_to_column(horse_fix, precinct, context="test-horse")
    trailer_confirmed = _geofence_verdict_to_column(trailer_fix, precinct, context="test-trailer")

    assert horse_confirmed is True
    assert trailer_confirmed is False
