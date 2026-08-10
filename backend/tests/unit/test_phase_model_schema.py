"""Unit tests for the phase-refactor's data-model changes (parent plan D3/D4/D6).

Inspects SQLAlchemy metadata only -- no engine, no session, no DB. Mirrors
test_model_schema_v6.py's `_column_names` style.

Run: pytest tests/unit/test_phase_model_schema.py -v
"""


def _column_names(model_cls) -> set[str]:
    return {c.name for c in model_cls.__table__.columns}


def test_phase_event_has_trip_stop_anchor_status_idempotency_key():
    """D3/D4: trip_stop_id (nullable), anchor_status (non-nullable), idempotency_key exist."""
    from app.db.models.phases import PhaseEvent

    cols = {c.name: c for c in PhaseEvent.__table__.columns}

    assert "trip_stop_id" in cols
    assert cols["trip_stop_id"].nullable

    assert "anchor_status" in cols
    assert not cols["anchor_status"].nullable

    assert "idempotency_key" in cols


def test_phase_event_uniqueness_is_per_stop():
    """uq_phase_events_trip_stop_type replaces the old (trip_id, phase_type) constraint."""
    from sqlalchemy import UniqueConstraint

    from app.db.models.phases import PhaseEvent

    unique_constraints = [
        arg for arg in PhaseEvent.__table_args__ if isinstance(arg, UniqueConstraint)
    ]
    constraint_names = {uc.name for uc in unique_constraints}
    constraint_column_sets = [
        {col.name if hasattr(col, "name") else col for col in uc.columns}
        for uc in unique_constraints
    ]

    assert "uq_phase_events_trip_stop_type" in constraint_names
    assert {"trip_id", "trip_stop_id", "phase_type"} in constraint_column_sets
    assert {"trip_id", "phase_type"} not in constraint_column_sets


def test_trip_has_current_phase_and_current_stop():
    """D6: current_phase and current_stop exist on Trip and are both nullable."""
    from app.db.models.trips import Trip

    cols = {c.name: c for c in Trip.__table__.columns}

    assert "current_phase" in cols
    assert cols["current_phase"].nullable

    assert "current_stop" in cols
    assert cols["current_stop"].nullable


def test_exception_and_gps_snapshot_point_at_phase_events():
    """TripException.phase_event_id and TrailerGpsSnapshot.phase_event_id both FK to phase_events."""
    from app.db.models.phases import TrailerGpsSnapshot
    from app.db.models.transit import TripException

    exception_cols = {c.name: c for c in TripException.__table__.columns}
    assert "phase_event_id" in exception_cols
    exception_fk_targets = {fk.column.table.name for fk in exception_cols["phase_event_id"].foreign_keys}
    assert "phase_events" in exception_fk_targets

    gps_cols = {c.name: c for c in TrailerGpsSnapshot.__table__.columns}
    assert "phase_event_id" in gps_cols
    gps_fk_targets = {fk.column.table.name for fk in gps_cols["phase_event_id"].foreign_keys}
    assert "phase_events" in gps_fk_targets
