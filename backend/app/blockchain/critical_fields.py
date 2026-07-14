"""Critical-fields lists for vehicle/driver mutations.

A field is 'critical' if a change to it should be anchored to Hedera.
Non-critical changes (cosmetic) are still recorded in the event log but skip
the Hedera anchor to save fees and reduce on-chain noise.
"""
from __future__ import annotations
from typing import Any, Mapping

VEHICLE_CRITICAL_FIELDS: frozenset[str] = frozenset({
    "registration",
    "licence_disc_expiry",
    "vehicle_type",
    "vin_number",
    "pulsit_device_id",
    "is_active",
})

# Non-critical vehicle attributes — recorded in the event log for dispatcher visibility
# but never anchored to Hedera (no fee, no on-chain noise for cosmetic edits).
VEHICLE_COSMETIC_FIELDS: frozenset[str] = frozenset({
    "make",
    "model",
    "year",
    "gross_vehicle_mass_kg",
    "length_m",
})

DRIVER_CRITICAL_FIELDS: frozenset[str] = frozenset({
    "license_number",
    "license_expiry",
    "is_active",
})


def diff_critical_fields(
    old: Mapping[str, Any],
    new: Mapping[str, Any],
    critical: frozenset[str],
) -> dict[str, dict[str, Any]] | None:
    """Return {field: {"from": old, "to": new}} for changed critical fields, or None."""
    diff: dict[str, dict[str, Any]] = {}
    for field in critical:
        old_value = old.get(field)
        new_value = new.get(field)
        if old_value != new_value:
            diff[field] = {"from": old_value, "to": new_value}
    return diff or None
