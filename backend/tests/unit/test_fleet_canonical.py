"""canonical_vehicle_fields: the device-ID rewrite fleet.vehicles anchors with.

The hashes are the same golden vectors as tests/integration/test_vehicle_anchor_payload_pins.py,
which captures them from the real create_vehicle / update_vehicle. Here the payload is rebuilt
from fixed inputs through the shared function, so the two files agreeing means the function
reproduces what production anchors. Same rule as B3: never edit a vector to make this pass.
"""

from typing import Any

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.enums import VehicleEventType
from app.orchestration.fleet.canonical import canonical_vehicle_fields

EVENT_ID = "11111111-1111-4111-8111-111111111111"
VEHICLE_ID = "22222222-2222-4222-8222-222222222222"
USER_ID = "33333333-3333-4333-8333-333333333333"
TIMESTAMP = "2026-01-01T00:00:00+00:00"

CREATE_HASH = "984ac1a00cc661c54d3af8b5b62bbdf2f348e6fc50e7fa5bd0bbff5630f798d5"
CREATE_EMPTY_HASH = "dc8d8abef0ac75e38c23804e94f5944283968cbe533dda0b9a5a9d043394364d"
UPDATE_DEVICE_HASH = "d6fedcccd654e3540baabcef88c501b7cadfe2ecd1a5f6edad298605bd0ec0dd"
UPDATE_MIXED_HASH = "f9ebfebdd57e97de5605881320a38a9b807569d20e7d96005591f12272c20fe9"


def _snapshot(device_id: str) -> dict[str, Any]:
    return {
        "registration": "CA 100-100", "vehicle_type": "horse", "pulsit_device_id": device_id,
        "make": "Volvo", "model": None, "year": 2018, "vin_number": None,
        "licence_disc_expiry": None, "gross_vehicle_mass_kg": None, "length_m": None,
        "is_active": True,
    }


def _payload(event_type: VehicleEventType, fields: dict[str, Any]) -> dict[str, Any]:
    return {
        "vehicle_event_id": EVENT_ID, "vehicle_id": VEHICLE_ID, "event_type": event_type.value,
        "fields": canonical_vehicle_fields(event_type.value, fields),
        "changed_by_user_id": USER_ID, "timestamp": TIMESTAMP,
    }


def test_created_payload_hash_matches_what_create_vehicle_anchors() -> None:
    payload = _payload(VehicleEventType.CREATED, _snapshot("PLT-PIN-001"))

    assert compute_payload_hash(payload) == CREATE_HASH


def test_created_payload_with_empty_device_id_hashes_to_none() -> None:
    payload = _payload(VehicleEventType.CREATED, _snapshot(""))

    assert payload["fields"]["pulsit_device_id_sha256"] is None
    assert compute_payload_hash(payload) == CREATE_EMPTY_HASH


def test_device_id_update_payload_hash_matches_what_update_vehicle_anchors() -> None:
    payload = _payload(
        VehicleEventType.VEHICLE_UPDATED,
        {"pulsit_device_id": {"from": "PLT-PIN-OLD", "to": "PLT-PIN-NEW"}},
    )

    assert compute_payload_hash(payload) == UPDATE_DEVICE_HASH


def test_update_drops_cosmetic_diffs_the_anchor_never_carried() -> None:
    logged = {"registration": {"from": "CA 100-100", "to": "CA 100-200"},
              "make": {"from": "Volvo", "to": "Scania"}}

    payload = _payload(VehicleEventType.LICENSE_PLATE_CHANGED, logged)

    assert compute_payload_hash(payload) == UPDATE_MIXED_HASH


def test_canonicalising_does_not_mutate_the_logged_fields() -> None:
    logged = {"pulsit_device_id": {"from": "A", "to": "B"}, "make": {"from": "X", "to": "Y"}}
    before = {k: dict(v) for k, v in logged.items()}

    canonical_vehicle_fields(VehicleEventType.VEHICLE_UPDATED.value, logged)

    assert logged == before


def test_update_hashes_a_missing_side_of_the_device_id_as_empty_string() -> None:
    fields = canonical_vehicle_fields(
        VehicleEventType.VEHICLE_UPDATED.value,
        {"pulsit_device_id": {"from": None, "to": "PLT-PIN-NEW"}},
    )

    assert fields["pulsit_device_id_sha256"]["from"] == (
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )


def test_update_keeps_only_critical_fields_so_an_unclassified_field_is_never_anchored() -> None:
    logged = {
        "registration": {"from": "CA 1", "to": "CA 2"},
        "make": {"from": "Volvo", "to": "Scania"},
        "future_field": {"from": 1, "to": 2},
    }

    fields = canonical_vehicle_fields(VehicleEventType.LICENSE_PLATE_CHANGED.value, logged)

    assert fields == {"registration": {"from": "CA 1", "to": "CA 2"}}


async def test_anchor_fleet_event_anchors_the_built_payload_and_links_the_receipt() -> None:
    import uuid
    from datetime import UTC, datetime
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.db.models.enums import BlockchainReceiptType, DriverEventType, SubjectType
    from app.db.models.events import DriverEvent
    from app.orchestration.fleet.canonical import anchor_fleet_event, driver_event_payload

    event = DriverEvent(
        id=uuid.uuid4(), driver_id=uuid.uuid4(), event_type=DriverEventType.CREATED.value,
        changed_fields={"is_active": True}, changed_by_user_id=uuid.uuid4(),
    )
    event.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    receipt = SimpleNamespace(id=uuid.uuid4())
    anchor = AsyncMock(return_value=receipt)
    db = object()

    result = await anchor_fleet_event(
        db,  # type: ignore[arg-type]
        anchor=anchor, event=event, receipt_type=BlockchainReceiptType.DRIVER_CREATED,
    )

    assert result is receipt
    assert event.blockchain_receipt_id == receipt.id
    anchor.assert_awaited_once_with(
        db,
        subject_type=SubjectType.DRIVER_EVENT,
        subject_id=event.id,
        canonical_payload=driver_event_payload(event),
        receipt_type=BlockchainReceiptType.DRIVER_CREATED,
    )
