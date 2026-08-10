"""Unit tests for the mock-state key helpers.

The Redis-backed store itself is exercised through MockScanFeed's tests with an
injected fake; these tests cover the pure key-building logic, which is what
guarantees one trigger's state never collides with another's.
"""

from app.integrations.mock_state import (
    MOCK_STATE_PREFIX,
    RedisMockStateStore,
    build_key,
)


def test_build_key_namespaces_every_key():
    key = build_key("scan", "WAY001", "stop-1", "out")

    assert key.startswith(MOCK_STATE_PREFIX)


def test_build_key_is_stable_for_the_same_parts():
    first = build_key("scan", "WAY001", "stop-1", "out")
    second = build_key("scan", "WAY001", "stop-1", "out")

    assert first == second


def test_build_key_separates_different_parts():
    out_key = build_key("scan", "WAY001", "stop-1", "out")
    in_key = build_key("scan", "WAY001", "stop-1", "in")

    assert out_key != in_key


def test_build_key_separates_different_kinds():
    scan_key = build_key("scan", "WAY001")
    pp_key = build_key("pp", "WAY001")

    assert scan_key != pp_key


async def test_empty_batch_reads_without_touching_redis():
    """A trip with nothing to gate is the common case and must cost no connection.

    The URL is deliberately unroutable: if get_many_json opened a connection to ask
    for zero keys, this test would fail rather than quietly pass.
    """
    store = RedisMockStateStore("redis://127.0.0.1:1/")

    assert await store.get_many_json([]) == []


def test_decode_reads_absent_state_as_unset():
    assert RedisMockStateStore._decode("some-key", None) is None


def test_decode_reads_corrupt_state_as_unset():
    """A writer bug must not fail the read path that the phase gate sits on."""
    assert RedisMockStateStore._decode("some-key", "{not json") is None


def test_decode_parses_stored_state():
    assert RedisMockStateStore._decode("some-key", '{"closed_at": "now"}') == {
        "closed_at": "now",
    }
