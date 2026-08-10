"""Tests for domain exception classes."""

from app.core.exceptions import ResourceNotFoundError, TripConflictError


def test_trip_conflict_error_carries_order_number():
    err = TripConflictError(order_number="ORD-001")
    assert err.order_number == "ORD-001"
    assert "ORD-001" in str(err)


def test_resource_not_found_error_carries_resource_and_id():
    err = ResourceNotFoundError(resource="Driver", resource_id="abc-123")
    assert err.resource == "Driver"
    assert err.resource_id == "abc-123"
    assert "Driver" in str(err)
    assert "abc-123" in str(err)
