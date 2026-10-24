"""Request and response models for the Cost analytics tab (FP-294).

Kept apart from schemas/fleet_analytics.py, which is already large. Imports nothing from
app.analytics: schemas sit below it in the layers contract, so the rate bounds come from
app.core.constants instead.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.constants import MAX_COST_RATE, MAX_LITRES_PER_100KM, MAX_ROAD_FACTOR, MIN_ROAD_FACTOR
from app.schemas.fleet_analytics import PeriodEcho


class CostProfileRead(BaseModel):
    """The rates in force for the caller's organisation, and where they came from."""

    model_config = ConfigDict(frozen=True)

    diesel_price_per_litre: float
    litres_per_100km: float
    # Derived (price × consumption ÷ 100), sent so the screen never redoes the sum.
    fuel_per_km: float
    running_cost_per_km: float
    driver_cost_per_hour: float
    delay_cost_per_hour: float
    fixed_cost_per_trip: float
    road_factor: float
    # True until an admin first saves: the figures use the starting rates from Bruce's figures.
    is_default: bool
    updated_at: datetime | None
    updated_by_name: str | None


def _rand() -> Any:
    """A rand rate: cents at most, never negative, never past the typo cap. Typed Any
    because that is what pydantic.Field itself returns."""
    return Field(default=None, ge=0, le=MAX_COST_RATE, max_digits=12, decimal_places=2)


class CostProfileUpdate(BaseModel):
    """An admin's change to the rates. Any field left out keeps its current value."""

    model_config = ConfigDict(extra="forbid")

    diesel_price_per_litre: Decimal | None = _rand()
    litres_per_100km: Decimal | None = Field(
        default=None, gt=0, le=MAX_LITRES_PER_100KM, max_digits=6, decimal_places=1,
    )
    running_cost_per_km: Decimal | None = _rand()
    driver_cost_per_hour: Decimal | None = _rand()
    delay_cost_per_hour: Decimal | None = _rand()
    fixed_cost_per_trip: Decimal | None = _rand()
    road_factor: Decimal | None = Field(
        default=None, ge=MIN_ROAD_FACTOR, le=MAX_ROAD_FACTOR, max_digits=4, decimal_places=2,
    )

    @model_validator(mode="after")
    def _at_least_one_rate(self) -> Self:
        # An empty (or all-null) body would still stamp "last changed by" without changing anything.
        if all(getattr(self, name) is None for name in type(self).model_fields):
            raise ValueError("send at least one rate to change")
        return self


# ── GET /analytics/fleet/cost ────────────────────────────────────────────────
# Rand amounts are floats rounded to the cent, hours and km to one decimal: computed in
# Decimal (app/analytics/cost_model.py) and converted only here, at the response edge.

# Where a lane's distance came from: every leg routed by road, every leg estimated as a
# straight line × road factor, or some of each.
DistanceSource = Literal["road", "estimate", "mixed"]


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True)


class OperatingCost(_Frozen):
    """Estimated operating cost of the period's costed trips, by what drives it."""

    fuel: float
    running: float
    driver: float
    fixed: float
    total: float
    trips_costed: int
    # Closed trips with no final arrival time: no driving time, so not costed at all.
    trips_not_costed: int
    distance_km: float
    legs_routed: int
    legs_estimated: int


class DelayCost(_Frozen):
    """Hours late at final arrival on trips that had a problem, at the delay rate."""

    cost: float
    late_hours: float
    problem_trips: int
    late_problem_trips: int
    # Problem trips with no planned or no actual arrival: lateness can't be measured.
    lateness_unknown: int


class ValueExposed(_Frozen):
    """Declared waybill value on trips with a theft signal: real data, not an estimate."""

    under_review: float
    reviewed: float
    total: float
    trips: int
    consignments_without_value: int
    trips_without_consignments: int


class CostBucket(_Frozen):
    """One week, month or year, by the first attested departure (as every fleet chart)."""

    start: date
    is_partial: bool
    fuel: float
    running: float
    driver: float
    fixed: float
    delay_cost: float
    value_under_review: float
    value_reviewed: float


class LaneCost(_Frozen):
    origin_precinct_id: UUID
    origin_name: str | None
    destination_precinct_id: UUID
    destination_name: str | None
    trip_count: int
    operating_total: float
    # None when no trip on the lane could be costed (no arrival time).
    operating_per_trip: float | None
    delay_cost: float
    value_exposed: float
    distance_source: DistanceSource


class CostResponse(_Frozen):
    period: PeriodEcho
    # The rates these figures were worked out with, so every figure carries its source.
    rates: CostProfileRead
    operating: OperatingCost
    delay: DelayCost
    exposure: ValueExposed
    buckets: list[CostBucket]
    # Highest operating cost first.
    lanes: list[LaneCost]
