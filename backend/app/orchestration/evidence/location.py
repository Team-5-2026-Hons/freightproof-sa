"""The driver's per-trip location trail — writes behind POST /trips/{id}/locations.

Records where the driver was while they used the app, which is what replaced the three
manual "Capture GPS Location" steps. Evidence, not operations: nothing here reroutes or
dispatches anything, it only writes down what the phone reported.
"""

import logging
import uuid
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import TripStatus
from app.db.models.locations import TripLocationPing
from app.orchestration.substitutions.access import WriteClaim, authorise_driver_write
from app.schemas.locations import LocationPingCreate

logger = logging.getLogger(__name__)

# A finished trip's trail is closed. Late pings for one are dropped rather than 404'd:
# the offline queue can legitimately surface a fix captured before the trip closed, and
# failing that request would make the PWA retry a write that can never succeed.
_CLOSED_STATUSES = {TripStatus.CLOSED, TripStatus.CANCELLED}


async def record_location_pings(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    pings: list[LocationPingCreate], custody_sequence: int | None = None,
) -> int:
    """Append fixes to one trip's trail; returns how many were stored.

    Raises ResourceNotFoundError if the trip doesn't exist or the driver never held it, and a
    CustodyAccessError if they held it earlier or the batch belongs to another custody period
    (the caller maps those to 409 with the contract's code). That gate is the whole
    authorisation boundary for this table: a driver may only write their own position onto the
    trip they hold right now, and driver_id comes from the verified token, never the body.
    """
    trip, _ = await authorise_driver_write(
        db, trip_id=trip_id, driver_id=driver_id, claim=WriteClaim(custody_sequence),
    )

    if trip.status in _CLOSED_STATUSES:
        # Logged, not silent: a client still pinging a closed trip is a real client bug
        # worth seeing, it just isn't the driver's problem to retry.
        logger.info(
            "Dropped %d location ping(s) for %s trip %s", len(pings), trip.status, trip_id,
        )
        return 0

    db.add_all([
        TripLocationPing(
            trip_id=trip_id,
            driver_id=driver_id,
            # str() before Decimal: float -> Decimal directly carries the float's binary
            # rounding error into a fixed-point column (Decimal(-26.0942) is
            # -26.09419999...). The string form is what Numeric(10, 7) actually meant.
            lat=Decimal(str(ping.lat)),
            lng=Decimal(str(ping.lng)),
            accuracy_m=None if ping.accuracy_m is None else Decimal(str(ping.accuracy_m)),
            context=ping.context,
            recorded_at=ping.recorded_at,
        )
        for ping in pings
    ])
    await db.flush()
    return len(pings)
