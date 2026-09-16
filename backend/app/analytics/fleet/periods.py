"""Pure date arithmetic for the fleet analytics page. No database, no I/O.

Every period, bucket and band the fleet queries use is worked out here, so the rules for
which week a trip lands in, or which band a late arrival falls into, are proven once in
unit tests (tests/unit/test_fleet_periods.py, test_fleet_calculations.py) and not re-derived
inside each query.

Calendar dates are South African (SAST, UTC+2, no daylight saving). The SQL side buckets with
the named zone (constants.OPERATIONS_TIME_ZONE_NAME). This side uses the fixed offset from
settings, as the rest of the backend does. The two agree because SAST never shifts.
"""

import enum
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from app.analytics.fleet.constants import (
    DAY_BLOCKS,
    EARLY_THRESHOLD_MINUTES,
    EXPIRY_BAND_EDGES_DAYS,
    LATE_BUCKET_EDGES_MINUTES,
    MAX_TREND_BUCKETS,
    REVIEW_AGE_EDGES_HOURS,
    DayBlock,
)
from app.core.config import settings

OPERATIONS_TZ = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))

DAYS_PER_WEEK = 7
MONTHS_PER_YEAR = 12
SECONDS_PER_MINUTE = 60
SECONDS_PER_HOUR = 3600
_FIRST_DAY = 1
_JANUARY = 1


class Grain(str, enum.Enum):
    """How a trend chart groups time. Weeks start on Monday (ISO), as Postgres's
    date_trunc('week', ...) does, so both sides put a Sunday in the same week."""

    WEEK = "week"
    MONTH = "month"
    YEAR = "year"


@dataclass(frozen=True)
class Period:
    """An inclusive range of SAST calendar dates, and the grain its trends are grouped by.

    grain is None for the charts that show one distribution over the whole period and
    have no time axis.
    """

    start: date
    end: date
    grain: Grain | None


@dataclass(frozen=True)
class Bucket:
    """One bar or point on a trend chart, keyed by its first calendar day."""

    start: date
    # The bucket is not a whole week/month/year inside the period, so its total is not
    # comparable with its neighbours'. The chart draws it faded (spec G8).
    is_partial: bool


@dataclass(frozen=True)
class InstantRange:
    """Half-open [start, end) between two timezone-aware instants."""

    start: datetime
    end: datetime


# ── Days and instants ────────────────────────────────────────────────────────


def today_sast(now: datetime | None = None) -> date:
    """The South African calendar date at `now` (default: the current moment)."""
    moment = now if now is not None else datetime.now(OPERATIONS_TZ)
    return sast_date(moment)


def sast_date(instant: datetime) -> date:
    """The SAST calendar date an instant falls on. 23:30 UTC is already tomorrow in SAST."""
    return instant.astimezone(OPERATIONS_TZ).date()


def start_of_day(day: date) -> datetime:
    """00:00 SAST at the start of `day`."""
    return datetime.combine(day, time.min, tzinfo=OPERATIONS_TZ)


def instant_range(start: date, end: date) -> InstantRange:
    """The instants covering the inclusive SAST dates [start, end] (spec G5)."""
    return InstantRange(start=start_of_day(start), end=start_of_day(end + timedelta(days=1)))


def trailing_days(today: date, days: int) -> tuple[date, date]:
    """The `days` SAST calendar days that end today, today included."""
    return today - timedelta(days=days - 1), today


# ── Periods and buckets ──────────────────────────────────────────────────────


def bucket_start(day: date, grain: Grain) -> date:
    """The first day of the bucket containing `day`."""
    if grain is Grain.WEEK:
        return day - timedelta(days=day.weekday())
    if grain is Grain.MONTH:
        return day.replace(day=_FIRST_DAY)
    return date(day.year, _JANUARY, _FIRST_DAY)


