"""Unit tests for the ScanFeed interface and its mock implementation.

The store is a dict-backed fake injected via monkeypatch, so these run with no
Redis present — the same reason the PP client's tests run with no network.
"""

import pytest

from app.core.config import settings
from app.integrations import scan_feed as scan_feed_module
from app.integrations.scan_feed import (
    MockScanFeed,
    ScanDirection,
    ScanSessionQuery,
    get_scan_feed,
)
from tests.conftest import FakeMockStateStore


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    fake = FakeMockStateStore()
    monkeypatch.setattr(scan_feed_module, "get_mock_state_store", lambda: fake)
    return fake


async def test_poll_returns_empty_when_nothing_staged(store: FakeMockStateStore):
    feed = MockScanFeed()

    events = await feed.poll_scans(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert events == []


async def test_staged_barcodes_are_returned_by_poll(store: FakeMockStateStore):
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


async def test_poll_is_scoped_by_direction(store: FakeMockStateStore):
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


async def test_poll_is_scoped_by_stop(store: FakeMockStateStore):
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


async def test_staging_replaces_rather_than_appends(store: FakeMockStateStore):
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


async def test_events_carry_their_scan_timestamp(store: FakeMockStateStore):
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


async def test_session_is_open_when_nothing_staged(store: FakeMockStateStore):
    feed = MockScanFeed()

    closed = await feed.is_scan_session_closed(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    assert closed is False


async def test_session_reports_closed_once_closed(store: FakeMockStateStore):
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


async def test_session_close_is_scoped_by_direction(store: FakeMockStateStore):
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


async def test_session_close_is_scoped_by_stop(store: FakeMockStateStore):
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


async def test_closing_a_session_does_not_disturb_staged_barcodes(store: FakeMockStateStore):
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


async def test_closed_sessions_answers_each_query_in_order(store: FakeMockStateStore):
    """The batch is positional — callers zip it back against their own targets."""
    feed = MockScanFeed()
    await feed.close_session(
        consignment_reference="WAY002", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    closed = await feed.closed_sessions([
        ScanSessionQuery("WAY001", "stop-1", ScanDirection.OUT),
        ScanSessionQuery("WAY002", "stop-1", ScanDirection.OUT),
        ScanSessionQuery("WAY003", "stop-1", ScanDirection.OUT),
    ])

    assert closed == [False, True, False]


async def test_closed_sessions_is_scoped_by_direction(store: FakeMockStateStore):
    """An OUT session closing must not report the IN session as closed."""
    feed = MockScanFeed()
    await feed.close_session(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    closed = await feed.closed_sessions([
        ScanSessionQuery("WAY001", "stop-1", ScanDirection.OUT),
        ScanSessionQuery("WAY001", "stop-1", ScanDirection.IN),
    ])

    assert closed == [True, False]


async def test_closed_sessions_agrees_with_the_singular_form(store: FakeMockStateStore):
    """The gate and any one-off caller must never disagree about the same session."""
    feed = MockScanFeed()
    await feed.close_session(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )

    singular = await feed.is_scan_session_closed(
        consignment_reference="WAY001", stop_reference="stop-1",
        direction=ScanDirection.OUT,
    )
    batched = await feed.closed_sessions(
        [ScanSessionQuery("WAY001", "stop-1", ScanDirection.OUT)]
    )

    assert batched == [singular]


async def test_closed_sessions_of_nothing_is_empty(store: FakeMockStateStore):
    """A trip with nothing to gate asks nothing — see RedisMockStateStore."""
    feed = MockScanFeed()

    assert await feed.closed_sessions([]) == []
