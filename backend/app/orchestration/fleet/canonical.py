"""What fleet anchors for a vehicle event, as one function both sides call.

fleet.vehicles anchors a vehicle event with the GPS device ID replaced by its SHA-256
(SEC-5, POPIA: the plaintext must not reach Hedera or the receipt's payload_json), while
VehicleEvent.changed_fields keeps the plaintext. Verification therefore has to apply the
same rewrite to the logged fields before it hashes them; if the two sides each carried their
own copy of the rule, an honest event read as tampered the day one drifted. This module is
the only place the rule lives. It is a leaf: it imports no orchestration module, so both
fleet.vehicles and the verification package can sit above it.
"""
from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import Any

from app.blockchain.critical_fields import VEHICLE_COSMETIC_FIELDS
from app.db.models.enums import VehicleEventType

_DEVICE_ID_FIELD = "pulsit_device_id"
_DEVICE_ID_HASH_FIELD = "pulsit_device_id_sha256"


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonical_vehicle_fields(event_type: str, fields: Mapping[str, Any]) -> dict[str, Any]:
    """The `fields` entry of a vehicle event's anchored payload, from its logged fields.

    `fields` is a creation snapshot for a created event, or a {field: {"from", "to"}} diff
    for every other type. Both the anchoring side (which passes the critical-only diff) and
    the verifying side (which passes the stored changed_fields) get the same answer:

    - created: the plaintext device ID is replaced by "pulsit_device_id_sha256", which is
      None when the device ID is falsy (so an empty ID and a missing one hash alike).
    - any other type: changed_fields also logs cosmetic diffs, which are never anchored, so
      they are dropped here; a device-ID diff has both its sides hashed, a missing side as "".
    """
    canonical = dict(fields)
    if event_type == VehicleEventType.CREATED.value:
        device_id = canonical.pop(_DEVICE_ID_FIELD, None)
        canonical[_DEVICE_ID_HASH_FIELD] = _sha256_hex(str(device_id)) if device_id else None
        return canonical

    for cosmetic in VEHICLE_COSMETIC_FIELDS:
        canonical.pop(cosmetic, None)
    if _DEVICE_ID_FIELD in canonical:
        entry = canonical.pop(_DEVICE_ID_FIELD)
        canonical[_DEVICE_ID_HASH_FIELD] = {
            side: _sha256_hex(value or "") for side, value in entry.items()
        }
    return canonical
