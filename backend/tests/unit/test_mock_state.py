"""Unit tests for the mock-state key helpers.

The Redis-backed store itself is exercised through MockScanFeed's tests with an
injected fake; these tests cover the pure key-building logic, which is what
guarantees one trigger's state never collides with another's.
"""

from app.integrations.mock_state import MOCK_STATE_PREFIX, build_key


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
