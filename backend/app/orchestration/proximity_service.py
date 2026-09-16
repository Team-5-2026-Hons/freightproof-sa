"""Pure driver-vs-truck proximity evaluation (Task 4 of the trip-location-timeline
story).

`geofence_service.evaluate_geofence` answers "is the TRUCK inside the precinct?".
This module answers a different, independent question: "how far apart are the
DRIVER'S OWN PHONE and the vehicle's Pulsit tracker, right now?" A truck can sit
correctly inside its precinct while the driver's phone is genuinely metres away
(left in the cab, handed to a co-driver, a phase completed from the office
tablet) — precinct membership and driver/truck separation are independent
facts and this module deliberately never touches a Precinct row or calls
evaluate_geofence. Task 5 assembles both answers into one
`ActionLocationAssessment`; this module only ever answers the second question,
alone, with no DB and no HTTP.

Mirrors the NULL-is-an-admission philosophy documented at the top of
corroboration_service.py: every quality gate that could not be checked (a
missing coordinate, a missing timestamp, a missing accuracy figure) is reported
as an explicit reason code rather than silently deciding "close enough".
'unverified' means exactly what it says — we do not know — and is never
produced by falling back to a zero-distance or an assumed-fresh fix.

Deliberately pure, like geofence_service.py: a plain `def`, not `async def` —
there is no I/O here to yield on, only arithmetic over the caller's arguments.
"""

from datetime import datetime

from app.core.geo import haversine_metres
from app.schemas.action_location import ProximityReason, ProximityVerdict

# How much later than `evaluated_at` a source timestamp may read before it is
# treated as a fabricated or clock-skewed "future" fix rather than an honest
# near-simultaneous capture. Kept small and separate from `max_skew_seconds`:
# ordinary clock drift between two independent devices (the driver's phone and
# the Pulsit tracker) is exactly what the skew check exists to tolerate, so this
# slack only needs to absorb the much smaller jitter between a device's own
# clock and the server's `evaluated_at` instant.
FUTURE_FIX_SLACK_SECONDS: float = 5.0

# The fixed order reasons appear in on every call, regardless of which checks
# actually tripped. Defined once as a tuple and filtered below, so two
# assessments that fail the same two gates always render the same two-item list
# in the same order — a UI list that silently reordered itself between two
# otherwise-identical evaluations would be a bug users notice instantly.
_REASON_ORDER: tuple[ProximityReason, ...] = (
    "missing_phone",
    "missing_tracker",
    "missing_time",
    "missing_accuracy",
    "poor_accuracy",
    "stale_fix",
    "time_skew",
    "future_fix",
)


def _fix_age_seconds(*, captured_at: datetime, evaluated_at: datetime) -> float:
    """Seconds between a source fix's own timestamp and the evaluation instant.

    Positive means the fix is from the past, as every honest fix is. Negative
    means the source timestamp claims to be from the future relative to
    `evaluated_at` — see FUTURE_FIX_SLACK_SECONDS above for how that is judged.
    """
    return (evaluated_at - captured_at).total_seconds()


def evaluate_proximity(
    *,
    driver_lat: float | None,
    driver_lng: float | None,
    tracker_lat: float | None,
    tracker_lng: float | None,
    driver_captured_at: datetime | None,
    tracker_captured_at: datetime | None,
    driver_accuracy_metres: float | None,
    evaluated_at: datetime,
    max_separation_metres: float,
    max_age_seconds: int,
    max_skew_seconds: int,
    max_phone_accuracy_metres: float,
) -> tuple[ProximityVerdict, float | None, list[ProximityReason]]:
    """Compare the driver's phone fix against the truck's tracker fix.

    Returns `(verdict, separation_metres, reasons)`.

    `separation_metres` is the factual straight-line distance, computed whenever
    BOTH coordinate pairs exist — even when every other quality gate fails and
    the verdict ends `'unverified'`. A real measured distance is evidence in its
    own right (exactly the stance corroboration_service.py takes on distance:
    "logged... so a mismatch is traceable"); withholding it because a timestamp
    happened to be stale would hide information the UI can legitimately show,
    captioned as unreliable. It is `None` only when a coordinate pair is itself
    missing, since there is then nothing to measure between.

    `verdict` is `'within_limit'` or `'separated'` ONLY when every quality gate
    passes (`reasons` is empty) — never through a fallback that treats missing
    data as passing. Any tripped gate forces `'unverified'`, regardless of what
    the raw distance happens to be; an unverified result never resolves to
    `'within_limit'` through a zero-distance or assumed-fresh shortcut.
    """
    triggered: set[ProximityReason] = set()

    missing_phone = driver_lat is None or driver_lng is None
    missing_tracker = tracker_lat is None or tracker_lng is None
    if missing_phone:
        triggered.add("missing_phone")
    if missing_tracker:
        triggered.add("missing_tracker")

    if driver_captured_at is None or tracker_captured_at is None:
        # We need BOTH timestamps to compare timing at all — an absent side means
        # "cannot verify timing", not "assume it's live" (same stance
        # corroboration_service._within_corroboration_skew takes).
        triggered.add("missing_time")

    if driver_accuracy_metres is None:
        triggered.add("missing_accuracy")
    elif driver_accuracy_metres > max_phone_accuracy_metres:
        triggered.add("poor_accuracy")

    # Freshness and future-fix checks run independently per source timestamp,
    # whenever that particular timestamp exists — even if the OTHER side's
    # timestamp is missing, since "missing_time" above already reports that half
    # of the story and a present timestamp's own freshness is still real
    # information.
    for captured_at in (driver_captured_at, tracker_captured_at):
        if captured_at is None:
            continue
        age_seconds = _fix_age_seconds(captured_at=captured_at, evaluated_at=evaluated_at)
        if age_seconds > max_age_seconds:
            triggered.add("stale_fix")
        elif age_seconds < -FUTURE_FIX_SLACK_SECONDS:
            triggered.add("future_fix")

    if driver_captured_at is not None and tracker_captured_at is not None:
        skew_seconds = abs((driver_captured_at - tracker_captured_at).total_seconds())
        if skew_seconds > max_skew_seconds:
            triggered.add("time_skew")

    reasons = [reason for reason in _REASON_ORDER if reason in triggered]

    separation_metres: float | None = None
    if not missing_phone and not missing_tracker:
        separation_metres = haversine_metres(driver_lat, driver_lng, tracker_lat, tracker_lng)

    if reasons:
        verdict: ProximityVerdict = "unverified"
    elif separation_metres is None:
        # Unreachable in practice: an empty `reasons` means neither
        # `missing_phone` nor `missing_tracker` triggered, which is exactly the
        # condition that guarantees `separation_metres` was computed above. Kept
        # as an explicit branch — rather than an assert — so this function's
        # return type stays honest to a type-checker without leaning on control
        # flow it cannot see across, and so a future edit that breaks the
        # invariant fails safe into 'unverified' instead of a crash or a
        # fabricated pass.
        verdict = "unverified"
    else:
        verdict = "within_limit" if separation_metres <= max_separation_metres else "separated"

    return verdict, separation_metres, reasons


__all__ = ["FUTURE_FIX_SLACK_SECONDS", "evaluate_proximity"]
