"""What fleet anchors for a vehicle, driver or precinct event, as functions both sides call.

The payload an event is anchored with is built here from the event row, by the same functions
fleet.drivers, fleet.vehicles and fleet.precincts anchor with and the verification package
rebuilds with. Anchoring and verification therefore cannot drift apart: the fault fixed in 6a
(a device-ID rewrite applied on one side only) is not expressible any more.

fleet.vehicles anchors a vehicle event with the GPS device ID replaced by its SHA-256
(SEC-5, POPIA: the plaintext must not reach Hedera or the receipt's payload_json), while
VehicleEvent.changed_fields keeps the plaintext. Verification therefore has to apply the
same rewrite to the logged fields before it hashes them; if the two sides each carried their
own copy of the rule, an honest event read as tampered the day one drifted. This module is
the only place the rule lives. It is a leaf: it imports no orchestration module, so the three
fleet modules and the verification package can all sit above it.
"""
from __future__ import annotations

import hashlib
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.critical_fields import VEHICLE_CRITICAL_FIELDS
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import BlockchainReceiptType, SubjectType, VehicleEventType
from app.db.models.events import DriverEvent, PrecinctEvent, VehicleEvent

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
      only VEHICLE_CRITICAL_FIELDS are kept. Keeping the critical set (rather than dropping the
      cosmetic one) means a field nobody has classified yet is never anchored by accident; a
      device-ID diff has both its sides hashed, a missing side as "".
    """
    canonical = dict(fields)
    if event_type == VehicleEventType.CREATED.value:
        device_id = canonical.pop(_DEVICE_ID_FIELD, None)
        canonical[_DEVICE_ID_HASH_FIELD] = _sha256_hex(str(device_id)) if device_id else None
        return canonical

    canonical = {name: value for name, value in canonical.items() if name in VEHICLE_CRITICAL_FIELDS}
    if _DEVICE_ID_FIELD in canonical:
        entry = canonical.pop(_DEVICE_ID_FIELD)
        canonical[_DEVICE_ID_HASH_FIELD] = {
            side: _sha256_hex(value or "") for side, value in entry.items()
        }
    return canonical


def vehicle_event_payload(
    event: VehicleEvent, *, device_id_in_plaintext: bool = False,
) -> dict[str, Any]:
    """The payload a vehicle event is anchored with, built from its row.

    device_id_in_plaintext selects the rule for receipts anchored before b2348ff (June 2026),
    which carried the GPS device ID unhashed; verification sets it from the shape of the
    receipt's stored payload, anchoring never does.
    """
    fields = (
        dict(event.changed_fields)
        if device_id_in_plaintext
        else canonical_vehicle_fields(event.event_type, event.changed_fields)
    )
    return {
        "vehicle_event_id": str(event.id),
        "vehicle_id": str(event.vehicle_id),
        "event_type": event.event_type,
        "fields": fields,
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }


def driver_event_payload(event: DriverEvent) -> dict[str, Any]:
    """The payload a driver event is anchored with. The licence number is already a hash in
    changed_fields (POPIA), so nothing is rewritten here."""
    return {
        "driver_event_id": str(event.id),
        "driver_id": str(event.driver_id),
        "event_type": event.event_type,
        "fields": dict(event.changed_fields),
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }


def precinct_event_payload(event: PrecinctEvent) -> dict[str, Any]:
    """The payload a precinct event is anchored with. A precinct holds no personal data, so
    its full logged diff (cosmetic changes included) is anchored in the clear."""
    return {
        "precinct_event_id": str(event.id),
        "precinct_id": str(event.precinct_id),
        "event_type": event.event_type,
        "fields": dict(event.changed_fields),
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }


class AnchorFn(Protocol):
    """The shape of blockchain.anchor_service.anchor_subject, as far as the fleet needs it."""

    def __call__(
        self,
        db: AsyncSession,
        *,
        subject_type: SubjectType,
        subject_id: Any,
        canonical_payload: dict[str, Any],
        receipt_type: BlockchainReceiptType,
    ) -> Awaitable[BlockchainReceipt]: ...


type FleetEvent = VehicleEvent | DriverEvent | PrecinctEvent

_SUBJECT_AND_PAYLOAD: dict[type, tuple[SubjectType, Callable[[Any], dict[str, Any]]]] = {
    VehicleEvent: (SubjectType.VEHICLE_EVENT, vehicle_event_payload),
    DriverEvent: (SubjectType.DRIVER_EVENT, driver_event_payload),
    PrecinctEvent: (SubjectType.PRECINCT_EVENT, precinct_event_payload),
}


async def anchor_fleet_event(
    db: AsyncSession,
    *,
    anchor: AnchorFn,
    event: FleetEvent,
    receipt_type: BlockchainReceiptType,
) -> BlockchainReceipt:
    """Anchor a flushed vehicle, driver or precinct event and link its receipt.

    `anchor` is the caller's own `anchor_subject`, passed in rather than imported here so each
    fleet module remains the place where anchoring is looked up: the tests that patch
    `fleet.<module>.anchor_subject` keep applying, and this leaf stays free of the anchoring
    service. The event must already be flushed, because its id and created_at are in the payload.
    """
    subject_type, build_payload = _SUBJECT_AND_PAYLOAD[type(event)]
    receipt = await anchor(
        db,
        subject_type=subject_type,
        subject_id=event.id,
        canonical_payload=build_payload(event),
        receipt_type=receipt_type,
    )
    event.blockchain_receipt_id = receipt.id
    return receipt
