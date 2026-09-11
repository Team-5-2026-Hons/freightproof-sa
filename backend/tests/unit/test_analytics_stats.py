"""Unit tests for the analytics arithmetic and the result models' derived fields.

Pure logic — no DB. The integration suite (tests/integration/test_analytics.py) covers
the views themselves; this file pins down the one place rates are divided and
percentiles interpolated.
"""

import uuid
from datetime import date

import pytest

from app.analytics.stats import (
    MEDIAN_FRACTION,
    P90_FRACTION,
    percentile,
    safe_ratio,
    validate_month_range,
)
from app.schemas.analytics import DriverMetrics, DurationStats, FacilityMetrics


def _driver_metrics(**overrides: int | float) -> DriverMetrics:
    fields: dict[str, int | float] = {name: 0 for name in DriverMetrics.model_fields if name != "driver_id"}
    fields.update(overrides)
    return DriverMetrics(driver_id=uuid.uuid4(), **fields)


# ── safe_ratio ───────────────────────────────────────────────────────────────


def test_safe_ratio_divides() -> None:
    result = safe_ratio(1, 4)

    assert result == 0.25


def test_safe_ratio_zero_denominator_returns_none() -> None:
    result = safe_ratio(0, 0)

    assert result is None


# ── percentile ───────────────────────────────────────────────────────────────


def test_percentile_empty_returns_none() -> None:
    result = percentile([], MEDIAN_FRACTION)

    assert result is None


def test_percentile_single_value_is_that_value() -> None:
    result = percentile([42.0], P90_FRACTION)

    assert result == 42.0


def test_percentile_median_interpolates_between_middle_values() -> None:
    result = percentile([100.0, 200.0, 300.0, 1000.0], MEDIAN_FRACTION)

    assert result == pytest.approx(250.0)


def test_percentile_p90_interpolates_linearly() -> None:
    # rank = 0.9 * (4 - 1) = 2.7 -> 300 + (1000 - 300) * 0.7
    result = percentile([100.0, 200.0, 300.0, 1000.0], P90_FRACTION)

    assert result == pytest.approx(790.0)


def test_percentile_ignores_input_order() -> None:
    ordered = percentile([1.0, 2.0, 3.0, 4.0, 5.0], P90_FRACTION)

    shuffled = percentile([4.0, 1.0, 5.0, 3.0, 2.0], P90_FRACTION)

    assert shuffled == ordered


def test_percentile_fraction_out_of_range_raises() -> None:
    with pytest.raises(ValueError):
        percentile([1.0], 1.5)


def test_percentile_of_pooled_months_differs_from_average_of_monthly_medians() -> None:
    # The reason lane_analytics stores arrays: medians do not recombine.
    month_a = [100.0, 200.0, 300.0]
    month_b = [1000.0]

    pooled = percentile(month_a + month_b, MEDIAN_FRACTION)
    median_a = percentile(month_a, MEDIAN_FRACTION)
    median_b = percentile(month_b, MEDIAN_FRACTION)

    assert pooled == pytest.approx(250.0)
    assert median_a is not None and median_b is not None
    assert (median_a + median_b) / 2 == pytest.approx(600.0)


# ── validate_month_range ─────────────────────────────────────────────────────


def test_validate_month_range_single_month_accepted() -> None:
    validate_month_range(date(2026, 3, 1), date(2026, 3, 1))


def test_validate_month_range_mid_month_date_raises() -> None:
    with pytest.raises(ValueError):
        validate_month_range(date(2026, 3, 15), date(2026, 4, 1))


def test_validate_month_range_reversed_raises() -> None:
    with pytest.raises(ValueError):
        validate_month_range(date(2026, 5, 1), date(2026, 4, 1))


# ── DurationStats ────────────────────────────────────────────────────────────


def test_duration_stats_empty_has_no_statistics() -> None:
    stats = DurationStats.from_values([])

    assert stats.sample_count == 0
    assert stats.mean is None
    assert stats.minimum is None
    assert stats.maximum is None
    assert stats.median is None
    assert stats.p90 is None


def test_duration_stats_computes_every_statistic_from_one_list() -> None:
    stats = DurationStats.from_values([300.0, 100.0, 1000.0, 200.0])

    assert stats.sample_count == 4
    assert stats.mean == pytest.approx(400.0)
    assert stats.minimum == 100.0
    assert stats.maximum == 1000.0
    assert stats.median == pytest.approx(250.0)
    assert stats.p90 == pytest.approx(790.0)


# ── Derived fields on the result models ──────────────────────────────────────


def test_driver_metrics_rates_are_none_without_observations() -> None:
    metrics = _driver_metrics()

    assert metrics.exception_trip_rate is None
    assert metrics.on_time_departure_rate is None
    assert metrics.override_rate is None
    assert metrics.activation_dwell_minutes_avg is None
    assert metrics.confirmation_dwell_minutes_avg is None


def test_driver_metrics_rates_divide_the_summed_ingredients() -> None:
    metrics = _driver_metrics(
        trip_count=4,
        trips_with_exceptions_count=1,
        departures_with_plan_count=3,
        on_time_departures_count=2,
        phase_events_count=28,
        override_count=7,
        loading_dwell_minutes_sum=90.0,
        loading_dwell_events_count=3,
    )

    assert metrics.exception_trip_rate == pytest.approx(0.25)
    assert metrics.on_time_departure_rate == pytest.approx(2 / 3)
    assert metrics.override_rate == pytest.approx(0.25)
    assert metrics.loading_dwell_minutes_avg == pytest.approx(30.0)


def test_driver_metrics_confirmation_dwell_carries_receiver_caveat() -> None:
    schema = DriverMetrics.model_json_schema(mode="serialization")

    description = schema["properties"]["confirmation_dwell_minutes_avg"]["description"]

    assert "receiver" in description


def test_facility_corroboration_rate_excludes_unwitnessed() -> None:
    metrics = FacilityMetrics(
        precinct_id=uuid.uuid4(), confirmed_count=3, mismatch_count=1, unwitnessed_count=50
    )

    assert metrics.corroboration_rate == pytest.approx(0.75)


def test_facility_corroboration_rate_none_when_nothing_was_checked() -> None:
    metrics = FacilityMetrics(
        precinct_id=uuid.uuid4(), confirmed_count=0, mismatch_count=0, unwitnessed_count=5
    )

    assert metrics.corroboration_rate is None
