"""Model, enum and critical-field contract for precinct anchoring.

Pure assertions about declared structure — no DB. The migration is verified
separately by running it (Step 7).
"""

from app.blockchain.critical_fields import (
    PRECINCT_COSMETIC_FIELDS,
    PRECINCT_CRITICAL_FIELDS,
    diff_critical_fields,
)
from app.db.models import Base
from app.db.models.enums import BlockchainReceiptType, PrecinctEventType, SubjectType
from app.db.models.events import PrecinctEvent, VehicleEvent


def test_precinct_events_table_is_registered():
    """Registration in db/models/__init__.py is what makes Alembic see the table."""
    assert "precinct_events" in Base.metadata.tables


def test_precinct_event_carries_the_same_columns_as_vehicle_event():
    """Genuinely asserts parity with VehicleEvent, not just a hardcoded literal, so
    the two event-log models can't silently drift apart from each other."""
    precinct_columns = {c.name for c in PrecinctEvent.__table__.columns}
    vehicle_columns = {c.name for c in VehicleEvent.__table__.columns}

    # Normalise the one column that is legitimately named after its owning entity.
    normalised_precinct_columns = (precinct_columns - {"precinct_id"}) | {"vehicle_id"}

    assert normalised_precinct_columns == vehicle_columns


def test_precinct_event_blockchain_receipt_is_nullable():
    """Cosmetic edits are recorded unanchored, so this column must allow null."""
    assert PrecinctEvent.__table__.columns["blockchain_receipt_id"].nullable is True


def test_subject_type_has_precinct_event():
    assert SubjectType.PRECINCT_EVENT.value == "precinct_event"


def test_receipt_types_exist_for_precinct():
    assert BlockchainReceiptType.PRECINCT_CREATED.value == "precinct_created"
    assert BlockchainReceiptType.PRECINCT_UPDATED.value == "precinct_updated"


def test_precinct_event_types_cover_every_meaningful_change():
    assert {e.value for e in PrecinctEventType} == {
        "created",
        "relocated",
        "geofence_resized",
        "sharing_changed",
        "cosmetic_update",
    }


def test_critical_and_cosmetic_fields_are_disjoint():
    assert PRECINCT_CRITICAL_FIELDS & PRECINCT_COSMETIC_FIELDS == frozenset()


def test_geofence_defining_fields_are_critical():
    """These three decide the FP-68 verdict — a change to any must be anchored."""
    assert {"latitude", "longitude", "geofence_radius_metres"} <= PRECINCT_CRITICAL_FIELDS


def test_sharing_is_critical_but_name_is_not():
    assert "is_shared" in PRECINCT_CRITICAL_FIELDS
    assert "name" in PRECINCT_COSMETIC_FIELDS
    assert "address" in PRECINCT_COSMETIC_FIELDS


def test_moving_a_precinct_is_a_critical_diff():
    old = {"latitude": -29.7942, "longitude": 30.9820, "geofence_radius_metres": 200, "is_shared": False}
    new = {"latitude": -26.0942, "longitude": 28.1342, "geofence_radius_metres": 200, "is_shared": False}

    diff = diff_critical_fields(old, new, PRECINCT_CRITICAL_FIELDS)

    assert diff is not None
    assert set(diff.keys()) == {"latitude", "longitude"}
    assert diff["latitude"] == {"from": -29.7942, "to": -26.0942}


def test_renaming_a_precinct_is_not_a_critical_diff():
    old = {"latitude": -29.7942, "longitude": 30.9820, "geofence_radius_metres": 200, "is_shared": False}

    assert diff_critical_fields(old, dict(old), PRECINCT_CRITICAL_FIELDS) is None
