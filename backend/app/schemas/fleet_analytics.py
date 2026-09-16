"""Response models for the fleet analytics endpoints (GET /analytics/fleet/*).

Same contract as app/schemas/analytics.py: frozen models that ship the raw counts and derive
every rate from them once, as a computed field, so a rate can never disagree with the counts
beside it. A rate is None when its denominator is zero, because no observations is not 0%.

Mirrored in TypeScript by frontend/shared/lib/types/fleet-analytics.ts; keep the two in step.
"""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, computed_field

from app.analytics.fleet.constants import DayBlock
from app.analytics.fleet.periods import Grain, LatenessBand, PlanBand, ReviewAgeBand
from app.analytics.stats import safe_ratio
from app.db.models.enums import (
    DispatcherReviewOutcome,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    VehicleType,
)
from app.schemas.analytics import DurationStats


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True)


# GET /tiles


class CriticalWaiting(_Frozen):
    """Critical problems waiting for a dispatcher's review, right now."""

    count: int
    # When the longest-waiting one was raised. None when nothing is waiting.
    oldest_created_at: datetime | None


class ExpiryBands(_Frozen):
    """Separate bands, never cumulative. Further out than 180 days is in none of them."""

    expired: int
    within_30_days: int
    within_90_days: int
    within_180_days: int
    no_date: int


class LicenceExpiry(_Frozen):
    drivers: ExpiryBands
    vehicle_discs: ExpiryBands


class UnusedVehicle(_Frozen):
    vehicle_id: UUID
    registration: str
    vehicle_type: VehicleType


class UnusedVehicles(_Frozen):
    """Active vehicles with no trip in the tile window and none live now. Vehicles only,
    never drivers: listing idle drivers would be a ranking by another name (spec D13)."""

    window_days: int
    vehicles: list[UnusedVehicle]


class FleetTilesResponse(_Frozen):
    live_trips: int
    critical_waiting: CriticalWaiting
    licence_expiry: LicenceExpiry
    unused_vehicles: UnusedVehicles
    # The first day "All time" covers: the SAST day of the organisation's first trip, or
    # today with none. The page loads the tiles first, so it can tell which View-by
    # options All time allows (at most 53 bars) before any chart asks for data.
    all_time_start: date


# Shared by the endpoints that take a period


class PeriodEcho(_Frozen):
    """The period the answer covers, as the server resolved it. "All time" comes back with
    its real first day, so the page can say which dates it is showing."""

    start: date
    end: date
    grain: Grain | None


# GET /activity


class TripsBucket(_Frozen):
    """Chart 1.1: closed trips that first departed in this bucket, split by trip type."""

    bucket_start: date
    is_partial: bool
    loaded_count: int
    empty_count: int


class CancellationsBucket(_Frozen):
    """Chart 1.7: trips that ended in this bucket, and how many of those were cancelled."""

    bucket_start: date
    is_partial: bool
    cancelled_count: int
    # Closed plus cancelled trips whose end fell in the bucket: the "out of" for the rate.
    ended_count: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cancelled_rate(self) -> float | None:
        return safe_ratio(self.cancelled_count, self.ended_count)


class CancelledTrip(_Frozen):
    """One row of chart 1.7's table. The cancellation note is not carried here: it lives
    inside a free-text exception description, so the table links to the trip page, which
    shows it (spec D20)."""

    trip_id: UUID
    trip_reference: str
    cancelled_at: datetime


class ActivityResponse(_Frozen):
    period: PeriodEcho
    trips: list[TripsBucket]
    cancellations: list[CancellationsBucket]
    # Newest first.
    cancelled_trips: list[CancelledTrip]


# GET /patterns


class PatternBar(_Frozen):
    """One bar of a busy-pattern chart: an hour, weekday, date or month."""

    key: int
    event_count: int
    # How many calendar days of the period had this hour / weekday / date / month: the
    # divisor that keeps a rare bar (the 31st) from looking quiet just because it is rare.
    day_count: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def average_per_day(self) -> float | None:
        return safe_ratio(self.event_count, self.day_count)


class PatternSet(_Frozen):
    """Always complete and in clock/calendar order: 24 hours (0-23), 7 weekdays (Monday = 0),
    31 dates (1-31), 12 months (1-12). Never sorted by size (spec §5.1)."""

    hour_of_day: list[PatternBar]
    weekday: list[PatternBar]
    day_of_month: list[PatternBar]
    month_of_year: list[PatternBar]


