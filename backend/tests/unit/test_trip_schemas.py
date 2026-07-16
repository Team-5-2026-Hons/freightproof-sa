"""Unit tests for TripCreateRequest validation (trip creation redesign)."""
import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.db.models.enums import TripType
from app.schemas.trips import ConsignmentRead, TripConsignmentInput, TripCreateRequest


def _payload(**overrides):
    base = dict(
        order_number="ORD-1",
        driver_id=uuid.uuid4(),
        horse_id=uuid.uuid4(),
        trailer_ids=[uuid.uuid4()],
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
        consignments=[{"pp_reference": "WAY001", "unit_count_expected": 4}],
    )
    base.update(overrides)
    return base


def test_loaded_without_consignments_rejected():
    with pytest.raises(ValidationError, match="at least one consignment"):
        TripCreateRequest(**_payload(consignments=[]))


def test_empty_leg_with_consignments_rejected():
    with pytest.raises(ValidationError, match="cannot carry consignments"):
        TripCreateRequest(**_payload(trip_type=TripType.EMPTY_LEG))


def test_empty_leg_without_consignments_valid():
    req = TripCreateRequest(**_payload(trip_type=TripType.EMPTY_LEG, consignments=[]))

    assert req.trip_type == TripType.EMPTY_LEG


def test_duplicate_pp_references_rejected():
    dup = [
        {"pp_reference": "WAY001", "unit_count_expected": 4},
        {"pp_reference": "WAY001", "unit_count_expected": 2},
    ]
    with pytest.raises(ValidationError, match="duplicate pp_reference"):
        TripCreateRequest(**_payload(consignments=dup))


def test_zero_trailers_valid():
    req = TripCreateRequest(**_payload(trailer_ids=[]))

    assert req.trailer_ids == []


def test_client_organization_id_removed():
    assert "client_organization_id" not in TripCreateRequest.model_fields


def test_pp_reference_field_removed():
    assert "pp_reference" not in TripCreateRequest.model_fields


def test_unit_count_must_be_positive():
    with pytest.raises(ValidationError):
        TripConsignmentInput(pp_reference="WAY001", unit_count_expected=0)


def test_duplicate_trailer_ids_rejected():
    """Moved from test_schema_validators.py (CQ-4/CQ-5) — still valid after the
    redesign, just needs a consignments list since trip_type now defaults to LOADED."""
    shared = uuid.uuid4()
    with pytest.raises(ValidationError, match="duplicate"):
        TripCreateRequest(**_payload(trailer_ids=[shared, shared]))


def test_consignment_read_allows_null_client_org():
    """Regression: client_organization_id is nullable in the DB (unresolved PP
    accnum = NULL + warning), so ConsignmentRead must accept None or trip detail
    reads 500 on such rows."""
    now = datetime(2026, 7, 14, tzinfo=timezone.utc)

    read = ConsignmentRead(
        id=uuid.uuid4(),
        parcel_perfect_reference="WAY001",
        client_organization_id=None,
        created_at=now,
        updated_at=now,
    )

    assert read.client_organization_id is None
