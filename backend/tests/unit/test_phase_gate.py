"""Unit tests for the warehouse-scan phase gate.

Uses db_session (skips without TEST_DATABASE_URL) — the whole job is reading DB
state, so a DB-free test would assert nothing meaningful. Mirrors
test_scan_service.py, which does the same.
"""

from typing import Any

import pytest

from app.db.models.enums import PhaseType
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import MockScanFeed, ScanDirection
from app.orchestration import phase_gate


class FakeStore:
    """Dict-backed MockStateStore — same fake as test_scan_feed.py."""

    def __init__(self) -> None:
        self.data: dict[str, dict[str, Any]] = {}

    async def get_json(self, key: str) -> dict[str, Any] | None:
        return self.data.get(key)

    async def set_json(self, key: str, value: dict[str, Any]) -> None:
        self.data[key] = value

    async def flush(self) -> int:
        count = len(self.data)
        self.data.clear()
        return count


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    fake = FakeStore()
    monkeypatch.setattr(scan_feed_module, "get_mock_state_store", lambda: fake)
    return fake


async def test_loading_is_blocked_before_the_session_closes(db_session, store, seeded):
    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=seeded["trip"].id)

    assert blocked[(PhaseType.LOADING, seeded["stop"].id)] == phase_gate.BLOCKED_ON_SCAN


async def test_loading_unblocks_once_the_session_closes(db_session, store, seeded):
    await MockScanFeed().close_session(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT,
    )

    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=seeded["trip"].id)

    assert blocked[(PhaseType.LOADING, seeded["stop"].id)] is None


async def test_a_short_scan_still_unblocks_when_the_session_is_closed(db_session, store, seeded):
    """The whole point of session semantics — a missing parcel is a finding, not a block."""
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT, barcodes=seeded["barcodes"][:2],
    )
    await feed.close_session(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT,
    )

    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=seeded["trip"].id)

    assert blocked[(PhaseType.LOADING, seeded["stop"].id)] is None


async def test_a_stop_with_no_consignments_is_never_blocked(db_session, store, empty_trip):
    """Trips created without a PP reference have no Parcel rows at all. manifest.ts
    documents this as 'common' and 'a normal state, not a failure' — blocking them
    would make the dispatcher override the default path for a legitimate trip shape."""
    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=empty_trip["trip"].id)

    assert all(value is None for value in blocked.values())


async def test_closing_one_stop_does_not_unblock_another(db_session, store, xdock_trip):
    """A cross-dock trip loads at more than one stop."""
    await MockScanFeed().close_session(
        consignment_reference="WAY001", stop_reference=str(xdock_trip["stop_1"].id),
        direction=ScanDirection.OUT,
    )

    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=xdock_trip["trip"].id)

    assert blocked[(PhaseType.LOADING, xdock_trip["stop_1"].id)] is None
    assert blocked[(PhaseType.LOADING, xdock_trip["stop_2"].id)] == phase_gate.BLOCKED_ON_SCAN


async def test_confirmation_reads_scan_in_not_scan_out(db_session, store, seeded):
    await MockScanFeed().close_session(
        consignment_reference="WAY001", stop_reference=str(seeded["stop"].id),
        direction=ScanDirection.OUT,
    )

    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=seeded["trip"].id)

    assert blocked[(PhaseType.CONFIRMATION, seeded["stop"].id)] == phase_gate.BLOCKED_ON_SCAN


async def test_phases_other_than_loading_and_confirmation_are_never_blocked(
    db_session, store, seeded,
):
    blocked = await phase_gate.blocked_on_by_stop(db_session, trip_id=seeded["trip"].id)

    # Via blocked_on_for, not blocked[...]: an ungated phase has NO KEY in the map —
    # "absent means not gated" is the contract. Indexing it directly raises KeyError,
    # and the fix for that is to use the accessor, never to insert null keys for every
    # phase type into the derivation.
    for phase_type in (PhaseType.DEPARTURE, PhaseType.UNLOADING):
        assert phase_gate.blocked_on_for(
            blocked, phase_type=phase_type, trip_stop_id=seeded["stop"].id,
        ) is None


async def test_a_stop_with_two_waybills_blocks_until_both_close(
    db_session, store, two_waybill_stop,
):
    await MockScanFeed().close_session(
        consignment_reference="WAY001",
        stop_reference=str(two_waybill_stop["stop"].id),
        direction=ScanDirection.OUT,
    )

    blocked = await phase_gate.blocked_on_by_stop(
        db_session, trip_id=two_waybill_stop["trip"].id,
    )

    assert blocked[
        (PhaseType.LOADING, two_waybill_stop["stop"].id)
    ] == phase_gate.BLOCKED_ON_SCAN
