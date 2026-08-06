"""Unit tests for the ScanFeed interface and its mock implementation.

The store is a dict-backed fake injected via monkeypatch, so these run with no
Redis present — the same reason the PP client's tests run with no network.
"""

from typing import Any

import pytest

from app.core.config import settings
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import (
    MockScanFeed,
    ScanDirection,
    get_scan_feed,
)


class FakeStore:
    """Dict-backed MockStateStore. Avoids adding fakeredis to requirements.txt."""

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


async def test_poll_returns_empty_when_nothing_staged(store: FakeStore):
    feed = MockScanFeed()

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert events == []


async def test_staged_barcodes_are_returned_by_poll(store: FakeStore):
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001", "WAY0010002"],
    )

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert [e.barcode for e in events] == ["WAY0010001", "WAY0010002"]
    assert all(e.direction is ScanDirection.OUT for e in events)


async def test_poll_is_scoped_by_direction(store: FakeStore):
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001"],
    )

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.IN,
    )

    assert events == []


async def test_poll_is_scoped_by_stop(store: FakeStore):
    """A cross-dock trip has several stops — a scan at one must not leak to another."""
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001"],
    )

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-2",
        direction=ScanDirection.OUT,
    )

    assert events == []


async def test_staging_replaces_rather_than_appends(store: FakeStore):
    """Re-staging is how a demo is corrected after a mis-click; it must not accumulate."""
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001", "WAY0010002"],
    )

    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001"],
    )
    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert [e.barcode for e in events] == ["WAY0010001"]


async def test_events_carry_their_scan_timestamp(store: FakeStore):
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001"],
    )

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert events[0].scanned_at.tzinfo is not None


def test_factory_returns_the_mock_when_configured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "SCAN_FEED_USE_MOCK", True)

    feed = get_scan_feed()

    assert isinstance(feed, MockScanFeed)


def test_factory_raises_when_no_real_feed_exists(monkeypatch: pytest.MonkeyPatch):
    """No live warehouse feed exists yet — failing loudly beats silently mocking."""
    monkeypatch.setattr(settings, "SCAN_FEED_USE_MOCK", False)

    with pytest.raises(NotImplementedError):
        get_scan_feed()


async def test_session_is_open_when_nothing_staged(store: FakeStore):
    feed = MockScanFeed()

    closed = await feed.is_scan_session_closed(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert closed is False


async def test_session_reports_closed_once_closed(store: FakeStore):
    feed = MockScanFeed()
    await feed.close_session(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    closed = await feed.is_scan_session_closed(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert closed is True


async def test_session_close_is_scoped_by_direction(store: FakeStore):
    feed = MockScanFeed()
    await feed.close_session(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    closed = await feed.is_scan_session_closed(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.IN,
    )

    assert closed is False


async def test_session_close_is_scoped_by_stop(store: FakeStore):
    """A cross-dock trip closes one stop's session without touching another's."""
    feed = MockScanFeed()
    await feed.close_session(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    closed = await feed.is_scan_session_closed(
        consignment_reference="WAY001", stop_reference="stop-2",
        direction=ScanDirection.OUT,
    )

    assert closed is False


async def test_closing_a_session_does_not_disturb_staged_barcodes(store: FakeStore):
    """Closing is a separate key — it must not clobber what was staged."""
    feed = MockScanFeed()
    await feed.stage_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT, barcodes=["WAY0010001"],
    )

    await feed.close_session(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )
    assert [e.barcode for e in events] == ["WAY0010001"]
