"""Derives which phases are waiting on the warehouse scan feed.

Shared by the read schema and phase_service's completion guard so both agree.
Gated per (phase_type, trip_stop_id), since a cross-dock trip has its own scan
session at each stop. Three states (design §3.1): no expected parcel set -> not
blocked; session open -> BLOCKED_ON_SCAN; session closed -> not blocked. A trip
with no Parcel Perfect reference has no Consignment rows and must never block at
loading forever.

Layering: orchestration -> integrations, db. Never imports from api/.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseType
from app.db.models.trips import Consignment
from app.integrations.scan_feed import ScanDirection, ScanSessionQuery, get_scan_feed

# String rather than bool so a second gate (telemetry, customs) can be added later
# without changing the field's type on the wire.
BLOCKED_ON_SCAN = "warehouse_scan"

# Any phase absent from this map is never blocked. Public: dev_triggers.py imports
# it directly to report which phase gates which stop's scan.
GATED_PHASES: dict[PhaseType, ScanDirection] = {
    PhaseType.LOADING: ScanDirection.OUT,
    PhaseType.CONFIRMATION: ScanDirection.IN,
    # IN, not OUT: blocked_on_by_stop keys IN off Consignment.delivery_stop_id,
    # the right stop for a drop-off.
    PhaseType.UNLOADING: ScanDirection.IN,
}


async def blocked_on_by_stop(
    db: AsyncSession, *, trip_id: uuid.UUID,
) -> dict[tuple[PhaseType, uuid.UUID], str | None]:
    """Map (phase_type, trip_stop_id) -> blocked_on, for this whole trip.

    Built once per request and passed down rather than derived per phase event,
    since PhaseEventRead.from_event is sync and deriving it there would mean an
    N+1 across every phase of every trip-detail response.
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

    # Batch all queries rather than resolving inside the loop, to avoid a feed
    # round trip per consignment per gated phase on every trip-detail render.
    targets: list[tuple[PhaseType, uuid.UUID]] = []
    queries: list[ScanSessionQuery] = []

    for phase_type, direction in GATED_PHASES.items():
        for reference, pickup_stop_id, delivery_stop_id in consignments:
            stop_id = pickup_stop_id if direction is ScanDirection.OUT else delivery_stop_id
            if stop_id is None:
                continue  # FP-112 partitioning not populated — nothing to gate

            targets.append((phase_type, stop_id))
            queries.append(ScanSessionQuery(
                consignment_reference=reference,
                stop_reference=str(stop_id),
                direction=direction,
            ))

    closed_flags = await feed.closed_sessions(queries)

    blocked: dict[tuple[PhaseType, uuid.UUID], str | None] = {}
    for key, closed in zip(targets, closed_flags, strict=True):
        if blocked.get(key) == BLOCKED_ON_SCAN:
            # A stop serving two waybills stays blocked while EITHER session is open.
            continue
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
