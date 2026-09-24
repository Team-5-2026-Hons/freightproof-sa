"""Pure road rules: no DB, no Pulsit, no Redis."""

import uuid
from decimal import Decimal

from app.db.models.enums import ExceptionSeverity, ExceptionType
from app.db.models.organisations import Precinct
from app.integrations.pulsit import PulsitFixStatus
from app.orchestration.road_check_service import (
    RigReading,
    RigRole,
    RoadStage,
    evaluate_road_readings,
)

_MAX_SEPARATION = 500.0
# ~1.1 km of latitude per 0.01 degree: far enough to exceed the 500 m threshold.
_ORIGIN = (Decimal("-33.9249000"), Decimal("18.4241000"))
_NEAR = (Decimal("-33.9250000"), Decimal("18.4241000"))    # ~11 m from origin
_FAR = (Decimal("-33.9349000"), Decimal("18.4241000"))     # ~1.1 km from origin


def _reading(role: RigRole, position: tuple[Decimal, Decimal] | None, *,
             status: PulsitFixStatus = PulsitFixStatus.OK, registration: str = "CA 1") -> RigReading:
    # A missing position with the default status reads as a dark tracker (NO_FIX); an
    # explicit status such as UNKNOWN_DEVICE is kept as given.
    effective_status = PulsitFixStatus.NO_FIX if position is None and status is PulsitFixStatus.OK else status
    return RigReading(
        vehicle_id=uuid.uuid4(), registration=registration, role=role, status=effective_status,
        lat=position[0] if position else None, lng=position[1] if position else None,
    )


def _on_road() -> RoadStage:
    return RoadStage(
        current_phase_event_id=uuid.uuid4(), trip_stop_id=uuid.uuid4(),
        on_road=True, pending_departure_id=None, stop_precinct=None,
    )


def _at_origin() -> RoadStage:
    precinct = Precinct(
        id=uuid.uuid4(), name="Cape Town DC", principal_organization_id=uuid.uuid4(),
        latitude=_ORIGIN[0], longitude=_ORIGIN[1], geofence_radius_metres=200,
    )
    return RoadStage(
        current_phase_event_id=uuid.uuid4(), trip_stop_id=uuid.uuid4(),
        on_road=False, pending_departure_id=uuid.uuid4(), stop_precinct=precinct,
    )


def test_trailer_far_from_horse_on_road_is_critical_separation():
    stage = _on_road()
    trailer = _reading(RigRole.TRAILER, _FAR, registration="TRL 222")

    findings = evaluate_road_readings(
        stage=stage, readings=[_reading(RigRole.HORSE, _ORIGIN), trailer],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert [f.exception_type for f in findings] == [ExceptionType.TRAILER_SEPARATED_IN_TRANSIT]
    finding = findings[0]
    assert finding.severity == ExceptionSeverity.CRITICAL
    assert finding.phase_event_id == stage.current_phase_event_id
    assert finding.vehicle_id == trailer.vehicle_id
    assert (finding.lat, finding.lng) == _FAR
    assert "TRL 222" in finding.description


def test_trailer_within_threshold_raises_nothing():
    findings = evaluate_road_readings(
        stage=_on_road(),
        readings=[_reading(RigRole.HORSE, _ORIGIN), _reading(RigRole.TRAILER, _NEAR)],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert findings == []


def test_no_horse_position_means_no_separation_verdict():
    findings = evaluate_road_readings(
        stage=_on_road(),
        readings=[_reading(RigRole.HORSE, None), _reading(RigRole.TRAILER, _FAR)],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert [f.exception_type for f in findings] == [ExceptionType.TRACKER_SILENT]


def test_silent_tracker_is_a_warning_on_the_current_phase():
    stage = _on_road()
    silent = _reading(RigRole.TRAILER, None, registration="TRL 333")

    findings = evaluate_road_readings(
        stage=stage, readings=[_reading(RigRole.HORSE, _ORIGIN), silent],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert len(findings) == 1
    assert findings[0].exception_type == ExceptionType.TRACKER_SILENT
    assert findings[0].severity == ExceptionSeverity.WARNING
    assert findings[0].vehicle_id == silent.vehicle_id
    assert findings[0].phase_event_id == stage.current_phase_event_id
    assert (findings[0].lat, findings[0].lng) == (None, None)


def test_unknown_device_raises_nothing():
    findings = evaluate_road_readings(
        stage=_on_road(),
        readings=[
            _reading(RigRole.HORSE, _ORIGIN),
            _reading(RigRole.TRAILER, None, status=PulsitFixStatus.UNKNOWN_DEVICE),
        ],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert findings == []


def test_horse_outside_stop_before_departure_is_critical():
    stage = _at_origin()
    horse = _reading(RigRole.HORSE, _FAR, registration="CA 123")

    findings = evaluate_road_readings(stage=stage, readings=[horse], max_separation_metres=_MAX_SEPARATION)

    assert [f.exception_type for f in findings] == [ExceptionType.MOVED_BEFORE_DEPARTURE]
    assert findings[0].severity == ExceptionSeverity.CRITICAL
    assert findings[0].phase_event_id == stage.pending_departure_id
    assert findings[0].vehicle_id == horse.vehicle_id
    assert "Cape Town DC" in findings[0].description


def test_horse_inside_stop_before_departure_raises_nothing():
    findings = evaluate_road_readings(
        stage=_at_origin(), readings=[_reading(RigRole.HORSE, _NEAR)],
        max_separation_metres=_MAX_SEPARATION,
    )

    assert findings == []


def test_separation_rule_does_not_run_at_a_stop():
    stage = _at_origin()

    findings = evaluate_road_readings(
        stage=stage,
        readings=[_reading(RigRole.HORSE, _NEAR), _reading(RigRole.TRAILER, _FAR)],
        max_separation_metres=_MAX_SEPARATION,
    )

    # Trailer separation at a stop is TRAILER_LOCATION_MISMATCH's job (phase_service).
    assert findings == []
