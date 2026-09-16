"""FP-116 "move the truck" — dev-only control that moves a Pulsit tracker.

Separate from dev_triggers.py: needs a stricter guard, PULSE_USE_MOCK in addition to
DEV_PANEL_ENABLED, since staging into a live Pulsit client would do nothing.

This endpoint writes Pulsit mock state only — no phase_events row, no trip_exceptions
row, no commit — so the exception the room sees on screen arrives through the real
geofence/exception pipeline, not from this endpoint faking it.
tests/integration/test_dev_pulsit.py asserts DB row counts are unchanged.

The returned verdict uses `evaluate_geofence`, the same pure function a handshake calls,
as a read only — it shows what the staged position yields right now.
"""

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.config import settings
from app.core.demo_waypoints import DEMO_WAYPOINTS, DemoWaypoint, get_waypoint
from app.db.models.organisations import Precinct
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.integrations.pulsit import (
    MockPulsitClient,
    PulsitUnsupportedError,
    get_pulsit_client,
)
from app.orchestration.geofence_service import TrackerFix, evaluate_geofence
from app.schemas.dev import MoveTruckRequest, MoveTruckResponse, WaypointRead
from app.schemas.people import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dev/pulsit", tags=["dev-triggers"])

# A trigger that silently does nothing is worse in a demo than one that fails loudly.
_MOCK_REQUIRED_DETAIL = (
    "Moving the truck requires the Pulsit mock — check PULSE_USE_MOCK."
)


def move_truck_enabled() -> bool:
    """Whether the move-truck router should be registered at all.

    Two signals, both default-closed: DEV_PANEL_ENABLED (the standard dev-trigger gate)
    and PULSE_USE_MOCK (staging into a live Pulsit client would do nothing). ENVIRONMENT
    is deliberately not a third signal — the demo host sets it to production to hide
    /docs, not to gate dev panels (see dev_triggers.dev_panel_enabled()).

    When either is false the router is not registered, so the paths 404, not 403.
    """
    return settings.DEV_PANEL_ENABLED and settings.PULSE_USE_MOCK


def _to_waypoint_read(waypoint: DemoWaypoint) -> WaypointRead:
    """Map a waypoint fixture onto its wire shape. One place, so the two cannot drift."""
    return WaypointRead(
        waypoint_id=waypoint.waypoint_id,
        label=waypoint.label,
        sequence=waypoint.sequence,
        description=waypoint.description,
        latitude=waypoint.latitude,
        longitude=waypoint.longitude,
        intended_distance_metres=waypoint.intended_distance_metres,
        expected_confirmed=waypoint.expected_confirmed,
    )


@router.get(
    "/waypoints",
    response_model=list[WaypointRead],
    summary="The ordered waypoints the presenter can move the truck to",
)
async def list_waypoints(
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[WaypointRead]:
    """Serve the route so the panel renders one definition of it, not a TypeScript copy."""
    return [_to_waypoint_read(w) for w in DEMO_WAYPOINTS]


async def _load_trip_context(
    db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID
) -> tuple[Trip, Vehicle, Precinct]:
    """Resolve the trip, the horse whose tracker moves, and the precinct to measure from.

    Scoped to the caller's organisation. Precinct is the trip's current stop, falling
    back to the first stop when `current_stop` is unset (not yet activated). Used only to
    pick which distance to *display* — a stale cache degrades the readout, nothing else.
    """
    trip = (await db.execute(
        select(Trip).where(
            Trip.id == trip_id,
            Trip.operator_organization_id == organization_id,
        )
    )).scalar_one_or_none()
    if trip is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=f"Trip {trip_id} not found.",
        )

    horse = (await db.execute(
        select(Vehicle).where(Vehicle.id == trip.horse_id)
    )).scalar_one_or_none()
    if horse is None:
        # Trip.horse_id is a NOT NULL FK, so this shouldn't happen — but a 500 mid-demo
        # is worse than a readable refusal.
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Trip {trip_id} has no resolvable horse vehicle.",
        )

    stops = list((await db.execute(
        select(TripStop, Precinct)
        .join(Precinct, Precinct.id == TripStop.precinct_id)
        .where(TripStop.trip_id == trip_id)
        .order_by(TripStop.sequence)
    )).all())
    if not stops:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Trip {trip_id} has no stops to measure a distance from.",
        )

    precinct = next(
        (p for stop, p in stops if stop.sequence == trip.current_stop),
        stops[0][1],
    )
    return trip, horse, precinct


@router.post(
    "/move-truck",
    response_model=MoveTruckResponse,
    summary="Move the trip's tracker to a waypoint (Pulsit mock state only)",
)
async def move_truck(
    body: MoveTruckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> MoveTruckResponse:
    """Stage a tracker position (idempotent), then report where the truck is and what the fence says."""
    waypoint = get_waypoint(body.waypoint_id)
    if waypoint is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Unknown waypoint {body.waypoint_id!r}.",
        )

    client = get_pulsit_client(organization_id=current_user.organization_id)
    if not isinstance(client, MockPulsitClient):
        # Unreachable while the router's guard holds; kept because PULSE_USE_MOCK is
        # mutable at runtime (tests do this), and a silently-live client must never happen.
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        )

    trip, horse, precinct = await _load_trip_context(
        db, trip_id=body.trip_id, organization_id=current_user.organization_id,
    )

    # The only write this endpoint performs, and it is to the mock.
    # Unpacked and tested for None directly, not via `waypoint.is_no_signal`: mypy can't
    # narrow Optional[Decimal] through a property call.
    latitude, longitude = waypoint.latitude, waypoint.longitude
    try:
        if latitude is None or longitude is None:
            await client.stage_no_fix(horse.pulsit_device_id)
        else:
            await client.stage_position(
                horse.pulsit_device_id, lat=latitude, lng=longitude,
            )
    except PulsitUnsupportedError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        ) from exc

    # Everything below is a read. Read the position back through get_position rather than
    # echoing the waypoint, so a staging bug shows up here instead of being masked.
    fix = await client.get_position(horse.pulsit_device_id)

    # Explicit None checks alongside has_position let mypy narrow Optional[Decimal].
    tracker_fix: Optional[TrackerFix] = (
        TrackerFix(lat=fix.lat, lng=fix.lng)
        if fix.has_position and fix.lat is not None and fix.lng is not None
        else None
    )
    verdict = evaluate_geofence(tracker_fix, precinct)

    logger.info(
        "Dev panel moved trip=%s device=%s to waypoint=%s (confirmed=%s)",
        body.trip_id, horse.pulsit_device_id, waypoint.waypoint_id, verdict.confirmed,
    )

    return MoveTruckResponse(
        trip_id=trip.id,
        waypoint_id=waypoint.waypoint_id,
        waypoint_label=waypoint.label,
        device_id=horse.pulsit_device_id,
        vehicle_registration=horse.registration,
        precinct_id=precinct.id,
        precinct_name=precinct.name,
        latitude=fix.lat,
        longitude=fix.lng,
        has_position=fix.has_position,
        distance_metres=verdict.distance_metres,
        geofence_radius_metres=verdict.radius_metres,
        gps_tolerance_metres=verdict.tolerance_metres,
        # Null, not False, when there's no fix: an unreachable tracker hasn't contradicted the driver.
        geofence_confirmed=verdict.confirmed if fix.has_position else None,
        in_tolerance_band=verdict.in_tolerance_band,
        verdict_reason=verdict.reason.value,
    )
