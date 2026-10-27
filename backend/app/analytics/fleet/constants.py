"""Named constants for the fleet analytics page.

Every threshold the fleet queries and their tests share is defined here once, with the
reason it has its value, so a chart's definition can be read without opening the query
that applies it.
"""

from app.core.fleet_bands import DayBlock
from app.db.models.enums import ExceptionType

OPERATIONS_TIME_ZONE_NAME = "Africa/Johannesburg"

MAX_TREND_BUCKETS = 53

TILE_WINDOW_DAYS = 30

EARLY_THRESHOLD_MINUTES = 15

LATE_BUCKET_EDGES_MINUTES: tuple[int, int, int] = (15, 60, 180)

REVIEW_AGE_EDGES_HOURS: tuple[int, int, int] = (1, 24, 72)

EXPIRY_BAND_EDGES_DAYS: tuple[int, int, int] = (30, 90, 180)

THEFT_SIGNAL_TYPES: tuple[ExceptionType, ...] = (
    ExceptionType.SEAL_MISMATCH,
    ExceptionType.SEAL_COMPROMISED,
    ExceptionType.SEAL_BROKEN_IN_TRANSIT,
    ExceptionType.TRAILER_LOCATION_MISMATCH,
    ExceptionType.PARCEL_COUNT_MISMATCH,
    ExceptionType.WAYBILL_COUNT_MISMATCH,
    ExceptionType.PANIC_BUTTON,
    ExceptionType.RECEIVER_ID_MISMATCH,
)

EXCLUDED_FROM_PROBLEMS: frozenset[ExceptionType] = frozenset({ExceptionType.DISPATCHER_NOTE})


DAY_BLOCKS: tuple[tuple[DayBlock, int, int], ...] = (
    (DayBlock.NIGHT, 0, 6),
    (DayBlock.MORNING, 6, 12),
    (DayBlock.AFTERNOON, 12, 18),
    (DayBlock.EVENING, 18, 24),
)
