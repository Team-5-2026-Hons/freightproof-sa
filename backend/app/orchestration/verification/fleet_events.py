"""Rebuild a vehicle, driver or precinct event's anchored payload from its live row."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.events import DriverEvent, PrecinctEvent, VehicleEvent
from app.orchestration.fleet.canonical import (
    driver_event_payload, precinct_event_payload, vehicle_event_payload,
)


def _anchored_device_id_in_plaintext(anchored_payload: Any) -> bool:
    """True for a vehicle receipt anchored before b2348ff (June 2026), which put the GPS
    device ID in the payload as plaintext "pulsit_device_id" rather than its hash.

    Read from the receipt's stored payload_json, which is safe even though the database is
    the thing under suspicion: the rebuilt payload is only ever compared against the
    receipt's data_hash, which is also what Hedera holds. Editing payload_json to look legacy
    only makes the rebuild skip the hashing, and that cannot hash to a hashed anchored value.
    """
    if not isinstance(anchored_payload, dict):
        return False
    fields = anchored_payload.get("fields")
    return isinstance(fields, dict) and "pulsit_device_id" in fields


async def _reconstruct_vehicle_event_payload(
    db: AsyncSession, event_id: uuid.UUID, *, anchored_payload: Any,
) -> dict[str, Any] | None:
    """Rebuild a vehicle event's anchored payload from its live row.

    changed_fields keeps the plaintext device ID, which fleet.vehicles hashed before
    anchoring, so the payload is built by the same fleet.canonical function the anchoring side
    used. Receipts that predate that hashing anchored the plaintext and are rebuilt as-is.
    """
    event = (
        await db.execute(select(VehicleEvent).where(VehicleEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        return None
    return vehicle_event_payload(
        event, device_id_in_plaintext=_anchored_device_id_in_plaintext(anchored_payload),
    )


async def _reconstruct_driver_event_payload(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[str, Any] | None:
    event = (
        await db.execute(select(DriverEvent).where(DriverEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        return None
    return driver_event_payload(event)


async def _reconstruct_precinct_event_payload(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[str, Any] | None:
    """Rebuild the canonical payload fleet.precincts anchored, from the live row.

    Key order and value shapes must match create_precinct/update_precinct exactly —
    _hash_payload sorts keys, but a renamed key or a Decimal where a float was anchored
    produces a different hash and reports a mismatch that never happened.
    """
    event = (
        await db.execute(select(PrecinctEvent).where(PrecinctEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        return None
    return precinct_event_payload(event)
