from decimal import Decimal

from app.orchestration.dev_rig_service import (
    UNCOUPLED_TRAILER_MIN_OFFSET_METRES,
    midpoint,
    uncoupled_offset_metres,
)


def test_midpoint_averages_and_keeps_seven_decimals():
    result = midpoint((Decimal("-33.9249000"), Decimal("18.4241000")), (Decimal("-33.7342000"), Decimal("18.9621000")))

    assert result == (Decimal("-33.8295500"), Decimal("18.6931000"))


def test_uncoupled_offset_is_at_least_the_floor():
    assert uncoupled_offset_metres(500.0) == UNCOUPLED_TRAILER_MIN_OFFSET_METRES


def test_uncoupled_offset_doubles_a_large_threshold():
    # A threshold raised in config must not silently break the demo scenario.
    assert uncoupled_offset_metres(4_000.0) == 8_000.0