class PatternsResponse(_Frozen):
    # Both event types in one answer, so the page's Departures | Arrivals switch never refetches.
    period: PeriodEcho
    departures: PatternSet
    arrivals: PatternSet


# GET /on-time


class PunctualityBucket(_Frozen):
    """Chart 2.1. Strict: on or before the plan, no grace window (spec D9)."""

    bucket_start: date
    is_partial: bool
    departures_with_plan: int
    on_time_departures: int
    # Closed trips with a planned arrival AND an attested final arrival.
    arrivals_with_plan: int
    on_time_arrivals: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def on_time_departure_rate(self) -> float | None:
        return safe_ratio(self.on_time_departures, self.departures_with_plan)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def on_time_arrival_rate(self) -> float | None:
        return safe_ratio(self.on_time_arrivals, self.arrivals_with_plan)


class LatenessBar(_Frozen):
    """Chart 2.2: how many trips fell in one lateness band over the whole period."""

    band: LatenessBand
    trip_count: int


class Lateness(_Frozen):
    # All six bands, always, in LatenessBand order (early first, 3 h+ last).
    departures: list[LatenessBar]
    arrivals: list[LatenessBar]


class PlanBandCount(_Frozen):
    band: PlanBand
    trip_count: int


class PlanSpread(_Frozen):
    """Chart 2.5, whole period: how far each trip's actual time was from planned. Medians
    are positive minutes on both sides ("typically 40 min early"), never negative."""

    bands: list[PlanBandCount]
    early_count: int
    over_count: int
    on_plan_count: int
    median_early_minutes: float | None
    median_over_minutes: float | None


class OnTimeResponse(_Frozen):
    period: PeriodEcho
    punctuality: list[PunctualityBucket]
    lateness: Lateness
    plan_spread: PlanSpread


# GET /problems
# Every count excludes dispatcher notes (spec D10).

_PER_100 = 100


class ProblemsPerTripBucket(_Frozen):
    """Chart 3.1. Info is counted but not drawn: nothing raises it today."""

    bucket_start: date
    is_partial: bool
    trip_count: int
    info_count: int
    warning_count: int
    critical_count: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def warning_per_100(self) -> float | None:
        return safe_ratio(self.warning_count * _PER_100, self.trip_count)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def critical_per_100(self) -> float | None:
        return safe_ratio(self.critical_count * _PER_100, self.trip_count)


class TheftSignalsBucket(_Frozen):
    """Chart 3.2. by_type holds every THEFT_SIGNAL_TYPES member, zeros included, in that
    constant's order, so the table's columns never move."""

    bucket_start: date
    is_partial: bool
    total_count: int
    by_type: dict[str, int]


class ProblemTypeCount(_Frozen):
    """Chart 3.3: only (type, source) pairs that happened, so a type nothing creates never
    sits at a reassuring zero (spec D11)."""

    exception_type: ExceptionType
    source: ExceptionSource
    count: int


class ProblemStepCount(_Frozen):
    """Chart 3.4: the linked step's phase type, or "unlinked"."""

    step: str
    count: int


class RiskyTimeBlock(_Frozen):
    """Chart 3.5. Shares are of the period's totals across all four blocks, divided once here."""

    block: DayBlock
    driving_minutes: float
    driving_share: float | None
    road_problem_count: int
    road_problem_share: float | None


class ProblemsResponse(_Frozen):
    period: PeriodEcho
    per_trip: list[ProblemsPerTripBucket]
    theft_signals: list[TheftSignalsBucket]
    by_type: list[ProblemTypeCount]
    by_step: list[ProblemStepCount]
    risky_times: list[RiskyTimeBlock]


# GET /review
# Not limited to closed trips: reviewing is independent of trip status. The migration-only
# legacy_review marker is left out everywhere (it records that a review happened, not what it found).


class WaitingAgeBar(_Frozen):
    """Chart 4.1, right now: critical problems waiting for review, by how long they've waited."""

    band: ReviewAgeBand
    count: int


class QueueBucket(_Frozen):
    """Chart 4.2: critical problems still waiting at the end of the bucket (or now, if sooner)."""

    bucket_start: date
    is_partial: bool
    waiting_at_end: int


class TimeToReviewBucket(_Frozen):
    """Chart 4.3: critical problems reviewed in the bucket, and how long each had waited.
    The median is over the pooled hours, never an average of averages."""

    bucket_start: date
    is_partial: bool
    reviewed_count: int
    median_hours: float | None
    mean_hours: float | None


