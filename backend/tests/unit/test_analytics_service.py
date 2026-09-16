"""Unit tests for the analytics service's pure assembly step: FP-153 result rows plus
looked-up names -> response rows.

No DB. The lookups themselves (org-scoped drivers and vehicles, precincts by id only) are
proven in tests/integration/test_analytics_endpoints.py.
"""

import uuid
from datetime import date

import pytest

from app.db.models.enums import VehicleType
from app.orchestration.analytics_service import (
    VehicleLabel,
    attach_driver_names,
    attach_facility_names,
    attach_lane_names,
    attach_vehicle_registrations,
    check_month_range,
)
from app.schemas.analytics import (
    DriverMetrics,
    DurationStats,
    FacilityMetrics,
    LaneMetrics,
    VehicleMetrics,
)


def _driver_metrics(**overrides: int | float) -> DriverMetrics:
    fields: dict[str, int | float] = {
        name: 0 for name in DriverMetrics.model_fields if name != "driver_id"
    }
    fields.update(overrides)
    return DriverMetrics(driver_id=uuid.uuid4(), **fields)


def _vehicle_metrics() -> VehicleMetrics:
    return VehicleMetrics(
        vehicle_id=uuid.uuid4(), trip_count=3, mechanical_exceptions_count=1,
        mechanical_info_count=0, mechanical_warning_count=1, mechanical_critical_count=0,
        mechanical_gap_minutes_sum=0, mechanical_gap_count=0, driving_hours_sum=12.5,
    )


def _lane_metrics() -> LaneMetrics:
    return LaneMetrics(
        origin_precinct_id=uuid.uuid4(), destination_precinct_id=uuid.uuid4(),
        trip_count=2, exception_count=1,
        actual_transit_minutes=DurationStats.from_values([100.0, 300.0]),
        schedule_delta_minutes=DurationStats.from_values([]),
    )


# ── check_month_range ────────────────────────────────────────────────────────


def test_check_month_range_accepts_first_of_month_bounds() -> None:
    check_month_range(date(2026, 6, 1), date(2026, 8, 1))


@pytest.mark.parametrize(
    ("start_month", "end_month"),
    [(date(2026, 6, 15), date(2026, 8, 1)), (date(2026, 8, 1), date(2026, 6, 1))],
    ids=["mid-month", "start-after-end"],
)
def test_check_month_range_rejects_a_range_the_views_cannot_answer(
    start_month: date, end_month: date,
) -> None:
    with pytest.raises(ValueError):
        check_month_range(start_month, end_month)


# ── attach_driver_names ──────────────────────────────────────────────────────


def test_attach_driver_names_names_each_driver() -> None:
    row = _driver_metrics(trip_count=2)

    [response] = attach_driver_names([row], {row.driver_id: "Thandi Mokoena"})

    assert response.driver_id == row.driver_id
    assert response.driver_name == "Thandi Mokoena"


def test_attach_driver_names_missing_name_keeps_row_with_none() -> None:
    row = _driver_metrics(trip_count=2)

    responses = attach_driver_names([row], {})

    assert len(responses) == 1
    assert responses[0].driver_name is None
    assert responses[0].trip_count == 2


def test_attach_driver_names_preserves_order() -> None:
    rows = [_driver_metrics(trip_count=count) for count in (1, 2, 3)]
    names = {rows[0].driver_id: "First", rows[2].driver_id: "Third"}

    responses = attach_driver_names(rows, names)

    assert [response.driver_id for response in responses] == [row.driver_id for row in rows]
    assert [response.driver_name for response in responses] == ["First", None, "Third"]


def test_attach_driver_names_keeps_every_count_and_rate() -> None:
    row = _driver_metrics(
        trip_count=4, trips_with_exceptions_count=1,
        confirmation_dwell_minutes_sum=30, confirmation_dwell_events_count=2,
    )

    [response] = attach_driver_names([row], {row.driver_id: "Thandi Mokoena"})

    # Stored counts AND computed rates identical to FP-153's row — nothing reinterpreted.
    assert response.model_dump(exclude={"driver_name"}) == row.model_dump()
    assert response.exception_trip_rate == pytest.approx(0.25)
    assert response.confirmation_dwell_minutes_avg == pytest.approx(15.0)
    assert response.on_time_departure_rate is None


# ── Vehicles, lanes, facilities ──────────────────────────────────────────────


def test_attach_vehicle_registrations_sets_registration_and_type() -> None:
    horse, trailer = _vehicle_metrics(), _vehicle_metrics()
    labels = {
        horse.vehicle_id: VehicleLabel("CA 123-456", VehicleType.HORSE),
        trailer.vehicle_id: VehicleLabel("CA 654-321", VehicleType.TRAILER),
    }

    responses = attach_vehicle_registrations([horse, trailer], labels)

    assert [(response.registration, response.vehicle_type) for response in responses] == [
        ("CA 123-456", VehicleType.HORSE), ("CA 654-321", VehicleType.TRAILER),
    ]


def test_attach_vehicle_registrations_missing_registration_is_none() -> None:
    known, unknown = _vehicle_metrics(), _vehicle_metrics()

    responses = attach_vehicle_registrations(
        [known, unknown], {known.vehicle_id: VehicleLabel("CA 123-456", VehicleType.HORSE)},
    )

    assert [response.registration for response in responses] == ["CA 123-456", None]
    assert [response.vehicle_type for response in responses] == [VehicleType.HORSE, None]
    assert responses[1].model_dump(exclude={"registration", "vehicle_type"}) == unknown.model_dump()


def test_attach_lane_names_names_each_end_independently() -> None:
    row = _lane_metrics()

    [response] = attach_lane_names([row], {row.origin_precinct_id: "Cape Town DC"})

    assert response.origin_precinct_name == "Cape Town DC"
    assert response.destination_precinct_name is None
    assert response.actual_transit_minutes == row.actual_transit_minutes
    assert response.exception_density == pytest.approx(0.5)


def test_attach_facility_names_keeps_unwitnessed_out_of_the_rate() -> None:
    row = FacilityMetrics(
        precinct_id=uuid.uuid4(), confirmed_count=1, mismatch_count=1, unwitnessed_count=5,
    )

    [response] = attach_facility_names([row], {row.precinct_id: "Durban Depot"})

    assert response.precinct_name == "Durban Depot"
    assert response.unwitnessed_count == 5
    assert response.corroboration_rate == pytest.approx(0.5)


def test_attach_functions_with_no_rows_return_empty_lists() -> None:
    assert attach_driver_names([], {}) == []
    assert attach_vehicle_registrations([], {}) == []
    assert attach_lane_names([], {}) == []
    assert attach_facility_names([], {}) == []
