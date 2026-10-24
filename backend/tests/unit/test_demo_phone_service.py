"""Gating and round-trip behaviour of the demo phone-position staging store.

The gates are the whole safeguard here: a staged pair is substituted into a driver's
request and is then indistinguishable from a real capture in the phase row, so "cannot
be staged or read unless BOTH dev flags are on" is the property these tests defend. See
app/dev/services/demo_phone.py.
"""

import uuid
from decimal import Decimal

import pytest

from app.core.config import settings
from app.dev.services import demo_phone
from tests.conftest import FakeMockStateStore

# Cape Town docks, the demo's own neighbourhood — a real coordinate so a stored value
# that silently round-trips through float is visible in the assertions.
STAGED_LAT = Decimal("-33.9188610")
STAGED_LNG = Decimal("18.4233000")


@pytest.fixture
def store() -> FakeMockStateStore:
    return FakeMockStateStore()


@pytest.fixture
def dev_panel_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", True)
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", True)


async def test_staging_round_trips_the_exact_coordinate(
    dev_panel_on: None, store: FakeMockStateStore,
) -> None:
    trip_id = uuid.uuid4()

    await demo_phone.stage_phone_position(trip_id, lat=STAGED_LAT, lng=STAGED_LNG, store=store)
    staged = await demo_phone.staged_position(trip_id, store=store)

    # Decimal in, Decimal out, digit for digit: these coordinates land in a
    # Numeric(10, 7) column, where a float round-trip shifts the last place.
    assert staged == (STAGED_LAT, STAGED_LNG)


async def test_nothing_staged_returns_none(dev_panel_on: None, store: FakeMockStateStore) -> None:
    assert await demo_phone.staged_position(uuid.uuid4(), store=store) is None


async def test_staging_is_scoped_per_trip(dev_panel_on: None, store: FakeMockStateStore) -> None:
    staged_trip, other_trip = uuid.uuid4(), uuid.uuid4()

    await demo_phone.stage_phone_position(staged_trip, lat=STAGED_LAT, lng=STAGED_LNG, store=store)

    assert await demo_phone.staged_position(other_trip, store=store) is None


async def test_restaging_replaces_rather_than_merges(
    dev_panel_on: None, store: FakeMockStateStore,
) -> None:
    trip_id = uuid.uuid4()
    second_lat, second_lng = Decimal("-26.0942000"), Decimal("28.1342000")

    await demo_phone.stage_phone_position(trip_id, lat=STAGED_LAT, lng=STAGED_LNG, store=store)
    await demo_phone.stage_phone_position(trip_id, lat=second_lat, lng=second_lng, store=store)

    # Pressing the panel button twice must leave identical state to pressing it once —
    # re-pressing is how a presenter recovers from a mis-click.
    assert await demo_phone.staged_position(trip_id, store=store) == (second_lat, second_lng)


async def test_clearing_hands_the_fix_back_to_the_device(
    dev_panel_on: None, store: FakeMockStateStore,
) -> None:
    trip_id = uuid.uuid4()
    await demo_phone.stage_phone_position(trip_id, lat=STAGED_LAT, lng=STAGED_LNG, store=store)

    await demo_phone.clear_phone_position(trip_id, store=store)

    assert await demo_phone.staged_position(trip_id, store=store) is None


async def test_clearing_what_was_never_staged_is_a_no_op(
    dev_panel_on: None, store: FakeMockStateStore,
) -> None:
    await demo_phone.clear_phone_position(uuid.uuid4(), store=store)

    assert await demo_phone.staged_position(uuid.uuid4(), store=store) is None


@pytest.mark.parametrize(
    ("dev_panel", "pulse_mock"),
    [(False, True), (True, False), (False, False)],
)
async def test_neither_staging_nor_reading_works_unless_both_flags_are_on(
    monkeypatch: pytest.MonkeyPatch, store: FakeMockStateStore,
    dev_panel: bool, pulse_mock: bool,
) -> None:
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", dev_panel)
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", pulse_mock)
    trip_id = uuid.uuid4()

    await demo_phone.stage_phone_position(trip_id, lat=STAGED_LAT, lng=STAGED_LNG, store=store)

    assert demo_phone.demo_phone_enabled() is False
    assert await demo_phone.staged_position(trip_id, store=store) is None
    assert store.data == {}


async def test_state_staged_while_flags_were_on_is_unreadable_once_they_are_off(
    monkeypatch: pytest.MonkeyPatch, store: FakeMockStateStore,
) -> None:
    trip_id = uuid.uuid4()
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", True)
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", True)
    await demo_phone.stage_phone_position(trip_id, lat=STAGED_LAT, lng=STAGED_LNG, store=store)

    # The read is gated too, not just the write: leftover state in a shared Redis must
    # not start substituting positions the moment a deployment turns the panel off.
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", False)

    assert await demo_phone.staged_position(trip_id, store=store) is None


@pytest.mark.parametrize(
    "stored",
    [
        {},
        {"lat": "-33.9188610"},
        {"lng": "18.4233000"},
        {"lat": None, "lng": None},
        {"lat": "not a number", "lng": "18.4233000"},
    ],
)
async def test_unusable_stored_state_falls_back_to_the_real_fix(
    dev_panel_on: None, store: FakeMockStateStore, stored: dict[str, object],
) -> None:
    trip_id = uuid.uuid4()
    store.data[f"freightproof:mock:demo_phone:{trip_id}"] = stored  # type: ignore[assignment]

    # Falling back to the device's own capture is the only safe direction to fail in, so
    # nothing here may raise into a phase submit.
    assert await demo_phone.staged_position(trip_id, store=store) is None


async def test_follow_tracker_stages_the_trackers_coordinate(
    dev_panel_on: None, store: FakeMockStateStore,
) -> None:
    trip_id = uuid.uuid4()

    staged = await demo_phone.follow_tracker(
        trip_id, lat=STAGED_LAT, lng=STAGED_LNG, move_phone=True, store=store,
    )

    assert staged is True
    assert await demo_phone.staged_position(trip_id, store=store) == (STAGED_LAT, STAGED_LNG)


async def test_follow_tracker_leaves_a_staged_position_alone_when_not_following(
    dev_panel_on: None, store: FakeMockStateStore,
) -> None:
    trip_id = uuid.uuid4()
    await demo_phone.stage_phone_position(trip_id, lat=STAGED_LAT, lng=STAGED_LNG, store=store)

    staged = await demo_phone.follow_tracker(
        trip_id, lat=Decimal("-26.0942000"), lng=Decimal("28.1342000"),
        move_phone=False, store=store,
    )

    # The FP-145 escape hatch: staging the truck alone is how a genuine phone/tracker
    # divergence is tested, so it must not quietly move the phone too.
    assert staged is False
    assert await demo_phone.staged_position(trip_id, store=store) == (STAGED_LAT, STAGED_LNG)


async def test_follow_tracker_clears_when_the_tracker_goes_dark(
    dev_panel_on: None, store: FakeMockStateStore,
) -> None:
    trip_id = uuid.uuid4()
    await demo_phone.stage_phone_position(trip_id, lat=STAGED_LAT, lng=STAGED_LNG, store=store)

    staged = await demo_phone.follow_tracker(trip_id, lat=None, lng=None, move_phone=True, store=store)

    # no_signal is not a place: the phone must not stay pinned where the truck used to be.
    assert staged is False
    assert await demo_phone.staged_position(trip_id, store=store) is None
