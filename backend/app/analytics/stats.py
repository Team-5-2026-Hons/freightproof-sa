"""Pure arithmetic for the analytics read layer — no database, no I/O.

Kept apart from the query modules so the one place a rate is divided and a percentile is
interpolated can be unit-tested directly against hand-computed values.
"""

import math
from collections.abc import Sequence
from datetime import date

MEDIAN_FRACTION = 0.5
P90_FRACTION = 0.9

# Monthly buckets are keyed by the first day of the month (the views' month_start).
_FIRST_DAY_OF_MONTH = 1


def safe_ratio(numerator: float, denominator: float) -> float | None:
    """numerator / denominator, or None when there is nothing to divide by.

    None rather than 0.0 on purpose: a driver with no planned departures has no on-time
    rate at all, which is a different fact from an on-time rate of 0%.
    """
    if denominator == 0:
        return None
    return numerator / denominator


def percentile(values: Sequence[float], fraction: float) -> float | None:
    """The `fraction` percentile of `values` by linear interpolation between ranks.

    Same definition as Postgres percentile_cont, so a figure computed here agrees with
    one an analyst reproduces in SQL. Callers must pass the POOLED raw observations for
    the whole range: percentiles of separate months cannot be recombined into the
    percentile of their union.
    """
    if not 0.0 <= fraction <= 1.0:
        raise ValueError(f"percentile fraction must be within [0, 1], got {fraction}")
    if not values:
        return None

    ordered = sorted(values)
    rank = fraction * (len(ordered) - 1)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (rank - lower)


def validate_month_range(start_month: date, end_month: date) -> None:
    """Reject a range the monthly views cannot answer exactly.

    Buckets are whole months, so a mid-month date would silently widen to the whole
    month rather than mean what the caller asked for — refuse it instead.
    """
    if start_month.day != _FIRST_DAY_OF_MONTH or end_month.day != _FIRST_DAY_OF_MONTH:
        raise ValueError(
            f"month range bounds must be first-of-month dates, got {start_month} .. {end_month}"
        )
    if start_month > end_month:
        raise ValueError(f"start_month {start_month} is after end_month {end_month}")
