import pytest
from app.blockchain.critical_fields import (
    diff_critical_fields, VEHICLE_CRITICAL_FIELDS, DRIVER_CRITICAL_FIELDS,
)


def test_diff_returns_none_when_no_critical_change():
    old = {"registration": "ABC123", "make": "Volvo"}
    new = {"registration": "ABC123", "make": "Scania"}
    assert diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS) is None


def test_diff_returns_diff_when_critical_changed():
    old = {"registration": "ABC123", "make": "Volvo"}
    new = {"registration": "XYZ789", "make": "Volvo"}
    result = diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS)
    assert result == {"registration": {"from": "ABC123", "to": "XYZ789"}}


def test_diff_multiple_critical_fields():
    old = {"license_number": "L1", "license_expiry": "2026-01-01", "is_active": True}
    new = {"license_number": "L2", "license_expiry": "2031-01-01", "is_active": True}
    result = diff_critical_fields(old, new, DRIVER_CRITICAL_FIELDS)
    assert result == {
        "license_number": {"from": "L1", "to": "L2"},
        "license_expiry": {"from": "2026-01-01", "to": "2031-01-01"},
    }


def test_diff_handles_missing_keys_as_none():
    old = {}
    new = {"registration": "ABC123"}
    result = diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS)
    assert result == {"registration": {"from": None, "to": "ABC123"}}
