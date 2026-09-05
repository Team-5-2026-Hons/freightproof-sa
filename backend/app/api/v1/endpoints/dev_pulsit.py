"""FP-116 "move the truck" — the dev-only control that moves a Pulsit tracker.

Separate from dev_triggers.py deliberately, for two reasons. It carries its own,
stricter guard (that file's router needs only DEV_PANEL_ENABLED; this one additionally
needs PULSE_USE_MOCK, because staging a position into a live Pulsit client would do
nothing at all). And keeping it out of a file three other flows already live in means
this slice cannot conflict with a teammate's branch over the same lines.

THE RULE THIS FILE EXISTS TO UPHOLD, AND THE ONLY REASON THE DEMO IS WORTH ANYTHING:

    THIS ENDPOINT WRITES PULSIT MOCK STATE AND NOTHING ELSE.

No phase_events row. No trip_exceptions row. No trip state. No commit — this module
never opens a write transaction at all; its only database use is reading the trip, its
horse and its current precinct so the response can report real state.

The exception the room sees on screen therefore arrives through the real pipeline: the
real Pulsit client reading the moved position, the real geofence maths (FP-68), the
real column write (FP-143) and the real exception service (FP-145). A reviewer asking
"did you just insert that row?" has a clean answer, and
tests/integration/test_dev_pulsit.py asserts it by counting rows before and after.

The verdict returned below is computed with `evaluate_geofence` — the same pure
function a handshake calls. It is a read, not a write: the panel shows what the next
handshake WILL find, and it cannot drift from what the handshake actually decides
because it is not a second implementation of the arithmetic.
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

# Returned when the trip's horse has no tracker the mock library knows about. Mirrors
# dev_triggers._MOCK_REQUIRED_DETAIL's stance: a trigger that silently does nothing is
# worse in a demo than one that fails loudly.
_MOCK_REQUIRED_DETAIL = (
    "Moving the truck requires the Pulsit mock — check PULSE_USE_MOCK."
)


def move_truck_enabled() -> bool:
    """Whether the move-truck router should be registered at all.

    TWO independent signals, both defaulting to closed:

      * DEV_PANEL_ENABLED — the same deliberate opt-in that gates every other dev
        trigger. Absent from .env.example values, so an unconfigured deployment has
        no panel.
      * PULSE_USE_MOCK — staging a position while pointed at live Pulsit would write
        into a mock nobody reads, so the control would be a button that lies.

    When either is false the router is NOT REGISTERED — the paths 404 rather than 403,
    so there is nothing to probe and nothing to misconfigure later.

    ON THE ENVIRONMENT CHECK THAT IS NOT HERE: FP-197 as written asked for a
    non-production check as the second signal. It is deliberately not used, because in
    this codebase ENVIRONMENT="production" does not mean "real production" — the
    deployed demo host sets it to keep /docs, /redoc and /openapi.json unpublished
    (main.py), and dev_triggers.dev_panel_enabled() already records the team's decision
    to stop treating that flag as a dev-panel gate for exactly this reason. Gating on it
    here would make "move the truck" absent on the one host the demo actually runs on,
    which defeats the story. PULSE_USE_MOCK is the stronger second signal in any case:
    it is causally connected to whether this endpoint can do anything at all, where
    ENVIRONMENT is not.

    Treat DEV_PANEL_ENABLED as production config of the same weight as a credential,
    and turn it off when the demo window closes.
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
    """Serve the route so the panel renders one definition of it.

    Static data behind a dispatcher token: the panel needs it, and hardcoding the
    coordinates in TypeScript as well would give a corrected digit somewhere to hide.
    """
    return [_to_waypoint_read(w) for w in DEMO_WAYPOINTS]


async def _load_trip_context(
    db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID
) -> tuple[Trip, Vehicle, Precinct]:
    """Resolve the trip, the horse whose tracker moves, and the precinct to measure from.

    Scoped to the caller's organisation, so the panel cannot address another operator's
    fleet even with a valid dispatcher token.

    WHICH PRECINCT: the trip's current stop, falling back to the first stop when
    `current_stop` is unset (a trip that has not been activated yet sits at its origin).
    `Trip.current_stop` is a cache rebuilt from the phase-event ledger, and it is read
    here only to choose which distance to *display* — no verdict is stored from it, so a
    stale cache degrades the panel's readout and nothing else.
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
        # Trip.horse_id is a NOT NULL FK, so this is a broken fleet record rather than
        # an expected state — but a 500 mid-demo is worse than a readable refusal.
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
    """Stage a tracker position, then report where the truck is and what the fence says.

    Idempotent by construction: `stage_position` REPLACES the staged state for a device
    rather than merging into it, so pressing the same waypoint twice leaves Redis in the
    identical state and returns the identical response. Re-pressing is how a presenter
    recovers from a mis-click, so it must be boring.

    Nothing is committed. The session is used for three reads and never written to.
    """
    waypoint = get_waypoint(body.waypoint_id)
    if waypoint is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Unknown waypoint {body.waypoint_id!r}.",
        )

    client = get_pulsit_client()
    if not isinstance(client, MockPulsitClient):
        # Unreachable while the router's guard holds — the router is not registered
        # unless PULSE_USE_MOCK is true. Kept because the guard is enforced at import
        # time and the flag is mutable at runtime (tests do exactly that), and a
        # silently-live client is the one failure this file must never have.
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        )

    trip, horse, precinct = await _load_trip_context(
        db, trip_id=body.trip_id, organization_id=current_user.organization_id,
    )

    # ---- The only write this endpoint performs, and it is to the mock. ----
    # Unpacked into locals and tested for None directly rather than through
    # `waypoint.is_no_signal`: the property says the same thing, but mypy cannot narrow
    # Optional[Decimal] through a property call, and silencing that with a cast would
    # discard the one check that stops a None coordinate reaching stage_position.
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

    # ---- Everything below is a read, so the panel shows real state. ----
    # Read the position back through get_positions rather than echoing the waypoint:
    # that exercises the same path a handshake uses, so a staging bug shows up on the
    # panel instead of being masked by the panel restating its own request.
    fix = await client.get_position(horse.pulsit_device_id)

    # `has_position` is the check callers should make, and it is the one that carries
    # the meaning (status is OK *and* coordinates are present). The explicit None tests
    # alongside it are not redundancy for its own sake — they are what lets mypy narrow
    # Optional[Decimal] to Decimal, which a property cannot do.
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
        # Null rather than False when there is no fix: an unreachable tracker has not
        # contradicted the driver, and rendering that as a failed verdict would be the
        # panel accusing someone the pipeline deliberately does not accuse.
        geofence_confirmed=verdict.confirmed if fix.has_position else None,
        in_tolerance_band=verdict.in_tolerance_band,
        verdict_reason=verdict.reason.value,
    )
