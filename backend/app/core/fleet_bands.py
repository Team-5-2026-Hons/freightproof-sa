"""The bands and groupings fleet analytics reports in: the vocabulary its response schemas name.

Pure enums with no dependencies, so the schema layer can use them without importing
`app.analytics` (which sits above it). The rules that sort a value into a band stay with the
analytics code that applies them (`app.analytics.fleet.periods`, `.constants`).
"""

import enum


class Grain(str, enum.Enum):
    """How a trend chart groups time. Weeks start Monday (ISO), matching Postgres's
    date_trunc('week', ...)."""

    WEEK = "week"
    MONTH = "month"
    YEAR = "year"


class DayBlock(str, enum.Enum):
    """A quarter of the South African day, for chart 3.5 (risky times of day)."""

    NIGHT = "night"
    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"


class LatenessBand(str, enum.Enum):
    """Chart 2.2. Early and on time are separate so the strict on-time rule doesn't hide
    trips that left far ahead of an unrealistic plan."""

    EARLY = "early"
    ON_TIME = "on_time"
    LATE_1_15 = "late_1_15"
    LATE_15_60 = "late_15_60"
    LATE_60_180 = "late_60_180"
    LATE_OVER_180 = "late_over_180"


class PlanBand(str, enum.Enum):
    """Chart 2.5's nine columns, left to right: finished early (furthest first), exactly on plan,
    ran over (nearest first), so the histogram reads as one line from early to late."""

    EARLY_OVER_180 = "early_over_180"
    EARLY_60_180 = "early_60_180"
    EARLY_15_60 = "early_15_60"
    EARLY_0_15 = "early_0_15"
    ON_PLAN = "on_plan"
    OVER_0_15 = "over_0_15"
    OVER_15_60 = "over_15_60"
    OVER_60_180 = "over_60_180"
    OVER_OVER_180 = "over_over_180"


class ReviewAgeBand(str, enum.Enum):
    """Chart 4.1: how long critical problems have waited for review."""

    UNDER_1H = "under_1h"
    HOUR_TO_DAY = "1h_to_24h"
    DAY_TO_3_DAYS = "1d_to_3d"
    OVER_3_DAYS = "over_3d"


class ExpiryBand(str, enum.Enum):
    """The Licences & discs tile. Separate bands, never cumulative: a licence expiring in
    10 days is counted under 30 days only, not also under 90 and 180."""

    EXPIRED = "expired"
    WITHIN_30_DAYS = "within_30_days"
    WITHIN_90_DAYS = "within_90_days"
    WITHIN_180_DAYS = "within_180_days"
    NO_DATE = "no_date"
