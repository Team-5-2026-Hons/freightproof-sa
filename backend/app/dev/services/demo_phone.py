"""Demo-only staging of the DRIVER'S PHONE position, per trip.

WHY THIS EXISTS: the demo runs against a real backend from a room nowhere near the
depots a trip names. The truck side of a phase's location evidence already has a staging
seam (dev/endpoints/pulsit.py's move-truck, FP-116/FP-197), but the phone fix is captured
on the device, so a staged truck and a real phone disagree by ~1000km and every phase
records a location warning. This stages the phone alongside the truck so a walkthrough
reads the way a real trip would, with nothing to type on the handset mid-demo.

WHAT IT IS NOT: evidence. The staged pair is substituted into the driver's request at the
API edge (api/v1/endpoints/phases.py) and is then indistinguishable, in the phase row and
in the audit pack, from a coordinate the phone actually reported. There is deliberately
no provenance column (decided 22 Oct 2026) — so this module's gates ARE the safeguard:

  * DEV_PANEL_ENABLED and PULSE_USE_MOCK must BOTH be true, the same double gate
    move-truck uses. In a deployment with either off, the staging routes are not
    registered and `staged_position` below always returns None, so the substitution
    cannot happen.
  * State lives only in the mock_state Redis namespace, beside the staged tracker
    positions, and expires on that store's TTL. Nothing is written to Postgres here.

Layering: dev service — may read config and integrations (mock_state), never api/.
"""

import logging
import uuid
from decimal import Decimal
from typing import Optional

from app.core.config import settings
from app.integrations.mock_state import MockStateStore, build_key, get_mock_state_store

logger = logging.getLogger(__name__)

# Separates these keys from the staged scan/PP/tracker state in the same namespace, so a
# scoped flush can address them and nothing collides.
_KIND = "demo_phone"

_LAT_FIELD = "lat"
_LNG_FIELD = "lng"


def demo_phone_enabled() -> bool:
    """Whether a staged phone position may be staged OR read at all.

    Both flags, matching dev_pulsit.move_truck_enabled(): staging the phone while
    pointed at live Pulsit would fake half of a comparison whose other half is real,
    which is worse than faking neither.
    """
    return settings.DEV_PANEL_ENABLED and settings.PULSE_USE_MOCK


def _key(trip_id: uuid.UUID) -> str:
    return build_key(_KIND, str(trip_id))


async def stage_phone_position(
    trip_id: uuid.UUID, *, lat: Decimal, lng: Decimal,
    store: Optional[MockStateStore] = None,
) -> None:
    """Put this trip's phone fix at (lat, lng) until cleared or the store's TTL expires.

    Replaces rather than merges, exactly like MockPulsitClient.stage_position: pressing
    the same panel button twice must leave identical state, because re-pressing is how a
    presenter recovers from a mis-click.
    """
    if not demo_phone_enabled():
        # Caller-visible silence is fine here: the only callers are dev routes that do
        # not exist unless the same flags are on. Logged so a flag flipped mid-session
        # does not look like a storage failure.
        logger.warning("Ignoring staged phone position for trip=%s: demo phone staging is off", trip_id)
        return

    # str(), not float(): these coordinates are substituted into a request that lands in
    # a Numeric(10, 7) column, and a float round-trip would shift the last digit.
    await (store or get_mock_state_store()).set_json(
        _key(trip_id), {_LAT_FIELD: str(lat), _LNG_FIELD: str(lng)},
    )


async def clear_phone_position(
    trip_id: uuid.UUID, *, store: Optional[MockStateStore] = None,
) -> None:
    """Hand this trip's phone fix back to the device. Safe when nothing was staged."""
    await (store or get_mock_state_store()).set_json(_key(trip_id), {})


async def follow_tracker(
    trip_id: uuid.UUID, *, lat: Optional[Decimal], lng: Optional[Decimal], move_phone: bool,
    store: Optional[MockStateStore] = None,
) -> bool:
    """Put the phone where the tracker was just staged. Returns whether it staged one.

    The three cases a caller has, in one place so move_truck stays a thin shim:
      * not following     -> leave whatever is staged alone (the FP-145 escape hatch)
      * following, no fix -> clear, so a dark tracker does not leave the phone pinned
                             to where the truck used to be
      * following, a fix  -> stage that exact coordinate
    """
    if not move_phone:
        return False
    if lat is None or lng is None:
        await clear_phone_position(trip_id, store=store)
        return False
    await stage_phone_position(trip_id, lat=lat, lng=lng, store=store)
    return True


async def staged_position(
    trip_id: uuid.UUID, *, store: Optional[MockStateStore] = None,
) -> Optional[tuple[Decimal, Decimal]]:
    """The staged (lat, lng) for this trip, or None to use the device's own fix.

    None on every normal path: flags off, nothing staged, state cleared, or anything
    unreadable. Falling back to the real capture is the only safe direction to fail in,
    so no malformed value raises out of here.
    """
    if not demo_phone_enabled():
        return None

    try:
        state = await (store or get_mock_state_store()).get_json(_key(trip_id))
    except Exception:  # noqa: BLE001 — a dead Redis must not break a phase submit
        logger.exception("Could not read staged phone position for trip=%s; using the real fix", trip_id)
        return None

    if not state:
        return None

    raw_lat, raw_lng = state.get(_LAT_FIELD), state.get(_LNG_FIELD)
    if raw_lat is None or raw_lng is None:
        return None
    try:
        return Decimal(str(raw_lat)), Decimal(str(raw_lng))
    except Exception:  # noqa: BLE001 — InvalidOperation and anything else JSON held
        logger.exception("Staged phone position for trip=%s is unusable; using the real fix", trip_id)
        return None
