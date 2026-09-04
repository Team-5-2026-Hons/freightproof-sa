"""Geofence corroboration verdict for FP-68: does a Pulsit tracker fix agree with a
precinct's location, within the operational GPS tolerance?

Deliberately pure: no DB, no HTTP, no writes. The caller (FP-143) is responsible for
fetching the fix and the precinct and for persisting `phase_events.pulsit_geofence_
confirmed`; this module only turns (fix, precinct) into a verdict. Evidence, not
operations — this records whether the tracker agrees with the depot, it does not act
on the answer.
"""

import logging
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING, Optional

from app.core.config import settings
from app.core.geo import haversine_metres

if TYPE_CHECKING:
    # Import-time only: avoids a hard runtime dependency on db/models from an
    # orchestration module that otherwise touches no DB, while still typing the
    # `precinct` parameter precisely for callers and mypy.
    from app.db.models.organisations import Precinct

logger = logging.getLogger(__name__)

# Mirrors two authoritative sources that must not silently diverge: the
# server_default="200" on Precinct.geofence_radius_metres (db/models/organisations.py)
# and _RADIUS_DEFAULT_METRES in schemas/organisations.py. The column is NOT NULL, so a
# real row can never actually have a None radius — this constant only exists as a
# defensive guard for a partially-built or detached Precinct object in a test or a
# not-yet-flushed unit of work, not as an expected runtime state.
DEFAULT_GEOFENCE_RADIUS_METRES = 200


class GeofenceVerdictReason(str, Enum):
    """Why the verdict came out the way it did. Local to this module — nothing here
    is persisted, so this does not belong in the shared db/models/enums.py."""

    # Distance was actually computed; `confirmed` carries the real geometric verdict.
    MEASURED = "measured"
    # No tracker fix was available to compare (fix was None, or its lat/lng were None).
    NO_FIX = "no_fix"
    # The precinct had no usable coordinates (precinct was None, or lat/lng were None).
    NO_PRECINCT_COORDINATES = "no_precinct_coordinates"


@dataclass(frozen=True)
class TrackerFix:
    """A single Pulsit tracker position, reduced to only what this module needs.

    FP-87 (the Pulsit HTTP client) does not exist yet, so this module deliberately
    owns this shape and FP-87 will map its response onto it — not the reverse. No
    timestamp, device id, or source field: a geofence check only ever needs "where",
    and adding fields this module doesn't use would just be speculative coupling to
    an API that hasn't been built.
    """

    lat: float | Decimal
    lng: float | Decimal


@dataclass(frozen=True)
class GeofenceVerdict:
    """The outcome of comparing one fix against one precinct's geofence.

    `radius_metres` and `tolerance_metres` report the values actually applied (after
    any None-fallback), so a downstream reader can reconstruct the arithmetic without
    re-deriving defaults themselves.
    """

    confirmed: bool
    # None means "not computed" (a guard tripped before any maths ran) — never
    # confused with 0.0, which is a real, different claim: the fix sat exactly on
    # the precinct's centre.
    distance_metres: Optional[float]
    radius_metres: Optional[int]
    tolerance_metres: int
    in_tolerance_band: bool
    reason: GeofenceVerdictReason


def evaluate_geofence(
    fix: Optional[TrackerFix],
    precinct: "Optional[Precinct]",
    *,
    tolerance_metres: Optional[int] = None,
) -> GeofenceVerdict:
    """Compare a tracker fix against a precinct's geofence and return a verdict.

    A plain `def`, not `async def`: this repo's async rule exists for DB/HTTP work,
    and this function performs neither — it is pure arithmetic over its arguments, so
    marking it async would be cargo-cult concurrency with no I/O to yield on.

    `tolerance_metres=None` means "use the operational default", read from
    `settings.GPS_TOLERANCE_METRES` rather than baked in as a default argument, so
    tests can vary it per-call without patching global config.

    Never raises into the caller: missing inputs are real integration problems and
    are logged as warnings, but they resolve to an honest verdict rather than an
    exception, since a corroboration check that can throw is one FP-143 would have to
    wrap in a try/except anyway.
    """
    effective_tolerance = (
        settings.GPS_TOLERANCE_METRES if tolerance_metres is None else tolerance_metres
    )

    if fix is None or fix.lat is None or fix.lng is None:
        logger.warning("Geofence check skipped: no tracker fix available to compare.")
        return GeofenceVerdict(
            confirmed=False,
            distance_metres=None,
            radius_metres=None,
            tolerance_metres=effective_tolerance,
            in_tolerance_band=False,
            reason=GeofenceVerdictReason.NO_FIX,
        )

    if precinct is None or precinct.latitude is None or precinct.longitude is None:
        logger.warning("Geofence check skipped: precinct has no usable coordinates.")
        return GeofenceVerdict(
            confirmed=False,
            distance_metres=None,
            radius_metres=None,
            tolerance_metres=effective_tolerance,
            in_tolerance_band=False,
            reason=GeofenceVerdictReason.NO_PRECINCT_COORDINATES,
        )

    # NOT NULL in the schema — see DEFAULT_GEOFENCE_RADIUS_METRES docstring above for
    # why this branch exists at all despite that.
    radius = (
        DEFAULT_GEOFENCE_RADIUS_METRES
        if precinct.geofence_radius_metres is None
        else precinct.geofence_radius_metres
    )

    distance = haversine_metres(fix.lat, fix.lng, precinct.latitude, precinct.longitude)

    # Lenient band: phase_events.pulsit_geofence_confirmed (FP-143) is a single
    # nullable boolean, so this verdict must reduce to one bool. `confirmed` uses the
    # tolerance-widened radius; `in_tolerance_band` separately flags the marginal
    # case — inside the widened band but outside the radius proper — so a reviewer
    # reading confirmed=True, in_tolerance_band=True can see the call was marginal,
    # and FP-145 can render "driver and truck 3.1 km apart" honestly instead of a
    # flat pass/fail.
    confirmed = distance <= radius + effective_tolerance
    in_tolerance_band = radius < distance <= radius + effective_tolerance

    return GeofenceVerdict(
        confirmed=confirmed,
        distance_metres=distance,
        radius_metres=radius,
        tolerance_metres=effective_tolerance,
        in_tolerance_band=in_tolerance_band,
        reason=GeofenceVerdictReason.MEASURED,
    )
