import uuid

import pytest
from pydantic import TypeAdapter, ValidationError

from app.db.models.enums import PhaseType
from app.schemas.phases import InTransitCompleteRequest, PhaseCompleteRequest

_ADAPTER: TypeAdapter[PhaseCompleteRequest] = TypeAdapter(PhaseCompleteRequest)


def test_in_transit_payload_resolves_to_its_own_union_member():
    """Arrival is a driver submission as of 2026-08-09, so the discriminator must
    resolve `in_transit` instead of raising union_tag_invalid."""
    parsed = _ADAPTER.validate_python(
        {"phase_type": "in_transit", "idempotency_key": str(uuid.uuid4())}
    )

    assert isinstance(parsed, InTransitCompleteRequest)


def test_in_transit_payload_carries_the_arrival_position():
    """GPS, timestamp, idempotency key — the whole payload. The position is the only
    substantive evidence an arrival attestation carries."""
    parsed = _ADAPTER.validate_python({
        "phase_type": "in_transit",
        "idempotency_key": "queue-entry-1",
        "driver_phone_lat": -33.9249,
        "driver_phone_lng": 18.4241,
    })

    assert parsed.driver_phone_lat == -33.9249
    assert parsed.driver_phone_lng == 18.4241


def test_in_transit_payload_rejects_a_half_position():
    """Inherited from _PhaseCompleteBase: a lone axis is not a position."""
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python({
            "phase_type": "in_transit",
            "idempotency_key": "queue-entry-2",
            "driver_phone_lat": -33.9249,
        })


def test_trip_creation_is_still_not_driver_addressable():
    """Only in_transit changed. trip_creation has no actor and stays out of the union."""
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python(
            {"phase_type": "trip_creation", "idempotency_key": str(uuid.uuid4())}
        )


def test_phase_type_enum_still_has_seven_members():
    """Guards against someone 'solving' this by adding an enum member."""
    assert len(list(PhaseType)) == 7