def next_bucket_start(start: date, grain: Grain) -> date:
    """The first day of the bucket after the one that starts on `start`."""
    if grain is Grain.WEEK:
        return start + timedelta(days=DAYS_PER_WEEK)
    if grain is Grain.MONTH:
        return date(start.year + start.month // MONTHS_PER_YEAR, start.month % MONTHS_PER_YEAR + 1, _FIRST_DAY)
    return date(start.year + 1, _JANUARY, _FIRST_DAY)


def bucket_starts(start: date, end: date, grain: Grain) -> list[date]:
    """From the bucket holding `start` to the bucket holding `end`, empty ones included.

    Empty buckets are kept on purpose (spec G7): a chart that skipped a quiet week would
    draw its neighbours side by side and hide the gap.
    """
    starts: list[date] = []
    current = bucket_start(start, grain)
    while current <= end:
        starts.append(current)
        current = next_bucket_start(current, grain)
    return starts


def bucket_count(start: date, end: date, grain: Grain) -> int:
    return len(bucket_starts(start, end, grain))


def buckets(period: Period) -> list[Bucket]:
    """Every bucket of the period, each marked partial when it isn't a whole one inside it.

    "Not finished yet" (spec G8) needs no separate test: build_period never lets `end` pass
    today, so a bucket still running past today necessarily runs past `end` too.
    """
    if period.grain is None:
        raise ValueError("a period without a grain has no buckets")
    result: list[Bucket] = []
    for start in bucket_starts(period.start, period.end, period.grain):
        last_day = next_bucket_start(start, period.grain) - timedelta(days=1)
        result.append(Bucket(start=start, is_partial=start < period.start or last_day > period.end))
    return result


def require_grain(period: Period) -> Grain:
    """The grain of a trend query's period. Reaching a trend query without one is a defect (a
    500), never the caller's mistake: every trend endpoint makes grain a required parameter."""
    if period.grain is None:
        raise ValueError("a trend query needs a period with a grain")
    return period.grain


def resolve_start(
    start: date | None, *, end: date, earliest_activity: date | None, today: date,
) -> date:
    """The period's first day. An omitted start means "All time" (spec G11).

    All time begins on the day of the organisation's first trip, or today if it has none.
    It is never later than `end`, so asking for All time up to a date before the first trip
    gives an empty period, not an error.
    """
    if start is not None:
        return start
    first = earliest_activity if earliest_activity is not None else today
    return min(first, end)


def build_period(*, start: date, end: date, grain: Grain | None, today: date) -> Period:
    """Validate a requested period (spec G12). ValueError carries a message for the dispatcher."""
    if end > today:
        raise ValueError(f"The period can't end after today ({today.isoformat()}).")
    if start > end:
        raise ValueError(
            f"The period can't start ({start.isoformat()}) after it ends ({end.isoformat()})."
        )
    if grain is not None:
        count = bucket_count(start, end, grain)
        if count > MAX_TREND_BUCKETS:
            raise ValueError(
                f"This period covers {count} {grain.value}s, but a chart can show at most "
                f"{MAX_TREND_BUCKETS}. Choose a longer grouping or a shorter period."
            )
    return Period(start=start, end=end, grain=grain)


# ── Per-occurrence averages (spec G13) ───────────────────────────────────────


@dataclass(frozen=True)
class OccurrenceDays:
    """How many calendar days of the period belong to each hour / weekday / date / month.

    The denominators of the busy-pattern charts. Dividing by these rather than by the
    number of weeks or months is what makes the 31st fair: it is only divided by the
    months that have a 31st.
    """

    # Every day has each hour of the day exactly once.
    total_days: int
    # Monday = 0 ... Sunday = 6.
    weekday: dict[int, int]
    # 1 ... 31.
    day_of_month: dict[int, int]
    # 1 ... 12. A day count, so the chart reads "average per day in March".
    month_of_year: dict[int, int]


def occurrence_days(start: date, end: date) -> OccurrenceDays:
    days = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
    weekday = Counter(day.weekday() for day in days)
    day_of_month = Counter(day.day for day in days)
    month_of_year = Counter(day.month for day in days)
    return OccurrenceDays(
        total_days=len(days),
        weekday={key: weekday[key] for key in range(DAYS_PER_WEEK)},
        day_of_month={key: day_of_month[key] for key in range(1, 32)},
        month_of_year={key: month_of_year[key] for key in range(1, MONTHS_PER_YEAR + 1)},
    )


# ── Driving time by time of day (chart 3.5) ──────────────────────────────────


def _block_at(moment: datetime) -> tuple[DayBlock, datetime]:
    """The block `moment` (SAST) falls in, and the instant that block ends."""
    for block, first_hour, end_hour in DAY_BLOCKS:
        if first_hour <= moment.hour < end_hour:
            return block, start_of_day(moment.date()) + timedelta(hours=end_hour)
    # DAY_BLOCKS covers every hour 0-23, so reaching here means the constant was broken.
    raise ValueError(f"DAY_BLOCKS does not cover hour {moment.hour}")


def day_block(instant: datetime) -> DayBlock:
    """The SAST quarter of the day an instant falls in (chart 3.5)."""
    return _block_at(instant.astimezone(OPERATIONS_TZ))[0]


def driving_minutes_by_block(departed_at: datetime, arrived_at: datetime) -> dict[DayBlock, float]:
    """Split one driving leg's minutes across the SAST day blocks it spans.

    Walks block boundary to block boundary, so the split is exact to the second; the spec's
    "minute by minute" describes the result, not the loop. A leg across midnight counts its
    late minutes to evening and its early ones to night. A leg with no length counts nothing.
    """
    totals = {block: 0.0 for block, _, _ in DAY_BLOCKS}
    cursor = departed_at.astimezone(OPERATIONS_TZ)
    finish = arrived_at.astimezone(OPERATIONS_TZ)
    while cursor < finish:
        block, block_end = _block_at(cursor)
        segment_end = min(block_end, finish)
        totals[block] += (segment_end - cursor).total_seconds() / SECONDS_PER_MINUTE
        cursor = segment_end
    return totals


# ── Review queue history (chart 4.2) ─────────────────────────────────────────


def waiting_at(items: Iterable[tuple[datetime, datetime | None]], at: datetime) -> int:
    """How many (created_at, reviewed_at) items were waiting for review at instant `at`.

    Waiting = raised before `at` and not yet reviewed by then. A review exactly at `at`
    still counts as waiting, which keeps the rule half-open like every other range here.
    """
    return sum(
        1 for created_at, reviewed_at in items
        if created_at < at and (reviewed_at is None or reviewed_at >= at)
    )


# ── Bands ────────────────────────────────────────────────────────────────────


class LatenessBand(str, enum.Enum):
    """Chart 2.2. Early and on time are separate so the strict on-time rule doesn't hide
    trips that left far ahead of an unrealistic plan."""

    EARLY = "early"
    ON_TIME = "on_time"
    LATE_1_15 = "late_1_15"
    LATE_15_60 = "late_15_60"
    LATE_60_180 = "late_60_180"
    LATE_OVER_180 = "late_over_180"


_LATE_BANDS: tuple[LatenessBand, LatenessBand, LatenessBand] = (
    LatenessBand.LATE_1_15, LatenessBand.LATE_15_60, LatenessBand.LATE_60_180,
)


def lateness_band(delta_minutes: float) -> LatenessBand:
    """Band for actual minus planned. On or before plan is on time (strict rule, spec D9)."""
    if delta_minutes < -EARLY_THRESHOLD_MINUTES:
        return LatenessBand.EARLY
    if delta_minutes <= 0:
        return LatenessBand.ON_TIME
    for band, edge in zip(_LATE_BANDS, LATE_BUCKET_EDGES_MINUTES, strict=True):
        if delta_minutes <= edge:
            return band
    return LatenessBand.LATE_OVER_180


class ReviewAgeBand(str, enum.Enum):
    """Chart 4.1: how long critical problems have waited for review."""

    UNDER_1H = "under_1h"
    HOUR_TO_DAY = "1h_to_24h"
    DAY_TO_3_DAYS = "1d_to_3d"
    OVER_3_DAYS = "over_3d"


_YOUNGER_AGE_BANDS: tuple[ReviewAgeBand, ReviewAgeBand, ReviewAgeBand] = (
    ReviewAgeBand.UNDER_1H, ReviewAgeBand.HOUR_TO_DAY, ReviewAgeBand.DAY_TO_3_DAYS,
)


def review_age_band(age: timedelta) -> ReviewAgeBand:
    hours = age.total_seconds() / SECONDS_PER_HOUR
    for band, edge in zip(_YOUNGER_AGE_BANDS, REVIEW_AGE_EDGES_HOURS, strict=True):
        if hours < edge:
            return band
    return ReviewAgeBand.OVER_3_DAYS


class ExpiryBand(str, enum.Enum):
    """The Licences & discs tile. Separate bands, never cumulative: a licence expiring in
    10 days is counted under 30 days only, not also under 90 and 180."""

    EXPIRED = "expired"
    WITHIN_30_DAYS = "within_30_days"
    WITHIN_90_DAYS = "within_90_days"
    WITHIN_180_DAYS = "within_180_days"
    NO_DATE = "no_date"


_FUTURE_EXPIRY_BANDS: tuple[ExpiryBand, ExpiryBand, ExpiryBand] = (
    ExpiryBand.WITHIN_30_DAYS, ExpiryBand.WITHIN_90_DAYS, ExpiryBand.WITHIN_180_DAYS,
)


def expiry_band(expiry: date | None, today: date) -> ExpiryBand | None:
    """The band an expiry date falls in, or None when it is more than 180 days away.

    Expiring today still counts as valid today, so it falls under 30 days, not expired.
    """
    if expiry is None:
        return ExpiryBand.NO_DATE
    days_left = (expiry - today).days
    if days_left < 0:
        return ExpiryBand.EXPIRED
    for band, edge in zip(_FUTURE_EXPIRY_BANDS, EXPIRY_BAND_EDGES_DAYS, strict=True):
        if days_left <= edge:
            return band
    return None


class PlanBand(str, enum.Enum):
    """Chart 2.5's nine columns, left to right: finished early (furthest first), exactly on plan,
    ran over (nearest first), so the histogram reads as one line from early to late (spec D23)."""

    EARLY_OVER_180 = "early_over_180"
    EARLY_60_180 = "early_60_180"
    EARLY_15_60 = "early_15_60"
    EARLY_0_15 = "early_0_15"
    ON_PLAN = "on_plan"
    OVER_0_15 = "over_0_15"
    OVER_15_60 = "over_15_60"
    OVER_60_180 = "over_60_180"
    OVER_OVER_180 = "over_over_180"


# Nearest to the plan first, paired with LATE_BUCKET_EDGES_MINUTES.
_EARLY_PLAN_BANDS: tuple[PlanBand, PlanBand, PlanBand] = (
    PlanBand.EARLY_0_15, PlanBand.EARLY_15_60, PlanBand.EARLY_60_180,
)
_OVER_PLAN_BANDS: tuple[PlanBand, PlanBand, PlanBand] = (
    PlanBand.OVER_0_15, PlanBand.OVER_15_60, PlanBand.OVER_60_180,
)


def plan_band(delta_minutes: float) -> PlanBand:
    """The band for actual minus planned trip time. Same edges as the lateness bands (spec
    §5.2), in absolute minutes off plan: more than 0 up to 15, more than 15 up to 60, more than
    60 up to 180, more than 180. Exactly 0 is on plan."""
    if delta_minutes == 0:
        return PlanBand.ON_PLAN
    early = delta_minutes < 0
    magnitude = abs(delta_minutes)
    for band, edge in zip(_EARLY_PLAN_BANDS if early else _OVER_PLAN_BANDS, LATE_BUCKET_EDGES_MINUTES, strict=True):
        if magnitude <= edge:
            return band
    return PlanBand.EARLY_OVER_180 if early else PlanBand.OVER_OVER_180
