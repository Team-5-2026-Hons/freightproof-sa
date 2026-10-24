"""Stamps the driver's reported fix onto a phase event."""

import logging
from decimal import Decimal

from app.db.models.enums import DriverPositionSource
from app.db.models.phases import PhaseEvent
from app.orchestration.phases.demo_position import staged_demo_position
from app.schemas.phases import PhaseCompleteRequest

logger = logging.getLogger(__name__)


async def _record_driver_position(event: PhaseEvent, payload: PhaseCompleteRequest) -> None:
    """Stamp the driver's phone fix and capture instant onto the phase event.

    Called by every advance_*, not just activation: the PWA no longer has manual
    "Capture GPS Location" steps, it takes a fix silently as the driver swipes to
    confirm, so every phase event can now say where it was completed.

    DEMO STAGING: when a position has been staged for this trip (dev panel -> "move the
    phone"; see phases/demo_position.py), it replaces the reported coordinates and the row
    is stamped SIMULATED. Every other row is stamped DEVICE. The stamp is written in the
    same place as the coordinates themselves, deliberately — the two cannot drift, and no
    path can store a position without saying where it came from. Nothing is staged in a
    normal deployment, where no provider is installed at all.

    Only writes when a value is present. A None must never overwrite something already
    stored by an earlier attempt — a replayed offline submission whose original capture
    succeeded would otherwise erase it on retry. The GPS pair and driver_captured_at
    are gated independently of each other: a phase can carry a capture time
    with no GPS fix (a denied permission) or an older client's GPS fix with no capture
    time at all, and neither absence should suppress the other.

    POPIA: these columns stay in Postgres. Every canonical payload builder in this
    module is an explicit whitelist, so nothing written here can reach a Hedera hash.
    """
    staged = await staged_demo_position(event.trip_id)
    if staged is not None:
        staged_lat, staged_lng = staged
        # Overwrites unconditionally, unlike the reported pair below: a staged position is
        # the operator saying "pretend the phone is here", and honouring it only when the
        # handset also produced a fix would leave a demo at the mercy of the room's GPS.
        event.driver_phone_lat = staged_lat
        event.driver_phone_lng = staged_lng
        event.driver_position_source = DriverPositionSource.SIMULATED.value
        logger.warning(
            "Phase event %s recorded a SIMULATED phone position (demo staging) for trip=%s",
            event.id, event.trip_id,
        )
    elif payload.driver_phone_lat is not None and payload.driver_phone_lng is not None:
        # str() before Decimal: handing a float straight to a Numeric(10, 7) column
        # carries the float's binary rounding error into fixed point (-26.0942 stores
        # as -26.0941999...). The string form is the coordinate the phone actually
        # reported.
        event.driver_phone_lat = Decimal(str(payload.driver_phone_lat))
        event.driver_phone_lng = Decimal(str(payload.driver_phone_lng))
        event.driver_position_source = DriverPositionSource.DEVICE.value

    # Never substituted with completed_at or datetime.now(UTC) when absent —
    # an invented capture instant would defeat the entire point of corroboration_
    # service's skew check, which exists specifically to distrust a value this code
    # made up.
    if payload.driver_captured_at is not None:
        event.driver_captured_at = payload.driver_captured_at

    # A preview is advisory and non-writing; completion always assembles its own
    # ActionLocationAssessment afterwards. Keep the driver's acknowledgement in its
    # own columns so it cannot be mistaken for, or suppress, the measured result.
    if payload.location_warning_acknowledged_at is not None:
        event.location_warning_acknowledged_at = payload.location_warning_acknowledged_at
    if payload.location_warning_reason is not None:
        event.location_warning_reason = payload.location_warning_reason
