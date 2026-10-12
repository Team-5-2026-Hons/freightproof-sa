"""Pure trace derivation: multi-stop boundaries, overrides, old plans and seal evidence."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest

from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.orchestration.parcel_trace.evidence import RESOLVED_STATUSES
from app.orchestration.parcel_trace.projection import project_journey
from app.orchestration.parcel_trace.queries import JourneyRecords
from app.orchestration.phases.plan import PlanStop, build_phase_plan
from app.orchestration.phases.state import _is_resolved


def records(*, stops_count: int = 2, pickup: int = 0, delivery: int = 1) -> JourneyRecords:
    now = datetime.now(UTC)
    trip = Trip(id=uuid4(), trip_reference="Trace trip", status="active", created_at=now)
    stops = [TripStop(id=uuid4(), trip_id=trip.id, precinct_id=uuid4(), sequence=i) for i in range(stops_count)]
    cargo = Consignment(id=uuid4(), trip_id=trip.id, pickup_stop_id=stops[pickup].id, delivery_stop_id=stops[delivery].id)
    plan = build_phase_plan([PlanStop(i, i < stops_count - 1, i > 0) for i in range(stops_count)])
    phases = [PhaseEvent(
        id=uuid4(), trip_id=trip.id, trip_stop_id=stops[p.stop_sequence].id if p.stop_sequence is not None else None,
        sequence_number=p.sequence_number, phase_type=p.phase_type, status="completed", anchor_status="anchored",
        completed_at=now, created_at=now,
    ) for p in plan]
    for p in phases:
        if p.phase_type in {PhaseType.DEPARTURE, PhaseType.ARRIVAL}:
            p.seal_number = "seal-123"
        if p.phase_type == PhaseType.ARRIVAL:
            p.seal_condition = "intact"
    return JourneyRecords(trip=trip, phases=phases, stops=stops, consignment=cargo,
                          precinct_names={s.precinct_id: f"Depot {s.sequence}" for s in stops})


@pytest.mark.parametrize("status", list(PhaseStatus))
def test_trace_resolution_matches_existing_engine(status: PhaseStatus) -> None:
    assert (status in RESOLVED_STATUSES) == _is_resolved(status)


def test_multi_stop_seal_windows_are_per_leg() -> None:
    result = project_journey(records(stops_count=3, delivery=2))
    assert len(result.seal_windows) == 2
    assert all(w.status == "matched" for w in result.seal_windows)
    assert result.seal_windows[0].destination_name == "Depot 1"
    assert result.seal_windows[1].origin_name == "Depot 1"
    assert not set(result.seal_windows[0].phase_ids) & set(result.seal_windows[1].phase_ids)


def test_through_carried_parcel_does_not_claim_other_cargo_was_its_loading() -> None:
    data = records(stops_count=3, delivery=2)
    result = project_journey(data)
    middle = {p.id for p in data.phases if p.trip_stop_id == data.stops[1].id and p.phase_type in {PhaseType.LOADING, PhaseType.UNLOADING}}
    assert middle
    assert all(p.relevance == "trip_context" for p in result.phases if p.id in middle)
    assert len(result.seal_windows) == 2


def test_completed_cargo_does_not_follow_truck_after_delivery() -> None:
    data = records(stops_count=3, delivery=1)
    data.phases[-2].status = PhaseStatus.PENDING
    for p in data.phases:
        p.horse_gps_lat = Decimal("-26")
        p.horse_gps_lng = Decimal("28")
    result = project_journey(data)
    assert result.progress.position == "after_delivery"
    assert result.progress.phase_type == PhaseType.UNLOADING
    assert result.last_recorded_location is not None
    assert result.last_recorded_location.precinct_name == "Depot 1"
    assert len(result.seal_windows) == 1


def test_before_pickup_does_not_invent_a_parcel_position() -> None:
    data = records(stops_count=3, pickup=1, delivery=2)
    for p in data.phases[4:]:
        p.status = PhaseStatus.PENDING
        p.completed_at = None
    data.phases[3].horse_gps_lat = Decimal("-26")
    data.phases[3].horse_gps_lng = Decimal("28")
    result = project_journey(data)
    assert result.progress.position == "before_pickup"
    assert result.last_recorded_location is None


@pytest.mark.parametrize("condition,seal,expected", [("intact", "seal-123", "matched"), ("damaged", "seal-123", "mismatch"), ("missing", None, "mismatch"), ("intact", "different", "mismatch"), (None, "seal-123", "unverified")])
def test_seal_summary_uses_actual_condition_and_number(condition: str | None, seal: str | None, expected: str) -> None:
    data = records()
    inspection = next(p for p in data.phases if p.phase_type == PhaseType.ARRIVAL)
    inspection.seal_condition, inspection.seal_number = condition, seal
    assert project_journey(data).seal_windows[0].status == expected


def test_overridden_arrival_never_claims_an_intact_seal_or_location() -> None:
    data = records()
    inspection = next(p for p in data.phases if p.phase_type == PhaseType.ARRIVAL)
    inspection.status = PhaseStatus.OVERRIDDEN
    inspection.horse_gps_lat, inspection.horse_gps_lng = Decimal("-26"), Decimal("28")
    result = project_journey(data)
    assert result.seal_windows[0].status == "unverified"
    assert result.progress.has_overrides
    assert result.last_recorded_location is None


def test_legacy_plan_does_not_gain_a_synthetic_arrival() -> None:
    data = records()
    data.phases = [p for p in data.phases if p.phase_type != PhaseType.ARRIVAL]
    unloading = next(p for p in data.phases if p.phase_type == PhaseType.UNLOADING)
    unloading.seal_number = "seal-123"
    result = project_journey(data)
    assert len(result.phases) == len(data.phases)
    assert all(p.phase_type != PhaseType.ARRIVAL for p in result.phases)
    assert result.seal_windows[0].inspection_phase_id == unloading.id
    assert result.seal_windows[0].status == "unverified"


def test_missing_stop_links_remain_unknown() -> None:
    data = records()
    assert data.consignment is not None
    data.consignment.pickup_stop_id = None
    result = project_journey(data)
    assert result.progress.position == "unknown"
    assert result.seal_windows == []
    assert all(p.relevance == "unknown" for p in result.phases)
    assert result.gaps


def test_cancelled_trip_retains_pending_rows_without_current_activity() -> None:
    data = records()
    data.trip.status = TripStatus.CANCELLED
    for p in data.phases[3:]:
        p.status = PhaseStatus.PENDING
        p.completed_at = None
    result = project_journey(data)
    assert result.progress.position == "cancelled"
    assert result.progress.phase_type == PhaseType.LOADING
    assert result.phases[-1].status == PhaseStatus.PENDING


def test_transit_gps_is_not_labelled_as_its_departure_depot() -> None:
    data = records()
    transit = next(p for p in data.phases if p.phase_type == PhaseType.IN_TRANSIT)
    transit.horse_gps_lat, transit.horse_gps_lng = Decimal("-29"), Decimal("30")
    result = project_journey(data)
    assert result.last_recorded_location is not None
    assert result.last_recorded_location.precinct_name is None
    assert result.last_recorded_location.captured_at is None


def test_scan_stamp_is_not_a_derived_delivery_confirmation() -> None:
    data = records()
    for p in data.phases[4:]:
        p.status = PhaseStatus.PENDING
        p.completed_at = None
    data.parcels = [Parcel(id=uuid4(), status="scanned_in", pp_scan_in_at=datetime.now(UTC))]
    result = project_journey(data)
    assert result.scans[0].status == "scanned_in"
    assert result.progress.position == "within_journey"
    assert result.progress.phase_type == PhaseType.IN_TRANSIT
