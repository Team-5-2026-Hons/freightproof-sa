"""Dev-only placement of a trip's DRIVER-PHONE position.

The driver-side counterpart to dev/endpoints/pulsit.py's move-truck, and deliberately a
separate control: nothing here moves the tracker, and nothing in move-truck moves the
phone (Tim, 22 Oct 2026). Keeping them independent is also what leaves a genuine
phone/tracker divergence stageable for FP-145 GPS_MISMATCH work.

WHY IT EXISTS: a demo walk happens in a room nowhere near the depots a trip names, so the
handset's real fix sits ~1000km from the expected precinct and every phase records a
location warning. Placing the phone at the origin before the first submission, and at the
destination before the last, makes the walk read the way a real trip would.

WHAT IT COSTS, AND THE LIMIT ON IT: a phase completed while a position is staged is
stamped `driver_position_source = 'simulated'` in the ledger
(orchestration/phases/driver_position.py). The staged coordinate is therefore never
presentable as a real capture — which is the only reason staging one is acceptable.

Writes nothing to Postgres: the staged pair lives in the mock-state store
(dev/services/demo_phone.py) and expires on its TTL. Registered under the same two guards
as move-truck — DEV_PANEL_ENABLED and PULSE_USE_MOCK — so these paths do not exist in a
normal deployment.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import ResourceNotFoundError
from app.db.models.organisations import Precinct
from app.db.models.trips import Trip, TripStop
from app.db.session import get_db
from app.dev.schemas import (
    PHONE_AT_ORIGIN,
    PHONE_AT_STOP,
    PHONE_PLACEMENT_LABELS,
    PHONE_RELEASE,
    MovePhoneRequest,
    MovePhoneResponse,
)
from app.dev.services import demo_phone as dev_demo_phone
from app.dev.services import truck as dev_truck_service
from app.schemas.people import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dev/phone", tags=["dev-triggers"])


async def _load_trip(db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID) -> Trip:
    """Scope the trip to the caller's organisation.

    Same shape as dev/endpoints/tracker.py's own loader: a valid dispatcher token for one
    operator must not be able to address another operator's trip, and a trip that exists
    elsewhere is indistinguishable here from one that does not exist.
    """
    trip = (await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == organization_id)
    )).scalar_one_or_none()
    if trip is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=f"Trip {trip_id} not found.",
        )
    return trip


async def _end_stop(
    db: AsyncSession, *, trip_id: uuid.UUID, origin: bool,
) -> tuple[TripStop, Precinct]:
    """The first or last stop of the plan, with its precinct.

    Read off the stops in plan order rather than the trip's own origin/destination
    precinct columns: on a cross-dock plan the last STOP is what the final phases are
    measured against, and LENGTH IS DATA — the plan, not the header, says where the
    trip ends.
    """
    rows = list((await db.execute(
        select(TripStop, Precinct)
        .join(Precinct, Precinct.id == TripStop.precinct_id)
        .where(TripStop.trip_id == trip_id)
        .order_by(TripStop.sequence)
    )).all())
    if not rows:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Trip {trip_id} has no stops to place a phone at.",
        )
    stop, precinct = rows[0] if origin else rows[-1]
    return stop, precinct


@router.post(
    "/move",
    response_model=MovePhoneResponse,
    summary="Place this trip's driver-phone position, or release it to the real device",
)
async def move_phone(
    body: MovePhoneRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> MovePhoneResponse:
    """Stage where this trip's phone reports from, or hand it back to the handset.

    `release` is the off switch and the state of every trip that was never staged: the
    device's own fix is recorded again, stamped `device`.

    Idempotent by construction — staging replaces rather than merges, so pressing the
    same panel option twice leaves identical state and returns an identical response.
    """
    trip = await _load_trip(
        db, trip_id=body.trip_id, organization_id=current_user.organization_id,
    )

    if body.placement == PHONE_RELEASE:
        await dev_demo_phone.clear_phone_position(trip.id)
        logger.info("Dev panel released the staged phone position for trip=%s", trip.id)
        return MovePhoneResponse(
            trip_id=trip.id,
            placement=body.placement,
            placement_label=PHONE_PLACEMENT_LABELS[body.placement],
            staged=False,
            recorded_as="device",
        )

    if body.placement == PHONE_AT_STOP:
        # MovePhoneRequest's validator guarantees trip_stop_id for this placement.
        assert body.trip_stop_id is not None
        try:
            stop, precinct = await dev_truck_service.resolve_target_stop(
                db, trip_id=trip.id, trip_stop_id=body.trip_stop_id,
            )
        except ResourceNotFoundError as exc:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc),
            ) from exc
    else:
        stop, precinct = await _end_stop(
            db, trip_id=trip.id, origin=body.placement == PHONE_AT_ORIGIN,
        )

    # The precinct CENTRE — the same geometry move-truck's at_stop scenario offsets from,
    # so a phone and a truck placed at one stop agree exactly rather than approximately.
    await dev_demo_phone.stage_phone_position(
        trip.id, lat=precinct.latitude, lng=precinct.longitude,
    )
    logger.warning(
        "Dev panel staged a simulated phone position for trip=%s at stop=%s (%s)",
        trip.id, stop.id, precinct.name,
    )

    return MovePhoneResponse(
        trip_id=trip.id,
        placement=body.placement,
        placement_label=PHONE_PLACEMENT_LABELS[body.placement],
        staged=True,
        latitude=precinct.latitude,
        longitude=precinct.longitude,
        trip_stop_id=stop.id,
        precinct_name=precinct.name,
    )
