"""Unit tests for v6 model changes.

Covers:
  1. DriverSubstitution model — all four required log fields, is_planned flag,
     nullable exception_id for unplanned-only linkage.
  2. updated_at present on tables that previously lacked it:
     organizations, precincts, vehicles, trip_templates, sla_configs.

Run: pytest tests/unit/test_model_schema_v6.py -v
"""

import uuid
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# DriverSubstitution — model importable and has all required columns
# ---------------------------------------------------------------------------

def _column_names(model_cls) -> set[str]:
    return {c.name for c in model_cls.__table__.columns}


def test_driver_substitution_importable():
    from app.db.models.trips import DriverSubstitution  # noqa: F401


def test_driver_substitution_has_four_required_log_fields():
    """Spec §5+H3: original_driver_id, substituting_driver_id, exchange_location,
    approving_dispatcher_user_id must all be present and non-nullable."""
    from app.db.models.trips import DriverSubstitution

    cols = {c.name: c for c in DriverSubstitution.__table__.columns}

    for field in (
        "original_driver_id",
        "substituting_driver_id",
        "exchange_location",
        "approving_dispatcher_user_id",
    ):
        assert field in cols, f"missing required column: {field}"
        assert not cols[field].nullable, f"{field} must be non-nullable"


def test_driver_substitution_is_planned_non_nullable():
    """Planned substitutions are normal events; unplanned are exceptions.
    is_planned must be a non-nullable boolean to enforce this distinction."""
    from app.db.models.trips import DriverSubstitution

    cols = {c.name: c for c in DriverSubstitution.__table__.columns}
    assert "is_planned" in cols
    assert not cols["is_planned"].nullable


def test_driver_substitution_exception_id_nullable():
    """exception_id is only populated for unplanned substitutions."""
    from app.db.models.trips import DriverSubstitution

    cols = {c.name: c for c in DriverSubstitution.__table__.columns}
    assert "exception_id" in cols
    assert cols["exception_id"].nullable


def test_driver_substitution_trip_fk_present():
    from app.db.models.trips import DriverSubstitution

    fk_targets = {fk.column.table.name for col in DriverSubstitution.__table__.columns for fk in col.foreign_keys}
    assert "trips" in fk_targets


def test_driver_substitution_driver_fks_present():
    """Both original and substituting driver must FK to the drivers table."""
    from app.db.models.trips import DriverSubstitution

    driver_cols = {
        col.name
        for col in DriverSubstitution.__table__.columns
        for fk in col.foreign_keys
        if fk.column.table.name == "drivers"
    }
    assert "original_driver_id" in driver_cols
    assert "substituting_driver_id" in driver_cols


def test_driver_substitution_has_timestamps():
    from app.db.models.trips import DriverSubstitution

    names = _column_names(DriverSubstitution)
    assert "created_at" in names
    assert "substitution_at" in names


# ---------------------------------------------------------------------------
# updated_at present on tables that previously lacked it (CLAUDE.md standard)
# ---------------------------------------------------------------------------

def test_organization_has_updated_at():
    from app.db.models.organisations import Organization

    assert "updated_at" in _column_names(Organization)


def test_precinct_has_updated_at():
    from app.db.models.organisations import Precinct

    assert "updated_at" in _column_names(Precinct)


def test_vehicle_has_updated_at():
    from app.db.models.vehicles import Vehicle

    assert "updated_at" in _column_names(Vehicle)


def test_trip_template_has_updated_at():
    from app.db.models.trips import TripTemplate

    assert "updated_at" in _column_names(TripTemplate)


def test_sla_config_has_updated_at():
    from app.db.models.sla import SlaConfig

    assert "updated_at" in _column_names(SlaConfig)


# ---------------------------------------------------------------------------
# DriverSubstitutionCreate schema — validates the four required log fields
# ---------------------------------------------------------------------------

def test_driver_substitution_schema_valid():
    from app.schemas.trips import DriverSubstitutionCreate

    ds = DriverSubstitutionCreate(
        trip_id=uuid.uuid4(),
        original_driver_id=uuid.uuid4(),
        substituting_driver_id=uuid.uuid4(),
        exchange_location="Harrismith N3 fuel stop",
        approving_dispatcher_user_id=uuid.uuid4(),
        is_planned=True,
        substitution_at=datetime(2026, 5, 1, 14, 30, tzinfo=timezone.utc),
    )
    assert ds.is_planned is True
    assert ds.exception_id is None


def test_driver_substitution_schema_unplanned_accepts_exception_id():
    from app.schemas.trips import DriverSubstitutionCreate

    eid = uuid.uuid4()
    ds = DriverSubstitutionCreate(
        trip_id=uuid.uuid4(),
        original_driver_id=uuid.uuid4(),
        substituting_driver_id=uuid.uuid4(),
        exchange_location="Side of N3 near Mooi River",
        approving_dispatcher_user_id=uuid.uuid4(),
        is_planned=False,
        substitution_at=datetime(2026, 5, 1, 14, 30, tzinfo=timezone.utc),
        exception_id=eid,
    )
    assert ds.is_planned is False
    assert ds.exception_id == eid
