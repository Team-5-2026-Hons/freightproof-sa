"""Named constants for the fleet analytics page.

Spec: docs/design-notes/2026-09-15-fleet-analytics-page-spec.md. Every threshold the fleet
queries and their tests share is defined here once, with the reason it has its value, so a
chart's definition can be read without opening the query that applies it.
"""

import enum

from app.db.models.enums import ExceptionType

# The zone the SQL buckets by. Named rather than a bare offset so the boundary reads as
# intent, the same choice the FP-153 views make. SAST has no daylight saving, so it always
# agrees with settings.OPERATIONS_UTC_OFFSET_HOURS, which the Python side uses (spec G5).
OPERATIONS_TIME_ZONE_NAME = "Africa/Johannesburg"

# One year of weeks. Past this, a trend chart's bars get too thin to read or hover, so a
# longer period has to be viewed by month or year instead (spec G12).
MAX_TREND_BUCKETS = 53

# How many South African calendar days (today included) the "right now" tiles look back.
# Long enough to hold several trips per vehicle at today's volumes, short enough to
# describe the fleet as it is now rather than its history.
TILE_WINDOW_DAYS = 30

# More than this many minutes ahead of plan counts as "early", not "on time": leaving a
# quarter of an hour early usually means the plan was wrong, not that the driver was good.
EARLY_THRESHOLD_MINUTES = 15

# Inclusive upper edges, in minutes late, of the 1-15 min, 15-60 min and 1-3 h bands.
# Anything later than the last edge is "3 h+". The edges separate "a little late often"
# from "very late sometimes" (chart 2.2).
LATE_BUCKET_EDGES_MINUTES: tuple[int, int, int] = (15, 60, 180)

# Exclusive upper edges, in hours waiting, of the under-1 h, 1-24 h and 1-3 day
# review-age bands. Anything older is "over 3 days" (chart 4.1).
REVIEW_AGE_EDGES_HOURS: tuple[int, int, int] = (1, 24, 72)

# Inclusive upper edges, in days left, of the licence / disc expiry bands. 30 and 90 match
# the drivers list's red and amber colours (app/(app)/fleet/drivers/page.tsx), so the tile
# agrees with what that list shows. Further out than 180 days is not a concern yet.
EXPIRY_BAND_EDGES_DAYS: tuple[int, int, int] = (30, 90, 180)

# Exception types that each mean a parcel or waybill count did not add up. A loaded trip
# with neither is one where every parcel was accounted for (the Parcels complete tile).
PARCEL_SHORTFALL_TYPES: tuple[ExceptionType, ...] = (
    ExceptionType.PARCEL_COUNT_MISMATCH,
    ExceptionType.WAYBILL_COUNT_MISMATCH,
)

# Signs that cargo may have been tampered with (spec D12). SEAL_UNVERIFIED is deliberately
# absent: it means no departure seal existed to compare against, a paperwork gap rather than
# evidence of tampering (see its comment in app/db/models/enums.py). A tuple, not a set, so
# the per-type columns of chart 3.2 keep one stable order.
THEFT_SIGNAL_TYPES: tuple[ExceptionType, ...] = (
    ExceptionType.SEAL_MISMATCH,
    ExceptionType.SEAL_BROKEN_IN_TRANSIT,
    ExceptionType.PARCEL_COUNT_MISMATCH,
    ExceptionType.WAYBILL_COUNT_MISMATCH,
    ExceptionType.PANIC_BUTTON,
    # The receiver's ID was checked at delivery and did not match: the goods may have gone to
    # the wrong person (D25). Its sibling RECEIVER_ID_UNVERIFIED stays out for the reason
    # SEAL_UNVERIFIED does: no check completed, a gap in the chain rather than a theft sign.
    ExceptionType.RECEIVER_ID_MISMATCH,
)

# Never counted as a problem (spec D10). Every cancellation and every dispatcher override
# records one automatically, so counting them would make "problems" rise whenever a
# dispatcher does their job.
EXCLUDED_FROM_PROBLEMS: frozenset[ExceptionType] = frozenset({ExceptionType.DISPATCHER_NOTE})


class DayBlock(str, enum.Enum):
    """A quarter of the South African day, for chart 3.5 (risky times of day)."""

    NIGHT = "night"
    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"


# (block, first hour, end hour exclusive) in SAST. Together they cover 00:00-24:00 with no
# gap or overlap, so every driving minute lands in exactly one block. Six-hour blocks are
# coarse on purpose: with today's volumes, finer slices would each hold a handful of minutes.
DAY_BLOCKS: tuple[tuple[DayBlock, int, int], ...] = (
    (DayBlock.NIGHT, 0, 6),
    (DayBlock.MORNING, 6, 12),
    (DayBlock.AFTERNOON, 12, 18),
    (DayBlock.EVENING, 18, 24),
)
