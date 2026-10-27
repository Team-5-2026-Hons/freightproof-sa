"""Unit tests for the Cost tab's pure arithmetic (app/analytics/cost_model.py).

Pure logic, no DB. The calibration test is the one that matters most at examination: it
shows the starting rates reproduce Bruce's own JHB–DBN example (≈ R20,000) rather than
being numbers we invented.
"""

from dataclasses import fields, replace
from decimal import Decimal

import pytest
from sqlalchemy import CheckConstraint, Table

from app.analytics.cost_model import (
    DEFAULT_COST_RATES,
    ZERO_COST,
    CostParts,
    CostRates,
    delay_cost,
    late_hours,
    route_km,
    to_rand,
    to_tenths,
    trip_operating_cost,
)
from app.core.constants import MAX_COST_RATE, MAX_LITRES_PER_100KM, MAX_ROAD_FACTOR, MIN_ROAD_FACTOR
from app.core.geo import haversine_metres
from app.db.models.cost import CostProfile

_JHB = (Decimal("-26.2041"), Decimal("28.0473"))
_DBN = (Decimal("-29.8587"), Decimal("31.0218"))
_PMB = (Decimal("-29.6006"), Decimal("30.3794"))
_BRUCE_RUN_RAND = Decimal("20000")
_BRUCE_RUN_HOURS = Decimal("9")
_CALIBRATION_TOLERANCE = Decimal("0.05")
_FLAT_RATES = CostRates(
    diesel_price_per_litre=Decimal("20"), litres_per_100km=Decimal("10"), running_per_km=Decimal("3"), driver_per_hour=Decimal("100"),
    delay_per_hour=Decimal("500"), fixed_per_trip=Decimal("50"), road_factor=Decimal("1"),
)


def _straight_km(a: tuple[Decimal, Decimal], b: tuple[Decimal, Decimal]) -> Decimal:
    return Decimal(repr(haversine_metres(*a, *b))) / Decimal(1000)


def test_default_rates_reproduce_bruce_jhb_dbn_run_within_five_percent() -> None:
    km = route_km([_JHB, _DBN], DEFAULT_COST_RATES.road_factor)

    total = trip_operating_cost(km, _BRUCE_RUN_HOURS, DEFAULT_COST_RATES).total

    assert abs(total - _BRUCE_RUN_RAND) / _BRUCE_RUN_RAND <= _CALIBRATION_TOLERANCE


def test_default_road_factor_turns_jhb_dbn_straight_line_into_n3_road_distance() -> None:
    km = route_km([_JHB, _DBN], DEFAULT_COST_RATES.road_factor)

    assert abs(km - Decimal(568)) / Decimal(568) <= _CALIBRATION_TOLERANCE


@pytest.mark.parametrize("points", [[], [_JHB]])
def test_route_km_with_fewer_than_two_stops_is_zero(points: list[tuple[Decimal, Decimal]]) -> None:
    assert route_km(points, Decimal("1.15")) == Decimal(0)


def test_route_km_two_stops_is_straight_line_times_factor() -> None:
    factor = Decimal("1.2")

    km = route_km([_JHB, _DBN], factor)

    assert km == _straight_km(_JHB, _DBN) * factor


def test_route_km_three_stops_sums_both_legs() -> None:
    km = route_km([_JHB, _PMB, _DBN], Decimal(1))

    assert km == _straight_km(_JHB, _PMB) + _straight_km(_PMB, _DBN)


def test_route_km_multi_stop_is_longer_than_direct() -> None:
    via = route_km([_JHB, _DBN, _PMB], Decimal(1))

    assert via > route_km([_JHB, _PMB], Decimal(1))


def test_trip_operating_cost_splits_by_part() -> None:
    parts = trip_operating_cost(Decimal(100), Decimal("2.5"), _FLAT_RATES)

    assert parts == CostParts(
        fuel=Decimal(200), running=Decimal(300), driver=Decimal(250), fixed=Decimal(50),
    )
    assert parts.total == Decimal(800)


def test_cost_parts_add_part_by_part() -> None:
    one = trip_operating_cost(Decimal(10), Decimal(1), _FLAT_RATES)

    summed = ZERO_COST + one + one

    assert summed == CostParts(
        fuel=Decimal(40), running=Decimal(60), driver=Decimal(200), fixed=Decimal(100),
    )


@pytest.mark.parametrize(
    ("minutes", "expected"),
    [
        (None, None),
        (-30.0, Decimal(0)),
        (0.0, Decimal(0)),
        (90.0, Decimal("1.5")),
        (15.0, Decimal("0.25")),
    ],
)
def test_late_hours(minutes: float | None, expected: Decimal | None) -> None:
    assert late_hours(minutes) == expected


def test_delay_cost_is_hours_times_delay_rate() -> None:
    assert delay_cost(Decimal("1.5"), _FLAT_RATES) == Decimal(750)


def test_delay_cost_of_zero_hours_is_zero() -> None:
    assert delay_cost(Decimal(0), DEFAULT_COST_RATES) == Decimal(0)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Decimal("10.005"), 10.01),
        (Decimal("10.004"), 10.0),
        (Decimal("-0.005"), -0.01),
        (Decimal("1234567.891"), 1234567.89),
    ],
)
def test_to_rand_rounds_half_up_to_the_cent(value: Decimal, expected: float) -> None:
    assert to_rand(value) == expected


def test_to_tenths_rounds_half_up() -> None:
    assert to_tenths(Decimal("41.95")) == 42.0
    assert to_tenths(Decimal("41.94")) == 41.9


def test_summing_many_small_amounts_does_not_drift() -> None:
    total = sum((Decimal("0.1") for _ in range(1000)), start=Decimal(0))

    assert to_rand(total) == 100.0


def test_default_rates_are_within_the_allowed_bounds() -> None:
    not_money = {"road_factor", "litres_per_100km"}
    money = [getattr(DEFAULT_COST_RATES, f.name) for f in fields(CostRates) if f.name not in not_money]

    assert all(Decimal(0) <= rate <= MAX_COST_RATE for rate in money)
    assert Decimal(0) < DEFAULT_COST_RATES.litres_per_100km <= MAX_LITRES_PER_100KM
    assert MIN_ROAD_FACTOR <= DEFAULT_COST_RATES.road_factor <= MAX_ROAD_FACTOR


def test_fuel_per_km_is_price_times_consumption() -> None:
    assert _FLAT_RATES.fuel_per_km == Decimal(2)


def test_default_fuel_per_km_matches_bruce_fuel_share() -> None:
    assert abs(DEFAULT_COST_RATES.fuel_per_km - Decimal("17.60")) < Decimal("0.10")


def test_changing_a_rate_changes_only_its_part() -> None:
    dearer_fuel = replace(_FLAT_RATES, diesel_price_per_litre=Decimal(40))

    base = trip_operating_cost(Decimal(100), Decimal(1), _FLAT_RATES)
    changed = trip_operating_cost(Decimal(100), Decimal(1), dearer_fuel)

    assert changed.fuel == base.fuel * 2
    assert (changed.running, changed.driver, changed.fixed) == (base.running, base.driver, base.fixed)


def test_db_check_constraints_match_the_core_bounds() -> None:
    table = CostProfile.__table__
    assert isinstance(table, Table)
    checks = {
        str(constraint.name): str(constraint.sqltext)
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert f"litres_per_100km <= {MAX_LITRES_PER_100KM.normalize():f}" in checks["ck_cost_profiles_litres_per_100km_range"]
    assert f"BETWEEN {MIN_ROAD_FACTOR} AND {MAX_ROAD_FACTOR}" in checks["ck_cost_profiles_road_factor_range"]
