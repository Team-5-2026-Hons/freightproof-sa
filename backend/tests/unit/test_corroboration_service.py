"""Unit tests for app.orchestration.corroboration_service — pure logic, no DB, no HTTP.

Covers the two module-level helpers that turn a Pulsit fix into what gets written:

    _geofence_verdict_to_column   the three-state (True / False / None) contract for
                                   phase_events.pulsit_geofence_confirmed
    _snapshot_for_trailer         builds (or refuses to build) a TrailerGpsSnapshot row

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

from app.db.models.organisations import Precinct
from app.db.models.phases import TrailerGpsSnapshot
from app.integrations.pulsit import PulsitFix, PulsitFixSource, PulsitFixStatus
from app.orchestration.corroboration_service import (
    _geofence_verdict_to_column, _snapshot_for_trailer,
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
        "app.orchestration.geofence_service.haversine_metres",
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
