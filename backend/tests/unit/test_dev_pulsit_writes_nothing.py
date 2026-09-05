"""FP-116: the move-truck endpoint touches Pulsit mock state and nothing else.

WHY THIS EXISTS ALONGSIDE THE INTEGRATION TEST: the row-counting proof in
tests/integration/test_dev_pulsit.py needs a database and skips without
TEST_DATABASE_URL. The integrity claim this whole story rests on — "the exception on
screen arrived through the real pipeline, the button did not insert it" — is too
important to be carried only by a test that can silently skip. This file proves the
same thing with no database at all, by calling the endpoint function directly against a
session that raises if anything tries to write through it.

Between them: this one proves the endpoint CANNOT write, and the integration test
proves that end to end no rows appear.
"""

import uuid
from decimal import Decimal
from typing import Any

import pytest

from app.api.v1.endpoints import dev_pulsit
from app.core.config import settings
from app.core.demo_waypoints import (
    DEMO_WAYPOINTS,
    WAYPOINT_NO_SIGNAL,
    WAYPOINT_PRECINCT,
    WAYPOINT_THREE_KM,
)
from app.integrations.pulsit import MockPulsitClient
from app.schemas.dev import MoveTruckRequest

from tests.conftest import FakeMockStateStore

_DEVICE_ID = "PLT-HORSE-001"
_DEPOT_LAT = Decimal("-33.9249")
_DEPOT_LNG = Decimal("18.4241")


class WriteForbiddenSession:
    """An AsyncSession stand-in where every write path is a test failure.

    Not a mock that records calls and is asserted on afterwards — a session that
    refuses. A recording mock proves nothing if someone forgets to assert on it; this
    fails at the moment of the write, wherever in the call stack it happens.
    """

    def __init__(self) -> None:
        self.executed = 0

    async def execute(self, *_args: Any, **_kwargs: Any) -> Any:
        # Reads are legitimate — the endpoint resolves the trip, horse and precinct so
        # the response can report real state. Never reached here because
        # _load_trip_context is stubbed, but counted so a future refactor that adds a
        # query is visible rather than silent.
        self.executed += 1
        raise AssertionError("unexpected query — _load_trip_context should be stubbed")

    def add(self, *_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("move_truck must never add a row")

    def add_all(self, *_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("move_truck must never add rows")

    async def commit(self) -> None:
        raise AssertionError("move_truck must never commit")

    async def flush(self, *_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("move_truck must never flush")

    async def delete(self, *_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("move_truck must never delete")


class _FakeTrip:
    def __init__(self) -> None:
        self.id = uuid.uuid4()


class _FakeHorse:
    pulsit_device_id = _DEVICE_ID
    registration = "CA 123-456"


class _FakePrecinct:
    def __init__(self) -> None:
        self.id = uuid.uuid4()
        self.name = "Cape Town Depot (Epping)"
        self.latitude = _DEPOT_LAT
        self.longitude = _DEPOT_LNG
        self.geofence_radius_metres = 200


class _FakeUser:
    organization_id = uuid.uuid4()


@pytest.fixture
def wired(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    """Point the endpoint at a dict-backed store and stub its three reads."""
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", True)
    store = FakeMockStateStore()
    monkeypatch.setattr(
        "app.integrations.pulsit.get_mock_state_store", lambda: store
    )
    monkeypatch.setattr(dev_pulsit, "get_pulsit_client", MockPulsitClient)

    async def _stub_context(_db: Any, **_kwargs: Any):
        return _FakeTrip(), _FakeHorse(), _FakePrecinct()

    monkeypatch.setattr(dev_pulsit, "_load_trip_context", _stub_context)
    return store


async def _call(waypoint_id: str):
    return await dev_pulsit.move_truck(
        MoveTruckRequest(trip_id=uuid.uuid4(), waypoint_id=waypoint_id),
        db=WriteForbiddenSession(),  # type: ignore[arg-type]
        current_user=_FakeUser(),  # type: ignore[arg-type]
    )


@pytest.mark.parametrize("waypoint_id", [w.waypoint_id for w in DEMO_WAYPOINTS])
async def test_no_waypoint_writes_through_the_session(wired, waypoint_id: str) -> None:
    """Every waypoint, including no-signal. The session refuses all writes."""
    result = await _call(waypoint_id)

    assert result.waypoint_id == waypoint_id


async def test_the_only_state_written_is_this_devices_pulsit_key(wired) -> None:
    await _call(WAYPOINT_THREE_KM)

    assert list(wired.data.keys()) == [f"freightproof:mock:pulsit:{_DEVICE_ID}"]


async def test_staged_position_is_the_waypoint_coordinate(wired) -> None:
    """Read back through the store, so a staging bug cannot hide behind the response."""
    await _call(WAYPOINT_PRECINCT)

    staged = wired.data[f"freightproof:mock:pulsit:{_DEVICE_ID}"]
    assert Decimal(staged["lat"]) == _DEPOT_LAT
    assert Decimal(staged["lng"]) == _DEPOT_LNG
    assert staged["status"] == "ok"


async def test_no_signal_stages_an_absent_fix_not_a_coordinate(wired) -> None:
    await _call(WAYPOINT_NO_SIGNAL)

    staged = wired.data[f"freightproof:mock:pulsit:{_DEVICE_ID}"]
    assert staged["status"] == "no_fix"
    assert "lat" not in staged and "lng" not in staged


async def test_re_pressing_a_waypoint_replaces_rather_than_accumulates(wired) -> None:
    """Idempotent by construction — stage_position replaces the whole record."""
    await _call(WAYPOINT_THREE_KM)
    await _call(WAYPOINT_THREE_KM)
    await _call(WAYPOINT_THREE_KM)

    assert len(wired.data) == 1


async def test_moving_away_then_back_leaves_the_truck_at_the_precinct(wired) -> None:
    await _call(WAYPOINT_THREE_KM)

    result = await _call(WAYPOINT_PRECINCT)

    assert result.geofence_confirmed is True
    assert result.distance_metres == pytest.approx(0.0, abs=1.0)


async def test_unknown_waypoint_raises_before_anything_is_staged(wired) -> None:
    """The id is resolved first, so a typo cannot half-move the truck."""
    with pytest.raises(Exception) as exc_info:
        await _call("nowhere-at-all")

    assert getattr(exc_info.value, "status_code", None) == 404
    assert wired.data == {}
