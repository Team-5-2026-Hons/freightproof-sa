"""Result models for the FP-153 analytics read layer (app/analytics/).

Each model carries the RAW ingredients summed across the requested months and derives
every rate or average from them as a computed field. A rate is therefore divided exactly
once, after summing, and can never disagree with the counts shipped beside it — averaging
per-month percentages is wrong whenever the months had different volumes (spec §3 rule 1).

A derived value is None when its denominator is zero: "no observations" is not 0%.

No blended score exists anywhere here, by design (spec §3 rule 4): severities are
returned as separate counts and the reader weighs them.

Organisation is not echoed back — every read function is scoped to one organisation by
its caller, so every row already belongs to it.
"""

from collections.abc import Sequence
from uuid import UUID

from pydantic import BaseModel, ConfigDict, computed_field

from app.analytics.stats import MEDIAN_FRACTION, P90_FRACTION, percentile, safe_ratio


class DriverMetrics(BaseModel):
    """One driver's closed trips over a month range."""

    model_config = ConfigDict(frozen=True)

    driver_id: UUID
    trip_count: int
    trips_with_exceptions_count: int
    total_exceptions_count: int
    info_exceptions_count: int
    warning_exceptions_count: int
    critical_exceptions_count: int
    departures_with_plan_count: int
    on_time_departures_count: int
    activation_dwell_minutes_sum: float
    activation_dwell_events_count: int
    loading_dwell_minutes_sum: float
    loading_dwell_events_count: int
    departure_dwell_minutes_sum: float
    departure_dwell_events_count: int
    unloading_dwell_minutes_sum: float
    unloading_dwell_events_count: int
    confirmation_dwell_minutes_sum: float
    confirmation_dwell_events_count: int
    phase_events_count: int
    override_count: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def exception_trip_rate(self) -> float | None:
        """Share of trips that carried at least one exception."""
        return safe_ratio(self.trips_with_exceptions_count, self.trip_count)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def on_time_departure_rate(self) -> float | None:
        """Strictly on or before plan, over trips that had a planned departure at all."""
        return safe_ratio(self.on_time_departures_count, self.departures_with_plan_count)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def override_rate(self) -> float | None:
        return safe_ratio(self.override_count, self.phase_events_count)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def activation_dwell_minutes_avg(self) -> float | None:
        return safe_ratio(self.activation_dwell_minutes_sum, self.activation_dwell_events_count)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def loading_dwell_minutes_avg(self) -> float | None:
        return safe_ratio(self.loading_dwell_minutes_sum, self.loading_dwell_events_count)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def departure_dwell_minutes_avg(self) -> float | None:
        return safe_ratio(self.departure_dwell_minutes_sum, self.departure_dwell_events_count)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def unloading_dwell_minutes_avg(self) -> float | None:
        return safe_ratio(self.unloading_dwell_minutes_sum, self.unloading_dwell_events_count)

    # The caveat travels with the number (spec §4) so a UI built on it cannot drop it.
    @computed_field(  # type: ignore[prop-decorator]
        description=(
            "Not purely driver behaviour: a slow receiver at the destination also "
            "lengthens the gap between unloading and confirmation."
        )
    )
    @property
    def confirmation_dwell_minutes_avg(self) -> float | None:
        return safe_ratio(self.confirmation_dwell_minutes_sum, self.confirmation_dwell_events_count)


class VehicleMetrics(BaseModel):
    """One vehicle's closed trips over a month range, horse or trailer."""

    model_config = ConfigDict(frozen=True)

    vehicle_id: UUID
    trip_count: int
    mechanical_exceptions_count: int
    mechanical_info_count: int
    mechanical_warning_count: int
    mechanical_critical_count: int
    mechanical_gap_minutes_sum: float
    mechanical_gap_count: int
    driving_hours_sum: float

    @computed_field  # type: ignore[prop-decorator]
    @property
    def mean_minutes_between_mechanical(self) -> float | None:
        """Mean time between breakdowns, for breakdowns that fell in the range."""
        return safe_ratio(self.mechanical_gap_minutes_sum, self.mechanical_gap_count)


class VehicleStreak(BaseModel):
    """Whole-history clean-trip streaks for one vehicle, horse or trailer — not affected by
    a month range."""

    model_config = ConfigDict(frozen=True)

    vehicle_id: UUID
    highest_streak_trips: int
    # None until a mechanical incident has closed at least one streak.
    lowest_streak_trips: int | None


class DurationStats(BaseModel):
    """Distribution of one lane measure over the pooled observations. All values in minutes."""

    model_config = ConfigDict(frozen=True)

    sample_count: int
    mean: float | None
    minimum: float | None
    maximum: float | None
    median: float | None
    p90: float | None

    @classmethod
    def from_values(cls, values: Sequence[float]) -> "DurationStats":
        """Every statistic computed once over the whole pooled list — order-independent."""
        return cls(
            sample_count=len(values),
            mean=safe_ratio(sum(values), len(values)),
            minimum=min(values, default=None),
            maximum=max(values, default=None),
            median=percentile(values, MEDIAN_FRACTION),
            p90=percentile(values, P90_FRACTION),
        )


class LaneMetrics(BaseModel):
    """One origin -> destination lane over a month range."""

    model_config = ConfigDict(frozen=True)

    origin_precinct_id: UUID
    destination_precinct_id: UUID
    trip_count: int
    exception_count: int
    # "How long does this route physically take" ...
    actual_transit_minutes: DurationStats
    # ... versus "are we keeping the schedule we promise for it" (actual - planned, per
    # trip). Can hold fewer samples than actual_transit_minutes: not every trip has a plan.
    schedule_delta_minutes: DurationStats

    @computed_field  # type: ignore[prop-decorator]
    @property
    def exception_density(self) -> float | None:
        return safe_ratio(self.exception_count, self.trip_count)


class FacilityMetrics(BaseModel):
    """Pulsit geofence corroboration at one precinct over a month range."""

    model_config = ConfigDict(frozen=True)

    precinct_id: UUID
    confirmed_count: int
    mismatch_count: int
    # Kept, not discarded: a high count here means the precinct's Pulsit COVERAGE is
    # broken, a different problem from trucks not being where drivers said.
    unwitnessed_count: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def corroboration_rate(self) -> float | None:
        """Confirmed over CHECKED events. Unwitnessed is deliberately outside the
        denominator — "could not check" is not a failure (matches the dispatcher's
        "Awaiting Pulsit" state)."""
        return safe_ratio(self.confirmed_count, self.confirmed_count + self.mismatch_count)
