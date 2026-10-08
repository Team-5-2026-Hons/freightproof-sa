"""Unit tests for app.orchestration.corroboration_service — pure logic, no DB, no HTTP.

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
from app.orchestration.corroboration_service import (
    _PHASES_WITHOUT_A_GEOFENCE_VERDICT, _geofence_verdict_to_column, _snapshot_for_trailer,
    _within_corroboration_skew,
)
from app.orchestration.geofence_service import DEFAULT_GEOFENCE_RADIUS_METRES

# Riverhorse Valley, Durban — the same real precinct fixture test_geofence_service.py
# uses, kept identical so a distance that is "clearly inside" or "clearly outside"
# means the same thing in both files.
_PRECINCT_LAT = Decimal("-29.7942000")
_PRECINCT_LNG = Decimal("30.9820000")

# ~101 m from the precinct centre — well inside a 200 m radius.
_NEARBY_LAT = Decimal("-29.7950")
_NEARBY_LNG = Decimal("30.9825")

# Johannesburg CBD — many hundreds of km from the Durban precinct, i.e. cleanly
# beyond any radius + tolerance this file uses.
_FAR_LAT = Decimal("-26.2041")
_FAR_LNG = Decimal("28.0473")

# A fixed instant to build "N hours ago" timestamps from, rather than calling
# datetime.now(UTC) inside a test — a captured_at assertion that used now() on both
# sides would still pass after a regression that stamped the row with now().
_PINNED_NOW = datetime(2026, 9, 4, 17, 0, 0, tzinfo=UTC)


@dataclass
class _PrecinctStub:
    """Minimal stand-in for a Precinct row — see module docstring for why."""

    latitude: Optional[Decimal]
    longitude: Optional[Decimal]
    geofence_radius_metres: Optional[int]


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


# ---------------------------------------------------------------------------
# _geofence_verdict_to_column — the three-state contract
# ---------------------------------------------------------------------------


def test_fix_inside_radius_returns_true():
    # Arrange
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    precinct = _make_precinct()

    # Act
    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-inside-radius")

    # Assert
    assert confirmed is True


def test_fix_far_outside_radius_returns_false_not_none():
    # Arrange
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_FAR_LAT, lng=_FAR_LNG)
    precinct = _make_precinct()

    # Act
    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-far-outside-radius")

    # Assert: this IS the accusation the module docstring describes — "we checked
    # and the truck was NOT there" — and must be a real False, not the NULL that
    # every "we couldn't check" case below produces.
    assert confirmed is False
    assert confirmed is not None


def test_no_fix_status_returns_none_not_false():
    # THE single most important assertion in this file (see the handoff packet and
    # the module's NULL SEMANTICS docstring block). evaluate_geofence itself returns
    # confirmed=False when there is nothing to measure — a NO_FIX tracker reading
    # with no lat/lng. If _geofence_verdict_to_column ever regresses to persisting
    # that raw boolean instead of checking verdict.reason is MEASURED, a dark
    # tracker would read to a dispatcher exactly like a truck proven absent. This
    # assertion is written as `is None`, not falsy, specifically so a regression to
    # `False` fails loudly rather than passing by coincidence.
    # Arrange
    fix = _make_fix(status=PulsitFixStatus.NO_FIX)
    precinct = _make_precinct()

    # Act
    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-no-fix")

    # Assert
    assert confirmed is None


def test_none_fix_returns_none():
    # Arrange
    precinct = _make_precinct()

    # Act
    confirmed = _geofence_verdict_to_column(None, precinct, context="test-none-fix")

    # Assert
    assert confirmed is None


def test_unavailable_status_returns_none():
    # Arrange: Pulsit itself was unreachable — our side failing, not a claim about
    # the vehicle, so this must land on "could not check" like NO_FIX does.
    fix = _make_fix(status=PulsitFixStatus.UNAVAILABLE)
    precinct = _make_precinct()

    # Act
    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-unavailable")

    # Assert
    assert confirmed is None


def test_unknown_device_status_returns_none():
    # Arrange: the fleet record and the tracker estate disagree about this device —
    # a fleet-data problem, not evidence the truck was anywhere in particular.
    fix = _make_fix(status=PulsitFixStatus.UNKNOWN_DEVICE)
    precinct = _make_precinct()

    # Act
    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-unknown-device")

    # Assert
    assert confirmed is None


def test_none_precinct_returns_none():
    # Arrange
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)

    # Act
    confirmed = _geofence_verdict_to_column(fix, None, context="test-none-precinct")

    # Assert
    assert confirmed is None


def test_precinct_without_coordinates_returns_none():
    # Arrange: a precinct row with no usable location — nothing to compare against.
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    precinct = _make_precinct(latitude=None)

    # Act
    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-no-precinct-coords")

    # Assert
    assert confirmed is None


def test_fix_inside_tolerance_band_returns_true():
    # Arrange: precincts and fixes cannot be placed at an exact integer-metre
    # boundary, so — mirroring test_geofence_service.py's own boundary tests —
    # haversine_metres is patched to a distance strictly between the radius and
    # radius + tolerance: the marginal band that is still persisted as True.
    radius = DEFAULT_GEOFENCE_RADIUS_METRES
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    precinct = _make_precinct(geofence_radius_metres=radius)

    # Act
    with patch(
        "app.orchestration.evidence.geofence.haversine_metres",
        return_value=float(radius) + 1.0,
    ):
        confirmed = _geofence_verdict_to_column(fix, precinct, context="test-tolerance-band")

    # Assert: outside the radius proper but within the lenient band — still True,
    # confirming it is the widened radius that gets persisted, not the strict one.
    assert confirmed is True


# ---------------------------------------------------------------------------
# _snapshot_for_trailer
# ---------------------------------------------------------------------------


def test_positioned_fix_produces_snapshot_with_tracker_timestamp():
    # Arrange: fixed_at is 3 hours before a pinned instant, never datetime.now(UTC),
    # so a regression that stamps the row with the current time fails this
    # assertion instead of accidentally passing.
    tracker_time = _PINNED_NOW - timedelta(hours=3)
    fix = _make_fix(
        status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG,
        fixed_at=tracker_time, device_id="PLT-TRAILER-TEST",
    )
    phase_event_id = uuid.uuid4()
    trailer_id = uuid.uuid4()

    # Act
    snapshot = _snapshot_for_trailer(
        phase_event_id=phase_event_id, trailer_id=trailer_id, fix=fix
    )

    # Assert
    assert isinstance(snapshot, TrailerGpsSnapshot)
    assert snapshot.phase_event_id == phase_event_id
    assert snapshot.trailer_id == trailer_id
    assert snapshot.pulsit_device_id == "PLT-TRAILER-TEST"
    assert snapshot.lat == _NEARBY_LAT
    assert snapshot.lng == _NEARBY_LNG
    # The TRACKER's own reading time, not when the server processed the handshake —
    # the only place a replayed offline submission's staleness is visible at all.
    assert snapshot.captured_at == tracker_time


def test_no_fix_status_returns_no_snapshot():
    # Arrange: a trailer that did not report gets no row, not a row full of nulls.
    fix = _make_fix(status=PulsitFixStatus.NO_FIX)

    # Act
    snapshot = _snapshot_for_trailer(
        phase_event_id=uuid.uuid4(), trailer_id=uuid.uuid4(), fix=fix
    )

    # Assert
    assert snapshot is None


def test_unknown_device_status_returns_no_snapshot():
    # Arrange
    fix = _make_fix(status=PulsitFixStatus.UNKNOWN_DEVICE)

    # Act
    snapshot = _snapshot_for_trailer(
        phase_event_id=uuid.uuid4(), trailer_id=uuid.uuid4(), fix=fix
    )

    # Assert
    assert snapshot is None


def test_positioned_fix_without_fixed_at_returns_none():
    # Arrange: a positioned fix that is missing its own reading time. PulsitFix's
    # normal contract never produces this shape (every OK fix from either client
    # carries fixed_at), but this module deliberately refuses to depend on another
    # story's invariant to decide whether to invent a timestamp for evidence — see
    # the fixed_at guard's own comment in corroboration_service.py. If that
    # invariant is ever broken upstream, the row must still be dropped, not stamped
    # with now().
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG, fixed_at=None)

    # Act
    snapshot = _snapshot_for_trailer(
        phase_event_id=uuid.uuid4(), trailer_id=uuid.uuid4(), fix=fix
    )

    # Assert
    assert snapshot is None


def test_snapshot_lat_lng_remain_decimal():
    # Arrange: these land in Numeric(10,7) columns — a float round trip would lose
    # precision that is evidence.
    precise_lat = Decimal("-29.7941234")
    precise_lng = Decimal("30.9829876")
    fix = _make_fix(
        status=PulsitFixStatus.OK, lat=precise_lat, lng=precise_lng,
        fixed_at=_PINNED_NOW - timedelta(hours=1),
    )

    # Act
    snapshot = _snapshot_for_trailer(
        phase_event_id=uuid.uuid4(), trailer_id=uuid.uuid4(), fix=fix
    )

    # Assert
    assert snapshot is not None
    assert isinstance(snapshot.lat, Decimal)
    assert isinstance(snapshot.lng, Decimal)
    assert snapshot.lat == precise_lat
    assert snapshot.lng == precise_lng


# ---------------------------------------------------------------------------
# _within_corroboration_skew — the timing gate
# ---------------------------------------------------------------------------


def test_a_fix_taken_at_the_same_instant_is_within_skew():
    # Arrange
    driver_captured_at = _PINNED_NOW

    # Act
    result = _within_corroboration_skew(fixed_at=_PINNED_NOW, driver_captured_at=driver_captured_at)

    # Assert
    assert result is True


def test_a_fix_just_inside_the_configured_skew_is_within_skew():
    # Arrange: one second inside the boundary, never exactly on it — a boundary test
    # written AT the limit is indistinguishable from an off-by-one in either direction.
    driver_captured_at = _PINNED_NOW
    fixed_at = _PINNED_NOW + timedelta(seconds=settings.PULSIT_CORROBORATION_MAX_SKEW_SECONDS - 1)

    # Act
    result = _within_corroboration_skew(fixed_at=fixed_at, driver_captured_at=driver_captured_at)

    # Assert
    assert result is True


def test_a_fix_just_outside_the_configured_skew_is_not_within_skew():
    # Arrange
    driver_captured_at = _PINNED_NOW
    fixed_at = _PINNED_NOW + timedelta(seconds=settings.PULSIT_CORROBORATION_MAX_SKEW_SECONDS + 1)

    # Act
    result = _within_corroboration_skew(fixed_at=fixed_at, driver_captured_at=driver_captured_at)

    # Assert
    assert result is False


def test_the_skew_is_symmetric_a_fix_taken_before_the_capture_can_also_miss():
    # Arrange: the driver's own clock is AHEAD of the tracker's last reading — an
    # offline replay is one route to a large gap, but the sign of the gap does not
    # matter, only its magnitude.
    driver_captured_at = _PINNED_NOW
    fixed_at = _PINNED_NOW - timedelta(hours=3)

    # Act
    result = _within_corroboration_skew(fixed_at=fixed_at, driver_captured_at=driver_captured_at)

    # Assert
    assert result is False


def test_a_missing_driver_captured_at_is_never_treated_as_safe():
    # Arrange: an older queued client that predates this field entirely. THE
    # single most important assertion in this block — treating "we don't know" as
    # "assume it's fine" is exactly the fabrication this gate exists to close.
    fix_taken_right_now = _PINNED_NOW

    # Act
    result = _within_corroboration_skew(fixed_at=fix_taken_right_now, driver_captured_at=None)

    # Assert
    assert result is False


def test_a_missing_fixed_at_is_never_treated_as_safe():
    # Arrange: has_position already filters this out upstream in practice, but the
    # helper itself must not assume a caller always does that filtering first.
    driver_captured_at = _PINNED_NOW

    # Act
    result = _within_corroboration_skew(fixed_at=None, driver_captured_at=driver_captured_at)

    # Assert
    assert result is False


def test_both_absent_is_never_treated_as_safe():
    # Act
    result = _within_corroboration_skew(fixed_at=None, driver_captured_at=None)

    # Assert
    assert result is False


# ---------------------------------------------------------------------------
# The TRAILER geofence verdict (FP-146's TRAILER_LOCATION_MISMATCH)
#
# trailer_gps_snapshots.geofence_confirmed is written by record_phase_corroboration's
# trailer loop by composing the SAME two functions already exercised above —
# _within_corroboration_skew gates whether a trailer fix is even judged, then
# _geofence_verdict_to_column turns a judged fix into the three-state column — with
# the SAME precinct object the horse verdict used for that phase. record_phase_
# corroboration itself needs a DB session and the Pulsit client (see this module's own
# docstring), so it is exercised in tests/integration/test_trailer_location_mismatch.py
# and test_phase_corroboration.py; what is unit-testable in isolation is that this
# composition, applied to a trailer's own fix, produces the same honest three states a
# trailer snapshot's column promises.
# ---------------------------------------------------------------------------


def test_trailer_fix_inside_radius_returns_true():
    # Arrange: exactly the function record_phase_corroboration calls for each
    # trailer's own fix, against the phase's precinct.
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    precinct = _make_precinct()

    # Act
    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-trailer-inside")

    # Assert
    assert confirmed is True


def test_trailer_fix_outside_radius_returns_false_not_none():
    # Arrange: a trailer measured away from the precinct — the FALSE half of the
    # decoupled-trailer signal FP-146's exception is built on.
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_FAR_LAT, lng=_FAR_LNG)
    precinct = _make_precinct()

    # Act
    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-trailer-outside")

    # Assert: a real accusation, not the "could not check" NULL.
    assert confirmed is False
    assert confirmed is not None


def test_trailer_fix_outside_the_skew_window_is_not_judged_but_position_still_stored():
    # Arrange: a trailer fix that WOULD read False if judged (it is far from the
    # precinct), but arrives well outside settings.PULSIT_CORROBORATION_MAX_SKEW_
    # SECONDS of the driver's own capture instant — record_phase_corroboration's
    # trailer loop gates the verdict on `_within_corroboration_skew` before ever
    # calling `_geofence_verdict_to_column`, exactly like it does for the horse.
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

    # Act: the skew gate a trailer verdict is subject to before the verdict function
    # is ever reached.
    is_timely = _within_corroboration_skew(
        fixed_at=fix.fixed_at, driver_captured_at=driver_captured_at,
    )
    # The trailer's POSITION is independent of the skew gate (trailer_gps_snapshots.
    # captured_at is the tracker's own reading time, never compared against driver_
    # captured_at — see corroboration_service's module docstring). Only the verdict
    # is gated, mirroring the trailer loop's `if judges_geofence and _within_
    # corroboration_skew(...)` condition.
    snapshot = _snapshot_for_trailer(
        phase_event_id=phase_event_id, trailer_id=trailer_id, fix=fix
    )
    geofence_confirmed = (
        _geofence_verdict_to_column(fix, precinct, context="test-trailer-stale") if is_timely
        else None
    )

    # Assert
    assert is_timely is False
    assert geofence_confirmed is None
    assert snapshot is not None
    assert snapshot.lat == _FAR_LAT
    assert snapshot.lng == _FAR_LNG


def test_trailer_precinct_without_coordinates_returns_none():
    # Arrange: the same "nothing to compare against" case as the horse's own test
    # above, applied to a trailer fix.
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    precinct = _make_precinct(latitude=None)

    # Act
    confirmed = _geofence_verdict_to_column(fix, precinct, context="test-trailer-no-precinct")

    # Assert
    assert confirmed is None


def test_in_transit_is_the_one_phase_a_trailer_never_gets_a_verdict_for():
    # Arrange: record_phase_corroboration's trailer loop only calls _geofence_
    # verdict_to_column when `judges_geofence` is True, i.e. when the phase is NOT in
    # _PHASES_WITHOUT_A_GEOFENCE_VERDICT. A trailer's fix genuinely outside the
    # precinct would otherwise read False; on in_transit the precinct is the one the
    # truck departed FROM, so judging it there would fabricate a mismatch on every
    # healthy trip in the fleet (see the module docstring's reasoning for the horse).
    fix = _make_fix(status=PulsitFixStatus.OK, lat=_FAR_LAT, lng=_FAR_LNG)
    precinct = _make_precinct()

    # Act: the exact gate record_phase_corroboration's trailer loop evaluates first.
    judges_geofence = PhaseType.IN_TRANSIT not in _PHASES_WITHOUT_A_GEOFENCE_VERDICT
    geofence_confirmed = (
        _geofence_verdict_to_column(fix, precinct, context="test-trailer-in-transit")
        if judges_geofence else None
    )

    # Assert: NULL even though the raw fix, if judged, would measure False.
    assert judges_geofence is False
    assert geofence_confirmed is None


def test_arrival_is_judged_like_every_other_stop_phase():
    # Arrange: Arrival is a stop-anchored
    # phase, so it gets the full trailer geofence treatment automatically, with no
    # special-casing needed in _PHASES_WITHOUT_A_GEOFENCE_VERDICT.
    # Act / Assert
    assert PhaseType.ARRIVAL not in _PHASES_WITHOUT_A_GEOFENCE_VERDICT


def test_horse_and_trailer_verdicts_are_independent_on_the_same_call():
    # Arrange: one precinct, two fixes — the horse's own, and one trailer's own — the
    # same shape record_phase_corroboration reads for a single phase completion: one
    # precinct resolved once, then _geofence_verdict_to_column called once per entity.
    precinct = _make_precinct()
    horse_fix = _make_fix(status=PulsitFixStatus.OK, lat=_NEARBY_LAT, lng=_NEARBY_LNG)
    trailer_fix = _make_fix(status=PulsitFixStatus.OK, lat=_FAR_LAT, lng=_FAR_LNG)

    # Act
    horse_confirmed = _geofence_verdict_to_column(horse_fix, precinct, context="test-horse")
    trailer_confirmed = _geofence_verdict_to_column(trailer_fix, precinct, context="test-trailer")

    # Assert: the same precinct, the same call site's logic, two independent verdicts
    # — exactly the "horse TRUE, trailer FALSE" reading FP-146's exception depends on.
    assert horse_confirmed is True
    assert trailer_confirmed is False
