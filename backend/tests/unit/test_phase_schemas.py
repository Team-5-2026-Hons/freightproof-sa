import uuid

import pytest
from pydantic import TypeAdapter, ValidationError

from app.db.models.enums import PhaseType
from app.schemas.phases import (
    ConfirmationCompleteRequest,
    DepartureCompleteRequest,
    InTransitCompleteRequest,
    PhaseCompleteRequest,
)

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


def test_departure_rejects_one_artifact_used_for_two_evidence_roles():
    artifact_id = uuid.uuid4()

    with pytest.raises(ValidationError, match="different artifacts"):
        DepartureCompleteRequest(
            phase_type=PhaseType.DEPARTURE,
            idempotency_key=str(uuid.uuid4()),
            seal_number="AB-1234",
            seal_photo_artifact_id=artifact_id,
            waybill_photo_artifact_id=artifact_id,
        )


def test_confirmation_rejects_one_artifact_used_for_two_evidence_roles():
    artifact_id = uuid.uuid4()

    with pytest.raises(ValidationError, match="different artifacts"):
        ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            idempotency_key=str(uuid.uuid4()),
            pod_photo_artifact_id=artifact_id,
            pod_signature_artifact_id=artifact_id,
        )


# ---------------------------------------------------------------------------
# Task 0A: driver_captured_at
# ---------------------------------------------------------------------------


def test_driver_captured_at_is_optional_for_an_older_queued_client():
    """A client that predates this field must still 200, never 422 forever."""
    parsed = _ADAPTER.validate_python(
        {"phase_type": "in_transit", "idempotency_key": str(uuid.uuid4())}
    )

    assert parsed.driver_captured_at is None


def test_driver_captured_at_is_accepted_when_timezone_aware():
    parsed = _ADAPTER.validate_python({
        "phase_type": "in_transit",
        "idempotency_key": str(uuid.uuid4()),
        "driver_captured_at": "2026-09-06T14:00:00+00:00",
    })

    assert parsed.driver_captured_at is not None
    assert parsed.driver_captured_at.tzinfo is not None


def test_driver_captured_at_rejects_a_naive_timestamp():
    """A naive value would silently compare as if it were UTC in corroboration_
    service, manufacturing a skew verdict from a timestamp never actually anchored to
    a real instant — rejected outright rather than assumed."""
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python({
            "phase_type": "in_transit",
            "idempotency_key": str(uuid.uuid4()),
            "driver_captured_at": "2026-09-06T14:00:00",
        })


def test_location_warning_acknowledgement_is_optional_and_preserves_the_driver_reason():
    """The acknowledgement is driver context, not a client-supplied assessment verdict."""
    parsed = _ADAPTER.validate_python({
        "phase_type": "in_transit",
        "idempotency_key": str(uuid.uuid4()),
        "location_warning_acknowledged_at": "2026-09-15T14:00:00+00:00",
        "location_warning_reason": "Truck is waiting at the gate.",
    })

    assert parsed.location_warning_acknowledged_at is not None
    assert parsed.location_warning_reason == "Truck is waiting at the gate."


def test_location_warning_reason_rejects_blank_acknowledgement():
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python({
            "phase_type": "in_transit",
            "idempotency_key": str(uuid.uuid4()),
            "location_warning_reason": "   ",
        })
