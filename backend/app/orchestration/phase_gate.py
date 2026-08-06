"""Derives which phases are waiting on the warehouse scan feed.

Pure read path: no writes, no side effects, no exceptions raised for business
outcomes. Two consumers — the read schema (so the driver app can render a waiting
screen) and phase_service's completion guard (so a hand-crafted POST cannot slip
past the UI). Both must agree, which is why the logic lives here once rather than
twice.

Gating is per (phase_type, trip_stop_id), never per trip: a cross-dock trip loads
at several stops and each has its own warehouse and its own session.

Three states, not two (design §3.1):
  - no expected parcel set at this stop  -> None. NOT blocked.
  - expected set exists, session open    -> BLOCKED_ON_SCAN
  - session closed                       -> None

The first is load-bearing. A trip created without a Parcel Perfect reference has
no Consignment and no Parcel rows; lib/api/manifest.ts records this as "common"
and "a normal state, not a failure". Without that state such trips would block at
loading forever and move only by dispatcher override.

Layering: orchestration -> integrations, db. Never imports from api/.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseType
from app.db.models.trips import Consignment
from app.integrations.scan_feed import ScanDirection, get_scan_feed

# The only value blocked_on takes today. A string rather than a bool so a second
# gate (telemetry, customs) can be added later without changing the field's type
# on the wire and breaking the shared TS contract.
BLOCKED_ON_SCAN = "warehouse_scan"

# Which phase reads which direction. Any phase absent from this map is never
# blocked — that is the whole rule, stated once.
_GATED_PHASES: dict[PhaseType, ScanDirection] = {
    PhaseType.LOADING: ScanDirection.OUT,
    PhaseType.CONFIRMATION: ScanDirection.IN,
}


async def blocked_on_by_stop(
    db: AsyncSession, *, trip_id: uuid.UUID,
) -> dict[tuple[PhaseType, uuid.UUID], str | None]:
    """Map (phase_type, trip_stop_id) -> blocked_on, for this whole trip.

    Built once per request and passed down, rather than derived per phase event:
    PhaseEventRead.from_event is synchronous and pure by design, and deriving this
    inside it would mean either a DB call from a sync method or an N+1 across every
    phase of every trip-detail response.
    """
    result = await db.execute(
        select(
            Consignment.parcel_perfect_reference,
            Consignment.pickup_stop_id,
            Consignment.delivery_stop_id,
        ).where(Consignment.trip_id == trip_id)
    )
    consignments = result.all()

    feed = get_scan_feed()
    blocked: dict[tuple[PhaseType, uuid.UUID], str | None] = {}

    for phase_type, direction in _GATED_PHASES.items():
        for reference, pickup_stop_id, delivery_stop_id in consignments:
            stop_id = pickup_stop_id if direction is ScanDirection.OUT else delivery_stop_id
            if stop_id is None:
                # FP-112 partitioning not populated on this consignment — there is no
                # stop to attribute the scan to, so there is nothing to gate.
                continue

            key = (phase_type, stop_id)
            if blocked.get(key) == BLOCKED_ON_SCAN:
                # Already known blocked by another consignment at this stop. A stop
                # serving two waybills is blocked while EITHER session is still open,
                # so nothing a later consignment reports can clear it — skip the call.
                continue

            closed = await feed.is_scan_session_closed(
                consignment_reference=reference,
                stop_reference=str(stop_id),
                direction=direction,
            )
            blocked[key] = None if closed else BLOCKED_ON_SCAN

    return blocked


def blocked_on_for(
    blocked_by_stop: dict[tuple[PhaseType, uuid.UUID], str | None],
    *,
    phase_type: PhaseType,
    trip_stop_id: uuid.UUID | None,
) -> str | None:
    """Look one phase up in the map. Absent means not gated, which is not blocked."""
    if trip_stop_id is None:
        return None
    return blocked_by_stop.get((phase_type, trip_stop_id))
