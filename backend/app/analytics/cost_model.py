"""Pure arithmetic for the Cost tab (FP-294): no database, no I/O.

Every operating-cost figure FreightProof shows is an ESTIMATE built from an organisation's
cost rates; no system we read records what a trip actually cost. Keeping the arithmetic
here, apart from the queries, lets the one place a rand is computed be unit-tested against
hand-worked values, including the calibration against Bruce's JHB–DBN example.

Money is Decimal throughout and only becomes a float at the response edge (to_rand), so
summing hundreds of trips never drifts by a cent.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.core.geo import haversine_metres

MINUTES_PER_HOUR = Decimal(60)
METRES_PER_KM = Decimal(1000)
# Consumption is quoted per 100 km (the way fleet managers and truck makers state it).
KM_PER_CONSUMPTION_UNIT = Decimal(100)

_CENTS = Decimal("0.01")
_TENTHS = Decimal("0.1")


@dataclass(frozen=True)
class CostRates:
    """An organisation's cost rates, in rand. Mirrors one cost_profiles row.

    Fuel is held as a diesel price and a consumption rather than one rand-per-km figure,
    because the price changes every month (DMPR, first Wednesday) while consumption
    doesn't: an admin updates one number from the pump price, not a sum.
    """

    diesel_price_per_litre: Decimal
    litres_per_100km: Decimal
    running_per_km: Decimal
    driver_per_hour: Decimal
    delay_per_hour: Decimal
    fixed_per_trip: Decimal
    road_factor: Decimal

    @property
    def fuel_per_km(self) -> Decimal:
        return self.diesel_price_per_litre * self.litres_per_100km / KM_PER_CONSUMPTION_UNIT


# The starting rates, used until an admin saves their own. Calibrated so Bruce's own
# example comes out right (a JHB–DBN run costs about R20,000; this model gives ~R20,200):
#   Bruce, 1 Sep 2026: a JHB–DBN run ≈ R20,000, fuel ≈ 50% of it
#       → R10,000 over 568 km (N3 by road) ≈ R17.60/km.
#   Diesel: R33.29/L, the DMPR regulated inland 50ppm price from 7 Oct 2026. Update it
#       when the price changes. Consumption: R17.60/km ÷ R33.29/L ≈ 53 L/100 km,
#       worked back from Bruce's figures (plausible for a loaded interlink on the N3;
#       not measured on a real truck). Together: R17.64/km.
#   Bruce, 28 Jul 2026: a driver ≈ R30,000/month; ÷ 195 working hours (45 h/week × 4.33)
#       ≈ R155/h. Assumed ≈ 9 h of driving on the run → ≈ R1,395.
#   The rest, R20,000 − R10,000 − R1,395 ≈ R8,600 ÷ 568 km ≈ R15.10/km
#       (tyres, maintenance, tolls, the vehicle itself).
#   Delay: the driver R155/h plus the truck standing idle, its non-fuel cost spread
#       over the run's hours (R8,600 ÷ 9 h ≈ R955/h) → ≈ R1,100/h.
#   Road factor: 568 km by road ÷ 500 km straight line between JHB and DBN ≈ 1.14 → 1.15.
#   Fixed per trip: Bruce gave no figure, so it starts at zero.
DEFAULT_COST_RATES = CostRates(
    diesel_price_per_litre=Decimal("33.29"),
    litres_per_100km=Decimal("53.0"),
    running_per_km=Decimal("15.10"),
    driver_per_hour=Decimal("155.00"),
    delay_per_hour=Decimal("1100.00"),
    fixed_per_trip=Decimal("0.00"),
    road_factor=Decimal("1.15"),
)


@dataclass(frozen=True)
class CostParts:
    """One trip's (or a sum of trips') estimated operating cost, split by what drives it."""

    fuel: Decimal
    running: Decimal
    driver: Decimal
    fixed: Decimal

    @property
    def total(self) -> Decimal:
        return self.fuel + self.running + self.driver + self.fixed

    def __add__(self, other: "CostParts") -> "CostParts":
        return CostParts(
            fuel=self.fuel + other.fuel,
            running=self.running + other.running,
            driver=self.driver + other.driver,
            fixed=self.fixed + other.fixed,
        )


@dataclass(frozen=True)
class LegDistance:
    """One leg's distance (consecutive stops), and whether it was measured along the truck
    road route or estimated as a straight line × road factor."""

    km: Decimal
    routed: bool


ZERO_COST = CostParts(fuel=Decimal(0), running=Decimal(0), driver=Decimal(0), fixed=Decimal(0))


def route_km(points: Sequence[tuple[Decimal, Decimal]], road_factor: Decimal) -> Decimal:
    """Estimated road distance through `points` (lat, lng) in stop order, in km.

    The straight line between each consecutive pair of stops, summed, times the road
    factor. A trip with fewer than two stops has no leg to measure, so it is 0 km.
    The fallback when a leg's truck road route can't be looked up.
    """
    metres = sum(
        (
            Decimal(repr(haversine_metres(lat1, lng1, lat2, lng2)))
            for (lat1, lng1), (lat2, lng2) in zip(points, points[1:])
        ),
        start=Decimal(0),
    )
    return metres / METRES_PER_KM * road_factor


def trip_operating_cost(km: Decimal, driving_hours: Decimal, rates: CostRates) -> CostParts:
    """A trip's estimated operating cost: distance × per-km rates, plus hours × driver rate,
    plus the fixed per-trip rate."""
    return CostParts(
        fuel=km * rates.fuel_per_km,
        running=km * rates.running_per_km,
        driver=driving_hours * rates.driver_per_hour,
        fixed=rates.fixed_per_trip,
    )


def late_hours(delay_minutes: float | None) -> Decimal | None:
    """Hours late at arrival. None when lateness can't be measured (no plan or no arrival);
    0 for an early or on-time arrival, since arriving early saves no delay cost."""
    if delay_minutes is None:
        return None
    if delay_minutes <= 0:
        return Decimal(0)
    return Decimal(repr(delay_minutes)) / MINUTES_PER_HOUR


def delay_cost(hours: Decimal, rates: CostRates) -> Decimal:
    """The estimated cost of `hours` of delay at the organisation's delay rate."""
    return hours * rates.delay_per_hour


def to_rand(value: Decimal) -> float:
    """A rand amount for the response: rounded half-up to the cent, the way money is
    rounded on an invoice, then made a float for JSON."""
    return float(value.quantize(_CENTS, rounding=ROUND_HALF_UP))


def to_tenths(value: Decimal) -> float:
    """An hours or km figure for the response, to one decimal place."""
    return float(value.quantize(_TENTHS, rounding=ROUND_HALF_UP))
