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

# A precinct's position and radius are the inputs to FP-68's geofence verdict, so a
# change to either changes what every future handshake at this facility MEANS. That is
# the definition of critical here.
#
# is_shared is critical too, on the same grounds Vehicle treats is_active as critical:
# it is an access-control change rather than an evidence change, and an unanchored
# silent widening of who can see a facility is exactly the audit gap anchoring exists
# to close.
PRECINCT_CRITICAL_FIELDS: frozenset[str] = frozenset({
    "latitude",
    "longitude",
    "geofence_radius_metres",
    "is_shared",
})

# Labels for humans. Recorded in the event log for dispatcher visibility, never
# anchored — renaming a depot changes no verdict and should not cost a Hedera fee.
PRECINCT_COSMETIC_FIELDS: frozenset[str] = frozenset({
    "name",
    "address",
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