class ReviewOutcomeCount(_Frozen):
    """Chart 4.4: reviews of any severity concluded in the period, per real outcome."""

    outcome: DispatcherReviewOutcome
    count: int


class ReviewResponse(_Frozen):
    period: PeriodEcho
    waiting_by_age: list[WaitingAgeBar]
    queue: list[QueueBucket]
    time_to_review: list[TimeToReviewBucket]
    outcomes: list[ReviewOutcomeCount]


# GET /evidence


class TrackerBucket(_Frozen):
    """Chart 5.1: attested stop steps of the closed-trip set, by what the tracker said. The
    facility view's rule: in_transit and overridden steps never get a verdict, so they're out."""

    bucket_start: date
    is_partial: bool
    confirmed_count: int
    mismatch_count: int
    # Kept, not dropped: a high count means tracker COVERAGE is broken, a different problem.
    unwitnessed_count: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def agreement_rate(self) -> float | None:
        """Confirmed over CHECKED steps. Unwitnessed is outside the denominator: "could not
        check" is not a failure (same rule as FacilityMetrics.corroboration_rate)."""
        return safe_ratio(self.confirmed_count, self.confirmed_count + self.mismatch_count)


class OverridesBucket(_Frozen):
    """Chart 5.2: every step of the closed-trip set, and how many a dispatcher overrode. The
    driver view's override_rate definition."""

    bucket_start: date
    is_partial: bool
    phase_count: int
    override_count: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def override_rate(self) -> float | None:
        return safe_ratio(self.override_count, self.phase_count)


class ReceiverSignoffBucket(_Frozen):
    """Chart 5.7: attested sign-off steps of the closed-trip set, and how many the receiver
    confirmed by scanning the QR."""

    bucket_start: date
    is_partial: bool
    confirmation_count: int
    receiver_scan_count: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def receiver_scan_rate(self) -> float | None:
        return safe_ratio(self.receiver_scan_count, self.confirmation_count)


class SignoffFlags(_Frozen):
    # Receiver confirmations in the period sent from a device already holding a FreightProof
    # session, most plausibly the driver's own phone (FP-240's bearer_token_present).
    same_phone_count: int
    # Rejected scan attempts in the period against the organisation's own trips.
    rejected_attempt_count: int


class EvidenceResponse(_Frozen):
    period: PeriodEcho
    tracker: list[TrackerBucket]
    overrides: list[OverridesBucket]
    receiver_signoff: list[ReceiverSignoffBucket]
    signoff_flags: SignoffFlags


# GET /routes


class SiteActivity(_Frozen):
    """Chart 1.6: attested pickups and deliveries at one site over the period."""

    precinct_id: UUID
    # Looked up by id only (spec G16): a site belongs to the client, not the operator.
    precinct_name: str | None
    pickup_count: int
    delivery_count: int


class LaneRisk(_Frozen):
    """Charts 2.4 and 6.3: one origin -> destination lane over the period."""

    origin_precinct_id: UUID
    origin_name: str | None
    destination_precinct_id: UUID
    destination_name: str | None
    trip_count: int
    # First attested departure to final arrival, per closed trip, pooled for the period: the
    # lane view's actual_transit_minutes.
    driving_minutes: DurationStats
    # Excludes dispatcher notes (spec D10), unlike the lane view's exception_count.
    problem_count: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def problems_per_trip(self) -> float | None:
        return safe_ratio(self.problem_count, self.trip_count)


class RoutesResponse(_Frozen):
    period: PeriodEcho
    # Busiest first.
    sites: list[SiteActivity]
    # Busiest first.
    lanes: list[LaneRisk]


# GET /incidents


class IncidentPin(_Frozen):
    """One located report on the incident map (chart 3.6). Deliberately nothing about the
    person: no driver name, phone or id. A pin is where a named driver was, so it carries only
    what the dispatcher needs to open the report (spec D14, POPIA)."""

    exception_id: UUID
    trip_id: UUID
    trip_reference: str
    exception_type: ExceptionType
    severity: ExceptionSeverity
    created_at: datetime
    lat: float
    lng: float


class IncidentsResponse(_Frozen):
    period: PeriodEcho
    # Newest first.
    pins: list[IncidentPin]
    # Reports in the period with no location, so an empty map is never mistaken for no problems.
    unlocated_count: int
