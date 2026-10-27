"""Unit tests for FP-112: TripStop model defaults and TripCreateRequest stop validation.

Pure logic / in-memory model construction only — no DB, no HTTP.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.db.models.trips import Consignment, TripStop
from app.schemas.trips import TripCreateRequest, TripStopCreate


def test_tripstop_optional_fields_default_to_none():
    stop = TripStop(trip_id=uuid.uuid4(), precinct_id=uuid.uuid4(), sequence=0)
    assert stop.slot_time is None
    assert stop.notes is None


def test_consignment_fp112_fields_default_to_none():
    consignment = Consignment(
        parcel_perfect_reference="PP-1",
        client_organization_id=uuid.uuid4(),
    )
    assert consignment.pickup_stop_id is None
    assert consignment.delivery_stop_id is None
    assert consignment.load_priority is None
    assert consignment.unit_count_expected is None
    assert consignment.pp_manifest_number is None


def _base_kwargs() -> dict:
    return {
        "order_number": "ORD-1",
        "driver_id": uuid.uuid4(),
        "horse_id": uuid.uuid4(),
        "trailer_ids": [uuid.uuid4()],
        "consignments": [{"pp_reference": "WAY001", "unit_count_expected": 4}],
        "planned_departure_at": datetime.now(UTC),
        "planned_arrival_at": datetime.now(UTC) + timedelta(hours=10),
    }


def test_stops_omitted_with_origin_and_destination_is_valid():
    req = TripCreateRequest(
        **_base_kwargs(),
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
    )
    assert req.stops is None


def test_stops_omitted_missing_destination_raises():
    with pytest.raises(ValidationError):
        TripCreateRequest(**_base_kwargs(), origin_precinct_id=uuid.uuid4())


def test_stops_omitted_missing_origin_raises():
    with pytest.raises(ValidationError):
        TripCreateRequest(**_base_kwargs(), destination_precinct_id=uuid.uuid4())


def test_origin_equal_destination_raises():
    precinct_id = uuid.uuid4()
    with pytest.raises(ValidationError):
        TripCreateRequest(
            **_base_kwargs(),
            origin_precinct_id=precinct_id,
            destination_precinct_id=precinct_id,
        )


def test_explicit_stops_without_origin_destination_is_valid():
    req = TripCreateRequest(
        **_base_kwargs(),
        stops=[
            TripStopCreate(precinct_id=uuid.uuid4(), sequence=0),
            TripStopCreate(precinct_id=uuid.uuid4(), sequence=1),
            TripStopCreate(precinct_id=uuid.uuid4(), sequence=2),
        ],
    )
    assert req.origin_precinct_id is None
    assert req.destination_precinct_id is None
    assert len(req.stops) == 3


def test_stops_with_duplicate_sequence_raises():
    with pytest.raises(ValidationError):
        TripCreateRequest(
            **_base_kwargs(),
            stops=[
                TripStopCreate(precinct_id=uuid.uuid4(), sequence=0),
                TripStopCreate(precinct_id=uuid.uuid4(), sequence=0),
            ],
        )


def test_stops_with_fewer_than_two_raises():
    with pytest.raises(ValidationError):
        TripCreateRequest(
            **_base_kwargs(),
            stops=[TripStopCreate(precinct_id=uuid.uuid4(), sequence=0)],
        )

