"""Unit tests for the four Pydantic v2 schema validators defined in the spec.

Run: pytest tests/unit/test_schema_validators.py -v
All four tests FAIL until the relevant schema files are implemented.
"""

import pytest
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# DriverCreate — id_number must be exactly 13 digits
# ---------------------------------------------------------------------------

def test_driver_id_number_valid():
    from app.schemas.people import DriverCreate
    import uuid
    d = DriverCreate(
        organization_id=uuid.uuid4(),
        full_name="Test Driver",
        id_number="1234567890123",
        phone_number="+27821234567",
        license_number="LIC001",
    )
    assert d.id_number == "1234567890123"


def test_driver_id_number_too_short():
    from app.schemas.people import DriverCreate
    import uuid
    with pytest.raises(Exception):
        DriverCreate(
            organization_id=uuid.uuid4(),
            full_name="Test Driver",
            id_number="123456",
            phone_number="+27821234567",
            license_number="LIC001",
        )


def test_driver_id_number_non_digits():
    from app.schemas.people import DriverCreate
    import uuid
    with pytest.raises(Exception):
        DriverCreate(
            organization_id=uuid.uuid4(),
            full_name="Test Driver",
            id_number="12345678901AB",
            phone_number="+27821234567",
            license_number="LIC001",
        )


# ---------------------------------------------------------------------------
# TripCreate — planned_arrival_at must be after planned_departure_at
# ---------------------------------------------------------------------------

def test_trip_arrival_after_departure_valid():
    from app.schemas.trips import TripCreate
    import uuid
    t = TripCreate(
        trip_reference="TRP-2026-0001",
        order_number="FDX-001",
        operator_organization_id=uuid.uuid4(),
        client_organization_id=uuid.uuid4(),
        driver_id=uuid.uuid4(),
        horse_id=uuid.uuid4(),
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
        created_by_user_id=uuid.uuid4(),
        planned_departure_at=datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc),
        planned_arrival_at=datetime(2026, 5, 1, 16, 0, tzinfo=timezone.utc),
    )
    assert t.planned_arrival_at > t.planned_departure_at


def test_trip_arrival_before_departure_invalid():
    from app.schemas.trips import TripCreate
    import uuid
    with pytest.raises(Exception):
        TripCreate(
            trip_reference="TRP-2026-0002",
            order_number="FDX-002",
            operator_organization_id=uuid.uuid4(),
            client_organization_id=uuid.uuid4(),
            driver_id=uuid.uuid4(),
            horse_id=uuid.uuid4(),
            origin_precinct_id=uuid.uuid4(),
            destination_precinct_id=uuid.uuid4(),
            created_by_user_id=uuid.uuid4(),
            planned_departure_at=datetime(2026, 5, 1, 16, 0, tzinfo=timezone.utc),
            planned_arrival_at=datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc),
        )


def test_trip_only_departure_no_arrival_valid():
    """Validator must not fire when only one of the two fields is provided."""
    from app.schemas.trips import TripCreate
    import uuid
    t = TripCreate(
        trip_reference="TRP-2026-0003",
        order_number="FDX-003",
        operator_organization_id=uuid.uuid4(),
        client_organization_id=uuid.uuid4(),
        driver_id=uuid.uuid4(),
        horse_id=uuid.uuid4(),
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
        created_by_user_id=uuid.uuid4(),
        planned_departure_at=datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc),
    )
    assert t.planned_departure_at is not None
    assert t.planned_arrival_at is None


# ---------------------------------------------------------------------------
# HandshakeEventCreate — sequence_number must be 0–5
# ---------------------------------------------------------------------------

def test_handshake_sequence_number_valid():
    from app.schemas.handshakes import HandshakeEventCreate
    import uuid
    h = HandshakeEventCreate(
        trip_id=uuid.uuid4(),
        handshake_type="loading",
        sequence_number=2,
    )
    assert h.sequence_number == 2


def test_handshake_sequence_number_too_high():
    from app.schemas.handshakes import HandshakeEventCreate
    import uuid
    with pytest.raises(Exception):
        HandshakeEventCreate(
            trip_id=uuid.uuid4(),
            handshake_type="loading",
            sequence_number=6,
        )


def test_handshake_sequence_number_negative():
    from app.schemas.handshakes import HandshakeEventCreate
    import uuid
    with pytest.raises(Exception):
        HandshakeEventCreate(
            trip_id=uuid.uuid4(),
            handshake_type="loading",
            sequence_number=-1,
        )


# ---------------------------------------------------------------------------
# MerkleBatchLeafCreate — source_type must be "checkpoint", "exception", or "artifact"
# ---------------------------------------------------------------------------

def test_merkle_leaf_source_type_valid():
    from app.schemas.blockchain import MerkleBatchLeafCreate
    import uuid
    for valid in ("checkpoint", "exception", "artifact"):
        leaf = MerkleBatchLeafCreate(
            batch_id=uuid.uuid4(),
            leaf_index=0,
            leaf_hash="a" * 64,
            source_type=valid,
            source_id=uuid.uuid4(),
        )
        assert leaf.source_type == valid


def test_merkle_leaf_source_type_invalid():
    from app.schemas.blockchain import MerkleBatchLeafCreate
    import uuid
    with pytest.raises(Exception):
        MerkleBatchLeafCreate(
            batch_id=uuid.uuid4(),
            leaf_index=0,
            leaf_hash="a" * 64,
            source_type="trip",
            source_id=uuid.uuid4(),
        )
