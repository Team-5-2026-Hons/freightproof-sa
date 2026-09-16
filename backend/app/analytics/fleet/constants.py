"""Named constants for the fleet analytics page (docs/design-notes/2026-09-15-fleet-analytics-page-spec.md),
each defined once with the reason for its value."""

import enum

from app.db.models.enums import ExceptionType

# SAST has no daylight saving, so this always agrees with settings.OPERATIONS_UTC_OFFSET_HOURS (spec G5).
OPERATIONS_TIME_ZONE_NAME = "Africa/Johannesburg"

# One year of weekly buckets; past this a trend chart's bars get too thin to read (spec G12).
MAX_TREND_BUCKETS = 53

# Days the "right now" tiles look back — long enough for several trips per vehicle,
# short enough to reflect the fleet now rather than its history.
TILE_WINDOW_DAYS = 30

# Minutes ahead of plan before counting as "early" rather than on time; a short lead
# usually means the plan was wrong, not that the driver was good.
EARLY_THRESHOLD_MINUTES = 15

# Inclusive upper edges (minutes late) of the 1-15/15-60/1-3h bands for chart 2.2;
# anything later is "3h+".
LATE_BUCKET_EDGES_MINUTES: tuple[int, int, int] = (15, 60, 180)

# Exclusive upper edges (hours waiting) of the under-1h/1-24h/1-3day review-age bands
# for chart 4.1; anything older is "over 3 days".
REVIEW_AGE_EDGES_HOURS: tuple[int, int, int] = (1, 24, 72)

# Inclusive upper edges (days left) of the licence/disc expiry bands; 30 and 90 match
# the drivers list's red/amber colours (app/(app)/fleet/drivers/page.tsx).
EXPIRY_BAND_EDGES_DAYS: tuple[int, int, int] = (30, 90, 180)

# Exception types meaning a parcel or waybill count did not add up.
PARCEL_SHORTFALL_TYPES: tuple[ExceptionType, ...] = (
    ExceptionType.PARCEL_COUNT_MISMATCH,
    ExceptionType.WAYBILL_COUNT_MISMATCH,
)

# Signs cargo may have been tampered with (spec D12). SEAL_UNVERIFIED is deliberately
# excluded: it means no departure seal existed to compare, a paperwork gap rather than
# evidence of tampering (see app/db/models/enums.py). A tuple, not a set, so chart 3.2's
# per-type columns keep one stable order.
THEFT_SIGNAL_TYPES: tuple[ExceptionType, ...] = (
    ExceptionType.SEAL_MISMATCH,
    ExceptionType.SEAL_BROKEN_IN_TRANSIT,
    ExceptionType.PARCEL_COUNT_MISMATCH,
    ExceptionType.WAYBILL_COUNT_MISMATCH,
    ExceptionType.PANIC_BUTTON,
    # Receiver ID checked and did not match at delivery (D25); RECEIVER_ID_UNVERIFIED
    # stays out for the same reason SEAL_UNVERIFIED does.
    ExceptionType.RECEIVER_ID_MISMATCH,
)

# Never counted as a problem (spec D10): cancellations and dispatcher overrides record
# one automatically.
EXCLUDED_FROM_PROBLEMS: frozenset[ExceptionType] = frozenset({ExceptionType.DISPATCHER_NOTE})


class DayBlock(str, enum.Enum):
    """A quarter of the South African day, for chart 3.5 (risky times of day)."""

    NIGHT = "night"
    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"


# (block, first hour, end hour exclusive) in SAST, covering 00:00-24:00 with no gap or overlap.
DAY_BLOCKS: tuple[tuple[DayBlock, int, int], ...] = (
    (DayBlock.NIGHT, 0, 6),
    (DayBlock.MORNING, 6, 12),
    (DayBlock.AFTERNOON, 12, 18),
    (DayBlock.EVENING, 18, 24),
)
