"""Unit tests for the Pulsit mock client and its Redis-backed state layer.

FIXTURE PROVENANCE — read this before trusting any expectation below.

These fixtures were NOT recorded from the Pulsit API. No such recording exists,
because no credentials exist: Pulsit supplied no specification and access was still
being arranged when this was written. Every position here is hand-built, and the
coordinates are taken from our own seed data (scripts/seed_demo.py:_PRECINCTS), not
from anything Pulsit ever returned.

That distinction matters on an evidence platform. These tests prove the client
behaves correctly against the shape we ASSUMED; they cannot prove the assumption.

Redis is never touched: FakeMockStateStore is injected in its place.
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.core.config import settings
from app.integrations import pulsit as pulsit_module
from app.integrations.pulsit import (
    MOCK_DEVICE_POSITIONS,
    MockPulsitClient,
    PulsitFixSource,
    PulsitFixStatus,
    PulsitUnsupportedError,
)
from tests.conftest import FakeMockStateStore

# A device id that is deliberately absent from MOCK_DEVICE_POSITIONS.
_UNKNOWN_DEVICE = "PLT-NOT-A-REAL-TRACKER"

# Seeded fixture devices, used where the test is about the fixture library itself.
_HORSE = "PLT-HORSE-001"
_TRAILER_A = "PLT-TRAILER-001"
_TRAILER_B = "PLT-TRAILER-002"


@pytest.fixture
def mock_store(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    """Inject a dict-backed store and assert mock mode, as the dev panel would run."""
    fake = FakeMockStateStore()
    monkeypatch.setattr(pulsit_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", True)
    return fake


# ---------------------------------------------------------------------------
# Reading positions with nothing staged — the fixture library
# ---------------------------------------------------------------------------


async def test_known_device_returns_fixture_position(mock_store):
    client = MockPulsitClient()

    fix = await client.get_position(_HORSE)

    assert fix.status is PulsitFixStatus.OK
    assert fix.has_position is True
    assert (fix.lat, fix.lng) == MOCK_DEVICE_POSITIONS[_HORSE]
    assert fix.device_id == _HORSE


async def test_fix_is_labelled_as_mock_sourced(mock_store):
    client = MockPulsitClient()

    fix = await client.get_position(_HORSE)

    assert fix.source is PulsitFixSource.MOCK


async def test_unknown_device_returns_unknown_device_without_raising(mock_store):
    client = MockPulsitClient()

    fix = await client.get_position(_UNKNOWN_DEVICE)

    assert fix.status is PulsitFixStatus.UNKNOWN_DEVICE
    assert fix.has_position is False
    assert fix.lat is None and fix.lng is None
    assert fix.device_id == _UNKNOWN_DEVICE


async def test_unstaged_fixture_timestamp_is_current(mock_store):
    before = datetime.now(UTC)
    client = MockPulsitClient()

    fix = await client.get_position(_HORSE)

    # A position is a claim about now; a frozen fixture date would read as stale.
    assert fix.fixed_at is not None
    assert before <= fix.fixed_at <= datetime.now(UTC)


async def test_coordinates_are_decimal_not_float(mock_store):
    client = MockPulsitClient()

    fix = await client.get_position(_HORSE)

    # Decimal all the way through: these land in Numeric(10,7) columns.
    assert isinstance(fix.lat, Decimal)
    assert isinstance(fix.lng, Decimal)


# ---------------------------------------------------------------------------
# Staging — the state layer FP-197's dev endpoint will drive
# ---------------------------------------------------------------------------


async def test_staged_position_overrides_the_fixture(mock_store):
    client = MockPulsitClient()
    await client.stage_position(_HORSE, Decimal("-26.2041"), Decimal("28.0473"))

    fix = await client.get_position(_HORSE)

    assert fix.status is PulsitFixStatus.OK
    assert fix.lat == Decimal("-26.2041")
    assert fix.lng == Decimal("28.0473")


async def test_staged_position_survives_full_decimal_precision(mock_store):
    client = MockPulsitClient()
    # Seven decimal places — the full precision of Numeric(10,7). A float
    # round-trip through JSON would not return this value unchanged.
    await client.stage_position(_HORSE, Decimal("-33.9248765"), Decimal("18.4241234"))

    fix = await client.get_position(_HORSE)

    assert fix.lat == Decimal("-33.9248765")
    assert fix.lng == Decimal("18.4241234")


async def test_restaging_replaces_rather_than_merges(mock_store):
    client = MockPulsitClient()
    await client.stage_position(_HORSE, Decimal("-26.2041"), Decimal("28.0473"))

    await client.stage_position(_HORSE, Decimal("-29.0852"), Decimal("26.1596"))
    fix = await client.get_position(_HORSE)

    assert fix.lat == Decimal("-29.0852")
    assert fix.lng == Decimal("26.1596")


async def test_staged_fixed_at_is_honoured(mock_store):
    moment = datetime(2026, 9, 4, 8, 12, 3, tzinfo=UTC)
    client = MockPulsitClient()

    await client.stage_position(_HORSE, Decimal("-33.9249"), Decimal("18.4241"), fixed_at=moment)
    fix = await client.get_position(_HORSE)

    assert fix.fixed_at == moment


async def test_staged_no_fix_reports_no_fix(mock_store):
    client = MockPulsitClient()
    await client.stage_no_fix(_HORSE)

    fix = await client.get_position(_HORSE)

    # The tracker went dark: still a known device, but no position to report.
    assert fix.status is PulsitFixStatus.NO_FIX
    assert fix.has_position is False
    assert fix.lat is None and fix.lng is None


async def test_staging_can_take_an_unknown_device_off_the_unknown_path(mock_store):
    """A device not in the fixture library becomes readable once staged.

    This is what lets a dispatcher-created vehicle be demonstrated without editing
    the fixture library.
    """
    client = MockPulsitClient()
    await client.stage_position(_UNKNOWN_DEVICE, Decimal("-33.9249"), Decimal("18.4241"))

    fix = await client.get_position(_UNKNOWN_DEVICE)

    assert fix.status is PulsitFixStatus.OK


async def test_staging_raises_when_mock_mode_is_off(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", False)
    client = MockPulsitClient()

    with pytest.raises(PulsitUnsupportedError):
        await client.stage_position(_HORSE, Decimal("-33.9249"), Decimal("18.4241"))


async def test_staging_no_fix_raises_when_mock_mode_is_off(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", False)
    client = MockPulsitClient()

    with pytest.raises(PulsitUnsupportedError):
        await client.stage_no_fix(_HORSE)


async def test_corrupt_staged_state_degrades_to_no_fix(mock_store):
    client = MockPulsitClient()
    # A malformed write by some future trigger: status says OK, coordinates absent.
    mock_store.data[f"freightproof:mock:pulsit:{_HORSE}"] = {"status": "ok"}

    fix = await client.get_position(_HORSE)

    assert fix.status is PulsitFixStatus.NO_FIX


# ---------------------------------------------------------------------------
# Batch reads — a trip with several trailers
# ---------------------------------------------------------------------------


async def test_multiple_trailers_return_one_fix_each_in_order(mock_store):
    client = MockPulsitClient()

    fixes = await client.get_positions([_HORSE, _TRAILER_A, _TRAILER_B])

    assert [f.device_id for f in fixes] == [_HORSE, _TRAILER_A, _TRAILER_B]
    assert all(f.has_position for f in fixes)


async def test_batch_mixes_staged_fixture_and_unknown_devices(mock_store):
    client = MockPulsitClient()
    await client.stage_position(_TRAILER_A, Decimal("-26.2041"), Decimal("28.0473"))
    await client.stage_no_fix(_TRAILER_B)

    fixes = await client.get_positions([_HORSE, _TRAILER_A, _TRAILER_B, _UNKNOWN_DEVICE])

    assert [f.status for f in fixes] == [
        PulsitFixStatus.OK,           # fixture library
        PulsitFixStatus.OK,           # staged position
        PulsitFixStatus.NO_FIX,       # staged dark
        PulsitFixStatus.UNKNOWN_DEVICE,
    ]


async def test_batch_costs_one_store_round_trip(mock_store):
    """Four trailers must not cost four Redis connections — FP-195 reads per trailer."""
    client = MockPulsitClient()

    await client.get_positions([_HORSE, _TRAILER_A, _TRAILER_B, _UNKNOWN_DEVICE])

    assert mock_store.batch_calls == 1


async def test_duplicate_device_ids_are_answered_positionally(mock_store):
    client = MockPulsitClient()

    fixes = await client.get_positions([_HORSE, _HORSE])

    # The contract promises one fix per requested id, in order — not a de-duplicated set.
    assert len(fixes) == 2
    assert [f.device_id for f in fixes] == [_HORSE, _HORSE]


async def test_empty_request_returns_empty_without_touching_the_store(mock_store):
    client = MockPulsitClient()

    assert await client.get_positions([]) == []
    assert mock_store.batch_calls == 0
